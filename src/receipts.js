'use strict';
// Receipts: one line per call the desk made for a request, in
// artifacts/receipts.jsonl. Every figure in a deliverable must trace to one.

const fs = require('fs');
const path = require('path');
const T = require('./request');

function file(id) { return path.join(T.artifactsDir(id), 'receipts.jsonl'); }

function list(id) {
  const p = file(id);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Append a receipt; returns its sequence number (R-<seq> in prose). */
function append(id, rec) {
  const seq = list(id).length + 1;
  fs.appendFileSync(file(id), `${JSON.stringify({ seq, at: new Date().toISOString(), ...rec })}\n`);
  return seq;
}

/** Pure: counts a human wants to see. */
function stats(rows) {
  const ok = rows.filter((r) => typeof r.status === 'number' && r.status >= 200 && r.status < 300).length;
  const failed = rows.filter((r) => typeof r.status === 'number' && (r.status < 200 || r.status >= 300)).length;
  const refused = rows.filter((r) => r.status === 'refused').length;
  const byRoute = {};
  for (const r of rows) { const k = `${r.method} ${r.path}`; byRoute[k] = (byRoute[k] || 0) + 1; }
  return { calls: rows.length, ok, failed, refused, byRoute };
}

/** Every number in a saved response (absolute, 2 dp) so a figure can be traced back to data. */
function numbersIn(value, out = new Set(), depth = 0) {
  if (depth > 12) return out;
  if (typeof value === 'number' && Number.isFinite(value)) out.add(Math.abs(Math.round(value * 100) / 100));
  else if (typeof value === 'string' && /^-?\$?[\d,]+(\.\d+)?$/.test(value.trim())) { const n = Number(value.replace(/[$,]/g, '')); if (Number.isFinite(n)) out.add(Math.abs(Math.round(n * 100) / 100)); }
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out, depth + 1);
  return out;
}

/** All numbers across every saved data file for a request. */
function dataNumbers(id) {
  const dir = path.join(T.artifactsDir(id), 'data');
  const out = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(json|csv)$/i.test(f)) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      if (/\.json$/i.test(f)) numbersIn(JSON.parse(raw), out);
      else for (const m of raw.match(/-?\d[\d,]*(\.\d+)?/g) || []) { const n = Number(m.replace(/,/g, '')); if (Number.isFinite(n)) out.add(Math.abs(Math.round(n * 100) / 100)); }
    } catch { /* unreadable file */ }
  }
  return out;
}

module.exports = { file, list, append, stats, numbersIn, dataNumbers };
