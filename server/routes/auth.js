import { app } from '../router.js';
import { login, signToken, verifyPassword, hashPassword } from '../auth.js';
import { get, run } from '../db.js';
import { bad, now } from '../util.js';

const cookie = (tok, maxAge) => `sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

app.post('/api/auth/login', ctx => {
  const id = login(ctx.body.username, ctx.body.password);
  ctx.headers = { 'Set-Cookie': cookie(signToken(id), 30 * 86400) };
  return { ok: true };
}, { public: true });

app.post('/api/auth/logout', ctx => {
  run('UPDATE core_login_history SET logout_time=? WHERE id=(SELECT max(id) FROM core_login_history WHERE user_id=?)', now(), ctx.user?.id);
  ctx.headers = { 'Set-Cookie': cookie('', 0) };
  return { ok: true };
}, { public: true });

app.get('/api/auth/me', ctx => ctx.user);

app.post('/api/auth/password', ctx => {
  const { old_password, new_password } = ctx.body;
  const u = get('SELECT password, username FROM core_user WHERE id=?', ctx.user.id);
  if (!verifyPassword(old_password || '', u.password, u.username)) throw bad('Stara lozinka nije tačna');
  if (!new_password || new_password.length < 4) throw bad('Nova lozinka mora imati bar 4 znaka');
  run('UPDATE core_user SET password=?, credentials_date=?, modified_date=?, modified_by_id=? WHERE id=?', hashPassword(new_password), now(), now(), ctx.user.id, ctx.user.id);
  return { ok: true };
});
