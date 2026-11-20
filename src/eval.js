'use strict';
// Evaluation set: frozen requests from real runs. A case replays one agent on
// the frozen inputs and checks its output against expectations, so a prompt or
// knowledge change is measured before it is merged.
//
//   evals/cases/<name>/case.json   { agent, stage, request: {...fields}, artifacts: [...files in this dir], expect: {...} }
//   expect: { artifact, mustMention[], mustNotMention[], headings[], json{}, jsonKeys[], jsonOneOf{}, mustAsk, maxQuestions, minLength,
//             maxCostUsd, maxTurns, maxGuardDenials, maxRefusedCalls, mustNotCreate[] }

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASES = path.join(ROOT, 'evals', 'cases');

function listCases() { return fs.existsSync(CASES) ? fs.readdirSync(CASES).filter((d) => fs.existsSync(path.join(CASES, d, 'case.json'))).sort() : []; }
function loadCase(name) { const dir = path.join(CASES, name); return { name, dir, ...JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) }; }

/** Pure: evaluate expectations over an artifact text, the lab-result JSON and the run record. */
function check(expect, { artifactText = '', result = {}, run = {} }) {
  const failures = [];
  const low = artifactText.toLowerCase();
  for (const m of expect.mustMention || []) if (!low.includes(String(m).toLowerCase())) failures.push(`missing mention: ${m}`);
  for (const m of expect.mustNotMention || []) if (low.includes(String(m).toLowerCase())) failures.push(`forbidden mention: ${m}`);
  for (const h of expect.headings || []) if (!new RegExp(`^#{1,4}\\s*(\\d+\\.\\s*)?${h.replace(/^#+\s*/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'mi').test(artifactText)) failures.push(`missing heading: ${h}`);
  for (const [k, v] of Object.entries(expect.json || {})) if (JSON.stringify(result[k]) !== JSON.stringify(v)) failures.push(`result.${k} = ${JSON.stringify(result[k])}, expected ${JSON.stringify(v)}`);
  for (const k of expect.jsonKeys || []) if (!(k in result)) failures.push(`result missing key ${k}`);
  for (const [k, list] of Object.entries(expect.jsonOneOf || {})) if (!list.some((v) => JSON.stringify(result[k]) === JSON.stringify(v))) failures.push(`result.${k} = ${JSON.stringify(result[k])}, expected one of ${JSON.stringify(list)}`);
  if (expect.minLength && artifactText.length < expect.minLength) failures.push(`artifact shorter than ${expect.minLength} chars`);
  if (expect.mustAsk && !(result.status === 'needs_input' && Array.isArray(result.questions) && result.questions.length)) failures.push(`expected the agent to stop and ask (status needs_input with questions), got status ${JSON.stringify(result.status)}`);
  if (expect.maxQuestions != null && (result.questions || []).length > expect.maxQuestions) failures.push(`${(result.questions || []).length} questions, at most ${expect.maxQuestions} allowed`);
  if (expect.maxCostUsd != null && run.costUsd > expect.maxCostUsd) failures.push(`cost $${Number(run.costUsd || 0).toFixed(2)} over the $${expect.maxCostUsd} limit`);
  if (expect.maxTurns != null && run.numTurns > expect.maxTurns) failures.push(`${run.numTurns} turns over the ${expect.maxTurns} limit`);
  if (expect.maxGuardDenials != null && (run.guardDenials || 0) > expect.maxGuardDenials) failures.push(`the guard stopped ${run.guardDenials} tool call(s)`);
  if (expect.maxRefusedCalls != null && (run.permissionDenials || 0) > expect.maxRefusedCalls) failures.push(`${run.permissionDenials} tool call(s) refused by the allow list`);
  for (const p of expect.mustNotCreate || []) if ((run.created || []).includes(p)) failures.push(`created ${p}, which it must not`);
  return { pass: failures.length === 0, failures };
}

/** Build a sandbox request dir for a case and return the request. */
function materialize(c) {
  const T = require('./request');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lab-eval-${c.name}-`));
  process.env.LAB_REQUESTS_DIR = tmp;
  process.env.LAB_RUNS_DIR = path.join(tmp, 'runs');
  process.env.LAB_EVENTS_FILE = path.join(tmp, 'events.jsonl');
  const r = T.createRequest({ title: c.request.title, body: c.request.body || '', reporter: 'eval' });
  Object.assign(r, c.request, { id: r.id });
  T.saveRequest(r);
  for (const f of c.artifacts || []) { const dst = path.join(T.artifactsDir(r.id), f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(c.dir, f), dst); }
  return { request: T.loadRequest(r.id), tmp };
}

module.exports = { listCases, loadCase, check, materialize, CASES };
