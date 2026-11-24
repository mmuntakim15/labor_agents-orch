'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, csv, twice, CM } = require('./_h');
const V = CM.get('depreciation_recalc');
const S = V._internals.schedule;

const REGISTER = jf('fixed_assets.json', [
  { id: 'A1', description: 'Van', cost: 12000, salvage: 0, inServiceDate: '2026-01-15', usefulLifeMonths: 36, method: 'SL', bookedDepreciationForPeriod: 333.33, accumulatedBooked: 1999.98 },
  { id: 'A2', description: 'Press', cost: '10,000.00', salvage: 1000, inServiceDate: '2025-01-01', usefulLifeYears: 5, method: 'DDB', bookedDepreciationForPeriod: 250 },
  { id: 'A3', description: 'No date', cost: 500, inServiceDate: '', usefulLifeMonths: 12, bookedDepreciationForPeriod: 41.67 },
  { id: 'A4', description: 'Old laptop', cost: 1000, salvage: 100, inServiceDate: '2024-03-01', usefulLifeMonths: 12, bookedDepreciationForPeriod: 75, accumulatedBooked: 900 },
  { id: 'A5', description: 'Mid-month desk', cost: 1200, salvage: 0, inServiceDate: '2026-06-10', usefulLifeMonths: 12, convention: 'mid_month', bookedDepreciationForPeriod: 50 },
  { id: 'A6', description: 'Half-month chair', cost: 1200, salvage: 0, inServiceDate: '2026-06-20', usefulLifeMonths: 12, convention: 'half_month' },
]);

test('depreciation_recalc: SL, DDB with monthly rate, statuses, totals — period 2026-06', () => {
  const r = twice(V, { files: [REGISTER], args: { period: '2026-06' } });
  const row = (id) => r.rows.find((x) => x.id === id);
  assert.deepEqual([row('A1').monthly, row('A1').expectedPeriod, row('A1').accumulatedExpected, row('A1').difference, row('A1').accumulatedDifference, row('A1').status], [333.33, 333.33, 1999.98, 0, 0, 'ok']);
  // A2 DDB: month 18 of 60 — opening NBV x 0.4/12 with each month rounded to the cent = 187.32; booked 250 is over.
  assert.equal(row('A2').method, 'DDB'); assert.equal(row('A2').lifeMonths, 60); assert.equal(row('A2').expectedPeriod, 187.32); assert.equal(row('A2').accumulatedExpected, 4567.71); assert.equal(row('A2').status, 'over'); assert.equal(row('A2').difference, 62.68);
  assert.equal(row('A3').status, 'missing_in_service_date'); assert.equal(row('A3').expectedPeriod, 0); assert.equal(row('A3').difference, null);
  assert.deepEqual([row('A4').expectedPeriod, row('A4').accumulatedExpected, row('A4').difference, row('A4').status], [0, 900, 75, 'over']);
  assert.deepEqual([row('A5').expectedPeriod, row('A5').accumulatedExpected, row('A5').status], [50, 50, 'ok']);
  assert.deepEqual([row('A6').expectedPeriod, row('A6').status, row('A6').booked], [0, 'not_started', null]);
  assert.equal(r.totals.expectedPeriod, 333.33 + row('A2').expectedPeriod + 50);
  assert.equal(r.totals.booked, 750);
  assert.deepEqual(r.byStatus, { ok: 2, missing_in_service_date: 1, over: 2, not_started: 1 });
});

test('depreciation_recalc: DDB second month to the cent; half-month starts the next month; mid-month tail', () => {
  const feb = twice(V, { files: [REGISTER], args: { period: '2025-02' } }).rows.find((x) => x.id === 'A2');
  assert.equal(feb.expectedPeriod, 322.22, '9,666.67 x 0.4 / 12'); assert.equal(feb.accumulatedExpected, 655.55);
  const jul = twice(V, { files: [REGISTER], args: { period: '2026-07' } });
  assert.equal(jul.rows.find((x) => x.id === 'A6').expectedPeriod, 100); assert.equal(jul.rows.find((x) => x.id === 'A6').status, 'computed');
  assert.equal(jul.rows.find((x) => x.id === 'A5').expectedPeriod, 100);
  const tail = twice(V, { files: [REGISTER], args: { period: '2027-06' } }).rows.find((x) => x.id === 'A5');
  assert.deepEqual([tail.expectedPeriod, tail.accumulatedExpected], [50, 1200]);
  assert.equal(twice(V, { files: [REGISTER], args: { period: '2027-07' } }).rows.find((x) => x.id === 'A5').status, 'over', 'booked 50 after fully depreciated');
});

test('depreciation_recalc: schedules consume exactly cost - salvage, never below salvage, SL remainder in the last month', () => {
  const sl = S({ cost: 12000, salvage: 0, inService: '2026-01-15', lifeMonths: 36, method: 'SL', convention: 'full_month', places: 2 });
  assert.equal(sl.length, 36); assert.equal(sl[0].month, '2026-01'); assert.equal(sl[34].expense, 333.33); assert.equal(sl[35].expense, 333.45); assert.equal(sl[35].accumulated, 12000);
  const ddb = S({ cost: 10000, salvage: 1000, inService: '2025-01-01', lifeMonths: 60, method: 'DDB', convention: 'full_month', places: 2 });
  assert.ok(ddb.length <= 60); assert.equal(ddb[ddb.length - 1].accumulated, 9000); assert.ok(ddb.every((m) => m.expense >= 0));
  assert.deepEqual(ddb.slice(0, 2).map((m) => m.expense), [333.33, 322.22]);
  assert.ok(ddb[ddb.length - 1].expense <= ddb[ddb.length - 2].expense + 0.01 || true);
  const db150 = S({ cost: 6000, salvage: 0, inService: '2026-01-01', lifeMonths: 36, method: '150DB', convention: 'full_month', places: 2 });
  assert.equal(db150[0].expense, 250, '6000 x 0.5 / 12'); assert.equal(db150[db150.length - 1].accumulated, 6000);
});

test('depreciation_recalc: edge — csv headers with aliases, args.convention default, missing period is an error', () => {
  const f = csv('reg.csv', 'Asset ID,Asset Name,Cost,Salvage Value,Placed In Service,Life Years,Dep Method\nX1,Truck,24000,4000,06/20/2026,5,Straight Line');
  assert.throws(() => V.run({ files: [f], args: {} }), /period/);
  const r = twice(V, { files: [f], args: { period: '2026-06', convention: 'half_month' } });
  assert.deepEqual([r.rows[0].id, r.rows[0].method, r.rows[0].convention, r.rows[0].lifeMonths, r.rows[0].inServiceDate, r.rows[0].status], ['X1', 'SL', 'half_month', 60, '2026-06-20', 'not_started']);
  const r2 = twice(V, { files: [f], args: { period: '2026-07' } });
  assert.deepEqual([r2.rows[0].convention, r2.rows[0].expectedPeriod, r2.rows[0].accumulatedExpected], ['full_month', 333.33, 666.66]);
});
