import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound } from '../util.js';
import { assetById, assetLabel, clearLabelCache } from '../whsutil.js';

const R = ['ROLE_WHS_R', 'ROLE_WHS', 'ROLE_WHS_CLERK', 'ROLE_SP_LOC_U', 'ROLE_SP_R'];

app.get('/api/whs', ctx => {
  need(ctx.user, ...R);
  const parts = Object.fromEntries(all("SELECT a.whs_id, count(*) n FROM spare_part p JOIN whs_ast a ON a.id=p.location_id WHERE p.active=1 AND p.status='UNSOLD' GROUP BY a.whs_id").map(r => [r.whs_id, r.n]));
  const rows = all(`SELECT w.*, (SELECT count(*) FROM whs_ast a WHERE a.whs_id=w.id AND a.active=1) assets FROM whs w WHERE w.active=1 ORDER BY w.title`);
  for (const r of rows) r.parts = parts[r.id] || 0;
  return rows;
});
app.post('/api/whs', ctx => {
  need(ctx.user, 'ROLE_WHS_C');
  if (!ctx.body.title) throw bad('Unesite naziv');
  const id = uuid(); const t = now();
  insert('whs', { id, title: ctx.body.title, licence: LICENCE, active: 1, created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
  return { id };
});
app.put('/api/whs/:id', ctx => {
  need(ctx.user, 'ROLE_WHS_U');
  update('whs', { title: ctx.body.title, modified_by_id: ctx.user.id, modified_date: now() }, 'id=?', ctx.params.id);
  clearLabelCache();
  return { ok: true };
});
app.del('/api/whs/:id', ctx => {
  need(ctx.user, 'ROLE_WHS_D');
  if (get('SELECT 1 x FROM whs_ast WHERE whs_id=? AND active=1 LIMIT 1', ctx.params.id)) throw bad('Magacin nije prazan — prvo obrišite lokacije');
  run('UPDATE whs SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), ctx.params.id);
  return { ok: true };
});

app.get('/api/whs-types', ctx => {
  const types = all('SELECT * FROM whs_ast_type WHERE active=1 ORDER BY the_order');
  const ch = all('SELECT * FROM whs_ast_type_children ORDER BY the_order');
  for (const t of types) t.children = ch.filter(c => c.type_id === t.id).map(c => c.type_child_id);
  return types;
});

function assetRows(where, ...p) {
  return all(`SELECT a.id, a.code, a.additional_code, a.code_extended, a.ast_type_id, a.parent_id, a.whs_id, a.ladder_first_level, a.ladder_second_level, a.forklift,
      t.title type_title, t.parts_allowed, t.move_allowed,
      (SELECT count(*) FROM whs_ast c WHERE c.parent_id=a.id AND c.active=1) children,
      (SELECT count(*) FROM spare_part p WHERE p.location_id=a.id AND p.active=1 AND p.status='UNSOLD') parts,
      (SELECT count(*) FROM rims r WHERE r.location_id=a.id AND r.active=1 AND r.status='UNSOLD') rims
    FROM whs_ast a JOIN whs_ast_type t ON t.id=a.ast_type_id WHERE a.active=1 AND ${where}
    ORDER BY t.the_order, coalesce(a.code, 0), a.code_extended`, ...p);
}

app.get('/api/assets', ctx => {
  need(ctx.user, ...R);
  const q = ctx.query;
  if (q.parent_id) return assetRows('a.parent_id=?', q.parent_id);
  if (q.whs_id) return assetRows('a.whs_id=? AND a.parent_id IS NULL', q.whs_id);
  throw bad('Nedostaje whs_id ili parent_id');
});

app.get('/api/assets/find', ctx => {
  need(ctx.user, ...R);
  const c = String(ctx.query.code || '').trim().toUpperCase();
  return all(`SELECT a.id, a.code_extended, t.title type_title, t.parts_allowed, w.title whs_title FROM whs_ast a JOIN whs_ast_type t ON t.id=a.ast_type_id LEFT JOIN whs w ON w.id=a.whs_id
    WHERE a.active=1 AND upper(a.code_extended) LIKE ? ORDER BY length(a.code_extended), a.code_extended LIMIT 30`, c + '%').map(r => ({ ...r, label: assetLabel(r.id) }));
});

app.get('/api/assets/:id', ctx => {
  need(ctx.user, ...R);
  const a = assetById(ctx.params.id);
  if (!a) throw notFound('Lokacija ne postoji');
  a.label = assetLabel(a.id);
  a.parent = a.parent_id ? { id: a.parent_id, label: assetLabel(a.parent_id) } : null;
  a.children = assetRows('a.parent_id=?', a.id);
  const deep = ctx.query.deep === '1';
  const locFilter = deep ? "p.location_id IN (SELECT id FROM whs_ast WHERE path LIKE '%/'||?||'/%')" : 'p.location_id=?';
  a.parts = all(`SELECT p.id, p.internal_code, p.title, p.catalog_number, p.price, p.status, p.side, l.code_extended location_code,
      (SELECT x.id FROM lib_attachment x WHERE x.object_id=p.id AND x.active=1 ORDER BY x.main_picture DESC LIMIT 1) image_id
    FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id WHERE ${locFilter} AND p.active=1 AND p.status='UNSOLD' ORDER BY p.title LIMIT 2000`, a.id);
  a.rims = all(`SELECT r.id, r.internal_code, r.price FROM rims r WHERE ${locFilter.replace(/p\./g, 'r.')} AND r.active=1 AND r.status='UNSOLD'`, a.id);
  a.history = all(`SELECT h.created_date, p.code_extended parent_code, u.full_name user_name FROM whs_ast_location_history h LEFT JOIN whs_ast p ON p.id=h.parent_id
    LEFT JOIN core_user u ON u.id=h.created_by_id WHERE h.asset_id=? ORDER BY h.id DESC LIMIT 50`, a.id);
  return a;
});

function nextCode(type, whsId, parentId) {
  if (type.code_strategy === 'LETTER') {
    const used = all('SELECT code_extended c FROM whs_ast WHERE ast_type_id=? AND whs_id=? AND active=1', type.id, whsId).map(r => r.c);
    for (let i = 0; i < 26; i++) { const L = String.fromCharCode(65 + i); if (!used.includes(L)) return { code: null, ext: L }; }
    throw bad('Nema više slobodnih slova');
  }
  let n;
  if (type.code_strategy === 'NUMBER_WAREHOUSE_PARENT_UNIQUE') {
    n = (get(`SELECT max(code) m FROM whs_ast WHERE ast_type_id=? AND whs_id=? AND ${parentId ? 'parent_id=?' : 'parent_id IS NULL'} AND active=1`, type.id, whsId, ...(parentId ? [parentId] : [])).m || 0) + 1;
  } else {
    n = (get('SELECT max(code) m FROM whs_ast WHERE ast_type_id=?', type.id).m || 0) + 1;
  }
  return { code: n, ext: (type.code || '') + n };
}

app.post('/api/assets', ctx => {
  need(ctx.user, 'ROLE_WHS_C', 'ROLE_WHS_U');
  const { whs_id, parent_id, ast_type_id } = ctx.body;
  const count = Math.min(Math.max(Number(ctx.body.count) || 1, 1), 200);
  const type = get('SELECT * FROM whs_ast_type WHERE id=?', ast_type_id);
  if (!type) throw bad('Izaberite tip lokacije');
  let parent = null;
  if (parent_id) {
    parent = get('SELECT * FROM whs_ast WHERE id=?', parent_id);
    if (!parent) throw bad('Nadređena lokacija ne postoji');
    if (!get('SELECT 1 x FROM whs_ast_type_children WHERE type_id=? AND type_child_id=?', parent.ast_type_id, type.id)) throw bad('Ovaj tip se ne može staviti u izabranu lokaciju');
  } else if (!type.base) throw bad('Ovaj tip mora imati nadređenu lokaciju');
  const wid = parent ? parent.whs_id : whs_id;
  if (!wid || !get('SELECT 1 x FROM whs WHERE id=? AND active=1', wid)) throw bad('Izaberite magacin');
  const created = [];
  tx(() => {
    for (let i = 0; i < count; i++) {
      const { code, ext } = nextCode(type, wid, parent?.id);
      const add = type.code_edit_allowed && ctx.body.additional_code ? String(ctx.body.additional_code).toUpperCase().slice(0, 3) : null;
      const id = uuid(); const t = now();
      const ppath = parent ? parent.path : '/';
      insert('whs_ast', { id, parent_id: parent?.id || null, whs_id: wid, ast_type_id: type.id, code, additional_code: add, code_extended: ext + (add || ''),
        path: ppath + id + '/', parent_path: ppath, licence: LICENCE, active: 1, ladder_first_level: ctx.body.ladder_first_level ? 1 : 0,
        ladder_second_level: ctx.body.ladder_second_level ? 1 : 0, forklift: ctx.body.forklift ? 1 : 0, created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
      created.push({ id, code_extended: ext + (add || '') });
    }
  });
  return { created };
});

app.put('/api/assets/:id', ctx => {
  need(ctx.user, 'ROLE_WHS_U');
  const a = assetById(ctx.params.id);
  if (!a) throw notFound();
  const d = { modified_by_id: ctx.user.id, modified_date: now() };
  if (a.height_details_allowed || a.code_edit_allowed) {
    for (const k of ['ladder_first_level', 'ladder_second_level', 'forklift']) if (k in ctx.body) d[k] = ctx.body[k] ? 1 : 0;
  }
  if (a.code_edit_allowed && 'additional_code' in ctx.body) {
    const add = ctx.body.additional_code ? String(ctx.body.additional_code).toUpperCase().slice(0, 3) : null;
    let code = a.code;
    if (ctx.body.code) code = Number(ctx.body.code);
    d.code = code; d.additional_code = add; d.code_extended = (a.type_code || '') + code + (add || '');
    if (get('SELECT 1 x FROM whs_ast WHERE code_extended=? AND ast_type_id=? AND id<>? AND active=1', d.code_extended, a.ast_type_id, a.id)) throw bad('Kod ' + d.code_extended + ' već postoji');
  }
  update('whs_ast', d, 'id=?', a.id);
  clearLabelCache();
  return { ok: true };
});

// Premještanje palete/kutije na drugu lokaciju
app.post('/api/assets/:id/move', ctx => {
  need(ctx.user, 'ROLE_WHS_U', 'ROLE_WHS_CLERK');
  const a = assetById(ctx.params.id);
  if (!a) throw notFound();
  if (!a.move_allowed) throw bad(a.type_title + ' se ne može premještati');
  let target = ctx.body.parent_id ? get('SELECT * FROM whs_ast WHERE id=?', ctx.body.parent_id) : null;
  if (!target && ctx.body.parent_code) {
    const rows = all(`SELECT a.* FROM whs_ast a WHERE upper(a.code_extended)=? AND a.active=1`, String(ctx.body.parent_code).trim().toUpperCase());
    if (rows.length > 1) throw bad('Kod nije jedinstven');
    target = rows[0];
  }
  if (!target) throw bad('Odredište ne postoji');
  if (target.path.includes('/' + a.id + '/')) throw bad('Ne može se staviti u samu sebe');
  if (!get('SELECT 1 x FROM whs_ast_type_children WHERE type_id=? AND type_child_id=?', target.ast_type_id, a.ast_type_id)) throw bad(a.type_title + ' se ne može staviti na tu lokaciju');
  const oldPath = a.path; const newPath = target.path + a.id + '/';
  tx(() => {
    run('UPDATE whs_ast SET parent_id=?, whs_id=?, path=?, parent_path=?, modified_by_id=?, modified_date=? WHERE id=?', target.id, target.whs_id, newPath, target.path, ctx.user.id, now(), a.id);
    for (const d of all('SELECT id, path, parent_path FROM whs_ast WHERE path LIKE ? AND id<>?', oldPath + '%', a.id)) {
      run('UPDATE whs_ast SET path=?, parent_path=?, whs_id=? WHERE id=?', newPath + d.path.slice(oldPath.length), newPath + d.parent_path.slice(oldPath.length), target.whs_id, d.id);
    }
    insert('whs_ast_location_history', { asset_id: a.id, parent_id: target.id, created_by_id: ctx.user.id, created_date: now() });
  });
  clearLabelCache();
  return { ok: true, label: assetLabel(a.id) };
});

app.del('/api/assets/:id', ctx => {
  need(ctx.user, 'ROLE_WHS_D');
  const id = ctx.params.id;
  if (get('SELECT 1 x FROM whs_ast WHERE parent_id=? AND active=1 LIMIT 1', id)) throw bad('Lokacija ima pod-lokacije');
  if (get("SELECT 1 x FROM spare_part WHERE location_id=? AND active=1 AND status='UNSOLD' LIMIT 1", id)) throw bad('Na lokaciji ima dijelova');
  run('UPDATE whs_ast SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?', ctx.user.id, now(), id);
  return { ok: true };
});
