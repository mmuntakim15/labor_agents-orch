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
    maxTurns: 110,
    maxBudgetUsd: r.size === 'M' ? 12 : 7,
    timeoutMs: 45 * 60 * 1000,
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
      P.artifact(ctx, 'proposals.json', 8000),
      P.commentsBlock(ctx),
      '',
      '## Your job now: prepare the records (Preparer)',
      'Follow the document-task method. Parse each attachment, map rows to Dime records, check what already exists so nothing is duplicated, and stage every create or update as a proposal with the right tier. Never call a write route. Produce the tie-out or summary workbook the definition of done asks for.',
      `Write ${ctx.artifactsDir}/work.md: each attachment and what it contained, each proposal with the attachment row behind it, matches against existing records, the tie-out figures with receipts, and anything you could not map. Run \`check.js run --request ${r.id}\` before you finish.`,
      '',
      P.resultReminder('Report the proposal count in summary. List deliverables in "artifacts".'),
    ].join('\n'),
  };
}

module.exports = { name: 'preparer', label: 'Preparer', stages: ['execute'], plan };
