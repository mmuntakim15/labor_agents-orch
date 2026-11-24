'use strict';
// coding_consistency — vendors coded to more than one GL account (optionally
// per department) in the period, with the dominant account named. Pure.
const F = require('./_fields');

module.exports = {
  name: 'coding_consistency',
  describe: 'Vendors whose transactions were coded to more than one account in the period (optionally split by department), with counts, totals and the dominant account; allowedSplits whitelists known legitimate splits.',
  inputs: [{ name: 'transactions', shape: 'Dime V2 transaction search {rows:[{_id, date, merchant_name|name, accounting_category, amount, department?}]} or bills with line_items, or any rows/CSV with vendor|vendorName|merchant_name|payee, account|accountName|accounting_category|category, optional department|class, optional amount, optional date.' }],
  args: { period: "optional 'YYYY-MM' | 'YYYY' | 'YYYY-MM-DD..YYYY-MM-DD' | {start,end}", allowedSplits: { 'Vendor name': ['Account A', 'Account B'] }, minCount: 2, byDepartment: false },
  output: '{ exceptions:[{vendor, accounts:[{account, department?, count, total}], dominant, why}], vendorsChecked, rowsScanned, rowsOutOfPeriod, rowsUnparsed }',
  run({ files, args = {} }) {
    const period = F.periodOf(args.period); const minCount = Number(args.minCount ?? 2); const byDept = Boolean(args.byDepartment);
    const allowed = new Map(); for (const [v, accts] of Object.entries(args.allowedSplits || {})) allowed.set(F.normVendor(v), new Set((accts || []).map(F.normKey)));
    const vendors = new Map(); let scanned = 0; let out = 0; let unparsed = 0;
    const add = (vendorName, account, department, amount, date) => {
      const vk = F.normVendor(vendorName); const ak = F.normKey(account); if (!vk || !ak) { unparsed += 1; return; }
      scanned += 1; if (date && !F.inPeriod(date, period)) { out += 1; return; }
      if (!vendors.has(vk)) vendors.set(vk, { vendor: F.str(vendorName), cells: new Map(), count: 0 });
      const v = vendors.get(vk); v.count += 1;
      const ck = byDept ? `${ak}||${F.normKey(department)}` : ak;
      if (!v.cells.has(ck)) v.cells.set(ck, { account: F.str(account), department: byDept ? F.str(department) || null : undefined, count: 0, total: 0 });
      const c = v.cells.get(ck); c.count += 1; c.total = F.round2(c.total + Math.abs(amount || 0));
    };
    for (const r of F.rowsFrom(files[0])) {
      const vendor = F.pick(r, 'vendor'); const date = F.ymd(F.pick(r, 'date'));
      if (Array.isArray(r.line_items) && r.line_items.length) { for (const li of r.line_items) add(vendor, F.pick(li, ['gl_account', 'category', 'account', 'accounting_category']), F.pick(li, 'department'), F.num(F.pick(li, ['total_with_tax', 'amount_ex_tax', 'amount', 'total'])), date); continue; }
      add(vendor, F.pick(r, ['account', 'accountName', 'account_name', 'accounting_category', 'glAccount', 'gl_account', 'category', 'coa']), F.pick(r, 'department'), F.num(F.pick(r, 'amount')), date);
    }
    const exceptions = [];
    for (const vk of [...vendors.keys()].sort()) {
      const v = vendors.get(vk); if (v.count < minCount) continue;
      const accounts = [...v.cells.values()].map((c) => { const o = { account: c.account, count: c.count, total: c.total }; if (byDept) o.department = c.department; return o; });
      const distinct = new Set(accounts.map((a) => F.normKey(a.account))); if (distinct.size < 2) continue;
      const ok = allowed.get(vk); if (ok && [...distinct].every((a) => ok.has(a))) continue;
      accounts.sort(F.by((a) => -a.count, (a) => -a.total, (a) => a.account, (a) => a.department || ''));
      const dom = accounts[0]; const others = accounts.slice(1);
      const why = `${dom.count} of ${v.count} postings go to "${dom.account}"${byDept && dom.department ? ` (${dom.department})` : ''}; also coded to ${others.map((o) => `"${o.account}"${byDept && o.department ? ` (${o.department})` : ''} ×${o.count}`).join(', ')}`;
      exceptions.push({ vendor: v.vendor, accounts, dominant: dom.account, why });
    }
    exceptions.sort(F.by((e) => -e.accounts.length, (e) => F.normVendor(e.vendor)));
    return { exceptions, vendorsChecked: vendors.size, rowsScanned: scanned, rowsOutOfPeriod: out, rowsUnparsed: unparsed, period, minCount, byDepartment: byDept };
  },
};
