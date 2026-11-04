import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './sqlite.js';
import { ROOT } from './env.js';

const dbPath = path.resolve(ROOT, process.env.DB_PATH || './data/delic.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const fresh = !fs.existsSync(dbPath);
export const db = await openDb(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-64000;');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const clean = r => (r ? { ...r } : r);
export const get = (sql, ...p) => clean(stmt(sql).get(...p.map(norm)));
export const all = (sql, ...p) => stmt(sql).all(...p.map(norm)).map(clean);
export const run = (sql, ...p) => stmt(sql).run(...p.map(norm));
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
// INSERT iz objekta
export function insert(table, obj) {
  const keys = Object.keys(obj);
  return run(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => obj[k]));
}
export function update(table, obj, where, ...wp) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  return run(`UPDATE "${table}" SET ${keys.map(k => `"${k}"=?`).join(',')} WHERE ${where}`, ...keys.map(k => obj[k]), ...wp);
}
export function columns(table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
}

// ---------------- Šema (ista kao stari program) ----------------
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
db.exec(SCHEMA);

// Dodatne tabele nove aplikacije
db.exec(`
CREATE TABLE IF NOT EXISTS app_olx_log (id INTEGER PRIMARY KEY AUTOINCREMENT, object_type TEXT, object_id TEXT, action TEXT, ok INTEGER, message TEXT, created_date TEXT);
CREATE TABLE IF NOT EXISTS app_vehicle_sale (id TEXT PRIMARY KEY, vehicle_id TEXT, the_price REAL, currency_id TEXT, note TEXT, status TEXT, created_by_id TEXT, created_date TEXT);
`);

// Indeksi za brzinu (ne mijenjaju podatke)
db.exec(`
CREATE INDEX IF NOT EXISTS ix_sp_status ON spare_part(active, status, created_date);
CREATE INDEX IF NOT EXISTS ix_sp_code ON spare_part(internal_code);
CREATE INDEX IF NOT EXISTS ix_sp_cat ON spare_part(catalog_number);
CREATE INDEX IF NOT EXISTS ix_sp_loc2 ON spare_part(location_id, status);
CREATE INDEX IF NOT EXISTS ix_sp_veh2 ON spare_part(vehicle_id, status);
CREATE INDEX IF NOT EXISTS ix_sp_type ON spare_part(type_id);
CREATE INDEX IF NOT EXISTS ix_sp_model ON spare_part(model_id);
CREATE INDEX IF NOT EXISTS ix_sp_make ON spare_part(make_id);
CREATE INDEX IF NOT EXISTS ix_sp_parent ON spare_part(parent_id);
CREATE INDEX IF NOT EXISTS ix_sp_created ON spare_part(created_date);
CREATE INDEX IF NOT EXISTS ix_sp_olx ON spare_part(external_olx_id);
CREATE INDEX IF NOT EXISTS ix_att_obj ON lib_attachment(object_id, active);
CREATE INDEX IF NOT EXISTS ix_slh_part ON spare_part_location_history(part_id);
CREATE INDEX IF NOT EXISTS ix_slh_rims ON spare_part_location_history(rims_id);
CREATE INDEX IF NOT EXISTS ix_slh_loc ON spare_part_location_history(location_id);
CREATE INDEX IF NOT EXISTS ix_ssh_part ON spare_part_sale_history(part_id);
CREATE INDEX IF NOT EXISTS ix_ssh_rims ON spare_part_sale_history(rims_id);
CREATE INDEX IF NOT EXISTS ix_ssh_date ON spare_part_sale_history(created_date);
CREATE INDEX IF NOT EXISTS ix_req_status ON req(status, created_date);
CREATE INDEX IF NOT EXISTS ix_req_part ON req(part_id);
CREATE INDEX IF NOT EXISTS ix_req_parent ON req(parent_id);
CREATE INDEX IF NOT EXISTS ix_req_num ON req(the_number);
CREATE INDEX IF NOT EXISTS ix_ast_parent ON whs_ast(parent_id);
CREATE INDEX IF NOT EXISTS ix_ast_whs ON whs_ast(whs_id);
CREATE INDEX IF NOT EXISTS ix_ast_code ON whs_ast(code_extended);
CREATE INDEX IF NOT EXISTS ix_model_make ON car_model(make_id);
CREATE INDEX IF NOT EXISTS ix_rims_status ON rims(active, status);
CREATE INDEX IF NOT EXISTS ix_veh_status ON vehicle(active, status);
CREATE INDEX IF NOT EXISTS ix_type_group ON spare_part_type(group_id);
DROP INDEX IF EXISTS ix_sp_loc; DROP INDEX IF EXISTS ix_sp_veh;
`);
// Statistika za planer upita (jednom)
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get()) db.exec('ANALYZE');
else db.exec('PRAGMA optimize');

// Početni podaci ako je baza prazna (bez uvoza)
if (fresh || !get('SELECT 1 x FROM core_licence LIMIT 1')) {
  const seed = fs.readFileSync(path.join(ROOT, 'server', 'seed.sql'), 'utf8');
  db.exec(seed);
}

export const LICENCE = get('SELECT licence_id FROM core_licence WHERE default_licence=1 AND active=1')?.licence_id || 'autodelic';
