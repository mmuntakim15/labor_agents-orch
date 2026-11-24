#!/usr/bin/env node
'use strict';
// Run the whole Request Library against one entity and record the numbers.
//
//   node scripts/libraryRun.js create --business <id> --name "<entity name>" [--only R01,R02] [--tag <tag>]
//       one request per recipe (recipeId set, the entity named in the body, client context pinned), queued for `lab worker`
//   node scripts/libraryRun.js report [--tag <tag>] [--md <file>] [--json <file>]
//       the numbers per recipe: status, where it stopped, touches, cost, runs, verifier verdict, deliverables, level
//
// Zero dependencies. Never runs a model itself: `lab worker` does, with the lane's admission rules.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'src', 'request'));
const RC = require(path.join(ROOT, 'src', 'recipes'));
const O = require(path.join(ROOT, 'src', 'orchestrator'));
let DG = null; try { DG = require(path.join(ROOT, 'src', 'digest')); } catch { DG = null; }

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null && !String(rest[i + 1]).startsWith('--') ? rest[i + 1] : d; };

function create() {
  const business = flag('business'); const name = flag('name'); const tag = flag('tag') || `library-${new Date().toISOString().slice(0, 10)}`;
  if (!business || !name) throw new Error('create needs --business <id> --name "<entity name>"');
  const only = (flag('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const recipes = Object.values(RC.current()).filter((r) => !only.length || only.includes(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  const made = [];
  for (const r of recipes) {
    const body = `${r.prompt} Entity: ${name}.`;
    const req = T.createRequest({ title: `${r.id} · ${r.title}`, body, reporter: 'library-run', backend: flag('backend') || null });
    req.recipeId = r.id; req.recipeVersion = r.version; req.kind = r.kind; req.worker = r.worker;
    req.client = { businessId: String(business), businessName: name };
    req.subject = { businessIds: [String(business)], businessNames: [name], periods: [], accounts: [] };
    req.libraryRun = { tag, recipeId: r.id, createdAt: new Date().toISOString() };
    T.saveRequest(req);
    O.enqueue(req.id, 'library-run');
    made.push({ id: req.id, recipe: r.id, kind: r.kind, worker: r.worker, ceiling: r.autonomyCeiling });
  }
  console.log(JSON.stringify({ tag, business, name, created: made.length, requests: made }, null, 1));
}

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

function rowOf(r) {
  const runs = r.runs || [];
  const cost = money(runs.reduce((s, x) => s + (x.costUsd || 0), 0));
  const first = runs[0] && Date.parse(runs[0].startedAt); const last = runs.length && Date.parse(runs[runs.length - 1].endedAt || runs[runs.length - 1].startedAt);
  let verdict = null; try { verdict = JSON.parse(fs.readFileSync(path.join(T.artifactsDir(r.id), 'verify.json'), 'utf8')).verdict; } catch { verdict = null; }
  let checks = null; try { const c = JSON.parse(fs.readFileSync(path.join(T.artifactsDir(r.id), 'checks.json'), 'utf8')); checks = `${(c.items || []).filter((i) => i.pass).length}/${(c.items || []).length}`; } catch { checks = null; }
  let proposals = []; try { proposals = JSON.parse(fs.readFileSync(path.join(T.artifactsDir(r.id), 'proposals.json'), 'utf8')).items || []; } catch { proposals = []; }
  const deliverables = (() => { try { return fs.readdirSync(path.join(T.artifactsDir(r.id), 'deliverables')).filter((f) => !/^manifest\.json$/.test(f)); } catch { return []; } })();
  const stoppedAt = r.status === 'done' ? 'delivered' : r.status === 'awaiting_gate_1' ? 'Gate 1 (scope)' : r.status === 'awaiting_gate_2' ? 'Gate 2 (changes)' : r.status === 'awaiting_input' ? `input: ${(r.inputsNeeded || []).filter((i) => !i.receivedAt).map((i) => i.name).join(', ')}` : r.status === 'blocked' ? `blocked: ${(r.blocked && r.blocked.reason) || ''}`.slice(0, 160) : (r.pendingQuestions || []).length ? `question: ${r.pendingQuestions[0]}`.slice(0, 160) : r.status;
  const level = DG && DG.levelOf ? (() => { try { return DG.levelOf(r); } catch { return null; } })() : null;
  return {
    request: r.id, recipe: r.recipeId || (r.libraryRun && r.libraryRun.recipeId) || null, kind: r.kind, worker: r.worker, status: r.status, stoppedAt,
    touches: r.touches != null ? Number(r.touches) : 0, costUsd: cost, runs: runs.length, minutes: first && last ? Math.round((last - first) / 60000) : null,
    verdict, checks, proposals: proposals.length, tiers: proposals.map((p) => p.tier).join(''), deliverables: deliverables.length, level, gap: r.blocked && r.blocked.gap ? r.blocked.gap : null,
    recipeMatch: r.recipeMatch ? `${r.recipeMatch.id} ${r.recipeMatch.score}` : null,
  };
}

function report() {
  const tag = flag('tag') || null;
  const all = T.listRequests().filter((r) => r.libraryRun && (!tag || r.libraryRun.tag === tag)).sort((a, b) => String(a.libraryRun.recipeId).localeCompare(String(b.libraryRun.recipeId)));
  const rows = all.map(rowOf);
  const n = rows.length;
  const done = rows.filter((r) => r.status === 'done');
  const summary = {
    tag: tag || (all[0] && all[0].libraryRun.tag) || null, requests: n, delivered: done.length,
    zeroTouchDelivered: done.filter((r) => r.touches === 0).length, l4: rows.filter((r) => r.level === 'L4').length,
    atGate1: rows.filter((r) => r.status === 'awaiting_gate_1').length, atGate2: rows.filter((r) => r.status === 'awaiting_gate_2').length,
    awaitingInput: rows.filter((r) => r.status === 'awaiting_input').length, blocked: rows.filter((r) => r.status === 'blocked').length,
    withQuestions: rows.filter((r) => /^question/.test(r.stoppedAt)).length, running: rows.filter((r) => ['intake', 'scope', 'execute', 'verify', 'apply', 'deliver'].includes(r.status)).length,
    costUsd: money(rows.reduce((s, r) => s + r.costUsd, 0)), avgCostDelivered: done.length ? money(done.reduce((s, r) => s + r.costUsd, 0) / done.length) : null,
    verifierPass: rows.filter((r) => r.verdict === 'pass').length, verifierFail: rows.filter((r) => r.verdict === 'fail').length,
  };
  const out = { generatedAt: new Date().toISOString(), summary, rows };
  const jsonFile = flag('json') || path.join(ROOT, 'evals', 'reports', `${summary.tag || 'library'}.json`);
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true }); fs.writeFileSync(jsonFile, JSON.stringify(out, null, 1));
  const md = [
    `# Library run ${summary.tag || ''}`, '', `Generated ${out.generatedAt}`, '',
    `| Requests | Delivered | Zero-touch | L4 | Gate 1 | Gate 2 | Input | Questions | Blocked | Running | Cost | Avg cost (delivered) | Verifier pass/fail |`, `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
    `| ${n} | ${summary.delivered} | ${summary.zeroTouchDelivered} | ${summary.l4} | ${summary.atGate1} | ${summary.atGate2} | ${summary.awaitingInput} | ${summary.withQuestions} | ${summary.blocked} | ${summary.running} | $${summary.costUsd} | ${summary.avgCostDelivered == null ? '-' : `$${summary.avgCostDelivered}`} | ${summary.verifierPass}/${summary.verifierFail} |`, '',
    '| Recipe | Request | Kind · worker | Outcome | Touches | Cost | Runs | Min | Verifier | Checks | Proposals (tiers) | Files | Level |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.recipe} | ${r.request} | ${r.kind} · ${r.worker} | ${r.stoppedAt} | ${r.touches} | $${r.costUsd} | ${r.runs} | ${r.minutes == null ? '-' : r.minutes} | ${r.verdict || '-'} | ${r.checks || '-'} | ${r.proposals}${r.tiers ? ` (${r.tiers})` : ''} | ${r.deliverables} | ${r.level || '-'} |`),
  ].join('\n');
  const mdFile = flag('md') || jsonFile.replace(/\.json$/, '.md'); fs.writeFileSync(mdFile, `${md}\n`);
  console.log(JSON.stringify(summary, null, 1)); console.log(`report: ${mdFile}`);
}

try { if (cmd === 'create') create(); else if (cmd === 'report') report(); else { console.log('usage: libraryRun.js create --business <id> --name "<name>" [--only R01,R02] [--tag t] | report [--tag t]'); process.exit(1); } }
catch (e) { console.error(e.message); process.exit(1); }
