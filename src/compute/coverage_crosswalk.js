'use strict';
// coverage_crosswalk — which balance-sheet accounts on the trial balance have
// a supporting schedule or reconciliation, and which do not. Pure.
const F = require('./_fields');

const SUPPORT_TYPES = ['bank_recon', 'prepaid', 'fixed_asset', 'debt', 'lease', 'accrual', 'revrec', 'external'];
const DICT_KEYS = { bankRecon: 'bank_recon', bankReconciliation: 'bank_recon', prepaids: 'prepaid', prepaid: 'prepaid', fixedAssets: 'fixed_asset', depreciation: 'fixed_asset', debt: 'debt', loans: 'debt', leases: 'lease', accruals: 'accrual', revenueRecognition: 'revrec', revrec: 'revrec', external: 'external', schedules: 'external' };

/** Expected support for an account, from its name then its type. */
function expectedSupport(name, type) {
  const n = ` ${String(name || '').toLowerCase()} `; const t = String(type || '').toLowerCase();
  if (/accumulated dep|fixed asset|equipment|furniture|vehicle|machinery|building|leasehold improvement|computer|property, plant|capital asset/.test(n)) return 'fixed_asset';
  if (/prepaid|deposit paid|prepayment/.test(n)) return 'prepaid';
  if (/deferred revenue|unearned|contract liabilit|customer deposit/.test(n)) return 'revrec';
  if (/right.of.use|\brou\b|lease liabilit|operating lease|finance lease|lease /.test(n)) return 'lease';
  if (/accrued|accrual/.test(n)) return 'accrual';
  if (/note|loan|debt|line of credit|mortgage|bond|borrowing|sba|ppp|credit facility|payable to shareholder|due to/.test(n)) return 'debt';
  if (/cash|bank|checking|savings|money market|petty|operating acct|credit card|paypal|stripe balance|undeposited/.test(n) || /bank|cash|credit card/.test(t)) return 'bank_recon';
  return 'external';
}
const EXCLUDE_DEFAULT = ['Income', 'Expense', 'Revenue', 'Cost of Goods Sold'];
const typeKey = (t) => F.normKey(t).replace(/s$/, '');

/** Flatten a trial balance input to [{account, code, type, balance}]. */
function tbRows(file) {
  const j = file.json;
  const out = [];
  const push = (r, catHint) => {
    const account = F.str(F.pick(r, ['entryName', 'account', 'accountName', 'account_name', 'name', 'accounting_category']));
    if (!account) return;
    let balance = F.num(F.pick(r, 'balance'));
    if (balance == null) {
      const s = F.sides(r);
      if (s) { const side = (F.str(F.pick(r, ['glType', 'side', 'drcr'])) || F.str(F.pick(r, ['type']))).toLowerCase(); const amt = F.num(F.pick(r, 'amount')); balance = side === 'credit' && amt != null ? -Math.abs(amt) : side === 'debit' && amt != null ? Math.abs(amt) : s.debit - s.credit; }
    }
    if (balance == null) return;
    out.push({ account, code: F.str(F.pick(r, 'accountCode')) || null, type: F.str(F.pick(r, ['accountType', 'category', 'account_type', 'accounting_accounts']) ?? catHint) || F.str(F.pick(r, ['type'])) || F.str(catHint), balance: F.round2(balance) });
  };
  // Dime live TB: items carry type:'debit'|'credit' (the side) and category (the account type)
  if (j && !Array.isArray(j) && Array.isArray(j.categories)) { for (const c of j.categories) for (const li of c.lineItems || []) for (const it of li.items || []) push({ ...it, type: undefined, drcr: it.type, category: it.category || c.category }, c.category); return out; }
  for (const r of F.rowsFrom(file)) push(r, null);
  return out;
}

/** Flatten a schedules input to [{accountId, accountName, type, inactive, why}]. */
function scheduleRows(file, asOf) {
  const out = []; const j = file.json;
  const staleBefore = F.addMonths(asOf.slice(0, 7), -2) + '-01'; // period end more than ~2 months before asOf is stale
  const add = (r, type) => {
    const t = F.normKey(r.type || r.kind || r.scheduleType || type);
    const typ = SUPPORT_TYPES.find((x) => F.normKey(x) === t) || DICT_KEYS[r.type || type] || 'external';
    const end = F.ymd(F.pick(r, ['endDate', 'periodEnd', 'period_end', 'asOf', 'statementDate', 'updatedAt', 'lastActivity']));
    const status = F.str(r.status).toLowerCase(); const itemCount = Array.isArray(r.items) ? r.items.length : r.itemCount != null ? Number(r.itemCount) : r.count != null ? Number(r.count) : null;
    let why = null;
    if (r.active === false || /^(draft|not[ _-]?started|inactive|archived|abandoned)$/.test(status)) why = `status ${status || 'inactive'}`;
    else if (itemCount === 0) why = 'no items';
    else if (end && end < staleBefore) why = `last period ends ${end}`;
    out.push({ accountId: F.str(r.accountId ?? r.account_id ?? r.coaId ?? r.coa_id ?? r.assignedCOA ?? r.glAccountId) || null, accountName: F.str(r.accountName ?? r.account_name ?? r.account ?? r.coaName ?? r.glAccount ?? r.name) || null, type: typ, inactive: Boolean(why), why, id: F.str(r.id ?? r._id) || null });
  };
  if (j && !Array.isArray(j) && Object.keys(j).some((k) => DICT_KEYS[k] && j[k] && Array.isArray(j[k].list || j[k]))) {
    for (const k of Object.keys(j).sort()) { if (!DICT_KEYS[k]) continue; const list = Array.isArray(j[k]) ? j[k] : j[k].list || []; for (const r of list) add(r, DICT_KEYS[k]); }
    return out;
  }
  for (const r of F.rowsFrom(file)) add(r, r.type);
  return out;
}

