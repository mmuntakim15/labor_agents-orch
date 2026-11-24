'use strict';
// The recipe library (RD-2). A recipe is a versioned JSON file in recipes/
// that the Intake and Planner read before the request text: kind, worker,
// done items, inputs, setup questions, deliverable shape, trigger and budget.
// Everything here is offline and pure apart from reading the folder; the
// matcher is a weighted token overlap (no model), the Intake agent confirms.
//
//   load(id, version?)      one recipe (recipes/<id>.json, or recipes/<id>.v<n>.json for an older version)
//   current()               { R01: recipe, … } newest version per id
//   validate(recipe)        { ok, errors, warnings }
//   match(text, { recipes, limit })  [{ id, score }] best first, score 0..1
//   library()               the compact array the API stores for the picker (recipes, then candidates with learnedFrom/used)
//   writeLibraryJson()      knowledge/generated/library.json
//
// Candidates (FR-37): a delivered general-lane request is compiled into
// recipes/candidates/cand-<slug>.json (same schema, candidate: true, version 0,
// no trigger.default) plus a frozen eval case; the matcher sees it at once.
//   compile(requestId)                  → { ok, candidate, file, caseDir } (or { ok: false, errors })
//   recordUse(candId, requestId, bizId) another request followed the candidate
//   recordEvalReport(name, result)      evals/reports/<name>.json, written by `lab eval`
//   promote(candId, { by, cron, nextId }) → recipes/R<nn>.json v1; refuses unless used >= 2 and the eval report passed
//   discard(candId, by)                 → recipes/candidates/.discarded/
// LAB_RECIPES_DIR, LAB_CANDIDATES_DIR and LAB_EVALS_DIR point tests at a sandbox.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'recipes');
const CANDIDATES = path.join(DIR, 'candidates');
const EVALS = path.join(ROOT, 'evals');
const LIBRARY_FILE = path.join(ROOT, 'knowledge', 'generated', 'library.json');
function recipesDir() { return process.env.LAB_RECIPES_DIR || DIR; }
function candidatesDir() { return process.env.LAB_CANDIDATES_DIR || (process.env.LAB_RECIPES_DIR ? path.join(process.env.LAB_RECIPES_DIR, 'candidates') : CANDIDATES); }
function evalsDir() { return process.env.LAB_EVALS_DIR || EVALS; }
function reportsDir() { return path.join(evalsDir(), 'reports'); }

const pipeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pipeline.json'), 'utf8'));
const KINDS = pipeline.kinds;
const { WORKERS } = require('./plan');

const GROUPS = {
  1: 'Zero-touch answers', 2: 'Reconciliation and investigation', 3: 'Close and workpapers', 4: 'Reporting and treasury',
  5: 'Accounting research and judgment', 6: 'Gated changes', 7: 'Recurring monitoring',
};
/** Period words a recipe may use; `cadence` is the word the library shows when the trigger gives none. The dates tool resolves the actual boundaries at run time. */
const PERIOD_RULES = {
  last_closed_month: { cadence: 'month end', text: 'the last closed month (the most recent month whose period is locked, else the month before the current one)' },
  closing_month: { cadence: 'weekly during close', text: 'the month being closed (the month before the current one)' },
  last_week: { cadence: 'weekly', text: 'the seven days ending yesterday' },
  prior_quarter: { cadence: 'quarterly', text: 'the last complete calendar quarter' },
  prior_year: { cadence: 'year end', text: 'the last complete calendar year' },
  year_to_date: { cadence: 'month end', text: 'January 1 of the current year to the end of the last closed month' },
  business_day: { cadence: 'each business day', text: 'the previous business day' },
  current_month: { cadence: 'monthly', text: 'the current calendar month to date' },
};
const TOOLS = ['map', 'dime', 'files', 'export', 'check', 'compute', 'sandbox'];
const SETUP_TYPES = ['accounts', 'text', 'list', 'number', 'boolean', 'date'];
const INPUT_SOURCES = ['connection', 'dime', 'standing', 'document'];
const CEILINGS = ['L4', 'L3-policy', 'L3-pending'];
const CRON = /^(\S+\s+){4}\S+$/;

// ---------------------------------------------------------------- files
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function recipeFiles(dir = recipesDir()) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter((f) => /^R\d{2}(\.v\d+)?\.json$/.test(f)).sort().map((f) => path.join(dir, f)); }
function candidateFiles() { const d = candidatesDir(); if (!fs.existsSync(d)) return []; return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(d, f)); }

function load(id, version = null) {
  const safe = String(id || '').trim();
  if (/^cand-/.test(safe)) return loadCandidate(safe); // a matched candidate is adopted like a recipe (version 0, never scheduled)
  if (!/^R\d{2}$/.test(safe)) throw new Error(`bad recipe id ${id}`);
  const files = recipeFiles().filter((p) => path.basename(p).startsWith(`${safe}.`));
  if (!files.length) throw new Error(`recipe ${safe} not found`);
  const all = files.map(readJson);
  if (version == null) return all.sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  const hit = all.find((r) => Number(r.version) === Number(version));
  if (!hit) throw new Error(`recipe ${safe} version ${version} not found (have ${all.map((r) => r.version).join(', ')})`);
  return hit;
}

/** Every recipe in recipes/ keyed by id, newest version wins. */
function current() {
  const out = {};
  for (const p of recipeFiles()) { const r = readJson(p); if (!r || !r.id) continue; if (!out[r.id] || (r.version || 0) > (out[r.id].version || 0)) out[r.id] = r; }
  return out;
}
/** Candidates (FR-37): same schema plus candidate:true, learnedFrom[], used, entities[]; sorted by id. */
function candidates() { return candidateFiles().map(readJson).filter((r) => r && r.id).sort((a, b) => String(a.id).localeCompare(String(b.id))); }
function candidateFile(id) { const safe = String(id || '').trim(); if (!/^cand-[a-z0-9-]+$/.test(safe)) throw new Error(`bad candidate id ${id}`); return path.join(candidatesDir(), `${safe}.json`); }
function loadCandidate(id) { const p = candidateFile(id); if (!fs.existsSync(p)) throw new Error(`candidate ${id} not found`); return readJson(p); }

