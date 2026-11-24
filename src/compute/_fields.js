'use strict';
// Shared field helpers for the compute verbs (not a verb: underscore file).
// Everything here is pure and deterministic: no clock, no randomness, no I/O.
//
// Dime payloads the verbs consume differ in envelope and field names
// (bills: amount_total/issue_date/vendor_name; bank rows: amount/date/
// merchant_name; GL register: debit/credit/reference/description; vendor
// spend: vendorName/monthlySpend). `rowsFrom` unwraps the envelope and
// `pick` reads the first alias present, so a verb documents its shape as a
// list of accepted aliases instead of guessing one.

// ---------------------------------------------------------------- aliases
const ALIASES = {
  id: ['id', '_id', 'transaction_id', 'transactionId', 'billId', 'bill_id', 'journal_id', 'journalId', 'ref', 'line_id'],
  amount: ['amount', 'total', 'totalAmount', 'total_amount', 'amount_total', 'amountTotal', 'value'],
  date: ['date', 'txn_date', 'transactionDate', 'transaction_date', 'bill_date', 'issue_date', 'issueDate', 'posted_at', 'postedAt', 'posting_date', 'postingDate', 'created', 'createdAt'],
  vendor: ['vendor', 'vendorName', 'vendor_name', 'merchant', 'merchant_name', 'merchantName', 'payee', 'name', 'counterparty'],
  description: ['description', 'memo', 'narration', 'name', 'details', 'note', 'notes'],
  reference: ['reference', 'ref', 'invoice_number', 'invoiceNumber', 'journal_id', 'journalId', 'check_number', 'checkNumber', 'document_number'],
  account: ['account', 'accountName', 'account_name', 'accounting_category', 'glAccount', 'gl_account', 'category', 'coa', 'entryName'],
  accountCode: ['accountCode', 'account_code', 'code', 'coaCode', 'accountNumber', 'account_number', 'number'],
  accountType: ['accountType', 'account_type', 'type', 'accounting_accounts', 'category', 'class'],
  department: ['department', 'dept', 'class', 'location'],
  debit: ['debit', 'dr', 'debitAmount', 'debit_amount'],
  credit: ['credit', 'cr', 'creditAmount', 'credit_amount'],
  balance: ['balance', 'endingBalance', 'ending_balance', 'netBalance', 'net'],
  createdBy: ['createdBy', 'created_by', 'user', 'userName', 'postedBy', 'posted_by', 'enteredBy', 'author', 'createdByName'],
  glType: ['glType', 'gl_type', 'side', 'drcr'],
  month: ['month', 'period', 'ym'],
};

// Envelope keys that hold the list in Dime responses and in hand-made files.
const LIST_KEYS = ['rows', 'data', 'items', 'results', 'list', 'entries', 'transactions', 'bills', 'lines', 'records', 'logs', 'events', 'vendors', 'vendorRows', 'accounts', 'connections', 'schedules'];

// ---------------------------------------------------------------- strings
const normKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

const LEGAL_SUFFIXES = new Set(['llc', 'l l c', 'inc', 'incorporated', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'llp', 'lp', 'plc', 'pllc', 'pc', 'gmbh', 'sa', 'ag', 'bv', 'pty', 'the']);

/** Vendor name key: lower-case, punctuation removed, legal suffixes and a leading "the" dropped. */
function normVendor(name) {
  const toks = String(name == null ? '' : name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (toks.length > 1 && LEGAL_SUFFIXES.has(toks[toks.length - 1])) toks.pop();
  while (toks.length > 1 && toks[0] === 'the') toks.shift();
  return toks.join(' ');
}

const str = (v) => (v == null ? '' : String(v).trim());

// ---------------------------------------------------------------- numbers
/** "$1,234.56" → 1234.56, "(12.50)" → -12.5, "1.234,56" is NOT handled (US formats only). */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim(); if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/[$,\s]/g, '').replace(/^[A-Z]{3}(?=[\d.-])/, '');
  if (s.toLowerCase() === 'cr') return null;
  if (!/^[+-]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s); if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const abs2 = (n) => round2(Math.abs(n));

