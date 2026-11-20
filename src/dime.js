'use strict';
// The only path to a Dime backend. Signs in as the desk's service accountant
// user through the product's own login route (credentials from the git-ignored
// config/backends.local.json), caches the token per backend, and makes HTTP
// calls with retries for 429 and connection blips. Every write the desk ever
// performs goes through here, so Dime's validation, period locks and audit
// middleware apply exactly as for a person in a browser.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function loadBackends() {
  // tests and sandboxes hand the whole table in (never a file): LAB_BACKENDS_JSON='{"default":"t","backends":{"t":{...}}}'
  if (process.env.LAB_BACKENDS_JSON) { const j = JSON.parse(process.env.LAB_BACKENDS_JSON); return { default: j.default, backends: Object.fromEntries(Object.entries(j.backends || {}).map(([id, b]) => [id, { id, ...b }])) }; }
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'backends.json'), 'utf8'));
  let local = {};
  try { local = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'backends.local.json'), 'utf8')); } catch { /* optional */ }
  const backends = {};
  for (const [id, b] of Object.entries(base.backends || {})) backends[id] = { id, ...b, ...((local.backends || {})[id] || {}) };
  for (const [id, b] of Object.entries(local.backends || {})) if (!backends[id]) backends[id] = { id, ...b };
  return { default: local.default || base.default, backends };
}

function backend(id) {
  const all = loadBackends();
  const key = id || process.env.LAB_BACKEND || all.default;
  const b = all.backends[key];
  if (!b) throw new Error(`unknown backend "${key}"; known: ${Object.keys(all.backends).join(', ')}`);
  if (!b.apiBaseUrl) throw new Error(`backend "${key}" has no apiBaseUrl`);
  return b;
}

function checkoutPath(b = backend()) { return path.resolve(ROOT, b.checkout || '../../ms-university'); }

function sessionsDir() { return path.join(process.env.LAB_RUNS_DIR || path.join(ROOT, 'runs'), '.sessions'); }
function sessionFile(id) { return path.join(sessionsDir(), `${id}.json`); }
function loadSession(id) { try { return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')); } catch { return null; } }
function saveSession(id, s) { fs.mkdirSync(sessionsDir(), { recursive: true }); fs.writeFileSync(sessionFile(id), JSON.stringify(s)); }
function forgetSession(id) { try { fs.unlinkSync(sessionFile(id)); } catch { /* none */ } }

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal, redirect: 'manual' });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    let json = null; let text = null;
    if (/json/.test(type)) { try { json = JSON.parse(buf.toString('utf8')); } catch { text = buf.toString('utf8'); } } else if (/^text\//.test(type)) text = buf.toString('utf8');
    return { status: res.status, ok: res.ok, headers: res.headers, type, json, text, buf };
  } finally { clearTimeout(timer); }
}

/** Sign in as the service user. Returns the session {token, email, at}. */
async function login(id, { force = false } = {}) {
  const b = backend(id);
  if (!force) { const s = loadSession(b.id); if (s && s.token) return s; }
  const l = b.login || {};
  if (!l.email || !l.password) throw new Error(`no service login for backend "${b.id}": add backends.${b.id}.login {email,password} to config/backends.local.json`);
  const r = await fetchJson(`${b.apiBaseUrl}/api/v1/accountant/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: l.email, password: l.password }), timeoutMs: 30000 });
  const token = r.json && r.json.token;
  if (!r.ok || !token) throw new Error(`Dime sign-in failed on ${b.id}: ${r.status} ${(r.json && (r.json.message || r.json.error)) || (r.text || '').slice(0, 200)}`);
  const s = { token, email: l.email, at: new Date().toISOString(), base: b.apiBaseUrl };
  saveSession(b.id, s);
  return s;
}

function argsHash(query, body) {
  return crypto.createHash('sha1').update(JSON.stringify({ q: query || null, b: body || null })).digest('hex').slice(0, 12);
}

/**
 * One call to the product. Returns {status, ok, json, text, buf, bytes, ms, argsHash}.
 * A 401 re-signs in once. 429 backs off. Connection refusals retry a few times.
 */
async function call({ backend: id, method = 'GET', path: reqPath, query = null, body = null, headers = {}, timeoutMs = 120000, _attempt = 0, _relogin = true } = {}) {
  const b = backend(id);
  if (!reqPath || !reqPath.startsWith('/')) throw new Error('path must start with /');
  const s = await login(b.id);
  const url = new URL(reqPath, b.apiBaseUrl);
  if (query && typeof query === 'object') for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const started = Date.now();
  const h = { authorization: `Bearer ${s.token}`, cookie: `token=${s.token}`, accept: 'application/json, */*', ...headers };
  let payload;
  if (body != null) { h['content-type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  let r;
  try { r = await fetchJson(url.toString(), { method: method.toUpperCase(), headers: h, body: payload, timeoutMs }); } catch (e) {
    const transient = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|aborted/i.test(String(e && (e.cause && e.cause.code || e.message)));
    if (transient && _attempt < 3) { await new Promise((x) => setTimeout(x, Math.min(1000 * 2 ** _attempt, 8000))); return call({ backend: id, method, path: reqPath, query, body, headers, timeoutMs, _attempt: _attempt + 1, _relogin }); }
    const err = new Error(`The Dime API at ${b.apiBaseUrl} is not reachable (${(e.cause && e.cause.code) || e.message}). Start the backend (lab stack up) or check config/backends.json.`);
    err.status = 0; throw err;
  }
  if (r.status === 401 && _relogin) { forgetSession(b.id); await login(b.id, { force: true }); return call({ backend: id, method, path: reqPath, query, body, headers, timeoutMs, _attempt, _relogin: false }); }
  if (r.status === 429 && _attempt < 5) { const ra = Number(r.headers.get('retry-after')); const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : Math.min(1000 * 2 ** _attempt, 15000); await new Promise((x) => setTimeout(x, wait)); return call({ backend: id, method, path: reqPath, query, body, headers, timeoutMs, _attempt: _attempt + 1, _relogin }); }
  return { status: r.status, ok: r.ok, json: r.json, text: r.text, buf: r.buf, type: r.type, bytes: r.buf.length, ms: Date.now() - started, argsHash: argsHash(query, body), url: url.pathname + url.search };
}

/** Plain sentence for a failed product call, from the product's own words when it sent any. */
function humanize(status, json) {
  const said = json && (json.message || json.error || (Array.isArray(json.details) && json.details[0] && json.details[0].message));
  if (typeof said === 'string' && said.trim() && !/\/api\//.test(said)) return said.replace(/\s+/g, ' ').trim();
  if (status === 400 || status === 422) return 'The product refused the call as invalid.';
  if (status === 401 || status === 403) return "The product did not accept the desk's sign-in for this call.";
  if (status === 404) return 'The product could not find what was asked for.';
  if (status === 409) return 'The product reported a conflict with something already on file.';
  if (status === 429) return 'The product is busy and asked the desk to slow down.';
  if (status >= 500) return 'The product hit an internal error.';
  return 'The product could not be reached.';
}

/** Health probe without auth. */
async function health(id) {
  const b = backend(id);
  try { const r = await fetchJson(`${b.apiBaseUrl}${(b.boot && b.boot.health) || '/healthz'}`, { timeoutMs: 5000 }); return { ok: r.status < 500, status: r.status }; } catch (e) { return { ok: false, error: (e.cause && e.cause.code) || e.message }; }
}

module.exports = { loadBackends, backend, checkoutPath, login, call, humanize, health, argsHash, sessionFile, forgetSession, fetchJson };
