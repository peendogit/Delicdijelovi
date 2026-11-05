import { h, $, clear, state, GET, POST, api, go, currentRoute, can, lookups, toast, route, modal, field, input, run, canScan, scanBarcode, setRenderer } from './lib.js';
import './modules/dashboard.js';
import './modules/parts.js';
import './modules/vehicles.js';
import './modules/rims.js';
import './modules/whs.js';
import './modules/req.js';
import './modules/users.js';
import './modules/admin.js';
import './modules/analytics.js';
import './modules/pricing.js';
import './modules/bulk.js';

const app = $('#app');

const NAV = [
  ['/', '🏠', 'Početna', () => true],
  ['/dijelovi', '🔧', 'Dijelovi', () => can('ROLE_SP_R', 'ROLE_SP')],
  ['/lista', '🔎', 'Pretraga liste', () => can('ROLE_SP_R', 'ROLE_SP')],
  ['/cijene', '💡', 'Prijedlozi cijena', () => can('ROLE_SP_U')],
  ['/nalozi', '📋', 'Nalozi', () => can('ROLE_REQ', 'ROLE_REQ_R', 'ROLE_REQ_C', 'ROLE_REQ_ST', 'ROLE_WHS_CLERK')],
  ['/vozila', '🚗', 'Vozila (donori)', () => can('ROLE_VEH_R', 'ROLE_VEH')],
  ['/felne', '⚙️', 'Felne', () => can('ROLE_RIMS_R', 'ROLE_RIMS')],
  ['/magacin', '🏬', 'Magacin', () => can('ROLE_WHS_R', 'ROLE_WHS', 'ROLE_WHS_CLERK', 'ROLE_SP_LOC_U')],
  ['/premjestanje', '📦', 'Premještanje', () => can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK')],
  ['/inventura', '✅', 'Inventura', () => can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK', 'ROLE_WHS_R')],
  ['/analitika', '📊', 'Analitika', () => can('ROLE_ANL')],
  ['sep'],
  ['/korisnici', '👥', 'Korisnici', () => can('ROLE_USR_R', 'ROLE_USR')],
  ['/admin', '🛠', 'Administracija', () => can('ROLE_SP_ADM', 'ROLE_VEH_ADM', 'ROLE_RIMS_U', 'ROLE_WHS_U', 'ROLE_SUPERADMIN')],
  ['/profil', '👤', 'Moj profil', () => true],
];
const BNAV = ['/', '/dijelovi', '/nalozi', '/magacin'];

function loginView() {
  const u = input('username', '', { placeholder: 'Korisničko ime / email', autocapitalize: 'none' });
  const p = input('password', '', { type: 'password', placeholder: 'Lozinka' });
  const err = h('div.muted', { style: { color: 'var(--red)', minHeight: '20px' } });
  const submit = async e => {
    e.preventDefault(); err.textContent = '';
    try { await POST('/api/auth/login', { username: u.value, password: p.value }); await boot(); go('/'); }
    catch (x) { err.textContent = x.message; }
  };
  clear(app, h('div.login', h('form.card', { onsubmit: submit },
    h('div.brand', h('b', 'DELIĆ'), h('div.muted', { style: { marginTop: '6px' } }, 'Auto otpad — dijelovi')),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, u, p, err, h('button.primary', { type: 'submit' }, 'Prijava')))));
  setTimeout(() => u.focus(), 50);
}

let shell = null;
function buildShell() {
  const side = h('nav.side');
  const bnav = h('nav.bnav');
  const main = h('main.main');
  const res = h('div.combo-list');
  const sInp = h('input', { placeholder: 'Šifra dijela, kataloški broj, P123, broj naloga…', autocomplete: 'off' });
  let t, results = [];
  const openRes = r => { res.style.display = 'none'; sInp.value = ''; sInp.blur(); go({ part: '/dijelovi/', rims: '/felne/', vehicle: '/vozila/', req: '/nalozi/', asset: '/magacin/lokacija/' }[r.kind] + r.id); };
  sInp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = sInp.value.trim();
      if (q.length < 2) { res.style.display = 'none'; return; }
      results = await GET('/api/search?q=' + encodeURIComponent(q));
      clear(res, results.length ? results.map(r => h('div.combo-item', { onmousedown: e => { e.preventDefault(); openRes(r); } }, r.label, r.sub ? h('small', r.sub) : null))
        : h('div.combo-item', { onmousedown: e => { e.preventDefault(); res.style.display = 'none'; go('/dijelovi?q=' + encodeURIComponent(q)); } }, `Traži „${q}” u dijelovima…`));
      res.style.display = 'block';
    }, 250);
  });
  sInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (results.length === 1) openRes(results[0]); else { res.style.display = 'none'; go('/dijelovi?q=' + encodeURIComponent(sInp.value.trim())); sInp.value = ''; } }
  });
  sInp.addEventListener('blur', () => setTimeout(() => (res.style.display = 'none'), 150));
  const burger = h('button.burger', { onclick: () => side.classList.toggle('open') }, '☰');
  const scanBtn = canScan() ? h('button.burger', { style: { display: 'block' }, title: 'Skeniraj', onclick: async () => {
    const c = await scanBarcode(); if (!c) return;
    const r = await GET('/api/search?q=' + encodeURIComponent(c));
    if (r.length) openRes(r[0]); else toast('Nije pronađeno: ' + c, 'err');
  } }, '📷') : null;
  const top = h('header.top', burger, h('a.logo', { href: '#/' }, h('b', 'D'), 'DELIĆ', h('small', 'katalog dijelova')), h('div.srch', sInp, res), scanBtn,
    h('span.me', { onclick: () => go('/profil') }, state.user.full_name));
  clear(app, top, h('div.layout', side, main), bnav);
  side.addEventListener('click', e => { if (e.target.closest('a')) side.classList.remove('open'); });
  shell = { side, bnav, main };
  renderNav();
}
function renderNav() {
  const path = '/' + ((location.hash.slice(2) || '').split(/[/?]/)[0] || '');
  const items = NAV.filter(n => n[0] === 'sep' || n[3]());
  clear(shell.side, items.map(n => n[0] === 'sep' ? h('div.sep') : h('a' + (n[0] === path ? '.act' : ''), { href: '#' + n[0] }, h('span', n[1]), n[2])),
    !isStandalone() ? h('a', { href: '#', onclick: e => { e.preventDefault(); installApp(); } }, h('span', '📲'), 'Instaliraj aplikaciju') : null,
    h('div.sep'), h('a', { href: '#', onclick: async e => { e.preventDefault(); await POST('/api/auth/logout'); state.user = null; loginView(); } }, h('span', '🚪'), 'Odjava'));
  clear(shell.bnav, BNAV.map(p => NAV.find(n => n[0] === p)).filter(n => n && n[3]()).map(n => h('a' + (n[0] === path ? '.act' : ''), { href: '#' + n[0] }, h('span', n[1]), n[2].split(' ')[0])),
    h('a', { href: '#', onclick: e => { e.preventDefault(); shell.side.classList.toggle('open'); } }, h('span', '☰'), 'Meni'));
}

