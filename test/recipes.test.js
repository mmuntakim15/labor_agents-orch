'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sandbox } = require('./helpers');
sandbox('recipes');
const RC = require('../src/recipes');
const DN = require('../src/done');
const PL = require('../src/plan');
const T = require('../src/request');
const O = require('../src/orchestrator');

const EXPECTED = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R29', 'R31', 'R42', 'R57', 'R58', 'R59', 'R60'];
// BRD-RD-2 §5.H groups 2 and 3: reconciliation, investigation, close and workpapers (writes, restricted data and L3 ceilings allowed)
const RD2 = ['R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R20', 'R21', 'R22', 'R23', 'R24', 'R25', 'R26', 'R27', 'R28'];
// BRD-RD-2 §5.H groups 3 to 6 (R30-R56 less R31 and R42, which are P0): close packages, reporting and treasury, research memos, gated changes
const RD2B = ['R30', 'R32', 'R33', 'R34', 'R35', 'R36', 'R37', 'R38', 'R39', 'R40', 'R41', 'R43', 'R44', 'R45', 'R46', 'R47', 'R48', 'R49', 'R50', 'R51', 'R52', 'R53', 'R54', 'R55', 'R56'];
const ALL = [...EXPECTED, ...RD2, ...RD2B].sort();
const pipeline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'pipeline.json'), 'utf8'));

test('the 16 P0 recipes load, validate, and every evaluator, kind, worker, tool and period rule they name exists', () => {
  const cur = RC.current();
  for (const id of ALL) assert.ok(cur[id], `${id} is missing from recipes/`); // other BRD rows land alongside; each range asserts its own ids
  for (const id of EXPECTED) {
    const r = cur[id];
    const v = RC.validate(r);
    assert.ok(v.ok, `${id}: ${v.errors.join('; ')}`);
    assert.equal(r.version, 1);
    assert.ok(pipeline.kinds.includes(r.kind)); assert.ok(PL.WORKERS.includes(r.worker));
    for (const d of r.done) if (d.evaluator) assert.ok(DN.EVALUATORS[d.evaluator], `${id} ${d.id}: evaluator ${d.evaluator} missing`);
    assert.ok(r.done.some((d) => d.evaluator), `${id} has no code-judged done item`);
    assert.ok(r.done.some((d) => d.evaluator === 'exceptions_have_source'), `${id} lacks exceptions_have_source`);
    assert.ok(r.done.some((d) => d.evaluator === 'deliverable_standard'), `${id} lacks deliverable_standard`);
    for (const t of r.tools) assert.ok(RC.TOOLS.includes(t));
    assert.equal(r.tools.includes('compute'), Boolean((r.compute || []).length), `${id}: compute tool iff a verb is named`);
    assert.ok(RC.PERIOD_RULES[r.trigger.periodRule], `${id}: period rule ${r.trigger.periodRule}`);
    assert.deepEqual(r.writes, []); assert.equal(r.autonomyCeiling, 'L4'); assert.equal(r.restrictedData, false);
    assert.equal(r.budgetUsd, [1, 7].includes(r.group) ? 3 : 6, `${id}: budget by group`);
    assert.deepEqual(r.deliverables[0].sheets, ['Exceptions', 'Tie-out', 'Detail', 'Sources']);
    assert.deepEqual(r.evals, [`evals/cases/${id.toLowerCase()}-seed-co`]);
    assert.equal(RC.load(id).id, id); assert.equal(RC.load(id, 1).version, 1);
  }
  assert.equal(RC.validateAll().ok, true);
  assert.throws(() => RC.load('R99'), /not found/); assert.throws(() => RC.load('R01', 7), /version 7/); assert.throws(() => RC.load('../x'), /bad recipe id/);
  const kinds = Object.fromEntries(EXPECTED.map((id) => [id, cur[id].kind]));
  for (const q of ['R01', 'R02', 'R03', 'R05', 'R06', 'R08', 'R09']) assert.equal(kinds[q], 'question', q);
  for (const rep of ['R04', 'R07', 'R29', 'R31', 'R42', 'R57', 'R58', 'R59', 'R60']) assert.equal(kinds[rep], 'report', rep);
  assert.equal(cur.R42.trigger.periodRule, 'prior_year'); assert.equal(cur.R57.trigger.default, '0 6 * * 1-5');
  assert.equal(cur.R59.inputs[0].source, 'standing'); assert.equal(cur.R59.inputs[0].maxAgeDays, 45); assert.equal(cur.R60.inputs[0].source, 'standing');
});

