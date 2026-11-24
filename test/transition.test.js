'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('./helpers');
sandbox('tr');
const T = require('../src/request');
const O = require('../src/orchestrator');

function fresh(over = {}) { const r = T.createRequest({ title: 'x', body: 'y' }); return { ...r, ...over }; }

test('intake: a small read-only request takes the fast lane; writes or size M go to scope; questions park', () => {
  let tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'report', size: 'S', writes: false, worker: 'analyst', subject: { businessIds: ['b1'] }, done: [{ text: 'xlsx' }] });
  assert.equal(tr.status, 'execute'); assert.equal(tr.patch.scoped, false); assert.equal(tr.patch.done[0].id, 'D-1');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'report', size: 'M', writes: false });
  assert.equal(tr.status, 'scope'); assert.equal(tr.patch.scoped, true);
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'data_task', size: 'S', writes: true });
  assert.equal(tr.status, 'scope', 'writes never take the fast lane');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'report', size: 'L' });
  assert.equal(tr.status, 'scope');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'needs_input', questions: ['a?', 'b?', 'c?', 'd?'], kind: 'report', size: 'S' });
  assert.equal(tr.status, 'intake'); assert.equal(tr.stop, true); assert.equal(tr.patch.pendingQuestions.length, 3, 'at most three questions');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'nonsense', size: 'XL' });
  assert.equal(tr.patch.kind, 'question'); assert.equal(tr.patch.size, 'S');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S' });
  assert.equal(tr.patch.writes, true, 'a change request implies writes'); assert.equal(tr.patch.worker, 'bookkeeper');
});

test('scope: a valid plan goes to Gate 1 and carries writes, done items and children', () => {
  assert.equal(O.transition(fresh(), 'scope', 'planner', { status: 'ok' }, { planError: 'plan.json missing' }).status, 'blocked');
  // a tier-B write (journal_entry) keeps Gate 1; an all-tier-A plan skips it (see the "skips Gate 1" case below)
  let tr = O.transition(fresh({ kind: 'data_task' }), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'M', writes: [{ kind: 'vendor', summary: 'x' }, { kind: 'journal_entry', summary: 'y' }], done: [{ text: 'a' }] } });
  assert.equal(tr.status, 'awaiting_gate_1'); assert.equal(tr.stop, true); assert.equal(tr.patch.writes, true); assert.equal(tr.patch.done[0].id, 'D-1'); assert.equal(tr.patch.gates[1].approved, false);
  tr = O.transition(fresh({ kind: 'report', size: 'L' }), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'L', children: [{ title: 'a' }, { title: 'b' }] } });
  assert.equal(tr.patch.children.length, 2); assert.equal(tr.patch.children[0].requestId, null);
  tr = O.transition(fresh(), 'scope', 'planner', { status: 'needs_input', questions: ['q'] });
  assert.equal(tr.status, 'scope'); assert.deepEqual(tr.patch.pendingQuestions, ['q']);
});

test('execute: any worker hands to verify; questions park; an unknown agent blocks', () => {
  for (const w of ['analyst', 'investigator', 'preparer', 'bookkeeper']) assert.equal(O.transition(fresh(), 'execute', w, { status: 'ok' }).status, 'verify');
  assert.equal(O.transition(fresh(), 'execute', 'analyst', { status: 'needs_input', questions: ['q'] }).status, 'execute');
  assert.equal(O.transition(fresh(), 'execute', 'verifier', { status: 'ok' }).status, 'blocked');
  assert.equal(O.transition(fresh(), 'execute', 'analyst', { status: 'fail', summary: 'boom' }).status, 'blocked');
});

test('verify: pass goes to Gate 2 when proposals wait, else deliver; fail loops twice then blocks', () => {
  assert.equal(O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 0 } }).status, 'deliver');
  assert.equal(O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 2 } }).status, 'awaiting_gate_2');
  assert.equal(O.transition(fresh({ proposalsApplied: true }), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 0 } }).status, 'deliver', 'after apply, verify leads to deliver');
  let tr = O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'fail', failing: ['D-3'] });
  assert.equal(tr.status, 'execute'); assert.equal(tr.patch.loops.verify, 1); assert.match(tr.reason, /D-3/);
  tr = O.transition(fresh({ loops: { verify: 2 } }), 'verify', 'verifier', { status: 'ok' }, { verdict: 'fail', failing: ['D-3'] });
  assert.equal(tr.status, 'blocked'); assert.match(tr.reason, /keeps failing/);
  assert.equal(O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdictError: 'no verdict' }).status, 'blocked');
});

