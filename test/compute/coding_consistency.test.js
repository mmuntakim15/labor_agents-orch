'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, csv, twice, orderInvariant } = require('./_h');
const V = require('../../src/compute/coding_consistency');

const rows = [
  { _id: 't1', date: '2026-10-02', merchant_name: 'Uber', accounting_category: 'Travel', amount: -100, department: 'Sales' },
  { _id: 't2', date: '2026-10-09', merchant_name: 'UBER *TRIP', name: 'UBER', accounting_category: 'Travel', amount: -50 },
  { _id: 't3', date: '2026-10-16', merchant_name: 'Uber', accounting_category: 'Travel', amount: -25 },
  { _id: 't4', date: '2026-10-23', merchant_name: 'Uber', accounting_category: 'Meals & Entertainment', amount: -30, department: 'Ops' },
  { _id: 't5', date: '2026-09-01', merchant_name: 'Uber', accounting_category: 'Entertainment', amount: -300 },
  { _id: 't6', date: '2026-10-03', merchant_name: 'Amazon', accounting_category: 'Office Supplies', amount: -40 },
  { _id: 't7', date: '2026-10-04', merchant_name: 'Amazon, Inc.', accounting_category: 'Office Supplies', amount: -60 },
  { _id: 't8', date: '2026-10-05', merchant_name: 'Amazon', accounting_category: 'Software', amount: -12 },
  { _id: 't9', date: '2026-10-01', merchant_name: 'Rent Co', accounting_category: 'Rent', amount: -3000, department: 'Sales' },
  { _id: 't10', date: '2026-10-01', merchant_name: 'Rent Co', accounting_category: 'Rent', amount: -1000, department: 'Ops' },
  { _id: 't11', date: '2026-10-07', merchant_name: 'Single Vendor', accounting_category: 'Misc', amount: -5 },
];

test('coding_consistency: V2-style rows, period filter, dominant account, allowedSplits whitelist', () => {
  const files = [jf('txns.json', { rows, pagination: { total: rows.length } })];
  const r = twice(V, { files, args: { period: '2026-10', allowedSplits: { 'AMAZON INC': ['Office Supplies', 'Software'] } } });
  assert.equal(r.rowsScanned, 11); assert.equal(r.rowsOutOfPeriod, 1);
  assert.equal(r.vendorsChecked, 5, 'Uber, "uber trip" (not fuzzy-merged), Amazon (Inc. dropped), Rent Co, Single Vendor');
  assert.equal(r.exceptions.length, 1);
  const u = r.exceptions[0];
  assert.equal(u.vendor, 'Uber'); assert.equal(u.dominant, 'Travel');
  assert.deepEqual(u.accounts.map((a) => [a.account, a.count, a.total]), [['Travel', 2, 125], ['Meals & Entertainment', 1, 30]], '"UBER *TRIP" is a different vendor key, so Uber has 2 Travel rows + 1 Meals row');
  assert.match(u.why, /2 of 3 postings go to "Travel"; also coded to "Meals & Entertainment" ×1/);
  orderInvariant(V, { files, args: { period: '2026-10' } });
});

test('coding_consistency: without the whitelist Amazon is an exception too; minCount hides small vendors', () => {
  const files = [jf('txns.json', rows)];
  const r = twice(V, { files, args: { period: { start: '2026-10-01', end: '2026-10-31' } } });
  assert.deepEqual(r.exceptions.map((e) => e.vendor), ['Amazon', 'Uber'], 'both split 2 ways; ties sort by vendor');
  assert.equal(r.exceptions[0].dominant, 'Office Supplies');
  const strict = twice(V, { files, args: { period: '2026-10', minCount: 4 } });
  assert.deepEqual(strict.exceptions, [], 'Uber has 3 in-period rows, Amazon 3');
  const all = twice(V, { files, args: {} });
  assert.equal(all.exceptions.find((e) => e.vendor === 'Uber').accounts.length, 3, 'no period: the September Entertainment row counts');
});

test('coding_consistency: byDepartment splits the breakdown but a single account is never an exception; bills with line_items; CSV headers', () => {
  const r = twice(V, { files: [jf('txns.json', rows)], args: { period: '2026-10', byDepartment: true } });
  assert.ok(!r.exceptions.some((e) => e.vendor === 'Rent Co'), 'Rent Co: one account across two departments');
  const uber = r.exceptions.find((e) => e.vendor === 'Uber');
  assert.deepEqual(uber.accounts.map((a) => [a.account, a.department, a.count, a.total]), [['Travel', 'Sales', 1, 100], ['Meals & Entertainment', 'Ops', 1, 30], ['Travel', null, 1, 25]], 'cells tie on count, so they sort by total');
  const bills = twice(V, { files: [jf('bills.json', [
    { id: 'b1', vendor_name: 'Comcast', issue_date: '2026-10-01', line_items: [{ gl_account: 'Utilities', total_with_tax: 200 }, { gl_account: 'Telephone', total_with_tax: 50 }] },
    { id: 'b2', vendor_name: 'Comcast', issue_date: '2026-10-01', line_items: [{ gl_account: 'Utilities', total_with_tax: 200 }] },
  ])], args: {} });
  assert.equal(bills.exceptions[0].vendor, 'Comcast'); assert.equal(bills.exceptions[0].dominant, 'Utilities'); assert.equal(bills.rowsScanned, 3);
  const c = twice(V, { files: [csv('x.csv', 'Vendor,Account,Amount\nA,Rent,1\nA,Rent,2\nB,Fees,3\nB,,4\n')], args: {} });
  assert.deepEqual(c.exceptions, []); assert.equal(c.rowsUnparsed, 1, 'a row without an account is counted, not guessed');
});
