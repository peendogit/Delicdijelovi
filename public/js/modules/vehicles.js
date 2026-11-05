import { h, clear, route, GET, POST, PUT, DEL, qs, go, can, lookups, models, E, img, fmtDT, fmtDate, fmtMoney, field, input, textarea, select, combo, formData, modal, confirmBox, toast, run, gallery, kv, badge, pager, tabs, loading, empty, setQuery , refresh, toolbarN, fab } from '../lib.js';
import { makeItems, modelItems, partItem } from './parts.js';

const vBadge = s => badge(E.vstatus[s] || s, s === 'COMPLETE' ? 'blue' : s === 'SOLD' ? 'red' : 'green');

route('/vozila', async (params, query, main) => {
  const L = await lookups();
  const q = { offset: 0, ...query }; q.offset = Number(q.offset) || 0;
  const res = h('div');
  const load = async () => {
    setQuery(Object.fromEntries(Object.entries(q).filter(([, v]) => v)));
    clear(res, loading());
    const d = await GET('/api/vehicles?' + qs({ ...q, limit: 50 }));
    clear(res, h('div.muted', { style: { margin: '6px 2px' } }, `Ukupno: ${d.total}`), h('div.card.p0', h('div.list', d.rows.length ? d.rows.map(v => h('a.item', { href: '#/vozila/' + v.id },
      h('img.th', { src: img(v.image_id), loading: 'lazy' }),
      h('div.bd', h('div.t', `${v.internal_code} · ${v.model_label} ${v.model_year}`),
        h('div.s', [E.fuel[v.fuel_type], v.cylinder_capacity ? v.cylinder_capacity + ' ccm' : '', v.power ? v.power + ' kW' : '', v.engine_code, E.gearbox[v.gearbox_type], v.chassis_number].filter(Boolean).map(x => h('span', x)))),
      h('div.rt', vBadge(v.status), h('span.muted', `${v.parts_unsold} na stanju · ${v.parts_sold} prod.`), v.status === 'COMPLETE' && v.price ? h('span.price', fmtMoney(v.price)) : null))) : empty())),
      pager(d.total, q.offset, 50, o => { q.offset = o; load(); }));
  };
  const set = (k, v) => { q[k] = v; q.offset = 0; load(); };
  const s = input('q', q.q, { type: 'search', placeholder: 'Šifra, VIN, motor, model, godište…' });
  let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => set('q', s.value.trim()), 400); };
  const st = select('status', q.status, E.vstatus, { placeholder: 'Svi statusi' }); st.onchange = () => set('status', st.value);
  const mk = combo('make_id', q.make_id, makeItems(L), { placeholder: 'Marka' }); mk.addEventListener('change', () => set('make_id', mk.value));
  clear(main, h('div',
    h('div.head', h('h1', 'Vozila (donori)'), h('button', { onclick: () => go('/kalkulator') }, '🧮 Kalkulator otkupa'), can('ROLE_VEH_C') ? fab('Novo vozilo', () => go('/vozila/novo')) : null),
    h('div.card', h('div.filters', { style: { marginTop: 0 } }, s, mk, st)), res));
  load();
});

