'use strict';
// schedule_vs_actual — expand contract billing schedules into expected invoices and match them to what was actually invoiced.
const M = require('./_money');
const D = require('./_dates');
const Tb = require('./_table');

const F = {
  contract: ['contract', 'contractid', 'contractnumber', 'agreement', 'subscription', 'subscriptionid', 'id'],
  customer: ['customer', 'customername', 'client', 'account', 'company'],
  start: ['startdate', 'start', 'effectivedate', 'billingstart', 'from'],
  end: ['enddate', 'end', 'expiry', 'expirationdate', 'to', 'through'],
  term: ['termmonths', 'term', 'months', 'duration'],
  period: ['period', 'frequency', 'billingfrequency', 'billingperiod', 'cadence', 'interval'],
  amount: ['amount', 'price', 'fee', 'billingamount', 'recurringamount', 'total'],
  escalator: ['escalatorpct', 'escalator', 'escalation', 'escalationpct', 'uplift', 'annualincrease'],
  invDate: ['date', 'invoicedate', 'issuedate', 'txndate', 'issued'],
  invNumber: ['number', 'invoicenumber', 'invoice', 'invoiceno', 'docnumber', 'reference', 'id'],
  invAmount: ['amount', 'total', 'totalamount', 'invoiceamount', 'subtotal'],
  payInvoice: ['invoice', 'invoicenumber', 'number', 'invoiceno', 'reference', 'appliedto'],
  payDate: ['date', 'paymentdate', 'paiddate', 'received'],
  payAmount: ['amount', 'paid', 'paymentamount', 'total'],
};
const STEP = { monthly: 1, month: 1, quarterly: 3, quarter: 3, annual: 12, annually: 12, yearly: 12, year: 12, semiannual: 6, semiannually: 6, onetime: 0, once: 0, single: 0, oneoff: 0 };

function expand(s, asOf) {
  const out = [];
  if (s.step === 0) { if (s.start <= asOf) out.push({ seq: 1, periodStart: s.start, periodEnd: s.end || s.start, amount: s.amount }); return out; }
  for (let k = 0; k < 1200; k += 1) {
    const ps = D.addMonths(s.start, k * s.step); if (ps > asOf || (s.end && ps > s.end)) break;
    const pe = D.addDays(D.addMonths(s.start, (k + 1) * s.step), -1);
    const years = Math.floor((k * s.step) / 12);
    const amount = M.round2(s.amount * (1 + s.escalatorPct / 100) ** years);
    out.push({ seq: k + 1, periodStart: ps, periodEnd: s.end && pe > s.end ? s.end : pe, amount });
  }
  return out;
}

