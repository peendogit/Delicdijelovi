import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound, pick, nextNumber, modelLabelById } from '../util.js';
import { assetLabel, resolveLocation, defaultLocation, moveItem } from '../whsutil.js';
import { sellItem, returnItem } from './parts.js';

const FIELDS = ['type_id', 'diameter_id', 'width_id', 'pattern_id', 'vehicle_id', 'car_make_id', 'car_model_id', 'damaged', 'screw_included', 'chrome_nickel_plated',
  'offSet', 'center_hole', 'price', 'currency_id', 'note'];

const SELECT = `SELECT r.*, rt.title type_title, rd.title diameter_title, rw.title width_title, rp.bolt_number||'x'||rp.bolt_distance pattern_title,
  mk.name make_name, l.code_extended location_code, v.internal_code vehicle_code,
  (SELECT a.id FROM lib_attachment a WHERE a.object_id=r.id AND a.active=1 ORDER BY a.main_picture DESC, a.created_date LIMIT 1) image_id
  FROM rims r LEFT JOIN rims_type rt ON rt.id=r.type_id LEFT JOIN rims_diameter rd ON rd.id=r.diameter_id LEFT JOIN rims_width rw ON rw.id=r.width_id
  LEFT JOIN rims_bolt_pattern rp ON rp.id=r.pattern_id LEFT JOIN car_make mk ON mk.id=r.car_make_id LEFT JOIN whs_ast l ON l.id=r.location_id LEFT JOIN vehicle v ON v.id=r.vehicle_id`;

export const rimsTitle = r => [r.type_title, r.diameter_title, r.pattern_title, r.width_title, r.offSet ? 'ET' + r.offSet : ''].filter(Boolean).join(' ');

