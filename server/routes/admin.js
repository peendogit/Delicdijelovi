// Administracija šifarnika (marke, modeli, grupe, vrste dijelova, felne, tipovi lokacija, valute, podešavanja)
import { app } from '../router.js';
import { get, all, run, insert, update, tx, LICENCE } from '../db.js';
import { need } from '../auth.js';
import { uuid, now, bad, notFound, pick, modelLabel, setConfig } from '../util.js';

const E = {
  car_make: { auth: ['ROLE_SP_ADM', 'ROLE_VEH_ADM'], fields: ['name', 'icon', 'active', 'external_olx_id'], order: 'name', audit: 'mod' },
  car_model: { auth: ['ROLE_SP_ADM', 'ROLE_VEH_ADM'], fields: ['name', 'generation_name', 'restyling', 'restyling_second', 'make_id', 'date_from', 'date_to', 'active', 'external_id'], order: 'name, date_from', audit: 'full', filter: 'make_id' },
  spare_part_group: { auth: ['ROLE_SP_ADM'], fields: ['title', 'catalog_number_required', 'share_engine_data', 'share_engine_code', 'share_gearbox_data', 'active'], order: 'title', audit: 'full', licence: true },
  spare_part_type: { auth: ['ROLE_SP_ADM'], fields: ['title', 'group_id', 'external_olx_id', 'external_pa_id', 'title_pa', 'catalog_number_required', 'engine_number_visible', 'part_set_visible', 'sides', 'share_engine_data', 'share_engine_code', 'share_gearbox_data', 'share_all_wheel_drive', 'active'], order: 'title', audit: 'full', licence: true, filter: 'group_id' },
  rims_type: { auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], fields: ['title', 'active', 'external_olx_id', 'external_pa_id'], order: 'title' },
  rims_diameter: { auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], fields: ['title', 'external_olx_id', 'external_pa_id'], order: 'CAST(title AS INTEGER)', hardDelete: true },
  rims_width: { auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], fields: ['title', 'external_pa_id'], order: 'CAST(title AS REAL)', hardDelete: true },
  rims_bolt_pattern: { auth: ['ROLE_RIMS_U', 'ROLE_SP_ADM'], fields: ['bolt_number', 'bolt_distance', 'external_pa_id'], order: 'bolt_number, CAST(bolt_distance AS REAL)', hardDelete: true, defaults: { external_pa_id: '' } },
  whs_ast_type: { auth: ['ROLE_WHS_U', 'ROLE_SUPERADMIN'], fields: ['title', 'code', 'code_strategy', 'base', 'parts_allowed', 'code_edit_allowed', 'move_allowed', 'height_details_allowed', 'the_order', 'active'], order: 'the_order', audit: 'full', licence: true },
  whs: { auth: ['ROLE_WHS_U'], fields: ['title', 'active'], order: 'title', audit: 'full', licence: true },
};
const BOOL = new Set(['active', 'restyling', 'restyling_second', 'catalog_number_required', 'share_engine_data', 'share_engine_code', 'share_gearbox_data', 'share_all_wheel_drive', 'engine_number_visible', 'part_set_visible', 'base', 'parts_allowed', 'code_edit_allowed', 'move_allowed', 'height_details_allowed']);

function ent(name, user) {
  const e = E[name];
  if (!e) throw notFound('Nepoznat šifarnik');
  need(user, ...e.auth);
  return e;
}
function clean(e, body) {
  const d = pick(body, e.fields);
  for (const k of Object.keys(d)) if (BOOL.has(k)) d[k] = d[k] ? 1 : 0;
  return d;
}

app.get('/api/admin/:entity', ctx => {
  const e = ent(ctx.params.entity, ctx.user);
  const f = e.filter && ctx.query[e.filter];
  const del = e.audit === 'full' ? 'deleted_date IS NULL' : '1=1';
  const rows = all(`SELECT * FROM "${ctx.params.entity}" WHERE ${del} ${f ? `AND ${e.filter}=?` : ''} ORDER BY ${e.order}`, ...(f ? [f] : []));
  if (ctx.params.entity === 'car_model') for (const r of rows) r.label = modelLabel(r);
  if (ctx.params.entity === 'spare_part_type') {
    const ch = all('SELECT * FROM spare_part_type_children');
    const cnt = Object.fromEntries(all("SELECT type_id, count(*) n FROM spare_part WHERE active=1 AND status='UNSOLD' GROUP BY type_id").map(r => [r.type_id, r.n]));
    for (const r of rows) { r.children = ch.filter(c => c.type_id === r.id).map(c => c.child_id); r.parts = cnt[r.id] || 0; }
  }
  if (ctx.params.entity === 'whs_ast_type') {
    const ch = all('SELECT * FROM whs_ast_type_children');
    for (const r of rows) r.children = ch.filter(c => c.type_id === r.id).map(c => c.type_child_id);
  }
  return rows;
});

