'use strict';
const P = require('../../src/prompting');
const RC = require('../../src/recipes');
const { base } = require('../../src/agentBase');

function plan(ctx) {
  const b = base(ctx, { readOnly: true });
  const recipe = ctx.recipe || null;
  return {
    ...b,
    allowedTools: b.allowedTools.filter((t) => !/export\.js/.test(t)),
    maxTurns: 30,
    maxBudgetUsd: 2,
    timeoutMs: 12 * 60 * 1000,
    prompt: [
      P.requestBlock(ctx),
      '',
      recipe ? RC.intakeBlock(recipe, { setup: ctx.setup, matchInfo: ctx.request.recipeId ? null : ctx.recipeMatch }) : '',
      recipe ? '' : (ctx.recipeMatch && ctx.recipeMatch.id ? `## Recipe\nNo library recipe matched closely enough to adopt (best ${ctx.recipeMatch.id} at ${ctx.recipeMatch.score}). Triage from scratch; name the nearest recipe in triage.md if it is the same request in other words.` : ''),
      '',
      P.artifactsBlock(ctx),
      '',
      P.toolsBlock(ctx, { readOnly: true }),
      '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: Intake',
      'Follow the triage standard. Resolve the subject against Dime (businesses, periods) with the tools; never guess an entity id or a date. Classify kind, size, writes and worker. Draft the definition of done from the catalogue. Ask at most three questions, and only ones the requester alone can answer.',
      recipe ? 'A recipe applies (see the Recipe block): adopt its kind, worker, done items, inputs and setup keys; answer setup questions from the answers given there before asking anything; carry recipeId and recipeVersion in triage.json and the lab-result.' : '',
      ctx.request.answers ? 'The requester has already answered earlier questions (see above). Do not re-ask them; fold the answers in.' : '',
      ctx.request.parentId ? `This request is a child of ${ctx.request.parentId}; its kind and subject were set by the parent's plan. Confirm them, keep the size S or M, and do not split it further.` : '',
      `Write ${ctx.artifactsDir}/triage.md (for the requester) and ${ctx.artifactsDir}/triage.json (for the orchestrator; same fields as the lab-result).`,
      '',
      P.resultReminder(`Carry kind, size, writes, worker, subject {businessIds, businessNames, periods, accounts} and done[] in the JSON${recipe ? ', plus recipeId and recipeVersion' : ''}. Use status needs_input only when a question truly blocks the work; list the questions.`),
    ].join('\n'),
  };
}

module.exports = { name: 'intake', label: 'Intake', stages: ['intake'], plan };
