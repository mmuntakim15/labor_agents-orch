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
      P.commentsBlock(ctx),
      '',
      '## Your job now: find out (Investigator)',
      'Follow the investigation method. Pull both sides of the question, match on identifiers, list every exception with its id and amount, state the cutoff and the sync state you relied on, and say plainly what you could not determine. Every count and amount you report must trace to a saved response.',
      `Write ${ctx.artifactsDir}/work.md (the findings with receipts) and the deliverables the definition of done asks for (usually an xlsx of the exceptions and a short memo). Run \`check.js run --request ${r.id}\` before you finish.`,
      '',
      P.resultReminder('Put the one-sentence answer in summary. List deliverables in "artifacts".'),
    ].join('\n'),
  };
}

module.exports = { name: 'investigator', label: 'Investigator', stages: ['execute'], plan };
