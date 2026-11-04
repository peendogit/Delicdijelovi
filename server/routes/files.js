// Slike (lib_attachment) — fajlovi se čuvaju u data/uploads/<id>.jpg (+ <id>_t.jpg umanjena)
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../router.js';
import { get, all, run, insert, tx, LICENCE } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound } from '../util.js';
import { ROOT } from '../env.js';

export const UPLOADS = path.resolve(ROOT, process.env.UPLOADS_DIR || './data/uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const KIND = {
  SPARE_PART: { table: 'spare_part', auth: ['ROLE_SP_U', 'ROLE_SP_C', 'ROLE_USR_LIB_UP'] },
  VEHICLE: { table: 'vehicle', auth: ['ROLE_VEH_U', 'ROLE_VEH_C', 'ROLE_USR_LIB_UP'] },
  RIMS: { table: 'rims', auth: ['ROLE_RIMS_U', 'ROLE_RIMS_C', 'ROLE_USR_LIB_UP'] },
};
export const imgPath = (id, thumb) => path.join(UPLOADS, id.replace(/[^a-zA-Z0-9-]/g, '') + (thumb ? '_t' : '') + '.jpg');

function fromDataUrl(s) {
  if (!s) return null;
  const m = String(s).match(/^data:image\/[a-z+]+;base64,(.*)$/);
  return Buffer.from(m ? m[1] : s, 'base64');
}

app.post('/api/files/:type/:objectId', ctx => {
  const k = KIND[ctx.params.type];
  if (!k) throw bad('Nepoznat tip');
  need(ctx.user, ...k.auth);
  if (!get(`SELECT 1 x FROM ${k.table} WHERE id=?`, ctx.params.objectId)) throw notFound();
  const full = fromDataUrl(ctx.body.full);
  if (!full || full.length < 100) throw bad('Slika je prazna');
  const thumb = fromDataUrl(ctx.body.thumb);
  const id = uuid();
  fs.writeFileSync(imgPath(id), full);
  if (thumb) fs.writeFileSync(imgPath(id, true), thumb);
  tx(() => {
    const hasMain = get('SELECT 1 x FROM lib_attachment WHERE object_id=? AND active=1 AND main_picture=1', ctx.params.objectId);
    insert('lib_attachment', { id, type: ctx.params.type, object_id: ctx.params.objectId, main_picture: hasMain ? 0 : 1, file_size: full.length, licence: LICENCE, active: 1, created_by_id: ctx.user.id, created_date: now() });
  });
  return { id };
});

app.post('/api/files/:id/main', ctx => {
  const a = get('SELECT * FROM lib_attachment WHERE id=?', ctx.params.id);
  if (!a) throw notFound();
  need(ctx.user, ...KIND[a.type].auth);
  tx(() => {
    run('UPDATE lib_attachment SET main_picture=0 WHERE object_id=?', a.object_id);
    run('UPDATE lib_attachment SET main_picture=1 WHERE id=?', a.id);
  });
  return { ok: true };
});

app.del('/api/files/:id', ctx => {
  const a = get('SELECT * FROM lib_attachment WHERE id=?', ctx.params.id);
  if (!a) throw notFound();
  need(ctx.user, 'ROLE_USR_LIB_D', ...KIND[a.type].auth);
  tx(() => {
    run('UPDATE lib_attachment SET active=0, main_picture=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), a.id);
    if (a.main_picture) {
      const n = get('SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY created_date LIMIT 1', a.object_id);
      if (n) run('UPDATE lib_attachment SET main_picture=1 WHERE id=?', n.id);
    }
  });
  return { ok: true };
});

// Prikaz slike: /img/<id>  ili /img/<id>?t=1 (umanjena)
app.get('/img/:id', ctx => {
  const id = ctx.params.id.replace(/\.jpg$/, '');
  const thumb = ctx.query.t === '1';
  let f = imgPath(id, thumb);
  if (!fs.existsSync(f) && thumb) f = imgPath(id);
  if (fs.existsSync(f)) {
    ctx.res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' });
    fs.createReadStream(f).pipe(ctx.res);
    return;
  }
  const fb = process.env.IMG_FALLBACK_URL;
  if (fb) { ctx.res.writeHead(302, { Location: fb.replace('{id}', id) }); ctx.res.end(); return; }
  ctx.res.writeHead(404, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  ctx.res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e5e7eb"/><path d="M30 65l12-15 9 11 7-8 12 12z" fill="#9ca3af"/><circle cx="62" cy="38" r="6" fill="#9ca3af"/></svg>`);
}, { public: true });

// Periodično brisanje fajlova obrisanih slika (zadatak ATTACHMENTS_DELETE)
export function purgeDeletedFiles() {
  let n = 0;
  for (const a of all("SELECT id FROM lib_attachment WHERE active=0 AND deleted_date < datetime('now','-30 days')")) {
    for (const t of [false, true]) { const f = imgPath(a.id, t); if (fs.existsSync(f)) { fs.unlinkSync(f); n++; } }
  }
  return n;
}
