// Prodaja sa kupcem i dokumentom (otpremnica), više stavki odjednom, garancija i pošiljke (brza pošta / pouzeće)
import { app } from '../router.js';
import { db, get, all, run, insert, tx, LICENCE } from '../db.js';
import { need, can } from '../auth.js';
import { uuid, now, today, bad, notFound, configStr, setConfig } from '../util.js';
import { sellItem } from './parts.js';
import { rimsTitle } from './rims.js';

db.exec(`
CREATE TABLE IF NOT EXISTS app_customer (id TEXT PRIMARY KEY, name TEXT, phone TEXT, phone_norm TEXT, city TEXT, address TEXT, note TEXT, created_date TEXT, created_by_id TEXT, active INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_cust_phone ON app_customer(phone_norm);
CREATE TABLE IF NOT EXISTS app_doc (id TEXT PRIMARY KEY, year INTEGER, number INTEGER, created_date TEXT, created_by_id TEXT, customer_id TEXT, customer_name TEXT, customer_phone TEXT,
  payment TEXT, total REAL, note TEXT, status TEXT DEFAULT 'OK');
CREATE INDEX IF NOT EXISTS ix_doc_date ON app_doc(created_date);
CREATE INDEX IF NOT EXISTS ix_doc_cust ON app_doc(customer_id);
CREATE TABLE IF NOT EXISTS app_doc_item (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, sale_id TEXT, part_id TEXT, rims_id TEXT, code TEXT, title TEXT, catalog_number TEXT, price REAL);
CREATE INDEX IF NOT EXISTS ix_doci_doc ON app_doc_item(doc_id);
CREATE INDEX IF NOT EXISTS ix_doci_part ON app_doc_item(part_id);
CREATE INDEX IF NOT EXISTS ix_doci_rims ON app_doc_item(rims_id);
CREATE TABLE IF NOT EXISTS app_shipment (id TEXT PRIMARY KEY, doc_id TEXT, customer_id TEXT, courier TEXT, tracking TEXT, cod_amount REAL, shipping_cost REAL,
  status TEXT DEFAULT 'PREP', cod_status TEXT, created_date TEXT, created_by_id TEXT, sent_date TEXT, delivered_date TEXT, paid_date TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS ix_ship_status ON app_shipment(status, cod_status);
`);
// podaci firme za otpremnicu (mogu se mijenjati u Administracija → Podešavanja)
for (const [k, v] of [['COMPANY_NAME', 'Auto otpad Delić'], ['COMPANY_ADDRESS', 'Pavlovića put 13, Bijeljina'], ['COMPANY_PHONE', '066 027 888'], ['WARRANTY_DAYS', '7']])
  if (configStr(k) == null) setConfig(k, 'string_value', v, LICENCE);

export const PAY = { CASH: 'Gotovina', CARD: 'Kartica', COD: 'Pouzeće', BANK: 'Virman/račun' };
const normPhone = p => String(p || '').replace(/\D/g, '').replace(/^00387|^387/, '0');
const SALE = ['ROLE_SP_SALE', 'ROLE_RIMS_U'];

// ---------- Kupci ----------
export function upsertCustomer(c, user) {
  if (!c) return null;
  if (c.id) return get('SELECT * FROM app_customer WHERE id=?', c.id);
  const name = (c.name || '').trim(), phone = (c.phone || '').trim();
  if (!name && !phone) return null;
  const pn = normPhone(phone);
  let ex = pn.length >= 6 ? get('SELECT * FROM app_customer WHERE phone_norm=? AND active=1', pn) : null;
  if (!ex && name && !pn) ex = get('SELECT * FROM app_customer WHERE lower(name)=lower(?) AND active=1', name);
  if (ex) {
    const upd = {}; for (const k of ['name', 'city', 'address']) if (c[k] && !ex[k]) upd[k] = c[k];
    if (Object.keys(upd).length) run(`UPDATE app_customer SET ${Object.keys(upd).map(k => k + '=?').join(',')} WHERE id=?`, ...Object.values(upd), ex.id);
    return get('SELECT * FROM app_customer WHERE id=?', ex.id);
  }
  const id = uuid();
  insert('app_customer', { id, name: name || null, phone: phone || null, phone_norm: pn || null, city: c.city || null, address: c.address || null, note: c.note || null, created_date: now(), created_by_id: user.id, active: 1 });
  return get('SELECT * FROM app_customer WHERE id=?', id);
}

