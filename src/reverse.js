'use strict';
// Reversal (RD-2): undo one applied proposal through the product's own routes,
// never a delete. A named person asks (the `reverse` command, `lab reverse`);
// the inverse call per kind is:
//   transaction_categorization, recode_to_bill  re-categorise with the state the worker recorded as `previous`
//   payment_application                         the bill's remove-payment route (from the map), payment_id = the applied reference
//   journal_entry, accrual                      a reversing journal dated today, every line mirrored, memo "Reversed by …"
//   vendor, customer                            status inactive through the update route
// Anything else, or a kind without the data it needs, is refused with the reason and nothing is called.
// The proposal is marked reversed, a receipt is appended, and a knowledge note (kind gotcha) is written for the worker to mirror.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const PR = require('./proposals');
const R = require('./receipts');
const M = require('./map');
const D = require('./dime');

const WINDOW_DAYS = 30;
const DAY_MS = 864e5;
const NOTES_FILE = (id) => path.join(T.artifactsDir(id), 'knowledge-notes.jsonl');

function fail(msg) { const e = new Error(msg); e.refused = true; return e; }
function businessIdOf(p, req) { const m = /\/businessId\/([A-Za-z0-9_-]+)/.exec(p.path || '') || /\/business\/([A-Za-z0-9_-]+)/.exec(p.path || ''); return (m && m[1]) || (req.client && req.client.businessId) || ((req.subject || {}).businessIds || [])[0] || null; }
function allowed(map, method, p) { const e = map && M.match(map, method, p); if (!e) throw fail(`${method} ${p} is not in the endpoint map; the reversal route must be a real one`); if (e.denied) throw fail(`${method} ${p} is denied by policy (${e.denied})`); return e; }
function findRoute(map, method, words, must) { const hits = M.search(map, words, { limit: 10 }).filter((e) => e.method === method && !e.denied && must.test(e.path)); return hits[0] || null; }
function fill(pattern, params) { return pattern.replace(/:([A-Za-z0-9_]+)\??/g, (s, k) => { if (params[k] == null) throw fail(`cannot fill :${k} of ${pattern}`); return String(params[k]); }); }

/** Pure: the memo every reversing entry carries. */
function memoFor(by, reason, requestId, pid) { return `Reversed by ${by} · ${reason} · ${requestId} · ${pid}`; }

/** Pure: the mirrored lines of a journal the Applier posted (bare array of Dime transaction lines, or {lines:[{account,debit,credit}]}). */
function reversingLines(p, { by, reason, requestId, today = new Date().toISOString().slice(0, 10) }) {
  const memo = memoFor(by, reason, requestId, p.id);
  const flip = (g) => (String(g).toLowerCase() === 'debit' ? 'credit' : 'debit');
  const dir = (g) => (String(g).toLowerCase() === 'debit' ? 'inflow' : 'outflow');
  const src = Array.isArray(p.body) ? p.body : (p.body && Array.isArray(p.body.items) ? p.body.items : null);
  if (src && src.length) {
    return src.map((l) => { const g = flip(l.glType); const { _id, id, journal_id, ...rest } = l; return { ...rest, glType: g, amountDirection: dir(g), amount: Math.abs(Number(l.amount) || 0), date: today, transaction_date: today, transaction_memo: memo, memo, journal_id: journal_id ? `${journal_id}-REV` : undefined, reversal_of: p.appliedRef && p.appliedRef.id ? String(p.appliedRef.id) : (journal_id || null) }; });
  }
  const lines = p.entry && Array.isArray(p.entry.lines) ? p.entry.lines : [];
  if (!lines.length) throw fail('no journal lines recorded on the proposal to mirror');
  return lines.map((l) => { const debit = Number(l.credit || 0); const credit = Number(l.debit || 0); const g = debit > 0 ? 'debit' : 'credit'; return { account_id: l.account_id || 'gl_999999', accounting_category: l.account, accounting_accounts: l.type || l.accounting_accounts || null, glType: g, amountDirection: dir(g), amount: debit > 0 ? debit : credit, date: today, transaction_date: today, transaction_memo: memo, memo, reversal_of: p.appliedRef && p.appliedRef.id ? String(p.appliedRef.id) : null }; });
}

