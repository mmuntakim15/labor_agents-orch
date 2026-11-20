'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox, fakeDime, writeTestMap } = require('./helpers');
sandbox('ui');
const UI = require('../dashboard/server');
const T = require('../src/request');
const O = require('../src/orchestrator');
const PR = require('../src/proposals');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const KEY = 'key-for-tests';
const started = []; const activeNow = new Set(); const notified = [];
let server; let base; let cookie = ''; let api; let restoreMap;
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });
const postJ = async (p, body) => { const r = await post(p, body); return { status: r.status, body: await r.json() }; };
const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers: { cookie, ...headers } }); const type = r.headers.get('content-type') || ''; return { status: r.status, type, etag: r.headers.get('etag'), disposition: r.headers.get('content-disposition'), body: r.status === 304 ? null : type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };

test.before(async () => {
  api = await fakeDime(); restoreMap = writeTestMap().restore;
  server = UI.createServer({ verifyDimeToken: async (t) => (t === 'dime-token-of-a-signed-in-user' ? { name: 'Jake' } : null), appOrigins: ['http://localhost:3000'], startRun: (id) => started.push(id), activeOf: (t) => (activeNow.has(t.id) ? { active: true, pid: null, agent: 'analyst', since: new Date(Date.now() - 60000).toISOString() } : { active: false, pid: null, agent: null, since: null }), notify: (n) => notified.push(n), doctor: async () => [{ ok: true, text: 'node 20' }], key: KEY, users: [] });
  await listen(server); base = `http://127.0.0.1:${server.address().port}`;
  const r = await post('/api/login', { key: KEY, name: 'Mo' }); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { server.close(); restoreMap(); await api.close(); });
test.beforeEach(() => { started.length = 0; notified.length = 0; activeNow.clear(); });

test('the page is served with the Dime shell and the BETA badge; sign-in is required for the API', async () => {
  const page = await get('/'); assert.equal(page.status, 200); const html = page.body.toString();
  assert.match(html, /Request Desk/); assert.match(html, /class="beta">BETA/); assert.match(html, /What do you need/);
  const css = (await get('/app.css')).body.toString(); assert.match(css, /--side: #0b1a21/); assert.match(css, /--accent: #2fb7c2/);
  const r = await fetch(`${base}/api/board`); assert.equal(r.status, 401);
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'wrong', name: 'x' }) }); assert.equal(bad.status, 401);
});

test('a chat-style post creates the request under the signed-in name, stores an xlsx attachment, and queues the run', async () => {
  const r = await post('/api/requests', { body: 'Flux for the last two months\n\nwith a memo', kind: 'report', attachments: [{ name: 'Screen Shot 1.png', data: PNG }, { name: 'gusto.xlsx', data: Buffer.from(require('../src/xlsx').writeXlsx([{ name: 'S', rows: [['a', 1]] }])).toString('base64') }] });
  assert.equal(r.status, 201); const d = await r.json();
  assert.equal(d.request.title, 'Flux for the last two months'); assert.equal(d.request.kind, 'report'); assert.equal(d.request.reporter, 'Mo');
  assert.deepEqual(d.request.attachments.map((a) => a.name), ['Screen-Shot-1.png', 'gusto.xlsx']);
  assert.deepEqual(started, [d.request.id]);
  const img = await get(`/api/requests/${d.request.id}/files/attachments/Screen-Shot-1.png`); assert.equal(img.type, 'image/png');
  const x = await get(`/api/requests/${d.request.id}/files/attachments/gusto.xlsx`); assert.match(x.disposition || '', /attachment/);
  const row = (await get('/api/board')).body.requests.find((t) => t.id === d.request.id);
  assert.equal(row.needs, 'queued' === row.needs ? 'queued' : row.needs); assert.equal(row.kind, 'report');
  const bad = await postJ('/api/requests', { body: 'x', kind: 'nonsense' }); assert.equal(bad.status, 400);
});

