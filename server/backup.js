// Rezervne kopije baze: data/backups/delic-YYYY-MM-DD.db.gz (komprimovano, čuva se zadnjih BACKUP_KEEP)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { db } from './db.js';
import { ROOT } from './env.js';
import { today } from './util.js';

export const BACKUP_DIR = path.resolve(ROOT, process.env.BACKUP_DIR || './data/backups');
const KEEP = Number(process.env.BACKUP_KEEP || 10);
const RE = /^delic-\d{4}-\d{2}-\d{2}\.db\.gz$/;

export async function backupNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = path.join(BACKUP_DIR, `tmp-${Date.now()}.db`);
  const file = path.join(BACKUP_DIR, `delic-${today()}.db.gz`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
  fs.unlinkSync(tmp);
  const all = fs.readdirSync(BACKUP_DIR).filter(f => RE.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return { file: path.basename(file), size: fs.statSync(file).size };
}
export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => RE.test(f)).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
}