// ---------------------------------------------------------------- dates (all UTC, all YYYY-MM-DD strings)
const pad2 = (n) => String(n).padStart(2, '0');
function ymdFromUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

/** Any date-ish value → 'YYYY-MM-DD' or null. Excel serials (25569..80000) are accepted. */
function ymd(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymdFromUTC(v);
  if (typeof v === 'number') { if (v > 25569 && v < 80000 && Number.isFinite(v)) return ymdFromUTC(new Date(Math.round((v - 25569) * 864e5))); return null; }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad2(m[1])}-${pad2(m[2])}`; }
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : ymdFromUTC(new Date(t));
}
function ymdToDays(y) { const [Y, M, D] = y.split('-').map(Number); return Math.round(Date.UTC(Y, M - 1, D) / 864e5); }
/** b − a in whole days (both 'YYYY-MM-DD'). */
function daysBetween(a, b) { return ymdToDays(b) - ymdToDays(a); }
function isWeekend(y) { const d = new Date(`${y}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6; }
function monthKey(y) { return y ? y.slice(0, 7) : null; }
function addMonths(ym, n) { const [Y, M] = ym.split('-').map(Number); const t = Y * 12 + (M - 1) + n; return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`; }
const isYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const isYMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** 'Jan' | 'January' | 'Jan 2026' | '2026-01' | '2026-01-15' → { month: 0-11, year: 2026|null }. */
function parseMonthLabel(v) {
  const s = str(v).toLowerCase(); if (!s) return null;
  if (isYM(s)) return { month: Number(s.slice(5, 7)) - 1, year: Number(s.slice(0, 4)) };
  const y = ymd(s); if (y && /^\d{4}-\d{2}-\d{2}/.test(s)) return { month: Number(y.slice(5, 7)) - 1, year: Number(y.slice(0, 4)) };
  const m = /^([a-z]{3,9})\.?(?:\s+'?(\d{2}|\d{4}))?$/.exec(s);
  if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3)); if (mi < 0) return null; const yr = m[2] == null ? null : (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])); return { month: mi, year: yr }; }
  const m2 = /^(\d{1,2})\/(\d{4})$/.exec(s); if (m2) return { month: Number(m2[1]) - 1, year: Number(m2[2]) };
  return null;
}

// ---------------------------------------------------------------- rows
/** Header row + data rows (arrays) → array of objects keyed by the trimmed header. */
function objectsFromRows(rows) {
  const all = (rows || []).filter((r) => Array.isArray(r) && r.some((c) => str(c) !== ''));
  if (!all.length) return [];
  const header = all[0].map((h) => str(h));
  return all.slice(1).map((r) => { const o = {}; header.forEach((h, i) => { if (h) o[h] = r[i] == null ? null : r[i]; }); return o; });
}

/** Unwrap a parsed input into an array of row objects. Accepts arrays, {rows|data|…: []}, {data:{rows:[]}}. */
function listFrom(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const k of LIST_KEYS) if (Array.isArray(json[k])) return json[k];
  for (const k of LIST_KEYS) if (json[k] && typeof json[k] === 'object') { const inner = listFrom(json[k]); if (inner.length) return inner; }
  return [];
}

/** Rows (objects) for a loaded input file whatever its format. */
function rowsFrom(file) {
  if (!file) return [];
  if (file.json !== undefined) return listFrom(file.json).filter((r) => r && typeof r === 'object');
  if (file.rows) return objectsFromRows(file.rows);
  if (file.text) { try { return listFrom(JSON.parse(file.text)); } catch { return []; } }
  return [];
}

/** First alias present on the row (exact key, then case/punctuation-insensitive key). */
function pick(row, aliases) {
  if (!row) return undefined;
  const list = Array.isArray(aliases) ? aliases : ALIASES[aliases] || [aliases];
  for (const a of list) if (row[a] !== undefined && row[a] !== null && row[a] !== '') return row[a];
  const keys = Object.keys(row); const byNorm = new Map(keys.map((k) => [normKey(k), k]));
  for (const a of list) { const k = byNorm.get(normKey(a)); if (k && row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]; }
  return undefined;
}

/** Debit/credit view of a row: { debit, credit } from debit/credit columns, glType+amount, or a signed amount (+ = debit). */
function sides(row) {
  const d = num(pick(row, 'debit')); const c = num(pick(row, 'credit'));
  if (d != null || c != null) return { debit: Math.abs(d || 0), credit: Math.abs(c || 0) };
  const amt = num(pick(row, 'amount')); if (amt == null) return null;
  const gl = str(pick(row, 'glType')).toLowerCase();
  if (gl === 'debit' || gl === 'dr') return { debit: Math.abs(amt), credit: 0 };
  if (gl === 'credit' || gl === 'cr') return { debit: 0, credit: Math.abs(amt) };
  return amt >= 0 ? { debit: amt, credit: 0 } : { debit: 0, credit: -amt };
}

// ---------------------------------------------------------------- ordering
/** Deterministic comparator over a list of key functions (strings compare by code point, numbers numerically, null last). */
function by(...keys) {
  return (a, b) => {
    for (const k of keys) {
      const x = k(a); const y = k(b);
      if (x === y) continue;
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      const xs = String(x); const ys = String(y);
      if (xs < ys) return -1; if (xs > ys) return 1;
    }
    return 0;
  };
}
const sortedKeys = (o) => Object.keys(o).sort();

// ---------------------------------------------------------------- args
function requireArg(args, name, hint) {
  const v = args && args[name];
  if (v === undefined || v === null || v === '') throw new Error(`args.${name} is required${hint ? `: ${hint}` : ''} (pass --args '{"${name}": ...}')`);
  return v;
}
function requireYMD(args, name) {
  const v = requireArg(args, name, "a date 'YYYY-MM-DD' (no wall clock is read, so the as-of date must be explicit)");
  const y = ymd(v); if (!y) throw new Error(`args.${name} must be a date (YYYY-MM-DD), got ${JSON.stringify(v)}`);
  return y;
}
/** Period filter: 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD..YYYY-MM-DD' | {start,end} → { start, end } (inclusive) or null. */
function periodOf(p) {
  if (!p) return null;
  if (typeof p === 'object') { const s = ymd(p.start || p.from || p.startDate); const e = ymd(p.end || p.to || p.endDate); return s || e ? { start: s || '0000-01-01', end: e || '9999-12-31' } : null; }
  const s = String(p).trim();
  if (/^\d{4}$/.test(s)) return { start: `${s}-01-01`, end: `${s}-12-31` };
  if (isYM(s)) { const next = addMonths(s, 1); const last = daysBetween(`${s}-01`, `${next}-01`); return { start: `${s}-01`, end: `${s}-${pad2(last)}` }; }
  const m = /^(\S+)\s*(?:\.\.|to|\/)\s*(\S+)$/.exec(s); if (m) { const a = ymd(m[1]); const b = ymd(m[2]); if (a && b) return { start: a, end: b }; }
  const one = ymd(s); return one ? { start: one, end: one } : null;
}
const inPeriod = (y, period) => !period || (y != null && y >= period.start && y <= period.end);

module.exports = { ALIASES, LIST_KEYS, normKey, normVendor, str, num, round2, abs2, ymd, daysBetween, isWeekend, monthKey, addMonths, isYM, isYMD, parseMonthLabel, MONTHS, objectsFromRows, listFrom, rowsFrom, pick, sides, by, sortedKeys, requireArg, requireYMD, periodOf, inPeriod, pad2 };