app.get('/api/customers', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE);
  const q = String(ctx.query.q || '').trim();
  const l = '%' + q + '%', pn = '%' + normPhone(q) + '%';
  return all(`SELECT c.*, (SELECT count(*) FROM app_doc d WHERE d.customer_id=c.id AND d.status='OK') docs,
      (SELECT coalesce(sum(total),0) FROM app_doc d WHERE d.customer_id=c.id AND d.status='OK') spent, (SELECT max(created_date) FROM app_doc d WHERE d.customer_id=c.id) last
    FROM app_customer c WHERE c.active=1 ${q ? `AND (c.name LIKE ? OR c.city LIKE ? ${normPhone(q).length >= 3 ? 'OR c.phone_norm LIKE ?' : ''})` : ''}
    ORDER BY last DESC NULLS LAST, c.created_date DESC LIMIT ${q ? 20 : 300}`, ...(q ? [l, l, ...(normPhone(q).length >= 3 ? [pn] : [])] : []));
});
app.get('/api/customers/:id', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE);
  const c = get('SELECT * FROM app_customer WHERE id=?', ctx.params.id);
  if (!c) throw notFound();
  c.docs = all("SELECT d.*, (SELECT count(*) FROM app_doc_item i WHERE i.doc_id=d.id) items FROM app_doc d WHERE d.customer_id=? ORDER BY d.created_date DESC", c.id);
  c.demands = all("SELECT * FROM app_demand WHERE phone IS NOT NULL AND replace(replace(replace(phone,' ',''),'-',''),'/','') LIKE ? ORDER BY created_date DESC LIMIT 20", '%' + (c.phone_norm || '###').slice(-6));
  return c;
});
app.put('/api/customers/:id', ctx => {
  need(ctx.user, ...SALE);
  const b = ctx.body;
  run('UPDATE app_customer SET name=?, phone=?, phone_norm=?, city=?, address=?, note=? WHERE id=?', b.name || null, b.phone || null, normPhone(b.phone) || null, b.city || null, b.address || null, b.note || null, ctx.params.id);
  return { ok: true };
});

// ---------- Prodaja (dokument sa više stavki) ----------
app.post('/api/sales', ctx => {
  need(ctx.user, ...SALE);
  const b = ctx.body;
  const items = (b.items || []).filter(i => i && i.id);
  if (!items.length) throw bad('Nema stavki za prodaju');
  const payment = PAY[b.payment] ? b.payment : (b.shipment ? 'COD' : 'CASH');
  return tx(() => {
    const cust = upsertCustomer(b.customer, ctx.user);
    const docId = uuid(); const t = now(); const year = Number(t.slice(0, 4));
    const number = (get('SELECT max(number) m FROM app_doc WHERE year=?', year).m || 0) + 1;
    let total = 0; const rows = [];
    for (const it of items) {
      const kind = it.kind === 'rims' ? 'rims' : 'part';
      const sid = sellItem(kind, it.id, { price: it.price, note: [b.note, cust?.name].filter(Boolean).join(' · ') || null }, ctx.user);
      const s = get('SELECT the_price FROM spare_part_sale_history WHERE id=?', sid);
      let code, title, cat;
      if (kind === 'rims') {
        const r = get(`SELECT r.internal_code, rt.title type_title, rd.title diameter_title, rw.title width_title, rp.bolt_number||'x'||rp.bolt_distance pattern_title, r.offSet FROM rims r
          LEFT JOIN rims_type rt ON rt.id=r.type_id LEFT JOIN rims_diameter rd ON rd.id=r.diameter_id LEFT JOIN rims_width rw ON rw.id=r.width_id LEFT JOIN rims_bolt_pattern rp ON rp.id=r.pattern_id WHERE r.id=?`, it.id);
        code = r.internal_code; title = rimsTitle(r);
      } else { const p = get('SELECT internal_code, title, catalog_number FROM spare_part WHERE id=?', it.id); code = p.internal_code; title = p.title; cat = p.catalog_number; }
      insert('app_doc_item', { doc_id: docId, sale_id: sid, part_id: kind === 'part' ? it.id : null, rims_id: kind === 'rims' ? it.id : null, code, title, catalog_number: cat || null, price: s.the_price });
      total += s.the_price; rows.push(code);
    }
    insert('app_doc', { id: docId, year, number, created_date: t, created_by_id: ctx.user.id, customer_id: cust?.id || null, customer_name: cust?.name || b.customer?.name || null,
      customer_phone: cust?.phone || b.customer?.phone || null, payment, total, note: b.note || null, status: 'OK' });
    // ako je ovaj kupac ranije tražio ovaj dio — zapis "Tražili" se zatvara
    if (cust?.phone_norm) {
      const tail = cust.phone_norm.slice(-6);
      for (const it of items) run(`UPDATE app_demand SET status='DONE', closed_date=?, closed_by_id=?, matched_part_id=? WHERE status IN ('OPEN','NOTIFIED') AND replace(replace(replace(phone,' ',''),'-',''),'/','') LIKE ?
        AND (matched_part_id=? OR catalog_number IS NOT NULL AND upper(replace(replace(catalog_number,' ',''),'-','')) = (SELECT upper(replace(replace(catalog_number,' ',''),'-','')) FROM spare_part WHERE id=?)
          OR type_id IS NOT NULL AND type_id=(SELECT type_id FROM spare_part WHERE id=?) AND model_id=(SELECT model_id FROM spare_part WHERE id=?))`, t, ctx.user.id, it.id, '%' + tail, it.id, it.id, it.id, it.id);
    }
    if (b.shipment) {
      const sh = b.shipment;
      insert('app_shipment', { id: uuid(), doc_id: docId, customer_id: cust?.id || null, courier: sh.courier || null, tracking: sh.tracking || null,
        cod_amount: payment === 'COD' ? Number(sh.cod_amount ?? total) : 0, shipping_cost: sh.shipping_cost ? Number(sh.shipping_cost) : null,
        status: sh.tracking ? 'SENT' : 'PREP', cod_status: payment === 'COD' ? 'PENDING' : 'NONE', created_date: t, created_by_id: ctx.user.id, sent_date: sh.tracking ? t : null, note: sh.note || null });
    }
    return { doc_id: docId, number: `${number}/${year}`, total, items: rows };
  });
});