app.post('/api/admin/:entity', ctx => {
  const e = ent(ctx.params.entity, ctx.user);
  const d = { ...(e.defaults || {}), ...clean(e, ctx.body) };
  const id = uuid(); const t = now();
  const row = { id, ...d };
  if ('active' in Object.fromEntries(e.fields.map(f => [f, 1])) && row.active === undefined) row.active = 1;
  if (e.licence) row.licence = LICENCE;
  if (e.audit === 'full') Object.assign(row, { created_by_id: ctx.user.id, created_date: t, modified_by_id: ctx.user.id, modified_date: t });
  if (e.audit === 'mod') Object.assign(row, { modified_by_id: ctx.user.id, modified_date: t });
  if (ctx.params.entity === 'car_model') { delete row.created_by_id; row.created_date = t; }
  tx(() => {
    insert(ctx.params.entity, row);
    saveChildren(ctx.params.entity, id, ctx.body);
  });
  return { id };
});

function saveChildren(entity, id, body) {
  if (!Array.isArray(body.children)) return;
  if (entity === 'spare_part_type') {
    run('DELETE FROM spare_part_type_children WHERE type_id=?', id);
    for (const c of body.children) insert('spare_part_type_children', { type_id: id, child_id: c });
  }
  if (entity === 'whs_ast_type') {
    run('DELETE FROM whs_ast_type_children WHERE type_id=?', id);
    body.children.forEach((c, i) => insert('whs_ast_type_children', { type_id: id, type_child_id: c, the_order: i + 1 }));
  }
}

app.put('/api/admin/:entity/:id', ctx => {
  const e = ent(ctx.params.entity, ctx.user);
  const d = clean(e, ctx.body);
  if (e.audit) Object.assign(d, { modified_by_id: ctx.user.id, modified_date: now() });
  tx(() => {
    update(ctx.params.entity, d, 'id=?', ctx.params.id);
    saveChildren(ctx.params.entity, ctx.params.id, ctx.body);
  });
  return { ok: true };
});

app.del('/api/admin/:entity/:id', ctx => {
  const e = ent(ctx.params.entity, ctx.user);
  if (e.hardDelete) run(`DELETE FROM "${ctx.params.entity}" WHERE id=?`, ctx.params.id);
  else if (e.audit === 'full') run(`UPDATE "${ctx.params.entity}" SET active=0, deleted_by_id=?, deleted_date=? WHERE id=?`, ctx.user.id, now(), ctx.params.id);
  else run(`UPDATE "${ctx.params.entity}" SET active=0 WHERE id=?`, ctx.params.id);
  return { ok: true };
});

// Podešavanja (core_configuration)
const SECRET = new Set(['OLX_CLIENT_TOKEN', 'PA_ACCESS_TOKEN', 'OLX_PASSWORD']);
app.get('/api/config', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM');
  return all('SELECT * FROM core_configuration ORDER BY name').map(r => (SECRET.has(r.name) && r.string_value ? { ...r, string_value: '••••••', secret: true } : r));
});
app.put('/api/config/:name', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM');
  const { field, value } = ctx.body;
  if (!['string_value', 'int_value', 'boolean_value', 'double_value', 'date_value'].includes(field)) throw bad('Pogrešno polje');
  if (SECRET.has(ctx.params.name) && value === '••••••') return { ok: true };
  setConfig(ctx.params.name, field, field === 'boolean_value' ? (value ? 1 : 0) : value, LICENCE);
  return { ok: true };
});

app.get('/api/currencies', ctx => all('SELECT * FROM core_currency ORDER BY code'));
app.put('/api/currencies/:code', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM');
  run('UPDATE core_currency SET active=? WHERE code=?', ctx.body.active ? 1 : 0, ctx.params.code);
  return { ok: true };
});

app.get('/api/tasks', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM');
  return all('SELECT * FROM core_factory_task ORDER BY task_id');
});
app.put('/api/tasks/:id', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM');
  run('UPDATE core_factory_task SET enabled=? WHERE task_id=?', ctx.body.enabled ? 1 : 0, ctx.params.id);
  return { ok: true };
});

// Rezervne kopije baze
import { backupNow, listBackups, BACKUP_DIR } from '../backup.js';
import fs from 'node:fs';
import pathMod from 'node:path';
app.get('/api/backups', ctx => { need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM'); return listBackups(); });
app.post('/api/backups', async ctx => { need(ctx.user, 'ROLE_SUPERADMIN', 'ROLE_SP_ADM'); return backupNow(); });
app.get('/api/backups/:name', ctx => {
  need(ctx.user, 'ROLE_SUPERADMIN');
  const name = pathMod.basename(ctx.params.name);
  const f = pathMod.join(BACKUP_DIR, name);
  if (!/^delic-.*\.db\.gz$/.test(name) || !fs.existsSync(f)) throw notFound();
  ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': fs.statSync(f).size });
  fs.createReadStream(f).pipe(ctx.res);
});
