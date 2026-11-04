// Postavi lozinku korisniku:  node tools/set-password.js peendo@gmail.com novaLozinka
import { loadEnv } from '../server/env.js';
loadEnv();
const { get, run } = await import('../server/db.js');
const { hashPassword } = await import('../server/auth.js');
const [username, pw] = process.argv.slice(2);
if (!username || !pw) { console.log('Upotreba: node tools/set-password.js <korisničko-ime> <lozinka>'); process.exit(1); }
const u = get('SELECT id, full_name FROM core_user WHERE lower(username)=lower(?)', username);
if (!u) { console.log('Korisnik ne postoji:', username); process.exit(1); }
run('UPDATE core_user SET password=?, active=1 WHERE id=?', hashPassword(pw), u.id);
console.log('Lozinka postavljena za', u.full_name);
