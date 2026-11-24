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
  // live point-in-time TB from the ledger (refuses a locked period; the saved Financial is the record then)
  trial_balance: { path: (b) => `/api/v1/accountant/reports/trial-balance-asof/${b}`, args: (a) => ({ asOf: a.asOf || a.endDate || a.currentEnd }), figures: ['totalDebits', 'totalDebit', 'debitTotal', 'debit', 'totalCredits', 'credit'] },
};
const GL_ACCOUNT_ROUTE = { path: (b) => `/api/v1/accountant/reports/general-ledger-account-realtime/${b}`, args: (a) => ({ startDate: a.startDate, endDate: a.endDate, account: a.account }), figures: ['endingBalance', 'ending_balance', 'closingBalance', 'balance', 'beginningBalance', 'totalDebits', 'totalCredits'] };

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; if (typeof v === 'string' && /^-?\(?\$?[\d,]+(\.\d+)?\)?$/.test(v.trim())) { const n = Number(v.replace(/[$,()]/g, '')); return Number.isFinite(n) ? (/\(/.test(v) ? -n : n) : null; } return null; };
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

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

// ---------------------------------------------------------------- workbook helpers for the RD-2 evaluators (pure over parsed sheets)
/** The named deliverable, else the first xlsx deliverable. */
function pickWorkbook(dir, args = {}) {
  const files = deliverables(dir);
  const f = args.name ? files.find((x) => x.name === args.name) : files.find((x) => x.ext === '.xlsx');
  if (!f) return { error: args.name ? `deliverable ${args.name} not found` : 'no xlsx deliverable' };
  if (f.ext !== '.xlsx') return { error: `${f.name} is not a workbook` };
  try { return { file: f, wb: X.readXlsx(fs.readFileSync(f.path)) }; } catch (e) { return { error: `${f.name} does not open: ${e.message}` }; }
}
/** A data/<file>.json or deliverable file by name (with or without extension). */
function pickFile(dir, name) {
  const cands = [path.join(dir, 'data', name), path.join(dir, 'data', `${name}.json`), path.join(dir, 'deliverables', name), path.join(dir, name)];
  const p = cands.find((c) => fs.existsSync(c) && c.startsWith(dir));
  return p ? { name: path.basename(p), path: p, ext: path.extname(p).toLowerCase() } : null;
}
const sheetNamed = (wb, name) => wb.sheets.find((s) => String(s.name).trim().toLowerCase() === String(name).trim().toLowerCase()) || null;
const rowHas = (row, re) => (row || []).some((v) => typeof v === 'string' && re.test(v.trim()));
const nonEmpty = (row) => (row || []).some((v) => v != null && String(v).trim() !== '');
/** The header row of a sheet: the first row (within the first six) with at least two text cells and no numbers, else row 0. */
function headerRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i += 1) { const r = rows[i] || []; const texts = r.filter((v) => typeof v === 'string' && v.trim()).length; const nums = r.filter((v) => typeof v === 'number').length; if (texts >= 2 && nums === 0) return i; }
  return 0;
}
/** Table of a sheet: header cells and the data rows below it (blank rows and rows starting with "Total…" excluded from data; totals returned apart). */
function table(rows) {
  const h = headerRowIndex(rows); const header = (rows[h] || []).map((v) => str(v).trim());
  const data = []; const totals = [];
  for (const r of rows.slice(h + 1)) { if (!nonEmpty(r)) continue; if (typeof r[0] === 'string' && /^(grand\s+)?totals?\b/i.test(r[0].trim())) totals.push(r); else data.push(r); }
  return { headerIndex: h, header, data, totals };
}
const colsMatching = (header, re) => header.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);
/** Every string cell in every sheet of a workbook, or the text of a csv/md/txt/html deliverable. */
function textOf(f) {
  const out = [];
  try { if (f.ext === '.xlsx') { for (const s of X.readXlsx(fs.readFileSync(f.path)).sheets) { out.push(s.name); for (const row of s.rows) for (const v of row) if (typeof v === 'string') out.push(v); } } else if (['.csv', '.md', '.txt', '.html'].includes(f.ext)) out.push(fs.readFileSync(f.path, 'utf8')); } catch { /* unreadable */ }
  return out;
}
const JUDGEMENT_WORDS = ['fraud', 'stole', 'personal use', 'abuse', 'dishonest', 'lazy'];
const PLUMBING = [/\/api\//i, /\breceipts?\b/i, /\bendpoints?\b/i, /\btools?\b/i];

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

  // ---------------------------------------------------------------- RD-2 recipe evaluators
  /** Every row of the Exceptions sheet (or --sheet) of the named/first workbook has a value in a column headed id / ref / link / source. */
  async exceptions_have_source({ dir, args }) {
    const w = pickWorkbook(dir, args); if (w.error) return { pass: false, figures: {}, note: w.error };
    const sheet = sheetNamed(w.wb, args.sheet || 'Exceptions'); if (!sheet) return { pass: false, figures: {}, note: `${w.file.name} has no ${args.sheet || 'Exceptions'} sheet` };
    const t = table(sheet.rows); const cols = colsMatching(t.header, /id|ref|link|source/i);
    if (!cols.length) return { pass: false, figures: { header: t.header }, note: 'no column headed id, ref, link or source' };
    const missing = t.data.map((r, i) => ({ row: t.headerIndex + 2 + i, ok: cols.some((c) => r[c] != null && String(r[c]).trim() !== '') })).filter((x) => !x.ok).map((x) => x.row);
    return { pass: missing.length === 0, figures: { rows: t.data.length, sourceColumns: cols.map((c) => t.header[c]), rowsWithoutSource: missing.slice(0, 20) }, note: missing.length ? `${missing.length} exception row(s) cite no source (rows ${missing.slice(0, 8).join(', ')})` : (t.data.length ? null : 'no exception rows') };
  },
  /** A rollforward sheet ties: opening + additions − reductions = closing per row (0.005) and the totals row equals the column sums. */
  async rollforward_ties({ dir, args }) {
    let rows;
    if (args.file && /\.json$/i.test(args.file)) { const f = pickFile(dir, args.file); if (!f) return { pass: false, figures: {}, note: `file ${args.file} not found` }; const j = JSON.parse(fs.readFileSync(f.path, 'utf8')); rows = Array.isArray(j) ? j : j.rows || []; if (rows.length && !Array.isArray(rows[0])) { const keys = Object.keys(rows[0]); rows = [keys, ...rows.map((r) => keys.map((k) => r[k]))]; } }
    else { const w = pickWorkbook(dir, { name: args.file || args.name }); if (w.error) return { pass: false, figures: {}, note: w.error }; const sheet = args.sheet ? sheetNamed(w.wb, args.sheet) : (w.wb.sheets.find((s) => { const h = table(s.rows).header; return colsMatching(h, /^open/i).length && colsMatching(h, /^(clos|end)/i).length; }) || null); if (!sheet) return { pass: false, figures: {}, note: 'no sheet with Opening and Closing columns' }; rows = sheet.rows; }
    const t = table(rows);
    const col = (re) => colsMatching(t.header, re)[0];
    const o = col(/^open/i); const a = col(/^(add|incr)/i); const r = col(/^(red|decr|disp|remov)/i); const c = col(/^(clos|end)/i);
    if ([o, a, r, c].some((x) => x == null)) return { pass: false, figures: { header: t.header }, note: 'needs Opening, Additions/Increases, Reductions/Decreases and Closing columns' };
    const bad = []; const sums = { o: 0, a: 0, r: 0, c: 0 };
    t.data.forEach((row, i) => { const v = [o, a, r, c].map((k) => num(row[k]) || 0); sums.o += v[0]; sums.a += v[1]; sums.r += v[2]; sums.c += v[3]; if (Math.abs(v[0] + v[1] - v[2] - v[3]) > 0.005) bad.push({ row: t.headerIndex + 2 + i, difference: r2(v[0] + v[1] - v[2] - v[3]) }); });
    const tot = t.totals[0]; let totalsNote = null;
    if (!tot) { if (args.totalsRow !== false) totalsNote = 'no totals row'; } else { const tv = [o, a, r, c].map((k) => num(tot[k]) || 0); const off = [['opening', sums.o, tv[0]], ['additions', sums.a, tv[1]], ['reductions', sums.r, tv[2]], ['closing', sums.c, tv[3]]].filter(([, s, v]) => Math.abs(s - v) > 0.005); if (off.length) totalsNote = `totals row differs: ${off.map(([n, s, v]) => `${n} ${r2(v)} vs sum ${r2(s)}`).join(', ')}`; }
    const pass = bad.length === 0 && !totalsNote;
    return { pass, figures: { rows: t.data.length, opening: r2(sums.o), additions: r2(sums.a), reductions: r2(sums.r), closing: r2(sums.c), rowsOff: bad.slice(0, 20) }, note: [bad.length ? `${bad.length} row(s) do not roll forward` : null, totalsNote].filter(Boolean).join('; ') || null };
  },
  /** The house deliverable shape: Exceptions first with Count and Total on the first two rows, a Tie-out with Difference 0.00, and no plumbing words. */
  async deliverable_standard({ dir, args }) {
    const w = pickWorkbook(dir, args); if (w.error) return { pass: false, figures: {}, note: w.error };
    const problems = []; const first = w.wb.sheets[0];
    if (!first || String(first.name).trim().toLowerCase() !== 'exceptions') problems.push(`first sheet is ${first ? first.name : 'missing'}, not Exceptions`);
    const top = (first ? first.rows.slice(0, 2) : []);
    const labelWithNumber = (re) => top.some((row) => (row || []).some((v, i) => typeof v === 'string' && re.test(v.trim()) && (row.slice(i + 1).some((x) => num(x) != null))));
    if (!labelWithNumber(/^count\b/i)) problems.push('rows 1-2 of Exceptions lack a Count label with a number');
    if (!labelWithNumber(/^total\b/i)) problems.push('rows 1-2 of Exceptions lack a Total label with a number');
    const tieSheet = w.wb.sheets.find((s) => /tie-?out/i.test(s.name));
    const tieRows = tieSheet ? tieSheet.rows : (() => { for (const s of w.wb.sheets) { const i = s.rows.findIndex((row) => rowHas(row, /tie-?out/i)); if (i >= 0) return s.rows.slice(i); } return null; })();
    if (!tieRows) problems.push('no Tie-out sheet or block');
    else { const diffRow = tieRows.find((row) => rowHas(row, /^difference\b/i)); if (!diffRow) problems.push('Tie-out has no Difference cell'); else { const i = diffRow.findIndex((v) => typeof v === 'string' && /^difference\b/i.test(v.trim())); const v = diffRow.slice(i + 1).map(num).find((x) => x != null); if (v == null) problems.push('Difference has no number'); else if (Math.abs(v) > 0.005) problems.push(`Difference is ${r2(v)}, not 0.00`); } }
    const leaks = [];
    for (const s of w.wb.sheets) for (const row of s.rows) for (const v of row) if (typeof v === 'string') for (const re of PLUMBING) if (re.test(v)) { leaks.push(`${s.name}: "${v.slice(0, 60)}"`); break; }
    if (leaks.length) problems.push(`${leaks.length} cell(s) carry plumbing words (/api/, receipt, endpoint, tool): ${leaks.slice(0, 3).join('; ')}`);
    return { pass: problems.length === 0, figures: { sheets: w.wb.sheets.map((s) => s.name), leaks: leaks.length }, note: problems.join('; ') || null };
  },
  /** The deliverable's stated total ties to Dime's single-account general ledger (ending balance by default) for the account and dates. */
  async ties_to_gl_account({ req, dir, args, expect, call }) {
    if (!args.account || !args.startDate || !args.endDate) return { pass: false, figures: {}, note: 'needs args account, startDate and endDate' };
    const businesses = args.businessId ? [args.businessId] : ((req.subject && req.subject.businessIds) || []);
    if (!businesses.length) return { pass: false, figures: {}, note: 'no businessId on the request subject' };
    const have = new Set(); for (const f of deliverables(dir).filter((x) => !(args.file || args.name) || x.name === (args.file || args.name))) for (const n of numbersInDeliverable(f)) have.add(n);
    const figs = {}; const misses = [];
    for (const b of businesses) {
      const r = await call({ method: 'GET', path: GL_ACCOUNT_ROUTE.path(b), query: GL_ACCOUNT_ROUTE.args(args) });
      if (!r.ok) { misses.push(`${b}: general ledger call failed (${r.status})`); continue; }
      const f = findFigure(r.json, (expect && expect.figure ? [expect.figure] : []).concat(GL_ACCOUNT_ROUTE.figures));
      if (!f) { misses.push(`${b}: no balance figure in the response`); continue; }
      const v = Math.abs(r2(f.value)); figs[b] = { [f.key]: f.value };
      if (!have.has(v)) misses.push(`${b}: ${f.key} = ${f.value} for account ${args.account} is not in the deliverable`);
    }
    return { pass: misses.length === 0, figures: figs, note: misses.join('; ') || null };
  },
  /** No two proposals name the same vendor, amount and period. */
  async no_double_count({ req }) {
    const items = PR.load(req.id).items;
    const vendorOf = (p) => { const b = p.body || {}; return str(p.vendor || b.vendor || b.vendorName || b.vendor_name || b.vendorId || b.vendor_id || b.name).trim().toLowerCase(); };
    const periodOf = (p) => { const b = p.body || {}; const d = p.period || b.period || b.date || b.txn_date || b.transactionDate || b.dueDate || ''; return String(d).slice(0, 7); };
    const seen = new Map(); const dups = [];
    for (const p of items) { const v = vendorOf(p); const a = p.amount ?? PR.amountOf(p.body, p.entry); if (!v || a == null) continue; const k = `${v}|${r2(a)}|${periodOf(p)}`; if (seen.has(k)) dups.push({ a: seen.get(k), b: p.id, key: k }); else seen.set(k, p.id); }
    return { pass: dups.length === 0, figures: { proposals: items.length, duplicates: dups }, note: dups.length ? `${dups.length} proposal pair(s) count the same vendor, amount and period: ${dups.map((d) => `${d.a}/${d.b}`).join(', ')}` : null };
  },
  /** A data/<file>.json written by compute column_map has no ambiguous columns and no missing required ones. */
  async column_headers_mapped({ dir, args }) {
    if (!args.file) return { pass: false, figures: {}, note: 'needs args.file (data/<name>.json from compute column_map)' };
    const f = pickFile(dir, args.file); if (!f) return { pass: false, figures: {}, note: `file ${args.file} not found` };
    let j; try { j = JSON.parse(fs.readFileSync(f.path, 'utf8')); } catch (e) { return { pass: false, figures: {}, note: `${f.name} is not JSON: ${e.message}` }; }
    const ambiguous = new Set((Array.isArray(j.ambiguous) ? j.ambiguous : []).map((x) => str(x.name || x.column || x)));
    const missing = new Set((Array.isArray(j.missing) ? j.missing : []).map((x) => str(x.name || x.column || x)));
    const required = new Set((Array.isArray(j.required) ? j.required : []).map(str));
    const entries = Array.isArray(j.columns) ? j.columns : (j.mapping && typeof j.mapping === 'object' && !Array.isArray(j.mapping) ? Object.entries(j.mapping).map(([name, v]) => ({ name, ...(v && typeof v === 'object' ? v : { to: v }) })) : (Array.isArray(j.mapping) ? j.mapping : []));
    for (const e of entries) { if (!e) continue; const name = str(e.name || e.column || e.header); const status = str(e.status).toLowerCase(); if (e.required) required.add(name); if (status === 'ambiguous') ambiguous.add(name); if (status === 'missing') missing.add(name); }
    const missingRequired = [...missing].filter((m) => !required.size || required.has(m));
    const pass = ambiguous.size === 0 && missingRequired.length === 0;
    return { pass, figures: { columns: entries.length, ambiguous: [...ambiguous], missing: [...missing], required: [...required] }, note: pass ? null : [ambiguous.size ? `ambiguous: ${[...ambiguous].join(', ')}` : null, missingRequired.length ? `missing required: ${missingRequired.join(', ')}` : null].filter(Boolean).join('; ') };
  },
  /** A named figure in a data json, or the exception count of a workbook sheet, lies within expect.min/max (expect.equals also allowed). */
  async figure_in_range({ dir, args, expect }) {
    let value = null; let what;
    if (args.file) {
      const f = pickFile(dir, args.file); if (!f) return { pass: false, figures: {}, note: `file ${args.file} not found` };
      if (f.ext === '.json') { const j = JSON.parse(fs.readFileSync(f.path, 'utf8')); if (!args.figure) return { pass: false, figures: {}, note: 'needs args.figure for a json file' }; const direct = args.figure.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j); const found = typeof direct === 'number' ? { key: args.figure, value: direct } : findFigure(j, [args.figure]); if (!found) return { pass: false, figures: {}, note: `figure ${args.figure} not found in ${f.name}` }; value = found.value; what = `${f.name}:${found.key}`; }
      else if (f.ext === '.xlsx') { const wb = X.readXlsx(fs.readFileSync(f.path)); const s = sheetNamed(wb, args.sheet || 'Exceptions') || wb.sheets[0]; value = table(s.rows).data.length; what = `${f.name}:${s.name} rows`; }
      else return { pass: false, figures: {}, note: `${f.name}: only json and xlsx are read` };
    } else {
      const w = pickWorkbook(dir, args); if (w.error) return { pass: false, figures: {}, note: w.error };
      const s = sheetNamed(w.wb, args.sheet || 'Exceptions'); if (!s) return { pass: false, figures: {}, note: `${w.file.name} has no ${args.sheet || 'Exceptions'} sheet` };
      value = table(s.rows).data.length; what = `${w.file.name}:${s.name} rows`;
    }
    const e = expect || {}; const lim = (x) => (x == null || x === '' ? null : num(x));
    if ([e.min, e.max, e.equals].some((x) => x != null && lim(x) == null)) return { pass: false, figures: { [what]: value }, note: `expect holds a non-numeric bound (${JSON.stringify(e)}); was a {{setup.…}} token left unfilled?` };
    const ok = (lim(e.min) == null || value >= lim(e.min)) && (lim(e.max) == null || value <= lim(e.max)) && (lim(e.equals) == null || Math.abs(value - lim(e.equals)) <= 0.005);
    return { pass: ok, advisory: Boolean(e.advisory), figures: { [what]: value }, note: ok ? null : `${what} = ${value}, expected ${JSON.stringify({ min: e.min, max: e.max, equals: e.equals })}` };
  },
  /** The deliverables contain none of the judgement words (default: fraud, stole, personal use, abuse, dishonest, lazy). */
  async no_judgement_words({ dir, args }) {
    const words = (Array.isArray(args.words) && args.words.length ? args.words : JUDGEMENT_WORDS).map((w) => String(w).toLowerCase());
    const files = deliverables(dir).filter((f) => !args.name || f.name === args.name);
    if (!files.length) return { pass: false, figures: {}, note: args.name ? `deliverable ${args.name} not found` : 'no deliverables written' };
    const hits = [];
    for (const f of files) for (const t of textOf(f)) { const low = t.toLowerCase(); for (const w of words) if (new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(low)) hits.push({ file: f.name, word: w, text: t.slice(0, 80) }); }
    return { pass: hits.length === 0, figures: { files: files.map((f) => f.name), hits: hits.slice(0, 20) }, note: hits.length ? `${hits.length} judgement word(s) found: ${[...new Set(hits.map((h) => h.word))].join(', ')}` : null };
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
      items.push({ id: d.id, evaluator: name, pass: Boolean(res.pass), advisory: Boolean(res.advisory) || d.advisory === true, figures: res.figures || {}, note: res.note || null });
    } catch (e) { items.push({ id: d.id, evaluator: name, pass: false, figures: {}, note: `evaluator error: ${e.message}` }); }
  }
  const blocking = items.filter((i) => !i.pass && !i.advisory);
  return { at: new Date().toISOString(), items, pass: blocking.length === 0, failing: blocking.map((i) => i.id) };
}

