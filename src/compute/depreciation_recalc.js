'use strict';
// depreciation_recalc — recompute book depreciation for a period from the register and compare with what was booked.
const M = require('./_money');
const D = require('./_dates');
const Tb = require('./_table');

const F = {
  id: ['id', 'assetid', 'asset', 'assetnumber', 'tag', 'number', 'code'],
  description: ['description', 'name', 'assetname', 'assetdescription'],
  cost: ['cost', 'acquisitioncost', 'basis', 'originalcost', 'purchaseprice', 'amount'],
  salvage: ['salvage', 'salvagevalue', 'residual', 'residualvalue'],
  inService: ['inservicedate', 'inservice', 'placedinservice', 'dateinservice', 'acquisitiondate', 'acquired', 'startdate', 'purchasedate'],
  lifeMonths: ['usefullifemonths', 'lifemonths', 'months'],
  lifeYears: ['usefullifeyears', 'lifeyears', 'years', 'usefullife', 'life'],
  method: ['method', 'depreciationmethod', 'depmethod'],
  convention: ['convention', 'averagingconvention'],
  booked: ['bookeddepreciationforperiod', 'bookeddepreciation', 'booked', 'periodbooked', 'depreciationbooked', 'bookedperiod', 'currentperiod', 'depreciationexpense'],
  accumulatedBooked: ['accumulatedbooked', 'accumulateddepreciation', 'accumulated', 'accumdep', 'accumulateddepreciationbooked'],
};
const METHODS = { sl: 'SL', straightline: 'SL', ddb: 'DDB', doubledeclining: 'DDB', doubledecliningbalance: 'DDB', '200db': 'DDB', db200: 'DDB', '150db': '150DB', db150: '150DB', decliningbalance150: '150DB' };
const CONVENTIONS = { fullmonth: 'full_month', full: 'full_month', halfmonth: 'half_month', half: 'half_month', midmonth: 'mid_month', mid: 'mid_month' };

/**
 * Month-by-month schedule. Returns [{ month: 'YYYY-MM', expense, accumulated }] until the depreciable base is consumed.
 * DB methods apply annualRate/12 to the opening net book value each month and switch to straight-line over the remaining
 * months when that is higher; nothing ever takes the book value below salvage.
 */
function schedule({ cost, salvage, inService, lifeMonths, method, convention, places }) {
  const base = M.roundTo(cost - salvage, places);
  const out = []; if (base <= 0 || lifeMonths <= 0) return out;
  const startIdx = D.monthIndex(inService) + (convention === 'half_month' && D.dayOfMonth(inService) > 15 ? 1 : 0);
  const rate = method === 'DDB' ? 2 / (lifeMonths / 12) : method === '150DB' ? 1.5 / (lifeMonths / 12) : null;
  const slMonthly = M.roundTo(base / lifeMonths, places);
  let accumulated = 0; let consumed = 0; let i = 0;
  while (accumulated < base && i < lifeMonths * 2 + 24) {
    const frac = convention === 'mid_month' && i === 0 ? 0.5 : 1;
    const remaining = M.roundTo(base - accumulated, places);
    const remainingMonths = Math.max(lifeMonths - consumed, frac);
    let expense;
    if (!rate) expense = slMonthly * frac;
    else { const nbv = cost - accumulated; const db = nbv * (rate / 12) * frac; const sl = ((nbv - salvage) / remainingMonths) * frac; expense = Math.max(db, sl); }
    expense = M.roundTo(Math.min(expense, remaining), places);
    if (consumed + frac >= lifeMonths - 1e-9 && !rate) expense = remaining; // last straight-line month takes the rounding remainder
    accumulated = M.roundTo(accumulated + expense, places); consumed += frac;
    out.push({ month: D.monthFromIndex(startIdx + i), expense, accumulated });
    i += 1;
  }
  return out;
}

