'use strict';
// duplicate_pairs — candidate duplicate payments across one or more lists
// (bills, bank transactions, journal lines). Same normalised vendor, amounts
// within tolerance, dates within `days`, different ids. Pure.
const F = require('./_fields');

const ITEM_SHAPE = 'array or {rows|data|bills|transactions:[...]} of rows with id (id|_id|transaction_id|billId|journal_id), date (date|txn_date|transactionDate|issue_date|bill_date|posted_at), amount (amount|total|totalAmount|total_amount|amount_total; sign ignored) and vendor (vendor|vendorName|vendor_name|merchant|merchant_name|payee|name). CSV/XLSX with those headers also works.';

function items(file) {
  const out = []; let unparsed = 0;
  for (const r of F.rowsFrom(file)) {
    const amount = F.num(F.pick(r, 'amount')); const date = F.ymd(F.pick(r, 'date')); const vendor = F.str(F.pick(r, 'vendor'));
    if (amount == null || !date || !vendor) { unparsed += 1; continue; }
    out.push({ source: file.name, id: F.str(F.pick(r, 'id')) || `${file.name}#${out.length + unparsed + 1}`, date, amount: F.abs2(amount), vendor });
  }
  return { out, unparsed };
}

module.exports = {
  name: 'duplicate_pairs',
  describe: 'Candidate duplicate payments: same normalised vendor (case, punctuation, LLC/Inc/Ltd/Corp dropped), |amount diff| within tolerance (absolute or %), dates within N days, different ids. Bucketed by vendor and sorted by amount, so it is linear per vendor bucket.',
  inputs: [
    { name: 'list', shape: ITEM_SHAPE },
    { name: 'more lists', shape: `optional further files of the same kind (e.g. bills + bank transactions); pairs are reported across files too. ${ITEM_SHAPE}`, optional: true },
  ],
  args: { days: 30, tolerance: 0, tolerancePct: 0, excludeVendors: [], minAmount: 0 },
  output: '{ pairs:[{a:{source,id,date,amount,vendor}, b:{…}, daysApart, amountDiff, why}], excluded, unparsed, scanned }',
  run({ files, args = {} }) {
    const days = Number(args.days ?? 30); const tol = Math.abs(Number(args.tolerance ?? 0)); const pct = Math.abs(Number(args.tolerancePct ?? 0)) / 100; const minAmount = Number(args.minAmount ?? 0);
    const excl = new Set((args.excludeVendors || []).map(F.normVendor).filter(Boolean));
    if (!(days >= 0) || !(tol >= 0) || !(pct >= 0) || !(minAmount >= 0)) throw new Error('days, tolerance, tolerancePct and minAmount must be non-negative numbers');
    let scanned = 0; let excluded = 0; let unparsed = 0; const buckets = new Map();
    for (const f of files) {
      const { out, unparsed: u } = items(f); unparsed += u;
      for (const it of out) {
        scanned += 1; const key = F.normVendor(it.vendor);
        if (!key || excl.has(key) || it.amount < minAmount) { excluded += 1; continue; }
        if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(it);
      }
    }
    const pairs = [];
    const sortItems = F.by((x) => x.amount, (x) => x.date, (x) => x.source, (x) => x.id);
    for (const key of [...buckets.keys()].sort()) {
      const list = buckets.get(key).sort(sortItems);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]; const b = list[j]; const diff = F.round2(b.amount - a.amount);
          const allowed = Math.max(tol, F.round2(pct * Math.max(a.amount, b.amount)));
          if (diff > allowed) break; // amounts ascend: nothing later can be closer
          if (a.source === b.source && a.id === b.id) continue;
          const apart = Math.abs(F.daysBetween(a.date, b.date)); if (apart > days) continue;
          const [p, q] = F.by((x) => x.date, (x) => x.source, (x) => x.id)(a, b) <= 0 ? [a, b] : [b, a];
          const why = [`same vendor "${key}"`, diff === 0 ? `same amount ${a.amount.toFixed(2)}` : `amounts ${p.amount.toFixed(2)} vs ${q.amount.toFixed(2)} (diff ${diff.toFixed(2)} within ${allowed.toFixed(2)})`, apart === 0 ? 'same day' : `${apart} day${apart === 1 ? '' : 's'} apart`, p.source === q.source ? `both in ${p.source}` : `${p.source} vs ${q.source}`].join('; ');
          pairs.push({ a: p, b: q, daysApart: apart, amountDiff: diff, why });
        }
      }
    }
    pairs.sort(F.by((x) => F.normVendor(x.a.vendor), (x) => x.a.amount, (x) => x.a.date, (x) => x.a.source, (x) => x.a.id, (x) => x.b.date, (x) => x.b.source, (x) => x.b.id));
    return { pairs, excluded, unparsed, scanned, args: { days, tolerance: tol, tolerancePct: pct * 100, minAmount, excludeVendors: [...excl].sort() } };
  },
};
