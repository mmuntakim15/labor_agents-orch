'use strict';
// forecast_roll — roll an existing 13-week cash forecast to a new as-of date from the bank, open AR/AP, payroll and recurring commitments.
const M = require('./_money');
const D = require('./_dates');
const Tb = require('./_table');

const ROLES = ['forecast', 'bank', 'invoices', 'bills', 'payroll', 'recurring'];
const HINT = { forecast: /forecast|13.?week|cash.?flow/i, bank: /bank|balance|transactions|statement|plaid/i, invoices: /invoice|receivable|\bar\b/i, bills: /bill|payable|\bap\b/i, payroll: /payroll|wages/i, recurring: /recurring|commitment|subscription/i };
const F = {
  date: ['date', 'txndate', 'transactiondate', 'posted', 'postingdate', 'paydate', 'checkdate', 'nextdate', 'startdate', 'start'],
  amount: ['amount', 'total', 'balancedue', 'balance', 'open', 'outstanding', 'amountdue', 'openbalance', 'value', 'net'],
  balance: ['balance', 'runningbalance', 'currentbalance', 'availablebalance', 'endingbalance'],
  description: ['description', 'memo', 'name', 'payee', 'merchant', 'details', 'narrative'],
  customer: ['customer', 'customername', 'client', 'account'],
  vendor: ['vendor', 'vendorname', 'supplier', 'payee'],
  number: ['number', 'invoicenumber', 'invoice', 'billnumber', 'bill', 'docnumber', 'reference', 'id'],
  due: ['duedate', 'due', 'expecteddate', 'paymentdate'],
  frequency: ['frequency', 'cadence', 'period', 'interval', 'recurrence'],
  direction: ['direction', 'type', 'kind', 'flow'],
  dayOfMonth: ['dayofmonth', 'day'],
};
const LINE = [
  ['opening', /opening|beginning|starting/i], ['closing', /closing|ending/i],
  ['ar', /receiv|collection|customer|\bar\b|sales receipt|cash in from customers/i], ['ap', /payable|vendor|supplier|\bap\b|bills/i],
  ['payroll', /payroll|wages|salar|benefits/i], ['recurring', /rent|lease|loan|debt|recurring|subscription|insurance|utilit|software|saas/i],
  ['otherIn', /other inflow|other income|other receipt|financing in|interest income|refund|inflow/i], ['otherOut', /other outflow|other payment|tax|capex|owner draw|distribution|outflow/i],
];
const STEP_DAYS = { weekly: 7, week: 7, biweekly: 14, fortnightly: 14, everytwoweeks: 14 };
const STEP_MONTHS = { monthly: 1, month: 1, quarterly: 3, quarter: 3, semiannual: 6, annual: 12, annually: 12, yearly: 12 };

function assignRoles(files) {
  const out = {}; const left = [...files];
  for (const role of ROLES) { const i = left.findIndex((f) => HINT[role].test(f.name)); if (i >= 0) { out[role] = left[i]; left.splice(i, 1); } }
  for (const role of ROLES) if (!out[role] && left.length) out[role] = left.shift();
  return out;
}

