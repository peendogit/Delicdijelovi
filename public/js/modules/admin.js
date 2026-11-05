import { h, clear, route, GET, POST, PUT, DEL, go, can, lookups, state, E, fmtDT, field, input, textarea, select, check, combo, modal, confirmBox, toast, run, badge, tabs, empty, loading } from '../lib.js';

const SIDES = Object.keys(E.side);
const ENT = {
  spare_part_type: { title: 'Vrste dijelova', auth: ['ROLE_SP_ADM'], label: r => r.title, sub: (r, L) => [L.groups.find(g => g.id === r.group_id)?.title, r.parts ? r.parts + ' na stanju' : '', r.sides ? r.sides.split(';').map(s => E.side[s]).join('/') : ''].filter(Boolean).join(' · '),
    fields: L => [['title', 'Naziv', 'text'], ['group_id', 'Grupa', 'select', L.groups.map(g => ({ value: g.id, label: g.title }))], ['sides', 'Moguće strane', 'sides'],
      ['catalog_number_required', 'Kataloški broj obavezan', 'bool'], ['engine_number_visible', 'Prikaži broj motora', 'bool'], ['part_set_visible', 'Može biti komplet', 'bool'],
      ['share_engine_data', 'Preuzmi podatke motora sa vozila', 'bool'], ['share_engine_code', 'Preuzmi oznaku/broj motora', 'bool'], ['share_gearbox_data', 'Preuzmi podatke mjenjača', 'bool'], ['share_all_wheel_drive', 'Preuzmi pogon', 'bool'],
      ['children', 'Pod-dijelovi kompleta', 'children'], ['external_olx_id', 'OLX kategorija (ID)', 'number'], ['title_pa', 'Naziv (PolovniAutomobili)', 'text'], ['external_pa_id', 'PA ID', 'number'], ['active', 'Aktivna', 'bool']] },
  spare_part_group: { title: 'Grupe dijelova', auth: ['ROLE_SP_ADM'], label: r => r.title,
    fields: () => [['title', 'Naziv', 'text'], ['catalog_number_required', 'Kataloški broj obavezan', 'bool'], ['share_engine_data', 'Preuzmi podatke motora', 'bool'], ['share_engine_code', 'Preuzmi oznaku motora', 'bool'], ['share_gearbox_data', 'Preuzmi podatke mjenjača', 'bool'], ['active', 'Aktivna', 'bool']] },
  car_make: { title: 'Marke', auth: ['ROLE_SP_ADM', 'ROLE_VEH_ADM'], label: r => r.name,
    fields: () => [['name', 'Naziv', 'text'], ['icon', 'Ikona (kod)', 'text'], ['external_olx_id', 'OLX ID', 'text'], ['active', 'Aktivna', 'bool']] },
  car_model: { title: 'Modeli', auth: ['ROLE_SP_ADM', 'ROLE_VEH_ADM'], label: r => r.label, filter: 'make_id',
    fields: L => [['make_id', 'Marka', 'select', L.makes.map(m => ({ value: m.id, label: m.name }))], ['name', 'Model', 'text'], ['generation_name', 'Generacija (npr. 8P, W204)', 'text'],
      ['restyling', 'Restyling', 'bool'], ['restyling_second', 'Drugi restyling', 'bool'], ['date_from', 'Proizvodnja od', 'date'], ['date_to', 'Proizvodnja do', 'date'], ['external_id', 'OLX ID modela', 'text'], ['active', 'Aktivan', 'bool']] },
  rims_type: { title: 'Vrste felni', auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], label: r => r.title, fields: () => [['title', 'Naziv', 'text'], ['external_olx_id', 'OLX kategorija', 'text'], ['active', 'Aktivna', 'bool']] },
  rims_diameter: { title: 'Prečnici', auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], label: r => r.title, fields: () => [['title', 'Prečnik (npr. 17")', 'text'], ['external_olx_id', 'OLX vrijednost', 'text']] },
  rims_width: { title: 'Širine', auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], label: r => r.title, fields: () => [['title', 'Širina (npr. 7 j)', 'text']] },
  rims_bolt_pattern: { title: 'Rasponi šarafa', auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], label: r => r.bolt_number + 'x' + r.bolt_distance, fields: () => [['bolt_number', 'Broj šarafa', 'number'], ['bolt_distance', 'Razmak (npr. 112)', 'text']] },
  whs_ast_type: { title: 'Tipovi lokacija', auth: ['ROLE_WHS_U', 'ROLE_SUPERADMIN'], label: r => r.title + (r.code ? ' (' + r.code + ')' : ''),
    fields: () => [['title', 'Naziv', 'text'], ['code', 'Prefiks koda (npr. P)', 'text'], ['code_strategy', 'Dodjela koda', 'select', [{ value: 'NUMBER', label: 'Broj — jedinstven globalno' }, { value: 'NUMBER_WAREHOUSE_PARENT_UNIQUE', label: 'Broj — jedinstven u nadređenoj' }, { value: 'LETTER', label: 'Slovo (A, B, C…)' }]],
      ['base', 'Osnovna (direktno u magacinu)', 'bool'], ['parts_allowed', 'Mogu se stavljati dijelovi', 'bool'], ['code_edit_allowed', 'Dozvoljena dodatna oznaka', 'bool'], ['move_allowed', 'Može se premještati', 'bool'],
      ['height_details_allowed', 'Oznake visine (merdevine/viljuškar)', 'bool'], ['the_order', 'Redoslijed', 'number'], ['children', 'Šta može sadržati', 'wchildren'], ['active', 'Aktivan', 'bool']] },
};

