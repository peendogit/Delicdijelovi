import { ROOT } from './env.js';

import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';
import { readToken, loadUser } from './auth.js';
import { routes } from './router.js';
import './routes/auth.js';
import './routes/lookups.js';
import './routes/parts.js';
import './routes/vehicles.js';
import './routes/rims.js';
import './routes/whs.js';
import './routes/req.js';
import './routes/users.js';
import './routes/admin.js';
import './routes/analytics.js';
import './routes/dashboard.js';
import './routes/files.js';
import './routes/olx.js';
import './routes/public.js';
import './routes/pricing.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT || 3010);
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function parseCookies(h = '') {
  const o = {};
  for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return o;
}
function readBody(req, limit = 25e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Prevelik zahtjev')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const gz = req => /\bgzip\b/.test(req?.headers['accept-encoding'] || '');
function send(res, status, data, headers = {}, req) {
  let body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  // kompresija (manje mobilnih podataka) za veće odgovore
  if (gz(req) && body.length > 1500) { body = zlib.gzipSync(body, { level: 6 }); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
  res.writeHead(status, h);
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let p = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Zabranjeno' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  const ext = path.extname(file);
  // no-cache + Last-Modified: telefon uvijek dobije novu verziju poslije ažuriranja, a inače 304 (bez ponovnog skidanja)
  const mtime = fs.statSync(file).mtime.toUTCString();
  if (req.headers['if-modified-since'] === mtime) { res.writeHead(304); return res.end(); }
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': mtime };
  if (gz(req) && ['.js', '.css', '.html', '.svg', '.json'].includes(ext)) {
    h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
    res.writeHead(200, h);
    return fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  }
  res.writeHead(200, h);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/img/')) return serveStatic(req, res, url.pathname);
    const match = routes.match(req.method, url.pathname);
    if (!match) throw new HttpError(404, 'Nepoznata ruta');
    const cookies = parseCookies(req.headers.cookie);
    const uid = readToken(cookies.sid || (req.headers.authorization || '').replace(/^Bearer /, ''));
    const user = uid ? loadUser(uid) : null;
    if (!match.route.public && !user) throw new HttpError(401, 'Niste prijavljeni');
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await readBody(req);
      const ct = req.headers['content-type'] || '';
      if (match.route.raw) body = raw;
      else if (ct.includes('application/json') && raw.length) body = JSON.parse(raw.toString('utf8'));
      else body = {};
    }
    const query = Object.fromEntries(url.searchParams);
    const ctx = { req, res, params: match.params, query, body: body || {}, user, url };
    const out = await match.route.handler(ctx);
    if (res.writableEnded || res.headersSent) return;
    send(res, 200, out ?? { ok: true }, ctx.headers || {}, req);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) send(res, status, { error: e.message || 'Greška' }, {}, req);
  }
});

server.listen(PORT, () => console.log(`Delić dijelovi radi na http://localhost:${PORT}`));
if (process.env.SCHEDULER !== '0') startScheduler();
