import { app } from '../router.js';
import { all, get } from '../db.js';
import { modelLabel, configStr } from '../util.js';
import { assetLabel } from '../whsutil.js';

// Sve šifarnike u jednom pozivu (keširano u pregledaču)
app.get('/api/lookups', ctx => {
  const makes = all('SELECT id, name, icon, active FROM car_make ORDER BY name');
  const groups = all('SELECT id, title, catalog_number_required, share_engine_data, share_engine_code, share_gearbox_data, active FROM spare_part_group WHERE deleted_date IS NULL ORDER BY title');
  const types = all(`SELECT id, title, group_id, catalog_number_required, engine_number_visible, part_set_visible, sides, share_engine_data, share_engine_code,
      share_gearbox_data, share_all_wheel_drive, external_olx_id, external_pa_id, title_pa, active FROM spare_part_type WHERE deleted_date IS NULL ORDER BY title`);
  const ch = all('SELECT type_id, child_id FROM spare_part_type_children');
  for (const t of types) t.children = ch.filter(c => c.type_id === t.id).map(c => c.child_id);
  const users = all("SELECT id, full_name, active FROM core_user WHERE deleted_date IS NULL ORDER BY full_name");
  return {
    makes, groups, types, users,
    rims_types: all('SELECT * FROM rims_type ORDER BY title'),
    rims_diameters: all('SELECT * FROM rims_diameter ORDER BY CAST(title AS INTEGER)'),
    rims_widths: all('SELECT * FROM rims_width ORDER BY CAST(title AS REAL)'),
    rims_patterns: all("SELECT id, bolt_number, bolt_distance, bolt_number||'x'||bolt_distance title FROM rims_bolt_pattern ORDER BY bolt_number, CAST(bolt_distance AS REAL)"),
    warehouses: all('SELECT id, title FROM whs WHERE active=1 ORDER BY title'),
    currencies: all('SELECT code FROM core_currency WHERE active=1').map(r => r.code),
    currency: configStr('CURRENCY', 'BAM'),
    default_location: (() => { const id = configStr('WAREHOUSE_DEFAULT_ASSET'); return id ? { id, label: assetLabel(id) } : null; })(),
    return_location: (() => { const id = configStr('WAREHOUSE_RETURN_ASSET'); return id ? { id, label: assetLabel(id) } : null; })(),
  };
});

app.get('/api/models', ctx => {
  const rows = all(`SELECT id, name, generation_name, restyling, restyling_second, make_id, date_from, date_to, active FROM car_model WHERE make_id=? ${ctx.query.all ? '' : 'AND active=1'}
    ORDER BY name, date_from`, ctx.query.make_id);
  for (const r of rows) r.label = modelLabel(r);
  return rows;
});
