// Prodaja sa kupcem, otpremnica, kupci, pošiljke
import { h, clear, route, GET, POST, PUT, qs, go, can, fmtMoney, fmtDT, fmtDate, field, input, textarea, select, check, modal, toast, run, badge, tabs, loading, empty, setQuery, refresh } from '../lib.js';

export const PAY = { CASH: 'Gotovina', CARD: 'Kartica', COD: 'Pouzeće', BANK: 'Virman/račun' };
const COURIERS = ['Euro Express', 'X Express', 'BH Pošta', 'Pošte Srpske', 'A2B', 'Lično preuzimanje', 'Ostalo'];
const SHIP = { PREP: ['Za slanje', 'orange'], SENT: ['Poslano', 'blue'], DELIVERED: ['Isporučeno', 'green'], RETURNED: ['Vraćeno', 'red'] };
const COD = { PENDING: ['Pouzeće čeka', 'orange'], PAID: ['Pouzeće naplaćeno', 'green'], NONE: null };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Unos kupca sa prijedlozima postojećih (po imenu ili telefonu)
function customerFields() {
  let chosen = null;
  const name = input('cname', '', { placeholder: 'Ime i prezime / firma', autocomplete: 'off' });
  const phone = input('cphone', '', { type: 'tel', inputmode: 'tel', placeholder: '06x xxx xxx', autocomplete: 'off' });
  const city = input('ccity', '', { placeholder: 'Mjesto' });
  const address = input('caddr', '', { placeholder: 'Adresa (za slanje)' });
  const box = h('div.combo-list');
  const info = h('div.muted');
  let t;
  const suggest = src => {
    chosen = null; info.textContent = '';
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = src.value.trim(); if (q.length < 3) { box.style.display = 'none'; return; }
      const rows = await GET('/api/customers?q=' + encodeURIComponent(q));
      clear(box, rows.map(c => h('div.combo-item', { onmousedown: e => { e.preventDefault(); pick(c); } }, (c.name || '—') + (c.phone ? ' · ' + c.phone : ''), h('small', [c.city, c.docs ? `${c.docs} kupovina, ${fmtMoney(c.spent)}` : ''].filter(Boolean).join(' · ')))));
      box.style.display = rows.length ? 'block' : 'none';
    }, 250);
  };
  const pick = c => { chosen = c; name.value = c.name || ''; phone.value = c.phone || ''; city.value = c.city || ''; address.value = c.address || ''; box.style.display = 'none'; info.textContent = `✔ Postojeći kupac${c.docs ? ` — ${c.docs} kupovina, ukupno ${fmtMoney(c.spent)}` : ''}`; };
  name.addEventListener('input', () => suggest(name)); phone.addEventListener('input', () => suggest(phone));
  for (const x of [name, phone]) x.addEventListener('blur', () => setTimeout(() => (box.style.display = 'none'), 150));
  const el = h('div', h('div.grid', h('div.field', h('span', 'Kupac'), h('div.combo', name, box)), field('Telefon', phone), field('Mjesto', city), field('Adresa', address)), info);
  el.value = () => (chosen ? { id: chosen.id } : (name.value || phone.value ? { name: name.value.trim(), phone: phone.value.trim(), city: city.value.trim(), address: address.value.trim() } : null));
  return el;
}