/** Read the existing forecast grid: week start dates, line labels, prior values and the prior closing per week. */
function readForecast(file) {
  const rows = file.rows || (file.sheets && file.sheets[0] ? file.sheets[0].rows : (Array.isArray(file.json) && Array.isArray(file.json[0]) ? file.json : null));
  if (!rows || !rows.length) return { weeks: [], lines: {}, closing: {}, orientation: null, weekday: null };
  const datesIn = (arr) => arr.map((v, i) => ({ i, d: D.parseDate(v) })).filter((x) => x.d);
  let best = { n: 0 }; rows.forEach((r, ri) => { const ds = datesIn(r); if (ds.length > best.n) best = { n: ds.length, ri, ds }; });
  const lines = {}; const closing = {}; let weeks = []; let orientation = null;
  if (best.n >= 3) {
    orientation = 'columns'; weeks = best.ds.map((x) => x.d);
    for (const r of rows.slice(best.ri + 1)) { const label = Tb.str(r[0]) || Tb.str(r.find((c) => typeof c === 'string' && c.trim())); if (!label) continue; const kind = (LINE.find(([, re]) => re.test(label)) || ['other'])[0]; lines[label] = { kind, values: Object.fromEntries(best.ds.map((x) => [x.d, M.parseMoney(r[x.i])])) }; }
  } else {
    let col = -1; let n = 0; const width = Math.max(...rows.map((r) => r.length));
    for (let c = 0; c < width; c += 1) { const k = rows.filter((r) => D.parseDate(r[c])).length; if (k > n) { n = k; col = c; } }
    if (n >= 3) {
      orientation = 'rows'; const header = rows.find((r) => Tb.str(r[col]) && !D.parseDate(r[col])) || [];
      const dataRows = rows.filter((r) => D.parseDate(r[col])); weeks = dataRows.map((r) => D.parseDate(r[col]));
      header.forEach((h, ci) => { if (ci === col || !Tb.str(h)) return; const label = Tb.str(h); const kind = (LINE.find(([, re]) => re.test(label)) || ['other'])[0]; lines[label] = { kind, values: Object.fromEntries(dataRows.map((r) => [D.parseDate(r[col]), M.parseMoney(r[ci])])) }; });
    }
  }
  weeks = [...new Set(weeks)].sort();
  for (const [label, l] of Object.entries(lines)) if (l.kind === 'closing') for (const w of weeks) if (l.values[w] != null) closing[w] = l.values[w];
  return { weeks, lines, closing, orientation, weekday: weeks.length ? D.weekday(weeks[0]) : null, labels: Object.keys(lines).sort() };
}

