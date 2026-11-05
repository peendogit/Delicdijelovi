// "Pošalji kupcu": slike + tekst na Viber/WhatsApp, ili link na javnu stranicu dijela
import { h, field, input, textarea, modal, toast, fmtMoney, E } from '../lib.js';

export async function shareDialog(p) {
  const link = location.origin + '/p/' + p.internal_code;
  const text = [p.title, `Šifra: ${p.internal_code}`, p.catalog_number ? `Kat. broj: ${p.catalog_number}` : null, p.side ? `Strana: ${E.side[p.side] || p.side}` : null,
    p.price ? `Cijena: ${fmtMoney(p.price, p.currency_id)}` : 'Cijena na upit', `Slike i detalji: ${link}`].filter(Boolean).join('\n');
  const ta = textarea('t', text, { rows: 7 });
  const phone = input('phone', '', { type: 'tel', inputmode: 'tel', placeholder: 'npr. 065 123 456 (opciono)' });
  const intl = () => { const d = phone.value.replace(/\D/g, ''); return d ? (d.startsWith('387') ? d : '387' + d.replace(/^0/, '')) : ''; };
  const n = Math.min(p.images?.length || 0, 6);
  return modal('📤 Pošalji kupcu', [
    field('Poruka', ta), field('Broj kupca (za direktno slanje)', phone),
    h('div.sheet-list',
      navigator.share ? h('button.primary', { onclick: async () => {
        try {
          const files = [];
          for (const im of (p.images || []).slice(0, 6)) {
            const b = await (await fetch('/img/' + im.id)).blob();
            if (b.type.startsWith('image/')) files.push(new File([b], `${p.internal_code}-${files.length + 1}.jpg`, { type: 'image/jpeg' }));
          }
          const data = { text: ta.value, title: p.title };
          if (files.length && navigator.canShare?.({ files })) data.files = files;
          await navigator.share(data);
        } catch (e) { if (e.name !== 'AbortError') toast('Dijeljenje nije uspjelo: ' + e.message, 'err'); }
      } }, `📤 Podijeli${n ? ` sa ${n} slika` : ''} (Viber, WhatsApp…)`) : null,
      h('button', { onclick: () => window.open(`https://wa.me/${intl()}?text=${encodeURIComponent(ta.value)}`) }, '🟢 WhatsApp (tekst i link)'),
      h('button', { onclick: () => { location.href = intl() ? `viber://chat?number=%2B${intl()}` : `viber://forward?text=${encodeURIComponent(ta.value)}`; navigator.clipboard?.writeText(ta.value); if (intl()) toast('Tekst kopiran — zalijepite u Viber'); } }, '🟣 Viber'),
      h('button', { onclick: async () => { await navigator.clipboard.writeText(ta.value); toast('Kopirano'); } }, '📋 Kopiraj tekst'),
      h('button', { onclick: () => window.open(link) }, '🔗 Otvori javnu stranicu dijela')),
    h('p.muted', 'Javna stranica pokazuje slike, cijenu i dugmad za poziv/Viber/WhatsApp; kad se dio proda, piše da više nije dostupan.'),
  ], [{ label: 'Zatvori' }]);
}
