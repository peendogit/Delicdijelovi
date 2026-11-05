// Pretraga liste kataloških brojeva
import { h, clear, route, POST, go, can, img, E, fmtMoney, fmtDate, textarea, check, toast, run, badge, empty, loading, printLabels } from '../lib.js';
import { reqDialog } from './parts.js';

// Lista može biti u redovima, ili odvojena zarezom/tačka-zarezom/tabom. Razmaci unutar broja se ignorišu.
function parseList(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  let parts = t.split(/\r?\n/);
  if (parts.length === 1) parts = t.split(/[,;\t]+/);
  if (parts.length === 1 && /\s/.test(t)) {
    // jedan red sa razmacima: ako su "riječi" duge, vjerovatno su to odvojeni brojevi
    const w = t.split(/\s+/);
    if (w.every(x => x.replace(/[^A-Za-z0-9]/g, '').length >= 6)) parts = w;
  }
  return parts.map(x => x.replace(/^[\s\d]+[.)]\s+/, '').trim()).filter(Boolean); // skini "1. " numeraciju
}

let last = { text: '', partial: false, data: null };

route('/lista', async (params, query, main) => {
  const ta = textarea('list', last.text, { rows: 8, placeholder: 'Zalijepite kataloške brojeve, svaki u svom redu (ili odvojene zarezom):\n8E0941004P\n3G0 955 103 A\n510941607A' });
  ta.style.fontFamily = 'ui-monospace, Menlo, Consolas, monospace';
  const partial = check('partial', last.partial, 'Djelimično poklapanje (broj iz liste je dio kataloškog broja)');
  const info = h('div.muted');
  const res = h('div');
  const selected = new Set();
  const upd = () => { const n = parseList(ta.value).length; info.textContent = n ? `${n} brojeva u listi` : ''; };
  ta.addEventListener('input', upd); upd();

  const search = async () => {
    const items = parseList(ta.value);
    if (!items.length) return toast('Zalijepite bar jedan broj', 'err');
    last.text = ta.value; last.partial = partial.querySelector('input').checked;
    clear(res, loading());
    last.data = await run(() => POST('/api/parts/bulk-search', { items, partial: last.partial }));
    draw();
  };
  const textReport = onlyFound => last.data.results.filter(r => !onlyFound || r.unsold).map(r => {
    if (!r.unsold) return `${r.input} — nema`;
    const pr = r.min_price ? (r.min_price === r.max_price ? fmtMoney(r.min_price) : `${fmtMoney(r.min_price)}–${fmtMoney(r.max_price)}`) : 'cijena na upit';
    return `${r.input} — ima${r.unsold > 1 ? ' (' + r.unsold + ' kom)' : ''}, ${pr}`;
  }).join('\n');

  const draw = () => {
    const d = last.data; if (!d) return clear(res);
    selected.clear();
    const filt = h('div.chips');
    let mode = 'all';
    const body = h('div');
    const drawBody = () => {
      const list = d.results.filter(r => mode === 'all' || (mode === 'found' ? r.unsold : !r.unsold));
      clear(body, list.length ? h('div.card.p0', h('div.scroll-x', h('table.tbl',
        h('thead', h('tr', h('th', 'Traženo'), h('th', 'Stanje'), h('th', ''), h('th', 'Šifra'), h('th', 'Naziv'), h('th', 'Lokacija'), h('th.n', 'Cijena'))),
        h('tbody', list.flatMap(r => {
          const st = r.unsold ? badge(`✔ Ima ${r.unsold}`, 'green') : r.sold ? badge('Samo prodat', 'orange') : badge('✖ Nema', 'red');
          const extra = r.sold && !r.unsold && r.last_sold ? h('div.muted', 'zadnja prodaja ' + fmtDate(r.last_sold)) : null;
          const rows = r.rows.filter(p => p.status === 'UNSOLD');
          if (!rows.length) return [h('tr', h('td', h('b.code-in', r.input)), h('td', st, extra), h('td', { colspan: 5 }, ''))];
          return rows.map((p, i) => h('tr.click', { onclick: e => { if (!e.target.closest('input')) go('/dijelovi/' + p.id); } },
            i === 0 ? h('td', { rowspan: rows.length, style: { verticalAlign: 'top' } }, h('b', r.input)) : null,
            i === 0 ? h('td', { rowspan: rows.length, style: { verticalAlign: 'top' } }, st) : null,
            h('td', { style: { width: '30px' } }, can('ROLE_REQ_C') ? h('input', { type: 'checkbox', onchange: e => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); } }) : ''),
            h('td', h('span.code', p.internal_code)),
            h('td', h('div.t', p.title), h('div.muted', [p.catalog_number, E.side[p.side]].filter(Boolean).join(' · '))),
            h('td', p.location_code ? h('b', p.location_code) : ''),
            h('td.n', p.price ? h('span.price', fmtMoney(p.price, p.currency_id)) : h('span.muted', '—'))));
        })))))
        : empty('Nema stavki za ovaj prikaz'));
    };
    const chip = (k, l) => h('button.chip' + (mode === k ? '.act' : ''), { onclick: e => { mode = k; [...filt.children].forEach(c => c.classList.toggle('act', c === e.target)); drawBody(); } }, l);
    clear(filt, chip('all', `Sve (${d.total})`), chip('found', `Ima (${d.found})`), chip('missing', `Nema (${d.total - d.found})`));
    drawBody();
    clear(res,
      h('div.stats',
        h('div.stat', h('b', d.total), h('span', 'Traženih brojeva')),
        h('div.stat', { style: { borderLeftColor: 'var(--ok)' } }, h('b', d.found), h('span', 'Ima na stanju')),
        h('div.stat', { style: { borderLeftColor: 'var(--red)' } }, h('b', d.total - d.found), h('span', 'Nema'))),
      h('div.card', h('div.row', filt, h('div.grow'),
        h('button', { onclick: async () => { await navigator.clipboard.writeText(textReport(false)); toast('Kopirano — zalijepite kupcu u Viber/WhatsApp'); } }, '📋 Kopiraj odgovor za kupca'),
        h('button', { onclick: async () => { await navigator.clipboard.writeText(textReport(true)); toast('Kopirano (samo ono što ima)'); } }, '📋 Samo što ima'),
        can('ROLE_REQ_C') ? h('button.primary', { onclick: async () => {
          if (!selected.size) {
            // ako ništa nije štiklirano: po jedan (najnoviji) od svakog pronađenog broja
            for (const r of d.results) { const p = r.rows.find(x => x.status === 'UNSOLD'); if (p) selected.add(p.id); }
          }
          if (!selected.size) return toast('Ništa nije pronađeno', 'err');
          if (await reqDialog([...selected])) toast('Nalog poslat magacinu');
        } }, '📋 Nalog za pronađene') : null,
        h('button', { onclick: () => {
          const ps = d.results.flatMap(r => r.rows.filter(p => p.status === 'UNSOLD' && (!selected.size || selected.has(p.id))));
          if (ps.length) printLabels(ps.map(p => ({ code: p.internal_code, title: p.title, sub: [p.catalog_number, p.location_code].filter(Boolean).join(' · ') })));
        } }, '🏷 Etikete'))),
      h('p.muted', 'Nalog: ako ništa nije štiklirano, šalje se po jedan komad od svakog pronađenog broja.'),
      body);
  };

  clear(main, h('div',
    h('div.head', h('h1', 'Pretraga liste kataloških brojeva')),
    h('div.card', ta, h('div.row', { style: { marginTop: '8px' } }, info, h('div.grow'), partial,
      h('button', { onclick: () => { ta.value = ''; last = { text: '', partial: false, data: null }; upd(); clear(res); ta.focus(); } }, 'Očisti'),
      h('button.primary', { onclick: search }, '🔍 Traži sve'))),
    res));
  if (last.data) draw(); else setTimeout(() => ta.focus(), 50);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) search(); });
});
