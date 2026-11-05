import {
  h, clear, route, GET, POST, PUT, DEL, qs, go, can, state, lookups, models, E, img, fmtDT, fmtDate, fmtMoney, field, input, textarea, select, check, combo,
  locationInput, formData, modal, confirmBox, toast, run, gallery, kv, badge, statusBadge, reqBadge, pager, tabs, loading, empty, setQuery, printLabels, uploadImages, refresh, toolbar, fab, readCatalogFromPhoto,
} from '../lib.js';

export const typeItems = L => L.types.filter(t => t.active).map(t => ({ value: t.id, label: t.title, sub: L.groups.find(g => g.id === t.group_id)?.title }));
export const makeItems = L => L.makes.filter(m => m.active).map(m => ({ value: m.id, label: m.name }));
export const modelItems = list => list.map(m => ({ value: m.id, label: m.label }));
export const userItems = L => L.users.map(u => ({ value: u.id, label: u.full_name }));

// Lista dijelova (koristi se i na drugim ekranima)
export function partItem(p, opts = {}) {
  return h('a.item', { href: '#/dijelovi/' + p.id },
    opts.check || null,
    h('img.th', { src: img(p.image_id), loading: 'lazy' }),
    h('div.bd',
      h('div.t', p.title),
      h('div.s', h('span.code', p.internal_code), p.catalog_number ? h('span', p.catalog_number) : null, p.side ? h('span', E.side[p.side] || p.side) : null,
        p.location_code ? h('b', '📍 ' + p.location_code) : null, p.vehicle_code ? h('span', '🚗 ' + p.vehicle_code) : null, p.created_date ? h('span', fmtDate(p.created_date)) : null)),
    h('div.rt', p.price ? h('span.price', fmtMoney(p.price, p.currency_id)) : null, p.status === 'SOLD' ? statusBadge('SOLD') : null, p.part_set ? badge('komplet') : null, p.parent_id ? badge('dio kompleta') : null));
}

// Tabelarni red (katalog) za širi ekran
function partRow(p, check) {
  return h('tr.click', { onclick: e => { if (!e.target.closest('input')) go('/dijelovi/' + p.id); } },
    h('td', { style: { width: '30px' } }, check || ''),
    h('td', { style: { width: '58px' } }, h('img.th', { src: img(p.image_id), loading: 'lazy' })),
    h('td', h('span.code', p.internal_code)),
    h('td', h('div.t', p.title), p.note ? h('div.muted', p.note) : null),
    h('td', p.catalog_number || (p.catalog_number_damaged ? h('span.muted', 'nečitljiv') : '')),
    h('td', E.side[p.side] || ''),
    h('td', p.location_code ? h('b', p.location_code) : ''),
    h('td', { style: { whiteSpace: 'nowrap' } }, p.vehicle_code ? '🚗 ' + p.vehicle_code : ''),
    h('td.n', p.price ? h('span.price', fmtMoney(p.price, p.currency_id)) : '', p.status === 'SOLD' ? h('div', statusBadge('SOLD')) : null));
}

