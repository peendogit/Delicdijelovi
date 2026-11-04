// Zajedničke funkcije: DOM, API, ruter, komponente
export const $ = (s, el = document) => el.querySelector(s);

export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };

// ---------- Format ----------
export const fmtDate = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
export const fmtDT = d => (d ? fmtDate(d) + ' ' + d.slice(11, 16) : '');
export const fmtMoney = (v, c = 'KM') => (v == null || v === '' ? '' : Number(v).toLocaleString('bs-BA', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + (c === 'BAM' ? 'KM' : c || 'KM'));
export const fmtNum = v => (v == null ? '' : Number(v).toLocaleString('bs-BA'));
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// ---------- Šifarnici (enumi) ----------
export const E = {
  status: { UNSOLD: 'Na stanju', SOLD: 'Prodat' },
  fuel: { DIESEL: 'Dizel', PETROL: 'Benzin', HYBRID: 'Hibrid', LPG: 'Plin', ELECTRIC: 'Električni' },
  gearbox: { MANUAL: 'Manuelni', AUTOMATIC: 'Automatik' },
  drive: { FWD: 'Prednji', RWD: 'Zadnji', AWD: '4x4' },
  side: { LEFT: 'Lijevo', RIGHT: 'Desno', FRONT: 'Naprijed', BACK: 'Nazad', FRONT_LEFT: 'Naprijed lijevo', FRONT_RIGHT: 'Naprijed desno', BACK_LEFT: 'Nazad lijevo', BACK_RIGHT: 'Nazad desno', CENTRAL: 'Sredina' },
  body: { LIMOUSINE: 'Limuzina', CARAVAN: 'Karavan', SUV: 'SUV / Džip', COUPE: 'Kupe', CABRIO: 'Kabriolet', VAN: 'Kombi' },
  vstatus: { PARTS: 'Za dijelove', COMPLETE: 'Prodaje se cijelo', SOLD: 'Prodato' },
  req: { NEW: 'Novi', PREPARED: 'U realizaciji', DONE: 'Završen', CLOSED: 'Zatvoren' },
};

// ---------- API ----------
export const state = { user: null, lookups: null, models: {} };
export async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let j = null;
  try { j = await r.json(); } catch {}
  if (r.status === 401 && !url.includes('/auth/')) { state.user = null; location.hash = '#/prijava'; throw new Error('Niste prijavljeni'); }
  if (!r.ok) throw new Error(j?.error || 'Greška ' + r.status);
  return j;
}
export const GET = url => api('GET', url);
export const POST = (url, b = {}) => api('POST', url, b);
export const PUT = (url, b = {}) => api('PUT', url, b);
export const DEL = url => api('DELETE', url);
export const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false)).toString();

export async function lookups(force) {
  if (!state.lookups || force) state.lookups = await GET('/api/lookups');
  return state.lookups;
}
export async function models(makeId) {
  if (!makeId) return [];
  if (!state.models[makeId]) state.models[makeId] = await GET('/api/models?make_id=' + makeId);
  return state.models[makeId];
}
export const can = (...a) => !!state.user && (state.user.superadmin || a.some(x => state.user.auth.includes(x)));

// ---------- Toast / dijalozi ----------
export function toast(msg, type = 'ok') {
  const t = h('div.toast.' + type, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 5000 : 2500);
}
export async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, 'err'); throw e; }
}
export function modal(title, body, actions = []) {
  return new Promise(resolve => {
    const close = v => { bg.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = e => { if (e.key === 'Escape') close(null); };
    const bg = h('div.modal-bg', { onclick: e => { if (e.target === bg) close(null); } },
      h('div.modal',
        h('div.modal-head', h('h3', title), h('button.icon', { onclick: () => close(null), title: 'Zatvori' }, '✕')),
        h('div.modal-body', body),
        actions.length ? h('div.modal-foot', actions.map(a => h('button' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
          onclick: async () => { if (a.onClick) { try { const v = await a.onClick(); if (v !== false) close(v ?? true); } catch (e) { toast(e.message, 'err'); } } else close(a.value ?? null); },
        }, a.label))) : null));
    document.body.append(bg);
    document.addEventListener('keydown', esc);
    setTimeout(() => bg.querySelector('input:not([type=checkbox]),select,textarea')?.focus(), 50);
  });
}
export const confirmBox = (msg, label = 'Da', danger = true) => modal('Potvrda', h('p', msg), [{ label: 'Odustani' }, { label, primary: !danger, danger, value: true }]);

