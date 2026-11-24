'use strict';
// Endpoint map: a generated index of Dime's HTTP routes so agents never guess
// a path. Built from the ms-university checkout (routes/, app.js mounts,
// controllers/) and enriched with the purpose lines and parameter appendices
// of the route catalogues under knowledge/routes/.
//
//   build()                 -> knowledge/generated/ENDPOINTS.json (+ ENDPOINTS.md summary)
//   load()                  -> the map
//   match(map, method, path)-> the endpoint whose pattern matches a concrete path, or null
//   search(map, words)      -> ranked endpoints
//   fresh(map)              -> is the map newer than the checkout's routes?

const fs = require('fs');
const path = require('path');
const D = require('./dime');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'knowledge', 'generated');
// LAB_MAP_FILE lets tests and sandboxes use their own map without touching the real one
const OUT_FILE = () => process.env.LAB_MAP_FILE || path.join(OUT_DIR, 'ENDPOINTS.json');
const OUT_MD = path.join(OUT_DIR, 'ENDPOINTS.md');
const CATALOG_DIR = path.join(ROOT, 'knowledge', 'routes');
const POLICY = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));

function read(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; } }
function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(path.relative(base, p));
  }
  return out;
}

/** Normalise a route path for matching: every :param becomes :p, trailing slash dropped. */
function norm(p) { return String(p).replace(/\/+$/, '').replace(/:[A-Za-z0-9_]+\??/g, ':p').replace(/\/+/g, '/') || '/'; }
const key = (m, p) => `${String(m).toUpperCase()} ${norm(p)}`;

