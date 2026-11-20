#!/usr/bin/env node
'use strict';
// Agent-facing runner for the definition-of-done evaluators.
//   node tools/check.js run  --request REQ-1 [--item D-2]
//   node tools/check.js eval --request REQ-1 --evaluator ties_to_report --args '<json>' [--expect '<json>']
//   node tools/check.js catalog
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const DN = require(path.join(ROOT, 'src', 'done'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null ? rest[i + 1] : d; };
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.ok === false ? 1 : 0); };
const j = (n) => { const v = flag(n); if (v == null) return {}; try { return JSON.parse(v); } catch (e) { out({ ok: false, error: `--${n} is not valid JSON: ${e.message}` }); return {}; } };

(async () => {
  if (cmd === 'catalog') return out({ ok: true, evaluators: DN.CATALOG });
  const id = flag('request') || process.env.LAB_REQUEST; if (!id) return out({ ok: false, error: '--request <ID> is required' });
  const req = T.loadRequest(id);
  if (cmd === 'run') { const r = await DN.runAll(req, { only: flag('item') }); return out({ ok: true, ...r, next: r.pass ? 'Every code-checked item passes. Prose items are judged by the Verifier.' : `Failing: ${r.failing.join(', ')}. Fix the work before you finish; the Verifier will fail the request otherwise.` }); }
  if (cmd === 'eval') {
    const name = String(flag('evaluator') || '').replace(/^check\./, ''); const fn = DN.EVALUATORS[name];
    if (!fn) return out({ ok: false, error: `unknown evaluator ${name}`, known: Object.keys(DN.EVALUATORS) });
    const tmp = { ...req, done: [{ id: 'adhoc', evaluator: name, args: j('args'), expect: j('expect') }] };
    const r = await DN.runAll(tmp); return out({ ok: true, ...r.items[0] });
  }
  out({ ok: false, error: 'usage: run --request <ID> [--item D-n] | eval --request <ID> --evaluator <name> --args <json> [--expect <json>] | catalog' });
})().catch((e) => out({ ok: false, error: e.message }));