test('framed by the Dime app, the desk signs the person in without the key; anything else still needs it', async () => {
  const load = (headers) => fetch(`${base}/?embedded=1&user=Priya`, { headers });
  const ok = await load({ 'sec-fetch-dest': 'iframe', referer: 'http://localhost:3000/accountant/clients/details/ai-agents?id=1' });
  const c = (ok.headers.get('set-cookie') || '').split(';')[0]; assert.match(c, /^lab_ui_\d+=[a-f0-9]{48}$/);
  const me = await (await fetch(`${base}/api/session`, { headers: { cookie: c } })).json(); assert.equal(me.authed, true); assert.equal(me.name, 'Priya');
  assert.equal((await load({ 'sec-fetch-dest': 'iframe', referer: 'http://evil.example/' })).headers.get('set-cookie'), null);
  assert.equal((await load({ 'sec-fetch-dest': 'document', referer: 'http://localhost:3000/' })).headers.get('set-cookie'), null);
  assert.equal((await fetch(`${base}/`, { headers: { 'sec-fetch-dest': 'iframe', referer: 'http://localhost:3000/' } })).headers.get('set-cookie'), null);
});

test('the Dime web app calls the desk with the Dime sign-in token: allowed origin + valid token only', async () => {
  const app = { origin: 'http://localhost:3000', authorization: 'Bearer dime-token-of-a-signed-in-user' };
  const pre = await fetch(`${base}/api/board`, { method: 'OPTIONS', headers: { origin: app.origin, 'access-control-request-method': 'GET' } }); assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), app.origin);
  const b = await fetch(`${base}/api/board`, { headers: app }); assert.equal(b.status, 200); assert.equal(b.headers.get('access-control-allow-origin'), app.origin);
  const made = await fetch(`${base}/api/requests`, { method: 'POST', headers: { ...app, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'AR over 60 days', start: false, business: 'b1' }) });
  assert.equal(made.status, 201); assert.equal((await made.json()).request.reporter, 'Jake');
  assert.equal((await fetch(`${base}/api/board`, { headers: { origin: app.origin, authorization: 'Bearer some-other-token-that-dime-rejects' } })).status, 401);
  assert.equal((await fetch(`${base}/api/requests`, { method: 'POST', headers: { origin: 'http://evil.example', authorization: app.authorization, 'content-type': 'application/json' }, body: '{"body":"x"}' })).status, 403);
  assert.equal((await fetch(`${base}/api/requests`, { method: 'POST', headers: { origin: app.origin, cookie, 'content-type': 'application/json' }, body: '{"body":"x","start":false}' })).status, 403); // a cookie alone never works cross-origin
  assert.equal((await fetch(`${base}/api/board`, { method: 'OPTIONS', headers: { origin: 'http://evil.example' } })).status, 403);
});

test('a request sent from a client workspace carries that business as its subject; a bad id is refused', async () => {
  const r = await postJ('/api/requests', { body: 'Flux for the last two months', start: false, business: '6ac61eb5bdc8011894efa2c4', businessName: 'Widget Co' });
  assert.equal(r.status, 201); assert.deepEqual(r.body.request.subject, { businessIds: ['6ac61eb5bdc8011894efa2c4'], businessNames: ['Widget Co'] }); assert.deepEqual(r.body.summary.subject.ids, ['6ac61eb5bdc8011894efa2c4']);
  const P = require('../src/prompting'); assert.match(P.requestBlock({ request: T.loadRequest(r.body.request.id) }), /Client context: .*6ac61eb5bdc8011894efa2c4 \(Widget Co\).*Do not ask which entity/);
  assert.equal((await postJ('/api/requests', { body: 'x', start: false, business: '../etc' })).status, 400);
});