// ---------------------------------------------------------------- validation
function validate(recipe) {
  const errors = []; const warnings = [];
  const e = (m) => errors.push(m);
  if (!recipe || typeof recipe !== 'object') return { ok: false, errors: ['recipe is not an object'], warnings };
  const isCandidate = recipe.candidate === true;
  if (!isCandidate && !/^R\d{2}$/.test(String(recipe.id))) e(`id must match R\\d{2} (got ${recipe.id})`);
  if (isCandidate && !/^cand-[a-z0-9-]+$/.test(String(recipe.id))) e(`a candidate id must match cand-<slug> (got ${recipe.id})`);
  if (isCandidate && recipe.version === 0) { /* a candidate is version 0 until promoted */ } else if (!Number.isInteger(recipe.version) || recipe.version < 1) e('version must be a positive integer');
  if (isCandidate) {
    if (!Array.isArray(recipe.learnedFrom) || !recipe.learnedFrom.length || !recipe.learnedFrom.every((x) => /^REQ-\d+$/.test(String(x)))) e('a candidate names the requests it was learned from (learnedFrom: [REQ-n])');
    if (!Number.isInteger(recipe.used) || recipe.used < 1) e('a candidate carries used >= 1');
    if (!Array.isArray(recipe.entities)) e('a candidate carries entities[]');
  }
  if (!Number.isInteger(recipe.group) || recipe.group < 1 || recipe.group > 7) e('group must be 1..7');
  if (!recipe.title || typeof recipe.title !== 'string') e('title is required');
  if (!recipe.prompt || typeof recipe.prompt !== 'string') e('prompt is required');
  if (!KINDS.includes(recipe.kind)) e(`kind must be one of ${KINDS.join(', ')}`);
  if (!WORKERS.includes(recipe.worker)) e(`worker must be one of ${WORKERS.join(', ')}`);
  const t = recipe.trigger;
  if (!t || typeof t !== 'object') e('trigger {default, periodRule, event} is required');
  else {
    if (!(t.default === null || (typeof t.default === 'string' && CRON.test(t.default.trim())))) e('trigger.default must be a five-field cron string or null');
    if (isCandidate && t.default) e('a candidate never carries trigger.default');
    if (!PERIOD_RULES[t.periodRule]) e(`trigger.periodRule must be one of ${Object.keys(PERIOD_RULES).join(', ')}`);
    if (!(t.event === null || typeof t.event === 'string')) e('trigger.event must be a string or null');
    if (t.cadence != null && typeof t.cadence !== 'string') e('trigger.cadence must be a string when given');
  }
  if (!Array.isArray(recipe.setup)) e('setup must be an array');
  else recipe.setup.forEach((s, i) => {
    if (!s || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(String(s.key || ''))) e(`setup[${i}] needs a camelCase key`);
    if (!s || !s.q) e(`setup[${i}] needs a question q`);
    if (!s || !SETUP_TYPES.includes(s.type)) e(`setup[${i}] type must be one of ${SETUP_TYPES.join(', ')}`);
    if (!s || !['*', 'recipe'].includes(s.scope)) e(`setup[${i}] scope must be '*' or 'recipe'`);
  });
  if (!Array.isArray(recipe.inputs)) e('inputs must be an array');
  else recipe.inputs.forEach((x, i) => {
    if (!x || !x.name) e(`inputs[${i}] needs a name`);
    if (!x || !PERIOD_RULES[x.periodRule]) e(`inputs[${i}] periodRule must be one of ${Object.keys(PERIOD_RULES).join(', ')}`);
    if (!x || !INPUT_SOURCES.includes(x.source)) e(`inputs[${i}] source must be one of ${INPUT_SOURCES.join(', ')}`);
    if (x && x.source === 'connection' && !x.connection) e(`inputs[${i}] names no connection`);
    if (x && ['document', 'standing'].includes(x.source) && !(Array.isArray(x.acceptedTypes) && x.acceptedTypes.length)) e(`inputs[${i}] needs acceptedTypes[]`);
    if (x && x.optional != null && typeof x.optional !== 'boolean') e(`inputs[${i}] optional must be boolean`);
    if (x && x.maxAgeDays != null && !(Number(x.maxAgeDays) > 0)) e(`inputs[${i}] maxAgeDays must be positive`);
  });
  const DN = require('./done');
  if (!Array.isArray(recipe.done) || !recipe.done.length) e('done must be a non-empty array');
  else {
    const ids = new Set();
    recipe.done.forEach((d, i) => {
      if (!d || !d.id || !d.text) e(`done[${i}] needs id and text`);
      if (d && d.id) { if (ids.has(d.id)) e(`done[${i}] id ${d.id} repeats`); ids.add(d.id); }
      if (d && d.evaluator && !DN.EVALUATORS[String(d.evaluator).replace(/^check\./, '')]) e(`done[${i}] evaluator ${d.evaluator} does not exist`);
      if (d && d.args != null && typeof d.args !== 'object') e(`done[${i}] args must be an object`);
      if (d && d.expect != null && typeof d.expect !== 'object') e(`done[${i}] expect must be an object`);
    });
    if (!recipe.done.some((d) => d && d.evaluator)) e('at least one done item must be code-judged (evaluator)');
  }
  if (!Array.isArray(recipe.writes)) e('writes must be an array');
  else recipe.writes.forEach((w, i) => {
    if (!w || !w.kind || !w.route) e(`writes[${i}] needs kind and route`);
    if (!w || !Array.isArray(w.tierRules) || !w.tierRules.length) e(`writes[${i}] needs tierRules[]`);
    else w.tierRules.forEach((r, j) => { if (!r || !r.when || !['A', 'B', 'C', 'human'].includes(r.tier)) e(`writes[${i}].tierRules[${j}] needs when and tier A|B|C|human`); });
  });
  if (Array.isArray(recipe.writes) && recipe.writes.length && !['data_task', 'change_request'].includes(recipe.kind)) warnings.push('writes on a read-only kind');
  if (!Array.isArray(recipe.deliverables) || !recipe.deliverables.length) e('deliverables must be a non-empty array');
  else recipe.deliverables.forEach((d, i) => {
    if (!d || !d.name) e(`deliverables[${i}] needs a name`);
    // a workbook names its sheets; a memo, csv or pdf deliverable carries sheets: []
    if (!d || !Array.isArray(d.sheets) || (!d.sheets.length && /\.xlsx$/i.test(String(d.name || '')))) e(`deliverables[${i}] needs sheets[]`);
    else if (/\.xlsx$/i.test(d.name) && d.sheets[0] !== 'Exceptions') warnings.push(`deliverables[${i}] first sheet is ${d.sheets[0]}, the standard is Exceptions`);
  });
  if (!CEILINGS.includes(recipe.autonomyCeiling)) e(`autonomyCeiling must be one of ${CEILINGS.join(', ')}`);
  if (typeof recipe.restrictedData !== 'boolean') e('restrictedData must be boolean');
  if (!(Number(recipe.budgetUsd) > 0)) e('budgetUsd must be a positive number');
  if (!Array.isArray(recipe.tools) || !recipe.tools.length) e('tools must be a non-empty array');
  else for (const x of recipe.tools) if (!TOOLS.includes(x)) e(`tool ${x} is not one of ${TOOLS.join(', ')}`);
  if (recipe.compute != null) {
    if (!Array.isArray(recipe.compute) || recipe.compute.some((v) => !/^[a-z][a-z0-9_]*$/.test(String(v)))) e('compute must be an array of verb names');
    else if (recipe.compute.length && !(recipe.tools || []).includes('compute')) e('compute verbs are named but tools lacks compute');
    else if (recipe.compute.length) { try { const have = new Set(require('./compute').list().map((v) => v.name)); for (const v of recipe.compute) if (!have.has(v)) warnings.push(`compute verb ${v} is not built yet`); } catch { /* registry unavailable */ } }
  }
  if (recipe.keywords != null && !(Array.isArray(recipe.keywords) && recipe.keywords.every((k) => typeof k === 'string'))) e('keywords must be an array of strings');
  if (!Array.isArray(recipe.evals)) e('evals must be an array');
  else for (const x of recipe.evals) if (typeof x !== 'string' || !/^evals\/cases\//.test(x)) e(`evals entry ${x} must be a path under evals/cases/`);
  return { ok: errors.length === 0, errors, warnings };
}

/** Validate every recipe on disk (recipes and candidates); for `lab recipes validate` and doctor. */
function validateAll() {
  const out = [];
  for (const p of [...recipeFiles(), ...candidateFiles()]) {
    let r = null; let v;
    try { r = readJson(p); v = validate(r); } catch (err) { v = { ok: false, errors: [err.message], warnings: [] }; }
    out.push({ file: path.relative(ROOT, p), id: r && r.id, version: r && r.version, ...v });
  }
  return { ok: out.every((x) => x.ok), items: out };
}

// ---------------------------------------------------------------- matcher
const STOP = new Set(('a an the of to in for on at by with and or but is are be been was were this that these those which what who whom how when where ' +
  'show list find identify give get me my our we you your i it its as from into each every all any some no not has have had do does did than then so if ' +
  'please can could would should will there their them they he she his her also just only about over under per via versus vs using use used').split(' '));
// Words that name the subject of a request (which entity, which period) rather than the ask. Dropped from the request side of match().
const SUBJECT_STOP = new Set(('entity entities business businesses client clients company co inc llc ltd corp plc llp period periods month months year years quarter quarters week weeks ' +
  'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
  'fy ytd q1 q2 q3 q4 2024 2025 2026 2027 2028 asof as of ending ended').split(' ').map((w) => w.trim()).filter(Boolean));
const CANDIDATE_DISCOUNT = 0.85;
const SYNONYMS = { old: 'age', aged: 'age', aging: 'age', ageing: 'age', stale: 'age', outstand: 'open', unmatch: 'open', unreconcil: 'reconcil', uncategor: 'categor', dupe: 'duplic', dup: 'duplic', bill: 'invoic', supplier: 'vendor', payabl: 'ap', receivabl: 'ar', credit: 'card', expens: 'expens', spend: 'expens', cost: 'expens' };

function stem(w) {
  let s = w;
  if (s.length >= 4) {
    if (s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
    else if (s.endsWith('sses')) s = s.slice(0, -2);
    else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  }
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ly')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('er')) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return SYNONYMS[s] || s;
}

/** Pure: lower-case, strip punctuation, drop stop words, stem-lite. Numbers are kept. */
function tokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(stem).filter((w) => w.length > 1);
}

/** Pure: the weighted token profile of one recipe (title 3, prompt 2, keywords 2, group name 1). */
function profile(recipe) {
  const w = new Map();
  const add = (text, weight) => { for (const t of tokens(text)) w.set(t, Math.max(w.get(t) || 0, weight)); };
  add(recipe.title, 3); add(recipe.prompt, 2); add((recipe.keywords || []).join(' '), 2); add(GROUPS[recipe.group] || '', 1);
  return w;
}

/**
 * Pure given `recipes`: [{ id, score }] best first. Score = 0.75 × how much of the request the recipe covers
 * (idf-weighted) + 0.25 × how much of the recipe the request covers. Recipes first, then candidates.
 */
function match(text, { recipes = null, limit = 5 } = {}) {
  const list = recipes ? (Array.isArray(recipes) ? recipes : Object.values(recipes)) : [...Object.values(current()), ...candidates()];
  // Subject words name WHICH books and WHEN, not WHAT is asked: they are dropped from the request side so that
  // "…for Acme Dental, November 2026" matches the same recipe as the bare ask.
  const q = new Set(tokens(text).filter((t) => !SUBJECT_STOP.has(t)));
  if (!q.size || !list.length) return [];
  const profiles = list.map((r) => ({ id: r.id, p: profile(r) }));
  const df = new Map(); for (const { p } of profiles) for (const t of p.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = profiles.length;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  // Request words no recipe knows (an entity name, "RD-2 Seed Co", a period, a person) are the subject, not the
  // ask: they carry no weight, so "…? Entity: Acme Dental." matches as well as the bare library prompt.
  let qMass = 0; for (const t of q) qMass += df.has(t) ? idf(t) : 0;
  const out = [];
  for (const { id, p } of profiles) {
    let covered = 0; let hit = 0; let rMass = 0;
    for (const [t, w] of p) { const v = w * idf(t); rMass += v; if (q.has(t)) { hit += v; covered += idf(t); } }
    if (!hit) continue;
    const coverage = qMass ? covered / qMass : 0; const specificity = rMass ? hit / rMass : 0;
    let score = 0.75 * coverage + 0.25 * specificity;
    // a learned candidate is a looser profile (a whole request body), so it is discounted and never adopted over a library recipe below the adoption line
    if (/^cand-/.test(String(id))) score *= CANDIDATE_DISCOUNT;
    out.push({ id, score: Math.round(score * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, limit);
}

// ---------------------------------------------------------------- library
function cadenceOf(recipe) { const t = recipe.trigger || {}; return t.cadence || (PERIOD_RULES[t.periodRule] || {}).cadence || 'on request'; }
function levelOf(recipe) { return recipe.autonomyCeiling === 'L4' ? 'L4' : 'L3'; }

/**
 * The compact array the API stores for the Library picker (no done items, no routes): recipes sorted by id, then
 * candidates sorted by id with `candidate: true, learnedFrom, used` so the Library tab can show "Learned from REQ-n".
 */
function library(recipes = current(), cands = candidates()) {
  const row = (r) => ({
    id: r.id, version: r.version, group: r.group, groupName: GROUPS[r.group] || null, title: r.title, cadence: cadenceOf(r), level: levelOf(r),
    setupKeys: (r.setup || []).map((s) => s.key), inputs: (r.inputs || []).map((i) => i.name), prompt: r.prompt,
    // the questions themselves, so the Dime screen can ask them: entity-wide ('*') ones are shared across recipes
    setupQuestions: (r.setup || []).map((s) => ({ key: s.key, q: s.q, type: s.type || 'text', scope: s.scope || 'recipe', ...(s.default !== undefined ? { default: s.default } : {}) })),
  });
  return [
    ...Object.values(recipes).sort((a, b) => a.id.localeCompare(b.id)).map(row),
    ...(cands || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).map((c) => ({ ...row(c), candidate: true, learnedFrom: (c.learnedFrom || []).slice().sort((a, b) => Number(String(a).slice(4)) - Number(String(b).slice(4))), used: c.used || 0 })),
  ];
}

function writeLibraryJson(file = LIBRARY_FILE) {
  const lib = library();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ builtAt: new Date().toISOString(), count: lib.length, recipes: lib }, null, 1)}\n`);
  return { file, count: lib.length };
}

// ---------------------------------------------------------------- candidates (FR-37)
const MONTH = /^(\d{4})-(\d{2})$/; const QUARTER = /^(\d{4})-Q([1-4])$/i; const YEAR = /^\d{4}$/; const DAY = /^\d{4}-\d{2}-\d{2}$/;
const monthIndex = (y, m) => y * 12 + (m - 1);

/** Pure: one resolved period as { start, end, label } from a string (2026-09, 2026-Q3, 2026, 2026-09-30) or an object { period|label, startDate|start, endDate|end }. */
function periodBounds(p) {
  if (p && typeof p === 'object') {
    const start = p.startDate || p.start || null; const end = p.endDate || p.end || null; const label = p.period || p.label || null;
    if (start && end) return { start: String(start).slice(0, 10), end: String(end).slice(0, 10), label };
    if (label) return periodBounds(String(label));
    return null;
  }
  const s = String(p || '').trim(); let m;
  const iso = (d) => d.toISOString().slice(0, 10);
  if ((m = MONTH.exec(s))) { const y = +m[1]; const mo = +m[2]; return { start: iso(new Date(Date.UTC(y, mo - 1, 1))), end: iso(new Date(Date.UTC(y, mo, 0))), label: s }; }
  if ((m = QUARTER.exec(s))) { const y = +m[1]; const q = +m[2]; return { start: iso(new Date(Date.UTC(y, (q - 1) * 3, 1))), end: iso(new Date(Date.UTC(y, q * 3, 0))), label: s.toUpperCase() }; }
  if (YEAR.test(s)) return { start: `${s}-01-01`, end: `${s}-12-31`, label: s };
  if (DAY.test(s)) return { start: s, end: s, label: s };
  const words = /^([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (words) { const mo = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(words[1].toLowerCase()) + 1; if (mo) return periodBounds(`${words[2]}-${String(mo).padStart(2, '0')}`); }
  return null;
}

/**
 * Pure: the period rule a request's resolved periods follow, judged against the day it was created.
 * One month before the creation month → last_closed_month; the creation month → current_month; a quarter → prior_quarter;
 * a year → prior_year; Jan 1 to a month end → year_to_date; a 7-day span → last_week; one day → business_day; else last_closed_month.
 */
function inferPeriodRule(periods, createdAt) {
  const list = (Array.isArray(periods) ? periods : [periods]).map(periodBounds).filter(Boolean);
  const created = new Date(createdAt || Date.now()); const cy = created.getUTCFullYear(); const cm = created.getUTCMonth() + 1;
  if (!list.length) return { rule: 'last_closed_month', count: 0, inferred: false };
  const last = list[list.length - 1]; const first = list[0];
  const days = Math.round((Date.parse(last.end) - Date.parse(first.start)) / 864e5) + 1;
  const label = String(last.label || '');
  if (QUARTER.test(label)) return { rule: 'prior_quarter', count: list.length, inferred: true };
  if (YEAR.test(label)) return { rule: 'prior_year', count: list.length, inferred: true };
  if (/-01-01$/.test(first.start) && list.length === 1 && days > 31 && !/-12-31$/.test(last.end)) return { rule: 'year_to_date', count: 1, inferred: true };
  if (days === 1) return { rule: 'business_day', count: list.length, inferred: true };
  if (days === 7) return { rule: 'last_week', count: list.length, inferred: true };
  const m = MONTH.exec(label) || MONTH.exec(last.end.slice(0, 7));
  if (m) {
    const diff = monthIndex(cy, cm) - monthIndex(+m[1], +m[2]);
    if (diff === 0) return { rule: 'current_month', count: list.length, inferred: true };
    if (diff === 1) return { rule: 'last_closed_month', count: list.length, inferred: true };
    if (diff === 2) return { rule: 'closing_month', count: list.length, inferred: true };
  }
  return { rule: 'last_closed_month', count: list.length, inferred: false };
}

/** Pure: replace concrete ids and dates with recipe tokens so the candidate fits the next entity and period. */
function abstractValue(value, { businessIds = [], periodStart = null, periodEnd = null }) {
  const sub = (s) => {
    let t = String(s);
    for (const b of businessIds) if (b) t = t.split(String(b)).join('{{businessId}}');
    if (periodEnd) t = t.split(periodEnd).join('{{period.end}}');
    if (periodStart) t = t.split(periodStart).join('{{period.start}}');
    return t;
  };
  const walk = (v) => {
    if (typeof v === 'string') return sub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

/** Pure: kebab slug of a title, at most 40 characters. */
function slugOf(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'request'; }
const GROUP_BY_KIND = { question: 2, report: 4, export: 4, data_task: 3, change_request: 6 };

/** Pure: which done items passed, from checks.json (code) and verify.json (Verifier); an item failed by either is out. */
function passedDone(done, checks, verify) {
  const failed = new Set(); const judged = new Set();
  for (const i of (checks && checks.items) || []) { judged.add(i.id); if (i.pass === false && !i.advisory) failed.add(i.id); }
  for (const i of (verify && verify.items) || []) { judged.add(i.id); if (i.pass === false) failed.add(i.id); }
  return (done || []).filter((d) => d && d.id && d.text && !failed.has(d.id) && judged.has(d.id));
}

/** Pure: plan inputs (strings "name: what, columns" or objects) → recipe inputs. */
function inputsFrom(plan, rule) {
  const out = []; const seen = new Set();
  const push = (name, what, source, accepted, optional) => { const n = String(name || '').trim(); if (!n || seen.has(n)) return; seen.add(n); const ext = (path.extname(n).slice(1) || '').toLowerCase(); out.push({ name: n, periodRule: rule, source, acceptedTypes: accepted || (ext ? [ext] : ['xlsx', 'csv', 'pdf']), ...(what ? { what } : {}), ...(optional ? { optional: true } : {}) }); };
  for (const i of (plan && plan.inputs) || []) {
    if (typeof i === 'string') { const m = /^([^:]+):\s*(.*)$/.exec(i); push(m ? m[1] : i, m ? m[2] : null, 'document'); } else if (i && typeof i === 'object') push(i.name || i.file, i.what || i.describe || null, INPUT_SOURCES.includes(i.source) ? i.source : 'document', Array.isArray(i.acceptedTypes) ? i.acceptedTypes : null, i.optional === true);
  }
  for (const i of (plan && plan.inputsNeeded) || []) if (i && typeof i === 'object') push(i.name, i.why || null, i.standing ? 'standing' : 'document', Array.isArray(i.acceptedTypes) ? i.acceptedTypes : null, false);
  return out;
}

/** Pure: setup questions from answers the requester or triage stated as key/value pairs. */
function setupFrom(answers) {
  const src = answers && typeof answers === 'object' ? (answers.answers && typeof answers.answers === 'object' ? answers.answers : answers) : {};
  const type = (k, v) => (/accounts?$/i.test(k) ? 'accounts' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'list' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? 'date' : 'text');
  return Object.entries(src).filter(([k, v]) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(k) && v != null && v !== '').sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ key: k, q: `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}?`, type: type(k, v), scope: 'recipe', default: v }));
}

/**
 * Compile a delivered request into a candidate recipe plus a frozen eval case. Reads triage.json, plan.json, checks.json,
 * verify.json, proposals.json, deliverables/manifest.json and receipts.jsonl under the request's artifacts. Writes
 * recipes/candidates/cand-<slug>.json and evals/cases/cand-<slug>/case.json only when the candidate validates.
 */
function compile(requestId, { now = new Date() } = {}) {
  const T = require('./request');
  const req = T.loadRequest(requestId);
  const json = (n) => { try { return T.readJsonArtifact(req.id, n); } catch { return null; } };
  const triage = json('triage.json') || {}; const plan = json('plan.json') || {}; const checks = json('checks.json'); const verify = json('verify.json');
  const proposals = (json('proposals.json') || { items: [] }).items || []; const manifest = (json('deliverables/manifest.json') || { items: [] }).items || [];
  let receipts = []; try { receipts = require('./receipts').list(req.id); } catch { receipts = []; }
  const subject = req.subject || triage.subject || {};
  const kind = KINDS.includes(triage.kind) ? triage.kind : req.kind; const worker = WORKERS.includes(triage.worker) ? triage.worker : req.worker;
  const businessIds = (subject.businessIds || []).map(String).filter(Boolean);
  const periods = subject.periods || [];
  const pr = inferPeriodRule(periods, req.createdAt);
  const bounds = periods.length ? periodBounds(periods[periods.length - 1]) : null;
  const abs = (v) => abstractValue(v, { businessIds, periodStart: bounds && bounds.start, periodEnd: bounds && bounds.end });
  const slug = `cand-${slugOf(req.title)}`;
  const done = passedDone(req.done, checks, verify).map((d) => ({ id: d.id, text: abs(d.text), ...(d.evaluator ? { evaluator: String(d.evaluator).replace(/^check\./, ''), args: abs(d.args || {}), ...(d.expect && Object.keys(d.expect).length ? { expect: abs(d.expect) } : {}) } : {}), ...(d.advisory ? { advisory: true } : {}) }));
  const steps = ((plan.steps || []).map((s) => (typeof s === 'string' ? s : s && (s.text || s.step)) || '').filter(Boolean)).map(abs);
  let verbs = []; try { verbs = require('./compute').list().map((v) => v.name); } catch { verbs = []; }
  const compute = verbs.filter((v) => steps.some((s) => new RegExp(`\\b${v}\\b`).test(s)) || receipts.some((r) => r.verb === v)).sort();
  const programs = [...new Set(receipts.filter((r) => r.kind === 'compute' && r.method === 'SANDBOX' && r.status === 'ok' && r.path).map((r) => r.path))].sort();
  const writes = []; const seenW = new Set();
  for (const p of proposals) { const k = `${p.kind}|${p.method} ${p.path}`; if (!p.kind || seenW.has(k)) continue; seenW.add(k); writes.push({ kind: p.kind, route: `${p.method || 'POST'} ${abs(String(p.path || ''))}`.trim(), tierRules: [{ when: 'as proposed', tier: ['A', 'B', 'C'].includes(p.tier) ? p.tier : 'C' }] }); }
  const X = require('./xlsx');
  const deliverables = manifest.filter((m) => m && m.name).map((m) => {
    let sheets = [];
    if (/\.xlsx$/i.test(m.name)) { try { sheets = X.readXlsx(fs.readFileSync(path.join(T.artifactsDir(req.id), 'deliverables', m.name))).sheets.map((s) => s.name); } catch { sheets = []; } }
    return { name: m.name, sheets, ...(m.kind ? { kind: m.kind } : {}), ...(m.first ? { first: true } : {}) };
  });
  const setup = setupFrom(req.setup || triage.setup || null);
  const tools = ['map', 'dime', 'files', 'check', ...(deliverables.length ? ['export'] : []), ...(compute.length ? ['compute'] : []), ...(programs.length ? ['sandbox'] : [])];
  const spent = (req.runs || []).reduce((s, r) => s + (r.costUsd || 0), 0);
  const level = String(req.level || (req.origin && req.origin.level) || '').toUpperCase();
  const candidate = {
    id: slug, candidate: true, version: 0, group: GROUP_BY_KIND[kind] || 2,
    title: req.title, prompt: String(req.body || req.title || '').replace(/\s+/g, ' ').trim().slice(0, 400) || req.title,
    keywords: [...new Set([...(subject.accounts || []), ...(triage.keywords || [])].map(String).filter(Boolean))],
    kind, worker,
    trigger: { default: null, periodRule: pr.rule, event: null },
    subjectPattern: { entity: '$current', periods: pr.rule, count: pr.count, inferred: pr.inferred },
    setup, inputs: inputsFrom(plan, pr.rule), steps, compute, ...(programs.length ? { programs } : {}),
    done, writes, deliverables,
    gaps: Array.isArray(plan.gaps) ? plan.gaps : [],
    autonomyCeiling: level === 'L4' ? 'L4' : 'L3-policy',
    restrictedData: Boolean(req.restrictedData),
    budgetUsd: Math.max(1, Math.ceil(spent || 0)) || 6,
    tools, evals: [`evals/cases/${slug}`],
    learnedFrom: [req.id], used: 1, entities: [...new Set(businessIds)],
    compiledAt: (now instanceof Date ? now : new Date(now)).toISOString(), compiledFrom: { kind: req.kind, size: req.size, writes: Boolean(req.writes), periods, createdAt: req.createdAt },
  };
  if (!spent) candidate.budgetUsd = [1, 7].includes(candidate.group) ? 3 : 6;
  const v = validate(candidate);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings, candidate };
  const caseDir = path.join(evalsDir(), 'cases', slug); fs.mkdirSync(caseDir, { recursive: true });
  const kase = { agent: 'intake', stage: 'intake', request: { title: req.title, body: req.body || '', backend: req.backend || null, ...(req.client ? { client: req.client } : {}) }, artifacts: [], expect: { artifact: 'triage.md', json: { kind, worker }, jsonKeys: ['subject', 'done'], maxGuardDenials: 0 }, comment: `Frozen from ${req.id} when candidate ${slug} was compiled.` };
  fs.writeFileSync(path.join(caseDir, 'case.json'), `${JSON.stringify(kase, null, 2)}\n`);
  fs.mkdirSync(candidatesDir(), { recursive: true });
  const file = candidateFile(slug);
  if (fs.existsSync(file)) { // compiled again (a send-back, a second delivery): keep the provenance, refresh the body
    const prev = readJson(file);
    candidate.learnedFrom = [...new Set([...(prev.learnedFrom || []), req.id])]; candidate.used = Math.max(prev.used || 1, candidate.learnedFrom.length); candidate.entities = [...new Set([...(prev.entities || []), ...candidate.entities])];
  }
  fs.writeFileSync(file, `${JSON.stringify(candidate, null, 2)}\n`);
  return { ok: true, candidate, file, caseDir, warnings: v.warnings };
}

/** Another request followed this candidate: used += 1, provenance grows. */
function recordUse(candidateId, requestId, businessId = null) {
  const file = candidateFile(candidateId); const c = loadCandidate(candidateId);
  c.used = (c.used || 0) + 1;
  if (requestId && /^REQ-\d+$/.test(String(requestId)) && !(c.learnedFrom || []).includes(requestId)) c.learnedFrom = [...(c.learnedFrom || []), requestId];
  if (businessId && !(c.entities || []).includes(String(businessId))) c.entities = [...(c.entities || []), String(businessId)];
  c.lastUsedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`);
  return c;
}