// ---------- Forme ----------
// field('Naziv', input) — omotač sa labelom
export const field = (label, input, opts = {}) => h('label.field' + (opts.wide ? '.wide' : '') + (opts.full ? '.full' : ''), h('span', label, opts.req ? h('b.req', ' *') : null), input);
export function input(name, value, attrs = {}) { return h('input', { name, value: value ?? '', autocomplete: 'off', ...attrs }); }
export function textarea(name, value, attrs = {}) { const t = h('textarea', { name, rows: 3, ...attrs }); t.value = value ?? ''; return t; }
export function select(name, value, options, attrs = {}) {
  // options: [{value,label}] ili {value:label}
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([v, l]) => ({ value: v, label: l }));
  const s = h('select', { name, ...attrs }, attrs.empty === false ? null : h('option', { value: '' }, attrs.placeholder || '—'), opts.map(o => h('option', { value: o.value }, o.label)));
  s.value = value ?? '';
  return s;
}
export function check(name, value, label) {
  return h('label.check', h('input', { type: 'checkbox', name, checked: !!value }), h('span', label));
}
export function formData(form) {
  const o = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.dataset.skip) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value === '' ? null : el.value;
  }
  return o;
}

// Pretraživi izbor (combo): items [{value,label,sub}], vraća element sa .value
export function combo(name, value, items, attrs = {}) {
  const hidden = h('input', { type: 'hidden', name, value: value ?? '' });
  const box = h('div.combo-list');
  const label = v => items.find(i => i.value === v)?.label || '';
  const inp = h('input', { type: 'text', placeholder: attrs.placeholder || 'Traži…', value: label(value), autocomplete: 'off', 'data-skip': '1' });
  let idx = -1, shown = [];
  const render = () => {
    const q = inp.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    shown = (hidden.value && label(hidden.value).toLowerCase() === q ? items : items.filter(i => words.every(w => (i.label + ' ' + (i.sub || '')).toLowerCase().includes(w)))).slice(0, 80);
    idx = -1;
    clear(box, shown.map((i, k) => h('div.combo-item', { onmousedown: e => { e.preventDefault(); pickItem(i); } }, i.label, i.sub ? h('small', i.sub) : null)));
    box.style.display = shown.length ? 'block' : 'none';
  };
  const pickItem = i => {
    hidden.value = i ? i.value : ''; inp.value = i ? i.label : ''; box.style.display = 'none';
    wrap.dispatchEvent(new CustomEvent('change', { detail: i, bubbles: true }));
  };
  inp.addEventListener('focus', () => { inp.select(); render(); });
  inp.addEventListener('input', () => { if (!inp.value) hidden.value = ''; render(); });
  inp.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; if (!inp.value) pickItem(null); else inp.value = label(hidden.value); }, 150));
  inp.addEventListener('keydown', e => {
    const els = box.children;
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, els.length - 1); } else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[idx] || shown.length === 1) pickItem(shown[Math.max(idx, 0)]); return; } else return;
    [...els].forEach((x, k) => x.classList.toggle('act', k === idx)); els[idx]?.scrollIntoView({ block: 'nearest' });
  });
  const wrap = h('div.combo', hidden, inp, box);
  Object.defineProperty(wrap, 'value', { get: () => hidden.value, set: v => { hidden.value = v ?? ''; inp.value = label(v); } });
  wrap.setItems = (list, keep) => { items = list; if (!keep || !items.find(i => i.value === hidden.value)) { hidden.value = ''; inp.value = ''; } else inp.value = label(hidden.value); };
  wrap.input = inp;
  if (attrs.disabled) inp.disabled = true;
  return wrap;
}