module.exports = {
  name: 'forecast_roll',
  describe: 'Rolls an existing 13-week cash forecast to args.asOf. The old workbook gives the week alignment and the prior closing per week (for deviation flags); weeks before the current one are replaced with actuals from the bank transactions; forward weeks are rebuilt from the bank balance at asOf plus open invoices (AR, shifted by collectionLagDays; past-due into week 1), open bills (AP), the payroll calendar and recurring commitments. An item the bank already shows as settled (invoice/bill number in a bank description, or same counterparty and exact amount; payroll of the same amount within 3 days) is excluded, so nothing is counted twice. Files are assigned to roles by name hint (forecast, bank, invoice, bill, payroll, recurring) then by position. Pure: never reads the clock.',
  inputs: [
    { name: 'forecast', shape: 'existing forecast .xlsx/.csv: week start dates across a header row or down a column; line labels Opening/AR/AP/Payroll/Recurring/Closing' },
    { name: 'bank', shape: 'json { balance, asOf? } or rows: date, amount (signed), description, balance? (running)' },
    { name: 'invoices', shape: 'rows: customer, number, dueDate, amount|balance (open AR)', optional: true },
    { name: 'bills', shape: 'rows: vendor, number, dueDate, amount|balance (open AP)', optional: true },
    { name: 'payroll', shape: 'rows: date, amount', optional: true },
    { name: 'recurring', shape: 'rows: name, amount, frequency weekly|biweekly|monthly|quarterly|annual, nextDate|startDate|dayOfMonth, direction in|out (default out)', optional: true },
  ],
  args: { asOf: "'YYYY-MM-DD' (required)", weeks: 13, collectionLagDays: 0, openingBalance: 'override for the bank balance at asOf (optional)', weekStartsOn: '0-6, default: weekday of the old forecast, else Monday' },
  output: '{ asOf, weeks: [{ start, end, opening, inflows: { ar, other, total }, outflows: { ap, payroll, recurring, other, total }, net, closing, isActual, priorClosing }], items: [{ week, kind, ref, counterparty, date, amount, source }], excludedSettled: [...], beyondHorizon: [...], assumptions: [], flags: [{ week, why }], replacedActualsFor: [weeks], noDoubleCount, prior: { orientation, weeks, labels } }',
  run({ files, args = {} }) {
    const asOf = D.parseDate(args.asOf); if (!asOf) throw new Error("forecast_roll: args.asOf 'YYYY-MM-DD' is required");
    const horizon = Math.max(1, Number(args.weeks || 13)); const lag = Number(args.collectionLagDays || 0);
    const roles = assignRoles(files);
    if (!roles.forecast) throw new Error('forecast_roll: the existing forecast is required as the first input');
    const prior = readForecast(roles.forecast);
    const assumptions = []; const flags = [];
    const weekStartsOn = args.weekStartsOn != null ? Number(args.weekStartsOn) : prior.weekday != null ? prior.weekday : 1;
    const back = (D.weekday(asOf) - weekStartsOn + 7) % 7; const week0 = D.addDays(asOf, -back);
    const weekOf = (d) => Math.floor(D.daysBetween(week0, d) / 7);
    assumptions.push(prior.weeks.length ? `week starts follow the prior forecast (weekday ${weekStartsOn}); current week starts ${week0}` : `no week dates found in the prior forecast; weeks start on weekday ${weekStartsOn} from ${week0}`);

    // bank: balance at asOf and transactions
    const bank = roles.bank; if (!bank) throw new Error('forecast_roll: a bank balance/transactions input is required');
    const bj = bank.json && !Array.isArray(bank.json) ? bank.json : null;
    const txns = (bj ? Tb.records({ json: bj.transactions || bj.rows || bj.data || [] }) : Tb.records(bank)).map((r) => ({ date: D.parseDate(Tb.field(r, F.date)), amount: M.parseMoney(Tb.field(r, F.amount)), description: Tb.str(Tb.field(r, F.description)), balance: M.parseMoney(Tb.field(r, F.balance)) })).filter((t) => t.date && t.amount != null && t.date <= asOf).sort(Tb.by((t) => t.date, (t) => t.description, (t) => t.amount));
    let opening = null; let openingSource = null;
    if (args.openingBalance != null) { opening = M.round2(M.parseMoney(args.openingBalance)); openingSource = 'args.openingBalance'; }
    else if (bj && M.parseMoney(bj.balance ?? bj.currentBalance ?? bj.availableBalance ?? bj.current) != null) { opening = M.round2(M.parseMoney(bj.balance ?? bj.currentBalance ?? bj.availableBalance ?? bj.current)); openingSource = 'bank json balance'; }
    else { const withBal = txns.filter((t) => t.balance != null); if (withBal.length) { opening = M.round2(withBal[withBal.length - 1].balance); openingSource = `running balance after ${withBal[withBal.length - 1].date}`; } }
    if (opening == null) throw new Error('forecast_roll: no bank balance at asOf (json balance, a running-balance column, or args.openingBalance)');
    assumptions.push(`opening cash ${opening.toFixed(2)} from ${openingSource}`);

    // settled-in-bank test
    const normDesc = txns.map((t) => ({ ...t, n: Tb.norm(t.description) }));
    const settledBy = (ref, counterparty, amount, sign, date = null, window = null) => {
      const r = Tb.norm(ref); const cp = Tb.norm(counterparty);
      for (const t of normDesc) {
        if (sign && Math.sign(t.amount) !== sign) continue;
        if (r && r.length >= 4 && t.n.includes(r)) return `${t.date} ${t.description} ${t.amount}`;
        if (window && date && Math.abs(D.daysBetween(date, t.date)) <= window && M.eq(Math.abs(t.amount), Math.abs(amount))) return `${t.date} ${t.description} ${t.amount}`;
        if (!window && cp && cp.length >= 4 && M.eq(Math.abs(t.amount), Math.abs(amount)) && (t.n.includes(cp) || cp.includes(t.n.slice(0, Math.max(4, Math.min(t.n.length, 8)))) && t.n.length >= 4)) return `${t.date} ${t.description} ${t.amount}`;
      }
      return null;
    };

    const items = []; const excludedSettled = []; const beyondHorizon = [];
    const place = (kind, ref, counterparty, date, amount, source, { pastDueFlag = true } = {}) => {
      let target = date; let note = null;
      if (target <= asOf) { target = D.addDays(asOf, 1); note = 'past due at asOf, placed in the current week'; }
      const w = weekOf(target);
      if (w >= horizon) { beyondHorizon.push({ kind, ref, counterparty, date, amount, source }); return; }
      items.push({ week: w, kind, ref, counterparty, date, expectedDate: target, amount: M.round2(amount), source, note });
      if (note && pastDueFlag) flags.push({ week: w, why: `${kind} ${ref || counterparty} dated ${date} is past due; assumed to settle in the current week` });
    };
    const rec = (file, fields) => Tb.records(file).map((r, i) => ({ ref: Tb.str(Tb.field(r, F.number)) || `${fields}-${i + 2}`, counterparty: Tb.str(Tb.field(r, F[fields])), date: D.parseDate(Tb.field(r, F.due)) || D.parseDate(Tb.field(r, F.date)), amount: M.parseMoney(Tb.field(r, F.amount)) })).filter((x) => x.date && x.amount != null && x.amount !== 0).sort(Tb.by((x) => x.date, (x) => x.ref));
    if (roles.invoices) for (const inv of rec(roles.invoices, 'customer')) { const s = settledBy(inv.ref, inv.counterparty, inv.amount, 1); if (s) { excludedSettled.push({ kind: 'ar', ref: inv.ref, counterparty: inv.counterparty, amount: M.round2(inv.amount), bankLine: s }); continue; } place('ar', inv.ref, inv.counterparty, D.addDays(inv.date, lag), Math.abs(inv.amount), roles.invoices.name); }
    if (roles.bills) for (const b of rec(roles.bills, 'vendor')) { const s = settledBy(b.ref, b.counterparty, b.amount, -1); if (s) { excludedSettled.push({ kind: 'ap', ref: b.ref, counterparty: b.counterparty, amount: M.round2(b.amount), bankLine: s }); continue; } place('ap', b.ref, b.counterparty, b.date, -Math.abs(b.amount), roles.bills.name); }
    if (roles.payroll) for (const p of Tb.records(roles.payroll).map((r, i) => ({ ref: Tb.str(Tb.field(r, F.description)) || `payroll-${i + 2}`, date: D.parseDate(Tb.field(r, F.date)), amount: M.parseMoney(Tb.field(r, F.amount)) })).filter((x) => x.date && x.amount).sort(Tb.by((x) => x.date, (x) => x.ref))) {
      const s = settledBy('', 'payroll', p.amount, -1, p.date, 3); if (s) { excludedSettled.push({ kind: 'payroll', ref: p.ref, date: p.date, amount: M.round2(p.amount), bankLine: s }); continue; }
      place('payroll', p.ref, 'payroll', p.date, -Math.abs(p.amount), roles.payroll.name);
    }
    if (roles.recurring) {
      const end = D.addDays(week0, horizon * 7 - 1);
      for (const r of Tb.records(roles.recurring).map((x, i) => ({ name: Tb.str(Tb.field(x, F.description)) || `recurring-${i + 2}`, amount: M.parseMoney(Tb.field(x, F.amount)), freq: Tb.norm(Tb.field(x, F.frequency)) || 'monthly', anchor: D.parseDate(Tb.field(x, F.due)) || D.parseDate(Tb.field(x, F.date)), dom: M.parseMoney(Tb.field(x, F.dayOfMonth)), dir: Tb.norm(Tb.field(x, F.direction)) })).filter((x) => x.amount).sort(Tb.by((x) => x.name))) {
        const inflow = /^(in|inflow|receipt|income|credit)$/.test(r.dir) || r.amount < 0 && !r.dir; const amt = Math.abs(r.amount) * (inflow ? 1 : -1);
        let anchor = r.anchor; if (!anchor && r.dom) { const d = Math.min(Math.max(1, Math.round(r.dom)), 28); anchor = `${D.monthKey(asOf)}-${String(d).padStart(2, '0')}`; }
        if (!anchor) { assumptions.push(`recurring '${r.name}' has no date or dayOfMonth; skipped`); continue; }
        const days = STEP_DAYS[r.freq]; const months = STEP_MONTHS[r.freq];
        if (!days && !months) { assumptions.push(`recurring '${r.name}' has unknown frequency '${r.freq}'; skipped`); continue; }
        let k = 0; let occ = anchor; let guard = 0;
        while (occ < D.addDays(week0, -366) && guard < 2000) { k += 1; occ = days ? D.addDays(anchor, days * k) : D.addMonths(anchor, months * k); guard += 1; }
        for (; guard < 4000 && occ <= end; k += 1, guard += 1) { if (occ > asOf) place(inflow ? 'otherIn' : 'recurring', r.name, r.name, occ, amt, roles.recurring.name, { pastDueFlag: false }); occ = days ? D.addDays(anchor, days * (k + 1)) : D.addMonths(anchor, months * (k + 1)); }
      }
    }
    items.sort(Tb.by((i) => i.week, (i) => i.kind, (i) => i.expectedDate, (i) => i.ref, (i) => i.counterparty));

    // actual weeks: prior forecast weeks before the current week, restated from the bank
    const actualStarts = prior.weeks.filter((w) => w < week0 && D.daysBetween(w, week0) % 7 === 0);
    const weeks = []; const replacedActualsFor = [];
    for (const ws of actualStarts) {
      const we = D.addDays(ws, 6); const inWeek = txns.filter((t) => t.date >= ws && t.date <= we); const after = txns.filter((t) => t.date > we);
      const closing = M.round2(opening - M.sum(after, (t) => t.amount)); const inflow = M.sum(inWeek.filter((t) => t.amount > 0), (t) => t.amount); const outflow = M.sum(inWeek.filter((t) => t.amount < 0), (t) => t.amount);
      weeks.push({ start: ws, end: we, opening: M.round2(closing - inflow - outflow), inflows: { ar: null, other: null, total: inflow }, outflows: { ap: null, payroll: null, recurring: null, other: null, total: outflow }, net: M.round2(inflow + outflow), closing, isActual: true, priorClosing: prior.closing[ws] ?? null, transactions: inWeek.length });
      replacedActualsFor.push(ws);
      if (prior.closing[ws] != null && !M.eq(prior.closing[ws], closing)) flags.push({ week: ws, why: `actual closing ${closing.toFixed(2)} differs from the prior forecast ${prior.closing[ws].toFixed(2)} by ${M.round2(closing - prior.closing[ws]).toFixed(2)}` });
    }
    if (!txns.length && actualStarts.length) assumptions.push('no bank transactions supplied: actual weeks show the asOf balance carried back with zero flows');
    let bal = opening;
    for (let w = 0; w < horizon; w += 1) {
      const start = D.addDays(week0, w * 7); const its = items.filter((i) => i.week === w);
      const sumK = (k) => M.sum(its.filter((i) => i.kind === k), (i) => i.amount);
      const inflows = { ar: sumK('ar'), other: sumK('otherIn') }; inflows.total = M.round2(inflows.ar + inflows.other);
      const outflows = { ap: sumK('ap'), payroll: sumK('payroll'), recurring: sumK('recurring'), other: sumK('otherOut') }; outflows.total = M.round2(outflows.ap + outflows.payroll + outflows.recurring + outflows.other);
      const net = M.round2(inflows.total + outflows.total); const closing = M.round2(bal + net);
      const priorClosing = prior.closing[start] ?? null;
      weeks.push({ start, end: D.addDays(start, 6), opening: bal, inflows, outflows, net, closing, isActual: false, priorClosing, items: its.length });
      if (closing < 0) flags.push({ week: start, why: `closing cash is negative (${closing.toFixed(2)})` });
      if (priorClosing != null && Math.abs(closing - priorClosing) > Math.max(500, Math.abs(priorClosing) * 0.1)) flags.push({ week: start, why: `closing ${closing.toFixed(2)} differs from the prior forecast ${priorClosing.toFixed(2)} by ${M.round2(closing - priorClosing).toFixed(2)}` });
      bal = closing;
    }
    if (beyondHorizon.length) assumptions.push(`${beyondHorizon.length} open item(s) fall after the ${horizon}-week horizon and are excluded (listed in beyondHorizon)`);
    if (lag) assumptions.push(`AR collections assumed ${lag} day(s) after invoice due date`);
    const placedKeys = items.map((i) => `${i.kind}|${i.ref}|${i.expectedDate}|${i.amount}`); const excludedKeys = new Set(excludedSettled.map((e) => `${e.kind}|${e.ref}`));
    const noDoubleCount = new Set(placedKeys).size === placedKeys.length && !items.some((i) => excludedKeys.has(`${i.kind}|${i.ref}`)) && items.every((i) => i.expectedDate > asOf);
    flags.sort(Tb.by((f) => f.week, (f) => f.why));
    return { asOf, weekStart: week0, horizon, opening, openingSource, weeks, items, excludedSettled: excludedSettled.sort(Tb.by((e) => e.kind, (e) => e.ref)), beyondHorizon: beyondHorizon.sort(Tb.by((e) => e.date, (e) => e.ref)), assumptions, flags, replacedActualsFor, noDoubleCount, prior: { orientation: prior.orientation, weeks: prior.weeks, labels: prior.labels || [] }, roles: Object.fromEntries(Object.entries(roles).map(([k, f]) => [k, f.name])) };
  },
};
