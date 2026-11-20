'use strict';
// The Applier: deterministic code, not a model run. After a named person
// approved proposals at Gate 2, it sends each approved one to Dime through the
// product's own route, in order, re-reading the approval at apply time (never
// trusting a payload it was handed), records the Dime reference, and stops on
// the first failure with the product's own words.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const PR = require('./proposals');
const R = require('./receipts');
const M = require('./map');
const D = require('./dime');

function refOf(json) {
  const pick = (o) => o && typeof o === 'object' ? (o._id || o.id || o.jobId || o.journalId || o.vendorId || o.customerId || null) : null;
  return pick(json) || pick(json && json.data) || pick(json && json.result) || pick(json && Array.isArray(json.data) && json.data[0]) || null;
}

async function execute(ctx, { call = D.call, log = () => {} } = {}) {
  const req = ctx.request;
  const policy = M.POLICY();
  const map = M.load();
  const fresh = PR.load(req.id).items;
  const todo = fresh.filter((p) => p.status === 'approved');
  const applied = []; let failed = null;
  if (policy.writesEnabled === false) return { status: 'blocked', summary: 'writes are disabled on this desk (config/policy.json writesEnabled=false)', applied: [] };
  for (const p of todo) {
    // re-read the approval: a proposal is applied only if a named person approved it, and only through a mapped, allowed route
    if (!p.reviewedBy) { failed = { id: p.id, error: 'no approver recorded' }; break; }
    if (p.tier === 'C' || !p.method || !p.path) { failed = { id: p.id, error: 'not an applicable proposal (tier C or no route)' }; break; }
    const e = map && M.match(map, p.method, p.path);
    if (!e) { failed = { id: p.id, error: `${p.method} ${p.path} is not in the endpoint map` }; break; }
    if (e.denied) { failed = { id: p.id, error: `${p.method} ${p.path} is denied by policy (${e.denied})` }; break; }
    if (p.entry && !PR.balanced(p.entry).ok) { failed = { id: p.id, error: 'journal entry does not balance' }; break; }
    log(`  applying ${p.id} ${p.method} ${p.path}`);
    let r;
    try { r = await call({ backend: req.backend, method: p.method, path: p.path, body: p.body }); } catch (x) { failed = { id: p.id, error: x.message }; PR.markApplied(req.id, p.id, { error: x.message }); break; }
    R.append(req.id, { method: p.method, path: p.path, url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: process.env.LAB_RUN || 'apply', purpose: `apply ${p.id} (${p.kind})`, proposal: p.id });
    if (!r.ok) { const msg = D.humanize(r.status, r.json); PR.markApplied(req.id, p.id, { error: `${r.status}: ${msg}` }); failed = { id: p.id, error: msg, status: r.status }; break; }
    const ref = { id: refOf(r.json), route: `${p.method} ${p.path}`, status: r.status, at: new Date().toISOString(), by: p.reviewedBy };
    PR.markApplied(req.id, p.id, { appliedRef: ref });
    applied.push({ id: p.id, kind: p.kind, ref });
  }
  const out = { at: new Date().toISOString(), applied, failed, skipped: fresh.filter((p) => p.status !== 'approved').map((p) => ({ id: p.id, status: p.status })) };
  fs.writeFileSync(path.join(T.artifactsDir(req.id), 'applied.json'), JSON.stringify(out, null, 1));
  if (failed) return { status: 'blocked', summary: `${applied.length} applied, then ${failed.id} failed: ${failed.error}. The remaining approved items were not sent.`, applied, failed };
  return { status: 'ok', summary: `${applied.length} approved proposal(s) applied through Dime.`, applied };
}

module.exports = { name: 'applier', label: 'Applier', stages: ['apply'], deterministic: true, execute, refOf };
