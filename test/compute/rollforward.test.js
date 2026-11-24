'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { csv, jf, twice, CM } = require('./_h');
const V = CM.get('rollforward');

const SCHEDULE = csv('fa_rollforward.csv', [
  'Asset,Opening,Additions,Depreciation,Disposals,Closing',
  'Truck,"10,000.00",0,"1,200.00",0,"8,800.00"',
  'Laptop,2500.50,0,500.10,0,2000.40',
  'Printer,800,200,100,700,0',
  'Total,"13,300.50",200,"1,800.10",700,"10,800.40"',
].join('\n'));

test('rollforward: per-row and total arithmetic to the cent, breaks, ignored total row, GL comparison', () => {
  const r = twice(V, { files: [SCHEDULE], args: { expectedClosingTotal: '10,800.40' } });
  assert.equal(r.rows.length, 3); assert.deepEqual(r.ignoredTotalRows, ['Total']);
  assert.deepEqual(r.rows[0], { key: 'Truck', opening: 10000, additions: 0, reductions: 1200, computedClosing: 8800, closing: 8800, difference: 0 });
  assert.deepEqual(r.rows[1], { key: 'Laptop', opening: 2500.5, additions: 0, reductions: 500.1, computedClosing: 2000.4, closing: 2000.4, difference: 0 });
  assert.deepEqual(r.rows[2], { key: 'Printer', opening: 800, additions: 200, reductions: 800, computedClosing: 200, closing: 0, difference: -200 });
  assert.deepEqual(r.totals, { opening: 13300.5, additions: 200, reductions: 2500.1, computedClosing: 11000.4, closing: 10800.4, difference: -200 });
  assert.deepEqual(r.breaks, [{ key: 'Printer', difference: -200 }]);
  assert.equal(r.ties, false);
  assert.deepEqual(r.columns.reductions, ['Depreciation', 'Disposals']);
  assert.deepEqual(r.glComparison, { expectedClosingTotal: 10800.4, scheduleClosing: 10800.4, difference: 0, ties: true });
  assert.equal(r.reductionsTreatedAs, 'positive values, subtracted');
});

test('rollforward: reductions already signed negative are detected and added; schedule ties', () => {
  const r = twice(V, { files: [jf('prepaids.json', [{ account: 'Insurance', opening: 1200, increases: 0, amortisation: -100, closing: 1100 }, { account: 'Software', opening: 2400.5, increases: 600, amortisation: -200.05, closing: 2800.45 }])] });
  assert.equal(r.ties, true); assert.deepEqual(r.breaks, []);
  assert.equal(r.rows[1].reductions, 200.05); assert.equal(r.rows[1].computedClosing, 2800.45);
  assert.equal(r.totals.reductions, 300.05); assert.equal(r.totals.closing, 3900.45);
  assert.equal(r.reductionsTreatedAs, 'signed (negative) values, added');
});

test('rollforward: args.columns maps unusual headers; GL comparison difference is reported', () => {
  const r = twice(V, { files: [csv('x.csv', 'Name,Start Bal,Adds,Less,End Bal\nA,100,50,25,125\nB,10.10,0,0.10,10.00')], args: { columns: { opening: 'Start Bal', additions: 'Adds', reductions: 'Less', closing: 'End Bal' }, expectedClosingTotal: 135.5 } });
  assert.equal(r.ties, false); assert.equal(r.breaks.length, 0, 'rows tie');
  assert.deepEqual(r.glComparison, { expectedClosingTotal: 135.5, scheduleClosing: 135, difference: -0.5, ties: false });
  assert.equal(r.columns.opening, 'Start Bal');
});

test('rollforward: edge — no closing column is a clear error; empty schedule is an error', () => {
  assert.throws(() => V.run({ files: [csv('x.csv', 'Account,Opening,Additions\nA,1,2')], args: {} }), /no closing column/);
  assert.throws(() => V.run({ files: [csv('x.csv', 'Account,Opening,Closing')], args: {} }), /no rows/);
});