app.get('/api/rims', ctx => {
  need(ctx.user, 'ROLE_RIMS_R', 'ROLE_RIMS');
  const q = ctx.query; const w = ['r.active=1']; const p = [];
  const status = q.status || 'UNSOLD';
  if (status !== 'ALL') { w.push('r.status=?'); p.push(status); }
  for (const k of ['type_id', 'diameter_id', 'width_id', 'pattern_id', 'car_make_id', 'car_model_id', 'vehicle_id']) if (q[k]) { w.push(`r.${k}=?`); p.push(q[k]); }
  if (q.q) { w.push('(r.internal_code=? OR r.note LIKE ? OR mk.name LIKE ?)'); p.push(q.q.trim().toUpperCase(), '%' + q.q + '%', '%' + q.q + '%'); }
  const total = get(`SELECT count(*) n FROM rims r LEFT JOIN car_make mk ON mk.id=r.car_make_id WHERE ${w.join(' AND ')}`, ...p).n;
  const rows = all(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY r.created_date DESC LIMIT ? OFFSET ?`, ...p, Math.min(Number(q.limit) || 50, 500), Number(q.offset) || 0);
  for (const r of rows) { r.title = rimsTitle(r); r.model_label = modelLabelById(r.car_model_id); }
  return { total, rows };
});

function detail(id) {
  const r = get(`${SELECT} WHERE r.id=?`, id);
  if (!r) throw notFound('Felna ne postoji');
  r.title = rimsTitle(r);
  r.model_label = modelLabelById(r.car_model_id);
  r.location_label = assetLabel(r.location_id);
  r.images = all('SELECT id, main_picture, created_date FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date', id);
  r.location_history = all(`SELECT h.action, h.created_date, a.code_extended code, u.full_name user_name FROM spare_part_location_history h LEFT JOIN whs_ast a ON a.id=h.location_id
    LEFT JOIN core_user u ON u.id=h.created_by_id WHERE h.rims_id=? ORDER BY h.id DESC LIMIT 100`, id);
  r.sale_history = all('SELECT s.*, u.full_name user_name FROM spare_part_sale_history s LEFT JOIN core_user u ON u.id=s.created_by_id WHERE s.rims_id=? ORDER BY s.created_date DESC', id);
  r.requests = all('SELECT id, the_number, status, created_date FROM req WHERE rims_id=? AND active=1 ORDER BY created_date DESC', id);
  return r;
}
app.get('/api/rims/by-code/:code', ctx => {
  need(ctx.user, 'ROLE_RIMS_R', 'ROLE_RIMS', 'ROLE_WHS_CLERK');
  const r = get('SELECT id FROM rims WHERE upper(internal_code)=? AND active=1', ctx.params.code.trim().toUpperCase());
  if (!r) throw notFound('Felna ' + ctx.params.code + ' ne postoji');
  return detail(r.id);
});
app.get('/api/rims/:id', ctx => { need(ctx.user, 'ROLE_RIMS_R', 'ROLE_RIMS', 'ROLE_WHS_CLERK'); return detail(ctx.params.id); });

function fromVehicle(d) {
  if (!d.vehicle_id) return d;
  const v = get('SELECT * FROM vehicle WHERE id=?', d.vehicle_id);
  if (!v) return d;
  d.car_make_id ??= v.make_id; d.car_model_id ??= v.model_id;
  d.type_id ??= v.rims_type_id; d.diameter_id ??= v.rims_diameter_id; d.width_id ??= v.rims_width_id; d.pattern_id ??= v.rims_pattern_id;
  d.offSet ??= v.rims_offSet; d.center_hole ??= v.rims_center_hole;
  return d;
}

app.post('/api/rims', ctx => {
  need(ctx.user, 'ROLE_RIMS_C');
  const d = fromVehicle(pick(ctx.body, FIELDS));
  for (const k of ['type_id', 'diameter_id', 'width_id', 'pattern_id']) if (!d[k]) throw bad('Vrsta, prečnik, širina i raspon šarafa su obavezni');
  const id = uuid(); const t = now();
  tx(() => {
    insert('rims', { ...d, id, internal_code: 'F' + nextNumber('spare_part_number'), status: 'UNSOLD', damaged: d.damaged ? 1 : 0, screw_included: d.screw_included ? 1 : 0,
      chrome_nickel_plated: d.chrome_nickel_plated ? 1 : 0, currency_id: d.currency_id || 'BAM', licence: LICENCE, active: 1,
      created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
    const loc = resolveLocation(ctx.body) || defaultLocation();
    if (loc) moveItem('rims', id, loc, ctx.user.id);
  });
  return detail(id);
});

app.put('/api/rims/:id', ctx => {
  need(ctx.user, 'ROLE_RIMS_U');
  const d = pick(ctx.body, FIELDS);
  for (const k of ['damaged', 'screw_included', 'chrome_nickel_plated']) if (k in d) d[k] = d[k] ? 1 : 0;
  d.modified_by_id = ctx.user.id; d.modified_date = now();
  tx(() => {
    update('rims', d, 'id=?', ctx.params.id);
    if (ctx.body.location_id || ctx.body.location_code) moveItem('rims', ctx.params.id, resolveLocation(ctx.body), ctx.user.id);
  });
  return detail(ctx.params.id);
});
app.del('/api/rims/:id', ctx => {
  need(ctx.user, 'ROLE_RIMS_D', 'ROLE_RIMS_U');
  run('UPDATE rims SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});
app.post('/api/rims/:id/move', ctx => {
  need(ctx.user, 'ROLE_RIMS_U', 'ROLE_WHS_CLERK', 'ROLE_SP_LOC_U');
  const loc = resolveLocation(ctx.body);
  if (!loc) throw bad('Unesite lokaciju');
  tx(() => moveItem('rims', ctx.params.id, loc, ctx.user.id));
  return detail(ctx.params.id);
});
app.post('/api/rims/:id/sell', ctx => { need(ctx.user, 'ROLE_SP_SALE', 'ROLE_RIMS_U'); tx(() => sellItem('rims', ctx.params.id, ctx.body, ctx.user)); return detail(ctx.params.id); });
app.post('/api/rims/:id/return', ctx => { need(ctx.user, 'ROLE_SP_SALE', 'ROLE_RIMS_U'); tx(() => returnItem('rims', ctx.params.id, ctx.body, ctx.user)); return detail(ctx.params.id); });
