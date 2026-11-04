// Mini ruter: app.get('/api/parts/:id', handler, {public:true, raw:true})
const list = [];
function add(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  list.push({ method, re, keys, handler, ...opts });
}
export const app = {
  get: (p, h, o) => add('GET', p, h, o),
  post: (p, h, o) => add('POST', p, h, o),
  put: (p, h, o) => add('PUT', p, h, o),
  del: (p, h, o) => add('DELETE', p, h, o),
};
export const routes = {
  match(method, pathname) {
    for (const r of list) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = pathname.match(r.re);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  },
};
