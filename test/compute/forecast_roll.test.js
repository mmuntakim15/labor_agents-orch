'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, csv, twice, CM } = require('./_h');
const V = CM.get('forecast_roll');

const FORECAST = csv('cash_forecast_13wk.csv', [
  'Line,2026-02-02,2026-02-09,2026-02-16,2026-02-23',
  'Opening Cash,50000,52000,55000,58000',
  'AR Collections,10000,8000,9000,9000',
  'AP Payments,-5000,-5000,-6000,-4000',
  'Payroll,-3000,0,0,-3000',
  'Closing Cash,52000,55000,58000,60000',
].join('\n'));
const BANK = jf('bank_balance.json', { balance: 61234.56, transactions: [
  { date: '2026-02-03', amount: 2500, description: 'ACME DENTAL INV-1001' },
  { date: '2026-02-05', amount: -3000, description: 'GUSTO PAYROLL' },
  { date: '2026-02-10', amount: -1200, description: 'STAPLES BILL-77' },
  { date: '2026-02-17', amount: 4000, description: 'BETA LLC PAYMENT' },
] });
const INVOICES = jf('open_invoices.json', [
  { customer: 'Acme Dental', number: 'INV-1001', dueDate: '2026-02-01', amount: 2500 },
  { customer: 'Beta LLC', number: 'INV-1002', dueDate: '2026-02-15', amount: 4000 },
  { customer: 'Gamma Co', number: 'INV-1003', dueDate: '2026-02-10', amount: 1500 },
  { customer: 'Delta', number: 'INV-1004', dueDate: '2026-03-05', amount: 2200.75 },
  { customer: 'Epsilon', number: 'INV-1005', dueDate: '2026-06-30', amount: 9000 },
]);
const BILLS = jf('open_bills.json', [{ vendor: 'Staples', number: 'BILL-77', dueDate: '2026-02-12', amount: 1200 }, { vendor: 'AWS', number: 'BILL-78', dueDate: '2026-02-25', amount: 900.5 }]);
const PAYROLL = csv('payroll_calendar.csv', 'Date,Amount\n2026-02-05,3000\n2026-02-19,3000\n2026-03-05,3000');
const RECURRING = csv('recurring.csv', 'Name,Amount,Frequency,Day of Month,Direction\nRent,2500,monthly,1,out');
const ctx = { files: [FORECAST, BANK, INVOICES, BILLS, PAYROLL, RECURRING], args: { asOf: '2026-02-18' } };

