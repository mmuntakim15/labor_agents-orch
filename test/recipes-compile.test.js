'use strict';
// Recipe compilation (FR-37): a delivered general-lane request becomes a
// candidate the matcher sees at once; use is counted; promotion needs two uses
// and a passing eval report; discard keeps the file out of sight.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sandbox } = require('./helpers');
const tmp = sandbox('recipes-compile');
const ROOT = path.join(__dirname, '..');
// a private recipes folder (three library recipes copied in) and a private evals folder, so nothing lands in the repo
process.env.LAB_RECIPES_DIR = path.join(tmp, 'recipes');
process.env.LAB_EVALS_DIR = path.join(tmp, 'evals');
fs.mkdirSync(path.join(tmp, 'recipes', 'candidates'), { recursive: true });
for (const id of ['R01', 'R03', 'R08']) fs.copyFileSync(path.join(ROOT, 'recipes', `${id}.json`), path.join(tmp, 'recipes', `${id}.json`));
const RC = require('../src/recipes');
const T = require('../src/request');
const R = require('../src/receipts');
const X = require('../src/xlsx');

const BIZ = '66500000000000000000abcd';
/** A delivered request with every artifact compile() reads. */
function delivered({ title = 'Vendor bills with no GL posting in the month', body = 'List every vendor bill dated in October 2026 that has no matching posting in the general ledger, with the bill id, vendor and amount.', level = null, failD2 = false, setup = null, noProposals = false } = {}) {
  const r = T.createRequest({ title, body, reporter: 'Mo' });
  Object.assign(r, {
    status: 'done', kind: 'question', size: 'M', writes: !noProposals, worker: 'investigator', createdAt: '2026-11-05T14:00:00.000Z',
    subject: { businessIds: [BIZ], businessNames: ['Acme Dental'], periods: ['2026-10'], accounts: ['Accounts Payable'] },
    done: [
      { id: 'D-1', text: `Detail total ties to Dime's AP aging for ${BIZ} as of 2026-10-31`, evaluator: 'ties_to_report', args: { report: 'ap_aging', asOf: '2026-10-31', businessId: BIZ, name: 'bills-vs-gl.xlsx' }, expect: { figure: 'total' } },
      { id: 'D-2', text: 'Every exception row cites the bill id', evaluator: 'exceptions_have_source', args: { name: 'bills-vs-gl.xlsx' } },
      { id: 'D-3', text: 'The memo says what could not be determined' },
      { id: 'D-4', text: 'An item nobody judged' },
    ],
    ...(level ? { level } : {}), ...(setup ? { setup } : {}),
    runs: [{ n: 1, stage: 'intake', agent: 'intake', costUsd: 0.8 }, { n: 2, stage: 'execute', agent: 'investigator', costUsd: 3.4 }, { n: 3, stage: 'verify', agent: 'verifier', costUsd: 1.1 }],
  });
  T.saveRequest(r);
  T.writeArtifact(r.id, 'triage.json', { status: 'ok', kind: 'question', size: 'M', writes: !noProposals, worker: 'investigator', subject: r.subject, done: r.done });
  T.writeArtifact(r.id, 'plan.json', {
    size: 'M', writes: !noProposals, worker: 'investigator',
    calls: [{ method: 'GET', path: `/api/v1/accountant/reports/general-ledger-realtime/${BIZ}`, purpose: 'GL for the month' }],
    inputs: ['bills-oct.csv: vendor bills from the AP system, columns bill id, vendor, date, amount', { name: 'Bank statement', source: 'standing', acceptedTypes: ['pdf'], optional: true }],
    inputsNeeded: [{ name: 'Vendor remittance file', period: '2026-10', why: 'to separate paid from unpaid', acceptedTypes: ['csv'], standing: false }],
    steps: [`pull: GL for 2026-10 for business ${BIZ} → data/gl-oct.json`, 'pull: open bills at 2026-10-31 → data/bills.json', 'compute: open_item_age over data/bills.json as of 2026-10-31 → data/bills-aged.json', 'compare: sandbox program bills-vs-gl.js over data/bills-aged.json, data/gl-oct.json → data/bills-vs-gl.json', 'prove: Exceptions rows cite the bill id; D-1 ties_to_report'],
    gaps: [{ primitive: 'compute', gap: 'compute', detail: 'FX gain by bill needs daily rates Dime does not store', blocking: false }],
    estimateUsd: 6,
  });
  T.writeArtifact(r.id, 'checks.json', { at: '2026-11-05T15:00:00.000Z', items: [{ id: 'D-1', evaluator: 'ties_to_report', pass: true }, { id: 'D-2', evaluator: 'exceptions_have_source', pass: !failD2 }], pass: !failD2, failing: failD2 ? ['D-2'] : [] });
  T.writeArtifact(r.id, 'verify.json', { verdict: 'pass', items: [{ id: 'D-1', pass: true }, { id: 'D-2', pass: true }, { id: 'D-3', pass: true, evidence: 'memo §3' }] });
  if (!noProposals) T.writeArtifact(r.id, 'proposals.json', { items: [{ id: 'P-1', kind: 'bill_recode', tier: 'A', method: 'PATCH', path: `/api/v1/accountant/bill/${BIZ}/b1`, status: 'approved' }, { id: 'P-2', kind: 'bill_recode', tier: 'A', method: 'PATCH', path: `/api/v1/accountant/bill/${BIZ}/b2`, status: 'approved' }, { id: 'P-3', kind: 'journal_entry', tier: 'B', method: 'POST', path: '/api/v1/accountant/journal', status: 'rejected' }] });
  const wb = X.writeXlsx([{ name: 'Exceptions', header: ['Bill', 'Amount'], rows: [['b1', 100]] }, { name: 'Tie-out', header: ['Line', 'Amount'], rows: [['Difference', 0]] }, { name: 'Detail', header: ['Bill'], rows: [['b1']] }, { name: 'Sources', header: ['Source'], rows: [['AP aging as of 2026-10-31']] }]);
  T.writeArtifact(r.id, 'deliverables/bills-vs-gl.xlsx', wb);
  T.writeArtifact(r.id, 'deliverables/memo.md', '# Memo\n\nTwo bills have no GL posting.');
  T.writeArtifact(r.id, 'deliverables/manifest.json', { items: [{ name: 'bills-vs-gl.xlsx', kind: 'xlsx', receipts: ['R-1'], first: true }, { name: 'memo.md', kind: 'md', receipts: [] }] });
  R.append(r.id, { method: 'GET', path: `/api/v1/accountant/reports/general-ledger-realtime/${BIZ}`, status: 200, outFile: 'data/gl-oct.json' });
  R.append(r.id, { kind: 'compute', method: 'SANDBOX', path: 'a'.repeat(64), status: 'ok', outFile: 'data/bills-vs-gl.json' });
  R.append(r.id, { kind: 'compute', method: 'SANDBOX', path: 'b'.repeat(64), status: 'refused', refused: 'program references process' });
  return T.loadRequest(r.id);
}

