// Nalozi — zahtjev magacinu da donese dio (NEW -> PREPARED -> CLOSED)
import { app } from '../router.js';
import { get, all, run, insert, tx, LICENCE } from '../db.js';
import { need, can } from '../auth.js';
import { uuid, now, bad, notFound, nextNumber } from '../util.js';
import { assetLabel, returnLocation, moveItem } from '../whsutil.js';
import { sellItem } from './parts.js';

const READ = ['ROLE_REQ', 'ROLE_REQ_R', 'ROLE_REQ_C', 'ROLE_REQ_ST', 'ROLE_WHS_CLERK'];

const SELECT = `SELECT r.*, p.internal_code part_code, p.title part_title, p.catalog_number, p.status part_status, p.price part_price, p.location_id part_location_id,
    rm.internal_code rims_code, l.code_extended location_code, cl.code_extended current_location_code,
    cu.full_name created_by_name, ru.full_name realization_by_name, xu.full_name closed_by_name,
    (SELECT a.id FROM lib_attachment a WHERE a.object_id=coalesce(r.part_id, r.rims_id) AND a.active=1 ORDER BY a.main_picture DESC LIMIT 1) image_id
  FROM req r LEFT JOIN spare_part p ON p.id=r.part_id LEFT JOIN rims rm ON rm.id=r.rims_id LEFT JOIN whs_ast l ON l.id=r.location_id
  LEFT JOIN whs_ast cl ON cl.id=coalesce(p.location_id, rm.location_id)
  LEFT JOIN core_user cu ON cu.id=r.created_by_id LEFT JOIN core_user ru ON ru.id=r.realization_by_id LEFT JOIN core_user xu ON xu.id=r.closed_by_id`;

app.get('/api/req', ctx => {
  need(ctx.user, ...READ);
  const q = ctx.query; const w = ['r.active=1']; const p = [];
  if (q.status === 'ACTIVE' || !q.status) w.push("r.status IN ('NEW','PREPARED')");
  else if (q.status !== 'ALL') { w.push('r.status=?'); p.push(q.status); }
  if (q.mine === '1') { w.push('r.created_by_id=?'); p.push(ctx.user.id); }
  if (q.q) { w.push('(r.the_number=? OR p.internal_code=? OR p.title LIKE ? OR r.description LIKE ?)'); p.push(q.q.trim(), q.q.trim().toUpperCase(), '%' + q.q + '%', '%' + q.q + '%'); }
  if (q.date_from) { w.push('r.created_date>=?'); p.push(q.date_from); }
  if (q.date_to) { w.push("r.created_date<date(?,'+1 day')"); p.push(q.date_to); }
  const where = w.join(' AND ');
  const total = get(`SELECT count(*) n FROM req r LEFT JOIN spare_part p ON p.id=r.part_id WHERE ${where}`, ...p).n;
  const rows = all(`${SELECT} WHERE ${where} ORDER BY CASE WHEN r.status IN ('NEW','PREPARED') THEN r.urgent ELSE 0 END DESC, r.created_date DESC LIMIT ? OFFSET ?`,
    ...p, Math.min(Number(q.limit) || 100, 500), Number(q.offset) || 0);
  for (const r of rows) r.location_label = assetLabel(r.part_location_id || r.location_id);
  return { total, rows };
});

app.get('/api/req/:id', ctx => {
  need(ctx.user, ...READ);
  const r = get(`${SELECT} WHERE r.id=?`, ctx.params.id);
  if (!r) throw notFound('Nalog ne postoji');
  r.location_label = assetLabel(r.part_location_id || r.location_id);
  const groupId = r.parent_id || r.id;
  r.group = all(`${SELECT} WHERE (r.id=? OR r.parent_id=?) AND r.active=1 ORDER BY r.the_number`, groupId, groupId);
  return r;
});

