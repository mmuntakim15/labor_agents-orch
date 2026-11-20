#!/usr/bin/env node
'use strict';
// Agent-facing deliverable writer. Writes only under <request>/artifacts/deliverables/.
//   node tools/export.js xlsx --request REQ-1 --name report.xlsx --sheets-file sheets.json [--receipts R-1,R-2]
//        sheets.json: [{ "name": "P&L", "columns": [{"key":"account","header":"Account"},{"key":"aug","header":"Aug 2026","format":"money"}], "rows": [{...}] }]
//        or [{ "name": "…", "header": ["A","B"], "rows": [[…],[…]], "formats": ["text","money"] }]
//   node tools/export.js csv  --request REQ-1 --name rows.csv --rows-file rows.json
//   node tools/export.js md   --request REQ-1 --name memo.md --from draft.md
//   node tools/export.js html --request REQ-1 --name page.html --from page.html|draft.md
//   node tools/export.js pdf  --request REQ-1 --name memo.pdf --from draft.md|page.html
//   node tools/export.js first --request REQ-1 --name report.xlsx --why "the figures they asked for"   mark the deliverable the requester should open first
//   node tools/export.js copy --request REQ-1 --name aging.xlsx --from <path under artifacts/data>   (a file Dime exported)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const X = require(path.join(ROOT, 'src', 'xlsx'));
const T = require(path.join(ROOT, 'src', 'request'));
const MD = require(path.join(ROOT, 'src', 'markdown'));
const PDF = require(path.join(ROOT, 'src', 'pdf'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null ? rest[i + 1] : d; };
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.ok === false ? 1 : 0); };

const rid = flag('request') || process.env.LAB_REQUEST;
if (!rid) out({ ok: false, error: '--request <ID> is required' });
let req; try { req = T.loadRequest(rid); } catch (e) { out({ ok: false, error: e.message }); }
const dir = path.join(T.artifactsDir(rid), 'deliverables'); fs.mkdirSync(dir, { recursive: true });
const name = path.basename(String(flag('name') || '')).replace(/[^A-Za-z0-9._ -]+/g, '-');
if (!name) out({ ok: false, error: '--name <file> is required' });
const want = { xlsx: '.xlsx', csv: '.csv', md: '.md', html: '.html', pdf: '.pdf' }[cmd];
if (want && path.extname(name).toLowerCase() !== want) out({ ok: false, error: `--name must end in ${want} for ${cmd}` });
const target = path.join(dir, name);
const inside = (p) => { const a = path.resolve(p); const root = path.resolve(T.artifactsDir(rid)); return a === root || a.startsWith(root + path.sep) ? a : null; };
const receipts = String(flag('receipts') || '').split(',').map((s) => s.trim()).filter(Boolean);

function manifest(entry) {
  const mf = path.join(dir, 'manifest.json');
  let m = { items: [] }; try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { /* new */ }
  m.items = m.items.filter((x) => x.name !== entry.name).concat([{ ...entry, at: new Date().toISOString(), run: process.env.LAB_RUN || null }]);
  fs.writeFileSync(mf, JSON.stringify(m, null, 1));
}
function done(extra = {}) { const bytes = fs.statSync(target).size; manifest({ name, bytes, kind: cmd, receipts, ...extra }); out({ ok: true, file: target, bytes, next: 'Mention this deliverable by name in work.md with the receipts its figures come from.' }); }
function readFrom() { const f = flag('from'); if (!f) out({ ok: false, error: '--from <file> is required' }); const a = inside(f) || path.resolve(f); if (!fs.existsSync(a)) out({ ok: false, error: `no such file ${a}` }); if (!inside(a)) out({ ok: false, error: 'the source must be under this request\'s artifacts folder' }); return a; }

try {
  if (cmd === 'xlsx') {
    const sf = flag('sheets-file'); if (!sf) out({ ok: false, error: '--sheets-file <sheets.json> is required' });
    const sheets = JSON.parse(fs.readFileSync(inside(sf) || sf, 'utf8'));
    if (!Array.isArray(sheets) || !sheets.length) out({ ok: false, error: 'sheets.json must be a non-empty array of sheets' });
    for (const s of sheets) if (!Array.isArray(s.rows)) out({ ok: false, error: `sheet ${s.name || '?'} has no rows array` });
    fs.writeFileSync(target, X.writeXlsx(sheets));
    const back = X.readXlsx(fs.readFileSync(target));
    done({ sheets: back.sheets.map((s) => ({ name: s.name, rows: s.rows.length })) });
  }
  if (cmd === 'csv') {
    const rf = flag('rows-file'); if (!rf) out({ ok: false, error: '--rows-file <rows.json> is required' });
    const rows = JSON.parse(fs.readFileSync(inside(rf) || rf, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) out({ ok: false, error: 'rows.json must be a non-empty array' });
    const keys = Array.isArray(rows[0]) ? null : [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v) => { const s = v == null ? '' : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = keys ? [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))] : rows.map((r) => r.map(cell).join(','));
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    done({ rows: rows.length });
  }
  if (cmd === 'md') { fs.copyFileSync(readFrom(), target); done(); }
  if (cmd === 'html' || cmd === 'pdf') {
    const src = readFrom();
    const html = /\.md$/i.test(src) ? MD.page(path.basename(name, path.extname(name)), fs.readFileSync(src, 'utf8')) : fs.readFileSync(src, 'utf8');
    if (cmd === 'html') { fs.writeFileSync(target, html); done(); }
    if (!PDF.available()) out({ ok: false, error: 'no Chrome on this machine for pdf; deliver the md/html instead' });
    PDF.toPdfSync(html, target);
    done();
  }
  if (cmd === 'copy') { const src = readFrom(); fs.copyFileSync(src, target); done({ from: path.relative(T.artifactsDir(rid), src) }); }
  if (cmd === 'first') {
    if (!fs.existsSync(target)) out({ ok: false, error: `no deliverable named ${name}; write it first` });
    const mf = path.join(dir, 'manifest.json'); let m = { items: [] }; try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { /* new */ }
    m.primary = { name, why: String(flag('why') || '').slice(0, 200), at: new Date().toISOString(), run: process.env.LAB_RUN || null };
    fs.writeFileSync(mf, JSON.stringify(m, null, 1));
    out({ ok: true, primary: name });
  }
  out({ ok: false, error: 'usage: xlsx | csv | md | html | pdf | copy | first (see the header of this file)' });
} catch (e) { out({ ok: false, error: e.message }); }
