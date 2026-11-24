#!/usr/bin/env node
'use strict';
// PreToolUse guard for every agent run. Claude Code calls this with the tool
// call as JSON on stdin. Exit 0 = allow, exit 2 = deny (stderr is shown to
// the model as the reason). Independent of the allow list, so a permissive
// allow list can never let an agent reach the database, read secrets, talk
// to the network outside tools/dime.js, or write outside its roots.
//
// Env: LAB_WRITE_ROOTS (path-delimited absolute dirs), LAB_FORBIDDEN (JSON
// array of extra regex strings for Bash commands), LAB_GUARD_LOG (file).

const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');

const ALWAYS_FORBIDDEN = [
  /\bmongosh?\b/, /\bmongodump\b/, /\bmongoexport\b/, /\bmongoimport\b/,
  /\bnode\s+-e\b/, /\bnode\s+--eval\b/, /\bnode\s+-p\b/,
  /\bcurl\b/, /\bwget\b/, /\bnc\b/, /\bssh\b/, /\bscp\b/,
  /\bgit\b/, /\bgh\b/, /\bnpm\b/, /\bnpx\b/,
  /\.env(\.|\b)/, /config\.env/, /private\.key/, /backends\.local\.json/,
  /\brm\s+-rf?\s+[\/~]/, /\bsudo\b/, /\bkubectl\b/, /\bgcloud\b/, /\bdocker\b/,
  /\bopen\b/, /\bosascript\b/,
];

function decide(input, env) {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};

  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    let extra = [];
    try { extra = JSON.parse(env.LAB_FORBIDDEN || '[]').map((s) => new RegExp(s)); } catch { extra = []; }
    for (const re of [...ALWAYS_FORBIDDEN, ...extra]) {
      if (re.test(cmd)) return { allow: false, reason: `Command blocked by the lab guard (${re}). Agents only run the desk's own tools (node ${TOOLS}/<tool>.js …); they never touch the database, the network, git, env files or the shell beyond that.` };
    }
    // a Bash call must start with one of the desk's tools (the allow list says the same; this is the second lock)
    const first = cmd.trim().split(/\s+/);
    const ok = first[0] === 'node' && first[1] && path.resolve(first[1]).startsWith(TOOLS + path.sep);
    if (!ok) return { allow: false, reason: `Only the desk's tools may be run: node ${TOOLS}/<map|dime|files|export|check|compute|sandbox>.js … (got "${cmd.slice(0, 80)}")` };
    return { allow: true };
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const target = ti.file_path || ti.notebook_path || '';
    if (!target) return { allow: true };
    const abs = path.resolve(target);
    const base = path.basename(abs);
    if (/^\.env/.test(base) || base === 'config.env' || base === 'backends.local.json') return { allow: false, reason: 'Env and credential files are never written by agents.' };
    const roots = String(env.LAB_WRITE_ROOTS || '').split(path.delimiter).filter(Boolean).map((r) => path.resolve(r));
    if (!roots.length) return { allow: false, reason: 'No write roots configured for this agent; writes are denied.' };
    const inside = roots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!inside) return { allow: false, reason: `Write outside this agent's roots is denied. Allowed roots: ${roots.join(', ')}` };
    if (/\/(attachments|receipts\.jsonl)(\/|$)/.test(abs) || /\/receipts\.jsonl$/.test(abs)) return { allow: false, reason: 'Attachments and receipts are read-only for agents.' };
    let deny = [];
    try { deny = JSON.parse(env.LAB_WRITE_DENY || '[]').map((s) => new RegExp(s)); } catch { deny = []; }
    for (const re of deny) if (re.test(abs)) return { allow: false, reason: `This agent may not write ${path.basename(abs)} (${re}); that file belongs to another step.` };
    return { allow: true };
  }
  return { allow: true };
}

function recordDenial(input, reason, env) {
  if (!env.LAB_GUARD_LOG) return;
  try {
    const ti = input.tool_input || {};
    const what = String(ti.command || ti.file_path || ti.notebook_path || '').slice(0, 300);
    require('fs').appendFileSync(env.LAB_GUARD_LOG, `${JSON.stringify({ at: new Date().toISOString(), tool: input.tool_name || '', what, reason: String(reason).slice(0, 300) })}\n`);
  } catch { /* the denial stands whether or not it could be logged */ }
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
    const d = decide(input, process.env);
    if (d.allow) process.exit(0);
    recordDenial(input, d.reason, process.env);
    process.stderr.write(d.reason);
    process.exit(2);
  });
}

module.exports = { decide, ALWAYS_FORBIDDEN, recordDenial, TOOLS };