test('forecast_roll: week alignment, actuals restated from the bank, settled items excluded, weekly roll to the cent', () => {
  const r = twice(V, ctx);
  assert.equal(r.weekStart, '2026-02-16', 'asOf Wed 18 Feb aligns to the prior forecast Mondays');
  assert.deepEqual(r.replacedActualsFor, ['2026-02-02', '2026-02-09']);
  assert.deepEqual(r.roles, { forecast: 'cash_forecast_13wk.csv', bank: 'bank_balance.json', invoices: 'open_invoices.json', bills: 'open_bills.json', payroll: 'payroll_calendar.csv', recurring: 'recurring.csv' });
  const a1 = r.weeks[0]; const a2 = r.weeks[1];
  assert.deepEqual([a1.start, a1.isActual, a1.opening, a1.inflows.total, a1.outflows.total, a1.closing, a1.priorClosing], ['2026-02-02', true, 58934.56, 2500, -3000, 58434.56, 52000]);
  assert.deepEqual([a2.start, a2.isActual, a2.opening, a2.outflows.total, a2.closing], ['2026-02-09', true, 58434.56, -1200, 57234.56]);
  assert.deepEqual(r.excludedSettled.map((e) => [e.kind, e.ref]), [['ap', 'BILL-77'], ['ar', 'INV-1001'], ['ar', 'INV-1002'], ['payroll', 'payroll-2']]);
  assert.equal(r.weeks.length, 2 + 13);
  const w0 = r.weeks[2]; const w1 = r.weeks[3]; const w2 = r.weeks[4]; const w6 = r.weeks[8];
  assert.deepEqual([w0.start, w0.isActual, w0.opening, w0.inflows.ar, w0.outflows.payroll, w0.closing], ['2026-02-16', false, 61234.56, 1500, -3000, 59734.56]);
  assert.deepEqual([w1.start, w1.outflows.ap, w1.outflows.recurring, w1.closing], ['2026-02-23', -900.5, -2500, 56334.06]);
  assert.deepEqual([w2.start, w2.inflows.ar, w2.outflows.payroll, w2.closing], ['2026-03-02', 2200.75, -3000, 55534.81]);
  assert.deepEqual([w6.start, w6.outflows.recurring], ['2026-03-30', -2500]);
  assert.equal(r.weeks[r.weeks.length - 1].closing, 55534.81 - 2500 - 2500, 'rent on 1 Apr and 1 May only');
  assert.deepEqual(r.beyondHorizon.map((b) => b.ref), ['INV-1005']);
  assert.equal(r.noDoubleCount, true);
  assert.ok(r.flags.some((f) => f.week === 0 && /INV-1003.*past due/.test(f.why)));
  assert.ok(r.flags.some((f) => f.week === '2026-02-02' && /differs from the prior forecast 52000.00/.test(f.why)));
  assert.ok(r.assumptions.some((a) => /opening cash 61234.56 from bank json balance/.test(a)));
  assert.equal(r.prior.orientation, 'columns'); assert.deepEqual(r.prior.weeks, ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']);
});

test('forecast_roll: collection lag shifts AR; openingBalance override; weeks arg', () => {
  const r = twice(V, { ...ctx, args: { asOf: '2026-02-18', collectionLagDays: 7, openingBalance: '60,000.00', weeks: 4 } });
  assert.equal(r.opening, 60000); assert.equal(r.openingSource, 'args.openingBalance');
  assert.equal(r.weeks.length, 2 + 4);
  const ar = r.items.filter((i) => i.kind === 'ar').map((i) => [i.ref, i.week, i.expectedDate]);
  assert.deepEqual(ar, [['INV-1003', 0, '2026-02-19'], ['INV-1004', 3, '2026-03-12']]);
  assert.ok(r.assumptions.some((a) => /7 day\(s\)/.test(a)));
});

test('forecast_roll: edge — weeks down a column (rows orientation), running-balance opening, no bank balance is an error', () => {
  const rowsWise = csv('forecast.csv', 'Week,Opening,Collections,Payments,Closing\n2026-03-02,1,2,3,100\n2026-03-09,1,2,3,200\n2026-03-16,1,2,3,300');
  const bankRows = csv('bank.csv', 'Date,Description,Amount,Balance\n2026-03-01,Opening,0,5000\n2026-03-10,Deposit,250.25,5250.25');
  const r = twice(V, { files: [rowsWise, bankRows], args: { asOf: '2026-03-11' } });
  assert.equal(r.prior.orientation, 'rows'); assert.deepEqual(r.prior.weeks, ['2026-03-02', '2026-03-09', '2026-03-16']);
  assert.equal(r.opening, 5250.25); assert.match(r.openingSource, /running balance after 2026-03-10/);
  assert.deepEqual(r.replacedActualsFor, ['2026-03-02']); assert.equal(r.weeks[0].closing, 5000, 'balance before the 10 Mar deposit');
  assert.equal(r.weeks[1].start, '2026-03-09'); assert.equal(r.weeks[1].closing, 5250.25, 'no open items: cash is flat');
  assert.ok(r.flags.some((f) => f.week === '2026-03-02' && /differs from the prior forecast 100.00/.test(f.why)));
  assert.throws(() => V.run({ files: [rowsWise, csv('bank.csv', 'Date,Description,Amount\n2026-03-10,Deposit,250.25')], args: { asOf: '2026-03-11' } }), /no bank balance/);
  assert.throws(() => V.run({ files: [rowsWise, bankRows], args: {} }), /asOf/);
});