// Unos lokacije po kodu (P123) sa prijedlozima
export function locationInput(name = 'location_code', attrs = {}) {
  const inp = h('input', { name, placeholder: attrs.placeholder || 'npr. P123', autocomplete: 'off', style: { textTransform: 'uppercase' } });
  const box = h('div.combo-list');
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = inp.value.trim();
      if (!q) { box.style.display = 'none'; return; }
      const rows = (await GET('/api/assets/find?code=' + encodeURIComponent(q))).filter(r => r.parts_allowed);
      clear(box, rows.map(r => h('div.combo-item', { onmousedown: e => { e.preventDefault(); inp.value = r.code_extended; box.style.display = 'none'; inp.dispatchEvent(new Event('change', { bubbles: true })); } }, r.code_extended, h('small', r.label))));
      box.style.display = rows.length ? 'block' : 'none';
    }, 200);
  });
  inp.addEventListener('blur', () => setTimeout(() => (box.style.display = 'none'), 150));
  return h('div.combo', inp, box);
}

// ---------- Slike ----------
export const img = (id, thumb = true) => (id ? `/img/${id}${thumb ? '?t=1' : ''}` : '/noimg.svg');

function resize(file, max, q) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', q));
      URL.revokeObjectURL(im.src);
    };
    im.onerror = rej;
    im.src = URL.createObjectURL(file);
  });
}
export async function uploadImages(type, objectId, files, onProgress) {
  let n = 0;
  for (const f of files) {
    const full = await resize(f, 1600, 0.82);
    const thumb = await resize(f, 400, 0.75);
    await POST(`/api/files/${type}/${objectId}`, { full, thumb });
    onProgress?.(++n, files.length);
  }
}
export function gallery(images, { type, objectId, canEdit, onChange }) {
  const main = h('div.gal-main');
  const strip = h('div.gal-strip');
  let cur = images[0];
  const show = im => {
    cur = im;
    clear(main, im ? h('img', { src: img(im.id, false), onclick: () => window.open(img(im.id, false)) }) : h('div.gal-empty', 'Nema slika'));
    [...strip.children].forEach(c => c.classList.toggle('act', c.dataset.id === im?.id));
  };
  for (const im of images) {
    strip.append(h('div.gal-th', { 'data-id': im.id, onclick: () => show(im) }, h('img', { src: img(im.id), loading: 'lazy' }), im.main_picture ? h('span.badge.main', '★') : null));
  }
  const fileInp = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  const camInp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  const prog = h('span.muted');
  const doUpload = async files => {
    if (!files.length) return;
    await run(() => uploadImages(type, objectId, [...files], (a, b) => (prog.textContent = `Šaljem ${a}/${b}…`)), 'Slike dodate');
    prog.textContent = ''; onChange?.();
  };
  fileInp.onchange = () => doUpload(fileInp.files);
  camInp.onchange = () => doUpload(camInp.files);
  const tools = canEdit ? h('div.gal-tools',
    h('button', { onclick: () => camInp.click() }, '📷 Slikaj'),
    h('button', { onclick: () => fileInp.click() }, '🖼 Dodaj slike'),
    images.length ? h('button', { onclick: async () => { if (!cur) return; await run(() => POST(`/api/files/${cur.id}/main`), 'Glavna slika postavljena'); onChange?.(); } }, '★ Glavna') : null,
    images.length ? h('button.danger', { onclick: async () => { if (!cur || !(await confirmBox('Obrisati ovu sliku?'))) return; await run(() => DEL(`/api/files/${cur.id}`), 'Slika obrisana'); onChange?.(); } }, '🗑') : null,
    prog, fileInp, camInp) : null;
  show(images[0]);
  return h('div.gallery', main, images.length > 1 ? strip : null, tools);
}

// ---------- Ruter ----------
const routes = [];
export const route = (pattern, render) => routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), keys: [...pattern.matchAll(/:(\w+)/g)].map(m => m[1]), render });
export const go = path => { location.hash = '#' + path; };
// ponovo iscrtaj trenutni ekran (bez novog unosa u istoriju — dugme Nazad radi normalno)
let _render = () => {};
export const setRenderer = fn => { _render = fn; };
export const refresh = () => _render({ keepScroll: true });
export function currentRoute() {
  const raw = location.hash.slice(1) || '/';
  const [path, query] = raw.split('?');
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query: Object.fromEntries(new URLSearchParams(query || '')) };
  }
  return null;
}
export function setQuery(q) {
  const [path] = (location.hash.slice(1) || '/').split('?');
  history.replaceState(null, '', '#' + path + (qs(q) ? '?' + qs(q) : ''));
}

