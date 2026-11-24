'use strict';
// The Applier: deterministic code, not a model run. It sends approved proposals
// to Dime through the product's own route, in order, re-reading the approval at
// apply time (never trusting a payload it was handed), records the Dime reference,
// and stops on the first failure with the product's own words.
//
// Two approvers exist (RD-2):
//   a named person at Gate 2            → every approved proposal is sent;
//   the entity policy (`policy@v<n>`)   → before any gate, only the policy-approved tier-A items are sent, and each
//                                          one is decided again here: a kind demoted or a switch turned off since
//                                          verify leaves the item pending with a note (E-01), it is never posted.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const PR = require('./proposals');
const R = require('./receipts');
const M = require('./map');
const D = require('./dime');
const POL = require('./policy');

const isPolicy = (p) => /^policy@/.test(String((p && p.reviewedBy) || ''));

function refOf(json) {
  const pick = (o) => o && typeof o === 'object' ? (o._id || o.id || o.jobId || o.journalId || o.vendorId || o.customerId || null) : null;
  return pick(json) || pick(json && json.data) || pick(json && json.result) || pick(json && Array.isArray(json.data) && json.data[0]) || null;
}

async function execute(ctx, { call = D.call, log = () => {} } = {}) {
  const req = ctx.request;
  const policy = M.POLICY();
  const map = M.load();
  const fresh = PR.load(req.id).items;
  const humanGate = Boolean(req.gates && req.gates[2] && req.gates[2].approved);
  // before Gate 2 only the policy's own approvals are in scope; a person's approvals wait for the gate
  const todo = fresh.filter((p) => p.status === 'approved' && (humanGate || isPolicy(p)));
  const applied = []; const deferred = []; let failed = null;
  if (policy.writesEnabled === false) return { status: 'blocked', summary: 'writes are disabled on this desk (config/policy.json writesEnabled=false)', applied: [] };
  const entityPolicy = POL.load(POL.businessOf(req));
  for (const p of todo) {
    // re-read the approval: a proposal is applied only if a named person or the policy approved it, and only through a mapped, allowed route
    if (!p.reviewedBy) { failed = { id: p.id, error: 'no approver recorded' }; break; }
    if (isPolicy(p)) {
      const d = POL.decide({ kind: p.kind, amount: p.amountApproved ?? p.amount ?? null, facts: p.facts || {}, policy: entityPolicy });
      if (!d.autoApply) { const why = `policy changed since verify (now tier ${d.tier}${d.reason ? `: ${d.reason}` : ''}); left for a person`; PR.revertToProposed(req.id, p.id, why); deferred.push({ id: p.id, kind: p.kind, reason: why }); T.addComment(req.id, { author: 'Applier', stage: 'apply', body: `⏸ ${p.id} not posted: ${why}` }); continue; }
    }
    if (p.tier === 'C' || !p.method || !p.path) { failed = { id: p.id, error: 'not an applicable proposal (tier C or no route)' }; break; }
    const e = map && M.match(map, p.method, p.path);
    if (!e) { failed = { id: p.id, error: `${p.method} ${p.path} is not in the endpoint map` }; break; }
    if (e.denied) { failed = { id: p.id, error: `${p.method} ${p.path} is denied by policy (${e.denied})` }; break; }
    if (p.entry && !PR.balanced(p.entry).ok) { failed = { id: p.id, error: 'journal entry does not balance' }; break; }
    log(`  applying ${p.id} ${p.method} ${p.path}${isPolicy(p) ? ` (${p.reviewedBy})` : ''}`);
    let r;
    try { r = await call({ backend: req.backend, request: req, method: p.method, path: p.path, body: p.body }); } catch (x) { failed = { id: p.id, error: x.message }; PR.markApplied(req.id, p.id, { error: x.message }); break; }
    R.append(req.id, { method: p.method, path: p.path, url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: process.env.LAB_RUN || 'apply', purpose: `apply ${p.id} (${p.kind})${isPolicy(p) ? ` under ${p.reviewedBy}` : ''}`, proposal: p.id });
    if (!r.ok) { const msg = D.humanize(r.status, r.json); PR.markApplied(req.id, p.id, { error: `${r.status}: ${msg}` }); failed = { id: p.id, error: msg, status: r.status }; break; }
    const ref = { id: refOf(r.json), route: `${p.method} ${p.path}`, status: r.status, at: new Date().toISOString(), by: p.reviewedBy, policy: isPolicy(p) ? (p.policyDecision || null) : null };
    PR.markApplied(req.id, p.id, { appliedRef: ref });
    applied.push({ id: p.id, kind: p.kind, ref, by: p.reviewedBy });
  }
  const out = { at: new Date().toISOString(), mode: humanGate ? 'gate2' : 'policy', applied, deferred, failed, skipped: fresh.filter((p) => !todo.includes(p)).map((p) => ({ id: p.id, status: p.status })) };
  fs.writeFileSync(path.join(T.artifactsDir(req.id), 'applied.json'), JSON.stringify(out, null, 1));
  if (failed) return { status: 'blocked', summary: `${applied.length} applied, then ${failed.id} failed: ${failed.error}. The remaining approved items were not sent.`, applied, deferred, failed };
  const who = humanGate ? 'approved' : 'tier-A, approved by policy';
  return { status: 'ok', summary: `${applied.length} ${who} proposal(s) applied through Dime.${deferred.length ? ` ${deferred.length} left for a person (policy changed).` : ''}`, applied, deferred };
}

module.exports = { name: 'applier', label: 'Applier', stages: ['apply'], deterministic: true, execute, refOf, isPolicy };
