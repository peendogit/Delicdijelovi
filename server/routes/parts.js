import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need, can } from '../auth.js';
import { uuid, now, bad, notFound, pick, newPartCode, modelLabelById, configBool } from '../util.js';
import { assetLabel, resolveLocation, defaultLocation, returnLocation, moveItem } from '../whsutil.js';
import { olxOnSold } from '../olx.js';

export const PART_FIELDS = ['catalog_number', 'catalog_number_manufacturer', 'catalog_number_damaged', 'type_id', 'make_id', 'model_id', 'model_year',
  'gearbox_code', 'gearbox_type', 'gearbox_speed', 'engine_code', 'vehicle_id', 'fuel_type', 'cylinder_capacity', 'power', 'mileage', 'chassis_number',
  'engine_number', 'color', 'drive_train', 'side', 'vehicle_type', 'part_set', 'damaged', 'price', 'currency_id', 'note', 'parent_id', 'parent_detached'];

const VEH_ENGINE = ['fuel_type', 'cylinder_capacity', 'power'];
const VEH_ENGINE_CODE = ['engine_code', 'engine_number'];
const VEH_GEARBOX = ['gearbox_code', 'gearbox_type', 'gearbox_speed'];

export function partTitle(typeId, modelId) {
  const t = get('SELECT title FROM spare_part_type WHERE id=?', typeId);
  let tt = t?.title || '';
  if (configBool('SPARE_PART_TYPE_UPPERCASE')) tt = tt.toUpperCase();
  return tt + ' ' + modelLabelById(modelId);
}

// Popuni podatke iz vozila-donora prema pravilima tipa dijela (share_* zastavice)
function inheritFromVehicle(data) {
  if (!data.vehicle_id) return data;
  const v = get('SELECT * FROM vehicle WHERE id=?', data.vehicle_id);
  if (!v) throw bad('Vozilo ne postoji');
  const t = get('SELECT * FROM spare_part_type WHERE id=?', data.type_id) || {};
  const g = get('SELECT * FROM spare_part_group WHERE id=?', t.group_id) || {};
  data.make_id = v.make_id; data.model_id = v.model_id;
  if (data.model_year == null) data.model_year = v.model_year;
  const fill = keys => keys.forEach(k => { if (data[k] == null && v[k] != null) data[k] = v[k]; });
  if (t.share_engine_data || g.share_engine_data) fill(VEH_ENGINE);
  if (t.share_engine_code || g.share_engine_code) fill(VEH_ENGINE_CODE);
  if (t.share_gearbox_data || g.share_gearbox_data) fill(VEH_GEARBOX);
  if (t.share_all_wheel_drive) fill(['drive_train']);
  if (data.vehicle_type == null && v.the_type) data.vehicle_type = v.the_type;
  if (data.chassis_number == null && v.chassis_number) data.chassis_number = v.chassis_number;
  if (data.mileage == null && v.mileage) data.mileage = v.mileage;
  if (data.color == null && v.color) data.color = v.color;
  return data;
}