// items: [{kind:'part'|'rims', id, code, title, price}]
export async function saleDialog(items, opts = {}) {
  items = items.map(i => ({ ...i }));
  const list = h('div');
  const totalEl = h('b', { style: { fontSize: '18px', color: 'var(--navy)' } });
  const recalc = () => { const t = items.reduce((s, i) => s + (Number(i.price) || 0), 0); totalEl.textContent = fmtMoney(t); if (!codTouched) cod.value = t || ''; return t; };
  const drawItems = () => clear(list, h('table.tbl', h('tbody', items.map((it, k) => h('tr',
    h('td', h('span.code', it.code), h('div.muted', it.title)),
    h('td.n', { style: { width: '120px' } }, (() => { const p = input('p', it.price ?? '', { type: 'number', step: '0.01', inputmode: 'decimal', style: { textAlign: 'right', fontWeight: '700' } }); p.oninput = () => { it.price = p.value; recalc(); }; return p; })()),
    h('td', { style: { width: '30px' } }, items.length > 1 ? h('button.sm', { onclick: () => { items.splice(k, 1); drawItems(); recalc(); } }, '✕') : ''))))));
  const cust = customerFields();
  const pay = select('payment', 'CASH', PAY, { empty: false });
  const shipChk = check('ship', false, '📦 Šalje se brzom poštom');
  const courier = select('courier', 'Euro Express', COURIERS.map(c => ({ value: c, label: c })), { empty: false });
  const tracking = input('tracking', '', { placeholder: 'broj pošiljke (može i kasnije)' });
  let codTouched = false;
  const cod = input('cod', '', { type: 'number', step: '0.01' }); cod.oninput = () => { codTouched = true; };
  const shipCost = input('scost', '', { type: 'number', step: '0.01', placeholder: 'opciono' });
  const shipBox = h('div.grid', { style: { display: 'none' } }, field('Kurirska služba', courier), field('Broj pošiljke', tracking), field('Iznos pouzeća (KM)', cod), field('Poštarina (KM)', shipCost));
  shipChk.querySelector('input').onchange = e => { shipBox.style.display = e.target.checked ? 'grid' : 'none'; if (e.target.checked && pay.value === 'CASH') pay.value = 'COD'; };
  const note = textarea('note', '', { rows: 2, placeholder: 'Napomena (opciono)' });
  drawItems(); recalc();
  const res = await modal(`💰 Prodaja (${items.length} ${items.length === 1 ? 'stavka' : 'stavki'})`, [
    list, h('div.row', h('span.grow', 'Ukupno:'), totalEl),
    h('div.sect', 'Kupac (opciono, potrebno za slanje i garanciju)'), cust,
    h('div.sect', 'Plaćanje i slanje'), field('Način plaćanja', pay), shipChk, shipBox, note,
  ], [{ label: 'Odustani' }, { label: '💰 Prodaj', primary: true, onClick: async () => {
    const ship = shipChk.querySelector('input').checked;
    const c = cust.value();
    if (ship && !c) throw new Error('Za slanje upišite kupca (ime i telefon)');
    const r = await POST('/api/sales', { items: items.map(i => ({ kind: i.kind, id: i.id, price: i.price })), customer: c, payment: pay.value, note: note.value || null,
      shipment: ship ? { courier: courier.value, tracking: tracking.value || null, cod_amount: pay.value === 'COD' ? Number(cod.value) || recalc() : 0, shipping_cost: shipCost.value || null } : null });
    return r;
  } }]);
  if (!res) return null;
  toast(`Prodato — otpremnica ${res.number}, ${fmtMoney(res.total)}`);
  if (await modal('Prodato ✔', [h('p', `Otpremnica br. ${res.number} · ${fmtMoney(res.total)}`)], [{ label: 'Zatvori' }, { label: '🖨 Štampaj otpremnicu', primary: true, value: true }])) printDoc(res.doc_id);
  return res;
}

