'use strict';
// Runs one agent turn through the local Claude Code CLI (`claude -p`), the
// same way dev-agents-orch and the standalone Dime agents do. No SDK, no API
// key: the developer's Claude login is the runtime.
//
// Every tool call the model makes is permission-checked by the CLI against
// the allow/deny lists we pass, plus hooks/guard.js (PreToolUse) which
// enforces write roots and forbidden shell commands regardless of the list.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'hooks', 'guard.js');

function claudeBin() { return process.env.LAB_CLAUDE_BIN || 'claude'; }

function childEnv({ writeRoots, forbidden, guardLog, requestId, extra }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  env.LAB_WRITE_ROOTS = writeRoots.join(path.delimiter);
  env.LAB_FORBIDDEN = JSON.stringify(forbidden || []);
  if (requestId) env.LAB_REQUEST = requestId;
  if (guardLog) env.LAB_GUARD_LOG = guardLog; else delete env.LAB_GUARD_LOG;
  Object.assign(env, extra || {});
  return env;
}

function settingsJson() {
  return JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `node ${JSON.stringify(GUARD)}` }] }] },
  });
}

/**
 * @param {object} o  prompt, systemAppend, cwd, addDirs, allowedTools, disallowedTools, writeRoots, forbidden,
 *                    permissionMode, maxTurns, maxBudgetUsd, model, effort, timeoutMs, logFile, guardLog, resume, onEvent, requestId, env
 */
async function runClaude(o) {
  const tmpSys = path.join(os.tmpdir(), `lab-sys-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(tmpSys, o.systemAppend || '');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt-file', tmpSys, '--settings', settingsJson(), '--permission-mode', o.permissionMode || 'default'];
  if (o.resume) args.push('--resume', o.resume);
  if (o.allowedTools && o.allowedTools.length) args.push('--allowedTools', o.allowedTools.join(','));
  if (o.disallowedTools && o.disallowedTools.length) args.push('--disallowedTools', o.disallowedTools.join(','));
  for (const d of o.addDirs || []) args.push('--add-dir', d);
  if (o.maxTurns) args.push('--max-turns', String(o.maxTurns));
  if (o.maxBudgetUsd) args.push('--max-budget-usd', String(o.maxBudgetUsd));
  const model = o.model || process.env.LAB_CLAUDE_MODEL;
  if (model) args.push('--model', model);
  const effort = o.effort || process.env.LAB_CLAUDE_EFFORT;
  if (effort) args.push('--effort', effort);

  const started = Date.now();
  const log = o.logFile ? fs.createWriteStream(o.logFile, { flags: 'a' }) : null;
  const assistantText = [];
  let result = null; let stderr = ''; let sessionId = null; let timedOut = false;

  await new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, {
      cwd: o.cwd,
      env: childEnv({ writeRoots: o.writeRoots || [], forbidden: o.forbidden, guardLog: o.guardLog, requestId: o.requestId, extra: o.env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { stderr += '\n[lab] timeout, killing claude'; timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs || 45 * 60 * 1000);
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (log) log.write(`${line}\n`);
        if (ev.session_id && !sessionId) sessionId = ev.session_id;
        if (o.onEvent) o.onEvent(ev);
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) for (const b of ev.message.content) if (b.type === 'text' && b.text) assistantText.push(b.text);
        if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => { clearTimeout(timer); resolve(); });
    child.stdin.end(o.prompt);
  });
  if (log) log.end();
  try { fs.unlinkSync(tmpSys); } catch { /* ignore */ }

  const text = (result && typeof result.result === 'string' && result.result) || assistantText.join('\n');
  return {
    text,
    subtype: result ? result.subtype : 'no_result',
    isError: result ? Boolean(result.is_error) : true,
    costUsd: result ? result.total_cost_usd || 0 : 0,
    numTurns: result ? result.num_turns || 0 : 0,
    sessionId: (result && result.session_id) || sessionId,
    timedOut,
    permissionDenials: result && Array.isArray(result.permission_denials) ? result.permission_denials.length : 0,
    durationMs: Date.now() - started,
    stderr: stderr.trim(),
  };
}

/** Extract the ```lab-result``` JSON block an agent must end with. */
function parseAgentResult(text) {
  const m = /```lab-result\s*\n([\s\S]*?)\n```/m.exec(text || '');
  if (!m) return { ok: false, comment: (text || '').trim(), result: { status: 'fail', summary: 'Agent did not end with a lab-result block.' } };
  let parsed;
  try { parsed = JSON.parse(m[1]); } catch (e) { return { ok: false, comment: (text || '').trim(), result: { status: 'fail', summary: `lab-result block is not valid JSON: ${e.message}` } }; }
  const comment = text.slice(0, m.index).trim();
  if (!parsed.status) parsed.status = 'ok';
  return { ok: true, comment, result: parsed };
}

/** Pure: did the run end at a limit without the closing result block, in a session that can be resumed? */
function needsWrapUp(res, parsed) {
  return Boolean(res && parsed && !parsed.ok && res.sessionId && ['no_result', 'error_max_turns'].includes(res.subtype));
}

module.exports = { needsWrapUp, runClaude, parseAgentResult, settingsJson, childEnv, claudeBin };
