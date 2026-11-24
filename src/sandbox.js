'use strict';
// Compute sandbox (FR-36): a small pure JavaScript program an agent writes when
// no compute verb covers the calculation. The program text is stored once under
// artifacts/programs/<sha256>.js and executed in a child process
// (node --disallow-code-generation-from-strings --max-old-space-size=512
// src/sandboxHarness.js) that runs it with vm.runInNewContext over a frozen
// context exposing only { inputs, args, Math, JSON, Number, String, Array,
// Object, Date (clock frozen at args.asOf or 0), console.log (captured) }.
// The output lands in data/<out>.json as { result, trace } with the same stable
// JSON writer as the compute runner, so the Verifier can `rerun` the program by
// sha on the recorded inputs and compare the bytes. Nothing here reaches Dime.
//
// Refusals (exit 1, receipt status 'refused'): the program text matches
// FORBIDDEN (require(, process, fetch, import(, child_process, XMLHttpRequest),
// the program is over MAX_PROGRAM_BYTES, the program or an input lies outside
// the request's artifacts folder, or the run exceeds the time cap.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const T = require('./request');
const R = require('./receipts');
const CM = require('./compute');

const HARNESS = path.join(__dirname, 'sandboxHarness.js');
const FORBIDDEN = /\brequire\s*\(|\bprocess\b|\bfetch\b|\bimport\s*\(|child_process|XMLHttpRequest/;
const MAX_PROGRAM_BYTES = 20 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The time cap; LAB_SANDBOX_TIMEOUT_MS lets a test use a tight one. */
function timeoutMs() { const n = Number(process.env.LAB_SANDBOX_TIMEOUT_MS); return n > 0 ? n : DEFAULT_TIMEOUT_MS; }

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const stable = CM.stable;

/** Pure: why a program text is refused, or null when it may run. */
function refuseReason(text) {
  if (typeof text !== 'string' || !text.trim()) return 'program is empty';
  if (Buffer.byteLength(text, 'utf8') > MAX_PROGRAM_BYTES) return `program is ${Buffer.byteLength(text, 'utf8')} bytes; the cap is ${MAX_PROGRAM_BYTES}`;
  const m = FORBIDDEN.exec(text);
  if (m) return `program references ${m[0].trim()}; a sandbox program is pure: inputs and args in, a JSON result out`;
  return null;
}

/** Resolve a path given by an agent to an absolute path inside the request's artifacts, or null. */
function insideArtifacts(req, p) {
  const art = path.resolve(T.artifactsDir(req.id));
  const abs = path.resolve(path.isAbsolute(p) ? p : path.join(art, p));
  return abs === art || abs.startsWith(art + path.sep) ? abs : null;
}

/** Pure given the fs: the frozen epoch for the run (args.asOf as a date or ms; else 0). */
function epochOf(args) {
  const v = args && args.asOf;
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v)); return Number.isFinite(t) ? t : 0;
}

