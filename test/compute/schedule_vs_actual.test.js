'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, csv, twice, orderInvariant, CM } = require('./_h');
const V = CM.get('schedule_vs_actual');

const SCHEDULES = csv('schedules.csv', [
  'Contract,Customer,Start Date,End Date,Term Months,Period,Amount,Escalator Pct',
  'C-1,Acme,2026-01-01,,12,monthly,"1,000.00",',
  'C-2,Beta,2025-07-01,2027-06-30,,quarterly,3000,10',
  'C-3,Gamma,2026-02-10,,,one_time,5000,',
  'C-4,Delta,,,,monthly,10,',
].join('\n'));
const INVOICES = jf('invoices.json', [
  { number: 'INV-1', contract: 'C-1', customer: 'Acme', date: '2026-01-03', amount: 1000 },
  { number: 'INV-2', contract: 'C-1', customer: 'Acme', date: '2026-02-01', amount: 1000 },
  { number: 'INV-3', contract: 'C-1', customer: 'Acme', date: '2026-03-20', amount: 1000 },
  { number: 'INV-4', contract: '', customer: 'Beta', date: '2025-07-01', amount: 3000 },
  { number: 'INV-5', contract: 'C-2', customer: 'Beta', date: '2025-10-02', amount: 3300 },
  { number: 'INV-6', contract: 'C-2', customer: 'Beta', date: '2026-01-01', amount: 3000 },
  { number: 'INV-7', contract: 'C-2', customer: 'Beta', date: '2026-04-01', amount: 3000 },
  { number: 'INV-8', contract: 'C-3', customer: 'Gamma', date: '2026-02-10', amount: 5000 },
  { number: 'INV-9', contract: 'C-9', customer: 'Delta', date: '2026-03-01', amount: 750 },
  { number: 'INV-10', contract: 'C-1', customer: 'Acme', date: '2026-03-25', amount: 1000 },
  { number: 'INV-11', contract: 'C-1', customer: 'Acme', date: '2026-05-01', amount: 1000 },
]);
const PAYMENTS = jf('payments.json', [{ invoice: 'INV-1', date: '2026-01-20', amount: 1000 }]);

test('schedule_vs_actual: expansion, matching, mistimed, missing, unexpected, amount diffs — asOf 2026-04-15', () => {
  const ctx = { files: [SCHEDULES, INVOICES, PAYMENTS], args: { asOf: '2026-04-15' } };
  const r = twice(V, ctx); orderInvariant(V, ctx);
  assert.equal(r.expectedCount, 9); assert.equal(r.invoiceCount, 10, 'INV-11 after asOf is out of scope');
  assert.deepEqual(r.schedulesSkipped, [{ contract: 'C-4', why: 'no start date' }]);
  assert.deepEqual(r.counts, { matched: 7, missing: 1, unexpected: 2, mistimed: 1, amountDiffs: 1 });
  assert.deepEqual(r.matched.map((m) => m.invoice.number), ['INV-1', 'INV-2', 'INV-4', 'INV-5', 'INV-6', 'INV-7', 'INV-8']);
  assert.deepEqual(r.matched[0].invoice, { number: 'INV-1', contract: 'C-1', customer: 'Acme', date: '2026-01-03', amount: 1000, paid: 1000, lastPaymentDate: '2026-01-20', settled: true });
  assert.deepEqual(r.missing.map((e) => [e.contract, e.dueDate, e.amount]), [['C-1', '2026-04-01', 1000]]);
  assert.deepEqual(r.mistimed.map((m) => [m.expected.dueDate, m.invoice.number, m.daysOff]), [['2026-03-01', 'INV-3', 19]]);
  assert.deepEqual(r.unexpected.map((u) => [u.number, u.knownContract]), [['INV-9', false], ['INV-10', true]]);
  assert.deepEqual(r.amountDiffs.map((a) => [a.invoice.number, a.expected.amount, a.difference]), [['INV-5', 3000, 300]]);
  assert.deepEqual(r.totals, { expected: 21000, invoiced: 22050, matched: 19300, missing: 1000, unexpected: 1750, mistimed: 1000, amountDifference: 300 });
});

test('schedule_vs_actual: annual escalator applies from the first anniversary; termMonths derives the end date', () => {
  const r = twice(V, { files: [SCHEDULES, INVOICES], args: { asOf: '2026-08-01' } });
  const c2 = r.missing.filter((e) => e.contract === 'C-2');
  assert.deepEqual(c2.map((e) => [e.seq, e.dueDate, e.amount]), [[5, '2026-07-01', 3300]]);
  const c1 = [...r.matched, ...r.mistimed].filter((m) => m.expected.contract === 'C-1').concat(r.missing.filter((e) => e.contract === 'C-1').map((e) => ({ expected: e })));
  assert.equal(c1.length, 8, 'Jan..Aug 2026 inside the 12-month term');
  assert.equal(r.missing.find((e) => e.contract === 'C-1' && e.dueDate === '2026-08-01').periodEnd, '2026-08-31');
});

test('schedule_vs_actual: edge — tolerance changes classification; asOf is required', () => {
  assert.throws(() => V.run({ files: [SCHEDULES, INVOICES], args: {} }), /asOf/);
  const loose = twice(V, { files: [SCHEDULES, INVOICES], args: { asOf: '2026-04-15', dateTolerance: 20, amountTolerance: 500 } });
  assert.equal(loose.counts.mistimed, 0); assert.equal(loose.counts.amountDiffs, 0);
  assert.equal(loose.counts.matched, 9, 'INV-3 (19 days) and INV-10 (7 days before the April due date) both match now'); assert.equal(loose.counts.missing, 0); assert.equal(loose.counts.unexpected, 1);
});