route('/vozila/:id', async ({ id }) => {
  if (id === 'novo') return vehicleForm(null);
  const v = await GET('/api/vehicles/' + id);
  const reload = () => refresh();
  let tab = 'UNSOLD';
  const partsBox = h('div');
  const loadParts = async () => {
    clear(partsBox, loading());
    const d = await GET('/api/parts?' + qs({ vehicle_id: id, status: tab, limit: 500, sort: 'title' }));
    clear(partsBox, tabs([['UNSOLD', `Na stanju (${v.stats.unsold || 0})`], ['SOLD', `Prodati (${v.stats.sold || 0})`], ['ALL', 'Svi']], tab, k => { tab = k; loadParts(); }),
      h('div.list', d.rows.length ? d.rows.map(p => partItem(p)) : empty('Nema dijelova')));
  };
  loadParts();
  const info = kv([
    ['Šifra', h('span.code', v.internal_code)], ['Status', vBadge(v.status)],
    ['Vozilo', v.model_label], ['Godište', v.model_year], ['Kilometraža', v.mileage ? v.mileage.toLocaleString('bs-BA') + ' km' : null],
    ['VIN', v.chassis_number], ['Gorivo', E.fuel[v.fuel_type]], ['Motor', [v.cylinder_capacity ? v.cylinder_capacity + ' ccm' : '', v.power ? v.power + ' kW' : '', v.engine_code].filter(Boolean).join(' · ')],
    ['Broj motora', v.engine_number], ['Mjenjač', [E.gearbox[v.gearbox_type], v.gearbox_speed ? v.gearbox_speed + ' br.' : '', v.gearbox_code].filter(Boolean).join(' · ')],
    ['Pogon', E.drive[v.drive_train]], ['Karoserija', E.body[v.the_type]], ['Boja', v.color],
    ['Felne', [v.rims_type_title, v.rims_diameter_title, v.rims_width_title, v.rims_pattern_title, v.rims_offSet ? 'ET' + v.rims_offSet : '', v.rims_center_hole ? 'CB ' + v.rims_center_hole : ''].filter(Boolean).join(' ')],
    ['Nabavna cijena', v.price ? fmtMoney(v.price, v.currency_id) : h('span.muted', 'nije upisana')], ['Napomena', v.note],
    ['YouTube', v.youtube_url ? h('a', { href: v.youtube_url, target: '_blank' }, 'video') : null],
    ['OLX', v.external_olx_id ? h('a', { href: 'https://olx.ba/artikal/' + v.external_olx_id, target: '_blank' }, v.external_olx_id) : null],
    ['Unio', (v.created_by_name || '') + ' · ' + fmtDT(v.created_date)],
  ]);
  return h('div',
    h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', `${v.internal_code} · ${v.model_label} ${v.model_year}`)),
    toolbarN(3,
      can('ROLE_SP_C') ? h('button.primary', { onclick: () => go('/dijelovi/novi?vehicle_id=' + id) }, '🔧 Novi dio sa vozila') : null,
      can('ROLE_RIMS_C') ? h('button', { onclick: () => go('/felne/nova?vehicle_id=' + id) }, '⚙️ Felne sa vozila') : null,
      can('ROLE_VEH_U') ? h('button', { onclick: () => go(`/vozila/${id}/uredi`) }, '✏️ Uredi') : null,
      can('ROLE_VEH_U') && v.status === 'COMPLETE' ? h('button', { onclick: async () => {
        const pr = input('price', v.price, { type: 'number' }); const note = textarea('note', '');
        if (await modal('Prodaja vozila', [field('Cijena', pr), field('Napomena', note)], [{ label: 'Odustani' }, { label: 'Prodaj', primary: true, onClick: () => POST(`/api/vehicles/${id}/sell`, { price: pr.value, note: note.value }) }])) reload();
      } }, '💰 Prodaj vozilo') : null,
      h('button', { onclick: async () => { const d = await GET(`/api/olx/describe/vehicle/${id}`); const ta = textarea('t', d.html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim(), { rows: 12 }); modal('Tekst oglasa', [field('Naslov', input('t', d.title)), ta], [{ label: 'Zatvori' }, { label: 'Kopiraj', primary: true, onClick: async () => { await navigator.clipboard.writeText(ta.value); toast('Kopirano'); return false; } }]); } }, '📝 Tekst oglasa'),
      can('ROLE_VEH_D') ? h('button.danger', { onclick: async () => { if (await confirmBox('Obrisati vozilo ' + v.internal_code + '?')) { await run(() => DEL('/api/vehicles/' + id), 'Obrisano'); go('/vozila'); } } }, '🗑 Obriši vozilo') : null),
    h('div.stats',
      h('div.stat', h('b', v.stats.total || 0), h('span', 'Dijelova ukupno')), h('div.stat', h('b', v.stats.unsold || 0), h('span', 'Na stanju')),
      h('div.stat', h('b', v.stats.sold || 0), h('span', 'Prodato')), h('div.stat', h('b', fmtMoney(v.stats.earned || 0)), h('span', 'Zarađeno od dijelova')),
      h('div.stat', h('b', fmtMoney(v.stats.unsold_value || 0)), h('span', 'Vrijednost na stanju')),
      h('div.stat', h('b', fmtMoney(v.stats.invested || 0)), h('span', 'Uloženo (nabavka + troškovi)')),
      h('div.stat', { style: { borderLeftColor: v.stats.profit >= 0 ? 'var(--ok)' : 'var(--red)' } }, h('b', { style: { color: v.stats.profit >= 0 ? 'var(--ok)' : 'var(--red)' } }, (v.stats.profit >= 0 ? '+' : '') + fmtMoney(v.stats.profit || 0)),
        h('span', v.stats.profit >= 0 ? 'Zarada iznad uloženog' : 'Još do isplate'), v.stats.invested ? h('div.muted', Math.round(((v.stats.earned + v.stats.sold_whole) / v.stats.invested) * 100) + '% vraćeno') : null)),
    h('div.card', h('h2', 'Troškovi vozila'),
      h('table.tbl', h('tbody',
        h('tr', h('td', 'Nabavna cijena'), h('td.muted', fmtDate(v.created_date)), h('td.n', h('b', fmtMoney(v.price || 0))), h('td', '')),
        v.costs.map(c => h('tr', h('td', c.title, c.note ? h('div.muted', c.note) : null), h('td.muted', fmtDate(c.cost_date)), h('td.n', fmtMoney(c.amount)),
          h('td', can('ROLE_VEH_U') ? h('button.sm.danger', { onclick: async () => { if (await confirmBox('Obrisati trošak „' + c.title + '”?')) { await run(() => DEL(`/api/vehicles/${id}/costs/${c.id}`)); reload(); } } }, '🗑') : '')))),
        h('tr', h('td', h('b', 'Ukupno uloženo')), h('td', ''), h('td.n', h('b', fmtMoney(v.stats.invested || 0))), h('td', ''))),
      can('ROLE_VEH_U') ? h('button', { style: { marginTop: '8px' }, onclick: async () => {
        const t = input('title', '', { placeholder: 'npr. Šlep, Carina, Transport, Popravka' }); const a = input('amount', '', { type: 'number', step: '0.01', inputmode: 'decimal' });
        const d = input('cost_date', new Date().toISOString().slice(0, 10), { type: 'date' }); const n = input('note', '');
        if (await modal('Novi trošak — ' + v.internal_code, [field('Opis', t), field('Iznos (KM)', a), field('Datum', d), field('Napomena', n)], [{ label: 'Odustani' }, { label: 'Dodaj', primary: true, onClick: () => POST(`/api/vehicles/${id}/costs`, { title: t.value, amount: a.value, cost_date: d.value, note: n.value }) }])) reload();
      } }, '+ Dodaj trošak') : null),
    h('div.grid2', h('div.card', gallery(v.images, { type: 'VEHICLE', objectId: id, canEdit: can('ROLE_VEH_U', 'ROLE_VEH_C', 'ROLE_USR_LIB_UP'), onChange: reload })), h('div.card', info)),
    v.rims.length ? h('div.card', h('h2', 'Felne sa vozila'), h('div.chips', v.rims.map(r => h('a.chip', { href: '#/felne/' + r.id }, r.internal_code + ' ' + (r.status === 'SOLD' ? '(prodate)' : ''))))) : null,
    h('div.card.p0', h('div', { style: { padding: '12px 14px 0' } }, h('h2', 'Dijelovi')), partsBox));
});

