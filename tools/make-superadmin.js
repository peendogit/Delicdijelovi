// Daje korisniku sva prava (ROLE_SUPERADMIN):  node tools/make-superadmin.js peendo@gmail.com
import { loadEnv } from '../server/env.js';
loadEnv();
const { get, run, insert, LICENCE } = await import('../server/db.js');
const username = process.argv[2];
if (!username) { console.log('Upotreba: node tools/make-superadmin.js <korisničko-ime>'); process.exit(1); }
const u = get('SELECT id, full_name FROM core_user WHERE lower(username)=lower(?)', username);
if (!u) { console.log('Korisnik ne postoji:', username); process.exit(1); }
let r = get("SELECT id FROM core_role WHERE the_type='USER' AND user_id=?", u.id);
if (!r) { const id = Number(insert('core_role', { name: 'Superadmin ' + u.full_name, the_type: 'USER', user_id: u.id, licence: LICENCE, active: 1 }).lastInsertRowid); r = { id }; }
run('INSERT OR IGNORE INTO core_role_auth (role_id, authority) VALUES (?, ?)', r.id, 'ROLE_SUPERADMIN');
console.log('Superadmin prava data korisniku', u.full_name);