/** `lab eval` writes one report per case here; promote() reads the candidate's. */
function recordEvalReport(name, result) {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]+/g, '-'); if (!safe) throw new Error('an eval report needs a case name');
  fs.mkdirSync(reportsDir(), { recursive: true });
  const file = path.join(reportsDir(), `${safe}.json`);
  const doc = { name: safe, pass: Boolean(result && result.pass), at: new Date().toISOString(), ...(result && typeof result === 'object' ? result : {}) };
  doc.pass = Boolean(result && result.pass);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return { file, pass: doc.pass };
}
function readEvalReport(name) { const p = path.join(reportsDir(), `${String(name).replace(/[^A-Za-z0-9._-]+/g, '-')}.json`); return fs.existsSync(p) ? readJson(p) : null; }

/** The next free R<nn> id in the recipes folder. */
function nextRecipeId() {
  const taken = new Set(recipeFiles().map((p) => path.basename(p).slice(0, 3)));
  for (let n = 1; n <= 99; n += 1) { const id = `R${String(n).padStart(2, '0')}`; if (!taken.has(id)) return id; }
  throw new Error('no free recipe id under R99');
}

/**
 * Promote a candidate to recipes/R<nn>.json version 1. Refuses unless used >= 2, the eval report for the candidate passed,
 * and the resulting recipe validates. `cron` becomes trigger.default (null leaves it on request only).
 */
