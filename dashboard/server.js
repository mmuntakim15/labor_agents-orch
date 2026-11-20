'use strict';
// Web dashboard for the Request Desk: start requests chat-style with
// attachments, watch them move across the lane, approve scope and changes,
// read the evidence, download the deliverables, see the cost.
//
// No pipeline logic lives here: every action calls one orchestrator function,
// a run is a detached `lab run <ID>` child admitted by the orchestrator's
// own admission rule, and gate fields are written only by the orchestrator.
// Binds to 127.0.0.1, needs a sign-in, refuses cross-origin writes.

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const O = require(path.join(ROOT, 'src', 'orchestrator'));
const EV = require(path.join(ROOT, 'src', 'events'));
const PR = require(path.join(ROOT, 'src', 'proposals'));
const R = require(path.join(ROOT, 'src', 'receipts'));
const EVD = require(path.join(ROOT, 'src', 'evidence'));
const MD = require(path.join(ROOT, 'src', 'markdown'));
const PDF = require(path.join(ROOT, 'src', 'pdf'));

// What the requester gets, in the format they will open it in. A markdown or html draft that has been rendered to a pdf of the
// same name is not listed twice; a markdown file with no pdf is offered as one (rendered on demand). The file to open first is
// the one the Deliverer marked, or by kind: the workbook for figures, the document for a question.
const DRAFT = /\.(md|html)$/i;
function deliverablesOf(t) {
  const dir = path.join(T.artifactsDir(t.id), 'deliverables'); if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'manifest.json');
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const shown = names.filter((f) => !(DRAFT.test(f) && lower.has(f.replace(DRAFT, '.pdf').toLowerCase())));
  let marked = null; try { marked = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).primary || null; } catch { /* no manifest */ }
  const ext = (f) => path.extname(f).slice(1).toLowerCase();
  const order = t.kind === 'question' ? ['pdf', 'md', 'docx', 'html', 'xlsx', 'csv'] : ['xlsx', 'xls', 'pdf', 'md', 'docx', 'csv', 'html'];
  const byMark = marked && marked.name ? shown.find((f) => f === marked.name) || shown.find((f) => f === String(marked.name).replace(DRAFT, '.pdf')) : null;
  const first = byMark || order.map((e) => shown.find((f) => ext(f) === e)).find(Boolean) || shown[0] || null;
  return shown.map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size, path: `deliverables/${f}`, format: ext(f), asPdf: ext(f) === 'md', label: ext(f) === 'md' ? f.replace(/\.md$/i, '.pdf') : f, first: f === first, why: f === first && byMark ? String(marked.why || '') : '' }));
}

function loadConfig() { const cfg = {}; for (const f of ['dashboard.json', 'dashboard.local.json']) { try { Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(ROOT, 'config', f), 'utf8'))); } catch { /* optional */ } } return cfg; }
const CFG = loadConfig();
const STATIC_DIR = path.join(__dirname, 'ui');
const LAB_BIN = path.join(ROOT, 'bin', 'lab');

const MAX_BODY = 40 * 1024 * 1024; const MAX_FILE = 10 * 1024 * 1024; const MAX_FILES = 12;
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/plain', '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/plain', '.json': 'text/plain', '.jsonl': 'text/plain', '.html': 'text/plain', '.js': 'text/plain', '.yml': 'text/plain', '.yaml': 'text/plain',
};
const ATTACH_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.md', '.txt', '.log', '.csv', '.json', '.xlsx', '.xls', '.docx']);
const STATIC_MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const AGENT_LABELS = Object.fromEntries(Object.values(O.agents).map((a) => [a.label, a.name]));
const ROLES = ['requester', 'approver', 'operator'];
const ATTENTION = ['gate', 'questions', 'blocked', 'error'];

class HttpError extends Error { constructor(code, message) { super(message); this.code = code; } }

