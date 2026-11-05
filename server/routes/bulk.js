// Pretraga liste kataloških brojeva: zalijepi listu, za svaki broj: ima li ga, koliko, gdje, cijena
import { app } from '../router.js';
import { all } from '../db.js';
import { need } from '../auth.js';
import { bad } from '../util.js';

// mora biti ISTI izraz kao u indeksima ix_sp_catn / ix_sp_catmn (db.js)
const N = c => `upper(replace(replace(replace(replace(${c},' ',''),'-',''),'.',''),'/',''))`;
export const norm = s => String(s || '').toUpperCase().replace(/[\s\-./]/g, '');

app.post('/api/parts/bulk-search', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP');
  const items = (ctx.body.items || []).map(x => String(x).trim()).filter(Boolean);
  if (!items.length) throw bad('Lista je prazna');
  if (items.length > 300) throw bad('Najviše 300 brojeva odjednom');
  const partial = !!ctx.body.partial;
  const cols = `p.id, p.internal_code, p.title, p.catalog_number, p.catalog_number_manufacturer, p.price, p.currency_id, p.status, p.side, p.created_date,
    l.code_extended location_code, (SELECT a.id FROM lib_attachment a WHERE a.object_id=p.id AND a.active=1 ORDER BY a.main_picture DESC LIMIT 1) image_id`;
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const n = norm(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    let rows;
    if (n.length >= 3 && !partial) {
      rows = all(`SELECT ${cols} FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id
        WHERE p.active=1 AND (${N('p.catalog_number')}=? OR ${N('p.catalog_number_manufacturer')}=? OR p.internal_code=?)
        ORDER BY p.status DESC, p.created_date DESC LIMIT 50`, n, n, n);
    } else if (n.length >= 5) {
      // djelimično: broj iz liste je dio kataloškog broja (npr. bez slova na kraju)
      rows = all(`SELECT ${cols} FROM spare_part p LEFT JOIN whs_ast l ON l.id=p.location_id
        WHERE p.active=1 AND (${N('p.catalog_number')} LIKE ? OR ${N('p.catalog_number_manufacturer')} LIKE ?)
        ORDER BY p.status DESC, p.created_date DESC LIMIT 50`, '%' + n + '%', '%' + n + '%');
    } else rows = [];
    const unsold = rows.filter(r => r.status === 'UNSOLD');
    const prices = unsold.map(r => r.price).filter(p => p > 0);
    out.push({
      input: raw, norm: n,
      unsold: unsold.length, sold: rows.length - unsold.length,
      min_price: prices.length ? Math.min(...prices) : null, max_price: prices.length ? Math.max(...prices) : null,
      last_sold: rows.find(r => r.status === 'SOLD')?.created_date || null,
      rows,
    });
  }
  return { results: out, found: out.filter(r => r.unsold).length, total: out.length };
});