// Kreiranje naloga za jedan ili više dijelova/felni
app.post('/api/req', ctx => {
  need(ctx.user, 'ROLE_REQ_C');
  const parts = (ctx.body.part_ids || []).filter(Boolean);
  const rims = (ctx.body.rims_ids || []).filter(Boolean);
  if (!parts.length && !rims.length) throw bad('Izaberite bar jedan dio');
  const created = [];
  tx(() => {
    let parentId = null;
    const items = [...parts.map(id => ['part', id]), ...rims.map(id => ['rims', id])];
    for (const [kind, id] of items) {
      const it = get(`SELECT id, location_id, status FROM ${kind === 'rims' ? 'rims' : 'spare_part'} WHERE id=? AND active=1`, id);
      if (!it) throw bad('Dio ne postoji');
      if (it.status === 'SOLD') throw bad('Dio je već prodat');
      if (get(`SELECT 1 x FROM req WHERE ${kind === 'rims' ? 'rims_id' : 'part_id'}=? AND status IN ('NEW','PREPARED') AND active=1`, id)) throw bad('Za ovaj dio već postoji aktivan nalog');
      const rid = uuid(); const t = now();
      insert('req', { id: rid, part_id: kind === 'part' ? id : null, rims_id: kind === 'rims' ? id : null, location_id: it.location_id, description: ctx.body.description || null,
        the_number: String(nextNumber('req_number')), status: 'NEW', urgent: ctx.body.urgent ? 1 : 0, shipment: ctx.body.shipment ? 1 : 0, parent_id: parentId,
        licence: LICENCE, active: 1, created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
      if (items.length > 1 && !parentId) parentId = rid;
      created.push(rid);
    }
  });
  return { created };
});

// Magacioner preuzima nalog (pronašao dio)
app.post('/api/req/:id/prepare', ctx => {
  need(ctx.user, 'ROLE_REQ_ST', 'ROLE_WHS_CLERK');
  const r = get('SELECT * FROM req WHERE id=?', ctx.params.id);
  if (!r) throw notFound();
  if (r.status !== 'NEW') throw bad('Nalog nije nov');
  run("UPDATE req SET status='PREPARED', realization_by_id=?, realization_date=?, modified_by_id=?, modified_date=? WHERE id=?", ctx.user.id, now(), ctx.user.id, now(), r.id);
  return { ok: true };
});

// Zatvaranje: dio je donesen na pult (P599) — opciono odmah i prodaja
app.post('/api/req/:id/close', ctx => {
  need(ctx.user, 'ROLE_REQ_ST', 'ROLE_WHS_CLERK');
  const r = get('SELECT * FROM req WHERE id=?', ctx.params.id);
  if (!r) throw notFound();
  if (r.status === 'CLOSED') throw bad('Nalog je već zatvoren');
  tx(() => {
    const t = now();
    run(`UPDATE req SET status='CLOSED', realization_by_id=coalesce(realization_by_id, ?), realization_date=coalesce(realization_date, ?), closed_by_id=?, closed_date=?, modified_by_id=?, modified_date=? WHERE id=?`,
      ctx.user.id, t, ctx.user.id, t, ctx.user.id, t, r.id);
    const kind = r.rims_id ? 'rims' : 'part';
    const itemId = r.rims_id || r.part_id;
    const loc = returnLocation();
    const it = get(`SELECT status FROM ${kind === 'rims' ? 'rims' : 'spare_part'} WHERE id=?`, itemId);
    if (loc && it?.status === 'UNSOLD' && ctx.body.move !== false) moveItem(kind, itemId, loc, ctx.user.id);
    if (ctx.body.sell) {
      need(ctx.user, 'ROLE_SP_SALE');
      sellItem(kind, itemId, { price: ctx.body.price, note: ctx.body.note }, ctx.user);
    }
  });
  return { ok: true };
});

app.post('/api/req/:id/reopen', ctx => {
  need(ctx.user, 'ROLE_REQ_ST');
  run("UPDATE req SET status='NEW', closed_by_id=NULL, closed_date=NULL, realization_by_id=NULL, realization_date=NULL, modified_by_id=?, modified_date=? WHERE id=?", ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});

app.put('/api/req/:id', ctx => {
  need(ctx.user, 'ROLE_REQ_U', 'ROLE_REQ_C');
  const r = get('SELECT * FROM req WHERE id=?', ctx.params.id);
  if (!r) throw notFound();
  if (!can(ctx.user, 'ROLE_REQ_U') && r.created_by_id !== ctx.user.id) throw bad('Možete mijenjati samo svoje naloge');
  run('UPDATE req SET description=?, urgent=?, shipment=?, modified_by_id=?, modified_date=? WHERE id=?',
    ctx.body.description ?? r.description, ctx.body.urgent ? 1 : 0, ctx.body.shipment ? 1 : 0, ctx.user.id, now(), r.id);
  return { ok: true };
});

app.del('/api/req/:id', ctx => {
  need(ctx.user, 'ROLE_REQ_U', 'ROLE_REQ_C');
  const r = get('SELECT * FROM req WHERE id=?', ctx.params.id);
  if (!r) throw notFound();
  if (!can(ctx.user, 'ROLE_REQ_U') && r.created_by_id !== ctx.user.id) throw bad('Možete otkazati samo svoje naloge');
  run('UPDATE req SET active=0, modified_by_id=?, modified_date=? WHERE id=?', ctx.user.id, now(), r.id);
  return { ok: true };
});
