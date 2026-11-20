'use strict';
const P = require('../../src/prompting');
const { base } = require('../../src/agentBase');

function plan(ctx) {
  const r = ctx.request;
  const b = base(ctx, { canWrite: Boolean(r.writes) });
  const loop = (r.loops && r.loops.verify) || 0;
  return {
    ...b,
    resumable: true,
    maxTurns: 90,
    maxBudgetUsd: r.size === 'M' ? 10 : 6,
    timeoutMs: 40 * 60 * 1000,
    prompt: [
      P.requestBlock(ctx),
      '',
      P.doneBlock(ctx),
      '',
      P.artifactsBlock(ctx),
      P.artifact(ctx, 'triage.md', 6000),
      P.planBlock(ctx),
      P.toolsBlock(ctx, { readOnly: false }),
      loop ? P.artifact(ctx, 'verify.json', 12000) + '\nThe Verifier failed the previous round. Fix every failing item above; do not argue with a code-checked item.' : '',
      r.sendBackNote ? '' : '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: do the work (Analyst)',
      'Follow the report method and the data-fidelity rules. Pull what the plan names (search the map for anything it does not cover), save every response with --out, compute in files under the artifacts folder, and write the deliverables with the export tool. Every figure you place must come from a receipted response or from arithmetic over receipted figures that you show in work.md.',
      `Write ${ctx.artifactsDir}/work.md: what you did, each deliverable with the receipts behind it, the headline figures, every assumption, and anything you could not determine. Run \`check.js run --request ${r.id}\` before you finish and fix what fails.`,
      '',
      P.resultReminder('List the deliverables you wrote in "artifacts". Use status needs_input only if the work cannot proceed without the requester.'),
    ].join('\n'),
  };
}

module.exports = { name: 'analyst', label: 'Analyst', stages: ['execute'], plan };