test('compile: a delivered request becomes a validated candidate with abstracted subject, passed done items, writes, deliverables, inputs, steps, verbs, programs, gaps and a frozen eval case', () => {
  const r = delivered();
  const out = RC.compile(r.id, { now: new Date('2026-11-06T09:00:00Z') });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  const c = out.candidate;
  assert.equal(c.id, 'cand-vendor-bills-with-no-gl-posting-in-the-m', 'slug capped at 40 characters'); assert.equal(c.candidate, true); assert.equal(c.version, 0);
  assert.deepEqual(c.learnedFrom, [r.id]); assert.equal(c.used, 1); assert.deepEqual(c.entities, [BIZ]);
  assert.deepEqual(c.trigger, { default: null, periodRule: 'last_closed_month', event: null }, 'October judged from a November creation date');
  assert.deepEqual(c.subjectPattern, { entity: '$current', periods: 'last_closed_month', count: 1, inferred: true });
  assert.equal(c.kind, 'question'); assert.equal(c.worker, 'investigator'); assert.equal(c.group, 2); assert.equal(c.title, r.title); assert.equal(c.prompt, r.body);
  assert.deepEqual(c.keywords, ['Accounts Payable']);
  // done: D-1..D-3 passed (D-4 was never judged); ids, dates and the business id are tokens
  assert.deepEqual(c.done.map((d) => d.id), ['D-1', 'D-2', 'D-3']);
  assert.equal(c.done[0].text, "Detail total ties to Dime's AP aging for {{businessId}} as of {{period.end}}");
  assert.deepEqual(c.done[0].args, { report: 'ap_aging', asOf: '{{period.end}}', businessId: '{{businessId}}', name: 'bills-vs-gl.xlsx' }); assert.deepEqual(c.done[0].expect, { figure: 'total' });
  assert.ok(!('evaluator' in c.done[2]));
  // writes: one rule per (kind, route) actually proposed, tier as used
  assert.deepEqual(c.writes, [{ kind: 'bill_recode', route: 'PATCH /api/v1/accountant/bill/{{businessId}}/b1', tierRules: [{ when: 'as proposed', tier: 'A' }] }, { kind: 'bill_recode', route: 'PATCH /api/v1/accountant/bill/{{businessId}}/b2', tierRules: [{ when: 'as proposed', tier: 'A' }] }, { kind: 'journal_entry', route: 'POST /api/v1/accountant/journal', tierRules: [{ when: 'as proposed', tier: 'B' }] }]);
  assert.deepEqual(c.deliverables, [{ name: 'bills-vs-gl.xlsx', sheets: ['Exceptions', 'Tie-out', 'Detail', 'Sources'], kind: 'xlsx', first: true }, { name: 'memo.md', sheets: [], kind: 'md' }]);
  assert.deepEqual(c.inputs.map((i) => [i.name, i.source, i.periodRule, i.acceptedTypes, i.optional || false]), [['bills-oct.csv', 'document', 'last_closed_month', ['csv'], false], ['Bank statement', 'standing', 'last_closed_month', ['pdf'], true], ['Vendor remittance file', 'document', 'last_closed_month', ['csv'], false]]);
  assert.equal(c.inputs[0].what, 'vendor bills from the AP system, columns bill id, vendor, date, amount');
  assert.equal(c.steps.length, 5); assert.match(c.steps[0], /business \{\{businessId\}\}/); assert.match(c.steps[0], /GL for \{\{period\.end\}\}/ === null ? /x/ : /GL for 2026-10 /, 'a bare month label is not a period token');
  assert.deepEqual(c.compute, ['open_item_age']); assert.deepEqual(c.programs, ['a'.repeat(64)], 'only programs that ran');
  assert.deepEqual(c.gaps, [{ primitive: 'compute', gap: 'compute', detail: 'FX gain by bill needs daily rates Dime does not store', blocking: false }]);
  assert.deepEqual(c.tools, ['map', 'dime', 'files', 'check', 'export', 'compute', 'sandbox']);
  assert.equal(c.autonomyCeiling, 'L3-policy', 'no level on the request → L3'); assert.equal(c.restrictedData, false); assert.equal(c.budgetUsd, 6, 'ceil of $5.30 spent');
  assert.deepEqual(c.setup, []); assert.deepEqual(c.evals, [`evals/cases/${c.id}`]); assert.equal(c.compiledAt, '2026-11-06T09:00:00.000Z');
  assert.deepEqual(c.compiledFrom, { kind: 'question', size: 'M', writes: true, periods: ['2026-10'], createdAt: '2026-11-05T14:00:00.000Z' });
  // on disk, validated, and visible
  assert.equal(out.file, path.join(tmp, 'recipes', 'candidates', `${c.id}.json`)); assert.deepEqual(JSON.parse(fs.readFileSync(out.file, 'utf8')), c);
  assert.equal(RC.validate(c).ok, true); assert.equal(RC.validateAll().ok, true); assert.ok(RC.validateAll().items.some((i) => i.id === c.id));
  assert.deepEqual(RC.candidates().map((x) => x.id), [c.id]); assert.equal(RC.loadCandidate(c.id).id, c.id); assert.equal(RC.load(c.id).id, c.id, 'load() resolves a candidate id so intake can adopt it'); assert.throws(() => RC.load('cand-nope'), /not found/);
  const kase = JSON.parse(fs.readFileSync(path.join(out.caseDir, 'case.json'), 'utf8'));
  assert.equal(out.caseDir, path.join(tmp, 'evals', 'cases', c.id));
  assert.equal(kase.agent, 'intake'); assert.equal(kase.stage, 'intake'); assert.equal(kase.request.title, r.title); assert.equal(kase.request.body, r.body); assert.deepEqual(kase.expect.json, { kind: 'question', worker: 'investigator' }); assert.deepEqual(kase.artifacts, []);
  assert.ok(!fs.existsSync(path.join(ROOT, 'recipes', 'candidates', `${c.id}.json`)), 'nothing was written into the repo');
  assert.ok(!fs.existsSync(path.join(ROOT, 'evals', 'cases', c.id)));
});

