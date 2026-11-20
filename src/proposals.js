'use strict';
// Proposals: writes an agent wants made to the books, staged on the request
// (artifacts/proposals.json) for a named person to approve at Gate 2. Only the
// deterministic Applier ever sends them to Dime, and only the approved ones.
//
// Tiers (from the financial-review agent's fix-authorization doctrine):
//   A  one correct answer, one click to approve
//   B  the amount is the agent's estimate; the person confirms or edits the number
//   C  a judgment call: a question to a person, never a payload

const fs = require('fs');
const path = require('path');
const T = require('./request');

function file(id) { return path.join(T.artifactsDir(id), 'proposals.json'); }
function load(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return { items: [] }; } }
function save(id, doc) { fs.writeFileSync(file(id), JSON.stringify(doc, null, 1)); return doc; }

/** Pure: the tier a proposal gets. The agent may demote (A→B, B→C) but never promote. */
function tierFor(policy, kind, requested) {
  const t = policy.tierByKind || {};
  let base = policy.tierDefault || 'B';
  for (const [tier, kinds] of Object.entries(t)) if ((kinds || []).includes(kind)) base = tier;
  const order = { A: 0, B: 1, C: 2 };
  const r = requested && order[requested] != null ? requested : null;
  if (!r) return { tier: base, reason: null };
  if (order[r] > order[base]) return { tier: r, reason: `agent demoted from ${base}` };
  if (order[r] < order[base]) return { tier: base, reason: `policy keeps ${kind} at ${base} (agent asked for ${r})` };
  return { tier: base, reason: null };
}

/** Pure: does a journal entry balance? Accepts {lines:[{debit,credit}]} or Dime's {items:[{glType, amount}]}. */
function balanced(entry) {
  const lines = (entry && (entry.lines || entry.items || entry.entries)) || [];
  let debits = 0; let credits = 0;
  for (const l of lines) {
    if (l.debit != null || l.credit != null) { debits += Number(l.debit || 0); credits += Number(l.credit || 0); } else if (l.glType) { if (String(l.glType).toLowerCase() === 'debit') debits += Math.abs(Number(l.amount || 0)); else credits += Math.abs(Number(l.amount || 0)); }
  }
  debits = Math.round(debits * 100) / 100; credits = Math.round(credits * 100) / 100;
  return { ok: lines.length >= 2 && debits === credits && debits > 0, debits, credits, lines: lines.length };
}

/** Best-effort amount of a proposal for the tier-B confirmation box. */
function amountOf(body, entry) {
  if (entry) { const b = balanced(entry); if (b.debits) return b.debits; }
  if (body && typeof body === 'object') for (const k of ['amount', 'total', 'totalAmount', 'unit_amount_cents', 'amount_cents']) if (typeof body[k] === 'number') return /cents/.test(k) ? body[k] / 100 : body[k];
  return null;
}

function add(id, p) {
  const doc = load(id);
  const n = doc.items.length + 1;
  const item = { id: `P-${n}`, status: p.tier === 'C' ? 'question' : 'proposed', at: new Date().toISOString(), run: process.env.LAB_RUN || null, ...p };
  doc.items.push(item);
  save(id, doc);
  return { proposal: item, count: doc.items.length };
}

/** Human decision on one proposal. Only the orchestrator's gate writers call this with a name. */
function decide(id, pid, { status, by, note = null, amount = null, body = null }) {
  const doc = load(id);
  const it = doc.items.find((x) => x.id === pid);
  if (!it) throw new Error(`no proposal ${pid} on ${id}`);
  if (!['approved', 'rejected', 'answered'].includes(status)) throw new Error(`bad proposal status ${status}`);
  if (it.tier === 'C' && status === 'approved') throw new Error(`${pid} is a tier C question; it cannot be approved, only answered`);
  it.status = status; it.reviewedBy = by; it.reviewedAt = new Date().toISOString(); it.note = note;
  if (amount != null && status === 'approved') { it.amountApproved = Number(amount); if (it.body && typeof it.body === 'object') { it.bodyOriginal = it.bodyOriginal || JSON.parse(JSON.stringify(it.body)); it.body = withAmount(it.body, Number(amount), it.amount); } }
  if (body && status === 'approved') { it.bodyOriginal = it.bodyOriginal || it.body; it.body = body; }
  save(id, doc);
  return it;
}

/** Replace the proposal's amount in the body where it appears as the original number. */
function withAmount(body, amount, original) {
  const walk = (v) => { if (typeof v === 'number' && original != null && Math.abs(v - original) < 0.005) return amount; if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])); return v; };
  return walk(body);
}

function markApplied(id, pid, { appliedRef, error = null }) {
  const doc = load(id);
  const it = doc.items.find((x) => x.id === pid); if (!it) throw new Error(`no proposal ${pid}`);
  if (error) { it.status = 'failed'; it.error = String(error).slice(0, 500); } else { it.status = 'applied'; it.appliedRef = appliedRef; it.appliedAt = new Date().toISOString(); }
  save(id, doc); return it;
}

function summary(id) {
  const items = load(id).items;
  const c = (s) => items.filter((x) => x.status === s).length;
  return { total: items.length, proposed: c('proposed'), approved: c('approved'), rejected: c('rejected'), applied: c('applied'), failed: c('failed'), questions: items.filter((x) => x.tier === 'C').length, answered: c('answered'), pending: items.filter((x) => ['proposed', 'question'].includes(x.status)).length };
}

module.exports = { file, load, save, add, decide, markApplied, summary, tierFor, balanced, amountOf, withAmount };