route('/dijelovi', async (params, query, main) => {
  const L = await lookups();
  const q = { status: 'UNSOLD', sort: 'new', offset: 0, ...query };
  q.offset = Number(q.offset) || 0;
  const LIMIT = 50;
  const results = h('div.card.p0');
  const treeBox = h('div.tree' + (window.innerWidth <= 960 && !q.group_id && !q.type_id ? '.collapsed' : ''));
  const selected = new Set();
  const openGroups = new Set(q.group_id ? [q.group_id] : []);
  const bulk = h('div.card', { style: { display: 'none', position: 'sticky', top: '60px', zIndex: 10, borderLeft: '4px solid var(--or)' } });
  const updBulk = () => {
    bulk.style.display = selected.size ? 'block' : 'none';
    clear(bulk, h('div.row', h('b.grow', `Izabrano: ${selected.size}`),
      can('ROLE_SP_SALE') ? h('button.primary', { onclick: async () => {
        const rows = await Promise.all([...selected].map(id => GET('/api/parts/' + id)));
        const { saleDialog } = await import('./sales.js');
        if (await saleDialog(rows.map(p => ({ kind: 'part', id: p.id, code: p.internal_code, title: p.title, price: p.price ?? '' })))) { selected.clear(); updBulk(); load(); }
      } }, '💰 Prodaj izabrane') : null,
      can('ROLE_REQ_C') ? h('button', { onclick: () => reqDialog([...selected]).then(ok => { if (ok) { selected.clear(); updBulk(); load(); } }) }, '📋 Nalog') : null,
      h('button', { onclick: async () => { const rows = await Promise.all([...selected].map(id => GET('/api/parts/' + id))); printLabels(rows.map(p => ({ code: p.internal_code, title: p.title, sub: p.location_code }))); } }, '🏷 Etikete'),
      h('button', { onclick: () => { selected.clear(); updBulk(); load(); } }, 'Poništi')));
  };
  const cb = p => (can('ROLE_REQ_C', 'ROLE_SP_SALE') && p.status === 'UNSOLD' ? h('input', { type: 'checkbox', checked: selected.has(p.id), onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); updBulk(); } }) : null);

  // Stablo: grupe → vrste, sa brojem dijelova za trenutni izbor vozila/filtere
  const drawTree = facets => {
    const cnt = Object.fromEntries(facets.map(f => [f.type_id, f.n]));
    const groups = L.groups.map(g => ({ g, types: L.types.filter(t => t.group_id === g.id && cnt[t.id]).sort((a, b) => a.title.localeCompare(b.title)) }))
      .map(x => ({ ...x, n: x.types.reduce((s, t) => s + cnt[t.id], 0) })).filter(x => x.n).sort((a, b) => a.g.title.localeCompare(b.g.title));
    const other = L.types.filter(t => cnt[t.id] && !L.groups.some(g => g.id === t.group_id));
    const total = facets.reduce((s, f) => s + f.n, 0);
    clear(treeBox,
      h('div.th2', { onclick: e => { if (!e.target.closest('a') && window.innerWidth <= 960) treeBox.classList.toggle('collapsed'); } }, h('span', 'Grupe dijelova', h('span.only-narrow', { style: { display: 'inline' } }, treeBox.classList.contains('collapsed') ? ' ▾' : ' ▴')), q.group_id || q.type_id ? h('a', { onclick: () => { q.group_id = ''; q.type_id = ''; q.offset = 0; load(); } }, 'sve ✕') : h('span', total.toLocaleString('bs-BA'))),
      groups.map(({ g, types, n }) => {
        const open = openGroups.has(g.id);
        return [
          h('div.g' + (open ? '.open' : '') + (q.group_id === g.id && !q.type_id ? '.act' : ''), { onclick: () => { open ? openGroups.delete(g.id) : openGroups.add(g.id); q.group_id = g.id; q.type_id = ''; q.offset = 0; load(); } },
            h('span', h('span.ar', '▸'), ' ', g.title), h('span.cnt', n.toLocaleString('bs-BA'))),
          open ? types.map(t => h('div.t2' + (q.type_id === t.id ? '.act' : ''), { onclick: () => { q.type_id = t.id; q.group_id = ''; q.offset = 0; load(); } }, h('span', t.title), h('span.cnt', cnt[t.id].toLocaleString('bs-BA')))) : null,
        ];
      }),
      other.length ? other.map(t => h('div.t2' + (q.type_id === t.id ? '.act' : ''), { onclick: () => { q.type_id = t.id; q.offset = 0; load(); } }, h('span', t.title), h('span.cnt', cnt[t.id]))) : null);
  };

  let facetKey = '';
  const load = async () => {
    setQuery(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'status' && v === 'UNSOLD') && !(k === 'sort' && v === 'new') && !(k === 'offset' && !v))));
    clear(results, loading());
    const fq = { ...q }; delete fq.type_id; delete fq.group_id; delete fq.offset; delete fq.sort;
    const fk = qs(fq);
    const [d] = await Promise.all([
      GET('/api/parts?' + qs({ ...q, limit: LIMIT })),
      fk !== facetKey ? GET('/api/parts/facets?' + fk).then(f => { facetKey = fk; lastFacets = f; }) : null,
    ]);
    drawTree(lastFacets);
    const typeT = q.type_id ? L.types.find(t => t.id === q.type_id)?.title : q.group_id ? L.groups.find(g => g.id === q.group_id)?.title : null;
    clear(results,
      h('div.resbar', h('b', `${d.total.toLocaleString('bs-BA')} artikala`), typeT ? badge(typeT, 'orange') : null, vehLabel() ? badge(vehLabel(), 'blue') : null, h('div.grow'), statusChips(), sortS),
      d.rows.length ? [
        h('div.only-wide.scroll-x', h('table.tbl', h('thead', h('tr', h('th', ''), h('th', 'Slika'), h('th', 'Šifra'), h('th', 'Naziv artikla'), h('th', 'Kataloški br.'), h('th', 'Strana'), h('th', 'Lokacija'), h('th', 'Donor'), h('th.n', 'Cijena'))),
          h('tbody', d.rows.map(p => partRow(p, cb(p)))))),
        h('div.only-narrow', h('div.list', d.rows.map(p => partItem(p, { check: cb(p) })))),
      ] : h('div', empty('Nema dijelova za zadate uslove'), h('div', { style: { textAlign: 'center', paddingBottom: '16px' } }, h('button', { onclick: async () => { const { demandDialog } = await import('./demand.js'); demandDialog({ make_id: q.make_id, model_id: q.model_id, type_id: q.type_id, catalog_number: q.q }); } }, '📝 Kupac je tražio — zapiši'))),
      pager(d.total, q.offset, LIMIT, off => { q.offset = off; load(); window.scrollTo(0, 0); }));
  };
  let lastFacets = [];
  const set = (k, v) => { q[k] = v; q.offset = 0; load(); };

  // Izbor vozila
  const makeC = combo('make_id', q.make_id, makeItems(L), { placeholder: 'Sve marke' });
  const modelC = combo('model_id', q.model_id, q.make_id ? modelItems(await models(q.make_id)) : [], { placeholder: 'Svi modeli' });
  const vehLabel = () => [makeC.input.value, modelC.input.value].filter(Boolean).join(' ');
  makeC.addEventListener('change', async () => { q.model_id = ''; modelC.setItems(modelItems(await models(makeC.value))); set('make_id', makeC.value); });
  modelC.addEventListener('change', () => set('model_id', modelC.value));
  const sInp = input('q', q.q, { placeholder: 'Naziv, kataloški broj, šifra, oznaka motora…', type: 'search' });
  let st; sInp.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => set('q', sInp.value.trim()), 400); });

  const sel = (k, opts, ph) => { const s = select(k, q[k], opts, { placeholder: ph }); s.onchange = () => set(k, s.value); return s; };
  const locI = input('loc', '', { placeholder: 'Lokacija (P123)' });
  locI.onchange = async () => {
    if (!locI.value) return set('location_id', '');
    const r = await GET('/api/assets/find?code=' + encodeURIComponent(locI.value));
    const exact = r.find(x => x.code_extended.toUpperCase() === locI.value.trim().toUpperCase());
    if (exact) set('location_id', exact.id); else toast('Lokacija nije pronađena', 'err');
  };
  const dateF = input('date_from', q.date_from, { type: 'date' }); dateF.onchange = () => set('date_from', dateF.value);
  const dateT = input('date_to', q.date_to, { type: 'date' }); dateT.onchange = () => set('date_to', dateT.value);
  const userC = combo('created_by_id', q.created_by_id, userItems(L), { placeholder: 'Unio korisnik' });
  userC.addEventListener('change', () => set('created_by_id', userC.value));
  const hasF = ['side', 'fuel_type', 'gearbox_type', 'location_id', 'has_price', 'no_images', 'olx', 'date_from', 'date_to', 'created_by_id', 'drive_train', 'vehicle_id', 'year'].some(k => q[k]);
  const yearI = input('year', q.year, { type: 'number', placeholder: 'Godište', inputmode: 'numeric' }); yearI.onchange = () => set('year', yearI.value);
  const filters = h('div.filters', { style: { display: hasF ? 'grid' : 'none' } },
    sel('side', E.side, 'Strana'), sel('fuel_type', E.fuel, 'Gorivo'), sel('gearbox_type', E.gearbox, 'Mjenjač'), sel('drive_train', E.drive, 'Pogon'), yearI,
    locI, sel('has_price', { 1: 'Sa cijenom', 0: 'Bez cijene' }, 'Cijena'), sel('no_images', { 1: 'Bez slika' }, 'Slike'), sel('olx', { 1: 'Na OLX-u', 0: 'Nije na OLX-u' }, 'OLX'),
    userC, field('Unesen od', dateF), field('Unesen do', dateT));

  const statusChips = () => h('div.chips', [['UNSOLD', 'Na stanju'], ['SOLD', 'Prodati'], ['ALL', 'Svi']].map(([k, l]) => h('button.chip' + (q.status === k ? '.act' : ''), { onclick: () => set('status', k) }, l)));
  const sortS = sel('sort', { new: 'Najnoviji', old: 'Najstariji', mod: 'Zadnje mijenjani', price_desc: 'Cijena ↓', price_asc: 'Cijena ↑', title: 'Naziv A-Ž' }, 'Sortiranje');
  sortS.style.width = 'auto'; sortS.style.minHeight = '30px'; sortS.style.padding = '3px 8px';

  clear(main, h('div',
    h('div.head', h('h1', 'Katalog dijelova'), h('button', { onclick: () => go('/lista') }, '🔎 Pretraga liste'), can('ROLE_SP_C') ? fab('Novi dio', () => go('/dijelovi/novi')) : null),
    h('div.vbar',
      h('div.vlabel', h('b', '1'), 'Izbor vozila', h('span', { style: { fontWeight: 400, opacity: .7, textTransform: 'none' } }, '— zatim izaberite grupu dijelova')),
      field('Marka', makeC), field('Model', modelC), field('Pretraga', sInp),
      h('div.row', { style: { flexWrap: 'nowrap' } },
        h('button', { onclick: () => { filters.style.display = filters.style.display === 'none' ? 'grid' : 'none'; } }, '⚙ Filteri'),
        h('button', { onclick: () => go('/dijelovi') }, '✕'))),
    h('div.card', { style: { display: hasF ? 'block' : 'none', padding: '0 12px 12px' } }, filters),
    bulk,
    h('div.cat', treeBox, results)));
  // filteri: prikaži karticu kad se otvore
  const fCard = filters.parentNode;
  new MutationObserver(() => { fCard.style.display = filters.style.display === 'none' ? 'none' : 'block'; }).observe(filters, { attributes: true, attributeFilter: ['style'] });
  load();
});

