// Kalkulator otkupa vozila
import { h, clear, route, GET, qs, go, lookups, models, fmtMoney, fmtNum, fmtDate, field, input, combo, badge, loading, empty, setQuery, toast } from '../lib.js';
import { makeItems, modelItems } from './parts.js';

route('/kalkulator', async (params, query, main) => {
  const L = await lookups();
  const res = h('div');
  const makeC = combo('make_id', query.make_id, makeItems(L), { placeholder: 'Marka' });
  const modelC = combo('model_id', query.model_id, query.make_id ? modelItems(await models(query.make_id)) : [], { placeholder: 'Model (generacija i godišta)' });
  makeC.addEventListener('change', async () => modelC.setItems(modelItems(await models(makeC.value))));
  const yearI = input('year', query.year, { type: 'number', inputmode: 'numeric', placeholder: 'npr. 2012' });
  const offerI = input('offer', query.offer, { type: 'number', inputmode: 'decimal', placeholder: 'koliko traže (KM)' });
  const st = (v, l, x) => h('div.stat', h('b', v), h('span', l), x || null);
  const calc = async () => {
    if (!makeC.value) return toast('Izaberite marku i model', 'err');
    const q = { make_id: makeC.value, model_id: modelC.value, year: yearI.value, offer: offerI.value };
    setQuery(q);
    clear(res, loading());
    const d = await GET('/api/calc/vehicle?' + qs(q));
    const offer = Number(offerI.value) || null;
    const conf = { high: ['pouzdano', 'green'], medium: ['srednje pouzdano', 'orange'], low: ['okvirno — malo podataka', 'gray'] }[d.confidence];
    let verdict = null;
    if (offer && d.recommended_max) {
      const ok = offer <= d.recommended_max;
      verdict = h('div.card', { style: { borderLeft: `6px solid ${ok ? 'var(--ok)' : 'var(--red)'}`, fontSize: '16px' } },
        h('b', { style: { color: ok ? 'var(--ok)' : 'var(--red)' } }, ok ? '✔ Isplati se' : '✖ Preskupo'),
        ` — traže ${fmtMoney(offer)}, preporučeni maksimum je ${fmtMoney(d.recommended_max)}`,
        !ok ? h('div.muted', `Ponuda bi trebala biti oko ${fmtMoney(d.recommended_max)} ili manje.`) : h('div.muted', `Ostaje prostora oko ${fmtMoney(d.recommended_max - offer)}.`));
    }
    const e = d.earned;
    clear(res,
      h('div.art-head', h('div.ttl', h('h1', '🚗 ' + d.model + (yearI.value ? ' · ' + yearI.value : '')), h('div.muted', `Poređenje: ${d.basis} · ${d.n} vozila iz vaše istorije · `, badge(conf[0], conf[1]))),
        h('div', { style: { textAlign: 'right' } }, h('div.muted', 'PREPORUČENI MAKSIMUM'), h('div.price', { style: { fontSize: '28px' } }, d.recommended_max != null ? fmtMoney(d.recommended_max) : '—'))),
      verdict,
      h('div.stats',
        st(e.m12.median != null ? fmtMoney(e.m12.median) : '—', 'Donese u prvih 12 mj. (srednje)', h('div.muted', e.m12.n + ' vozila')),
        st(e.m3.median != null ? fmtMoney(e.m3.median) : '—', 'U prva 3 mjeseca'), st(e.m6.median != null ? fmtMoney(e.m6.median) : '—', 'U prvih 6 mjeseci'),
        st(e.total_median != null ? fmtMoney(e.total_median) : '—', 'Ukupno do danas (srednje)'),
        st(d.paid.median != null ? fmtMoney(d.paid.median) : '—', 'Koliko ste plaćali', d.paid.min != null ? h('div.muted', `${fmtMoney(d.paid.min)} – ${fmtMoney(d.paid.max)}`) : null),
        st(d.payback.median_days != null ? Math.round(d.payback.median_days / 30) + ' mj.' : '—', 'Do isplate (srednje)', h('div.muted', `isplatilo se ${d.payback.paid_off}/${d.n}`))),
      h('div.card', h('h2', 'Kako je izračunato'), h('p', { style: { margin: 0 } },
        `Preporuka = ${Math.round(d.factor * 100)}% od onoga što ovakvo vozilo vrati od dijelova u prvih 12 mjeseci`,
        d.year_factor !== 1 ? `, korigovano za godište (×${d.year_factor.toFixed(2)})` : '', '. Ostatak pokriva rad, prostor, troškove i rizik.'),
        d.saturated ? h('p', { style: { color: 'var(--red)', marginBottom: 0 } }, `⚠ Već imate ${fmtNum(d.stock)} dijelova ovog modela na stanju, a za 12 mjeseci prodalo se ${fmtNum(d.sold12.n)} — zaliha je veća nego inače (${d.stock_ratio} naspram prosjeka ${d.normal_ratio}), pa je preporuka smanjena.`) : null),
      h('div.grid2',
        h('div.card', h('h2', 'Šta se za ovaj model traži (12 mj.)'), d.demand.length ? h('table.tbl', h('thead', h('tr', h('th', 'Dio'), h('th.n', 'Prodato'), h('th.n', 'Promet'), h('th.n', 'Na stanju'))),
          h('tbody', d.demand.map(r => h('tr', h('td', r.title), h('td.n', r.sold), h('td.n', fmtMoney(r.revenue)), h('td.n', r.stock ? r.stock : badge('NEMA', 'red')))))) : empty('Nema prodaja u zadnjih 12 mjeseci'),
          h('p.muted', `Ukupno ${fmtNum(d.sold12.n)} prodaja za ${fmtMoney(d.sold12.s)}; na stanju ${fmtNum(d.stock)} dijelova ovog modela.`)),
        h('div.card', h('h2', 'Slična vozila koja ste imali'), d.vehicles.length ? h('table.tbl', h('thead', h('tr', h('th', 'Vozilo'), h('th.n', 'Plaćeno'), h('th.n', '12 mj.'), h('th.n', 'Ukupno'))),
          h('tbody', d.vehicles.map(v => h('tr.click', { onclick: () => go('/vozila/' + v.id) }, h('td', h('b', v.internal_code), ' ' + v.title + ' ' + v.model_year, h('div.muted', fmtDate(v.created_date))),
            h('td.n', v.price ? fmtMoney(v.price) : '—'), h('td.n', v.m12 != null ? fmtMoney(v.m12) : h('span.muted', 'još nema god.')), h('td.n', h('b', fmtMoney(v.back))))))) : empty('Nema sličnih vozila'))));
  };
  clear(main, h('div',
    h('div.head', h('h1', '🧮 Kalkulator otkupa vozila')),
    h('div.card', h('p.muted', { style: { marginTop: 0 } }, 'Upišite vozilo koje vam nude. Program iz vaših prodaja izračuna koliko ovakvo vozilo donese od dijelova i do koje cijene se isplati kupiti.'),
      h('div.grid', field('Marka', makeC), field('Model', modelC, { wide: true }), field('Godište', yearI), field('Traže (KM)', offerI)),
      h('div.row', { style: { marginTop: '10px', justifyContent: 'flex-end' } }, h('button.primary', { onclick: calc }, '🧮 Izračunaj'))),
    res));
  if (query.make_id) calc();
});
