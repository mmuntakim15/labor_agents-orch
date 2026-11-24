'use strict';
// The RD-2 recipe evaluators, each on a small workbook or data file built in the sandbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('./helpers');
sandbox('evaluators');
const T = require('../src/request');
const X = require('../src/xlsx');
const DN = require('../src/done');
const PR = require('../src/proposals');

/** The house workbook: Exceptions (count/total rows, header, data), Tie-out (Difference 0.00), Sources. */
function standardBook({ exceptions = [['TX-1', 'Acme', 120.5], ['TX-2', 'Beta', 80]], difference = 0, header = ['Transaction id', 'Vendor', 'Amount'], extraCell = null, tieSheet = true } = {}) {
  const total = exceptions.reduce((s, r) => s + (Number(r[2]) || 0), 0);
  const ex = { name: 'Exceptions', rows: [['Count', exceptions.length, 'Total', total], [], header, ...exceptions, ...(extraCell ? [[extraCell]] : [])] };
  const tie = { name: 'Tie-out', rows: [['Figure', 'Workbook', 'Dime'], ['Account balance', total, total], ['Difference', difference]] };
  const src = { name: 'Sources', rows: [['Source', 'Period', 'Pulled'], ['Dime general ledger, account 1200', 'October 2026', '2026-11-03']] };
  return X.writeXlsx(tieSheet ? [ex, tie, src] : [ex, src]);
}
async function run(r, done, call) { T.saveRequest({ ...r, done }); return DN.runAll(T.loadRequest(r.id), { call }); }
const one = async (r, item, call) => (await run(r, [{ id: 'D-1', ...item }], call)).items[0];

test('exceptions_have_source: every exception row needs an id/ref/link/source cell', async () => {
  const r = T.createRequest({ title: 'e', body: '' });
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook());
  let it = await one(r, { evaluator: 'exceptions_have_source', args: { name: 'x.xlsx' } });
  assert.equal(it.pass, true); assert.equal(it.figures.rows, 2); assert.deepEqual(it.figures.sourceColumns, ['Transaction id']);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ exceptions: [['TX-1', 'Acme', 1], [null, 'Beta', 2], ['', 'Gamma', 3]] }));
  it = await one(r, { evaluator: 'exceptions_have_source' });
  assert.equal(it.pass, false); assert.equal(it.figures.rowsWithoutSource.length, 2); assert.match(it.note, /2 exception row/);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ header: ['Vendor', 'Memo', 'Amount'] }));
  it = await one(r, { evaluator: 'exceptions_have_source' });
  assert.equal(it.pass, false); assert.match(it.note, /no column headed/);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ exceptions: [] }));
  it = await one(r, { evaluator: 'exceptions_have_source' });
  assert.equal(it.pass, true, 'no exceptions is a clean result'); assert.match(it.note, /no exception rows/);
  assert.equal((await one(r, { evaluator: 'exceptions_have_source', args: { name: 'nope.xlsx' } })).pass, false);
  assert.match((await one(r, { evaluator: 'exceptions_have_source', args: { sheet: 'Detail' } })).note, /no Detail sheet/);
});

test('deliverable_standard: Exceptions first with Count and Total, a Tie-out difference of 0.00, no plumbing words', async () => {
  const r = T.createRequest({ title: 's', body: '' });
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook());
  assert.equal((await one(r, { evaluator: 'deliverable_standard' })).pass, true);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ difference: 0.02 }));
  let it = await one(r, { evaluator: 'deliverable_standard' }); assert.equal(it.pass, false); assert.match(it.note, /Difference is 0\.02/);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ tieSheet: false }));
  it = await one(r, { evaluator: 'deliverable_standard' }); assert.equal(it.pass, false); assert.match(it.note, /no Tie-out/);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ extraCell: 'pulled from /api/v1/accountant/reports/x (receipt R-3)' }));
  it = await one(r, { evaluator: 'deliverable_standard' }); assert.equal(it.pass, false); assert.match(it.note, /plumbing/); assert.equal(it.figures.leaks, 1);
  // Tie-out as a block inside another sheet also counts; Exceptions not first fails
  const ex = { name: 'Exceptions', rows: [['Count', 1, 'Total', 5], [], ['Id', 'Amount'], ['A', 5], [], ['Tie-out'], ['Difference', 0]] };
  T.writeArtifact(r.id, 'deliverables/x.xlsx', X.writeXlsx([ex]));
  assert.equal((await one(r, { evaluator: 'deliverable_standard' })).pass, true, 'tie-out block inside the sheet');
  T.writeArtifact(r.id, 'deliverables/x.xlsx', X.writeXlsx([{ name: 'Detail', rows: [['a']] }, ex]));
  it = await one(r, { evaluator: 'deliverable_standard' }); assert.equal(it.pass, false); assert.match(it.note, /first sheet is Detail/);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', X.writeXlsx([{ name: 'Exceptions', rows: [['Id', 'Amount'], ['A', 5], ['Tie-out'], ['Difference', 0]] }]));
  it = await one(r, { evaluator: 'deliverable_standard' }); assert.equal(it.pass, false); assert.match(it.note, /Count label/); assert.match(it.note, /Total label/);
});