function defaultCall(req) {
  const D = require('./dime');
  return async ({ method, path: p, query, body }) => {
    const r = await D.call({ backend: req.backend, request: req, method, path: p, query, body });
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
  // RD-2 recipe evaluators
  { evaluator: 'exceptions_have_source', when: 'every exception row must cite an id, ref, link or source', args: '{ name?, sheet? (default Exceptions) }' },
  { evaluator: 'rollforward_ties', when: 'a schedule with Opening, Additions, Reductions, Closing columns and a totals row', args: '{ file | name, sheet?, totalsRow? }' },
  { evaluator: 'deliverable_standard', when: 'every recipe workbook: Exceptions first with Count and Total, a Tie-out with Difference 0.00, no plumbing words', args: '{ name? }' },
  { evaluator: 'ties_to_gl_account', when: 'a schedule total must equal one GL account\'s balance in Dime', args: '{ account, startDate, endDate, businessId?, file? } expect { figure?: endingBalance|beginningBalance|totalDebits|totalCredits }' },
  { evaluator: 'no_double_count', when: 'proposals were written (accruals, bills)', args: '{}' },
  { evaluator: 'column_headers_mapped', when: 'an attachment was mapped with compute column_map', args: '{ file: data/<name>.json }' },
  { evaluator: 'figure_in_range', when: 'a figure or the exception count must sit in a range', args: '{ file?, figure?, sheet?, name? } expect { min?, max?, equals?, advisory? }' },
  { evaluator: 'no_judgement_words', when: 'the deliverable flags people\'s spend or conduct', args: '{ name?, words? }' },
];

module.exports = { EVALUATORS, runAll, CATALOG, REPORT_ROUTES, GL_ACCOUNT_ROUTE, findFigure, numbersInDeliverable, deliverables, opens, table, headerRowIndex };
