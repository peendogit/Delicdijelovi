import { app } from '../router.js';
import { login, signToken, verifyPassword, hashPassword } from '../auth.js';
import { get, all, run } from '../db.js';
import { bad, now, HttpError } from '../util.js';

const cookie = (tok, maxAge) => `sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

// zaštita od pogađanja lozinke: najviše 8 pogrešnih pokušaja u 10 minuta po IP adresi
const fails = new Map();
app.post('/api/auth/login', ctx => {
  const ip = String(ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '').split(',')[0].trim();
  const f = (fails.get(ip) || []).filter(t => t > Date.now() - 600e3);
  if (f.length >= 8) throw new HttpError(429, 'Previše pogrešnih pokušaja — sačekajte 10 minuta');
  let id;
  try { id = login(ctx.body.username, ctx.body.password); }
  catch (e) { if (e.status === 401) { f.push(Date.now()); fails.set(ip, f); } throw e; }
  fails.delete(ip);
  ctx.headers = { 'Set-Cookie': cookie(signToken(id), 30 * 86400) };
  return { ok: true };
}, { public: true });

app.post('/api/auth/logout', ctx => {
  run('UPDATE core_login_history SET logout_time=? WHERE id=(SELECT max(id) FROM core_login_history WHERE user_id=?)', now(), ctx.user?.id);
  ctx.headers = { 'Set-Cookie': cookie('', 0) };
  return { ok: true };
}, { public: true });

app.get('/api/auth/me', ctx => ({
  ...ctx.user,
  profiles: all('SELECT p.name FROM core_user_profile up JOIN core_profile p ON p.id=up.profile_id WHERE up.user_id=? AND p.active=1 ORDER BY up.profile_order', ctx.user.id).map(r => r.name),
}));

app.post('/api/auth/password', ctx => {
  const { old_password, new_password } = ctx.body;
  const u = get('SELECT password, username FROM core_user WHERE id=?', ctx.user.id);
  if (!verifyPassword(old_password || '', u.password, u.username)) throw bad('Stara lozinka nije tačna');
  if (!new_password || new_password.length < 4) throw bad('Nova lozinka mora imati bar 4 znaka');
  run('UPDATE core_user SET password=?, credentials_date=?, modified_date=?, modified_by_id=? WHERE id=?', hashPassword(new_password), now(), now(), ctx.user.id, ctx.user.id);
  return { ok: true };
});
