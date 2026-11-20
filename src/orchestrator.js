'use strict';
// The request lane state machine. One lane for every kind; the ceremony scales:
// a size-S read-only request skips Scope and Gate 1; Gate 2 and Apply run only
// when proposals exist. Transitions are pure so they are tested without a model.
// Humans are the only writers of gate fields and proposal decisions.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const K = require('./knowledge');
const C = require('./claude');
const P = require('./prompting');
const EV = require('./events');
const D = require('./dime');
const M = require('./map');
const PL = require('./plan');
const DN = require('./done');
const PR = require('./proposals');
const R = require('./receipts');
const EVD = require('./evidence');

const ROOT = path.join(__dirname, '..');
const pipeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pipeline.json'), 'utf8'));
const AGENT_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agents.json'), 'utf8'));

const agents = {
  intake: require('../agents/intake'),
  planner: require('../agents/planner'),
  analyst: require('../agents/analyst'),
  investigator: require('../agents/investigator'),
  preparer: require('../agents/preparer'),
  bookkeeper: require('../agents/bookkeeper'),
  verifier: require('../agents/verifier'),
  deliverer: require('../agents/deliverer'),
  applier: require('./apply'),
};
const WORKERS = PL.WORKERS;
const KINDS = pipeline.kinds;
const LOCK_DIR = () => path.join(T.requestsDir(), '.locks');

function log(msg) { if (!process.env.LAB_QUIET) process.stdout.write(`${msg}\n`); }
function warnComment(id, stage, msg) { T.addComment(id, { author: 'orchestrator', stage, body: `⚠ ${msg}` }); }

// ---------------------------------------------------------------- lane helpers
function isParent(req) { return Array.isArray(req.children) && req.children.length > 0; }
function laneFor(req) { return isParent(req) ? pipeline.lanes.parent : pipeline.lanes.request; }
function budgetFor(req) { if (Number(req.budgetUsd) > 0) return Number(req.budgetUsd); const b = pipeline.budget || {}; return (b.perRequestUsdBySize || {})[req.size] || b.default || 20; }
function loopLimit(req, kind) { return (pipeline.loops[kind] || 0) + ((req.loopGrants || {})[kind] || 0); }
function spent(req) { return (req.runs || []).reduce((s, r) => s + (r.costUsd || 0), 0); }
function workerFor(req) { return (req.worker && WORKERS.includes(req.worker) ? req.worker : null) || pipeline.workers[req.kind] || 'analyst'; }

/** Pure: does this request take the fast lane (no Scope, no Gate 1)? */
function isFast(req) {
  const fl = pipeline.fastLane; if (!fl || req.fastLane === false) return false;
  if (req.writes) return false;
  if (!(fl.sizes || []).includes(req.size)) return false;
  if (!(fl.kinds || []).includes(req.kind)) return false;
  return !(req.pendingQuestions || []).length;
}

/** Pure: given a result from intake, the classification patch. */
function classify(req, r) {
  const kind = KINDS.includes(r.kind) ? r.kind : (req.kind || 'question');
  const size = ['S', 'M', 'L'].includes(r.size) ? r.size : (req.size || 'S');
  const writes = typeof r.writes === 'boolean' ? r.writes : Boolean(req.writes) || ['data_task', 'change_request'].includes(kind);
  const worker = WORKERS.includes(r.worker) ? r.worker : pipeline.workers[kind] || 'analyst';
  const subject = { ...(req.subject || {}), ...(r.subject && typeof r.subject === 'object' ? r.subject : {}) };
  const done = Array.isArray(r.done) && r.done.length ? PL.normalizeDone(r.done) : (req.done || []);
  return { kind, size, writes, worker, subject, done };
}

