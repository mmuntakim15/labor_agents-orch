'use strict';
// Request store. One folder per request:
//   requests/<ID>/request.json      fields
//   requests/<ID>/comments.jsonl    append-only comment stream
//   requests/<ID>/artifacts/        files the agents produce (data/, deliverables/, attachments/)
// Lifted from dev-agents-orch/src/ticket.js; the vocabulary is "request".

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'REQ';

function requestsDir() { return process.env.LAB_REQUESTS_DIR || path.join(ROOT, 'requests'); }
/** Where run transcripts and the event log live (LAB_RUNS_DIR for tests and sandboxes). */
function runsDir() { return process.env.LAB_RUNS_DIR || path.join(ROOT, 'runs'); }

function requestDir(id) {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) throw new Error('bad request id');
  return path.join(requestsDir(), safe);
}

function artifactsDir(id) {
  const d = path.join(requestDir(id), 'artifacts');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function nextId() {
  const counterFile = path.join(requestsDir(), '.counter');
  fs.mkdirSync(requestsDir(), { recursive: true });
  let n = 0;
  try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0; } catch { /* first request */ }
  n += 1;
  fs.writeFileSync(counterFile, String(n));
  return `${PREFIX}-${n}`;
}

function emptyGates() {
  return {
    1: { approved: false, by: null, at: null, note: null },
    2: { approved: false, by: null, at: null, note: null },
  };
}

function createRequest({ title, body, reporter = 'human', backend = null }) {
  if (!title) throw new Error('title is required');
  const id = nextId();
  const now = new Date().toISOString();
  const req = {
    id,
    title,
    body: body || '',
    reporter,
    backend,
    status: 'intake',
    kind: null,            // report | export | question | data_task | change_request
    size: null,            // S | M | L
    writes: false,
    worker: null,          // analyst | investigator | preparer | bookkeeper
    subject: {},           // { businessIds[], businessNames[], periods[], accounts[] }
    done: [],              // definition of done items
    gates: emptyGates(),
    loops: { verify: 0 },
    answers: '',
    pendingQuestions: [],
    proposals: [],         // mirror of proposals.json statuses (id, status, by, at, appliedRef)
    touches: 0,            // decisions a person made on this request (gates, proposals, answers, inputs); policy decisions never count
    inputsNeeded: [],      // RD-2: documents only a person can supply [{name, period, why, acceptedTypes, askedAt, receivedAt, missing}]
    children: [],
    parentId: null,
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
  fs.mkdirSync(path.join(requestDir(id), 'artifacts'), { recursive: true });
  saveRequest(req);
  fs.writeFileSync(path.join(requestDir(id), 'comments.jsonl'), '');
  addComment(id, { author: reporter, stage: 'intake', body: `${title}\n\n${body || ''}`.trim() });
  return req;
}

function loadRequest(id) {
  const p = path.join(requestDir(id), 'request.json');
  if (!fs.existsSync(p)) throw new Error(`request ${id} not found`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveRequest(req) {
  req.updatedAt = new Date().toISOString();
  const p = path.join(requestDir(req.id), 'request.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(req, null, 2));
  fs.renameSync(tmp, p);
  return req;
}

function addComment(id, { author, stage, body }) {
  const line = JSON.stringify({ at: new Date().toISOString(), author, stage, body });
  fs.appendFileSync(path.join(requestDir(id), 'comments.jsonl'), `${line}\n`);
}

function listComments(id) {
  const p = path.join(requestDir(id), 'comments.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Top-level artifact names plus the files under data/, deliverables/ and attachments/ (as "dir/name"). */
function listArtifacts(id) {
  const d = artifactsDir(id);
  const out = [];
  for (const f of fs.readdirSync(d).filter((f) => !f.startsWith('.')).sort()) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { for (const g of fs.readdirSync(p).filter((x) => !x.startsWith('.')).sort()) out.push(`${f}/${g}`); } else out.push(f);
  }
  return out;
}

function readArtifact(id, name) {
  const p = path.join(artifactsDir(id), name.replace(/^\/+/, ''));
  if (!p.startsWith(artifactsDir(id))) return null;
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function readJsonArtifact(id, name) {
  const raw = readArtifact(id, name);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${name} is not valid JSON: ${e.message}`); }
}

function writeArtifact(id, name, content) {
  const p = path.join(artifactsDir(id), name.replace(/^\/+/, ''));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 1));
  return p;
}

function listRequests() {
  const dir = requestsDir();
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${PREFIX}-\\d+$`);
  return fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => parseInt(a.slice(PREFIX.length + 1), 10) - parseInt(b.slice(PREFIX.length + 1), 10))
    .map((id) => loadRequest(id));
}

module.exports = {
  PREFIX, requestsDir, runsDir, requestDir, artifactsDir,
  createRequest, loadRequest, saveRequest, addComment, listComments,
  listArtifacts, readArtifact, readJsonArtifact, writeArtifact, listRequests,
};
