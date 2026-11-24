'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox } = require('../helpers');
sandbox('xlsx-update');
const T = require('../../src/request');
const X = require('../../src/xlsx');
const CM = require('../../src/compute');
const V = CM.get('xlsx_update_in_place');

function request() { return T.createRequest({ title: 'update the budget workbook', body: 'x', reporter: 'test' }); }
function attach(req, name, buf) { return T.writeArtifact(req.id, `attachments/${name}`, buf); }
const partsOf = (buf) => X.unzip(buf);
const sheetXml = (buf, n) => partsOf(buf)[`xl/worksheets/sheet${n}.xml`].toString('utf8');

/** A workbook the way other tools write it: shared strings, a styles.xml with a custom number format, a formula + calcChain. */
function sharedStringWorkbook() {
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  const sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Vendor</t></si><si><t>Amount</t></si><si><t>Acme &amp; Co</t></si><si><t>Beta</t></si></sst>';
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B4"/><cols><col min="1" max="1" width="30" customWidth="1"/></cols><sheetData><row r="1" spans="1:2"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2" spans="1:2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>100.5</v></c></row><row r="3" spans="1:2"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>20</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4" s="1"><f>SUM(B2:B3)</f><v>120.5</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="D1:E1"/></mergeCells></worksheet>';
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>keep me</t></is></c></row></sheetData></worksheet>';
  const calc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B4" i="1"/></calcChain>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AP &amp; Spend" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  return X.zip([['[Content_Types].xml', types], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', styles], ['xl/sharedStrings.xml', sst], ['xl/calcChain.xml', calc], ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2]]);
}

test('xlsx_update_in_place: append, setCells, replaceWhere on a writer-made workbook; other sheet, styles and widths preserved; deterministic bytes', async () => {
  const req = request();
  const original = X.writeXlsx([
    { name: 'Budget', columns: [{ key: 'a', header: 'Account' }, { key: 'b', header: 'Amount', format: 'money', width: 18 }, { key: 'c', header: 'Status' }], rows: [{ a: 'Rent', b: 4500.5, c: 'open' }, { a: 'Payroll', b: 41006.18, c: 'open' }] },
    { name: 'Sources', header: ['R', 'Route'], rows: [['R-1', '/api/v1/x?a=1&b=2']] },
  ]);
  attach(req, 'Budget.xlsx', original);
  const ops = [
    { sheet: 'Budget', appendRows: [['Software', 1200.25, 'open'], ['Travel', 300, 'open']] },
    { sheet: 'Budget', setCells: { C2: 'paid', E1: 'Reviewed', D2: { date: '2026-02-28' } } },
    { sheet: 'Budget', replaceWhere: { column: 'Account', equals: 'Payroll', set: { Amount: 41000, Status: 'revised' } } },
  ];
  const run = () => CM.run(V, { request: req, fileNames: ['Budget.xlsx'], args: { ops } });
  const r1 = await run(); const bytes1 = fs.readFileSync(path.join(T.artifactsDir(req.id), r1.result.written));
  const r2 = await run(); const bytes2 = fs.readFileSync(path.join(T.artifactsDir(req.id), r2.result.written));
  assert.ok(bytes1.equals(bytes2), 'same inputs give byte-identical workbooks'); assert.equal(r1.result.sha, r2.result.sha);
  assert.equal(r1.result.written, 'deliverables/Budget (updated).xlsx');
  assert.deepEqual([r1.result.sheetsTouched, r1.result.rowsAppended, r1.result.cellsSet, r1.result.formulasReplaced], [['Budget'], 2, 6 + 3 + 2, 0]);
  assert.deepEqual(r1.result.preserved, { sheets: 2, stylesKept: true, sharedStringsKept: true, partsUnchanged: 6, partsTotal: 7 });
  const back = X.readXlsx(bytes1);
  assert.deepEqual(back.sheets[0].rows[1], ['Rent', 4500.5, 'paid', 46081 /* Excel serial of 2026-02-28 */]);
  assert.deepEqual(back.sheets[0].rows[2], ['Payroll', 41000, 'revised']);
  assert.deepEqual(back.sheets[0].rows[3], ['Software', 1200.25, 'open']); assert.deepEqual(back.sheets[0].rows[4], ['Travel', 300, 'open']);
  assert.equal(back.sheets[0].rows[0][4], 'Reviewed');
  assert.deepEqual(back.sheets[1].rows, X.readXlsx(original).sheets[1].rows, 'untouched sheet reads back identically');
  const xml = sheetXml(bytes1, 1);
  assert.match(xml, /<cols>.*width="18".*<\/cols>/, 'column widths kept');
  assert.match(xml, /<c r="B4" s="2"><v>1200\.25<\/v><\/c>/, 'appended money cell copies the last row\'s money style');
  assert.match(xml, /<c r="B5" s="2"><v>300<\/v><\/c>/, 'an integer appended under a money column stays money-formatted');
  assert.ok(partsOf(bytes1)['xl/styles.xml'].equals(partsOf(original)['xl/styles.xml']));
  assert.ok(fs.existsSync(path.join(T.artifactsDir(req.id), 'attachments', 'Budget.xlsx')) && fs.readFileSync(path.join(T.artifactsDir(req.id), 'attachments', 'Budget.xlsx')).equals(original), 'original attachment untouched');
});

test('xlsx_update_in_place: shared strings, custom numFmt styles, merges and spans survive; replacing a formula drops calcChain', async () => {
  const req = request(); const original = sharedStringWorkbook(); attach(req, 'AP.xlsx', original);
  const r = await CM.run(V, { request: req, fileNames: ['AP.xlsx'], args: { outName: 'AP rolled.xlsx', ops: [
    { sheet: 'AP & Spend', replaceWhere: { column: 'Vendor', equals: 'Acme & Co', set: { B: 150.75 } } },
    { sheet: 'AP & Spend', setCells: { B4: 170.75 } },
    { sheet: 'AP & Spend', appendRows: [['Gamma', 5]] },
  ] } });
  assert.equal(r.result.written, 'deliverables/AP rolled.xlsx'); assert.equal(r.result.formulasReplaced, 1); assert.equal(r.result.cellsSet, 4);
  const bytes = fs.readFileSync(path.join(T.artifactsDir(req.id), r.result.written)); const parts = partsOf(bytes);
  assert.equal(parts['xl/calcChain.xml'], undefined, 'calcChain removed after a formula was overwritten');
  assert.doesNotMatch(parts['[Content_Types].xml'].toString(), /calcChain/); assert.doesNotMatch(parts['xl/_rels/workbook.xml.rels'].toString(), /calcChain/);
  assert.ok(parts['xl/sharedStrings.xml'].equals(partsOf(original)['xl/sharedStrings.xml'])); assert.ok(parts['xl/styles.xml'].equals(partsOf(original)['xl/styles.xml']));
  const back = X.readXlsx(bytes);
  assert.deepEqual(back.sheets[0].rows, [['Vendor', 'Amount'], ['Acme & Co', 150.75], ['Beta', 20], ['Total', 170.75], ['Gamma', 5]]);
  assert.deepEqual(back.sheets[1].rows, [['keep me']]);
  const xml = sheetXml(bytes, 1);
  assert.match(xml, /<c r="B2" s="1"><v>150\.75<\/v><\/c>/, 'replaced cell keeps its custom "$" style index');
  assert.match(xml, /<c r="B5" s="1"><v>5<\/v><\/c>/, 'appended row inherits the column style');
  assert.match(xml, /<mergeCells count="1"><mergeCell ref="D1:E1"\/><\/mergeCells>/); assert.match(xml, /<dimension ref="A1:B5"\/>/); assert.doesNotMatch(xml, /spans=/);
  assert.match(xml, /<c r="A2" t="s"><v>2<\/v><\/c>/, 'untouched shared-string cell kept as is');
});

test('xlsx_update_in_place: edge — unknown sheet and missing ops are errors; null clears a cell; replaceWhere with no match is reported', async () => {
  const req = request(); attach(req, 'One.xlsx', X.writeXlsx([{ name: 'S', header: ['A', 'B'], rows: [['x', 1], ['y', 2]] }]));
  await assert.rejects(CM.run(V, { request: req, fileNames: ['One.xlsx'], args: { ops: [{ sheet: 'Nope', setCells: { A1: 1 } }] } }), /sheet 'Nope' not found/);
  await assert.rejects(CM.run(V, { request: req, fileNames: ['One.xlsx'], args: {} }), /no ops/);
  const r = await CM.run(V, { request: req, fileNames: ['One.xlsx'], args: { ops: [{ sheet: 'S', setCells: { B2: null } }, { sheet: 'S', replaceWhere: { column: 'A', equals: 'zzz', set: { B: 9 } } }] } });
  assert.equal(r.result.cellsCleared, 1); assert.equal(r.result.replaceWhereNoMatch, 1);
  const back = X.readXlsx(fs.readFileSync(path.join(T.artifactsDir(req.id), r.result.written)));
  assert.deepEqual(back.sheets[0].rows, [['A', 'B'], ['x'], ['y', 2]]);
});
