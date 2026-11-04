import { h, clear, route, GET, POST, PUT, DEL, go, can, fmtDT, field, input, textarea, check, modal, confirmBox, toast, run, badge, tabs, empty, formData } from '../lib.js';

route('/korisnici', async (params, query, main) => {
  let tab = query.tab || 'users';
  const body = h('div');
  const render = async () => {
    clear(body, h('div.loading', 'Učitavam…'));
    if (tab === 'users') {
      const list = await GET('/api/users');
      clear(body, h('div.card.p0', h('div.scroll-x', h('table.tbl', h('thead', h('tr', h('th', 'Ime'), h('th', 'Korisničko ime'), h('th', 'Profili'), h('th', 'Zadnja prijava'), h('th', 'Status'))),
        h('tbody', list.map(u => h('tr.click', { onclick: () => go('/korisnici/' + u.id) }, h('td', h('b', u.full_name), u.phone ? h('div.muted', u.phone) : null), h('td', u.username),
          h('td', h('div.chips', u.profiles.map(p => badge(p.name)))), h('td.muted', fmtDT(u.last_login)), h('td', u.active ? badge('aktivan', 'green') : badge('neaktivan', 'gray')))))))));
    } else {
      const [profiles, auths] = await Promise.all([GET('/api/profiles'), GET('/api/authorities')]);
      clear(body, h('div.card.p0', h('div.list', profiles.map(p => h('div.item', { onclick: () => profileDialog(p, auths).then(ok => ok && render()) },
        h('div.bd', h('div.t', p.name), h('div.s', p.auth.filter(a => a !== 'ROLE_USER').map(a => h('span', auths.find(x => x.role_name === a)?.title || a)))))))),
        can('ROLE_SUPERADMIN', 'ROLE_USR_AUTH') ? h('button', { onclick: () => profileDialog(null, auths).then(ok => ok && render()) }, '+ Novi profil') : null);
    }
  };
  clear(main, h('div', h('div.head', h('h1', 'Korisnici'), can('ROLE_USR_U', 'ROLE_USR_CRD') ? h('button.primary', { onclick: () => go('/korisnici/novi') }, '+ Novi korisnik') : null),
    tabs([['users', 'Korisnici'], ['profiles', 'Profili i prava']], tab, k => { tab = k; main.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('act', b.textContent.startsWith(k === 'users' ? 'Korisnici' : 'Profili'))); render(); }), body));
  render();
});

function profileDialog(p, auths) {
  const name = input('name', p?.name || '');
  const cats = {};
  for (const a of auths) (cats[a.category_name || 'Ostalo'] ||= []).push(a);
  const boxes = Object.entries(cats).map(([c, list]) => h('div', h('div.sect', c), list.map(a => h('label.check', h('input', { type: 'checkbox', 'data-auth': a.role_name, checked: p?.auth.includes(a.role_name) }), a.title + ' ', h('small.muted', a.role_name)))));
  const editable = can('ROLE_SUPERADMIN', 'ROLE_USR_AUTH');
  return modal(p ? 'Profil: ' + p.name : 'Novi profil', [field('Naziv', name), boxes], editable ? [{ label: 'Odustani' }, {
    label: 'Sačuvaj', primary: true, onClick: () => {
      const auth = [...document.querySelectorAll('[data-auth]:checked')].map(x => x.dataset.auth);
      if (!auth.includes('ROLE_USER')) auth.push('ROLE_USER');
      return p ? PUT('/api/profiles/' + p.id, { name: name.value, auth }) : POST('/api/profiles', { name: name.value, auth });
    },
  }] : [{ label: 'Zatvori' }]);
}

route('/korisnici/:id', async ({ id }) => {
  const isNew = id === 'novi';
  const [u, profiles] = await Promise.all([isNew ? Promise.resolve({ active: 1, profile_ids: [] }) : GET('/api/users/' + id), GET('/api/profiles')]);
  const form = h('form.card', { onsubmit: e => e.preventDefault() });
  const I = (n, a = {}) => input(n, u[n], a);
  const pw = isNew ? input('password', '', { type: 'password' }) : null;
  clear(form, h('div.grid',
    field('Ime', I('firstname'), { req: true }), field('Prezime', I('lastname')), field('Korisničko ime (za prijavu)', I('username', { autocapitalize: 'none' }), { req: true }),
    field('Email', I('email', { type: 'email' })), field('Telefon', I('phone')),
    pw ? field('Lozinka', pw, { req: true }) : null,
    !isNew ? h('div.field', h('span', ' '), check('active', u.active, 'Aktivan')) : null,
    field('Napomena', textarea('note', u.note, { rows: 2 }), { full: true }),
    h('div.sect', 'Profili (prava pristupa)'),
    h('div.full', { style: { gridColumn: '1 / -1' } }, h('div.grid', profiles.map(p => h('label.check', h('input', { type: 'checkbox', 'data-prof': p.id, 'data-skip': '1', checked: u.profile_ids.includes(p.id) }), p.name))))),
    h('div.sticky-actions',
      !isNew && can('ROLE_USR_D') ? h('button.danger', { type: 'button', onclick: async () => { if (await confirmBox('Obrisati korisnika ' + u.full_name + '?')) { await run(() => DEL('/api/users/' + id), 'Obrisan'); go('/korisnici'); } } }, '🗑 Obriši') : null,
      !isNew && can('ROLE_USR_PASS', 'ROLE_USR_CRD') ? h('button', { type: 'button', onclick: async () => {
        const np = input('p', '', { type: 'password' });
        await modal('Nova lozinka za ' + u.full_name, [field('Lozinka', np)], [{ label: 'Odustani' }, { label: 'Postavi', primary: true, onClick: async () => { await POST(`/api/users/${id}/password`, { password: np.value }); toast('Lozinka postavljena'); } }]);
      } }, '🔑 Lozinka') : null,
      h('div.grow'),
      h('button', { type: 'button', onclick: () => history.back() }, 'Odustani'),
      h('button.primary', { type: 'button', onclick: async () => {
        const d = formData(form);
        d.profile_ids = [...form.querySelectorAll('[data-prof]:checked')].map(x => Number(x.dataset.prof));
        if (!isNew && !can('ROLE_USR_USERNAME') && d.username === u.username) delete d.username;
        await run(() => (isNew ? POST('/api/users', d) : PUT('/api/users/' + id, d)), 'Sačuvano');
        go('/korisnici');
      } }, '💾 Sačuvaj')));
  return h('div', h('div.head', h('button.icon', { onclick: () => history.back() }, '←'), h('h1', isNew ? 'Novi korisnik' : u.full_name)), form,
    !isNew && u.logins?.length ? h('div.card', h('h2', 'Zadnje prijave'), h('table.tbl', h('tbody', u.logins.map(l => h('tr', h('td', fmtDT(l.login_time)), h('td.muted', l.logout_time ? 'odjava ' + fmtDT(l.logout_time) : '')))))) : null);
});
