// Uvoz MariaDB/MySQL backupa (.sql ili .sql.gz) starog programa u SQLite bazu.
// Upotreba:  node tools/import.js /putanja/delic08072026.sql.gz [data/delic.db]
// Tabele i kolone ostaju ISTE kao u starom programu.
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';
import { openDb } from '../server/sqlite.js';
import { loadEnv, ROOT } from '../server/env.js';

loadEnv();
const src = process.argv.slice(2).filter(a => !a.startsWith('--'))[0];
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dst = path.resolve(ROOT, args[1] || process.env.DB_PATH || './data/delic.db');
if (!src || !fs.existsSync(src)) {
  console.error('Upotreba: node tools/import.js backup.sql.gz [data/delic.db]');
  process.exit(1);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
if (fs.existsSync(dst)) {
  // Zaštita: ponovni uvoz briše sve što je uneseno u NOVOJ aplikaciji poslije backupa
  if (!process.argv.includes('--force')) {
    let info = '';
    try {
      const old = await openDb(dst);
      const r = old.prepare('SELECT max(created_date) d, count(*) n FROM spare_part').get();
      info = `Postojeća baza ima ${r.n} dijelova, zadnji unesen ${r.d}.`;
      old.close();
    } catch {}
    console.log(`\nBAZA VEĆ POSTOJI (${dst}). ${info}\nUvoz će je ZAMIJENITI backupom — sve uneseno u novoj aplikaciji poslije backupa se gubi\n(stara baza se ipak sačuva kao rezerva).\nAko si siguran, ponovi komandu sa  --force  na kraju.\n`);
    process.exit(1);
  }
  const bak = dst + '.prije-uvoza-' + Date.now();
  fs.renameSync(dst, bak);
  console.log('Postojeća baza sačuvana kao', bak);
}
const db = await openDb(dst);
db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');

const ESC = { n: '\n', r: '\r', t: '\t', 0: '\0', Z: '\x1a', '\\': '\\', "'": "'", '"': '"', b: '\b' };

function parseValues(s, i) {
  const rows = [];
  const n = s.length;
  while (i < n) {
    while (i < n && (s[i] === ' ' || s[i] === ',' || s[i] === '\n')) i++;
    if (i >= n || s[i] === ';') break;
    if (s[i] !== '(') throw new Error('Neočekivan znak na ' + i + ': ' + s.slice(i, i + 40));
    i++;
    const row = [];
    for (;;) {
      if (s[i] === "'") {
        i++;
        let buf = '';
        for (;;) {
          let j = i;
          while (s[j] !== '\\' && s[j] !== "'") j++;
          buf += s.slice(i, j);
          i = j;
          if (s[i] === '\\') { buf += ESC[s[i + 1]] ?? s[i + 1]; i += 2; }
          else if (s[i + 1] === "'") { buf += "'"; i += 2; }
          else { i++; break; }
        }
        row.push(buf);
      } else {
        let j = i;
        while (s[j] !== ',' && s[j] !== ')') j++;
        const tok = s.slice(i, j).trim();
        i = j;
        if (tok === 'NULL') row.push(null);
        else row.push(Number(tok));
      }
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
    }
    rows.push(row);
  }
  return rows;
}

const input = fs.createReadStream(src);
const stream = src.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

let cur = null, cols = [], pk = null;
const counts = {};
db.exec('BEGIN');
for await (const line of rl) {
  let m = line.match(/^CREATE TABLE `(\w+)`/);
  if (m) { cur = m[1]; cols = []; pk = null; continue; }
  if (cur && line.startsWith('  `')) {
    m = line.match(/^  `(\w+)` (\w+)/);
    const t = { int: 'INTEGER', tinyint: 'INTEGER', double: 'REAL' }[m[2]] || 'TEXT';
    cols.push([m[1], t]);
    continue;
  }
  if (cur && line.startsWith('  PRIMARY KEY')) { pk = [...line.matchAll(/`(\w+)`/g)].map(x => x[1]); continue; }
  if (cur && line.startsWith(')')) {
    let ddl = cols.map(([c, t]) => `"${c}" ${t}`).join(', ');
    if (pk) ddl += ', PRIMARY KEY (' + pk.map(p => `"${p}"`).join(',') + ')';
    db.exec(`DROP TABLE IF EXISTS "${cur}"`);
    db.exec(`CREATE TABLE "${cur}" (${ddl})`);
    counts[cur] = 0;
    cur = null;
    continue;
  }
  if (line.startsWith('INSERT INTO')) {
    m = line.match(/^INSERT INTO `(\w+)` VALUES /);
    const t = m[1];
    const rows = parseValues(line, m[0].length);
    if (!rows.length) continue;
    const st = db.prepare(`INSERT OR REPLACE INTO "${t}" VALUES (${rows[0].map(() => '?').join(',')})`);
    for (const r of rows) st.run(...r);
    counts[t] = (counts[t] || 0) + rows.length;
  }
}
db.exec('COMMIT');
// Sigurnost: OLX/PA integracija se nakon uvoza ISKLJUČUJE da nova aplikacija ne bi dirala oglase dok radi i stari program.
db.exec("UPDATE core_configuration SET boolean_value=0 WHERE name IN ('OLX_ENABLED','PA_ENABLED')");
db.exec('PRAGMA journal_mode=WAL;');
console.log('OLX integracija je ISKLJUČENA (uključuje se u Administracija → OLX kad stari program prestane da radi).');
console.log('Uvezeno:');
for (const [t, c] of Object.entries(counts)) console.log('  ' + t.padEnd(32) + c);
db.close();
console.log('\nGotovo ->', dst, '\nPokreni server (npm start) — indeksi i dodatne tabele se prave automatski.');
