#!/usr/bin/env node
'use strict';
// Agent-facing endpoint map queries. One JSON object on stdout.
//   node tools/map.js search <words…> [--domain <name>] [--limit N]
//   node tools/map.js show <METHOD> <path>
//   node tools/map.js domains
//   node tools/map.js domain <name>
const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'map'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null ? rest[i + 1] : d; };
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.ok === false ? 1 : 0); };

const map = M.load();
if (!map) out({ ok: false, error: 'the endpoint map has not been built; a human must run `lab map` (you cannot)' });

const brief = (e) => ({ method: e.method, path: e.path, read: e.read, denied: e.denied || undefined, domain: e.domain, purpose: e.purpose || '(no catalogue entry; read the controller name)', params: e.params, handler: e.handler || undefined });

if (cmd === 'search') {
  const words = positional; if (!words.length) out({ ok: false, error: 'search needs words, e.g. search ar aging' });
  const hits = M.search(map, words, { domain: flag('domain'), limit: Number(flag('limit', 15)) });
  out({ ok: true, query: words.join(' '), results: hits.map(brief), next: hits.length ? 'Pick one, run `show <METHOD> <path>` for its parameters, then call it with tools/dime.js. Read the domain catalogue (domain <name>) when you need the surrounding routes.' : 'No match. Try other words, or read a domain catalogue: `domains`.' });
}
if (cmd === 'show') {
  const [method, p] = positional; if (!method || !p) out({ ok: false, error: 'show <METHOD> <path>' });
  const e = M.match(map, method, p) || map.endpoints.find((x) => x.key === M.key(method, p));
  if (!e) out({ ok: false, error: `no endpoint ${method.toUpperCase()} ${p} in the map; search for it first`, suggestions: M.search(map, p.split('/').slice(-3).join(' '), { limit: 5 }).map((x) => `${x.method} ${x.path}`) });
  out({ ok: true, endpoint: brief(e), middleware: e.middleware, controller: e.controller, next: e.denied ? `Denied by policy (${e.denied}); do not call it. Say in your report that the request needs it.` : e.read ? 'A read: call it with tools/dime.js call … --out <name>.' : 'A write: stage it with tools/dime.js propose …; it is never called during execution.' });
}
if (cmd === 'domains') out({ ok: true, domains: Object.entries(map.domains).map(([d, v]) => ({ domain: d, routes: map.endpoints.filter((e) => e.domain === d).length, file: v.file, about: v.intro.slice(0, 200) })) });
if (cmd === 'domain') {
  const d = positional[0]; const v = d && map.domains[d];
  if (!v) out({ ok: false, error: `unknown domain "${d}"`, domains: Object.keys(map.domains) });
  out({ ok: true, domain: d, file: v.file, routes: map.endpoints.filter((e) => e.domain === d).length, next: `Read the file with the Read tool: ${v.file}` });
}
out({ ok: false, error: 'usage: search <words…> | show <METHOD> <path> | domains | domain <name>' });
