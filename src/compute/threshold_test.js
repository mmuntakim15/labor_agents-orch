'use strict';
// threshold_test — what a capitalisation / review threshold would catch: counts and totals below and above each candidate.
const M = require('./_money');
const D = require('./_dates');
const Tb = require('./_table');

const F = {
  account: ['account', 'accountname', 'glaccount', 'accounting_category', 'category'],
  type: ['type', 'class', 'accounttype', 'accounting_accounts', 'accountclass'],
  amount: ['amount', 'total', 'value', 'debit', 'net'],
  date: ['date', 'txndate', 'transactiondate', 'posted', 'postingdate'],
  description: ['description', 'memo', 'name', 'vendor', 'payee', 'merchant', 'details'],
};

module.exports = {
  name: 'threshold_test',
  describe: 'For each candidate threshold, counts and totals the GL items (by absolute amount) below and above it, as a share of the population, after filtering to the given classes and period. With args.threshold it also lists the largest items below and the smallest above that line. Pure.',
  inputs: [{ name: 'items', shape: 'rows or json array: account, type|class, amount, date, description' }],
  args: { candidates: [500, 1000, 2500, 5000], classes: ['Expense', 'Fixed Asset'], period: "'YYYY-MM' | 'YYYY' | { start, end } (optional)", threshold: 'chosen threshold for the largestBelow / smallestAbove lists (optional)', listSize: 10 },
  output: '{ population: { count, total }, candidates: [{ threshold, belowCount, belowTotal, aboveCount, aboveTotal, pctOfTotal }], chosen?: { threshold, largestBelow: [...], smallestAbove: [...] }, filtered: { byClass, byPeriod, noAmount } }',
  run({ files, args = {} }) {
    const recs = Tb.records(files[0]);
    const candidates = (args.candidates || [500, 1000, 2500, 5000]).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    const classes = (args.classes === undefined ? ['Expense', 'Fixed Asset'] : args.classes || []).map(Tb.norm).filter(Boolean);
    const range = D.periodRange(args.period);
    const filtered = { byClass: 0, byPeriod: 0, noAmount: 0 };
    const items = [];
    for (const r of recs) {
      const amount = M.parseMoney(Tb.field(r, F.amount));
      if (amount == null) { filtered.noAmount += 1; continue; }
      const type = Tb.str(Tb.field(r, F.type));
      if (classes.length) { const t = Tb.norm(type); if (!classes.some((c) => t === c || t.includes(c) || c.includes(t) && t.length > 2)) { filtered.byClass += 1; continue; } }
      const date = D.parseDate(Tb.field(r, F.date));
      if (range && (!date || !D.inRange(date, range))) { filtered.byPeriod += 1; continue; }
      items.push({ account: Tb.str(Tb.field(r, F.account)), type, amount: M.round2(amount), abs: Math.abs(M.round2(amount)), date, description: Tb.str(Tb.field(r, F.description)) });
    }
    const total = M.sum(items, (i) => i.abs);
    const rows = candidates.map((threshold) => {
      const below = items.filter((i) => i.abs < threshold); const above = items.filter((i) => i.abs >= threshold);
      const belowTotal = M.sum(below, (i) => i.abs);
      return { threshold, belowCount: below.length, belowTotal, aboveCount: above.length, aboveTotal: M.sum(above, (i) => i.abs), pctOfTotal: total ? M.roundTo((belowTotal / total) * 100, 2) : 0 };
    });
    const out = { population: { count: items.length, total }, candidates: rows, filtered, classes: args.classes === undefined ? ['Expense', 'Fixed Asset'] : args.classes, period: range };
    if (args.threshold != null) {
      const t = Number(args.threshold); const n = Number(args.listSize || 10);
      const strip = (i) => ({ account: i.account, type: i.type, amount: i.amount, date: i.date, description: i.description });
      const largestBelow = items.filter((i) => i.abs < t).sort(Tb.by((i) => -i.abs, (i) => i.date, (i) => i.account, (i) => i.description)).slice(0, n).map(strip);
      const smallestAbove = items.filter((i) => i.abs >= t).sort(Tb.by((i) => i.abs, (i) => i.date, (i) => i.account, (i) => i.description)).slice(0, n).map(strip);
      out.chosen = { threshold: t, largestBelow, smallestAbove };
    }
    return out;
  },
};
