'use strict';
// The day's digest, the autonomy level and the eleven metrics, from fixture request folders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox } = require('./helpers');
const tmp = sandbox('digest');
process.env.LAB_POLICY_DIR = path.join(tmp, 'policy');
const T = require('../src/request');
const PR = require('../src/proposals');
const DG = require('../src/digest');

const BIZ = 'biz-dg'; const TODAY = DG.today(); const YESTERDAY = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
function mk(title, over = {}) { const r = T.createRequest({ title, body: 'b', reporter: 'Mo' }); Object.assign(r, { subject: { businessIds: [BIZ] }, client: { businessId: BIZ }, size: 'S', kind: 'change_request' }, over); T.saveRequest(r); return r; }
const run = (stage, cost, start, end) => ({ n: 1, stage, agent: 'x', startedAt: start, endedAt: end, costUsd: cost, status: 'ok' });

test('assemble: applied today under policy (reversible within 30 days), decisions, awaiting input, paused, review suggested, totals', () => {
  // 1. delivered zero-touch with a policy apply today, every done item code-judged → L4, not review-suggested
  const a = mk('Recode payments to bills', { status: 'done', touches: 0, done: [{ id: 'D-1', text: 'pairs', evaluator: 'proposals_pairwise' }], runs: [run('execute', 1.5, `${TODAY}T08:00:00Z`, `${TODAY}T08:10:00Z`)] });
  T.writeArtifact(a.id, 'checks.json', { items: [{ id: 'D-1', pass: true }], pass: true, failing: [] });
  T.writeArtifact(a.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true, evidence: 'R-1 reproduced' }], reproduced: [{ seq: 1, ok: true }, { seq: 2, ok: false }] });
  let p = PR.add(a.id, { kind: 'recode_to_bill', tier: 'A', summary: 'Recode 4 payments', method: 'PUT', path: '/x', body: {}, amount: 1200 }).proposal;
  PR.decideByPolicy(a.id, p.id, { version: 3, reason: 'exact match' }); PR.markApplied(a.id, p.id, { appliedRef: { id: 'rc-1', at: `${TODAY}T08:09:00Z`, by: 'policy@v3' } });
  p = PR.add(a.id, { kind: 'recode_to_bill', tier: 'A', summary: 'Recode 1 more', method: 'PUT', path: '/x', body: {}, amount: 50 }).proposal;
  PR.decideByPolicy(a.id, p.id, { version: 3 }); PR.markApplied(a.id, p.id, { appliedRef: { id: 'rc-2', at: `${YESTERDAY}T08:09:00Z` } });
  // 2. a human-approved apply today is not in "applied" (the person already knows) but counts in totals
  const h = mk('Vendors from W-9s', { status: 'done', touches: 3, runs: [run('execute', 2, `${TODAY}T09:00:00Z`, `${TODAY}T09:30:00Z`)] });
  p = PR.add(h.id, { kind: 'vendor', tier: 'B', summary: 'v', method: 'POST', path: '/x', body: {}, amount: 10 }).proposal; PR.decide(h.id, p.id, { status: 'approved', by: 'Mo' }); PR.markApplied(h.id, p.id, { appliedRef: { id: 'v1', at: `${TODAY}T09:20:00Z` } });
  // 3. decisions: Gate 2 with a tier B pending, and a question
  const g = mk('Accrue cleaning', { status: 'awaiting_gate_2' });
  PR.add(g.id, { kind: 'accrual', tier: 'B', summary: 'Accrue 2,400', method: 'POST', path: '/x', body: {}, amount: 2400 }); PR.add(g.id, { kind: null, tier: 'C', summary: 'Capitalise?', question: 'Capitalise?' });
  const q = mk('Which entity', { status: 'intake', pendingQuestions: ['Which entity?'] });
  // 4. awaiting input
  const i = mk('Payroll tie-out', { status: 'awaiting_input', inputsStage: 'execute', inputsNeeded: [{ name: 'Gusto register', period: '2026-10', why: 'tie-out', acceptedTypes: ['csv'], askedAt: `${TODAY}T07:00:00Z`, receivedAt: null, missing: false }, { name: 'old', askedAt: `${TODAY}T07:00:00Z`, receivedAt: `${TODAY}T07:30:00Z` }] });
  // 5. paused: blocked twice
  const b = mk('SCF rebuild', { status: 'blocked', blocked: { stage: 'scope', agent: 'planner', kind: 'gap', gap: 'compute', reason: 'compute: no verb' } });
  T.addComment(b.id, { author: 'orchestrator', stage: 'scope', body: '→ blocked (compute: no verb)' }); T.addComment(b.id, { author: 'orchestrator', stage: 'scope', body: '→ blocked (compute: still no verb)' });
  const b1 = mk('Blocked once', { status: 'blocked', blocked: { stage: 'execute', kind: 'stage', reason: 'x' } }); T.addComment(b1.id, { author: 'orchestrator', stage: 'execute', body: '→ blocked (x)' });
  // 6. review suggested: delivered, zero touch, one done item judged only by the model
  const m = mk('Memo on lease', { status: 'done', touches: 0, done: [{ id: 'D-1', text: 'xlsx opens', evaluator: 'export_opens' }, { id: 'D-2', text: 'memo names the drivers' }] });
  T.writeArtifact(m.id, 'checks.json', { items: [{ id: 'D-1', pass: true }], pass: true, failing: [] }); T.writeArtifact(m.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true }, { id: 'D-2', pass: true, evidence: 'reads well' }], reproduced: [] });
  // another business: never in this digest
  const other = T.createRequest({ title: 'elsewhere', body: '' }); other.status = 'awaiting_gate_2'; other.subject = { businessIds: ['someone-else'] }; T.saveRequest(other);

  const d = DG.assemble(BIZ, TODAY);
  assert.equal(d.businessId, BIZ); assert.equal(d.date, TODAY); assert.ok(fs.existsSync(d.file)); assert.match(d.file, new RegExp(`digest/${BIZ}/${TODAY}\\.json$`));
  assert.equal(d.applied.length, 1); assert.equal(d.applied[0].proposal, 'P-1'); assert.equal(d.applied[0].reversible, true); assert.equal(d.applied[0].by, 'policy@v3'); assert.equal(d.applied[0].policyVersion, 3); assert.match(d.applied[0].memo, /Recode 4 payments · exact match/); assert.equal(d.applied[0].amount, 1200);
  assert.equal(d.decisions.length, 2); const gd = d.decisions.find((x) => x.request === g.id); assert.equal(gd.gate, 2); assert.deepEqual(gd.pending.map((x) => x.tier), ['B', 'C']); assert.deepEqual(d.decisions.find((x) => x.request === q.id).questions, ['Which entity?']);
  assert.equal(d.awaitingInput.length, 1); assert.deepEqual(d.awaitingInput[0].inputs.map((x) => x.name), ['Gusto register']);
  assert.deepEqual(d.paused.map((x) => x.request), [b.id]); assert.equal(d.paused[0].gap, 'compute'); assert.equal(d.paused[0].timesBlocked, 2);
  assert.deepEqual(d.reviewSuggested.map((x) => x.request), [m.id]); assert.deepEqual(d.reviewSuggested[0].items.map((x) => x.id), ['D-2']);
  // delivered today: every request that reached done today, zero-touch or not, with its level, judged items and files
  const dl = Object.fromEntries(d.delivered.map((x) => [x.request, x]));
  assert.ok(dl[a.id] && dl[h.id], 'both the policy-applied and the human-approved request were delivered today');
  assert.equal(dl[a.id].level, 'L4'); assert.equal(dl[a.id].touches, 0); assert.deepEqual(dl[a.id].checks, { passed: 1, total: 1 }); assert.equal(dl[a.id].costUsd, 1.5); assert.equal(dl[a.id].minutes, 10); assert.deepEqual(dl[a.id].files, []); assert.equal(dl[a.id].exceptions, null);
  assert.equal(dl[h.id].level, 'L3'); assert.equal(dl[h.id].touches, 3);
  assert.equal(d.totals.delivered, d.delivered.length);
  // rows carry the Dime-side id and the words for what a decision waits on
  assert.equal(gd.requestId, null, 'desk-only request: no Dime id'); assert.equal(gd.needs, 'Approve 1 change and answer 1 question');
  assert.equal(d.decisions.find((x) => x.request === q.id).needs, '1 question for you');
  assert.equal(d.applied[0].proposalId, 'P-1'); assert.equal(d.applied[0].requestId, null); assert.equal(d.applied[0].at, d.applied[0].appliedAt);
  assert.equal(d.totals.applied, 1); assert.equal(d.totals.reversed, 0); assert.equal(d.totals.costUsd, 3.5, 'cost of the requests active today'); assert.ok(d.totals.requests >= 2); assert.equal(d.totals.zeroTouch >= 1, true); assert.equal(d.totals.l4, 1);
  assert.ok(d.hash && d.hash.length === 40); assert.equal(DG.assemble(BIZ, TODAY, { write: false }).hash, d.hash, 'the hash is stable for an unchanged day');
  // a reversal today shows in the row and the totals
  PR.markReversed(a.id, 'P-1', { by: 'Mo', reason: 'wrong bill' });
  const d2 = DG.assemble(BIZ, TODAY, { write: false });
  assert.equal(d2.applied[0].status, 'reversed'); assert.equal(d2.applied[0].reversible, false); assert.match(d2.applied[0].memo, /Reversed by Mo · wrong bill/); assert.equal(d2.totals.reversed, 1); assert.notEqual(d2.hash, d.hash);
  assert.equal(DG.assemble(BIZ, YESTERDAY, { write: false }).applied[0].proposal, 'P-2', 'yesterday\'s digest lists yesterday\'s apply');
  assert.ok(DG.businesses().includes(BIZ) && DG.businesses().includes('someone-else'));
});