// ---------------------------------------------------------------- transitions (pure)
function transition(req, stage, agentName, result, extras = {}) {
  const r = result || {};
  const key = `${stage}/${agentName}`;
  if (r.status === 'blocked' || r.status === 'fail') return { status: 'blocked', stop: true, reason: r.summary || r.status, patch: {} };

  switch (key) {
    case 'intake/intake': {
      const c = classify(req, r);
      if (r.status === 'needs_input') return { status: 'intake', stop: true, reason: 'questions for the requester', patch: { ...c, pendingQuestions: (r.questions || []).slice(0, 3) } };
      const next = { ...req, ...c, pendingQuestions: [] };
      if (c.size === 'L') return { status: 'scope', stop: false, reason: 'size L: the Planner splits it into child requests', patch: { ...c, pendingQuestions: [], scoped: true } };
      if (isFast(next)) return { status: 'execute', stop: false, reason: 'fast lane: small read-only request, no scope needed', patch: { ...c, pendingQuestions: [], scoped: false } };
      return { status: 'scope', stop: false, reason: `scope needed (${c.writes ? 'writes expected' : `size ${c.size}`})`, patch: { ...c, pendingQuestions: [], scoped: true } };
    }
    case 'scope/planner': {
      if (r.status === 'needs_input') return { status: 'scope', stop: true, reason: 'questions for the requester', patch: { pendingQuestions: (r.questions || []).slice(0, 3) } };
      if (!extras.plan) return { status: 'blocked', stop: true, reason: extras.planError || 'plan.json missing', patch: {} };
      const p = extras.plan;
      const patch = { pendingQuestions: [], scoped: true, gates: { ...req.gates, 1: { ...req.gates[1], approved: false, rejectedAt: null } } };
      if (p.size) patch.size = p.size;
      if (Array.isArray(p.done) && p.done.length) patch.done = PL.normalizeDone(p.done);
      if (p.worker) patch.worker = p.worker;
      patch.writes = Boolean(req.writes) || (Array.isArray(p.writes) && p.writes.length > 0) || Boolean(p.writesExpected);
      if (Array.isArray(p.children) && p.children.length) patch.children = p.children.map((c) => ({ title: c.title, body: c.body || '', kind: c.kind || req.kind, subject: c.subject || null, done: c.done || null, requestId: null }));
      if (p.estimateUsd) patch.estimateUsd = Number(p.estimateUsd);
      return { status: 'awaiting_gate_1', stop: true, reason: patch.children ? `ready for Gate 1 with ${patch.children.length} child request(s)` : 'ready for Gate 1', patch };
    }
    case `execute/${agentName}`: {
      if (!WORKERS.includes(agentName)) return { status: 'blocked', stop: true, reason: `no transition rule for ${key}`, patch: {} };
      if (r.status === 'needs_input') return { status: 'execute', stop: true, reason: 'questions for the requester', patch: { pendingQuestions: (r.questions || []).slice(0, 3) } };
      return { status: 'verify', stop: false, patch: { pendingQuestions: [], sendBackNote: null } };
    }
    case 'verify/verifier': {
      const v = extras.verdict;
      if (v === 'pass') {
        const pending = extras.proposals ? extras.proposals.pending : 0;
        if (pending > 0 && !req.proposalsApplied) return { status: 'awaiting_gate_2', stop: true, reason: `verified; ${pending} proposal(s) wait for approval at Gate 2`, patch: {} };
        return { status: 'deliver', stop: false, reason: 'verified', patch: {} };
      }
      if (v === 'fail') {
        const n = (req.loops.verify || 0) + 1; const loops = { ...req.loops, verify: n };
        if (n > loopLimit(req, 'verify')) return { status: 'blocked', stop: true, reason: `verification keeps failing (${loopLimit(req, 'verify')} loops used): ${(extras.failing || []).join(', ') || 'see verify.json'}`, patch: { loops } };
        return { status: 'execute', stop: false, reason: `verification failed (loop ${n}): ${(extras.failing || []).join(', ') || 'see verify.json'}`, patch: { loops } };
      }
      return { status: 'blocked', stop: true, reason: extras.verdictError || 'verifier produced no usable verdict', patch: {} };
    }
    case 'apply/applier': {
      if (r.status !== 'ok') return { status: 'blocked', stop: true, reason: r.summary || 'apply failed', patch: {} };
      return { status: 'verify', stop: false, reason: 'applied; verifying the result', patch: { proposalsApplied: true } };
    }
    case 'deliver/deliverer': {
      if (!extras.hasSummary) return { status: 'blocked', stop: true, reason: 'deliverer finished without summary.md', patch: {} };
      return { status: 'done', stop: true, reason: 'delivered', patch: {} };
    }
    default:
      return { status: 'blocked', stop: true, reason: `no transition rule for ${key}`, patch: {} };
  }
}

/** Which agents run for a stage (pure). */
function agentsForStage(req, stage) {
  const cfg = pipeline.stages[stage];
  if (!cfg || !cfg.agents) return [];
  return cfg.agents.map((a) => (a === 'worker' ? workerFor(req) : a));
}

function assertPreconditions(req, stage, agentName) {
  if (stage === 'execute' && req.scoped && !req.gates[1].approved) throw new Error('Gate 1 is not approved; nothing runs before the scope is approved');
  if (stage === 'apply' && !req.gates[2].approved) throw new Error('Gate 2 is not approved; nothing is written before change approval');
  if (!agents[agentName]) throw new Error(`unknown agent ${agentName}`);
  const cap = budgetFor(req);
  if (spent(req) >= cap) throw Object.assign(new Error(`request budget exhausted ($${spent(req).toFixed(2)} of $${cap}); raise this request's budget or cancel it`), { code: 'BUDGET' });
}

// ---------------------------------------------------------------- context
function readPlan(id) { const p = T.readJsonArtifact(id, 'plan.json'); if (!p) throw new Error('plan.json missing'); const v = PL.validate(p, M.load()); if (!v.ok) throw new Error(`plan.json invalid: ${v.errors.join('; ')}`); return p; }

async function buildCtx(req, stage, agentName) {
  const artifacts = T.listArtifacts(req.id);
  const artifactsDir = T.artifactsDir(req.id);
  const comments = T.listComments(req.id);
  let plan = null; try { plan = readPlan(req.id); } catch { plan = null; }
  let backend = null; try { backend = D.backend(req.backend); } catch { backend = null; }
  if (agentName === 'verifier') {
    // deterministic checks first; the Verifier is given them and cannot contradict a failed one
    const checks = await DN.runAll(req).catch((e) => ({ at: new Date().toISOString(), items: [], pass: true, failing: [], error: e.message }));
    T.writeArtifact(req.id, 'checks.json', JSON.stringify(checks, null, 1));
    EV.emit('check', { request: req.id, items: checks.items.map((i) => ({ evaluator: i.evaluator, pass: i.pass })) });
  }
  for (const d of ['data', 'deliverables']) fs.mkdirSync(path.join(artifactsDir, d), { recursive: true });
  const lastSameAgent = (req.runs || []).filter((r) => r.agent === agentName && r.stage === stage && r.sessionId).slice(-1)[0];
  return { request: req, stage, agentName, artifacts: T.listArtifacts(req.id), artifactsDir, comments, plan, backend, pipeline, proposals: PR.summary(req.id), receipts: R.stats(R.list(req.id)), resumeSessionId: lastSameAgent ? lastSameAgent.sessionId : null, fast: isFast(req) };
}

