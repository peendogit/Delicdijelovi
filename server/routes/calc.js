// Kalkulator otkupa: koliko ovakvo vozilo donosi od dijelova (iz vlastite istorije) → do koje cijene se isplati kupiti
import { app } from '../router.js';
import { get, all } from '../db.js';
import { need } from '../auth.js';
import { bad, modelLabelById } from '../util.js';
import { vehicleMoney } from './analytics.js';

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const days = (a, b) => (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 864e5;

app.get('/api/calc/vehicle', ctx => {
  need(ctx.user, 'ROLE_ANL', 'ROLE_VEH_C', 'ROLE_VEH_U');
  const { model_id, make_id } = ctx.query;
  const year = Number(ctx.query.year) || null;
  if (!model_id && !make_id) throw bad('Izaberite marku i model');
  const model = model_id ? get('SELECT * FROM car_model WHERE id=?', model_id) : null;
  const makeId = make_id || model?.make_id;
  const { V } = vehicleMoney();
  const vehicles = [...V.values()];
  // nivo poređenja: isti tačan model → isti model sve generacije → ista marka
  const sameName = model ? new Set(all('SELECT id FROM car_model WHERE make_id=? AND name=?', model.make_id, model.name).map(r => r.id)) : new Set();
  const levels = [
    model_id ? ['tačan model', vehicles.filter(v => v.model_id === model_id)] : null,
    model ? ['isti model, sve generacije', vehicles.filter(v => sameName.has(v.model_id))] : null,
    ['ista marka', vehicles.filter(v => get('SELECT make_id FROM car_model WHERE id=?', v.model_id)?.make_id === makeId)],
  ].filter(Boolean);
  const [basis, list] = levels.find(([, l]) => l.length >= 2) || levels[levels.length - 1];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const within = (v, d) => v.flows.filter(f => days(v.created_date, f.d) <= d).reduce((s, f) => s + f.amt, 0);
  const old = d => list.filter(v => days(v.created_date, now) >= d);
  const stat = d => { const l = old(d); return { n: l.length, median: median(l.map(v => within(v, d))), avg: l.length ? Math.round(l.reduce((s, v) => s + within(v, d), 0) / l.length) : null }; };
  const m3 = stat(90), m6 = stat(180), m12 = stat(365);
  const totals = list.map(v => v.back);
  const paid = list.map(v => v.price).filter(p => p > 0);
  const paybacks = list.filter(v => v.payback_days != null).map(v => v.payback_days);
  // potražnja i zaliha za taj model (zadnjih 12 mj.)
  const modelIds = model_id ? (basis === 'tačan model' ? [model_id] : [...sameName]) : all('SELECT id FROM car_model WHERE make_id=?', makeId).map(r => r.id);
  const ph = modelIds.map(() => '?').join(',') || "''";
  const demand = all(`SELECT t.title, count(*) sold, sum(h.the_price) revenue FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id JOIN spare_part_type t ON t.id=p.type_id
    WHERE h.status='SOLD' AND h.created_date >= date('now','-12 months') AND p.model_id IN (${ph}) GROUP BY t.id ORDER BY revenue DESC LIMIT 15`, ...modelIds);
  const stockTypes = new Map(all(`SELECT t.title, count(*) n FROM spare_part p JOIN spare_part_type t ON t.id=p.type_id WHERE p.active=1 AND p.status='UNSOLD' AND p.model_id IN (${ph}) GROUP BY t.id`, ...modelIds).map(r => [r.title, r.n]));
  for (const d of demand) d.stock = stockTypes.get(d.title) || 0;
  const sold12 = get(`SELECT count(*) n, coalesce(sum(h.the_price),0) s FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id WHERE h.status='SOLD' AND h.created_date >= date('now','-12 months') AND p.model_id IN (${ph})`, ...modelIds);
  const stock = get(`SELECT count(*) n FROM spare_part p WHERE p.active=1 AND p.status='UNSOLD' AND p.model_id IN (${ph})`, ...modelIds).n;
  // godište: noviji = više vrijedi (blaga korekcija prema prosjeku sličnih)
  const ys = list.map(v => v.model_year).filter(Boolean);
  const yf = year && ys.length >= 2 ? Math.min(1.3, Math.max(0.7, 1 + 0.03 * (year - median(ys)))) : 1;
  const base = m12.median ?? m6.median ?? median(totals);
  // preporuka: do ~60% onoga što ovakvo vozilo vrati u prvih 12 mjeseci (ostatak pokriva rad, prostor i rizik)
  // zasićenje: ima li ovog modela na stanju bitno više nego inače (u odnosu na prosjek cijelog otpada)
  const allStock = get("SELECT count(*) n FROM spare_part WHERE active=1 AND status='UNSOLD'").n;
  const allSold = get("SELECT count(*) n FROM spare_part_sale_history WHERE status='SOLD' AND created_date >= date('now','-12 months')").n || 1;
  const ratio = sold12.n ? stock / sold12.n : null, normal = allStock / allSold;
  const saturated = !!(sold12.n && ratio > normal * 1.5);
  const factor = saturated ? 0.45 : 0.6;
  const rec = base != null ? Math.round((base * yf * factor) / 50) * 50 : null;
  const confidence = list.length >= 5 && basis === 'tačan model' ? 'high' : list.length >= 3 ? 'medium' : 'low';
  return {
    model: model_id ? modelLabelById(model_id) : get('SELECT name FROM car_make WHERE id=?', makeId)?.name, basis, n: list.length, confidence,
    earned: { m3, m6, m12, total_median: median(totals), total_avg: list.length ? Math.round(totals.reduce((s, x) => s + x, 0) / list.length) : null },
    paid: { median: median(paid), min: paid.length ? Math.min(...paid) : null, max: paid.length ? Math.max(...paid) : null },
    payback: { median_days: median(paybacks), paid_off: paybacks.length },
    year_factor: yf, factor, saturated, stock_ratio: ratio && Math.round(ratio * 10) / 10, normal_ratio: Math.round(normal * 10) / 10, recommended_max: rec,
    sold12, stock, demand,
    vehicles: list.sort((a, b) => b.created_date.localeCompare(a.created_date)).slice(0, 20).map(v => ({ id: v.id, internal_code: v.internal_code, title: modelLabelById(v.model_id), model_year: v.model_year,
      created_date: v.created_date, price: v.price, back: v.back, m12: days(v.created_date, now) >= 365 ? within(v, 365) : null, payback_days: v.payback_days })),
  };
});