function listWhere(q) {
  const w = ['p.active=1'];
  const p = [];
  const status = q.status || 'UNSOLD';
  if (status !== 'ALL') { w.push('p.status=?'); p.push(status); }
  if (q.q) {
    for (const word of String(q.q).trim().split(/\s+/).slice(0, 8)) {
      w.push(`(p.title LIKE ? OR p.catalog_number LIKE ? OR p.catalog_number_manufacturer LIKE ? OR p.internal_code=? OR p.engine_code LIKE ? OR p.note LIKE ? OR p.chassis_number LIKE ?)`);
      const l = '%' + word + '%';
      p.push(l, l.replace(/[\s.-]/g, ''), l, word.toUpperCase(), l, l, l);
    }
  }
  if (q.code) { w.push('p.internal_code=?'); p.push(String(q.code).trim().toUpperCase()); }
  if (q.catalog) { w.push("(replace(replace(upper(p.catalog_number),' ',''),'-','') LIKE ? OR upper(p.catalog_number_manufacturer) LIKE ?)"); const c = '%' + String(q.catalog).toUpperCase().replace(/[\s-]/g, '') + '%'; p.push(c, c); }
  for (const k of ['make_id', 'model_id', 'type_id', 'vehicle_id', 'side', 'fuel_type', 'gearbox_type', 'drive_train', 'vehicle_type', 'created_by_id']) {
    if (q[k]) { w.push(`p.${k}=?`); p.push(q[k]); }
  }
  if (q.group_id) { w.push('p.type_id IN (SELECT id FROM spare_part_type WHERE group_id=?)'); p.push(q.group_id); }
  if (q.location_id) { w.push("p.location_id IN (SELECT id FROM whs_ast WHERE path LIKE '%/'||?||'/%')"); p.push(q.location_id); }
  if (q.whs_id) { w.push('p.location_id IN (SELECT id FROM whs_ast WHERE whs_id=?)'); p.push(q.whs_id); }
  if (q.has_price === '1') w.push('p.price > 0');
  if (q.has_price === '0') w.push('(p.price IS NULL OR p.price=0)');
  if (q.no_images === '1') w.push('NOT EXISTS (SELECT 1 FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1)');
  if (q.olx === '1') w.push('p.external_olx_id IS NOT NULL');
  if (q.olx === '0') w.push('p.external_olx_id IS NULL');
  if (q.damaged === '1') w.push('p.damaged=1');
  if (q.part_set === '1') w.push('p.part_set=1');
  if (q.date_from) { w.push('p.created_date >= ?'); p.push(q.date_from); }
  if (q.date_to) { w.push('p.created_date < date(?, \'+1 day\')'); p.push(q.date_to); }
  if (q.year) { w.push('p.model_year=?'); p.push(Number(q.year)); }
  return { where: w.join(' AND '), params: p };
}

