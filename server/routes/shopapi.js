// API za webshop (delicauto-shop) — isti ugovor kao shop-api.cjs koji webshop već koristi:
//   GET /shop-api/health, /shop-api/parts?after=&limit=, /shop-api/parts/:id, /shop-api/changes?since=
//   POST /shop-api/reserve {partId, qty, orderRef}, /shop-api/release {orderRef}
// Ključ: SHOP_API_KEY u .env ovog programa = APP_API_KEY u .env webshopa.
// ID dijela za webshop = prvih 12 hex znakova UUID-a kao broj (isto kao webshop-ov uvoz iz backupa → ništa se ne pomjera).
import crypto from 'node:crypto';
import { app } from '../router.js';
import { db, get, all, run } from '../db.js';
import { HttpError, modelLabel } from '../util.js';

db.exec(`
CREATE TABLE IF NOT EXISTS app_shop_id (num INTEGER PRIMARY KEY, part_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS app_shop_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, part_id TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS app_shop_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, part_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  order_ref TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE(order_ref, part_id));
CREATE INDEX IF NOT EXISTS ix_shop_res_part ON app_shop_reservations(part_id);
CREATE TRIGGER IF NOT EXISTS shop_sp_ins AFTER INSERT ON spare_part BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (NEW.id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_sp_upd AFTER UPDATE ON spare_part BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (NEW.id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_sp_del AFTER DELETE ON spare_part BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (OLD.id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_att_ins AFTER INSERT ON lib_attachment WHEN NEW.type='SPARE_PART' BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (NEW.object_id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_att_upd AFTER UPDATE ON lib_attachment WHEN NEW.type='SPARE_PART' BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (NEW.object_id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_res_ins AFTER INSERT ON app_shop_reservations BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (NEW.part_id, strftime('%s','now')); END;
CREATE TRIGGER IF NOT EXISTS shop_res_del AFTER DELETE ON app_shop_reservations BEGIN INSERT INTO app_shop_changes(part_id, at) VALUES (OLD.part_id, strftime('%s','now')); END;
`);

