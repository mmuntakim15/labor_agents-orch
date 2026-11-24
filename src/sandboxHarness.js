'use strict';
// The child process behind src/sandbox.js. Started as
//   node --disallow-code-generation-from-strings --max-old-space-size=512 sandboxHarness.js
// with { program, inputs, args, now } as JSON on stdin. Runs the program as the
// body of a function (inputs, args) inside vm.runInNewContext over a frozen
// context that exposes only data and pure built-ins: no require, no process,
// no fetch, no timers, no host globals. Date.now and `new Date()` are pinned
// to `now` so a program that stamps "today" is still reproducible. Prints one
// JSON line { ok, result, logs } or { ok: false, error, logs } and exits.
const vm = require('vm');

/** Pure: a Date constructor whose clock is frozen at `now` (ms since epoch); explicit dates still work. */
function frozenDate(now) {
  const Host = Date;
  const D = function Date(...a) { if (!new.target) return new Host(now).toString(); return a.length ? new Host(...a) : new Host(now); };
  D.now = () => now; D.UTC = Host.UTC; D.parse = Host.parse; D.prototype = Host.prototype;
  return D;
}

function makeContext({ inputs, args, now, logs }) {
  const out = (...xs) => { logs.push(xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  // this process exists for one program, so freezing the host's Math and JSON costs nothing and keeps the program from rewiring them
  const sandbox = {
    inputs, args,
    Math: Object.freeze(Math), JSON: Object.freeze(JSON), Number, String, Array, Object, Boolean, Map, Set, Error, parseInt, parseFloat, isNaN, isFinite,
    Date: frozenDate(now),
    console: Object.freeze({ log: out, info: out, warn: out, error: out }),
  };
  return vm.createContext(Object.freeze(sandbox), { codeGeneration: { strings: false, wasm: false } });
}

function run({ program, inputs = [], args = {}, now = 0 }) {
  const logs = [];
  const ctx = makeContext({ inputs, args, now, logs });
  // strict mode: a bare assignment to an undeclared name is a ReferenceError (no accidental globals) and `this` is undefined, not the global
  const wrapped = `(function (inputs, args) {\n'use strict';\n${program}\n})(inputs, args)`;
  const result = vm.runInContext(wrapped, ctx, { filename: 'program.js', timeout: Number(process.env.LAB_SANDBOX_VM_TIMEOUT_MS) || 60000 });
  return { result, logs };
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let logs = [];
    try {
      const job = JSON.parse(raw || '{}');
      const r = run(job); logs = r.logs;
      const text = JSON.stringify({ ok: true, result: r.result === undefined ? null : r.result, logs });
      process.stdout.write(`${text}\n`, () => process.exit(0));
    } catch (e) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: `${e && e.name ? `${e.name}: ` : ''}${e && e.message ? e.message : String(e)}`, logs })}\n`, () => process.exit(1));
    }
  });
}

module.exports = { run, frozenDate, makeContext };
