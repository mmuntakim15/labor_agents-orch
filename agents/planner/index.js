'use strict';
const P = require('../../src/prompting');
const { base } = require('../../src/agentBase');

function plan(ctx) {
  const b = base(ctx, { readOnly: true });
  const g1 = ctx.request.gates[1];
  return {
    ...b,
    maxTurns: 50,
    maxBudgetUsd: 4,
    timeoutMs: 20 * 60 * 1000,
    prompt: [
      P.requestBlock(ctx),
      '',
      P.doneBlock(ctx),
      '',
      P.artifactsBlock(ctx),
      P.artifact(ctx, 'triage.md', 8000),
      P.toolsBlock(ctx, { readOnly: true }),
      '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: Scope',
      'Follow the plan standard. Find every call the worker will need in the endpoint map (search, then read the domain catalogue), decide which attachments must be parsed and how, list every write the request implies with its tier, estimate the cost, and refine the definition of done. For a size L request, split it into child requests instead of a call list.',
      g1 && g1.rejectedAt && g1.note ? `The approver sent the previous scope back with this note; address it: ${g1.note}` : '',
      `Write ${ctx.artifactsDir}/plan.json (the contract) and ${ctx.artifactsDir}/scope.md (one page for the approver: what will be done, what will be read, what will be proposed, what it costs, what is assumed).`,
      '',
      P.resultReminder('Carry size and writes in the JSON. Use status needs_input only when a question blocks the plan.'),
    ].join('\n'),
  };
}

module.exports = { name: 'planner', label: 'Planner', stages: ['scope'], plan };