test('board, detail, etag 304, scope review and Gate 1 approval', async () => {
  const id = (await postJ('/api/requests', { body: 'Set up vendors from W-9s', start: false })).body.request.id;
  const t = T.loadRequest(id); t.status = 'awaiting_gate_1'; t.scoped = true; t.kind = 'data_task'; t.size = 'M'; t.writes = true; t.done = [{ id: 'D-1', text: 'one vendor per W-9', evaluator: 'proposals_balanced' }]; T.saveRequest(t);
  T.writeArtifact(id, 'plan.json', { size: 'M', calls: [{ method: 'GET', path: '/api/v1/accountant/reports/ap-aging/b1', purpose: 'aging' }], writes: [{ kind: 'vendor', tier: 'A', summary: 'create', count: 2 }], estimateUsd: 9, inputs: ['w9.pdf'], risks: ['date'] });
  T.writeArtifact(id, 'scope.md', '# Scope');
  const d = await get(`/api/requests/${id}`);
  assert.equal(d.body.summary.gate, 1); assert.equal(d.body.scope.hasPlan, true); assert.equal(d.body.scope.writes[0].count, 2); assert.equal(d.body.scope.calls[0].read, true); assert.equal(d.body.scope.done[0].evaluator, 'proposals_balanced');
  const again = await get(`/api/requests/${id}`, { 'if-none-match': d.etag }); assert.equal(again.status, 304);
  const board = await get('/api/board'); const row = board.body.requests.find((x) => x.id === id); assert.equal(row.needs, 'gate'); assert.equal(row.writes, true);
  const rej = await postJ(`/api/requests/${id}/reject`, { gate: 1, note: '' }); assert.equal(rej.status, 400);
  const ok = await postJ(`/api/requests/${id}/approve`, { gate: 1, note: 'go', role: 'approver' });
  assert.equal(ok.status, 200); assert.equal(ok.body.request.status, 'execute'); assert.equal(ok.body.request.gates[1].by, 'Mo'); assert.deepEqual(started, [id]);
});

test('Gate 2: proposals are shown with tiers and entries; decisions are recorded under the name; apply starts', async () => {
  const id = (await postJ('/api/requests', { body: 'accrue cleaning', start: false })).body.request.id;
  const t = T.loadRequest(id); t.status = 'awaiting_gate_2'; t.writes = true; t.kind = 'change_request'; T.saveRequest(t);
  PR.add(id, { kind: 'journal_entry', tier: 'B', summary: 'Accrue September cleaning', method: 'POST', path: '/api/v1/accountant/vendor', body: { amount: 2400 }, amount: 2400, entry: { lines: [{ account: 'Cleaning Expense', debit: 2400 }, { account: 'Accrued Liabilities', credit: 2400 }] } });
  PR.add(id, { kind: null, tier: 'C', summary: 'Capitalise the laptop?', question: 'Capitalise?' });
  const d = await get(`/api/requests/${id}`);
  assert.equal(d.body.proposals.length, 2); assert.equal(d.body.proposals[0].entry.balanced, true); assert.equal(d.body.proposals[0].tier, 'B'); assert.equal(d.body.proposals[1].question, 'Capitalise?'); assert.equal(d.body.proposals[1].summary, 'Capitalise the laptop?');
  const early = await postJ(`/api/requests/${id}/approve`, { gate: 2 }); assert.equal(early.status, 400); assert.match(early.body.error, /undecided/);
  let r = await postJ(`/api/requests/${id}/proposal`, { id: 'P-1', decision: 'approve', amount: '2450' }); assert.equal(r.status, 200); assert.equal(r.body.proposal.status, 'approved');
  r = await postJ(`/api/requests/${id}/proposal`, { id: 'P-2', decision: 'approve' }); assert.equal(r.status, 400, 'a question cannot be approved');
  r = await postJ(`/api/requests/${id}/proposal`, { id: 'P-2', decision: 'answer', note: 'expense it' }); assert.equal(r.status, 200);
  r = await postJ(`/api/requests/${id}/approve`, { gate: 2 }); assert.equal(r.status, 200); assert.equal(r.body.request.status, 'apply'); assert.deepEqual(started, [id]);
  const items = PR.load(id).items; assert.equal(items[0].amountApproved, 2450); assert.equal(items[0].reviewedBy, 'Mo');
  const ev = r.body.evidence.find((x) => x.key === 'proposals'); assert.match(ev.text, /1 approved/);
});

