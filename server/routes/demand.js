// "Tražili, a nismo imali" — evidencija potražnje kupaca + poklapanje sa dijelovima koji se kasnije unesu
import { app } from '../router.js';
import { db, get, all, run, insert } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound, pick, modelLabelById } from '../util.js';
import { norm } from './bulk.js';

db.exec(`CREATE TABLE IF NOT EXISTS app_demand (id TEXT PRIMARY KEY, created_date TEXT, created_by_id TEXT, customer_name TEXT, phone TEXT,
  make_id TEXT, model_id TEXT, model_year INTEGER, type_id TEXT, catalog_number TEXT, text TEXT, status TEXT DEFAULT 'OPEN', note TEXT,
  closed_date TEXT, closed_by_id TEXT, matched_part_id TEXT);
  CREATE INDEX IF NOT EXISTS ix_demand_status ON app_demand(status, created_date);`);

const N = c => `upper(replace(replace(replace(replace(${c},' ',''),'-',''),'.',''),'/',''))`;
const R = ['ROLE_SP_R', 'ROLE_SP', 'ROLE_REQ_C'];

// dijelovi na stanju koji odgovaraju zahtjevu
function matches(d, limit = 20) {
  const cols = `p.id, p.internal_code, p.title, p.price, p.catalog_number, p.side, l.code_extended location_code, p.created_date`;
  const J = `FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id WHERE p.active=1 AND p.status='UNSOLD'`;
  const c = norm(d.catalog_number);
  if (c.length >= 5) return all(`SELECT ${cols} ${J} AND (${N('p.catalog_number')}=? OR ${N('p.catalog_number_manufacturer')}=?) ORDER BY p.created_date DESC LIMIT ${limit}`, c, c);
  if (d.type_id && d.model_id) return all(`SELECT ${cols} ${J} AND p.type_id=? AND p.model_id=? ORDER BY p.created_date DESC LIMIT ${limit}`, d.type_id, d.model_id);
  return [];
}
function decorate(d) {
  d.model_label = d.model_id ? modelLabelById(d.model_id) : (d.make_id ? get('SELECT name FROM car_make WHERE id=?', d.make_id)?.name : '');
  d.type_title = d.type_id ? get('SELECT title FROM spare_part_type WHERE id=?', d.type_id)?.title : null;
  d.user_name = get('SELECT full_name FROM core_user WHERE id=?', d.created_by_id)?.full_name;
  return d;
}

app.get('/api/demand', ctx => {
  need(ctx.user, ...R);
  const q = ctx.query; const w = ['1=1']; const p = [];
  if (q.status === 'OPEN' || !q.status || q.status === 'AVAILABLE') w.push("status IN ('OPEN','NOTIFIED')");
  else if (q.status !== 'ALL') { w.push('status=?'); p.push(q.status); }
  if (q.q) { const l = '%' + q.q + '%'; w.push('(customer_name LIKE ? OR phone LIKE ? OR catalog_number LIKE ? OR text LIKE ?)'); p.push(l, l, l, l); }
  let rows = all(`SELECT * FROM app_demand WHERE ${w.join(' AND ')} ORDER BY created_date DESC LIMIT 500`, ...p).map(decorate);
  for (const d of rows) { const m = d.status === 'OPEN' || d.status === 'NOTIFIED' ? matches(d, 5) : []; d.match_count = m.length; d.matches = m; }
  if (q.status === 'AVAILABLE') rows = rows.filter(d => d.match_count);
  const counts = get("SELECT sum(status IN ('OPEN','NOTIFIED')) open, sum(status='DONE') done, count(*) total FROM app_demand");
  return { rows, counts };
});