test('compile: the matcher picks the candidate for the same request in other words; the library mirror lists it after the recipes with learnedFrom and used, deterministically', () => {
  const r = delivered({ title: 'Bills without a ledger posting' });
  const { candidate: c } = RC.compile(r.id);
  const hits = RC.match(r.body);
  // a candidate is discounted (CANDIDATE_DISCOUNT) so it never outranks a library recipe on loose overlap; its own
  // request still comes back first and clears the clear-winner line the orchestrator adopts at (>= 0.6, 1.5x the runner-up)
  assert.equal(hits[0].id, c.id, JSON.stringify(hits)); assert.ok(hits[0].score >= 0.6, JSON.stringify(hits));
  // (this fixture holds two near-duplicate candidates on purpose, so no runner-up margin is asserted here)
  const para = RC.match('which October vendor bills never got posted to the general ledger?');
  assert.equal(para[0].id, c.id, JSON.stringify(para));
  assert.equal(RC.match('duplicate payments to vendors this year')[0].id, 'R08', 'library recipes still win their own text');
  const lib = RC.library();
  assert.deepEqual(lib.map((x) => x.id), ['R01', 'R03', 'R08', c.id, 'cand-vendor-bills-with-no-gl-posting-in-the-m'], 'recipes first, then candidates by id');
  for (const x of lib.slice(0, 3)) assert.deepEqual(Object.keys(x).sort(), ['cadence', 'group', 'groupName', 'id', 'inputs', 'level', 'prompt', 'setupKeys', 'setupQuestions', 'title', 'version'], 'recipe rows are unchanged');
  const row = lib[3];
  assert.deepEqual(Object.keys(row).sort(), ['cadence', 'candidate', 'group', 'groupName', 'id', 'inputs', 'learnedFrom', 'level', 'prompt', 'setupKeys', 'setupQuestions', 'title', 'used', 'version']);
  assert.equal(row.candidate, true); assert.deepEqual(row.learnedFrom, [r.id]); assert.equal(row.used, 1); assert.equal(row.version, 0); assert.equal(row.level, 'L3'); assert.equal(row.cadence, 'month end'); assert.equal(row.groupName, 'Reconciliation and investigation');
  assert.deepEqual(row.inputs, ['bills-oct.csv', 'Bank statement', 'Vendor remittance file']);
  const f1 = path.join(tmp, 'lib1.json'); const f2 = path.join(tmp, 'lib2.json');
  assert.equal(RC.writeLibraryJson(f1).count, 5); RC.writeLibraryJson(f2);
  const strip = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.builtAt; return j; };
  assert.deepEqual(strip(f1), strip(f2)); assert.deepEqual(strip(f1).recipes, lib);
});