test('apply and deliver', () => {
  let tr = O.transition(fresh(), 'apply', 'applier', { status: 'ok' });
  assert.equal(tr.status, 'verify'); assert.equal(tr.patch.proposalsApplied, true);
  assert.equal(O.transition(fresh(), 'apply', 'applier', { status: 'blocked', summary: 'closed period' }).status, 'blocked');
  assert.equal(O.transition(fresh(), 'deliver', 'deliverer', { status: 'ok' }, { hasSummary: false }).status, 'blocked');
  tr = O.transition(fresh(), 'deliver', 'deliverer', { status: 'ok' }, { hasSummary: true });
  assert.equal(tr.status, 'done'); assert.equal(tr.stop, true);
});

test('agents for a stage: the worker is the one intake chose, else the kind decides', () => {
  assert.deepEqual(O.agentsForStage({ kind: 'report' }, 'execute'), ['analyst']);
  assert.deepEqual(O.agentsForStage({ kind: 'question' }, 'execute'), ['investigator']);
  assert.deepEqual(O.agentsForStage({ kind: 'data_task', worker: 'bookkeeper' }, 'execute'), ['bookkeeper']);
  assert.deepEqual(O.agentsForStage({}, 'verify'), ['verifier']);
  assert.deepEqual(O.agentsForStage({}, 'awaiting_gate_1'), []);
});

test('preconditions: scoped execute needs Gate 1, apply needs Gate 2, budget blocks', () => {
  const r = fresh({ scoped: true });
  assert.throws(() => O.assertPreconditions(r, 'execute', 'analyst'), /Gate 1/);
  assert.doesNotThrow(() => O.assertPreconditions(fresh({ scoped: false }), 'execute', 'analyst'));
  assert.throws(() => O.assertPreconditions(fresh(), 'apply', 'applier'), /Gate 2/);
  const spent = fresh({ size: 'S', budgetUsd: 8, runs: [{ costUsd: 9 }] }); // an explicit budget: the size default in pipeline.json is an operator setting
  assert.throws(() => O.assertPreconditions(spent, 'execute', 'analyst'), /budget exhausted/);
});

test('human actions are the only writers of gates and proposals; names are required', () => {
  const r = T.createRequest({ title: 'g', body: 'b' }); r.status = 'awaiting_gate_1'; r.scoped = true; T.saveRequest(r);
  assert.throws(() => O.approve(r.id, 1, ''), /--by/);
  assert.throws(() => O.reject(r.id, 1, 'Mo', ''), /note is required/);
  const a = O.approve(r.id, 1, 'Mo', 'go', 'approver');
  assert.equal(a.status, 'execute'); assert.equal(a.gates[1].by, 'Mo'); assert.equal(a.gates[1].approvals[0].role, 'approver');
  const PR = require('../src/proposals');
  const r2 = T.createRequest({ title: 'g2', body: 'b' }); r2.status = 'awaiting_gate_2'; T.saveRequest(r2);
  PR.add(r2.id, { kind: 'vendor', tier: 'A', summary: 's', method: 'POST', path: '/x', body: {} });
  PR.add(r2.id, { kind: 'journal_entry', tier: 'B', summary: 'accrual', method: 'POST', path: '/y', body: { amount: 2400 }, amount: 2400 });
  PR.add(r2.id, { kind: null, tier: 'C', summary: 'capitalise?', question: 'capitalise?' });
  assert.throws(() => O.approve(r2.id, 2, 'Mo'), /undecided/);
  O.decideProposal(r2.id, 'P-1', 'Mo', { decision: 'approve' });
  const b = O.decideProposal(r2.id, 'P-2', 'Mo', { decision: 'approve', amount: 2450 });
  assert.equal(b.amountApproved, 2450); assert.equal(b.body.amount, 2450, 'the edited amount replaces the estimate in the body');
  assert.throws(() => O.decideProposal(r2.id, 'P-3', 'Mo', { decision: 'approve' }), /tier C/);
  assert.throws(() => O.approve(r2.id, 2, 'Mo'), /undecided/, 'the question still waits');
  O.decideProposal(r2.id, 'P-3', 'Mo', { decision: 'answer', note: 'expense it' });
  const g2 = O.approve(r2.id, 2, 'Mo');
  assert.equal(g2.status, 'apply');
  const r3 = T.createRequest({ title: 'g3', body: 'b' }); r3.status = 'awaiting_gate_2'; T.saveRequest(r3);
  PR.add(r3.id, { kind: 'vendor', tier: 'A', summary: 's', method: 'POST', path: '/x', body: {} });
  O.decideProposal(r3.id, 'P-1', 'Mo', { decision: 'reject', note: 'duplicate' });
  assert.equal(O.approve(r3.id, 2, 'Mo').status, 'deliver', 'nothing approved: skip apply');
});

