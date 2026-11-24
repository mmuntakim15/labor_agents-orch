'use strict';
// Shared test scaffolding: a sandbox store, a stand-in model, a fake Dime API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function sandbox(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lab-${name}-`));
  process.env.LAB_REQUESTS_DIR = path.join(tmp, 'requests');
  process.env.LAB_RUNS_DIR = path.join(tmp, 'runs');
  process.env.LAB_EVENTS_FILE = path.join(tmp, 'events.jsonl');
  process.env.LAB_CLAUDE_BIN = path.join(__dirname, 'fixtures', 'fake-claude.js');
  process.env.LAB_QUIET = '1';
  return tmp;
}

/** A tiny Dime stand-in: login, profile, a report, a vendor create, with knobs for 401/429. */
function fakeDime({ port = 0 } = {}) {
  const state = { logins: 0, calls: [], vendors: [], journals: [], removedPayments: [], categorized: [], expire: false, rateLimitOnce: false, failVendor: null, failRemovePayment: false };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const url = new URL(req.url, 'http://x'); const p = url.pathname; const auth = req.headers.authorization || '';
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      state.calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams.entries()), body: body ? JSON.parse(body) : null, auth });
      if (p === '/healthz') return send(200, { ok: true });
      if (p === '/api/v1/accountant/auth/login' && req.method === 'POST') { const b = JSON.parse(body || '{}'); if (b.email !== 'svc@test' || b.password !== 'pw') return send(401, { message: 'Invalid credentials' }); state.logins += 1; return send(201, { success: true, token: `tok-${state.logins}` }); }
      if (!/^Bearer tok-/.test(auth) || (state.expire && auth === 'Bearer tok-1')) return send(401, { message: 'not authorized' });
      if (p === '/api/v1/accountant/auth/me') return send(200, { data: { email: 'svc@test', businesses: [{ businessId: 'b1' }, { businessId: 'b2' }] } });
      if (p === '/api/v1/accountant/dashboard/businessList') { const all = [{ _id: 'b1', businessInfo: { businessName: 'Acme Dental', fiscalYearEnd: 'December' }, status: 'completed', functionalCurrency: 'USD' }, { _id: 'b2', businessInfo: { businessName: 'Beta LLC' }, status: 'completed', functionalCurrency: 'USD' }]; const q = url.searchParams.get('searchKey'); return send(200, { businesses: q ? all.filter((b) => b.businessInfo.businessName.toLowerCase().includes(q.toLowerCase())) : all, invites: [] }); }
      if (/^\/api\/v1\/accountant\/reports\/profit-and-loss-realtime\//.test(p)) { if (state.rateLimitOnce) { state.rateLimitOnce = false; return send(429, { message: 'slow down' }, { 'retry-after': '0' }); } return send(200, { data: { metrics: { netIncome: 12418.22, totalRevenue: 90000 }, rows: [{ account: 'Rent', amount: 4500 }, { account: 'Payroll', amount: 41006.18 }] } }); }
      if (/^\/api\/v1\/accountant\/reports\/ap-aging\//.test(p)) return send(200, { data: { total: 5400.5, rows: [{ vendor: 'Acme Supply', total: 5400.5 }] } });
      if (p === '/api/v1/accountant/vendor' && req.method === 'POST') { const b = JSON.parse(body || '{}'); if (state.failVendor && b.name === state.failVendor) return send(400, { message: 'Vendor already exists' }); const v = { _id: `v${state.vendors.length + 1}`, ...b }; state.vendors.push(v); return send(201, { success: true, data: v }); }
      // RD-2 reversal routes: vendor update (deactivate), remove a bill payment, post a journal, re-categorise a transaction
      let m;
      if ((m = /^\/api\/v1\/accountant\/vendor\/([^/]+)$/.exec(p)) && req.method === 'PUT') { const v = state.vendors.find((x) => x._id === m[1]); if (!v) return send(404, { message: 'Vendor not found' }); Object.assign(v, JSON.parse(body || '{}')); return send(200, { success: true, data: v }); }
      if ((m = /^\/api\/v1\/transactions\/accounting\/bookkeeping\/businessId\/([^/]+)\/bill\/([^/]+)\/remove-payment$/.exec(p)) && req.method === 'PUT') { const b = JSON.parse(body || '{}'); if (state.failRemovePayment) return send(422, { message: 'This payment came from a bank line; remove it by unlinking that line' }); state.removedPayments.push({ billId: m[2], paymentId: b.payment_id }); return send(200, { success: true, data: { _id: `rev-${b.payment_id}`, journalId: `JRN-REV-${state.removedPayments.length}` } }); }
      if ((m = /^\/api\/v1\/transactions\/accounting\/businessId\/([^/]+)\/transactions$/.exec(p)) && req.method === 'POST') { const lines = JSON.parse(body || '[]'); if (!Array.isArray(lines)) return send(400, { message: 'body must be an array' }); const d = lines.reduce((s, l) => s + (l.glType === 'debit' ? l.amount : 0), 0); const c = lines.reduce((s, l) => s + (l.glType === 'credit' ? l.amount : 0), 0); if (url.searchParams.get('glJournal') === 'true' && Math.round(d * 100) !== Math.round(c * 100)) return send(400, { message: 'Journal does not balance' }); const j = { _id: `j${state.journals.length + 1}`, lines }; state.journals.push(j); return send(201, { success: true, data: j }); }
      if ((m = /^\/api\/v1\/transactions\/accounting\/businessId\/([^/]+)\/transactionId\/([^/]+)$/.exec(p)) && req.method === 'PUT') { const b = JSON.parse(body || '{}'); state.categorized.push({ id: m[2], ...b }); return send(200, { success: true, data: { _id: m[2], ...b } }); }
      return send(404, { message: 'no route' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => { const base = `http://127.0.0.1:${server.address().port}`; process.env.LAB_BACKENDS_JSON = JSON.stringify({ default: 't', backends: { t: { label: 'test', apiBaseUrl: base, login: { email: 'svc@test', password: 'pw' }, checkout: '../../ms-university' } } }); resolve({ server, base, state, close: () => { try { server.closeAllConnections(); } catch { /* older node */ } return new Promise((r) => server.close(r)); } }); }));
}

/** A minimal endpoint map so the HTTP tool and plan validation have something to match in tests. */
function writeTestMap() {
  process.env.LAB_MAP_FILE = path.join(process.env.LAB_RUNS_DIR || os.tmpdir(), 'test-map', 'ENDPOINTS.json');
  const M = require('../src/map');
  const mk = (method, p, extra = {}) => ({ method, path: p, key: M.key(method, p), domain: 'test', purpose: `${method} ${p}`, auth: 'accountant', middleware: ['accountantProtect'], handler: null, controller: null, params: { query: [], body: [], path: [] }, read: method === 'GET', denied: null, ...extra });
  const map = { builtAt: new Date().toISOString(), checkout: 'test', checkoutStamp: Date.now() + 1e9, count: 6, domains: { test: { file: 'x', intro: 'test', routes: 6 } }, endpoints: [
    mk('GET', '/api/v1/accountant/auth/me', { denied: 'prefix /api/v1/accountant/auth' }),
    mk('GET', '/api/v1/accountant/reports/profit-and-loss-realtime/:businessId'),
    mk('GET', '/api/v1/accountant/reports/ap-aging/:businessId'),
    mk('POST', '/api/v1/accountant/vendor'),
    mk('PATCH', '/api/v1/transactions/accounting/bookkeeping/V2/businessId/:businessId', { read: true }),
    mk('DELETE', '/api/v1/accountant/vendor/:id', { denied: 'method DELETE' }),
    // RD-2 reversal routes, with the purposes the map search finds them by
    mk('PUT', '/api/v1/accountant/vendor/:id', { purpose: 'update a vendor (status active|inactive)' }),
    mk('PUT', '/api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/apply-payment', { purpose: 'apply a ledger payment to a bill' }),
    mk('PUT', '/api/v1/transactions/accounting/bookkeeping/businessId/:businessId/bill/:billId/remove-payment', { purpose: 'take a ledger payment back off a bill, posting a reversing journal; body payment_id' }),
    mk('POST', '/api/v1/transactions/accounting/businessId/:businessId/transactions', { purpose: 'Bulk create; the journal-entry create surface. Body = bare array of transaction lines; query glJournal=true' }),
    mk('PUT', '/api/v1/transactions/accounting/businessId/:businessId/transactionId/:transactionId', { purpose: 'Update/categorize one transaction' }),
  ] };
  map.count = map.endpoints.length;
  fs.mkdirSync(path.dirname(M.OUT), { recursive: true });
  const existed = fs.existsSync(M.OUT) ? fs.readFileSync(M.OUT) : null;
  fs.writeFileSync(M.OUT, JSON.stringify(map));
  return { restore: () => { if (existed) fs.writeFileSync(M.OUT, existed); else fs.unlinkSync(M.OUT); } };
}

module.exports = { sandbox, fakeDime, writeTestMap };
