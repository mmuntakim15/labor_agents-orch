'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sandbox, writeTestMap } = require('./helpers');
sandbox('units');
const T = require('../src/request');
const G = require('../hooks/guard');
const X = require('../src/xlsx');
const M = require('../src/map');
const PR = require('../src/proposals');
const PL = require('../src/plan');
const R = require('../src/receipts');
const DN = require('../src/done');
const C = require('../src/claude');
const E = require('../src/eval');
const K = require('../src/knowledge');

test('request store: create, comments, artifacts, listing', () => {
  const r = T.createRequest({ title: 'Flux for Aug and Sep', body: 'please', reporter: 'Mo' });
  assert.match(r.id, /^REQ-\d+$/); assert.equal(r.status, 'intake'); assert.equal(r.gates[2].approved, false);
  T.writeArtifact(r.id, 'data/x.json', { a: 1 }); T.writeArtifact(r.id, 'work.md', 'hi');
  assert.deepEqual(T.listArtifacts(r.id).sort(), ['data/x.json', 'work.md']);
  assert.deepEqual(T.readJsonArtifact(r.id, 'data/x.json'), { a: 1 });
  assert.equal(T.readArtifact(r.id, '../request.json'), null, 'reads stay inside artifacts');
  assert.equal(T.listComments(r.id)[0].author, 'Mo');
  assert.ok(T.listRequests().some((x) => x.id === r.id));
});

test('guard: only the desk tools run; env, mongo, curl, git and node -e are denied; writes stay in roots', () => {
  const env = { LAB_WRITE_ROOTS: '/tmp/art', LAB_WRITE_DENY: JSON.stringify(['/verify\\.json$']) };
  const tools = G.TOOLS;
  assert.equal(G.decide({ tool_name: 'Bash', tool_input: { command: `node ${tools}/dime.js call --request REQ-1 --method GET --path /api/v1/x` } }, env).allow, true);
  for (const cmd of ['curl http://x', 'mongosh', 'node -e "1"', 'git status', 'cat config/config.env', 'ls', `node ${tools}/../src/dime.js`, 'npm test', 'open x']) assert.equal(G.decide({ tool_name: 'Bash', tool_input: { command: cmd } }, env).allow, false, cmd);
  assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/tmp/art/work.md' } }, env).allow, true);
  assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/tmp/elsewhere/x.md' } }, env).allow, false);
  assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/tmp/art/attachments/a.csv' } }, env).allow, false, 'attachments are read-only');
  assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/tmp/art/receipts.jsonl' } }, env).allow, false, 'receipts are read-only');
  assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/tmp/art/verify.json' } }, env).allow, false, 'per-agent write deny');
  assert.equal(G.decide({ tool_name: 'Edit', tool_input: { file_path: '/tmp/art/.env' } }, env).allow, false);
  assert.equal(G.decide({ tool_name: 'Read', tool_input: { file_path: '/anything' } }, env).allow, true, 'reads are never blocked by the guard');
});

test('xlsx: write then read back, formats, two sheets, inline strings with special characters', () => {
  const buf = X.writeXlsx([{ name: 'P&L <2026>', columns: [{ key: 'a', header: 'Account' }, { key: 'b', header: 'Amount', format: 'money' }, { key: 'c', header: 'Pct', format: 'percent' }], rows: [{ a: 'Rent & utilities', b: 4500.5, c: 0.1 }, { a: 'Payroll "x"', b: -12.25, c: 0 }] }, { name: 'Sources', header: ['R', 'Route'], rows: [['R-1', '/api/v1/x?a=1&b=2'], ['R-2', true]] }]);
  const back = X.readXlsx(buf);
  assert.equal(back.sheets.length, 2); assert.equal(back.sheets[0].name, 'P&L <2026>');
  assert.deepEqual(back.sheets[0].rows[0], ['Account', 'Amount', 'Pct']);
  assert.deepEqual(back.sheets[0].rows[1], ['Rent & utilities', 4500.5, 0.1]);
  assert.deepEqual(back.sheets[0].rows[2], ['Payroll "x"', -12.25, 0]);
  assert.deepEqual(back.sheets[1].rows[1], ['R-1', '/api/v1/x?a=1&b=2']); assert.equal(back.sheets[1].rows[2][1], true);
  assert.equal(X.colName(0), 'A'); assert.equal(X.colName(27), 'AB'); assert.equal(X.colIndex('AB'), 27);
});