test('delivered: summary, deliverables with downloads, evidence page, send back; blocked: budget', async () => {
  const id = (await postJ('/api/requests', { body: 'flux', start: false })).body.request.id;
  const t = T.loadRequest(id); t.status = 'done'; t.kind = 'report'; t.size = 'S'; t.runs = [{ n: 1, stage: 'execute', agent: 'analyst', costUsd: 1.2, durationMs: 60000, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), status: 'ok', guardDenials: 0 }]; T.saveRequest(t);
  T.writeArtifact(id, 'summary.md', '# Done\n\nNet income 12,418.22'); T.writeArtifact(id, 'deliverables/report.xlsx', require('../src/xlsx').writeXlsx([{ name: 'S', rows: [['a', 1]] }])); T.writeArtifact(id, 'deliverables/memo.md', '# memo');
  require('../src/evidence').assemble(T.loadRequest(id));
  const d = await get(`/api/requests/${id}`);
  assert.equal(d.body.deliverables.length, 2); assert.match(d.body.summaryMd, /12,418.22/);
  // the workbook is what a report's requester opens first; the markdown memo is offered as a pdf
  assert.deepEqual(d.body.deliverables.map((f) => [f.name, f.format, f.first, f.asPdf]).sort(), [['memo.md', 'md', false, true], ['report.xlsx', 'xlsx', true, false]]);
  // the requester never sees a markdown name, a route or a tool: the memo is labelled as the pdf it opens as, sources are named as reports
  assert.equal(d.body.deliverables.find((f) => f.name === 'memo.md').label, 'memo.pdf');
  const as = d.body.assurance; assert.ok(as.some((r) => r.key === 'deliverables' && r.items.some((i) => i.text === 'memo.pdf'))); assert.doesNotMatch(JSON.stringify(as), /\/api\/|\.md\b|guard|allow list|GET |checks\.json/);
  T.addComment(id, { author: 'orchestrator', stage: 'deliver', body: '⚠ the guard stopped 1 tool call by Deliverer: Bash `ls /x`' }); T.addComment(id, { author: 'Deliverer', stage: 'deliver', body: 'I wrote `summary.md`.\n\n— Deliverer: Your flux is ready (R-6, R-7) in flux-memo.md. Size S, goes to the analyst.' }); T.addComment(id, { author: 'orchestrator', stage: 'deliver', body: '→ done (delivered)' });
  const th = (await get(`/api/requests/${id}`)).body.thread; assert.deepEqual(th.map((m) => m.k), ['you', 'desk', 'step']); assert.equal(th[1].text, 'Your flux is ready in flux-memo.pdf.'); assert.equal(th[2].status, 'done');
  assert.equal(UI.sourceName('GET /api/v1/accountant/reports/profit-and-loss-realtime/6ac61eb5bdc8011894efa2c4'), 'Profit and loss'); assert.equal(UI.sourceName('GET /api/v1/accountant/dashboard/businessList'), 'List of businesses');
  process.env.LAB_CHROME = path.join(__dirname, 'fixtures', 'fake-chrome.js');
  const pdf = await get(`/api/requests/${id}/files/deliverables/memo.md?as=pdf`); assert.equal(pdf.status, 200); assert.match(pdf.type, /application\/pdf/); assert.match(pdf.disposition, /inline; filename="memo\.pdf"/); assert.equal(pdf.body.slice(0, 4).toString(), '%PDF');
  const sum = await get(`/api/requests/${id}/files/summary.md?as=pdf&download=1`); assert.match(sum.disposition, /attachment; filename=".*-summary\.pdf"/);
  assert.equal((await get(`/api/requests/${id}/files/deliverables/report.xlsx?as=pdf`)).status, 400);
  // the Deliverer's mark wins over the default, and a draft with a rendered pdf of the same name is listed once
  T.writeArtifact(id, 'deliverables/memo.pdf', '%PDF-1.4 x'); T.writeArtifact(id, 'deliverables/manifest.json', JSON.stringify({ items: [], primary: { name: 'memo.md', why: 'they asked why' } }));
  const d2 = (await get(`/api/requests/${id}`)).body.deliverables; assert.deepEqual(d2.map((f) => f.name).sort(), ['memo.pdf', 'report.xlsx']); assert.equal(d2.find((f) => f.first).name, 'memo.pdf'); assert.equal(d2.find((f) => f.first).why, 'they asked why');
  fs.unlinkSync(path.join(T.artifactsDir(id), 'deliverables', 'memo.pdf')); fs.unlinkSync(path.join(T.artifactsDir(id), 'deliverables', 'manifest.json')); assert.ok(d.body.files.some((f) => f.path === 'evidence.html'));
  const ev = await get(`/api/requests/${id}/files/evidence.html`); assert.match(ev.type, /text\/html/); assert.match(ev.body.toString(), /Evidence for/);
  const md = await get(`/api/requests/${id}/files/deliverables/memo.md`); assert.match(md.type, /text\/plain/);
  const x = await get(`/api/requests/${id}/files/deliverables/report.xlsx?download=1`); assert.match(x.disposition, /report\.xlsx/);
  assert.equal((await get(`/api/requests/${id}/files/../request.json`)).status, 404);
  let r = await postJ(`/api/requests/${id}/sendback`, { note: '' }); assert.equal(r.status, 400);
  r = await postJ(`/api/requests/${id}/sendback`, { note: 'add the memo' }); assert.equal(r.status, 200); assert.equal(r.body.request.status, 'execute'); assert.equal(r.body.request.loops.verify, 1); assert.deepEqual(started, [id]);
  const b = (await postJ('/api/requests', { body: 'flux', start: false })).body.request.id;
  const bt = T.loadRequest(b); bt.status = 'blocked'; bt.size = 'S'; bt.blocked = { stage: 'execute', agent: 'analyst', kind: 'budget', reason: 'budget exhausted' }; bt.runs = [{ n: 1, stage: 'execute', agent: 'analyst', costUsd: 8, status: 'ok', startedAt: new Date().toISOString() }]; T.saveRequest(bt);
  const row = (await get('/api/board')).body.requests.find((x) => x.id === b); assert.equal(row.needs, 'blocked'); assert.equal(row.blocked.kind, 'budget');
  r = await postJ(`/api/requests/${b}/budget`, { usd: 20 }); assert.equal(r.status, 200); assert.equal(r.body.request.status, 'execute');
});

