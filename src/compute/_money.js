'use strict';
// Money helpers shared by the compute verbs (underscore prefix: not a verb).
// Every verb rounds to cents through here so results are reproducible and
// money sums never drift: sums are accumulated in integer cents.

/** Parse "1,234.56", "(1,234.56)", "$-12.00", "12.5-", "USD 3.00", numbers. null when it is not a money value. */
function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^(USD|EUR|GBP|CAD|AUD)\s*/i, '').replace(/\s*(USD|EUR|GBP|CAD|AUD)$/i, '');
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  if (/[-−]$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }
  s = s.replace(/^[$€£]\s*/, '');
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/,/g, '').replace(/\s+/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Integer cents of a number (half away from zero). */
function cents(x) {
  const n = Number(x) || 0;
  const r = Math.round(Math.abs(n) * 100 + 1e-9);
  return n < 0 ? -r : r;
}

/** Round to cents; -0 becomes 0. */
function round2(x) { const r = cents(x) / 100; return r === 0 ? 0 : r; }

/** Round to `places` decimals (default 2). */
function roundTo(x, places = 2) {
  const f = 10 ** places; const n = Number(x) || 0;
  const r = Math.round(Math.abs(n) * f + 1e-9) / f;
  const out = n < 0 ? -r : r; return out === 0 ? 0 : out;
}

/** Sum of numbers (or of fn(item)) to the cent, accumulated in integer cents. */
function sum(items, fn = null) {
  let c = 0;
  for (const it of items || []) { const v = fn ? fn(it) : it; if (v == null) continue; c += cents(v); }
  const r = c / 100; return r === 0 ? 0 : r;
}

/** |a - b| < half a cent. */
function eq(a, b, tol = 0.005) { return Math.abs((Number(a) || 0) - (Number(b) || 0)) < tol; }

module.exports = { parseMoney, cents, round2, roundTo, sum, eq };