test('levelOf: L4 only when delivered, untouched, and every done item code-judged or Verifier-reproduced', () => {
  const r = mk('lvl', { status: 'done', touches: 0, done: [{ id: 'D-1', text: 'a', evaluator: 'x' }, { id: 'D-2', text: 'b' }] });
  T.writeArtifact(r.id, 'checks.json', { items: [{ id: 'D-1', pass: true }], pass: true, failing: [] });
  T.writeArtifact(r.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true }, { id: 'D-2', pass: true, evidence: 'figure 12,418.22 reproduced from R-3' }], reproduced: [{ seq: 3, ok: true }] });
  assert.equal(DG.levelOf(T.loadRequest(r.id)), 'L4');
  T.writeArtifact(r.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true }, { id: 'D-2', pass: true, evidence: 'the memo reads well' }], reproduced: [] });
  assert.equal(DG.levelOf(T.loadRequest(r.id)), 'L3', 'a prose item judged only by the model');
  T.writeArtifact(r.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true }, { id: 'D-2', pass: true, figures: { netIncome: 12418.22 } }], reproduced: [] });
  assert.equal(DG.levelOf(T.loadRequest(r.id)), 'L4', 'figures on the verifier item count as reproduced');
  assert.equal(DG.levelOf({ ...T.loadRequest(r.id), touches: 1 }), 'L3');
  assert.equal(DG.levelOf({ ...T.loadRequest(r.id), status: 'verify' }), 'L3');
  T.writeArtifact(r.id, 'checks.json', { items: [{ id: 'D-1', pass: true, advisory: true }], pass: true, failing: [] });
  assert.equal(DG.levelOf(T.loadRequest(r.id)), 'L3', 'an advisory check is not a code judgment');
  assert.equal(DG.levelOf(mk('empty', { status: 'done', touches: 0, done: [] })), 'L3');
});

