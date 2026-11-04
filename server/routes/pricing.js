// Prijedlozi cijena (na osnovu vlastitih prodaja) + masovno odobravanje sa mogućnošću poništavanja
import { app } from '../router.js';
import { db, get, all, run, insert, tx } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad } from '../util.js';
import { suggest, suggestById, levelNum } from '../pricing.js';

db.exec(`CREATE TABLE IF NOT EXISTS app_price_log (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT, part_id TEXT, old_price REAL, new_price REAL,
  source TEXT, created_by_id TEXT, created_date TEXT, undone INTEGER DEFAULT 0);
  CREATE INDEX IF NOT EXISTS ix_price_log_batch ON app_price_log(batch_id);`);

app.get('/api/pricing/part/:id', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP');
  return suggestById(ctx.params.id) || { price: null };
});

// Prijedlog za dio koji se tek unosi (forma)
app.get('/api/pricing/preview', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_SP_C');
  const q = ctx.query;
  if (!q.type_id) return { price: null };
  return suggest({ ...q, model_year: q.model_year ? Number(q.model_year) : null, damaged: q.damaged === '1' }) || { price: null };
});

// Dijelovi na stanju bez cijene + prijedlog
function candidates(q) {
  const w = ["p.active=1", "p.status='UNSOLD'", '(p.price IS NULL OR p.price=0)']; const prm = [];
  for (const k of ['make_id', 'model_id', 'type_id', 'vehicle_id']) if (q[k]) { w.push(`p.${k}=?`); prm.push(q[k]); }
  if (q.group_id) { w.push('p.type_id IN (SELECT id FROM spare_part_type WHERE group_id=?)'); prm.push(q.group_id); }
  if (q.with_images === '1') w.push('EXISTS (SELECT 1 FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1)');
  const rows = all(`SELECT p.id, p.internal_code, p.title, p.type_id, p.model_id, p.make_id, p.catalog_number, p.model_year, p.damaged, p.created_date
    FROM spare_part p WHERE ${w.join(' AND ')} ORDER BY p.created_date DESC`, ...prm);
  const min = levelNum(q.min_level || 'high');
  const counts = { high: 0, medium: 0, low: 0, none: 0 };
  const out = [];
  for (const r of rows) {
    const s = suggest(r);
    if (!s) { counts.none++; continue; }
    counts[s.level]++;
    if (levelNum(s.level) >= min) out.push({ ...r, suggestion: s });
  }
  return { counts, rows: out };
}

app.get('/api/pricing/suggestions', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  const { counts, rows } = candidates(ctx.query);
  const lim = Math.min(Number(ctx.query.limit) || 50, 200), off = Number(ctx.query.offset) || 0;
  const page = rows.slice(off, off + lim).map(r => ({
    ...r, image_id: get('SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC LIMIT 1', r.id)?.id || null,
  }));
  return { total: rows.length, counts, rows: page };
});

function applyItems(items, source, user) {
  const batch = uuid(); const t = now(); let n = 0;
  tx(() => {
    for (const it of items) {
      const price = Number(it.price);
      if (!it.id || !(price > 0)) continue;
      const p = get("SELECT price FROM spare_part WHERE id=? AND active=1 AND status='UNSOLD'", it.id);
      if (!p) continue;
      run("UPDATE spare_part SET price=?, currency_id=coalesce(currency_id,'BAM'), modified_by_id=?, modified_date=? WHERE id=?", price, user.id, t, it.id);
      insert('app_price_log', { batch_id: batch, part_id: it.id, old_price: p.price, new_price: price, source, created_by_id: user.id, created_date: t, undone: 0 });
      n++;
    }
  });
  return { batch_id: batch, count: n };
}

app.post('/api/pricing/apply', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  if (!Array.isArray(ctx.body.items) || !ctx.body.items.length) throw bad('Ništa nije izabrano');
  return applyItems(ctx.body.items, ctx.body.source || 'prijedlog', ctx.user);
});

// Odobri SVE prijedloge koji odgovaraju filteru (izuzetak: ručno izmijenjene cijene šalje klijent u overrides)
app.post('/api/pricing/apply-filter', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  const { rows } = candidates(ctx.body.filter || {});
  const ov = ctx.body.overrides || {};
  const skip = new Set(ctx.body.skip || []);
  return applyItems(rows.filter(r => !skip.has(r.id)).map(r => ({ id: r.id, price: ov[r.id] ?? r.suggestion.price })), 'prijedlog-masovno', ctx.user);
});

app.get('/api/pricing/batches', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  return all(`SELECT l.batch_id, l.source, min(l.created_date) date, count(*) n, max(l.undone) undone, sum(l.new_price) total, u.full_name user_name
    FROM app_price_log l LEFT JOIN core_user u ON u.id=l.created_by_id GROUP BY l.batch_id ORDER BY date DESC LIMIT 20`);
});

app.post('/api/pricing/batches/:id/undo', ctx => {
  need(ctx.user, 'ROLE_SP_U');
  const rows = all('SELECT * FROM app_price_log WHERE batch_id=? AND undone=0', ctx.params.id);
  if (!rows.length) throw bad('Već poništeno');
  let n = 0;
  tx(() => {
    for (const r of rows) {
      // vrati staru cijenu samo ako je u međuvremenu niko nije ručno promijenio
      const res = run("UPDATE spare_part SET price=?, modified_by_id=?, modified_date=? WHERE id=? AND price=? AND status='UNSOLD'", r.old_price, ctx.user.id, now(), r.part_id, r.new_price);
      n += Number(res.changes || 0);
    }
    run('UPDATE app_price_log SET undone=1 WHERE batch_id=?', ctx.params.id);
  });
  return { restored: n, total: rows.length };
});