async function entityView(name, box) {
  const L = await lookups();
  const e = ENT[name];
  let filterVal = '';
  const listBox = h('div');
  let rows = [];
  let wtypes = name === 'whs_ast_type' ? await GET('/api/admin/whs_ast_type') : null;
  const load = async () => {
    if (e.filter && !filterVal) { clear(listBox, empty('Izaberite marku')); return; }
    clear(listBox, loading());
    rows = await GET(`/api/admin/${name}` + (e.filter ? `?${e.filter}=${filterVal}` : ''));
    draw();
  };
  const q = input('q', '', { type: 'search', placeholder: 'Filter…' });
  q.oninput = () => draw();
  const draw = () => {
    const s = q.value.toLowerCase();
    const list = rows.filter(r => !s || e.label(r).toLowerCase().includes(s));
    clear(listBox, h('div.muted', { style: { margin: '6px 2px' } }, list.length + ' stavki'), h('div.card.p0', h('div.list', list.slice(0, 500).map(r => h('div.item', { onclick: () => edit(r) },
      h('div.bd', h('div.t', e.label(r)), e.sub ? h('div.s', e.sub(r, L)) : null), r.active === 0 ? badge('neaktivno', 'gray') : null)))));
  };
  const edit = async r => {
    const isNew = !r; r = r || { active: 1, ...(e.filter ? { [e.filter]: filterVal } : {}) };
    const inputs = {};
    const els = e.fields(L).map(([k, label, type, opts]) => {
      let el;
      if (type === 'bool') { el = check(k, r[k], label); inputs[k] = () => el.querySelector('input').checked; return el; }
      if (type === 'select') { el = select(k, r[k], opts); inputs[k] = () => el.value || null; }
      else if (type === 'sides') {
        const cur = (r.sides || '').split(';').filter(Boolean);
        el = h('div.chips', SIDES.map(sd => h('label.check', h('input', { type: 'checkbox', 'data-side': sd, checked: cur.includes(sd) }), E.side[sd])));
        inputs.sides = () => [...el.querySelectorAll('[data-side]:checked')].map(x => x.dataset.side).join(';') || null;
      } else if (type === 'children') {
        const cur = new Set(r.children || []);
        const sel = h('div.chips');
        const drawSel = () => clear(sel, [...cur].map(id => h('span.chip', { onclick: () => { cur.delete(id); drawSel(); } }, (L.types.find(t => t.id === id)?.title || id) + ' ✕')));
        const c = combo('_child', '', L.types.filter(t => t.active).map(t => ({ value: t.id, label: t.title })), { placeholder: 'Dodaj pod-dio…' });
        c.addEventListener('change', ev => { if (ev.detail) { cur.add(ev.detail.value); c.value = ''; drawSel(); } });
        drawSel();
        el = h('div', sel, c); inputs.children = () => [...cur];
      } else if (type === 'wchildren') {
        const cur = r.children || [];
        el = h('div.chips', wtypes.map(t => h('label.check', h('input', { type: 'checkbox', 'data-wc': t.id, checked: cur.includes(t.id) }), t.title)));
        inputs.children = () => [...el.querySelectorAll('[data-wc]:checked')].map(x => x.dataset.wc);
      } else {
        el = input(k, type === 'date' ? (r[k] || '').slice(0, 10) : r[k], { type: type === 'number' ? 'number' : type === 'date' ? 'date' : 'text' });
        inputs[k] = () => (el.value === '' ? null : type === 'number' ? Number(el.value) : el.value);
      }
      return field(label, el);
    });
    const ok = await modal(isNew ? 'Novo: ' + e.title : e.label(r), els, [
      !isNew ? { label: '🗑', danger: true, onClick: async () => { if (!(await confirmBox('Obrisati / deaktivirati?'))) return false; await DEL(`/api/admin/${name}/${r.id}`); } } : null,
      { label: 'Odustani' },
      { label: 'Sačuvaj', primary: true, onClick: async () => { const d = Object.fromEntries(Object.entries(inputs).map(([k, f]) => [k, f()])); await (isNew ? POST(`/api/admin/${name}`, d) : PUT(`/api/admin/${name}/${r.id}`, d)); } },
    ].filter(Boolean));
    if (ok) { toast('Sačuvano'); state.models = {}; await lookups(true); if (name === 'whs_ast_type') wtypes = await GET('/api/admin/whs_ast_type'); load(); }
  };
  let filterEl = null;
  if (e.filter === 'make_id') {
    filterEl = combo('make', '', L.makes.map(m => ({ value: m.id, label: m.name + (m.active ? '' : ' (neaktivna)') })), { placeholder: 'Izaberi marku…' });
    filterEl.addEventListener('change', () => { filterVal = filterEl.value; load(); });
  }
  clear(box, h('div.card', h('div.row', filterEl ? h('div.grow', filterEl) : null, h('div.grow', q), h('button.primary', { onclick: () => (e.filter && !filterVal ? toast('Izaberite marku', 'err') : edit(null)) }, '+ Novo'))), listBox);
  load();
}

