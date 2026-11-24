'use strict';
// RD-2 delegated identity on the desk: a request that carries a token AS its requester calls Dime with it and never
// signs in as the service user; an expired token is refreshed from the API; a request with none uses the service login.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LAB_REQUESTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-deleg-'));
process.env.LAB_RUNS_DIR = path.join(process.env.LAB_REQUESTS_DIR, 'runs');
const D = require('../src/dime');
const T = require('../src/request');

/** A tiny Dime that records the bearer token of every call, answers 401 to a token it was told to expire, and mints refreshes. */
function fakeApi() {
  const state = { calls: [], logins: 0, refreshes: 0, expired: new Set() };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const p = req.url.split('?')[0];
      if (p === '/healthz') return send(200, { db: 'up' });
      if (p === '/api/v1/accountant/auth/login' && req.method === 'POST') { state.logins += 1; return send(201, { token: `svc-${state.logins}` }); }
      if (/\/api\/v1\/internal\/request-desk\/requests\/[^/]+\/token$/.test(p)) { if (req.headers['x-request-desk-token'] !== 'desk-secret') return send(401, { error: 'no' }); state.refreshes += 1; return send(200, { token: `deleg-fresh-${state.refreshes}`, expiresAt: new Date(Date.now() + 3600000).toISOString() }); }
      const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
      state.calls.push({ path: p, token: tok });
      if (state.expired.has(tok)) return send(401, { message: 'expired' });
      return send(200, { ok: true, as: tok });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

function backendsFor(base) {
  process.env.LAB_BACKENDS_JSON = JSON.stringify({ default: 'fake', backends: { fake: { apiBaseUrl: base, login: { email: 'svc@test', password: 'pw' } } } });
}

test('a request with a delegated token calls Dime as that person; one without uses the service login; an expired token is refreshed', async () => {
  const { server, state, base } = await fakeApi();
  try {
    backendsFor(base);
    process.env.LAB_API_TOKEN = 'desk-secret'; process.env.LAB_API_URL = base;
    const withTok = T.createRequest({ title: 'from Dime', body: 'x', backend: 'fake' });
    withTok.api = { id: 'abc123', ref: 'REQ-9' }; withTok.auth = { token: 'deleg-1', expiresAt: new Date(Date.now() + 3600000).toISOString(), apiId: 'abc123' }; T.saveRequest(withTok);
    const r1 = await D.call({ backend: 'fake', request: withTok, method: 'GET', path: '/api/v1/accountant/x' });
    assert.equal(r1.ok, true); assert.equal(r1.auth, 'delegated'); assert.equal(r1.json.as, 'deleg-1');
    assert.equal(state.logins, 0, 'no service login when a delegated token is present');

    const noTok = T.createRequest({ title: 'from the CLI', body: 'x', backend: 'fake' });
    const r2 = await D.call({ backend: 'fake', request: noTok, method: 'GET', path: '/api/v1/accountant/y' });
    assert.equal(r2.auth, 'service'); assert.equal(r2.json.as, 'svc-1'); assert.equal(state.logins, 1);

    // the delegated token expires mid-run: Dime says 401, the desk refreshes it from the API and retries as the person
    state.expired.add('deleg-1');
    const r3 = await D.call({ backend: 'fake', request: withTok, method: 'GET', path: '/api/v1/accountant/z' });
    assert.equal(r3.ok, true); assert.equal(r3.auth, 'delegated'); assert.equal(r3.json.as, 'deleg-fresh-1'); assert.equal(state.refreshes, 1);
    assert.equal(T.loadRequest(withTok.id).auth.token, 'deleg-fresh-1', 'the refreshed token is saved on the request');
    assert.equal(state.logins, 1, 'still no extra service login');

    // a token the desk knows is about to expire is not even tried
    const stale = { ...withTok, auth: { token: 'old', expiresAt: new Date(Date.now() + 10000).toISOString(), apiId: 'abc123' } };
    assert.equal(D.delegatedFor(stale), null);
  } finally { server.close(); delete process.env.LAB_API_TOKEN; delete process.env.LAB_API_URL; }
});
