'use strict';
// The compute runner end to end: the CLI lists and describes verbs, `run`
// loads request files, writes data/<out>.json with {result, trace}, and the
// trace names the input sha and any receipts behind that file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-compute-'));
process.env.LAB_REQUESTS_DIR = path.join(tmp, 'requests');
process.env.LAB_RUNS_DIR = path.join(tmp, 'runs');
process.env.LAB_QUIET = '1';
const T = require('../../src/request');
const R = require('../../src/receipts');
const CM = require('../../src/compute');
const { FIX } = require('./_h');

const MINE = ['coding_consistency', 'column_map', 'coverage_crosswalk', 'duplicate_pairs', 'gl_hygiene', 'open_item_age', 'recurrence_detect', 'staleness'];
const cli = (...args) => { const p = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'compute.js'), ...args], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' }); let out = null; try { out = JSON.parse(p.stdout); } catch { out = { raw: p.stdout, stderr: p.stderr }; } return { code: p.status, out }; };

test('compute.js list shows every verb with its inputs; describe shows args and output', () => {
  const { code, out } = cli('list');
  assert.equal(code, 0, JSON.stringify(out).slice(0, 2000)); assert.equal(out.ok, true, JSON.stringify(out).slice(0, 2000));
  const names = out.verbs.map((v) => v.name);
  for (const n of MINE) assert.ok(names.includes(n), `${n} is listed`);
  assert.deepEqual(names, [...names].sort(), 'listed in name order');
  for (const v of out.verbs.filter((x) => MINE.includes(x.name))) { assert.ok(v.describe.length > 20); assert.ok(v.inputs.length >= 1); for (const i of v.inputs) assert.ok(i.name && i.shape, `${v.name} input ${i.name} documents its shape`); }
  const d = cli('describe', 'duplicate_pairs');
  assert.equal(d.out.ok, true); assert.equal(d.out.args.days, 30); assert.match(d.out.output, /pairs/);
  const u = cli('describe', 'no_such_verb');
  assert.equal(u.code, 1); assert.match(u.out.error, /unknown verb no_such_verb/); assert.ok(u.out.known.includes('duplicate_pairs'));
  for (const n of MINE) assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'compute', `_${n}.js`)), 'verbs are not underscore files');
  assert.equal(CM.get('_fields'), null, 'the shared helper is not a verb');
});

test('compute.js output is complete when captured through a pipe (exit waits for stdout to drain)', () => {
  // Before the fix in tools/compute.js (console.log then process.exit), 2 of 5 captures on macOS stopped at 8192 bytes.
  const sizes = new Set();
  for (let i = 0; i < 6; i += 1) {
    const p = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'compute.js'), 'list'], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.doesNotThrow(() => JSON.parse(p.stdout), `capture ${i} is not complete JSON (${Buffer.byteLength(p.stdout)} bytes)`);
    sizes.add(Buffer.byteLength(p.stdout));
  }
  assert.equal(sizes.size, 1, `every capture has the same length, got ${[...sizes].join(', ')}`);
  assert.ok([...sizes][0] > 8192, 'the listing is larger than one pipe chunk, so a truncation would show');
});