test('send back needs a note and re-enters execute with it', () => {
  const r = T.createRequest({ title: 's', body: 'b' }); r.status = 'done'; r.size = 'S'; T.saveRequest(r);
  assert.throws(() => O.sendBack(r.id, 'Mo', ''), /note/);
  const x = O.sendBack(r.id, 'Mo', 'add the memo');
  assert.equal(x.status, 'execute'); assert.equal(x.loops.verify, 1); assert.equal(x.sendBackNote, 'add the memo');
});

test('send back respects the loop budget; grant and override are recorded', () => {
  const r = T.createRequest({ title: 's', body: 'b' }); r.status = 'done'; r.size = 'S'; r.loops = { verify: 2 }; T.saveRequest(r);
  assert.throws(() => O.sendBack(r.id, 'Mo', 'again'), /loop budget/);
  O.grantLoop(r.id, 'Mo');
  assert.equal(O.sendBack(r.id, 'Mo', 'again').status, 'execute');
  const b = T.createRequest({ title: 'bl', body: 'b' }); b.status = 'blocked'; b.blocked = { stage: 'verify', agent: 'verifier', kind: 'loop_verify', reason: 'x' }; T.saveRequest(b);
  const o = O.override(b.id, 'Mo', 'D-3', 'the memo is fine');
  assert.equal(o.status, 'deliver'); assert.equal(o.overrides[0].by, 'Mo');
  const c = T.createRequest({ title: 'bud', body: 'b' }); c.status = 'blocked'; c.blocked = { stage: 'execute', agent: 'analyst', kind: 'budget', reason: 'x' }; c.runs = [{ costUsd: 8 }]; T.saveRequest(c);
  assert.throws(() => O.raiseBudget(c.id, 'Mo', 5), /exceed/);
  assert.equal(O.raiseBudget(c.id, 'Mo', 20).status, 'execute');
  assert.equal(O.cancel(c.id, 'Mo', 'not needed').status, 'cancelled');
  assert.throws(() => O.cancel(c.id, 'Mo', 'again'), /already/);
});

test('a failed apply can be corrected: the proposal body is edited and re-approved while blocked in apply, then requeued', () => {
  const PR = require('../src/proposals');
  const r = T.createRequest({ title: 'fix', body: 'b' }); r.status = 'blocked'; r.blocked = { stage: 'apply', agent: 'applier', kind: 'stage', reason: 'email invalid' }; r.gates[2] = { approved: true, by: 'Mo', at: 'x', note: null }; T.saveRequest(r);
  PR.add(r.id, { kind: 'vendor', tier: 'A', summary: 's', method: 'POST', path: '/x', body: { name: 'v', email: 'a@b.example' } });
  PR.markApplied(r.id, 'P-1', { error: '422: email must be valid' });
  const it = O.decideProposal(r.id, 'P-1', 'Mo', { decision: 'approve', body: { name: 'v', email: 'a@b.com' } });
  assert.equal(it.status, 'approved'); assert.equal(it.body.email, 'a@b.com'); assert.equal(it.bodyOriginal.email, 'a@b.example', 'the original body is kept');
  assert.equal(O.requeue(r.id, 'Mo', 'apply').status, 'apply');
  assert.doesNotThrow(() => O.assertPreconditions(T.loadRequest(r.id), 'apply', 'applier'));
  const other = T.createRequest({ title: 'nope', body: 'b' }); other.status = 'execute'; T.saveRequest(other);
  assert.throws(() => O.decideProposal(other.id, 'P-1', 'Mo', { decision: 'approve' }), /not at Gate 2/);
});

