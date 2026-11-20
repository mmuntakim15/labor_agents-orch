'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFile } = require('child_process');
const { sandbox, fakeDime, writeTestMap } = require('./helpers');
sandbox('dime');
const T = require('../src/request');
const D = require('../src/dime');
const R = require('../src/receipts');
const PR = require('../src/proposals');
const ROOT = path.join(__dirname, '..');

let api; let restoreMap;
test.before(async () => { api = await fakeDime(); restoreMap = writeTestMap().restore; });
test.after(async () => { restoreMap(); await api.close(); });

test('login once, cached token, re-login on 401, back off on 429', async () => {
  const s = await D.login('t'); assert.equal(s.token, 'tok-1'); assert.equal(api.state.logins, 1);
  const r = await D.call({ backend: 't', method: 'GET', path: '/api/v1/accountant/reports/profit-and-loss-realtime/b1', query: { startDate: '2026-09-01' } });
  assert.equal(r.ok, true); assert.equal(r.json.data.metrics.netIncome, 12418.22); assert.equal(api.state.logins, 1, 'token reused');
  assert.equal(api.state.calls.slice(-1)[0].query.startDate, '2026-09-01');
  api.state.expire = true;
  const r2 = await D.call({ backend: 't', method: 'GET', path: '/api/v1/accountant/reports/profit-and-loss-realtime/b1' });
  assert.equal(r2.ok, true); assert.equal(api.state.logins, 2, 'a 401 re-signed in once');
  api.state.rateLimitOnce = true;
  const r3 = await D.call({ backend: 't', method: 'GET', path: '/api/v1/accountant/reports/profit-and-loss-realtime/b1' });
  assert.equal(r3.ok, true);
  assert.equal(D.humanize(404, {}), 'The product could not find what was asked for.');
  assert.equal(D.humanize(400, { message: 'Period is closed' }), 'Period is closed');
});

test('the HTTP tool: reads run and leave receipts; unmapped, denied and write paths are refused with nothing called', async () => {
  const r = T.createRequest({ title: 't', body: '' }); r.backend = 't'; r.writes = false; T.saveRequest(r);
  // async spawn: a synchronous spawn would block the event loop that serves the fake Dime in this same process
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [path.join(ROOT, 'tools', 'dime.js'), ...args], { encoding: 'utf8', env: { ...process.env }, timeout: 20000 }, (err, stdout) => resolve(JSON.parse(stdout || (err && err.stdout) || '{"ok":false,"error":"no output"}'))));
  const before = api.state.calls.length;
  let o = await run(['call', '--request', r.id, '--method', 'GET', '--path', '/api/v1/accountant/reports/profit-and-loss-realtime/b1', '--query', '{"startDate":"2026-09-01","endDate":"2026-09-30"}', '--out', 'pl-sep']);
  assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.receipt, 1); assert.match(o.saved, /data\/pl-sep\.json$/); assert.ok(o.response.shape);
  assert.ok(T.listArtifacts(r.id).includes('data/pl-sep.json'));
  o = await run(['call', '--request', r.id, '--method', 'GET', '--path', '/api/v1/nope/x']);
  assert.equal(o.ok, false); assert.match(o.error, /not in the endpoint map/);
  o = await run(['call', '--request', r.id, '--method', 'GET', '--path', '/api/v1/accountant/auth/me']);
  assert.equal(o.ok, false); assert.match(o.error, /denied by policy/);
  o = await run(['call', '--request', r.id, '--method', 'POST', '--path', '/api/v1/accountant/vendor', '--body', '{"name":"x"}']);
  assert.equal(o.ok, false); assert.match(o.error, /is a write/);
  assert.equal(api.state.calls.length - before, 1, 'only the one read reached Dime');
  const rows = R.list(r.id);
  assert.equal(rows.length, 3); assert.equal(rows[1].status, 'refused'); assert.equal(rows[2].refused, 'write during execution');
  o = await run(['propose', '--request', r.id, '--kind', 'vendor', '--tier', 'A', '--summary', 'x', '--method', 'POST', '--path', '/api/v1/accountant/vendor', '--body', '{"name":"x"}']);
  assert.equal(o.ok, false); assert.match(o.error, /read-only/);
  r.writes = true; T.saveRequest(r);
  o = await run(['propose', '--request', r.id, '--kind', 'vendor', '--tier', 'A', '--summary', 'Vendor x from w9', '--method', 'POST', '--path', '/api/v1/accountant/vendor', '--body', '{"name":"x"}']);
  assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.proposal.id, 'P-1'); assert.equal(o.proposal.tier, 'A');
  o = await run(['propose', '--request', r.id, '--kind', 'vendor', '--tier', 'A', '--summary', 'del', '--method', 'DELETE', '--path', '/api/v1/accountant/vendor/1']);
  assert.equal(o.ok, false); assert.match(o.error, /denied/);
  o = await run(['propose', '--request', r.id, '--kind', 'journal_entry', '--tier', 'A', '--summary', 'q', '--method', 'POST', '--path', '/api/v1/accountant/vendor', '--body', '{}', '--entry-file', path.join(T.artifactsDir(r.id), 'nope.json')]);
  assert.equal(o.ok, false);
  o = await run(['businesses', '--request', r.id]);
  assert.equal(o.ok, true, JSON.stringify(o)); assert.deepEqual(o.businesses.map((b) => b.name), ['Acme Dental', 'Beta LLC']);
  assert.equal(api.state.calls.length - before, 2);
  assert.equal(PR.summary(r.id).total, 1);
  o = await run(['dates', '--month', '2026-02']); assert.equal(o.days, 28);
  o = await run(['dates', '--last-months', '2', '--as-of', '2026-01-15']); assert.deepEqual(o.periods.map((p) => p.period), ['2025-11', '2025-12']);
});
