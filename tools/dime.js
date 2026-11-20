#!/usr/bin/env node
'use strict';
// Agent-facing HTTP tool: the only network path an agent has. Reads execute
// and leave a receipt; writes are staged as proposals for a named human.
//
//   node tools/dime.js call       --request REQ-1 --method GET --path /api/v1/… [--query '<json>'] [--body '<json>'|--body-file f] [--out name] [--raw]
//   node tools/dime.js propose    --request REQ-1 --kind vendor --tier A --summary "…" --method POST --path /api/v1/… (--body '<json>'|--body-file f) [--amount n] [--entry-file f]
//   node tools/dime.js businesses --request REQ-1
//   node tools/dime.js dates      --month YYYY-MM | --quarter YYYY-Qn | --year YYYY | --last-months N [--as-of YYYY-MM-DD]
//
// One JSON object on stdout; {ok:false, error} and exit 1 on a refusal or failure.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const D = require(path.join(ROOT, 'src', 'dime'));
const M = require(path.join(ROOT, 'src', 'map'));
const R = require(path.join(ROOT, 'src', 'receipts'));
const PR = require(path.join(ROOT, 'src', 'proposals'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null && !String(rest[i + 1]).startsWith('--') ? rest[i + 1] : d; };
const has = (n) => rest.includes(`--${n}`);
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.ok === false ? 1 : 0); };
const jsonFlag = (n) => { const v = flag(n); if (v == null) return null; try { return JSON.parse(v); } catch (e) { out({ ok: false, error: `--${n} is not valid JSON: ${e.message}` }); return null; } };
const bodyArg = () => { const f = flag('body-file'); if (f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { out({ ok: false, error: `--body-file: ${e.message}` }); } } return jsonFlag('body'); };

function loadReq() {
  const id = flag('request') || process.env.LAB_REQUEST;
  if (!id) out({ ok: false, error: '--request <ID> is required' });
  try { return T.loadRequest(id); } catch (e) { out({ ok: false, error: e.message }); return null; }
}
const clipJson = (j, max = 12000) => { const s = JSON.stringify(j); return s.length > max ? `${s.slice(0, max)}…[clipped ${s.length - max} chars; the full response is in the --out file]` : j; };