test('admission: run limit, and a writing request never shares a business with another running one', () => {
  const a = { id: 'REQ-1', subject: { businessIds: ['b1'] }, writes: true };
  const b = { id: 'REQ-2', subject: { businessIds: ['b1'] }, writes: false };
  const c = { id: 'REQ-3', subject: { businessIds: ['b2'] }, writes: false };
  assert.equal(O.admission(a, [a, b, c], { activeIds: new Set(['REQ-2']) }).ok, false);
  assert.equal(O.admission(b, [a, b, c], { activeIds: new Set(['REQ-1']) }).ok, false, 'a read-only request waits for a writer on the same business');
  assert.equal(O.admission(b, [a, b, c], { activeIds: new Set(['REQ-3']) }).ok, true);
  assert.equal(O.admission(b, [a, b, c], { activeIds: new Set(['REQ-1', 'REQ-3']), maxRuns: 2 }).ok, false);
});

test('classify: fast-lane judgment and worker choice', () => {
  assert.equal(O.isFast({ kind: 'report', size: 'S', writes: false, pendingQuestions: [] }), true);
  assert.equal(O.isFast({ kind: 'report', size: 'S', writes: true, pendingQuestions: [] }), false);
  assert.equal(O.isFast({ kind: 'data_task', size: 'S', writes: false, pendingQuestions: [] }), false);
  assert.equal(O.workerFor({ kind: 'question' }), 'investigator');
  assert.equal(O.workerFor({ kind: 'question', worker: 'analyst' }), 'analyst');
});

// ---------------------------------------------------------------- RD-2: policy-decided gates, awaiting_input, gap vocabulary, touches
const POL = require('../src/policy');
const PR2 = require('../src/proposals');
process.env.LAB_POLICY_DIR = require('path').join(process.env.LAB_RUNS_DIR, 'policy');
const basePolicy = () => ({ ...POL.load(null), kinds: {} });

test('RD-2 isFast: a writes request is fast only when every planned write decided to tier A with autoApply', () => {
  const s = { kind: 'change_request', size: 'S', writes: true, pendingQuestions: [] };
  assert.equal(O.isFast(s), false, 'no decision recorded: never fast');
  assert.equal(O.isFast({ ...s, writeTiers: [{ kind: 'vendor', tier: 'A', autoApply: true }] }), true);
  assert.equal(O.isFast({ ...s, writeTiers: [{ kind: 'vendor', tier: 'A', autoApply: true }, { kind: 'accrual', tier: 'B', autoApply: false }] }), false);
  assert.equal(O.isFast({ ...s, writeTiers: [{ kind: 'vendor', tier: 'A', autoApply: false }] }), false, 'writes disabled: tier A but no autoApply');
  assert.equal(O.isFast({ ...s, writeTiers: [] }), false);
  assert.equal(O.isFast({ ...s, size: 'M', writeTiers: [{ kind: 'vendor', tier: 'A', autoApply: true }] }), false, 'size M is never fast');
  assert.equal(O.isFast({ ...s, writeTiers: [{ kind: 'vendor', tier: 'A', autoApply: true }], pendingQuestions: ['q'] }), false);
  assert.equal(O.isFast({ kind: 'report', size: 'S', writes: false, pendingQuestions: [] }), true, 'the read-only rule is unchanged');
});

test('RD-2 intake: the recipe\'s writes are decided under the entity policy; all tier A takes the fast lane with writes', () => {
  const recipe = { id: 'R56', writes: [{ kind: 'vendor' }] };
  let tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S', writes: true, worker: 'bookkeeper', recipeId: 'R56', recipeVersion: 1 }, { recipe, policy: basePolicy() });
  assert.equal(tr.status, 'execute'); assert.equal(tr.patch.scoped, false); assert.deepEqual(tr.patch.writeTiers.map((t) => [t.kind, t.tier]), [['vendor', 'A']]); assert.match(tr.reason, /tier A under policy/);
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S', writes: true }, { recipe: { id: 'R20', writes: [{ kind: 'vendor' }, { kind: 'journal_entry' }] }, policy: basePolicy() });
  assert.equal(tr.status, 'scope'); assert.deepEqual(tr.patch.writeTiers.map((t) => t.tier), ['A', 'B']); assert.match(tr.reason, /journal_entry B/);
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S', writes: true }, { recipe, policy: { ...basePolicy(), writesEnabled: false } });
  assert.equal(tr.status, 'scope', 'writes disabled on the entity: tier A still, but no autoApply, so no fast lane');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S', writes: true }, { recipe, policy: { ...basePolicy(), alwaysHuman: ['vendor'] } });
  assert.equal(tr.status, 'scope'); assert.equal(tr.patch.writeTiers[0].tier, 'human');
  tr = O.transition(fresh(), 'intake', 'intake', { status: 'ok', kind: 'change_request', size: 'S', writes: true }, { recipe: null, policy: basePolicy() });
  assert.equal(tr.status, 'scope', 'no recipe, no decision: scope as before'); assert.equal(tr.patch.writeTiers, undefined);
});

