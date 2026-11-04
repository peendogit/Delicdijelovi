import { h, clear, route, GET, POST, PUT, DEL, qs, go, can, img, beep, fmtDT, fmtMoney, field, input, textarea, check, modal, confirmBox, toast, run, kv, badge, reqBadge, pager, tabs, loading, empty, setQuery , refresh, toolbarN, fab } from '../lib.js';

async function closeDialog(r) {
  const sell = check('sell', false, 'Odmah evidentiraj prodaju');
  const price = input('price', r.part_price ?? '', { type: 'number', step: '0.01' });
  const pf = field('Prodajna cijena', price); pf.style.display = 'none';
  sell.querySelector('input').onchange = e => (pf.style.display = e.target.checked ? '' : 'none');
  return modal('Zatvori nalog #' + r.the_number, [h('p', 'Dio je donesen na pult — premješta se na lokaciju za izdavanje.'), can('ROLE_SP_SALE') ? sell : null, pf], [{ label: 'Odustani' }, {
    label: '✔ Zatvori', primary: true, onClick: () => POST(`/api/req/${r.id}/close`, { sell: sell.querySelector('input').checked, price: price.value }),
  }]);
}

function reqCard(r, reload) {
  const active = r.status === 'NEW' || r.status === 'PREPARED';
  return h('div.item' + (r.urgent && active ? '.urgent' : ''), { onclick: e => { if (!e.target.closest('button')) go('/nalozi/' + r.id); } },
    h('img.th', { src: img(r.image_id), loading: 'lazy' }),
    h('div.bd',
      h('div.t', '#' + r.the_number + ' · ' + (r.part_title || (r.rims_code ? 'Felne ' + r.rims_code : ''))),
      h('div.s', h('span.code', r.part_code || r.rims_code || ''), r.current_location_code ? h('b', { style: { color: 'var(--tx)' } }, '📍 ' + r.current_location_code) : null,
        r.urgent ? badge('HITNO', 'red') : null, r.shipment ? badge('Slanje', 'blue') : null, h('span', r.created_by_name), h('span', fmtDT(r.created_date))),
      r.description ? h('div.s', { style: { color: 'var(--tx)' } }, '💬 ' + r.description) : null,
      r.location_label && active ? h('div.s', r.location_label) : null),
    h('div.rt', reqBadge(r.status),
      active && can('ROLE_REQ_ST', 'ROLE_WHS_CLERK') && r.status === 'NEW' ? h('button.sm', { onclick: () => run(() => POST(`/api/req/${r.id}/prepare`), 'Preuzeto').then(reload) }, '✋ Preuzmi') : null,
      active && can('ROLE_REQ_ST', 'ROLE_WHS_CLERK') ? h('button.sm.primary', { onclick: async () => { if (await closeDialog(r)) reload(); } }, '✔ Donesen') : null));
}

route('/nalozi', async (params, query, main) => {
  const q = { status: 'ACTIVE', offset: 0, ...query }; q.offset = Number(q.offset) || 0;
  const res = h('div');
  let seen = null;
  const load = async () => {
    setQuery(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !(k === 'status' && v === 'ACTIVE'))));
    clear(res, loading());
    const d = await GET('/api/req?' + qs({ ...q, limit: 100 }));
    // zvuk + vibracija kad stigne novi nalog (za magacionera)
    const newIds = d.rows.filter(r => r.status === 'NEW').map(r => r.id);
    if (seen && newIds.some(id => !seen.has(id))) { beep(); navigator.vibrate?.([200, 100, 200]); toast('Stigao novi nalog!'); }
    seen = new Set(newIds);
    clear(res, h('div.card.p0', h('div.list', d.rows.length ? d.rows.map(r => reqCard(r, load)) : empty('Nema naloga'))), pager(d.total, q.offset, 100, o => { q.offset = o; load(); }));
  };
  const s = input('q', q.q, { type: 'search', placeholder: 'Broj naloga, šifra dijela, napomena…' });
  let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { q.q = s.value.trim(); q.offset = 0; load(); }, 400); };
  const tabBox = h('div');
  const renderTabs = () => clear(tabBox, tabs([['ACTIVE', 'Aktivni'], ['NEW', 'Novi'], ['PREPARED', 'U realizaciji'], ['CLOSED', 'Zatvoreni'], ['ALL', 'Svi']], q.status, k => { q.status = k; q.offset = 0; renderTabs(); load(); }));
  renderTabs();
  const mine = h('label.check', h('input', { type: 'checkbox', checked: q.mine === '1', onchange: e => { q.mine = e.target.checked ? '1' : ''; load(); } }), 'Samo moji');
  clear(main, h('div', h('div.head', h('h1', 'Nalozi'), h('button', { onclick: load }, '⟳ Osvježi')), h('div.card', h('div.row', h('div.grow', s), mine)), tabBox, res));
  load();
  // automatsko osvježavanje aktivnih naloga svakih 30 s
  const iv = setInterval(() => { if (!document.body.contains(res)) return clearInterval(iv); if (q.status === 'ACTIVE' && !document.querySelector('.modal-bg')) load(); }, 20000);
});

