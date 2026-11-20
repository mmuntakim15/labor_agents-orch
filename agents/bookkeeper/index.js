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
      P.artifact(ctx, 'proposals.json', 8000),
      P.commentsBlock(ctx),
      '',
      '## Your job now: prepare the ledger changes (Bookkeeper)',
      'Follow the ledger-changes method. Find the exact rows or accounts the request names, check the period is open, and stage every change as a proposal: categorisation changes through the categorisation route, journal entries with a balanced entry file, reversals as their own proposal. Never call a write route. Flag any judgment (capitalise, which period, materiality) as a tier C question.',
      `Write ${ctx.artifactsDir}/work.md: the rows found (receipts), each proposal with its entry shown as a debit/credit table, the period-lock state you read, and anything that needs a human decision. Run \`check.js run --request ${r.id}\` before you finish.`,
      '',
      P.resultReminder('Report the proposal count and tiers in summary.'),
    ].join('\n'),
  };
}

module.exports = { name: 'bookkeeper', label: 'Bookkeeper', stages: ['execute'], plan };
