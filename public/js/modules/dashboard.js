import { h, route, GET, img, fmtDT, fmtMoney, go, reqBadge, can, badge } from '../lib.js';

route('/', async () => {
  const d = await GET('/api/dashboard');
  const c = d.counts;
  const stat = (n, l, path) => h('div.stat', { onclick: () => go(path), style: { cursor: 'pointer' } }, h('b', n.toLocaleString('bs-BA')), h('span', l));
  const quick = h('div.actions', { style: { marginBottom: '12px' } },
    can('ROLE_SP_C') ? h('button.primary', { onclick: () => go('/dijelovi/novi') }, '+ Novi dio') : null,
    can('ROLE_VEH_C') ? h('button', { onclick: () => go('/vozila/novo') }, '+ Novo vozilo') : null,
    can('ROLE_RIMS_C') ? h('button', { onclick: () => go('/felne/nova') }, '+ Nove felne') : null,
    can('ROLE_SP_LOC_U', 'ROLE_WHS_CLERK') ? h('button', { onclick: () => go('/premjestanje') }, '📦 Premještanje') : null);
  const w = d.widgets.map(wd => {
    if (wd.key === 'active_req') {
      return h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', wd.title, ' ', badge(wd.rows.length))),
        h('div.list', wd.rows.length ? wd.rows.map(r => h('a.item' + (r.urgent ? '.urgent' : ''), { href: '#/nalozi/' + r.id },
          h('div.bd', h('div.t', '#' + r.the_number + ' · ' + (r.title || '')), h('div.s', h('span.code', r.internal_code || ''), r.location_code ? h('b', '📍 ' + r.location_code) : null, r.shipment ? badge('Slanje', 'blue') : null, h('span', r.user_name), h('span', fmtDT(r.d)))),
          h('div.rt', reqBadge(r.status)))) : h('div.empty', 'Nema aktivnih naloga')));
    }
    return h('div.card.p0', h('div', { style: { padding: '12px 14px 4px' } }, h('h2', wd.title, wd.count != null ? ' ' : null, wd.count != null ? badge(wd.count) : null)),
      h('div.list', wd.rows.length ? wd.rows.map(r => h('a.item', { href: '#/dijelovi/' + r.id },
        h('img.th', { src: img(r.image_id), loading: 'lazy' }),
        h('div.bd', h('div.t', r.title), h('div.s', h('span.code', r.internal_code), r.user_name ? h('span', r.user_name) : null, h('span', fmtDT(r.d)))),
        h('div.rt', r.price ? h('span.price', fmtMoney(r.price)) : null))) : h('div.empty', 'Prazno')));
  });
  return h('div',
    h('div.head', h('h1', 'Početna')),
    h('div.stats', stat(c.parts, 'Dijelova na stanju', '/dijelovi'), stat(c.req, 'Aktivnih naloga', '/nalozi'), stat(c.vehicles, 'Vozila', '/vozila'), stat(c.rims, 'Felni na stanju', '/felne')),
    quick,
    h('div.grid2', w));
});
