import { h, clear, route, GET, POST, PUT, DEL, go, can, state, lookups, img, fmtDT, fmtMoney, field, input, select, check, modal, confirmBox, toast, run, badge, loading, empty, printLabels, tabs, scanBarcode, canScan , refresh, toolbarN } from '../lib.js';
import { partItem } from './parts.js';

let typesCache = null;
const types = async () => (typesCache ||= await GET('/api/whs-types'));

route('/magacin', async () => {
  const list = await GET('/api/whs');
  const find = input('code', '', { placeholder: 'Pronađi lokaciju (P123, K45, R3…)', style: { textTransform: 'uppercase' } });
  const res = h('div.list');
  let t; find.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    if (!find.value.trim()) return clear(res);
    const r = await GET('/api/assets/find?code=' + encodeURIComponent(find.value.trim()));
    clear(res, r.map(a => h('a.item', { href: '#/magacin/lokacija/' + a.id }, h('div.bd', h('div.t', a.code_extended + ' · ' + a.type_title), h('div.s', a.label)))));
  }, 250); };
  return h('div',
    h('div.head', h('h1', 'Magacin'),
      can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK') ? h('button.primary', { onclick: () => go('/premjestanje') }, '📦 Premještanje') : null,
      can('ROLE_WHS_C') ? h('button', { onclick: async () => {
        const n = input('title', '');
        if (await modal('Novi magacin', [field('Naziv', n)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => POST('/api/whs', { title: n.value }) }])) refresh();
      } }, '+ Magacin') : null),
    h('div.card', find, res),
    h('div.tiles', list.map(w => h('div.tile', { onclick: () => go('/magacin/m/' + w.id) }, h('b', w.title), h('small', `${w.parts.toLocaleString('bs-BA')} dijelova · ${w.assets} lok.`)))));
});

function addAssetDialog(whsId, parent, allowed) {
  const T = typesCache;
  const opts = T.filter(t => allowed.includes(t.id));
  if (!opts.length) { toast('Ovdje se ne mogu dodavati pod-lokacije', 'err'); return null; }
  const ts = select('ast_type_id', opts[0].id, opts.map(t => ({ value: t.id, label: t.title + (t.code ? ` (${t.code}…)` : '') })), { empty: false });
  const cnt = input('count', 1, { type: 'number', min: 1, max: 200 });
  const add = input('additional_code', '', { maxlength: 3, placeholder: 'npr. B (opciono)' });
  const addF = field('Dodatna oznaka (nivo)', add);
  const upd = () => { addF.style.display = T.find(t => t.id === ts.value)?.code_edit_allowed ? '' : 'none'; };
  ts.onchange = upd; upd();
  return modal('Nova lokacija' + (parent ? ' u ' + parent.code_extended : ''), [field('Tip', ts), field('Koliko komada', cnt), addF, h('p.muted', 'Kod se dodjeljuje automatski (sljedeći slobodan broj).')], [{ label: 'Odustani' }, {
    label: 'Kreiraj', primary: true,
    onClick: async () => { const r = await POST('/api/assets', { whs_id: whsId, parent_id: parent?.id, ast_type_id: ts.value, count: cnt.value, additional_code: add.value }); toast('Kreirano: ' + r.created.map(c => c.code_extended).join(', ')); return r; },
  }]);
}

const tile = a => h('div.tile', { onclick: () => go('/magacin/lokacija/' + a.id) }, h('b', a.code_extended), h('small', a.type_title), h('small', { style: { display: 'block' } },
  [a.children ? a.children + ' lok.' : '', a.parts ? a.parts + ' dij.' : '', a.rims ? a.rims + ' fel.' : ''].filter(Boolean).join(' · ') || 'prazno'));

route('/magacin/m/:id', async ({ id }) => {
  await types();
  const [ws, roots] = await Promise.all([GET('/api/whs'), GET('/api/assets?whs_id=' + id)]);
  const w = ws.find(x => x.id === id);
  if (!w) return h('div.empty', 'Magacin ne postoji');
  const reload = () => refresh();
  return h('div',
    h('div.head', h('button.icon', { onclick: () => go('/magacin') }, '←'), h('h1', w.title),
      can('ROLE_WHS_C', 'ROLE_WHS_U') ? h('button', { onclick: async () => { if (await addAssetDialog(id, null, typesCache.filter(t => t.base).map(t => t.id))) reload(); } }, '+ Lokacija') : null,
      can('ROLE_WHS_U') ? h('button', { onclick: async () => { const n = input('title', w.title); if (await modal('Preimenuj magacin', [field('Naziv', n)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => PUT('/api/whs/' + id, { title: n.value }) }])) reload(); } }, '✏️') : null,
      can('ROLE_WHS_D') ? h('button.danger', { onclick: async () => { if (await confirmBox('Obrisati magacin ' + w.title + '?')) { await run(() => DEL('/api/whs/' + id), 'Obrisano'); go('/magacin'); } } }, '🗑') : null),
    h('p.muted', `${w.parts.toLocaleString('bs-BA')} dijelova na stanju · ${w.assets} lokacija`),
    roots.length ? h('div.tiles', roots.map(tile)) : h('div.empty', 'Nema lokacija'));
});

