import { h, clear, route, GET, qs, go, fmtMoney, fmtNum, fmtDate, input, select, field, loading, today, setQuery, tabs, badge, empty, lookups } from '../lib.js';

function barChart(series, key, color, fmt = fmtNum) {
  if (!series.length) return h('div.empty', 'Nema podataka');
  const W = Math.max(series.length * 28, 320), H = 180, max = Math.max(...series.map(s => s[key] || 0), 1);
  const bw = W / series.length;
  let svg = `<svg width="${W}" height="${H + 34}" xmlns="http://www.w3.org/2000/svg" font-size="10" font-family="system-ui">`;
  for (let i = 0; i <= 4; i++) { const y = H - (H * i) / 4 + 4; svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#eef0f2"/>`; }
  series.forEach((s, i) => {
    const v = s[key] || 0, bh = (v / max) * (H - 14);
    svg += `<rect x="${i * bw + 3}" y="${H - bh + 4}" width="${bw - 6}" height="${bh}" rx="3" fill="${color}"><title>${s.d}: ${fmt(v)}</title></rect>`;
    if (series.length <= 40) svg += `<text x="${i * bw + bw / 2}" y="${H + 18}" text-anchor="middle" fill="#6b7280">${s.d.length > 7 ? s.d.slice(8, 10) + '.' + s.d.slice(5, 7) : s.d.slice(5, 7) + '/' + s.d.slice(2, 4)}</text>`;
  });
  svg += `<text x="2" y="12" fill="#6b7280">max ${fmt(max)}</text></svg>`;
  return h('div.chart', { html: svg });
}
const bars = (rows, valKey, fmt = fmtNum) => {
  const max = Math.max(...rows.map(r => r[valKey] || 0), 1);
  return rows.map(r => h('div.bar-row', h('span', r.title), h('b', fmt(r[valKey])), h('div.bar', h('i', { style: { width: (100 * (r[valKey] || 0)) / max + '%' } }))));
};


const st = (v, l, extra) => h('div.stat', h('b', v), h('span', l), extra || null);
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
const delta = (a, b, label) => {
  const p = pct(a, b);
  if (p === null) return h('div.muted', label + ': —');
  return h('div', { style: { fontSize: '12px', marginTop: '3px', color: p >= 0 ? 'var(--ok)' : 'var(--red)', fontWeight: 600 } }, (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% ', h('span.muted', label));
};
function table(cols, rows, onRow) {
  const head = h('thead', h('tr', cols.map(c => h('th' + (c.n ? '.n' : ''), c.l))));
  const tr = r => h('tr' + (onRow ? '.click' : ''), onRow ? { onclick: () => onRow(r) } : {}, cols.map(c => h('td' + (c.n ? '.n' : ''), c.f ? c.f(r) : r[c.k] ?? '')));
  const body = h('tbody', rows.length ? rows.map(tr) : h('tr', h('td', { colspan: cols.length }, empty())));
  return h('div.scroll-x', h('table.tbl', head, body));
}
const card = (title, ...kids) => h('div.card', h('h2', title), ...kids);
const DOW = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub'];

function heatmap(heat) {
  const hours = []; for (let i = 7; i <= 19; i++) hours.push(i);
  const max = Math.max(1, ...heat.map(x => x.n));
  const get = (d, hr) => heat.find(x => x.dow === d && x.hr === hr)?.n || 0;
  const days = [1, 2, 3, 4, 5, 6, 0];
  const tot = d => heat.filter(x => x.dow === d).reduce((s, x) => s + x.n, 0);
  return h('div.scroll-x', h('table.tbl', { style: { width: 'auto' } },
    h('thead', h('tr', h('th', ''), hours.map(x => h('th', { style: { textAlign: 'center', padding: '4px' } }, x + 'h')), h('th.n', 'Ukupno'))),
    h('tbody', days.map(d => h('tr', h('td', h('b', DOW[d])), hours.map(hr => {
      const n = get(d, hr); const a = n / max;
      return h('td', { title: `${DOW[d]} ${hr}h: ${n} prodaja`, style: { textAlign: 'center', padding: '4px', minWidth: '34px', background: n ? `rgba(240,140,0,${0.12 + a * 0.88})` : '#f6f8fb', color: a > 0.55 ? '#fff' : 'var(--tx)', fontWeight: 600, fontSize: '12px' } }, n || '');
    }), h('td.n', h('b', tot(d))))))));
}

async function tabPregled(q, box) {
  const [d, o] = await Promise.all([GET('/api/analytics?' + qs(q)), GET('/api/analytics/overview?' + qs(q))]);
  const s = d.summary, c = o.cur;
  clear(box,
    h('div.stats',
      st(fmtMoney(c.revenue), 'Promet', [delta(c.revenue, o.prev.revenue, 'vs. prethodni period'), delta(c.revenue, o.yoy.revenue, 'vs. prošla godina')]),
      st(fmtNum(c.sold), 'Prodatih dijelova', [delta(c.sold, o.prev.sold, 'vs. prethodni'), delta(c.sold, o.yoy.sold, 'vs. prošla god.')]),
      st(fmtMoney(Math.round(c.avg_price || 0)), 'Prosječna prodaja', [delta(c.avg_price, o.prev.avg_price, 'vs. prethodni'), delta(c.avg_price, o.yoy.avg_price, 'vs. prošla god.')]),
      st(fmtNum(c.added), 'Unesenih dijelova', [delta(c.added, o.prev.added, 'vs. prethodni'), delta(c.added, o.yoy.added, 'vs. prošla god.')]),
      st(fmtNum(c.returned), 'Povrata', h('div.muted', c.sold ? `${Math.round((c.returned / c.sold) * 100)}% od prodaja` : '')),
      st(o.discount.n ? Math.round((1 - o.discount.r) * 100) + '%' : '—', 'Prosječan popust', h('div.muted', `prodajna vs. upisana cijena (${o.discount.n} prod.)`)),
      st(fmtNum(s.photos), 'Slika'), st(fmtNum(s.vehicles_added), 'Novih vozila'), st(fmtNum(s.req_created), 'Naloga'),
      st(s.req_avg_min ? Math.round(s.req_avg_min) + ' min' : '—', 'Prosj. trajanje naloga'),
      o.zero_price_sales ? st(fmtNum(o.zero_price_sales), 'Prodaja za 0 KM', h('div.muted', 'u kompletu / bez cijene')) : null),
    h('p.muted', `Prethodni period: ${fmtDate(o.prev.from)} – ${fmtDate(o.prev.to)} · Prošla godina: ${fmtDate(o.yoy.from)} – ${fmtDate(o.yoy.to)}`),
    h('div.grid2',
      card('Promet', barChart(d.series, 'revenue', '#0b2a4a', v => fmtMoney(v))),
      card('Uneseno (plavo) / prodato (narandžasto)', barChart(d.series, 'added', '#1d5fa8'), barChart(d.series, 'sold', '#f08c00'))),
    card('Kad se prodaje — dan u sedmici × sat', heatmap(o.heat), h('p.muted', 'Tamnije = više prodaja. Korisno za raspored radnika i pauza.')),
    h('div.grid2',
      card('Prodaja po cjenovnom razredu', bars(o.priceBands.map(b => ({ ...b, title: b.title + ' KM' })), 'n'), h('p.muted', 'broj prodaja po razredu')),
      card('Promet po cjenovnom razredu', bars(o.priceBands.map(b => ({ ...b, title: b.title + ' KM' })), 'revenue', fmtMoney))),
    h('div.grid2',
      card('Najprodavanije vrste', bars(d.top_types, 'n')),
      card('Prodaja po markama', bars(d.top_makes, 'n'))),
    card('Najisplativija vozila u periodu', d.top_vehicles.length ? d.top_vehicles.map(v => h('div.bar-row', { style: { cursor: 'pointer' }, onclick: () => go('/vozila/' + v.id) }, h('span', v.internal_code + ' · ' + v.title + ' ' + v.model_year), h('b', fmtMoney(v.revenue)), h('div.muted', { style: { gridColumn: '1/-1' } }, v.n + ' dijelova'))) : empty()));
}

async function tabZaliha(q, box) {
  const d = await GET('/api/analytics/stock');
  const tot = d.buckets.reduce((s, b) => s + b.n, 0);
  const old = d.buckets.filter(b => b.b >= 5).reduce((s, b) => s + b.n, 0);
  clear(box,
    h('div.stats', st(fmtNum(tot), 'Dijelova na stanju'), st(Math.round((old / (tot || 1)) * 100) + '%', 'Stariji od 2 godine', h('div.muted', fmtNum(old) + ' dijelova')),
      st(fmtNum(d.no_loc), 'Bez lokacije'), st(fmtNum(d.empty_locations), 'Praznih polica/kutija')),
    h('div.grid2',
      card('Starost robe na stanju', table([{ l: 'Starost', k: 'title' }, { l: 'Dijelova', n: 1, f: r => fmtNum(r.n) }, { l: '%', n: 1, f: r => Math.round((r.n / (tot || 1)) * 100) + '%' }, { l: 'Sa cijenom', n: 1, f: r => fmtNum(r.priced) }, { l: 'Vrijednost', n: 1, f: r => fmtMoney(r.value) }], d.buckets)),
      card('Koliko se prodalo od unesenog (po godini unosa)', table([{ l: 'Godina', k: 'y' }, { l: 'Uneseno', n: 1, f: r => fmtNum(r.n) }, { l: 'Prodato', n: 1, f: r => fmtNum(r.sold) },
        { l: '% prodato', n: 1, f: r => h('b', Math.round((r.sold / (r.n || 1)) * 100) + '%') }], d.cohorts))),
    card('Grupe — zaliha i starost', table([{ l: 'Grupa', k: 'title' }, { l: 'Dijelova', n: 1, f: r => fmtNum(r.n) }, { l: 'Prosj. starost', n: 1, f: r => Math.round(r.avg_days / 30) + ' mj.' },
      { l: 'Starijih od 2 god.', n: 1, f: r => fmtNum(r.old) + ' (' + Math.round((r.old / (r.n || 1)) * 100) + '%)' }, { l: 'Vrijednost', n: 1, f: r => fmtMoney(r.value) }], d.groups)),
    h('div.grid2',
      card('Magacini', bars(d.warehouses.map(w => ({ ...w })), 'n')),
      card('Najstariji skuplji dijelovi (100 KM+) — kandidati za akciju', table([{ l: 'Šifra', f: r => h('span.code', r.internal_code) }, { l: 'Naziv', k: 'title' }, { l: 'Unesen', f: r => fmtDate(r.created_date) }, { l: 'Lok.', k: 'location_code' }, { l: 'Cijena', n: 1, f: r => fmtMoney(r.price) }], d.oldest_valuable, r => go('/dijelovi/' + r.id)))));
}

async function tabPotraznja(q, box) {
  const L = await lookups();
  const months = q.months || 12;
  const d = await GET('/api/analytics/demand?' + qs({ months, make_id: q.make_id }));
  const stockCell = r => (r.stock === 0 ? badge('NEMA', 'red') : fmtNum(r.stock));
  const cols = [
    { l: 'Dio', f: r => h('span', h('b', r.type), h('div.muted', r.grp)) },
    { l: 'Vozilo (tačan model i godišta)', f: r => h('a', { href: '#', onclick: e => { e.preventDefault(); e.stopPropagation(); openModel(r.model_id); } }, r.model) },
    { l: 'Prodato', n: 1, f: r => h('b', fmtNum(r.sold)) }, { l: 'Prosj. cijena', n: 1, f: r => (r.avg_price ? fmtMoney(r.avg_price) : '—') },
    { l: 'Promet', n: 1, f: r => fmtMoney(r.revenue) }, { l: 'Na stanju', n: 1, f: stockCell },
    { l: 'Prodaje se za', n: 1, f: r => (r.days_to_sell != null ? r.days_to_sell + ' d' : '—') }, { l: 'Zadnja prodaja', f: r => fmtDate(r.last_sold) }];
  const openParts = r => go('/dijelovi?' + qs({ type_id: r.type_id, model_id: r.model_id, status: 'ALL' }));
  const drill = h('div');
  const openModel = async id => {
    q.model = id; setQuery(q);
    clear(drill, loading()); drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const m = await GET('/api/analytics/demand/model/' + id + '?' + qs({ months }));
    clear(drill, h('div.card', { style: { borderLeft: '5px solid var(--or)' } },
      h('div.row', h('h2.grow', { style: { margin: 0 } }, '🚗 ' + m.model), h('button.sm', { onclick: () => { q.model = ''; setQuery(q); clear(drill); } }, '✕ Zatvori')),
      h('div.stats', { style: { marginTop: '10px' } }, st(fmtNum(m.totals.sold), `Prodatih dijelova (${months} mj.)`), st(fmtMoney(m.totals.revenue), 'Promet'), st(fmtNum(m.totals.stock), 'Dijelova na stanju'),
        st(fmtNum(m.donors.length), 'Donora ovog modela', m.donors[0] ? h('div.muted', 'zadnji ' + fmtDate(m.donors[0].created_date)) : null)),
      h('p.muted', 'Koji dijelovi se za ovaj model traže. Crveno NEMA = prodaje se, a trenutno nema na stanju.'),
      table([{ l: 'Dio', f: r => h('span', h('b', r.type), h('div.muted', r.grp)) }, { l: `Prodato (${months} mj.)`, n: 1, f: r => h('b', fmtNum(r.sold)) }, { l: 'Prodato ukupno', n: 1, f: r => fmtNum(r.sold_all) },
        { l: 'Promet', n: 1, f: r => fmtMoney(r.revenue) }, { l: 'Na stanju', n: 1, f: r => (r.stock === 0 && r.sold_all ? badge('NEMA', 'red') : fmtNum(r.stock)) }],
        m.rows, r => go('/dijelovi?' + qs({ type_id: r.type_id, model_id: id, status: 'ALL' }))),
      m.donors.length ? h('div', { style: { marginTop: '8px' } }, h('span.muted', 'Donori: '), h('span.chips', m.donors.map(v => h('a.chip', { href: '#/vozila/' + v.id }, v.internal_code + ' · ' + v.model_year)))) : null));
  };
  const mk = select('make_id', q.make_id, L.makes.filter(m => m.active).map(m => ({ value: m.id, label: m.name })), { placeholder: 'Sve marke' });
  mk.onchange = () => { q.make_id = mk.value; q.model = ''; tabPotraznja(q, box); };
  mk.style.maxWidth = '260px';
  clear(box,
    h('div.card', h('div.row', h('b', 'Marka:'), mk, h('span.muted', 'Sve je po tačnom modelu (generacija i godišta), npr. „Mercedes ML W164 (05-08)”. Klik na red otvara dijelove, klik na model otvara pregled modela.'))),
    drill,
    card('🚗 Najtraženija vozila — za koje modele se najviše prodaje dijelova',
      table([{ l: 'Vozilo (tačan model)', f: r => h('b', r.model) }, { l: 'Prodatih dijelova', n: 1, f: r => h('b', fmtNum(r.sold)) }, { l: 'Promet', n: 1, f: r => fmtMoney(r.revenue) },
        { l: 'Vrsta dijelova traženo', n: 1, k: 'types' }, { l: 'Od toga fali', n: 1, f: r => (r.missing ? badge(r.missing + ' vrsta', 'orange') : '0') }, { l: 'Na stanju', n: 1, f: r => fmtNum(r.stock) },
        { l: 'Donora imali', n: 1, f: r => r.donors + (r.last_donor ? ' (zadnji ' + fmtDate(r.last_donor).slice(3) + ')' : '') }], d.models, r => openModel(r.model_id)),
      h('p.muted', '„Od toga fali” = broj vrsta dijelova koje se za taj model prodaju, a zaliha ne pokriva ni godinu dana. Visok promet + puno vrsta koje fale + nema skorijeg donora = dobro vozilo za otkup.')),
    card('🔥 Ovo nabavljati — dio za tačan model koji se prodaje, a nema ga (ili ga je malo)', h('p.muted', `Bar 2 prodaje u zadnjih ${months} mj., a zaliha manja od godinu dana prodaje. Prvo su oni kojih uopšte nema.`), table(cols, d.shortage, openParts)),
    card('⚡ Najbrže se prodaju (od unosa do prodaje)', table(cols, d.fastest, openParts)),
    card('🐢 Previše na stanju za taj model', h('p.muted', 'Bar 8 komada za isti model, a prodaja ne bi potrošila ni za 5 godina.'),
      table([{ l: 'Dio', f: r => h('span', h('b', r.type), h('div.muted', r.grp)) }, { l: 'Vozilo', k: 'model' }, { l: 'Na stanju', n: 1, f: r => fmtNum(r.stock) }, { l: 'Prodato', n: 1, k: 'sold' },
        { l: 'Zalihe za', n: 1, f: r => (r.months_of_stock == null ? 'ne prodaje se' : Math.round(r.months_of_stock / 12) + ' god.') }], d.overstock, openParts)));
  if (q.model) openModel(q.model);
}

async function tabVozila(q, box) {
  const d = await GET('/api/analytics/vehicles');
  const open = r => go('/vozila/' + r.id);
  clear(box,
    h('div.stats', st(fmtNum(d.total.vehicles), 'Vozila-donora'), st(fmtMoney(d.total.earned), 'Zarađeno od dijelova (ukupno)'), st(fmtMoney(d.total.avg), 'Prosječno po vozilu')),
    card('Koji modeli se najviše isplate (prosjek po vozilu, min. 2 vozila)', h('p.muted', 'Korisno pri kupovini havarisanih vozila: koliko u prosjeku donese jedno vozilo tog modela, i koliko u prva 3 mjeseca.'),
      table([{ l: 'Model', k: 'title' }, { l: 'Vozila', n: 1, k: 'vehicles' }, { l: 'Prosj. po vozilu', n: 1, f: r => h('b', fmtMoney(r.avg)) }, { l: 'Prva 3 mj.', n: 1, f: r => fmtMoney(r.avg_90) }, { l: 'Prodatih dijelova', n: 1, f: r => fmtNum(r.sold) }], d.models)),
    h('div.grid2',
      card('Najisplativija vozila (ukupno)', table([{ l: 'Vozilo', f: r => r.internal_code + ' · ' + r.title + ' ' + r.model_year }, { l: 'Zarađeno', n: 1, f: r => fmtMoney(r.earned) }, { l: 'Mjesečno', n: 1, f: r => (r.per_month ? fmtMoney(r.per_month) : '—') }], d.top, open)),
      card('Vozila iz zadnjih 12 mjeseci — kako idu', table([{ l: 'Vozilo', f: r => r.internal_code + ' · ' + r.title + ' ' + r.model_year }, { l: 'Dana', n: 1, k: 'days' }, { l: 'Prodato', n: 1, f: r => r.sold + '/' + r.parts }, { l: 'Zarađeno', n: 1, f: r => fmtMoney(r.earned) }, { l: 'Još na stanju', n: 1, f: r => fmtMoney(r.stock_value) }], d.recent, open))));
}

async function tabRadnici(q, box) {
  const [d, w] = await Promise.all([GET('/api/analytics?' + qs(q)), GET('/api/analytics/workers?' + qs(q))]);
  clear(box,
    card('Učinak po radnicima', table([{ l: 'Radnik', k: 'name' }, { l: 'Unio', n: 1, f: r => fmtNum(r.added) }, { l: 'Slika', n: 1, f: r => fmtNum(r.photos) }, { l: 'Premještanja', n: 1, f: r => fmtNum(r.moved) },
      { l: 'Prodao', n: 1, f: r => fmtNum(r.sold) }, { l: 'Promet', n: 1, f: r => fmtMoney(r.revenue) }, { l: 'Naloga kreirao', n: 1, f: r => fmtNum(r.req_created) }, { l: 'Naloga realizovao', n: 1, f: r => fmtNum(r.req_done) }], d.users)),
    h('div.grid2',
      card('Unos dijelova po danu', table([{ l: 'Radnik', k: 'name' }, { l: 'Radnih dana', n: 1, k: 'days' }, { l: 'Prosjek/dan', n: 1, f: r => h('b', r.avg) }, { l: 'Najbolji dan', n: 1, k: 'best' }, { l: 'Ukupno', n: 1, k: 'total' }], w.entry)),
      card('Magacin — brzina naloga', table([{ l: 'Magacioner', f: r => r.name || '—' }, { l: 'Naloga', n: 1, k: 'n' }, { l: 'Hitnih', n: 1, k: 'urgent' }, { l: 'Do preuzimanja', n: 1, f: r => (r.to_take_min ?? '—') + ' min' }, { l: 'Do zatvaranja', n: 1, f: r => (r.to_close_min ?? '—') + ' min' }], w.req))),
    card('Kvalitet unosa (šta fali na unesenim dijelovima)', table([{ l: 'Radnik', f: r => r.name || '—' }, { l: 'Uneseno', n: 1, k: 'n' },
      { l: 'Bez kat. broja', n: 1, f: r => r.no_cat + ' (' + Math.round((r.no_cat / (r.n || 1)) * 100) + '%)' }, { l: 'Bez slike', n: 1, f: r => r.no_img + ' (' + Math.round((r.no_img / (r.n || 1)) * 100) + '%)' },
      { l: 'Bez cijene', n: 1, f: r => r.no_price + ' (' + Math.round((r.no_price / (r.n || 1)) * 100) + '%)' }], w.quality)));
}

route('/analitika', async (params, query, main) => {
  const t = today();
  const q = { tab: query.tab || 'pregled', from: query.from || t.slice(0, 8) + '01', to: query.to || t, group: query.group || 'day', months: query.months || '12', make_id: query.make_id || '', model: query.model || '' };
  const body = h('div'); const tabBox = h('div'); const filt = h('div');
  const TABS = [['pregled', '📈 Pregled'], ['zaliha', '📦 Zaliha'], ['potraznja', '🎯 Šta nabaviti'], ['vozila', '🚗 Vozila'], ['radnici', '👷 Radnici']];
  const F = { pregled: tabPregled, zaliha: tabZaliha, potraznja: tabPotraznja, vozila: tabVozila, radnici: tabRadnici };
  const load = async () => {
    setQuery(q);
    clear(tabBox, tabs(TABS, q.tab, k => { q.tab = k; load(); }));
    filt.style.display = ['pregled', 'radnici', 'potraznja'].includes(q.tab) ? '' : 'none';
    per.style.display = q.tab === 'potraznja' ? 'none' : ''; mon.style.display = q.tab === 'potraznja' ? '' : 'none';
    clear(body, loading());
    try { await F[q.tab](q, body); } catch (e) { clear(body, h('div.card', e.message)); }
  };
  const f = input('from', q.from, { type: 'date' }), tt = input('to', q.to, { type: 'date' });
  const g = select('group', q.group, { day: 'Po danima', month: 'Po mjesecima' }, { empty: false });
  f.onchange = () => { q.from = f.value; load(); }; tt.onchange = () => { q.to = tt.value; load(); }; g.onchange = () => { q.group = g.value; load(); };
  const preset = (l, from, to, grp = 'day') => h('button.chip', { onclick: () => { q.from = from; q.to = to; q.group = grp; f.value = from; tt.value = to; g.value = grp; load(); } }, l);
  const y = t.slice(0, 4);
  const d7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const d90 = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);
  const per = h('div', h('div.filters', { style: { marginTop: 0 } }, field('Od', f), field('Do', tt), field('Grupisanje', g)),
    h('div.chips', { style: { marginTop: '8px' } }, preset('Danas', t, t), preset('7 dana', d7, t), preset('Ovaj mjesec', t.slice(0, 8) + '01', t), preset('90 dana', d90, t), preset('Ova godina', y + '-01-01', t, 'month'), preset('Prošla godina', (y - 1) + '-01-01', (y - 1) + '-12-31', 'month'), preset('Sve', '2020-01-01', t, 'month')));
  const ms = select('months', q.months, { 3: 'Zadnja 3 mjeseca', 6: 'Zadnjih 6 mjeseci', 12: 'Zadnjih 12 mjeseci', 24: 'Zadnje 2 godine' }, { empty: false });
  ms.onchange = () => { q.months = ms.value; load(); };
  const mon = h('div', field('Period prodaje za računanje potražnje', ms));
  clear(filt, h('div.card', per, mon));
  clear(main, h('div', h('div.head', h('h1', 'Analitika')), tabBox, filt, body));
  load();
});