/** Pure: the inverse call for one applied proposal, or a refusal. */
function inverseCall(p, req, map, { by, reason }) {
  const kind = p.kind; const biz = businessIdOf(p, req);
  if (!p.appliedRef) throw fail(`${p.id} has no applied reference to reverse`);
  switch (kind) {
    case 'transaction_categorization': case 'recode_to_bill': case 'transaction_bulk_categorization': {
      const prev = p.previous;
      if (!prev || typeof prev !== 'object') throw fail('no previous state recorded on the proposal; the worker did not give one at propose time');
      const method = String(prev.method || 'PUT').toUpperCase(); const route = prev.path || (kind === 'transaction_categorization' ? p.path : null);
      if (!route) throw fail('no previous state path: the reversal needs the transaction route the categorisation used');
      const body = prev.body !== undefined ? prev.body : (prev.method || prev.path ? null : prev);
      if (!body || typeof body !== 'object') throw fail('previous state carries no body to restore');
      allowed(map, method, route);
      return { method, path: route, body: { ...body, reversal_memo: memoFor(by, reason, req.id, p.id) }, how: 're-categorise with the recorded previous state' };
    }
    case 'payment_application': {
      const route = findRoute(map, 'PUT', 'bill remove-payment', /remove-payment$/) || findRoute(map, 'POST', 'bill remove-payment', /remove-payment$/);
      if (!route) throw fail('no remove-payment route in the endpoint map; run `lab map` or reverse the payment in Dime');
      const billId = (p.body && (p.body.billId || p.body.bill_id)) || (/\/bill\/([A-Za-z0-9_-]+)/.exec(p.path || '') || [])[1];
      if (!billId) throw fail('the proposal names no bill to remove the payment from');
      if (!p.appliedRef.id) throw fail('no payment id was returned when the payment was applied');
      allowed(map, route.method, fill(route.path, { businessId: biz, billId }));
      return { method: route.method, path: fill(route.path, { businessId: biz, billId }), body: { payment_id: String(p.appliedRef.id), reason: memoFor(by, reason, req.id, p.id) }, how: 'remove the payment from the bill (the product posts the reversing journal)' };
    }
    case 'journal_entry': case 'accrual': {
      const route = findRoute(map, 'POST', 'transactions journal create', /\/transactions$/) || (p.method === 'POST' && /\/transactions(\?|$)/.test(p.path || '') ? { method: 'POST', path: p.path.split('?')[0] } : null);
      if (!route) throw fail('no journal create route in the endpoint map');
      if (!biz) throw fail('no business id on the proposal or the request');
      const route2 = fill(route.path, { businessId: biz });
      allowed(map, 'POST', route2);
      return { method: 'POST', path: `${route2}?glJournal=true`, body: reversingLines(p, { by, reason, requestId: req.id }), how: 'post a reversing journal dated today' };
    }
    case 'vendor': case 'customer': {
      const route = findRoute(map, 'PUT', `${kind} update`, new RegExp(`/${kind}/:[A-Za-z0-9_]+$`));
      if (!route) throw fail(`no ${kind} update route in the endpoint map to deactivate with`);
      if (!p.appliedRef.id) throw fail(`no ${kind} id was returned when it was created`);
      const route2 = fill(route.path, { id: p.appliedRef.id, [`${kind}Id`]: p.appliedRef.id });
      allowed(map, 'PUT', route2);
      return { method: 'PUT', path: route2, body: { status: 'inactive', notes: memoFor(by, reason, req.id, p.id) }, how: `deactivate the ${kind} (never deleted)` };
    }
    default:
      throw fail(`no reversal path for kind ${kind || '(none)'}; undo it in Dime and note it on the request`);
  }
}