test('the 19 RD-2 reconciliation and close recipes (R10-R28) validate with the house shape: code-judged done items, tier rules on every write, restricted payroll rows at L3', () => {
  const cur = RC.current();
  const spec = { // group, kind, worker, budget, ceiling, restricted  (BRD-RD-2 §5.H)
    R10: [2, 'report', 'preparer', 12, 'L4', false], R11: [2, 'report', 'investigator', 10, 'L4', false], R12: [2, 'question', 'investigator', 6, 'L4', false],
    R13: [2, 'report', 'investigator', 10, 'L3-pending', true], R14: [2, 'report', 'investigator', 10, 'L3-pending', true], R15: [2, 'question', 'investigator', 8, 'L4', false],
    R16: [2, 'report', 'investigator', 15, 'L4', false], R17: [2, 'report', 'analyst', 8, 'L4', false], R18: [2, 'report', 'investigator', 10, 'L4', false],
    R19: [2, 'report', 'investigator', 15, 'L4', false], R20: [2, 'report', 'investigator', 8, 'L4', false], R21: [2, 'report', 'analyst', 6, 'L4', false],
    R22: [3, 'report', 'analyst', 20, 'L4', false], R23: [3, 'report', 'bookkeeper', 8, 'L4', false], R24: [3, 'report', 'preparer', 10, 'L4', false],
    R25: [3, 'report', 'bookkeeper', 8, 'L4', false], R26: [3, 'report', 'preparer', 10, 'L3-pending', true], R27: [3, 'report', 'bookkeeper', 8, 'L3-pending', true],
    R28: [3, 'report', 'preparer', 10, 'L4', false],
  };
  for (const id of RD2) {
    const r = cur[id]; const [group, kind, worker, budget, ceiling, restricted] = spec[id];
    const v = RC.validate(r);
    assert.ok(v.ok, `${id}: ${v.errors.join('; ')}`);
    assert.equal(r.version, 1); assert.equal(r.group, group, `${id} group`); assert.equal(r.kind, kind, `${id} kind`); assert.equal(r.worker, worker, `${id} worker`);
    assert.equal(r.budgetUsd, budget, `${id} budget`); assert.equal(r.autonomyCeiling, ceiling, `${id} ceiling`); assert.equal(r.restrictedData, restricted, `${id} restrictedData`);
    for (const d of r.done) if (d.evaluator) assert.ok(DN.EVALUATORS[d.evaluator], `${id} ${d.id}: evaluator ${d.evaluator} missing`);
    assert.ok(r.done.some((d) => d.evaluator === 'exceptions_have_source'), `${id} lacks exceptions_have_source`);
    assert.ok(r.done.some((d) => d.evaluator === 'deliverable_standard'), `${id} lacks deliverable_standard`);
    for (const t of r.tools) assert.ok(RC.TOOLS.includes(t));
    assert.equal(r.tools.includes('compute'), Boolean((r.compute || []).length), `${id}: compute tool iff a verb is named`);
    assert.ok(RC.PERIOD_RULES[r.trigger.periodRule], `${id}: period rule ${r.trigger.periodRule}`);
    for (const i of r.inputs) assert.ok(RC.INPUT_SOURCES.includes(i.source) && RC.PERIOD_RULES[i.periodRule], `${id} input ${i.name}`);
    for (const w of r.writes) { assert.ok(w.kind && w.route, `${id} write needs kind and route`); for (const t of w.tierRules) assert.ok(['A', 'B', 'C', 'human'].includes(t.tier) && t.when, `${id} ${w.kind} tier rule`); }
    if (r.writes.some((w) => ['journal_entry', 'accrual', 'depreciation_run', 'capitalize'].includes(w.kind))) assert.ok(r.done.some((d) => d.evaluator === 'proposals_balanced'), `${id}: entry writes need proposals_balanced`);
    assert.deepEqual(r.deliverables[0].sheets, ['Exceptions', 'Tie-out', 'Detail', 'Sources']);
    assert.deepEqual(r.evals, [`evals/cases/${id.toLowerCase()}-seed-co`]);
    assert.equal(RC.load(id).id, id);
  }
  // the named evaluators from the BRD rows
  assert.ok(cur.R10.done.some((d) => d.evaluator === 'ties_to_gl_account' && d.args.account === '{{setup.bankAccountsInScope}}'));
  assert.deepEqual(cur.R10.writes[0].tierRules.map((t) => t.tier), ['A', 'human'], 'bank reconciliation: create A, finalize never');
  for (const id of ['R18', 'R20', 'R22', 'R25']) assert.ok(cur[id].done.some((d) => d.evaluator === 'rollforward_ties'), `${id} rollforward_ties`);
  for (const id of ['R19', 'R22']) assert.ok(cur[id].done.some((d) => d.evaluator === 'ties_to_report' && d.args.report === 'trial_balance'), `${id} ties_to_report trial_balance`);
  for (const id of ['R23', 'R25', 'R27']) assert.ok(cur[id].done.some((d) => d.evaluator === 'no_double_count'), `${id} no_double_count`);
  for (const id of ['R13', 'R14', 'R19', 'R24', 'R26']) assert.ok(cur[id].done.some((d) => d.evaluator === 'column_headers_mapped'), `${id} column_headers_mapped`);
  assert.ok(cur.R14.done.some((d) => d.evaluator === 'no_judgement_words'));
  assert.ok(cur.R24.done.some((d) => d.evaluator === 'deliverable_exists'));
  assert.ok(cur.R26.done.some((d) => d.evaluator === 'figure_in_range' && d.expect.equals === 0));
  // pay-run recipes stand in with business_day and say so
  for (const id of ['R13', 'R14', 'R26']) { assert.equal(cur[id].trigger.periodRule, 'business_day'); assert.equal(cur[id].trigger.cadence, 'each pay run'); assert.equal(cur[id].trigger.default, null); assert.match(cur[id].comment, /last_pay_date/); }
  for (const id of ['R12', 'R19', 'R21']) assert.equal(cur[id].trigger.default, null, `${id} is on demand`);
  assert.equal(cur.R16.size, 'L'); assert.deepEqual(cur.R22.children, ['R10', 'R20', 'R28', 'R33']);
  assert.equal(cur.R10.inputs[0].connection, 'Plaid'); assert.equal(cur.R11.inputs[0].connection, 'Ramp'); assert.equal(cur.R18.inputs[0].connection, 'Stripe');
  assert.equal(cur.R24.inputs[1].source, 'standing');
  assert.ok(cur.R23.writes[0].tierRules[0].when.includes('{{setup.accrualCeiling}}'));
  assert.deepEqual(cur.R25.writes.map((w) => w.kind), ['prepaid_schedule', 'journal_entry']); assert.deepEqual(cur.R28.writes.map((w) => w.kind), ['depreciation_run', 'capitalize']);
  // shared '*' setup keys keep one wording across recipes
  const q = {}; for (const id of ALL) for (const s of cur[id].setup) { if (s.scope !== '*') continue; if (q[s.key]) assert.equal(s.q, q[s.key], `${id}: setup ${s.key} wording differs from an earlier recipe`); q[s.key] = s.q; }
});

test('the 25 RD-2 close, reporting, research and gated-change recipes (R30-R56) validate with the house shape: research memos hedge, payment runs and recharges never write, gated changes carry tier rules', () => {
  const cur = RC.current();
  const spec = { // group, kind, worker, budget, ceiling, restricted  (BRD-RD-2 §5.H)
    R30: [3, 'report', 'analyst', 15, 'L4', false], R32: [3, 'report', 'analyst', 8, 'L4', false], R33: [3, 'report', 'analyst', 8, 'L4', false], R34: [3, 'report', 'investigator', 12, 'L4', false],
    R35: [4, 'report', 'analyst', 20, 'L4', false], R36: [4, 'report', 'analyst', 8, 'L4', false], R37: [4, 'report', 'analyst', 8, 'L3-pending', true], R38: [4, 'report', 'analyst', 8, 'L4', false],
    R39: [4, 'question', 'analyst', 6, 'L4', false], R40: [4, 'report', 'analyst', 6, 'L3-policy', false], R41: [4, 'report', 'analyst', 8, 'L4', false],
    R43: [5, 'report', 'analyst', 20, 'L3-policy', false], R44: [5, 'report', 'analyst', 15, 'L3-policy', false], R45: [5, 'report', 'analyst', 15, 'L3-policy', false], R46: [5, 'report', 'analyst', 15, 'L3-policy', false],
    R47: [5, 'report', 'analyst', 12, 'L3-policy', false], R48: [5, 'report', 'analyst', 6, 'L4', false], R49: [5, 'report', 'analyst', 12, 'L3-policy', false],
    R50: [6, 'change_request', 'preparer', 8, 'L3-pending', false], R51: [6, 'change_request', 'bookkeeper', 8, 'L4', false], R52: [6, 'change_request', 'bookkeeper', 10, 'L4', false],
    R53: [6, 'change_request', 'preparer', 6, 'L4', false], R54: [6, 'change_request', 'bookkeeper', 12, 'L4', false], R55: [6, 'change_request', 'preparer', 8, 'L4', false], R56: [6, 'change_request', 'bookkeeper', 6, 'L4', false],
  };
  for (const id of RD2B) {
    const r = cur[id]; const [group, kind, worker, budget, ceiling, restricted] = spec[id];
    const v = RC.validate(r);
    assert.ok(v.ok, `${id}: ${v.errors.join('; ')}`);
    assert.equal(r.version, 1); assert.equal(r.group, group, `${id} group`); assert.equal(r.kind, kind, `${id} kind`); assert.equal(r.worker, worker, `${id} worker`);
    assert.equal(r.budgetUsd, budget, `${id} budget`); assert.equal(r.autonomyCeiling, ceiling, `${id} ceiling`); assert.equal(r.restrictedData, restricted, `${id} restrictedData`);
    for (const d of r.done) if (d.evaluator) assert.ok(DN.EVALUATORS[d.evaluator], `${id} ${d.id}: evaluator ${d.evaluator} missing`);
    assert.ok(r.done.some((d) => d.evaluator === 'exceptions_have_source'), `${id} lacks exceptions_have_source`);
    assert.ok(r.done.some((d) => d.evaluator === 'deliverable_standard'), `${id} lacks deliverable_standard`);
    for (const t of r.tools) assert.ok(RC.TOOLS.includes(t));
    assert.equal(r.tools.includes('compute'), Boolean((r.compute || []).length), `${id}: compute tool iff a verb is named`);
    assert.ok(RC.PERIOD_RULES[r.trigger.periodRule], `${id}: period rule ${r.trigger.periodRule}`);
    for (const i of r.inputs) assert.ok(RC.INPUT_SOURCES.includes(i.source) && RC.PERIOD_RULES[i.periodRule], `${id} input ${i.name}`);
    for (const w of r.writes) { assert.ok(w.kind && w.route, `${id} write needs kind and route`); for (const t of w.tierRules) assert.ok(['A', 'B', 'C', 'human'].includes(t.tier) && t.when, `${id} ${w.kind} tier rule`); }
    if (r.kind === 'change_request') { assert.ok(r.writes.length, `${id}: a change request names its writes`); assert.ok(r.done.some((d) => d.evaluator === 'proposals_balanced'), `${id}: writes need proposals_balanced`); }
    assert.ok(r.deliverables.some((d) => /\.xlsx$/.test(d.name) && d.sheets.join() === 'Exceptions,Tie-out,Detail,Sources'), `${id}: a workbook with the standard sheets`);
    assert.deepEqual(r.evals, [`evals/cases/${id.toLowerCase()}-seed-co`]);
    assert.equal(RC.load(id).id, id);
  }
  // research recipes (group 5): a memo pdf, hedged wording, no conclusion where facts are missing
  for (const id of ['R43', 'R44', 'R45', 'R46', 'R47', 'R48', 'R49']) {
    const r = cur[id];
    assert.ok(r.deliverables.some((d) => /\.pdf$/.test(d.name)), `${id} delivers a pdf`);
    const nj = r.done.find((d) => d.evaluator === 'no_judgement_words'); assert.ok(nj, `${id} no_judgement_words`); assert.deepEqual(nj.args.words, ['definitely', 'certainly', 'guaranteed']);
    assert.match(nj.text, /no conclusion where facts are missing/);
  }
  // the named evaluators from the BRD rows
  assert.ok(cur.R30.done.some((d) => d.evaluator === 'ties_to_report' && d.args.report === 'trial_balance'));
  assert.ok(cur.R33.done.some((d) => d.evaluator === 'rollforward_ties') && cur.R33.done.some((d) => d.evaluator === 'ties_to_gl_account' && d.args.account === '{{setup.deferredRevenueAccounts}}'));
  assert.ok(cur.R34.done.some((d) => d.evaluator === 'deliverable_exists' && d.args.name === 'client-request-email.md'));
  assert.deepEqual(cur.R35.done.filter((d) => d.evaluator === 'ties_to_report').map((d) => d.args.report), ['balance_sheet', 'profit_and_loss']);
  assert.ok(cur.R38.done.some((d) => d.evaluator === 'deliverable_exists') && cur.R38.done.some((d) => d.evaluator === 'figure_in_range'));
  assert.ok(cur.R39.done.some((d) => d.evaluator === 'ties_to_report' && d.args.report === 'profit_and_loss' && d.expect.figure === 'netIncome'));
  assert.ok(cur.R41.done.some((d) => d.evaluator === 'figure_in_range' && d.args.figure === 'reconciles'));
  for (const id of ['R37', 'R55']) assert.ok(cur[id].done.some((d) => d.evaluator === 'column_headers_mapped'), `${id} column_headers_mapped`);
  assert.ok(cur.R52.done.some((d) => d.evaluator === 'no_double_count'));
  for (const id of ['R35', 'R54']) assert.ok(cur[id].done.some((d) => d.evaluator === 'all_entities_covered') && cur[id].size === 'L', `${id} is a size L parent`);
  // recommendation-only and memo-only recipes never write; the payment run and the recharge say so in prose
  for (const id of ['R40', 'R46']) assert.deepEqual(cur[id].writes, [], `${id} writes nothing`);
  assert.ok(cur.R40.done.some((d) => !d.evaluator && /no payment is initiated/.test(d.text)) && cur.R40.done.some((d) => /bank details changed .* listed separately/.test(d.text)));
  assert.ok(cur.R46.done.some((d) => !d.evaluator && /never proposed/.test(d.text)));
  assert.ok(cur.R34.done.some((d) => /never sent/.test(d.text)));
  assert.ok(cur.R50.done.some((d) => /never merged or deleted/.test(d.text)));
  // tier rules as the BRD rows set them
  assert.deepEqual(cur.R35.writes.map((w) => [w.kind, w.optional, w.tierRules[0].tier]), [['report_package', true, 'A']]);
  assert.deepEqual(cur.R51.writes[0].tierRules.map((t) => t.tier), ['A', 'B']);
  assert.deepEqual(cur.R52.writes.map((w) => [w.kind, w.tierRules[0].tier]), [['recurring_entries', 'A'], ['depreciation_run', 'A']]);
  assert.deepEqual(cur.R53.writes[0].tierRules.map((t) => t.tier), ['A', 'B', 'C']);
  assert.deepEqual(cur.R54.writes.map((w) => [w.kind, w.tierRules[0].tier]), [['journal_entry', 'B']]);
  assert.deepEqual(cur.R55.writes[0].tierRules.map((t) => t.tier), ['A', 'C']);
  assert.equal(cur.R56.writes[0].kind, 'recode_to_bill'); assert.match(cur.R56.writes[0].tierRules[0].when, /to the cent.*30 days/);
  for (const w of cur.R50.writes) assert.ok(w.tierRules.every((t) => t.tier === 'B'), 'vendor fixes are tier B');
  // triggers and inputs
  for (const id of ['R34', 'R43', 'R44', 'R48']) assert.equal(cur[id].trigger.default, null, `${id} is on demand`);
  assert.equal(cur.R49.trigger.periodRule, 'prior_year'); assert.equal(cur.R53.trigger.periodRule, 'business_day'); assert.equal(cur.R38.trigger.periodRule, 'last_week');
  for (const id of ['R45', 'R46', 'R47']) assert.equal(cur[id].trigger.periodRule, 'prior_quarter', `${id} is quarterly`);
  assert.equal(cur.R36.inputs.find((i) => i.source === 'standing').maxAgeDays, 90); assert.ok(cur.R38.inputs.filter((i) => i.source === 'standing').length === 2);
  assert.ok(cur.R48.inputs[0].source === 'document' && cur.R48.inputs[0].optional === false); assert.ok(cur.R55.inputs[0].source === 'document' && cur.R55.inputs[0].optional === false);
  assert.ok(cur.R53.inputs.some((i) => i.source === 'connection') && cur.R53.inputs.some((i) => i.source === 'document' && i.optional));
});