test('RD-2 scope: plan.writes are decided and carried; inputs the Planner cannot resolve park the request in awaiting_input', () => {
  let tr = O.transition(fresh({ kind: 'change_request' }), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'M', writes: [{ kind: 'vendor', summary: 'x' }, { kind: 'accrual', summary: 'y', amount: 900 }] }, policy: basePolicy() });
  assert.equal(tr.status, 'awaiting_gate_1'); assert.deepEqual(tr.patch.writeTiers.map((t) => [t.kind, t.tier]), [['vendor', 'A'], ['accrual', 'B']]);
  tr = O.transition(fresh(), 'scope', 'planner', { status: 'needs_input', inputs: [{ name: 'Gusto register', period: '2026-10', why: 'tie-out', acceptedTypes: ['csv'] }] });
  assert.equal(tr.status, 'awaiting_input'); assert.equal(tr.stop, true); assert.equal(tr.patch.inputsStage, 'scope'); assert.equal(tr.patch.inputsNeeded[0].name, 'Gusto register'); assert.equal(tr.patch.inputsNeeded[0].receivedAt, null); assert.ok(tr.patch.inputsNeeded[0].askedAt); assert.match(tr.reason, /^input: Gusto register/);
  tr = O.transition(fresh(), 'scope', 'planner', { status: 'needs_input', questions: ['which entity?'] });
  assert.equal(tr.status, 'scope', 'questions without inputs park as before'); assert.deepEqual(tr.patch.pendingQuestions, ['which entity?']);
  tr = O.transition(fresh(), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'M', writes: [], inputsNeeded: [{ name: 'bank statement', period: '2026-10' }, { name: 'standing file', standing: true }] }, policy: basePolicy() });
  assert.equal(tr.status, 'awaiting_input', 'plan.json may name the missing inputs'); assert.equal(tr.patch.inputsNeeded.length, 1, 'a standing input is not asked of a person');
  tr = O.transition(fresh(), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'M', writes: [], inputsNeeded: [] }, policy: basePolicy() });
  assert.equal(tr.status, 'awaiting_gate_1');
});

