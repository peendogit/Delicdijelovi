// Pomoćne funkcije za magacin (lokacije = whs_ast)
import { get, all, run, insert } from './db.js';
import { bad, now, configStr } from './util.js';

const labelCache = new Map();
export function clearLabelCache() { labelCache.clear(); }

export function assetById(id) {
  return id ? get('SELECT a.*, t.title type_title, t.code type_code, t.parts_allowed, t.move_allowed, t.code_edit_allowed, t.height_details_allowed, t.code_strategy, t.base, w.title whs_title FROM whs_ast a LEFT JOIN whs_ast_type t ON t.id=a.ast_type_id LEFT JOIN whs w ON w.id=a.whs_id WHERE a.id=?', id) : null;
}

// "Slikanje / R1 / P1"
export function assetLabel(id) {
  if (!id) return '';
  if (labelCache.has(id)) return labelCache.get(id);
  const a = get('SELECT a.path, a.code_extended, w.title whs_title FROM whs_ast a LEFT JOIN whs w ON w.id=a.whs_id WHERE a.id=?', id);
  if (!a) return '';
  const ids = (a.path || '').split('/').filter(Boolean);
  const codes = ids.map(x => get('SELECT code_extended FROM whs_ast WHERE id=?', x)?.code_extended || '?');
  const s = [a.whs_title, ...codes].filter(Boolean).join(' / ');
  labelCache.set(id, s);
  return s;
}

// Pronađi lokaciju po kodu (P123, K45, PL7 …) — samo tipovi u koje se smiju stavljati dijelovi
export function findLocationByCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const rows = all(`SELECT a.id FROM whs_ast a JOIN whs_ast_type t ON t.id=a.ast_type_id
    WHERE upper(a.code_extended)=? AND a.active=1 AND t.parts_allowed=1`, c);
  if (rows.length === 1) return rows[0].id;
  if (rows.length > 1) throw bad(`Kod ${c} nije jedinstven — izaberite lokaciju ručno`);
  return null;
}

export function resolveLocation(body) {
  if (body.location_id) {
    const a = assetById(body.location_id);
    if (!a || !a.active) throw bad('Lokacija ne postoji');
    if (!a.parts_allowed) throw bad(`Na ${a.type_title} se ne mogu stavljati dijelovi`);
    return a.id;
  }
  if (body.location_code) {
    const id = findLocationByCode(body.location_code);
    if (!id) throw bad(`Lokacija ${body.location_code} ne postoji`);
    return id;
  }
  return null;
}

export const defaultLocation = () => configStr('WAREHOUSE_DEFAULT_ASSET');
export const returnLocation = () => configStr('WAREHOUSE_RETURN_ASSET');

// Upis u istoriju lokacija (OUT sa stare, IN na novu) — isto kao stari program
export function moveItem(kind, id, newLoc, userId) {
  const table = kind === 'rims' ? 'rims' : 'spare_part';
  const col = kind === 'rims' ? 'rims_id' : 'part_id';
  const cur = get(`SELECT location_id FROM ${table} WHERE id=?`, id);
  if (!cur) throw bad('Ne postoji');
  if (cur.location_id === newLoc) return false;
  const t = now();
  if (cur.location_id) insert('spare_part_location_history', { [col]: id, location_id: cur.location_id, action: 'OUT', created_by_id: userId, created_date: t });
  if (newLoc) insert('spare_part_location_history', { [col]: id, location_id: newLoc, action: 'IN', created_by_id: userId, created_date: t });
  run(`UPDATE ${table} SET location_id=?, modified_by_id=?, modified_date=? WHERE id=?`, newLoc, userId, t, id);
  return true;
}
