'use strict';
// Registry and runner for the compute verbs (tools/compute.js). A verb is a
// file in this folder exporting { name, describe, inputs?, args?, output?, run }.
// `run(ctx)` is pure: ctx.files are the parsed inputs, ctx.args the parsed
// --args object; it returns a JSON-serialisable object. The runner adds the
// receipt trace and, with --out, writes data/<out>.json. Nothing here reaches
// Dime or the network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('../request');
const X = require('../xlsx');
const R = require('../receipts');

const HERE = __dirname;

function list() {
  return fs.readdirSync(HERE)
    .filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_'))
    .map((f) => require(path.join(HERE, f)))
    .filter((m) => m && m.name && typeof m.run === 'function')
    .sort((a, b) => a.name.localeCompare(b.name));
}
function get(name) { return list().find((v) => v.name === String(name || '').trim()) || null; }

function csvRows(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/** Resolve a name to a file under data/ or attachments/ (never outside the request). */
function resolveInput(req, name) {
  const art = T.artifactsDir(req.id);
  const candidates = [path.join(art, 'data', name), path.join(art, 'data', `${name}.json`), path.join(art, 'attachments', name), path.join(art, name)];
  const p = candidates.find((c) => fs.existsSync(c) && c.startsWith(art + path.sep));
  if (!p) throw new Error(`input not found under data/ or attachments/: ${name}`);
  return p;
}

/** Load one input: json → .json, rows → csv/xlsx (first sheet or all sheets), text → everything else. */
function loadInput(req, name) {
  const p = resolveInput(req, name); const ext = path.extname(p).toLowerCase(); const buf = fs.readFileSync(p);
  const f = { name: path.basename(p), path: p, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
  if (ext === '.json') { f.json = JSON.parse(buf.toString('utf8')); }
  else if (ext === '.csv') { f.rows = csvRows(buf.toString('utf8')); }
  else if (ext === '.xlsx') { const w = X.readXlsx(buf); f.sheets = w.sheets; f.rows = (w.sheets[0] || { rows: [] }).rows; }
  else { f.text = buf.toString('utf8'); }
  return f;
}

/** Receipt seqs behind a data file: the HTTP tool names its --out files in receipts.jsonl (outFile). */
function receiptsFor(req, files) {
  let all = []; try { all = R.list(req.id); } catch { all = []; }
  // the HTTP tool records outFile as "data/<name>.json"
  const names = new Set(files.map((f) => f.name));
  return all.filter((r) => r.outFile && names.has(path.basename(String(r.outFile)))).map((r) => r.seq).filter((s) => s != null);
}

/** Stable JSON: sorted keys, so equal results are byte-identical. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

async function run(verb, { request, fileNames = [], args = {}, outName = null }) {
  const files = fileNames.map((n) => loadInput(request, n));
  const need = verb.inputs || [];
  if (need.length && files.length < need.filter((i) => !i.optional).length) throw new Error(`${verb.name} needs ${need.filter((i) => !i.optional).map((i) => i.name).join(', ')} (--in <file>,<file>)`);
  const result = await verb.run({ request, files, args });
  const trace = { inputs: files.map((f) => ({ name: f.name, sha: f.sha })), receipts: receiptsFor(request, files), argsHash: crypto.createHash('sha256').update(stable(args)).digest('hex').slice(0, 12) };
  const payload = { result, trace };
  let outFile = null;
  if (outName) {
    const safe = String(outName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.json$/, '');
    const dir = path.join(T.artifactsDir(request.id), 'data'); fs.mkdirSync(dir, { recursive: true });
    outFile = path.join(dir, `${safe}.json`);
    fs.writeFileSync(outFile, stable(payload));
  }
  // clip what goes back to the model; the file holds everything
  const s = stable(result); const clipped = s.length > 12000;
  return { result: clipped ? { clipped: true, preview: s.slice(0, 12000), note: `result is ${s.length} chars; ${outFile ? 'read the --out file' : 'call again with --out <name> and read the file'}` } : result, trace, outFile: outFile ? path.relative(T.artifactsDir(request.id), outFile) : null };
}

module.exports = { list, get, run, loadInput, csvRows, stable };
