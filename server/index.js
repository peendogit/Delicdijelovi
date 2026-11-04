// Provjera verzije Node.js prije pokretanja (ugrađeni SQLite traži Node 22.13+)
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Potreban je Node.js 22.13 ili noviji (sada: ${process.versions.node}). Vidi README.md -> "Node.js verzija".`);
  process.exit(1);
}
// .env se mora učitati PRIJE ostalih modula (oni čitaju process.env pri učitavanju)
const { loadEnv } = await import('./env.js');
loadEnv();
if (!process.env.TZ) process.env.TZ = 'Europe/Sarajevo';
await import('./main.js');