async function configView(box) {
  const rows = await GET('/api/config');
  const LBL = {
    CURRENCY: 'Osnovna valuta', WAREHOUSE_DEFAULT_ASSET: 'Podrazumijevana lokacija novih dijelova (ID)', WAREHOUSE_RETURN_ASSET: 'Lokacija za izdavanje/povrat (ID)',
    OLX_ENABLED: 'OLX integracija uključena', OLX_CLIENT_ID: 'OLX client ID', OLX_CLIENT_TOKEN: 'OLX client token', OLX_USERNAME: 'OLX korisničko ime', OLX_PASSWORD: 'OLX lozinka', OLX_SHORT_DESCRIPTION: 'OLX kratki opis',
    INTEGRATION_DESCRIPTION_PARTS: 'Opis oglasa — dijelovi', INTEGRATION_DESCRIPTION_RIMS: 'Opis oglasa — felne', INTEGRATION_DESCRIPTION_VEHICLE: 'Opis oglasa — vozila',
    SPARE_PART_TYPE_UPPERCASE: 'Naziv vrste velikim slovima', COMPANY_NAME: 'Naziv firme (otpremnica)', COMPANY_ADDRESS: 'Adresa firme', COMPANY_PHONE: 'Telefon firme', WARRANTY_DAYS: 'Garancija (dana)', ANTHROPIC_API_KEY: 'AI ključ (prepoznavanje sa slike)', PA_ENABLED: 'PolovniAutomobili integracija', PA_ACCESS_TOKEN: 'PolovniAutomobili token', WEB_APPLICATION_ADDRESS: 'Adresa aplikacije',
  };
  for (const n of ['OLX_USERNAME', 'OLX_PASSWORD', 'ANTHROPIC_API_KEY']) if (!rows.find(r => r.name === n)) rows.push({ name: n, string_value: null });
  clear(box, h('div.card.p0', h('div.list', rows.map(r => {
    const isBool = r.boolean_value != null && r.string_value == null;
    let el;
    if (isBool) el = h('input', { type: 'checkbox', checked: !!r.boolean_value, onchange: e => run(() => PUT('/api/config/' + r.name, { field: 'boolean_value', value: e.target.checked }), 'Sačuvano') });
    else {
      const long = (r.string_value || '').length > 60 || r.name.startsWith('INTEGRATION_DESCRIPTION');
      el = long ? textarea(r.name, r.string_value, { rows: 6 }) : input(r.name, r.string_value, { type: /PASSWORD|API_KEY|TOKEN/.test(r.name) ? 'password' : 'text' });
      el.onchange = () => run(() => PUT('/api/config/' + r.name, { field: 'string_value', value: el.value }), 'Sačuvano');
    }
    return h('div.item', { style: { cursor: 'default', flexWrap: 'wrap' } }, h('div.bd', { style: { minWidth: '200px' } }, h('div.t', LBL[r.name] || r.name), h('div.s', r.name)), h('div', { style: { flex: isBool ? '0' : '2 1 300px' } }, el));
  }))), h('p.muted', 'U opisima oglasa: PART_TITLE = naziv, PART_CODE = šifra, VEHICLE_DETAILS = podaci o vozilu.'));
}

