'use strict';
// gl_hygiene — mechanical checks over journal/GL lines: blank or placeholder
// descriptions, wrong-sign account balances, round-number entries, weekend
// postings, entries by users who rarely post. Pure.
const F = require('./_fields');

const PLACEHOLDERS = new Set(['', 'tbd', 'tba', 'test', 'testing', 'misc', 'miscellaneous', 'n/a', 'na', 'none', 'null', 'x', 'xx', 'xxx', 'asdf', 'temp', 'placeholder', 'je', 'entry', 'journal entry', 'journal', 'adjustment', 'adj', '.', '-', '--', '?', 'tbd.', 'see memo', 'various', 'other']);
const DEBIT_NORMAL = /asset|bank|cash|expense|cogs|cost of goods|cost of sales|receivable|inventory|prepaid|fixed|depreciation expense|other current asset|accounts receivable/;
const CREDIT_NORMAL = /liabilit|equity|revenue|income|sales|payable|credit card|accumulated depreciation|deferred|accrued|retained|capital|loan|note payable/;
function normalSide(type, account) {
  const t = String(type || '').toLowerCase(); const a = String(account || '').toLowerCase();
  if (/accumulated depreciation|allowance for|contra/.test(a)) return 'credit';
  if (CREDIT_NORMAL.test(t)) return 'credit'; if (DEBIT_NORMAL.test(t)) return 'debit';
  if (CREDIT_NORMAL.test(a)) return 'credit'; if (DEBIT_NORMAL.test(a)) return 'debit';
  return null;
}

module.exports = {
  name: 'gl_hygiene',
  describe: 'GL hygiene checks on journal lines: blank/placeholder descriptions, accounts whose net balance sits on the wrong side for their type, round-number entries at or above a threshold, weekend postings, and postings by users with very few entries in the period.',
  inputs: [{ name: 'lines', shape: 'Dime V2 transaction search (type accounting) {rows:[{_id, date, name|description, accounting_category, accounting_accounts, amount, glType, createdBy?, journal_id?}]} or any rows/CSV with id, date, description|memo|name, account|accountName|accounting_category, type|accountType|accounting_accounts (Asset|Liability|Equity|Revenue|Income|Expense…), debit/credit or amount(+glType or signed), optional createdBy|user|postedBy.' }],
  args: { period: "optional 'YYYY-MM' | 'YYYY' | 'YYYY-MM-DD..YYYY-MM-DD' | {start,end}", roundThreshold: 1000, roundModulus: 100, rareUserMax: 2, checks: ['blank_description', 'wrong_sign', 'round_number', 'weekend_posting', 'rare_user'] },
  output: '{ findings:[{check, account?, id?, amount?, date?, user?, why}], counts:{check→n}, scanned, outOfPeriod, unparsed, accountsWithUnknownType }',
  run({ files, args = {} }) {
    const period = F.periodOf(args.period); const roundThreshold = Number(args.roundThreshold ?? 1000); const modulus = Number(args.roundModulus ?? 100); const rareMax = Number(args.rareUserMax ?? 2);
    const checks = new Set(args.checks || ['blank_description', 'wrong_sign', 'round_number', 'weekend_posting', 'rare_user']);
    const findings = []; const accounts = new Map(); const users = new Map(); let scanned = 0; let out = 0; let unparsed = 0; let seq = 0;
    for (const r of F.rowsFrom(files[0])) {
      const date = F.ymd(F.pick(r, 'date')); const s = F.sides(r);
      if (!date || !s) { unparsed += 1; continue; }
      scanned += 1; if (!F.inPeriod(date, period)) { out += 1; continue; }
      seq += 1;
      const id = F.str(F.pick(r, 'id')) || `row-${seq}`; const account = F.str(F.pick(r, ['account', 'accountName', 'account_name', 'accounting_category', 'glAccount', 'gl_account', 'coa'])) || '(no account)'; const type = F.str(F.pick(r, ['accountType', 'account_type', 'accounting_accounts', 'type']));
      const desc = F.str(F.pick(r, ['description', 'memo', 'narration', 'name', 'details'])); const amount = F.abs2(s.debit || s.credit); const user = F.str(F.pick(r, 'createdBy'));
      if (checks.has('blank_description') && PLACEHOLDERS.has(desc.toLowerCase().replace(/\s+/g, ' ').trim())) findings.push({ check: 'blank_description', account, id, amount, date, why: desc ? `placeholder description "${desc}"` : 'blank description' });
      if (checks.has('round_number') && amount >= roundThreshold && modulus > 0 && Number.isInteger(amount) && amount % modulus === 0) findings.push({ check: 'round_number', account, id, amount, date, why: `${amount.toFixed(2)} is a whole multiple of ${modulus} at or above ${roundThreshold}` });
      if (checks.has('weekend_posting') && F.isWeekend(date)) findings.push({ check: 'weekend_posting', account, id, amount, date, why: `${date} is a ${new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ? 'Sunday' : 'Saturday'}` });
      const ak = F.normKey(account); if (!accounts.has(ak)) accounts.set(ak, { account, type, debit: 0, credit: 0 }); const a = accounts.get(ak); a.debit = F.round2(a.debit + s.debit); a.credit = F.round2(a.credit + s.credit); if (!a.type && type) a.type = type;
      if (user) { if (!users.has(user)) users.set(user, []); users.get(user).push(id); }
    }
    let unknownType = 0;
    if (checks.has('wrong_sign')) for (const ak of [...accounts.keys()].sort()) {
      const a = accounts.get(ak); const side = normalSide(a.type, a.account); const net = F.round2(a.debit - a.credit);
      if (!side) { unknownType += 1; continue; }
      if ((side === 'debit' && net < 0) || (side === 'credit' && net > 0)) findings.push({ check: 'wrong_sign', account: a.account, amount: Math.abs(net), why: `${a.type || 'account'} "${a.account}" is ${side}-normal but nets ${net < 0 ? 'credit' : 'debit'} ${Math.abs(net).toFixed(2)} (debits ${a.debit.toFixed(2)}, credits ${a.credit.toFixed(2)})` });
    }
    if (checks.has('rare_user')) for (const u of [...users.keys()].sort()) { const ids = users.get(u); if (ids.length <= rareMax) findings.push({ check: 'rare_user', user: u, ids: [...ids].sort(), why: `${u} posted ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} in the period (≤ ${rareMax})` }); }
    findings.sort(F.by((f) => f.check, (f) => f.account || '', (f) => f.date || '', (f) => f.id || '', (f) => f.user || ''));
    const counts = {}; for (const c of [...checks].sort()) counts[c] = 0; for (const f of findings) counts[f.check] = (counts[f.check] || 0) + 1;
    return { findings, counts, scanned, outOfPeriod: out, unparsed, accountsWithUnknownType: unknownType, period, roundThreshold, roundModulus: modulus, rareUserMax: rareMax };
  },
};