test('metricsOf: the eleven keys', () => {
  const r = mk('metrics', { status: 'done', touches: 2, questionsAsked: 1, setup: { entity: { answers: { apAccounts: ['2000'] } }, recipe: { answers: { threshold: 500 } } }, runs: [run('intake', 0.4, '2026-11-23T08:00:00Z', '2026-11-23T08:02:00Z'), run('execute', 2.1, '2026-11-23T08:02:00Z', '2026-11-23T08:20:00Z')], inputsNeeded: [{ name: 'a', askedAt: '2026-11-23T08:20:00Z', receivedAt: '2026-11-23T09:20:00Z' }] });
  T.addComment(r.id, { author: 'orchestrator', stage: 'verify', body: '→ awaiting_gate_2 (verified; 1 proposal(s) wait)' });
  const x = T.loadRequest(r.id); x.gates[2] = { approved: true, by: 'Mo', at: new Date(Date.parse(T.listComments(r.id).slice(-1)[0].at) + 30 * 60000).toISOString(), note: null }; T.saveRequest(x);
  T.writeArtifact(r.id, 'verify.json', { verdict: 'pass', items: [], reproduced: [{ seq: 1, ok: true }, { seq: 2, ok: true }, { seq: 3, ok: false }] });
  let p = PR.add(r.id, { kind: 'vendor', tier: 'A', summary: 'v', method: 'POST', path: '/x', body: {} }).proposal; PR.decideByPolicy(r.id, p.id, { version: 1 }); PR.markApplied(r.id, p.id, { appliedRef: { id: 'v1' } });
  p = PR.add(r.id, { kind: 'vendor', tier: 'A', summary: 'v2', method: 'POST', path: '/x', body: {} }).proposal; PR.decideByPolicy(r.id, p.id, { version: 1 }); PR.markApplied(r.id, p.id, { appliedRef: { id: 'v2' } }); PR.markReversed(r.id, p.id, { by: 'Mo', reason: 'dup' });
  p = PR.add(r.id, { kind: 'bill', tier: 'B', summary: 'b', method: 'POST', path: '/x', body: {}, amount: 1 }).proposal; PR.decide(r.id, p.id, { status: 'approved', by: 'Mo' }); PR.markApplied(r.id, p.id, { appliedRef: { id: 'b1' } });
  const m = DG.metricsOf(T.loadRequest(r.id));
  assert.deepEqual(Object.keys(m).sort(), [...DG.METRIC_KEYS].sort());
  assert.equal(m.touches, 2); assert.equal(m.costUsd, 2.5); assert.equal(m.runs, 2); assert.equal(m.wallMs, 20 * 60000);
  assert.equal(m.humanWaitMs, 30 * 60000 + 60 * 60000, 'gate wait plus the input wait'); assert.equal(m.verifierReproduced, 2); assert.equal(m.verifierTotal, 3);
  assert.equal(m.autoApplied, 2); assert.equal(m.reversed, 1); assert.equal(m.setupHits, 2); assert.equal(m.questionsAsked, 1);
  const bare = DG.metricsOf(mk('bare'));
  for (const k of DG.METRIC_KEYS) assert.equal(typeof bare[k], 'number', k);
});