test('recordUse: a second request following the candidate raises used and extends the provenance; the same request twice does not repeat', () => {
  const r = delivered({ title: 'Used twice' });
  const { candidate: c } = RC.compile(r.id);
  const u = RC.recordUse(c.id, 'REQ-77', 'biz-2');
  assert.equal(u.used, 2); assert.deepEqual(u.learnedFrom, [r.id, 'REQ-77']); assert.deepEqual(u.entities, [BIZ, 'biz-2']); assert.ok(u.lastUsedAt);
  const again = RC.recordUse(c.id, 'REQ-77', 'biz-2');
  assert.equal(again.used, 3); assert.deepEqual(again.learnedFrom, [r.id, 'REQ-77']); assert.deepEqual(again.entities, [BIZ, 'biz-2']);
  assert.equal(RC.loadCandidate(c.id).used, 3, 'written through');
  assert.equal(RC.library().find((x) => x.id === c.id).used, 3);
  assert.throws(() => RC.recordUse('cand-nope', 'REQ-1'), /not found/); assert.throws(() => RC.recordUse('../R01', 'REQ-1'), /bad candidate id/);
  // compiling the same request again refreshes the body and keeps the provenance
  const re = RC.compile(r.id);
  assert.equal(re.ok, true); assert.equal(re.candidate.used, 3); assert.deepEqual(re.candidate.learnedFrom, [r.id, 'REQ-77']); assert.deepEqual(re.candidate.entities, [BIZ, 'biz-2']);
});