function promote(candidateId, { by, cron = null, nextId = null } = {}) {
  if (!by) throw new Error('promote needs --by <name>: a person owns every library recipe');
  const c = loadCandidate(candidateId);
  if (!((c.used || 0) >= 2)) throw new Error(`${candidateId} was used ${c.used || 0} time(s); a candidate is promoted after it has run for at least 2 requests`);
  const report = readEvalReport(candidateId);
  if (!report) throw new Error(`no eval report for ${candidateId}: run \`lab eval ${candidateId}\` first (evals/reports/${candidateId}.json)`);
  if (!report.pass) throw new Error(`the eval report for ${candidateId} did not pass (${report.at || 'no date'}); fix the candidate and run \`lab eval ${candidateId}\` again`);
  if (cron != null && !(typeof cron === 'string' && CRON.test(cron.trim()))) throw new Error('--cron must be a five-field cron string');
  const id = nextId || nextRecipeId();
  if (!/^R\d{2}$/.test(String(id))) throw new Error(`bad recipe id ${id}`);
  if (recipeFiles().some((p) => path.basename(p).startsWith(`${id}.`))) throw new Error(`recipe ${id} already exists`);
  const { candidate: _c, used, compiledAt, compiledFrom, subjectPattern, lastUsedAt, ...rest } = c;
  const recipe = { ...rest, id, version: 1, trigger: { ...c.trigger, default: cron ? cron.trim() : null }, subjectPattern, promotedBy: by, promotedAt: new Date().toISOString(), promotedFrom: { candidate: candidateId, used, compiledAt, compiledFrom, evalReportAt: report.at || null } };
  const v = validate(recipe);
  if (!v.ok) throw new Error(`${candidateId} does not validate as a recipe: ${v.errors.join('; ')}`);
  fs.mkdirSync(recipesDir(), { recursive: true });
  const file = path.join(recipesDir(), `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(recipe, null, 2)}\n`);
  fs.unlinkSync(candidateFile(candidateId));
  return { recipe, file, warnings: v.warnings };
}