test('map: catalogue parsing, code scan of a mini checkout, matching with params, policy denial', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-map-'));
  fs.mkdirSync(path.join(tmp, 'routes', 'accountant'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'controllers', 'accountant'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app.js'), `const r = require('./routes/accountant/reports');\napp.use('/api/v1/accountant/reports', r);\napp.use('/api/v1/accountant/flux', require('./routes/accountant/flux'));\n`);
  fs.writeFileSync(path.join(tmp, 'routes', 'accountant', 'reports.js'), `const { accountantProtect } = require('../../middleware/auth');\nconst { getARAgingReport } = require('../../controllers/accountant/reports');\nrouter.get('/ar-aging/:businessId', accountantProtect, getARAgingReport);\n`);
  fs.writeFileSync(path.join(tmp, 'routes', 'accountant', 'flux.js'), `const c = require('../../controllers/accountant/flux');\nrouter.post('/', accountantProtect, c.createFlux);\nrouter.get('/:id', accountantProtect, c.getFlux);\n`);
  fs.writeFileSync(path.join(tmp, 'controllers', 'accountant', 'reports.js'), `exports.getARAgingReport = asyncHandler(async (req, res) => { const { asOf } = req.query; if (req.query.exports === 'xlsx') {} res.json({}); });\n`);
  fs.writeFileSync(path.join(tmp, 'controllers', 'accountant', 'flux.js'), `exports.createFlux = asyncHandler(async (req, res) => { const { businessId, type } = req.body; });\nexports.getFlux = asyncHandler(async (req, res) => { req.params.id; req.query.exports; });\n`);
  const scan = M.scanCheckout(tmp);
  assert.equal(scan.endpoints.length, 3);
  const aging = scan.endpoints.find((e) => e.path === '/api/v1/accountant/reports/ar-aging/:businessId');
  assert.deepEqual(aging.params.query.sort(), ['asOf', 'exports']); assert.deepEqual(aging.middleware, ['accountantProtect']); assert.equal(aging.controller, 'controllers/accountant/reports.js');
  const flux = scan.endpoints.find((e) => e.path === '/api/v1/accountant/flux' && e.method === 'POST');
  assert.deepEqual(flux.params.body.sort(), ['businessId', 'type']);
  // matching and policy
  const map = { endpoints: [{ method: 'GET', path: '/api/v1/accountant/reports/ar-aging/:businessId', read: true }, { method: 'GET', path: '/api/v1/accountant/flux/:id', read: true }, { method: 'GET', path: '/api/v1/accountant/flux/business/:businessId', read: true }] };
  assert.equal(M.match(map, 'get', '/api/v1/accountant/reports/ar-aging/64abc?asOf=2026-09-30').path, '/api/v1/accountant/reports/ar-aging/:businessId');
  assert.equal(M.match(map, 'GET', '/api/v1/accountant/flux/business/64abc').path, '/api/v1/accountant/flux/business/:businessId', 'literal segments beat params');
  assert.equal(M.match(map, 'POST', '/api/v1/accountant/reports/ar-aging/64abc'), null);
  const policy = M.POLICY();
  assert.ok(M.deniedBy(policy, 'GET', '/api/v1/accountant/auth/me')); assert.ok(M.deniedBy(policy, 'DELETE', '/api/v1/accountant/vendor/1')); assert.ok(M.deniedBy(policy, 'POST', '/api/v1/transactions/accounting/bookkeeping/businessId/1/ramp-exchangeCode'));
  assert.equal(M.deniedBy(policy, 'GET', '/api/v1/accountant/reports/ar-aging/1'), null);
  assert.equal(M.key('get', '/a/:id/b/:x/'), 'GET /a/:p/b/:p');
});

test('proposals: tiers never promote, entries must balance, decisions carry names', () => {
  const policy = M.POLICY();
  assert.equal(PR.tierFor(policy, 'vendor', 'A').tier, 'A');
  assert.equal(PR.tierFor(policy, 'journal_entry', 'A').tier, 'B', 'policy keeps journal entries at B');
  assert.equal(PR.tierFor(policy, 'vendor', 'C').tier, 'C', 'an agent may demote');
  assert.equal(PR.tierFor(policy, 'unknown_kind', null).tier, 'B');
  assert.equal(PR.balanced({ lines: [{ account: 'a', debit: 2400 }, { account: 'b', credit: 2400 }] }).ok, true);
  assert.equal(PR.balanced({ lines: [{ account: 'a', debit: 2400 }, { account: 'b', credit: 2399.99 }] }).ok, false);
  assert.equal(PR.balanced({ items: [{ glType: 'debit', amount: 10 }, { glType: 'credit', amount: -10 }] }).ok, true, 'Dime shape with absolute amounts');
  assert.equal(PR.amountOf({ unit_amount_cents: 123456 }), 1234.56);
  const r = T.createRequest({ title: 'p', body: '' });
  const { proposal } = PR.add(r.id, { kind: 'vendor', tier: 'A', summary: 's', method: 'POST', path: '/x', body: { name: 'n' } });
  assert.equal(proposal.id, 'P-1'); assert.equal(proposal.status, 'proposed');
  assert.throws(() => PR.decide(r.id, 'P-1', { status: 'applied', by: 'Mo' }), /bad proposal status/);
  PR.decide(r.id, 'P-1', { status: 'rejected', by: 'Mo', note: 'dup' });
  assert.deepEqual(PR.summary(r.id), { total: 1, proposed: 0, approved: 0, rejected: 1, applied: 0, reversed: 0, failed: 0, questions: 0, answered: 0, pending: 0, policyApproved: 0 });
});

test('plan validation against the map', () => {
  const { restore } = writeTestMap();
  try {
    const map = M.load();
    assert.equal(PL.validate({ calls: [{ method: 'GET', path: '/api/v1/accountant/reports/ap-aging/b1' }] }, map).ok, true);
    const bad = PL.validate({ size: 'XL', calls: [{ method: 'GET', path: '/api/v1/nope' }, { method: 'GET', path: '/api/v1/accountant/auth/me' }], writes: [{ kind: 'x' }], children: [{ title: 'c' }] }, map);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /not in the endpoint map/.test(e))); assert.ok(bad.errors.some((e) => /denied by policy/.test(e))); assert.ok(bad.errors.some((e) => /size must be/.test(e))); assert.ok(bad.errors.some((e) => /only a size L/.test(e))); assert.ok(bad.errors.some((e) => /writes\[0\]/.test(e)));
    assert.deepEqual(PL.normalizeDone([{ text: 'a', evaluator: 'check.export_opens' }, { id: 'D-9', text: 'b' }, {}]), [{ id: 'D-1', text: 'a', evaluator: 'export_opens', args: {}, expect: {} }, { id: 'D-9', text: 'b' }]);
  } finally { restore(); }
});