// ---------------------------------------------------------------- pure helpers
function deriveTitle(text) {
  const line = String(text || '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
  if (line.length <= 90) return line;
  const cut = line.slice(0, 90);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 90)}…`;
}
function safeName(name) { const base = path.basename(String(name || 'file').replace(/\\/g, '/')).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, ''); return base.slice(-80) || 'file'; }
function resolveInside(root, rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  const abs = path.join(root, ...parts);
  let real; let realRoot;
  try { real = fs.realpathSync(abs); realRoot = fs.realpathSync(root); } catch { return null; }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  if (/^\.env/.test(path.basename(real)) || /backends\.local/.test(real)) return null;
  return real;
}
function requestAllowed(req, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = req.headers.host || '';
  if (!hosts.has(host)) return 'bad host';
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return 'cross-origin request refused';
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return 'content-type must be application/json';
  return null;
}
function loadKey() { return process.env.LAB_UI_KEY || (CFG.key ? String(CFG.key) : null); }
function loadUsers() { return Array.isArray(CFG.users) ? CFG.users.filter((u) => u && u.name && u.key) : []; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function clip(s, n) { const x = String(s ?? ''); return x.length > n ? `${x.slice(0, n)}…` : x; }
function oneLine(s, n) { return clip(String(s ?? '').replace(/\s+/g, ' ').trim(), n); }

// ---------------------------------------------------------------- attachments
function saveAttachments(id, files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];
  if (list.length > MAX_FILES) throw new HttpError(400, `at most ${MAX_FILES} files per message`);
  const dir = path.join(T.artifactsDir(id), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const f of list) {
    let name = safeName(f && f.name);
    const ext = path.extname(name).toLowerCase();
    if (!ATTACH_EXT.has(ext)) throw new HttpError(400, `${name}: file type not accepted (images, pdf, md, txt, log, csv, json, xlsx, docx)`);
    const buf = Buffer.from(String((f && f.data) || ''), 'base64');
    if (!buf.length) throw new HttpError(400, `${name}: empty file`);
    if (buf.length > MAX_FILE) throw new HttpError(400, `${name}: larger than ${MAX_FILE / 1024 / 1024} MB`);
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${path.basename(safeName(f.name), ext)}-${i}${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    saved.push({ name, bytes: buf.length, mime: MIME[ext] || 'application/octet-stream', at: new Date().toISOString() });
  }
  const t = T.loadRequest(id);
  t.attachments = [...(t.attachments || []), ...saved];
  T.saveRequest(t);
  return saved;
}

// ---------------------------------------------------------------- runs on disk
function lockFile(id) { return path.join(T.requestsDir(), '.locks', id); }
function runsDir(id) { return path.join(T.runsDir(), path.basename(T.requestDir(id))); }
function runBase(id, n) { const prefix = `${String(Number(n)).padStart(2, '0')}-`; try { const f = fs.readdirSync(runsDir(id)).find((x) => x.startsWith(prefix) && x.endsWith('.prompt.md')); return f ? path.join(runsDir(id), f.replace(/\.prompt\.md$/, '')) : null; } catch { return null; } }
function latestEventsFile(id) { const d = runsDir(id); let best = null; try { for (const f of fs.readdirSync(d)) { if (!f.endsWith('.events.jsonl')) continue; const m = fs.statSync(path.join(d, f)).mtimeMs; if (!best || m > best.mtimeMs) best = { file: path.join(d, f), mtimeMs: m }; } } catch { /* none */ } return best; }
function activeState(req) {
  if ((O.pipeline.stages[req.status] || {}).terminal) return { active: false, pid: null, agent: null, since: null };
  const pid = O.lockHolder(req.id);
  const rec = (req.runs || []).find((r) => r.status === 'running');
  if (pid) return { active: true, pid, agent: rec ? rec.agent : null, since: rec ? rec.startedAt : null };
  if (rec) { const ev = latestEventsFile(req.id); const last = Math.max(ev ? ev.mtimeMs : 0, Date.parse(rec.startedAt) || 0); if (Date.now() - last < 20 * 60 * 1000) return { active: true, pid: null, agent: rec.agent, since: rec.startedAt }; }
  return { active: false, pid: null, agent: null, since: null };
}
function tail(file, bytes) { try { const size = fs.statSync(file).size; const fd = fs.openSync(file, 'r'); const len = Math.min(size, bytes); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd); const s = buf.toString('utf8'); return len < size ? s.slice(s.indexOf('\n') + 1) : s; } catch { return ''; } }

function spawnRun(id) {
  const dir = runsDir(id); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.dirname(lockFile(id)), { recursive: true });
  const logFile = path.join(dir, 'ui-run.log');
  fs.appendFileSync(logFile, `\n--- run requested ${new Date().toISOString()} ---\n`);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [LAB_BIN, 'run', id], { cwd: ROOT, stdio: ['ignore', out, out], detached: true });
  fs.closeSync(out);
  fs.writeFileSync(lockFile(id), String(child.pid));
  const fail = (why) => { try { const t = T.loadRequest(id); t.runError = { at: new Date().toISOString(), message: why }; T.saveRequest(t); T.addComment(id, { author: 'orchestrator', stage: t.status, body: `⚠ the run stopped unexpectedly: ${why}` }); } catch { /* gone */ } };
  child.on('error', (e) => fail(`could not start (${e.message})`));
  child.on('exit', (code, signal) => {
    try { if (Number(fs.readFileSync(lockFile(id), 'utf8')) === child.pid) fs.unlinkSync(lockFile(id)); } catch { /* gone */ }
    if (code === 0 || signal === 'SIGTERM' || code === 143) return;
    const last = tail(logFile, 4000).split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    fail(oneLine(last.replace(/^error:\s*/, ''), 400) || `exit code ${code ?? signal}`);
  });
  child.unref();
  return child.pid;
}
function stopRun(id) {
  const pid = O.lockHolder(id); if (!pid) return null;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  try { fs.unlinkSync(lockFile(id)); } catch { /* released */ }
  O.markAborted(id);
  return pid;
}
function costRates(requests) {
  const by = {}; const all = { usd: 0, ms: 0 };
  for (const t of requests) for (const r of t.runs || []) { if (!(r.costUsd > 0) || !(r.durationMs > 0)) continue; const a = (by[r.agent] = by[r.agent] || { usd: 0, ms: 0, runs: 0 }); a.usd += r.costUsd; a.ms += r.durationMs; a.runs += 1; all.usd += r.costUsd; all.ms += r.durationMs; }
  const rate = (x) => (x && x.ms > 0 ? (x.usd / x.ms) * 60000 : null);
  return { perMin: (agent) => rate(by[agent]) ?? rate(all) };
}

// ---------------------------------------------------------------- read models
function artifactJson(id, name) { return readJson(path.join(T.artifactsDir(id), name)); }
function guardDenials(id) { const out = []; try { for (const f of fs.readdirSync(runsDir(id)).filter((x) => x.endsWith('.guard.jsonl')).sort()) { const run = Number(f.slice(0, 2)); for (const l of fs.readFileSync(path.join(runsDir(id), f), 'utf8').split('\n').filter(Boolean)) { try { out.push({ run, ...JSON.parse(l) }); } catch { /* skip */ } } } } catch { /* none */ } return out; }

/** Pass/fail rows a person can scan: code checks, the Verifier, calls, proposals, applied, guard. */
function evidence(req) {
  const id = req.id; const rows = [];
  const add = (key, label, state, text, items = [], file = null) => rows.push({ key, label, state, text, items: items.slice(0, 14), file });
  const ck = artifactJson(id, 'checks.json');
  if (ck) add('checks', 'Definition of done, checked by code', ck.pass ? 'pass' : 'fail', `${(ck.items || []).filter((i) => i.pass).length} of ${(ck.items || []).length} pass${(ck.items || []).some((i) => i.advisory && !i.pass) ? ' (advisory notes below)' : ''}`,
    (ck.items || []).map((i) => ({ state: i.pass ? 'pass' : (i.advisory ? 'warn' : 'fail'), text: `${i.id} ${i.evaluator}: ${i.note || 'ok'}${i.figures && Object.keys(i.figures).length ? ` · ${oneLine(JSON.stringify(i.figures), 160)}` : ''}` })), 'checks.json');
  const vf = artifactJson(id, 'verify.json');
  if (vf) add('verify', 'Verifier', vf.verdict === 'pass' ? 'pass' : 'fail', `${vf.verdict || 'no verdict'} · ${(vf.items || []).filter((i) => i.pass).length} of ${(vf.items || []).length} items with evidence${(vf.reproduced || []).length ? ` · ${(vf.reproduced || []).filter((r) => r.ok).length}/${(vf.reproduced || []).length} figures reproduced` : ''}`,
    [...(vf.items || []).map((i) => ({ state: i.pass ? 'pass' : 'fail', text: `${i.id}: ${oneLine(i.evidence || i.note || '', 220)}` })), ...(vf.reproduced || []).filter((r) => !r.ok).map((r) => ({ state: 'fail', text: `R-${r.seq} did not reproduce: ${oneLine(r.note || '', 160)}` }))], 'verify.md');
  const rs = R.stats(R.list(id));
  if (rs.calls) add('receipts', 'Calls to Dime', rs.refused || rs.failed ? 'warn' : 'pass', `${rs.calls} calls · ${rs.ok} ok · ${rs.failed} failed · ${rs.refused} refused by the map or the policy`, Object.entries(rs.byRoute).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => ({ state: 'pass', text: `${v}× ${k}` })), 'receipts.jsonl');
  const ps = PR.summary(id);
  if (ps.total) add('proposals', 'Changes to the books', ps.failed ? 'fail' : (ps.pending ? 'warn' : 'pass'), `${ps.total} proposed · ${ps.approved + ps.applied} approved · ${ps.applied} applied · ${ps.rejected} rejected · ${ps.questions} questions${ps.pending ? ` · ${ps.pending} waiting for a decision` : ''}`,
    PR.load(id).items.map((p) => ({ state: p.status === 'applied' || p.status === 'approved' ? 'pass' : p.status === 'failed' ? 'fail' : 'warn', text: `${p.id} [${p.tier}] ${p.kind || 'question'}: ${oneLine(p.summary, 160)} → ${p.status}${p.reviewedBy ? ` by ${p.reviewedBy}` : ''}${p.appliedRef && p.appliedRef.id ? ` (${p.appliedRef.id})` : ''}${p.error ? ` · ${oneLine(p.error, 120)}` : ''}` })), 'proposals.json');
  const dl = fs.existsSync(path.join(T.artifactsDir(id), 'deliverables')) ? fs.readdirSync(path.join(T.artifactsDir(id), 'deliverables')).filter((f) => !f.startsWith('.') && f !== 'manifest.json') : [];
  if (dl.length) add('deliverables', 'Deliverables', 'pass', `${dl.length} file${dl.length === 1 ? '' : 's'}`, dl.map((f) => ({ state: 'pass', text: f })), null);
  const gd = guardDenials(id); const perm = (req.runs || []).reduce((s, r) => s + (r.permissionDenials || 0), 0);
  if (gd.length || perm) add('guard', 'Tool calls that were stopped', 'warn', `${gd.length} by the guard${perm ? `, ${perm} by the tool allow list` : ''}`, gd.map((d) => ({ state: 'warn', text: `run ${d.run} · ${d.tool} ${oneLine(d.what, 140)} — ${oneLine(d.reason, 120)}` })));
  else if ((req.runs || []).some((r) => 'guardDenials' in r)) add('guard', 'Tool calls that were stopped', 'pass', 'none');
  if ((req.overrides || []).length) add('overrides', 'Overrides by a person', 'warn', `${req.overrides.length}`, req.overrides.map((o) => ({ state: 'warn', text: `${o.item} by ${o.by}: ${oneLine(o.reason, 160)}` })));
  return rows;
}

// The same proof for the person who asked, in an accountant's words: what was promised and met, that the figures were
// re-checked, which Dime reports they came from, what changed in the books, what was handed over. No routes, tools or file names.
function sourceName(route) {
  const parts = String(route).replace(/^[A-Z]+\s+/, '').split('?')[0].split('/').filter(Boolean).filter((x) => !/^(api|v\d+|accountant|reports?)$/i.test(x) && !/^[0-9a-f]{12,}$/i.test(x) && !/^\d+$/.test(x) && !/^[:<{]/.test(x));
  const words = parts.map((x) => x.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase()).join(' ');
  const known = [[/profit and loss/, 'Profit and loss'], [/balance sheet/, 'Balance sheet'], [/trial balance/, 'Trial balance'], [/ar aging/, 'Receivables aging'], [/ap aging/, 'Payables aging'], [/general ledger|\bgl\b/, 'General ledger'], [/business ?list/, 'List of businesses'], [/journal/, 'Journal entries'], [/vendor/, 'Vendors'], [/customer/, 'Customers'], [/invoice/, 'Invoices'], [/bill/, 'Bills'], [/transaction/, 'Transactions'], [/account/, 'Chart of accounts'], [/reconcil/, 'Reconciliations'], [/payroll/, 'Payroll']];
  const hit = known.find(([re]) => re.test(words)); if (hit) return hit[1];
  const tail = words.split(' ').filter(Boolean).slice(-3).join(' '); return tail ? tail[0].toUpperCase() + tail.slice(1) : 'Dime';
}
function assurance(req, deliverables) {
  const id = req.id; const rows = []; const doneText = Object.fromEntries((req.done || []).map((d) => [d.id, d.text]));
  const add = (key, label, state, text, items = []) => rows.push({ key, label, state, text, items: items.slice(0, 14), file: null });
  const ck = artifactJson(id, 'checks.json');
  if (ck && (ck.items || []).length) { const hard = ck.items.filter((i) => !i.advisory); const met = hard.filter((i) => i.pass).length; add('checks', 'What was promised', ck.pass ? 'pass' : 'fail', `${met} of ${hard.length} requirements met`, hard.map((i) => ({ state: i.pass ? 'pass' : 'fail', text: `${doneText[i.id] || i.id}${i.pass ? '' : ' (not met)'}` }))); }
  const vf = artifactJson(id, 'verify.json');
  if (vf) { const rep = vf.reproduced || []; const ok = rep.filter((r) => r.ok).length; add('verify', 'Independent review', vf.verdict === 'pass' ? 'pass' : 'fail', `${vf.verdict === 'pass' ? 'Passed' : 'Did not pass'}: the work was checked a second time, separately from whoever prepared it${rep.length ? `. ${ok} of ${rep.length} figures were pulled from Dime again and ${ok === rep.length ? 'matched' : 'compared'}` : ''}.`, (vf.items || []).map((i) => ({ state: i.pass ? 'pass' : 'fail', text: `${String(doneText[i.id] || i.id).replace(/[.\s]+$/, '')}: ${i.pass ? 'confirmed' : 'not confirmed'}` }))); }
  const rs = R.stats(R.list(id));
  if (rs.calls) { const by = {}; for (const [k, v] of Object.entries(rs.byRoute)) { const n = sourceName(k); by[n] = (by[n] || 0) + v; } add('sources', 'Where the figures came from', rs.failed ? 'warn' : 'pass', `Every figure was read directly from Dime${rs.failed ? `; ${rs.failed} read${rs.failed === 1 ? '' : 's'} did not come back and ${rs.failed === 1 ? 'was' : 'were'} not used` : ''}.`, Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ state: 'pass', text: `${k}${v > 1 ? ` (read ${v} times)` : ''}` }))); }
  const ps = PR.summary(id);
  if (ps.total) { const word = { applied: 'posted to Dime', approved: 'approved', rejected: 'rejected', proposed: 'waiting for your decision', question: 'waiting for your answer', answered: 'answered', failed: 'could not be posted' }; add('proposals', 'Changes to the books', ps.failed ? 'fail' : (ps.pending ? 'warn' : 'pass'), `${ps.total} proposed · ${ps.applied} posted to Dime · ${ps.rejected} rejected${ps.pending ? ` · ${ps.pending} waiting for you` : ''}. Nothing is posted without a named person's approval.`, PR.load(id).items.map((p) => ({ state: p.status === 'applied' || p.status === 'approved' ? 'pass' : p.status === 'failed' ? 'fail' : 'warn', text: `${oneLine(p.summary, 160)}: ${word[p.status] || p.status}${p.reviewedBy ? ` by ${p.reviewedBy}` : ''}` }))); }
  else if (ck || vf) add('proposals', 'Changes to the books', 'pass', 'None. This request did not change the books.');
  if (deliverables.length) add('deliverables', 'Files delivered', 'pass', `${deliverables.length} file${deliverables.length === 1 ? '' : 's'}`, deliverables.map((f) => ({ state: 'pass', text: f.label })));
  if ((req.overrides || []).length) add('overrides', 'Accepted by a person despite a failed check', 'warn', `${req.overrides.length}`, req.overrides.map((o) => ({ state: 'warn', text: `${doneText[o.item] || o.item}, accepted by ${o.by}: ${oneLine(o.reason, 160)}` })));
  return rows;
}