/** Move a candidate out of the matcher's sight, keeping it for the record. */
function discard(candidateId, by) {
  if (!by) throw new Error('discard needs --by <name>');
  const c = loadCandidate(candidateId);
  const dir = path.join(candidatesDir(), '.discarded'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${candidateId}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ ...c, discardedBy: by, discardedAt: new Date().toISOString() }, null, 2)}\n`);
  fs.unlinkSync(candidateFile(candidateId));
  return { file };
}

// ---------------------------------------------------------------- setup answers and prompt blocks
/** Pure: replace {{setup.key}} tokens with the answer (or the setup default); other tokens are left for Intake. */
function fillSetup(value, recipe, answers = {}) {
  const defaults = Object.fromEntries((recipe.setup || []).filter((s) => s.default != null).map((s) => [s.key, s.default]));
  const lookup = (k) => (answers && answers[k] != null ? answers[k] : defaults[k]);
  const fill = (v) => {
    if (typeof v === 'string') { const m = /^\{\{setup\.([a-zA-Z0-9]+)\}\}$/.exec(v.trim()); if (m) { const a = lookup(m[1]); return a == null ? v : a; } return v.replace(/\{\{setup\.([a-zA-Z0-9]+)\}\}/g, (s, k) => { const a = lookup(k); return a == null ? s : String(a); }); }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return fill(value);
}

/** The recipe's setup questions split into answered (from ctx.setup) and open. ctx.setup = { answers: { key: value } } or { key: value }. */
function setupStatus(recipe, setup) {
  const answers = setup && setup.answers && typeof setup.answers === 'object' ? setup.answers : (setup || {});
  const answered = []; const open = [];
  for (const s of recipe.setup || []) { const a = answers[s.key]; if (a != null && a !== '') answered.push({ ...s, answer: a }); else open.push(s); }
  return { answered, open, answers };
}

/** Prompt block for Intake: adopt the recipe; answer setup from the stored answers before asking. */
function intakeBlock(recipe, { setup = null, matchInfo = null } = {}) {
  if (!recipe) return '';
  const st = setupStatus(recipe, setup);
  const lines = [
    '## Recipe',
    `This request ${matchInfo && matchInfo.score != null ? `matches library recipe ${recipe.id} v${recipe.version} (match ${matchInfo.score}; confirm it reads as the same request, else ignore this block and triage from scratch)` : `was started from library recipe ${recipe.id} v${recipe.version}`}: ${recipe.title}`,
    `Library wording: ${recipe.prompt}`,
    `Adopt the recipe's kind (${recipe.kind}), worker (${recipe.worker}), period rule (${recipe.trigger.periodRule}: ${PERIOD_RULES[recipe.trigger.periodRule].text}; resolve the dates with the dates tool), done items, inputs and setup keys. Write "recipeId": "${recipe.id}" and "recipeVersion": ${recipe.version} into triage.json and the lab-result.`,
    'Done items (carry them as written; fill {{period.start}}, {{period.end}}, {{businessId}} with the resolved values; items already filled from setup are final):',
    ...(recipe.done || []).map((d) => `- ${d.id}: ${d.text}${d.evaluator ? `  [${d.evaluator} ${JSON.stringify(fillSetup(d.args || {}, recipe, st.answers))} expect ${JSON.stringify(fillSetup(d.expect || {}, recipe, st.answers))}${d.advisory ? ' advisory' : ''}]` : ''}`),
  ];
  if ((recipe.inputs || []).length) lines.push('Inputs the work needs (the Planner resolves them connection → Dime → standing file → document request; name any that is missing in triage.md, do not ask for it):', ...recipe.inputs.map((i) => `- ${i.name} (${i.periodRule}; ${i.source}${i.connection ? ` ${i.connection}` : ''}${i.optional ? '; optional' : ''}${i.acceptedTypes ? `; ${i.acceptedTypes.join('/')}` : ''}${i.maxAgeDays ? `; fresh within ${i.maxAgeDays} days` : ''})`));
  if (st.answered.length) lines.push('Setup already answered for this entity (use these; never re-ask):', ...st.answered.map((s) => `- ${s.key}: ${typeof s.answer === 'string' ? s.answer : JSON.stringify(s.answer)}`));
  if (st.open.length) lines.push(`Setup not yet answered (a question only if the work cannot proceed without it; otherwise state the assumption in triage.md and name the key${st.open.some((s) => s.default != null) ? '; defaults apply where given' : ''}):`, ...st.open.map((s) => `- ${s.key} (${s.type}, ${s.scope === '*' ? 'entity-wide' : 'this recipe'}): ${s.q}${s.default != null ? ` [default ${JSON.stringify(s.default)}]` : ''}`));
  lines.push(`Deliverable: ${(recipe.deliverables || []).map((d) => `${d.name} with sheets ${d.sheets.join(', ')}`).join('; ')}. Budget $${recipe.budgetUsd}; writes: ${(recipe.writes || []).length ? recipe.writes.map((w) => w.kind).join(', ') : 'none'}.`);
  return lines.join('\n');
}

