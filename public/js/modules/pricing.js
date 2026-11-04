import { h, clear, route, GET, POST, qs, go, can, lookups, models, img, fmtMoney, fmtDT, fmtDate, field, select, combo, input, modal, confirmBox, toast, run, badge, pager, loading, empty, setQuery, refresh } from '../lib.js';
import { makeItems, modelItems, typeItems } from './parts.js';

export const LEVEL = { high: ['Pouzdan', 'green'], medium: ['Srednje', 'orange'], low: ['Okvirno', 'gray'] };
export const levelBadge = l => badge(...(LEVEL[l] || ['—', 'gray']));

// Modal sa prijedlogom i prodajama na osnovu kojih je izračunat; vraća izabranu cijenu ili null
export async function suggestionDialog(partId, current) {
  const s = await GET('/api/pricing/part/' + partId);
  if (!s.price) { toast('Nema dovoljno prodaja za prijedlog', 'err'); return null; }
  const pr = input('price', s.price, { type: 'number', step: '0.01', inputmode: 'decimal' });
  return modal('💡 Prijedlog cijene', [
    h('div.row', h('b', { style: { fontSize: '28px', color: 'var(--g2)' } }, fmtMoney(s.price)), levelBadge(s.level)),
    h('p.muted', `Na osnovu ${s.n} prodaja (${s.basis}). Raspon: ${fmtMoney(s.min)} – ${fmtMoney(s.max)}.${current ? ' Trenutna cijena: ' + fmtMoney(current) + '.' : ''}`),
    field('Cijena koju upisujem', pr),
    h('details', h('summary', 'Prodaje na osnovu kojih je izračunato'), h('table.tbl', h('tbody', s.samples.map(x => h('tr', h('td', h('a', { href: '#/dijelovi/' + x.part_id, target: '_blank' }, x.code)), h('td', x.title), h('td.n', fmtMoney(x.price)), h('td.muted', fmtDate(x.date))))))),
  ], [{ label: 'Odustani' }, { label: 'Upiši cijenu', primary: true, onClick: async () => { await POST('/api/pricing/apply', { items: [{ id: partId, price: pr.value }], source: 'prijedlog-ručno' }); toast('Cijena upisana'); return Number(pr.value); } }]);
}

