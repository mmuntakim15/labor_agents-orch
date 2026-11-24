#!/usr/bin/env node
'use strict';
// Agent-facing compute sandbox (FR-36): run a small pure JavaScript program
// when no compute verb covers the calculation. The program is the body of a
// function (inputs, args) → result; end it with `return`. inputs are the
// parsed --in files in the shape the compute verbs get ({ name, sha, json |
// rows | sheets | text }). Reads only the request's files; writes only
// artifacts/programs/<sha>.js and data/<out>.json. Never touches Dime.
//
//   node tools/sandbox.js run   --request REQ-1 --program <file.js under artifacts> --in <file>[,<file>…] [--args '<json>'] --out <name> [--purpose "<why>"]
//   node tools/sandbox.js rerun --request REQ-1 --sha <programSha>        the Verifier's replay: same program, same inputs, byte-identical output or not
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const SB = require(path.join(ROOT, 'src', 'sandbox'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null && !String(rest[i + 1]).startsWith('--') ? rest[i + 1] : d; };
// exit only once stdout has drained (a pipe write is asynchronous on macOS)
const out = (o) => { process.stdout.write(`${JSON.stringify(o, null, 1)}\n`, () => process.exit(o.ok === false ? 1 : 0)); };
const USAGE = 'usage: sandbox.js run --request REQ-n --program <file.js> --in <files> [--args <json>] --out <name> | rerun --request REQ-n --sha <programSha>';

(() => {
  if (!['run', 'rerun'].includes(cmd)) return out({ ok: false, error: USAGE });
  const id = flag('request') || process.env.LAB_REQUEST; if (!id) return out({ ok: false, error: '--request <ID> is required' });
  let req; try { req = T.loadRequest(id); } catch (e) { return out({ ok: false, error: e.message }); }
  try {
    if (cmd === 'rerun') { const sha = flag('sha'); if (!sha) return out({ ok: false, error: '--sha <programSha> is required' }); return out(SB.rerun(req, { sha, purpose: flag('purpose') })); }
    let args = {}; const a = flag('args'); if (a) { try { args = JSON.parse(a); } catch (e) { return out({ ok: false, error: `--args is not valid JSON: ${e.message}` }); } }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return out({ ok: false, error: '--args must be a JSON object' });
    const inputNames = String(flag('in') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const r = SB.run(req, { program: flag('program'), inputNames, args, outName: flag('out'), purpose: flag('purpose') });
    return out(r.ok ? { ...r, next: `Cite data/${path.basename(r.outFile)} (receipt R-${r.receipt}) in work.md; the Verifier reruns program ${r.programSha.slice(0, 12)}… by sha.` } : r);
  } catch (e) {
    return out({ ok: false, error: e.message });
  }
})();
