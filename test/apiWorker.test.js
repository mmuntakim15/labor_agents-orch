'use strict';
// The desk as a worker of the Dime API: it claims what people did in the app, acts on it through the same functions
// its own page uses, and reports the client view and the files back. The API here is a stand-in that speaks the
// internal contract (ms-university routes/internal/requestDesk.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { sandbox, writeTestMap, fakeDime } = require('./helpers');
sandbox('apiworker');
process.env.LAB_CHROME = path.join(__dirname, 'fixtures', 'fake-chrome.js');
const UI = require('../dashboard/server');
const { createWorker } = require('../dashboard/apiWorker');
const T = require('../src/request');

const TOKEN = 'shared-secret-for-tests';
const started = []; const logs = [];
let api; let base; let desk; let worker; let restoreMap; let dime;
// What the stand-in API holds
const queue = []; const settled = []; const states = new Map(); const files = new Map(); const attachments = new Map([['f1', { name: 'old-aging.xlsx', contentBase64: Buffer.from('workbook').toString('base64') }]]);
// RD-2 stores: worker registrations, entity setup rows, digests and policies the desk mirrored; the fake Dime's calls
const registrations = []; const setups = new Map(); const setupReads = []; const digestsPushed = new Map(); const policies = new Map(); let digestPushes = 0;
const digestPushCount = () => digestPushes; const dimeCalls = { filter: (fn) => dime.state.calls.filter(fn) };
let unauthorized = 0; let beats = 0;

