// Potpuno isključi OLX: briše pristupne podatke, gasi integraciju i pozadinske OLX zadatke.
//   node tools/olx-off.js
import { loadEnv } from '../server/env.js';
loadEnv();
const { run, all } = await import('../server/db.js');
run("UPDATE core_configuration SET boolean_value=0 WHERE name IN ('OLX_ENABLED','PA_ENABLED')");
run("UPDATE core_configuration SET string_value=NULL WHERE name IN ('OLX_CLIENT_ID','OLX_CLIENT_TOKEN','OLX_USERNAME','OLX_PASSWORD','PA_ACCESS_TOKEN')");
run("UPDATE core_factory_task SET enabled=0 WHERE task_id IN ('OLX_INTEGRATION','OLX_INTEGRATION_REFRESH','SALE_INTEGRATION','PA_INTEGRATION')");
console.log('OLX je potpuno isključen:');
for (const r of all("SELECT name, string_value IS NOT NULL ima_vrijednost, boolean_value FROM core_configuration WHERE name LIKE 'OLX%' OR name LIKE 'PA_%'")) console.log('  ', r.name, r.ima_vrijednost ? 'POSTAVLJENO' : 'prazno', r.boolean_value ?? '');
for (const r of all("SELECT task_id, enabled FROM core_factory_task")) console.log('   zadatak', r.task_id, r.enabled ? 'UKLJUČEN' : 'isključen');