module.exports = {
  name: 'schedule_vs_actual',
  describe: 'Expands each contract billing schedule (monthly/quarterly/annual/one_time, with an optional annual escalator) into the invoices expected up to asOf, then matches them to actual invoices by contract (or customer when the invoice carries no contract) and date: on time within dateTolerance days, otherwise the nearest unused invoice in the billing period is "mistimed"; amounts outside amountTolerance are listed. Invoices that match nothing are unexpected; payments, when given, mark matched invoices paid. Pure.',
  inputs: [
    { name: 'schedules', shape: 'rows or json: contract, customer, startDate, endDate|termMonths, period monthly|quarterly|annual|one_time, amount, escalatorPct?' },
    { name: 'invoices', shape: 'rows or json: contract?, customer, date, amount, number' },
    { name: 'payments', shape: 'rows or json: invoice number, date, amount (optional)', optional: true },
  ],
  args: { asOf: "'YYYY-MM-DD' (required)", dateTolerance: 5, amountTolerance: 0.01 },
  output: '{ asOf, expectedCount, matched: [{ expected, invoice }], missing: [expected], unexpected: [invoice], mistimed: [{ expected, invoice, daysOff }], amountDiffs: [{ expected, invoice, difference }], totals: { expected, invoiced, matched, missing, unexpected, mistimed, amountDifference }, schedulesSkipped }',
  run({ files, args = {} }) {
    const asOf = D.parseDate(args.asOf); if (!asOf) throw new Error("schedule_vs_actual: args.asOf 'YYYY-MM-DD' is required");
    const dateTol = Number(args.dateTolerance ?? 5); const amtTol = Number(args.amountTolerance ?? 0.01);
    const schedulesSkipped = [];
    const schedules = Tb.records(files[0]).map((r, i) => {
      const contract = Tb.str(Tb.field(r, F.contract)) || `schedule ${i + 2}`; const customer = Tb.str(Tb.field(r, F.customer));
      const start = D.parseDate(Tb.field(r, F.start)); let end = D.parseDate(Tb.field(r, F.end));
      const term = M.parseMoney(Tb.field(r, F.term)); if (!end && term && start) end = D.addDays(D.addMonths(start, Math.round(term)), -1);
      const periodRaw = Tb.norm(Tb.field(r, F.period)) || 'monthly'; const step = STEP[periodRaw];
      const amount = M.parseMoney(Tb.field(r, F.amount));
      if (!start || step === undefined || amount == null) { schedulesSkipped.push({ contract, why: !start ? 'no start date' : step === undefined ? `unknown period '${periodRaw}'` : 'no amount' }); return null; }
      return { contract, customer, start, end, step, period: periodRaw, amount: M.round2(amount), escalatorPct: M.parseMoney(Tb.field(r, F.escalator)) || 0 };
    }).filter(Boolean).sort(Tb.by((s) => s.contract, (s) => s.start));
    const expected = [];
    for (const s of schedules) for (const e of expand(s, asOf)) expected.push({ contract: s.contract, customer: s.customer, period: s.period, seq: e.seq, dueDate: e.periodStart, periodStart: e.periodStart, periodEnd: e.periodEnd, amount: e.amount });
    const contracts = new Set(schedules.map((s) => Tb.norm(s.contract))); const customers = new Set(schedules.map((s) => Tb.norm(s.customer)).filter(Boolean));
    const invoices = Tb.records(files[1]).map((r, i) => ({ number: Tb.str(Tb.field(r, F.invNumber)) || `invoice ${i + 2}`, contract: Tb.str(Tb.field(r, F.contract)), customer: Tb.str(Tb.field(r, F.customer)), date: D.parseDate(Tb.field(r, F.invDate)), amount: M.round2(M.parseMoney(Tb.field(r, F.invAmount)) || 0), used: false }))
      .filter((inv) => inv.date && inv.date <= asOf).sort(Tb.by((i) => i.date, (i) => i.number));
    const pays = files[2] ? Tb.records(files[2]).map((r) => ({ invoice: Tb.str(Tb.field(r, F.payInvoice)), date: D.parseDate(Tb.field(r, F.payDate)), amount: M.round2(M.parseMoney(Tb.field(r, F.payAmount)) || 0) })) : [];
    const paidFor = (num) => { const ps = pays.filter((p) => Tb.norm(p.invoice) === Tb.norm(num)); return ps.length ? { paid: M.sum(ps, (p) => p.amount), lastPaymentDate: ps.map((p) => p.date).filter(Boolean).sort().pop() || null } : null; };
    const belongs = (inv, e) => (inv.contract ? Tb.norm(inv.contract) === Tb.norm(e.contract) : e.customer && Tb.norm(inv.customer) === Tb.norm(e.customer));
    const matched = []; const missing = []; const mistimed = []; const amountDiffs = [];
    const strip = (inv) => { const p = paidFor(inv.number); return { number: inv.number, contract: inv.contract, customer: inv.customer, date: inv.date, amount: inv.amount, ...(p ? { paid: p.paid, lastPaymentDate: p.lastPaymentDate, settled: Math.abs(p.paid - inv.amount) < 0.005 } : {}) }; };
    for (const e of expected.sort(Tb.by((x) => x.contract, (x) => x.dueDate))) {
      const cands = invoices.filter((inv) => !inv.used && belongs(inv, e));
      const near = cands.filter((inv) => Math.abs(D.daysBetween(e.dueDate, inv.date)) <= dateTol).sort(Tb.by((inv) => Math.abs(D.daysBetween(e.dueDate, inv.date)), (inv) => Math.abs(inv.amount - e.amount), (inv) => inv.number));
      let hit = near[0]; let kind = 'matched';
      if (!hit) { const inWin = cands.filter((inv) => inv.date >= D.addDays(e.periodStart, -dateTol) && inv.date <= e.periodEnd).sort(Tb.by((inv) => Math.abs(D.daysBetween(e.dueDate, inv.date)), (inv) => inv.number)); hit = inWin[0]; kind = 'mistimed'; }
      if (!hit) { missing.push(e); continue; }
      hit.used = true;
      const rec = { expected: e, invoice: strip(hit) };
      if (kind === 'mistimed') mistimed.push({ ...rec, daysOff: D.daysBetween(e.dueDate, hit.date) }); else matched.push(rec);
      if (Math.abs(hit.amount - e.amount) > amtTol) amountDiffs.push({ ...rec, difference: M.round2(hit.amount - e.amount) });
    }
    const unexpected = invoices.filter((inv) => !inv.used).map((inv) => ({ ...strip(inv), knownContract: inv.contract ? contracts.has(Tb.norm(inv.contract)) : customers.has(Tb.norm(inv.customer)) }));
    const totals = { expected: M.sum(expected, (e) => e.amount), invoiced: M.sum(invoices, (i) => i.amount), matched: M.sum(matched, (m) => m.invoice.amount), missing: M.sum(missing, (e) => e.amount), unexpected: M.sum(unexpected, (u) => u.amount), mistimed: M.sum(mistimed, (m) => m.invoice.amount), amountDifference: M.sum(amountDiffs, (a) => a.difference) };
    return { asOf, expectedCount: expected.length, invoiceCount: invoices.length, matched, missing, unexpected, mistimed, amountDiffs, totals, counts: { matched: matched.length, missing: missing.length, unexpected: unexpected.length, mistimed: mistimed.length, amountDiffs: amountDiffs.length }, schedulesSkipped, tolerances: { dateTolerance: dateTol, amountTolerance: amtTol } };
  },
};