test('receipts and done evaluators (no backend needed)', async () => {
  const r = T.createRequest({ title: 'd', body: '' }); r.subject = { businessIds: ['b1'], businessNames: ['Acme Dental'] };
  r.done = [{ id: 'D-1', text: 'xlsx', evaluator: 'deliverable_exists', args: { ext: '.xlsx' } }, { id: 'D-2', text: 'opens', evaluator: 'export_opens' }, { id: 'D-3', text: 'entities', evaluator: 'all_entities_covered' }, { id: 'D-4', text: 'figures', evaluator: 'figures_in_data' }, { id: 'D-5', text: 'rows', evaluator: 'row_count', args: { file: 'r.xlsx' }, expect: { min: 2 } }, { id: 'D-6', text: 'ties', evaluator: 'ties_to_report', args: { report: 'profit_and_loss', startDate: '2026-09-01', endDate: '2026-09-30' } }, { id: 'D-7', text: 'reads', evaluator: 'receipts_min', expect: { min: 1 } }];
  T.saveRequest(r);
  T.writeArtifact(r.id, 'data/pl.json', { metrics: { netIncome: 12418.22 }, rows: [{ amount: 4500 }] });
  const seq = R.append(r.id, { method: 'GET', path: '/api/v1/x', status: 200, bytes: 10, ms: 5, outFile: 'data/pl.json' });
  assert.equal(seq, 1); assert.equal(R.stats(R.list(r.id)).ok, 1);
  T.writeArtifact(r.id, 'deliverables/r.xlsx', X.writeXlsx([{ name: 'Acme Dental', header: ['Account', 'Amt'], rows: [['Rent', 4500], ['Net', 12418.22], ['Made up', 9999.99]] }]));
  const call = async ({ path: p }) => (/profit-and-loss/.test(p) ? { ok: true, status: 200, json: { data: { metrics: { netIncome: 12418.22 } } } } : { ok: false, status: 404 });
  const out = await DN.runAll(r, { call });
  const by = Object.fromEntries(out.items.map((i) => [i.id, i]));
  assert.equal(by['D-1'].pass, true); assert.equal(by['D-2'].pass, true); assert.equal(by['D-3'].pass, true); assert.equal(by['D-5'].pass, true); assert.equal(by['D-6'].pass, true); assert.equal(by['D-7'].pass, true);
  assert.equal(by['D-4'].pass, true, 'advisory by default'); assert.equal(by['D-4'].advisory, true); assert.equal(by['D-4'].figures.uncited, 1, 'the made-up 9999.99 is uncited');
  assert.equal(out.pass, true);
  r.done.push({ id: 'D-8', text: 'strict', evaluator: 'figures_in_data', expect: { maxUncited: 0 } }); T.saveRequest(r);
  const strict = await DN.runAll(r, { call, only: 'D-8' });
  assert.equal(strict.pass, false); assert.deepEqual(strict.failing, ['D-8']);
  const ties = await DN.runAll({ ...r, done: [{ id: 'D-9', text: 't', evaluator: 'ties_to_report', args: { report: 'profit_and_loss' } }] }, { call: async () => ({ ok: true, status: 200, json: { metrics: { netIncome: 1 } } }) });
  assert.equal(ties.pass, false, 'a report figure absent from the deliverable fails');
});

