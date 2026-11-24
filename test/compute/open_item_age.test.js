'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, csv, twice } = require('./_h');
const V = require('../../src/compute/open_item_age');

test('open_item_age: Dime GL register — reference match first, then FIFO; balance rows and post-asOf rows ignored', () => {
  const r = twice(V, { files: [fixture('gl_register.json')], args: { asOf: '2026-11-30' } });
  assert.equal(r.scanned, 7); assert.equal(r.afterAsOf, 1, 'R7 is after asOf'); assert.equal(r.unparsed, 0, 'Beginning/Ending Balance rows are skipped silently');
  assert.deepEqual(r.matched, [
    { debitId: 'R1', creditId: 'R2', amount: 1000, how: 'reference' },
    { debitId: 'R3', creditId: 'R5', amount: 250, how: 'fifo' },
  ]);
  assert.deepEqual(r.open, [
    { id: 'R4', date: '2026-09-20', amount: 250, side: 'debit', ageDays: 71, likelySource: 'JE-6 — Accrual', matchedAgainst: null },
    { id: 'R6', date: '2026-10-15', amount: 75.5, side: 'debit', ageDays: 46, likelySource: 'Bank fee', matchedAgainst: null },
  ]);
  assert.equal(r.netBalance, 325.5); assert.equal(r.openTotal, 325.5); assert.equal(r.openDebits, 325.5); assert.equal(r.openCredits, 0);
  assert.deepEqual(r.buckets, { '0-30': { count: 0, amount: 0 }, '31-60': { count: 1, amount: 75.5 }, '61-90': { count: 1, amount: 250 }, '90+': { count: 0, amount: 0 } });
});

test('open_item_age: a shared reference token beats FIFO order; method fifo ignores references', () => {
  const rows = [
    { id: 'D1', date: '2026-01-01', description: 'Invoice 500 for A', reference: 'INV-A1', amount: 500 },
    { id: 'D2', date: '2026-01-02', description: 'Invoice for B', reference: 'INV-B2', amount: 500 },
    { id: 'C1', date: '2026-01-03', description: 'Payment INV-B2', reference: 'CHK-9', amount: -500 },
  ];
  const ref = twice(V, { files: [jf('x.json', rows)], args: { asOf: '2026-01-31' } });
  assert.deepEqual(ref.matched, [{ debitId: 'D2', creditId: 'C1', amount: 500, how: 'reference' }]);
  assert.equal(ref.open[0].id, 'D1'); assert.equal(ref.open[0].ageDays, 30);
  const fifo = twice(V, { files: [jf('x.json', rows)], args: { asOf: '2026-01-31', method: 'fifo' } });
  assert.deepEqual(fifo.matched, [{ debitId: 'D1', creditId: 'C1', amount: 500, how: 'fifo' }]);
  assert.equal(fifo.open[0].id, 'D2');
});

test('open_item_age: CSV with signed amounts, credits left open age too, 90+ bucket carries a negative amount', () => {
  const r = twice(V, { files: [csv('reg.csv', 'id,date,memo,amount\nA,01/05/2026,Deposit in transit,-1500\nB,2026-04-01,Fee,20\n')], args: { asOf: '2026-04-30' } });
  assert.deepEqual(r.open.map((o) => [o.id, o.side, o.ageDays]), [['A', 'credit', 115], ['B', 'debit', 29]]);
  assert.equal(r.buckets['90+'].amount, -1500); assert.equal(r.buckets['0-30'].amount, 20);
  assert.equal(r.openTotal, -1480); assert.equal(r.netBalance, -1480);
});

test('open_item_age: refuses without asOf (no wall clock) and with an unknown method', () => {
  assert.throws(() => V.run({ files: [fixture('gl_register.json')], args: {} }), /args\.asOf is required/);
  assert.throws(() => V.run({ files: [fixture('gl_register.json')], args: { asOf: 'yesterday' } }), /must be a date/);
  assert.throws(() => V.run({ files: [fixture('gl_register.json')], args: { asOf: '2026-11-30', method: 'lifo' } }), /unknown method/);
});
