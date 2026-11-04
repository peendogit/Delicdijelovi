// Uvoz slika iz starog programa: kopira sve fajlove čije ime sadrži ID slike (lib_attachment.id) u data/uploads/<id>.jpg
// Upotreba:  node tools/import-images.js /putanja/do/foldera/sa/slikama
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, ROOT } from '../server/env.js';
loadEnv();
const { all } = await import('../server/db.js');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.log('Upotreba: node tools/import-images.js <folder>'); process.exit(1); }
const dst = path.resolve(ROOT, process.env.UPLOADS_DIR || './data/uploads');
fs.mkdirSync(dst, { recursive: true });
const ids = new Set(all('SELECT id FROM lib_attachment').map(r => r.id));
const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
let found = 0, copied = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    const m = e.name.match(re) || f.match(re);
    if (!m || !ids.has(m[0].toLowerCase())) continue;
    found++;
    const thumb = /thumb|small|_t\b|_s\b/i.test(e.name);
    const out = path.join(dst, m[0].toLowerCase() + (thumb ? '_t' : '') + '.jpg');
    if (!fs.existsSync(out)) { fs.copyFileSync(f, out); copied++; }
    if (found % 5000 === 0) console.log('…', found);
  }
}
walk(src);
console.log(`Pronađeno ${found} slika, kopirano ${copied} u ${dst}`);
