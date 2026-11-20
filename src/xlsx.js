'use strict';
// Minimal xlsx writer and reader on node built-ins (zlib + a hand-rolled zip).
// Writer: sheets of rows with number formats, frozen header, column widths.
// Reader: shared strings, inline strings, numbers, booleans; one array of rows per sheet.

const zlib = require('zlib');

// ---------------------------------------------------------------- zip
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function dosTime(d = new Date()) { return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff }; }

function zip(files) {
  const parts = []; const central = []; let offset = 0; const { time, date } = dosTime();
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data); const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data; const method = useDeflate ? 8 : 0; const crc = crc32(data); const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10); cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, end]);
}

function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(lho + 26); const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen; const data = buf.slice(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : (() => { throw new Error(`unsupported zip method ${method}`); })();
    p += 46 + nlen + elen + clen;
  }
  return out;
}

// ---------------------------------------------------------------- xml helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

// ---------------------------------------------------------------- writer
// styles: 0 general, 1 bold header, 2 #,##0.00, 3 0.0%, 4 date, 5 integer #,##0, 6 text
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\(#,##0.00\\)"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF1"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
const FORMAT_STYLE = { general: 0, header: 1, money: 2, percent: 3, date: 4, integer: 5, text: 6, number: 2 };

function excelDate(d) { return Math.round(((d.getTime() - Date.UTC(1899, 11, 30)) / 864e5) * 1e6) / 1e6; }

function cellXml(ref, v, style) {
  const s = style ? ` s="${style}"` : '';
  if (v == null || v === '') return '';
  if (v instanceof Date) return `<c r="${ref}"${s || ' s="4"'}><v>${excelDate(v)}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s}><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
}

/**
 * sheets: [{ name, rows: [[...]] | [{...}], columns?: [{key, header, format, width}], formats?: ['money', …] per column, freeze?: true }]
 * Rows as objects need columns (keys) or the first object's keys are used.
 */
function writeXlsx(sheets) {
  const files = [];
  const names = [];
  sheets.forEach((sh, i) => {
    const name = String(sh.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
    names.push(name);
    let rows = sh.rows || []; let columns = sh.columns || null;
    if (rows.length && !Array.isArray(rows[0])) { columns = columns || Object.keys(rows[0]).map((k) => ({ key: k, header: k })); rows = rows.map((r) => columns.map((c) => r[c.key])); }
    const formats = sh.formats || (columns ? columns.map((c) => c.format || null) : []);
    const header = columns ? columns.map((c) => c.header || c.key) : (sh.header || null);
    const all = header ? [header, ...rows] : rows;
    const xmlRows = all.map((r, ri) => {
      const cells = r.map((v, ci) => { const style = header && ri === 0 ? 1 : (FORMAT_STYLE[formats[ci]] ?? (typeof v === 'number' && !Number.isInteger(v) ? 2 : 0)); return cellXml(`${colName(ci)}${ri + 1}`, v, style); }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const widths = (columns || (all[0] || []).map(() => null)).map((c, ci) => { const w = c && c.width; if (w) return w; const lens = all.slice(0, 200).map((r) => String(r[ci] ?? '').length); return Math.min(60, Math.max(10, Math.max(...lens, 0) + 2)); });
    const cols = widths.length ? `<cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const freeze = header && sh.freeze !== false ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${xmlRows}</sheetData></worksheet>`]);
  });
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  return zip([['[Content_Types].xml', types], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', STYLES], ...files]);
}

// ---------------------------------------------------------------- reader
function readXlsx(buf) {
  const z = unzip(buf);
  const text = (n) => (z[n] ? z[n].toString('utf8') : '');
  const shared = [];
  const ss = text('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  const rels = {}; for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = /Id="([^"]+)"/.exec(m[1]); const tg = /Target="([^"]+)"/.exec(m[1]); if (id && tg) rels[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/'); }
  const sheets = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unesc((/name="([^"]*)"/.exec(m[1]) || [])[1] || ''); const rid = (/r:id="([^"]+)"/.exec(m[1]) || [])[1];
    const file = rels[rid] || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = text(file); const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1]; const inner = cm[2] || '';
        const ref = (/r="([A-Z]+)\d+"/.exec(attrs) || [])[1]; const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
        const ci = ref ? colIndex(ref) : row.length;
        let v = null;
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (t === 's') v = shared[Number(vm ? vm[1] : -1)] ?? null;
        else if (t === 'inlineStr') v = unesc((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<t[^>]*>|<\/t>/g, '')).join(''));
        else if (t === 'b') v = vm ? vm[1] === '1' : null;
        else if (t === 'str' || t === 'e') v = vm ? unesc(vm[1]) : null;
        else v = vm ? Number(vm[1]) : null;
        while (row.length < ci) row.push(null);
        row[ci] = v;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return { sheets };
}

module.exports = { writeXlsx, readXlsx, zip, unzip, crc32, colName, colIndex, FORMAT_STYLE };
