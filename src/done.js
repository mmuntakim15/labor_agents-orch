'use strict';
// Definition-of-done evaluators: deterministic checks the orchestrator runs
// before the Verifier (and that agents may run themselves with tools/check.js).
// Each evaluator gets { req, dir, args, expect, call } and returns
// { pass, figures, note, advisory? }. A failed non-advisory item forces a failing verdict.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const R = require('./receipts');
const X = require('./xlsx');
const PR = require('./proposals');

// The realtime P&L and balance sheet are variance reports: they take a current and a prior period (all four dates required).
const periodArgs = (a) => ({ currentStart: a.currentStart || a.startDate, currentEnd: a.currentEnd || a.endDate, priorStart: a.priorStart || a.currentStart || a.startDate, priorEnd: a.priorEnd || a.currentEnd || a.endDate, ...(a.comparisonMode ? { comparisonMode: a.comparisonMode } : {}) });
const REPORT_ROUTES = {
  profit_and_loss: { path: (b) => `/api/v1/accountant/reports/profit-and-loss-realtime/${b}`, args: periodArgs, figures: ['netIncome', 'net_income', 'netProfit', 'totalRevenue', 'operatingIncome', 'grossProfit'] },
  balance_sheet: { path: (b) => `/api/v1/accountant/reports/balance-sheet-realtime/${b}`, args: periodArgs, figures: ['totalAssets', 'total_assets', 'totalLiabilities', 'totalEquity', 'totalLiabilitiesAndEquity'] },
  general_ledger: { path: (b) => `/api/v1/accountant/reports/general-ledger-realtime/${b}`, args: (a) => ({ startDate: a.startDate, endDate: a.endDate }), figures: ['totalDebits', 'totalCredits'] },
  ar_aging: { path: (b) => `/api/v1/accountant/reports/ar-aging/${b}`, args: (a) => ({ asOf: a.asOf }), figures: ['total', 'grandTotal', 'totalOutstanding', 'totalDue'] },
  ap_aging: { path: (b) => `/api/v1/accountant/reports/ap-aging/${b}`, args: (a) => ({ asOf: a.asOf }), figures: ['total', 'grandTotal', 'totalOutstanding', 'totalDue'] },
};

const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** Walk a response for the first numeric value under one of the candidate keys. */
function findFigure(json, candidates, depth = 0) {
  if (!json || typeof json !== 'object' || depth > 8) return null;
  for (const k of candidates) if (typeof json[k] === 'number') return { key: k, value: json[k] };
  for (const [k, v] of Object.entries(json)) { if (v && typeof v === 'object') { const f = findFigure(v, candidates, depth + 1); if (f) return { key: `${k}.${f.key}`, value: f.value }; } }
  return null;
}

function deliverables(dir) {
  const d = path.join(dir, 'deliverables');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => !f.startsWith('.') && f !== 'manifest.json').map((f) => ({ name: f, path: path.join(d, f), ext: path.extname(f).toLowerCase() }));
}

/** Numbers that appear in a deliverable (xlsx cells, csv/md numbers), absolute, 2 dp. */
function numbersInDeliverable(f) {
  const out = new Set();
  try {
    if (f.ext === '.xlsx') { for (const s of X.readXlsx(fs.readFileSync(f.path)).sheets) for (const row of s.rows) for (const v of row) if (typeof v === 'number') out.add(Math.abs(r2(v))); }
    else if (['.csv', '.md', '.txt', '.html'].includes(f.ext)) for (const m of fs.readFileSync(f.path, 'utf8').match(/-?\(?\$?\d[\d,]*(\.\d+)?\)?/g) || []) { const n = Number(m.replace(/[$,()]/g, '')); if (Number.isFinite(n)) out.add(Math.abs(r2(n))); }
  } catch { /* unreadable */ }
  return out;
}

function opens(f) {
  const buf = fs.readFileSync(f.path);
  if (f.ext === '.xlsx') { const w = X.readXlsx(buf); return { ok: w.sheets.length > 0 && w.sheets.some((s) => s.rows.length > 1), detail: `${w.sheets.length} sheet(s), ${w.sheets.reduce((n, s) => n + s.rows.length, 0)} rows` }; }
  if (f.ext === '.pdf') return { ok: buf.slice(0, 4).toString() === '%PDF' && buf.length > 500, detail: `${buf.length} bytes` };
  if (f.ext === '.csv') { const lines = buf.toString('utf8').split('\n').filter((l) => l.trim()); return { ok: lines.length > 1, detail: `${lines.length} lines` }; }
  if (['.md', '.txt', '.html'].includes(f.ext)) return { ok: buf.toString('utf8').trim().length > 40, detail: `${buf.length} bytes` };
  return { ok: buf.length > 0, detail: `${buf.length} bytes` };
}

