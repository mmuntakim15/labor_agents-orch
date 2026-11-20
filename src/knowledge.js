'use strict';
// Assembles an agent's system prompt from markdown on disk:
//   agents/<name>/AGENT.md              the charter
//   knowledge/shared/*.md               every agent (learned.md filtered by area)
//   knowledge/generated/ENDPOINTS.md    the endpoint map summary built by `lab map` (domains + counts, not every route)
//   agents/<name>/knowledge/*.md        agent-specific
// Files are concatenated in sorted order so the prompt is stable across runs
// (stable prefix = prompt-cache friendly). Route catalogues under knowledge/routes/
// are NOT inlined: agents read the one or two domains they need with the Read tool.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readDirMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

function agentDir(name) {
  const d = path.join(ROOT, 'agents', name);
  if (!fs.existsSync(path.join(d, 'AGENT.md'))) throw new Error(`agent "${name}" has no AGENT.md`);
  return d;
}

function listAgents() {
  const d = path.join(ROOT, 'agents');
  return fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'AGENT.md'))).sort();
}

/** Pure: keep learned.md sections whose `areas:` line matches one of `areas`, and sections with no `areas:` line. */
function filterLearned(text, areas) {
  if (!areas || !areas.length) return text;
  const want = new Set(areas.map((a) => String(a).toLowerCase()));
  const parts = String(text).split(/^(?=## )/m);
  return parts.filter((sec, i) => {
    if (i === 0 && !sec.startsWith('## ')) return true;
    const m = /^areas:\s*(.+)$/mi.exec(sec);
    if (!m) return true;
    return m[1].split(/[,\s]+/).filter(Boolean).some((a) => want.has(a.toLowerCase()));
  }).join('');
}

/** Area tokens from a request: kind, worker, and the route domains the plan names. */
function areasFromRequest(req, plan) {
  const out = new Set();
  if (req && req.kind) out.add(req.kind);
  if (req && req.worker) out.add(req.worker);
  for (const c of (plan && plan.calls) || []) if (c && c.domain) out.add(String(c.domain).toLowerCase());
  return [...out];
}

function buildSystemPrompt(name, { areas } = {}) {
  const parts = [];
  parts.push(`# You are the ${name} agent of the Dime Request Desk\n`);
  parts.push(fs.readFileSync(path.join(agentDir(name), 'AGENT.md'), 'utf8'));
  for (const f of readDirMd(path.join(ROOT, 'knowledge', 'shared'))) {
    const text = f.name === 'learned.md' ? filterLearned(f.text, areas) : f.text;
    parts.push(`\n\n<!-- shared knowledge: ${f.name} -->\n${text}`);
  }
  const gen = path.join(ROOT, 'knowledge', 'generated', 'ENDPOINTS.md');
  if (fs.existsSync(gen)) parts.push(`\n\n<!-- generated knowledge: ENDPOINTS.md -->\n${fs.readFileSync(gen, 'utf8')}`);
  for (const f of readDirMd(path.join(agentDir(name), 'knowledge'))) parts.push(`\n\n<!-- ${name} knowledge: ${f.name} -->\n${f.text}`);
  return parts.join('\n');
}

module.exports = { buildSystemPrompt, listAgents, agentDir, filterLearned, areasFromRequest, ROOT };
