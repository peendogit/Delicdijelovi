// Pozadinski poslovi (core_factory_task): OLX_INTEGRATION, SALE_INTEGRATION, ATTACHMENTS_DELETE
// Raspored se čita iz baze (sat/minut kao u starom programu, npr. hour='2,4', minute='0/15').
import { all, run } from './db.js';
import { now } from './util.js';
import { jobPublishNew, jobRemoveSold } from './olx.js';
import { purgeDeletedFiles } from './routes/files.js';

const JOBS = {
  OLX_INTEGRATION: () => jobPublishNew(200),
  SALE_INTEGRATION: () => jobRemoveSold(),
  ATTACHMENTS_DELETE: () => purgeDeletedFiles(),
};

function matches(field, val) {
  if (field == null || field === '*' || field === '?') return true;
  return String(field).split(',').some(part => {
    if (part.includes('/')) { const [s, step] = part.split('/').map(Number); return val >= s && (val - s) % step === 0; }
    return Number(part) === val;
  });
}

export function startScheduler() {
  let lastMinute = '';
  setInterval(async () => {
    const t = now(); const minute = t.slice(0, 16);
    if (minute === lastMinute) return;
    lastMinute = minute;
    const h = Number(t.slice(11, 13)), m = Number(t.slice(14, 16));
    for (const task of all('SELECT * FROM core_factory_task WHERE enabled=1')) {
      const fn = JOBS[task.task_id];
      if (!fn || !matches(task.hour, h) || !matches(task.minute, m)) continue;
      try {
        const r = await fn();
        run('UPDATE core_factory_task SET last_execution=?, note=? WHERE task_id=?', now(), 'OK ' + (r ?? ''), task.task_id);
      } catch (e) {
        run('UPDATE core_factory_task SET last_execution=?, note=? WHERE task_id=?', now(), 'Greška: ' + e.message, task.task_id);
      }
    }
  }, 20000).unref();
}
