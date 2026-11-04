import { h, clear, route, GET, POST, PUT, DEL, qs, go, can, lookups, models, E, img, fmtDT, fmtMoney, field, input, textarea, select, check, combo, locationInput, formData, confirmBox, run, gallery, kv, badge, statusBadge, reqBadge, pager, tabs, loading, empty, setQuery, printLabels } from '../lib.js';
import { makeItems, modelItems, reqDialog, moveDialog, sellDialog, returnDialog } from './parts.js';

const opt = list => list.map(x => ({ value: x.id, label: x.title }));

route('/felne', async (params, query, main) => {
  const L = await lookups();
  const q = { status: 'UNSOLD', offset: 0, ...query }; q.offset = Number(q.offset) || 0;
  const res = h('div');
  const load = async () => {
    setQuery(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'status' && v === 'UNSOLD'))));
    clear(res, loading());
    const d = await GET('/api/rims?' + qs({ ...q, limit: 50 }));
    clear(res, h('div.muted', { style: { margin: '6px 2px' } }, `Pronađeno: ${d.total}`), h('div.card.p0', h('div.list', d.rows.length ? d.rows.map(r => h('a.item', { href: '#/felne/' + r.id },
      h('img.th', { src: img(r.image_id), loading: 'lazy' }),
      h('div.bd', h('div.t', r.title), h('div.s', h('span.code', r.internal_code), r.model_label ? h('span', r.model_label) : null, r.location_code ? h('b', '📍 ' + r.location_code) : null,
        r.damaged ? h('span', 'oštećene') : null, r.screw_included ? h('span', 'sa šarafima') : null)),
      h('div.rt', r.price ? h('span.price', fmtMoney(r.price)) : h('span.muted', 'bez cijene'), r.status === 'SOLD' ? statusBadge('SOLD') : null))) : empty())),
      pager(d.total, q.offset, 50, o => { q.offset = o; load(); }));
  };
  const set = (k, v) => { q[k] = v; q.offset = 0; load(); };
  const sel = (k, list, ph) => { const s = select(k, q[k], list, { placeholder: ph }); s.onchange = () => set(k, s.value); return s; };
  const s = input('q', q.q, { type: 'search', placeholder: 'Šifra (F123) ili napomena' }); let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => set('q', s.value.trim()), 400); };
  const mk = combo('car_make_id', q.car_make_id, makeItems(L), { placeholder: 'Marka' }); mk.addEventListener('change', () => set('car_make_id', mk.value));
  clear(main, h('div',
    h('div.head', h('h1', 'Felne'), can('ROLE_RIMS_C') ? h('button.primary', { onclick: () => go('/felne/nova') }, '+ Nove felne') : null),
    h('div.card', h('div.filters', { style: { marginTop: 0 } }, s, sel('status', { UNSOLD: 'Na stanju', SOLD: 'Prodate', ALL: 'Sve' }, 'Status'), sel('type_id', opt(L.rims_types), 'Vrsta'),
      sel('diameter_id', opt(L.rims_diameters), 'Prečnik'), sel('width_id', opt(L.rims_widths), 'Širina'), sel('pattern_id', opt(L.rims_patterns), 'Raspon šarafa'), mk)), res));
  load();
});