/** The scope in the shape a person needs to approve Gate 1. */
function scopeReview(req) {
  const plan = artifactJson(req.id, 'plan.json');
  const done = (req.done || []).map((d) => ({ id: d.id, text: d.text, evaluator: d.evaluator || null }));
  if (!plan) return { done, calls: [], writes: [], inputs: [], children: [], questions: [], risks: [], estimateUsd: req.estimateUsd || null, hasPlan: false };
  return {
    hasPlan: true, done,
    calls: (plan.calls || []).slice(0, 40).map((c) => ({ method: c.method, path: c.path, purpose: oneLine(c.purpose || '', 140), read: c.read !== false })),
    writes: (plan.writes || []).map((w) => ({ kind: w.kind, tier: w.tier || '?', summary: oneLine(w.summary || '', 160), count: w.count || null })),
    inputs: (plan.inputs || []).map((i) => oneLine(typeof i === 'string' ? i : JSON.stringify(i), 160)),
    children: (plan.children || []).map((c) => oneLine(c.title, 120)),
    questions: (plan.questions || []).map((q) => oneLine(typeof q === 'string' ? q : q.question || JSON.stringify(q), 220)),
    risks: (plan.risks || []).map((r) => oneLine(typeof r === 'string' ? r : r.text || JSON.stringify(r), 220)),
    estimateUsd: plan.estimateUsd || req.estimateUsd || null, steps: (plan.steps || []).map((s) => oneLine(typeof s === 'string' ? s : s.text || JSON.stringify(s), 160)),
  };
}