test.before(async () => {
  restoreMap = writeTestMap().restore;
  dime = await fakeDime();
  api = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(o ? JSON.stringify(o) : undefined); };
    if (req.headers['x-request-desk-token'] !== TOKEN) { unauthorized += 1; return send(401, { error: 'Not authorized' }); }
    const p = req.url.replace('/api/v1/internal/request-desk', ''); let m;
    if (p === '/workers/register') { registrations.push(body); return send(200, { registered: true }); }
    if ((m = /^\/setup\/([^/?]+)(\?.*)?$/.exec(p))) { setupReads.push(p); const s = setups.get(m[1]); return s ? send(200, s) : send(404, { error: 'No setup for this entity' }); }
    if (p === '/digest') { if (!body.businessId || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !body.digest) return send(422, { error: 'bad digest' }); digestsPushed.set(`${body.businessId}:${body.date}`, body.digest); digestPushes += 1; return send(200, { ok: true }); }
    if ((m = /^\/policy\/([^/]+)$/.exec(p))) { if (typeof body.writesEnabled !== 'boolean') return send(422, { error: 'writesEnabled must be true or false' }); policies.set(m[1], body); return send(200, { ok: true }); }
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
test.after(async () => { api.close(); desk.close(); restoreMap(); await dime.close(); });

const job = (type, payload = {}, over = {}) => ({ command: { id: `c${queue.length + settled.length + 1}`, type, payload, by: { id: 'u1', name: 'Jake' } }, request: { id: 'api-1', ref: 'REQ-9', deskId: null, businessId: '6ac61eb5bdc8011894efa2c4', title: 'AR over 60 days', body: 'AR over 60 days as of October 31, 2026 for balances &lt; 500', kind: null, recipeId: null, origin: { kind: 'manual', scheduleId: null, period: null }, system: false, ...over }, files: [] });

test('a request sent in the app becomes a desk request under the person\'s name, scoped to the client, with its attachment', async () => {
  queue.push({ ...job('create'), files: [{ id: 'f1', name: 'old-aging.xlsx' }] });
  await worker.tick();
  assert.equal(settled.length, 1); assert.equal(settled[0].how, 'resolve');
  const id = settled[0].deskId; const t = T.loadRequest(id);
  assert.equal(t.reporter, 'Jake'); assert.deepEqual(t.subject.businessIds, ['6ac61eb5bdc8011894efa2c4']); assert.deepEqual(t.api, { id: 'api-1', ref: 'REQ-9' });
  assert.match(t.body, /balances < 500/); // the API's escaping is undone before an agent reads it
  assert.equal(fs.readFileSync(path.join(T.artifactsDir(id), 'attachments', 'old-aging.xlsx'), 'utf8'), 'workbook');
  assert.deepEqual(started, [id]);
  // and its state is reported at once, in the client's words, with no cost or agent names in the view (the eleven RD-2 metrics, costUsd among them, travel on their own key for the metrics route)
  const st = states.get('api-1'); assert.equal(st.deskId, id); assert.equal(st.status, 'intake'); assert.equal(st.detail.thread[0].k, 'you');
  assert.doesNotMatch(JSON.stringify({ summary: st.summary, detail: st.detail }), /costUsd|estimateUsd|agentLabel|guardDenials|evaluator|"path"/);
  assert.deepEqual(Object.keys(st.metrics).sort(), ['autoApplied', 'costUsd', 'humanWaitMs', 'questionsAsked', 'reversed', 'runs', 'setupHits', 'touches', 'verifierReproduced', 'verifierTotal', 'wallMs']); assert.equal(st.level, 'L3'); assert.equal(st.recipeId, null);
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

// ---------------------------------------------------------------- RD-2: recipes, setup, inputs, reverse, policy, digest, library registration
const PR = require('../src/proposals');
const POL = require('../src/policy');
process.env.LAB_POLICY_DIR = path.join(process.env.LAB_RUNS_DIR, 'policy');
const BIZ = '6ac61eb5bdc8011894efa2c4';

test('registration carries the recipe library and the map stamp', async () => {
  const w = createWorker(desk.hooks, { baseUrl: base, token: TOKEN, log: () => {}, workerId: 'lib-desk', library: () => [{ id: 'R56', version: 1, title: 'Payments to bills' }], mapStamp: () => '2026-11-24T02:17:30.483Z' });
  await w.tick();
  const reg = registrations.find((r) => r.workerId === 'lib-desk');
  assert.deepEqual(reg.library, [{ id: 'R56', version: 1, title: 'Payments to bills' }]); assert.equal(reg.mapStamp, '2026-11-24T02:17:30.483Z');
  assert.ok(registrations.find((r) => r.workerId === 'test-desk'), 'the default worker registered too');
});

test('a scheduled create carries the recipe, the period and the origin, and the entity setup is read once for intake', async () => {
  setups.set(BIZ, { businessId: BIZ, recipeId: 'R56', entity: { answers: { apAccounts: ['2000'] }, inputs: [], version: 2 }, recipe: { answers: { threshold: 500 }, inputs: [], version: 1 }, files: [] });
  queue.push(job('create', { recipeId: 'R56', period: '2026-10' }, { id: 'api-3', ref: 'REQ-11', title: 'Bank payments coded to expense', body: 'R56', recipeId: 'R56', origin: { kind: 'schedule', scheduleId: 'sch-1', period: '2026-10' } }));
  await worker.tick();
  const id = settled[settled.length - 1].deskId; const t = T.loadRequest(id);
  assert.equal(t.recipeId, 'R56'); assert.equal(t.period, '2026-10'); assert.deepEqual(t.origin, { kind: 'schedule', scheduleId: 'sch-1', period: '2026-10' });
  assert.deepEqual(t.setup.entity.answers, { apAccounts: ['2000'] }); assert.deepEqual(t.setup.recipe.answers, { threshold: 500 }); assert.ok(t.setupFetchedAt);
  assert.equal(setupReads.filter((x) => x.startsWith(`/setup/${BIZ}`) && /recipeId=R56/.test(x)).length, 1, 'read once, for this recipe');
  const st = states.get('api-3'); assert.equal(st.recipeId, 'R56'); assert.equal(st.level, 'L3'); assert.equal(typeof st.metrics.touches, 'number'); assert.deepEqual(Object.keys(st.detail).sort().slice(-3), ['summaryPlain', 'thread', 'tieout']); assert.deepEqual(st.detail.inputsNeeded, []);
  // an entity with no setup: 404 is not an error
  queue.push(job('create', { recipeId: 'R03' }, { id: 'api-4', ref: 'REQ-12', businessId: 'no-setup-biz' })); await worker.tick();
  assert.equal(settled[settled.length - 1].how, 'resolve'); assert.equal(T.loadRequest(settled[settled.length - 1].deskId).setup, undefined);
});

test('awaiting_input is reported with the inputs; a message with inputFor supplies one and the stage resumes', async () => {
  const id = T.listRequests().find((x) => x.api && x.api.id === 'api-3').id; const t = T.loadRequest(id);
  t.status = 'awaiting_input'; t.inputsStage = 'execute'; t.inputsNeeded = [{ name: 'October statement', period: '2026-10', why: 'closing balance', acceptedTypes: ['pdf'], askedAt: new Date().toISOString(), receivedAt: null, missing: false }]; T.saveRequest(t);
  await worker.tick();
  let st = states.get('api-3'); assert.equal(st.status, 'awaiting_input'); assert.deepEqual(st.detail.inputsNeeded.map((i) => [i.name, i.resolved]), [['October statement', false]]); assert.ok(st.detail.lane.includes('awaiting_input'));
  queue.push({ ...job('message', { text: 'here it is', inputFor: 'October statement' }, { id: 'api-3', deskId: id }), files: [{ id: 'f1', name: 'old-aging.xlsx' }] });
  await worker.tick();
  assert.equal(settled[settled.length - 1].how, 'resolve');
  const after = T.loadRequest(id); assert.equal(after.status, 'execute'); assert.equal(after.inputsNeeded[0].receivedFrom, 'Jake'); assert.deepEqual(after.inputsNeeded[0].files, ['old-aging.xlsx']); assert.equal(after.touches, 1);
  st = states.get('api-3'); assert.equal(st.detail.inputsNeeded[0].resolved, true);
  queue.push(job('message', { text: 'x', inputFor: 'nothing like that' }, { id: 'api-3', deskId: id })); await worker.tick();
  assert.equal(settled[settled.length - 1].how, 'fail'); assert.match(settled[settled.length - 1].error, /not an input/);
});

test('a reverse command undoes the applied change and the digest for the day shows it; a policy command writes the entity file and mirrors it with previews', async () => {
  const id = T.listRequests().find((x) => x.api && x.api.id === 'api-3').id; const t = T.loadRequest(id); t.status = 'done'; T.saveRequest(t);
  const { proposal } = PR.add(id, { kind: 'transaction_categorization', tier: 'A', summary: 'Recode t-9 to Software', method: 'PUT', path: `/api/v1/transactions/accounting/businessId/${BIZ}/transactionId/t-9`, body: { accounting_category: 'Software' }, previous: { accounting_category: 'Office Supplies' } });
  PR.decideByPolicy(id, proposal.id, { version: 1, reason: 'exact' }); PR.markApplied(id, proposal.id, { appliedRef: { id: 't-9', at: new Date().toISOString(), by: 'policy@v1' } });
  await worker.tick();
  const today = new Date().toISOString().slice(0, 10);
  let dg = digestsPushed.get(`${BIZ}:${today}`); assert.ok(dg, 'the digest was pushed'); assert.equal(dg.applied.length, 1); assert.equal(dg.applied[0].reversible, true); assert.equal(dg.file, undefined, 'the desk path stays on the desk');
  const n = digestPushCount(); await worker.tick(); assert.equal(digestPushCount(), n, 'an unchanged digest is not pushed again');
  queue.push(job('reverse', { proposalId: proposal.id, reason: 'it was office supplies' }, { id: 'api-3', deskId: id })); await worker.tick();
  assert.equal(settled[settled.length - 1].how, 'resolve');
  assert.equal(PR.load(id).items[0].status, 'reversed'); assert.equal(dimeCalls.filter((c) => c.method === 'PUT' && /transactionId\/t-9$/.test(c.path)).length, 1);
  dg = digestsPushed.get(`${BIZ}:${today}`); assert.equal(dg.applied[0].status, 'reversed'); assert.equal(dg.totals.reversed, 1);
  queue.push(job('reverse', { proposalId: proposal.id, reason: 'again' }, { id: 'api-3', deskId: id })); await worker.tick();
  assert.equal(settled[settled.length - 1].how, 'fail'); assert.match(settled[settled.length - 1].error, /already reversed/);
  // policy: rides the hidden entity row (no deskId, system true)
  queue.push(job('policy', { writesEnabled: false }, { id: 'api-policy', ref: 'REQ-0', deskId: null, system: true, title: 'Policy' })); await worker.tick();
  const last = settled[settled.length - 1]; assert.equal(last.how, 'resolve'); assert.equal(last.deskId, undefined, 'no desk request is tied to the entity row');
  const f = POL.load(BIZ); assert.equal(f.writesEnabled, false); assert.equal(f.changedBy, 'Jake'); assert.equal(f.version, 1);
  const mirrored = policies.get(BIZ); assert.equal(mirrored.writesEnabled, false); assert.equal(mirrored.version, 1); assert.equal(mirrored.changedBy, 'Jake'); assert.ok(Array.isArray(mirrored.alwaysHuman)); assert.equal(typeof mirrored.preview.on.items, 'number'); assert.equal(typeof mirrored.preview.off.items, 'number');
  queue.push(job('policy', { writesEnabled: true }, { id: 'api-policy', ref: 'REQ-0', deskId: null, system: true })); await worker.tick();
  assert.equal(POL.load(BIZ).writesEnabled, true); assert.equal(policies.get(BIZ).version, 2);
});
