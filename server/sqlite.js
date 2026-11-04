// Otvaranje SQLite baze: Node 22.13+ ima ugrađeni node:sqlite, a na starijem Node-u (npr. 20) koristi se paket better-sqlite3.
// Oba imaju isti način rada: db.prepare(sql).get/all/run(...), db.exec(sql), db.close().
export async function openDb(file) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(file);
  } catch (e) {
    let Better;
    try { Better = (await import('better-sqlite3')).default; }
    catch {
      console.error(`\nOvaj Node.js (${process.versions.node}) nema ugrađeni SQLite.\nU folderu programa pokreni:  npm install\n(instalira better-sqlite3), pa ponovi komandu.\n`);
      process.exit(1);
    }
    return new Better(file);
  }
}