/** Proposals in the shape a person needs at Gate 2. */
function proposalsReview(req) {
  return PR.load(req.id).items.map((p) => ({
    id: p.id, kind: p.kind || null, tier: p.tier, status: p.status, summary: p.summary, route: p.method ? `${p.method} ${p.path}` : null, amount: p.amountApproved ?? p.amount ?? null, question: p.tier === 'C' ? (p.question || p.summary) : null,
    entry: p.entry && Array.isArray(p.entry.lines) ? { lines: p.entry.lines.map((l) => ({ account: l.account, debit: l.debit || 0, credit: l.credit || 0 })), balanced: PR.balanced(p.entry).ok } : null,
    body: p.body ? clip(JSON.stringify(p.body, null, 1), 1800) : null, reviewedBy: p.reviewedBy || null, note: p.note || null, appliedRef: p.appliedRef || null, error: p.error || null, tierReason: p.tierReason || null,
  }));
}

function transcript(id, n) {
  const base = runBase(id, n); if (!base) throw new HttpError(404, 'run not found');
  const items = []; let truncated = false; let raw = '';
  try { raw = fs.readFileSync(`${base}.events.jsonl`, 'utf8'); } catch { /* code runs have no events */ }
  for (const line of raw.split('\n')) {
    if (!line) continue; if (items.length >= 2500) { truncated = true; break; }
    let e; try { e = JSON.parse(line); } catch { continue; }
    const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    if (e.type === 'assistant') for (const b of content) { if (b.type === 'text' && b.text && b.text.trim()) items.push({ k: 'text', text: clip(b.text, 6000) }); if (b.type === 'tool_use') { const i = b.input || {}; items.push({ k: 'tool', id: b.id, name: b.name, summary: oneLine(i.description || i.command || i.file_path || i.pattern || i.path || '', 200), input: clip(i.command || (i.file_path && !i.content && !i.new_string ? i.file_path : JSON.stringify(i, null, 1)), 1800) }); } }
    else if (e.type === 'user') for (const b of content) { if (b.type !== 'tool_result') continue; const text = Array.isArray(b.content) ? b.content.map((c) => c.text || `[${c.type}]`).join('\n') : String(b.content ?? ''); items.push({ k: 'result', id: b.tool_use_id, error: Boolean(b.is_error), text: clip(text, 1500) }); }
    else if (e.type === 'result') items.push({ k: 'end', subtype: e.subtype, costUsd: e.total_cost_usd || 0, turns: e.num_turns || 0, error: Boolean(e.is_error) });
  }
  const run = (T.loadRequest(id).runs || []).find((r) => r.n === Number(n)) || null;
  return { run, name: path.basename(base), items, truncated, denials: guardDenials(id).filter((d) => d.run === Number(n)), hasPrompt: fs.existsSync(`${base}.prompt.md`), hasFinal: fs.existsSync(`${base}.final.md`) };
}