const EVALUATORS = {
  /** Every deliverable (or the named one) opens and is not empty. */
  async export_opens({ dir, args }) {
    const files = deliverables(dir).filter((f) => !args.name || f.name === args.name);
    if (!files.length) return { pass: false, figures: {}, note: args.name ? `deliverable ${args.name} not found` : 'no deliverables written' };
    const res = files.map((f) => ({ name: f.name, ...opens(f) }));
    return { pass: res.every((x) => x.ok), figures: Object.fromEntries(res.map((x) => [x.name, x.detail])), note: res.filter((x) => !x.ok).map((x) => `${x.name} does not open or is empty`).join('; ') || null };
  },
  /** A deliverable exists (name or regex pattern). */
  async deliverable_exists({ dir, args }) {
    const files = deliverables(dir); const re = args.pattern ? new RegExp(args.pattern, 'i') : null;
    const hit = files.filter((f) => (args.name && f.name === args.name) || (re && re.test(f.name)) || (!args.name && !re && args.ext && f.ext === args.ext));
    return { pass: hit.length > 0, figures: { files: hit.map((f) => f.name) }, note: hit.length ? null : `no deliverable matching ${args.name || args.pattern || args.ext}` };
  },
  /** Row count of a deliverable or data file (first sheet, or --sheet) within bounds; header excluded. */
  async row_count({ dir, args, expect }) {
    const f = [...deliverables(dir), ...(fs.existsSync(path.join(dir, 'data')) ? fs.readdirSync(path.join(dir, 'data')).map((n) => ({ name: n, path: path.join(dir, 'data', n), ext: path.extname(n).toLowerCase() })) : [])].find((x) => x.name === args.file);
    if (!f) return { pass: false, figures: {}, note: `file ${args.file} not found` };
    let rows = 0;
    if (f.ext === '.xlsx') { const w = X.readXlsx(fs.readFileSync(f.path)); const s = args.sheet ? w.sheets.find((x) => x.name === args.sheet) : w.sheets[0]; rows = s ? Math.max(0, s.rows.length - 1) : 0; }
    else if (f.ext === '.csv') rows = Math.max(0, fs.readFileSync(f.path, 'utf8').split('\n').filter((l) => l.trim()).length - 1);
    else if (f.ext === '.json') { const j = JSON.parse(fs.readFileSync(f.path, 'utf8')); const arr = Array.isArray(j) ? j : j.rows || j.data || []; rows = Array.isArray(arr) ? arr.length : 0; }
    const e = expect || {};
    const ok = (e.min == null || rows >= e.min) && (e.max == null || rows <= e.max) && (e.equals == null || rows === e.equals);
    return { pass: ok, figures: { rows }, note: ok ? null : `rows=${rows}, expected ${JSON.stringify(e)}` };
  },
  /** Every subject entity appears in the deliverable (as a sheet name or a cell value). */
  async all_entities_covered({ req, dir, args }) {
    const names = (req.subject && (req.subject.businessNames || [])).filter(Boolean);
    const ids = (req.subject && (req.subject.businessIds || [])).filter(Boolean);
    if (!names.length && !ids.length) return { pass: false, figures: {}, note: 'the request has no subject entities to check' };
    const files = deliverables(dir).filter((f) => !args.file || f.name === args.file);
    const hay = [];
    for (const f of files) { try { if (f.ext === '.xlsx') { for (const s of X.readXlsx(fs.readFileSync(f.path)).sheets) { hay.push(s.name); for (const row of s.rows.slice(0, 2000)) for (const v of row) if (typeof v === 'string') hay.push(v); } } else if (['.csv', '.md', '.txt', '.html'].includes(f.ext)) hay.push(fs.readFileSync(f.path, 'utf8')); } catch { /* skip */ } }
    const text = hay.join('\n').toLowerCase();
    const missing = (names.length ? names : ids).filter((n) => !text.includes(String(n).toLowerCase()));
    return { pass: missing.length === 0, figures: { checked: names.length ? names : ids, missing }, note: missing.length ? `not found in the deliverable: ${missing.join(', ')}` : null };
  },
  /** Advisory: amounts in the deliverable that do not appear in any pulled data (computed figures must be reproduced by the Verifier). */
  async figures_in_data({ req, dir, args, expect }) {
    const data = R.dataNumbers(req.id);
    const files = deliverables(dir).filter((f) => !args.file || f.name === args.file);
    const uncited = [];
    let total = 0;
    for (const f of files) for (const n of numbersInDeliverable(f)) { if (n < 1000 && Number.isInteger(n)) continue; total += 1; if (!data.has(n)) uncited.push({ file: f.name, value: n }); }
    const limit = (expect && expect.maxUncited) ?? null;
    const pass = limit == null ? true : uncited.length <= limit;
    return { pass, advisory: limit == null, figures: { amounts: total, uncited: uncited.length, examples: uncited.slice(0, 12) }, note: uncited.length ? `${uncited.length} amount(s) not found in pulled data: the Verifier must reproduce each from receipted data or fail the request` : 'every amount traces to pulled data' };
  },
  /** At least n successful calls were receipted. */
  async receipts_min({ req, expect }) {
    const s = R.stats(R.list(req.id)); const min = (expect && expect.min) || 1;
    return { pass: s.ok >= min, figures: s, note: s.ok >= min ? null : `only ${s.ok} successful call(s), expected at least ${min}` };
  },
  /** Advisory: no call was refused by the map or the policy. */
  async no_refused_calls({ req }) {
    const s = R.stats(R.list(req.id));
    return { pass: s.refused === 0, advisory: true, figures: { refused: s.refused, failed: s.failed }, note: s.refused ? `${s.refused} call(s) refused (not in the map or denied by policy)` : null };
  },
  /** Every proposal with a journal entry balances; no proposal names a denied route. */
  async proposals_balanced({ req }) {
    const items = PR.load(req.id).items;
    const bad = items.filter((p) => p.entry && !PR.balanced(p.entry).ok).map((p) => p.id);
    return { pass: bad.length === 0, figures: { proposals: items.length, unbalanced: bad }, note: bad.length ? `unbalanced entries: ${bad.join(', ')}` : null };
  },
  /** A figure in the deliverable ties to Dime's own report for the subject and period. */
  async ties_to_report({ req, dir, args, expect, call }) {
    const route = REPORT_ROUTES[args.report]; if (!route) return { pass: false, figures: {}, note: `unknown report ${args.report}; known: ${Object.keys(REPORT_ROUTES).join(', ')}` };
    const businesses = args.businessId ? [args.businessId] : ((req.subject && req.subject.businessIds) || []);
    if (!businesses.length) return { pass: false, figures: {}, note: 'no businessId on the request subject' };
    const figs = {}; const misses = [];
    const have = new Set(); for (const f of deliverables(dir).filter((x) => !args.file || x.name === args.file)) for (const n of numbersInDeliverable(f)) have.add(n);
    for (const b of businesses) {
      const r = await call({ method: 'GET', path: route.path(b), query: route.args(args) });
      if (!r.ok) { misses.push(`${b}: report call failed (${r.status})`); continue; }
      const f = findFigure(r.json, (expect && expect.figure ? [expect.figure] : []).concat(route.figures));
      if (!f) { misses.push(`${b}: no figure among ${route.figures.join(', ')} in the report response`); continue; }
      const v = Math.abs(r2(f.value)); figs[b] = { [f.key]: f.value };
      if (!have.has(v)) misses.push(`${b}: ${f.key} = ${f.value} from Dime's ${args.report} is not in the deliverable`);
    }
    return { pass: misses.length === 0, figures: figs, note: misses.join('; ') || null };
  },
  /** Re-run the receipted read calls that saved a file and compare the set of numbers in the responses. */
  async figures_reproduce({ req, dir, expect, call }) {
    const rows = R.list(req.id).filter((r) => r.outFile && typeof r.status === 'number' && r.status < 300 && /^(GET|PATCH|POST)$/.test(r.method)).slice(0, (expect && expect.maxCalls) || 12);
    if (!rows.length) return { pass: false, figures: {}, note: 'no receipted calls with saved responses to reproduce' };
    const results = [];
    for (const r of rows) {
      let then; try { then = R.numbersIn(JSON.parse(fs.readFileSync(path.join(dir, r.outFile), 'utf8'))); } catch { results.push({ seq: r.seq, ok: false, note: 'saved file unreadable' }); continue; }
      const url = new URL(r.url || r.path, 'http://x'); const query = Object.fromEntries(url.searchParams.entries());
      const now = await call({ method: r.method, path: url.pathname, query: Object.keys(query).length ? query : null, body: r.body || null });
      if (!now.ok) { results.push({ seq: r.seq, ok: false, note: `re-call failed (${now.status})` }); continue; }
      const cur = R.numbersIn(now.json); let hit = 0; for (const n of then) if (cur.has(n)) hit += 1;
      const ratio = then.size ? hit / then.size : 1;
      results.push({ seq: r.seq, ok: ratio >= ((expect && expect.minOverlap) || 0.95), overlap: Math.round(ratio * 100) / 100, numbers: then.size });
    }
    return { pass: results.every((x) => x.ok), figures: { calls: results }, note: results.filter((x) => !x.ok).map((x) => `R-${x.seq}: ${x.note || `only ${Math.round(x.overlap * 100)}% of figures reproduced`}`).join('; ') || null };
  },
};

