'use strict';
// The day's digest for one entity (RD-2): what the desk applied on its own, what waits for a person, what is paused,
// what deserves a look. Assembled by code from the request folders and written to digest/<businessId>/<date>.json
// (under LAB_RUNS_DIR in tests); the API worker pushes it to Dime when its hash changes.
// Also here: levelOf(request) (L4 = delivered with no human touch and every done item judged by code or reproduced by
// the Verifier) and metricsOf(request) (the eleven keys the API's metrics route aggregates).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const T = require('./request');
const PR = require('./proposals');
const POL = require('./policy');
const RV = require('./reverse');

const METRIC_KEYS = ['touches', 'costUsd', 'runs', 'wallMs', 'humanWaitMs', 'verifierReproduced', 'verifierTotal', 'autoApplied', 'reversed', 'setupHits', 'questionsAsked'];
const DIR = () => process.env.LAB_DIGEST_DIR || path.join(T.runsDir(), 'digest');
const day = (iso) => String(iso || '').slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const isPolicy = (p) => /^policy@/.test(String((p && p.reviewedBy) || ''));
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

function json(id, name) { try { return T.readJsonArtifact(id, name); } catch { return null; } }
function spent(r) { return (r.runs || []).reduce((s, x) => s + (x.costUsd || 0), 0); }
function ref(r) { return (r.api && r.api.ref) || r.id; }

/** Pure given the artifacts: how every done item was judged. */
function judged(r) {
  const checks = json(r.id, 'checks.json') || { items: [] }; const verify = json(r.id, 'verify.json') || { items: [], reproduced: [] };
  return (r.done || []).map((d) => {
    const c = (checks.items || []).find((i) => i.id === d.id && !i.advisory);
    const v = (verify.items || []).find((i) => i.id === d.id);
    const reproduced = Boolean(v && v.pass && ((v.figures && Object.keys(v.figures).length) || /\bR-\d+\b/.test(String(v.evidence || v.note || '')) || (v.reproduced === true)));
    return { id: d.id, text: d.text, code: Boolean(c && c.pass), reproduced, verifier: Boolean(v && v.pass), modelOnly: !(c && c.pass) && !reproduced };
  });
}

/** 'L4' when delivered with no human touch and every done item code-judged or Verifier-reproduced; else 'L3'. */
function levelOf(r) {
  if (!r || r.status !== 'done') return 'L3';
  if ((Number(r.touches) || 0) !== 0) return 'L3';
  const items = judged(r); if (!items.length) return 'L3';
  return items.every((i) => i.code || i.reproduced) ? 'L4' : 'L3';
}

/** The eleven metric keys for one request. */
function metricsOf(r) {
  const runs = r.runs || [];
  const first = runs[0] && Date.parse(runs[0].startedAt); const lastRun = runs[runs.length - 1]; const last = lastRun && Date.parse(lastRun.endedAt || lastRun.startedAt);
  const comments = T.listComments(r.id);
  let humanWaitMs = 0;
  for (const g of [1, 2]) { const at = comments.find((c) => c.author === 'orchestrator' && new RegExp(`→ awaiting_gate_${g}`).test(c.body)); const dec = (r.gates[g] || {}).at || (r.gates[g] || {}).rejectedAt; if (at && dec) humanWaitMs += Math.max(0, Date.parse(dec) - Date.parse(at.at)); }
  for (const i of r.inputsNeeded || []) if (i.askedAt && (i.receivedAt || i.expiredAt)) humanWaitMs += Math.max(0, Date.parse(i.receivedAt || i.expiredAt) - Date.parse(i.askedAt));
  const verify = json(r.id, 'verify.json') || {}; const rep = Array.isArray(verify.reproduced) ? verify.reproduced : [];
  const props = PR.load(r.id).items;
  const setup = r.setup || {}; const answers = { ...((setup.entity || {}).answers || {}), ...((setup.recipe || {}).answers || {}), ...(setup.answers || {}) };
  const questionsAsked = r.questionsAsked != null ? Number(r.questionsAsked) : comments.filter((c) => c.author === 'orchestrator' && /questions for the requester/.test(c.body)).length;
  return {
    touches: Number(r.touches) || 0, costUsd: money(spent(r)), runs: runs.length, wallMs: first && last ? Math.max(0, last - first) : 0, humanWaitMs,
    verifierReproduced: rep.filter((x) => x && x.ok).length, verifierTotal: rep.length,
    autoApplied: props.filter((p) => isPolicy(p) && ['applied', 'reversed'].includes(p.status)).length, reversed: props.filter((p) => p.status === 'reversed').length,
    setupHits: r.setupHits != null ? Number(r.setupHits) : Object.keys(answers).length, questionsAsked,
  };
}