test('rollforward_ties: opening + additions − reductions = closing per row, totals row equals the sums', async () => {
  const r = T.createRequest({ title: 'rf', body: '' });
  const rows = (closing2, totals) => [['Asset', 'Opening', 'Additions', 'Reductions', 'Closing'], ['Truck', 1000, 200, 50, 1150], ['Laptop', 300, 0, 100, closing2], ...(totals ? [['Total', 1300, 200, 150, 1150 + closing2]] : [])];
  T.writeArtifact(r.id, 'deliverables/rf.xlsx', X.writeXlsx([{ name: 'Exceptions', rows: [['Count', 0]] }, { name: 'Rollforward', rows: rows(200, true) }]));
  let it = await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx' } });
  assert.equal(it.pass, true, it.note); assert.equal(it.figures.closing, 1350); assert.equal(it.figures.rows, 2);
  T.writeArtifact(r.id, 'deliverables/rf.xlsx', X.writeXlsx([{ name: 'Rollforward', rows: rows(201, true) }]));
  it = await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx', sheet: 'Rollforward' } });
  assert.equal(it.pass, false); assert.equal(it.figures.rowsOff[0].difference, -1); assert.match(it.note, /1 row/);
  T.writeArtifact(r.id, 'deliverables/rf.xlsx', X.writeXlsx([{ name: 'Rollforward', rows: rows(200, false) }]));
  it = await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx' } }); assert.equal(it.pass, false); assert.match(it.note, /no totals row/);
  assert.equal((await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx', totalsRow: false } })).pass, true);
  T.writeArtifact(r.id, 'deliverables/rf.xlsx', X.writeXlsx([{ name: 'Rollforward', rows: [['Asset', 'Opening', 'Additions', 'Reductions', 'Closing'], ['Truck', 1000, 200, 50, 1150], ['Total', 999, 200, 50, 1150]] }]));
  it = await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx' } }); assert.equal(it.pass, false); assert.match(it.note, /totals row differs: opening 999/);
  T.writeArtifact(r.id, 'data/rf.json', { rows: [{ name: 'a', Opening: 10, Increases: 5, Decreases: 3, Ending: 12 }, { name: 'Total', Opening: 10, Increases: 5, Decreases: 3, Ending: 12 }] });
  assert.equal((await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.json' } })).pass, true, 'json rows with synonyms');
  assert.match((await one(r, { evaluator: 'rollforward_ties', args: { file: 'rf.xlsx', sheet: 'Exceptions' } })).note || 'x', /./);
});

test('ties_to_gl_account: the deliverable carries the account balance Dime returns', async () => {
  const r = T.createRequest({ title: 'gl', body: '' }); r.subject = { businessIds: ['b1'] }; T.saveRequest(r);
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ exceptions: [['TX-1', 'Acme', 1200.5], ['TX-2', 'Beta', 300]] }));
  const calls = [];
  const call = async ({ path: p, query }) => { calls.push({ p, query }); return { ok: true, status: 200, json: { summary: { beginningBalance: 0, totalDebits: 1500.5, totalCredits: 0, endingBalance: 1500.5 } } }; };
  const args = { account: 'Clearing', startDate: '2026-01-01', endDate: '2026-10-31' };
  let it = await one(r, { evaluator: 'ties_to_gl_account', args }, call);
  assert.equal(it.pass, true, it.note); assert.deepEqual(it.figures.b1, { 'summary.endingBalance': 1500.5 });
  assert.equal(calls[0].p, '/api/v1/accountant/reports/general-ledger-account-realtime/b1'); assert.deepEqual(calls[0].query, { startDate: '2026-01-01', endDate: '2026-10-31', account: 'Clearing' });
  it = await one(r, { evaluator: 'ties_to_gl_account', args, expect: { figure: 'totalDebits' } }, async () => ({ ok: true, status: 200, json: { summary: { totalDebits: 999 } } }));
  assert.equal(it.pass, false); assert.match(it.note, /999.*not in the deliverable/);
  assert.match((await one(r, { evaluator: 'ties_to_gl_account', args }, async () => ({ ok: false, status: 404 }))).note, /failed \(404\)/);
  assert.match((await one(r, { evaluator: 'ties_to_gl_account', args: { account: 'x' } }, call)).note, /needs args/);
  assert.match((await one({ ...r, subject: {} }, { evaluator: 'ties_to_gl_account', args }, call)).note, /no businessId/);
});

test('no_double_count: two proposals with the same vendor, amount and period fail', async () => {
  const r = T.createRequest({ title: 'dc', body: '' });
  assert.equal((await one(r, { evaluator: 'no_double_count' })).pass, true, 'no proposals');
  PR.add(r.id, { kind: 'bill', tier: 'B', summary: 'a', method: 'POST', path: '/x', body: { vendorName: 'Acme Supply', amount: 240, date: '2026-10-05' }, amount: 240 });
  PR.add(r.id, { kind: 'bill', tier: 'B', summary: 'b', method: 'POST', path: '/x', body: { vendorName: 'Beta', amount: 240, date: '2026-10-05' }, amount: 240 });
  PR.add(r.id, { kind: 'bill', tier: 'B', summary: 'c', method: 'POST', path: '/x', body: { vendorName: 'Acme Supply', amount: 240, date: '2026-09-05' }, amount: 240 });
  assert.equal((await one(r, { evaluator: 'no_double_count' })).pass, true, 'different vendor or period is fine');
  PR.add(r.id, { kind: 'bill', tier: 'B', summary: 'd', method: 'POST', path: '/x', body: { vendor: 'acme supply', amount: 240, date: '2026-10-28' }, amount: 240 });
  const it = await one(r, { evaluator: 'no_double_count' });
  assert.equal(it.pass, false); assert.deepEqual(it.figures.duplicates.map((d) => [d.a, d.b]), [['P-1', 'P-4']]);
});

test('column_headers_mapped: ambiguous or missing required columns fail', async () => {
  const r = T.createRequest({ title: 'cm', body: '' });
  T.writeArtifact(r.id, 'data/map.json', { columns: [{ name: 'Employee', to: 'employee', status: 'mapped', required: true }, { name: 'Gross', to: 'gross', status: 'mapped', required: true }] });
  assert.equal((await one(r, { evaluator: 'column_headers_mapped', args: { file: 'map' } })).pass, true);
  T.writeArtifact(r.id, 'data/map.json', { columns: [{ name: 'Employee', status: 'mapped' }], ambiguous: ['Tax'], missing: ['Net'] });
  let it = await one(r, { evaluator: 'column_headers_mapped', args: { file: 'map.json' } });
  assert.equal(it.pass, false); assert.match(it.note, /ambiguous: Tax/); assert.match(it.note, /missing required: Net/);
  T.writeArtifact(r.id, 'data/map.json', { mapping: { Employee: { to: 'employee', status: 'mapped' }, Bonus: { status: 'missing', required: false } }, required: ['Employee'] });
  assert.equal((await one(r, { evaluator: 'column_headers_mapped', args: { file: 'map' } })).pass, true, 'an optional missing column is fine');
  assert.match((await one(r, { evaluator: 'column_headers_mapped', args: {} })).note, /needs args.file/);
  assert.match((await one(r, { evaluator: 'column_headers_mapped', args: { file: 'none' } })).note, /not found/);
});

test('figure_in_range: a json figure or the exception count sits within the bounds; advisory and unfilled tokens', async () => {
  const r = T.createRequest({ title: 'fr', body: '' });
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ exceptions: [['A', 'v', 1], ['B', 'v', 2], ['C', 'v', 3]] }));
  let it = await one(r, { evaluator: 'figure_in_range', args: { sheet: 'Exceptions' }, expect: { min: 1, max: 60 } });
  assert.equal(it.pass, true); assert.deepEqual(Object.values(it.figures), [3]);
  it = await one(r, { evaluator: 'figure_in_range', expect: { max: 2 } }); assert.equal(it.pass, false); assert.match(it.note, /= 3, expected/);
  it = await one(r, { evaluator: 'figure_in_range', expect: { max: 2, advisory: true } }); assert.equal(it.pass, false); assert.equal(it.advisory, true);
  const all = await run(r, [{ id: 'D-1', evaluator: 'figure_in_range', expect: { max: 2 }, advisory: true }]);
  assert.equal(all.pass, true, 'a done item marked advisory never blocks'); assert.equal(all.items[0].advisory, true);
  it = await one(r, { evaluator: 'figure_in_range', expect: { max: '{{setup.maxExceptions}}' } }); assert.equal(it.pass, false); assert.match(it.note, /non-numeric bound/);
  T.writeArtifact(r.id, 'data/kpi.json', { summary: { netIncome: 12418.22 }, rows: [] });
  assert.equal((await one(r, { evaluator: 'figure_in_range', args: { file: 'kpi', figure: 'summary.netIncome' }, expect: { min: 10000, max: 20000 } })).pass, true);
  assert.equal((await one(r, { evaluator: 'figure_in_range', args: { file: 'kpi.json', figure: 'netIncome' }, expect: { equals: 12418.22 } })).pass, true, 'nested key by name');
  assert.match((await one(r, { evaluator: 'figure_in_range', args: { file: 'kpi', figure: 'nothing' } })).note, /not found/);
  assert.match((await one(r, { evaluator: 'figure_in_range', args: { file: 'kpi' } })).note, /needs args.figure/);
});