route('/felne/:id', async ({ id }, query) => {
  if (id === 'nova') return rimsForm(null, query);
  const r = await GET('/api/rims/' + id);
  const reload = () => go('/felne/' + id + '?r=' + Date.now());
  const sold = r.status === 'SOLD';
  const act = async fn => { if (await fn()) reload(); };
  let tab = 'loc'; const tb = h('div');
  const renderTab = () => clear(tb, tabs([['loc', 'Lokacije'], ['sale', 'Prodaja'], ['req', 'Nalozi']], tab, k => { tab = k; renderTab(); }), {
    loc: () => r.location_history.length ? h('table.tbl', h('tbody', r.location_history.map(x => h('tr', h('td', fmtDT(x.created_date)), h('td', x.action === 'IN' ? '➡ U' : '⬅ Iz'), h('td', x.code), h('td.muted', x.user_name))))) : empty(),
    sale: () => r.sale_history.length ? h('table.tbl', h('tbody', r.sale_history.map(x => h('tr', h('td', fmtDT(x.created_date)), h('td', x.status === 'SOLD' ? badge('Prodaja', 'green') : badge('Povrat', 'red')), h('td.n', fmtMoney(x.the_price)), h('td.muted', x.user_name))))) : empty(),
    req: () => r.requests.length ? h('table.tbl', h('tbody', r.requests.map(x => h('tr.click', { onclick: () => go('/nalozi/' + x.id) }, h('td', '#' + x.the_number), h('td', reqBadge(x.status)), h('td', fmtDT(x.created_date)))))) : empty(),
  }[tab]());
  renderTab();
  return h('div',
    h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', r.internal_code + ' · ' + r.title)),
    h('div.card', h('div.actions',
      can('ROLE_RIMS_U') ? h('button', { onclick: () => go(`/felne/${id}/uredi`) }, '✏️ Uredi') : null,
      !sold && can('ROLE_RIMS_U', 'ROLE_WHS_CLERK', 'ROLE_SP_LOC_U') ? h('button', { onclick: () => act(() => moveDialog('rims', id)) }, '📍 Premjesti') : null,
      !sold && can('ROLE_REQ_C') ? h('button', { onclick: () => act(() => reqDialog([], [id])) }, '📋 Nalog') : null,
      !sold && can('ROLE_SP_SALE', 'ROLE_RIMS_U') ? h('button.primary', { onclick: () => act(() => sellDialog('rims', r)) }, '💰 Prodaj') : null,
      sold && can('ROLE_SP_SALE', 'ROLE_RIMS_U') ? h('button', { onclick: () => act(() => returnDialog('rims', r)) }, '↩ Povrat') : null,
      h('button', { onclick: () => printLabels([{ code: r.internal_code, title: r.title, sub: r.location_code }]) }, '🏷 Etiketa'),
      can('ROLE_RIMS_U', 'ROLE_RIMS_D') ? h('button.danger', { onclick: async () => { if (await confirmBox('Obrisati felne ' + r.internal_code + '?')) { await run(() => DEL('/api/rims/' + id), 'Obrisano'); go('/felne'); } } }, '🗑') : null)),
    h('div.grid2', h('div.card', gallery(r.images, { type: 'RIMS', objectId: id, canEdit: can('ROLE_RIMS_U', 'ROLE_RIMS_C', 'ROLE_USR_LIB_UP'), onChange: reload })),
      h('div.card', kv([['Šifra', h('span.code', r.internal_code)], ['Status', statusBadge(r.status)], ['Cijena', r.price ? h('span.price', fmtMoney(r.price, r.currency_id)) : 'nije unesena'],
        ['Lokacija', r.location_id ? h('a', { href: '#/magacin/lokacija/' + r.location_id }, r.location_label) : '—'],
        ['Vrsta', r.type_title], ['Prečnik', r.diameter_title], ['Širina', r.width_title], ['Raspon šarafa', r.pattern_title], ['ET', r.offSet], ['Centralna rupa', r.center_hole],
        ['Vozilo', r.model_label], ['Donor', r.vehicle_id ? h('a', { href: '#/vozila/' + r.vehicle_id }, '🚗 ' + r.vehicle_code) : null],
        ['Oštećene', r.damaged ? 'Da' : 'Ne'], ['Šarafi uključeni', r.screw_included ? 'Da' : 'Ne'], ['Hromirane/niklovane', r.chrome_nickel_plated ? 'Da' : null],
        ['Napomena', r.note], ['OLX', r.external_olx_id], ['Unesene', fmtDT(r.created_date)]]))),
    h('div.card', tb));
});
route('/felne/:id/uredi', async ({ id }) => rimsForm(await GET('/api/rims/' + id), {}));

async function rimsForm(r, query) {
  const L = await lookups();
  const isNew = !r; r = r || { vehicle_id: query.vehicle_id, currency_id: L.currency };
  if (isNew && r.vehicle_id) {
    const v = await GET('/api/vehicles/' + r.vehicle_id);
    Object.assign(r, { car_make_id: v.make_id, car_model_id: v.model_id, type_id: v.rims_type_id, diameter_id: v.rims_diameter_id, width_id: v.rims_width_id, pattern_id: v.rims_pattern_id, offSet: v.rims_offSet, center_hole: v.rims_center_hole });
  }
  const form = h('form.card', { onsubmit: e => e.preventDefault() });
  const makeC = combo('car_make_id', r.car_make_id, makeItems(L), { placeholder: 'Marka' });
  const modelC = combo('car_model_id', r.car_model_id, r.car_make_id ? modelItems(await models(r.car_make_id)) : [], { placeholder: 'Model' });
  makeC.addEventListener('change', async () => modelC.setItems(modelItems(await models(makeC.value))));
  clear(form, h('div.grid',
    field('Vrsta', select('type_id', r.type_id, opt(L.rims_types.filter(t => t.active || t.id === r.type_id))), { req: true }),
    field('Prečnik', select('diameter_id', r.diameter_id, opt(L.rims_diameters)), { req: true }),
    field('Širina', select('width_id', r.width_id, opt(L.rims_widths)), { req: true }),
    field('Raspon šarafa', select('pattern_id', r.pattern_id, opt(L.rims_patterns)), { req: true }),
    field('ET (offset)', input('offSet', r.offSet, { maxlength: 10 })), field('Centralna rupa (mm)', input('center_hole', r.center_hole, { type: 'number', step: '0.1' })),
    field('Marka', makeC), field('Model', modelC, { wide: true }),
    field('Cijena', input('price', r.price, { type: 'number', step: '0.01' })),
    h('div.field', h('span', ' '), h('div.row', check('damaged', r.damaged, 'Oštećene'), check('screw_included', r.screw_included, 'Šarafi uključeni'), check('chrome_nickel_plated', r.chrome_nickel_plated, 'Hrom/nikl'))),
    isNew ? field('Lokacija', locationInput()) : null,
    h('input', { type: 'hidden', name: 'vehicle_id', value: r.vehicle_id || '' }),
    field('Napomena', textarea('note', r.note), { full: true })),
    h('div.sticky-actions', h('button', { type: 'button', onclick: () => history.back() }, 'Odustani'),
      h('button.primary', { type: 'button', onclick: async () => { const x = await run(() => (isNew ? POST('/api/rims', formData(form)) : PUT('/api/rims/' + r.id, formData(form))), 'Sačuvano'); go('/felne/' + x.id); } }, '💾 Sačuvaj')));
  return h('div', h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', isNew ? 'Nove felne' : 'Izmjena felni ' + r.internal_code)), form);
}
