// Početna — widgeti kao u starom programu (zadnji dijelovi, prodati, vraćeni, aktivni nalozi, sadržaj polica)
import { app } from '../router.js';
import { get, all } from '../db.js';
import { can } from '../auth.js';
import { configStr } from '../util.js';
import { assetLabel } from '../whsutil.js';

const IMG = `(SELECT a.id FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1 ORDER BY a.main_picture DESC LIMIT 1) image_id`;

app.get('/api/dashboard', ctx => {
  const u = ctx.user; const out = { widgets: [] };
  if (can(u, 'ROLE_SP_R', 'ROLE_SP')) {
    out.widgets.push({ key: 'last_parts', title: 'Zadnji uneseni dijelovi', rows: all(`SELECT p.id, p.internal_code, p.title, p.price, p.created_date d, cu.full_name user_name, ${IMG}
      FROM spare_part p LEFT JOIN core_user cu ON cu.id=p.created_by_id WHERE p.active=1 ORDER BY p.created_date DESC LIMIT 10`) });
    out.widgets.push({ key: 'last_sold', title: 'Zadnji prodati dijelovi', rows: all(`SELECT p.id, p.internal_code, p.title, h.the_price price, h.created_date d, cu.full_name user_name, ${IMG}
      FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id LEFT JOIN core_user cu ON cu.id=h.created_by_id WHERE h.status='SOLD' ORDER BY h.created_date DESC LIMIT 10`) });
    out.widgets.push({ key: 'last_returned', title: 'Zadnji vraćeni dijelovi', rows: all(`SELECT p.id, p.internal_code, p.title, h.the_price price, h.created_date d, cu.full_name user_name, ${IMG}
      FROM spare_part_sale_history h JOIN spare_part p ON p.id=h.part_id LEFT JOIN core_user cu ON cu.id=h.created_by_id WHERE h.status='UNSOLD' ORDER BY h.created_date DESC LIMIT 10`) });
  }
  if (can(u, 'ROLE_REQ', 'ROLE_REQ_R', 'ROLE_WHS_CLERK')) {
    out.widgets.push({ key: 'active_req', title: 'Aktivni nalozi', rows: all(`SELECT r.id, r.the_number, r.status, r.urgent, r.shipment, r.created_date d, p.id part_id, p.internal_code, p.title, l.code_extended location_code, cu.full_name user_name
      FROM req r LEFT JOIN spare_part p ON p.id=r.part_id LEFT JOIN whs_ast l ON l.id=coalesce(p.location_id, r.location_id) LEFT JOIN core_user cu ON cu.id=r.created_by_id
      WHERE r.active=1 AND r.status IN ('NEW','PREPARED') ORDER BY r.urgent DESC, r.created_date LIMIT 30`) });
  }
  if (can(u, 'ROLE_WHS_R', 'ROLE_WHS', 'ROLE_WHS_CLERK', 'ROLE_SP_R')) {
    const ids = all("SELECT DISTINCT c.custom_string_1 id, c.title FROM dsh_wdg w JOIN dsh_wdg_conf c ON c.id=w.config_id WHERE w.widget_class LIKE '%WidgetAssets'");
    const fallback = [configStr('WAREHOUSE_DEFAULT_ASSET'), configStr('WAREHOUSE_RETURN_ASSET')].filter(Boolean).map(id => ({ id }));
    for (const a of (ids.length ? ids : fallback)) {
      if (!a.id || !get('SELECT 1 x FROM whs_ast WHERE id=? AND active=1', a.id)) continue;
      const rows = all(`SELECT p.id, p.internal_code, p.title, p.price, p.modified_date d, ${IMG} FROM spare_part p WHERE p.location_id=? AND p.active=1 AND p.status='UNSOLD' ORDER BY p.modified_date DESC LIMIT 50`, a.id);
      const n = get("SELECT count(*) n FROM spare_part WHERE location_id=? AND active=1 AND status='UNSOLD'", a.id).n;
      out.widgets.push({ key: 'asset', asset_id: a.id, title: (a.title || 'Lokacija') + ' — ' + assetLabel(a.id), count: n, rows });
    }
  }
  out.counts = {
    parts: get("SELECT count(*) n FROM spare_part WHERE active=1 AND status='UNSOLD'").n,
    vehicles: get('SELECT count(*) n FROM vehicle WHERE active=1').n,
    rims: get("SELECT count(*) n FROM rims WHERE active=1 AND status='UNSOLD'").n,
    req: get("SELECT count(*) n FROM req WHERE active=1 AND status IN ('NEW','PREPARED')").n,
  };
  return out;
});

// Globalna pretraga (šifra dijela, felne, vozila, lokacije, broj naloga)
app.get('/api/search', ctx => {
  const q = String(ctx.query.q || '').trim();
  if (!q) return [];
  const U = q.toUpperCase(); const res = [];
  const p = get('SELECT id, internal_code, title, status FROM spare_part WHERE internal_code=? AND active=1', U);
  if (p) res.push({ kind: 'part', id: p.id, label: `${p.internal_code} · ${p.title}`, sub: p.status === 'SOLD' ? 'Prodat' : 'Na stanju' });
  const r = get('SELECT id, internal_code FROM rims WHERE upper(internal_code)=? AND active=1', U);
  if (r) res.push({ kind: 'rims', id: r.id, label: `Felna ${r.internal_code}` });
  if (/^\d+$/.test(q)) {
    const v = get('SELECT id, internal_code, model_id, model_year FROM vehicle WHERE internal_code=? AND active=1', q);
    if (v) res.push({ kind: 'vehicle', id: v.id, label: `Vozilo ${v.internal_code}`, sub: String(v.model_year) });
    const n = get('SELECT id, the_number FROM req WHERE the_number=? AND active=1', q);
    if (n) res.push({ kind: 'req', id: n.id, label: `Nalog #${n.the_number}` });
  }
  for (const a of all(`SELECT a.id, a.code_extended FROM whs_ast a JOIN whs_ast_type t ON t.id=a.ast_type_id WHERE upper(a.code_extended)=? AND a.active=1 LIMIT 5`, U))
    res.push({ kind: 'asset', id: a.id, label: `Lokacija ${a.code_extended}`, sub: assetLabel(a.id) });
  if (can(ctx.user, 'ROLE_SP_R', 'ROLE_SP')) {
    const l = '%' + q + '%';
    for (const x of all(`SELECT id, internal_code, title FROM spare_part WHERE active=1 AND status='UNSOLD' AND (catalog_number LIKE ? OR title LIKE ?) ORDER BY created_date DESC LIMIT 8`, l.replace(/\s/g, ''), l))
      if (!res.find(y => y.id === x.id)) res.push({ kind: 'part', id: x.id, label: `${x.internal_code} · ${x.title}` });
  }
  return res;
});