route('/cijene', async (params, query, main) => {
  const L = await lookups();
  const q = { min_level: 'high', offset: 0, ...query }; q.offset = Number(q.offset) || 0;
  const LIMIT = 50;
  const overrides = {}; const skip = new Set();
  const res = h('div'); const info = h('div'); const batchesBox = h('div');
  let last = null;
  const load = async () => {
    setQuery(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'offset' && !v))));
    clear(res, loading());
    const d = await GET('/api/pricing/suggestions?' + qs({ ...q, limit: LIMIT }));
    last = d;
    const c = d.counts;
    clear(info, h('div.stats',
      h('div.stat', h('b', c.high.toLocaleString('bs-BA')), h('span', 'Pouzdanih prijedloga (isti kat. broj ili isti model, više prodaja)')),
      h('div.stat', h('b', c.medium.toLocaleString('bs-BA')), h('span', 'Srednje pouzdanih')),
      h('div.stat', h('b', c.low.toLocaleString('bs-BA')), h('span', 'Okvirnih (samo marka/vrsta)')),
      h('div.stat', h('b', c.none.toLocaleString('bs-BA')), h('span', 'Bez podataka'))));
    clear(res,
      h('div.card', h('div.row', h('b.grow', `Prikazano: ${d.total.toLocaleString('bs-BA')} dijelova bez cijene`),
        h('button', { disabled: !d.rows.length, onclick: () => applyPage(d.rows) }, `✔ Odobri ovu stranicu (${d.rows.filter(r => !skip.has(r.id)).length})`),
        h('button.primary', { disabled: !d.total, onclick: () => applyAll(d.total) }, `✔✔ Odobri SVE po filteru (${d.total.toLocaleString('bs-BA')})`))),
      h('div.card.p0', h('div.list', d.rows.length ? d.rows.map(row) : empty('Nema dijelova bez cijene za ovaj filter'))),
      pager(d.total, q.offset, LIMIT, o => { q.offset = o; load(); window.scrollTo(0, 0); }));
  };
  const row = r => {
    const s = r.suggestion;
    const pr = input('p', overrides[r.id] ?? s.price, { type: 'number', inputmode: 'decimal', style: { width: '90px', textAlign: 'right', fontWeight: '700' } });
    pr.onchange = () => { overrides[r.id] = Number(pr.value); };
    const cb = h('input', { type: 'checkbox', checked: !skip.has(r.id), onchange: e => { e.target.checked ? skip.delete(r.id) : skip.add(r.id); } });
    return h('div.item', { style: { cursor: 'default' } }, cb,
      h('img.th', { src: img(r.image_id), loading: 'lazy' }),
      h('div.bd', h('a.t', { href: '#/dijelovi/' + r.id, style: { color: 'var(--tx)', display: 'block' } }, r.title),
        h('div.s', h('span.code', r.internal_code), r.catalog_number ? h('span', r.catalog_number) : null, levelBadge(s.level), h('span', `${s.n} prod. · ${s.basis}`), h('span', `${s.min}–${s.max} KM`))),
      h('div.rt', h('div.row', { style: { flexWrap: 'nowrap', gap: '4px' } }, pr, h('span.muted', 'KM'))));
  };
  const applyPage = async rows => {
    const items = rows.filter(r => !skip.has(r.id)).map(r => ({ id: r.id, price: overrides[r.id] ?? r.suggestion.price }));
    if (!items.length) return;
    const r = await run(() => POST('/api/pricing/apply', { items }));
    toast(`Upisano ${r.count} cijena`); loadBatches(); load();
  };
  const applyAll = async total => {
    if (!(await confirmBox(`Upisati prijedloge cijena za ${total.toLocaleString('bs-BA')} dijelova po trenutnom filteru? (može se poništiti)`, 'Upiši sve', false))) return;
    const r = await run(() => POST('/api/pricing/apply-filter', { filter: { ...q, offset: undefined }, overrides, skip: [...skip] }));
    toast(`Upisano ${r.count} cijena`); loadBatches(); load();
  };
  const loadBatches = async () => {
    const b = await GET('/api/pricing/batches');
    const undo = async x => {
      if (!(await confirmBox(`Vratiti ${x.n} cijena na prethodno stanje?`))) return;
      const r = await run(() => POST(`/api/pricing/batches/${x.batch_id}/undo`));
      toast(`Vraćeno ${r.restored} od ${r.total}`); loadBatches(); load();
    };
    const tr = x => h('tr', h('td', fmtDT(x.date)), h('td', x.n + ' dij.'), h('td.n', fmtMoney(x.total)), h('td.muted', x.user_name),
      h('td', x.undone ? badge('poništeno', 'gray') : h('button.sm.danger', { onclick: () => undo(x) }, '↶ Poništi')));
    clear(batchesBox, b.length ? h('div.card', h('h2', 'Zadnja odobravanja'), h('table.tbl', h('tbody', b.map(tr)))) : null);
  };
  const set = (k, v) => { q[k] = v; q.offset = 0; load(); };
  const lvl = select('min_level', q.min_level, { high: 'Samo pouzdani', medium: 'Pouzdani + srednji', low: 'Svi (i okvirni)' }, { empty: false }); lvl.onchange = () => set('min_level', lvl.value);
  const grp = select('group_id', q.group_id, L.groups.filter(g => g.active).map(g => ({ value: g.id, label: g.title })), { placeholder: 'Sve grupe' }); grp.onchange = () => set('group_id', grp.value);
  const mk = combo('make_id', q.make_id, makeItems(L), { placeholder: 'Sve marke' }); mk.addEventListener('change', () => set('make_id', mk.value));
  const tp = combo('type_id', q.type_id, typeItems(L), { placeholder: 'Sve vrste' }); tp.addEventListener('change', () => set('type_id', tp.value));
  const imgs = select('with_images', q.with_images, { 1: 'Samo sa slikama' }, { placeholder: 'Sa i bez slika' }); imgs.onchange = () => set('with_images', imgs.value);
  clear(main, h('div',
    h('div.head', h('h1', '💡 Prijedlozi cijena')),
    h('div.card', h('p.muted', { style: { marginTop: 0 } }, 'Prijedlozi se računaju iz vaših stvarnih prodaja (srednja cijena zadnjih prodaja istog dijela). Provjereno na prodajama iz 2026: prijedlog obično odstupa od stvarne prodajne cijene ~16% kad postoji isti kataloški broj, ~20% za isti model, ~33% kad postoji samo marka. Ništa se ne upisuje dok ne odobrite, a svako odobravanje se može poništiti.'),
      h('div.filters', lvl, grp, mk, tp, imgs)),
    info, res, batchesBox));
  load(); loadBatches();
});