test('claude result parsing and wrap-up detection', () => {
  const p = C.parseAgentResult('Hello\n\n```lab-result\n{"status":"ok","summary":"s"}\n```');
  assert.equal(p.ok, true); assert.equal(p.comment, 'Hello'); assert.equal(p.result.summary, 's');
  assert.equal(C.parseAgentResult('no block').ok, false);
  assert.equal(C.needsWrapUp({ sessionId: 'x', subtype: 'no_result' }, { ok: false }), true);
  assert.equal(C.needsWrapUp({ sessionId: 'x', subtype: 'success' }, { ok: false }), false);
});

test('eval expectations and knowledge assembly', () => {
  const res = E.check({ mustMention: ['september'], mustNotMention: ['posted'], json: { kind: 'report' }, mustAsk: false, maxQuestions: 1, maxGuardDenials: 0 }, { artifactText: 'Periods: September and October 2026', result: { kind: 'report', questions: [] }, run: { guardDenials: 0 } });
  assert.equal(res.pass, true);
  const bad = E.check({ mustAsk: true, maxGuardDenials: 0 }, { artifactText: '', result: { status: 'ok' }, run: { guardDenials: 2 } });
  assert.equal(bad.pass, false); assert.equal(bad.failures.length, 2);
  for (const a of K.listAgents()) { const sp = K.buildSystemPrompt(a); assert.match(sp, /Unacceptable failures/); assert.match(sp, /System of record/); assert.match(sp, /house rules/i); }
  assert.deepEqual(K.areasFromRequest({ kind: 'report', worker: 'analyst' }, { calls: [{ domain: 'financials' }] }), ['report', 'analyst', 'financials']);
  const kept = K.filterLearned('# L\n\n## a\nareas: report\nx\n\n## b\nareas: question\ny\n\n## c\nz\n', ['report']);
  assert.match(kept, /## a/); assert.doesNotMatch(kept, /## b/); assert.match(kept, /## c/);
});