function hashOf(obj) { return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex'); }
/** The Dime-side id of a linked request (what the Today screen opens), or null for a desk-only one. */
function apiId(r) { return (r.api && r.api.id) || null; }
/** Common head of every digest row: ids on both sides, the recipe, the title. */
function head(r) { return { request: r.id, requestId: apiId(r), ref: ref(r), recipeId: r.recipeId || null, title: r.title }; }
/** When a delivered request was delivered: its deliver run's end, else its last run's end, else its last update. */
function deliveredAt(r) { const runs = r.runs || []; const d = [...runs].reverse().find((x) => x.stage === 'deliver' && x.endedAt); const last = runs[runs.length - 1]; return (d && d.endedAt) || (last && (last.endedAt || last.startedAt)) || r.updatedAt; }
/** Plain words for what a decision row waits on. */
function needsOf(r, pending) {
  if ((r.pendingQuestions || []).length) return `${plural(r.pendingQuestions.length, 'question')} for you`;
  if (r.status === 'awaiting_gate_1') return `Approve the plan${pending.length ? ` (${plural(pending.length, 'planned change')})` : ''}`;
  const qs = pending.filter((p) => p.tier === 'C').length; const ch = pending.length - qs;
  return [ch ? `Approve ${plural(ch, 'change')}` : '', qs ? `answer ${plural(qs, 'question')}` : ''].filter(Boolean).join(' and ').replace(/^answer/, 'Answer') || 'Approve the changes';
}
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }
/** What a delivered request left for the reader: its files, the Exceptions count when a workbook leads with one, and how its done items were judged. */
function deliveredRow(r) {
  const manifest = json(r.id, path.join('deliverables', 'manifest.json')) || { items: [] };
  const files = (manifest.items || []).map((i) => i.name).filter(Boolean);
  let exceptions = null;
  for (const i of manifest.items || []) { const s = (i.sheets || []).find((x) => /^exceptions$/i.test(String(x.name || ''))); if (s && Number.isFinite(Number(s.rows))) { exceptions = (exceptions || 0) + Number(s.rows); } }
  const items = judged(r); const runs = r.runs || [];
  const first = runs[0] && Date.parse(runs[0].startedAt); const at = deliveredAt(r); const end = at && Date.parse(at);
  return { ...head(r), kind: r.kind || null, level: levelOf(r), touches: Number(r.touches) || 0, deliveredAt: at, costUsd: money(spent(r)), minutes: first && end ? Math.max(0, Math.round((end - first) / 60000)) : null, checks: { passed: items.filter((i) => i.code || i.reproduced || i.verifier).length, total: items.length }, files, exceptions };
}
function blockedTimes(r) { return T.listComments(r.id).filter((c) => c.author === 'orchestrator' && /^→ blocked/.test(c.body)).length; }
function activeOn(r, date) { if (day(r.createdAt) === date || day(r.updatedAt) === date) return true; return (r.runs || []).some((x) => day(x.startedAt) === date || day(x.endedAt) === date); }

