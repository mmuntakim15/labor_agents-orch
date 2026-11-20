'use strict';
const P = require('../../src/prompting');
const { base } = require('../../src/agentBase');

function plan(ctx) {
  const r = ctx.request;
  const b = base(ctx, { readOnly: false, canWrite: false });
  return {
    ...b,
    forbidden: ['dime\\.js\\s+propose\\b'],
    maxTurns: 30,
    maxBudgetUsd: 2.5,
    timeoutMs: 12 * 60 * 1000,
    prompt: [
      P.requestBlock(ctx),
      '',
      P.doneBlock(ctx),
      '',
      P.artifactsBlock(ctx),
      P.artifact(ctx, 'work.md', 16000),
      P.artifact(ctx, 'verify.md', 8000),
      P.artifact(ctx, 'proposals.json', 6000),
      P.artifact(ctx, 'applied.json', 4000),
      r.children && r.children.length ? `\n## Child requests\n${r.children.map((c) => `- ${c.requestId}: ${c.title}`).join('\n')}\nCombine the children's deliverables (their artifacts folders are siblings of this one under the requests directory; read them with the Read tool) into one deliverable set here, and summarise the whole.` : '',
      P.toolsBlock(ctx, { readOnly: false }),
      '',
      P.commentsBlock(ctx),
      '',
      '## Your job now: deliver (Deliverer)',
      'Follow the summary standard and its "Formats" section. The requester opens these files in Excel or a PDF reader, never in a text editor: choose the format each deliverable should have from what it contains and what the request is for (a format the requester asked for by name always wins), render any markdown or html deliverable to pdf with the export tool, and leave workbooks and files Dime exported as they are. Do not change any figure.',
      'Then mark the one file the requester should open first with the export tool\'s `first` command and a one-line reason: the workbook when they asked for figures, the pdf when they asked a question or for an explanation.',
      `Write ${ctx.artifactsDir}/summary.md for the requester: what they are getting, the headline figures, what was proposed and what was applied, what could not be determined, and what they should look at first.`,
      '',
      P.resultReminder('summary must be one plain sentence a requester would read in a notification.'),
    ].join('\n'),
  };
}

module.exports = { name: 'deliverer', label: 'Deliverer', stages: ['deliver'], plan };