// ---------------------------------------------------------------- catalogue (purpose + params)
function parseCatalogs() {
  const byKey = {}; const domains = {};
  if (!fs.existsSync(CATALOG_DIR)) return { byKey, domains };
  for (const f of fs.readdirSync(CATALOG_DIR).filter((x) => x.endsWith('.md') && x !== 'index.md').sort()) {
    const domain = f.replace(/\.md$/, '');
    const text = read(path.join(CATALOG_DIR, f));
    domains[domain] = { file: path.join(CATALOG_DIR, f), intro: (text.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim(), routes: 0 };
    const re = /^- `([A-Z]+) (\/[^`]+)` — (.+)$/gm;
    let m;
    while ((m = re.exec(text))) {
      const k = key(m[1], m[2]); const rest = m[3];
      const e = (byKey[k] = byKey[k] || { domain, purpose: '', params: {} });
      const pm = /^(?:query: (.+)|body: (.+)|no query\/body params read|(.+))$/.exec(rest);
      if (pm && (pm[1] || pm[2])) { // appendix line
        const names = (pm[1] || pm[2]).split(/[`,]\s*/).map((s) => s.replace(/[`\s]/g, '')).filter(Boolean);
        e.params[pm[1] ? 'query' : 'body'] = [...new Set([...(e.params[pm[1] ? 'query' : 'body'] || []), ...names])];
        // "query: … body: …" on one line
        const bm = /body: (.+)$/.exec(pm[1] || ''); if (bm) { e.params.query = e.params.query.filter((n) => !/^body:?$/.test(n)); e.params.body = [...new Set([...(e.params.body || []), ...bm[1].split(/[`,]\s*/).map((s) => s.replace(/[`\s]/g, '')).filter(Boolean)])]; }
      } else if (!/^no query\/body params read$/.test(rest)) {
        if (!e.purpose) { e.purpose = rest.replace(/\s+/g, ' ').trim(); domains[domain].routes += 1; }
        const auth = /Auth: ([^.]+)\.?$/.exec(rest); if (auth) e.auth = auth[1].trim();
      }
    }
  }
  return { byKey, domains };
}

// ---------------------------------------------------------------- code scan
function scanCheckout(root) {
  const rels = walk(root).filter((r) => r === 'app.js' || r.startsWith('routes/') || r.startsWith('controllers/'));
  const files = new Set(walk(root));
  const routesByFile = {}; const ctrlOf = {}; const controllerFns = {}; const mounts = [];
  const resolveReq = (fromRel, spec) => {
    if (!spec.startsWith('.')) return null;
    const joined = path.normalize(path.join(path.dirname(fromRel), spec));
    for (const t of [joined, `${joined}.js`, `${joined}/index.js`]) if (files.has(t)) return t;
    return null;
  };
  for (const rel of rels) {
    const src = read(path.join(root, rel));
    if (rel.startsWith('routes/')) {
      const list = [];
      const rr = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*,([\s\S]*?)\)\s*;/g;
      let r;
      while ((r = rr.exec(src))) {
        const parts = r[3].split(',').map((s) => s.trim()).filter(Boolean);
        const handler = parts[parts.length - 1] || '';
        list.push({ method: r[1].toUpperCase(), path: r[2], middleware: parts.slice(0, -1).map((s) => s.replace(/\(.*$/s, '')).filter((s) => /^[A-Za-z_][\w.]*$/.test(s)), handler: handler.replace(/^[A-Za-z0-9_]+\./, '').replace(/[^\w]/g, '') });
      }
      // chained declarations: router.route('/x').post(mw, handler).put(handler); (the bill/invoice apply-payment routes are written this way)
      const cr = /router\s*\.route\(\s*['"`]([^'"`]+)['"`]\s*\)((?:\s*\.(?:get|post|put|patch|delete)\(\s*[\s\S]*?\))+)\s*;/g;
      let c;
      while ((c = cr.exec(src))) {
        const vr = /\.(get|post|put|patch|delete)\(\s*([\s\S]*?)\)(?=\s*(?:\.(?:get|post|put|patch|delete)\(|$))/g; let v;
        while ((v = vr.exec(c[2]))) {
          const parts = v[2].split(',').map((s) => s.trim()).filter(Boolean);
          const handler = parts[parts.length - 1] || '';
          list.push({ method: v[1].toUpperCase(), path: c[1], middleware: parts.slice(0, -1).map((s) => s.replace(/\(.*$/s, '')).filter((s) => /^[A-Za-z_][\w.]*$/.test(s)), handler: handler.replace(/^[A-Za-z0-9_]+\./, '').replace(/[^\w]/g, ''), chained: true });
        }
      }
      if (list.length) routesByFile[rel] = list;
      const ir = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let im; const ctrls = [];
      while ((im = ir.exec(src))) { const t = resolveReq(rel, im[1]); if (t && t.startsWith('controllers/')) ctrls.push(t); }
      ctrlOf[rel] = ctrls;
      // nested router.use('/x', require('./y')) mounts inside a route file
      const nr = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"](\.[^'"]+)['"]\s*\)\s*\)/g; let nm;
      while ((nm = nr.exec(src))) { const t = resolveReq(rel, nm[2]); if (t) mounts.push({ prefix: nm[1], routeFile: t, parent: rel }); }
    }
    if (rel.startsWith('controllers/')) {
      const fns = {};
      const er = /(?:exports\.([A-Za-z0-9_]+)\s*=|^\s*const\s+([A-Za-z0-9_]+)\s*=\s*asyncHandler\()/gm; let e;
      while ((e = er.exec(src))) fns[e[1] || e[2]] = e.index;
      controllerFns[rel] = { fns, src };
    }
    if (rel === 'app.js') {
      const varReq = {}; const vq = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let v;
      while ((v = vq.exec(src))) varReq[v[1]] = v[2];
      const mr = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:[^,)]+,\s*)*(?:require\(\s*['"](\.[^'"]+)['"]\s*\)|([A-Za-z0-9_]+))\s*\)/g; let mm;
      while ((mm = mr.exec(src))) {
        const spec = mm[2] || varReq[mm[3]];
        if (!spec || !/routes/.test(spec)) continue;
        const t = resolveReq('app.js', spec); if (t) mounts.push({ prefix: mm[1], routeFile: t, parent: 'app.js' });
      }
    }
  }
  // resolve nested mounts to full prefixes
  const fullPrefix = (m) => { if (m.parent === 'app.js') return m.prefix; const up = mounts.find((x) => x.routeFile === m.parent); return up ? `${fullPrefix(up)}${m.prefix}` : m.prefix; };
  const endpoints = [];
  for (const m of mounts) {
    const prefix = fullPrefix(m);
    for (const rt of routesByFile[m.routeFile] || []) {
      const ctrls = ctrlOf[m.routeFile] || [];
      const controller = ctrls.find((c) => controllerFns[c] && rt.handler in controllerFns[c].fns) || ctrls[0] || null;
      const params = handlerParams(controller && controllerFns[controller], rt.handler);
      endpoints.push({ method: rt.method, path: `${prefix}${rt.path === '/' ? '' : rt.path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/', routeFile: m.routeFile, middleware: rt.middleware, handler: rt.handler, controller, params });
    }
  }
  return { endpoints, mountCount: mounts.length, routeFiles: Object.keys(routesByFile).length };
}

/** req.query / req.body / req.params names a handler reads (regex over the handler's body). */
function handlerParams(ctrl, handler) {
  const out = { query: [], body: [], path: [] };
  if (!ctrl || !(handler in ctrl.fns)) return out;
  const start = ctrl.fns[handler];
  const rest = ctrl.src.slice(start, start + 30000);
  const nextIdx = rest.slice(10).search(/\n(?:exports\.[A-Za-z0-9_]+\s*=|const\s+[A-Za-z0-9_]+\s*=\s*asyncHandler\()/);
  const body = nextIdx > 0 ? rest.slice(0, nextIdx + 10) : rest;
  const add = (k, n) => { if (n && !out[k].includes(n) && out[k].length < 40) out[k].push(n); };
  let m;
  const dot = /req\.(query|body|params)\.([A-Za-z_][A-Za-z0-9_]*)/g; while ((m = dot.exec(body))) add(m[1] === 'params' ? 'path' : m[1], m[2]);
  const KW = new Set(['const', 'let', 'var', 'await', 'return']);
  const des = /\{([^{}]+)\}\s*=\s*req\.(query|body|params)\b/g; while ((m = des.exec(body))) for (const n of m[1].split(',').map((s) => s.trim().split(/[:=\s]/)[0]).filter((s) => /^[A-Za-z_]\w*$/.test(s) && !KW.has(s))) add(m[2] === 'params' ? 'path' : m[2], n);
  return out;
}

// ---------------------------------------------------------------- build / load / match
function checkoutStamp(root) {
  let max = 0;
  for (const rel of ['app.js', ...walk(path.join(root, 'routes'), root)]) { try { max = Math.max(max, fs.statSync(path.join(root, rel)).mtimeMs); } catch { /* skip */ } }
  return max;
}

function build({ checkout = D.checkoutPath(), log = () => {} } = {}) {
  if (!fs.existsSync(path.join(checkout, 'app.js'))) throw new Error(`no Dime checkout at ${checkout} (config/backends.json checkout)`);
  const scan = scanCheckout(checkout);
  const cat = parseCatalogs();
  const policy = POLICY();
  const readsNonGet = new Set((policy.readsViaNonGet || []).map((s) => { const [m, ...p] = s.split(' '); return key(m, p.join(' ')); }));
  const seen = new Set(); const endpoints = [];
  for (const e of scan.endpoints) {
    const k = key(e.method, e.path);
    if (seen.has(k)) continue; seen.add(k);
    const c = cat.byKey[k] || {};
    const params = { query: [...new Set([...(c.params && c.params.query || []), ...e.params.query])], body: [...new Set([...(c.params && c.params.body || []), ...e.params.body])], path: [...new Set([...(e.path.match(/:[A-Za-z0-9_]+/g) || []).map((s) => s.slice(1)), ...e.params.path])] };
    const denied = deniedBy(policy, e.method, e.path);
    endpoints.push({ method: e.method, path: e.path, key: k, domain: c.domain || domainGuess(e.path), purpose: c.purpose || '', auth: c.auth || (e.middleware.some((x) => /accountantProtect/.test(x)) ? 'accountant' : e.middleware.some((x) => /admin|machine|internal/i.test(x)) ? 'machine' : e.middleware.length ? e.middleware.join('+') : 'none'), middleware: e.middleware, handler: e.handler, controller: e.controller, params, read: e.method === 'GET' || readsNonGet.has(k), denied });
  }
  // catalogue-only routes (mounted in ways the scanner missed) still count, flagged
  for (const [k, c] of Object.entries(cat.byKey)) {
    if (seen.has(k) || !c.purpose) continue; seen.add(k);
    const [method, ...rest] = k.split(' '); const p = rest.join(' ');
    endpoints.push({ method, path: p, key: k, domain: c.domain, purpose: c.purpose, auth: c.auth || 'accountant', middleware: [], handler: null, controller: null, params: { query: (c.params && c.params.query) || [], body: (c.params && c.params.body) || [], path: (p.match(/:[A-Za-z0-9_]+/g) || []).map((s) => s.slice(1)) }, read: method === 'GET' || readsNonGet.has(k), denied: deniedBy(POLICY(), method, p), catalogOnly: true });
  }
  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const map = { builtAt: new Date().toISOString(), checkout, checkoutStamp: checkoutStamp(checkout), count: endpoints.length, domains: cat.domains, endpoints };
  fs.mkdirSync(path.dirname(OUT_FILE()), { recursive: true }); fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE(), JSON.stringify(map, null, 1));
  if (!process.env.LAB_MAP_FILE) fs.writeFileSync(OUT_MD, summaryMd(map));
  log(`endpoint map: ${endpoints.length} endpoints (${scan.endpoints.length} from code, ${endpoints.filter((e) => e.catalogOnly).length} catalogue-only) across ${Object.keys(cat.domains).length} domains`);
  return map;
}

function domainGuess(p) {
  if (/\/flux|trialBalance|budget|proforma|multi-?currency|consolidation/i.test(p)) return 'financials';
  if (/\/reports|analytics|dashboard|presentation/i.test(p)) return 'reports-analytics';
  if (/\/transactions\//.test(p)) return 'transactions';
  if (/workPapers|fixed-?assets|prepaid|accrual|lease|close/i.test(p)) return 'workpapers-close';
  if (/customer|vendor|product|field|command-center/i.test(p)) return 'entities';
  if (/agent|knowledge|categoriz/i.test(p)) return 'ai-agents';
  if (/tax|payroll|form941|mapping/i.test(p)) return 'tax-payroll';
  if (/document|vault|receipt|audit-?log/i.test(p)) return 'documents-misc';
  if (/auth|team|invite|roles/i.test(p)) return 'team-access';
  return 'other';
}

function deniedBy(policy, method, p) {
  for (const pre of policy.deniedPrefixes || []) if (p.startsWith(pre)) return `prefix ${pre}`;
  for (const pat of policy.deniedPatterns || []) if (new RegExp(pat, 'i').test(p)) return `pattern ${pat}`;
  if ((policy.neverProposeMethods || []).includes(method.toUpperCase())) return `method ${method}`;
  return null;
}

function summaryMd(map) {
  const lines = ['# Dime endpoint map (generated by `lab map`)', '', `${map.count} endpoints from the Dime checkout, built ${map.builtAt}. Search it with \`node tools/map.js search <words>\` and read one with \`node tools/map.js show <METHOD> <path>\`. A path that is not in this map does not exist; the HTTP tool refuses it. Read the route catalogue for a domain (the Read tool on the file path below) before planning calls in it.`, '', '| Domain | Routes | Catalogue file | When to reach for it |', '|---|---|---|---|'];
  for (const [d, v] of Object.entries(map.domains)) lines.push(`| ${d} | ${map.endpoints.filter((e) => e.domain === d).length} | ${v.file} | ${v.intro.slice(0, 220)} |`);
  lines.push('', '## Cross-cutting facts', '- Almost everything needs the accountant token the desk already holds. Routes marked `machine` or `business` will 401; say what you found rather than retrying.',
    '- Several heavy READS travel as PATCH or POST with filters in the body (the V2 transaction search, flux compare). The map marks them `read: true`; the HTTP tool allows them.',
    '- Long operations (statement extraction, report packages, flux analysis, categorisation runs) return a job id at once; poll the paired status route named in the catalogue.',
    '- Paginated list routes cap page size; walk pages rather than asking big. Date parameter names differ by route (startDate/endDate, start/end, {date:{start,end}}): read the entry before assuming, and sanity-check the row count and date span you get back.',
    `- Denied by policy (never callable from the desk): ${map.endpoints.filter((e) => e.denied).length} routes (auth, team, billing, internal, MCP, SCIM, integration connect flows, destructive bulk routes).`);
  return lines.join('\n');
}

function load() {
  if (!fs.existsSync(OUT_FILE())) return null;
  const map = JSON.parse(fs.readFileSync(OUT_FILE(), 'utf8'));
  map._re = null;
  return map;
}

function fresh(map, checkout = D.checkoutPath()) {
  if (!map) return false;
  try { return map.checkoutStamp >= checkoutStamp(checkout) - 1; } catch { return false; }
}

/** Compile each endpoint's pattern once. */
function compiled(map) {
  if (!map._re) map._re = map.endpoints.map((e) => ({ e, re: new RegExp(`^${e.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+\??/g, '[^/]+')}/?$`) }));
  return map._re;
}

/** The endpoint matching a concrete path (query string ignored), preferring literal segments over params. */
function match(map, method, concretePath) {
  if (!map) return null;
  const p = String(concretePath).split('?')[0].replace(/\/+$/, '') || '/';
  const m = String(method).toUpperCase();
  const hits = compiled(map).filter((x) => x.e.method === m && x.re.test(p)).map((x) => x.e);
  if (!hits.length) return null;
  hits.sort((a, b) => (b.path.split(':').length === 1 ? 1 : 0) - (a.path.split(':').length === 1 ? 1 : 0) || (a.path.match(/:/g) || []).length - (b.path.match(/:/g) || []).length);
  return hits[0];
}

function search(map, words, { domain = null, limit = 20 } = {}) {
  const ws = String(Array.isArray(words) ? words.join(' ') : words).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const score = (e) => {
    const hay = `${e.path} ${e.purpose} ${e.handler || ''} ${e.domain}`.toLowerCase();
    let s = 0;
    for (const w of ws) { if (e.path.toLowerCase().includes(w)) s += 3; if ((e.purpose || '').toLowerCase().includes(w)) s += 2; if (hay.includes(w)) s += 1; }
    if (e.read) s += 0.5; if (e.denied) s -= 5; if (e.catalogOnly) s -= 0.5;
    return s;
  };
  return map.endpoints.filter((e) => !domain || e.domain === domain).map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

module.exports = { build, load, fresh, match, search, norm, key, deniedBy, parseCatalogs, scanCheckout, handlerParams, get OUT() { return OUT_FILE(); }, OUT_MD, CATALOG_DIR, POLICY };
