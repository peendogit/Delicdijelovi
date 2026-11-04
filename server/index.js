// Pokretanje: provjera verzije Node.js, pa učitavanje .env PRIJE ostalih modula (oni čitaju process.env pri učitavanju)
const [maj] = process.versions.node.split('.').map(Number);
if (maj < 20) {
  console.error(`Potreban je Node.js 20 ili noviji (sada: ${process.versions.node}).`);
  process.exit(1);
}
const { loadEnv } = await import('./env.js');
loadEnv();
if (!process.env.TZ) process.env.TZ = 'Europe/Sarajevo';
await import('./main.js');