test('validate: the schema rejects what it should and names the field', () => {
  const good = RC.load('R03');
  const bad = (patch) => RC.validate({ ...good, ...patch });
  assert.equal(bad({ id: 'X1' }).ok, false);
  assert.match(bad({ version: '1' }).errors.join(' '), /version/);
  assert.match(bad({ group: 9 }).errors.join(' '), /group/);
  assert.match(bad({ kind: 'memo' }).errors.join(' '), /kind/);
  assert.match(bad({ worker: 'cfo' }).errors.join(' '), /worker/);
  assert.match(bad({ trigger: { default: 'daily', periodRule: 'last_week', event: null } }).errors.join(' '), /cron/);
  assert.match(bad({ trigger: { default: null, periodRule: 'sometimes', event: null } }).errors.join(' '), /periodRule/);
  assert.match(bad({ setup: [{ key: 'bad key', q: 'q', type: 'text', scope: '*' }] }).errors.join(' '), /camelCase/);
  assert.match(bad({ setup: [{ key: 'k', q: 'q', type: 'colour', scope: 'global' }] }).errors.join(' '), /type.*scope|scope/);
  assert.match(bad({ inputs: [{ name: 'x', periodRule: 'last_week', source: 'connection' }] }).errors.join(' '), /connection/);
  assert.match(bad({ inputs: [{ name: 'x', periodRule: 'last_week', source: 'document' }] }).errors.join(' '), /acceptedTypes/);
  assert.match(bad({ done: [{ id: 'D-1', text: 't', evaluator: 'reads_minds' }] }).errors.join(' '), /reads_minds does not exist/);
  assert.match(bad({ done: [{ id: 'D-1', text: 'prose only' }] }).errors.join(' '), /code-judged/);
  assert.match(bad({ writes: [{ kind: 'x' }] }).errors.join(' '), /writes\[0\]/);
  assert.match(bad({ deliverables: [] }).errors.join(' '), /deliverables/);
  assert.match(bad({ autonomyCeiling: 'L5' }).errors.join(' '), /autonomyCeiling/);
  assert.match(bad({ restrictedData: 'no' }).errors.join(' '), /restrictedData/);
  assert.match(bad({ budgetUsd: 0 }).errors.join(' '), /budgetUsd/);
  assert.match(bad({ tools: ['curl'] }).errors.join(' '), /tool curl/);
  assert.match(bad({ compute: ['x'], tools: ['dime'] }).errors.join(' '), /lacks compute/);
  assert.match(bad({ evals: ['cases/x'] }).errors.join(' '), /evals/);
  assert.match(bad({ candidate: true }).errors.join(' '), /candidate never carries trigger.default/);
  assert.ok(RC.validate({ ...good, deliverables: [{ name: 'x.xlsx', sheets: ['Detail'] }] }).warnings.some((w) => /Exceptions/.test(w)));
  assert.equal(RC.validate(null).ok, false);
});