route('/magacin/lokacija/:id', async ({ id }, query) => {
  await types();
  const deep = query.deep === '1';
  const a = await GET('/api/assets/' + id + (deep ? '?deep=1' : ''));
  const reload = () => refresh();
  const tp = typesCache.find(t => t.id === a.ast_type_id);
  const pathIds = (a.path || '').split('/').filter(Boolean);
  const crumbs = h('div.tree-path', h('a', { href: '#/magacin/m/' + a.whs_id }, a.whs_title), a.label.split(' / ').slice(1).map((c, i) => [' › ', h('a', { href: '#/magacin/lokacija/' + pathIds[i] }, c)]));
  const actions = toolbarN(3,
    can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK') && a.parts_allowed ? h('button.primary', { onclick: () => go('/premjestanje?loc=' + encodeURIComponent(a.code_extended)) }, '📦 Stavi dijelove ovdje') : null,
    can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK', 'ROLE_WHS_R') && a.parts_allowed ? h('button', { onclick: () => go('/inventura?loc=' + encodeURIComponent(a.code_extended)) }, '✅ Inventura') : null,
    can('ROLE_WHS_C', 'ROLE_WHS_U') && tp?.children?.length ? h('button', { onclick: async () => { if (await addAssetDialog(a.whs_id, a, tp.children)) reload(); } }, '+ Pod-lokacija') : null,
    can('ROLE_WHS_U', 'ROLE_WHS_CLERK') && a.move_allowed ? h('button', { onclick: async () => {
      const c = input('parent_code', '', { placeholder: 'npr. P120', style: { textTransform: 'uppercase' } });
      if (await modal('Premjesti ' + a.code_extended, [field('Nova nadređena lokacija', c)], [{ label: 'Odustani' }, { label: 'Premjesti', primary: true, onClick: () => POST(`/api/assets/${id}/move`, { parent_code: c.value }) }])) reload();
    } }, '↔ Premjesti ' + a.type_title.toLowerCase()) : null,
    can('ROLE_WHS_U') && (a.code_edit_allowed || a.height_details_allowed) ? h('button', { onclick: async () => {
      const add = input('additional_code', a.additional_code, { maxlength: 3 });
      const l1 = check('ladder_first_level', a.ladder_first_level, 'Potrebne merdevine (1. nivo)'), l2 = check('ladder_second_level', a.ladder_second_level, 'Potrebne merdevine (2. nivo)'), fl = check('forklift', a.forklift, 'Potreban viljuškar');
      if (await modal('Izmjena ' + a.code_extended, [a.code_edit_allowed ? field('Dodatna oznaka', add) : null, l1, l2, fl], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => PUT('/api/assets/' + id, { additional_code: add.value, ladder_first_level: l1.querySelector('input').checked, ladder_second_level: l2.querySelector('input').checked, forklift: fl.querySelector('input').checked }) }])) reload();
    } }, '✏️ Uredi') : null,
    h('button', { onclick: () => printLabels([{ code: a.code_extended, title: a.label, sub: a.type_title }, ...a.children.map(c => ({ code: c.code_extended, title: a.label + ' / ' + c.code_extended, sub: c.type_title }))]) }, '🏷 Etikete'),
    can('ROLE_WHS_D') ? h('button.danger', { onclick: async () => { if (await confirmBox('Obrisati lokaciju ' + a.code_extended + '?')) { await run(() => DEL('/api/assets/' + id), 'Obrisano'); history.back(); } } }, '🗑') : null);
  const flags = [a.ladder_first_level ? '🪜 merdevine 1' : '', a.ladder_second_level ? '🪜 merdevine 2' : '', a.forklift ? '🚜 viljuškar' : ''].filter(Boolean).join(' · ');
  return h('div',
    h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', a.code_extended + ' · ' + a.type_title)),
    crumbs, flags ? h('p.muted', flags) : null,
    actions,
    a.children.length ? h('div.card', h('h2', 'Pod-lokacije (' + a.children.length + ')'), h('div.tiles', a.children.map(tile))) : null,
    h('div.card.p0', h('div.row', { style: { padding: '12px 14px 4px' } }, h('h2.grow', { style: { margin: 0 } }, `Dijelovi (${a.parts.length})`),
      a.children.length ? h('label.check', h('input', { type: 'checkbox', checked: deep, onchange: e => go('/magacin/lokacija/' + id + (e.target.checked ? '?deep=1' : '')) }), 'uključi pod-lokacije') : null),
      h('div.list', a.parts.length ? a.parts.map(p => partItem(p)) : empty('Nema dijelova'))),
    a.rims.length ? h('div.card', h('h2', 'Felne'), h('div.chips', a.rims.map(r => h('a.chip', { href: '#/felne/' + r.id }, r.internal_code)))) : null,
    a.history.length ? h('div.card', h('h2', 'Istorija premještanja'), h('table.tbl', h('tbody', a.history.map(x => h('tr', h('td', fmtDT(x.created_date)), h('td', '➡ ' + x.parent_code), h('td.muted', x.user_name)))))) : null);
});