/** After a run: validate artifacts and compute the extras the transition needs. */
function postChecks(req, stage, agentName, parsed, ctx) {
  const extras = {};
  if (stage === 'scope') {
    try { extras.plan = readPlan(req.id); T.writeArtifact(req.id, 'plan.json', JSON.stringify(extras.plan, null, 1)); } catch (e) { extras.planError = e.message; } // validate() fills read/domain per call; keep them on disk for the dashboard
    if (extras.plan && parsed.result && parsed.result.status === 'ok' && !(extras.plan.calls || []).length && !(extras.plan.children || []).length) warnComment(req.id, stage, 'the plan names no calls; the worker will have to search from scratch');
  }
  if (stage === 'verify') {
    const checks = T.readJsonArtifact(req.id, 'checks.json') || { items: [], pass: true, failing: [] };
    let verify = null; try { verify = T.readJsonArtifact(req.id, 'verify.json'); } catch (e) { extras.verdictError = e.message; }
    const v = verify && ['pass', 'fail'].includes(verify.verdict) ? verify.verdict : (parsed.result && ['pass', 'fail'].includes(parsed.result.verdict) ? parsed.result.verdict : null);
    if (!v) extras.verdictError = extras.verdictError || 'verify.json has no verdict (pass|fail)';
    const failing = [...(checks.failing || []), ...((verify && verify.items) || []).filter((i) => i.pass === false).map((i) => i.id)];
    extras.failing = [...new Set(failing)];
    extras.verdict = v;
    if (v === 'pass' && !checks.pass) { extras.verdict = 'fail'; warnComment(req.id, stage, `the Verifier passed the request but code-checked items failed (${checks.failing.join(', ')}); the code wins`); }
    extras.proposals = PR.summary(req.id);
    EV.emit('verify', { request: req.id, failed: extras.verdict !== 'pass', failing: extras.failing });
  }
  if (stage === 'deliver') {
    extras.hasSummary = T.listArtifacts(req.id).includes('summary.md');
    try { EVD.assemble(T.loadRequest(req.id)); } catch (e) { warnComment(req.id, stage, `evidence page not assembled: ${e.message}`); }
  }
  return extras;
}

function cfgFor(agentName, stage, all = AGENT_CFG) {
  const d = all.defaults || {}; const a = (all.agents || {})[agentName] || {}; const s = (a.stages || {})[stage] || {};
  return { model: s.model ?? a.model ?? d.model ?? null, effort: s.effort ?? a.effort ?? d.effort ?? null };
}

function progress(label) {
  let n = 0;
  return (ev) => { if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) for (const b of ev.message.content) if (b.type === 'tool_use') { n += 1; if (n % 10 === 0) log(`  ${label}: ${n} tool calls so far`); } };
}

