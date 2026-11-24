'use strict';
// rollforward — prove a schedule rolls: opening + additions - reductions = closing, per row and in total.
const M = require('./_money');
const Tb = require('./_table');

const ALIASES = {
  key: ['key', 'account', 'asset', 'assetid', 'id', 'name', 'description', 'item', 'contract', 'loan', 'lease', 'customer', 'vendor', 'line'],
  opening: ['opening', 'openingbalance', 'beginning', 'beginningbalance', 'open', 'start', 'startingbalance', 'priorclosing', 'bf', 'broughtforward'],
  additions: ['additions', 'increases', 'adds', 'acquisitions', 'purchases', 'advances', 'accruals', 'transfersin', 'drawdowns', 'newleases', 'charges', 'debits'],
  reductions: ['reductions', 'decreases', 'amortisation', 'amortization', 'depreciation', 'disposals', 'releases', 'payments', 'repayments', 'transfersout', 'writeoffs', 'utilised', 'utilized', 'credits', 'reversals'],
  closing: ['closing', 'closingbalance', 'ending', 'endingbalance', 'end', 'close', 'cf', 'carriedforward', 'balance'],
};

function columnsFor(rec, args) {
  const cols = args.columns || {};
  const one = (group) => (cols[group] ? (Tb.keyFor(rec, [cols[group]]) ? [Tb.keyFor(rec, [cols[group]])] : []) : null);
  return {
    key: one('key') || (Tb.keyFor(rec, ALIASES.key) ? [Tb.keyFor(rec, ALIASES.key)] : []),
    opening: one('opening') || (Tb.keyFor(rec, ALIASES.opening) ? [Tb.keyFor(rec, ALIASES.opening)] : []),
    additions: one('additions') || Tb.keysMatching(rec, ALIASES.additions),
    reductions: one('reductions') || Tb.keysMatching(rec, ALIASES.reductions),
    closing: one('closing') || (Tb.keyFor(rec, ALIASES.closing) ? [Tb.keyFor(rec, ALIASES.closing)] : []),
  };
}

module.exports = {
  name: 'rollforward',
  describe: 'Checks a schedule rolls forward: opening + additions - reductions = closing for every row and in total. Header aliases are accepted (Opening/Beginning, Additions/Increases, Reductions/Decreases/Amortisation/Depreciation/Disposals, Closing/Ending); several addition or reduction columns are summed. Rows whose key starts with "Total" are ignored and reported. Reductions entered as negatives are detected (all non-zero reductions <= 0) and treated as signed. Pure.',
  inputs: [{ name: 'schedule', shape: 'rows (header first) or json array: key/account, Opening, Additions|Increases, Reductions|Decreases|Amortisation|Depreciation, Closing' }],
  args: { columns: '{ key, opening, additions, reductions, closing } header overrides (optional)', expectedClosingTotal: 'GL figure to compare the closing total against (optional)', reductionsSign: "'auto' (default) | 'positive' (subtract) | 'negative' (already signed, add)", tolerance: 0.005 },
  output: '{ rows: [{ key, opening, additions, reductions, computedClosing, closing, difference }], totals, breaks: [{ key, difference }], ties, ignoredTotalRows, columns, reductionsTreatedAs, glComparison? }',
  run({ files, args = {} }) {
    const recs = Tb.records(files[0]);
    if (!recs.length) throw new Error('rollforward: schedule has no rows');
    const cols = columnsFor(recs[0], args);
    for (const g of ['opening', 'closing']) if (!cols[g].length) throw new Error(`rollforward: no ${g} column found (headers: ${Object.keys(recs[0]).join(', ')}); pass args.columns.${g}`);
    const tol = Number(args.tolerance ?? 0.005);
    const ignoredTotalRows = [];
    const raw = [];
    recs.forEach((r, i) => {
      const key = cols.key.length ? Tb.str(r[cols.key[0]]) || `row ${i + 2}` : `row ${i + 2}`;
      if (/^(grand\s+)?totals?\b/i.test(key)) { ignoredTotalRows.push(key); return; }
      const opening = M.round2(M.parseMoney(r[cols.opening[0]]) || 0);
      const additions = M.sum(cols.additions, (c) => M.parseMoney(r[c]));
      const reductionsRaw = M.sum(cols.reductions, (c) => M.parseMoney(r[c]));
      const closing = M.round2(M.parseMoney(r[cols.closing[0]]) || 0);
      raw.push({ key, opening, additions, reductionsRaw, closing });
    });
    let sign = String(args.reductionsSign || 'auto');
    if (sign === 'auto') sign = raw.some((r) => r.reductionsRaw !== 0) && raw.every((r) => r.reductionsRaw <= 0) ? 'negative' : 'positive';
    const rows = raw.map((r) => {
      const reductions = sign === 'negative' ? M.round2(-r.reductionsRaw) : r.reductionsRaw;
      const computedClosing = M.round2(r.opening + r.additions - reductions);
      const difference = M.round2(r.closing - computedClosing);
      return { key: r.key, opening: r.opening, additions: r.additions, reductions, computedClosing, closing: r.closing, difference };
    });
    const totals = { opening: M.sum(rows, (r) => r.opening), additions: M.sum(rows, (r) => r.additions), reductions: M.sum(rows, (r) => r.reductions), computedClosing: M.sum(rows, (r) => r.computedClosing), closing: M.sum(rows, (r) => r.closing) };
    totals.difference = M.round2(totals.closing - totals.computedClosing);
    const breaks = rows.filter((r) => Math.abs(r.difference) >= tol).map((r) => ({ key: r.key, difference: r.difference })).sort(Tb.by((b) => -Math.abs(b.difference), (b) => b.key));
    const out = { rows, totals, breaks, ties: breaks.length === 0, rowCount: rows.length, ignoredTotalRows, columns: { key: cols.key[0] || null, opening: cols.opening[0], additions: cols.additions, reductions: cols.reductions, closing: cols.closing[0] }, reductionsTreatedAs: sign === 'negative' ? 'signed (negative) values, added' : 'positive values, subtracted' };
    if (args.expectedClosingTotal != null) {
      const gl = M.round2(M.parseMoney(args.expectedClosingTotal));
      out.glComparison = { expectedClosingTotal: gl, scheduleClosing: totals.closing, difference: M.round2(totals.closing - gl), ties: Math.abs(totals.closing - gl) < tol };
      out.ties = out.ties && out.glComparison.ties;
    }
    return out;
  },
};
