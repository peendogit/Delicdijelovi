// Service worker: aplikacija se može instalirati i otvara se i bez interneta (zadnja verzija ekrana).
// Kod (HTML/JS/CSS) se uvijek prvo traži sa servera — ažuriranja stižu odmah; keš je samo rezerva.
const CACHE = 'delic-v2';
const SHELL = ['/', '/index.html', '/app.css', '/js/app.js', '/js/lib.js', '/noimg.svg', '/favicon.svg', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png',
  ...['dashboard', 'parts', 'vehicles', 'rims', 'whs', 'req', 'users', 'admin', 'analytics', 'pricing', 'bulk'].map(m => `/js/modules/${m}.js`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'delic-img').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // API: samo mreža; bez interneta jasna poruka
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'Nema interneta — provjerite vezu' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Slike: keš prvo (ne mijenjaju se)
  if (url.pathname.startsWith('/img/')) {
    e.respondWith(caches.open('delic-img').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => caches.match('/noimg.svg')));
    return;
  }
  // Kod aplikacije: mreža prvo, keš kao rezerva
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())));
});
