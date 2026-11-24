'use strict';
// Table helpers shared by the compute verbs (underscore prefix: not a verb).
// Turns a loaded input (json | rows | sheets) into plain records and reads a
// field by any of several header spellings, so a verb accepts "Opening",
// "opening_balance" or "Opening Balance" alike. Deterministic: no clock, no I/O.

/** Header normaliser: 'Opening Balance ($)' → 'openingbalance'. */
function norm(h) { return String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

/** Rows (header first) → objects keyed by the header text as written. Empty header cells become `col<N>`. */
function rowsToRecords(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const header = rows[0].map((h, i) => { const s = String(h ?? '').trim(); return s || `col${i + 1}`; });
  const out = [];
  for (const r of rows.slice(1)) {
    if (!Array.isArray(r) || !r.some((c) => c != null && String(c).trim() !== '')) continue;
    const o = {}; header.forEach((h, i) => { o[h] = r[i] ?? null; }); out.push(o);
  }
  return out;
}

/** A loaded file (from src/compute/index.js) or a raw array → array of records. `sheet` picks an xlsx sheet by name. */
function records(file, { sheet = null } = {}) {
  if (!file) return [];
  if (Array.isArray(file)) return file.length && Array.isArray(file[0]) ? rowsToRecords(file) : file.filter((x) => x && typeof x === 'object');
  if (file.json !== undefined) {
    const j = file.json;
    if (Array.isArray(j)) return j.length && Array.isArray(j[0]) ? rowsToRecords(j) : j.filter((x) => x && typeof x === 'object');
    if (j && typeof j === 'object') { for (const k of ['rows', 'data', 'items', 'records', 'results', 'lines']) if (Array.isArray(j[k])) return records({ json: j[k] }); return [j]; }
    return [];
  }
  if (file.sheets && sheet) { const sh = file.sheets.find((s) => norm(s.name) === norm(sheet)); return sh ? rowsToRecords(sh.rows) : []; }
  if (file.rows) return rowsToRecords(file.rows);
  if (file.sheets && file.sheets[0]) return rowsToRecords(file.sheets[0].rows);
  return [];
}

/** Which key of `rec` matches one of the alias spellings (exact normalised match first, then prefix match). */
function keyFor(rec, aliases) {
  const keys = Object.keys(rec); const want = aliases.map(norm);
  for (const w of want) { const k = keys.find((x) => norm(x) === w); if (k) return k; }
  for (const w of want) { const k = keys.find((x) => norm(x).startsWith(w) && norm(x).length - w.length <= 12); if (k) return k; }
  return null;
}

/** Value of the first alias present on the record (null when none). */
function field(rec, aliases) { const k = keyFor(rec, aliases); return k == null ? null : rec[k]; }

/** All keys of a record that match any of the alias spellings (for summing several columns, e.g. Additions + Transfers in). */
function keysMatching(rec, aliases) {
  const want = aliases.map(norm);
  return Object.keys(rec).filter((k) => { const n = norm(k); return want.some((w) => n === w || (n.startsWith(w) && n.length - w.length <= 12)); });
}

/** Trimmed string or ''. */
function str(v) { return v == null ? '' : String(v).trim(); }

/** Stable comparison on strings/numbers, used by every sort so output order never depends on input order. */
function cmp(a, b) { if (a === b) return 0; if (a == null) return 1; if (b == null) return -1; if (typeof a === 'number' && typeof b === 'number') return a - b; return String(a) < String(b) ? -1 : 1; }
function by(...fns) { return (x, y) => { for (const f of fns) { const c = cmp(f(x), f(y)); if (c) return c; } return 0; }; }

module.exports = { norm, rowsToRecords, records, keyFor, field, keysMatching, str, cmp, by };