async function tasksView(box) {
  const rows = await GET('/api/tasks');
  const DESC = { OLX_INTEGRATION: 'Objava novih dijelova na OLX', OLX_INTEGRATION_REFRESH: 'Osvježavanje OLX oglasa', SALE_INTEGRATION: 'Skidanje prodatih dijelova sa OLX', ATTACHMENTS_DELETE: 'Brisanje fajlova obrisanih slika', PA_INTEGRATION: 'PolovniAutomobili' };
  const tr = t => h('tr',
    h('td', h('b', DESC[t.task_id] || t.task_id), h('div.muted', t.task_id), t.note ? h('div.muted', t.note) : null),
    h('td', `${t.hour}h / ${t.minute}m`),
    h('td', fmtDT(t.last_execution)),
    h('td', h('input', { type: 'checkbox', checked: !!t.enabled, onchange: e => run(() => PUT('/api/tasks/' + t.task_id, { enabled: e.target.checked }), 'Sačuvano') })));
  const table = h('table.tbl', h('thead', h('tr', h('th', 'Zadatak'), h('th', 'Raspored (sat/min)'), h('th', 'Zadnje izvršenje'), h('th', 'Uključen'))), h('tbody', rows.map(tr)));
  clear(box, h('div.card.p0', table), h('p.muted', 'Zadaci vezani za OLX rade samo kad je OLX integracija uključena u Podešavanjima.'));
}

async function olxView(box) {
  const s = await GET('/api/olx/status');
  clear(box,
    h('div.stats', h('div.stat', h('b', s.enabled ? 'UKLJUČENA' : 'ISKLJUČENA'), h('span', 'OLX integracija')), h('div.stat', h('b', s.listed.toLocaleString('bs-BA')), h('span', 'Dijelova na OLX-u')), h('div.stat', h('b', s.not_listed.toLocaleString('bs-BA')), h('span', 'Nije na OLX-u'))),
    h('div.card', h('p', 'Dok stari program radi, OLX integracija ovdje treba ostati ISKLJUČENA (inače bi oba programa objavljivala/skidala oglase). Kad pređete potpuno na novi program: Podešavanja → upišite OLX pristupne podatke → uključite „OLX integracija uključena”.'),
      h('div.actions', h('button', { disabled: !s.enabled, onclick: async () => { const r = await run(() => POST('/api/olx/run', { limit: 10 })); toast(`Objavljeno ${r.published}, skinuto ${r.removed}`); olxView(box); } }, '▶ Pokreni sinhronizaciju sada (10 dijelova)'))),
    h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', 'Dnevnik')), s.log.length ? h('table.tbl', h('tbody', s.log.map(l => h('tr', h('td', fmtDT(l.created_date)), h('td', l.code || ''), h('td', l.action), h('td', l.ok ? badge('OK', 'green') : badge('Greška', 'red')), h('td.muted', l.message))))) : empty('Nema zapisa')));
}

route('/admin', async (params, query, main) => {
  const T = [
    ['spare_part_type', 'Vrste dijelova'], ['spare_part_group', 'Grupe'], ['car_make', 'Marke'], ['car_model', 'Modeli'],
    ['rims_type', 'Felne: vrste'], ['rims_diameter', 'Felne: prečnici'], ['rims_width', 'Felne: širine'], ['rims_bolt_pattern', 'Felne: šarafi'],
    ['whs_ast_type', 'Tipovi lokacija'], ['config', 'Podešavanja'], ['tasks', 'Zadaci'], ['olx', 'OLX'], ['backup', 'Rezervne kopije'],
  ].filter(([k]) => ENT[k] ? can(...ENT[k].auth) : can('ROLE_SUPERADMIN', 'ROLE_SP_ADM'));
  let tab = query.tab || T[0]?.[0];
  const box = h('div');
  const tabBox = h('div');
  const show = () => {
    clear(tabBox, tabs(T, tab, k => { tab = k; history.replaceState(null, '', '#/admin?tab=' + k); show(); }));
    clear(box, loading());
    if (ENT[tab]) entityView(tab, box); else if (tab === 'config') configView(box); else if (tab === 'tasks') tasksView(box); else if (tab === 'olx') olxView(box); else if (tab === 'backup') backupView(box);
  };
  clear(main, h('div', h('div.head', h('h1', 'Administracija')), tabBox, box));
  show();
});

async function backupView(box) {
  const list = await GET('/api/backups');
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  clear(box,
    h('div.card', h('p', 'Kopija cijele baze pravi se automatski svaki dan u 03:10 (komprimovano, čuva se zadnjih 10 dana) u folderu data/backups na serveru. Slike su u data/uploads.'),
      h('button.primary', { onclick: async () => { await run(() => POST('/api/backups'), 'Kopija napravljena'); backupView(box); } }, '💾 Napravi kopiju sada')),
    h('div.card.p0', list.length ? h('table.tbl', h('tbody', list.map(b => h('tr', h('td', b.name), h('td.n', mb(b.size)), h('td', can('ROLE_SUPERADMIN') ? h('a', { href: '/api/backups/' + b.name }, '⬇ Preuzmi') : ''))))) : empty('Još nema kopija')));
}