// ---------- Prikaz ----------
export const kv = (rows) => h('dl.kv', rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v]) => [h('dt', k), h('dd', v)]));
export const badge = (txt, cls = '') => h('span.badge' + (cls ? '.' + cls : ''), txt);
export const statusBadge = s => badge(E.status[s] || s, s === 'SOLD' ? 'red' : 'green');
export const reqBadge = s => badge(E.req[s] || s, { NEW: 'orange', PREPARED: 'blue', CLOSED: 'gray', DONE: 'gray' }[s] || '');
export function pager(total, offset, limit, onPage) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1, pages = Math.ceil(total / limit);
  return h('div.pager',
    h('button', { disabled: page <= 1, onclick: () => onPage(offset - limit) }, '‹ Nazad'),
    h('span', `${page} / ${pages}`),
    h('button', { disabled: page >= pages, onclick: () => onPage(offset + limit) }, 'Dalje ›'));
}
export function tabs(list, active, onSel) {
  return h('div.tabs', list.map(([k, l]) => h('button' + (k === active ? '.act' : ''), { onclick: () => onSel(k) }, l)));
}
export const loading = () => h('div.loading', 'Učitavam…');
export const empty = (t = 'Nema podataka') => h('div.empty', t);

// ---------- Barkod (Code 128-B) i štampa etiketa ----------
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
export function barcodeSVG(text, height = 50) {
  const codes = [104];
  for (const ch of String(text)) codes.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  let sum = 104; for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  let x = 10, rects = '';
  for (const c of codes) { const p = C128[c]; for (let i = 0; i < p.length; i++) { const w = +p[i]; if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`; x += w; } }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px">${rects}</svg>`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// labels: [{code, title, sub}]
export function printLabels(labels) {
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etikete</title><style>
    @page{size:60mm 40mm;margin:0} body{margin:0;font-family:Arial,sans-serif}
    .l{width:60mm;height:40mm;box-sizing:border-box;padding:2mm 3mm;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
    .c{font-size:22pt;font-weight:bold;text-align:center;letter-spacing:1px} .t{font-size:8pt;line-height:1.15;max-height:3.5em;overflow:hidden} .s{font-size:8pt;text-align:center}
  </style></head><body>${labels.map(l => `<div class="l"><div class="t">${esc(l.title)}</div>${barcodeSVG(l.code, 38)}<div class="c">${esc(l.code)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ''}</div>`).join('')}
  <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// ---------- Skeniranje barkoda kamerom (Chrome na Androidu) ----------
export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
export async function scanBarcode() {
  if (!canScan()) { toast('Ovaj pregledač ne podržava skeniranje — koristite Chrome na Androidu', 'err'); return null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { toast('Nema dozvole za kameru', 'err'); return null; }
  const video = h('video', { autoplay: true, playsinline: true, muted: true, style: { width: '100%', borderRadius: '10px', background: '#000' } });
  video.srcObject = stream;
  const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'ean_8', 'data_matrix'] });
  let done = false;
  const p = modal('Skeniranje', [video, h('p.muted', 'Usmjerite kameru na barkod etikete.')], [{ label: 'Odustani' }]);
  const loop = async () => {
    while (!done) {
      try {
        if (video.readyState >= 2) {
          const r = await det.detect(video);
          if (r.length) { done = true; navigator.vibrate?.(80); document.querySelector('.modal-bg')?.remove(); stream.getTracks().forEach(t => t.stop()); return r[0].rawValue.trim(); }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    return null;
  };
  const res = await Promise.race([loop(), p.then(() => null)]);
  done = true; stream.getTracks().forEach(t => t.stop());
  return res;
}
// kratki zvuk (novi nalog i sl.)
export function beep() {
  try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.value = 0.15; o.start(); o.stop(c.currentTime + 0.25); } catch {}
}