export async function printDoc(id) {
  const w = window.open('', '_blank');
  const d = await GET('/api/docs/' + id);
  const c = d.company;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Otpremnica ${esc(d.number_label)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:18mm 14mm} h1{font-size:20px;margin:0} .top{display:flex;justify-content:space-between;border-bottom:3px solid #0b2a4a;padding-bottom:8px;margin-bottom:12px}
    .firm b{font-size:16px;color:#0b2a4a} table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left} th{background:#e9eef4;font-size:11px;text-transform:uppercase}
    td.n,th.n{text-align:right} .tot{font-size:16px;font-weight:bold;text-align:right;margin-top:8px} .box{border:1px solid #ccc;padding:8px;border-radius:4px;min-width:220px}
    .sig{display:flex;justify-content:space-between;margin-top:50px} .sig div{border-top:1px solid #333;width:40%;text-align:center;padding-top:4px} .war{margin-top:14px;padding:8px;background:#fff3e0;border-left:4px solid #f08c00}
    @media print{body{margin:10mm}}</style></head><body>
    <div class="top"><div class="firm"><b>${esc(c.name)}</b><br>${esc(c.address)}<br>Tel/Viber: ${esc(c.phone)}</div>
      <div style="text-align:right"><h1>OTPREMNICA</h1>br. <b>${esc(d.number_label)}</b><br>${fmtDT(d.created_date)}</div></div>
    <div style="display:flex;gap:12px;justify-content:space-between"><div class="box"><b>Kupac</b><br>${esc(d.customer?.name || d.customer_name || '—')}<br>${esc(d.customer?.phone || d.customer_phone || '')}<br>${esc([d.customer?.address, d.customer?.city].filter(Boolean).join(', '))}</div>
      <div class="box"><b>Plaćanje:</b> ${esc(PAY[d.payment] || d.payment)}${d.shipment ? `<br><b>Slanje:</b> ${esc(d.shipment.courier || '')} ${esc(d.shipment.tracking || '')}${d.shipment.cod_amount ? `<br><b>Pouzeće:</b> ${fmtMoney(d.shipment.cod_amount)}` : ''}` : ''}<br><b>Izdao:</b> ${esc(d.user_name || '')}</div></div>
    <table><thead><tr><th>#</th><th>Šifra</th><th>Naziv</th><th>Kat. broj</th><th class="n">Cijena</th></tr></thead><tbody>
    ${d.items.map((i, k) => `<tr><td>${k + 1}</td><td><b>${esc(i.code)}</b></td><td>${esc(i.title)}</td><td>${esc(i.catalog_number || '')}</td><td class="n">${fmtMoney(i.price)}</td></tr>`).join('')}
    </tbody></table><div class="tot">UKUPNO: ${fmtMoney(d.total)}</div>
    ${d.note ? `<p>Napomena: ${esc(d.note)}</p>` : ''}
    <div class="war">Garancija na ispravnost dijelova: <b>${c.warranty_days} dana</b> od dana kupovine (do ${fmtDate(new Date(Date.parse(d.created_date.slice(0, 10)) + c.warranty_days * 864e5).toISOString())}). Za reklamaciju ponesite ovu otpremnicu. Garancija ne važi za nestručnu ugradnju.</div>
    <div class="sig"><div>Izdao</div><div>Primio</div></div>
    <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// Info o garanciji za povrat
export async function warrantyInfo(kind, id) {
  const s = await GET(`/api/sales/last/${kind}/${id}`).catch(() => null);
  if (!s?.sale) return null;
  const who = s.doc ? `Otpremnica ${s.doc.number}/${s.doc.year}${s.doc.customer_name ? ' · ' + s.doc.customer_name : ''}${s.doc.customer_phone ? ' · ' + s.doc.customer_phone : ''}` : '';
  return h('div', { style: { padding: '8px 10px', borderRadius: '4px', background: s.in_warranty ? 'var(--okl)' : 'var(--redl)', borderLeft: `4px solid ${s.in_warranty ? 'var(--ok)' : 'var(--red)'}` } },
    h('b', s.in_warranty ? `✔ U garanciji (još ${s.days_left} ${s.days_left === 1 ? 'dan' : 'dana'})` : `✖ Garancija istekla (prije ${s.days_since - s.warranty_days} dana)`),
    h('div.muted', `Prodato ${fmtDate(s.sale.created_date)} za ${fmtMoney(s.sale.the_price)}. ${who}`));
}

// ---------- Ekran: Prodaja (dokumenti) ----------
route('/prodaja', async (params, query, main) => {
  const q = { from: query.from || '', to: query.to || '', q: query.q || '', payment: query.payment || '' };
  const res = h('div');
  const load = async () => {
    setQuery(q); clear(res, loading());
    const d = await GET('/api/docs?' + qs(q));
    clear(res, h('div.stats', h('div.stat', h('b', d.sum.n), h('span', 'Otpremnica')), h('div.stat', h('b', fmtMoney(d.sum.s)), h('span', 'Ukupno'))),
      h('div.card.p0', h('div.scroll-x', h('table.tbl', h('thead', h('tr', h('th', 'Br.'), h('th', 'Datum'), h('th', 'Kupac'), h('th.n', 'Stavki'), h('th.n', 'Iznos'), h('th', 'Plaćanje'), h('th', 'Slanje'), h('th', 'Izdao'))),
        h('tbody', d.rows.length ? d.rows.map(r => h('tr.click', { onclick: () => go('/prodaja/' + r.id) }, h('td', h('b', `${r.number}/${r.year}`)), h('td', fmtDT(r.created_date)),
          h('td', r.customer_name || h('span.muted', '—'), r.customer_phone ? h('div.muted', r.customer_phone) : null), h('td.n', r.items), h('td.n', h('b', fmtMoney(r.total))), h('td', PAY[r.payment] || r.payment),
          h('td', r.ship_status ? badge(...SHIP[r.ship_status]) : '', r.cod_status && COD[r.cod_status] ? h('div', badge(...COD[r.cod_status])) : null), h('td.muted', r.user_name || ''))) : h('tr', h('td', { colspan: 8 }, empty('Nema prodaja'))))))));
  };
  const s = input('q', q.q, { type: 'search', placeholder: 'Kupac, telefon, broj otpremnice, šifra dijela' });
  let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { q.q = s.value.trim(); load(); }, 400); };
  const f = input('from', q.from, { type: 'date' }), tt = input('to', q.to, { type: 'date' });
  f.onchange = () => { q.from = f.value; load(); }; tt.onchange = () => { q.to = tt.value; load(); };
  const p = select('payment', q.payment, PAY, { placeholder: 'Svi načini plaćanja' }); p.onchange = () => { q.payment = p.value; load(); };
  clear(main, h('div', h('div.head', h('h1', '🧾 Prodaja — otpremnice'), h('button', { onclick: () => go('/kupci') }, '👤 Kupci'), h('button', { onclick: () => go('/posiljke') }, '📦 Pošiljke')),
    h('div.card', h('div.filters', { style: { marginTop: 0 } }, s, field('Od', f), field('Do', tt), p), h('p.muted', { style: { marginBottom: 0 } }, 'Prodaja sa kupcem i otpremnicom ide preko dugmeta „Prodaj” na dijelu ili „Prodaj izabrane” u katalogu.')), res));
  load();
});

route('/prodaja/:id', async ({ id }) => {
  const d = await GET('/api/docs/' + id);
  return h('div',
    h('div.art-head', h('button.icon', { onclick: () => history.back() }, '←'), h('div.ttl', h('h1', 'Otpremnica ' + d.number_label), h('div.muted', fmtDT(d.created_date) + ' · ' + (d.user_name || ''))),
      h('div.price', fmtMoney(d.total))),
    h('div.toolbar', h('button.tile-btn.primary', { onclick: () => printDoc(id) }, h('span.ic', '🖨'), h('span.lb', 'Štampaj'))),
    h('div.grid2',
      h('div.card', h('h2', 'Kupac'), d.customer ? h('div', h('b', h('a', { href: '#/kupci/' + d.customer.id }, d.customer.name || '—')), h('div', d.customer.phone || ''), h('div.muted', [d.customer.address, d.customer.city].filter(Boolean).join(', '))) : h('p.muted', d.customer_name || 'Bez kupca'),
        h('p', 'Plaćanje: ', h('b', PAY[d.payment] || d.payment))),
      d.shipment ? h('div.card', h('h2', 'Slanje'), h('div', badge(...SHIP[d.shipment.status]), ' ', d.shipment.cod_status && COD[d.shipment.cod_status] ? badge(...COD[d.shipment.cod_status]) : ''),
        h('p', `${d.shipment.courier || ''} ${d.shipment.tracking || 'bez broja pošiljke'}`), d.shipment.cod_amount ? h('p', 'Pouzeće: ', h('b', fmtMoney(d.shipment.cod_amount))) : null, h('a', { href: '#/posiljke' }, 'Sve pošiljke →')) : h('div')),
    h('div.card.p0', h('table.tbl', h('thead', h('tr', h('th', 'Šifra'), h('th', 'Naziv'), h('th', 'Kat. broj'), h('th.n', 'Cijena'), h('th', ''))),
      h('tbody', d.items.map(i => h('tr.click', { onclick: () => go(i.part_id ? '/dijelovi/' + i.part_id : '/felne/' + i.rims_id) }, h('td', h('span.code', i.code)), h('td', i.title), h('td', i.catalog_number || ''), h('td.n', fmtMoney(i.price)),
        h('td', i.returned ? badge('vraćeno ' + fmtDate(i.returned), 'red') : '')))))));
});

// ---------- Kupci ----------
route('/kupci', async (params, query, main) => {
  const res = h('div');
  const load = async qq => {
    const rows = await GET('/api/customers?' + qs({ q: qq }));
    clear(res, h('div.card.p0', h('div.scroll-x', h('table.tbl', h('thead', h('tr', h('th', 'Kupac'), h('th', 'Telefon'), h('th', 'Mjesto'), h('th.n', 'Kupovina'), h('th.n', 'Ukupno'), h('th', 'Zadnja'))),
      h('tbody', rows.length ? rows.map(c => h('tr.click', { onclick: () => go('/kupci/' + c.id) }, h('td', h('b', c.name || '—')), h('td', c.phone || ''), h('td', c.city || ''), h('td.n', c.docs), h('td.n', fmtMoney(c.spent)), h('td.muted', fmtDate(c.last)))) : h('tr', h('td', { colspan: 6 }, empty('Još nema kupaca — kupci se dodaju pri prodaji'))))))));
  };
  const s = input('q', '', { type: 'search', placeholder: 'Ime, telefon ili mjesto' });
  let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => load(s.value.trim()), 300); };
  clear(main, h('div', h('div.head', h('h1', '👤 Kupci')), h('div.card', s), res));
  load('');
});
route('/kupci/:id', async ({ id }) => {
  const c = await GET('/api/customers/' + id);
  const spent = c.docs.filter(d => d.status === 'OK').reduce((s, d) => s + d.total, 0);
  return h('div',
    h('div.art-head', h('button.icon', { onclick: () => history.back() }, '←'), h('div.ttl', h('h1', c.name || '—'), h('div.muted', [c.phone, c.city, c.address].filter(Boolean).join(' · '))),
      c.phone ? h('a.chip', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, '📞 Pozovi') : null,
      h('button', { onclick: async () => {
        const n = input('name', c.name), p = input('phone', c.phone), ci = input('city', c.city), a = input('address', c.address), no = textarea('note', c.note);
        if (await modal('Izmjena kupca', [field('Ime', n), field('Telefon', p), field('Mjesto', ci), field('Adresa', a), field('Napomena', no)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => PUT('/api/customers/' + id, { name: n.value, phone: p.value, city: ci.value, address: a.value, note: no.value }) }])) refresh();
      } }, '✏️')),
    h('div.stats', h('div.stat', h('b', c.docs.length), h('span', 'Kupovina')), h('div.stat', h('b', fmtMoney(spent)), h('span', 'Ukupno potrošio'))),
    c.note ? h('div.card', '💬 ' + c.note) : null,
    h('div.card.p0', h('table.tbl', h('thead', h('tr', h('th', 'Otpremnica'), h('th', 'Datum'), h('th.n', 'Stavki'), h('th.n', 'Iznos'), h('th', 'Plaćanje'))),
      h('tbody', c.docs.map(d => h('tr.click', { onclick: () => go('/prodaja/' + d.id) }, h('td', h('b', `${d.number}/${d.year}`)), h('td', fmtDT(d.created_date)), h('td.n', d.items), h('td.n', fmtMoney(d.total)), h('td', PAY[d.payment] || d.payment)))))),
    c.demands.length ? h('div.card', h('h2', 'Tražio, a nismo imali'), c.demands.map(x => h('div', (x.catalog_number || x.text || '') + ' · ' + fmtDate(x.created_date) + ' · ' + x.status))) : null);
});