app.get('/api/parts', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_WHS_CLERK');
  const q = ctx.query;
  const { where, params } = listWhere(q);
  const limit = Math.min(Number(q.limit) || 50, 500);
  const offset = Number(q.offset) || 0;
  const sorts = { new: 'p.created_date DESC', old: 'p.created_date ASC', price_desc: 'p.price DESC', price_asc: 'p.price ASC', title: 'p.title ASC', mod: 'p.modified_date DESC' };
  const order = sorts[q.sort] || 'p.created_date DESC';
  const total = get(`SELECT count(*) n FROM spare_part p WHERE ${where}`, ...params).n;
  const rows = all(`SELECT p.id, p.internal_code, p.title, p.catalog_number, p.catalog_number_damaged, p.price, p.currency_id, p.status, p.side, p.location_id,
      p.created_date, p.model_year, p.engine_code, p.damaged, p.part_set, p.external_olx_id, p.note, p.parent_id,
      l.code_extended location_code, v.internal_code vehicle_code,
      (SELECT a.id FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1 ORDER BY a.main_picture DESC, a.created_date LIMIT 1) image_id
    FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id LEFT JOIN vehicle v ON v.id=p.vehicle_id
    WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { total, rows };
});

// Brojevi dijelova po vrsti za trenutni filter (stablo grupa kao u katalogu) — ignoriše izabranu vrstu/grupu
app.get('/api/parts/facets', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_WHS_CLERK');
  const q = { ...ctx.query }; delete q.type_id; delete q.group_id;
  const { where, params } = listWhere(q);
  return all(`SELECT p.type_id, count(*) n FROM spare_part p WHERE ${where} GROUP BY p.type_id`, ...params);
});

export function partDetail(id) {
  const p = get(`SELECT p.*, t.title type_title, t.group_id, g.title group_title, mk.name make_name, l.code_extended location_code,
      v.internal_code vehicle_code, cu.full_name created_by_name, mu.full_name modified_by_name
    FROM spare_part p LEFT JOIN spare_part_type t ON t.id=p.type_id LEFT JOIN spare_part_group g ON g.id=t.group_id
    LEFT JOIN car_make mk ON mk.id=p.make_id LEFT JOIN whs_ast l ON l.id=p.location_id LEFT JOIN vehicle v ON v.id=p.vehicle_id
    LEFT JOIN core_user cu ON cu.id=p.created_by_id LEFT JOIN core_user mu ON mu.id=p.modified_by_id WHERE p.id=?`, id);
  if (!p) throw notFound('Dio ne postoji');
  p.model_label = modelLabelById(p.model_id);
  p.location_label = assetLabel(p.location_id);
  p.images = all('SELECT id, main_picture, file_size, created_date FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date', id);
  p.location_history = all(`SELECT h.action, h.created_date, h.location_id, a.code_extended code, u.full_name user_name FROM spare_part_location_history h
    LEFT JOIN whs_ast a ON a.id=h.location_id LEFT JOIN core_user u ON u.id=h.created_by_id WHERE h.part_id=? ORDER BY h.id DESC LIMIT 100`, id);
  p.sale_history = all(`SELECT s.*, u.full_name user_name FROM spare_part_sale_history s LEFT JOIN core_user u ON u.id=s.created_by_id WHERE s.part_id=? ORDER BY s.created_date DESC`, id);
  p.requests = all(`SELECT r.id, r.the_number, r.status, r.urgent, r.shipment, r.description, r.created_date, r.closed_date, u.full_name created_by_name, ru.full_name realization_by_name
    FROM req r LEFT JOIN core_user u ON u.id=r.created_by_id LEFT JOIN core_user ru ON ru.id=r.realization_by_id WHERE r.part_id=? AND r.active=1 ORDER BY r.created_date DESC`, id);
  p.children = all(`SELECT c.id, c.internal_code, c.title, c.status, c.parent_detached, c.price FROM spare_part c WHERE c.parent_id=? AND c.active=1`, id);
  p.parent = p.parent_id ? get('SELECT id, internal_code, title, status FROM spare_part WHERE id=?', p.parent_id) : null;
  p.type_children = all('SELECT t.id, t.title FROM spare_part_type_children c JOIN spare_part_type t ON t.id=c.child_id WHERE c.type_id=? AND t.active=1', p.type_id);
  return p;
}

app.get('/api/parts/by-code/:code', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_WHS_CLERK');
  const p = get('SELECT id FROM spare_part WHERE internal_code=? AND active=1', ctx.params.code.trim().toUpperCase());
  if (!p) throw notFound('Dio sa šifrom ' + ctx.params.code + ' ne postoji');
  return partDetail(p.id);
});

app.get('/api/parts/:id', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_WHS_CLERK');
  return partDetail(ctx.params.id);
});

export function createPart(body, user) {
  let data = pick(body, PART_FIELDS);
  if (!data.type_id) throw bad('Izaberite vrstu dijela');
  data = inheritFromVehicle(data);
  if (!data.make_id || !data.model_id) throw bad('Izaberite marku i model');
  const type = get('SELECT * FROM spare_part_type WHERE id=?', data.type_id);
  if (!type) throw bad('Vrsta dijela ne postoji');
  if (type.catalog_number_required && !data.catalog_number && !data.catalog_number_damaged) throw bad('Kataloški broj je obavezan za ovu vrstu (ili označite "kataloški broj oštećen/nečitljiv")');
  const loc = resolveLocation(body) || defaultLocation();
  const t = now();
  const id = uuid();
  insert('spare_part', {
    ...data, id, internal_code: newPartCode(), title: partTitle(data.type_id, data.model_id),
    catalog_number_damaged: data.catalog_number_damaged ? 1 : 0, part_set: data.part_set ? 1 : 0, damaged: data.damaged ? 1 : 0, parent_detached: data.parent_detached ? 1 : 0,
    currency_id: data.price ? (data.currency_id || 'BAM') : data.currency_id,
    status: 'UNSOLD', location_id: null, licence: LICENCE, active: 1, created_by_id: user.id, created_date: t, modified_by_id: user.id, modified_date: t,
  });
  if (loc) moveItem('part', id, loc, user.id);
  return id;
}

app.post('/api/parts', ctx => {
  need(ctx.user, 'ROLE_SP_C');
  return tx(() => {
    const id = createPart(ctx.body, ctx.user);
    // Kreiranje pod-dijelova iz kompleta (npr. FAR XENON -> BALAST, LED MODUL…)
    const kids = Array.isArray(ctx.body.children) ? ctx.body.children : [];
    const parent = get('SELECT * FROM spare_part WHERE id=?', id);
    for (const k of kids) {
      if (!k.type_id) continue;
      createPart({ ...pick(parent, PART_FIELDS), catalog_number: k.catalog_number || null, catalog_number_damaged: k.catalog_number ? 0 : 1, price: k.price || null, note: k.note || null, side: k.side ?? parent.side,
        type_id: k.type_id, parent_id: id, parent_detached: 0, part_set: 0, location_id: parent.location_id }, ctx.user);
    }
    return { id };
  });
});

app.put('/api/parts/:id', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  const id = ctx.params.id;
  const old = get('SELECT * FROM spare_part WHERE id=? AND active=1', id);
  if (!old) throw notFound();
  let data = pick(ctx.body, PART_FIELDS);
  if (data.vehicle_id && data.vehicle_id !== old.vehicle_id) data = inheritFromVehicle({ ...data, type_id: data.type_id || old.type_id });
  for (const k of ['catalog_number_damaged', 'part_set', 'damaged', 'parent_detached']) if (k in data) data[k] = data[k] ? 1 : 0;
  if (data.price && !data.currency_id && !old.currency_id) data.currency_id = 'BAM';
  const typeId = data.type_id || old.type_id, modelId = data.model_id || old.model_id;
  data.title = partTitle(typeId, modelId);
  data.modified_by_id = ctx.user.id; data.modified_date = now();
  tx(() => {
    update('spare_part', data, 'id=?', id);
    if (ctx.body.location_id || ctx.body.location_code) {
      need(ctx.user, 'ROLE_SP_LOC_U', 'ROLE_WHS_CLERK');
      moveItem('part', id, resolveLocation(ctx.body), ctx.user.id);
    }
  });
  return partDetail(id);
});

app.del('/api/parts/:id', ctx => {
  need(ctx.user, 'ROLE_SP_D');
  const t = now();
  run('UPDATE spare_part SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, t, ctx.params.id);
  return { ok: true };
});

// Premještanje dijela (magacin)
app.post('/api/parts/:id/move', ctx => {
  need(ctx.user, 'ROLE_SP_LOC_U', 'ROLE_WHS_CLERK');
  const loc = resolveLocation(ctx.body);
  if (!loc) throw bad('Unesite lokaciju');
  tx(() => {
    moveItem('part', ctx.params.id, loc, ctx.user.id);
    // pod-dijelovi koji nisu odvojeni idu zajedno sa kompletom
    for (const c of all('SELECT id FROM spare_part WHERE parent_id=? AND active=1 AND parent_detached=0 AND status=?', ctx.params.id, 'UNSOLD')) moveItem('part', c.id, loc, ctx.user.id);
  });
  return { ok: true, location_label: assetLabel(loc) };
});

// Masovno premještanje: lista šifri dijelova -> jedna lokacija
app.post('/api/parts/move-bulk', ctx => {
  need(ctx.user, 'ROLE_SP_LOC_U', 'ROLE_WHS_CLERK');
  const loc = resolveLocation(ctx.body);
  if (!loc) throw bad('Unesite lokaciju');
  const codes = (ctx.body.codes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean);
  const res = [];
  tx(() => {
    for (const c of codes) {
      const p = get('SELECT id, title FROM spare_part WHERE internal_code=? AND active=1', c);
      if (!p) { res.push({ code: c, ok: false, msg: 'ne postoji' }); continue; }
      moveItem('part', p.id, loc, ctx.user.id);
      res.push({ code: c, ok: true, title: p.title });
    }
  });
  return { location_label: assetLabel(loc), results: res };
});

export function sellItem(kind, id, body, user) {
  const table = kind === 'rims' ? 'rims' : 'spare_part';
  const col = kind === 'rims' ? 'rims_id' : 'part_id';
  const it = get(`SELECT * FROM ${table} WHERE id=? AND active=1`, id);
  if (!it) throw notFound();
  if (it.status === 'SOLD') throw bad('Već je prodato');
  const price = body.price === '' || body.price == null ? (it.price || 0) : Number(body.price);
  const sid = uuid(); const t = now();
  insert('spare_part_sale_history', { id: sid, [col]: id, the_price: price, currency_id: body.currency_id || it.currency_id || 'BAM', note: body.note || null, status: 'SOLD', licence: LICENCE, created_by_id: user.id, created_date: t });
  run(`UPDATE ${table} SET status='SOLD', sale_history_id=?, location_id=NULL, modified_by_id=?, modified_date=? WHERE id=?`, sid, user.id, t, id);
  // aktivni nalozi za prodati dio se automatski zatvaraju
  run(`UPDATE req SET status='CLOSED', closed_by_id=?, closed_date=?, realization_by_id=coalesce(realization_by_id, ?), realization_date=coalesce(realization_date, ?), modified_by_id=?, modified_date=?
    WHERE ${col}=? AND status IN ('NEW','PREPARED') AND active=1`, user.id, t, user.id, t, user.id, t, id);
  olxOnSold(kind, id);
  return sid;
}
export function returnItem(kind, id, body, user) {
  const table = kind === 'rims' ? 'rims' : 'spare_part';
  const col = kind === 'rims' ? 'rims_id' : 'part_id';
  const it = get(`SELECT * FROM ${table} WHERE id=? AND active=1`, id);
  if (!it) throw notFound();
  if (it.status !== 'SOLD') throw bad('Nije prodato — ne može se vratiti');
  const last = get(`SELECT * FROM spare_part_sale_history WHERE ${col}=? AND status='SOLD' ORDER BY created_date DESC LIMIT 1`, id);
  const sid = uuid(); const t = now();
  insert('spare_part_sale_history', { id: sid, [col]: id, the_price: body.price == null || body.price === '' ? (last?.the_price || 0) : Number(body.price), currency_id: last?.currency_id || 'BAM', note: body.note || null, status: 'UNSOLD', licence: LICENCE, created_by_id: user.id, created_date: t });
  run(`UPDATE ${table} SET status='UNSOLD', sale_history_id=NULL, modified_by_id=?, modified_date=? WHERE id=?`, user.id, t, id);
  const loc = resolveLocation(body) || returnLocation();
  if (loc) { run(`UPDATE ${table} SET location_id=NULL WHERE id=?`, id); moveItem(kind === 'rims' ? 'rims' : 'part', id, loc, user.id); }
  return sid;
}

app.post('/api/parts/:id/sell', ctx => {
  need(ctx.user, 'ROLE_SP_SALE');
  tx(() => {
    sellItem('part', ctx.params.id, ctx.body, ctx.user);
    if (ctx.body.with_children) for (const c of all("SELECT id FROM spare_part WHERE parent_id=? AND active=1 AND status='UNSOLD' AND parent_detached=0", ctx.params.id)) sellItem('part', c.id, { price: 0, note: 'Prodato u kompletu' }, ctx.user);
  });
  return partDetail(ctx.params.id);
});
app.post('/api/parts/:id/return', ctx => {
  need(ctx.user, 'ROLE_SP_SALE');
  tx(() => returnItem('part', ctx.params.id, ctx.body, ctx.user));
  return partDetail(ctx.params.id);
});

// Kopija dijela (npr. isti dio, druga strana)
app.post('/api/parts/:id/copy', ctx => {
  need(ctx.user, 'ROLE_SP_C');
  const p = get('SELECT * FROM spare_part WHERE id=?', ctx.params.id);
  if (!p) throw notFound();
  const id = tx(() => createPart({ ...pick(p, PART_FIELDS), ...pick(ctx.body, PART_FIELDS), parent_id: null, location_id: p.location_id || undefined }, ctx.user));
  return { id };
});

// Odvajanje pod-dijela od kompleta
app.post('/api/parts/:id/detach', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  run('UPDATE spare_part SET parent_detached=?, modified_by_id=?, modified_date=? WHERE id=?', ctx.body.detached === false ? 0 : 1, ctx.user.id, now(), ctx.params.id);
  return partDetail(ctx.params.id);
});

// Tekst oglasa (OLX opis) za kopiranje
app.get('/api/parts/:id/ad-text', async ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP');
  const { describe } = await import('../olx.js');
  return describe('part', ctx.params.id);
});

export { can };