module.exports = {
  name: 'coverage_crosswalk',
  describe: 'Crosswalks balance-sheet accounts on a trial balance to the schedules/reconciliations that support them; lists uncovered accounts with the support type expected from the account name (cash→bank_recon, prepaid→prepaid, fixed asset→fixed_asset, notes/loans→debt, lease→lease, accrued→accrual, deferred revenue→revrec, else external).',
  inputs: [
    { name: 'trialBalance', shape: "Dime trial-balance-asof {categories:[{category, lineItems:[{items:[{entryName, coaCode, category, type:'debit'|'credit', amount}]}]}]} or flat rows/CSV with account|accountName|entryName, code|coaCode|accountNumber?, type|category|accountType, and balance (or debit/credit, or amount + type debit|credit)." },
    { name: 'schedules', shape: "Dime workPapers dictionary {bankRecon:{list:[{id,name,startDate,endDate,status}]}, fixedAssets:{list}, prepaids:{list}, accruals:{list}, …} or an array of {accountId?, accountName?, type:'bank_recon'|'prepaid'|'fixed_asset'|'debt'|'lease'|'accrual'|'revrec'|'external', status?, endDate?, items?|itemCount?}. A schedule covers an account when accountId equals the account code/id or the normalised names match (equal, or one contains the other)." },
  ],
  args: { asOf: '(required) YYYY-MM-DD', excludeTypes: EXCLUDE_DEFAULT, minBalance: 0 },
  output: "{ uncovered:[{account, code, balance, type, expectedSupport, reason:'no schedule'|'schedule found but no activity', schedule?}], covered:[{account, code, balance, support, schedule}], totals:{accounts, considered, covered, uncovered, excludedByType, belowMin, zeroBalance, uncoveredBalance} }",
  run({ files, args = {} }) {
    const asOf = F.requireYMD(args, 'asOf');
    const excl = new Set((args.excludeTypes || EXCLUDE_DEFAULT).map(typeKey)); const minBalance = Math.abs(Number(args.minBalance ?? 0));
    const tb = tbRows(files[0]); const schedules = files[1] ? scheduleRows(files[1], asOf) : [];
    if (!tb.length) throw new Error('trialBalance input has no account rows I can read (need account name and balance or debit/credit)');
    const totals = { accounts: tb.length, considered: 0, covered: 0, uncovered: 0, excludedByType: 0, belowMin: 0, zeroBalance: 0, uncoveredBalance: 0, schedules: schedules.length };
    const covered = []; const uncovered = [];
    const findSchedules = (acct) => {
      const nk = F.normKey(acct.account);
      return schedules.filter((s) => (s.accountId && acct.code && s.accountId === acct.code) || (s.accountName && (F.normKey(s.accountName) === nk || (nk.length >= 4 && F.normKey(s.accountName).includes(nk)) || (F.normKey(s.accountName).length >= 4 && nk.includes(F.normKey(s.accountName))))));
    };
    for (const acct of tb.sort(F.by((a) => a.code || '', (a) => a.account))) {
      const tk = typeKey(acct.type);
      if (excl.has(tk) || [...excl].some((e) => e && tk && (tk.startsWith(e) || e.startsWith(tk)) && Math.min(e.length, tk.length) >= 5)) { totals.excludedByType += 1; continue; }
      if (acct.balance === 0) { totals.zeroBalance += 1; continue; }
      if (Math.abs(acct.balance) < minBalance) { totals.belowMin += 1; continue; }
      totals.considered += 1;
      const exp = expectedSupport(acct.account, acct.type);
      const hits = findSchedules(acct).sort(F.by((s) => (s.type === exp ? 0 : 1), (s) => s.inactive ? 1 : 0, (s) => s.id || '', (s) => s.accountName || ''));
      const live = hits.find((s) => !s.inactive);
      if (live) { totals.covered += 1; covered.push({ account: acct.account, code: acct.code, balance: acct.balance, type: acct.type, support: live.type, schedule: live.id || live.accountName }); continue; }
      totals.uncovered += 1; totals.uncoveredBalance = F.round2(totals.uncoveredBalance + Math.abs(acct.balance));
      const row = { account: acct.account, code: acct.code, balance: acct.balance, type: acct.type, expectedSupport: exp, reason: hits.length ? 'schedule found but no activity' : 'no schedule' };
      if (hits.length) row.schedule = { id: hits[0].id || hits[0].accountName, type: hits[0].type, why: hits[0].why };
      uncovered.push(row);
    }
    uncovered.sort(F.by((u) => -Math.abs(u.balance), (u) => u.code || '', (u) => u.account));
    covered.sort(F.by((c) => c.code || '', (c) => c.account));
    return { asOf, uncovered, covered, totals, excludeTypes: [...excl].sort(), minBalance };
  },
};