export const stableId = u => parseInt(String(u).replace(/-/g, '').slice(0, 12), 16);
// dopuni mapu broj → UUID za dijelove koji je još nemaju (novi dijelovi)
function ensureMap() {
  const missing = all('SELECT id FROM spare_part s WHERE NOT EXISTS (SELECT 1 FROM app_shop_id m WHERE m.part_id=s.id)');
  if (!missing.length) return;
  const st = db.prepare('INSERT OR IGNORE INTO app_shop_id(num, part_id) VALUES (?, ?)');
  db.exec('BEGIN'); try { for (const r of missing) st.run(stableId(r.id), r.id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}
ensureMap();

const L = {
  fuel: { DIESEL: 'Dizel', PETROL: 'Benzin', HYBRID: 'Hibrid', ELECTRIC: 'Električni', LPG: 'Plin' },
  side: { LEFT: 'Lijeva', RIGHT: 'Desna', FRONT: 'Prednja', BACK: 'Zadnja', CENTRAL: 'Središnja', FRONT_LEFT: 'Prednja lijeva', FRONT_RIGHT: 'Prednja desna', BACK_LEFT: 'Zadnja lijeva', BACK_RIGHT: 'Zadnja desna' },
  gearbox: { MANUAL: 'Manuelni', AUTOMATIC: 'Automatik' },
  drive: { FWD: 'Prednji', RWD: 'Zadnji', AWD: '4x4' },
  body: { LIMOUSINE: 'Limuzina', SUV: 'SUV', CARAVAN: 'Karavan', COUPE: 'Coupe', VAN: 'Van', CABRIO: 'Kabriolet', HATCHBACK: 'Hatchback' },
};
const nowSec = () => Math.floor(Date.now() / 1000);
const SEL = `SELECT p.*, m.num, t.title type_title, g.title group_title, mk.name make_name, mo.name mo_name, mo.generation_name, mo.restyling, mo.restyling_second, mo.date_from, mo.date_to,
  (SELECT coalesce(sum(r.qty),0) FROM app_shop_reservations r WHERE r.part_id=p.id AND r.expires_at > ?) reserved
  FROM spare_part p JOIN app_shop_id m ON m.part_id=p.id LEFT JOIN spare_part_type t ON t.id=p.type_id LEFT JOIN spare_part_group g ON g.id=t.group_id
  LEFT JOIN car_make mk ON mk.id=p.make_id LEFT JOIN car_model mo ON mo.id=p.model_id`;
const yy = d => (d ? String(d).slice(2, 4) : '');
function shape(p) {
  const inStock = p.active === 1 && p.status === 'UNSOLD';
  const available = inStock && !(p.reserved > 0);
  const model = p.mo_name ? [p.mo_name, p.generation_name].filter(Boolean).join(' ') : null;
  const images = all("SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date LIMIT 8", p.id).map(a => a.id + '.jpg');
  return {
    id: p.num, available, qty: available ? 1 : 0,
    internal: p.internal_code, type: p.type_title ? String(p.type_title).trim() : null, group: p.group_title || null,
    make: p.make_name || null, model, vehicle: model ? `${model}${p.date_from ? ` (${yy(p.date_from)}-${yy(p.date_to)})` : ''}` : null,
    catalog: p.catalog_number || p.catalog_number_manufacturer || null, side: L.side[p.side] || null, fuel: L.fuel[p.fuel_type] || null,
    displacement: p.cylinder_capacity ? String(Math.round(p.cylinder_capacity)) : null, power: p.power ? String(p.power) : null,
    engineCode: p.engine_code || null, gearboxCode: p.gearbox_code || null, gearbox: L.gearbox[p.gearbox_type] || null,
    gears: p.gearbox_speed ? String(p.gearbox_speed) : null, body: L.body[p.vehicle_type] || p.vehicle_type || null, drive: L.drive[p.drive_train] || null,
    note: p.note ? String(p.note).trim() : null, price: p.price > 0 ? Math.round(p.price * 100) / 100 : null, images,
  };
}

function key(ctx) {
  const want = process.env.SHOP_API_KEY || '';
  if (!want) throw new HttpError(503, 'SHOP_API_KEY nije postavljen u .env programa');
  const got = String(ctx.req.headers['x-api-key'] || '');
  const a = crypto.createHash('sha256').update(got).digest(), b = crypto.createHash('sha256').update(want).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'neispravan API ključ');
}
const seqNow = () => get("SELECT seq FROM sqlite_sequence WHERE name='app_shop_changes'")?.seq || 0;
const sweep = () => run('DELETE FROM app_shop_reservations WHERE expires_at <= ?', nowSec());
const P = { public: true };

app.get('/shop-api/health', ctx => {
  key(ctx); sweep(); ensureMap();
  return { ok: true, seq: seqNow(), inStock: get("SELECT count(*) n FROM spare_part WHERE active=1 AND status='UNSOLD'").n, problems: [] };
}, P);

app.get('/shop-api/parts', ctx => {
  key(ctx);
  const after = Math.max(0, parseInt(ctx.query.after, 10) || 0);
  const limit = Math.min(1000, Math.max(1, parseInt(ctx.query.limit, 10) || 500));
  const rows = all(`${SEL} WHERE m.num > ? AND p.active=1 AND p.status='UNSOLD' ORDER BY m.num LIMIT ?`, nowSec(), after, limit);
  return { items: rows.map(shape).filter(p => p.available), next: rows.length === limit ? rows[rows.length - 1].num : null };
}, P);

app.get('/shop-api/parts/:id', ctx => {
  key(ctx);
  const num = Number(ctx.params.id);
  let row = get(`${SEL} WHERE m.num = ?`, nowSec(), num);
  if (!row) { ensureMap(); row = get(`${SEL} WHERE m.num = ?`, nowSec(), num); }
  return row ? shape(row) : { id: num, available: false };
}, P);

app.get('/shop-api/changes', ctx => {
  key(ctx); sweep(); ensureMap();
  const since = Math.max(0, parseInt(ctx.query.since, 10) || 0);
  const seq = seqNow();
  if (since > seq) return { seq, reset: true, ids: [] };
  const rows = all('SELECT DISTINCT c.part_id, m.num FROM app_shop_changes c LEFT JOIN app_shop_id m ON m.part_id=c.part_id WHERE c.seq > ? LIMIT 1001', since);
  if (rows.length > 1000) return { seq, full: true, ids: [] };
  run('DELETE FROM app_shop_changes WHERE at < ?', nowSec() - 30 * 86400);
  return { seq, ids: rows.filter(r => r.num != null).map(r => r.num) };
}, P);

app.post('/shop-api/reserve', ctx => {
  key(ctx);
  const partNum = parseInt(ctx.body.partId, 10), qty = parseInt(ctx.body.qty, 10) || 1, ref = String(ctx.body.orderRef || '').slice(0, 40);
  if (!partNum || !ref || qty !== 1) { ctx.res.statusCode = 400; return { ok: false, reason: 'neispravni podaci' }; }
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = get(`${SEL} WHERE m.num = ?`, nowSec(), partNum);
    if (!row) { db.exec('ROLLBACK'); ctx.status = 409; return conflict(ctx, { ok: false, reason: 'ne postoji' }); }
    if (get('SELECT 1 x FROM app_shop_reservations WHERE order_ref=? AND part_id=?', ref, row.id)) { db.exec('COMMIT'); return { ok: true, already: true }; }
    if (!shape(row).available) { db.exec('ROLLBACK'); return conflict(ctx, { ok: false, reason: 'nije na stanju' }); }
    run('INSERT INTO app_shop_reservations(part_id, qty, order_ref, created_at, expires_at) VALUES (?,?,?,?,?)', row.id, 1, ref, nowSec(), nowSec() + 14 * 86400);
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}, P);
function conflict(ctx, body) { ctx.res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); ctx.res.end(JSON.stringify(body)); }

app.post('/shop-api/release', ctx => {
  key(ctx);
  const ref = String(ctx.body.orderRef || '').slice(0, 40);
  if (!ref) return { ok: false };
  return { ok: true, released: Number(run('DELETE FROM app_shop_reservations WHERE order_ref=?', ref).changes) };
}, P);

// Za program: je li dio rezervisan narudžbom iz webshopa
app.get('/api/parts/:id/shop-reservation', ctx => {
  return get('SELECT order_ref, created_at, expires_at FROM app_shop_reservations WHERE part_id=? AND expires_at > ?', ctx.params.id, nowSec()) || null;
});
