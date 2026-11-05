// "Tražili, a nismo imali"
import { h, clear, route, GET, POST, PUT, qs, go, can, lookups, models, fmtDT, fmtDate, fmtMoney, field, input, textarea, combo, modal, confirmBox, toast, run, badge, tabs, loading, empty, setQuery } from '../lib.js';
import { makeItems, modelItems, typeItems } from './parts.js';

const ST = { OPEN: ['Otvoreno', 'orange'], NOTIFIED: ['Javljeno kupcu', 'blue'], DONE: ['Riješeno', 'green'], CANCELED: ['Otkazano', 'gray'] };
const telLink = p => (p ? h('a', { href: 'tel:' + p.replace(/[^\d+]/g, ''), onclick: e => e.stopPropagation() }, '📞 ' + p) : null);

// Brz unos (koristi se i iz drugih ekrana)
export async function demandDialog(pre = {}) {
  const L = await lookups();
  const typeC = combo('type_id', pre.type_id, typeItems(L), { placeholder: 'Vrsta dijela' });
  const makeC = combo('make_id', pre.make_id, makeItems(L), { placeholder: 'Marka' });
  const modelC = combo('model_id', pre.model_id, pre.make_id ? modelItems(await models(pre.make_id)) : [], { placeholder: 'Model' });
  makeC.addEventListener('change', async () => modelC.setItems(modelItems(await models(makeC.value))));
  const year = input('model_year', pre.model_year, { type: 'number', inputmode: 'numeric' });
  const cat = input('catalog_number', pre.catalog_number, { style: { textTransform: 'uppercase' } });
  const text = input('text', pre.text, { placeholder: 'npr. lijevi far, xenon' });
  const name = input('customer_name', pre.customer_name), phone = input('phone', pre.phone, { type: 'tel', inputmode: 'tel' });
  const note = textarea('note', pre.note, { rows: 2 });
  return modal('📝 Kupac je tražio', [
    h('div.grid', field('Vrsta dijela', typeC, { wide: true }), field('Kataloški broj', cat), field('Marka', makeC), field('Model', modelC, { wide: true }), field('Godište', year),
      field('Opis (ako nema vrste)', text, { full: true }), field('Ime kupca', name), field('Telefon', phone), field('Napomena', note, { full: true }))],
  [{ label: 'Odustani' }, { label: 'Zapiši', primary: true, onClick: async () => {
    const r = await POST('/api/demand', { type_id: typeC.value, make_id: makeC.value, model_id: modelC.value, model_year: year.value || null, catalog_number: cat.value.toUpperCase() || null, text: text.value || null, customer_name: name.value || null, phone: phone.value || null, note: note.value || null });
    toast(r.matches?.length ? `Zapisano — PAŽNJA: ovo već imate na stanju (${r.matches.length})!` : 'Zapisano');
    return r;
  } }]);
}

route('/trazeno', async (params, query, main) => {
  const q = { status: query.status || 'OPEN', q: query.q || '' };
  const res = h('div'); const tb = h('div');
  const load = async () => {
    setQuery(q);
    clear(tb, tabs([['OPEN', 'Otvoreno'], ['AVAILABLE', '✔ Sad imamo!'], ['DONE', 'Riješeno'], ['ALL', 'Sve']], q.status, k => { q.status = k; load(); }));
    clear(res, loading());
    const d = await GET('/api/demand?' + qs(q));
    clear(res,
      h('p.muted', `Otvorenih: ${d.counts.open || 0} · riješenih: ${d.counts.done || 0}`),
      h('div.card.p0', h('div.list', d.rows.length ? d.rows.map(r => {
        const what = [r.type_title, r.text].filter(Boolean).join(' — ') || 'Kat. br. ' + r.catalog_number;
        const setSt = s => run(() => PUT('/api/demand/' + r.id, { status: s }), 'Sačuvano').then(load);
        return h('div.item', { style: { cursor: 'default', alignItems: 'flex-start' } },
          h('div.bd',
            h('div.t', what, r.model_label ? h('span', { style: { fontWeight: 400 } }, ' · ' + r.model_label + (r.model_year ? ' ' + r.model_year : '')) : null),
            h('div.s', r.catalog_number ? h('span.code', r.catalog_number) : null, r.customer_name ? h('b', r.customer_name) : null, telLink(r.phone), h('span', fmtDT(r.created_date)), h('span', r.user_name || ''), badge(...ST[r.status])),
            r.note ? h('div.s', '💬 ' + r.note) : null,
            r.match_count ? h('div', { style: { marginTop: '6px', background: 'var(--okl)', padding: '6px 8px', borderRadius: '4px' } },
              h('b', { style: { color: 'var(--ok)' } }, `✔ Sada imamo ${r.match_count}${r.match_count >= 5 ? '+' : ''}: `),
              r.matches.map(m => h('a.chip', { href: '#/dijelovi/' + m.id, style: { margin: '2px' } }, m.internal_code + (m.location_code ? ' 📍' + m.location_code : '') + (m.price ? ' · ' + fmtMoney(m.price) : '')))) : null),
          h('div.rt',
            r.status === 'OPEN' ? h('button.sm', { onclick: () => setSt('NOTIFIED') }, '📞 Javio sam') : null,
            ['OPEN', 'NOTIFIED'].includes(r.status) ? h('button.sm.primary', { onclick: () => setSt('DONE') }, '✔ Riješeno') : null,
            ['OPEN', 'NOTIFIED'].includes(r.status) ? h('button.sm.danger', { onclick: async () => { if (await confirmBox('Otkazati?')) setSt('CANCELED'); } }, '✖') : null,
            r.status === 'DONE' || r.status === 'CANCELED' ? h('button.sm', { onclick: () => setSt('OPEN') }, '↺') : null));
      }) : empty(q.status === 'AVAILABLE' ? 'Ništa od traženog još nije stiglo' : 'Nema zapisa'))));
  };
  const s = input('q', q.q, { type: 'search', placeholder: 'Traži: ime, telefon, kat. broj, opis' });
  let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { q.q = s.value.trim(); load(); }, 400); };
  clear(main, h('div',
    h('div.head', h('h1', '📝 Tražili, a nismo imali'), h('button.primary', { onclick: async () => { if (await demandDialog()) load(); } }, '+ Zapiši traženo')),
    h('div.card', h('p.muted', { style: { marginTop: 0 } }, 'Kad kupac traži dio koji nemate — zapišite ga ovdje. Kad se takav dio unese u program, pojavi se pod „✔ Sad imamo!” i na samom dijelu, da nazovete kupca.'), s),
    tb, res));
  load();
});
