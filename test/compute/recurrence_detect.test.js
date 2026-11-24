'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, csv, twice } = require('./_h');
const V = require('../../src/compute/recurrence_detect');

test('recurrence_detect: Dime vendor-spend-analysis with bare month names, per-vendor aggregation across accounts, exclude', () => {
  const r = twice(V, { files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-11', exclude: ['ZOOM'] } });
  assert.equal(r.checked, 4); assert.equal(r.excluded, 1); assert.equal(r.currentMonthInData, true);
  assert.deepEqual(r.monthsSeen, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(r.window, { from: '2026-08', to: '2026-11' });
  assert.equal(r.missing.length, 1);
  const m = r.missing[0];
  assert.equal(m.vendor, 'Rent Co');
  assert.deepEqual(m.priorMonths, [{ month: '2026-08', amount: 3000 }, { month: '2026-09', amount: 3050 }, { month: '2026-10', amount: 3000 }], 'Rent + Utilities rows summed per vendor');
  assert.equal(m.average, 3016.67); assert.equal(m.currentMonthAmount, 0);
  assert.equal(m.lastPostingDate, undefined, 'no dates in a monthly series');
});

test('recurrence_detect: without the exclusion Zoom is missing too; months window changes the answer', () => {
  const r = twice(V, { files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-11' } });
  assert.deepEqual(r.missing.map((m) => m.vendor), ['Rent Co', 'Zoom'], 'sorted by |average| descending');
  const six = twice(V, { files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-11', months: 5 } });
  assert.deepEqual(six.missing.map((m) => m.vendor), ['Rent Co', 'Zoom']);
  const min = twice(V, { files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-11', minAverage: 100 } });
  assert.deepEqual(min.missing.map((m) => m.vendor), ['Rent Co']);
  const oct = twice(V, { files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-10' } });
  assert.deepEqual(oct.missing, [], 'anchoring moves with currentMonth: everybody recurring posted in Oct');
});

test('recurrence_detect: flat rows with dates — month bucketing and lastPostingDate; explicit YYYY-MM series', () => {
  const text = 'vendor,date,amount\nAWS,2026-07-03,410.10\nAWS,2026-08-03,398.00\nAWS,2026-09-05,402.20\nAWS,2026-10-04,415.00\nSlack,2026-08-01,80\nSlack,2026-09-01,80\nSlack,2026-10-01,80\nSlack,2026-11-01,80\n';
  const r = twice(V, { files: [csv('spend.csv', text)], args: { currentMonth: '2026-11' } });
  assert.deepEqual(r.missing.map((m) => [m.vendor, m.average, m.lastPostingDate]), [['AWS', 405.07, '2026-10-04']]);
  const r2 = twice(V, { files: [jf('v.json', { vendors: [{ vendor: 'Rent', monthlySpend: [{ month: '2026-09', amount: 100 }, { month: '2026-10', amount: 100 }] }] })], args: { currentMonth: '2026-11', months: 2 } });
  assert.equal(r2.missing.length, 1); assert.equal(r2.currentMonthInData, false, 'the reader can see Nov never appears in the data at all');
});

test('recurrence_detect: refuses without a valid currentMonth or months', () => {
  assert.throws(() => V.run({ files: [fixture('vendor_spend.json')], args: {} }), /currentMonth is required/);
  assert.throws(() => V.run({ files: [fixture('vendor_spend.json')], args: { currentMonth: 'Nov 2026' } }), /YYYY-MM/);
  assert.throws(() => V.run({ files: [fixture('vendor_spend.json')], args: { currentMonth: '2026-11', months: 0 } }), /positive integer/);
});
