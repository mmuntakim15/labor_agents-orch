'use strict';
// The desk as a worker of the Dime API.
//
// When the desk is used from the Dime web app, the API is the record a screen
// reads and the desk never serves a browser. This loop is the desk's whole
// conversation with the API, and every call goes outward (the desk can sit
// behind NAT):
//   1. claim what people asked for (a new request, a reply, an approval, a cancel) and act on it
//      through the same functions the desk's own page uses;
//   2. report where each request stands, in the client's words;
//   3. upload what it delivers (workbooks, PDFs, the summary as a PDF).
// A person's decision only ever arrives as a command they issued in the app, under their name.
//
// Configuration: the API's address is the Dime backend the desk already works against (or LAB_API_URL / config
// dashboard.api.baseUrl); the shared secret is LAB_API_TOKEN (or dashboard.local.json api.token, git-ignored).
// No token, no worker.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const PKG = require(path.join(ROOT, 'package.json'));

const TICK_MS = 2000;
const HEARTBEAT_MS = 15000;
// The board row, limited to what a client screen shows. Cost, run counts and agent names stay on the desk.
const SUMMARY_FIELDS = ['status', 'statusLabel', 'kind', 'writes', 'active', 'since', 'needs', 'gate', 'questions', 'wait', 'deliverables', 'attachments', 'parentId', 'children', 'loops', 'lastStage', 'wallMin', 'proposals', 'budgetUsd', 'runs'];
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// The API escapes "<" in text it receives; put it back so an agent reads what the person wrote.
const plain = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<');

/** What the API stores about one request: the client view only. */
function viewOf(d) {
  const s = d.summary; const summary = {};
  for (const k of SUMMARY_FIELDS) if (s[k] !== undefined) summary[k] = s[k];
  summary.subject = { names: (s.subject || {}).names || [], periods: (s.subject || {}).periods || [] };
  if (s.blocked) summary.blocked = { kind: s.blocked.kind, stage: s.blocked.stage };
  return {
    deskId: d.request.id, status: s.status, summary,
    detail: {
      request: { pendingQuestions: d.request.pendingQuestions || [], cancelled: d.request.cancelled ? { by: d.request.cancelled.by, reason: d.request.cancelled.reason, from: d.request.cancelled.from } : null },
      lane: d.lane, thread: d.thread, scope: d.scope ? { done: d.scope.done.map((x) => ({ id: x.id, text: x.text })), calls: d.scope.calls.map((c) => ({ read: Boolean(c.read) })), writes: d.scope.writes.map((w) => ({ kind: w.kind, count: w.count, summary: w.summary })), questions: d.scope.questions, risks: d.scope.risks, inputs: d.scope.inputs, children: d.scope.children } : null,
      proposals: (d.proposals || []).map((p) => ({ id: p.id, tier: p.tier, kind: p.kind, summary: p.summary, status: p.status, reviewedBy: p.reviewedBy, entry: p.entry || null, amount: p.amount, appliedRef: p.appliedRef ? { at: p.appliedRef.at } : null, error: p.error || null, note: p.note || null })),
      deliverables: d.deliverables.map((f) => ({ label: f.label, first: Boolean(f.first), why: f.why || '' })),
      assurance: d.assurance, summaryPlain: d.summaryPlain, canStop: Boolean(d.canStop), canEdit: Boolean(d.canEdit),
    },
  };
}

