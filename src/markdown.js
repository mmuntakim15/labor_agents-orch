'use strict';
// Small markdown → HTML renderer (escaped first) shared by the export tool, the
// evidence page and the dashboard. Headings, lists, tables, code, bold, links.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function render(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const block = (l) => /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || isList(l) || /^\s*\|/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue; }
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { const n = Math.min(h[1].length, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      const head = rows.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(rows[1]) ? rows.shift() : null; if (head) rows.shift();
      const num = (c) => (/^-?\(?\$?[\d,]+(\.\d+)?\)?%?$/.test(c.trim()) ? ' class="num"' : '');
      out.push(`<div class="tw"><table>${head ? `<tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${cells(r).map((c) => `<td${num(c)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    if (/^\s*>/.test(l)) { const b = []; while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${b.map(inline).join('<br>')}</blockquote>`); continue; }
    if (isList(l)) {
      const tag = /^\s*\d/.test(l) ? 'ol' : 'ul'; const items = [];
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (isList(L[i])) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')); else items[items.length - 1] += ` ${L[i].trim()}`;
        i++;
      }
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const p = []; while (i < L.length && L[i].trim() && !(p.length && block(L[i]))) p.push(L[i++]);
    out.push(`<p>${p.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/** A printable page (used for pdf deliverables and the evidence page). */
function page(title, md, { extraHead = '', bodyHtml = null } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: letter; margin: 16mm; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #15232b; margin: 0; padding: 0; }
  h1 { font-size: 20pt; color: #0b1a21; margin: 0 0 6px; } h2 { font-size: 14pt; color: #0b1a21; border-bottom: 1.5px solid #cbd5db; padding-bottom: 3px; margin: 22px 0 8px; } h3 { font-size: 11.5pt; color: #163b40; margin: 16px 0 5px; }
  table { border-collapse: collapse; width: 100%; font-size: 9.2pt; margin: 8px 0; } th { background: #0b1a21; color: #fff; text-align: left; padding: 5px 8px; } td { border: 1px solid #cbd5db; padding: 4px 8px; vertical-align: top; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr:nth-child(even) td { background: #f5f8f9; } code { font-family: Menlo, Consolas, monospace; font-size: 8.8pt; background: #eef2f4; padding: 1px 4px; border-radius: 3px; } pre { background: #eef2f4; padding: 10px; border-radius: 4px; font-size: 8.8pt; white-space: pre-wrap; }
  .meta { color: #5b6b72; font-size: 9pt; margin-bottom: 14px; } .pass { color: #1c7c54; font-weight: 600; } .fail { color: #b3372f; font-weight: 600; } .warn { color: #a86d12; font-weight: 600; } .muted { color: #6b7a81; }
  .beta { display: inline-block; font-size: 8pt; font-weight: 700; letter-spacing: 1px; padding: 1px 7px; border-radius: 3px; background: #2fb7c2; color: #052026; vertical-align: middle; margin-left: 6px; }
  ${extraHead}</style></head><body>${bodyHtml != null ? bodyHtml : render(md)}</body></html>`;
}

module.exports = { render, inline, esc, page };