test('match: each library prompt returns its own recipe first at 0.8 or more; paraphrases land in the top three; unrelated text stays low', () => {
  const cur = RC.current();
  for (const id of ALL) {
    const hits = RC.match(cur[id].prompt);
    assert.equal(hits[0].id, id, `${id}: got ${hits[0].id}`);
    assert.ok(hits[0].score >= 0.8, `${id}: score ${hits[0].score}`);
    assert.ok(hits[0].score <= 1);
  }
  const para = RC.match('show me clearing items older than a month');
  assert.ok(para.slice(0, 3).some((h) => h.id === 'R03'), JSON.stringify(para));
  assert.ok(RC.match('any duplicate payments to vendors this year?')[0].id === 'R08');
  const flux = RC.match('Create a flux for the last two months and produce the report with a short memo');
  assert.ok(!flux.length || flux[0].score < O.RECIPE_MATCH_MIN, `flux must not adopt a recipe: ${JSON.stringify(flux)}`);
  assert.deepEqual(RC.match(''), []); assert.deepEqual(RC.match('the of and'), []);
  // an explicit recipe set is honoured (candidates folder support uses the same path)
  assert.deepEqual(RC.match('clearing account items', { recipes: [cur.R03] }).map((h) => h.id), ['R03']);
  assert.ok(RC.match('clearing account items', { limit: 2 }).length <= 2);
  assert.equal(RC.stem('closed'), RC.stem('close')); assert.equal(RC.stem('invoices'), RC.stem('invoice')); assert.equal(RC.stem('older'), 'age');
});