function docDetail(id) {
  const d = get('SELECT d.*, u.full_name user_name FROM app_doc d LEFT JOIN core_user u ON u.id=d.created_by_id WHERE d.id=?', id);
  if (!d) throw notFound('Dokument ne postoji');
  d.items = all('SELECT * FROM app_doc_item WHERE doc_id=? ORDER BY id', id);
  for (const i of d.items) {
    const ret = get(`SELECT created_date FROM spare_part_sale_history WHERE ${i.part_id ? 'part_id' : 'rims_id'}=? AND status='UNSOLD' AND created_date > ? ORDER BY created_date LIMIT 1`, i.part_id || i.rims_id, d.created_date);
    i.returned = ret?.created_date || null;
  }
  d.customer = d.customer_id ? get('SELECT * FROM app_customer WHERE id=?', d.customer_id) : null;
  d.shipment = get('SELECT * FROM app_shipment WHERE doc_id=?', id);
  d.company = { name: configStr('COMPANY_NAME'), address: configStr('COMPANY_ADDRESS'), phone: configStr('COMPANY_PHONE'), warranty_days: Number(configStr('WARRANTY_DAYS', '7')) };
  d.number_label = `${d.number}/${d.year}`;
  return d;
}
app.get('/api/docs/:id', ctx => { need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE); return docDetail(ctx.params.id); });
app.get('/api/docs', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE);
  const q = ctx.query; const w = ['1=1']; const p = [];
  if (q.from) { w.push('d.created_date >= ?'); p.push(q.from); }
  if (q.to) { w.push("d.created_date < date(?, '+1 day')"); p.push(q.to); }
  if (q.payment) { w.push('d.payment=?'); p.push(q.payment); }
  if (q.q) { const l = '%' + q.q + '%'; w.push(`(d.customer_name LIKE ? OR d.customer_phone LIKE ? OR CAST(d.number AS TEXT)=? OR EXISTS (SELECT 1 FROM app_doc_item i WHERE i.doc_id=d.id AND (i.code=? OR i.title LIKE ?)))`); p.push(l, l, q.q, q.q.toUpperCase(), l); }
  const rows = all(`SELECT d.*, (SELECT count(*) FROM app_doc_item i WHERE i.doc_id=d.id) items, s.status ship_status, s.cod_status, u.full_name user_name
    FROM app_doc d LEFT JOIN app_shipment s ON s.doc_id=d.id LEFT JOIN core_user u ON u.id=d.created_by_id WHERE ${w.join(' AND ')} ORDER BY d.created_date DESC LIMIT ? OFFSET ?`, ...p, Math.min(Number(q.limit) || 100, 500), Number(q.offset) || 0);
  const sum = get(`SELECT count(*) n, coalesce(sum(total),0) s FROM app_doc d WHERE ${w.join(' AND ')} AND d.status='OK'`, ...p);
  return { rows, sum };
});

