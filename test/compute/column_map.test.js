'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, csv, twice } = require('./_h');
const X = require('../../src/xlsx');
const V = require('../../src/compute/column_map');

test('column_map: payroll gross-to-net CSV maps every canonical by text (exact → normalised → synonym → tokens)', () => {
  const r = twice(V, { files: [fixture('payroll.csv')], args: { schema: 'payroll_gross_to_net' } });
  assert.equal(r.rowCount, 2); assert.deepEqual(r.missing, []); assert.deepEqual(r.ambiguous, []); assert.deepEqual(r.unmapped, []);
  const m = Object.fromEntries(Object.entries(r.mapping).map(([k, v]) => [k, `${v.header}@${v.column}:${v.how}`]));
  assert.deepEqual(m, {
    employee: 'Employee Name@0:synonym', payDate: 'Check Date@1:synonym', payPeriodStart: 'Period Start@2:synonym', payPeriodEnd: 'Period End@3:synonym',
    grossWages: 'Gross Pay@4:synonym', employeeTaxes: 'Employee Taxes@5:normalised', employee401k: '401(k)@6:synonym', healthDeduction: 'Medical@7:synonym',
    otherDeductions: 'Other Deductions@8:normalised', netPay: 'Net Pay@9:normalised', employerTaxes: 'Employer Taxes@10:normalised', employerMatch: 'Company Match@11:synonym', providerFee: 'Payroll Fee@12:synonym',
  });
});

test('column_map: never by position — shuffled headers give the same header names with new column indexes; exact beats everything', () => {
  const a = twice(V, { files: [csv('c.csv', 'Date,Merchant,Amount,Cardholder\n2026-10-01,Uber,12.5,Ada\n')], args: { schema: 'card_export' } });
  const b = twice(V, { files: [csv('c.csv', 'Cardholder,Amount,Merchant,Date\nAda,12.5,Uber,2026-10-01\n')], args: { schema: 'card_export' } });
  assert.deepEqual(Object.keys(a.mapping), ['amount', 'cardholder', 'date', 'merchant']);
  for (const k of Object.keys(a.mapping)) { assert.equal(a.mapping[k].header, b.mapping[k].header); assert.notEqual(a.mapping[k].column, b.mapping[k].column); }
  assert.equal(a.mapping.date.how, 'normalised');
  const exact = twice(V, { files: [jf('c.json', [{ date: '2026-10-01', 'Transaction Date': 'x', merchant: 'Uber', amount: 1 }])], args: { schema: 'card_export' } });
  assert.equal(exact.mapping.date.how, 'exact'); assert.equal(exact.mapping.date.header, 'date'); assert.deepEqual(exact.unmapped, ['Transaction Date']);
});

test('column_map: ambiguity on a required canonical is refused with the candidates; args.synonyms pins one header', () => {
  const f = csv('c.csv', 'Transaction Date,Posted Date,Merchant,Amount\n2026-10-01,2026-10-02,Uber,12.5\n');
  assert.throws(() => V.run({ files: [f], args: { schema: 'card_export' } }), /ambiguous required column\(s\) for schema card_export: date → "Transaction Date" \(col 0\) \| "Posted Date" \(col 1\)/);
  const pinned = twice(V, { files: [f], args: { schema: 'card_export', synonyms: { date: ['Posted Date'] } } });
  assert.equal(pinned.mapping.date.header, 'Posted Date'); assert.deepEqual(pinned.unmapped, ['Transaction Date']);
  // ambiguity on an optional canonical is reported, not refused
  const bank = twice(V, { files: [csv('b.csv', 'Date,Description,Amount,Ending Balance,Running Balance\n2026-10-01,Coffee,-4,96,96\n')], args: { schema: 'bank_statement' } });
  assert.deepEqual(bank.ambiguous, [{ canonical: 'balance', candidates: [{ header: 'Ending Balance', column: 3 }, { header: 'Running Balance', column: 4 }], how: 'synonym' }]);
  assert.deepEqual(bank.missing, []); assert.deepEqual(bank.unmapped, []);
});

test('column_map: required alternatives (amount | debit+credit), missing is reported, legacy TB from XLSX', () => {
  const dc = twice(V, { files: [csv('b.csv', 'Posting Date,Details,Withdrawals,Deposits\n2026-10-01,Coffee,4,\n')], args: { schema: 'bank_statement' } });
  assert.deepEqual(dc.missing, []); assert.equal(dc.mapping.debit.header, 'Withdrawals'); assert.equal(dc.mapping.credit.header, 'Deposits'); assert.equal(dc.mapping.amount, undefined);
  const miss = twice(V, { files: [csv('b.csv', 'Posting Date,Details,Withdrawals\n2026-10-01,Coffee,4\n')], args: { schema: 'bank_statement' } });
  assert.deepEqual(miss.missing, ['amount|debit+credit']);
  const buf = X.writeXlsx([{ name: 'TB', header: ['Acct No', 'Account Title', 'Debit', 'Credit'], rows: [['1000', 'Cash', 500, null], ['3000', 'Equity', null, 500]] }]);
  const w = X.readXlsx(buf); const file = { name: 'tb.xlsx', path: '/inline/tb.xlsx', sha: 'x', sheets: w.sheets, rows: w.sheets[0].rows };
  const tb = twice(V, { files: [file], args: { schema: 'legacy_tb' } });
  assert.equal(tb.rowCount, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(tb.mapping).map(([k, v]) => [k, v.header])), { accountCode: 'Acct No', accountName: 'Account Title', credit: 'Credit', debit: 'Debit' });
  assert.equal(tb.mapping.accountName.how, 'tokens');
});

test('column_map: custom schema, header row override, and refusals', () => {
  const c = twice(V, { files: [csv('x.csv', 'Report,,\nWho,When,How Much\nA,2026-01-01,5\n')], args: { schema: 'custom', headerRow: 2, synonyms: { person: ['who'], date: ['when'], amount: ['how much'] }, required: ['person', 'amount'] } });
  assert.deepEqual(Object.fromEntries(Object.entries(c.mapping).map(([k, v]) => [k, v.column])), { amount: 2, date: 1, person: 0 }); assert.equal(c.rowCount, 1);
  assert.throws(() => V.run({ files: [csv('x.csv', 'a,b\n1,2\n')], args: { schema: 'nope' } }), /unknown schema nope/);
  assert.throws(() => V.run({ files: [csv('x.csv', 'a,b\n1,2\n')], args: { schema: 'custom' } }), /needs args\.synonyms/);
  assert.throws(() => V.run({ files: [csv('x.csv', '')], args: { schema: 'card_export' } }), /no header row/);
});