test('promote: refused without two uses, without an eval report, with a failing report, without --by or with a bad cron; then succeeds into the next free R<nn> v1 and removes the candidate', () => {
  const r = delivered({ title: 'Promoted prepaid check', body: 'Which prepaid expense schedules were not amortized in October 2026? List the account, the vendor and the missing amortization amount.' });
  const { candidate: c } = RC.compile(r.id);
  assert.throws(() => RC.promote(c.id, { by: 'Mo' }), /used 1 time/);
  RC.recordUse(c.id, 'REQ-78', BIZ);
  assert.throws(() => RC.promote(c.id, { by: 'Mo' }), /no eval report/);
  const rep = RC.recordEvalReport(c.id, { pass: false, passed: 0, runs: 1, failures: ['result.kind = "report", expected "question"'] });
  assert.equal(rep.pass, false); assert.equal(rep.file, path.join(tmp, 'evals', 'reports', `${c.id}.json`));
  assert.throws(() => RC.promote(c.id, { by: 'Mo' }), /did not pass/);
  RC.recordEvalReport(c.id, { pass: true, passed: 1, runs: 1 });
  assert.equal(RC.readEvalReport(c.id).pass, true); assert.equal(RC.readEvalReport('nothing'), null);
  assert.throws(() => RC.promote(c.id, {}), /--by/);
  assert.throws(() => RC.promote(c.id, { by: 'Mo', cron: 'daily' }), /five-field cron/);
  assert.throws(() => RC.promote(c.id, { by: 'Mo', nextId: 'R01' }), /already exists/);
  assert.throws(() => RC.promote(c.id, { by: 'Mo', nextId: 'X9' }), /bad recipe id/);
  assert.ok(fs.existsSync(RC.candidateFile(c.id)), 'every refusal left the candidate in place');
  assert.equal(RC.nextRecipeId(), 'R02');
  const p = RC.promote(c.id, { by: 'Mo', cron: '0 6 2 * *' });
  assert.equal(p.recipe.id, 'R02'); assert.equal(p.recipe.version, 1); assert.equal(p.recipe.trigger.default, '0 6 2 * *'); assert.equal(p.recipe.trigger.periodRule, 'last_closed_month');
  assert.equal(p.recipe.promotedBy, 'Mo'); assert.ok(p.recipe.promotedAt); assert.equal(p.recipe.promotedFrom.candidate, c.id); assert.equal(p.recipe.promotedFrom.used, 2);
  assert.ok(!('candidate' in p.recipe) && !('used' in p.recipe)); assert.deepEqual(p.recipe.learnedFrom, [r.id, 'REQ-78'], 'provenance travels');
  assert.equal(p.file, path.join(tmp, 'recipes', 'R02.json'));
  assert.ok(!fs.existsSync(RC.candidateFile(c.id)), 'the candidate file is gone'); assert.ok(!RC.candidates().some((x) => x.id === c.id));
  assert.equal(RC.load('R02').title, r.title); assert.equal(RC.validate(RC.load('R02')).ok, true); assert.equal(RC.validateAll().ok, true);
  assert.deepEqual(Object.keys(RC.current()).sort(), ['R01', 'R02', 'R03', 'R08']);
  assert.equal(RC.match(r.body)[0].id, 'R02', 'the promoted recipe now matches');
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'recipes', 'R02.json'), 'utf8')).title, r.title, 'the repo\'s own R02 was not touched');
  // a second promotion attempt of the vanished candidate
  assert.throws(() => RC.promote(c.id, { by: 'Mo' }), /not found/);
  // a candidate promoted without a cron stays on request
  const r2 = delivered({ title: 'Clearing items older than a month' });
  const c2 = RC.compile(r2.id).candidate; RC.recordUse(c2.id, 'REQ-79'); RC.recordEvalReport(c2.id, { pass: true });
  const p2 = RC.promote(c2.id, { by: 'Mo' });
  assert.equal(p2.recipe.id, 'R04'); assert.equal(p2.recipe.trigger.default, null); assert.equal(RC.cadenceOf(p2.recipe), 'month end');
});

