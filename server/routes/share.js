// Javna stranica dijela za slanje kupcu: /p/<šifra>  (bez prijave; samo dijelovi na stanju)
import { app } from '../router.js';
import { get, all } from '../db.js';
import { configStr } from '../util.js';
import { E } from '../labels.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => Number(v).toLocaleString('bs-BA', { maximumFractionDigits: 2 }) + ' KM';

app.get('/p/:code', ctx => {
  const code = ctx.params.code.toUpperCase();
  const p = get(`SELECT p.*, t.title type_title FROM spare_part p LEFT JOIN spare_part_type t ON t.id=p.type_id WHERE p.internal_code=? AND p.active=1`, code);
  const firm = configStr('COMPANY_NAME', 'Auto otpad Delić'), phone = configStr('COMPANY_PHONE', '066 027 888'), addr = configStr('COMPANY_ADDRESS', '');
  const intl = '387' + phone.replace(/\D/g, '').replace(/^0/, '');
  const imgs = p ? all('SELECT id FROM lib_attachment WHERE object_id=? AND active=1 ORDER BY main_picture DESC, created_date', p.id) : [];
  const sold = !p || p.status !== 'UNSOLD';
  const rows = p ? [['Šifra', p.internal_code], ['Kataloški broj', p.catalog_number], ['Strana', E.side[p.side]], ['Godište', p.model_year], ['Gorivo', E.fuel[p.fuel_type]],
    ['Motor', [p.cylinder_capacity ? p.cylinder_capacity + ' ccm' : '', p.power ? p.power + ' kW' : '', p.engine_code].filter(Boolean).join(' · ')], ['Mjenjač', E.gearbox[p.gearbox_type]], ['Napomena', p.note]].filter(r => r[1]) : [];
  const msg = encodeURIComponent(`Zanima me dio ${p?.title || ''} (šifra ${code})`);
  ctx.res.writeHead(sold ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  ctx.res.end(`<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(p ? p.title : 'Dio')} — ${esc(firm)}</title>
${p && imgs[0] ? `<meta property="og:image" content="/img/${imgs[0].id}"><meta property="og:title" content="${esc(p.title)}">` : ''}
<style>body{margin:0;font-family:system-ui,Arial,sans-serif;background:#eef1f5;color:#1b2430}header{background:#0b2a4a;color:#fff;padding:12px 16px;border-bottom:3px solid #f08c00;font-weight:800;letter-spacing:1px}
main{max-width:720px;margin:0 auto;padding:12px}.card{background:#fff;border-radius:6px;padding:14px;margin-bottom:10px;border:1px solid #d6dde6}h1{font-size:19px;margin:0 0 6px;color:#0b2a4a}
.price{font-size:26px;font-weight:800;color:#0b2a4a}.imgs img{width:100%;border-radius:6px;margin-bottom:8px;background:#f3f5f8}table{width:100%;border-collapse:collapse}td{padding:6px;border-bottom:1px solid #eef1f5}td:first-child{color:#66727f;width:40%}
.btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.btns a{display:block;text-align:center;padding:12px 6px;border-radius:6px;color:#fff;text-decoration:none;font-weight:700}
.code{background:#0b2a4a;color:#fff;padding:2px 8px;border-radius:3px;font-family:monospace;font-weight:700}</style></head><body>
<header>${esc(firm.toUpperCase())}</header><main>
${sold ? `<div class="card"><h1>Ovaj dio više nije dostupan</h1><p>Javite nam se — možda imamo isti ili sličan dio.</p></div>` : `
<div class="card"><h1>${esc(p.title)}</h1><span class="code">${esc(p.internal_code)}</span>
<div class="price" style="margin-top:8px">${p.price ? money(p.price) : 'Cijena na upit'}</div></div>
<div class="imgs">${imgs.map(i => `<img src="/img/${i.id}" loading="lazy" alt="">`).join('') || ''}</div>
<div class="card"><table>${rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join('')}</table></div>`}
<div class="card"><div class="btns"><a style="background:#1e7f3c" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">📞 Pozovi</a>
<a style="background:#7360f2" href="viber://chat?number=%2B${intl}">Viber</a><a style="background:#25d366" href="https://wa.me/${intl}?text=${msg}">WhatsApp</a></div>
<p style="text-align:center;color:#66727f">${esc(phone)} · ${esc(addr)}<br>Garancija na ispravnost ${esc(configStr('WARRANTY_DAYS', '7'))} dana · šaljemo brzom poštom</p></div>
</main></body></html>`);
}, { public: true });
