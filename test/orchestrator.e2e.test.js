'use strict';
// The whole lane with a stand-in model and a stand-in Dime: fast lane, verify loop,
// writes through Gate 2 and the Applier, parent with children.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox, fakeDime, writeTestMap } = require('./helpers');
sandbox('e2e');
const T = require('../src/request');
const O = require('../src/orchestrator');
const PR = require('../src/proposals');
const R = require('../src/receipts');

let api; let restoreMap;
test.before(async () => { api = await fakeDime(); restoreMap = writeTestMap().restore; });
test.after(async () => { restoreMap(); await api.close(); delete process.env.FAKE_VERDICT; delete process.env.FAKE_INTAKE; });

test('fast lane: a small report goes intake → execute → verify → deliver with no human touch, and leaves evidence', async () => {
  const r = T.createRequest({ title: 'Flux for the last two months', body: 'Create a flux for the last two months and produce the report', reporter: 'Mo', backend: 't' });
  const out = await O.run(r.id);
  assert.equal(out.status, 'done');
  assert.deepEqual(out.runs.map((x) => `${x.stage}/${x.agent}`), ['intake/intake', 'execute/analyst', 'verify/verifier', 'deliver/deliverer']);
  assert.equal(out.kind, 'report'); assert.equal(out.scoped, false); assert.equal(out.gates[1].approved, false, 'no gate was needed');
  const a = T.listArtifacts(r.id);
  for (const f of ['triage.json', 'work.md', 'checks.json', 'verify.json', 'summary.md', 'evidence.json', 'evidence.html', 'deliverables/report.xlsx']) assert.ok(a.includes(f), f);
  const checks = T.readJsonArtifact(r.id, 'checks.json');
  assert.equal(checks.pass, true); assert.ok(checks.items.some((i) => i.evaluator === 'export_opens' && i.pass));
  const ev = T.readJsonArtifact(r.id, 'evidence.json');
  assert.equal(ev.receipts.calls, 1); assert.equal(ev.deliverables.length, 2); assert.ok(ev.costUsd > 0);
  assert.equal(out.runs.reduce((s, x) => s + x.costUsd, 0), 4 * 0.42);
  const m = O.metrics().find((x) => x.id === r.id); assert.equal(m.touches, 0, 'zero human touches');
});

test('verify loop: a failing verdict sends the work back once, then passes; a code-failed item overrides a passing verdict', async () => {
  process.env.FAKE_VERDICT = 'fail';
  const r = T.createRequest({ title: 'Flux again', body: 'flux for the last two months', reporter: 'Mo', backend: 't' });
  const out = await O.run(r.id);
  delete process.env.FAKE_VERDICT;
  assert.equal(out.status, 'done'); assert.equal(out.loops.verify, 1);
  assert.deepEqual(out.runs.map((x) => x.stage), ['intake', 'execute', 'verify', 'execute', 'verify', 'deliver']);
  // code wins: make a done item fail deterministically and the Verifier's pass is overridden
  const r2 = T.createRequest({ title: 'Flux strict', body: 'flux', reporter: 'Mo', backend: 't' });
  process.env.FAKE_INTAKE = JSON.stringify({ done: [{ id: 'D-1', text: 'needs 5 rows', evaluator: 'row_count', args: { file: 'report.xlsx' }, expect: { min: 5 } }] });
  const out2 = await O.run(r2.id);
  delete process.env.FAKE_INTAKE;
  assert.equal(out2.status, 'blocked'); assert.equal(out2.blocked.kind, 'loop_verify'); assert.match(out2.blocked.reason, /D-1/);
  const comments = T.listComments(r2.id).map((c) => c.body).join('\n');
  assert.match(comments, /code wins/);
  // a person overrides and the request delivers
  O.override(r2.id, 'Mo', 'D-1', 'four rows is what the month has');
  const out3 = await O.run(r2.id);
  assert.equal(out3.status, 'done'); assert.equal(out3.overrides.length, 1);
  assert.match(fs.readFileSync(path.join(T.artifactsDir(r2.id), 'evidence.html'), 'utf8'), /overridden by Mo/);
});