/** Run the evaluator-backed done items of a request. `call` performs Dime reads (injected so tests need no backend). */
async function runAll(req, { only = null, call } = {}) {
  const dir = T.artifactsDir(req.id);
  const items = [];
  for (const d of req.done || []) {
    if (!d.evaluator) continue;
    if (only && d.id !== only) continue;
    const name = String(d.evaluator).replace(/^check\./, '');
    const fn = EVALUATORS[name];
    if (!fn) { items.push({ id: d.id, evaluator: name, pass: false, figures: {}, note: `unknown evaluator ${name}` }); continue; }
    try {
      const res = await fn({ req, dir, args: d.args || {}, expect: d.expect || {}, call: call || defaultCall(req) });
      items.push({ id: d.id, evaluator: name, pass: Boolean(res.pass), advisory: Boolean(res.advisory), figures: res.figures || {}, note: res.note || null });
    } catch (e) { items.push({ id: d.id, evaluator: name, pass: false, figures: {}, note: `evaluator error: ${e.message}` }); }
  }
  const blocking = items.filter((i) => !i.pass && !i.advisory);
  return { at: new Date().toISOString(), items, pass: blocking.length === 0, failing: blocking.map((i) => i.id) };
}

function defaultCall(req) {
  const D = require('./dime');
  return async ({ method, path: p, query, body }) => {
    const r = await D.call({ backend: req.backend, method, path: p, query, body });
    R.append(req.id, { method, path: p, url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: process.env.LAB_RUN || 'check', purpose: 'done evaluator' });
    return r;
  };
}

