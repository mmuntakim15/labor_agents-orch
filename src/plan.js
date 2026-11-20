'use strict';
// plan.json: what the Planner hands forward. Validated here so a malformed plan
// blocks the request with a clear reason instead of confusing the worker.
//
// {
//   "size": "M", "writes": true, "worker": "preparer",
//   "done": [ { "id": "D-1", "text": "…", "evaluator": "ties_to_report", "args": {…}, "expect": {…} } ],   // optional: replaces intake's list
//   "calls": [ { "method": "GET", "path": "/api/v1/…", "purpose": "…", "read": true, "domain": "financials" } ],
//   "inputs": [ "gusto-sept.csv: payroll register, columns …" ],
//   "writes": [ { "kind": "vendor", "tier": "A", "summary": "…", "count": 12 } ],
//   "steps": [ "…" ],
//   "estimateUsd": 6,
//   "children": [ { "title": "…", "body": "…", "kind": "report", "subject": {…} } ],   // size L only
//   "questions": [], "risks": [], "context": [ { "file": "…", "why": "…" } ]
// }

const KINDS = ['report', 'export', 'question', 'data_task', 'change_request'];
const WORKERS = ['analyst', 'investigator', 'preparer', 'bookkeeper'];

function validate(plan, map) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan.json is not an object'] };
  if (plan.size && !['S', 'M', 'L'].includes(plan.size)) errors.push(`size must be S, M or L (got ${plan.size})`);
  if (plan.worker && !WORKERS.includes(plan.worker)) errors.push(`worker must be one of ${WORKERS.join(', ')}`);
  if (!Array.isArray(plan.calls)) errors.push('calls must be an array');
  else plan.calls.forEach((c, i) => {
    if (!c || !c.method || !c.path) { errors.push(`calls[${i}] needs method and path`); return; }
    if (!/^\/api\/v1\//.test(c.path)) errors.push(`calls[${i}] path must start with /api/v1/`);
    if (map) { const M = require('./map'); const e = M.match(map, c.method, c.path) || map.endpoints.find((x) => x.key === M.key(c.method, c.path)); if (!e) errors.push(`calls[${i}] ${c.method} ${c.path} is not in the endpoint map`); else { c.read = e.read; c.domain = c.domain || e.domain; if (e.denied) errors.push(`calls[${i}] ${c.method} ${c.path} is denied by policy (${e.denied})`); } }
  });
  if (plan.done != null) {
    if (!Array.isArray(plan.done) || !plan.done.length) errors.push('done must be a non-empty array when given');
    else plan.done.forEach((d, i) => { if (!d || !d.text) errors.push(`done[${i}] needs text`); if (d && d.evaluator && !/^(check\.)?[a-z_]+$/.test(d.evaluator)) errors.push(`done[${i}] evaluator name is odd: ${d.evaluator}`); });
  }
  if (plan.writes != null && !Array.isArray(plan.writes)) errors.push('writes must be an array of {kind, tier, summary}');
  if (Array.isArray(plan.writes)) plan.writes.forEach((w, i) => { if (!w || !w.kind || !w.summary) errors.push(`writes[${i}] needs kind and summary`); if (w && w.tier && !['A', 'B', 'C'].includes(w.tier)) errors.push(`writes[${i}] tier must be A, B or C`); });
  if (plan.children != null) {
    if (!Array.isArray(plan.children)) errors.push('children must be an array');
    else plan.children.forEach((c, i) => { if (!c || !c.title) errors.push(`children[${i}] needs a title`); if (c && c.kind && !KINDS.includes(c.kind)) errors.push(`children[${i}] kind ${c.kind} unknown`); });
    if (Array.isArray(plan.children) && plan.children.length && plan.size !== 'L') errors.push('only a size L plan may have children');
  }
  return { ok: errors.length === 0, errors };
}

/** Pure: normalise done items (ids, evaluator prefix) and drop empties. */
function normalizeDone(items) {
  return (items || []).filter((d) => d && d.text).map((d, i) => ({ id: d.id || `D-${i + 1}`, text: String(d.text).trim(), ...(d.evaluator ? { evaluator: String(d.evaluator).replace(/^check\./, ''), args: d.args || {}, expect: d.expect || {} } : {}) }));
}

module.exports = { validate, normalizeDone, KINDS, WORKERS };