async function main() {
  if (cmd === 'dates') return out({ ok: true, ...dates() });

  if (cmd === 'businesses') {
    // the client list carries the names; it is heavy (chart of accounts per business), so only names, ids and status are returned and nothing is saved
    const req = loadReq();
    const search = flag('search');
    const r = await D.call({ backend: req.backend, method: 'GET', path: '/api/v1/accountant/dashboard/businessList', query: search ? { searchKey: search } : null });
    R.append(req.id, { method: 'GET', path: '/api/v1/accountant/dashboard/businessList', url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: process.env.LAB_RUN || null, purpose: 'businesses the desk can see' });
    if (!r.ok) return out({ ok: false, error: D.humanize(r.status, r.json), status: r.status });
    const arr = (r.json && (r.json.businesses || r.json.data || [])) || [];
    const list = arr.map((b) => { const i = b.businessInfo || {}; return { businessId: String(b._id || b.businessId || ''), name: i.businessName || i.dba || i.companyName || null, dba: i.dba && i.dba !== i.businessName ? i.dba : undefined, status: b.status || null, currency: b.functionalCurrency || null, fiscalYearEnd: i.fiscalYearEnd || null, archived: Boolean(b.archivedAt) }; });
    const q = search ? String(search).toLowerCase() : null;
    const hits = q ? list.filter((b) => (b.name || '').toLowerCase().includes(q) || (b.dba || '').toLowerCase().includes(q)) : list;
    return out({ ok: true, total: list.length, returned: hits.length, businesses: hits.slice(0, 120), next: hits.length === 1 ? 'One match: put its businessId and name in the subject.' : hits.length > 1 && q ? 'Several businesses match. If the request does not say which, ask one question naming them.' : 'Match the request\'s words to a name (use --search <word> to narrow). Put the chosen businessId and name in the subject.' });
  }

  if (cmd === 'call') {
    const req = loadReq();
    const method = String(flag('method', 'GET')).toUpperCase();
    const p = flag('path'); if (!p || !p.startsWith('/api/v1/')) return out({ ok: false, error: '--path must start with /api/v1/ and come from the endpoint map (tools/map.js search)' });
    const map = M.load(); if (!map) return out({ ok: false, error: 'the endpoint map has not been built; a human must run `lab map`' });
    const e = M.match(map, method, p);
    if (!e) return out({ ok: false, error: `${method} ${p} is not in the endpoint map; nothing was called. Search for the right route: node ${path.join(ROOT, 'tools', 'map.js')} search <words>`, suggestions: M.search(map, p.split('/').slice(-3).join(' '), { limit: 5 }).map((x) => `${x.method} ${x.path}`) });
    if (e.denied) { R.append(req.id, { method, path: p, status: 'refused', refused: `policy: ${e.denied}`, run: process.env.LAB_RUN || null }); return out({ ok: false, error: `${method} ${p} is denied by policy (${e.denied}); nothing was called. Say in your report that the request needs it.` }); }
    if (!e.read) { R.append(req.id, { method, path: p, status: 'refused', refused: 'write during execution', run: process.env.LAB_RUN || null }); return out({ ok: false, error: `${method} ${p} is a write. Nothing was called. Stage it for approval instead: node ${path.join(ROOT, 'tools', 'dime.js')} propose --request ${req.id} --kind <kind> --tier A|B|C --summary "…" --method ${method} --path ${p} --body '<json>'` }); }
    const query = jsonFlag('query'); const body = bodyArg();
    const r = await D.call({ backend: req.backend, method, path: p, query, body });
    const rec = { method, path: p, url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: process.env.LAB_RUN || null, purpose: e.purpose ? e.purpose.slice(0, 120) : null };
    let saved = null;
    const name = flag('out');
    if (name) {
      const safe = path.basename(String(name)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.json$/i, '');
      const isBinary = !r.json && !r.text;
      const file = `data/${safe}${isBinary ? ext(r.type) : '.json'}`;
      T.writeArtifact(req.id, file, isBinary ? r.buf : JSON.stringify(r.json != null ? r.json : r.text, null, 1));
      saved = path.join(T.artifactsDir(req.id), file); rec.outFile = file;
    }
    const seq = R.append(req.id, rec);
    if (!r.ok) return out({ ok: false, receipt: seq, status: r.status, error: D.humanize(r.status, r.json), response: r.json != null ? clipJson(r.json, 2000) : (r.text || '').slice(0, 2000), saved });
    const payload = r.json != null ? r.json : (r.text != null ? r.text.slice(0, 12000) : `[binary ${r.type}, ${r.bytes} bytes]`);
    return out({ ok: true, receipt: seq, status: r.status, bytes: r.bytes, saved, response: saved ? summarize(payload) : clipJson(payload), next: saved ? `Read ${saved} with the Read tool (or files.js tables/head for rows). Cite receipt R-${seq} for every figure you take from it.` : `Cite receipt R-${seq} for every figure you take from this response. For anything larger than a screen, call again with --out <name>.` });
  }

  if (cmd === 'propose') {
    const req = loadReq();
    const policy = M.POLICY();
    if (policy.writesEnabled === false) return out({ ok: false, error: 'writes are disabled on this desk (config/policy.json writesEnabled=false)' });
    if (!req.writes) return out({ ok: false, error: 'this request was triaged as read-only (writes=false). Say in your report that a change is needed; a human can resubmit it as a change request.' });
    const method = String(flag('method', 'POST')).toUpperCase(); const p = flag('path');
    const kind = flag('kind'); const summary = flag('summary'); let tier = String(flag('tier', '') || '').toUpperCase();
    if (!p || !kind || !summary) return out({ ok: false, error: 'propose needs --kind, --summary, --method, --path and --body (or --body-file)' });
    const map = M.load(); const e = map && M.match(map, method, p);
    if (!e) return out({ ok: false, error: `${method} ${p} is not in the endpoint map; a proposal must name a real route` });
    if (e.denied) return out({ ok: false, error: `${method} ${p} is denied by policy (${e.denied}) and cannot be proposed` });
    const body = bodyArg();
    let entry = null; const ef = flag('entry-file'); if (ef) { try { entry = JSON.parse(fs.readFileSync(ef, 'utf8')); } catch (x) { return out({ ok: false, error: `--entry-file: ${x.message}` }); } }
    const forced = PR.tierFor(policy, kind, tier);
    if (forced.tier === 'C') return out({ ok: true, ...PR.add(req.id, { kind, tier: 'C', summary, question: summary, method: null, path: null, body: null }), next: 'Tier C is a question for a person: it never carries a payload. Explain the judgment call in work.md.' });
    const bal = entry ? PR.balanced(entry) : null;
    if (entry && !bal.ok) return out({ ok: false, error: `journal entry does not balance: debits ${bal.debits} vs credits ${bal.credits}. Fix it before proposing.` });
    const res = PR.add(req.id, { kind, tier: forced.tier, tierReason: forced.reason, summary, method, path: p, body, amount: flag('amount') != null ? Number(flag('amount')) : PR.amountOf(body, entry), entry, endpointPurpose: e.purpose || null });
    return out({ ok: true, ...res, next: `Proposal ${res.proposal.id} staged (tier ${forced.tier}${forced.reason ? `: ${forced.reason}` : ''}). It is applied only after a named person approves it at Gate 2. Do not call the route yourself.` });
  }

  out({ ok: false, error: 'usage: call | propose | businesses | dates (see the header of this file)' });
}

