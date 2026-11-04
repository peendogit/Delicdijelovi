import crypto from 'node:crypto';
import { get, run } from './db.js';

export const uuid = () => crypto.randomUUID();

// Lokalno vrijeme (Europe/Sarajevo) u formatu 'YYYY-MM-DD HH:MM:SS' — isto kao stari program
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: process.env.TZ || 'Europe/Sarajevo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
export const now = () => fmt.format(new Date()).replace('T', ' ');
export const today = () => now().slice(0, 10);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = msg => new HttpError(400, msg);
export const notFound = (msg = 'Nije pronađeno') => new HttpError(404, msg);

export function config(name) {
  return get('SELECT * FROM core_configuration WHERE name=?', name);
}
export function configStr(name, def = null) { return config(name)?.string_value ?? def; }
export function configBool(name) { return !!config(name)?.boolean_value; }
export function setConfig(name, field, value, licence) {
  const ex = config(name);
  if (ex) run(`UPDATE core_configuration SET ${field}=? WHERE name=?`, value, name);
  else run(`INSERT INTO core_configuration (name, licence, ${field}) VALUES (?,?,?)`, name, licence, value);
}

// Brojač (spare_part_number / vehicle_number / req_number) — vraća sljedeći broj
export function nextNumber(table) {
  const row = get(`SELECT id, increment FROM ${table} LIMIT 1`);
  const n = (row?.increment || 0) + 1;
  if (row) run(`UPDATE ${table} SET increment=? WHERE id=?`, n, row.id);
  return n;
}

// Interna šifra dijela: 4 znaka [A-Z0-9], jedinstvena (kao u starom programu, npr. 9N32, DP8L)
const CH = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
export function newPartCode() {
  for (let i = 0; i < 200; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CH[crypto.randomInt(CH.length)];
    if (!get('SELECT 1 x FROM spare_part WHERE internal_code=?', c)) return c;
  }
  throw new Error('Nije moguće generisati šifru');
}

export function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k] === '' ? null : obj[k];
  return o;
}

export const yy = d => (d ? String(d).slice(2, 4) : '');
// Naziv modela kao u starom programu: "Audi A3 8P [restyling] (08-12)"
export function modelLabel(m, makeName) {
  if (!m) return '';
  let s = (makeName ? makeName + ' ' : '') + m.name;
  if (m.generation_name) s += ' ' + m.generation_name;
  if (m.restyling || m.restyling_second) s += ' [restyling]';
  if (m.date_from) s += ` (${yy(m.date_from)}-${m.date_to ? yy(m.date_to) : ''})`;
  return s;
}
export function modelLabelById(modelId) {
  const m = get('SELECT mo.*, mk.name make_name FROM car_model mo LEFT JOIN car_make mk ON mk.id=mo.make_id WHERE mo.id=?', modelId);
  return m ? modelLabel(m, m.make_name) : '';
}