test('writes: scope → Gate 1 → execute stages proposals → verify → Gate 2 decisions → Applier writes through Dime → verify → deliver', async () => {
  const r = T.createRequest({ title: 'Set up vendors from W-9s', body: 'Here are two W-9s; set the vendors up', reporter: 'Mo', backend: 't' });
  let out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_1'); assert.equal(out.kind, 'data_task'); assert.equal(out.writes, true); assert.equal(out.worker, 'preparer');
  assert.throws(() => O.approve(r.id, 2, 'Mo'), /not at Gate 2/);
  O.reject(r.id, 1, 'Mo', 'also tie out the aging');
  out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_1'); assert.equal(out.gates[1].rejectedAt !== undefined, true);
  O.approve(r.id, 1, 'Mo', 'go');
  out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_2');
  assert.deepEqual(out.runs.map((x) => x.stage).slice(-3), ['scope', 'execute', 'verify']);
  const ps = PR.load(r.id).items; assert.equal(ps.length, 3); assert.equal(ps[2].status, 'question');
  const vendorsBefore = api.state.vendors.length;
  O.decideProposal(r.id, 'P-1', 'Mo', { decision: 'approve' });
  O.decideProposal(r.id, 'P-2', 'Mo', { decision: 'approve', amount: 1250 });
  O.decideProposal(r.id, 'P-3', 'Mo', { decision: 'answer', note: 'same vendor; skip' });
  O.approve(r.id, 2, 'Mo');
  out = await O.run(r.id);
  assert.equal(out.status, 'done');
  assert.deepEqual(out.runs.map((x) => x.stage).slice(-4), ['apply', 'verify', 'deliver'].length === 3 ? ['verify', 'apply', 'verify', 'deliver'] : []);
  assert.equal(api.state.vendors.length - vendorsBefore, 2, 'two approved vendors were created in Dime');
  assert.equal(api.state.vendors[vendorsBefore + 1].openingBalance, 1250, 'the edited amount was sent, not the estimate');
  const applied = T.readJsonArtifact(r.id, 'applied.json');
  assert.equal(applied.applied.length, 2); assert.equal(applied.failed, null);
  const items = PR.load(r.id).items;
  assert.equal(items[0].status, 'applied'); assert.equal(items[0].appliedRef.id, api.state.vendors[vendorsBefore]._id); assert.equal(items[0].appliedRef.by, 'Mo');
  assert.ok(R.list(r.id).some((x) => x.proposal === 'P-1'), 'the apply left a receipt');
  assert.equal(api.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/accountant/vendor').length, 2, 'nothing was written before Gate 2');
});

test('apply stops on the first failure with the product\'s words and blocks', async () => {
  const r = T.createRequest({ title: 'Set up vendors from W-9s again', body: 'W-9s', reporter: 'Mo', backend: 't' });
  await O.run(r.id); O.approve(r.id, 1, 'Mo'); await O.run(r.id);
  api.state.failVendor = 'Acme Supply';
  O.decideProposal(r.id, 'P-1', 'Mo', { decision: 'approve' }); O.decideProposal(r.id, 'P-2', 'Mo', { decision: 'approve' }); O.decideProposal(r.id, 'P-3', 'Mo', { decision: 'answer', note: 'n' });
  O.approve(r.id, 2, 'Mo');
  const out = await O.run(r.id);
  api.state.failVendor = null;
  assert.equal(out.status, 'blocked'); assert.match(out.blocked.reason, /Vendor already exists/);
  const items = PR.load(r.id).items; assert.equal(items[0].status, 'failed'); assert.equal(items[1].status, 'approved', 'the second was not sent');
});

test('parent: size L splits into children at Gate 1; the parent delivers when they are done', async () => {
  const r = T.createRequest({ title: 'AR over 60 days for every entity', body: 'Pull AR over 60 days for every entity into one sheet', reporter: 'Mo', backend: 't' });
  let out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_1'); assert.equal(out.size, 'L'); assert.equal(out.children.length, 2);
  const p = O.approve(r.id, 1, 'Mo');
  assert.equal(p.status, 'children'); assert.ok(p.children.every((c) => c.requestId));
  for (const c of p.children) { const child = T.loadRequest(c.requestId); assert.equal(child.parentId, r.id); assert.equal(child.kind, 'report'); const done = await O.run(c.requestId); assert.equal(done.status, 'done'); }
  out = await O.run(r.id);
  assert.equal(out.status, 'done');
  assert.ok(fs.existsSync(path.join(T.artifactsDir(r.id), 'summary.md')));
});

test('questions park the request; an answer resumes it; budget exhaustion parks as blocked', async () => {
  const r = T.createRequest({ title: 'Which entity?', body: 'flux for Acme which entity?', reporter: 'Mo', backend: 't' });
  let out = await O.run(r.id);
  assert.equal(out.status, 'intake'); assert.equal(out.pendingQuestions.length, 1);
  O.answer(r.id, 'Mo', 'Acme Dental');
  out = await O.run(r.id);
  assert.equal(out.status, 'done'); assert.match(out.answers, /Acme Dental/);
  const b = T.createRequest({ title: 'Flux broke', body: 'flux', reporter: 'Mo', backend: 't' }); b.budgetUsd = 1; T.saveRequest(b);
  out = await O.run(b.id);
  assert.equal(out.status, 'blocked'); assert.equal(out.blocked.kind, 'budget');
  O.raiseBudget(b.id, 'Mo', 10);
  out = await O.run(b.id);
  assert.equal(out.status, 'done');
});

test('dry run writes the prompt and tool configuration without spending', async () => {
  const r = T.createRequest({ title: 'dry', body: 'flux', reporter: 'Mo', backend: 't' });
  const out = await O.run(r.id, { dryRun: true });
  assert.equal(out.status, 'intake'); assert.equal((out.runs || []).length, 0);
  const files = fs.readdirSync(path.join(T.runsDir(), r.id));
  assert.ok(files.some((f) => /01-intake-intake\.prompt\.md$/.test(f)));
  const prompt = fs.readFileSync(path.join(T.runsDir(), r.id, files.find((f) => /prompt\.md$/.test(f))), 'utf8');
  assert.match(prompt, /<untrusted source="requester">/); assert.match(prompt, /tools\/dime\.js businesses/); assert.match(prompt, /Unacceptable failures/);
});
