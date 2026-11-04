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