test('RD-2 execute: a worker that needs a document parks the request in awaiting_input; questions alone park in execute', () => {
  let tr = O.transition(fresh(), 'execute', 'analyst', { status: 'needs_input', inputs: [{ name: 'October statement' }] });
  assert.equal(tr.status, 'awaiting_input'); assert.equal(tr.patch.inputsStage, 'execute'); assert.deepEqual(tr.patch.pendingQuestions, []);
  tr = O.transition(fresh(), 'execute', 'bookkeeper', { status: 'needs_input', inputs: [], questions: ['q'] });
  assert.equal(tr.status, 'execute'); assert.deepEqual(tr.patch.pendingQuestions, ['q']);
  tr = O.transition(fresh(), 'execute', 'analyst', { status: 'needs_input', inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.equal(tr.patch.inputsNeeded.length, 6, 'at most six inputs at once');
});

test('RD-2 verify: tier-A proposals apply under policy before any gate, once; what remains goes to Gate 2 or deliver', () => {
  const tierA = [{ id: 'P-1', kind: 'vendor', tier: 'A', autoApply: true, reason: 'desk default for vendor', policyVersion: 3 }];
  let tr = O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 2 }, tierA });
  assert.equal(tr.status, 'apply'); assert.equal(tr.stop, false); assert.match(tr.reason, /1 tier-A change\(s\) apply under policy v3 before any gate/);
  assert.deepEqual(tr.patch.policyApply.items, [{ id: 'P-1', kind: 'vendor', reason: 'desk default for vendor' }]); assert.equal(tr.patch.policyApply.version, 3);
  tr = O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 2 }, tierA: [{ ...tierA[0], autoApply: false }] });
  assert.equal(tr.status, 'awaiting_gate_2', 'tier A without autoApply (writes disabled) waits for a person');
  tr = O.transition(fresh({ proposalsApplied: true }), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 1 }, tierA: [] });
  assert.equal(tr.status, 'awaiting_gate_2', 'second pass: the tier-B item still waits'); assert.equal(tr.patch.policyApply, null);
  tr = O.transition(fresh({ proposalsApplied: true }), 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 0 }, tierA: [] });
  assert.equal(tr.status, 'deliver', 'second pass with nothing pending: deliver');
  const g2 = fresh(); g2.gates[2] = { approved: true, by: 'Mo', at: 'x', note: null };
  tr = O.transition(g2, 'verify', 'verifier', { status: 'ok' }, { verdict: 'pass', proposals: { pending: 0 }, tierA });
  assert.equal(tr.status, 'deliver', 'after a person approved Gate 2 the policy path is not taken again');
  tr = O.transition(fresh(), 'verify', 'verifier', { status: 'ok' }, { verdict: 'fail', failing: ['D-2'], tierA });
  assert.equal(tr.status, 'execute', 'a failing verdict never applies anything');
});

test('RD-2 apply preconditions: policy approvals open the apply stage without Gate 2; the Applier re-reads the policy', () => {
  assert.throws(() => O.assertPreconditions(fresh(), 'apply', 'applier'), /Gate 2/);
  assert.doesNotThrow(() => O.assertPreconditions(fresh({ policyApply: { version: 1, items: [{ id: 'P-1' }] } }), 'apply', 'applier'));
  assert.throws(() => O.assertPreconditions(fresh({ policyApply: { version: 1, items: [] } }), 'apply', 'applier'), /Gate 2/);
  const r = T.createRequest({ title: 'pa', body: 'b' }); r.status = 'apply'; T.saveRequest(r);
  PR2.add(r.id, { kind: 'vendor', tier: 'A', summary: 'v', method: 'POST', path: '/api/v1/accountant/vendor', body: {} });
  PR2.add(r.id, { kind: 'vendor', tier: 'B', summary: 'v2', method: 'POST', path: '/api/v1/accountant/vendor', body: {}, amount: 3 });
  const done = O.applyTierA(r.id, { version: 2, items: [{ id: 'P-1', kind: 'vendor', reason: 'r' }, { id: 'P-2', kind: 'vendor', reason: 'r' }] });
  assert.deepEqual(done, ['P-1', 'P-2']);
  const items = PR2.load(r.id).items; assert.equal(items[0].status, 'approved'); assert.equal(items[0].reviewedBy, 'policy@v2'); assert.deepEqual(items[0].policyDecision.tier, 'A');
  assert.equal(T.loadRequest(r.id).touches, 0, 'a policy decision is not a human touch');
  assert.ok(T.listComments(r.id).some((c) => c.author === 'policy@v2'));
  assert.throws(() => PR2.decideByPolicy(r.id, 'P-1', { version: 2 }), /policy decides only a pending proposal/);
  const back = PR2.revertToProposed(r.id, 'P-2', 'policy changed'); assert.equal(back.status, 'proposed'); assert.equal(back.reviewedBy, null); assert.equal(back.policyDeferred.reason, 'policy changed');
  assert.throws(() => PR2.revertToProposed(r.id, 'P-2', 'x'), /not a policy-approved/);
  assert.equal(PR2.summary(r.id).policyApproved, 1);
});