function createWorker(hooks, { baseUrl, token, log = () => {}, fetchImpl = fetch, workerId = `${os.hostname()}-${process.pid}` }) {
  const base = `${String(baseUrl).replace(/\/+$/, '')}/api/v1/internal/request-desk`;
  const pushed = new Map(); // desk id → hash of the last view the API accepted
  let lastBeat = 0; let running = false; let timer = null; let registered = false;

  async function api(method, p, body) {
    const res = await fetchImpl(`${base}${p}`, { method, headers: { 'x-request-desk-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${json.error || ''}`.trim());
    return json;
  }
  const linked = () => T.listRequests().filter((t) => t.api && t.api.id);
  const deskIdFor = (apiId) => { const t = linked().find((x) => x.api.id === apiId); return t ? t.id : null; };
  async function attachmentsOf(files) {
    const out = [];
    for (const f of files || []) { const r = await api('GET', `/files/${f.id}`); out.push({ name: r.name, data: r.contentBase64 }); }
    return out;
  }

  /** Act on one thing a person did. Throws when it cannot be done; the command is then failed with the reason. */
  async function handle({ command, request, files }) {
    const by = (command.by && command.by.name) || 'Accountant'; const p = command.payload || {};
    let id = request.deskId || deskIdFor(request.id);
    if (command.type === 'create') {
      if (!id) { // a create claimed twice (the desk died after acting) must not make a second request
        const t = hooks.createFromBody({ title: plain(request.title), body: plain(request.body), kind: p.kind || undefined, business: request.businessId, attachments: await attachmentsOf(files), start: true }, by);
        t.api = { id: request.id, ref: request.ref }; T.saveRequest(t); id = t.id;
      }
      return id;
    }
    if (!id) throw new Error('the desk has no such request');
    if (command.type === 'message') hooks.act('message', id, { text: plain(p.text), attachments: await attachmentsOf(files), interrupt: Boolean(p.interrupt) }, by);
    else if (command.type === 'approve') hooks.act('approve', id, { gate: p.gate, role: 'approver', note: plain(p.note) }, by);
    else if (command.type === 'reject') hooks.act('reject', id, { gate: p.gate, note: plain(p.note) }, by);
    else if (command.type === 'proposal') hooks.act('proposal', id, { id: p.id, decision: p.decision, note: plain(p.note), amount: p.amount, body: null }, by);
    else if (command.type === 'sendback') hooks.act('sendback', id, { note: plain(p.note) }, by);
    else if (command.type === 'cancel') hooks.act('cancel', id, { reason: plain(p.reason) }, by);
    else if (command.type === 'amend') hooks.act('amend', id, { title: plain(p.title), body: plain(p.body) }, by);
    else if (command.type === 'budget') hooks.act('budget', id, { usd: p.usd }, by);
    else hooks.act(command.type, id, {}, by); // retry, run, stop, loop
    return id;
  }

  async function claimAll() {
    for (let n = 0; n < 20; n += 1) {
      const job = await api('POST', '/commands/claim', { workerId });
      if (!job) return;
      try { const deskId = await handle(job); await api('POST', `/commands/${job.command.id}/resolve`, { deskId }); pushed.delete(deskId); log(`api: ${job.command.type} on ${job.request.ref} by ${(job.command.by || {}).name || '?'}`); }
      catch (e) { log(`api: ${job.command.type} on ${job.request.ref} failed: ${e.message}`); await api('POST', `/commands/${job.command.id}/fail`, { error: e.message }).catch(() => {}); }
    }
  }

  /** The bytes a person receives for one deliverable: a markdown draft goes out as the PDF it is shown as. */
  async function bytesOf(id, f) { return fs.readFileSync(f.asPdf ? await hooks.pdfOf(id, f.path) : path.join(T.artifactsDir(id), f.path)); }

  async function syncOne(t) {
    const d = hooks.detail(t.id); const view = viewOf(d); const hash = sha256(Buffer.from(JSON.stringify(view)));
    if (pushed.get(t.id) === hash) return;
    const r = await api('POST', `/requests/${t.api.id}/state`, view);
    const have = new Map(((r && r.files) || []).map((f) => [`${f.role}:${f.name}`, f.sha]));
    for (const f of d.deliverables) {
      const buf = await bytesOf(t.id, f);
      if (have.get(`deliverable:${f.label}`) !== sha256(buf)) await api('POST', `/requests/${t.api.id}/files`, { role: 'deliverable', name: f.label, contentBase64: buf.toString('base64') });
    }
    if (d.summaryPlain) {
      try { const buf = fs.readFileSync(await hooks.pdfOf(t.id, 'summary.md')); const name = `${t.api.ref || t.id}-summary.pdf`; if (have.get(`summary:${name}`) !== sha256(buf)) await api('POST', `/requests/${t.api.id}/files`, { role: 'summary', name, contentBase64: buf.toString('base64') }); } catch (e) { log(`api: summary pdf for ${t.id} not sent: ${e.message}`); }
    }
    pushed.set(t.id, hash);
  }

  async function tick() {
    if (running) return; running = true;
    try {
      if (!registered) { await api('POST', '/workers/register', { workerId, host: os.hostname(), version: PKG.version }); registered = true; lastBeat = Date.now(); log(`api: desk registered with ${baseUrl} as ${workerId}`); }
      else if (Date.now() - lastBeat > HEARTBEAT_MS) { await api('POST', `/workers/${encodeURIComponent(workerId)}/heartbeat`, {}); lastBeat = Date.now(); }
      await claimAll();
      for (const t of linked()) { try { await syncOne(t); } catch (e) { log(`api: could not report ${t.id}: ${e.message}`); } }
    } catch (e) { if (registered || !tick.warned) log(`api: ${e.message}`); tick.warned = true; registered = registered && !/→ 401|→ 503/.test(e.message); }
    finally { running = false; }
  }

  return { tick, start() { timer = setInterval(tick, TICK_MS); timer.unref(); tick(); return this; }, stop() { if (timer) clearInterval(timer); timer = null; }, viewOf };
}

/** Start the worker when a token is configured. Returns null (and says nothing) when the desk is used on its own. */
function startFromConfig(hooks, cfg = {}, log = console.log) {
  const api = cfg.api || {};
  const token = process.env.LAB_API_TOKEN || api.token || '';
  if (!token) return null;
  let baseUrl = process.env.LAB_API_URL || api.baseUrl || '';
  if (!baseUrl) { try { baseUrl = require(path.join(ROOT, 'src', 'dime')).backend().apiBaseUrl; } catch { baseUrl = ''; } }
  if (!baseUrl) { log('api: LAB_API_TOKEN is set but there is no API address (LAB_API_URL)'); return null; }
  return createWorker(hooks, { baseUrl, token, log }).start();
}

module.exports = { createWorker, startFromConfig, viewOf };
