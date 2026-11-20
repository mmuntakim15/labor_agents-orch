'use strict';
// The evidence page: assembled by code from the stores, never written by a model.
// evidence.json for machines, evidence.html for the person who receives the deliverable.

const fs = require('fs');
const path = require('path');
const T = require('./request');
const R = require('./receipts');
const PR = require('./proposals');
const MD = require('./markdown');

function assemble(req) {
  const dir = T.artifactsDir(req.id);
  const json = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { return null; } };
  const receipts = R.list(req.id);
  const checks = json('checks.json'); const verify = json('verify.json'); const applied = json('applied.json');
  const manifest = json('deliverables/manifest.json') || { items: [] };
  const deliverables = fs.existsSync(path.join(dir, 'deliverables')) ? fs.readdirSync(path.join(dir, 'deliverables')).filter((f) => !f.startsWith('.') && f !== 'manifest.json').map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, 'deliverables', f)).size, receipts: ((manifest.items || []).find((m) => m.name === f) || {}).receipts || [] })) : [];
  const done = (req.done || []).map((d) => {
    const c = checks && (checks.items || []).find((i) => i.id === d.id);
    const v = verify && (verify.items || []).find((i) => i.id === d.id);
    return { id: d.id, text: d.text, evaluator: d.evaluator || null, code: c ? { pass: c.pass, advisory: c.advisory, figures: c.figures, note: c.note } : null, verifier: v ? { pass: v.pass, note: v.note || v.evidence || null, figures: v.figures || null } : null };
  });
  const proposals = PR.load(req.id).items.map((p) => ({ id: p.id, kind: p.kind, tier: p.tier, summary: p.summary, status: p.status, reviewedBy: p.reviewedBy || null, reviewedAt: p.reviewedAt || null, note: p.note || null, amount: p.amountApproved ?? p.amount ?? null, route: p.method ? `${p.method} ${p.path}` : null, appliedRef: p.appliedRef || null, error: p.error || null }));
  const runs = (req.runs || []).map((r) => ({ n: r.n, stage: r.stage, agent: r.agent, status: r.status, verdict: r.verdict || null, costUsd: r.costUsd, numTurns: r.numTurns, durationMs: r.durationMs, guardDenials: r.guardDenials || 0, permissionDenials: r.permissionDenials || 0, startedAt: r.startedAt }));
  const gates = Object.entries(req.gates || {}).map(([n, g]) => ({ gate: Number(n), ...g }));
  const ev = { id: req.id, title: req.title, kind: req.kind, size: req.size, writes: req.writes, subject: req.subject, reporter: req.reporter, createdAt: req.createdAt, status: req.status, backend: req.backend || null, body: req.body, attachments: req.attachments || [], done, verdict: verify ? verify.verdict : null, receipts: { ...R.stats(receipts), rows: receipts.map((r) => ({ seq: r.seq, at: r.at, method: r.method, path: r.path, status: r.status, bytes: r.bytes, ms: r.ms, argsHash: r.argsHash, run: r.run, outFile: r.outFile || null, refused: r.refused || null })) }, proposals, applied, runs, gates, deliverables, costUsd: runs.reduce((s, r) => s + (r.costUsd || 0), 0), overrides: req.overrides || [], generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(ev, null, 1));
  fs.writeFileSync(path.join(dir, 'evidence.html'), html(ev));
  return ev;
}