test('discard: the candidate moves to .discarded with who and when; the matcher and the library no longer see it', () => {
  const r = delivered({ title: 'Something we will not keep' });
  const { candidate: c } = RC.compile(r.id);
  assert.throws(() => RC.discard(c.id), /--by/);
  const d = RC.discard(c.id, 'Mo');
  assert.equal(d.file, path.join(tmp, 'recipes', 'candidates', '.discarded', `${c.id}.json`));
  const back = JSON.parse(fs.readFileSync(d.file, 'utf8'));
  assert.equal(back.discardedBy, 'Mo'); assert.ok(back.discardedAt); assert.equal(back.id, c.id);
  assert.ok(!RC.candidates().some((x) => x.id === c.id)); assert.ok(!RC.library().some((x) => x.id === c.id));
  assert.ok(!RC.match(r.body).some((h) => h.id === c.id));
  assert.throws(() => RC.discard(c.id, 'Mo'), /not found/);
});

test('compile refuses to write when nothing code-judged passed, and reports why; level L4 and setup answers are carried', () => {
  const r = delivered({ title: 'Unjudged work', failD2: true });
  // D-1 still passes, so the candidate validates; make it fail: no evaluator-backed item left
  const req = T.loadRequest(r.id); req.done = req.done.filter((d) => d.id !== 'D-1'); T.saveRequest(req);
  const out = RC.compile(r.id);
  assert.equal(out.ok, false); assert.ok(out.errors.some((e) => /code-judged/.test(e)), out.errors.join('; '));
  assert.ok(!fs.existsSync(path.join(tmp, 'recipes', 'candidates', 'cand-unjudged-work.json'))); assert.ok(!fs.existsSync(path.join(tmp, 'evals', 'cases', 'cand-unjudged-work')));
  const r2 = delivered({ title: 'Autonomous one', level: 'L4', setup: { answers: { apAccounts: ['2000', '2010'], flagThreshold: 250, 'bad key': 1, includeDrafts: false, cutoff: '2026-10-31', note: 'x' } }, noProposals: true });
  const c2 = RC.compile(r2.id).candidate;
  assert.equal(c2.autonomyCeiling, 'L4'); assert.deepEqual(c2.writes, []); assert.deepEqual(c2.tools, ['map', 'dime', 'files', 'check', 'export', 'compute', 'sandbox']);
  assert.deepEqual(c2.setup.map((s) => [s.key, s.type, s.scope]), [['apAccounts', 'accounts', 'recipe'], ['cutoff', 'date', 'recipe'], ['flagThreshold', 'number', 'recipe'], ['includeDrafts', 'boolean', 'recipe'], ['note', 'text', 'recipe']]);
  assert.equal(c2.setup[2].default, 250); assert.equal(c2.setup[2].q, 'flag threshold?');
  assert.equal(RC.fillSetup('{{setup.flagThreshold}}', c2, {}), 250, 'the stated answer is the default next time');
  assert.throws(() => RC.compile('REQ-999'), /not found/);
});