// ---------- Dijalozi ----------
export async function reqDialog(partIds, rimsIds = []) {
  const urgent = check('urgent', false, 'Hitno');
  const ship = check('shipment', false, 'Za slanje (brza pošta)');
  const desc = textarea('description', '', { placeholder: 'Napomena za magacin (npr. odnesi u servis, skini nosač…)' });
  return modal(`Nalog magacinu (${partIds.length + rimsIds.length})`, [urgent, ship, desc], [{ label: 'Odustani' }, {
    label: 'Pošalji nalog', primary: true,
    onClick: async () => { await POST('/api/req', { part_ids: partIds, rims_ids: rimsIds, urgent: urgent.querySelector('input').checked, shipment: ship.querySelector('input').checked, description: desc.value }); toast('Nalog poslat'); },
  }]);
}
export async function moveDialog(kind, id) {
  const loc = locationInput();
  return modal('Premjesti na lokaciju', [field('Nova lokacija', loc)], [{ label: 'Odustani' }, {
    label: 'Premjesti', primary: true,
    onClick: async () => { const r = await POST(`/api/${kind}/${id}/move`, { location_code: loc.querySelector('input').value }); toast('Premješteno' + (r.location_label ? ': ' + r.location_label : '')); },
  }]);
}
export async function sellDialog(kind, it) {
  const { saleDialog } = await import('./sales.js');
  const k = kind === 'rims' ? 'rims' : 'part';
  const items = [{ kind: k, id: it.id, code: it.internal_code, title: it.title, price: it.price ?? '' }];
  if (k === 'part') for (const c of it.children || []) if (c.status === 'UNSOLD' && !c.parent_detached) items.push({ kind: 'part', id: c.id, code: c.internal_code, title: c.title + ' (iz kompleta)', price: 0 });
  return saleDialog(items);
}
export async function returnDialog(kind, it) {
  const last = it.sale_history?.find(s => s.status === 'SOLD');
  const price = input('price', last?.the_price ?? '', { type: 'number', step: '0.01' });
  const note = textarea('note', '', { placeholder: 'Razlog povrata' });
  const loc = locationInput();
  const { warrantyInfo } = await import('./sales.js');
  const war = await warrantyInfo(kind === 'rims' ? 'rims' : 'part', it.id);
  return modal('Povrat: ' + it.internal_code, [war, field('Vraćeni iznos (KM)', price), field('Lokacija (prazno = pult/povrat)', loc), note], [{ label: 'Odustani' }, {
    label: '↩ Vrati na stanje', primary: true,
    onClick: async () => { await POST(`/api/${kind}/${it.id}/return`, { price: price.value, note: note.value, location_code: loc.querySelector('input').value || undefined }); toast('Vraćeno na stanje'); },
  }]);
}
async function adTextDialog(kind, id) {
  const d = await GET(`/api/olx/describe/${kind}/${id}`);
  const ta = textarea('t', d.html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim(), { rows: 12 });
  return modal('Tekst oglasa', [field('Naslov', input('title', d.title)), field('Kratki opis', input('s', d.short)), field('Opis', ta)], [
    { label: 'Zatvori' }, { label: '📋 Kopiraj opis', primary: true, onClick: async () => { await navigator.clipboard.writeText(ta.value); toast('Kopirano'); return false; } }]);
}