function runnable(t) { return O.runnable(t) && !(O.pipeline.stages[t.status] || {}).terminal; }
function listFiles(root, rel = '', out = []) {
  let names = []; try { names = fs.readdirSync(path.join(root, rel)).filter((f) => !f.startsWith('.')).sort(); } catch { return out; }
  for (const n of names) { if (out.length >= 600) break; const r = rel ? `${rel}/${n}` : n; let s; try { s = fs.statSync(path.join(root, r)); } catch { continue; } if (s.isDirectory()) listFiles(root, r, out); else out.push({ path: r, bytes: s.size, mtime: s.mtime.toISOString() }); }
  return out;
}
function activity(id) {
  const ev = latestEventsFile(id); if (!ev) return []; const out = [];
  for (const line of tail(ev.file, 96 * 1024).split('\n')) { let e; try { e = JSON.parse(line); } catch { continue; } if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue; for (const b of e.message.content) { if (b.type === 'text' && b.text && b.text.trim()) out.push({ kind: 'text', text: oneLine(b.text, 280) }); if (b.type === 'tool_use') { const i = b.input || {}; out.push({ kind: 'tool', name: b.name, text: oneLine((i.command || '').replace(/^node \S+\/tools\//, '') || i.description || i.file_path || i.pattern || i.path || '', 160) }); } } }
  return out.slice(-8);
}
function commentKind(author) { if (author === 'orchestrator') return 'system'; return AGENT_LABELS[author] ? 'agent' : 'human'; }

// ---------------------------------------------------------------- server
function createServer({ startRun = spawnRun, key = loadKey(), users = loadUsers(), activeOf = activeState, notify = slackNotifier(CFG.notify), doctor = runDoctor } = {}) {
  if (!key && !users.length) throw new Error('no sign-in configured: set LAB_UI_KEY, or "key" / "users" in config/dashboard.json');
  const sessions = new Map(); const fails = { n: 0, until: 0 };
  const digest = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
  const cookieName = () => `lab_ui_${server.address().port}`;
  const tokenOf = (req) => { const m = new RegExp(`(?:^|;\\s*)${cookieName()}=([a-f0-9]{48})`).exec(req.headers.cookie || ''); return m ? m[1] : null; };
  const sessionOf = (req) => { const tok = tokenOf(req); const s = tok && sessions.get(tok); if (!s) return null; if (s.exp < Date.now()) { sessions.delete(tok); return null; } return s; };
  const who = (req) => sessionOf(req).name;
  // The Dime app has already signed the person in, so the desk does not ask again when the Dime app frames it: the browser itself
  // says the page is loading in a frame (Sec-Fetch-Dest) of an allowed origin (Referer); a web page cannot forge either header.
  // Local development only. A hosted desk replaces this with a signed token from the Dime API (config embedAutoSignIn: false turns it off).
  function embedSession(req, url) {
    if (CFG.embedAutoSignIn === false || url.searchParams.get('embedded') !== '1' || sessionOf(req)) return null;
    if (req.headers['sec-fetch-dest'] !== 'iframe') return null;
    let origin = ''; try { origin = new URL(req.headers.referer || '').origin; } catch { return null; }
    if (!(CFG.embedOrigins || []).includes(origin)) return null;
    const name = String(url.searchParams.get('user') || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 60) || 'Dime user';
    const tok = crypto.randomBytes(24).toString('hex');
    sessions.set(tok, { name, roles: ROLES, account: false, embedded: true, exp: Date.now() + 7 * 864e5 });
    return `${cookieName()}=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
  }
  const roleFor = (req, asked) => { const s = sessionOf(req); const role = ROLES.includes(asked) ? asked : 'approver'; if (s.account && !s.roles.includes(role)) throw new HttpError(403, `${s.name} cannot act as ${role}`); return role; };

  const activeIds = (requests) => new Set(requests.filter((t) => activeOf(t).active).map((t) => t.id));
  const request = (id, by) => { const t = T.loadRequest(id); if (!runnable(t) || activeOf(t).active) return false; O.enqueue(id, by); pump(); return true; };
  const lastNeeds = new Map();
  function pump() {
    let requests; try { requests = T.listRequests(); } catch { return; }
    const active = activeIds(requests);
    for (const t of requests.filter((x) => x.queued).sort((a, b) => (a.queued.at < b.queued.at ? -1 : 1))) {
      if (!runnable(t)) { O.dequeue(t.id); continue; }
      if (active.has(t.id)) continue;
      const adm = O.admission(t, requests, { activeIds: active });
      if (!adm.ok) continue;
      const fresh = T.loadRequest(t.id); delete fresh.queued; delete fresh.runError; T.saveRequest(fresh);
      try { startRun(t.id); active.add(t.id); } catch (e) { const x = T.loadRequest(t.id); x.runError = { at: new Date().toISOString(), message: `could not start (${e.message})` }; T.saveRequest(x); }
    }
    for (const t of requests) {
      const s = stateOf(t, active.has(t.id)); const prev = lastNeeds.get(t.id); lastNeeds.set(t.id, s);
      if (prev === undefined || prev === s) continue;
      if (ATTENTION.includes(s) || s === 'done') { try { notify({ id: t.id, title: t.title, state: s, status: t.status, label: (O.pipeline.stages[t.status] || {}).label || t.status }); } catch { /* never affects a run */ } }
    }
    // parents whose children all finished move on by themselves
    for (const t of requests) if (t.status === 'children' && O.childrenDone(t) && !active.has(t.id)) { request(t.id, 'orchestrator'); }
  }
  function stateOf(t, active) {
    const cfg = O.pipeline.stages[t.status] || {};
    if (active) return 'running';
    if (cfg.gate) return 'gate';
    if ((t.pendingQuestions || []).length) return 'questions';
    if (t.status === 'blocked') return 'blocked';
    if (cfg.terminal) return 'done';
    if (t.runError && runnable(t)) return 'error';
    if (t.queued) return 'queued';
    if (t.status === 'children') return 'idle';
    return runnable(t) ? 'start' : 'idle';
  }
  function summary(t, ctx) {
    const st = activeOf(t); const cfg = O.pipeline.stages[t.status] || {}; const m = ctx.metrics[t.id] || {};
    const state = stateOf(t, st.active); const needs = ['running', 'done', 'idle'].includes(state) ? null : state;
    let wait = null; if (state === 'queued') { const adm = O.admission(t, ctx.requests, { activeIds: ctx.active }); wait = adm.ok ? 'starting' : adm.reason; }
    let estimate = null; if (st.active && st.agent && st.since) { const rate = ctx.rates.perMin(st.agent); if (rate) estimate = Number((((Date.now() - Date.parse(st.since)) / 60000) * rate).toFixed(2)); }
    const kids = (t.children || []).filter((k) => k.requestId).map((k) => { const c = ctx.requests.find((x) => x.id === k.requestId); return { id: k.requestId, title: k.title, status: c ? c.status : '?' }; });
    const ps = PR.summary(t.id);
    const dl = deliverablesOf(t).length;
    return {
      id: t.id, title: t.title, kind: t.kind || null, size: t.size || null, writes: Boolean(t.writes), worker: t.worker || null, status: t.status, statusLabel: cfg.label || t.status, lastStage: O.blockedStage(t),
      subject: { names: (t.subject || {}).businessNames || [], periods: (t.subject || {}).periods || [], ids: [...new Set([...(((t.subject || {}).businessIds) || []), ...(t.client ? [t.client.businessId] : [])].map(String))] }, parentId: t.parentId || null, children: kids, fastLane: !t.scoped && Boolean(t.kind),
      costUsd: Number(O.spent(t).toFixed(4)), budgetUsd: O.budgetFor(t), estimateUsd: estimate, runs: (t.runs || []).length,
      loops: { verify: t.loops.verify || 0, verifyLimit: O.loopLimit(t, 'verify') }, needs, gate: cfg.gate || null, questions: (t.pendingQuestions || []).length, wait,
      blocked: t.status === 'blocked' ? (t.blocked || { stage: O.blockedStage(t), kind: 'stage', reason: '' }) : null, runError: needs === 'error' ? t.runError : null,
      active: st.active, agent: st.agent, agentLabel: st.agent && O.agents[st.agent] ? O.agents[st.agent].label : null, since: st.since,
      attachments: (t.attachments || []).length, proposals: ps, deliverables: dl, guardDenials: (t.runs || []).reduce((s, r) => s + (r.guardDenials || 0), 0), costEstimated: (t.runs || []).some((r) => r.costEstimated),
      wallMin: m.wallMin ?? null, humanWaitMin: m.humanWaitMin || {}, createdAt: t.createdAt, updatedAt: t.updatedAt, reporter: t.reporter,
    };
  }
  function context() { const requests = T.listRequests(); return { requests, active: activeIds(requests), rates: costRates(requests), metrics: Object.fromEntries(O.metrics().map((r) => [r.id, r])) }; }
  function board() {
    const ctx = context(); const byAgent = {};
    for (const t of ctx.requests) for (const r of t.runs || []) { const a = (byAgent[r.agent] = byAgent[r.agent] || { runs: 0, costUsd: 0, ms: 0 }); a.runs += 1; a.costUsd += r.costUsd || 0; a.ms += r.durationMs || 0; }
    const rows = ctx.requests.map((t) => summary(t, ctx));
    let templates = []; try { templates = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'templates.json'), 'utf8')).templates || []; } catch { /* optional */ }
    return { pipeline: { lanes: O.pipeline.lanes, stages: O.pipeline.stages, kinds: O.KINDS, maxRuns: (O.pipeline.concurrency || {}).maxRuns || 2 }, agents: Object.fromEntries(Object.values(O.agents).map((a) => [a.name, a.label])), templates, requests: rows, byAgent,
      totals: { costUsd: rows.reduce((s, r) => s + r.costUsd, 0), active: rows.filter((r) => r.active).length, queued: rows.filter((r) => r.needs === 'queued').length, needsYou: rows.filter((r) => ATTENTION.includes(r.needs)).length, done: rows.filter((r) => (O.pipeline.stages[r.status] || {}).terminal).length } };
  }
  function detail(id) {
    const t = T.loadRequest(id); const st = activeOf(t); const ctx = context();
    const lessons = fs.existsSync(path.join(T.artifactsDir(id), 'lessons.md'));
    const deliverables = deliverablesOf(t);
    return { request: t, summary: summary(t, ctx), lane: O.laneFor(t), comments: T.listComments(t.id).map((c) => ({ ...c, kind: commentKind(c.author) })), files: listFiles(T.artifactsDir(t.id)), activity: st.active ? activity(t.id) : [], canStop: Boolean(st.pid),
      canEdit: !t.gates[1].approved && !['execute', 'verify', 'apply', 'deliver'].includes(t.status) && !(O.pipeline.stages[t.status] || {}).terminal, evidence: evidence(t), assurance: assurance(t, deliverables), scope: scopeReview(t), proposals: proposalsReview(t), deliverables, summaryMd: T.readArtifact(id, 'summary.md'), lessons: lessons ? { accepted: Boolean(t.lessonsNoted) } : null, log: tail(path.join(runsDir(id), 'ui-run.log'), 6000) };
  }
  function trends() {
    const agg = EV.aggregate(EV.read()); const rows = O.metrics(); const waits = {};
    for (const r of rows) for (const [g, m] of Object.entries(r.humanWaitMin || {})) { const w = (waits[g] = waits[g] || { n: 0, min: 0 }); w.n += 1; w.min += m; }
    const blocked = EV.read().filter((e) => e.type === 'transition' && e.to === 'blocked').length;
    const done = rows.filter((r) => r.status === 'done'); const zeroTouch = done.filter((r) => !r.writes && r.touches === 0).length;
    return { gates: agg.gates, loopCauses: agg.loopCauses, checks: agg.checks, verify: agg.verify, guard: agg.guard, receipts: agg.receipts, proposals: agg.proposals, interventions: { ...agg.interventions, blocked }, byKind: agg.byKind, zeroTouch: { done: done.length, zero: zeroTouch },
      humanWait: Object.fromEntries(Object.entries(waits).map(([g, w]) => [g, { requests: w.n, avgMin: Math.round(w.min / w.n) }])),
      byAgent: Object.fromEntries(Object.entries(agg.byAgent).map(([a, v]) => [a, { runs: v.runs, costUsd: v.costUsd, fails: v.fails, avgMin: v.runs ? Math.round(v.ms / v.runs / 60000) : 0 }])) };
  }
  let health = { at: 0, rows: null, pending: null };
  function getHealth(force) { if (!force && health.rows && Date.now() - health.at < 60000) return Promise.resolve(health); if (!health.pending) health.pending = doctor().then((rows) => { health = { at: Date.now(), rows, pending: null }; return health; }, () => { health = { at: Date.now(), rows: [{ ok: false, text: 'lab doctor could not be run' }], pending: null }; return health; }); return health.pending; }

  const actions = {
    run(id, b, req) { const t = T.loadRequest(id); if (activeOf(t).active) throw new HttpError(409, 'already running'); if (!runnable(t)) throw new HttpError(409, `nothing to run in ${t.status}`); T.addComment(id, { author: who(req), stage: t.status, body: 'asked the desk to continue' }); request(id, who(req)); },
    stop(id, b, req) { const t = T.loadRequest(id); const wasQueued = Boolean(t.queued); O.dequeue(id); const pid = stopRun(id); if (!pid && !wasQueued) throw new HttpError(409, 'nothing is running or queued for this request'); T.addComment(id, { author: who(req), stage: t.status, body: pid ? 'stopped the run' : 'took the request out of the queue' }); },
    approve(id, b, req) { const r = O.approve(id, Number(b.gate), who(req), b.note || undefined, roleFor(req, b.role)); if (r.status !== 'children') request(id, who(req)); },
    reject(id, b, req) { O.reject(id, Number(b.gate), who(req), String(b.note || '').trim()); request(id, who(req)); },
    proposal(id, b, req) {
      roleFor(req, 'approver');
      let body = null; if (b.body != null && b.body !== '') { try { body = typeof b.body === 'string' ? JSON.parse(b.body) : b.body; } catch { throw new HttpError(400, 'the edited body must be valid JSON'); } }
      const it = O.decideProposal(id, String(b.id), who(req), { decision: b.decision, note: b.note, amount: b.amount != null && b.amount !== '' ? Number(b.amount) : null, body });
      return { proposal: { id: it.id, status: it.status } };
    },
    resume(id, b, req) { const r = O.resumeFromArtifacts(id); request(id, who(req)); return { resume: r }; },
    retry(id, b, req) { const t = T.loadRequest(id); if (t.status === 'blocked') O.requeue(id, who(req), O.blockedStage(t)); else if (!t.runError) throw new HttpError(409, `request is ${t.status}; there is nothing to retry`); request(id, who(req)); },
    budget(id, b, req) { O.raiseBudget(id, who(req), Number(b.usd)); request(id, who(req)); },
    loop(id, b, req) { O.grantLoop(id, who(req), 'verify'); request(id, who(req)); },
    override(id, b, req) { roleFor(req, 'approver'); O.override(id, who(req), String(b.item || ''), String(b.note || '').trim()); request(id, who(req)); },
    sendback(id, b, req) { O.sendBack(id, who(req), String(b.note || '').trim()); request(id, who(req)); },
    cancel(id, b, req) { O.dequeue(id); stopRun(id); O.cancel(id, who(req), b.reason); },
    amend(id, b, req) { O.amend(id, who(req), { title: b.title, body: b.body }); },
    lessons(id, b, req) { O.acceptLessons(id, who(req)); },
    evidence(id) { EVD.assemble(T.loadRequest(id)); },
    message(id, b, req) {
      const by = who(req); const text = String(b.text || '').trim();
      const files = saveAttachments(id, b.attachments);
      if (!text && !files.length) throw new HttpError(400, 'write a message or attach a file');
      const body = [text, files.length ? `Attached: ${files.map((f) => f.name).join(', ')}` : ''].filter(Boolean).join('\n\n');
      const t = T.loadRequest(id);
      if ((t.pendingQuestions || []).length && text) { O.answer(id, by, body); request(id, by); return; }
      T.addComment(id, { author: by, stage: t.status, body });
      if (b.interrupt && activeOf(t).active) { if (!stopRun(id)) throw new HttpError(409, 'this run was not started from the dashboard or the worker, so it cannot be interrupted here'); T.addComment(id, { author: by, stage: t.status, body: 'interrupted the run so the agent restarts with this note' }); O.enqueue(id, by); }
    },
  };

  const server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(req.method === 'HEAD' ? undefined : buf); };
    const sendJson = (obj) => { const body = JSON.stringify(obj); const tag = `"${crypto.createHash('sha1').update(body).digest('base64')}"`; if (req.headers['if-none-match'] === tag) { res.writeHead(304, { etag: tag, 'cache-control': 'no-cache' }); return res.end(); } return send(200, body, { etag: tag, 'cache-control': 'no-cache' }); };
    try {
      const refused = requestAllowed(req, server.address().port); if (refused) throw new HttpError(403, refused);
      const url = new URL(req.url, 'http://x');
      const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const open = seg.length === 2 && (seg[1] === 'login' || seg[1] === 'session' || seg[1] === 'logout');
      if (seg[0] === 'api' && !open && !sessionOf(req)) throw new HttpError(401, 'sign in first');
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!seg.length || (seg.length === 1 && STATIC_MIME[path.extname(seg[0])])) { const f = path.join(STATIC_DIR, path.basename(seg[0] || 'index.html')); if (!fs.existsSync(f)) throw new HttpError(404, 'not found'); const ancestors = (CFG.embedOrigins || []).length ? CFG.embedOrigins.join(' ') : "'none'"; const bridge = !seg.length ? embedSession(req, url) : null; return send(200, fs.readFileSync(f), { ...(bridge ? { 'set-cookie': bridge } : {}), 'content-type': `${STATIC_MIME[path.extname(f)]}; charset=utf-8`, 'content-security-policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; frame-ancestors ${ancestors}` }); }
        if (seg[0] !== 'api') throw new HttpError(404, 'not found');
        if (seg[1] === 'session' && seg.length === 2) { const s = sessionOf(req); return send(200, s ? { authed: true, name: s.name, roles: s.roles, accounts: users.length > 0 } : { authed: false, accounts: users.length > 0, shared: Boolean(key) }); }
        if (seg[1] === 'board' && seg.length === 2) return sendJson(board());
        if (seg[1] === 'trends' && seg.length === 2) return sendJson(trends());
        if (seg[1] === 'health' && seg.length === 2) { const h = await getHealth(url.searchParams.get('refresh') === '1'); return send(200, { at: new Date(h.at).toISOString(), rows: h.rows }); }
        if (seg[1] === 'requests' && seg.length === 3) return sendJson(detail(seg[2]));
        if (seg[1] === 'requests' && seg[3] === 'runs' && seg.length === 5) { const part = url.searchParams.get('part'); if (!part) return send(200, transcript(seg[2], seg[4])); const base = runBase(seg[2], seg[4]); const f = base && { prompt: `${base}.prompt.md`, final: `${base}.final.md` }[part]; if (!f || !fs.existsSync(f)) throw new HttpError(404, 'not found'); return send(200, fs.readFileSync(f), { 'content-type': 'text/plain; charset=utf-8' }); }
        if (seg[1] === 'requests' && seg[3] === 'files' && seg.length > 4) {
          const rel = seg.slice(4).join('/'); const f = resolveInside(T.artifactsDir(seg[2]), rel);
          if (!f || !fs.statSync(f).isFile()) throw new HttpError(404, 'file not found');
          const ext = path.extname(f).toLowerCase(); let type = MIME[ext];
          if (rel === 'evidence.html') type = 'text/html'; // generated by code, not by an agent
          const download = url.searchParams.get('download') === '1' || ['.xlsx', '.docx'].includes(ext);
          if (url.searchParams.get('as') === 'pdf') {
            if (ext !== '.md') throw new HttpError(400, 'only a markdown file can be opened as a pdf');
            const st = fs.statSync(f); const key = crypto.createHash('sha1').update(`${rel}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 16);
            const out = path.join(runsDir(seg[2]), 'pdf-cache', `${key}.pdf`);
            if (!PDF.isPdf(out)) { const title = rel === 'summary.md' ? T.loadRequest(seg[2]).title : path.basename(f, '.md'); try { await PDF.toPdf(MD.page(title, fs.readFileSync(f, 'utf8')), out); } catch (e) { throw new HttpError(503, `could not make the pdf: ${e.message}`); } }
            const fname = rel === 'summary.md' ? `${path.basename(T.requestDir(seg[2]))}-summary.pdf` : `${path.basename(f, '.md')}.pdf`;
            return send(200, fs.readFileSync(out), { 'content-type': 'application/pdf', 'content-disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${safeName(fname)}"` });
          }
          return send(200, fs.readFileSync(f), { ...(type ? { 'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type } : { 'content-type': 'application/octet-stream' }), ...(download ? { 'content-disposition': `attachment; filename="${safeName(path.basename(f))}"` } : {}) });
        }
        throw new HttpError(404, 'not found');
      }
      if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new HttpError(413, 'request too large'); chunks.push(c); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'body is not JSON'); }
      if (seg[0] === 'api' && seg[1] === 'login' && seg.length === 2) {
        if (Date.now() < fails.until) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((fails.until - Date.now()) / 1000)} seconds.`);
        const account = users.find((u) => same(body.key, u.key)) || null; const shared = !account && key && same(body.key, key);
        if (!account && !shared) { fails.n += 1; if (fails.n >= 5) { fails.n = 0; fails.until = Date.now() + 30000; } throw new HttpError(401, 'That key is not right.'); }
        fails.n = 0;
        const name = account ? String(account.name) : String(body.name || '').trim().slice(0, 60);
        if (!name) throw new HttpError(400, 'Enter your name: it is recorded on what you do.');
        const roles = account ? (Array.isArray(account.roles) ? account.roles.filter((r) => ROLES.includes(r)) : ['requester']) : ROLES;
        const tok = crypto.randomBytes(24).toString('hex');
        sessions.set(tok, { name, roles, account: Boolean(account), exp: Date.now() + 7 * 864e5 });
        // Lax (not Strict) so the cookie still travels when the page is embedded by the Dime app on the same site (localhost, another port)
        return send(200, { authed: true, name, roles }, { 'set-cookie': `${cookieName()}=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
      }
      if (seg[0] === 'api' && seg[1] === 'logout' && seg.length === 2) { sessions.delete(tokenOf(req)); return send(200, { authed: false }, { 'set-cookie': `${cookieName()}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); }
      if (seg[0] === 'api' && seg[1] === 'requests' && seg.length === 2) {
        const text = String(body.body || '').trim(); const title = String(body.title || '').trim() || deriveTitle(text);
        if (!title) throw new HttpError(400, 'describe the request first');
        if (body.kind && !O.KINDS.includes(body.kind)) throw new HttpError(400, `kind must be one of ${O.KINDS.join(', ')}`);
        const t = T.createRequest({ title, body: text, reporter: who(req), backend: body.backend || null });
        if (body.kind) { t.kind = body.kind; T.saveRequest(t); }
        // sent from inside a client's workspace in the Dime app: that business is the subject, so the requester never has to name it
        const biz = String(body.business || '').trim();
        if (biz) { if (!/^[A-Za-z0-9_-]{1,64}$/.test(biz)) throw new HttpError(400, 'business must be a Dime business id'); const bname = oneLine(String(body.businessName || ''), 120); t.client = { businessId: biz, businessName: bname || null }; t.subject = { businessIds: [biz], ...(bname ? { businessNames: [bname] } : {}) }; T.saveRequest(t); }
        try { const files = saveAttachments(t.id, body.attachments); if (files.length) T.addComment(t.id, { author: t.reporter, stage: 'intake', body: `Attached: ${files.map((f) => f.name).join(', ')}` }); } catch (e) { T.addComment(t.id, { author: 'orchestrator', stage: 'intake', body: `⚠ attachment not saved: ${e.message}` }); }
        if (body.start !== false) request(t.id, who(req));
        return send(201, detail(t.id));
      }
      if (seg[0] === 'api' && seg[1] === 'requests' && seg.length === 4 && Object.prototype.hasOwnProperty.call(actions, seg[3])) { T.loadRequest(seg[2]); const extra = actions[seg[3]](seg[2], body, req) || {}; return send(200, { ...detail(seg[2]), ...extra }); }
      throw new HttpError(404, 'not found');
    } catch (e) { const code = e instanceof HttpError ? e.code : /not found$/.test(e.message) ? 404 : 400; send(code, { error: e.message }); }
  });
  server.pump = pump;
  const timer = setInterval(() => { try { pump(); } catch { /* next tick */ } }, 2000); timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

function runDoctor() { return new Promise((resolve) => { execFile(process.execPath, [LAB_BIN, 'doctor'], { cwd: ROOT, timeout: 40000 }, (err, stdout) => { const rows = String(stdout || '').split('\n').map((l) => l.trim()).filter((l) => /^[✔✖ℹ]/.test(l)).map((l) => ({ ok: l[0] === '✔' ? true : l[0] === '✖' ? false : null, text: l.slice(1).trim().replace(/\S+@\S+/g, '(configured)') })); resolve(rows.length ? rows : [{ ok: false, text: `lab doctor produced no output${err ? ` (${err.message.split('\n')[0]})` : ''}` }]); }); }); }
function slackNotifier(cfg) {
  const hook = process.env.LAB_NOTIFY_WEBHOOK || (cfg && cfg.webhook); if (!hook) return () => {};
  const base = (cfg && cfg.baseUrl) || ''; const words = { gate: 'needs your approval', questions: 'has questions for you', blocked: 'is blocked', error: 'stopped unexpectedly', done: 'is delivered' };
  return (n) => { const u = new URL(hook); const body = JSON.stringify({ text: `${n.id} ${words[n.state] || n.state}: ${n.title} (${n.label})${base ? ` ${base}/#/r/${n.id}` : ''}` }); const r = (u.protocol === 'http:' ? http : https).request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 8000 }); r.on('error', () => {}); r.on('timeout', () => r.destroy()); r.end(body); };
}
function start({ port, log = console.log } = {}) {
  const server = createServer(); const p = port ?? (Number(process.env.LAB_UI_PORT) || CFG.port || 4790);
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '127.0.0.1', () => { log(`Request Desk → http://127.0.0.1:${server.address().port}\n  orchestrator: ${ROOT}\n  Ctrl-C stops the dashboard; runs it started keep going`); resolve(server); }); });
}

module.exports = { createServer, start, loadKey, ORCH_DIR: ROOT, deriveTitle, safeName, resolveInside, requestAllowed, saveAttachments, activeState, costRates, evidence, assurance, sourceName, deliverablesOf, scopeReview, proposalsReview, transcript, slackNotifier };
