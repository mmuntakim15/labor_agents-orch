'use strict';
// open_item_age — open-item aging inside ONE GL account (a clearing, suspense,
// AP/AR control or accrual account): match debits against credits by equal
// amount and a shared reference token first, then FIFO by equal amount; what
// is left is open and aged at args.asOf. Pure.
const F = require('./_fields');

const TOKEN_RE = /[a-z0-9][a-z0-9-]{2,}/g;
/** Reference tokens: the whole normalised reference plus any alphanumeric token that carries a digit (invoice/check/JE numbers). */
function tokensOf(row) {
  const ref = F.str(F.pick(row, 'reference')); const desc = F.str(F.pick(row, 'description'));
  const set = new Set();
  if (ref) set.add(`ref:${F.normKey(ref)}`);
  for (const s of [ref, desc]) for (const t of String(s).toLowerCase().match(TOKEN_RE) || []) if (/\d/.test(t)) set.add(t);
  return set;
}

module.exports = {
  name: 'open_item_age',
  describe: 'Open-item aging for one GL account register: pairs debits with credits (equal amount + shared reference token, then FIFO by equal amount) and ages whatever is left at asOf, with 0-30/31-60/61-90/90+ buckets.',
  inputs: [{ name: 'register', shape: "GL register for ONE account: Dime general-ledger-account-realtime {rows:[{_id, date, reference, description, debit, credit, balance}]} (Beginning/Ending Balance rows without a date are ignored) or any rows/CSV with id, date, description|memo, reference|ref|invoice_number and either debit/credit columns or a signed amount (+ debit, − credit) or amount+glType." }],
  args: { asOf: '(required) YYYY-MM-DD', method: 'reference_then_fifo' },
  output: '{ open:[{id,date,amount,side,ageDays,likelySource,matchedAgainst:null}], matched:[{debitId,creditId,amount,how}], netBalance, openTotal, openDebits, openCredits, buckets:{0-30,31-60,61-90,90+ → {count, amount}}, scanned, afterAsOf, unparsed }',
  run({ files, args = {} }) {
    const asOf = F.requireYMD(args, 'asOf');
    const method = String(args.method || 'reference_then_fifo');
    if (!['reference_then_fifo', 'fifo'].includes(method)) throw new Error(`unknown method ${method} (reference_then_fifo | fifo)`);
    const debits = []; const credits = []; let unparsed = 0; let afterAsOf = 0; let scanned = 0; let seq = 0;
    for (const r of F.rowsFrom(files[0])) {
      const date = F.ymd(F.pick(r, 'date')); const s = F.sides(r);
      if (!date) { const d = F.str(F.pick(r, 'description')).toLowerCase(); if (/beginning balance|ending balance|opening balance|closing balance|^total/.test(d)) continue; unparsed += 1; continue; }
      if (!s || (s.debit === 0 && s.credit === 0)) { unparsed += 1; continue; }
      scanned += 1; if (date > asOf) { afterAsOf += 1; continue; }
      seq += 1;
      const base = { id: F.str(F.pick(r, 'id')) || `row-${seq}`, date, likelySource: [F.str(F.pick(r, 'reference')), F.str(F.pick(r, 'description'))].filter(Boolean).join(' — ') || null, tokens: tokensOf(r), seq };
      if (s.debit) debits.push({ ...base, amount: F.abs2(s.debit), side: 'debit' });
      if (s.credit) credits.push({ ...base, amount: F.abs2(s.credit), side: 'credit' });
    }
    const order = F.by((x) => x.date, (x) => x.seq, (x) => x.id);
    debits.sort(order); credits.sort(order);
    const matched = []; const usedC = new Set();
    const creditsByAmount = new Map();
    for (const c of credits) { const k = c.amount.toFixed(2); if (!creditsByAmount.has(k)) creditsByAmount.set(k, []); creditsByAmount.get(k).push(c); }
    const take = (d, pred, how) => {
      const cands = creditsByAmount.get(d.amount.toFixed(2)) || [];
      const c = cands.find((x) => !usedC.has(x) && pred(x)); if (!c) return false;
      usedC.add(c); d.matched = true; matched.push({ debitId: d.id, creditId: c.id, amount: d.amount, how, debitDate: d.date, creditDate: c.date }); return true;
    };
    if (method === 'reference_then_fifo') for (const d of debits) take(d, (c) => { for (const t of d.tokens) if (c.tokens.has(t)) return true; return false; }, 'reference');
    for (const d of debits) if (!d.matched) take(d, () => true, 'fifo');
    const open = [...debits.filter((d) => !d.matched), ...credits.filter((c) => !usedC.has(c))]
      .map((x) => ({ id: x.id, date: x.date, amount: x.amount, side: x.side, ageDays: F.daysBetween(x.date, asOf), likelySource: x.likelySource, matchedAgainst: null }))
      .sort(F.by((x) => x.date, (x) => x.id, (x) => x.side));
    const buckets = { '0-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } };
    for (const o of open) { const b = o.ageDays <= 30 ? '0-30' : o.ageDays <= 60 ? '31-60' : o.ageDays <= 90 ? '61-90' : '90+'; buckets[b].count += 1; buckets[b].amount = F.round2(buckets[b].amount + (o.side === 'debit' ? o.amount : -o.amount)); }
    const sum = (xs) => F.round2(xs.reduce((s, x) => s + x.amount, 0));
    const openDebits = sum(open.filter((o) => o.side === 'debit')); const openCredits = sum(open.filter((o) => o.side === 'credit'));
    matched.sort(F.by((m) => m.debitDate, (m) => m.debitId, (m) => m.creditId));
    return { asOf, method, open, matched: matched.map(({ debitDate, creditDate, ...m }) => m), netBalance: F.round2(sum(debits) - sum(credits)), openTotal: F.round2(openDebits - openCredits), openDebits, openCredits, buckets, scanned, afterAsOf, unparsed };
  },
};
