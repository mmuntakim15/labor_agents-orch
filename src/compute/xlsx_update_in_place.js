'use strict';
// xlsx_update_in_place — apply cell edits / appended rows to a copy of an existing workbook, keeping every other part byte-for-byte.
// The ONE compute verb that writes under deliverables/ (a new file; the original attachment is never modified).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('../xlsx');
const T = require('../request');
const M = require('./_money');
const D = require('./_dates');
const Tb = require('./_table');

const FIXED_ZIP_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function splitRef(ref) { const m = /^([A-Z]{1,3})(\d+)$/.exec(String(ref).toUpperCase()); if (!m) throw new Error(`xlsx_update_in_place: bad cell reference '${ref}'`); return { col: X.colIndex(m[1]), row: Number(m[2]) }; }

/** New cell XML for a value, keeping the style index `s` of the cell it replaces (number formats, fonts, fills). */
function cellXml(ref, v, s) {
  const st = s != null ? ` s="${s}"` : '';
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v.date) { const iso = D.parseDate(v.date); if (!iso) throw new Error(`xlsx_update_in_place: bad date ${v.date}`); return `<c r="${ref}"${st}><v>${D.toDays(iso) + 25569}</v></c>`; }
  if (typeof v === 'object' && v.formula) return `<c r="${ref}"${st}><f>${esc(v.formula)}</f></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${st}><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
}

/** Parse <sheetData> into editable rows: [{ r, attrs, cells: [{ col, ref, s, xml, hasFormula }] }] plus the xml before/after it. */
function parseSheet(xml) {
  const m = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml);
  if (!m) throw new Error('xlsx_update_in_place: sheet has no <sheetData>');
  const before = xml.slice(0, m.index); const after = xml.slice(m.index + m[0].length); const body = m[1] || '';
  const rows = [];
  for (const rm of body.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rm[1]; const r = Number((/\br="(\d+)"/.exec(attrs) || [])[1]); const cells = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (/\br="([A-Z]+\d+)"/.exec(cm[1]) || [])[1]; if (!ref) continue;
      cells.push({ col: splitRef(ref).col, ref, s: (/\bs="(\d+)"/.exec(cm[1]) || [])[1] ?? null, xml: cm[0], hasFormula: /<f\b/.test(cm[2] || '') });
    }
    rows.push({ r, attrs: attrs.replace(/\s*\bspans="[^"]*"/, ''), cells });
  }
  return { before, after, rows };
}

function serialise(sheet) {
  const rows = sheet.rows.filter((r) => r.cells.length).sort((a, b) => a.r - b.r);
  const body = rows.map((r) => { r.cells.sort((a, b) => a.col - b.col); return `<row${r.attrs.replace(/\br="\d+"/, `r="${r.r}"`)}>${r.cells.map((c) => c.xml).join('')}</row>`; }).join('');
  let maxCol = -1; let maxRow = 0; let minRow = Infinity; let minCol = Infinity;
  for (const r of rows) { maxRow = Math.max(maxRow, r.r); minRow = Math.min(minRow, r.r); for (const c of r.cells) { maxCol = Math.max(maxCol, c.col); minCol = Math.min(minCol, c.col); } }
  let xml = `${sheet.before}<sheetData>${body}</sheetData>${sheet.after}`;
  if (rows.length && /<dimension\b[^>]*\/>/.test(xml)) xml = xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${X.colName(minCol)}${minRow}:${X.colName(maxCol)}${maxRow}"/>`);
  return xml;
}

function setCell(sheet, ref, value, stats, styleHint = null) {
  const { col, row: rn } = splitRef(ref);
  let row = sheet.rows.find((r) => r.r === rn);
  if (!row) { row = { r: rn, attrs: ` r="${rn}"`, cells: [] }; sheet.rows.push(row); }
  const i = row.cells.findIndex((c) => c.col === col);
  const prev = i >= 0 ? row.cells[i] : null;
  if (prev && prev.hasFormula) stats.formulasReplaced += 1;
  const s = prev ? prev.s : styleHint;
  const xml = cellXml(ref.toUpperCase(), value, s);
  if (!xml) { if (i >= 0) row.cells.splice(i, 1); stats.cellsCleared += 1; return; }
  const cell = { col, ref: ref.toUpperCase(), s, xml, hasFormula: !!(value && value.formula) };
  if (i >= 0) row.cells[i] = cell; else row.cells.push(cell);
  stats.cellsSet += 1;
}

