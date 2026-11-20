'use strict';
// Boot the Dime API from the configured checkout so the desk has a backend to
// talk to (it reads its own config/config.env; the desk never does). Ports and
// commands come from config/backends.json `boot`.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const D = require('./dime');
const T = require('./request');

function pidFile(id) { return path.join(T.runsDir(), '.stack', `${id}.json`); }
function state(id) { try { return JSON.parse(fs.readFileSync(pidFile(id), 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function httpOk(url, timeoutMs = 4000) {
  return new Promise((resolve) => { const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); }); req.on('error', () => resolve(false)); req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); }); });
}

async function up(id, { log = () => {} } = {}) {
  const b = D.backend(id);
  const boot = b.boot; if (!boot) throw new Error(`backend ${b.id} has no boot config; it is expected to be running already at ${b.apiBaseUrl}`);
  const health = `${b.apiBaseUrl}${boot.health || '/healthz'}`;
  if (await httpOk(health)) { log(`api already answering at ${b.apiBaseUrl}`); return { already: true }; }
  const cwd = D.checkoutPath(b);
  if (!fs.existsSync(path.join(cwd, 'server.js'))) throw new Error(`no server.js in ${cwd}`);
  const logDir = path.join(T.runsDir(), '.stack'); fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `${b.id}.log`), 'a');
  const env = { ...process.env, ...(boot.env || {}) };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  const [cmd, ...args] = boot.start;
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, out], detached: true });
  fs.closeSync(out);
  child.unref();
  fs.writeFileSync(pidFile(b.id), JSON.stringify({ pid: child.pid, at: new Date().toISOString(), cwd, base: b.apiBaseUrl }));
  log(`api starting (pid ${child.pid}) from ${cwd}; waiting for ${health}`);
  const started = Date.now();
  while (Date.now() - started < (boot.bootTimeoutMs || 90000)) {
    if (await httpOk(health)) { log(`api healthy after ${Math.round((Date.now() - started) / 1000)}s`); return { pid: child.pid }; }
    if (!alive(child.pid)) throw new Error(`api exited; see ${path.join(logDir, `${b.id}.log`)}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`api did not become healthy; see ${path.join(logDir, `${b.id}.log`)}`);
}

function down(id) {
  const b = D.backend(id); const s = state(b.id);
  if (!s) return false;
  try { process.kill(-s.pid, 'SIGTERM'); } catch { try { process.kill(s.pid, 'SIGTERM'); } catch { /* gone */ } }
  try { fs.unlinkSync(pidFile(b.id)); } catch { /* none */ }
  return true;
}

module.exports = { up, down, state, httpOk, alive };
