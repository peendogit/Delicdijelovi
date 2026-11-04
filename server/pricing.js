// Prijedlog cijene na osnovu STVARNIH prodaja iz baze (spare_part_sale_history).
// Redoslijed: isti kataloški broj → ista vrsta + isti model → ista vrsta + ista marka → ista vrsta.
// Provjera na prodajama iz 2026 (model napravljen samo od ranijih prodaja), srednja greška:
//   kataloški broj ~16%, vrsta+model ~20%, vrsta+marka ~33%, samo vrsta ~37%  → zato su zadnja dva 'low'.
import { all, get } from './db.js';
import { modelLabel } from './util.js';

const normCat = c => (c ? String(c).toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = p => (p >= 30 ? Math.round(p / 5) * 5 : Math.max(5, Math.round(p)));
const MAX_SAMPLES = 15; // uzima se zadnjih N prodaja po ključu (novije cijene su relevantnije)

let cache = null, cacheAt = 0;

function build() {
  // Samo prodaje sa cijenom > 0 koje kasnije NISU vraćene
  const rows = all(`SELECT h.part_id, h.the_price p, h.created_date d, s.type_id, s.model_id, s.make_id, s.catalog_number, s.model_year, s.damaged, s.internal_code, s.title
    FROM spare_part_sale_history h JOIN spare_part s ON s.id=h.part_id
    WHERE h.status='SOLD' AND h.the_price > 0
      AND NOT EXISTS (SELECT 1 FROM spare_part_sale_history r WHERE r.part_id=h.part_id AND r.status='UNSOLD' AND r.created_date > h.created_date)
    ORDER BY h.created_date DESC`);
  const thisYear = new Date().getFullYear();
  const maps = { cat: new Map(), tm: new Map(), tk: new Map(), t: new Map() };
  const add = (m, k, v) => { if (!k) return; let a = m.get(k); if (!a) m.set(k, (a = [])); if (a.length < MAX_SAMPLES) a.push(v); };
  for (const r of rows) {
    // cijene rastu ~5% godišnje — starije prodaje se blago korigiraju na današnje
    const age = Math.max(0, thisYear - Number(String(r.d).slice(0, 4)));
    const v = { p: r.p * Math.min(1.25, 1 + 0.05 * age), raw: r.p, d: r.d, year: r.model_year, damaged: r.damaged, code: r.internal_code, title: r.title, part_id: r.part_id };
    add(maps.cat, normCat(r.catalog_number).length >= 5 ? normCat(r.catalog_number) : '', v);
    add(maps.tm, r.type_id + '|' + r.model_id, v);
    add(maps.tk, r.type_id + '|' + r.make_id, v);
    add(maps.t, r.type_id, v);
  }
  return maps;
}
export function stats() {
  if (!cache || Date.now() - cacheAt > 10 * 60e3) { cache = build(); cacheAt = Date.now(); }
  return cache;
}
export const invalidate = () => { cache = null; };

const LEVELS = { high: 3, medium: 2, low: 1 };
export const levelNum = l => LEVELS[l] || 0;

// part: { type_id, model_id, make_id, catalog_number, model_year, damaged }
export function suggest(part, withSamples = false) {
  const S = stats();
  const tries = [
    ['cat', normCat(part.catalog_number).length >= 5 ? normCat(part.catalog_number) : '', 'isti kataloški broj', n => (n >= 2 ? 'high' : 'medium')],
    ['tm', part.type_id + '|' + part.model_id, 'ista vrsta, isti model', n => (n >= 3 ? 'high' : 'medium')],
    ['tk', part.type_id + '|' + part.make_id, 'ista vrsta, ista marka', () => 'low'],
    ['t', part.type_id, 'ista vrsta (sve marke)', () => 'low'],
  ];
  for (const [k, key, basis, lvl] of tries) {
    const s = key && S[k].get(key);
    if (!s || !s.length) continue;
    let price = median(s.map(x => x.p));
    // godište: na nivou marke/vrste, novije vozilo = skuplji dio (±3% po godini, ograničeno)
    if ((k === 'tk' || k === 't') && part.model_year) {
      const ys = s.map(x => x.year).filter(Boolean);
      if (ys.length >= 3) price *= Math.min(1.4, Math.max(0.6, 1 + 0.03 * (part.model_year - median(ys))));
    }
    if (part.damaged) price *= 0.7;
    const out = { price: round(price), level: lvl(s.length), basis, n: s.length, min: round(Math.min(...s.map(x => x.raw))), max: round(Math.max(...s.map(x => x.raw))) };
    if (withSamples) out.samples = s.map(x => ({ code: x.code, title: x.title, price: x.raw, date: x.d, part_id: x.part_id }));
    return out;
  }
  return null;
}

export function suggestById(id) {
  const p = get('SELECT * FROM spare_part WHERE id=?', id);
  return p ? suggest(p, true) : null;
}
export { modelLabel };