const CATALOG = [
  { evaluator: 'export_opens', when: 'any deliverable file', args: '{ name? }' },
  { evaluator: 'deliverable_exists', when: 'a specific file must exist', args: '{ name | pattern | ext }' },
  { evaluator: 'row_count', when: 'a sheet or data file must have n rows', args: '{ file, sheet? } expect { min?, max?, equals? }' },
  { evaluator: 'all_entities_covered', when: 'multi-entity requests', args: '{ file? }' },
  { evaluator: 'figures_in_data', when: 'every report (advisory unless expect.maxUncited)', args: '{ file? } expect { maxUncited? }' },
  { evaluator: 'receipts_min', when: 'the work must have read Dime', args: 'expect { min }' },
  { evaluator: 'no_refused_calls', when: 'always (advisory)', args: '{}' },
  { evaluator: 'proposals_balanced', when: 'writes expected', args: '{}' },
  { evaluator: 'ties_to_report', when: 'a report total must equal Dime\'s own report', args: '{ report: profit_and_loss|balance_sheet|general_ledger|ar_aging|ap_aging, startDate?, endDate?, asOf?, businessId?, file? } expect { figure? }' },
  { evaluator: 'figures_reproduce', when: 'always for reports (the Verifier runs it)', args: 'expect { minOverlap?, maxCalls? }' },
];

module.exports = { EVALUATORS, runAll, CATALOG, REPORT_ROUTES, findFigure, numbersInDeliverable, deliverables, opens };
