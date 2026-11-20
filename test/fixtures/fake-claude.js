#!/usr/bin/env node
'use strict';
// Stand-in for the `claude` CLI in tests: reads the prompt on stdin, emits a few
// stream-json events, writes the artifacts the stage expects, ends with a result.
// No model and no cost. It only ever writes inside the request's artifacts folder.
// Behaviour knobs (env): FAKE_VERDICT=fail (Verifier fails once per request unless FAKE_VERDICT_ALWAYS),
// FAKE_INTAKE='{"kind":"data_task",...}' overrides the triage.
const fs = require('fs');
const path = require('path');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const dir = (/Artifacts directory \(absolute, write your outputs here\): (\S+)/.exec(input) || [])[1];
  const ok = dir && /artifacts$/.test(dir);
  const write = (name, text) => { if (!ok) return; const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof text === 'string' || Buffer.isBuffer(text) ? text : JSON.stringify(text, null, 1)); };
  const job = (/## Your job now: ([^\n]+)/.exec(input) || [])[1] || '';
  const reqId = (/# Request (REQ-\d+):/.exec(input) || [])[1] || 'REQ-?';
  const pause = Number(process.env.FAKE_CLAUDE_STEP_MS || 20);
  say({ type: 'system', session_id: `stand-in-${Date.now()}` });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: `Stand-in agent working on: ${job}` }] } });
  for (const [name, inp] of [['Bash', { command: 'node tools/map.js search aging' }], ['Read', { file_path: 'knowledge/routes/reports-analytics.md' }]]) {
    await new Promise((r) => setTimeout(r, pause));
    say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu-${name}`, name, input: inp }] } });
    say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `tu-${name}`, content: `${name} output` }] } });
  }
  let result; let note = `Stand-in report for: ${job}.`;
  const X = require(path.join(__dirname, '..', '..', 'src', 'xlsx'));
  if (/Intake/.test(job)) {
    const isW9 = /W-9|vendors/i.test(input); const isMulti = /every entity|all entities/i.test(input);
    const base = isW9 ? { kind: 'data_task', size: 'M', writes: true, worker: 'preparer' } : isMulti ? { kind: 'report', size: 'L', writes: false, worker: 'analyst' } : { kind: 'report', size: 'S', writes: false, worker: 'analyst' };
    const over = process.env.FAKE_INTAKE ? JSON.parse(process.env.FAKE_INTAKE) : {};
    const ask = /which entity\?/i.test(input) && !/## Answers from the requester/.test(input);
    const triage = { ...base, subject: { businessIds: ['b1'], businessNames: ['Acme Dental'], periods: ['2026-09', '2026-10'], accounts: [] }, done: isW9 ? [{ id: 'D-1', text: 'one vendor proposed per W-9', evaluator: 'proposals_balanced' }, { id: 'D-2', text: 'tie-out lists every row' }] : [{ id: 'D-1', text: 'xlsx exists', evaluator: 'deliverable_exists', args: { ext: '.xlsx' } }, { id: 'D-2', text: 'opens', evaluator: 'export_opens' }, { id: 'D-3', text: 'memo names the drivers' }], questions: ask ? ['Which entity: Acme Dental or Acme Dental Group?'] : [], ...over };
    write('triage.md', `# Triage\n\nkind ${triage.kind}, size ${triage.size}, writes ${triage.writes}. Periods September and October 2026.\n`);
    write('triage.json', triage);
    result = ask ? { status: 'needs_input', summary: 'One question blocks triage.', ...triage } : { status: 'ok', summary: `Triage: ${triage.kind}, size ${triage.size}.`, ...triage };
  } else if (/Scope/.test(job)) {
    const isL = /Size: L/.test(input);
    const plan = isL
      ? { size: 'L', writes: false, worker: 'analyst', calls: [], inputs: [], writes: [], steps: ['split by entity'], estimateUsd: 12, children: [{ title: 'AR over 60 for Acme Dental', body: 'child one', kind: 'report', subject: { businessIds: ['b1'], businessNames: ['Acme Dental'] } }, { title: 'AR over 60 for Beta LLC', body: 'child two', kind: 'report', subject: { businessIds: ['b2'], businessNames: ['Beta LLC'] } }] }
      : { size: 'M', writes: true, worker: 'preparer', done: [{ id: 'D-1', text: 'one vendor proposed per W-9', evaluator: 'proposals_balanced' }, { id: 'D-2', text: 'tie-out lists every row' }], calls: [{ method: 'GET', path: '/api/v1/accountant/reports/ap-aging/b1', purpose: 'AP aging' }], inputs: ['w9s.pdf'], writes: [{ kind: 'vendor', tier: 'A', summary: 'create vendor from W-9', count: 2 }], steps: ['parse', 'propose', 'tie out'], estimateUsd: 9 };
    write('plan.json', plan); write('scope.md', '# Scope\n\nEstimate $9. Assumptions: quarter end.\n');
    result = { status: 'ok', summary: 'Scope written.', size: plan.size, writes: plan.writes.length > 0 };
  } else if (/Analyst|Investigator/.test(job)) {
    write('data/pl-2026-09.json', { metrics: { netIncome: 12418.22 }, rows: [{ account: 'Rent', amount: 4500 }, { account: 'Payroll', amount: 41006.18 }] });
    write('deliverables/report.xlsx', X.writeXlsx([{ name: 'P&L', header: ['Account', 'Sep 2026'], rows: [['Rent', 4500], ['Payroll', 41006.18], ['Net income', 12418.22]] }]));
    write('deliverables/memo.md', '# Memo\n\nNet income 12,418.22. Payroll is the largest driver.\n');
    fs.appendFileSync(path.join(dir, 'receipts.jsonl'), `${JSON.stringify({ seq: 1, at: new Date().toISOString(), method: 'GET', path: '/api/v1/accountant/reports/profit-and-loss-realtime/b1', status: 200, bytes: 120, ms: 30, argsHash: 'abc', run: process.env.LAB_RUN || null, outFile: 'data/pl-2026-09.json' })}\n`);
    write('work.md', `# Work\n\nPulled the P&L (R-1). Net income 12,418.22 from R-1 metrics.netIncome. Deliverables: report.xlsx, memo.md.\n`);
    result = { status: 'ok', summary: 'Report written.', artifacts: ['deliverables/report.xlsx', 'deliverables/memo.md', 'work.md'] };
  } else if (/Preparer|Bookkeeper/.test(job)) {
    const PR = require(path.join(__dirname, '..', '..', 'src', 'proposals'));
    if (!PR.load(reqId).items.length) {
      PR.add(reqId, { kind: 'vendor', tier: 'A', summary: 'Vendor Acme Supply from w9-1.pdf', method: 'POST', path: '/api/v1/accountant/vendor', body: { name: 'Acme Supply', ein: '12-3456789' } });
      PR.add(reqId, { kind: 'vendor', tier: 'B', summary: 'Vendor Beta Co from w9-2.pdf (amount estimated)', method: 'POST', path: '/api/v1/accountant/vendor', body: { name: 'Beta Co', openingBalance: 1200 }, amount: 1200 });
      PR.add(reqId, { kind: 'vendor', tier: 'C', summary: 'Is "Acme Supply LLC" the same vendor as existing "Acme Supply"?', question: 'duplicate?' });
    }
    write('deliverables/vendor-setup.xlsx', X.writeXlsx([{ name: 'Setup', header: ['Row', 'Action'], rows: [['w9-1', 'propose'], ['w9-2', 'propose']] }]));
    write('work.md', '# Work\n\nParsed w9-1.pdf and w9-2.pdf. Proposed P-1, P-2; question P-3.\n');
    result = { status: 'ok', summary: '2 proposals and 1 question staged.', artifacts: ['deliverables/vendor-setup.xlsx', 'work.md'] };
  } else if (/Verifier/.test(job)) {
    const marker = path.join(dir, '.fake-verify-failed');
    const fail = process.env.FAKE_VERDICT === 'fail' && (process.env.FAKE_VERDICT_ALWAYS || !fs.existsSync(marker));
    if (fail) fs.writeFileSync(marker, '1');
    const v = { verdict: fail ? 'fail' : 'pass', items: [{ id: 'D-1', pass: true, evidence: 'R-1 reproduced' }, { id: 'D-3', pass: !fail, evidence: fail ? 'memo names one driver, not five' : 'memo names the drivers' }], reproduced: [{ seq: 1, ok: true }], uncited: [], notes: 'stand-in' };
    write('verify.json', v); write('verify.md', `# Verify\n\n${v.verdict}\n`);
    result = { status: 'ok', summary: `Verdict ${v.verdict}.`, verdict: v.verdict };
  } else if (/Deliverer/.test(job)) {
    const dl = fs.existsSync(path.join(dir, 'deliverables')) ? fs.readdirSync(path.join(dir, 'deliverables')).filter((f) => f !== 'manifest.json') : [];
    write('summary.md', `# ${reqId}\n\nYour report is ready.\n\n## Files\n${dl.map((f) => `- ${f}`).join('\n')}\n\n## Headline figures\n- Net income 12,418.22\n`);
    result = { status: 'ok', summary: 'Delivered.', artifacts: ['summary.md'] };
  } else {
    result = { status: 'blocked', summary: 'stand-in agent stops here' };
  }
  say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.42, num_turns: 4, session_id: 'stand-in', permission_denials: [], result: `${note}\n\n\`\`\`lab-result\n${JSON.stringify(result)}\n\`\`\`` });
});