function html(ev) {
  const e = MD.esc; const money = (n) => `$${(n || 0).toFixed(2)}`;
  const mark = (x) => (x == null ? '<span class="muted">not checked</span>' : x.pass ? '<span class="pass">pass</span>' : (x.advisory ? '<span class="warn">advisory</span>' : '<span class="fail">fail</span>'));
  const fig = (f) => (f && Object.keys(f).length ? `<code>${e(JSON.stringify(f).slice(0, 300))}</code>` : '');
  const body = `
<h1>Evidence for ${e(ev.id)} <span class="beta">BETA</span></h1>
<div class="meta">${e(ev.title)} · ${e(ev.kind || '')} · size ${e(ev.size || '?')} · ${ev.writes ? 'with changes to the books' : 'read-only'} · submitted by ${e(ev.reporter)} on ${e(String(ev.createdAt).slice(0, 10))} · status ${e(ev.status)} · model cost ${money(ev.costUsd)} · generated ${e(ev.generatedAt)}</div>
<h2>1. The request as written</h2><pre>${e(ev.body)}</pre>
${ev.attachments.length ? `<p>Attachments: ${ev.attachments.map((a) => `<code>${e(a.name)}</code> (${Math.round((a.bytes || 0) / 1024)} KB)`).join(', ')}</p>` : ''}
<p>Subject: businesses ${e(JSON.stringify((ev.subject || {}).businessNames || (ev.subject || {}).businessIds || []))}; periods ${e(JSON.stringify((ev.subject || {}).periods || []))}</p>
<h2>2. Definition of done</h2>
<table><tr><th>Item</th><th>What must be true</th><th>Checked by code</th><th>Verifier</th><th>Figures</th></tr>
${ev.done.map((d) => `<tr><td>${e(d.id)}</td><td>${e(d.text)}${d.evaluator ? `<br><span class="muted">evaluator ${e(d.evaluator)}</span>` : ''}</td><td>${mark(d.code)}${d.code && d.code.note ? `<br><span class="muted">${e(d.code.note)}</span>` : ''}</td><td>${mark(d.verifier)}${d.verifier && d.verifier.note ? `<br><span class="muted">${e(String(d.verifier.note).slice(0, 300))}</span>` : ''}</td><td>${fig(d.code && d.code.figures)}</td></tr>`).join('')}</table>
<p>Verifier verdict: <strong>${e(ev.verdict || 'none')}</strong></p>
<h2>3. Calls made to Dime (receipts)</h2>
<p>${ev.receipts.calls} calls: ${ev.receipts.ok} ok, ${ev.receipts.failed} failed, ${ev.receipts.refused} refused by the map or the policy.</p>
<table><tr><th>R</th><th>When</th><th>Call</th><th>Status</th><th class="num">Bytes</th><th class="num">ms</th><th>Args</th><th>Run</th><th>Saved as</th></tr>
${ev.receipts.rows.map((r) => `<tr><td>R-${r.seq}</td><td>${e(String(r.at).replace('T', ' ').slice(0, 19))}</td><td><code>${e(r.method)} ${e(r.path)}</code></td><td>${r.status === 'refused' ? `<span class="warn">refused: ${e(r.refused || '')}</span>` : (typeof r.status === 'number' && r.status < 300 ? `<span class="pass">${r.status}</span>` : `<span class="fail">${e(String(r.status))}</span>`)}</td><td class="num">${r.bytes ?? ''}</td><td class="num">${r.ms ?? ''}</td><td><code>${e(r.argsHash || '')}</code></td><td>${e(String(r.run ?? ''))}</td><td>${e(r.outFile || '')}</td></tr>`).join('')}</table>
<h2>4. Changes to the books</h2>
${ev.proposals.length ? `<table><tr><th>Proposal</th><th>Kind</th><th>Tier</th><th>Summary</th><th class="num">Amount</th><th>Decision</th><th>By</th><th>Applied</th></tr>${ev.proposals.map((p) => `<tr><td>${e(p.id)}</td><td>${e(p.kind)}</td><td>${e(p.tier)}</td><td>${e(p.summary)}${p.route ? `<br><code>${e(p.route)}</code>` : ''}</td><td class="num">${p.amount != null ? e(String(p.amount)) : ''}</td><td>${e(p.status)}${p.note ? `<br><span class="muted">${e(p.note)}</span>` : ''}</td><td>${e(p.reviewedBy || '')}<br><span class="muted">${e(p.reviewedAt ? String(p.reviewedAt).slice(0, 16).replace('T', ' ') : '')}</span></td><td>${p.appliedRef ? `<code>${e(String(p.appliedRef.id || ''))}</code> ${e(String(p.appliedRef.at || '').slice(0, 16))}` : (p.error ? `<span class="fail">${e(p.error)}</span>` : '')}</td></tr>`).join('')}</table>` : '<p class="muted">None. This request did not change the books.</p>'}
<h2>5. Gates and people</h2>
<table><tr><th>Gate</th><th>Decision</th><th>By</th><th>When</th><th>Note</th></tr>${ev.gates.map((g) => `<tr><td>${g.gate === 1 ? 'Scope approval' : 'Change approval'}</td><td>${g.approved ? '<span class="pass">approved</span>' : (g.rejectedAt ? '<span class="warn">sent back</span>' : '<span class="muted">not needed / not reached</span>')}</td><td>${e(g.by || '')}</td><td>${e(String(g.at || g.rejectedAt || '').slice(0, 16).replace('T', ' '))}</td><td>${e(g.note || '')}</td></tr>`).join('')}</table>
${ev.overrides.length ? `<h3>Overrides</h3><ul>${ev.overrides.map((o) => `<li><span class="warn">${e(o.item)}</span> overridden by ${e(o.by)} on ${e(String(o.at).slice(0, 10))}: ${e(o.reason)}</li>`).join('')}</ul>` : ''}
<h2>6. Agent runs</h2>
<table><tr><th>#</th><th>Stage</th><th>Agent</th><th>Result</th><th class="num">Turns</th><th class="num">Minutes</th><th class="num">Cost</th><th class="num">Stopped calls</th></tr>${ev.runs.map((r) => `<tr><td>${r.n}</td><td>${e(r.stage)}</td><td>${e(r.agent)}</td><td>${e(r.status)}${r.verdict ? ` · ${e(r.verdict)}` : ''}</td><td class="num">${r.numTurns || ''}</td><td class="num">${r.durationMs ? Math.round(r.durationMs / 60000) : ''}</td><td class="num">${money(r.costUsd)}</td><td class="num">${(r.guardDenials || 0) + (r.permissionDenials || 0)}</td></tr>`).join('')}<tr><td colspan="6"><strong>Total</strong></td><td class="num"><strong>${money(ev.costUsd)}</strong></td><td></td></tr></table>
<h2>7. Deliverables</h2>
${ev.deliverables.length ? `<ul>${ev.deliverables.map((d) => `<li><code>${e(d.name)}</code> (${Math.round(d.bytes / 1024)} KB)${d.receipts.length ? ` · from receipts ${d.receipts.map(e).join(', ')}` : ''}</li>`).join('')}</ul>` : '<p class="muted">No files.</p>'}
<p class="muted">Every figure in a deliverable traces to a receipt above or to arithmetic over receipted figures that the Verifier reproduced. Generated by the Dime Request Desk.</p>`;
  return MD.page(`Evidence ${ev.id}`, '', { bodyHtml: body });
}

module.exports = { assemble, html };