// polje + dugme za skeniranje kamerom
export function withScan(inp, after) {
  if (!canScan()) return inp;
  return h('div.row', { style: { flexWrap: 'nowrap' } }, h('div.grow', inp), h('button', { style: { minHeight: '54px', fontSize: '22px' }, onclick: async () => { const c = await scanBarcode(); if (c) { inp.value = c.toUpperCase(); after?.(); } } }, '📷'));
}

// ---------- Premještanje (magacioner) ----------
route('/premjestanje', async (params, query) => {
  const locI = input('loc', query.loc || '', { placeholder: 'Lokacija: P123', class: 'big-input', autocapitalize: 'characters' });
  const codeI = input('code', '', { placeholder: 'Šifra dijela / felne', class: 'big-input', autocapitalize: 'characters' });
  const locInfo = h('div.muted', { style: { textAlign: 'center', minHeight: '20px' } });
  const log = h('div.list');
  let locId = null, n = 0;
  const checkLoc = async () => {
    locId = null; const c = locI.value.trim().toUpperCase();
    if (!c) return (locInfo.textContent = '');
    const r = (await GET('/api/assets/find?code=' + encodeURIComponent(c))).filter(x => x.parts_allowed && x.code_extended.toUpperCase() === c);
    if (r.length === 1) { locId = r[0].id; locInfo.textContent = '✔ ' + r[0].label; locInfo.className = 'res-ok'; codeI.focus(); }
    else { locInfo.textContent = r.length ? 'Kod nije jedinstven' : '✖ Lokacija ne postoji'; locInfo.className = 'res-err'; }
  };
  locI.addEventListener('change', checkLoc);
  locI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkLoc(); } });
  const move = async () => {
    const c = codeI.value.trim().toUpperCase(); if (!c) return;
    codeI.value = '';
    if (!locId) { toast('Prvo unesite ispravnu lokaciju', 'err'); locI.focus(); return; }
    let line;
    try {
      if (/^F\d+$/.test(c)) {
        const r = await GET('/api/rims/by-code/' + c);
        await POST(`/api/rims/${r.id}/move`, { location_id: locId });
        line = h('div.item', h('div.bd', h('div.t.res-ok', '✔ ' + c + ' · ' + r.title), h('div.s', '➡ ' + locI.value.toUpperCase())));
      } else if (/^(K|PL)\d+[A-Z]?$/.test(c)) {
        const as = (await GET('/api/assets/find?code=' + c)).find(x => x.code_extended.toUpperCase() === c);
        if (!as) throw new Error('Kutija/paleta ' + c + ' ne postoji');
        await POST(`/api/assets/${as.id}/move`, { parent_id: locId });
        line = h('div.item', h('div.bd', h('div.t.res-ok', '✔ ' + c + ' (' + as.type_title + ') premještena'), h('div.s', '➡ ' + locI.value.toUpperCase())));
      } else {
        const r = await POST('/api/parts/move-bulk', { location_id: locId, codes: [c] });
        const x = r.results[0];
        if (!x.ok) throw new Error(c + ': ' + x.msg);
        line = h('div.item', h('div.bd', h('div.t.res-ok', '✔ ' + c + ' · ' + x.title), h('div.s', '➡ ' + r.location_label)));
      }
      n++;
    } catch (e) {
      line = h('div.item', h('div.bd', h('div.t.res-err', '✖ ' + e.message)));
      navigator.vibrate?.(300);
    }
    log.prepend(line);
    counter.textContent = `Premješteno: ${n}`;
    codeI.focus();
  };
  codeI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); move(); } });
  const counter = h('b');
  if (query.loc) setTimeout(checkLoc, 50); else setTimeout(() => locI.focus(), 50);
  return h('div',
    h('div.head', h('h1', 'Premještanje dijelova')),
    h('div.card', h('p.muted', '1) Unesite lokaciju (policu/kutiju/paletu). 2) Unosite šifre dijelova jednu po jednu i pritisnite Enter — svaki dio se odmah premješta. Felne (F123) i kutije/palete (K12, PL3) takođe rade.'),
      field('Lokacija', withScan(locI, checkLoc)), locInfo, field('Šifra', withScan(codeI, move)), h('button.primary', { onclick: move, style: { width: '100%', marginTop: '8px' } }, 'Premjesti')),
    h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, counter), log));
});

