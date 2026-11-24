#!/usr/bin/env node
'use strict';
// Agent-facing compute tool: deterministic calculations the Dime API does not
// offer (duplicate pairs, open-item aging inside an account, rollforwards, an
// indirect-method cash flow rebuild, depreciation recalculation, ...). Pure:
// the same inputs give byte-identical output. Reads only the request's data/
// and attachments/ files; writes only data/<out>.json. Never touches Dime.
//
//   node tools/compute.js list
//   node tools/compute.js describe <verb>
//   node tools/compute.js run <verb> --request REQ-1 --in <file>[,<file>…] [--args '<json>'] [--out <name>]
//
// A verb is a file src/compute/<verb>.js exporting { name, describe, inputs, run(ctx) }
// where ctx = { request, files: [{ name, path, rows|json|text }], args } and run
// returns a JSON-serialisable result. The result carries the receipt ids of the
// data files it read (from the --out names the HTTP tool used) so the Verifier
// can trace every figure.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const CM = require(path.join(ROOT, 'src', 'compute'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null && !String(rest[i + 1]).startsWith('--') ? rest[i + 1] : d; };
// Exit only once stdout has drained: on macOS a pipe write is asynchronous, so
// console.log + process.exit() truncated `list` at 8 KB when an agent captured it.
const out = (o) => { process.stdout.write(`${JSON.stringify(o, null, 1)}\n`, () => process.exit(o.ok === false ? 1 : 0)); };

(async () => {
  if (cmd === 'list') return out({ ok: true, verbs: CM.list().map((v) => ({ name: v.name, describe: v.describe, inputs: v.inputs || [] })) });
  if (cmd === 'describe') { const v = CM.get(rest[0]); if (!v) return out({ ok: false, error: `unknown verb ${rest[0]}`, known: CM.list().map((x) => x.name) }); return out({ ok: true, name: v.name, describe: v.describe, inputs: v.inputs || [], args: v.args || {}, output: v.output || '' }); }
  if (cmd !== 'run') return out({ ok: false, error: 'usage: compute.js list | describe <verb> | run <verb> --request REQ-n --in <files> [--args <json>] [--out <name>]' });
  const verb = rest[0]; const v = CM.get(verb);
  if (!v) return out({ ok: false, error: `unknown verb ${verb}`, known: CM.list().map((x) => x.name) });
  const id = flag('request') || process.env.LAB_REQUEST; if (!id) return out({ ok: false, error: '--request <ID> is required' });
  let req; try { req = T.loadRequest(id); } catch (e) { return out({ ok: false, error: e.message }); }
  let args = {}; const a = flag('args'); if (a) { try { args = JSON.parse(a); } catch (e) { return out({ ok: false, error: `--args is not valid JSON: ${e.message}` }); } }
  const names = String(flag('in') || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const result = await CM.run(v, { request: req, fileNames: names, args, outName: flag('out') });
    return out({ ok: true, verb: v.name, ...result });
  } catch (e) {
    return out({ ok: false, verb: v.name, error: e.message });
  }
})();
