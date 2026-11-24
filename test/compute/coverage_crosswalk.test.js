'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, csv, twice } = require('./_h');
const V = require('../../src/compute/coverage_crosswalk');

test('coverage_crosswalk: Dime live TB + workPapers dictionary — P&L excluded, bank recon by name containment, draft prepaid is "no activity"', () => {
  const files = [fixture('tb_live.json'), fixture('workpapers_dictionary.json')];
  const r = twice(V, { files, args: { asOf: '2026-11-30' } });
  assert.deepEqual(r.totals, { accounts: 10, considered: 8, covered: 2, uncovered: 6, excludedByType: 2, belowMin: 0, zeroBalance: 0, uncoveredBalance: 127000, schedules: 3 });
  assert.deepEqual(r.covered.map((c) => [c.account, c.support, c.schedule]), [['Operating Checking', 'bank_recon', 'br1'], ['Equipment', 'fixed_asset', 'fa1']]);
  assert.deepEqual(r.uncovered.map((u) => [u.account, u.balance, u.expectedSupport, u.reason]), [
    ['SBA Loan', -80000, 'debt', 'no schedule'],
    ['Retained Earnings', -20000, 'external', 'no schedule'],
    ['Deferred Revenue', -12000, 'revrec', 'no schedule'],
    ['Prepaid Insurance', 6000, 'prepaid', 'schedule found but no activity'],
    ['Accumulated Depreciation', -5000, 'fixed_asset', 'no schedule'],
    ['Accrued Expenses', -4000, 'accrual', 'no schedule'],
  ]);
  assert.deepEqual(r.uncovered[3].schedule, { id: 'pp1', type: 'prepaid', why: 'status draft' });
  assert.equal(r.covered[0].balance, 52000); assert.equal(r.uncovered[0].code, '2500');
});

test('coverage_crosswalk: flat CSV TB + schedule array matched by accountId; zero balances and minBalance; stale schedule', () => {
  const tb = csv('tb.csv', 'Account Code,Account Name,Type,Balance\n1000,Checking,Bank,"12,000.00"\n1050,Undeposited Funds,Other Current Asset,0\n1200,Prepaid Rent,Other Current Asset,900\n2200,Note Payable - Truck,Long Term Liability,"(18,000.00)"\n4000,Revenue,Income,"(50,000.00)"\n5000,COGS,Cost of Goods Sold,20000\n6100,Petty Cash Expense,Expenses,45\n');
  const schedules = jf('s.json', [
    { accountId: '1000', type: 'bank_recon', endDate: '2026-11-30', items: [{}] },
    { accountId: '2200', type: 'debt', endDate: '2026-06-30', items: [{}] },
  ]);
  const r = twice(V, { files: [tb, schedules], args: { asOf: '2026-11-30' } });
  assert.deepEqual(r.totals, { accounts: 7, considered: 3, covered: 1, uncovered: 2, excludedByType: 3, belowMin: 0, zeroBalance: 1, uncoveredBalance: 18900, schedules: 2 });
  assert.deepEqual(r.covered.map((c) => c.account), ['Checking']);
  assert.deepEqual(r.uncovered.map((u) => [u.account, u.expectedSupport, u.reason, u.schedule && u.schedule.why]), [
    ['Note Payable - Truck', 'debt', 'schedule found but no activity', 'last period ends 2026-06-30'],
    ['Prepaid Rent', 'prepaid', 'no schedule', undefined],
  ]);
  const min = twice(V, { files: [tb, schedules], args: { asOf: '2026-11-30', minBalance: 1000 } });
  assert.equal(min.totals.belowMin, 1); assert.equal(min.totals.uncovered, 1);
  const noExcl = twice(V, { files: [tb, schedules], args: { asOf: '2026-11-30', excludeTypes: [] } });
  assert.equal(noExcl.totals.excludedByType, 0); assert.equal(noExcl.totals.considered, 6);
});

test('coverage_crosswalk: no schedules file → everything uncovered; expected-support heuristic by name', () => {
  const r = twice(V, { files: [fixture('tb_live.json')], args: { asOf: '2026-11-30' } });
  assert.equal(r.totals.covered, 0); assert.equal(r.totals.uncovered, 8); assert.equal(r.totals.schedules, 0);
  const byName = Object.fromEntries(r.uncovered.map((u) => [u.account, u.expectedSupport]));
  assert.deepEqual(byName, { 'Operating Checking': 'bank_recon', 'Prepaid Insurance': 'prepaid', Equipment: 'fixed_asset', 'Accumulated Depreciation': 'fixed_asset', 'Accrued Expenses': 'accrual', 'Deferred Revenue': 'revrec', 'SBA Loan': 'debt', 'Retained Earnings': 'external' });
});

test('coverage_crosswalk: refuses without asOf and with an unreadable trial balance', () => {
  assert.throws(() => V.run({ files: [fixture('tb_live.json')], args: {} }), /args\.asOf is required/);
  assert.throws(() => V.run({ files: [jf('tb.json', [{ foo: 1 }])], args: { asOf: '2026-11-30' } }), /no account rows/);
});
