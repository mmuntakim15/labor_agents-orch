'use strict';
const P = require('../../src/prompting');
const { base } = require('../../src/agentBase');

function plan(ctx) {
  const r = ctx.request;
  const b = base(ctx, { readOnly: true });
  return {
    ...b,
    maxTurns: 60,
    maxBudgetUsd: 5,
    timeoutMs: 25 * 60 * 1000,
    prompt: [
      P.requestBlock(ctx),
      '',
      P.doneBlock(ctx),
      '',
      P.artifactsBlock(ctx),
      P.artifact(ctx, 'checks.json', 12000),
      P.artifact(ctx, 'work.md', 20000),
      P.artifact(ctx, 'proposals.json', 10000),
      P.artifact(ctx, 'applied.json', 4000),
      P.toolsBlock(ctx, { readOnly: true }),
      '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: verify (Verifier)',
      'Follow the verification method. checks.json is what the code already decided; you cannot pass an item the code failed. Reproduce the headline figures and a sample of the others by re-pulling the receipted calls yourself (the HTTP tool, --out to new names), open every deliverable, judge each prose item with evidence, and run `check.js eval --evaluator figures_reproduce` when reports are involved.',
      r.proposalsApplied ? 'Proposals were applied (by a person at Gate 2, or tier A under the entity policy before any gate; applied.json says which): confirm each applied reference exists in Dime with a read call and that the books show the change.' : '',
      'Sandbox programs: for every receipt with method SANDBOX (a program the worker ran because no compute verb covered the arithmetic), run `sandbox.js rerun --request ' + r.id + ' --sha <programSha>` and read programs/<sha>.js. identical false, or a program that cannot be rerun, fails every done item that rests on its output file; quote the diff path as the evidence. Never run a new program.',
      `Write ${ctx.artifactsDir}/verify.json: { "verdict": "pass"|"fail", "items": [ { "id": "D-1", "pass": true, "evidence": "…", "figures": {…} } ], "reproduced": [ { "seq": 1, "ok": true, "note": "…" } ], "uncited": [ … ], "notes": "…" } and ${ctx.artifactsDir}/verify.md for a person.`,
      '',
      P.resultReminder('Set "verdict" in the JSON to pass or fail. A single failing item is a fail. Never edit a deliverable or work.md.'),
    ].join('\n'),
  };
}

module.exports = { name: 'verifier', label: 'Verifier', stages: ['verify'], plan };
