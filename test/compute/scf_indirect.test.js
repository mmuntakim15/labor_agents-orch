'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, twice, orderInvariant, CM } = require('./_h');
const V = CM.get('scf_indirect');

const bs = (cash, ar, inv, equip, accum, ap, accrued, loan, stock, re) => [
  { account: 'Operating Checking', type: 'Bank', subtype: 'Checking', balance: cash },
  { account: 'Accounts Receivable', type: 'Accounts Receivable', balance: ar },
  { account: 'Inventory', type: 'Other Current Asset', subtype: 'Inventory', balance: inv },
  { account: 'Equipment', type: 'Fixed Asset', balance: equip },
  { account: 'Accumulated Depreciation', type: 'Fixed Asset', balance: accum },
  { account: 'Accounts Payable', type: 'Accounts Payable', balance: ap },
  { account: 'Accrued Liabilities', type: 'Other Current Liability', balance: accrued },
  { account: 'Bank Loan', type: 'Long Term Liability', balance: loan },
  { account: 'Common Stock', type: 'Equity', balance: stock },
  { account: 'Retained Earnings', type: 'Equity', balance: re },
  { account: 'Total Assets', type: '', balance: 999999 },
];
const OPEN = jf('bs_open.json', bs(10000, 5000, 3000, 20000, -4000, 2500, 800, 12000, 10000, 8700));
const CLOSE = jf('bs_close.json', bs(13725.5, 6200.25, 2800, 25000, -5500, 3100.75, 650, 10500, 12000, 15975));
const PL = jf('pl.json', [
  { account: 'Revenue', type: 'Income', amount: 30000 }, { account: 'Cost of Goods Sold', type: 'Cost of Goods Sold', amount: 12000 },
  { account: 'Rent', type: 'Expense', amount: 6000 }, { account: 'Depreciation Expense', type: 'Expense', amount: 1500 }, { account: 'Other Expense', type: 'Other Expense', amount: 3225 },
  { account: 'Net Income', type: '', amount: 7275 },
]);

test('scf_indirect: two-period rebuild reconciles to the change in cash to the cent', () => {
  const r = twice(V, { files: [OPEN, CLOSE, PL] });
  orderInvariant(V, { files: [OPEN, CLOSE, PL] });
  assert.equal(r.operating.netIncome, 7275);
  assert.deepEqual(r.operating.adjustments.map((a) => [a.account, a.amount]), [['Accumulated Depreciation', 1500], ['Accounts Receivable', -1200.25], ['Inventory', 200], ['Accounts Payable', 600.75], ['Accrued Liabilities', -150]]);
  assert.equal(r.operating.total, 8225.5);
  assert.deepEqual(r.investing.lines.map((a) => [a.account, a.amount]), [['Equipment', -5000]]); assert.equal(r.investing.total, -5000);
  assert.deepEqual(r.financing.lines.map((a) => [a.account, a.amount]), [['Bank Loan', -1500], ['Common Stock', 2000]]); assert.equal(r.financing.total, 500);
  assert.deepEqual([r.netChange, r.cashOpening, r.cashClosing, r.cashChange, r.unexplained, r.reconciles], [3725.5, 10000, 13725.5, 3725.5, 0, true]);
  assert.equal(r.checks.plDepreciationVsAccumulatedChange.difference, 0);
  assert.equal(r.checks.netIncomeVsRetainedEarningsRoll.difference, 0);
  assert.deepEqual(r.unclassified, []);
});

test('scf_indirect: system SCF comparison, dividends show as the retained-earnings roll residual, mapping overrides', () => {
  const sys = jf('scf_system.json', [{ line: 'Net Income', amount: 7275 }, { line: 'Net cash from operating activities', amount: 8225.5 }, { line: 'Net cash used in investing activities', amount: -5000 }, { line: 'Net cash from financing activities', amount: 600 }, { line: 'Change in Accounts Receivable', amount: -1200.25 }]);
  const r = twice(V, { files: [OPEN, CLOSE, PL, sys] });
  assert.deepEqual(r.comparison.map((c) => [c.line, c.rebuilt, c.system, c.difference]), [
    ['Change in Accounts Receivable', -1200.25, -1200.25, 0], ['Net Income', 7275, 7275, 0], ['Net cash from financing activities', 500, 600, -100], ['Net cash from operating activities', 8225.5, 8225.5, 0], ['Net cash used in investing activities', -5000, -5000, 0],
  ]);
  assert.equal(r.comparisonTies, false);
  // $500 dividends: retained earnings and cash both 500 lower
  const divClose = jf('bs_close2.json', bs(13225.5, 6200.25, 2800, 25000, -5500, 3100.75, 650, 10500, 12000, 15475));
  const d = twice(V, { files: [OPEN, divClose, PL] });
  assert.equal(d.reconciles, true); assert.equal(d.financing.total, 0);
  assert.deepEqual(d.financing.lines[2], { account: 'Retained earnings roll beyond net income', change: 6775, amount: -500, why: 'retained earnings fell by more than net income: implied distributions/dividends or prior-period adjustment' });
  const m = twice(V, { files: [OPEN, CLOSE, PL], args: { mapping: { 'bank loan': 'operating' }, netIncome: '7,275.00' } });
  assert.equal(m.operating.total, 6725.5); assert.equal(m.financing.total, 2000); assert.equal(m.reconciles, true);
  assert.equal(m.checks.profitAndLoss.netIncomeOverridden, true);
});

test('scf_indirect: edge — an account nobody can classify breaks reconciliation and is listed; bad mapping bucket throws', () => {
  const weird = jf('bs_close3.json', [...bs(13725.5, 6200.25, 2800, 25000, -5500, 3100.75, 650, 10500, 12000, 15975), { account: 'Mystery', type: 'Unknown', balance: 100 }]);
  const r = twice(V, { files: [OPEN, weird, PL] });
  assert.equal(r.reconciles, false); assert.deepEqual(r.unclassified.map((u) => [u.account, u.change]), [['Mystery', 100]]);
  assert.throws(() => V.run({ files: [OPEN, CLOSE, PL], args: { mapping: { x: 'nope' } } }), /bucket/);
});
