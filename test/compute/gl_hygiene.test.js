'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, csv, twice, orderInvariant } = require('./_h');
const V = require('../../src/compute/gl_hygiene');

const lines = [
  { _id: 'J1', date: '2026-10-05', name: 'Rent October', accounting_category: 'Rent Expense', accounting_accounts: 'Expense', amount: 5000, glType: 'debit', createdBy: 'alice' },
  { _id: 'J2', date: '2026-10-05', name: 'Rent October', accounting_category: 'Operating Checking', accounting_accounts: 'Bank', amount: 5000, glType: 'credit', createdBy: 'alice' },
  { _id: 'J3', date: '2026-10-10', name: 'test', accounting_category: 'Office Supplies', accounting_accounts: 'Expense', amount: 123.45, glType: 'debit', createdBy: 'bob' },
  { _id: 'J4', date: '2026-10-10', name: 'test', accounting_category: 'Operating Checking', accounting_accounts: 'Bank', amount: 123.45, glType: 'credit', createdBy: 'bob' },
  { _id: 'J5', date: '2026-10-20', name: '', accounting_category: 'Accounts Payable', accounting_accounts: 'Liability', amount: 7000, glType: 'debit', createdBy: 'alice' },
  { _id: 'J6', date: '2026-10-20', name: 'Vendor payment', accounting_category: 'Operating Checking', accounting_accounts: 'Bank', amount: 7000, glType: 'credit', createdBy: 'alice' },
  { _id: 'J7', date: '2026-09-30', name: 'Sept accrual', accounting_category: 'Accrued Expenses', accounting_accounts: 'Liability', amount: 400, glType: 'credit', createdBy: 'alice' },
  { _id: 'J8', date: '2026-10-21', name: 'Software', accounting_category: 'Software', accounting_accounts: 'Expense', amount: 99, glType: 'debit', createdBy: 'carol' },
];

test('gl_hygiene: all five checks over V2-style accounting rows in one period', () => {
  assert.equal(new Date('2026-10-10T00:00:00Z').getUTCDay(), 6, 'fixture sanity: 2026-10-10 is a Saturday');
  const files = [jf('gl.json', { rows: lines })];
  const r = twice(V, { files, args: { period: '2026-10' } });
  assert.equal(r.scanned, 8); assert.equal(r.outOfPeriod, 1); assert.equal(r.unparsed, 0);
  assert.deepEqual(r.counts, { blank_description: 3, rare_user: 2, round_number: 4, weekend_posting: 2, wrong_sign: 2 });
  const of = (check) => r.findings.filter((f) => f.check === check);
  assert.deepEqual(of('blank_description').map((f) => [f.id, f.why]), [['J5', 'blank description'], ['J3', 'placeholder description "test"'], ['J4', 'placeholder description "test"']]);
  assert.deepEqual(of('round_number').map((f) => f.id), ['J5', 'J2', 'J6', 'J1'], 'sorted by account then date then id');
  assert.deepEqual(of('weekend_posting').map((f) => f.id), ['J3', 'J4']);
  assert.match(of('weekend_posting')[0].why, /Saturday/);
  assert.deepEqual(of('wrong_sign').map((f) => [f.account, f.amount]), [['Accounts Payable', 7000], ['Operating Checking', 12123.45]]);
  assert.match(of('wrong_sign')[0].why, /Liability "Accounts Payable" is credit-normal but nets debit 7000\.00/);
  assert.deepEqual(of('rare_user').map((f) => [f.user, f.ids]), [['bob', ['J3', 'J4']], ['carol', ['J8']]]);
  assert.ok(r.findings.every((f) => f.check !== 'rare_user' || f.account === undefined));
  orderInvariant(V, { files, args: { period: '2026-10' } });
});

test('gl_hygiene: thresholds and check selection; unknown account types are counted, not guessed', () => {
  const files = [jf('gl.json', lines)];
  const r = twice(V, { files, args: { period: '2026-10', roundThreshold: 6000, checks: ['round_number', 'wrong_sign'] } });
  assert.deepEqual(r.counts, { round_number: 2, wrong_sign: 2 });
  assert.deepEqual(r.findings.filter((f) => f.check === 'round_number').map((f) => f.id), ['J5', 'J6']);
  const thousands = twice(V, { files, args: { period: '2026-10', roundModulus: 1000, checks: ['round_number'] } });
  assert.equal(thousands.counts.round_number, 4);
  const rare = twice(V, { files, args: { checks: ['rare_user'], rareUserMax: 1 } });
  assert.deepEqual(rare.findings.map((f) => f.user), ['carol']);
  const unknown = twice(V, { files: [csv('gl.csv', 'id,date,description,account,debit,credit\n1,2026-10-01,Thing,Mystery Account,,10\n2,2026-10-01,Thing,Rent Expense,10,\n')], args: {} });
  assert.equal(unknown.accountsWithUnknownType, 1); assert.deepEqual(unknown.counts.wrong_sign, 0);
  assert.equal(unknown.findings.length, 0);
});

test('gl_hygiene: contra assets are credit-normal by name; debit/credit CSV columns and $-formatted amounts', () => {
  const r = twice(V, { files: [csv('gl.csv', 'id,date,description,account,type,debit,credit,user\n1,2026-10-01,Dep,Accumulated Depreciation,Asset,,"$1,000.00",mo\n2,2026-10-01,Dep,Depreciation Expense,Expense,"$1,000.00",,mo\n3,2026-10-03,Fix,Accumulated Depreciation,Asset,"$2,500.00",,mo\n4,2026-10-03,Fix,Depreciation Expense,Expense,,"$2,500.00",mo\n')], args: { checks: ['wrong_sign'] } });
  assert.deepEqual(r.findings.map((f) => [f.account, f.amount]), [['Accumulated Depreciation', 1500], ['Depreciation Expense', 1500]]);
  const empty = twice(V, { files: [jf('e.json', [])], args: {} });
  assert.equal(empty.scanned, 0); assert.deepEqual(empty.findings, []);
});