// ---------- Inventura police/kutije: skeniraj sve što fizički jeste na lokaciji ----------
route('/inventura', async (params, query) => {
  const locI = input('loc', query.loc || '', { placeholder: 'Lokacija: P123', class: 'big-input', autocapitalize: 'characters' });
  const codeI = input('code', '', { placeholder: 'Šifra dijela', class: 'big-input', autocapitalize: 'characters' });
  const box = h('div');
  let asset = null, found = new Set(), extra = [];
  const draw = () => {
    if (!asset) return clear(box);
    const exp = asset.parts;
    const missing = exp.filter(p => !found.has(p.internal_code));
    clear(box,
      h('div.stats', h('div.stat', h('b', exp.length), h('span', 'Treba da je ovdje')), h('div.stat', h('b', exp.length - missing.length), h('span', 'Pronađeno')),
        h('div.stat', h('b', missing.length), h('span', 'Nedostaje')), h('div.stat', h('b', extra.length), h('span', 'Višak (sa druge lokacije)'))),
      extra.length ? h('div.card', h('h2', 'Višak — dijelovi koji su vođeni na drugoj lokaciji'), h('table.tbl', h('tbody', extra.map(x => h('tr', h('td', h('span.code', x.code)), h('td', x.title || x.msg), h('td.muted', x.from || ''))))),
        extra.some(x => x.id) && can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK') ? h('button.primary', { style: { marginTop: '8px' }, onclick: async () => {
          const r = await run(() => POST('/api/parts/move-bulk', { location_id: asset.id, codes: extra.filter(x => x.id).map(x => x.code) }), 'Višak upisan na ' + asset.code_extended);
          extra = extra.filter(x => !x.id); await load(); } }, 'Upiši višak na ' + asset.code_extended) : null) : null,
      h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', 'Spisak sa lokacije')), h('div.list', exp.map(p => h('a.item' + (found.has(p.internal_code) ? '' : '.hl'), { href: '#/dijelovi/' + p.id },
        h('div.bd', h('div.t', (found.has(p.internal_code) ? '✔ ' : '✖ ') + p.title), h('div.s', h('span.code', p.internal_code), p.catalog_number ? h('span', p.catalog_number) : null)))))),
      missing.length && found.size ? h('p.muted', 'Žuto označeni dijelovi nisu skenirani — provjerite da li su negdje drugo ili prodati.') : null);
  };
  const load = async () => {
    const c = locI.value.trim().toUpperCase(); if (!c) return;
    const r = (await GET('/api/assets/find?code=' + encodeURIComponent(c))).filter(x => x.parts_allowed && x.code_extended.toUpperCase() === c);
    if (r.length !== 1) { toast('Lokacija ne postoji', 'err'); return; }
    asset = await GET('/api/assets/' + r[0].id);
    draw(); codeI.focus();
  };
  const scan = async () => {
    const c = codeI.value.trim().toUpperCase(); codeI.value = ''; if (!c || !asset) return;
    if (asset.parts.some(p => p.internal_code === c)) { found.add(c); navigator.vibrate?.(40); }
    else if (!extra.some(x => x.code === c)) {
      try { const p = await GET('/api/parts/by-code/' + c); extra.push({ code: c, id: p.id, title: p.title, from: p.status === 'SOLD' ? 'PRODAT!' : p.location_label }); }
      catch { extra.push({ code: c, msg: 'ne postoji u bazi' }); }
      navigator.vibrate?.(300);
    }
    draw(); codeI.focus();
  };
  locI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); found = new Set(); extra = []; load(); } });
  codeI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scan(); } });
  if (query.loc) setTimeout(load, 50);
  return h('div', h('div.head', h('h1', 'Inventura lokacije')),
    h('div.card', h('p.muted', 'Unesite policu/kutiju, pa skenirajte ili ukucajte šifre svih dijelova koji su FIZIČKI na njoj. Program pokazuje šta nedostaje i šta je višak.'),
      field('Lokacija', withScan(locI, () => { found = new Set(); extra = []; load(); })), field('Šifra dijela', withScan(codeI, scan))),
    box);
});