test('RD-2 blocked reasons carry the capability gap word; metrics count them', () => {
  let tr = O.transition(fresh(), 'scope', 'planner', { status: 'blocked', gap: 'compute', detail: 'no verb rebuilds the cash flow statement' });
  assert.equal(tr.status, 'blocked'); assert.equal(tr.gap, 'compute'); assert.equal(tr.reason, 'compute: no verb rebuilds the cash flow statement');
  for (const g of ['read', 'compute', 'change', 'prove', 'input']) assert.equal(O.transition(fresh(), 'execute', 'analyst', { status: 'blocked', gap: g, summary: 's' }).reason, `${g}: s`);
  tr = O.transition(fresh(), 'execute', 'analyst', { status: 'blocked', gap: 'weather', summary: 'rain' });
  assert.equal(tr.gap, null); assert.equal(tr.reason, 'rain', 'an unknown gap word is not a gap');
  let b = O.blockedInfo('scope', 'planner', 'compute: no verb', 'compute'); assert.equal(b.kind, 'gap'); assert.equal(b.gap, 'compute');
  b = O.blockedInfo('execute', 'analyst', 'read: the route is denied'); assert.equal(b.gap, 'read', 'the word is read off the reason when the gap is not passed');
  b = O.blockedInfo('execute', 'analyst', 'request budget exhausted ($9 of $8)'); assert.equal(b.kind, 'budget'); assert.equal(b.gap, null);
  const r = T.createRequest({ title: 'gap', body: 'b' }); r.status = 'blocked'; r.blocked = b = O.blockedInfo('scope', 'planner', 'prove: no receipt reproduces the figure', 'prove'); T.saveRequest(r);
  assert.equal(O.metrics().find((m) => m.id === r.id).gap, 'prove');
  assert.equal(O.gapCounts().now.prove >= 1, true);
});

test('RD-2 awaiting_input: a person supplies the input and the stage that asked resumes; the timeout marks inputs missing', () => {
  const r = T.createRequest({ title: 'in', body: 'b' }); r.status = 'awaiting_input'; r.inputsStage = 'scope'; r.inputsNeeded = O.normalizeInputs([{ name: 'register', period: '2026-10' }, { name: 'statement' }], 'scope'); T.saveRequest(r);
  assert.equal(O.runnable(T.loadRequest(r.id)), false);
  assert.throws(() => O.provideInput(r.id, '', 'register'), /--by/);
  assert.throws(() => O.provideInput(r.id, 'Mo', 'nope'), /not an input this request is waiting for/);
  let x = O.provideInput(r.id, 'Mo', 'register', { attachments: [{ name: 'gusto.csv' }] });
  assert.equal(x.status, 'awaiting_input', 'one input still pending'); assert.equal(x.touches, 1); assert.deepEqual(O.pendingInputs(x).map((i) => i.name), ['statement']);
  x = O.provideInput(r.id, 'Mo', 'statement', { note: 'October' });
  assert.equal(x.status, 'scope', 'back to the stage that asked'); assert.equal(x.touches, 2);
  assert.throws(() => O.provideInput(r.id, 'Mo', 'statement'), /not an input/, 'an input is received once');
  // timeout: pure judgment, then the sweep
  const old = new Date(Date.now() - 6 * 864e5).toISOString();
  const w = { status: 'awaiting_input', inputsNeeded: [{ name: 'a', askedAt: old }, { name: 'b', askedAt: new Date().toISOString() }] };
  assert.equal(O.inputsExpired(w), false, 'one input is still fresh');
  assert.equal(O.inputsExpired({ ...w, inputsNeeded: [w.inputsNeeded[0]] }), true, '5 days by default');
  assert.equal(O.inputsExpired({ ...w, inputsNeeded: [w.inputsNeeded[0]], inputTimeoutDays: 10 }), false, 'the request may carry its own timeout');
  assert.equal(O.inputsExpired({ status: 'execute', inputsNeeded: [w.inputsNeeded[0]] }), false, 'only a waiting request expires');
  const r2 = T.createRequest({ title: 'in2', body: 'b' }); r2.status = 'awaiting_input'; r2.inputsStage = 'execute'; r2.inputsNeeded = [{ name: 'a', askedAt: old, receivedAt: null, missing: false }]; T.saveRequest(r2);
  assert.deepEqual(O.expireInputs(), [r2.id]);
  const after = T.loadRequest(r2.id); assert.equal(after.status, 'execute'); assert.equal(after.inputsNeeded[0].missing, true); assert.ok(after.inputsNeeded[0].expiredAt);
  assert.deepEqual(O.expireInputs(), [], 'nothing left to expire');
});