function ext(type) { if (/spreadsheet|excel/.test(type || '')) return '.xlsx'; if (/pdf/.test(type || '')) return '.pdf'; if (/csv/.test(type || '')) return '.csv'; return '.bin'; }

/** A compact look at a saved response so the agent knows its shape without the full body. */
function summarize(j) {
  const shape = (v, depth = 0) => {
    if (Array.isArray(v)) return `array[${v.length}]${v.length && depth < 2 ? ` of ${shape(v[0], depth + 1)}` : ''}`;
    if (v && typeof v === 'object') { const ks = Object.keys(v); return `{${ks.slice(0, 14).map((k) => `${k}: ${depth < 2 ? shape(v[k], depth + 1) : typeof v[k]}`).join(', ')}${ks.length > 14 ? `, …+${ks.length - 14}` : ''}}`; }
    if (typeof v === 'string') return `"${v.slice(0, 40)}${v.length > 40 ? '…' : ''}"`;
    return String(v);
  };
  return { shape: shape(j) };
}

function dates() {
  const iso = (d) => d.toISOString().slice(0, 10);
  const month = flag('month'); const quarter = flag('quarter'); const year = flag('year'); const last = flag('last-months');
  const asOf = flag('as-of') ? new Date(`${flag('as-of')}T00:00:00Z`) : new Date();
  const one = (y, mo) => { const start = new Date(Date.UTC(y, mo - 1, 1)); const end = new Date(Date.UTC(y, mo, 0)); return { period: `${y}-${String(mo).padStart(2, '0')}`, startDate: iso(start), endDate: iso(end), days: end.getUTCDate() }; };
  if (month) { const m = /^(\d{4})-(\d{2})$/.exec(month); if (!m) out({ ok: false, error: '--month must be YYYY-MM' }); return one(Number(m[1]), Number(m[2])); }
  if (quarter) { const m = /^(\d{4})-Q([1-4])$/i.exec(quarter); if (!m) out({ ok: false, error: '--quarter must be YYYY-Q1..Q4' }); const y = Number(m[1]); const q = Number(m[2]); const s = new Date(Date.UTC(y, (q - 1) * 3, 1)); const e = new Date(Date.UTC(y, q * 3, 0)); return { period: `${y}-Q${q}`, startDate: iso(s), endDate: iso(e), days: Math.round((e - s) / 864e5) + 1 }; }
  if (year) { const y = Number(year); const leap = new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1; return { period: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, days: leap ? 366 : 365, leapYear: leap }; }
  if (last) {
    const n = Number(last); if (!(n >= 1 && n <= 36)) out({ ok: false, error: '--last-months must be 1..36' });
    // "last N months" = the N complete calendar months before the current one
    const y = asOf.getUTCFullYear(); const mo = asOf.getUTCMonth() + 1;
    const periods = []; for (let i = n; i >= 1; i--) { let yy = y; let mm = mo - i; while (mm <= 0) { mm += 12; yy -= 1; } periods.push(one(yy, mm)); }
    return { asOf: iso(asOf), rule: 'the N complete calendar months before the month containing as-of', periods };
  }
  out({ ok: false, error: 'dates needs one of --month, --quarter, --year, --last-months' }); return null;
}

main().catch((e) => out({ ok: false, error: e.message, status: e.status ?? null }));