// Garancija: zadnja prodaja dijela/felne i da li je još u garanciji
app.get('/api/sales/last/:kind/:id', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE);
  const col = ctx.params.kind === 'rims' ? 'rims_id' : 'part_id';
  const s = get(`SELECT * FROM spare_part_sale_history WHERE ${col}=? AND status='SOLD' ORDER BY created_date DESC LIMIT 1`, ctx.params.id);
  if (!s) return { sale: null };
  const item = get(`SELECT * FROM app_doc_item WHERE sale_id=?`, s.id);
  const doc = item ? get('SELECT id, number, year, customer_name, customer_phone FROM app_doc WHERE id=?', item.doc_id) : null;
  const wd = Number(configStr('WARRANTY_DAYS', '7'));
  const days = Math.floor((Date.parse(today()) - Date.parse(s.created_date.slice(0, 10))) / 864e5);
  return { sale: s, doc, warranty_days: wd, days_since: days, in_warranty: days <= wd, days_left: wd - days };
});

// ---------- Pošiljke ----------
app.get('/api/shipments', ctx => {
  need(ctx.user, 'ROLE_SP_R', 'ROLE_SP', ...SALE, 'ROLE_WHS_CLERK');
  const t = ctx.query.tab || 'PREP';
  const where = { PREP: "s.status='PREP'", SENT: "s.status='SENT'", COD: "s.cod_status='PENDING' AND s.status IN ('SENT','DELIVERED')", ALL: '1=1' }[t] || '1=1';
  const rows = all(`SELECT s.*, d.number, d.year, d.total, d.customer_name, d.customer_phone, c.city, c.address,
      (SELECT group_concat(i.code || ' ' || i.title, ' | ') FROM app_doc_item i WHERE i.doc_id=d.id) items
    FROM app_shipment s LEFT JOIN app_doc d ON d.id=s.doc_id LEFT JOIN app_customer c ON c.id=s.customer_id WHERE ${where} ORDER BY s.created_date DESC LIMIT 500`);
  const stats = get(`SELECT sum(status='PREP') prep, sum(status='SENT') sent,
      coalesce(sum(CASE WHEN cod_status='PENDING' AND status IN ('SENT','DELIVERED') THEN cod_amount END),0) cod_pending, sum(cod_status='PENDING' AND status IN ('SENT','DELIVERED')) cod_n,
      coalesce(sum(CASE WHEN cod_status='PAID' AND paid_date >= date('now','start of month') THEN cod_amount END),0) cod_paid_month FROM app_shipment`);
  return { rows, stats };
});
app.post('/api/shipments/action', ctx => {
  need(ctx.user, ...SALE, 'ROLE_WHS_CLERK');
  const ids = (ctx.body.ids || []).filter(Boolean); const a = ctx.body.action; const t = now();
  if (!ids.length) throw bad('Ništa nije izabrano');
  tx(() => {
    for (const id of ids) {
      if (a === 'sent') run("UPDATE app_shipment SET status='SENT', sent_date=?, tracking=coalesce(?, tracking), courier=coalesce(?, courier) WHERE id=?", t, ctx.body.tracking || null, ctx.body.courier || null, id);
      else if (a === 'delivered') run("UPDATE app_shipment SET status='DELIVERED', delivered_date=? WHERE id=?", t, id);
      else if (a === 'returned') run("UPDATE app_shipment SET status='RETURNED', cod_status=CASE WHEN cod_status='PENDING' THEN 'NONE' ELSE cod_status END WHERE id=?", id);
      else if (a === 'paid') run("UPDATE app_shipment SET cod_status='PAID', paid_date=?, status=CASE WHEN status='SENT' THEN 'DELIVERED' ELSE status END, delivered_date=coalesce(delivered_date, ?) WHERE id=?", t, t, id);
      else if (a === 'update') run('UPDATE app_shipment SET tracking=?, courier=?, cod_amount=?, note=? WHERE id=?', ctx.body.tracking || null, ctx.body.courier || null, Number(ctx.body.cod_amount) || 0, ctx.body.note || null, id);
      else throw bad('Nepoznata radnja');
    }
  });
  return { ok: true, n: ids.length };
});