test('run via src/compute/index.js: writes data/<out>.json with {result, trace}; trace carries the input sha and receipts', async () => {
  const req = T.createRequest({ title: 'Dup check', body: 'find duplicate bills', reporter: 'test' });
  const billsBuf = fs.readFileSync(path.join(FIX, 'bills.json'));
  T.writeArtifact(req.id, 'data/bills.json', billsBuf);
  T.writeArtifact(req.id, 'attachments/bank.csv', fs.readFileSync(path.join(FIX, 'bank.csv')));
  const seq = R.append(req.id, { method: 'GET', path: '/api/v1/transactions/accounting/bookkeeping/businessId/b1/bills', status: 200, outFile: 'data/bills.json' });
  const verb = CM.get('duplicate_pairs');
  const res = await CM.run(verb, { request: T.loadRequest(req.id), fileNames: ['bills', 'bank.csv'], args: { days: 30 }, outName: 'dups' });
  assert.equal(res.outFile, 'data/dups.json');
  assert.equal(res.result.pairs.length, 5);
  const sha = crypto.createHash('sha256').update(billsBuf).digest('hex').slice(0, 16);
  assert.deepEqual(res.trace.inputs, [{ name: 'bills.json', sha }, { name: 'bank.csv', sha: res.trace.inputs[1].sha }]);
  assert.deepEqual(res.trace.receipts, [seq], 'the receipt that produced data/bills.json is traced');
  assert.match(res.trace.argsHash, /^[0-9a-f]{12}$/);
  const written = JSON.parse(T.readArtifact(req.id, 'data/dups.json'));
  assert.deepEqual(Object.keys(written), ['result', 'trace']);
  assert.equal(JSON.stringify(written.result), CM.stable(res.result), 'the file holds the full stable result');
  const again = await CM.run(verb, { request: T.loadRequest(req.id), fileNames: ['bills', 'bank.csv'], args: { days: 30 }, outName: 'dups2' });
  assert.equal(T.readArtifact(req.id, 'data/dups2.json').replace(/dups2/g, 'dups'), T.readArtifact(req.id, 'data/dups.json'), 'byte-identical on a second run');
  assert.equal(again.trace.argsHash, res.trace.argsHash);
});

test('run via the CLI with --request/--in/--args/--out; unknown verb and missing input fail cleanly', () => {
  const req = T.createRequest({ title: 'Aging', body: '', reporter: 'test' });
  T.writeArtifact(req.id, 'data/gl.json', fs.readFileSync(path.join(FIX, 'gl_register.json')));
  const ok = cli('run', 'open_item_age', '--request', req.id, '--in', 'gl.json', '--args', '{"asOf":"2026-11-30"}', '--out', 'aging');
  assert.equal(ok.code, 0, JSON.stringify(ok.out)); assert.equal(ok.out.ok, true); assert.equal(ok.out.verb, 'open_item_age'); assert.equal(ok.out.outFile, 'data/aging.json');
  assert.equal(ok.out.result.open.length, 2);
  assert.ok(fs.existsSync(path.join(T.artifactsDir(req.id), 'data', 'aging.json')));
  const noAsOf = cli('run', 'open_item_age', '--request', req.id, '--in', 'gl.json');
  assert.equal(noAsOf.code, 1); assert.match(noAsOf.out.error, /args\.asOf is required/);
  const unknown = cli('run', 'frobnicate', '--request', req.id, '--in', 'gl.json');
  assert.equal(unknown.code, 1); assert.match(unknown.out.error, /unknown verb frobnicate/); assert.ok(Array.isArray(unknown.out.known));
  const missing = cli('run', 'open_item_age', '--request', req.id, '--in', 'nope.json', '--args', '{"asOf":"2026-11-30"}');
  assert.equal(missing.code, 1); assert.match(missing.out.error, /input not found under data\/ or attachments\/: nope.json/);
  const escape = cli('run', 'open_item_age', '--request', req.id, '--in', '../request.json', '--args', '{"asOf":"2026-11-30"}');
  assert.equal(escape.code, 1); assert.match(escape.out.error, /input not found/, 'paths outside the artifacts folder are never read');
  const noFiles = cli('run', 'coverage_crosswalk', '--request', req.id, '--args', '{"asOf":"2026-11-30"}');
  assert.equal(noFiles.code, 1); assert.match(noFiles.out.error, /coverage_crosswalk needs trialBalance, schedules/);
  const badArgs = cli('run', 'open_item_age', '--request', req.id, '--in', 'gl.json', '--args', '{nope');
  assert.equal(badArgs.code, 1); assert.match(badArgs.out.error, /--args is not valid JSON/);
  const noReq = cli('run', 'open_item_age', '--request', 'REQ-999999', '--in', 'gl.json');
  assert.equal(noReq.code, 1); assert.match(noReq.out.error, /not found/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });
