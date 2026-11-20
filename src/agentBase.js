'use strict';
// Shared plan() scaffolding for model agents: the tool surface every agent
// gets, narrowed per role. The allow list is the first lock; hooks/guard.js is
// the second and does not depend on it.

const path = require('path');
const P = require('./prompting');

const ROOT = path.join(__dirname, '..');
const TOOLS = P.TOOLS;
const tool = (n) => `Bash(node ${path.join(TOOLS, `${n}.js`)}:*)`;

/**
 * @param {object} ctx
 * @param {object} o  readOnly: no export, no propose (Verifier); canWrite: may propose (workers on a writes request)
 */
function base(ctx, { readOnly = false, canWrite = false, canExport = true } = {}) {
  const allowed = ['Read', 'Glob', 'Grep', 'Write', 'Edit', tool('map'), tool('dime'), tool('files'), tool('check')];
  if (!readOnly && canExport) allowed.push(tool('export'));
  const forbidden = [];
  if (readOnly || !canWrite) forbidden.push('dime\\.js\\s+propose\\b');
  if (readOnly) forbidden.push('export\\.js\\b');
  const writeDeny = readOnly ? ['/deliverables/', '/data/', '/work\\.md$', '/plan\\.json$', '/proposals\\.json$'] : ['/proposals\\.json$', '/checks\\.json$', '/verify\\.json$', '/evidence\\.(json|html)$', '/applied\\.json$'];
  return {
    cwd: ctx.artifactsDir,
    addDirs: [path.join(ROOT, 'knowledge')],
    writeRoots: [ctx.artifactsDir],
    allowedTools: allowed,
    disallowedTools: ['WebFetch', 'WebSearch', 'NotebookEdit', 'MultiEdit', 'Task', 'Agent'],
    permissionMode: 'default',
    forbidden,
    env: { LAB_WRITE_DENY: JSON.stringify(writeDeny) },
  };
}

module.exports = { base, tool, TOOLS, ROOT };
