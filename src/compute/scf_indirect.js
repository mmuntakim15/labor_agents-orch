'use strict';
// scf_indirect — rebuild an indirect-method statement of cash flows from two balance sheets and the P&L, and reconcile it to the change in cash.
const M = require('./_money');
const Tb = require('./_table');

const F = {
  account: ['account', 'accountname', 'name', 'glaccount', 'line', 'accounting_category'],
  type: ['type', 'accounttype', 'class', 'accounting_accounts', 'category'],
  subtype: ['subtype', 'detailtype', 'subcategory', 'accountsubtype'],
  balance: ['balance', 'amount', 'total', 'closingbalance', 'endingbalance', 'value'],
  line: ['line', 'label', 'name', 'description', 'item'],
};
const BUCKETS = ['cash', 'operating', 'noncash', 'investing', 'financing', 'retained', 'ignore'];

/** Which side of the balance sheet an account sits on, from its type/subtype/name. */
function side(acc) {
  const t = `${acc.type} ${acc.subtype}`.toLowerCase(); const n = acc.account.toLowerCase();
  if (/asset|receivable|inventory|prepaid|bank|cash|accumulated|fixed|equipment|property|intangible|goodwill/.test(t)) return 'asset';
  if (/liabilit|payable|credit card|accrued|deferred|unearned|loan|note|debt|mortgage|lease|equity|capital|retained|stock|distribution|dividend|draw|owner|partner|member|apic|paid.in|net income|earnings/.test(t)) return 'claim';
  if (/receivable|inventory|prepaid|cash|checking|savings|equipment|accumulated|property|vehicle|furniture|intangible|goodwill|deposit/.test(n)) return 'asset';
  if (/payable|accrued|deferred|unearned|loan|note|debt|mortgage|lease liabilit|equity|capital|retained|stock|distribution|dividend|draw|net income|earnings|credit card|line of credit/.test(n)) return 'claim';
  return null;
}

function classify(acc, mapping) {
  const n = acc.account.toLowerCase(); const st = acc.subtype.toLowerCase(); const t = acc.type.toLowerCase(); const all = `${t} ${st}`;
  for (const [pattern, bucket] of mapping) if (pattern.test(acc.account) || pattern.test(acc.subtype) || pattern.test(acc.type)) return { bucket, by: 'mapping' };
  if (/cash|bank|checking|savings|money market|petty cash|undeposited/.test(st) || /\b(cash|bank)\b/.test(t) || /\b(cash|checking|savings|money market|petty cash|undeposited)\b/.test(n)) return { bucket: 'cash', by: 'type' };
  if (/accumulated|accum\.|allowance|reserve/.test(n) || /accumulated/.test(all)) return { bucket: 'noncash', by: 'name' };
  if (/retained earnings|net income|current year earnings|current earnings|profit for the (year|period)|opening balance equity/.test(n) || /retained|net income/.test(all)) return { bucket: 'retained', by: 'name' };
  if (/fixed asset|property|plant|equipment|ppe|intangible|goodwill|investment|long.?term asset|non.?current asset|other asset|vehicle|furniture|land|building|leasehold|right.of.use/.test(all) || /equipment|property|vehicle|furniture|land|building|leasehold|right.of.use|intangible|goodwill|investment in|capitalised|capitalized/.test(n)) return { bucket: 'investing', by: 'type' };
  if (/long.?term liabilit|non.?current liabilit|loan|note payable|notes payable|debt|line of credit|mortgage|lease liabilit|equity|capital|stock|apic|paid.in|distribution|dividend|draw|contribution|owner|partner|member|shareholder/.test(all) || /loan|note payable|notes payable|debt|line of credit|mortgage|lease liabilit|equity|capital|stock|apic|paid.in|distribution|dividend|draw|contribution|owner|partner|member|shareholder/.test(n)) return { bucket: 'financing', by: 'type' };
  if (/current asset|receivable|inventory|prepaid|current liabilit|payable|credit card|accrued|deferred|unearned|sales tax|payroll liabilit|other current/.test(all) || /receivable|inventory|prepaid|payable|accrued|deferred|unearned|sales tax|payroll liabilit|credit card|deposit/.test(n)) return { bucket: 'operating', by: 'type' };
  return { bucket: null, by: null };
}

function loadBs(file) {
  const out = new Map();
  for (const r of Tb.records(file)) {
    const account = Tb.str(Tb.field(r, F.account)); if (!account || /^total/i.test(account)) continue;
    const bal = M.parseMoney(Tb.field(r, F.balance)); if (bal == null) continue;
    const key = Tb.norm(account);
    const prev = out.get(key) || { account, type: Tb.str(Tb.field(r, F.type)), subtype: Tb.str(Tb.field(r, F.subtype)), balance: 0 };
    prev.balance = M.round2(prev.balance + bal); out.set(key, prev);
  }
  return out;
}

