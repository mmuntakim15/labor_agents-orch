'use strict';
// `lab eval`: replay agents on frozen cases and check expectations.
const fs = require('fs');
const path = require('path');
const E = require('./eval');

async function evaluate({ cases = [], dryRun = false, repeat = 1, model = null, log = console.log } = {}) {
  const names = cases.length ? cases : E.listCases();
  if (!names.length) { log('no eval cases under evals/cases'); return { failed: 0, passed: 0 }; }
  let failed = 0; let passed = 0;
  for (const name of names) {
    const c = E.loadCase(name);
    const results = [];
    for (let i = 0; i < repeat; i++) {
      const { request } = E.materialize(c);
      const O = require('./orchestrator'); const T = require('./request');
      if (model) process.env.LAB_CLAUDE_MODEL = model;
      let out;
      try { out = await O.runAgent(T.loadRequest(request.id), c.stage, c.agent, { dryRun }); } catch (e) { results.push({ pass: false, failures: [`run error: ${e.message}`] }); continue; }
      if (dryRun) { results.push({ pass: true, failures: [], dry: true }); continue; }
      const text = c.expect.artifact ? (T.readArtifact(request.id, c.expect.artifact) || '') : '';
      const run = (T.loadRequest(request.id).runs || []).slice(-1)[0] || {};
      results.push(E.check(c.expect, { artifactText: text, result: out.parsed.result, run: { ...run, created: T.listArtifacts(request.id) } }));
    }
    const ok = results.filter((r) => r.pass).length;
    if (ok === results.length) passed += 1; else failed += 1;
    // one report per case under evals/reports/ (a dry run proves nothing and is not recorded); `lab recipes promote` reads a candidate's
    if (!dryRun) { try { require('./recipes').recordEvalReport(name, { pass: ok === results.length, passed: ok, runs: results.length, failures: results.flatMap((r) => r.failures || []) }); } catch (e) { log(`  (eval report not written: ${e.message})`); } }
    log(`${ok === results.length ? '✔' : '✖'} ${name}: ${ok}/${results.length} pass${results.some((r) => r.dry) ? ' (dry run)' : ''}`);
    for (const r of results) for (const f of r.failures) log(`    - ${f}`);
  }
  log(`${passed} case(s) passed, ${failed} failed`);
  return { failed, passed };
}

module.exports = { evaluate };
