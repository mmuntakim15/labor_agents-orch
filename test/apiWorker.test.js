'use strict';
// The desk as a worker of the Dime API: it claims what people did in the app, acts on it through the same functions
// its own page uses, and reports the client view and the files back. The API here is a stand-in that speaks the
// internal contract (ms-university routes/internal/requestDesk.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { sandbox, writeTestMap } = require('./helpers');
sandbox('apiworker');
process.env.LAB_CHROME = path.join(__dirname, 'fixtures', 'fake-chrome.js');
const UI = require('../dashboard/server');
const { createWorker } = require('../dashboard/apiWorker');
const T = require('../src/request');

const TOKEN = 'shared-secret-for-tests';
const started = []; const logs = [];
let api; let base; let desk; let worker; let restoreMap;
// What the stand-in API holds
const queue = []; const settled = []; const states = new Map(); const files = new Map(); const attachments = new Map([['f1', { name: 'old-aging.xlsx', contentBase64: Buffer.from('workbook').toString('base64') }]]);
let unauthorized = 0; let beats = 0;

test.before(async () => {
  restoreMap = writeTestMap().restore;
  api = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(o ? JSON.stringify(o) : undefined); };
    if (req.headers['x-request-desk-token'] !== TOKEN) { unauthorized += 1; return send(401, { error: 'Not authorized' }); }
    const p = req.url.replace('/api/v1/internal/request-desk', ''); let m;
    if (p === '/workers/register') return send(200, { registered: true });
    if (/^\/workers\/[^/]+\/heartbeat$/.test(p)) { beats += 1; return send(200, { ok: true }); }
    if (p === '/commands/claim') { const job = queue.shift(); return job ? send(200, job) : send(204); }
    if ((m = /^\/commands\/([^/]+)\/(resolve|fail)$/.exec(p))) { settled.push({ id: m[1], how: m[2], ...body }); return send(200, { ok: true }); }
    if ((m = /^\/files\/([^/]+)$/.exec(p))) { const f = attachments.get(m[1]); return f ? send(200, f) : send(404, { error: 'No such file' }); }
    if ((m = /^\/requests\/([^/]+)\/state$/.exec(p))) { states.set(m[1], body); return send(200, { ok: true, files: [...files.entries()].filter(([k]) => k.startsWith(`${m[1]}:`)).map(([k, v]) => ({ role: v.role, name: k.split(':').slice(2).join(':'), sha: v.sha })) }); }
    if ((m = /^\/requests\/([^/]+)\/files$/.exec(p))) { const sha = require('crypto').createHash('sha256').update(Buffer.from(body.contentBase64, 'base64')).digest('hex'); files.set(`${m[1]}:${body.role}:${body.name}`, { role: body.role, sha, bytes: Buffer.from(body.contentBase64, 'base64') }); return send(200, { ok: true, sha }); }
    return send(404, { error: 'not found' });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${api.address().port}`;
  desk = UI.createServer({ startRun: (id) => started.push(id), activeOf: () => ({ active: false, pid: null, agent: null, since: null }), key: 'k', doctor: async () => [] });
  await new Promise((r) => desk.listen(0, '127.0.0.1', r));
  worker = createWorker(desk.hooks, { baseUrl: base, token: TOKEN, log: (l) => logs.push(l), workerId: 'test-desk' });
});
test.after(() => { api.close(); desk.close(); restoreMap(); });

const job = (type, payload = {}, over = {}) => ({ command: { id: `c${queue.length + settled.length + 1}`, type, payload, by: { id: 'u1', name: 'Jake' } }, request: { id: 'api-1', ref: 'REQ-9', deskId: null, businessId: '6ac61eb5bdc8011894efa2c4', title: 'AR over 60 days', body: 'AR over 60 days as of October 31, 2026 for balances &lt; 500', kind: null, ...over }, files: [] });

test('a request sent in the app becomes a desk request under the person\'s name, scoped to the client, with its attachment', async () => {
  queue.push({ ...job('create'), files: [{ id: 'f1', name: 'old-aging.xlsx' }] });
  await worker.tick();
  assert.equal(settled.length, 1); assert.equal(settled[0].how, 'resolve');
  const id = settled[0].deskId; const t = T.loadRequest(id);
  assert.equal(t.reporter, 'Jake'); assert.deepEqual(t.subject.businessIds, ['6ac61eb5bdc8011894efa2c4']); assert.deepEqual(t.api, { id: 'api-1', ref: 'REQ-9' });
  assert.match(t.body, /balances < 500/); // the API's escaping is undone before an agent reads it
  assert.equal(fs.readFileSync(path.join(T.artifactsDir(id), 'attachments', 'old-aging.xlsx'), 'utf8'), 'workbook');
  assert.deepEqual(started, [id]);
  // and its state is reported at once, in the client's words, with no cost or agent names
  const st = states.get('api-1'); assert.equal(st.deskId, id); assert.equal(st.status, 'intake'); assert.equal(st.detail.thread[0].k, 'you');
  assert.doesNotMatch(JSON.stringify(st), /costUsd|estimateUsd|agentLabel|guardDenials|evaluator|"path"/);
});

test('a create claimed twice does not make a second request', async () => {
  const before = T.listRequests().length;
  queue.push(job('create')); await worker.tick();
  assert.equal(T.listRequests().length, before); assert.equal(settled[1].how, 'resolve'); assert.equal(settled[1].deskId, settled[0].deskId);
});

test('a person\'s approval, reply and cancel are applied under their name; an impossible one is failed with the reason', async () => {
  const id = settled[0].deskId; const t = T.loadRequest(id);
  t.status = 'awaiting_gate_1'; t.kind = 'report'; t.size = 'M'; t.scoped = true; T.saveRequest(t); T.writeArtifact(id, 'plan.json', JSON.stringify({ steps: [], calls: [], writes: [] }));
  queue.push(job('message', { text: 'use invoice date', interrupt: false }, { deskId: id })); await worker.tick();
  assert.ok(T.listComments(id).some((c) => c.author === 'Jake' && /use invoice date/.test(c.body)));
  queue.push(job('approve', { gate: 1, note: 'go ahead' }, { deskId: id })); await worker.tick();
  const after = T.loadRequest(id); assert.equal(after.gates[1].approved, true); assert.equal(after.gates[1].by, 'Jake');
  queue.push(job('approve', { gate: 2, note: '' }, { deskId: id })); await worker.tick();
  const last = settled[settled.length - 1]; assert.equal(last.how, 'fail'); assert.ok(last.error);
  queue.push(job('cancel', { reason: 'no longer needed' }, { deskId: id })); await worker.tick();
  assert.equal(T.loadRequest(id).status, 'cancelled'); assert.equal(states.get('api-1').status, 'cancelled');
});

test('what the desk delivers is uploaded as the files a person opens: workbook as is, memo and summary as PDF, once', async () => {
  queue.push(job('create', {}, { id: 'api-2', ref: 'REQ-10' })); await worker.tick();
  const id = settled[settled.length - 1].deskId; const t = T.loadRequest(id);
  t.status = 'done'; t.kind = 'report'; T.saveRequest(t);
  T.writeArtifact(id, 'summary.md', '# Done\n\nNet income 12,418.22 per verify.md'); T.writeArtifact(id, 'deliverables/flux.xlsx', require('../src/xlsx').writeXlsx([{ name: 'S', rows: [['a', 1]] }])); T.writeArtifact(id, 'deliverables/flux-memo.md', '# memo');
  await worker.tick();
  const st = states.get('api-2'); assert.deepEqual(st.detail.deliverables.map((d) => [d.label, d.first]), [['flux-memo.pdf', false], ['flux.xlsx', true]]);
  assert.match(st.detail.summaryPlain, /the review notes/); // no working-file names reach the client
  assert.equal(files.get('api-2:deliverable:flux.xlsx').bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(files.get('api-2:deliverable:flux-memo.pdf').bytes.subarray(0, 4).toString(), '%PDF');
  assert.equal(files.get('api-2:summary:REQ-10-summary.pdf').bytes.subarray(0, 4).toString(), '%PDF');
  assert.ok(![...files.keys()].some((k) => /\.md$/.test(k)));
  const n = files.size; const pushes = states.size; states.delete('api-2'); await worker.tick();
  assert.equal(files.size, n); assert.equal(states.has('api-2'), false, 'an unchanged request is not reported again'); assert.ok(pushes);
});

test('the wrong token gets the desk nothing, and it says so once', async () => {
  const bad = createWorker(desk.hooks, { baseUrl: base, token: 'wrong', log: (l) => logs.push(l), workerId: 'bad-desk' });
  const n = unauthorized; await bad.tick(); await bad.tick();
  assert.ok(unauthorized > n); assert.equal(logs.filter((l) => /→ 401/.test(l)).length, 1);
});