/** Copy the program text to artifacts/programs/<sha>.js once; returns { sha, file }. */
function storeProgram(req, text) {
  const sha = sha256(text);
  const dir = path.join(T.artifactsDir(req.id), 'programs'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sha}.js`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
  return { sha, file };
}

/** Load inputs the way the compute runner does; refuses anything outside the request folder. */
function loadInputs(req, names) {
  const files = [];
  for (const name of names) {
    if (path.isAbsolute(name)) {
      const abs = insideArtifacts(req, name);
      if (!abs) throw Object.assign(new Error(`input ${name} is outside the request folder`), { refused: true });
      files.push(CM.loadInput(req, path.relative(T.artifactsDir(req.id), abs)));
      continue;
    }
    if (name.split(/[\\/]/).includes('..')) throw Object.assign(new Error(`input ${name} is outside the request folder`), { refused: true });
    files.push(CM.loadInput(req, name));
  }
  return files;
}

/** Run the stored program in the child; { ok, result, logs, ms } or { ok: false, error, timedOut, ms }. */
function execute(programText, { inputs, args, now }) {
  const t0 = Date.now();
  const job = JSON.stringify({ program: programText, inputs: inputs.map(({ path: _p, ...f }) => f), args, now });
  const p = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--max-old-space-size=512', HARNESS], {
    input: job, encoding: 'utf8', timeout: timeoutMs(), killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES,
    env: { PATH: process.env.PATH || '', LAB_SANDBOX_VM_TIMEOUT_MS: String(timeoutMs()) },
  });
  const ms = Date.now() - t0;
  if (p.error && p.error.code === 'ETIMEDOUT') return { ok: false, error: `program exceeded the ${timeoutMs()} ms cap`, timedOut: true, ms };
  if (p.error) return { ok: false, error: p.error.message, ms };
  let out = null; try { out = JSON.parse(String(p.stdout || '').trim().split('\n').pop() || 'null'); } catch { out = null; }
  if (!out) return { ok: false, error: `the program produced no JSON result (exit ${p.status})${p.stderr ? `: ${String(p.stderr).slice(0, 400)}` : ''}`, ms };
  return { ...out, ms };
}

function receipt(req, rec) { return R.append(req.id, { kind: 'compute', method: 'SANDBOX', run: process.env.LAB_RUN || null, ...rec }); }

/**
 * `sandbox run`: program file + inputs + args → data/<out>.json and a receipt.
 * Returns { ok, programSha, result, logs, trace, outFile, receipt } or { ok: false, refused|failed, error, receipt }.
 */
function run(req, { program, inputNames = [], args = {}, outName, purpose = null }) {
  const safeOut = String(outName || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.json$/, '');
  if (!program) return refuse(req, { error: '--program <file.js> is required', purpose });
  if (!safeOut) return refuse(req, { error: '--out <name> is required', purpose });
  const programPath = insideArtifacts(req, program);
  if (!programPath) return refuse(req, { error: `program ${program} is outside the request folder`, purpose });
  if (!fs.existsSync(programPath)) return refuse(req, { error: `program ${program} does not exist`, purpose });
  const text = fs.readFileSync(programPath, 'utf8');
  const why = refuseReason(text);
  if (why) return refuse(req, { error: why, purpose, path: sha256(text) });
  const { sha } = storeProgram(req, text);
  let inputs;
  try { inputs = loadInputs(req, inputNames); } catch (e) { return e.refused ? refuse(req, { error: e.message, purpose, path: sha }) : fail(req, { error: e.message, purpose, path: sha }); }
  const now = epochOf(args);
  const ex = execute(text, { inputs, args, now });
  if (!ex.ok) return ex.timedOut ? refuse(req, { error: ex.error, purpose, path: sha, ms: ex.ms, inputs: inputs.map((f) => f.name) }) : fail(req, { error: ex.error, purpose, path: sha, ms: ex.ms, logs: ex.logs, inputs: inputs.map((f) => f.name) });
  const trace = {
    programSha: sha, inputs: inputs.map((f) => ({ name: f.name, sha: f.sha })), receipts: receiptsFor(req, inputs),
    argsHash: crypto.createHash('sha256').update(stable(args)).digest('hex').slice(0, 12), args, asOf: now,
  };
  const payload = { result: ex.result, trace };
  const dir = path.join(T.artifactsDir(req.id), 'data'); fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `${safeOut}.json`);
  fs.writeFileSync(outFile, stable(payload));
  const rel = path.relative(T.artifactsDir(req.id), outFile);
  const seq = receipt(req, { path: sha, status: 'ok', outFile: rel, purpose: purpose || `sandbox program → ${rel}`, ms: ex.ms, inputs: trace.inputs, argsHash: trace.argsHash });
  const s = stable(ex.result); const clipped = s.length > 12000;
  return { ok: true, programSha: sha, result: clipped ? { clipped: true, preview: s.slice(0, 12000), note: `result is ${s.length} chars; read the --out file` } : ex.result, logs: ex.logs || [], trace, outFile: rel, receipt: seq };
}

function refuse(req, { error, purpose, path: sha = null, ...extra }) {
  const seq = receipt(req, { path: sha, status: 'refused', refused: error, outFile: null, purpose: purpose || 'sandbox program', ...extra });
  return { ok: false, refused: true, error, receipt: seq };
}
function fail(req, { error, purpose, path: sha = null, logs = [], ...extra }) {
  const seq = receipt(req, { path: sha, status: 'failed', error, outFile: null, purpose: purpose || 'sandbox program', ...extra });
  return { ok: false, failed: true, error, logs, receipt: seq };
}

/** Receipt seqs behind the input files (the HTTP tool names its --out files in receipts.jsonl). */
function receiptsFor(req, files) {
  let all = []; try { all = R.list(req.id); } catch { all = []; }
  const names = new Set(files.map((f) => f.name));
  return all.filter((r) => r.outFile && names.has(path.basename(String(r.outFile)))).map((r) => r.seq).filter((s) => s != null);
}

/** Pure: the first path where two JSON values differ, or null. */
function firstDiff(a, b, at = '$') {
  if (a === b) return null;
  if (Array.isArray(a) && Array.isArray(b)) { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = firstDiff(a[i], b[i], `${at}[${i}]`); if (d) return d; } return null; }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d; }
    return null;
  }
  return at;
}

/** The data files whose trace names this program (full sha or a prefix of 12+ chars). */
function outputsFor(req, sha) {
  const dir = path.join(T.artifactsDir(req.id), 'data');
  if (!fs.existsSync(dir)) return [];
  const want = String(sha || '').trim().toLowerCase();
  if (want.length < 12) throw new Error('--sha must be the program sha (at least 12 characters)');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const ps = j && j.trace && typeof j.trace.programSha === 'string' ? j.trace.programSha : null;
      if (ps && ps.startsWith(want)) out.push({ outFile: path.join('data', f), payload: j });
    } catch { /* not a sandbox output */ }
  }
  return out;
}

/**
 * `sandbox rerun`: execute the stored program again on the inputs each trace recorded and compare the bytes.
 * Returns { ok, programSha, identical, runs: [{ outFile, identical, diff, inputChanged }] }.
 */
function rerun(req, { sha, purpose = null }) {
  const outputs = outputsFor(req, sha);
  if (!outputs.length) return { ok: false, error: `no data file carries a sandbox trace for program ${sha}` };
  const full = outputs[0].payload.trace.programSha;
  const file = path.join(T.artifactsDir(req.id), 'programs', `${full}.js`);
  if (!fs.existsSync(file)) return { ok: false, error: `program ${full} is not stored under artifacts/programs/` };
  const text = fs.readFileSync(file, 'utf8');
  if (sha256(text) !== full) return { ok: false, error: `programs/${full}.js no longer hashes to its name; the stored program was altered` };
  const why = refuseReason(text);
  if (why) return refuse(req, { error: why, purpose: purpose || 'sandbox rerun', path: full });
  const runs = [];
  for (const o of outputs) {
    const tr = o.payload.trace || {};
    const recorded = Array.isArray(tr.inputs) ? tr.inputs : [];
    let inputs;
    try { inputs = loadInputs(req, recorded.map((i) => i.name)); } catch (e) { runs.push({ outFile: o.outFile, identical: false, diff: `inputs: ${e.message}` }); continue; }
    const changed = recorded.find((i, k) => inputs[k] && inputs[k].sha !== i.sha);
    if (changed) { runs.push({ outFile: o.outFile, identical: false, inputChanged: changed.name, diff: `$.trace.inputs[${recorded.indexOf(changed)}].sha` }); continue; }
    const args = tr.args && typeof tr.args === 'object' ? tr.args : {};
    const ex = execute(text, { inputs, args, now: typeof tr.asOf === 'number' ? tr.asOf : epochOf(args) });
    if (!ex.ok) { runs.push({ outFile: o.outFile, identical: false, diff: `rerun failed: ${ex.error}`, ms: ex.ms }); continue; }
    const again = stable({ result: ex.result, trace: tr });
    const original = fs.readFileSync(path.join(T.artifactsDir(req.id), o.outFile), 'utf8');
    const identical = again === original;
    runs.push({ outFile: o.outFile, identical, diff: identical ? null : (firstDiff(JSON.parse(original), JSON.parse(again)) || '$ (byte-level difference only)'), ms: ex.ms });
  }
  const identical = runs.every((r) => r.identical);
  const seq = receipt(req, { method: 'SANDBOX_RERUN', path: full, status: identical ? 'ok' : 'failed', outFile: runs.map((r) => r.outFile).join(','), purpose: purpose || 'rerun of a sandbox program by sha', identical, runs: runs.map((r) => ({ outFile: r.outFile, identical: r.identical, diff: r.diff })) });
  return { ok: true, programSha: full, identical, diff: identical ? null : (runs.find((r) => !r.identical) || {}).diff, runs, receipt: seq };
}

module.exports = { FORBIDDEN, MAX_PROGRAM_BYTES, DEFAULT_TIMEOUT_MS, HARNESS, timeoutMs, refuseReason, insideArtifacts, epochOf, storeProgram, loadInputs, execute, run, rerun, firstDiff, outputsFor, sha256 };
