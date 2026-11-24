'use strict';
// The compute sandbox (FR-36): a pure program runs deterministically and the
// Verifier's rerun finds the bytes identical; escapes fail; the time cap and
// every refusal are enforced and receipted; the tool surface exposes run to
// workers and rerun only to read-only roles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sandbox } = require('./helpers');
sandbox('sandbox');
const T = require('../src/request');
const R = require('../src/receipts');
const SB = require('../src/sandbox');
const H = require('../src/sandboxHarness');
const { base } = require('../src/agentBase');
const P = require('../src/prompting');
const G = require('../hooks/guard');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'sandbox.js');
const cli = (...args) => { const p = spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' }); let out = null; try { out = JSON.parse(p.stdout); } catch { out = { raw: p.stdout, stderr: p.stderr }; } return { code: p.status, out }; };

function freshRequest() {
  const r = T.createRequest({ title: 'Sandbox', body: 'sum a column' });
  T.writeArtifact(r.id, 'data/rows.csv', 'account,amount\nRent,4500.50\nPayroll,41006.18\nFees,12.25\n');
  T.writeArtifact(r.id, 'data/bills.json', { items: [{ id: 'b1', total: 100 }, { id: 'b2', total: 250.75 }] });
  R.append(r.id, { method: 'GET', path: '/api/v1/x', status: 200, outFile: 'data/bills.json' });
  return T.loadRequest(r.id);
}
const SUM = 'const rows = inputs[0].rows.slice(1);\nconsole.log("rows", rows.length);\nconst bills = inputs[1].json.items;\nreturn { total: Math.round(rows.reduce((s, r) => s + Number(r[1]), 0) * 100) / 100, bills: bills.reduce((s, b) => s + b.total, 0), asOf: new Date().toISOString().slice(0, 10), now: Date.now(), threshold: args.threshold };';

test('run: a pure program sums a column deterministically; two runs and a rerun are byte-identical; the trace names inputs, receipts, args and the program sha', () => {
  const r = freshRequest();
  T.writeArtifact(r.id, 'sum.js', SUM);
  const a = SB.run(r, { program: 'sum.js', inputNames: ['rows.csv', 'bills.json'], args: { threshold: 100, asOf: '2026-10-31' }, outName: 'totals', purpose: 'column total' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(a.result, { total: 45518.93, bills: 350.75, asOf: '2026-10-31', now: Date.parse('2026-10-31'), threshold: 100 });
  assert.deepEqual(a.logs, ['rows 3']);
  assert.equal(a.programSha, SB.sha256(SUM)); assert.equal(a.programSha.length, 64);
  assert.ok(fs.existsSync(path.join(T.artifactsDir(r.id), 'programs', `${a.programSha}.js`)), 'the program is stored by sha');
  assert.equal(a.outFile, 'data/totals.json');
  assert.deepEqual(a.trace.inputs.map((i) => i.name), ['rows.csv', 'bills.json']); assert.ok(a.trace.inputs.every((i) => /^[0-9a-f]{16}$/.test(i.sha)));
  assert.deepEqual(a.trace.receipts, [1], 'the receipt behind bills.json is carried'); assert.deepEqual(a.trace.args, { threshold: 100, asOf: '2026-10-31' }); assert.equal(a.trace.argsHash.length, 12);
  const file = fs.readFileSync(path.join(T.artifactsDir(r.id), a.outFile), 'utf8');
  assert.deepEqual(JSON.parse(file), { result: a.result, trace: a.trace });
  assert.equal(file, require('../src/compute').stable({ result: a.result, trace: a.trace }), 'the stable writer of the compute runner');
  const b = SB.run(r, { program: 'sum.js', inputNames: ['rows.csv', 'bills.json'], args: { threshold: 100, asOf: '2026-10-31' }, outName: 'totals-again' });
  assert.equal(fs.readFileSync(path.join(T.artifactsDir(r.id), b.outFile), 'utf8'), file, 'second run is byte-identical');
  const rr = SB.rerun(r, { sha: a.programSha });
  assert.equal(rr.ok, true, JSON.stringify(rr)); assert.equal(rr.identical, true); assert.equal(rr.diff, null); assert.equal(rr.runs.length, 2);
  const short = SB.rerun(r, { sha: a.programSha.slice(0, 12) });
  assert.equal(short.identical, true, 'a 12-char prefix finds the program');
  const recs = R.list(r.id).filter((x) => x.kind === 'compute');
  assert.equal(recs.length, 4);
  assert.deepEqual(recs.slice(0, 2).map((x) => [x.method, x.status, x.outFile, x.path === a.programSha]), [['SANDBOX', 'ok', 'data/totals.json', true], ['SANDBOX', 'ok', 'data/totals-again.json', true]]);
  assert.equal(recs[0].purpose, 'column total');
  assert.deepEqual(recs.slice(2).map((x) => [x.method, x.status, x.identical]), [['SANDBOX_RERUN', 'ok', true], ['SANDBOX_RERUN', 'ok', true]]);
  // a frozen clock: the same program without asOf stamps the epoch, so two runs still agree
  const z = SB.run(r, { program: 'sum.js', inputNames: ['rows.csv', 'bills.json'], args: {}, outName: 'epoch' });
  assert.equal(z.result.asOf, '1970-01-01'); assert.equal(z.result.now, 0);
});

test('rerun: a changed input, a tampered program or a non-deterministic result is reported with the first differing path and receipted as failed', () => {
  const r = freshRequest();
  T.writeArtifact(r.id, 'sum.js', SUM);
  const a = SB.run(r, { program: 'sum.js', inputNames: ['rows.csv', 'bills.json'], args: { asOf: '2026-10-31' }, outName: 'totals' });
  // a differing output: edit the data file the trace points at (as if the worker had changed the result by hand)
  const outPath = path.join(T.artifactsDir(r.id), a.outFile);
  const doc = JSON.parse(fs.readFileSync(outPath, 'utf8')); doc.result.total = 1; fs.writeFileSync(outPath, require('../src/compute').stable(doc));
  const rr = SB.rerun(r, { sha: a.programSha });
  assert.equal(rr.ok, true); assert.equal(rr.identical, false); assert.equal(rr.diff, '$.result.total');
  assert.equal(R.list(r.id).slice(-1)[0].status, 'failed');
  // an input that changed since the run
  T.writeArtifact(r.id, 'data/rows.csv', 'account,amount\nRent,1\n');
  const ic = SB.rerun(r, { sha: a.programSha });
  assert.equal(ic.identical, false); assert.equal(ic.runs[0].inputChanged, 'rows.csv'); assert.match(ic.runs[0].diff, /inputs\[0\]\.sha/);
  // a stored program that no longer hashes to its name
  fs.writeFileSync(path.join(T.artifactsDir(r.id), 'programs', `${a.programSha}.js`), 'return 1;');
  assert.match(SB.rerun(r, { sha: a.programSha }).error, /altered/);
  assert.match(SB.rerun(r, { sha: 'deadbeefdeadbeef' }).error, /no data file/);
  assert.throws(() => SB.rerun(r, { sha: 'abc' }), /at least 12/);
  assert.equal(SB.firstDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), '$.a[1].b'); assert.equal(SB.firstDiff(1, 1), null); assert.equal(SB.firstDiff({ a: 1 }, { a: 1, b: 2 }), '$.b');
});

test('escapes fail: Function-constructor code generation, require, process, fetch, import(), globalThis and timers are not reachable from a program', () => {
  const r = freshRequest();
  // static refusals (never executed)
  for (const [name, text] of Object.entries({ req: 'return require("fs");', proc: 'return process.env;', fetch: 'return fetch("http://x");', imp: 'return import("fs");', cp: 'return child_process;', xhr: 'return new XMLHttpRequest();' })) {
    T.writeArtifact(r.id, `${name}.js`, text);
    const out = SB.run(r, { program: `${name}.js`, inputNames: [], args: {}, outName: name });
    assert.equal(out.ok, false, name); assert.equal(out.refused, true, name); assert.match(out.error, /references/);
    assert.ok(!fs.existsSync(path.join(T.artifactsDir(r.id), 'data', `${name}.json`)), `${name}: nothing written`);
  }
  // runtime escapes the regex does not see
  T.writeArtifact(r.id, 'esc1.js', 'return this.constructor.constructor("return 1 + 1")();');
  const e1 = SB.run(r, { program: 'esc1.js', inputNames: [], args: {}, outName: 'esc1' });
  assert.equal(e1.ok, false); assert.equal(e1.failed, true); assert.match(e1.error, /TypeError/, 'strict mode: this is undefined inside the program');
  T.writeArtifact(r.id, 'esc1b.js', 'return globalThis.constructor.constructor("return 1 + 1")();');
  const e1b = SB.run(r, { program: 'esc1b.js', inputNames: [], args: {}, outName: 'esc1b' });
  assert.equal(e1b.failed, true); assert.match(e1b.error, /EvalError|Code generation from strings disallowed/);
  T.writeArtifact(r.id, 'esc2.js', 'return Math.max.constructor("return 2")();');
  assert.match(SB.run(r, { program: 'esc2.js', inputNames: [], args: {}, outName: 'esc2' }).error, /EvalError|disallowed/);
  T.writeArtifact(r.id, 'esc3.js', 'return [typeof globalThis, typeof require, typeof setTimeout, typeof Function, typeof eval, typeof Buffer, Object.keys(globalThis).sort().join(",")];');
  const e3 = SB.run(r, { program: 'esc3.js', inputNames: [], args: {}, outName: 'esc3' });
  assert.equal(e3.ok, true, JSON.stringify(e3));
  assert.deepEqual(e3.result.slice(0, 6), ['object', 'undefined', 'undefined', 'function', 'function', 'undefined'], 'Function and eval exist as realm intrinsics but code generation is disallowed (below)');
  T.writeArtifact(r.id, 'esc6.js', 'return eval("1 + 1");');
  assert.match(SB.run(r, { program: 'esc6.js', inputNames: [], args: {}, outName: 'esc6' }).error, /EvalError|disallowed/);
  assert.equal(e3.result[6], 'Array,Boolean,Date,Error,JSON,Map,Math,Number,Object,Set,String,args,console,inputs,isFinite,isNaN,parseFloat,parseInt', 'only the listed globals exist');
  T.writeArtifact(r.id, 'esc4.js', 'return Function("return 3")();');
  assert.match(SB.run(r, { program: 'esc4.js', inputNames: [], args: {}, outName: 'esc4' }).error, /EvalError|disallowed/);
  T.writeArtifact(r.id, 'esc5.js', 'try { Math.max = null; JSON.parse = null; inputs.push; } catch (e) { return "threw " + e.constructor.name; } return typeof Math.max;');
  assert.equal(SB.run(r, { program: 'esc5.js', inputNames: [], args: {}, outName: 'esc5' }).result, 'threw TypeError', 'the exposed objects are frozen (strict mode makes the write throw)');
  T.writeArtifact(r.id, 'esc7.js', 'leak = 7; return leak;');
  assert.match(SB.run(r, { program: 'esc7.js', inputNames: [], args: {}, outName: 'esc7' }).error, /ReferenceError/, 'no accidental globals');
  T.writeArtifact(r.id, 'thrower.js', 'throw new Error("boom");');
  const th = SB.run(r, { program: 'thrower.js', inputNames: [], args: {}, outName: 'th' });
  assert.equal(th.failed, true); assert.match(th.error, /boom/);
  assert.equal(R.list(r.id).filter((x) => x.status === 'failed').length, 7, 'every runtime failure is receipted (esc1, esc1b, esc2, esc4, esc6, esc7, thrower)');
  // the harness in-process agrees with the child about the frozen clock
  assert.equal(H.run({ program: 'return Date.now();', now: 42 }).result, 42);
  assert.equal(H.frozenDate(1000).now(), 1000); assert.ok(new (H.frozenDate(1000))() instanceof Date);
});

test('the cap: a tight loop is killed at LAB_SANDBOX_TIMEOUT_MS and refused with a receipt; the default cap is 60 s', () => {
  const r = freshRequest();
  T.writeArtifact(r.id, 'loop.js', 'let n = 0; while (true) { n += 1; } return n;');
  assert.equal(SB.timeoutMs(), 60000);
  process.env.LAB_SANDBOX_TIMEOUT_MS = '400';
  try {
    assert.equal(SB.timeoutMs(), 400);
    const t0 = Date.now();
    const out = SB.run(r, { program: 'loop.js', inputNames: [], args: {}, outName: 'loop' });
    assert.equal(out.ok, false); assert.equal(out.refused, true); assert.match(out.error, /exceeded the 400 ms cap/);
    assert.ok(Date.now() - t0 < 10000, 'the child was killed promptly');
    const rec = R.list(r.id).slice(-1)[0];
    assert.equal(rec.status, 'refused'); assert.equal(rec.method, 'SANDBOX'); assert.match(rec.refused, /cap/); assert.equal(rec.path, SB.sha256('let n = 0; while (true) { n += 1; } return n;'));
    assert.ok(!fs.existsSync(path.join(T.artifactsDir(r.id), 'data', 'loop.json')));
  } finally { delete process.env.LAB_SANDBOX_TIMEOUT_MS; }
});

test('refusals: program over 20 KB, program or input outside the request folder, missing program, missing --out; each is receipted as refused and writes nothing', () => {
  const r = freshRequest();
  T.writeArtifact(r.id, 'big.js', `return 1; // ${'x'.repeat(SB.MAX_PROGRAM_BYTES)}`);
  const big = SB.run(r, { program: 'big.js', inputNames: [], args: {}, outName: 'big' });
  assert.equal(big.refused, true); assert.match(big.error, /bytes; the cap is 20480/);
  T.writeArtifact(r.id, 'ok.js', 'return inputs.length;');
  const outside = SB.run(r, { program: '../../request.json', inputNames: [], args: {}, outName: 'o1' });
  assert.equal(outside.refused, true); assert.match(outside.error, /program .* outside the request folder/);
  const abs = SB.run(r, { program: path.join(T.requestDir(r.id), 'request.json'), inputNames: [], args: {}, outName: 'o2' });
  assert.equal(abs.refused, true); assert.match(abs.error, /outside the request folder/);
  const inOut = SB.run(r, { program: 'ok.js', inputNames: ['../../request.json'], args: {}, outName: 'o3' });
  assert.equal(inOut.refused, true); assert.match(inOut.error, /input .* outside the request folder/);
  const inAbs = SB.run(r, { program: 'ok.js', inputNames: [path.join(T.requestDir(r.id), 'request.json')], args: {}, outName: 'o4' });
  assert.equal(inAbs.refused, true); assert.match(inAbs.error, /outside the request folder/);
  const missing = SB.run(r, { program: 'nope.js', inputNames: [], args: {}, outName: 'o5' });
  assert.equal(missing.refused, true); assert.match(missing.error, /does not exist/);
  const noOut = SB.run(r, { program: 'ok.js', inputNames: [], args: {}, outName: '' });
  assert.equal(noOut.refused, true); assert.match(noOut.error, /--out/);
  const noIn = SB.run(r, { program: 'ok.js', inputNames: ['ghost.csv'], args: {}, outName: 'o6' });
  assert.equal(noIn.failed, true, 'a missing input is a failure, not a refusal'); assert.match(noIn.error, /input not found/);
  const insideAbs = SB.run(r, { program: path.join(T.artifactsDir(r.id), 'ok.js'), inputNames: [path.join(T.artifactsDir(r.id), 'data', 'rows.csv')], args: {}, outName: 'o7' });
  assert.equal(insideAbs.ok, true, 'absolute paths inside the artifacts folder are fine'); assert.equal(insideAbs.result, 1);
  const refused = R.list(r.id).filter((x) => x.status === 'refused');
  assert.equal(refused.length, 7); assert.ok(refused.every((x) => x.kind === 'compute' && x.method === 'SANDBOX' && x.outFile === null && x.refused));
  assert.deepEqual(fs.readdirSync(path.join(T.artifactsDir(r.id), 'data')).sort(), ['bills.json', 'o7.json', 'rows.csv']);
  assert.equal(SB.refuseReason(''), 'program is empty'); assert.equal(SB.refuseReason('return 1;'), null); assert.match(SB.refuseReason('const p = process;'), /process/);
  assert.match(SB.refuseReason('const r = require ("x")'), /require/); assert.equal(SB.refuseReason('const requirement = 1; return requirement;'), null, 'word boundaries');
});

test('the tool: run and rerun through the CLI; exit 1 on a refusal with the receipt number; usage errors', () => {
  const r = freshRequest();
  T.writeArtifact(r.id, 'sum.js', SUM);
  const a = cli('run', '--request', r.id, '--program', 'sum.js', '--in', 'rows.csv,bills.json', '--args', '{"threshold":5,"asOf":"2026-09-30"}', '--out', 'cli-total');
  assert.equal(a.code, 0, JSON.stringify(a.out)); assert.equal(a.out.ok, true); assert.equal(a.out.result.total, 45518.93); assert.equal(a.out.result.asOf, '2026-09-30'); assert.match(a.out.next, /R-2/);
  const rr = cli('rerun', '--request', r.id, '--sha', a.out.programSha);
  assert.equal(rr.code, 0); assert.equal(rr.out.identical, true);
  T.writeArtifact(r.id, 'bad.js', 'return process.pid;');
  const bad = cli('run', '--request', r.id, '--program', 'bad.js', '--out', 'bad');
  assert.equal(bad.code, 1); assert.equal(bad.out.refused, true); assert.ok(bad.out.receipt > 0);
  assert.equal(cli('run', '--request', r.id, '--program', 'sum.js', '--in', 'rows.csv', '--args', '{bad', '--out', 'x').out.error.includes('--args is not valid JSON'), true);
  assert.match(cli('run', '--request', r.id, '--program', 'sum.js', '--args', '[1]', '--out', 'x').out.error, /JSON object/);
  assert.match(cli('rerun', '--request', r.id).out.error, /--sha/);
  assert.match(cli('bogus').out.error, /usage/);
  assert.match(cli('run').out.error, /--request/);
  assert.match(cli('run', '--request', 'REQ-999', '--program', 'x', '--out', 'x').out.error, /not found/);
});

test('tool surface: workers and the Verifier get sandbox.js; read-only roles may rerun but not run; the prompt describes run and rerun; the guard allows the tool by path', () => {
  const ctx = { artifactsDir: '/tmp/art', request: { id: 'REQ-7', title: 't', status: 'execute', body: '' } };
  const worker = base(ctx, { canWrite: true });
  assert.ok(worker.allowedTools.some((t) => /sandbox\.js:\*/.test(t)));
  assert.ok(!worker.forbidden.some((f) => /sandbox/.test(f)));
  const ro = base(ctx, { readOnly: true });
  assert.ok(ro.allowedTools.some((t) => /sandbox\.js:\*/.test(t)), 'the Verifier can rerun');
  const forb = ro.forbidden.map((s) => new RegExp(s));
  assert.ok(forb.some((re) => re.test(`node ${TOOL} run --request REQ-7 --program x.js --out y`)), 'run is forbidden when read-only');
  assert.ok(!forb.some((re) => re.test(`node ${TOOL} rerun --request REQ-7 --sha abc`)), 'rerun is not');
  const env = { LAB_WRITE_ROOTS: '/tmp/art', LAB_FORBIDDEN: JSON.stringify(ro.forbidden) };
  assert.equal(G.decide({ tool_name: 'Bash', tool_input: { command: `node ${TOOL} rerun --request REQ-7 --sha abc` } }, env).allow, true);
  assert.equal(G.decide({ tool_name: 'Bash', tool_input: { command: `node ${TOOL} run --request REQ-7 --program x.js --out y` } }, env).allow, false, 'the guard enforces the read-only forbid');
  assert.equal(G.decide({ tool_name: 'Bash', tool_input: { command: `node ${TOOL} run --request REQ-7 --program x.js --out y` } }, { LAB_WRITE_ROOTS: '/tmp/art' }).allow, true, 'workers run it');
  assert.match(G.decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }, env).reason, /sandbox/);
  const tb = P.toolsBlock(ctx, { readOnly: false });
  assert.match(tb, /sandbox\.js run --request REQ-7 --program/); assert.match(tb, /no compute verb covers/); assert.match(tb, /Verifier reruns it by sha/); assert.match(tb, /sandbox\.js rerun --request REQ-7 --sha/);
  const tbr = P.toolsBlock(ctx, { readOnly: true });
  assert.doesNotMatch(tbr, /sandbox\.js run/); assert.match(tbr, /sandbox\.js rerun/); assert.match(tbr, /never run a new program/);
});