module.exports = {
  name: 'scf_indirect',
  describe: 'Rebuilds an indirect-method statement of cash flows from an opening and a closing balance sheet plus the P&L: net income, non-cash add-backs (change in accumulated depreciation/amortisation and allowances), working-capital changes (current assets and liabilities), investing (fixed assets, intangibles, investments), financing (debt and equity other than the retained-earnings roll), and reconciles the total to the change in cash accounts. Balances are read as presented (assets debit-positive, contra assets negative, liabilities and equity credit-positive). A retained-earnings movement beyond net income is shown in financing as the implied distribution/adjustment. Optional system SCF lines are compared line by line. Pure.',
  inputs: [
    { name: 'openingBalanceSheet', shape: 'rows or json: account, type, subtype?, balance' },
    { name: 'closingBalanceSheet', shape: 'rows or json: account, type, subtype?, balance' },
    { name: 'profitAndLoss', shape: 'rows or json: account, type (income|expense…), amount (positive as presented)' },
    { name: 'systemScf', shape: 'rows or json: line, amount (optional)', optional: true },
  ],
  args: { mapping: "{ '<regex on account/subtype/type>': 'operating'|'investing'|'financing'|'noncash'|'cash'|'retained'|'ignore' } overrides (optional)", netIncome: 'override for the P&L-derived net income (optional)' },
  output: '{ operating: { netIncome, adjustments: [{ account, amount, why }], total }, investing: { lines, total }, financing: { lines, total }, netChange, cashOpening, cashClosing, cashChange, reconciles, unexplained, unclassified: [...], checks: { netIncomeVsRetainedEarningsRoll, plDepreciationVsAccumulatedChange }, comparison?: [{ line, rebuilt, system, difference }] }',
  run({ files, args = {} }) {
    const mapping = Object.entries(args.mapping || {}).map(([p, b]) => { if (!BUCKETS.includes(b)) throw new Error(`scf_indirect: mapping bucket '${b}' must be one of ${BUCKETS.join('|')}`); return [new RegExp(p, 'i'), b]; });
    const open = loadBs(files[0]); const close = loadBs(files[1]);
    const pl = Tb.records(files[2] || []);
    let revenue = 0; let expenses = 0; let plDepreciation = 0;
    for (const r of pl) {
      const account = Tb.str(Tb.field(r, F.account)); if (!account || /^(total|net income|net profit|gross profit)/i.test(account)) continue;
      const amt = M.parseMoney(Tb.field(r, F.balance)); if (amt == null) continue;
      const t = Tb.str(Tb.field(r, F.type)).toLowerCase();
      const isIncome = /income|revenue|sales/.test(t) && !/cost|expense/.test(t);
      if (isIncome) revenue = M.round2(revenue + amt); else { expenses = M.round2(expenses + amt); if (/depreciation|amorti[sz]ation/i.test(account)) plDepreciation = M.round2(plDepreciation + amt); }
    }
    const netIncome = args.netIncome != null ? M.round2(M.parseMoney(args.netIncome)) : M.round2(revenue - expenses);
    const keys = [...new Set([...open.keys(), ...close.keys()])].sort();
    const buckets = { cash: [], operating: [], noncash: [], investing: [], financing: [], retained: [], ignore: [], unclassified: [] };
    let cashOpening = 0; let cashClosing = 0;
    for (const k of keys) {
      const a = close.get(k) || open.get(k); const o = open.get(k) ? open.get(k).balance : 0; const c = close.get(k) ? close.get(k).balance : 0;
      const change = M.round2(c - o);
      const { bucket, by } = classify(a, mapping);
      const sd = side(a) || (bucket === 'noncash' || bucket === 'investing' || bucket === 'operating' && /receivable|inventory|prepaid|deposit/.test(a.account.toLowerCase()) ? 'asset' : bucket ? 'claim' : null);
      if (bucket === 'cash') { cashOpening = M.round2(cashOpening + o); cashClosing = M.round2(cashClosing + c); buckets.cash.push({ account: a.account, opening: o, closing: c, change }); continue; }
      if (!bucket) { buckets.unclassified.push({ account: a.account, type: a.type, subtype: a.subtype, opening: o, closing: c, change }); continue; }
      if (bucket === 'ignore') { buckets.ignore.push({ account: a.account, change }); continue; }
      const cashEffect = sd === 'asset' ? M.round2(-change) : change;
      buckets[bucket].push({ account: a.account, opening: o, closing: c, change, amount: cashEffect, side: sd, classifiedBy: by });
    }
    const why = (b, x) => {
      if (b === 'noncash') return x.amount >= 0 ? 'non-cash charge added back (contra-asset grew)' : 'contra-asset released (disposal/write-back)';
      if (b === 'operating') return x.side === 'asset' ? (x.change > 0 ? 'increase in current asset uses cash' : 'decrease in current asset frees cash') : (x.change > 0 ? 'increase in current liability frees cash' : 'decrease in current liability uses cash');
      if (b === 'investing') return x.change > 0 ? 'purchase of long-lived asset' : 'disposal/collection of long-lived asset';
      return x.side === 'asset' ? (x.change > 0 ? 'advance made' : 'advance repaid') : (x.change > 0 ? 'proceeds (borrowing/contribution)' : 'repayment/distribution');
    };
    const line = (b) => (x) => ({ account: x.account, change: x.change, amount: x.amount, why: why(b, x) });
    // presentation order: non-cash add-backs, then working-capital assets, then working-capital liabilities (each alphabetical)
    const opSorted = [...buckets.operating].sort(Tb.by((x) => (x.side === 'asset' ? 0 : 1), (x) => x.account));
    const adjustments = [...buckets.noncash.map(line('noncash')), ...opSorted.map(line('operating'))];
    const investingLines = buckets.investing.map(line('investing'));
    const financingLines = buckets.financing.map(line('financing'));
    const reChange = M.sum(buckets.retained, (x) => x.change);
    const reResidual = M.round2(reChange - netIncome);
    if (buckets.retained.length && Math.abs(reResidual) >= 0.005) financingLines.push({ account: 'Retained earnings roll beyond net income', change: reChange, amount: reResidual, why: reResidual < 0 ? 'retained earnings fell by more than net income: implied distributions/dividends or prior-period adjustment' : 'retained earnings rose by more than net income: implied contribution or prior-period adjustment' });
    const operatingTotal = M.round2(netIncome + M.sum(adjustments, (x) => x.amount));
    const investingTotal = M.sum(investingLines, (x) => x.amount);
    const financingTotal = M.sum(financingLines, (x) => x.amount);
    const netChange = M.round2(operatingTotal + investingTotal + financingTotal);
    const cashChange = M.round2(cashClosing - cashOpening);
    const unexplained = M.round2(cashChange - netChange);
    const accumChange = M.sum(buckets.noncash, (x) => x.amount);
    const out = {
      operating: { netIncome, adjustments, total: operatingTotal },
      investing: { lines: investingLines, total: investingTotal },
      financing: { lines: financingLines, total: financingTotal },
      netChange, cashOpening, cashClosing, cashChange, reconciles: Math.abs(unexplained) < 0.005 && !buckets.unclassified.length, unexplained,
      cashAccounts: buckets.cash, unclassified: buckets.unclassified, ignored: buckets.ignore,
      checks: {
        netIncomeVsRetainedEarningsRoll: { netIncome, retainedEarningsChange: reChange, difference: reResidual, retainedAccounts: buckets.retained.map((x) => x.account) },
        plDepreciationVsAccumulatedChange: { plDepreciation, accumulatedChange: accumChange, difference: M.round2(accumChange - plDepreciation) },
        profitAndLoss: { revenue, expenses, netIncomeFromPl: M.round2(revenue - expenses), netIncomeOverridden: args.netIncome != null },
      },
    };
    if (files[3]) {
      const rebuilt = new Map([
        ['netincome', netIncome], ['operating', operatingTotal], ['netcashfromoperatingactivities', operatingTotal], ['netcashprovidedbyoperatingactivities', operatingTotal], ['cashfromoperations', operatingTotal], ['operatingactivities', operatingTotal],
        ['investing', investingTotal], ['netcashfrominvestingactivities', investingTotal], ['netcashusedininvestingactivities', investingTotal], ['investingactivities', investingTotal],
        ['financing', financingTotal], ['netcashfromfinancingactivities', financingTotal], ['netcashusedinfinancingactivities', financingTotal], ['financingactivities', financingTotal],
        ['netchange', netChange], ['netchangeincash', netChange], ['netincreaseincash', netChange], ['netincreasedecreaseincash', netChange], ['netcashflow', netChange],
        ['cashopening', cashOpening], ['beginningcash', cashOpening], ['cashatbeginningofperiod', cashOpening], ['openingcash', cashOpening],
        ['cashclosing', cashClosing], ['endingcash', cashClosing], ['cashatendofperiod', cashClosing], ['closingcash', cashClosing],
      ]);
      for (const x of [...adjustments, ...investingLines, ...financingLines]) if (!rebuilt.has(Tb.norm(x.account))) rebuilt.set(Tb.norm(x.account), x.amount);
      out.comparison = Tb.records(files[3]).map((r) => {
        const l = Tb.str(Tb.field(r, F.line)); const sys = M.parseMoney(Tb.field(r, F.balance));
        const key = Tb.norm(l).replace(/^(increase|decrease|changein|changesin)/, '');
        const rb = rebuilt.has(Tb.norm(l)) ? rebuilt.get(Tb.norm(l)) : rebuilt.has(key) ? rebuilt.get(key) : null;
        return { line: l, rebuilt: rb, system: sys == null ? null : M.round2(sys), difference: rb == null || sys == null ? null : M.round2(rb - sys) };
      }).filter((c) => c.line).sort(Tb.by((c) => c.line));
      out.comparisonTies = out.comparison.every((c) => c.difference != null && Math.abs(c.difference) < 0.005);
    }
    return out;
  },
};
