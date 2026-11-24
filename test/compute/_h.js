'use strict';
// Shared scaffolding for the compute verb tests: fixture loading in the exact
// shape src/compute/index.js hands to a verb, and a determinism check.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CM = require('../../src/compute');

const FIX = path.join(__dirname, '..', 'fixtures', 'compute');

/** Load a fixture the way the runner does (json → .json, rows → .csv). */
function fixture(name) {
  const p = path.join(FIX, name); const buf = fs.readFileSync(p);
  const f = { name, path: p, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
  if (name.endsWith('.json')) f.json = JSON.parse(buf.toString('utf8'));
  else if (name.endsWith('.csv')) f.rows = CM.csvRows(buf.toString('utf8'));
  else f.text = buf.toString('utf8');
  return f;
}
const jf = (name, json) => ({ name, path: `/inline/${name}`, sha: 'inline', json });
const csv = (name, text) => ({ name, path: `/inline/${name}`, sha: 'inline', rows: CM.csvRows(text) });

/** Run twice and insist on byte-identical stable JSON; returns the parsed result. */
function twice(verb, ctx) {
  const a = CM.stable(verb.run({ request: { id: 'REQ-test' }, ...ctx }));
  const b = CM.stable(verb.run({ request: { id: 'REQ-test' }, ...ctx }));
  assert.equal(a, b, `${verb.name} is not deterministic`);
  return JSON.parse(a);
}
/** Input order must not matter: reverse every list input and compare. */
function orderInvariant(verb, ctx) {
  const rev = (f) => { const g = { ...f }; if (Array.isArray(g.json)) g.json = [...g.json].reverse(); else if (g.json && Array.isArray(g.json.rows)) g.json = { ...g.json, rows: [...g.json.rows].reverse() }; else if (g.rows) g.rows = [g.rows[0], ...g.rows.slice(1).reverse()]; return g; };
  const a = CM.stable(verb.run({ request: { id: 'REQ-test' }, ...ctx }));
  const b = CM.stable(verb.run({ request: { id: 'REQ-test' }, ...ctx, files: ctx.files.map(rev) }));
  assert.equal(a, b, `${verb.name} output depends on input row order`);
}

module.exports = { FIX, fixture, jf, csv, twice, orderInvariant, CM };