route('/nalozi/:id', async ({ id }) => {
  const r = await GET('/api/req/' + id);
  const reload = () => refresh();
  const active = r.status === 'NEW' || r.status === 'PREPARED';
  return h('div',
    h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', 'Nalog #' + r.the_number), reqBadge(r.status)),
    toolbarN(2,
      active && r.status === 'NEW' && can('ROLE_REQ_ST', 'ROLE_WHS_CLERK') ? h('button', { onclick: () => run(() => POST(`/api/req/${id}/prepare`), 'Preuzeto').then(reload) }, '✋ Preuzmi') : null,
      active && can('ROLE_REQ_ST', 'ROLE_WHS_CLERK') ? h('button.primary', { onclick: async () => { if (await closeDialog(r)) reload(); } }, '✔ Donesen / zatvori') : null,
      !active && can('ROLE_REQ_ST') ? h('button', { onclick: () => run(() => POST(`/api/req/${id}/reopen`), 'Ponovo otvoren').then(reload) }, '↺ Ponovo otvori') : null,
      active && can('ROLE_REQ_U', 'ROLE_REQ_C') ? h('button', { onclick: async () => {
        const d = textarea('description', r.description), u = check('urgent', r.urgent, 'Hitno'), s = check('shipment', r.shipment, 'Za slanje');
        if (await modal('Izmjena naloga', [u, s, field('Napomena', d)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => PUT('/api/req/' + id, { description: d.value, urgent: u.querySelector('input').checked, shipment: s.querySelector('input').checked }) }])) reload();
      } }, '✏️ Uredi') : null,
      active && can('ROLE_REQ_U', 'ROLE_REQ_C') ? h('button.danger', { onclick: async () => { if (await confirmBox('Otkazati nalog #' + r.the_number + '?')) { await run(() => DEL('/api/req/' + id), 'Nalog otkazan'); go('/nalozi'); } } }, '✖ Otkaži nalog') : null),
    h('div.card', h('div.row', { style: { alignItems: 'flex-start' } }, h('img', { src: img(r.image_id), style: { width: '120px', height: '120px', objectFit: 'cover', borderRadius: '10px' } }),
      h('div.grow', kv([
        ['Dio', r.part_id ? h('a', { href: '#/dijelovi/' + r.part_id }, h('span.code', r.part_code), ' ', r.part_title) : r.rims_id ? h('a', { href: '#/felne/' + r.rims_id }, 'Felne ' + r.rims_code) : null],
        ['Kataloški broj', r.catalog_number], ['Cijena', r.part_price ? fmtMoney(r.part_price) : null],
        ['Trenutna lokacija', r.location_label ? h('b', r.location_label) : '—'], ['Lokacija pri kreiranju', r.location_code],
        ['Hitno', r.urgent ? badge('HITNO', 'red') : 'Ne'], ['Slanje', r.shipment ? 'Da (brza pošta)' : 'Ne'], ['Napomena', r.description],
        ['Kreirao', r.created_by_name + ' · ' + fmtDT(r.created_date)], ['Preuzeo', r.realization_by_name ? r.realization_by_name + ' · ' + fmtDT(r.realization_date) : null],
        ['Zatvorio', r.closed_by_name ? r.closed_by_name + ' · ' + fmtDT(r.closed_date) : null]])))),
    r.group.length > 1 ? h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', `Zajednički nalog (${r.group.length} dijelova)`)), h('div.list', r.group.map(x => reqCard(x, reload)))) : null);
});
