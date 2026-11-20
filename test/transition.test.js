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
  let tr = O.transition(fresh({ kind: 'data_task' }), 'scope', 'planner', { status: 'ok' }, { plan: { size: 'M', writes: [{ kind: 'vendor', summary: 'x' }], done: [{ text: 'a' }] } });
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
  const spent = fresh({ size: 'S', runs: [{ costUsd: 9 }] });
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
