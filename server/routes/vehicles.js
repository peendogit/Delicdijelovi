import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound, pick, nextNumber, modelLabelById } from '../util.js';

const FIELDS = ['make_id', 'model_id', 'model_year', 'mileage', 'chassis_number', 'engine_number', 'engine_code', 'fuel_type', 'cylinder_capacity', 'power',
  'gearbox_code', 'gearbox_type', 'gearbox_speed', 'the_type', 'color', 'drive_train', 'rims_type_id', 'rims_diameter_id', 'rims_width_id', 'rims_pattern_id',
  'rims_offSet', 'rims_center_hole', 'note', 'price', 'currency_id', 'status', 'youtube_url'];

app.get('/api/vehicles', ctx => {
  need(ctx.user, 'ROLE_VEH_R', 'ROLE_VEH', 'ROLE_SP_C');
  const q = ctx.query;
  const w = ['v.active=1']; const p = [];
  if (q.status) { w.push('v.status=?'); p.push(q.status); }
  if (q.make_id) { w.push('v.make_id=?'); p.push(q.make_id); }
  if (q.model_id) { w.push('v.model_id=?'); p.push(q.model_id); }
  if (q.fuel_type) { w.push('v.fuel_type=?'); p.push(q.fuel_type); }
  if (q.q) {
    for (const word of q.q.trim().split(/\s+/)) {
      const l = '%' + word + '%';
      w.push(`(v.internal_code=? OR v.chassis_number LIKE ? OR v.engine_code LIKE ? OR v.gearbox_code LIKE ? OR v.color LIKE ? OR v.note LIKE ? OR mk.name LIKE ? OR mo.name LIKE ? OR mo.generation_name LIKE ? OR CAST(v.model_year AS TEXT)=?)`);
      p.push(word, l, l, l, l, l, l, l, l, word);
    }
  }
  const limit = Math.min(Number(q.limit) || 50, 500), offset = Number(q.offset) || 0;
  const from = `FROM vehicle v LEFT JOIN car_make mk ON mk.id=v.make_id LEFT JOIN car_model mo ON mo.id=v.model_id WHERE ${w.join(' AND ')}`;
  const total = get(`SELECT count(*) n ${from}`, ...p).n;
  const rows = all(`SELECT v.id, v.internal_code, v.make_id, v.model_id, v.model_year, v.fuel_type, v.cylinder_capacity, v.power, v.engine_code, v.gearbox_type, v.chassis_number,
      v.status, v.price, v.currency_id, v.color, v.created_date, v.mileage, mk.name make_name,
      (SELECT a.id FROM lib_attachment a WHERE a.object_id=v.id AND a.active=1 ORDER BY a.main_picture DESC, a.created_date LIMIT 1) image_id,
      (SELECT count(*) FROM spare_part s WHERE s.vehicle_id=v.id AND s.active=1 AND s.status='UNSOLD') parts_unsold,
      (SELECT count(*) FROM spare_part s WHERE s.vehicle_id=v.id AND s.active=1 AND s.status='SOLD') parts_sold
    ${from} ORDER BY CAST(v.internal_code AS INTEGER) DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  for (const r of rows) r.model_label = modelLabelById(r.model_id);
  return { total, rows };
});

function detail(id) {
  const v = get(`SELECT v.*, mk.name make_name, rt.title rims_type_title, rd.title rims_diameter_title, rw.title rims_width_title,
      rp.bolt_number||'x'||rp.bolt_distance rims_pattern_title, cu.full_name created_by_name
    FROM vehicle v LEFT JOIN car_make mk ON mk.id=v.make_id LEFT JOIN rims_type rt ON rt.id=v.rims_type_id LEFT JOIN rims_diameter rd ON rd.id=v.rims_diameter_id
    LEFT JOIN rims_width rw ON rw.id=v.rims_width_id LEFT JOIN rims_bolt_pattern rp ON rp.id=v.rims_pattern_id LEFT JOIN core_user cu ON cu.id=v.created_by_id WHERE v.id=?`, id);
  if (!v) throw notFound('Vozilo ne postoji');
  v.model_label = modelLabelById(v.model_id);
  v.images = all('SELECT id, main_picture, created_date FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date', id);
  v.stats = get(`SELECT count(*) total, sum(status='UNSOLD') unsold, sum(status='SOLD') sold,
      sum(CASE WHEN status='UNSOLD' THEN coalesce(price,0) END) unsold_value FROM spare_part WHERE vehicle_id=? AND active=1`, id);
  v.stats.earned = get(`SELECT coalesce(sum(CASE WHEN h.status='SOLD' THEN h.the_price ELSE -h.the_price END),0) s FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.vehicle_id=?`, id).s;
  v.rims = all('SELECT id, internal_code, status, price FROM rims WHERE vehicle_id=? AND active=1', id);
  v.sales = all('SELECT s.*, u.full_name user_name FROM app_vehicle_sale s LEFT JOIN core_user u ON u.id=s.created_by_id WHERE vehicle_id=? ORDER BY created_date DESC', id);
  return v;
}

app.get('/api/vehicles/by-code/:code', ctx => {
  need(ctx.user, 'ROLE_VEH_R', 'ROLE_VEH', 'ROLE_SP_C');
  const v = get('SELECT id FROM vehicle WHERE internal_code=? AND active=1', ctx.params.code.trim());
  if (!v) throw notFound('Vozilo ' + ctx.params.code + ' ne postoji');
  return detail(v.id);
});
app.get('/api/vehicles/:id', ctx => { need(ctx.user, 'ROLE_VEH_R', 'ROLE_VEH', 'ROLE_SP_C'); return detail(ctx.params.id); });

app.post('/api/vehicles', ctx => {
  need(ctx.user, 'ROLE_VEH_C');
  const d = pick(ctx.body, FIELDS);
  if (!d.make_id || !d.model_id || !d.model_year) throw bad('Marka, model i godište su obavezni');
  const id = uuid(); const t = now();
  tx(() => insert('vehicle', { ...d, id, internal_code: String(nextNumber('vehicle_number')), status: d.status || 'PARTS', currency_id: d.currency_id || 'BAM', active: 1, licence: LICENCE,
    created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t }));
  return detail(id);
});

app.put('/api/vehicles/:id', ctx => {
  need(ctx.user, 'ROLE_VEH_U');
  const d = pick(ctx.body, FIELDS);
  d.modified_by_id = ctx.user.id; d.modified_date = now();
  tx(() => {
    update('vehicle', d, 'id=?', ctx.params.id);
    // Ako se promijeni marka/model/godište — ažuriraj i dijelove sa ovog vozila
    if (ctx.body.propagate && (d.make_id || d.model_id || d.model_year)) {
      const v = get('SELECT * FROM vehicle WHERE id=?', ctx.params.id);
      run('UPDATE spare_part SET make_id=?, model_id=?, model_year=? WHERE vehicle_id=?', v.make_id, v.model_id, v.model_year, v.id);
    }
  });
  return detail(ctx.params.id);
});

app.del('/api/vehicles/:id', ctx => {
  need(ctx.user, 'ROLE_VEH_D');
  run('UPDATE vehicle SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});

// Prodaja cijelog vozila (status COMPLETE) — evidencija
app.post('/api/vehicles/:id/sell', ctx => {
  need(ctx.user, 'ROLE_VEH_U');
  const v = get('SELECT * FROM vehicle WHERE id=?', ctx.params.id);
  if (!v) throw notFound();
  insert('app_vehicle_sale', { id: uuid(), vehicle_id: v.id, the_price: Number(ctx.body.price ?? v.price ?? 0), currency_id: v.currency_id || 'BAM', note: ctx.body.note || null, status: 'SOLD', created_by_id: ctx.user.id, created_date: now() });
  run("UPDATE vehicle SET status='SOLD', modified_by_id=?, modified_date=? WHERE id=?", ctx.user.id, now(), v.id);
  return detail(v.id);
});
