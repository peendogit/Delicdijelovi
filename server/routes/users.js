import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need, can, hashPassword, authorities } from '../auth.js';
import { uuid, now, bad, notFound, pick } from '../util.js';

app.get('/api/users', ctx => {
  need(ctx.user, 'ROLE_USR_R', 'ROLE_USR');
  const rows = all(`SELECT id, firstname, lastname, full_name, username, email, phone, active, note, created_date, modified_date,
      (SELECT max(login_time) FROM core_login_history h WHERE h.user_id=u.id) last_login
    FROM core_user u WHERE deleted_date IS NULL AND visible=1 ORDER BY active DESC, full_name`);
  const prof = all('SELECT up.user_id, p.id, p.name FROM core_user_profile up JOIN core_profile p ON p.id=up.profile_id WHERE p.active=1 ORDER BY up.profile_order');
  for (const r of rows) r.profiles = prof.filter(p => p.user_id === r.id).map(p => ({ id: p.id, name: p.name }));
  return rows;
});

app.get('/api/users/:id', ctx => {
  need(ctx.user, 'ROLE_USR_R', 'ROLE_USR');
  const u = get('SELECT id, firstname, lastname, full_name, username, email, phone, active, note, default_locale, session_duration, created_date FROM core_user WHERE id=?', ctx.params.id);
  if (!u) throw notFound();
  u.profile_ids = all('SELECT profile_id FROM core_user_profile WHERE user_id=?', u.id).map(r => r.profile_id);
  u.auth = authorities(u.id);
  u.logins = all('SELECT login_time, logout_time FROM core_login_history WHERE user_id=? ORDER BY id DESC LIMIT 20', u.id);
  return u;
});

function setProfiles(userId, ids) {
  run('DELETE FROM core_user_profile WHERE user_id=?', userId);
  ids.forEach((pid, i) => insert('core_user_profile', { user_id: userId, profile_id: Number(pid), profile_order: Number(pid) || i }));
}

app.post('/api/users', ctx => {
  need(ctx.user, 'ROLE_USR_U', 'ROLE_USR_CRD');
  const b = ctx.body;
  if (!b.username || !b.password) throw bad('Korisničko ime i lozinka su obavezni');
  if (get('SELECT 1 x FROM core_user WHERE lower(username)=lower(?) AND deleted_date IS NULL', b.username)) throw bad('Korisničko ime već postoji');
  const id = uuid(); const t = now();
  tx(() => {
    insert('core_user', { id, firstname: b.firstname || '', lastname: b.lastname || '', full_name: `${b.firstname || ''} ${b.lastname || ''}`.trim(), phone: b.phone || null,
      username: b.username.trim(), email: b.email || b.username.trim(), password: hashPassword(b.password), active: 1, visible: 1, default_locale: 'sr', licence: LICENCE,
      credentials_date: t, credentials_expiration_not_allowed: 1, account_non_expired: 1, account_non_locked: 1, note: b.note || null,
      created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
    if (Array.isArray(b.profile_ids)) setProfiles(id, b.profile_ids);
  });
  return { id };
});

app.put('/api/users/:id', ctx => {
  need(ctx.user, 'ROLE_USR_U');
  const b = ctx.body; const id = ctx.params.id;
  const d = pick(b, ['firstname', 'lastname', 'phone', 'email', 'note']);
  if ('active' in b) d.active = b.active ? 1 : 0;
  if (b.username !== undefined) {
    need(ctx.user, 'ROLE_USR_USERNAME');
    if (get('SELECT 1 x FROM core_user WHERE lower(username)=lower(?) AND id<>? AND deleted_date IS NULL', b.username, id)) throw bad('Korisničko ime već postoji');
    d.username = b.username.trim();
  }
  const cur = get('SELECT firstname, lastname FROM core_user WHERE id=?', id);
  d.full_name = `${d.firstname ?? cur.firstname} ${d.lastname ?? cur.lastname}`.trim();
  d.modified_by_id = ctx.user.id; d.modified_date = now();
  tx(() => {
    update('core_user', d, 'id=?', id);
    if (Array.isArray(b.profile_ids)) { need(ctx.user, 'ROLE_USR_PROF'); setProfiles(id, b.profile_ids); }
  });
  return { ok: true };
});

app.post('/api/users/:id/password', ctx => {
  need(ctx.user, 'ROLE_USR_PASS', 'ROLE_USR_CRD');
  if (!ctx.body.password || ctx.body.password.length < 4) throw bad('Lozinka mora imati bar 4 znaka');
  run('UPDATE core_user SET password=?, credentials_date=?, modified_by_id=?, modified_date=? WHERE id=?', hashPassword(ctx.body.password), now(), ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});

app.del('/api/users/:id', ctx => {
  need(ctx.user, 'ROLE_USR_D');
  if (ctx.params.id === ctx.user.id) throw bad('Ne možete obrisati sebe');
  run('UPDATE core_user SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});

// Profili (grupe prava) i prava
app.get('/api/profiles', ctx => {
  const profiles = all('SELECT * FROM core_profile WHERE active=1 ORDER BY id');
  const ra = all('SELECT rp.profile_id, ra.authority FROM core_role_profile rp JOIN core_role_auth ra ON ra.role_id=rp.role_id');
  for (const p of profiles) p.auth = ra.filter(r => r.profile_id === p.id).map(r => r.authority);
  return profiles;
});
app.get('/api/authorities', ctx => all('SELECT a.*, c.name category_name FROM core_auth a LEFT JOIN core_auth_category c ON c.code=a.category_code WHERE a.active=1 ORDER BY a.category_code, a.role_name'));

app.post('/api/profiles', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_USR_AUTH');
  const name = ctx.body.name;
  if (!name) throw bad('Naziv je obavezan');
  return tx(() => {
    const pid = Number(insert('core_profile', { name, licence: LICENCE, active: 1 }).lastInsertRowid);
    const rid = Number(insert('core_role', { name, the_type: 'PROFILE', licence: LICENCE, active: 1 }).lastInsertRowid);
    insert('core_role_profile', { role_id: rid, profile_id: pid });
    for (const a of ctx.body.auth || []) insert('core_role_auth', { role_id: rid, authority: a });
    return { id: pid };
  });
});
app.put('/api/profiles/:id', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_USR_AUTH');
  const pid = Number(ctx.params.id);
  tx(() => {
    if (ctx.body.name) { run('UPDATE core_profile SET name=? WHERE id=?', ctx.body.name, pid); }
    if (Array.isArray(ctx.body.auth)) {
      let rp = get('SELECT role_id FROM core_role_profile WHERE profile_id=?', pid);
      if (!rp) {
        const rid = Number(insert('core_role', { name: ctx.body.name || 'Profil ' + pid, the_type: 'PROFILE', licence: LICENCE, active: 1 }).lastInsertRowid);
        insert('core_role_profile', { role_id: rid, profile_id: pid }); rp = { role_id: rid };
      }
      run('DELETE FROM core_role_auth WHERE role_id=?', rp.role_id);
      for (const a of ctx.body.auth) if (a !== 'ROLE_SUPERADMIN' || can(ctx.user, 'ROLE_SUPERADMIN')) insert('core_role_auth', { role_id: rp.role_id, authority: a });
    }
  });
  return { ok: true };
});