/** The digest for one entity and one day. */
function assemble(businessId, date = today(), { now = Date.now(), write = true } = {}) {
  const requests = POL.requestsOf(businessId);
  const applied = []; const delivered = []; const decisions = []; const awaitingInput = []; const paused = []; const reviewSuggested = [];
  let reversedToday = 0;
  for (const r of requests) {
    const items = PR.load(r.id).items;
    for (const p of items) {
      if (isPolicy(p) && ['applied', 'reversed'].includes(p.status) && day(p.appliedRef && p.appliedRef.at || p.appliedAt) === date) {
        const rv = RV.reversible(p, { now });
        const at = (p.appliedRef && p.appliedRef.at) || p.appliedAt;
        applied.push({ ...head(r), proposal: p.id, proposalId: p.id, kind: p.kind, summary: p.summary, amount: p.amountApproved ?? p.amount ?? null, appliedAt: at, at, dimeRef: (p.appliedRef && p.appliedRef.id) || null, by: p.reviewedBy, policyVersion: p.policyDecision ? p.policyDecision.version : null, status: p.status, reversible: rv.ok, reversibleUntil: rv.ok ? new Date(Date.parse(p.appliedRef.at) + RV.WINDOW_DAYS * 864e5).toISOString().slice(0, 10) : null, reversedBy: p.status === 'reversed' ? p.reversedBy || null : null, memo: p.status === 'reversed' ? `Reversed by ${p.reversedBy} · ${p.reversedReason}` : `${p.summary}${p.policyDecision && p.policyDecision.reason ? ` · ${p.policyDecision.reason}` : ''}` });
      }
      if (p.status === 'reversed' && day(p.reversedAt) === date) reversedToday += 1;
    }
    if (r.status === 'awaiting_gate_2' || r.status === 'awaiting_gate_1') { const pending = items.filter((p) => ['proposed', 'question'].includes(p.status)).map((p) => ({ id: p.id, tier: POL.effectiveTier(p), kind: p.kind, summary: p.summary, amount: p.amountApproved ?? p.amount ?? null })); decisions.push({ ...head(r), gate: r.status === 'awaiting_gate_1' ? 1 : 2, pending, needs: needsOf(r, pending), since: r.updatedAt }); }
    if ((r.pendingQuestions || []).length) decisions.push({ ...head(r), questions: r.pendingQuestions, needs: needsOf(r, []), since: r.updatedAt });
    if (r.status === 'awaiting_input') awaitingInput.push({ ...head(r), inputs: (r.inputsNeeded || []).filter((i) => !i.receivedAt && !i.missing).map((i) => ({ name: i.name, period: i.period, why: i.why, acceptedTypes: i.acceptedTypes || [], askedAt: i.askedAt })), since: r.updatedAt });
    if (r.status === 'blocked' && blockedTimes(r) >= 2) paused.push({ ...head(r), reason: (r.blocked || {}).reason || null, gap: (r.blocked || {}).gap || null, why: (r.blocked || {}).reason || null, timesBlocked: blockedTimes(r) });
    if (r.status === 'done' && day(deliveredAt(r)) === date) delivered.push(deliveredRow(r));
    if (r.status === 'done' && (Number(r.touches) || 0) === 0) { const j = judged(r).filter((i) => i.modelOnly); if (j.length) reviewSuggested.push({ ...head(r), items: j.map((i) => ({ id: i.id, text: i.text })), deliveredAt: deliveredAt(r) }); }
  }
  delivered.sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt)));
  const active = requests.filter((r) => activeOn(r, date));
  const totals = { requests: active.length, zeroTouch: active.filter((r) => r.status === 'done' && (Number(r.touches) || 0) === 0).length, costUsd: money(active.reduce((s, r) => s + spent(r), 0)), reversed: reversedToday, applied: applied.length, delivered: delivered.length, decisions: decisions.length, awaitingInput: awaitingInput.length, paused: paused.length, reviewSuggested: reviewSuggested.length, l4: active.filter((r) => levelOf(r) === 'L4').length };
  const digest = { businessId: String(businessId), date, applied, delivered, decisions, awaitingInput, paused, reviewSuggested, totals };
  digest.hash = hashOf(digest);
  digest.generatedAt = new Date(now).toISOString();
  if (write) { const f = path.join(DIR(), String(businessId).replace(/[^A-Za-z0-9_-]/g, ''), `${date}.json`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(digest, null, 1)); digest.file = f; }
  return digest;
}

/** Every business id the store knows (subjects and clients), for the worker's digest sweep. */
function businesses(requests = T.listRequests()) {
  const out = new Set();
  for (const r of requests) { const b = POL.businessOf(r); if (b) out.add(String(b)); for (const x of (r.subject || {}).businessIds || []) out.add(String(x)); }
  return [...out];
}

module.exports = { METRIC_KEYS, DIR, assemble, levelOf, metricsOf, judged, businesses, hashOf, today, deliveredAt, needsOf };