module.exports = {
  name: 'depreciation_recalc',
  describe: 'Recomputes book depreciation for one period from the asset register (cost, salvage, in-service date, useful life, method SL/DDB/150DB, convention full_month/half_month/mid_month) and compares with the booked figure per asset. Declining-balance is applied monthly to opening net book value and switches to straight-line when that is higher; book value never drops below salvage; the last straight-line month absorbs rounding. Assets without an in-service date are flagged, not computed. Pure.',
  inputs: [{ name: 'register', shape: 'rows or json array: id, description, cost, salvage?, inServiceDate, usefulLifeMonths|usefulLifeYears, method?, convention?, bookedDepreciationForPeriod?, accumulatedBooked?' }],
  args: { period: "'YYYY-MM' (required)", convention: "default when the row has none: 'full_month' (default) | 'half_month' (in service on/after the 16th starts next month) | 'mid_month' (half a month first)", method: "default method when the row has none: 'SL'", roundTo: 2 },
  output: "{ period, rows: [{ id, description, method, convention, cost, salvage, lifeMonths, inServiceDate, monthly, expectedPeriod, booked, difference, accumulatedExpected, accumulatedBooked, accumulatedDifference, status: 'ok'|'under'|'over'|'computed'|'not_started'|'fully_depreciated'|'missing_in_service_date' }], totals, byStatus }",
  run({ files, args = {} }) {
    const period = String(args.period || '').trim();
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("depreciation_recalc: args.period 'YYYY-MM' is required");
    const places = Number.isInteger(args.roundTo) ? args.roundTo : 2;
    const defConv = CONVENTIONS[Tb.norm(args.convention)] || 'full_month';
    const defMethod = METHODS[Tb.norm(args.method)] || 'SL';
    const pIdx = D.monthIndex(period);
    const rows = Tb.records(files[0]).map((r, i) => {
      const id = Tb.str(Tb.field(r, F.id)) || `row ${i + 2}`;
      const description = Tb.str(Tb.field(r, F.description));
      const cost = M.roundTo(M.parseMoney(Tb.field(r, F.cost)) || 0, places);
      const salvage = M.roundTo(M.parseMoney(Tb.field(r, F.salvage)) || 0, places);
      const inService = D.parseDate(Tb.field(r, F.inService));
      const lm = M.parseMoney(Tb.field(r, F.lifeMonths)); const ly = M.parseMoney(Tb.field(r, F.lifeYears));
      const lifeMonths = lm ? Math.round(lm) : ly ? Math.round(ly * 12) : 0;
      const method = METHODS[Tb.norm(Tb.field(r, F.method))] || defMethod;
      const convention = CONVENTIONS[Tb.norm(Tb.field(r, F.convention))] || defConv;
      const booked = M.parseMoney(Tb.field(r, F.booked)); const accumulatedBooked = M.parseMoney(Tb.field(r, F.accumulatedBooked));
      const row = { id, description, method, convention, cost, salvage, lifeMonths, inServiceDate: inService, monthly: null, expectedPeriod: 0, booked: booked == null ? null : M.roundTo(booked, places), difference: null, accumulatedExpected: 0, accumulatedBooked: accumulatedBooked == null ? null : M.roundTo(accumulatedBooked, places), accumulatedDifference: null, status: 'computed' };
      if (!inService) { row.status = 'missing_in_service_date'; return row; }
      if (!lifeMonths) { row.status = 'missing_useful_life'; return row; }
      const sch = schedule({ cost, salvage, inService, lifeMonths, method, convention, places });
      row.monthly = method === 'SL' ? M.roundTo((cost - salvage) / lifeMonths, places) : (sch[0] ? sch[0].expense : 0);
      const hit = sch.find((s) => s.month === period);
      const before = sch.filter((s) => D.monthIndex(s.month) <= pIdx);
      row.expectedPeriod = hit ? hit.expense : 0;
      row.accumulatedExpected = before.length ? before[before.length - 1].accumulated : 0;
      if (row.accumulatedBooked != null) row.accumulatedDifference = M.roundTo(row.accumulatedBooked - row.accumulatedExpected, places);
      const firstIdx = sch.length ? D.monthIndex(sch[0].month) : D.monthIndex(inService);
      if (pIdx < firstIdx) row.status = 'not_started';
      else if (!hit && sch.length && pIdx > D.monthIndex(sch[sch.length - 1].month)) row.status = 'fully_depreciated';
      else if (!sch.length) row.status = 'fully_depreciated';
      if (row.booked != null) {
        row.difference = M.roundTo(row.booked - row.expectedPeriod, places);
        if (row.status === 'computed' || row.status === 'fully_depreciated' || row.status === 'not_started') row.status = Math.abs(row.difference) < 0.5 / 10 ** places ? (row.status === 'computed' ? 'ok' : row.status) : row.difference < 0 ? 'under' : 'over';
      }
      return row;
    });
    const totals = { cost: M.sum(rows, (r) => r.cost), expectedPeriod: M.sum(rows, (r) => r.expectedPeriod), booked: M.sum(rows, (r) => r.booked), difference: M.sum(rows, (r) => r.difference), accumulatedExpected: M.sum(rows, (r) => r.accumulatedExpected), accumulatedBooked: M.sum(rows, (r) => r.accumulatedBooked), accumulatedDifference: M.sum(rows, (r) => r.accumulatedDifference) };
    const byStatus = {}; for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    return { period, rows, totals, byStatus, assetCount: rows.length };
  },
  _internals: { schedule },
};
