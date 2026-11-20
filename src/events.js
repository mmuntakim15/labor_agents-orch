'use strict';
// Append-only event log (one JSON line per event) and the metrics derived from it.
// Everything the dashboard's System view shows comes from here.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = () => process.env.LAB_EVENTS_FILE || path.join(process.env.LAB_RUNS_DIR || path.join(ROOT, 'runs'), 'events.jsonl');

function emit(type, data) {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify({ at: new Date().toISOString(), type, ...data })}\n`);
}

function read() {
  const f = FILE();
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Pure aggregation over events. */
function aggregate(events) {
  const byAgent = {}; const loopCauses = {}; const checks = {}; const gates = { approved: 0, rejected: 0, byGate: {} }; const requests = {};
  const verify = { runs: 0, failed: 0 }; const guard = { runs: 0, denials: 0, byAgent: {} }; const interventions = { requeue: 0, budget: 0, loop_grant: 0, cancel: 0, sendback: 0 };
  const receipts = { calls: 0, refused: 0 }; const proposals = { proposed: 0, approved: 0, applied: 0, rejected: 0 }; const byKind = {};
  for (const e of events) {
    if (e.type === 'run') {
      const a = (byAgent[e.agent] = byAgent[e.agent] || { runs: 0, costUsd: 0, turns: 0, ms: 0, fails: 0 });
      a.runs += 1; a.costUsd += e.costUsd || 0; a.turns += e.numTurns || 0; a.ms += e.durationMs || 0; if (e.status !== 'ok') a.fails += 1;
      const t = (requests[e.request] = requests[e.request] || { costUsd: 0, runs: 0 }); t.costUsd += e.costUsd || 0; t.runs += 1;
      if (e.kind) { const k = (byKind[`${e.kind}/${e.size || '?'}`] = byKind[`${e.kind}/${e.size || '?'}`] || { costUsd: 0, runs: 0 }); k.costUsd += e.costUsd || 0; k.runs += 1; }
    }
    if (e.type === 'transition' && /loop|send back|verification/.test(e.reason || '')) { const k = `${e.stage}→${e.to}`; loopCauses[k] = (loopCauses[k] || 0) + 1; }
    if (e.type === 'check') for (const f of e.items || []) { const k = `${f.evaluator}:${f.pass ? 'pass' : 'fail'}`; checks[k] = (checks[k] || 0) + 1; }
    if (e.type === 'gate') { gates[e.action === 'approve' ? 'approved' : 'rejected'] += 1; const g = (gates.byGate[e.gate] = gates.byGate[e.gate] || { approved: 0, rejected: 0 }); g[e.action === 'approve' ? 'approved' : 'rejected'] += 1; }
    if (e.type === 'verify') { verify.runs += 1; if (e.failed) verify.failed += 1; }
    if (e.type === 'guard') { guard.runs += 1; guard.denials += e.denials || 0; guard.byAgent[e.agent] = (guard.byAgent[e.agent] || 0) + (e.denials || 0); }
    if (e.type === 'receipts') { receipts.calls += e.calls || 0; receipts.refused += e.refused || 0; }
    if (e.type === 'proposals') { proposals.proposed += e.proposed || 0; proposals.approved += e.approved || 0; proposals.applied += e.applied || 0; proposals.rejected += e.rejected || 0; }
    if (e.type in interventions) interventions[e.type] += 1;
  }
  return { byAgent, loopCauses, checks, gates, requests, verify, guard, interventions, receipts, proposals, byKind, events: events.length };
}

module.exports = { emit, read, aggregate };