test('RD-2 touches: every human decision counts once; the fast lane stays at zero', () => {
  const r = T.createRequest({ title: 't', body: 'b' }); r.status = 'awaiting_gate_1'; r.scoped = true; T.saveRequest(r);
  assert.equal(T.loadRequest(r.id).touches, 0);
  O.reject(r.id, 1, 'Mo', 'more'); assert.equal(T.loadRequest(r.id).touches, 1);
  const x = T.loadRequest(r.id); x.status = 'awaiting_gate_1'; T.saveRequest(x);
  O.approve(r.id, 1, 'Mo'); assert.equal(T.loadRequest(r.id).touches, 2);
  const y = T.loadRequest(r.id); y.status = 'awaiting_gate_2'; T.saveRequest(y);
  PR2.add(r.id, { kind: 'vendor', tier: 'B', summary: 'v', method: 'POST', path: '/x', body: {}, amount: 1 });
  O.decideProposal(r.id, 'P-1', 'Mo', { decision: 'approve' }); assert.equal(T.loadRequest(r.id).touches, 3);
  O.approve(r.id, 2, 'Mo'); assert.equal(T.loadRequest(r.id).touches, 4);
  const z = T.loadRequest(r.id); z.status = 'intake'; z.pendingQuestions = ['q']; T.saveRequest(z);
  O.answer(r.id, 'Mo', 'a'); assert.equal(T.loadRequest(r.id).touches, 5);
  const d = T.loadRequest(r.id); d.status = 'done'; d.size = 'S'; T.saveRequest(d);
  O.sendBack(r.id, 'Mo', 'again'); assert.equal(T.loadRequest(r.id).touches, 6);
  O.override(r.id, 'Mo', 'D-1', 'fine'); assert.equal(T.loadRequest(r.id).touches, 7);
  assert.equal(O.metrics().find((m) => m.id === r.id).touches, 7);
  T.addComment(r.id, { author: 'Mo', stage: 'execute', body: 'a plain note' }); assert.equal(T.loadRequest(r.id).touches, 7, 'a comment is not a decision');
});


test('scope: a plan whose writes all decide tier A skips Gate 1; a tier-B write, a child or size L still stops', () => {
  const policy = { version: 3, writesEnabled: true, tierByKind: { A: ['vendor'], B: ['journal_entry'], C: [] }, tierDefault: 'B', kinds: {}, alwaysHuman: [] };
  const base = { id: 'REQ-t', kind: 'data_task', size: 'S', writes: true, worker: 'preparer', subject: { businessIds: ['b1'] }, gates: { 1: { approved: false }, 2: { approved: false } }, loops: { verify: 0 }, pendingQuestions: [] };
  const ok = { status: 'ok' };
  const a = O.transition(base, 'scope', 'planner', ok, { policy, plan: { writes: [{ kind: 'vendor', count: 2 }], done: [{ text: 'x' }] } });
  assert.equal(a.status, 'execute'); assert.equal(a.stop, false); assert.match(a.reason, /no Gate 1/); assert.deepEqual(a.patch.writeTiers.map((t) => t.tier), ['A']); assert.equal(a.patch.scoped, true);
  assert.equal(a.patch.gates[1].approved, true); assert.equal(a.patch.gates[1].by, 'policy@v3');
  assert.doesNotThrow(() => O.assertPreconditions({ ...base, ...a.patch, status: 'execute' }, 'execute', 'preparer'), 'a policy-approved scope passes the execute precondition');
  const b = O.transition(base, 'scope', 'planner', ok, { policy, plan: { writes: [{ kind: 'vendor' }, { kind: 'journal_entry' }] } });
  assert.equal(b.status, 'awaiting_gate_1');
  const c = O.transition(base, 'scope', 'planner', ok, { policy, plan: { writes: [{ kind: 'vendor' }], children: [{ title: 'child' }] } });
  assert.equal(c.status, 'awaiting_gate_1');
  const d = O.transition({ ...base, size: 'L' }, 'scope', 'planner', ok, { policy, plan: { writes: [{ kind: 'vendor' }] } });
  assert.equal(d.status, 'awaiting_gate_1');
  const e = O.transition(base, 'scope', 'planner', ok, { policy: { ...policy, writesEnabled: false }, plan: { writes: [{ kind: 'vendor' }] } });
  assert.equal(e.status, 'awaiting_gate_1', 'writes disabled: tier A but no autoApply, so a person still approves the scope');
});
