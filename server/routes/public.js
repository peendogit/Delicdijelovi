// Javni API samo za čitanje (npr. za webshop delicauto.com). Uključuje se postavljanjem PUBLIC_API_KEY u .env
// Zahtjev mora imati zaglavlje:  X-API-Key: <PUBLIC_API_KEY>
import { app } from '../router.js';
import { get, all } from '../db.js';
import { HttpError, modelLabelById } from '../util.js';

function key(ctx) {
  const k = process.env.PUBLIC_API_KEY;
  if (!k) throw new HttpError(404, 'Javni API nije uključen');
  if ((ctx.req.headers['x-api-key'] || ctx.query.key) !== k) throw new HttpError(401, 'Pogrešan API ključ');
  ctx.headers = { 'Access-Control-Allow-Origin': '*' };
}
const COLS = `p.id, p.internal_code code, p.title, p.catalog_number, p.price, p.currency_id, p.status, p.active, p.side, p.model_year, p.fuel_type, p.engine_code,
  p.cylinder_capacity, p.power, p.gearbox_type, p.model_id, mk.name make, t.title type, g.title grp, p.note, p.created_date, p.modified_date`;
const FROM = `FROM spare_part p LEFT JOIN car_make mk ON mk.id=p.make_id LEFT JOIN spare_part_type t ON t.id=p.type_id LEFT JOIN spare_part_group g ON g.id=t.group_id`;
function shape(r) {
  r.model = modelLabelById(r.model_id); delete r.model_id;
  r.images = all('SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date', r.id).map(x => '/img/' + x.id);
  r.available = r.active === 1 && r.status === 'UNSOLD';
  return r;
}

// Lista; ?since=2026-11-01 00:00:00 vraća i prodate/obrisane izmijenjene od tada (za sinhronizaciju)
app.get('/api/public/parts', ctx => {
  key(ctx);
  const q = ctx.query;
  const lim = Math.min(Number(q.limit) || 100, 500), off = Number(q.offset) || 0;
  const where = q.since ? 'p.modified_date >= ?' : "p.active=1 AND p.status='UNSOLD'";
  const p = q.since ? [q.since] : [];
  const total = get(`SELECT count(*) n FROM spare_part p WHERE ${where}`, ...p).n;
  const rows = all(`SELECT ${COLS} ${FROM} WHERE ${where} ORDER BY p.modified_date LIMIT ? OFFSET ?`, ...p, lim, off).map(shape);
  return { total, rows };
}, { public: true });

app.get('/api/public/parts/:code', ctx => {
  key(ctx);
  const r = get(`SELECT ${COLS} ${FROM} WHERE p.internal_code=? OR p.id=?`, ctx.params.code.toUpperCase(), ctx.params.code);
  if (!r) throw new HttpError(404, 'Ne postoji');
  return shape(r);
}, { public: true });
