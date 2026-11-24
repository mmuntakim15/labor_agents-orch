'use strict';
// Date helpers shared by the compute verbs (underscore prefix: not a verb).
// Dates are ISO 'YYYY-MM-DD' strings everywhere; arithmetic goes through UTC
// day numbers so there is no timezone or DST drift. Nothing here reads the clock.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function valid(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) && y >= 1900 && y <= 2200; }

/** Excel serial day → ISO (1900 date system). */
function fromExcelSerial(n) { const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 864e5; const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }

/** Parse ISO, 'YYYY/MM/DD', 'MM/DD/YYYY', 'M/D/YY', 'DD-Mon-YYYY', 'Mon DD, YYYY', 'YYYYMMDD', Date, Excel serial → 'YYYY-MM-DD' or null. */
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') return v > 20000 && v < 80000 ? fromExcelSerial(v) : null;
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s)) || (m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return valid(y, mo, d) ? iso(y, mo, d) : null; }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return valid(y, mo, d) ? iso(y, mo, d) : null; }
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) { let y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900; const [mo, d] = [+m[1], +m[2]]; return valid(y, mo, d) ? iso(y, mo, d) : null; }
  if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})$/.exec(s))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; const [d, y] = [+m[1], +m[3]]; return mo && valid(y, mo, d) ? iso(y, mo, d) : null; }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; const [d, y] = [+m[2], +m[3]]; return mo && valid(y, mo, d) ? iso(y, mo, d) : null; }
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return n > 20000 && n < 80000 ? fromExcelSerial(n) : null; }
  return null;
}

function parts(d) { const [y, m, dd] = String(d).split('-').map(Number); return { y, m, d: dd }; }
/** Days since 1970-01-01 (UTC). */
function toDays(d) { const p = parts(d); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 864e5); }
function fromDays(n) { const dt = new Date(n * 864e5); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
/** b - a in days. */
function daysBetween(a, b) { return toDays(b) - toDays(a); }
function addDays(d, n) { return fromDays(toDays(d) + n); }
/** Add months, clamping the day to the target month's length (Jan 31 + 1 → Feb 28). */
function addMonths(d, n) { const p = parts(d); const t = p.y * 12 + (p.m - 1) + n; const y = Math.floor(t / 12); const m = (t % 12) + 1; return iso(y, m, Math.min(p.d, daysInMonth(y, m))); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** 'YYYY-MM' of a date. */
function monthKey(d) { return String(d).slice(0, 7); }
function monthStart(ym) { return `${ym}-01`; }
function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return iso(y, m, daysInMonth(y, m)); }
/** Month index (y*12+m-1) of 'YYYY-MM' or 'YYYY-MM-DD'. */
function monthIndex(s) { const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); }
function monthFromIndex(i) { return `${pad(Math.floor(i / 12), 4)}-${pad((i % 12) + 1)}`; }
/** Whole months from ym a to ym b (b - a). */
function monthsBetween(a, b) { return monthIndex(b) - monthIndex(a); }
function dayOfMonth(d) { return parts(d).d; }
/** 0 = Sunday … 6 = Saturday. */
function weekday(d) { return new Date(toDays(d) * 864e5).getUTCDay(); }

/** Period argument → { start, end } ISO. Accepts 'YYYY-MM', 'YYYY', 'YYYY-MM-DD..YYYY-MM-DD', { start, end } / { startDate, endDate }. */
function periodRange(p) {
  if (!p) return null;
  if (typeof p === 'object') { const s = parseDate(p.start || p.startDate || p.from); const e = parseDate(p.end || p.endDate || p.to); return s && e ? { start: s, end: e } : null; }
  const s = String(p).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return { start: monthStart(s), end: monthEnd(s) };
  if (/^\d{4}$/.test(s)) return { start: `${s}-01-01`, end: `${s}-12-31` };
  const m = /^(.+?)\s*(?:\.\.|to|–|—|\/)\s*(.+)$/.exec(s);
  if (m) { const a = parseDate(m[1]); const b = parseDate(m[2]); if (a && b) return { start: a, end: b }; }
  const one = parseDate(s); return one ? { start: one, end: one } : null;
}
function inRange(d, r) { return !r || (d >= r.start && d <= r.end); }

module.exports = { parseDate, fromExcelSerial, daysInMonth, toDays, fromDays, daysBetween, addDays, addMonths, compare, monthKey, monthStart, monthEnd, monthIndex, monthFromIndex, monthsBetween, dayOfMonth, weekday, periodRange, inRange, iso };