module.exports = {
  name: 'xlsx_update_in_place',
  describe: 'Applies edits to a copy of an existing workbook and writes it under deliverables/ (the only compute verb that writes there; the original attachment is untouched). Supported ops: appendRows (after the last row, copying that row\'s per-column cell styles so number formats carry on), setCells ({ A1: value }; a value may be { date: "YYYY-MM-DD" } or { formula: "SUM(A1:A3)" }; null clears), replaceWhere ({ column: letter|header, equals, set: { col: value } } over the rows under the header row). Every other part of the package (other sheets, styles.xml, sharedStrings, column widths, merges, defined names) is copied byte-for-byte; only the touched sheets\' <sheetData> and <dimension> are rewritten. Overwriting a formula cell drops calcChain.xml so Excel recomputes cleanly. Output bytes are deterministic (fixed zip timestamps). Pure apart from writing the one deliverable.',
  inputs: [{ name: 'workbook', shape: 'the .xlsx to update (read from disk by path; its parsed .sheets are used to evaluate replaceWhere)' }, { name: 'edits', shape: 'json { ops: [...] } (optional when args.ops is given)', optional: true }],
  args: { ops: '[{ sheet, appendRows: [[...]] } | { sheet, setCells: { A1: value } } | { sheet, replaceWhere: { column, equals, set: { col: value } }, headerRow: 1 }]', outName: "'<original> (updated).xlsx'" },
  output: '{ written, sha, sheetsTouched, rowsAppended, cellsSet, cellsCleared, formulasReplaced, preserved: { sheets, stylesKept, sharedStringsKept, partsUnchanged } }',
  run({ request, files, args = {} }) {
    const wb = files[0]; if (!wb || !wb.path || !/\.xlsx$/i.test(wb.path)) throw new Error('xlsx_update_in_place: first input must be an .xlsx file');
    const ops = args.ops || (files[1] && files[1].json && (files[1].json.ops || files[1].json)) || [];
    if (!Array.isArray(ops) || !ops.length) throw new Error('xlsx_update_in_place: no ops (args.ops or an edits json with { ops: [...] })');
    const buf = fs.readFileSync(wb.path); const parts = X.unzip(buf);
    const text = (n) => (parts[n] ? parts[n].toString('utf8') : '');
    const rels = {}; for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = /Id="([^"]+)"/.exec(m[1]); const tg = /Target="([^"]+)"/.exec(m[1]); if (id && tg) rels[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/'); }
    const sheetFiles = {}; let n = 0;
    for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) { n += 1; const name = (/name="([^"]*)"/.exec(m[1]) || [])[1] || ''; const rid = (/r:id="([^"]+)"/.exec(m[1]) || [])[1]; sheetFiles[Tb.norm(name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))] = { file: rels[rid] || `xl/worksheets/sheet${n}.xml`, name }; }
    const parsed = X.readXlsx(buf);
    const stats = { cellsSet: 0, cellsCleared: 0, rowsAppended: 0, formulasReplaced: 0 };
    const touched = new Map();
    const sheetFor = (op) => {
      const key = Tb.norm(op.sheet || (parsed.sheets[0] || {}).name); const sf = sheetFiles[key];
      if (!sf) throw new Error(`xlsx_update_in_place: sheet '${op.sheet}' not found (have: ${Object.values(sheetFiles).map((s) => s.name).join(', ')})`);
      if (!touched.has(sf.file)) touched.set(sf.file, { name: sf.name, sheet: parseSheet(text(sf.file)), values: (parsed.sheets.find((s) => Tb.norm(s.name) === key) || { rows: [] }).rows });
      return touched.get(sf.file);
    };
    for (const op of ops) {
      const t = sheetFor(op); const sh = t.sheet;
      if (op.appendRows) {
        const last = sh.rows.filter((r) => r.cells.length).sort((a, b) => b.r - a.r)[0];
        let r = last ? last.r + 1 : 1;
        for (const vals of op.appendRows) {
          vals.forEach((v, ci) => { const hint = last ? ((last.cells.find((c) => c.col === ci) || {}).s ?? null) : null; if (v != null && v !== '') setCell(sh, `${X.colName(ci)}${r}`, v, stats, hint); });
          stats.rowsAppended += 1; r += 1;
        }
      }
      if (op.setCells) for (const ref of Object.keys(op.setCells).sort()) setCell(sh, ref, op.setCells[ref], stats);
      if (op.replaceWhere) {
        const w = op.replaceWhere; const headerRow = Number(op.headerRow || w.headerRow || 1); const header = t.values[headerRow - 1] || [];
        const colOf = (c) => { if (/^[A-Z]{1,3}$/.test(String(c)) && !header.some((h) => Tb.norm(h) === Tb.norm(c))) return X.colIndex(String(c)); const i = header.findIndex((h) => Tb.norm(h) === Tb.norm(c)); if (i < 0) throw new Error(`xlsx_update_in_place: column '${c}' not found in header row ${headerRow} of '${t.name}'`); return i; };
        const wc = colOf(w.column); const want = w.equals; const wantNum = M.parseMoney(want);
        const same = (v) => (v === want) || (wantNum != null && M.parseMoney(v) != null && M.eq(M.parseMoney(v), wantNum)) || (typeof want === 'string' && Tb.norm(v) === Tb.norm(want) && Tb.norm(want) !== '');
        let hits = 0;
        t.values.forEach((row, ri) => { if (ri + 1 <= headerRow || !row || !same(row[wc])) return; hits += 1; for (const [c, v] of Object.entries(w.set || {})) setCell(sh, `${X.colName(colOf(c))}${ri + 1}`, v, stats); });
        if (!hits) stats.replaceWhereNoMatch = (stats.replaceWhereNoMatch || 0) + 1;
      }
    }
    const outParts = { ...parts };
    for (const [file, t] of touched) outParts[file] = Buffer.from(serialise(t.sheet), 'utf8');
    if (stats.formulasReplaced && outParts['xl/calcChain.xml']) {
      delete outParts['xl/calcChain.xml'];
      outParts['[Content_Types].xml'] = Buffer.from(text('[Content_Types].xml').replace(/<Override\b[^>]*calcChain\.xml"[^>]*\/>/, ''), 'utf8');
      outParts['xl/_rels/workbook.xml.rels'] = Buffer.from(text('xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*calcChain\.xml"[^>]*\/>/, ''), 'utf8');
    }
    const out = X.zip(Object.keys(parts).filter((k) => outParts[k]).map((k) => [k, outParts[k]]), { date: FIXED_ZIP_DATE });
    const base = path.basename(wb.name || wb.path).replace(/\.xlsx$/i, '');
    const outName = String(args.outName || `${base} (updated).xlsx`).replace(/[\\/:*?"<>|]+/g, '-').replace(/\.xlsx$/i, '') + '.xlsx';
    const dir = path.join(T.artifactsDir(request.id), 'deliverables'); fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, outName); fs.writeFileSync(outPath, out);
    const unchanged = Object.keys(parts).filter((k) => outParts[k] && outParts[k].equals(parts[k])).length;
    return {
      written: `deliverables/${outName}`, sha: crypto.createHash('sha256').update(out).digest('hex').slice(0, 16), bytes: out.length,
      sheetsTouched: [...touched.values()].map((t) => t.name).sort(), rowsAppended: stats.rowsAppended, cellsSet: stats.cellsSet, cellsCleared: stats.cellsCleared, formulasReplaced: stats.formulasReplaced, replaceWhereNoMatch: stats.replaceWhereNoMatch || 0,
      preserved: { sheets: Object.keys(sheetFiles).length, stylesKept: !!parts['xl/styles.xml'] && outParts['xl/styles.xml'].equals(parts['xl/styles.xml']), sharedStringsKept: !parts['xl/sharedStrings.xml'] || outParts['xl/sharedStrings.xml'].equals(parts['xl/sharedStrings.xml']), partsUnchanged: unchanged, partsTotal: Object.keys(parts).length },
    };
  },
};