app.post('/api/demand', ctx => {
  need(ctx.user, ...R);
  const d = pick(ctx.body, ['customer_name', 'phone', 'make_id', 'model_id', 'model_year', 'type_id', 'catalog_number', 'text', 'note']);
  if (!d.type_id && !d.catalog_number && !d.text) throw bad('Upišite šta je kupac tražio (vrstu dijela, kataloški broj ili opis)');
  if (d.model_id && !d.make_id) d.make_id = get('SELECT make_id FROM car_model WHERE id=?', d.model_id)?.make_id;
  const id = uuid();
  insert('app_demand', { ...d, id, status: 'OPEN', created_by_id: ctx.user.id, created_date: now() });
  const row = decorate(get('SELECT * FROM app_demand WHERE id=?', id));
  row.matches = matches(row);
  return row;
});

// više brojeva odjednom (iz Pretrage liste: sve što nema)
app.post('/api/demand/bulk', ctx => {
  need(ctx.user, ...R);
  const items = (ctx.body.catalog_numbers || []).map(String).filter(Boolean).slice(0, 300);
  const t = now();
  for (const c of items) insert('app_demand', { id: uuid(), catalog_number: c, customer_name: ctx.body.customer_name || null, phone: ctx.body.phone || null, note: ctx.body.note || null, status: 'OPEN', created_by_id: ctx.user.id, created_date: t });
  return { created: items.length };
});

app.put('/api/demand/:id', ctx => {
  need(ctx.user, ...R);
  const d = get('SELECT * FROM app_demand WHERE id=?', ctx.params.id);
  if (!d) throw notFound();
  const upd = pick(ctx.body, ['customer_name', 'phone', 'note', 'status', 'matched_part_id']);
  if (upd.status && !['OPEN', 'NOTIFIED', 'DONE', 'CANCELED'].includes(upd.status)) throw bad('Pogrešan status');
  if (upd.status === 'DONE' || upd.status === 'CANCELED') { upd.closed_date = now(); upd.closed_by_id = ctx.user.id; }
  const keys = Object.keys(upd);
  if (keys.length) run(`UPDATE app_demand SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => upd[k]), d.id);
  return { ok: true };
});

app.get('/api/demand/:id/matches', ctx => { need(ctx.user, ...R); const d = get('SELECT * FROM app_demand WHERE id=?', ctx.params.id); if (!d) throw notFound(); return matches(d, 50); });

// Za dio: koji otvoreni zahtjevi kupaca odgovaraju (prikaz na dijelu i poslije unosa)
export function demandsForPart(partId) {
  const p = get('SELECT * FROM spare_part WHERE id=?', partId);
  if (!p) return [];
  const c = norm(p.catalog_number);
  return all(`SELECT * FROM app_demand WHERE status IN ('OPEN','NOTIFIED') AND (
      (length(?) >= 5 AND ${N('catalog_number')} = ?) OR (type_id=? AND model_id=?) OR (type_id=? AND model_id IS NULL AND make_id=?))
    ORDER BY created_date DESC LIMIT 20`, c, c, p.type_id, p.model_id, p.type_id, p.make_id).map(decorate);
}
app.get('/api/demand/for-part/:id', ctx => { need(ctx.user, ...R); return demandsForPart(ctx.params.id); });

// Analitika: šta se najčešće traži
app.get('/api/demand/stats', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const months = Math.min(Math.max(Number(ctx.query.months) || 12, 1), 60);
  const since = `date('now','-${months} months')`;
  const rows = all(`SELECT type_id, model_id, make_id, count(*) n, sum(status='DONE') done, max(created_date) last FROM app_demand
    WHERE created_date >= ${since} AND status <> 'CANCELED' AND type_id IS NOT NULL GROUP BY type_id, coalesce(model_id, make_id) ORDER BY n DESC LIMIT 40`);
  for (const r of rows) { decorate(r); r.stock = matches(r, 999).length; }
  const total = get(`SELECT count(*) n, sum(status='DONE') done FROM app_demand WHERE created_date >= ${since} AND status <> 'CANCELED'`);
  return { months, rows, total };
});