async function render(opts = {}) {
  if (!state.user && state.offline) {
    return clear(app, h('div.login', h('div.card', h('div.brand', h('b', 'DELIĆ')), h('p', { style: { textAlign: 'center' } }, '📶 Nema interneta.'),
      h('p.muted', { style: { textAlign: 'center' } }, 'Program radi sa podacima na serveru, pa treba veza. Provjerite WiFi ili mobilne podatke.'),
      h('button.primary', { style: { width: '100%' }, onclick: async () => { await boot(); render(); } }, 'Pokušaj ponovo'))));
  }
  if (!state.user) return loginView();
  if (!shell) buildShell();
  renderNav();
  const m = currentRoute();
  const main = shell.main;
  if (!m) { clear(main, h('div.empty', 'Stranica ne postoji')); return; }
  try {
    if (!opts.keepScroll) document.querySelectorAll('.modal-bg').forEach(m => m.remove()); // prelazak na drugi ekran zatvara otvorene prozore
    const y = window.scrollY;
    if (!opts.keepScroll) clear(main, h('div.loading', 'Učitavam…'));
    const out = await m.r.render(m.params, m.query, main);
    if (out instanceof Node) clear(main, out);
    window.scrollTo(0, opts.keepScroll ? y : 0);
  } catch (e) {
    clear(main, h('div.card', h('h2', 'Greška'), h('p', e.message)));
  }
}

// Moj profil
route('/profil', () => {
  const u = state.user;
  const op = input('old_password', '', { type: 'password' }), np = input('new_password', '', { type: 'password' });
  return h('div',
    h('div.head', h('h1', 'Moj profil')),
    h('div.card', h('h2', u.full_name), h('p.muted', u.username), h('p', 'Profili: ', h('span.muted', (u.profiles || []).join(', ') || '—')), u.superadmin ? h('p', h('span.badge.green', 'Superadmin — sva prava')) : null),
    h('div.card', h('h2', 'Promjena lozinke'), h('div.grid', field('Stara lozinka', op), field('Nova lozinka', np)),
      h('div', { style: { marginTop: '10px' } }, h('button.primary', { onclick: () => run(() => POST('/api/auth/password', { old_password: op.value, new_password: np.value }), 'Lozinka promijenjena') }, 'Sačuvaj'))));
});

async function boot() {
  state.offline = false;
  try { state.user = await GET('/api/auth/me'); } catch (e) { state.user = null; state.offline = !navigator.onLine || /interneta/.test(e.message); }
  if (state.user) await lookups();
  shell = null;
}

window.addEventListener('hashchange', () => render());

// ---------- Instalacija na telefon (PWA) ----------
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (shell) renderNav(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Aplikacija je instalirana'); if (shell) renderNav(); });
window.addEventListener('offline', () => toast('Nema interneta', 'err'));
window.addEventListener('online', () => toast('Internet je ponovo tu'));
export async function installApp() {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderNav(); return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  modal('Instalacija na telefon', [
    !isSecureContext ? h('p', { style: { color: 'var(--red)' } }, 'Aplikacija se može instalirati samo preko https adrese (npr. https://dijelovi2.delicauto.com), ne preko IP adrese.') : null,
    ios ? h('p', 'iPhone: u Safariju dodirnite dugme Dijeli (□↑) pa „Dodaj na početni ekran”.')
      : h('p', 'Android: u Chromeu otvorite meni ⋮ pa „Instaliraj aplikaciju” (ili „Dodaj na početni ekran”).'),
  ], [{ label: 'Zatvori' }]);
}
setRenderer(render);
await boot();
if (state.user && location.hash === '#/prijava') location.hash = '#/';
render();
