#!/usr/bin/env node
'use strict';
// Agent-facing file reader for attachments and pulled data. Read only.
//   node tools/files.js tables <file> [--sheet <name|index>] [--limit N] [--offset N] [--out <name> --request REQ-1]
//   node tools/files.js text   <file>          docx, md, txt, csv, json as text (pdf and images: use the Read tool)
//   node tools/files.js head   <file> [--lines N]
//   node tools/files.js sheets <file>          sheet names and sizes of an xlsx
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const X = require(path.join(ROOT, 'src', 'xlsx'));
const T = require(path.join(ROOT, 'src', 'request'));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] != null ? rest[i + 1] : d; };
const file = rest.find((a) => !a.startsWith('--') && (rest.indexOf(a) === 0 || !rest[rest.indexOf(a) - 1].startsWith('--')));
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.ok === false ? 1 : 0); };

function csvRows(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => r.map((c) => { const t = c.trim(); return /^-?\$?[\d,]+(\.\d+)?$/.test(t) && t !== '' ? Number(t.replace(/[$,]/g, '')) : (/^\(\$?[\d,]+(\.\d+)?\)$/.test(t) ? -Number(t.replace(/[()$,]/g, '')) : c); }));
}

function docxText(buf) {
  const z = X.unzip(buf);
  const xml = z['word/document.xml'] ? z['word/document.xml'].toString('utf8') : '';
  return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<\/w:tr>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

function load(f) {
  if (!f) out({ ok: false, error: 'a file path is required' });
  const abs = path.resolve(f);
  if (/(^|\/)\.env|config\.env|backends\.local\.json|private\.key/.test(abs)) out({ ok: false, error: 'that file is never read by agents' });
  if (!fs.existsSync(abs)) out({ ok: false, error: `no such file: ${abs}` });
  return { abs, ext: path.extname(abs).toLowerCase(), buf: fs.readFileSync(abs) };
}

if (cmd === 'tables') {
  const { abs, ext, buf } = load(file);
  const limit = Math.min(Number(flag('limit', 300)) || 300, 5000); const offset = Number(flag('offset', 0)) || 0;
  let sheets;
  if (ext === '.xlsx' || ext === '.xlsm') sheets = X.readXlsx(buf).sheets;
  else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') sheets = [{ name: path.basename(abs), rows: csvRows(ext === '.tsv' ? buf.toString('utf8').replace(/\t/g, ',') : buf.toString('utf8')) }];
  else if (ext === '.json') { const j = JSON.parse(buf.toString('utf8')); const arr = Array.isArray(j) ? j : (j.rows || j.data || j.items || j.results || (Array.isArray(j.data && j.data.rows) ? j.data.rows : null)); if (!Array.isArray(arr)) out({ ok: false, error: 'json is not an array (or {rows|data|items|results}); read it with the Read tool', keys: Object.keys(j).slice(0, 30) }); const keys = [...new Set(arr.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : ['value'])))].slice(0, 80); sheets = [{ name: path.basename(abs), rows: [keys, ...arr.map((r) => keys.map((k) => (r && typeof r === 'object' ? (typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]).slice(0, 200) : r[k]) : r)))] }]; }
  else if (ext === '.xls') out({ ok: false, error: 'legacy .xls is not supported; ask the requester for xlsx or csv' });
  else if (ext === '.pdf' || /\.(png|jpe?g|gif|webp)$/.test(ext)) out({ ok: false, error: 'pdf and images are read with the Read tool (it shows pages and images); use files.js for csv, xlsx, docx and json' });
  else out({ ok: false, error: `cannot read tables from ${ext}; use text or the Read tool` });
  const want = flag('sheet'); const sh = want == null ? sheets[0] : (sheets[Number(want)] || sheets.find((s) => s.name === want));
  if (!sh) out({ ok: false, error: `no sheet ${want}`, sheets: sheets.map((s) => s.name) });
  const total = sh.rows.length; const rows = sh.rows.slice(offset, offset + limit);
  let saved = null; const name = flag('out'); const rid = flag('request') || process.env.LAB_REQUEST;
  if (name && rid) { const fileName = `data/${path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.json$/i, '')}.json`; T.writeArtifact(rid, fileName, JSON.stringify({ source: abs, sheet: sh.name, rows: sh.rows }, null, 0)); saved = path.join(T.artifactsDir(rid), fileName); }
  out({ ok: true, file: abs, sheet: sh.name, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), total, offset, returned: rows.length, header: sh.rows[0] || [], rows, saved, next: total > offset + rows.length ? `More rows: --offset ${offset + rows.length}. Use --out <name> to save every row to data/ and work from the file.` : 'All rows shown. Cite the attachment name when you use a figure from it.' });
}
if (cmd === 'sheets') { const { buf, ext } = load(file); if (ext !== '.xlsx') out({ ok: false, error: 'sheets works on xlsx' }); out({ ok: true, sheets: X.readXlsx(buf).sheets.map((s) => ({ name: s.name, rows: s.rows.length, header: s.rows[0] || [] })) }); }
if (cmd === 'text') {
  const { abs, ext, buf } = load(file);
  if (ext === '.docx') out({ ok: true, file: abs, text: docxText(buf).slice(0, 60000) });
  if (['.md', '.txt', '.csv', '.json', '.log', '.html', '.tsv'].includes(ext)) out({ ok: true, file: abs, text: buf.toString('utf8').slice(0, 60000) });
  out({ ok: false, error: `use the Read tool for ${ext} (pdf pages and images are shown to you directly)` });
}
if (cmd === 'head') { const { abs, ext, buf } = load(file); if (['.xlsx', '.docx', '.pdf'].includes(ext)) out({ ok: false, error: 'head is for text files; use tables/text/Read' }); const n = Number(flag('lines', 40)) || 40; out({ ok: true, file: abs, lines: buf.toString('utf8').split('\n').slice(0, n) }); }
out({ ok: false, error: 'usage: tables <file> | sheets <file> | text <file> | head <file>' });