/** Prompt block for the Planner: the recipe's steps, compute verbs and the inputs in resolution order. */
function plannerBlock(recipe, { setup = null } = {}) {
  if (!recipe) return '';
  const st = setupStatus(recipe, setup);
  const lines = [
    '## Recipe steps and inputs',
    `Recipe ${recipe.id} v${recipe.version}: ${recipe.title}. Period rule ${recipe.trigger.periodRule} (${PERIOD_RULES[recipe.trigger.periodRule].text}).`,
  ];
  if ((recipe.steps || []).length) lines.push('Steps the recipe expects (refine, do not skip):', ...recipe.steps.map((s, i) => `${i + 1}. ${s}`));
  if ((recipe.compute || []).length) lines.push(`Compute verbs for the arithmetic (plan them as steps; the worker never does this by hand): ${recipe.compute.join(', ')}`);
  if ((recipe.inputs || []).length) {
    lines.push('Inputs and their resolution order. For each, plan the first source that exists; a document request is the last resort and parks the request in awaiting_input:',
      ...recipe.inputs.map((i) => `- ${i.name} for ${i.periodRule}: 1) connection${i.connection ? ` (${i.connection})` : ''} → 2) Dime (a route in the map) → 3) standing file on the entity${i.maxAgeDays ? ` (fresh within ${i.maxAgeDays} days)` : ''} → 4) document from the requester${i.acceptedTypes ? ` (${i.acceptedTypes.join('/')})` : ''}${i.optional ? '. Optional: the work proceeds without it and says so' : ''}. Preferred: ${i.source}`));
  } else lines.push('Inputs: none beyond Dime reads.');
  if (st.answered.length) lines.push('Setup answers to apply:', ...st.answered.map((s) => `- ${s.key}: ${typeof s.answer === 'string' ? s.answer : JSON.stringify(s.answer)}`));
  lines.push(`Deliverables: ${(recipe.deliverables || []).map((d) => `${d.name} (${d.sheets.join(', ')})`).join('; ')}. Tools: ${(recipe.tools || []).join(', ')}. Budget $${recipe.budgetUsd}.`);
  return lines.join('\n');
}

module.exports = {
  DIR, CANDIDATES, EVALS, LIBRARY_FILE, GROUPS, PERIOD_RULES, TOOLS, SETUP_TYPES, INPUT_SOURCES, CEILINGS, recipesDir, candidatesDir, evalsDir, reportsDir,
  load, current, candidates, loadCandidate, candidateFile, validate, validateAll, tokens, stem, profile, match, SUBJECT_STOP, CANDIDATE_DISCOUNT, cadenceOf, levelOf, library, writeLibraryJson,
  fillSetup, setupStatus, intakeBlock, plannerBlock,
  periodBounds, inferPeriodRule, abstractValue, slugOf, passedDone, inputsFrom, setupFrom, compile, recordUse, recordEvalReport, readEvalReport, nextRecipeId, promote, discard,
};
