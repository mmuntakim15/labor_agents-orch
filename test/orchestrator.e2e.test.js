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
test.before(async () => { api = await fakeDime(); restoreMap = writeTestMap().restore; process.env.LAB_POLICY_DIR = require('path').join(process.env.LAB_RUNS_DIR, 'policy'); });
test.after(async () => { restoreMap(); await api.close(); delete process.env.FAKE_VERDICT; delete process.env.FAKE_INTAKE; delete process.env.FAKE_INPUTS; });

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

test('writes: scope → Gate 1 → execute stages proposals → verify → tier A applied under policy → Gate 2 for the rest → Applier → verify → deliver', async () => {
  const r = T.createRequest({ title: 'Set up vendors from W-9s', body: 'Here are two W-9s; set the vendors up', reporter: 'Mo', backend: 't' });
  let out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_1'); assert.equal(out.kind, 'data_task'); assert.equal(out.writes, true); assert.equal(out.worker, 'preparer');
  assert.deepEqual(out.writeTiers, [{ kind: 'vendor', tier: 'A', autoApply: true, reason: 'desk default for vendor' }, { kind: 'journal_entry', tier: 'B', autoApply: false, reason: 'desk default for journal_entry' }], 'the plan\'s writes were decided under the entity policy (the tier-B write is what keeps Gate 1)');
  assert.throws(() => O.approve(r.id, 2, 'Mo'), /not at Gate 2/);
  O.reject(r.id, 1, 'Mo', 'also tie out the aging');
  out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_gate_1'); assert.equal(out.gates[1].rejectedAt !== undefined, true);
  const vendorsBefore = api.state.vendors.length;
  O.approve(r.id, 1, 'Mo', 'go');
  out = await O.run(r.id);
  // RD-2: P-1 is tier A under policy → applied before Gate 2; P-2 (tier B) and P-3 (question) wait for Mo
  assert.equal(out.status, 'awaiting_gate_2');
  assert.deepEqual(out.runs.map((x) => x.stage).slice(-5), ['scope', 'execute', 'verify', 'apply', 'verify']);
  let items = PR.load(r.id).items; assert.equal(items.length, 3); assert.equal(items[2].status, 'question');
  assert.equal(items[0].status, 'applied'); assert.equal(items[0].reviewedBy, 'policy@v0'); assert.equal(items[0].appliedRef.by, 'policy@v0'); assert.equal(items[0].policyDecision.tier, 'A');
  assert.equal(items[1].status, 'proposed', 'tier B waits for a person');
  assert.equal(api.state.vendors.length - vendorsBefore, 1, 'only the tier-A vendor was created before Gate 2');
  assert.equal(out.policyApply, null, 'the policy apply record is cleared once the second verify passes');
  assert.equal(T.readJsonArtifact(r.id, 'applied.json').mode, 'policy');
  assert.ok(T.listComments(r.id).some((c) => c.author === 'policy@v0' && /approved P-1/.test(c.body)), 'the policy approval is labelled, never a person\'s name');
  assert.throws(() => O.decideProposal(r.id, 'P-1', 'Mo', { decision: 'approve' }), /already applied/);
  O.decideProposal(r.id, 'P-2', 'Mo', { decision: 'approve', amount: 1250 });
  O.decideProposal(r.id, 'P-3', 'Mo', { decision: 'answer', note: 'same vendor; skip' });
  O.approve(r.id, 2, 'Mo');
  out = await O.run(r.id);
  assert.equal(out.status, 'done');
  assert.deepEqual(out.runs.map((x) => x.stage).slice(-3), ['apply', 'verify', 'deliver']);
  assert.equal(api.state.vendors.length - vendorsBefore, 2, 'two vendors were created in Dime in all');
  assert.equal(api.state.vendors[vendorsBefore + 1].openingBalance, 1250, 'the edited amount was sent, not the estimate');
  const applied = T.readJsonArtifact(r.id, 'applied.json');
  assert.equal(applied.mode, 'gate2'); assert.equal(applied.applied.length, 1); assert.equal(applied.failed, null);
  items = PR.load(r.id).items;
  assert.equal(items[0].appliedRef.id, api.state.vendors[vendorsBefore]._id);
  assert.equal(items[1].status, 'applied'); assert.equal(items[1].appliedRef.by, 'Mo');
  assert.ok(R.list(r.id).some((x) => x.proposal === 'P-1' && /policy@v0/.test(x.purpose)), 'the policy apply left a receipt that says so');
  assert.equal(api.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/accountant/vendor').length, 2);
  assert.equal(out.touches, 5, 'reject, approve, two proposal decisions, approve');
  // the digest for today lists the policy apply as reversible, and the request's metrics count it
  const DG = require('../src/digest');
  const dg = DG.assemble('b1', undefined, { write: false });
  const row = dg.applied.find((a) => a.request === r.id && a.proposal === 'P-1'); assert.ok(row); assert.equal(row.reversible, true); assert.equal(row.by, 'policy@v0');
  assert.equal(DG.metricsOf(out).autoApplied, 1); assert.equal(DG.levelOf(out), 'L3', 'a person touched it');
  // reverse the policy apply: the vendor is deactivated, never deleted; a knowledge note is written
  const RV = require('../src/reverse');
  const rv = await RV.reverse(r.id, 'P-1', 'Mo', 'duplicate of an existing vendor');
  assert.equal(rv.proposal.status, 'reversed'); assert.equal(api.state.vendors[vendorsBefore].status, 'inactive'); assert.match(api.state.vendors[vendorsBefore].notes, /Reversed by Mo · duplicate of an existing vendor · REQ-\d+ · P-1/);
  assert.equal(RV.notes(r.id)[0].kind, 'gotcha'); assert.equal(RV.notes(r.id)[0].body, 'duplicate of an existing vendor');
  await assert.rejects(() => RV.reverse(r.id, 'P-1', 'Mo', 'again'), /already reversed/);
});

test('apply stops on the first failure with the product\'s words and blocks', async () => {
  const r = T.createRequest({ title: 'Set up vendors from W-9s again', body: 'W-9s', reporter: 'Mo', backend: 't' });
  await O.run(r.id); O.approve(r.id, 1, 'Mo'); await O.run(r.id);
  assert.equal(PR.load(r.id).items[0].status, 'applied', 'P-1 (tier A) went in under policy');
  api.state.failVendor = 'Beta Co';
  O.decideProposal(r.id, 'P-2', 'Mo', { decision: 'approve' }); O.decideProposal(r.id, 'P-3', 'Mo', { decision: 'answer', note: 'n' });
  O.approve(r.id, 2, 'Mo');
  const out = await O.run(r.id);
  api.state.failVendor = null;
  assert.equal(out.status, 'blocked'); assert.match(out.blocked.reason, /Vendor already exists/);
  const items = PR.load(r.id).items; assert.equal(items[1].status, 'failed'); assert.equal(items[0].status, 'applied');
});

test('kill switch mid-apply (E-01): a policy-approved item whose kind no longer auto-applies is left pending, never posted', async () => {
  const POL = require('../src/policy');
  const r = T.createRequest({ title: 'Set up vendors from W-9s once more', body: 'W-9s', reporter: 'Mo', backend: 't' });
  await O.run(r.id); O.approve(r.id, 1, 'Mo');
  // verify passes and hands to apply with P-1 policy-approved; then the entity switches writes off before the Applier runs
  let out = await O.run(r.id, { until: 'apply' });
  assert.equal(out.status, 'apply'); assert.equal(PR.load(r.id).items[0].reviewedBy, 'policy@v0');
  POL.set('b1', { writesEnabled: false }, 'Mo');
  const vendors = api.state.vendors.length;
  out = await O.run(r.id);
  POL.set('b1', { writesEnabled: true }, 'Mo');
  assert.equal(api.state.vendors.length, vendors, 'nothing was posted');
  assert.equal(out.status, 'awaiting_gate_2', 'the request waits for a person with every proposal pending');
  const p1 = PR.load(r.id).items[0]; assert.equal(p1.status, 'proposed'); assert.equal(p1.reviewedBy, null); assert.match(p1.policyDeferred.reason, /writes disabled/);
  assert.equal(T.readJsonArtifact(r.id, 'applied.json').deferred.length, 1);
  assert.ok(T.listComments(r.id).some((c) => /P-1 not posted/.test(c.body)));
});

test('awaiting_input: the worker names a document, a person supplies it, the stage resumes; a timeout resumes it with the input marked missing', async () => {
  process.env.FAKE_INPUTS = JSON.stringify([{ name: 'October bank statement', period: '2026-10', why: 'the recon needs the closing balance', acceptedTypes: ['pdf', 'csv'] }]);
  const r = T.createRequest({ title: 'Flux with statement', body: 'flux for the last two months', reporter: 'Mo', backend: 't' });
  let out = await O.run(r.id);
  assert.equal(out.status, 'awaiting_input'); assert.equal(out.inputsStage, 'execute'); assert.equal(out.inputsNeeded[0].name, 'October bank statement'); assert.equal(out.inputsNeeded[0].receivedAt, null);
  assert.equal(O.runnable(out), false, 'nothing runs while a document is awaited');
  assert.throws(() => O.provideInput(r.id, 'Mo', 'something else'), /not an input/);
  out = O.provideInput(r.id, 'Mo', 'October bank statement', { attachments: ['stmt-oct.pdf'] });
  assert.equal(out.status, 'execute'); assert.equal(out.inputsNeeded[0].receivedFrom, 'Mo'); assert.deepEqual(out.inputsNeeded[0].files, ['stmt-oct.pdf']); assert.equal(out.touches, 1);
  out = await O.run(r.id);
  assert.equal(out.status, 'done');
  // timeout path
  const r2 = T.createRequest({ title: 'Flux with statement 2', body: 'flux for the last two months', reporter: 'Mo', backend: 't' });
  out = await O.run(r2.id); assert.equal(out.status, 'awaiting_input');
  assert.deepEqual(O.expireInputs(), [], 'not yet');
  const resumed = O.expireInputs({ now: Date.now() + 6 * 864e5 });
  assert.deepEqual(resumed, [r2.id]);
  out = T.loadRequest(r2.id); assert.equal(out.status, 'execute'); assert.equal(out.inputsNeeded[0].missing, true);
  out = await O.run(r2.id); assert.equal(out.status, 'done');
  delete process.env.FAKE_INPUTS;
  const dg = require('../src/digest').assemble('b1', undefined, { write: false }); assert.ok(Array.isArray(dg.awaitingInput));
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