function readGuardLog(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

/** What a run of this agent probably cost, from finished runs' cost per minute (for killed runs that reported nothing). */
function estimateCost(agentName, durationMs, requests = T.listRequests()) {
  let usd = 0; let ms = 0;
  for (const r of requests) for (const x of r.runs || []) if (x.agent === agentName && x.costUsd > 0 && x.durationMs > 0) { usd += x.costUsd; ms += x.durationMs; }
  return ms > 0 ? Number(((usd / ms) * durationMs).toFixed(2)) : 0;
}

async function runDeterministic(req, stage, agent, ctx) {
  const n = req.runs.length + 1;
  const started = T.loadRequest(req.id);
  const startedAt = new Date().toISOString();
  started.runs.push({ n, stage, agent: agent.name, startedAt, endedAt: null, costUsd: 0, numTurns: 0, subtype: 'code', status: 'running' });
  T.saveRequest(started);
  T.addComment(req.id, { author: 'orchestrator', stage, body: `▶ ${agent.label} started (run ${n}, code)` });
  const t0 = Date.now();
  let result;
  try { process.env.LAB_RUN = String(n); result = await agent.execute(ctx, { log }); } catch (e) { result = { status: 'blocked', summary: e.message }; }
  const fresh = T.loadRequest(req.id);
  const rec = fresh.runs.find((x) => x.n === n) || {};
  Object.assign(rec, { endedAt: new Date().toISOString(), status: result.status, durationMs: Date.now() - t0, costUsd: 0 });
  T.saveRequest(fresh);
  T.addComment(req.id, { author: agent.label, stage, body: `— ${agent.label}: ${result.summary || result.status}` });
  EV.emit('run', { request: req.id, stage, agent: agent.name, status: result.status, costUsd: 0, numTurns: 0, durationMs: Date.now() - t0, kind: fresh.kind, size: fresh.size });
  if (stage === 'apply') { const s = PR.summary(req.id); EV.emit('proposals', { request: req.id, proposed: s.total, approved: s.approved + s.applied, applied: s.applied, rejected: s.rejected }); }
  return { ctx, res: null, parsed: { ok: true, comment: '', result }, agent };
}

async function runAgent(req, stage, agentName, opts = {}) {
  assertPreconditions(req, stage, agentName);
  const agent = agents[agentName];
  const ctx = await buildCtx(req, stage, agentName);
  if (agent.deterministic) return runDeterministic(req, stage, agent, ctx);

  ctx._deferComments = true;
  const p = agent.plan(ctx);
  ctx._deferComments = false;
  p.prompt = `${p.prompt}\n\n${P.commentsBlock(ctx)}`.trim();
  const cfg = cfgFor(agentName, stage);
  if (cfg.model && !p.model) p.model = cfg.model;
  if (cfg.effort && !p.effort) p.effort = cfg.effort;
  const systemAppend = K.buildSystemPrompt(agentName, { areas: K.areasFromRequest(req, ctx.plan) });
  const runsDir = path.join(T.runsDir(), req.id);
  fs.mkdirSync(runsDir, { recursive: true });
  const n = req.runs.length + 1;
  const base = path.join(runsDir, `${String(n).padStart(2, '0')}-${stage}-${agentName}`);
  fs.writeFileSync(`${base}.prompt.md`, `${systemAppend}\n\n---- USER PROMPT ----\n\n${p.prompt}`);
  const resume = p.resumable && ctx.resumeSessionId && (req.loops.verify > 0 || req.sendBackNote) ? ctx.resumeSessionId : null;

  if (opts.dryRun) {
    log(`[dry-run] ${agent.label} in ${stage}: prompt written to ${base}.prompt.md`);
    log(`  cwd=${p.cwd}\n  writeRoots=${p.writeRoots.join(', ')}\n  allowed=${p.allowedTools.join(' ')}${resume ? `\n  resume=${resume}` : ''}`);
    return { dry: true, ctx, plan: p };
  }

  const starting = T.loadRequest(req.id);
  starting.runs.push({ n, stage, agent: agentName, startedAt: new Date().toISOString(), endedAt: null, costUsd: 0, numTurns: 0, subtype: 'running', sessionId: resume, status: 'running' });
  T.saveRequest(starting);
  T.addComment(req.id, { author: 'orchestrator', stage, body: `▶ ${agent.label} started (run ${n}${resume ? ', resuming session' : ''})` });
  log(`▶ ${req.id} ${stage}: ${agent.label} (run ${n}${resume ? ', resume' : ''})`);
  const startedAt = new Date().toISOString();
  const env = { LAB_RUN: String(n), LAB_REQUEST: req.id };
  const res = await C.runClaude({ ...p, resume, systemAppend, logFile: `${base}.events.jsonl`, guardLog: `${base}.guard.jsonl`, requestId: req.id, env, onEvent: opts.onEvent || progress(agent.label) });
  let parsed = C.parseAgentResult(res.text);
  let wrappedUp = false; let costEstimated = false;
  if (!res.costUsd && res.subtype === 'no_result') { res.costUsd = estimateCost(agentName, res.durationMs); costEstimated = res.costUsd > 0; }
  if (C.needsWrapUp(res, parsed) && p.wrapUp !== false) {
    T.addComment(req.id, { author: 'orchestrator', stage, body: `⚠ ${agent.label} reached its ${res.timedOut ? 'time' : 'turn'} limit before finishing; asking it to wrap up from what it has` });
    const w = await C.runClaude({ ...p, prompt: P.wrapUpPrompt(ctx), resume: res.sessionId, systemAppend, logFile: `${base}.events.jsonl`, guardLog: `${base}.guard.jsonl`, requestId: req.id, env, maxTurns: 15, maxBudgetUsd: 3, timeoutMs: 8 * 60 * 1000, onEvent: opts.onEvent || progress(agent.label) });
    const wp = C.parseAgentResult(w.text);
    res.costUsd += w.costUsd || 0; res.numTurns += w.numTurns || 0; res.durationMs += w.durationMs || 0; res.permissionDenials = (res.permissionDenials || 0) + (w.permissionDenials || 0);
    if (wp.ok) { parsed = wp; res.text = w.text; res.subtype = 'wrapped_up'; res.isError = false; res.sessionId = w.sessionId || res.sessionId; wrappedUp = true; }
  }
  const denials = readGuardLog(`${base}.guard.jsonl`);
  fs.writeFileSync(`${base}.final.md`, res.text || '');
  const fresh = T.loadRequest(req.id);
  const rec = fresh.runs.find((x) => x.n === n) || {};
  Object.assign(rec, { startedAt, endedAt: new Date().toISOString(), costUsd: res.costUsd, numTurns: res.numTurns, subtype: res.subtype, sessionId: res.sessionId, status: parsed.result.status, verdict: parsed.result.verdict || null, durationMs: res.durationMs, guardDenials: denials.length, permissionDenials: res.permissionDenials || 0, ...(wrappedUp ? { wrappedUp: true } : {}), ...(costEstimated ? { costEstimated: true } : {}) });
  if (!fresh.runs.includes(rec)) fresh.runs.push({ n, stage, agent: agentName, ...rec });
  T.saveRequest(fresh);
  EV.emit('run', { request: req.id, stage, agent: agentName, status: parsed.result.status, costUsd: res.costUsd, numTurns: res.numTurns, durationMs: res.durationMs, resumed: Boolean(resume), model: p.model || null, effort: p.effort || null, kind: fresh.kind, size: fresh.size });
  const rs = R.stats(R.list(req.id)); EV.emit('receipts', { request: req.id, stage, agent: agentName, calls: rs.calls, refused: rs.refused });
  const body = [parsed.comment ? parsed.comment.slice(0, 6000) : '', `— ${agent.label}: ${parsed.result.summary || parsed.result.status}`].filter(Boolean).join('\n\n');
  T.addComment(req.id, { author: agent.label, stage, body });
  if (denials.length) {
    T.addComment(req.id, { author: 'orchestrator', stage, body: `⚠ the guard stopped ${denials.length} tool call${denials.length > 1 ? 's' : ''} by ${agent.label}: ${denials.slice(0, 3).map((d) => `${d.tool} \`${String(d.what).slice(0, 120)}\``).join('; ')}${denials.length > 3 ? '; …' : ''}` });
    EV.emit('guard', { request: req.id, stage, agent: agentName, denials: denials.length });
  }
  if (res.isError && res.subtype !== 'success') T.addComment(req.id, { author: 'orchestrator', stage, body: `⚠ claude run ended with ${res.subtype}${res.stderr ? `: ${res.stderr.slice(0, 500)}` : ''}` });
  log(`  ${agent.label} finished: ${parsed.result.status} ($${res.costUsd.toFixed(2)}, ${res.numTurns} turns, ${Math.round(res.durationMs / 1000)}s)`);
  return { ctx, res, parsed, agent };
}

/** Artifacts that let a stage be judged when the run ended without a result block. */
function stageArtifactsPresent(req, stage, agentName) {
  const a = T.listArtifacts(req.id);
  if (stage === 'intake') return a.includes('triage.json');
  if (stage === 'scope') return a.includes('plan.json');
  if (stage === 'execute') return a.includes('work.md');
  if (stage === 'verify') return a.includes('verify.json');
  if (stage === 'deliver') return a.includes('summary.md');
  return false;
}

/** For intake judged on artifacts: lift the classification from triage.json. */
function resultFromArtifacts(req, stage) {
  if (stage === 'intake') { const t = T.readJsonArtifact(req.id, 'triage.json') || {}; return { status: t.questions && t.questions.length ? 'needs_input' : 'ok', summary: 'judged on triage.json', ...t }; }
  if (stage === 'verify') { const v = T.readJsonArtifact(req.id, 'verify.json') || {}; return { status: 'ok', verdict: v.verdict, summary: 'judged on verify.json' }; }
  return { status: 'ok', summary: 'judged on artifacts (agent ended without a result block)' };
}

function resumeFromArtifacts(id) {
  const req = T.loadRequest(id);
  if (req.status !== 'blocked') throw new Error(`request is ${req.status}, not blocked`);
  const stage = (req.blocked && req.blocked.stage) || blockedStage(req); const agentName = (req.blocked && req.blocked.agent) || agentsForStage(req, stage)[0];
  if (!stageArtifactsPresent(req, stage, agentName)) throw new Error(`${stage} artifacts are not complete; run it again instead`);
  const parsed = { ok: true, comment: '', result: resultFromArtifacts(req, stage) };
  const extras = postChecks(req, stage, agentName, parsed, {});
  const tr = transition(req, stage, agentName, parsed.result, extras);
  Object.assign(req, tr.patch || {}); req.status = tr.status; delete req.blocked; T.saveRequest(req);
  T.addComment(id, { author: 'orchestrator', stage, body: `→ ${tr.status} (judged from artifacts${tr.reason ? `: ${tr.reason}` : ''})` });
  EV.emit('transition', { request: id, stage, agent: agentName, to: tr.status, reason: `resume: ${tr.reason || ''}` });
  return { status: tr.status, reason: tr.reason };
}

function blockedStage(req) { const r = (req.runs || [])[req.runs.length - 1]; return (req.blocked && req.blocked.stage) || (r ? r.stage : 'intake'); }

function markAborted(id) {
  const req = T.loadRequest(id);
  let changed = false;
  for (const r of req.runs || []) if (r.status === 'running') { r.status = 'aborted'; r.subtype = 'aborted'; r.endedAt = new Date().toISOString(); r.durationMs = Date.parse(r.endedAt) - Date.parse(r.startedAt); if (!r.costUsd) { r.costUsd = estimateCost(r.agent, r.durationMs); r.costEstimated = r.costUsd > 0; } changed = true; }
  if (changed) T.saveRequest(req);
  return changed;
}
function reconcile(req) { if (!lockHolder(req.id) && (req.runs || []).some((r) => r.status === 'running')) { markAborted(req.id); return T.loadRequest(req.id); } return req; }

function blockedInfo(stage, agent, reason) {
  const kind = /budget exhausted/.test(reason || '') ? 'budget' : /verification keeps failing/.test(reason || '') ? 'loop_verify' : 'stage';
  return { stage, agent, kind, reason: String(reason || '').slice(0, 500) };
}

// ---------------------------------------------------------------- parents and children
function spawnChildren(parent) {
  const req = T.loadRequest(parent.id);
  let n = 0;
  for (const c of req.children || []) {
    if (c.requestId) continue;
    const child = T.createRequest({ title: c.title, body: c.body || `${c.title}\n\n(part of ${req.id}: ${req.title})`, reporter: req.reporter, backend: req.backend });
    child.parentId = req.id; child.kind = c.kind || req.kind; child.writes = Boolean(req.writes);
    if (c.subject) child.subject = c.subject; if (c.done) child.done = PL.normalizeDone(c.done); child.attachments = req.attachments || [];
    T.saveRequest(child);
    // the parent's attachments are shared by reference: copy files so the child's artifacts dir is self-contained
    const src = path.join(T.artifactsDir(req.id), 'attachments'); if (fs.existsSync(src)) { const dst = path.join(T.artifactsDir(child.id), 'attachments'); fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f)); }
    c.requestId = child.id; n += 1;
    T.addComment(child.id, { author: 'orchestrator', stage: 'intake', body: `created as a child of ${req.id}` });
  }
  req.status = 'children'; T.saveRequest(req);
  T.addComment(req.id, { author: 'orchestrator', stage: 'children', body: `→ children (${n} child request(s) created: ${(req.children || []).map((c) => c.requestId).join(', ')})` });
  EV.emit('transition', { request: req.id, stage: 'awaiting_gate_1', agent: null, to: 'children', reason: `${n} children` });
  return req;
}
function childrenDone(req) { return (req.children || []).every((c) => { if (!c.requestId) return false; try { return T.loadRequest(c.requestId).status === 'done'; } catch { return false; } }); }

// ---------------------------------------------------------------- run loop
async function run(id, opts = {}) {
  let req = reconcile(T.loadRequest(id));
  for (let guard = 0; guard < 16; guard++) {
    const stage = req.status;
    const cfg = pipeline.stages[stage];
    if (!cfg) throw new Error(`unknown status ${stage}`);
    if (cfg.gate) { log(`⏸ ${id} is at ${cfg.label}. Approve with: lab approve ${id} --gate ${cfg.gate} --by <name>`); break; }
    if (stage === 'children') { if (childrenDone(req)) { req.status = 'deliver'; T.saveRequest(req); T.addComment(id, { author: 'orchestrator', stage, body: '→ deliver (all children done)' }); req = T.loadRequest(id); continue; } log(`⏸ ${id} waits for children: ${(req.children || []).map((k) => k.requestId).join(', ')}`); break; }
    if (cfg.terminal || stage === 'blocked') { log(`■ ${id} is ${cfg.label}`); break; }
    if (opts.until && stage === opts.until) { log(`■ reached --until ${stage}`); break; }
    if (req.pendingQuestions && req.pendingQuestions.length) { log(`⏸ ${id} is waiting for answers. Reply with: lab answer ${id} --by <name> --text "..."`); break; }
    const list = agentsForStage(req, stage);
    let stop = false; let i = 0;
    while (i < list.length) {
      const agentName = list[i];
      let out;
      try { out = await runAgent(req, stage, agentName, opts); } catch (e) {
        if (e.code !== 'BUDGET') throw e;
        req = T.loadRequest(id);
        req.blocked = blockedInfo(stage, agentName, e.message); req.status = 'blocked'; T.saveRequest(req);
        T.addComment(id, { author: 'orchestrator', stage, body: `→ blocked (${e.message})` });
        EV.emit('transition', { request: id, stage, agent: agentName, to: 'blocked', reason: e.message });
        log(`  → blocked (${e.message})`);
        stop = true; break;
      }
      if (out.dry) return req;
      req = T.loadRequest(id);
      if (out.parsed && !out.parsed.ok && stageArtifactsPresent(req, stage, agentName)) {
        warnComment(id, stage, `${agentName} ended without a lab-result (${out.res && out.res.subtype}); judging the stage on its artifacts`);
        out.parsed = { ok: true, comment: out.parsed.comment, result: resultFromArtifacts(req, stage) };
      }
      const extras = postChecks(req, stage, agentName, out.parsed, out.ctx);
      const tr = transition(req, stage, agentName, out.parsed.result, extras);
      Object.assign(req, tr.patch || {});
      req.status = tr.status;
      if (tr.status === 'blocked') req.blocked = blockedInfo(stage, agentName, tr.reason); else delete req.blocked;
      T.saveRequest(req);
      T.addComment(id, { author: 'orchestrator', stage, body: `→ ${tr.status}${tr.reason ? ` (${tr.reason})` : ''}` });
      EV.emit('transition', { request: id, stage, agent: agentName, to: tr.status, reason: tr.reason || null });
      // the evidence page carries the final status and the delivery comment, so it is assembled once more at the end
      if (tr.status === 'done') { try { EVD.assemble(T.loadRequest(id)); } catch (e) { warnComment(id, stage, `evidence page not refreshed: ${e.message}`); } }
      log(`  → ${tr.status}${tr.reason ? ` (${tr.reason})` : ''}`);
      if (tr.stop) { stop = true; break; }
      if (tr.status !== stage) break;
      i += 1;
    }
    if (stop) { const c = pipeline.stages[req.status]; if (c && c.gate) log(`⏸ ${id} is at ${c.label}.`); break; }
    if (!list.length) break;
  }
  return T.loadRequest(id);
}

// ---------------------------------------------------------------- human actions (the only writers of gate fields)
function needBy(by) { if (!by || !String(by).trim()) throw new Error('--by <name> is required: the request records who decided'); return String(by).trim(); }

function approve(id, gate, by, note, role = 'approver') {
  const req = T.loadRequest(id); by = needBy(by);
  const g = Number(gate); if (![1, 2].includes(g)) throw new Error('gate must be 1 or 2');
  const want = g === 1 ? 'awaiting_gate_1' : 'awaiting_gate_2';
  if (req.status !== want) throw new Error(`request is ${req.status}, not at Gate ${g}`);
  if (g === 2) {
    const s = PR.summary(id);
    if (s.pending > 0) throw new Error(`${s.pending} proposal(s) or question(s) still undecided; approve, reject or answer each one first (lab proposal …)`);
  }
  const now = new Date().toISOString();
  req.gates[g] = { ...req.gates[g], approved: true, by, at: now, note: note || null, approvals: [...((req.gates[g] || {}).approvals || []), { by, role, at: now }] };
  if (g === 1 && isParent(req)) { T.saveRequest(req); T.addComment(id, { author: by, stage: want, body: `approved Gate 1${note ? `: ${note}` : ''}` }); EV.emit('gate', { request: id, gate: g, action: 'approve', by, role }); return spawnChildren(req); }
  req.status = g === 2 && PR.summary(id).approved === 0 ? 'deliver' : pipeline.stages[want].onApprove;
  T.saveRequest(req);
  T.addComment(id, { author: by, stage: want, body: `approved Gate ${g}${note ? `: ${note}` : ''}${g === 2 && req.status === 'deliver' ? ' (nothing approved to apply; delivering as is)' : ''}` });
  EV.emit('gate', { request: id, gate: g, action: 'approve', by, role });
  return req;
}

function reject(id, gate, by, note) {
  const req = T.loadRequest(id); by = needBy(by);
  const g = Number(gate); const want = g === 1 ? 'awaiting_gate_1' : 'awaiting_gate_2';
  if (req.status !== want) throw new Error(`request is ${req.status}, not at Gate ${g}`);
  if (!note) throw new Error('a note is required when sending back');
  req.gates[g] = { ...req.gates[g], approved: false, rejectedAt: new Date().toISOString(), by, note };
  req.status = g === 1 ? 'scope' : 'execute';
  if (g === 2) req.sendBackNote = note;
  T.saveRequest(req);
  T.addComment(id, { author: by, stage: want, body: `sent back Gate ${g}: ${note}` });
  EV.emit('gate', { request: id, gate: g, action: 'reject', by });
  return req;
}

/** Decide one proposal at Gate 2: approve (optionally with an edited amount), reject with a note, or answer a tier C question. */
function decideProposal(id, pid, by, { decision, note, amount, body }) {
  const req = T.loadRequest(id); by = needBy(by);
  // decisions are taken at Gate 2, and again when an apply blocked (a failed proposal is corrected and re-approved, then the request is requeued into apply)
  const atGate = req.status === 'awaiting_gate_2' || (req.status === 'blocked' && req.blocked && req.blocked.stage === 'apply');
  if (!atGate) throw new Error(`request is ${req.status}, not at Gate 2`);
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'answer' ? 'answered' : null;
  if (!status) throw new Error('decision must be approve, reject or answer');
  if (status === 'rejected' && !note) throw new Error('a note is required to reject a proposal');
  if (status === 'answered' && !note) throw new Error('an answer is required');
  const it = PR.decide(id, pid, { status, by, note: note || null, amount: amount ?? null, body: body || null });
  req.proposals = PR.load(id).items.map((p) => ({ id: p.id, status: p.status, by: p.reviewedBy || null, at: p.reviewedAt || null, appliedRef: p.appliedRef || null }));
  T.saveRequest(req);
  T.addComment(id, { author: by, stage: 'awaiting_gate_2', body: `${status} ${pid} (${it.kind || 'question'}, tier ${it.tier})${amount != null ? ` with amount ${amount}` : ''}${note ? `: ${note}` : ''}` });
  return it;
}

function answer(id, by, text) {
  const req = T.loadRequest(id); by = needBy(by);
  if (!(req.pendingQuestions || []).length) throw new Error('no pending questions');
  req.answers = [req.answers, `Q: ${req.pendingQuestions.join(' | ')}\nA (${by}): ${text}`].filter(Boolean).join('\n\n');
  req.pendingQuestions = [];
  T.saveRequest(req);
  T.addComment(id, { author: by, stage: req.status, body: text });
  return req;
}

/** A delivered request sent back for another round. Counts against the verify loop budget. */
function sendBack(id, by, note) {
  const req = T.loadRequest(id); by = needBy(by);
  if (req.status !== 'done') throw new Error(`request is ${req.status}; only a delivered request can be sent back`);
  if (!note) throw new Error('a note is required');
  const n = (req.loops.verify || 0) + 1;
  if (n > loopLimit(req, 'verify')) throw new Error(`loop budget (${loopLimit(req, 'verify')}) used up; grant one more round first (lab loop ${id} --by …)`);
  req.loops = { ...req.loops, verify: n }; req.sendBackNote = note; req.status = 'execute'; req.gates[2] = { approved: false, by: null, at: null, note: null };
  T.saveRequest(req);
  T.addComment(id, { author: by, stage: 'done', body: `sent back: ${note}` });
  EV.emit('sendback', { request: id, by }); EV.emit('transition', { request: id, stage: 'done', agent: null, to: 'execute', reason: 'send back' });
  return req;
}

function raiseBudget(id, by, usd) {
  const req = T.loadRequest(id); by = needBy(by);
  if (!(Number(usd) > spent(req))) throw new Error(`new budget must exceed what is spent ($${spent(req).toFixed(2)})`);
  req.budgetUsd = Number(usd);
  if (req.status === 'blocked' && req.blocked && req.blocked.kind === 'budget') { req.status = req.blocked.stage; delete req.blocked; }
  T.saveRequest(req); T.addComment(id, { author: by, stage: req.status, body: `raised the budget to $${usd}` }); EV.emit('budget', { request: id, by, usd: Number(usd) });
  return req;
}
function grantLoop(id, by, kind = 'verify') {
  const req = T.loadRequest(id); by = needBy(by);
  req.loopGrants = { ...(req.loopGrants || {}), [kind]: ((req.loopGrants || {})[kind] || 0) + 1 };
  if (req.status === 'blocked' && req.blocked && req.blocked.kind === `loop_${kind}`) { req.status = 'execute'; delete req.blocked; }
  T.saveRequest(req); T.addComment(id, { author: by, stage: req.status, body: `allowed one more ${kind} round` }); EV.emit('loop_grant', { request: id, by, kind });
  return req;
}
function requeue(id, by, to) {
  const req = T.loadRequest(id); by = needBy(by);
  if (!pipeline.stages[to] || !pipeline.stages[to].agents) throw new Error(`cannot requeue into ${to}`);
  req.status = to; delete req.blocked; T.saveRequest(req);
  T.addComment(id, { author: by, stage: to, body: `requeued into ${to}` }); EV.emit('requeue', { request: id, by, to });
  return req;
}
function cancel(id, by, reason) {
  const req = T.loadRequest(id); by = needBy(by);
  if ((pipeline.stages[req.status] || {}).terminal) throw new Error(`request is already ${req.status}`);
  req.cancelled = { by, at: new Date().toISOString(), reason: reason || '', from: req.status }; req.status = 'cancelled'; delete req.blocked; delete req.queued;
  T.saveRequest(req); T.addComment(id, { author: by, stage: 'cancelled', body: `cancelled: ${reason || ''}` }); EV.emit('cancel', { request: id, by });
  return req;
}
function amend(id, by, { title, body } = {}) {
  const req = T.loadRequest(id); by = needBy(by);
  if (req.gates[1].approved || req.status === 'execute' || (pipeline.stages[req.status] || {}).terminal) throw new Error('the request can be edited only before the scope is approved');
  if (title) req.title = String(title).trim().slice(0, 200); if (body != null) req.body = String(body);
  T.saveRequest(req); T.addComment(id, { author: by, stage: req.status, body: `edited the request${title ? ` (title: ${req.title})` : ''}` });
  return req;
}
/** Record a human override of a failing done item (kept on the request and shown on the evidence page). */
function override(id, by, item, reason) {
  const req = T.loadRequest(id); by = needBy(by);
  if (!reason) throw new Error('a reason is required');
  req.overrides = [...(req.overrides || []), { item, by, reason, at: new Date().toISOString() }];
  if (req.status === 'blocked' && req.blocked && req.blocked.kind === 'loop_verify') { req.status = 'deliver'; delete req.blocked; }
  T.saveRequest(req); T.addComment(id, { author: by, stage: req.status, body: `overrode ${item}: ${reason}` });
  return req;
}
function enqueue(id, by) { const r = T.loadRequest(id); r.queued = { at: new Date().toISOString(), by: by || 'human' }; return T.saveRequest(r); }
function dequeue(id) { const r = T.loadRequest(id); if (!r.queued) return r; delete r.queued; return T.saveRequest(r); }

function pendingLessons() { return T.listRequests().filter((r) => T.listArtifacts(r.id).includes('lessons.md') && !r.lessonsNoted).map((r) => r.id); }
function acceptLessons(id, by) {
  const req = T.loadRequest(id); by = needBy(by);
  const text = T.readArtifact(id, 'lessons.md'); if (!text) throw new Error('no lessons.md on this request');
  const f = path.join(ROOT, 'knowledge', 'shared', 'learned.md');
  fs.appendFileSync(f, `\n\n## From ${id} (${req.title.slice(0, 80)}), accepted by ${by} on ${new Date().toISOString().slice(0, 10)}\nareas: ${[req.kind, req.worker].filter(Boolean).join(', ')}\n\n${text.trim()}\n`);
  req.lessonsNoted = { by, at: new Date().toISOString() }; T.saveRequest(req);
  T.addComment(id, { author: by, stage: req.status, body: 'accepted the lessons into shared knowledge' });
  return req;
}

// ---------------------------------------------------------------- worker / admission / metrics
function lock(id) { fs.mkdirSync(LOCK_DIR(), { recursive: true }); const p = path.join(LOCK_DIR(), id); try { fs.writeFileSync(p, String(process.pid), { flag: 'wx' }); return true; } catch { try { const pid = Number(fs.readFileSync(p, 'utf8')); process.kill(pid, 0); return false; } catch { fs.writeFileSync(p, String(process.pid)); return true; } } }
function unlock(id) { try { fs.unlinkSync(path.join(LOCK_DIR(), id)); } catch { /* none */ } }
function lockHolder(id) { try { const pid = Number(fs.readFileSync(path.join(LOCK_DIR(), id), 'utf8')); process.kill(pid, 0); return pid; } catch { return null; } }
function runnable(r) { const c = pipeline.stages[r.status]; return Boolean(c && c.agents && !(r.pendingQuestions || []).length); }

/** Pure: may this request start a run now? */
function admission(req, others, { activeIds = new Set(), maxRuns = (pipeline.concurrency || {}).maxRuns || 2 } = {}) {
  if (activeIds.size >= maxRuns) return { ok: false, reason: `${activeIds.size} of ${maxRuns} runs busy` };
  const mine = new Set(((req.subject || {}).businessIds) || []);
  for (const o of others) {
    if (o.id === req.id || !activeIds.has(o.id)) continue;
    const theirs = ((o.subject || {}).businessIds) || [];
    const overlap = theirs.some((b) => mine.has(b));
    if (overlap && (req.writes || o.writes)) return { ok: false, reason: `${o.id} is ${o.writes ? 'changing' : 'working on'} the same business${req.writes ? ' and this request writes' : ''}` };
  }
  return { ok: true };
}

async function worker({ once = false, intervalMs = 30000 } = {}) {
  for (;;) {
    const all = T.listRequests().map(reconcile);
    const active = new Set(all.filter((r) => lockHolder(r.id)).map((r) => r.id));
    for (const r of all) {
      if (!runnable(r) || active.has(r.id)) continue;
      const adm = admission(r, all, { activeIds: active });
      if (!adm.ok) { log(`… ${r.id} waits (${adm.reason})`); continue; }
      if (!lock(r.id)) continue;
      try { await run(r.id); } catch (e) { log(`✖ ${r.id}: ${e.message}`); T.addComment(r.id, { author: 'orchestrator', stage: r.status, body: `⚠ run failed: ${e.message}` }); } finally { unlock(r.id); }
    }
    if (once) return;
    await new Promise((x) => setTimeout(x, intervalMs));
  }
}

/** Per-request numbers: cost, wall time, human wait per gate, runs. */
function metrics() {
  return T.listRequests().map((r) => {
    const runs = r.runs || [];
    const first = runs[0] && Date.parse(runs[0].startedAt); const last = runs.length && Date.parse(runs[runs.length - 1].endedAt || runs[runs.length - 1].startedAt);
    const humanWaitMin = {};
    const comments = T.listComments(r.id);
    for (const g of [1, 2]) { const at = comments.find((c) => new RegExp(`→ awaiting_gate_${g}`).test(c.body)); const dec = (r.gates[g] || {}).at || (r.gates[g] || {}).rejectedAt; if (at && dec) humanWaitMin[g] = Math.round((Date.parse(dec) - Date.parse(at.at)) / 60000); }
    return { id: r.id, kind: r.kind, size: r.size, status: r.status, costUsd: spent(r), runs: runs.length, wallMin: first && last ? Math.round((last - first) / 60000) : null, humanWaitMin, loops: r.loops, writes: r.writes, touches: comments.filter((c) => !['orchestrator'].includes(c.author) && !Object.values(agents).some((a) => a.label === c.author) && c.author !== r.reporter).length + (r.gates[1].approved ? 1 : 0) + (r.gates[2].approved ? 1 : 0) };
  });
}

module.exports = {
  pipeline, agents, KINDS, WORKERS, laneFor, isParent, isFast, classify, transition, agentsForStage, assertPreconditions, budgetFor, loopLimit, spent, workerFor,
  buildCtx, postChecks, cfgFor, runAgent, run, resumeFromArtifacts, markAborted, reconcile, blockedInfo, blockedStage, stageArtifactsPresent,
  approve, reject, decideProposal, answer, sendBack, raiseBudget, grantLoop, requeue, cancel, amend, override, enqueue, dequeue, pendingLessons, acceptLessons,
  lock, unlock, lockHolder, runnable, admission, worker, metrics, spawnChildren, childrenDone, estimateCost,
};
