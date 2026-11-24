'use strict';
// recurrence_detect — vendors that posted in each of the prior N months but
// have nothing in the current month (a missing recurring bill or accrual). Pure.
const F = require('./_fields');

/** Resolve a monthlySpend series to {'YYYY-MM': amount}. Bare month names ('Jan') are anchored so the LAST label is currentMonth. */
function seriesToMap(series, currentMonth) {
  const parsed = (series || []).map((p) => ({ label: F.parseMonthLabel(p.month ?? p.period ?? p.label), amount: F.num(p.amount ?? p.total ?? p.spend) }));
  const out = {};
  const anchored = parsed.some((p) => p.label && p.label.year == null);
  if (anchored) {
    // walk backwards from currentMonth over the labels in order
    let ym = currentMonth; const n = parsed.length;
    for (let i = n - 1; i >= 0; i -= 1) { const p = parsed[i]; if (!p.label) continue; const expect = Number(ym.slice(5, 7)) - 1; if (p.label.month !== expect) { /* gap or mislabel: slide to the label's month */ while (Number(ym.slice(5, 7)) - 1 !== p.label.month) ym = F.addMonths(ym, -1); } if (p.amount != null) out[ym] = F.round2((out[ym] || 0) + p.amount); ym = F.addMonths(ym, -1); }
    return out;
  }
  for (const p of parsed) { if (!p.label || p.amount == null) continue; const ym = `${p.label.year}-${F.pad2(p.label.month + 1)}`; out[ym] = F.round2((out[ym] || 0) + p.amount); }
  return out;
}

module.exports = {
  name: 'recurrence_detect',
  describe: 'Finds vendors with spend in every one of the prior N months and none in the current month. Input is vendor spend by month (Dime vendor-spend-analysis, a {vendors:[{vendor, monthlySpend}]} file, or flat vendor/month/amount rows).',
  inputs: [{ name: 'vendorSpend', shape: "Dime vendor-spend-analysis payload {vendors|vendorRows|data:[{vendorName, account?, monthlySpend:[{month:'Jan'|'2026-01', amount}]}]} (per vendor+account rows are summed per vendor; bare month names are anchored so the last label = args.currentMonth), or {vendors:[{vendor, monthlySpend:[{month:'YYYY-MM', amount}]}]}, or flat rows/CSV with vendor|vendorName|merchant_name, month|period|date and amount (dates are bucketed by month; the latest date per vendor becomes lastPostingDate)." }],
  args: { months: 3, currentMonth: "(required) 'YYYY-MM'", exclude: [], minAverage: 0 },
  output: "{ missing:[{vendor, priorMonths:[{month,amount}], average, lastPostingDate?}], checked, monthsSeen:[...], window:{from,to}, excluded }",
  run({ files, args = {} }) {
    const currentMonth = String(F.requireArg(args, 'currentMonth', "'YYYY-MM'"));
    if (!F.isYM(currentMonth)) throw new Error(`args.currentMonth must be 'YYYY-MM', got ${JSON.stringify(currentMonth)}`);
    const months = Number(args.months ?? 3); if (!(months >= 1) || !Number.isInteger(months)) throw new Error('args.months must be a positive integer');
    const minAverage = Number(args.minAverage ?? 0);
    const excl = new Set((args.exclude || []).map(F.normVendor));
    const vendors = new Map(); // key → { vendor, byMonth, lastPostingDate }
    const ensure = (name) => { const k = F.normVendor(name); if (!vendors.has(k)) vendors.set(k, { vendor: F.str(name), byMonth: {}, lastPostingDate: null }); return vendors.get(k); };
    const monthsSeen = new Set();
    for (const r of F.rowsFrom(files[0])) {
      const name = F.pick(r, 'vendor'); if (!F.str(name)) continue;
      const series = r.monthlySpend || r.months || r.series;
      if (Array.isArray(series)) {
        const v = ensure(name); const map = seriesToMap(series, currentMonth);
        for (const ym of Object.keys(map)) { v.byMonth[ym] = F.round2((v.byMonth[ym] || 0) + map[ym]); monthsSeen.add(ym); }
      } else {
        const amount = F.num(F.pick(r, 'amount')); if (amount == null) continue;
        const rawMonth = F.pick(r, 'month'); const date = F.ymd(F.pick(r, 'date'));
        const lab = rawMonth != null ? F.parseMonthLabel(rawMonth) : null;
        const ym = lab && lab.year != null ? `${lab.year}-${F.pad2(lab.month + 1)}` : date ? F.monthKey(date) : null;
        if (!ym) continue;
        const v = ensure(name); v.byMonth[ym] = F.round2((v.byMonth[ym] || 0) + amount); monthsSeen.add(ym);
        if (date && amount !== 0 && (!v.lastPostingDate || date > v.lastPostingDate)) v.lastPostingDate = date;
      }
    }
    const prior = []; for (let i = months; i >= 1; i -= 1) prior.push(F.addMonths(currentMonth, -i));
    const missing = []; let checked = 0; let excluded = 0;
    for (const k of [...vendors.keys()].sort()) {
      if (excl.has(k)) { excluded += 1; continue; }
      const v = vendors.get(k); checked += 1;
      const priorMonths = prior.map((m) => ({ month: m, amount: v.byMonth[m] ?? null }));
      if (!priorMonths.every((p) => p.amount != null && p.amount !== 0)) continue;
      const cur = v.byMonth[currentMonth]; if (cur != null && cur !== 0) continue;
      const average = F.round2(priorMonths.reduce((s, p) => s + p.amount, 0) / months);
      if (Math.abs(average) < minAverage) continue;
      const row = { vendor: v.vendor, priorMonths, average, currentMonthAmount: cur ?? null };
      if (v.lastPostingDate) row.lastPostingDate = v.lastPostingDate;
      missing.push(row);
    }
    missing.sort(F.by((m) => -Math.abs(m.average), (m) => F.normVendor(m.vendor)));
    return { currentMonth, months, missing, checked, excluded, monthsSeen: [...monthsSeen].sort(), window: { from: prior[0], to: currentMonth }, currentMonthInData: monthsSeen.has(currentMonth) };
  },
};