test('pure helpers: period rule inference, abstraction, passed done items, slugs', () => {
  const at = '2026-11-05T12:00:00Z';
  assert.equal(RC.inferPeriodRule(['2026-10'], at).rule, 'last_closed_month'); assert.equal(RC.inferPeriodRule(['2026-11'], at).rule, 'current_month'); assert.equal(RC.inferPeriodRule(['2026-09'], at).rule, 'closing_month');
  assert.deepEqual(RC.inferPeriodRule(['2026-09', '2026-10'], at), { rule: 'last_closed_month', count: 2, inferred: true });
  assert.equal(RC.inferPeriodRule(['2026-Q3'], at).rule, 'prior_quarter'); assert.equal(RC.inferPeriodRule(['2025'], at).rule, 'prior_year');
  assert.equal(RC.inferPeriodRule([{ period: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30' }], at).rule, 'prior_quarter');
  assert.equal(RC.inferPeriodRule([{ startDate: '2026-01-01', endDate: '2026-10-31' }], at).rule, 'year_to_date');
  assert.equal(RC.inferPeriodRule([{ startDate: '2026-10-27', endDate: '2026-11-02' }], at).rule, 'last_week'); assert.equal(RC.inferPeriodRule(['2026-11-04'], at).rule, 'business_day');
  assert.equal(RC.inferPeriodRule(['October 2026'], at).rule, 'last_closed_month');
  assert.deepEqual(RC.inferPeriodRule([], at), { rule: 'last_closed_month', count: 0, inferred: false }); assert.equal(RC.inferPeriodRule(['2024-02'], at).inferred, false);
  assert.deepEqual(RC.periodBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28', label: '2026-02' }); assert.equal(RC.periodBounds('nonsense'), null);
  assert.deepEqual(RC.abstractValue({ a: `x ${BIZ} y 2026-10-31`, b: ['2026-10-01', 5] }, { businessIds: [BIZ], periodStart: '2026-10-01', periodEnd: '2026-10-31' }), { a: 'x {{businessId}} y {{period.end}}', b: ['{{period.start}}', 5] });
  const done = [{ id: 'D-1', text: 'a', evaluator: 'x' }, { id: 'D-2', text: 'b' }, { id: 'D-3', text: 'c' }, { id: 'D-4', text: 'd', evaluator: 'y' }];
  assert.deepEqual(RC.passedDone(done, { items: [{ id: 'D-1', pass: true }, { id: 'D-4', pass: false, advisory: true }] }, { items: [{ id: 'D-2', pass: true }, { id: 'D-3', pass: false }] }).map((d) => d.id), ['D-1', 'D-2', 'D-4'], 'an advisory code miss does not drop the item; a Verifier fail does');
  assert.deepEqual(RC.passedDone(done, null, null), []);
  assert.equal(RC.slugOf('  Vendor bills — no GL posting!  '), 'vendor-bills-no-gl-posting'); assert.equal(RC.slugOf(''), 'request'); assert.ok(RC.slugOf('x'.repeat(100)).length <= 40);
  assert.deepEqual(RC.inputsFrom({ inputs: ['a.xlsx: things'] }, 'last_week')[0], { name: 'a.xlsx', periodRule: 'last_week', source: 'document', acceptedTypes: ['xlsx'], what: 'things' });
  assert.deepEqual(RC.setupFrom(null), []); assert.deepEqual(RC.setupFrom({ k: 'v' }).map((s) => s.key), ['k']);
});

test('lab recipes compile | candidates | promote | discard through the CLI', () => {
  const r = delivered({ title: 'CLI learned request' });
  const lab = (...args) => { const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'lab'), ...args], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' }); return { code: p.status, out: `${p.stdout}${p.stderr}` }; };
  const c = lab('recipes', 'compile', r.id);
  assert.equal(c.code, 0, c.out); assert.match(c.out, /cand-cli-learned-request written to .*candidates\/cand-cli-learned-request\.json \(learned from REQ-\d+/);
  const l = lab('recipes', 'candidates');
  assert.equal(l.code, 0); assert.match(l.out, /cand-cli-learned-request\s+used\s+1\s+learned from REQ-\d+\s+question\/investigator\s+CLI learned request/);
  const pr = lab('recipes', 'promote', 'cand-cli-learned-request', '--by', 'Mo', '0 6 2 * *');
  assert.notEqual(pr.code, 0); assert.match(pr.out, /used 1 time/);
  RC.recordUse('cand-cli-learned-request', 'REQ-80'); RC.recordEvalReport('cand-cli-learned-request', { pass: true });
  const ok = lab('recipes', 'promote', 'cand-cli-learned-request', '--by', 'Mo', '0 6 2 * *');
  assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /cand-cli-learned-request → R\d{2} v1/);
  const id = /→ (R\d{2}) v1/.exec(ok.out)[1];
  assert.equal(RC.load(id).trigger.default, '0 6 2 * *'); assert.equal(RC.load(id).promotedBy, 'Mo');
  const r2 = delivered({ title: 'CLI discarded request' });
  assert.equal(lab('recipes', 'compile', r2.id).code, 0);
  const d = lab('recipes', 'discard', 'cand-cli-discarded-request', '--by', 'Mo');
  assert.equal(d.code, 0, d.out); assert.match(d.out, /moved to .*\.discarded\/cand-cli-discarded-request\.json/);
  assert.match(lab('recipes', 'compile').out, /recipes compile <REQ-n>/);
  assert.match(lab('recipes', 'bogus').out, /compile <REQ-n> \| candidates \| promote/);
  assert.match(lab('recipes', 'list').out, new RegExp(`${id} v1`));
});
