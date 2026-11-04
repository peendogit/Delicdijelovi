import { app } from '../router.js';
import { all, get } from '../db.js';
import { need } from '../auth.js';
import { publish, remove, updatePrice, describe, olxEnabled, jobPublishNew, jobRemoveSold } from '../olx.js';
import { HttpError } from '../util.js';
// ručne OLX akcije rade samo kad je integracija uključena (da se slučajno ne dira oglas dok radi stari program)
const on = () => { if (!olxEnabled()) throw new HttpError(400, 'OLX integracija je isključena (Administracija → Podešavanja)'); };

const KINDS = ['part', 'rims', 'vehicle'];
const chk = k => { if (!KINDS.includes(k)) throw new Error('Pogrešan tip'); return k; };

app.get('/api/olx/status', ctx => {
  need(ctx.user, 'ROLE_SP_ADM', 'ROLE_SUPERADMIN');
  return {
    enabled: olxEnabled(),
    listed: get('SELECT count(*) n FROM spare_part WHERE active=1 AND status=\'UNSOLD\' AND external_olx_id IS NOT NULL').n,
    not_listed: get('SELECT count(*) n FROM spare_part WHERE active=1 AND status=\'UNSOLD\' AND external_olx_id IS NULL').n,
    log: all(`SELECT g.*, coalesce(p.internal_code, r.internal_code) code FROM app_olx_log g LEFT JOIN spare_part p ON p.id=g.object_id LEFT JOIN rims r ON r.id=g.object_id
      ORDER BY g.id DESC LIMIT 100`),
  };
});
app.get('/api/olx/describe/:kind/:id', ctx => { need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', 'ROLE_RIMS_R', 'ROLE_VEH_R'); return describe(chk(ctx.params.kind), ctx.params.id); });
app.post('/api/olx/publish/:kind/:id', async ctx => { on(); need(ctx.user, 'ROLE_SP_U', 'ROLE_SP_ADM', 'ROLE_RIMS_U', 'ROLE_VEH_U'); return publish(chk(ctx.params.kind), ctx.params.id); });
app.post('/api/olx/remove/:kind/:id', async ctx => { on(); need(ctx.user, 'ROLE_SP_U', 'ROLE_SP_ADM', 'ROLE_RIMS_U', 'ROLE_VEH_U'); await remove(chk(ctx.params.kind), ctx.params.id); return { ok: true }; });
app.post('/api/olx/update/:kind/:id', async ctx => { on(); need(ctx.user, 'ROLE_SP_U', 'ROLE_SP_ADM', 'ROLE_RIMS_U'); await updatePrice(chk(ctx.params.kind), ctx.params.id); return { ok: true }; });
app.post('/api/olx/run', async ctx => {
  need(ctx.user, 'ROLE_SP_ADM', 'ROLE_SUPERADMIN');
  return { published: await jobPublishNew(Number(ctx.body.limit) || 20), removed: await jobRemoveSold() };
});
