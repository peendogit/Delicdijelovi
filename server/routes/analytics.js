import { app } from '../router.js';
import { get, all } from '../db.js';
import { need } from '../auth.js';
import { today, modelLabelById } from '../util.js';

app.get('/api/analytics', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const to = ctx.query.to || today();
  const from = ctx.query.from || to.slice(0, 8) + '01';
  const P = [from, to];
  const RA = a => `${a}created_date >= ? AND ${a}created_date < date(?, '+1 day')`;
  const R = RA('');
  const fmt = ctx.query.group === 'month' ? '%Y-%m' : '%Y-%m-%d';

  const summary = {
    added: get(`SELECT count(*) n FROM spare_part WHERE ${R}`, ...P).n,
    sold: get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='SOLD' AND ${R}`, ...P).n,
    returned: get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='UNSOLD' AND ${R}`, ...P).n,
    revenue: get(`SELECT coalesce(sum(CASE WHEN status='SOLD' THEN the_price ELSE -the_price END),0) s FROM spare_part_sale_history WHERE ${R}`, ...P).s,
    rims_sold: get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='SOLD' AND rims_id IS NOT NULL AND ${R}`, ...P).n,
    vehicles_added: get(`SELECT count(*) n FROM vehicle WHERE ${R}`, ...P).n,
    req_created: get(`SELECT count(*) n FROM req WHERE active=1 AND ${R}`, ...P).n,
    req_closed: get(`SELECT count(*) n FROM req WHERE active=1 AND closed_date >= ? AND closed_date < date(?, '+1 day')`, ...P).n,
    req_avg_min: get(`SELECT avg((julianday(closed_date)-julianday(created_date))*1440) m FROM req WHERE active=1 AND closed_date IS NOT NULL AND ${R}`, ...P).m,
    photos: get(`SELECT count(*) n FROM lib_attachment WHERE active=1 AND ${R}`, ...P).n,
  };

  const series = {};
  const put = (k, rows) => rows.forEach(r => { (series[r.d] ||= { d: r.d, added: 0, sold: 0, revenue: 0 })[k] = r.v; });
  put('added', all(`SELECT strftime('${fmt}', created_date) d, count(*) v FROM spare_part WHERE ${R} GROUP BY d`, ...P));
  put('sold', all(`SELECT strftime('${fmt}', created_date) d, count(*) v FROM spare_part_sale_history WHERE status='SOLD' AND ${R} GROUP BY d`, ...P));
  put('revenue', all(`SELECT strftime('${fmt}', created_date) d, sum(CASE WHEN status='SOLD' THEN the_price ELSE -the_price END) v FROM spare_part_sale_history WHERE ${R} GROUP BY d`, ...P));

  const users = {};
  const u = (k, rows) => rows.forEach(r => { if (r.id) (users[r.id] ||= { id: r.id, name: r.name || '?', added: 0, sold: 0, revenue: 0, req_created: 0, req_done: 0, photos: 0, moved: 0 })[k] = r.v; });
  const J = 'LEFT JOIN core_user u ON u.id=x.';
  u('added', all(`SELECT x.created_by_id id, u.full_name name, count(*) v FROM spare_part x ${J}created_by_id WHERE ${RA('x.')} GROUP BY 1`, ...P));
  u('sold', all(`SELECT x.created_by_id id, u.full_name name, count(*) v FROM spare_part_sale_history x ${J}created_by_id WHERE x.status='SOLD' AND ${RA('x.')} GROUP BY 1`, ...P));
  u('revenue', all(`SELECT x.created_by_id id, u.full_name name, sum(CASE WHEN x.status='SOLD' THEN x.the_price ELSE -x.the_price END) v FROM spare_part_sale_history x ${J}created_by_id WHERE ${RA('x.')} GROUP BY 1`, ...P));
  u('req_created', all(`SELECT x.created_by_id id, u.full_name name, count(*) v FROM req x ${J}created_by_id WHERE x.active=1 AND ${RA('x.')} GROUP BY 1`, ...P));
  u('req_done', all(`SELECT x.realization_by_id id, u.full_name name, count(*) v FROM req x ${J}realization_by_id WHERE x.active=1 AND x.realization_date >= ? AND x.realization_date < date(?, '+1 day') GROUP BY 1`, ...P));
  u('photos', all(`SELECT x.created_by_id id, u.full_name name, count(*) v FROM lib_attachment x ${J}created_by_id WHERE x.active=1 AND ${RA('x.')} GROUP BY 1`, ...P));
  u('moved', all(`SELECT x.created_by_id id, u.full_name name, count(*) v FROM spare_part_location_history x ${J}created_by_id WHERE x.action='IN' AND ${RA('x.')} GROUP BY 1`, ...P));

  const top_types = all(`SELECT t.title, count(*) n, sum(h.the_price) revenue FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id JOIN spare_part_type t ON t.id=p.type_id
    WHERE h.status='SOLD' AND ${RA('h.')} GROUP BY t.id ORDER BY n DESC LIMIT 20`, ...P);
  const top_makes = all(`SELECT m.name title, count(*) n, sum(h.the_price) revenue FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id JOIN car_make m ON m.id=p.make_id
    WHERE h.status='SOLD' AND ${RA('h.')} GROUP BY m.id ORDER BY n DESC LIMIT 15`, ...P);
  const top_vehicles = all(`SELECT v.id, v.internal_code, v.model_id, v.model_year, count(*) n, sum(h.the_price) revenue FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id
    JOIN vehicle v ON v.id=p.vehicle_id WHERE h.status='SOLD' AND ${RA('h.')} GROUP BY v.id ORDER BY revenue DESC LIMIT 15`, ...P);
  for (const v of top_vehicles) v.title = modelLabelById(v.model_id);

  const stock = get(`SELECT count(*) n, sum(price>0) priced, coalesce(sum(price),0) value,
      sum(NOT EXISTS (SELECT 1 FROM lib_attachment a WHERE a.object_id=spare_part.id AND a.active=1)) no_images
    FROM spare_part WHERE active=1 AND status='UNSOLD'`);
  const stock_groups = all(`SELECT coalesce(g.title,'—') title, count(*) n, coalesce(sum(p.price),0) value FROM spare_part p LEFT JOIN spare_part_type t ON t.id=p.type_id
    LEFT JOIN spare_part_group g ON g.id=t.group_id WHERE p.active=1 AND p.status='UNSOLD' GROUP BY g.id ORDER BY n DESC`);

  return { from, to, summary, series: Object.values(series).sort((a, b) => a.d.localeCompare(b.d)), users: Object.values(users).sort((a, b) => b.added + b.sold - a.added - a.sold), top_types, top_makes, top_vehicles, stock, stock_groups };
});

// ---------------------------------------------------------------------------
// Dodatna analitika
// ---------------------------------------------------------------------------
const prevPeriod = (from, to) => {
  const d1 = new Date(from + 'T00:00:00Z'), d2 = new Date(to + 'T00:00:00Z');
  const days = Math.round((d2 - d1) / 864e5) + 1;
  const pTo = new Date(d1 - 864e5), pFrom = new Date(pTo - (days - 1) * 864e5);
  return [pFrom.toISOString().slice(0, 10), pTo.toISOString().slice(0, 10)];
};
function kpis(from, to) {
  const P = [from, to]; const R = `created_date >= ? AND created_date < date(?, '+1 day')`;
  return {
    revenue: get(`SELECT coalesce(sum(CASE WHEN status='SOLD' THEN the_price ELSE -the_price END),0) s FROM spare_part_sale_history WHERE ${R}`, ...P).s,
    sold: get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='SOLD' AND ${R}`, ...P).n,
    added: get(`SELECT count(*) n FROM spare_part WHERE ${R}`, ...P).n,
    avg_price: get(`SELECT avg(the_price) a FROM spare_part_sale_history WHERE status='SOLD' AND the_price>0 AND ${R}`, ...P).a,
    returned: get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='UNSOLD' AND ${R}`, ...P).n,
  };
}

// Poređenje sa prethodnim periodom + kad se prodaje (dan u sedmici × sat)
app.get('/api/analytics/overview', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const to = ctx.query.to || today(), from = ctx.query.from || to.slice(0, 8) + '01';
  const [pf, pt] = prevPeriod(from, to);
  const heat = all(`SELECT CAST(strftime('%w', created_date) AS INTEGER) dow, CAST(strftime('%H', created_date) AS INTEGER) hr, count(*) n, sum(the_price) s
    FROM spare_part_sale_history WHERE status='SOLD' AND created_date >= ? AND created_date < date(?, '+1 day') GROUP BY dow, hr`, from, to);
  const yoyFrom = String(Number(from.slice(0, 4)) - 1) + from.slice(4), yoyTo = String(Number(to.slice(0, 4)) - 1) + to.slice(4);
  const priceBands = all(`SELECT CASE WHEN the_price<20 THEN '< 20' WHEN the_price<50 THEN '20–49' WHEN the_price<100 THEN '50–99' WHEN the_price<200 THEN '100–199'
      WHEN the_price<500 THEN '200–499' WHEN the_price<1000 THEN '500–999' ELSE '1000+' END title, count(*) n, sum(the_price) revenue, min(the_price) mn
    FROM spare_part_sale_history WHERE status='SOLD' AND the_price>0 AND created_date >= ? AND created_date < date(?, '+1 day') GROUP BY title ORDER BY mn`, from, to);
  // popust: prodajna cijena vs. cijena na dijelu
  const disc = get(`SELECT count(*) n, avg(h.the_price / p.price) r FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id
    WHERE h.status='SOLD' AND p.price>0 AND h.the_price>0 AND h.created_date >= ? AND h.created_date < date(?, '+1 day')`, from, to);
  const zero = get(`SELECT count(*) n FROM spare_part_sale_history WHERE status='SOLD' AND the_price=0 AND created_date >= ? AND created_date < date(?, '+1 day')`, from, to).n;
  return { from, to, cur: kpis(from, to), prev: { from: pf, to: pt, ...kpis(pf, pt) }, yoy: { from: yoyFrom, to: yoyTo, ...kpis(yoyFrom, yoyTo) }, heat, priceBands, discount: disc, zero_price_sales: zero };
});

// Zaliha: starost robe, ležeća roba, grupe, magacini, koliko se od unesenog prodalo
app.get('/api/analytics/stock', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const age = `julianday('now') - julianday(p.created_date)`;
  const buckets = all(`SELECT CASE WHEN ${age} < 90 THEN 1 WHEN ${age} < 180 THEN 2 WHEN ${age} < 365 THEN 3 WHEN ${age} < 730 THEN 4 WHEN ${age} < 1095 THEN 5 ELSE 6 END b,
      count(*) n, coalesce(sum(p.price),0) value, sum(p.price>0) priced FROM spare_part p WHERE p.active=1 AND p.status='UNSOLD' GROUP BY b ORDER BY b`);
  const L = { 1: 'do 3 mjeseca', 2: '3–6 mjeseci', 3: '6–12 mjeseci', 4: '1–2 godine', 5: '2–3 godine', 6: 'preko 3 godine' };
  for (const b of buckets) b.title = L[b.b];
  const groups = all(`SELECT coalesce(g.title,'—') title, count(*) n, coalesce(sum(p.price),0) value, round(avg(${age})) avg_days,
      sum(${age} > 730) old FROM spare_part p LEFT JOIN spare_part_type t ON t.id=p.type_id LEFT JOIN spare_part_group g ON g.id=t.group_id
    WHERE p.active=1 AND p.status='UNSOLD' GROUP BY g.id ORDER BY n DESC`);
  const oldest_valuable = all(`SELECT p.id, p.internal_code, p.title, p.price, p.created_date, l.code_extended location_code FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id
    WHERE p.active=1 AND p.status='UNSOLD' AND p.price >= 100 ORDER BY p.created_date LIMIT 40`);
  const cohorts = all(`SELECT strftime('%Y', created_date) y, count(*) n, sum(status='SOLD') sold FROM spare_part WHERE active=1 OR status='SOLD' GROUP BY y ORDER BY y`);
  const warehouses = all(`SELECT w.title, count(p.id) n, coalesce(sum(p.price),0) value FROM spare_part p JOIN whs_ast a ON a.id=p.location_id JOIN whs w ON w.id=a.whs_id
    WHERE p.active=1 AND p.status='UNSOLD' GROUP BY w.id ORDER BY n DESC`);
  const no_loc = get("SELECT count(*) n FROM spare_part WHERE active=1 AND status='UNSOLD' AND location_id IS NULL").n;
  const empty_locations = get(`SELECT count(*) n FROM whs_ast a JOIN whs_ast_type t ON t.id=a.ast_type_id WHERE a.active=1 AND t.parts_allowed=1
    AND NOT EXISTS (SELECT 1 FROM spare_part p WHERE p.location_id=a.id AND p.active=1 AND p.status='UNSOLD') AND NOT EXISTS (SELECT 1 FROM whs_ast c WHERE c.parent_id=a.id AND c.active=1)`).n;
  return { buckets, groups, oldest_valuable, cohorts, warehouses, no_loc, empty_locations };
});

// Potražnja na nivou TAČNOG modela (generacija + godišta), npr. "ZADNJI MOST — Mercedes ML W164 (05-08)"
function demandData(months, makeId) {
  const since = `date('now', '-${months} months')`;
  const mk = makeId ? ' AND p.make_id=?' : '';
  const prm = makeId ? [makeId] : [];
  const sales = all(`SELECT p.type_id, p.model_id, count(*) sold, sum(h.the_price) revenue, round(avg(NULLIF(h.the_price,0))) avg_price,
      round(avg(julianday(h.created_date) - julianday(p.created_date))) days_to_sell, max(h.created_date) last_sold
    FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE h.status='SOLD' AND h.created_date >= ${since}${mk} GROUP BY p.type_id, p.model_id`, ...prm);
  const stock = all(`SELECT p.type_id, p.model_id, count(*) n FROM spare_part p WHERE p.active=1 AND p.status='UNSOLD'${mk} GROUP BY p.type_id, p.model_id`, ...prm);
  const st = new Map(stock.map(r => [r.type_id + '|' + r.model_id, r.n]));
  const types = new Map(all('SELECT t.id, t.title, g.title grp FROM spare_part_type t LEFT JOIN spare_part_group g ON g.id=t.group_id').map(t => [t.id, t]));
  const ml = new Map();
  const label = id => { if (!ml.has(id)) ml.set(id, modelLabelById(id)); return ml.get(id); };
  const rows = sales.map(r => {
    const n = st.get(r.type_id + '|' + r.model_id) || 0;
    return { ...r, stock: n, type: types.get(r.type_id)?.title || '?', grp: types.get(r.type_id)?.grp || '', model: label(r.model_id),
      months_of_stock: Math.round((n / (r.sold / months)) * 10) / 10 };
  });
  return { rows, stock, sales, types, label, st };
}

app.get('/api/analytics/demand', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const months = Math.min(Math.max(Number(ctx.query.months) || 12, 1), 60);
  const { rows, stock, sales, types, label } = demandData(months, ctx.query.make_id || null);
  // traži se (bar 2 prodaje), a zaliha ne pokriva ni godinu prodaje
  const shortage = rows.filter(r => r.sold >= 2 && r.months_of_stock < 12).sort((a, b) => (b.stock === 0) - (a.stock === 0) || b.revenue - a.revenue).slice(0, 80);
  const fastest = rows.filter(r => r.sold >= 3).sort((a, b) => a.days_to_sell - b.days_to_sell).slice(0, 25);
  // previše: puno na stanju za taj model, a skoro se ne prodaje
  const soldMap = new Map(sales.map(r => [r.type_id + '|' + r.model_id, r.sold]));
  const overstock = stock.filter(r => r.n >= 8).map(r => {
    const sold = soldMap.get(r.type_id + '|' + r.model_id) || 0;
    return { type_id: r.type_id, model_id: r.model_id, stock: r.n, sold, type: types.get(r.type_id)?.title || '?', grp: types.get(r.type_id)?.grp || '',
      months_of_stock: sold ? Math.round((r.n / (sold / months)) * 10) / 10 : null };
  }).filter(r => r.months_of_stock === null || r.months_of_stock > 60).sort((a, b) => b.stock - a.stock).slice(0, 60);
  for (const r of overstock) r.model = label(r.model_id);
  // najtraženija vozila (tačan model) — po broju prodatih dijelova
  const byModel = new Map();
  for (const r of rows) {
    const m = byModel.get(r.model_id) || { model_id: r.model_id, model: r.model, sold: 0, revenue: 0, types: 0, missing: 0 };
    m.sold += r.sold; m.revenue += r.revenue; m.types++; if (r.months_of_stock < 12) m.missing++;
    byModel.set(r.model_id, m);
  }
  const stockByModel = new Map();
  for (const r of stock) stockByModel.set(r.model_id, (stockByModel.get(r.model_id) || 0) + r.n);
  const vehicles = new Map(all("SELECT model_id, count(*) n, max(created_date) last FROM vehicle WHERE active=1 GROUP BY model_id").map(v => [v.model_id, v]));
  const models = [...byModel.values()].map(m => ({ ...m, stock: stockByModel.get(m.model_id) || 0, donors: vehicles.get(m.model_id)?.n || 0, last_donor: vehicles.get(m.model_id)?.last || null }))
    .sort((a, b) => b.sold - a.sold).slice(0, 50);
  return { months, shortage, overstock, fastest, models };
});

// Jedan tačan model: koji dijelovi se za njega traže i šta ima na stanju
app.get('/api/analytics/demand/model/:id', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const months = Math.min(Math.max(Number(ctx.query.months) || 12, 1), 60);
  const since = `date('now', '-${months} months')`;
  const id = ctx.params.id;
  const rows = all(`SELECT t.id type_id, t.title type, coalesce(g.title,'') grp,
      (SELECT count(*) FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.model_id=? AND p.type_id=t.id AND h.status='SOLD' AND h.created_date >= ${since}) sold,
      (SELECT coalesce(sum(h.the_price),0) FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.model_id=? AND p.type_id=t.id AND h.status='SOLD' AND h.created_date >= ${since}) revenue,
      (SELECT count(*) FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.model_id=? AND p.type_id=t.id AND h.status='SOLD') sold_all,
      (SELECT count(*) FROM spare_part p WHERE p.model_id=? AND p.type_id=t.id AND p.active=1 AND p.status='UNSOLD') stock
    FROM spare_part_type t LEFT JOIN spare_part_group g ON g.id=t.group_id
    WHERE t.id IN (SELECT DISTINCT type_id FROM spare_part WHERE model_id=?)`, id, id, id, id, id).filter(r => r.sold_all || r.stock);
  rows.sort((a, b) => b.sold - a.sold || b.sold_all - a.sold_all);
  const totals = { sold: rows.reduce((s, r) => s + r.sold, 0), revenue: rows.reduce((s, r) => s + r.revenue, 0), stock: rows.reduce((s, r) => s + r.stock, 0) };
  const donors = all('SELECT id, internal_code, model_year, created_date, status FROM vehicle WHERE model_id=? AND active=1 ORDER BY created_date DESC', id);
  return { model: modelLabelById(id), months, rows, totals, donors };
});

// Vozila-donori: zarada po vozilu i po modelu, brzina zarade
app.get('/api/analytics/vehicles', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const rows = all(`SELECT v.id, v.internal_code, v.model_id, v.model_year, v.created_date, v.status,
      (SELECT count(*) FROM spare_part p WHERE p.vehicle_id=v.id AND p.active=1) parts,
      (SELECT count(*) FROM spare_part p WHERE p.vehicle_id=v.id AND p.status='SOLD') sold,
      (SELECT coalesce(sum(CASE WHEN h.status='SOLD' THEN h.the_price ELSE -h.the_price END),0) FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.vehicle_id=v.id) earned,
      (SELECT coalesce(sum(h.the_price),0) FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.vehicle_id=v.id AND h.status='SOLD' AND julianday(h.created_date) - julianday(v.created_date) <= 90) earned_90,
      (SELECT coalesce(sum(p.price),0) FROM spare_part p WHERE p.vehicle_id=v.id AND p.active=1 AND p.status='UNSOLD') stock_value
    FROM vehicle v WHERE v.active=1`);
  for (const r of rows) { r.title = modelLabelById(r.model_id); r.days = Math.round((Date.now() - new Date(r.created_date.replace(' ', 'T'))) / 864e5); r.per_month = r.days > 30 ? Math.round(r.earned / (r.days / 30)) : null; }
  const byModel = {};
  for (const r of rows) {
    const k = r.title.replace(/\s*\(.*\)$/, '');
    const m = (byModel[k] ||= { title: k, vehicles: 0, earned: 0, earned_90: 0, sold: 0 });
    m.vehicles++; m.earned += r.earned; m.earned_90 += r.earned_90; m.sold += r.sold;
  }
  const models = Object.values(byModel).map(m => ({ ...m, avg: Math.round(m.earned / m.vehicles), avg_90: Math.round(m.earned_90 / m.vehicles) })).filter(m => m.vehicles >= 2).sort((a, b) => b.avg - a.avg).slice(0, 30);
  const top = [...rows].sort((a, b) => b.earned - a.earned).slice(0, 25);
  const recent = [...rows].filter(r => r.days <= 365).sort((a, b) => b.created_date.localeCompare(a.created_date)).slice(0, 25);
  const total = { vehicles: rows.length, earned: rows.reduce((s, r) => s + r.earned, 0), avg: Math.round(rows.reduce((s, r) => s + r.earned, 0) / (rows.length || 1)) };
  return { total, models, top, recent };
});

// Radnici: detaljno + brzina realizacije naloga
app.get('/api/analytics/workers', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const to = ctx.query.to || today(), from = ctx.query.from || to.slice(0, 8) + '01';
  const req = all(`SELECT r.realization_by_id id, u.full_name name, count(*) n,
      round(avg((julianday(coalesce(r.realization_date, r.closed_date)) - julianday(r.created_date)) * 1440)) to_take_min,
      round(avg((julianday(r.closed_date) - julianday(r.created_date)) * 1440)) to_close_min,
      sum(r.urgent) urgent FROM req r LEFT JOIN core_user u ON u.id=r.realization_by_id
    WHERE r.active=1 AND r.closed_date IS NOT NULL AND r.created_date >= ? AND r.created_date < date(?, '+1 day') GROUP BY r.realization_by_id ORDER BY n DESC`, from, to);
  const daily = all(`SELECT u.full_name name, date(p.created_date) d, count(*) n FROM spare_part p LEFT JOIN core_user u ON u.id=p.created_by_id
    WHERE p.created_date >= ? AND p.created_date < date(?, '+1 day') GROUP BY p.created_by_id, d`, from, to);
  const perDay = {};
  for (const r of daily) { const x = (perDay[r.name] ||= { name: r.name, days: 0, total: 0, best: 0 }); x.days++; x.total += r.n; x.best = Math.max(x.best, r.n); }
  const entry = Object.values(perDay).map(x => ({ ...x, avg: Math.round(x.total / x.days) })).sort((a, b) => b.total - a.total);
  const quality = all(`SELECT u.full_name name, count(*) n, sum(p.catalog_number IS NULL OR p.catalog_number='') no_cat,
      sum(NOT EXISTS (SELECT 1 FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1)) no_img, sum(p.price IS NULL OR p.price=0) no_price
    FROM spare_part p LEFT JOIN core_user u ON u.id=p.created_by_id WHERE p.created_date >= ? AND p.created_date < date(?, '+1 day') GROUP BY p.created_by_id ORDER BY n DESC`, from, to);
  return { from, to, req, entry, quality };
});

// ---------------------------------------------------------------------------
// Ulaganja u vozila: nabavna cijena (vehicle.price) + dodatni troškovi, naspram zarade od dijelova i prodaje cijelih vozila
// ---------------------------------------------------------------------------
export function vehicleMoney() {
  const veh = all(`SELECT v.id, v.internal_code, v.model_id, v.model_year, v.created_date, v.status, coalesce(v.price,0) price FROM vehicle v WHERE v.active=1`);
  const costs = all('SELECT vehicle_id, amount, cost_date d FROM app_vehicle_cost WHERE active=1');
  // sve prodaje dijelova sa vozila (povrati umanjuju)
  const sales = all(`SELECT p.vehicle_id, h.created_date d, CASE WHEN h.status='SOLD' THEN h.the_price ELSE -h.the_price END amt
    FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE p.vehicle_id IS NOT NULL ORDER BY h.created_date`);
  const whole = all('SELECT vehicle_id, created_date d, the_price amt FROM app_vehicle_sale ORDER BY created_date');
  const V = new Map(veh.map(v => [v.id, { ...v, extra: 0, earned: 0, whole: 0, payback: null, flows: [] }]));
  for (const c of costs) { const v = V.get(c.vehicle_id); if (v) v.extra += c.amount; }
  for (const s of [...sales, ...whole.map(w => ({ ...w, whole: 1 }))].sort((a, b) => a.d.localeCompare(b.d))) {
    const v = V.get(s.vehicle_id); if (!v) continue;
    if (s.whole) v.whole += s.amt; else v.earned += s.amt;
    v.flows.push(s);
  }
  for (const v of V.values()) {
    v.invested = v.price + v.extra;
    let cum = 0;
    for (const f of v.flows) { cum += f.amt; if (v.invested > 0 && cum >= v.invested) { v.payback = f.d; break; } }
    v.back = v.earned + v.whole;
    v.profit = v.back - v.invested;
    v.pct = v.invested ? Math.round((v.back / v.invested) * 100) : null;
    v.payback_days = v.payback ? Math.round((new Date(v.payback.replace(' ', 'T')) - new Date(v.created_date.replace(' ', 'T'))) / 864e5) : null;
  }
  return { V, sales, whole, costs };
}

app.get('/api/analytics/investments', ctx => {
  need(ctx.user, 'ROLE_ANL');
  const to = ctx.query.to || today(), from = ctx.query.from || '2000-01-01';
  const inP = d => d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const { V, sales, whole, costs } = vehicleMoney();
  const all_ = [...V.values()];
  const bought = all_.filter(v => inP(v.created_date));
  // novac u periodu (gotovinski tok): kupovine + troškovi u periodu, naspram prodaja u periodu
  const period = {
    vehicles: bought.length,
    invested: bought.reduce((s, v) => s + v.price, 0) + costs.filter(c => inP(c.d)).reduce((s, c) => s + c.amount, 0),
    earned_parts: sales.filter(s => inP(s.d)).reduce((s, x) => s + x.amt, 0),
    earned_whole: whole.filter(s => inP(s.d)).reduce((s, x) => s + x.amt, 0),
    no_price: bought.filter(v => !v.price).length,
  };
  period.avg = period.vehicles ? Math.round(bought.reduce((s, v) => s + v.invested, 0) / period.vehicles) : 0;
  period.balance = period.earned_parts + period.earned_whole - period.invested;
  // vozila kupljena u periodu: koliko su do danas vratila
  const cohort = {
    invested: bought.reduce((s, v) => s + v.invested, 0), back: bought.reduce((s, v) => s + v.back, 0),
    paid_off: bought.filter(v => v.payback).length,
    avg_payback_days: (() => { const p = bought.filter(v => v.payback_days != null); return p.length ? Math.round(p.reduce((s, v) => s + v.payback_days, 0) / p.length) : null; })(),
  };
  cohort.pct = cohort.invested ? Math.round((cohort.back / cohort.invested) * 100) : null;
  // po godinama (sve vrijeme)
  const years = {};
  const Y = y => (years[y] ||= { year: y, vehicles: 0, invested: 0, cash_in: 0, cohort_back: 0, paid_off: 0 });
  for (const v of all_) { const y = Y(v.created_date.slice(0, 4)); y.vehicles++; y.invested += v.invested; y.cohort_back += v.back; if (v.payback) y.paid_off++; }
  for (const s of [...sales, ...whole]) Y(s.d.slice(0, 4)).cash_in += s.amt;
  const yearRows = Object.values(years).sort((a, b) => b.year.localeCompare(a.year)).map(y => ({ ...y, pct: y.invested ? Math.round((y.cohort_back / y.invested) * 100) : null, balance: y.cash_in - y.invested }));
  // po mjesecima u periodu
  const months = {};
  const M = m => (months[m] ||= { d: m, invested: 0, cash_in: 0 });
  for (const v of bought) M(v.created_date.slice(0, 7)).invested += v.price;
  for (const c of costs) if (inP(c.d)) M(c.d.slice(0, 7)).invested += c.amount;
  for (const s of [...sales, ...whole]) if (inP(s.d)) M(s.d.slice(0, 7)).cash_in += s.amt;
  const list = bought.sort((a, b) => b.created_date.localeCompare(a.created_date)).map(v => ({
    id: v.id, internal_code: v.internal_code, title: modelLabelById(v.model_id), model_year: v.model_year, created_date: v.created_date, status: v.status,
    price: v.price, extra: v.extra, invested: v.invested, earned: v.earned, whole: v.whole, back: v.back, profit: v.profit, pct: v.pct, payback: v.payback, payback_days: v.payback_days,
  }));
  return { from, to, period, cohort, years: yearRows, months: Object.values(months).sort((a, b) => a.d.localeCompare(b.d)), vehicles: list };
});