// ---------- Detalj ----------
route('/dijelovi/:id', async ({ id }, query, main) => {
  if (id === 'novi') return partForm(null, query, main);
  const p = await GET('/api/parts/' + id);
  const reload = () => refresh();
  const sold = p.status === 'SOLD';
  const act = async (fn) => { const r = await fn(); if (r) reload(); };
  const B = {
    edit: can('ROLE_SP_U') ? h('button', { onclick: () => go(`/dijelovi/${id}/uredi`) }, '✏️ Uredi') : null,
    move: !sold && can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK') ? h('button', { onclick: () => act(() => moveDialog('parts', id)) }, '📍 Premjesti') : null,
    req: !sold && can('ROLE_REQ_C') ? h('button', { onclick: () => act(() => reqDialog([id])) }, '📋 Nalog') : null,
    sell: !sold && can('ROLE_SP_SALE') ? h('button.primary', { onclick: () => act(() => sellDialog('parts', p)) }, '💰 Prodaj') : null,
    ret: sold && can('ROLE_SP_SALE') ? h('button.primary', { onclick: () => act(() => returnDialog('parts', p)) }, '↩ Povrat') : null,
  };
  const more = [
    !sold ? h('button', { onclick: async () => { const { shareDialog } = await import('./share.js'); shareDialog(p); } }, '📤 Pošalji kupcu (Viber/WhatsApp)') : null,
    can('ROLE_SP_C') ? h('button', { onclick: async () => {
      const side = select('side', p.side, E.side, { placeholder: 'Ista strana' });
      await modal('Kopiraj dio', [h('p.muted', 'Napravi novi dio sa istim podacima (nova šifra).'), field('Strana', side)], [{ label: 'Odustani' }, { label: 'Kopiraj', primary: true, onClick: async () => { const r = await POST(`/api/parts/${id}/copy`, side.value ? { side: side.value } : {}); go('/dijelovi/' + r.id); } }]);
    } }, '⧉ Kopiraj (npr. druga strana)') : null,
    h('button', { onclick: () => printLabels([{ code: p.internal_code, title: p.title, sub: [p.catalog_number, p.location_code].filter(Boolean).join(' · ') }]) }, '🏷 Štampaj etiketu'),
    h('button', { onclick: () => adTextDialog('part', id) }, '📝 Tekst oglasa'),
    can('ROLE_SP_U') && !sold ? h('button', { onclick: async () => { const { suggestionDialog } = await import('./pricing.js'); if (await suggestionDialog(id, p.price)) reload(); } }, '💡 Prijedlog cijene') : null,
    state.lookups.olx_enabled && can('ROLE_SP_ADM') && !p.external_olx_id && !sold ? h('button', { onclick: () => run(() => POST(`/api/olx/publish/part/${id}`), 'Objavljeno na OLX').then(reload) }, '🌐 Objavi na OLX') : null,
    state.lookups.olx_enabled && can('ROLE_SP_ADM') && p.external_olx_id ? h('button', { onclick: () => run(() => POST(`/api/olx/remove/part/${id}`), 'Uklonjeno sa OLX').then(reload) }, '🌐 Ukloni sa OLX') : null,
    can('ROLE_SP_D') ? h('button.danger', { onclick: async () => { if (await confirmBox('Obrisati dio ' + p.internal_code + '?')) { await run(() => DEL('/api/parts/' + id), 'Obrisano'); go('/dijelovi'); } } }, '🗑 Obriši dio') : null,
  ];
  const actions = toolbar([B.sell || B.ret, B.req, B.move, B.edit], more);

  const info = kv([
    ['Šifra', h('span.code', p.internal_code)],
    ['Status', statusBadge(p.status)],
    ['Cijena', h('span', p.price ? h('span.price', fmtMoney(p.price, p.currency_id)) : h('span.muted', 'nije unesena'), can('ROLE_SP_U') && !sold ? h('button.sm', { style: { marginLeft: '8px' }, onclick: async () => {
      const pr = input('price', p.price ?? '', { type: 'number', step: '0.01', inputmode: 'decimal' });
      if (await modal('Cijena: ' + p.internal_code, [field('Nova cijena (KM)', pr)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => PUT('/api/parts/' + id, { price: pr.value === '' ? null : Number(pr.value), currency_id: p.currency_id || 'BAM' }) }])) reload();
    } }, '✏️') : null, can('ROLE_SP_U') && !sold ? h('button.sm', { style: { marginLeft: '4px' }, onclick: async () => { const { suggestionDialog } = await import('./pricing.js'); if (await suggestionDialog(id, p.price)) reload(); } }, '💡') : null)],
    ['Lokacija', p.location_id ? h('a', { href: '#/magacin/lokacija/' + p.location_id }, p.location_label) : '—'],
    ['Vrsta', p.type_title + (p.group_title ? ' (' + p.group_title + ')' : '')],
    ['Vozilo', p.model_label],
    ['Donor', p.vehicle_id ? h('a', { href: '#/vozila/' + p.vehicle_id }, '🚗 ' + p.vehicle_code) : null],
    ['Kataloški broj', p.catalog_number ? p.catalog_number : (p.catalog_number_damaged ? h('i.muted', 'nečitljiv/oštećen') : null)],
    ['Kat. br. proizvođača', p.catalog_number_manufacturer],
    ['Strana', E.side[p.side] || p.side],
    ['Godište', p.model_year],
    ['Gorivo', E.fuel[p.fuel_type] || p.fuel_type],
    ['Motor', [p.cylinder_capacity ? p.cylinder_capacity + ' ccm' : '', p.power ? p.power + ' kW' : '', p.engine_code].filter(Boolean).join(' · ')],
    ['Broj motora', p.engine_number],
    ['Mjenjač', [E.gearbox[p.gearbox_type], p.gearbox_speed ? p.gearbox_speed + ' br.' : '', p.gearbox_code].filter(Boolean).join(' · ')],
    ['Pogon', E.drive[p.drive_train]], ['Karoserija', E.body[p.vehicle_type]], ['Boja', p.color],
    ['Kilometraža', p.mileage ? p.mileage.toLocaleString('bs-BA') + ' km' : null], ['Broj šasije', p.chassis_number],
    ['Komplet', p.part_set ? 'Da' : null], ['Oštećen', p.damaged ? 'Da' : null], ['Napomena', p.note],
    ['Dio kompleta', p.parent ? h('a', { href: '#/dijelovi/' + p.parent.id }, p.parent.internal_code + ' ' + p.parent.title + (p.parent_detached ? ' (odvojen)' : '')) : null],
    ['OLX', p.external_olx_id ? h('a', { href: 'https://olx.ba/artikal/' + p.external_olx_id, target: '_blank' }, p.external_olx_id) : null],
    ['Unio', (p.created_by_name || '') + ' · ' + fmtDT(p.created_date)],
    ['Izmijenio', p.modified_date !== p.created_date ? (p.modified_by_name || '') + ' · ' + fmtDT(p.modified_date) : null],
  ]);

  let tab = 'loc';
  const tabBody = h('div');
  const renderTab = () => {
    const T = {
      loc: () => p.location_history.length ? h('table.tbl', h('tbody', p.location_history.map(r => h('tr', h('td', fmtDT(r.created_date)), h('td', r.action === 'IN' ? '➡ U' : '⬅ Iz'), h('td', h('a', { href: '#/magacin/lokacija/' + r.location_id }, r.code)), h('td.muted', r.user_name))))) : empty(),
      sale: () => p.sale_history.length ? h('table.tbl', h('tbody', p.sale_history.map(r => h('tr', h('td', fmtDT(r.created_date)), h('td', r.status === 'SOLD' ? badge('Prodaja', 'green') : badge('Povrat', 'red')), h('td.n', fmtMoney(r.the_price, r.currency_id)), h('td.muted', r.user_name), h('td.muted', r.note || ''))))) : empty(),
      req: () => p.requests.length ? h('table.tbl', h('tbody', p.requests.map(r => h('tr.click', { onclick: () => go('/nalozi/' + r.id) }, h('td', '#' + r.the_number), h('td', reqBadge(r.status)), h('td', fmtDT(r.created_date)), h('td.muted', r.created_by_name), h('td.muted', r.description || ''))))) : empty(),
      set: () => h('div',
        p.children.length ? h('table.tbl', h('tbody', p.children.map(c => h('tr.click', { onclick: () => go('/dijelovi/' + c.id) }, h('td', h('span.code', c.internal_code)), h('td', c.title), h('td', statusBadge(c.status)), h('td', c.parent_detached ? badge('odvojen') : ''))))) : empty('Nema pod-dijelova'),
        p.type_children.length && can('ROLE_SP_C') ? h('div', { style: { marginTop: '10px' } }, h('div.muted', 'Dodaj pod-dio kompleta:'), h('div.actions', p.type_children.map(t => h('button.sm', {
          onclick: async () => { const r = await run(() => POST('/api/parts', { vehicle_id: p.vehicle_id, make_id: p.make_id, model_id: p.model_id, model_year: p.model_year, type_id: t.id, side: p.side, parent_id: id, catalog_number_damaged: true, location_id: p.location_id }), 'Pod-dio dodat'); go('/dijelovi/' + r.id); },
        }, '+ ' + t.title)))) : null,
        p.parent && can('ROLE_SP_U') ? h('button', { style: { marginTop: '10px' }, onclick: () => run(() => POST(`/api/parts/${id}/detach`, { detached: !p.parent_detached }), 'Sačuvano').then(reload) }, p.parent_detached ? 'Vrati u komplet' : 'Odvoji od kompleta') : null),
    };
    clear(tabBody, tabs([['loc', 'Lokacije'], ['sale', `Prodaja (${p.sale_history.length})`], ['req', `Nalozi (${p.requests.length})`], ['set', `Komplet (${p.children.length})`]], tab, k => { tab = k; renderTab(); }), T[tab]());
  };
  renderTab();

  const demandBox = h('div');
  if (!sold) GET('/api/demand/for-part/' + id).then(ds => {
    if (!ds.length) return;
    clear(demandBox, h('div.card', { style: { borderLeft: '5px solid var(--ok)', background: 'var(--okl)' } },
      h('b', `📝 Ovaj dio su tražili kupci (${ds.length}) — nazovite ih:`),
      ds.map(d => h('div', { style: { marginTop: '4px' } }, h('b', d.customer_name || 'kupac'), ' ', d.phone ? h('a', { href: 'tel:' + d.phone.replace(/[^\d+]/g, '') }, '📞 ' + d.phone) : '', h('span.muted', ' · ' + fmtDate(d.created_date) + (d.note ? ' · ' + d.note : '')),
        h('button.sm', { style: { marginLeft: '8px' }, onclick: () => run(() => PUT('/api/demand/' + d.id, { status: 'NOTIFIED', matched_part_id: id }), 'Označeno').then(reload) }, '📞 Javio sam')))));
  }).catch(() => {});
  return h('div',
    demandBox,
    h('div.art-head', h('button.icon', { onclick: () => history.back() }, '←'), h('span.code', p.internal_code),
      h('div.ttl', h('h1', p.title), h('div.muted', [p.type_title, p.catalog_number ? 'Kat. br. ' + p.catalog_number : '', p.location_code ? '📍 ' + p.location_code : ''].filter(Boolean).join(' · '))),
      h('div', { style: { textAlign: 'right' } }, p.price ? h('div.price', fmtMoney(p.price, p.currency_id)) : null, statusBadge(p.status))),
    actions,
    h('div.grid2',
      h('div.card', gallery(p.images, { type: 'SPARE_PART', objectId: id, canEdit: can('ROLE_SP_U', 'ROLE_SP_C', 'ROLE_USR_LIB_UP'), onChange: reload })),
      h('div.card', info)),
    h('div.card', tabBody));
});