test('questions are answered from the conversation; stop and cancel; system views', async () => {
  const id = (await postJ('/api/requests', { body: 'which entity?', start: false })).body.request.id;
  const t = T.loadRequest(id); t.pendingQuestions = ['Which entity?']; T.saveRequest(t);
  let r = await postJ(`/api/requests/${id}/message`, { text: 'Acme Dental' }); assert.equal(r.status, 200); assert.equal(r.body.request.pendingQuestions.length, 0); assert.match(r.body.request.answers, /Acme Dental/); assert.deepEqual(started, [id]);
  activeNow.add(id);
  const d = await get(`/api/requests/${id}`); assert.equal(d.body.summary.active, true); assert.equal(d.body.summary.agentLabel, 'Analyst');
  activeNow.delete(id);
  r = await postJ(`/api/requests/${id}/cancel`, { reason: 'not needed' }); assert.equal(r.body.request.status, 'cancelled');
  const h = await get('/api/health'); assert.equal(h.body.rows[0].ok, true);
  const tr = await get('/api/trends'); assert.ok('zeroTouch' in tr.body); assert.ok('proposals' in tr.body);
  const p = await postJ(`/api/requests/${id}/nope`, {}); assert.equal(p.status, 404);
  const cors = await fetch(`${base}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'http://evil' }, body: '{}' }); assert.equal(cors.status, 403);
});

test('the export tool renders a markdown draft to pdf and marks the deliverable to open first', async () => {
  const { spawnSync } = require('child_process');
  const id = (await postJ('/api/requests', { body: 'why did payroll move', start: false })).body.request.id;
  T.writeArtifact(id, 'memo.md', '# Why payroll moved\n\nA new hire started.');
  const run = (...a) => { const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'export.js'), ...a, '--request', id], { env: { ...process.env, LAB_CHROME: path.join(__dirname, 'fixtures', 'fake-chrome.js') }, encoding: 'utf8' }); return { code: r.status, out: JSON.parse(r.stdout) }; };
  let r = run('first', '--name', 'answer.pdf'); assert.equal(r.code, 1); assert.match(r.out.error, /write it first/);
  r = run('pdf', '--name', 'answer.pdf', '--from', path.join(T.artifactsDir(id), 'memo.md')); assert.equal(r.code, 0, JSON.stringify(r.out));
  r = run('first', '--name', 'answer.pdf', '--why', 'the answer to the question'); assert.equal(r.code, 0);
  const m = JSON.parse(fs.readFileSync(path.join(T.artifactsDir(id), 'deliverables', 'manifest.json'), 'utf8')); assert.equal(m.primary.name, 'answer.pdf'); assert.equal(m.items.length, 1);
  const d = (await get(`/api/requests/${id}`)).body.deliverables; assert.deepEqual(d.map((f) => [f.name, f.first, f.why]), [['answer.pdf', true, 'the answer to the question']]);
});

