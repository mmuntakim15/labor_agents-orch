'use strict';
// remittance_parse — invoice numbers and amounts out of a remittance advice (text, email body or CSV), each cited to its line.
const M = require('./_money');
const Tb = require('./_table');

const DEFAULT_INVOICE = { source: '\\bINV[-\\s]?\\d{3,}\\b', flags: 'i' };
// an amount needs cents or a currency symbol so bare integers (invoice numbers, quantities) are not read as money
const AMOUNT = /\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?-?|\(?-?\$\s?\d+(?:,\d{3})*(?:\.\d{1,2})?\)?/g;
const TOTAL_LINE = /\b(total|subtotal|sub-total|amount paid|payment amount|check amount|cheque amount|grand total|total remitted|total paid|remittance total)\b/i;
const PAYER_LINE = /^\s*(?:from|remitter|remitted by|payer|payor|payee|customer|sender)\s*[:\-]\s*(.+)$/i;

function invoiceRegex(arg) {
  if (!arg) return new RegExp(DEFAULT_INVOICE.source, DEFAULT_INVOICE.flags + 'g');
  if (typeof arg === 'string') { const m = /^\/(.+)\/([a-z]*)$/.exec(arg); return m ? new RegExp(m[1], m[2].replace('g', '') + 'g') : new RegExp(arg, 'ig'); }
  if (arg.source) return new RegExp(arg.source, String(arg.flags || 'i').replace('g', '') + 'g');
  throw new Error('remittance_parse: args.invoicePattern must be a regex source string');
}

function parseLine(text, lineNo, re) {
  const invoices = []; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) { invoices.push({ value: m[0].toUpperCase().replace(/\s+/g, '-'), start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex += 1; }
  const amounts = [];
  AMOUNT.lastIndex = 0;
  while ((m = AMOUNT.exec(text))) {
    const s = m.index; const e = s + m[0].length;
    if (invoices.some((inv) => s < inv.end && e > inv.start)) continue;
    const v = M.parseMoney(m[0]); if (v != null) amounts.push({ value: M.round2(v), start: s });
  }
  return { invoices, amounts };
}

function linesOf(file) {
  if (!file) return [];
  if (file.text != null) return file.text.split(/\r?\n/);
  if (file.json !== undefined) {
    const j = file.json;
    if (typeof j === 'string') return j.split(/\r?\n/);
    if (j && typeof j === 'object' && typeof (j.text || j.body) === 'string') return String(j.text || j.body).split(/\r?\n/);
    if (Array.isArray(j)) return j.map((x) => (typeof x === 'string' ? x : Object.values(x || {}).map((v) => (v == null ? '' : String(v))).join(' | ')));
    return [];
  }
  if (file.rows) return file.rows.map((r) => r.map((v) => (v == null ? '' : String(v))).join(' | '));
  return [];
}

module.exports = {
  name: 'remittance_parse',
  describe: 'Deterministically pulls invoice numbers and amounts out of a remittance advice (plain text, email body, JSON { text } or CSV rows): a line with one invoice and one amount is a pair, N invoices with N amounts pair in order, lines with an amount and no invoice are reported unparsed, a line with "total"/"amount paid" is read as the stated total. Each pair cites its source line. The reconciliation against open invoices is the agent\'s job, not this verb\'s. Pure.',
  inputs: [{ name: 'remittance', shape: 'text (.txt/.eml/.md), json { text|body } or CSV rows' }],
  args: { invoicePattern: "regex source for invoice numbers (default '\\bINV[-\\s]?\\d{3,}\\b', case-insensitive)", currency: 'USD' },
  output: '{ pairs: [{ invoice, amount, line, lineNo }], total, statedTotal, totalMatchesStated, unparsed: [{ line, lineNo, amounts }], invoicesWithoutAmount: [{ invoice, line, lineNo }], payer, currency, lineCount }',
  run({ files, args = {} }) {
    const re = invoiceRegex(args.invoicePattern);
    const lines = linesOf(files[0]);
    const pairs = []; const unparsed = []; const invoicesWithoutAmount = []; let payer = null; let statedTotal = null;
    lines.forEach((raw, i) => {
      const line = raw.replace(/\s+$/, ''); const lineNo = i + 1; if (!line.trim()) return;
      if (payer == null) { const pm = PAYER_LINE.exec(line); if (pm) { payer = pm[1].trim(); return; } }
      const { invoices, amounts } = parseLine(line, lineNo, re);
      if (!invoices.length && amounts.length && TOTAL_LINE.test(line)) { statedTotal = amounts[amounts.length - 1].value; return; }
      if (invoices.length && amounts.length && (amounts.length === invoices.length || invoices.length === 1)) {
        if (invoices.length === 1) pairs.push({ invoice: invoices[0].value, amount: amounts[amounts.length - 1].value, line: line.trim(), lineNo });
        else invoices.forEach((inv, k) => pairs.push({ invoice: inv.value, amount: amounts[k].value, line: line.trim(), lineNo }));
        return;
      }
      if (invoices.length) { invoices.forEach((inv) => invoicesWithoutAmount.push({ invoice: inv.value, line: line.trim(), lineNo, amounts: amounts.map((a) => a.value) })); return; }
      if (amounts.length) unparsed.push({ line: line.trim(), lineNo, amounts: amounts.map((a) => a.value) });
    });
    const total = M.sum(pairs, (p) => p.amount);
    const dupes = [...new Set(pairs.map((p) => p.invoice).filter((v, k, a) => a.indexOf(v) !== k))].sort();
    return { pairs, total, statedTotal, totalMatchesStated: statedTotal == null ? null : M.eq(total, statedTotal), unparsed, invoicesWithoutAmount, duplicateInvoices: dupes, payer, currency: String(args.currency || 'USD'), lineCount: lines.length, invoicePattern: re.source };
  },
};