// ---------- Pošiljke ----------
route('/posiljke', async (params, query, main) => {
  let tab = query.tab || 'PREP';
  const sel = new Set();
  const res = h('div'), tb = h('div');
  const act = async (action, extra = {}) => {
    if (!sel.size) return toast('Izaberite pošiljke (štiklirajte)', 'err');
    await run(() => POST('/api/shipments/action', { ids: [...sel], action, ...extra }), 'Sačuvano'); load();
  };
  const load = async () => {
    setQuery({ tab }); sel.clear();
    clear(tb, tabs([['PREP', '📦 Za slanje'], ['SENT', '🚚 Poslano'], ['COD', '💵 Pouzeće za naplatu'], ['ALL', 'Sve']], tab, k => { tab = k; load(); }));
    clear(res, loading());
    const d = await GET('/api/shipments?tab=' + tab);
    const s = d.stats;
    clear(res,
      h('div.stats', h('div.stat', h('b', s.prep || 0), h('span', 'Za slanje')), h('div.stat', h('b', s.sent || 0), h('span', 'Na putu')),
        h('div.stat', { style: { borderLeftColor: 'var(--red)' } }, h('b', fmtMoney(s.cod_pending)), h('span', `Pouzeće koje duguje kurir (${s.cod_n || 0})`)), h('div.stat', h('b', fmtMoney(s.cod_paid_month)), h('span', 'Naplaćeno pouzeće ovaj mjesec'))),
      h('div.card', h('div.actions',
        tab === 'PREP' ? h('button.primary', { onclick: async () => {
          const tr = input('t', ''); const co = select('c', 'Euro Express', COURIERS.map(c => ({ value: c, label: c })), { empty: false });
          if (sel.size && await modal('Poslano', [field('Kurir', co), field('Broj pošiljke (ako je jedna)', tr)], [{ label: 'Odustani' }, { label: 'Poslano', primary: true, value: true }])) act('sent', { tracking: sel.size === 1 ? tr.value : null, courier: co.value });
          else if (!sel.size) toast('Izaberite pošiljke', 'err');
        } }, '🚚 Označi kao poslano') : null,
        ['SENT', 'COD', 'ALL'].includes(tab) ? h('button', { onclick: () => act('delivered') }, '✔ Isporučeno') : null,
        ['SENT', 'COD', 'ALL'].includes(tab) ? h('button.primary', { onclick: () => act('paid') }, '💵 Novac od pouzeća stigao') : null,
        tab !== 'PREP' ? h('button.danger', { onclick: () => act('returned') }, '↩ Vraćeno') : null)),
      h('div.card.p0', h('div.scroll-x', h('table.tbl', h('thead', h('tr', h('th', ''), h('th', 'Otpremnica'), h('th', 'Kupac'), h('th', 'Dijelovi'), h('th', 'Kurir / broj'), h('th.n', 'Pouzeće'), h('th', 'Status'))),
        h('tbody', d.rows.length ? d.rows.map(r => h('tr',
          h('td', h('input', { type: 'checkbox', onchange: e => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); } })),
          h('td', h('a', { href: '#/prodaja/' + r.doc_id }, h('b', `${r.number}/${r.year}`)), h('div.muted', fmtDate(r.created_date))),
          h('td', h('b', r.customer_name || '—'), h('div', r.customer_phone || ''), h('div.muted', [r.address, r.city].filter(Boolean).join(', '))),
          h('td', { style: { maxWidth: '280px', fontSize: '12px' } }, r.items || ''),
          h('td', r.courier || '', h('div.muted', r.tracking || '—'), h('button.sm', { onclick: async () => {
            const tr = input('t', r.tracking), co = select('c', r.courier || 'Euro Express', COURIERS.map(c => ({ value: c, label: c })), { empty: false }), cd = input('cod', r.cod_amount, { type: 'number' }), no = input('n', r.note);
            if (await modal('Pošiljka ' + r.number + '/' + r.year, [field('Kurir', co), field('Broj pošiljke', tr), field('Pouzeće (KM)', cd), field('Napomena', no)], [{ label: 'Odustani' }, { label: 'Sačuvaj', primary: true, onClick: () => POST('/api/shipments/action', { ids: [r.id], action: 'update', tracking: tr.value, courier: co.value, cod_amount: cd.value, note: no.value }) }])) load();
          } }, '✏️')),
          h('td.n', r.cod_amount ? h('b', fmtMoney(r.cod_amount)) : '—'),
          h('td', badge(...SHIP[r.status]), r.cod_status && COD[r.cod_status] ? h('div', badge(...COD[r.cod_status])) : null))) : h('tr', h('td', { colspan: 7 }, empty('Nema pošiljki'))))))));
  };
  clear(main, h('div', h('div.head', h('h1', '📦 Pošiljke i pouzeće')), tb, res));
  load();
});
