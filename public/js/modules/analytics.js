import { h, clear, route, GET, qs, go, fmtMoney, fmtNum, input, select, field, loading, today, setQuery } from '../lib.js';

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

route('/analitika', async (params, query, main) => {
  const t = today();
  const q = { from: query.from || t.slice(0, 8) + '01', to: query.to || t, group: query.group || 'day' };
  const body = h('div');
  const load = async () => {
    setQuery(q);
    clear(body, loading());
    const d = await GET('/api/analytics?' + qs(q));
    const s = d.summary;
    const st = (v, l) => h('div.stat', h('b', v), h('span', l));
    clear(body,
      h('div.stats', st(fmtMoney(s.revenue), 'Promet (prodaja − povrati)'), st(fmtNum(s.sold), 'Prodatih dijelova'), st(fmtNum(s.returned), 'Povrata'), st(fmtNum(s.added), 'Unesenih dijelova'),
        st(fmtNum(s.photos), 'Slika'), st(fmtNum(s.vehicles_added), 'Novih vozila'), st(fmtNum(s.req_created), 'Naloga'), st(s.req_avg_min ? Math.round(s.req_avg_min) + ' min' : '—', 'Prosj. trajanje naloga')),
      h('div.grid2',
        h('div.card', h('h2', 'Promet'), barChart(d.series, 'revenue', '#0b2a4a', v => fmtMoney(v))),
        h('div.card', h('h2', 'Uneseno / prodato'), barChart(d.series, 'added', '#1d5fa8'), barChart(d.series, 'sold', '#f08c00'))),
      h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', 'Po radnicima')), h('div.scroll-x', h('table.tbl',
        h('thead', h('tr', h('th', 'Radnik'), h('th.n', 'Unio dijelova'), h('th.n', 'Slika'), h('th.n', 'Premještanja'), h('th.n', 'Prodao'), h('th.n', 'Promet'), h('th.n', 'Naloga kreirao'), h('th.n', 'Naloga realizovao'))),
        h('tbody', d.users.map(u => h('tr', h('td', u.name), h('td.n', fmtNum(u.added)), h('td.n', fmtNum(u.photos)), h('td.n', fmtNum(u.moved)), h('td.n', fmtNum(u.sold)), h('td.n', fmtMoney(u.revenue)), h('td.n', fmtNum(u.req_created)), h('td.n', fmtNum(u.req_done)))))))),
      h('div.grid2',
        h('div.card', h('h2', 'Najprodavanije vrste'), bars(d.top_types, 'n')),
        h('div.card', h('h2', 'Prodaja po markama'), bars(d.top_makes, 'n'))),
      h('div.grid2',
        h('div.card', h('h2', 'Najisplativija vozila (u periodu)'), d.top_vehicles.map(v => h('div.bar-row', { style: { cursor: 'pointer' }, onclick: () => go('/vozila/' + v.id) }, h('span', v.internal_code + ' · ' + v.title + ' ' + v.model_year), h('b', fmtMoney(v.revenue)), h('div.muted', { style: { gridColumn: '1/-1' } }, v.n + ' dijelova')))),
        h('div.card', h('h2', 'Stanje skladišta'), h('div.stats', st(fmtNum(d.stock.n), 'Dijelova na stanju'), st(fmtNum(d.stock.priced), 'Sa cijenom'), st(fmtMoney(d.stock.value), 'Vrijednost (sa cijenom)'), st(fmtNum(d.stock.no_images), 'Bez slika')),
          bars(d.stock_groups, 'n'))));
  };
  const f = input('from', q.from, { type: 'date' }), tt = input('to', q.to, { type: 'date' });
  const g = select('group', q.group, { day: 'Po danima', month: 'Po mjesecima' }, { empty: false });
  f.onchange = () => { q.from = f.value; load(); }; tt.onchange = () => { q.to = tt.value; load(); }; g.onchange = () => { q.group = g.value; load(); };
  const preset = (l, from, to, grp = 'day') => h('button.chip', { onclick: () => { q.from = from; q.to = to; q.group = grp; f.value = from; tt.value = to; g.value = grp; load(); } }, l);
  const y = t.slice(0, 4);
  const d7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  clear(main, h('div', h('div.head', h('h1', 'Analitika')),
    h('div.card', h('div.filters', { style: { marginTop: 0 } }, field('Od', f), field('Do', tt), field('Grupisanje', g)),
      h('div.chips', { style: { marginTop: '8px' } }, preset('Danas', t, t), preset('7 dana', d7, t), preset('Ovaj mjesec', t.slice(0, 8) + '01', t), preset('Ova godina', y + '-01-01', t, 'month'), preset('Prošla godina', (y - 1) + '-01-01', (y - 1) + '-12-31', 'month'))),
    body));
  load();
});
