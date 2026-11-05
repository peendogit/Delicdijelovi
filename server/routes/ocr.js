// Prepoznavanje kataloškog broja sa slike naljepnice (Claude API, plaća se po korištenju).
// Ključ: Administracija → Podešavanja → "AI ključ" (ANTHROPIC_API_KEY) ili u .env
import { app } from '../router.js';
import { need } from '../auth.js';
import { bad, configStr, HttpError } from '../util.js';

const MODEL = process.env.OCR_MODEL || 'claude-haiku-5-5';
const PROMPT = `Na slici je naljepnica ili oznaka na polovnom auto dijelu. Pročitaj kataloške (OE) brojeve dijela.
Vrati SAMO JSON, bez ikakvog drugog teksta, u obliku:
{"brojevi": ["..."], "proizvodjac": "...", "napomena": "..."}
- "brojevi": kataloški/OE brojevi tačno kako pišu (najvjerovatniji prvi). Ne uključuj datume, serijske brojeve, bar-kod brojeve od 13 cifara ni "Made in".
- "proizvodjac": proizvođač dijela ako se vidi (Bosch, Valeo, Hella, VW…), inače "".
- "napomena": kratko ako je slika nejasna, inače "".`;

app.post('/api/ocr', async ctx => {
  need(ctx.user, 'ROLE_SP_C', 'ROLE_SP_U', 'ROLE_SP_R');
  const key = configStr('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(400, 'AI ključ nije podešen (Administracija → Podešavanja → AI ključ)');
  const m = String(ctx.body.image || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw bad('Nema slike');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: PROMPT }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'AI greška: ' + (j.error?.message || r.status));
  const text = (j.content || []).map(c => c.text || '').join('');
  let out;
  try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { out = { brojevi: [], napomena: text.slice(0, 200) }; }
  const nums = [...new Set((out.brojevi || []).map(x => String(x).trim()).filter(x => x.replace(/[^A-Za-z0-9]/g, '').length >= 4))].slice(0, 8);
  return { numbers: nums, manufacturer: out.proizvodjac || '', note: out.napomena || '' };
});
