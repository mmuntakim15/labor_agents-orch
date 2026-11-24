'use strict';
const P = require('../../src/prompting');
const RC = require('../../src/recipes');
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
      ctx.recipe ? RC.plannerBlock(ctx.recipe, { setup: ctx.setup }) : '',
      P.artifactsBlock(ctx),
      P.artifact(ctx, 'triage.md', 8000),
      P.toolsBlock(ctx, { readOnly: true }),
      '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: Scope',
      'Follow the plan standard. Find every call the worker will need in the endpoint map (search, then read the domain catalogue), decide which attachments must be parsed and how, list every write the request implies with its tier, estimate the cost, and refine the definition of done. For a size L request, split it into child requests instead of a call list.',
      ctx.recipe ? 'A recipe applies (see Recipe steps and inputs): plan its steps and compute verbs, resolve each input in the order given, keep its done items (fill, never drop), and record in plan.json which inputs are missing as `inputsNeeded: [{ name, period, why, acceptedTypes, standing }]`.' : [
        '## General lane',
        'No Library recipe covers this request. Follow the primitives knowledge: express the work as ordered steps of pull, compute, compare, propose and prove, each naming its input and its output file. For every calculation run `compute.js list` and plan the verb that covers it; plan a sandbox program (`sandbox.js run --program <file>.js`) only when no verb does, and say so in the step, because the Verifier reruns every program by sha and fails the work if the output differs. Name every non-Dime input as `inputs[]` and anything the requester must still send as `inputsNeeded[]`.',
        'When a primitive cannot be satisfied, do not plan around it: record `gaps: [{ primitive, gap: read|compute|change|prove|input, detail, blocking }]` in plan.json, still write scope.md, and end with status blocked plus `gap` and `detail` in the lab-result when a gap is blocking.',
      ].join('\n'),
      g1 && g1.rejectedAt && g1.note ? `The approver sent the previous scope back with this note; address it: ${g1.note}` : '',
      `Write ${ctx.artifactsDir}/plan.json (the contract) and ${ctx.artifactsDir}/scope.md (one page for the approver: what will be done, what will be read, what will be proposed, what it costs, what is assumed).`,
      '',
      P.resultReminder('Carry size and writes in the JSON. Use status needs_input only when a question blocks the plan.'),
    ].join('\n'),
  };
}

module.exports = { name: 'planner', label: 'Planner', stages: ['scope'], plan };
