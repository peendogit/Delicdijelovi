import crypto from 'node:crypto';
import { get, all, run } from './db.js';
import { HttpError, now } from './util.js';

const SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'promijeni-me'
  ? process.env.SESSION_SECRET
  : crypto.createHash('sha256').update('delic-' + (process.env.DB_PATH || '')).digest('hex');
const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export function verifyPassword(pw, stored, username) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, h] = stored.split('$');
    const x = crypto.scryptSync(pw, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h));
  }
  // Stari program: SHA-256 (64 hex). Probamo uobičajene varijante.
  const s = stored.toLowerCase();
  return [sha(pw), sha(pw + '{' + username + '}'), sha(username + pw), sha(pw + username)].includes(s);
}

export function signToken(userId) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = Buffer.from(JSON.stringify({ u: userId, e: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
export function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.e < Date.now()) return null;
    return p.u;
  } catch { return null; }
}

export function authorities(userId) {
  const rows = all(`
    SELECT DISTINCT ra.authority FROM core_user_profile up
      JOIN core_role_profile rp ON rp.profile_id=up.profile_id
      JOIN core_role r ON r.id=rp.role_id AND r.active=1
      JOIN core_role_auth ra ON ra.role_id=r.id
    WHERE up.user_id=?
    UNION
    SELECT ra.authority FROM core_role r JOIN core_role_auth ra ON ra.role_id=r.id
    WHERE r.the_type='USER' AND r.user_id=? AND r.active=1`, userId, userId);
  return rows.map(r => r.authority);
}

export function loadUser(userId) {
  const u = get('SELECT id, firstname, lastname, full_name, username, email, phone, active, image, default_locale FROM core_user WHERE id=? AND deleted_date IS NULL', userId);
  if (!u || !u.active) return null;
  u.auth = authorities(userId);
  u.superadmin = u.auth.includes('ROLE_SUPERADMIN');
  return u;
}

export function login(username, password) {
  const u = get('SELECT * FROM core_user WHERE lower(username)=lower(?) AND deleted_date IS NULL', String(username || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password, u.username)) throw new HttpError(401, 'Pogrešno korisničko ime ili lozinka');
  if (!u.active) throw new HttpError(403, 'Korisnik nije aktivan');
  if (!String(u.password).startsWith('scrypt$')) run('UPDATE core_user SET password=? WHERE id=?', hashPassword(password), u.id);
  run('INSERT INTO core_login_history (user_id, login_time) VALUES (?,?)', u.id, now());
  return u.id;
}

export function can(user, ...auths) {
  if (!user) return false;
  if (user.superadmin) return true;
  return auths.some(a => user.auth.includes(a));
}
export function need(user, ...auths) {
  if (!can(user, ...auths)) throw new HttpError(403, 'Nemate pravo pristupa (' + auths.join(' / ') + ')');
}