test('library: compact shape per recipe, and library.json round-trips', () => {
  // candidates compiled from solved requests (recipes/candidates/) ride along with candidate:true; this test is about the library rows
  const lib = RC.library().filter((r) => !r.candidate);
  const cur = RC.current();
  assert.equal(lib.length, Object.keys(cur).length);
  assert.deepEqual(lib.map((r) => r.id), Object.keys(cur).sort(), 'sorted by id');
  for (const id of ALL) assert.ok(lib.some((r) => r.id === id), `${id} missing from the library`);
  for (const r of lib) {
    assert.deepEqual(Object.keys(r).sort(), ['cadence', 'group', 'groupName', 'id', 'inputs', 'level', 'prompt', 'setupKeys', 'setupQuestions', 'title', 'version']);
    assert.ok(r.setupQuestions.every((q) => q.key && q.q && q.type && ['*', 'recipe'].includes(q.scope)), `${r.id} setup questions carry key, q, type, scope`);
    assert.equal(r.level, cur[r.id].autonomyCeiling === 'L4' ? 'L4' : 'L3'); assert.ok(typeof r.cadence === 'string' && r.cadence);
    assert.ok(r.setupKeys.every((k) => typeof k === 'string')); assert.ok(r.inputs.every((k) => typeof k === 'string'));
    assert.ok(!('done' in r) && !('tools' in r), 'no done items or tools in the picker list');
  }
  const by = Object.fromEntries(lib.map((r) => [r.id, r]));
  assert.equal(by.R03.cadence, 'weekly'); assert.equal(by.R29.cadence, 'weekly during close'); assert.equal(by.R42.cadence, 'year end'); assert.equal(by.R57.cadence, 'each business day'); assert.equal(by.R59.cadence, 'monthly');
  assert.equal(by.R10.cadence, 'month end'); assert.equal(by.R13.cadence, 'each pay run'); assert.equal(by.R13.level, 'L3'); assert.equal(by.R12.cadence, 'on request'); assert.equal(by.R17.cadence, 'monthly');
  assert.deepEqual(by.R03.setupKeys, ['clearingAccounts', 'expectedClearingDays']); assert.deepEqual(by.R59.inputs, ['Vendor contract register']);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-lib-')), 'generated', 'library.json');
  const w = RC.writeLibraryJson(tmp);
  const nCand = RC.candidates().length;
  assert.equal(w.count, lib.length + nCand);
  const back = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  assert.deepEqual(back.recipes.filter((r) => !r.candidate), lib); assert.equal(back.count, lib.length + nCand); assert.ok(back.builtAt);
  // the checked-in copy is current
  const checkedIn = JSON.parse(fs.readFileSync(RC.LIBRARY_FILE, 'utf8'));
  assert.deepEqual(checkedIn.recipes.filter((r) => !r.candidate), lib, 'knowledge/generated/library.json is stale: run `lab recipes library`');
});