test('no_judgement_words: the default list and a custom one, as whole words', async () => {
  const r = T.createRequest({ title: 'jw', body: '' });
  T.writeArtifact(r.id, 'deliverables/x.xlsx', standardBook({ exceptions: [['TX-1', 'Equinox', 120], ['TX-2', 'Whole Foods', 80]] }));
  assert.equal((await one(r, { evaluator: 'no_judgement_words' })).pass, true);
  T.writeArtifact(r.id, 'deliverables/memo.md', 'The cardholder is clearly lazy and this looks like personal use.\nAbuser accounts are fine as a word.');
  let it = await one(r, { evaluator: 'no_judgement_words' });
  assert.equal(it.pass, false); assert.deepEqual([...new Set(it.figures.hits.map((h) => h.word))].sort(), ['lazy', 'personal use']);
  assert.equal((await one(r, { evaluator: 'no_judgement_words', args: { name: 'x.xlsx' } })).pass, true, 'scoped to one deliverable');
  it = await one(r, { evaluator: 'no_judgement_words', args: { words: ['equinox'] } }); assert.equal(it.pass, false); assert.equal(it.figures.hits[0].file, 'x.xlsx');
  assert.match((await one(r, { evaluator: 'no_judgement_words', args: { name: 'none.xlsx' } })).note, /not found/);
});

test('the catalogue lists every evaluator once and the trial balance report route exists', () => {
  const names = DN.CATALOG.map((c) => c.evaluator);
  assert.deepEqual([...new Set(names)].sort(), Object.keys(DN.EVALUATORS).sort());
  assert.equal(DN.REPORT_ROUTES.trial_balance.path('b1'), '/api/v1/accountant/reports/trial-balance-asof/b1');
  assert.deepEqual(DN.REPORT_ROUTES.trial_balance.args({ asOf: '2026-10-31' }), { asOf: '2026-10-31' });
  assert.deepEqual(DN.table([['Count', 2], [], ['Id', 'Amount'], ['A', 1], ['Total', 1]]), { headerIndex: 2, header: ['Id', 'Amount'], data: [['A', 1]], totals: [['Total', 1]] });
});