route('/vozila/:id/uredi', async ({ id }) => vehicleForm(await GET('/api/vehicles/' + id)));

async function vehicleForm(v) {
  const L = await lookups();
  const isNew = !v; v = v || { status: 'PARTS', currency_id: L.currency };
  const form = h('form.card', { onsubmit: e => e.preventDefault() });
  const makeC = combo('make_id', v.make_id, makeItems(L), { placeholder: 'Marka' });
  const modelC = combo('model_id', v.model_id, v.make_id ? modelItems(await models(v.make_id)) : [], { placeholder: 'Model' });
  makeC.addEventListener('change', async () => modelC.setItems(modelItems(await models(makeC.value))));
  const opt = list => list.map(x => ({ value: x.id, label: x.title }));
  const I = (n, a = {}) => input(n, v[n], a);
  clear(form, h('div.grid',
    h('div.sect', 'Osnovno'),
    field('Marka', makeC, { req: true }), field('Model', modelC, { req: true, wide: true }), field('Godište', I('model_year', { type: 'number', inputmode: 'numeric' }), { req: true }),
    field('Status', select('status', v.status, E.vstatus, { empty: false })), field('Kilometraža', I('mileage', { type: 'number' })),
    field('Broj šasije (VIN)', I('chassis_number', { maxlength: 17, style: { textTransform: 'uppercase' } }), { wide: true }), field('Boja', I('color', { maxlength: 20 })),
    field('Karoserija', select('the_type', v.the_type, E.body)),
    h('div.sect', 'Motor i mjenjač'),
    field('Gorivo', select('fuel_type', v.fuel_type, E.fuel)), field('Kubikaža (ccm)', I('cylinder_capacity', { type: 'number' })), field('Snaga (kW)', I('power', { type: 'number' })),
    field('Oznaka motora', I('engine_code', { maxlength: 10, style: { textTransform: 'uppercase' } })), field('Broj motora', I('engine_number', { maxlength: 20 })),
    field('Mjenjač', select('gearbox_type', v.gearbox_type, E.gearbox)), field('Broj brzina', I('gearbox_speed', { type: 'number' })), field('Oznaka mjenjača', I('gearbox_code', { maxlength: 10, style: { textTransform: 'uppercase' } })),
    field('Pogon', select('drive_train', v.drive_train, E.drive)),
    h('div.sect', 'Felne na vozilu'),
    field('Vrsta', select('rims_type_id', v.rims_type_id, opt(L.rims_types))), field('Prečnik', select('rims_diameter_id', v.rims_diameter_id, opt(L.rims_diameters))),
    field('Širina', select('rims_width_id', v.rims_width_id, opt(L.rims_widths))), field('Raspon šarafa', select('rims_pattern_id', v.rims_pattern_id, opt(L.rims_patterns))),
    field('ET', I('rims_offSet', { maxlength: 10 })), field('Centralna rupa', I('rims_center_hole', { type: 'number', step: '0.1' })),
    h('div.sect', 'Prodaja i ostalo'),
    field('Nabavna cijena (plaćeno za vozilo)', I('price', { type: 'number', step: '0.01', inputmode: 'decimal' })), field('Valuta', select('currency_id', v.currency_id || L.currency, L.currencies.map(c => ({ value: c, label: c })), { empty: false })),
    field('YouTube link', I('youtube_url'), { wide: true }), field('Napomena', textarea('note', v.note), { full: true }),
    !isNew ? h('label.check.full', h('input', { type: 'checkbox', name: 'propagate', checked: true }), 'Promjenu marke/modela/godišta primijeni i na dijelove ovog vozila') : null),
    h('div.sticky-actions', h('button', { type: 'button', onclick: () => history.back() }, 'Odustani'),
      h('button.primary', { type: 'button', onclick: async () => {
        const d = formData(form);
        for (const k of ['chassis_number', 'engine_code', 'gearbox_code']) if (d[k]) d[k] = d[k].toUpperCase();
        const r = await run(() => (isNew ? POST('/api/vehicles', d) : PUT('/api/vehicles/' + v.id, d)), 'Sačuvano');
        go('/vozila/' + r.id);
      } }, '💾 Sačuvaj')));
  return h('div', h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', isNew ? 'Novo vozilo' : 'Izmjena vozila ' + v.internal_code)), form);
}