test('setup answers fill {{setup.key}} tokens; the prompt blocks tell Intake and the Planner what to adopt', () => {
  const r = RC.load('R31');
  const filled = RC.fillSetup({ max: '{{setup.maxExceptions}}', note: 'at most {{setup.maxExceptions}} items' }, r, {});
  assert.equal(filled.max, 60, 'the setup default fills the token as a number'); assert.equal(filled.note, 'at most 60 items');
  assert.equal(RC.fillSetup('{{setup.maxExceptions}}', r, { maxExceptions: 25 }), 25);
  assert.equal(RC.fillSetup('{{setup.unknownKey}}', r, {}), '{{setup.unknownKey}}', 'unknown keys are left for Intake');
  const st = RC.setupStatus(r, { answers: { flagThreshold: 250 } });
  assert.deepEqual(st.answered.map((s) => s.key), ['flagThreshold']); assert.deepEqual(st.open.map((s) => s.key), ['maxExceptions']);
  const block = RC.intakeBlock(r, { setup: { flagThreshold: 250 }, matchInfo: { score: 0.91 } });
  assert.match(block, /^## Recipe/); assert.match(block, /match 0\.91/); assert.match(block, /"recipeId": "R31"/); assert.match(block, /flagThreshold: 250/); assert.match(block, /maxExceptions \(number, this recipe\)/); assert.match(block, /"max":60/);
  assert.match(RC.intakeBlock(r), /started from library recipe R31/);
  const pb = RC.plannerBlock(RC.load('R59'));
  assert.match(pb, /^## Recipe steps and inputs/); assert.match(pb, /recurrence_detect, schedule_vs_actual/); assert.match(pb, /Vendor contract register.*1\) connection.*2\) Dime.*3\) standing file.*fresh within 45 days.*4\) document/);
  assert.equal(RC.intakeBlock(null), ''); assert.equal(RC.plannerBlock(null), '');
});

test('orchestrator: intake context matches a recipe and keeps the match on the request; classify copies recipeId and recipeVersion', async () => {
  const r = T.createRequest({ title: 'Clearing items', body: 'Show all clearing account items older than 30 days and explain what each appears to relate to.' });
  const ctx = await O.buildCtx(r, 'intake', 'intake');
  assert.equal(ctx.recipe && ctx.recipe.id, 'R03'); assert.equal(ctx.recipeMatch.id, 'R03'); assert.ok(ctx.recipeMatch.score >= 0.8); assert.equal(ctx.recipeMatch.candidates.length, 3);
  assert.equal(T.loadRequest(r.id).recipeMatch.id, 'R03', 'the match is saved on the request');
  const prompt = O.agents.intake.plan(ctx).prompt;
  assert.match(prompt, /## Recipe\n/); assert.match(prompt, /R03 v1/); assert.match(prompt, /plus recipeId and recipeVersion/);
  const weak = T.createRequest({ title: 'Flux', body: 'Create a flux for the last two months and produce the report with a short memo' });
  const wctx = await O.buildCtx(weak, 'intake', 'intake');
  assert.equal(wctx.recipe, null); assert.doesNotMatch(O.agents.intake.plan(wctx).prompt, /## Recipe\nThis request/);
  const named = T.createRequest({ title: 'GL review', body: 'first pass' }); named.recipeId = 'R31'; named.recipeVersion = 1; T.saveRequest(named);
  const nctx = await O.buildCtx(named, 'scope', 'planner');
  assert.equal(nctx.recipe.id, 'R31'); assert.match(O.agents.planner.plan(nctx).prompt, /## Recipe steps and inputs/);
  const c = O.classify(r, { status: 'ok', kind: 'question', size: 'S', recipeId: 'R03', recipeVersion: 1 });
  assert.equal(c.recipeId, 'R03'); assert.equal(c.recipeVersion, 1);
  assert.ok(!('recipeId' in O.classify(r, { status: 'ok', kind: 'question', size: 'S' })), 'no recipe, no field');
  assert.ok(!('recipeId' in O.classify(r, { status: 'ok', recipeId: '../etc' })), 'odd ids are ignored');
  const tr = O.transition(r, 'intake', 'intake', { status: 'ok', kind: 'question', size: 'S', writes: false, worker: 'investigator', recipeId: 'R03', recipeVersion: 1 });
  assert.equal(tr.status, 'execute', 'transition rules are unchanged'); assert.equal(tr.patch.recipeId, 'R03');
});
