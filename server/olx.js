// OLX.ba integracija (https://api-documentation.olx.ba)
// Podrazumijevano ISKLJUČENA (OLX_ENABLED) — dok stari program radi, ne smiju oba objavljivati oglase.
import fs from 'node:fs';
import { get, all, run, insert } from './db.js';
import { configStr, configBool, setConfig, now, modelLabelById, bad } from './util.js';

const API = 'https://api.olx.ba';
let bearer = null;

export const olxEnabled = () => configBool('OLX_ENABLED');

function log(object_type, object_id, action, ok, message) {
  insert('app_olx_log', { object_type, object_id, action, ok: ok ? 1 : 0, message: String(message || '').slice(0, 1000), created_date: now() });
}

async function headers(json = true) {
  const h = { Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  const user = configStr('OLX_USERNAME'), pass = configStr('OLX_PASSWORD');
  if (user && pass) {
    if (!bearer) {
      const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username: user, password: pass, device_name: 'delic-dijelovi' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error('OLX prijava nije uspjela: ' + (j.message || r.status));
      bearer = j.token;
    }
    h.Authorization = 'Bearer ' + bearer;
  } else {
    const id = configStr('OLX_CLIENT_ID'), tok = configStr('OLX_CLIENT_TOKEN');
    if (!id || !tok) throw new Error('OLX pristupni podaci nisu podešeni');
    h['OLX-CLIENT-ID'] = id; h['OLX-CLIENT-TOKEN'] = tok;
  }
  return h;
}
async function call(method, path, body, isForm = false) {
  const h = await headers(!isForm);
  const r = await fetch(API + path, { method, headers: h, body: body == null ? undefined : isForm ? body : JSON.stringify(body) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (r.status === 401) bearer = null;
  if (!r.ok) throw new Error(`OLX ${method} ${path}: ${r.status} ${j.message || j.error || text.slice(0, 300)}`);
  return j;
}

const L = { DIESEL: 'Dizel', PETROL: 'Benzin', HYBRID: 'Hibrid', MANUAL: 'Manuelni', AUTOMATIC: 'Automatik', FWD: 'Prednji', RWD: 'Zadnji', AWD: '4x4' };
function vehicleDetails(o) {
  const rows = [];
  if (o.model_year) rows.push(['Godište', o.model_year]);
  if (o.fuel_type) rows.push(['Gorivo', L[o.fuel_type] || o.fuel_type]);
  if (o.cylinder_capacity) rows.push(['Kubikaža', o.cylinder_capacity + ' ccm']);
  if (o.power) rows.push(['Snaga', o.power + ' kW']);
  if (o.engine_code) rows.push(['Oznaka motora', o.engine_code]);
  if (o.gearbox_type) rows.push(['Mjenjač', (L[o.gearbox_type] || o.gearbox_type) + (o.gearbox_speed ? ' ' + o.gearbox_speed + ' brzina' : '') + (o.gearbox_code ? ' (' + o.gearbox_code + ')' : '')]);
  if (o.drive_train) rows.push(['Pogon', L[o.drive_train] || o.drive_train]);
  if (o.mileage) rows.push(['Kilometraža', o.mileage + ' km']);
  if (o.catalog_number) rows.push(['Kataloški broj', o.catalog_number]);
  return rows.map(([k, v]) => `<p>${k}: ${v}</p>`).join('\n');
}

export function describe(kind, id) {
  if (kind === 'rims') {
    const r = get(`SELECT r.*, rt.title tt, rd.title dt, rw.title wt, rp.bolt_number||'x'||rp.bolt_distance pt FROM rims r LEFT JOIN rims_type rt ON rt.id=r.type_id
      LEFT JOIN rims_diameter rd ON rd.id=r.diameter_id LEFT JOIN rims_width rw ON rw.id=r.width_id LEFT JOIN rims_bolt_pattern rp ON rp.id=r.pattern_id WHERE r.id=?`, id);
    const title = [r.tt, r.dt, r.pt, r.wt, r.offSet ? 'ET' + r.offSet : ''].filter(Boolean).join(' ') + (r.car_model_id ? ' ' + modelLabelById(r.car_model_id) : '');
    const html = (configStr('INTEGRATION_DESCRIPTION_RIMS') || '').replaceAll('PART_TITLE', title).replaceAll('PART_CODE', r.internal_code);
    return { title, html, short: configStr('OLX_SHORT_DESCRIPTION') || '' };
  }
  if (kind === 'vehicle') {
    const v = get('SELECT * FROM vehicle WHERE id=?', id);
    const title = modelLabelById(v.model_id) + ' ' + v.model_year;
    const html = (configStr('INTEGRATION_DESCRIPTION_VEHICLE') || '').replaceAll('PART_TITLE', title).replaceAll('VEHICLE_DETAILS', vehicleDetails(v));
    return { title, html, short: configStr('OLX_SHORT_DESCRIPTION') || '' };
  }
  const p = get('SELECT * FROM spare_part WHERE id=?', id);
  if (!p) throw bad('Dio ne postoji');
  const html = (configStr('INTEGRATION_DESCRIPTION_PARTS') || '').replaceAll('PART_TITLE', p.title).replaceAll('PART_CODE', p.internal_code).replaceAll('VEHICLE_DETAILS', vehicleDetails(p) + (p.note ? `\n<p>${p.note}</p>` : ''));
  return { title: p.title, html, short: configStr('OLX_SHORT_DESCRIPTION') || '' };
}

function requiredAttributes(categoryId) {
  const c = get('SELECT the_data FROM spt_external_olx WHERE id=?', categoryId);
  if (!c?.the_data) return [];
  let defs; try { defs = JSON.parse(c.the_data); } catch { return []; }
  return defs.filter(d => d.obavezno).map(d => ({ id: d.id, value: d.opcije?.includes('Ostalo') ? 'Ostalo' : (d.opcije?.[0] ?? '') }));
}

export async function publish(kind, id) {
  const table = kind === 'rims' ? 'rims' : kind === 'vehicle' ? 'vehicle' : 'spare_part';
  const o = get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!o) throw bad('Ne postoji');
  if (o.external_olx_id) throw bad('Već je objavljeno na OLX (' + o.external_olx_id + ')');
  const d = describe(kind, id);
  let category = null, brand = null, model = null;
  if (kind === 'part') {
    category = get('SELECT external_olx_id c FROM spare_part_type WHERE id=?', o.type_id)?.c;
    brand = get('SELECT external_olx_id c FROM car_make WHERE id=?', o.make_id)?.c;
    model = get('SELECT external_id c FROM car_model WHERE id=?', o.model_id)?.c;
  } else if (kind === 'rims') {
    category = get('SELECT external_olx_id c FROM rims_type WHERE id=?', o.type_id)?.c;
  }
  const body = { title: d.title.slice(0, 80), short_description: d.short, description: d.html, listing_type: 'sell', state: 'used', sku_number: o.internal_code, available: true };
  if (o.price) body.price = o.price;
  if (category) { body.category_id = Number(category); body.attributes = requiredAttributes(category); }
  if (brand) body.brand_id = String(brand);
  if (model) body.model_id = String(model);
  try {
    const l = await call('POST', '/listings', body);
    const lid = String(l.id || l.data?.id);
    const imgs = all('SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date LIMIT 20', id);
    const { imgPath } = await import('./routes/files.js');
    const fd = new FormData(); let n = 0;
    for (const im of imgs) {
      const f = imgPath(im.id);
      if (fs.existsSync(f)) { fd.append('images[]', new Blob([fs.readFileSync(f)], { type: 'image/jpeg' }), im.id + '.jpg'); n++; }
    }
    if (n) await call('POST', `/listings/${lid}/image-upload`, fd, true);
    await call('POST', `/listings/${lid}/publish`);
    run(`UPDATE ${table} SET external_olx_id=?, external_olx_date=? WHERE id=?`, lid, now(), id);
    log(kind, id, 'publish', true, 'OLX ' + lid + ', slika: ' + n);
    return { olx_id: lid };
  } catch (e) { log(kind, id, 'publish', false, e.message); throw e; }
}

export async function remove(kind, id) {
  const table = kind === 'rims' ? 'rims' : kind === 'vehicle' ? 'vehicle' : 'spare_part';
  const o = get(`SELECT external_olx_id FROM ${table} WHERE id=?`, id);
  if (!o?.external_olx_id) return;
  try {
    await call('DELETE', `/listings/${o.external_olx_id}`);
    run(`UPDATE ${table} SET external_olx_id=NULL, external_olx_date=? WHERE id=?`, now(), id);
    log(kind, id, 'delete', true, 'OLX ' + o.external_olx_id);
  } catch (e) {
    // oglas više ne postoji na OLX-u -> samo očisti vezu
    if (/: 404 /.test(e.message)) { run(`UPDATE ${table} SET external_olx_id=NULL WHERE id=?`, id); log(kind, id, 'delete', true, 'već uklonjen (404)'); return; }
    log(kind, id, 'delete', false, e.message); throw e;
  }
}

export async function updatePrice(kind, id) {
  const table = kind === 'rims' ? 'rims' : 'spare_part';
  const o = get(`SELECT external_olx_id, price FROM ${table} WHERE id=?`, id);
  if (!o?.external_olx_id) return;
  const d = describe(kind, id);
  await call('PUT', `/listings/${o.external_olx_id}`, { title: d.title.slice(0, 80), description: d.html, price: o.price || undefined });
  log(kind, id, 'update', true, 'OLX ' + o.external_olx_id);
}

// Pozove se pri prodaji — oglas se skida (u pozadini)
export function olxOnSold(kind, id) {
  if (!olxEnabled()) return;
  setTimeout(() => remove(kind, id).catch(() => {}), 10);
}

// Pozadinski posao: objavi nove dijelove (sa slikom) koji još nisu na OLX-u
export async function jobPublishNew(limit = 50) {
  if (!olxEnabled()) return 0;
  const rows = all(`SELECT p.id FROM spare_part p WHERE p.active=1 AND p.status='UNSOLD' AND p.external_olx_id IS NULL
    AND EXISTS (SELECT 1 FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1)
    AND NOT EXISTS (SELECT 1 FROM app_olx_log g WHERE g.object_id=p.id AND g.ok=0 AND g.created_date > datetime('now','-1 day'))
    ORDER BY p.created_date DESC LIMIT ?`, limit);
  let n = 0;
  for (const r of rows) { try { await publish('part', r.id); n++; } catch {} }
  setConfig('INTEGRATION_OLX_LAST_MODIFIED_TIME', 'string_value', now(), 'autodelic');
  return n;
}
// Pozadinski posao: skini oglase prodatih dijelova (ako nešto nije skinuto odmah)
export async function jobRemoveSold() {
  if (!olxEnabled()) return 0;
  let n = 0;
  for (const t of [['part', 'spare_part'], ['rims', 'rims']]) {
    for (const r of all(`SELECT id FROM ${t[1]} WHERE (status='SOLD' OR active=0) AND external_olx_id IS NOT NULL LIMIT 200`)) { try { await remove(t[0], r.id); n++; } catch {} }
  }
  return n;
}
