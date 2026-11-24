'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { csv, twice, orderInvariant, CM } = require('./_h');
const V = CM.get('threshold_test');

const ITEMS = csv('gl_items.csv', [
  'Account,Type,Amount,Date,Description',
  'Office Supplies,Expense,450.25,2026-03-02,Staples',
  'Computer Equipment,Fixed Asset,"1,850.00",2026-03-10,Dell laptop',
  'Rent,Expense,5000,2026-03-01,March rent',
  'Sales,Income,9000,2026-03-05,Customer invoice',
  'Furniture,Expense,(999.99),2026-03-15,Office chair refund',
  'Servers,Fixed Asset,2500,2026-04-01,Rack server',
  'Misc,Expense,,2026-03-20,no amount',
].join('\n'));

test('threshold_test: class and period filters, per-candidate counts/totals/pct to the cent', () => {
  const r = twice(V, { files: [ITEMS], args: { period: '2026-03', threshold: 1000 } });
  orderInvariant(V, { files: [ITEMS], args: { period: '2026-03', threshold: 1000 } });
  assert.deepEqual(r.population, { count: 4, total: 8300.24 });
  assert.deepEqual(r.filtered, { byClass: 1, byPeriod: 1, noAmount: 1 });
  assert.deepEqual(r.candidates, [
    { threshold: 500, belowCount: 1, belowTotal: 450.25, aboveCount: 3, aboveTotal: 7849.99, pctOfTotal: 5.42 },
    { threshold: 1000, belowCount: 2, belowTotal: 1450.24, aboveCount: 2, aboveTotal: 6850, pctOfTotal: 17.47 },
    { threshold: 2500, belowCount: 3, belowTotal: 3300.24, aboveCount: 1, aboveTotal: 5000, pctOfTotal: 39.76 },
    { threshold: 5000, belowCount: 3, belowTotal: 3300.24, aboveCount: 1, aboveTotal: 5000, pctOfTotal: 39.76 },
  ]);
  assert.equal(r.chosen.threshold, 1000);
  assert.deepEqual(r.chosen.largestBelow.map((i) => [i.account, i.amount]), [['Furniture', -999.99], ['Office Supplies', 450.25]]);
  assert.deepEqual(r.chosen.smallestAbove.map((i) => [i.account, i.amount]), [['Computer Equipment', 1850], ['Rent', 5000]]);
});

test('threshold_test: custom candidates and classes; no period keeps every dated row', () => {
  const r = twice(V, { files: [ITEMS], args: { candidates: [2000], classes: ['Fixed Asset'] } });
  assert.deepEqual(r.population, { count: 2, total: 4350 });
  assert.deepEqual(r.candidates, [{ threshold: 2000, belowCount: 1, belowTotal: 1850, aboveCount: 1, aboveTotal: 2500, pctOfTotal: 42.53 }]);
  assert.equal(r.chosen, undefined);
});

test('threshold_test: edge — empty population gives zero totals and 0 pct, never NaN', () => {
  const r = twice(V, { files: [ITEMS], args: { period: '2025-01', threshold: 500 } });
  assert.deepEqual(r.population, { count: 0, total: 0 });
  assert.deepEqual(r.candidates[0], { threshold: 500, belowCount: 0, belowTotal: 0, aboveCount: 0, aboveTotal: 0, pctOfTotal: 0 });
  assert.deepEqual(r.chosen, { threshold: 500, largestBelow: [], smallestAbove: [] });
});