route('/dijelovi/:id/uredi', async ({ id }, query, main) => partForm(await GET('/api/parts/' + id), query, main));

// ---------- Forma (novi / izmjena) ----------
let vehiclesCache = null, vehiclesAt = 0;
async function vehicleItems() {
  if (!vehiclesCache || Date.now() - vehiclesAt > 60000) { vehiclesCache = (await GET('/api/vehicles?limit=500')).rows; vehiclesAt = Date.now(); }
  return vehiclesCache.map(v => ({ value: v.id, label: `${v.internal_code} · ${v.model_label} ${v.model_year}`, sub: [E.fuel[v.fuel_type], v.engine_code, v.chassis_number].filter(Boolean).join(' · '), v }));
}

async function partForm(p, query, main) {
  const L = await lookups();
  const isNew = !p;
  p = p || { make_id: query.make_id, model_id: query.model_id, vehicle_id: query.vehicle_id, currency_id: L.currency };
  let lastCreated = null;
  const form = h('form.card', { onsubmit: e => e.preventDefault() });
  const vItems = await vehicleItems();
  const vehC = combo('vehicle_id', p.vehicle_id, vItems, { placeholder: 'Izaberi vozilo-donora (šifra, model, VIN)…' });
  const makeC = combo('make_id', p.make_id, makeItems(L), { placeholder: 'Marka' });
  const modelC = combo('model_id', p.model_id, p.make_id ? modelItems(await models(p.make_id)) : [], { placeholder: 'Model' });
  const typeC = combo('type_id', p.type_id, typeItems(L), { placeholder: 'npr. FAR, ALTERNATOR, VRATA…' });
  const sideS = select('side', p.side, E.side);
  const children = h('div.full', { style: { gridColumn: '1 / -1' } });
  const F = {};
  const mk = (name, el) => (F[name] = el);
  const engineFields = [
    field('Gorivo', mk('fuel_type', select('fuel_type', p.fuel_type, E.fuel))),
    field('Kubikaža (ccm)', mk('cylinder_capacity', input('cylinder_capacity', p.cylinder_capacity, { type: 'number', inputmode: 'numeric' }))),
    field('Snaga (kW)', mk('power', input('power', p.power, { type: 'number', inputmode: 'numeric' }))),
    field('Oznaka motora', mk('engine_code', input('engine_code', p.engine_code, { maxlength: 10, style: { textTransform: 'uppercase' } }))),
    h('div.field', { 'data-eng-no': 1 }, h('span', 'Broj motora'), mk('engine_number', input('engine_number', p.engine_number, { maxlength: 20 }))),
    field('Mjenjač', mk('gearbox_type', select('gearbox_type', p.gearbox_type, E.gearbox))),
    field('Broj brzina', mk('gearbox_speed', input('gearbox_speed', p.gearbox_speed, { type: 'number' }))),
    field('Oznaka mjenjača', mk('gearbox_code', input('gearbox_code', p.gearbox_code, { maxlength: 10, style: { textTransform: 'uppercase' } }))),
    field('Pogon', mk('drive_train', select('drive_train', p.drive_train, E.drive))),
    field('Karoserija', mk('vehicle_type', select('vehicle_type', p.vehicle_type, E.body))),
    field('Boja', mk('color', input('color', p.color, { maxlength: 20 }))),
    field('Kilometraža', mk('mileage', input('mileage', p.mileage, { type: 'number' }))),
    field('Broj šasije (VIN)', mk('chassis_number', input('chassis_number', p.chassis_number, { maxlength: 17, style: { textTransform: 'uppercase' } }))),
  ];
  const yearI = input('model_year', p.model_year, { type: 'number', inputmode: 'numeric', min: 1950, max: 2100 });
  const catI = input('catalog_number', p.catalog_number, { maxlength: 50, style: { textTransform: 'uppercase' } });
  const catReq = h('b.req', ' *');
  const partSet = check('part_set', p.part_set, 'Komplet (set)');
  const priceI = input('price', p.price, { type: 'number', step: '0.01', inputmode: 'decimal' });
  const priceHint = h('small.muted', { style: { minHeight: '16px' } });
  let ph;
  const updHint = () => { clearTimeout(ph); ph = setTimeout(async () => {
    const tId = typeC.value, mId = modelC.value; if (!tId) { priceHint.textContent = ''; return; }
    const s = await GET('/api/pricing/preview?' + qs({ type_id: tId, model_id: mId, make_id: makeC.value, catalog_number: catI.value, model_year: yearI.value, damaged: form.querySelector('[name=damaged]')?.checked ? 1 : '' }));
    clear(priceHint, s.price ? h('a', { href: '#', onclick: e => { e.preventDefault(); priceI.value = s.price; } }, `💡 prijedlog ${s.price} KM`, h('span', ` (${s.n} prod., ${s.basis}) — klikni za upis`)) : '');
  }, 400); };
  const loc = isNew ? locationInput('location_code', { placeholder: L.default_location ? 'prazno = ' + L.default_location.label.split(' / ').pop() : 'P123' }) : null;

  const fillVehicle = v => {
    if (!v) return;
    makeC.value = v.make_id;
    models(v.make_id).then(ms => { modelC.setItems(modelItems(ms)); modelC.value = v.model_id; });
    yearI.value = v.model_year || '';
    for (const k of ['fuel_type', 'cylinder_capacity', 'power', 'engine_code', 'gearbox_type', 'drive_train', 'chassis_number']) if (F[k] && v[k] != null && !F[k].value) F[k].value = v[k];
    if (F.vehicle_type && !F.vehicle_type.value && v.the_type) F.vehicle_type.value = v.the_type;
  };
  vehC.addEventListener('change', async e => {
    const it = e.detail; if (!it) return;
    const full = await GET('/api/vehicles/' + it.value);
    fillVehicle(full);
  });
  makeC.addEventListener('change', async () => modelC.setItems(modelItems(await models(makeC.value))));
  const applyType = () => {
    const t = L.types.find(x => x.id === typeC.value);
    const sides = t?.sides ? t.sides.split(';') : null;
    const cur = sideS.value;
    clear(sideS, h('option', { value: '' }, '—'), Object.entries(E.side).filter(([k]) => !sides || sides.includes(k)).map(([k, l]) => h('option', { value: k }, l)));
    sideS.value = cur;
    sideS.closest('.field').style.display = sides || cur ? '' : 'none';
    const g = L.groups.find(x => x.id === t?.group_id);
    catReq.style.display = (t?.catalog_number_required ?? g?.catalog_number_required) ? '' : 'none';
    partSet.style.display = t?.part_set_visible || p.part_set ? '' : 'none';
    const engNo = form.querySelector('[data-eng-no]'); if (engNo) engNo.style.display = t?.engine_number_visible || p.engine_number ? '' : 'none';
    clear(children);
    if (isNew && t?.children?.length) {
      children.append(h('div.sect', 'Pod-dijelovi kompleta (kreiraju se zajedno)'), h('div.chips', t.children.map(cid => {
        const ct = L.types.find(x => x.id === cid); if (!ct) return null;
        return h('label.check', h('input', { type: 'checkbox', 'data-child': cid, 'data-skip': '1' }), ct.title);
      })));
    }
    // podaci sa vozila po pravilima vrste
    if (vehC.value && t) {
      const v = vItems.find(x => x.value === vehC.value)?.v;
      if (v && (t.share_gearbox_data || g?.share_gearbox_data) && !F.gearbox_type.value) F.gearbox_type.value = v.gearbox_type || '';
    }
  };
  typeC.addEventListener('change', applyType);
  for (const el of [typeC, modelC, makeC, catI, yearI]) el.addEventListener('change', updHint);

  const save = async (next) => {
    const d = formData(form);
    if (d.engine_code) d.engine_code = d.engine_code.toUpperCase();
    if (d.gearbox_code) d.gearbox_code = d.gearbox_code.toUpperCase();
    if (d.catalog_number) d.catalog_number = d.catalog_number.toUpperCase().trim();
    if (d.chassis_number) d.chassis_number = d.chassis_number.toUpperCase();
    if (!d.catalog_number_damaged) d.catalog_number_damaged = false;
    if (isNew) d.children = [...form.querySelectorAll('[data-child]:checked')].map(c => ({ type_id: c.dataset.child }));
    if (isNew) {
      const r = await run(() => POST('/api/parts', d));
      GET('/api/demand/for-part/' + r.id).then(ds => { if (ds.length) toast(`📝 Ovaj dio je tražilo ${ds.length} kupaca — pogledajte na dijelu!`); }).catch(() => {});
      if (next) {
        const np = await GET('/api/parts/' + r.id);
        lastCreated = np;
        toast('Sačuvano: ' + np.internal_code);
        // zadrži vozilo/marku/model/motor, očisti podatke o dijelu
        for (const k of ['catalog_number', 'catalog_number_manufacturer', 'price', 'note']) { const el = form.querySelector(`[name=${k}]`); if (el) el.value = ''; }
        form.querySelector('[name=catalog_number_damaged]').checked = false;
        sideS.value = ''; typeC.value = ''; applyType();
        renderLast();
        typeC.input.focus();
        window.scrollTo(0, 0);
      } else go('/dijelovi/' + r.id);
    } else {
      await run(() => PUT('/api/parts/' + p.id, d), 'Sačuvano');
      go('/dijelovi/' + p.id);
    }
  };
  const lastBox = h('div');
  const renderLast = () => {
    if (!lastCreated) return clear(lastBox);
    const fi = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: { display: 'none' } });
    fi.onchange = () => run(() => uploadImages('SPARE_PART', lastCreated.id, [...fi.files]), 'Slike dodate');
    clear(lastBox, h('div.card', { style: { background: 'var(--gl)' } }, h('div.row',
      h('div.grow', 'Zadnji sačuvan: ', h('a', { href: '#/dijelovi/' + lastCreated.id }, h('span.code', lastCreated.internal_code), ' ', lastCreated.title)),
      h('button', { onclick: () => fi.click() }, '📷 Slikaj'), h('button', { onclick: () => printLabels([{ code: lastCreated.internal_code, title: lastCreated.title, sub: lastCreated.location_code }]) }, '🏷 Etiketa'), fi)));
  };

  clear(form,
    h('div.grid',
      h('div.sect', 'Vozilo'),
      field('Vozilo-donor', vehC, { wide: true }),
      field('Marka', makeC, { req: true }), field('Model', modelC, { req: true, wide: true }), field('Godište', yearI),
      h('div.sect', 'Dio'),
      field('Vrsta dijela', typeC, { req: true, wide: true }), field('Strana', sideS),
      h('div.field', h('span', 'Kataloški broj', catReq), h('div.row', { style: { flexWrap: 'nowrap', gap: '4px' } }, catI,
        h('button', { type: 'button', title: 'Pročitaj sa slike naljepnice', onclick: async () => { const n = await readCatalogFromPhoto(); if (n) { catI.value = n.toUpperCase(); catI.dispatchEvent(new Event('change')); toast('Upisano: ' + n); } } }, '📷'))),
      h('div.field', h('span', ' '), check('catalog_number_damaged', p.catalog_number_damaged, 'Kat. broj nečitljiv/oštećen')),
      field('Kat. broj proizvođača', input('catalog_number_manufacturer', p.catalog_number_manufacturer, { maxlength: 100 })),
      h('label.field', h('span', 'Cijena'), priceI, priceHint), field('Valuta', select('currency_id', p.currency_id || L.currency, L.currencies.map(c => ({ value: c, label: c === 'BAM' ? 'KM (BAM)' : c })), { empty: false })),
      h('div.field', h('span', ' '), h('div.row', partSet, check('damaged', p.damaged, 'Oštećen'))),
      field('Napomena', textarea('note', p.note, { rows: 2 }), { full: true }),
      children,
      loc ? h('div.sect', 'Lokacija') : null,
      loc ? field('Lokacija', loc) : null,
      h('div.sect', 'Motor, mjenjač i ostalo'),
      engineFields),
    h('div.sticky-actions',
      h('button', { type: 'button', onclick: () => history.back() }, 'Odustani'),
      isNew ? h('button', { type: 'button', onclick: () => save(true) }, '💾 Sačuvaj + sljedeći') : null,
      h('button.primary', { type: 'button', onclick: () => save(false) }, '💾 Sačuvaj')));
  applyType(); updHint();
  return h('div', h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', isNew ? 'Novi dio' : 'Izmjena: ' + p.internal_code)), lastBox, form);
}