/** Pure: may this proposal be reversed now? */
function reversible(p, { now = Date.now(), windowDays = WINDOW_DAYS } = {}) {
  if (!p) return { ok: false, why: 'no such proposal' };
  if (p.status === 'reversed') return { ok: false, why: `already reversed by ${p.reversedBy || '?'} on ${String(p.reversedAt || '').slice(0, 10)}` };
  if (p.status !== 'applied') return { ok: false, why: `${p.id} is ${p.status}, not applied` };
  const at = Date.parse((p.appliedRef && p.appliedRef.at) || p.appliedAt || '');
  if (!Number.isFinite(at)) return { ok: false, why: 'no applied time recorded' };
  if (now - at > windowDays * DAY_MS) return { ok: false, why: `the ${windowDays}-day reversal window has passed` };
  return { ok: true, why: null };
}

function appendNote(id, note) { fs.appendFileSync(NOTES_FILE(id), `${JSON.stringify({ at: new Date().toISOString(), ...note })}\n`); }
function notes(id) { try { return fs.readFileSync(NOTES_FILE(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

/** Undo one applied proposal. Throws (nothing called) when it cannot; blocks the request on a product refusal. */
async function reverse(requestId, pid, by, reason, { call = D.call, now = Date.now() } = {}) {
  if (!by || !String(by).trim()) throw fail('--by <name> is required: the reversal records who asked');
  if (!reason || !String(reason).trim()) throw fail('a reason is required: it goes on the reversing entry and the knowledge note');
  by = String(by).trim(); reason = String(reason).trim();
  const req = T.loadRequest(requestId);
  const p = PR.load(requestId).items.find((x) => x.id === pid);
  const ok = reversible(p, { now }); if (!ok.ok) throw fail(ok.why);
  if (M.POLICY().writesEnabled === false) throw fail('writes are disabled on this desk (config/policy.json writesEnabled=false)');
  const map = M.load();
  const inv = inverseCall(p, req, map, { by, reason });
  const r = await call({ backend: req.backend, request: req, method: inv.method, path: inv.path, body: inv.body });
  R.append(requestId, { method: inv.method, path: inv.path, url: r.url, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: 'reverse', purpose: `reverse ${pid} (${p.kind}): ${inv.how}`, proposal: pid, by });
  if (!r.ok) {
    const msg = D.humanize(r.status, r.json);
    T.addComment(requestId, { author: by, stage: req.status, body: `⚠ could not reverse ${pid}: ${msg}` });
    const fresh = T.loadRequest(requestId); fresh.blocked = { stage: 'reverse', agent: null, kind: 'stage', gap: 'change', reason: `change: reversal of ${pid} refused by the product: ${msg}` }; if (!['done', 'cancelled'].includes(fresh.status)) fresh.status = 'blocked'; T.saveRequest(fresh);
    throw Object.assign(new Error(`Dime refused the reversal: ${msg}`), { status: r.status });
  }
  const ref = { id: require('./apply').refOf(r.json), route: `${inv.method} ${inv.path}`, status: r.status, at: new Date().toISOString(), how: inv.how };
  const it = PR.markReversed(requestId, pid, { by, reason, reversalRef: ref });
  const fresh = T.loadRequest(requestId);
  fresh.proposals = PR.load(requestId).items.map((x) => ({ id: x.id, status: x.status, by: x.reviewedBy || null, at: x.reviewedAt || null, appliedRef: x.appliedRef || null }));
  fresh.reversals = [...(fresh.reversals || []), { proposal: pid, by, reason, at: ref.at, ref }];
  T.saveRequest(fresh);
  T.addComment(requestId, { author: by, stage: fresh.status, body: `reversed ${pid} (${p.kind}, ${inv.how}): ${reason}${ref.id ? ` → ${ref.id}` : ''}` });
  appendNote(requestId, { subject: `${p.kind}${fresh.recipeId ? ` · ${fresh.recipeId}` : ''}${req.client && req.client.businessName ? ` · ${req.client.businessName}` : ''}`, kind: 'gotcha', body: reason, proposal: pid, request: requestId, by, summary: p.summary || null });
  const EV = require('./events'); EV.emit('reverse', { request: requestId, proposal: pid, kind: p.kind, by });
  return { proposal: it, call: inv, ref };
}

module.exports = { reverse, reversible, inverseCall, reversingLines, memoFor, notes, WINDOW_DAYS, NOTES_FILE };
