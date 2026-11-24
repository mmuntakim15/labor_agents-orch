'use strict';
// Front end for the Request Desk dashboard. No framework, no build: the server sends JSON, this
// file renders it. Sections re-render only when their data changes, so typing is never interrupted.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${(n || 0).toFixed(2)}`;
  const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  // Client view by default: accountant wording, no developer detail. The team adds ?ops=1 once to see runs, raw files and the system page (kept for the browser session).
  const TECH = (() => { try { const q = new URLSearchParams(location.search); if (q.get('ops') === '1') sessionStorage.setItem('lab.ops', '1'); if (q.get('ops') === '0') sessionStorage.removeItem('lab.ops'); return sessionStorage.getItem('lab.ops') === '1'; } catch { return false; } })();
  if (TECH) document.documentElement.classList.add('ops');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const period = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(String(p)); return m && MONTHS[m[2] - 1] ? `${MONTHS[m[2] - 1]} ${m[1]}` : String(p); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const COLS = [
    { title: 'Received', sub: 'Reading your request', statuses: ['intake'] },
    { title: 'Planning', sub: 'What will be pulled and prepared', statuses: ['scope'] },
    { title: 'Needs a document', sub: 'Waiting for a file from you', statuses: ['awaiting_input'], gate: true },
    { title: 'Approve plan', sub: 'Waiting for you', statuses: ['awaiting_gate_1'], gate: true },
    { title: 'Preparing', sub: 'Pulling figures, building the files', statuses: ['execute', 'children'] },
    { title: 'Review', sub: 'Figures re-checked against Dime', statuses: ['verify'] },
    { title: 'Approve changes', sub: 'Waiting for you', statuses: ['awaiting_gate_2'], gate: true },
    { title: 'Posting', sub: 'Approved changes go into Dime', statuses: ['apply'] },
    { title: 'Wrapping up', sub: 'Summary and files', statuses: ['deliver'] },
    { title: 'Done', sub: '', statuses: ['done', 'cancelled'], cap: 8 },
  ];
  const STEP = { intake: 'Received', scope: 'Planning', awaiting_input: 'Needs a document', awaiting_gate_1: 'Approve plan', execute: 'Preparing', verify: 'Review', awaiting_gate_2: 'Approve changes', apply: 'Posting', deliver: 'Wrapping up', children: 'Parts in progress', done: 'Done', cancelled: 'Cancelled', blocked: 'On hold' };
  const SHORT = { awaiting_input: 'Document', awaiting_gate_1: 'Approve plan', awaiting_gate_2: 'Approve changes', children: 'Parts' };
  const KIND = { report: 'Report', export: 'Export', question: 'Question', data_task: 'Document task', change_request: 'Change to the books' };
  const ROLE = { requester: 'Requester', approver: 'Approver', operator: 'Operator' };
  const ATTENTION = { gate: 'needs your approval', questions: 'has questions for you', blocked: 'is blocked', error: 'stopped unexpectedly' };
  const IMG = /\.(png|jpe?g|gif|webp)$/i;

  const S = { board: null, keys: {}, id: null, d: null, tab: 'chat', file: null, shown: 0, busy: false, mode: null, run: null, tr: null, q: '', seen: null, roles: ['approver'], cache: {} };

  function dur(ms) { if (!(ms >= 0)) return ''; const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60); if (h) return `${h}h ${m % 60}m`; if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`; return `${s}s`; }
  const mins = (n) => (n == null ? '–' : n < 1 ? '<1m' : n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`);
  const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`; };
  const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000); }

  async function api(path, body) {
    const held = body === undefined ? S.cache[path] : null;
    const r = await fetch(path, body === undefined ? { cache: 'no-store', headers: held ? { 'if-none-match': held.etag } : {} } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 304 && held) return held.data;
    const j = await r.json().catch(() => ({ error: r.statusText }));
    if (r.status === 401 && path !== '/api/login') showLogin();
    if (!r.ok) throw new Error(j.error || r.statusText);
    const etag = r.headers.get('etag');
    if (body === undefined && etag) S.cache[path] = { etag, data: j };
    return j;
  }
  function paint(el, key, html) { const k = typeof key === 'string' ? key : JSON.stringify(key); if (S.keys[el.id] === k) return false; S.keys[el.id] = k; el.innerHTML = html(); return true; }

  // ---------------------------------------------------------------- markdown
  function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'); }
  function md(src) {
    const L = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let i = 0;
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
    const block = (l) => /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || isList(l) || /^\s*\|/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);
    while (i < L.length) {
      const l = L[i];
      if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue; }
      if (!l.trim()) { i++; continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { const n = Math.min(h[1].length + 2, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(l)) { const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]); const head = rows.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(rows[1]) ? rows.shift() : null; if (head) rows.shift(); out.push(`<div class="tw"><table>${head ? `<tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${cells(r).map((c) => `<td${/^-?\(?\$?[\d,]+(\.\d+)?\)?%?$/.test(c) ? ' class="num"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`); continue; }
      if (/^\s*>/.test(l)) { const b = []; while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${b.map(inline).join('<br>')}</blockquote>`); continue; }
      if (isList(l)) { const tag = /^\s*\d/.test(l) ? 'ol' : 'ul'; const items = []; while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) { if (isList(L[i])) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')); else items[items.length - 1] += ` ${L[i].trim()}`; i++; } out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`); continue; }
      const p = []; while (i < L.length && L[i].trim() && !(p.length && block(L[i]))) p.push(L[i++]);
      out.push(`<p>${p.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }

  // ---------------------------------------------------------------- attachments
  function attachBox(chips, input, button, dropZone, textarea) {
    let files = [];
    const draw = () => { chips.innerHTML = files.map((f, i) => `<div class="chip-file">${f.url ? `<img src="${f.url}" alt="">` : `<div class="ext">${esc(f.name.split('.').pop())}</div>`}<span title="${esc(f.name)}">${esc(f.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(f.name)}">×</button></div>`).join(''); };
    const add = async (list) => { for (const file of list) { if (file.size > 10 * 1048576) { toast(`${file.name} is larger than 10 MB`); continue; } const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file); }); const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`; files.push({ name, data, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }); } draw(); };
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); draw(); } });
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
    textarea.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); add(fs); } });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag'); add([...e.dataTransfer.files]); });
    return { take: () => files.map(({ name, data }) => ({ name, data })), clear: () => { files = []; draw(); }, count: () => files.length };
  }
  const grow = (ta, max) => { const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, max)}px`; }; ta.addEventListener('input', fit); return fit; };

  // ---------------------------------------------------------------- board
  const isDone = (t) => Boolean((S.board.pipeline.stages[t.status] || {}).terminal);
  const toneOf = (t) => (t.active ? 'run' : t.needs === 'blocked' || t.needs === 'error' ? 'bad' : (t.needs === 'gate' || t.needs === 'questions') ? 'you' : t.status === 'cancelled' ? '' : isDone(t) ? 'ok' : '');
  function cardState(t) {
    if (t.active) return { cls: 'run', html: `${TECH ? `${esc(t.agentLabel || 'Desk')} working` : 'In progress'}${t.since ? ` · <span data-since="${esc(t.since)}"></span>` : ''}` };
    if (t.needs === 'gate') return { cls: 'you', html: t.gate === 2 ? `${plural(t.proposals.pending, 'change')} to approve` : 'Approve the scope' };
    if (t.needs === 'questions') return { cls: 'you', html: `${plural(t.questions, 'question')} for you` };
    if (t.needs === 'blocked') return { cls: 'bad', html: t.blocked && t.blocked.kind === 'budget' ? 'On hold: needs your go-ahead to continue' : t.blocked && /^loop/.test(t.blocked.kind) ? 'Blocked: verification keeps failing' : 'Blocked: needs a human' };
    if (t.needs === 'error') return { cls: 'bad', html: 'The run stopped unexpectedly' };
    if (t.needs === 'queued') return { cls: 'idle', html: `Queued${t.wait && t.wait !== 'starting' ? `: ${esc(t.wait)}` : ''}` };
    if (t.status === 'children') { const k = t.children || []; return { cls: 'idle', html: `${k.filter((c) => c.status === 'done').length} of ${plural(k.length, 'child request')} done` }; }
    if (isDone(t)) return { cls: t.status === 'cancelled' ? 'idle' : 'ok', html: t.status === 'cancelled' ? 'Cancelled' : `Delivered${t.deliverables ? ` · ${plural(t.deliverables, 'file')}` : ''}` };
    if (t.needs === 'start') return { cls: 'idle', html: 'Ready to run' };
    return { cls: 'idle', html: esc(t.statusLabel) };
  }
  function card(t) {
    const st = cardState(t);
    return `<a class="card${t.id === S.id ? ' sel' : ''}" href="#/r/${esc(t.id)}">
      <div class="r1"><span class="id">${esc(t.id)}</span>${t.kind ? `<span class="tagchip">${esc(KIND[t.kind] || t.kind)}</span>` : ''}${TECH && t.size ? `<span class="tagchip">${esc(t.size)}</span>` : ''}${t.writes ? '<span class="tagchip w" title="Every change needs your approval before it is posted">changes the books</span>' : ''}${t.parentId ? `<span class="tagchip" title="Child of ${esc(t.parentId)}">in ${esc(t.parentId)}</span>` : ''}${t.attachments ? `<span>${plural(t.attachments, 'file')}</span>` : ''}</div>
      <div class="ttl">${esc(t.title)}</div>
      <div class="st ${st.cls}"><span class="dot ${st.cls}"></span><span>${st.html}</span></div></a>`;
  }
  // inside a client's workspace the board shows that client's requests only
  const mine = (t) => { const ids = (t.subject || {}).ids; return !EMBED.business || !ids || !ids.length || ids.includes(EMBED.business); }; // a request whose business is not known yet is shown, never hidden
  const matches = (t) => mine(t) && (!S.q || `${t.id} ${t.title} ${t.kind || ''} ${t.statusLabel} ${(t.subject.names || []).join(' ')}`.toLowerCase().includes(S.q));
  function renderBoard() {
    const b = S.board; if (!b) return;
    const own = b.requests.filter(mine); const tot = EMBED.business ? { active: own.filter((t) => t.active).length, queued: own.filter((t) => t.needs === 'queued').length, needsYou: own.filter((t) => ATTENTION[t.needs]).length, done: own.filter((t) => isDone(t) && t.status !== 'cancelled').length } : b.totals;
    document.title = `${tot.needsYou ? `(${tot.needsYou}) ` : ''}Request Desk`;
    paint($('#totals'), tot, () => `<span><b>${tot.active}</b> in progress${TECH ? ` <span class="of">of ${b.pipeline.maxRuns} at once</span>` : ''}</span>${tot.queued ? `<span><b>${tot.queued}</b> queued</span>` : ''}<span class="you"><b>${tot.needsYou}</b> need you</span><span><b>${tot.done}</b> done</span>`);
    const colOf = (t) => { const st = t.status === 'blocked' ? t.lastStage : t.status; const i = COLS.findIndex((c) => c.statuses.includes(st)); return i < 0 ? 0 : i; };
    paint($('#board'), [b.requests, S.id, S.q], () => {
      const by = COLS.map(() => []);
      for (const t of b.requests) if (matches(t)) by[colOf(t)].push(t);
      return COLS.map((c, i) => { const all = by[i].sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1)); const rows = c.cap && !S.q ? all.slice(0, c.cap) : all; return `<section class="col${c.gate ? ' gate' : ''}${all.length ? '' : ' none'}"><div class="col-h"><div class="t">${esc(c.title)} <span class="n">${all.length}</span>${c.gate && all.length ? '<span class="tag">Your turn</span>' : ''}</div><div class="sub">${esc(c.sub)}</div></div><div class="cards">${rows.map(card).join('')}${all.length > rows.length ? `<a class="more-link" href="#/done">${all.length - rows.length} more in Completed</a>` : ''}</div></section>`; }).join('');
    });
    renderSide(); tickClocks(); notifyChanges();
    if (!$('#view-done').hidden) renderDone();
  }
  // Embedded by the Dime app: ?business=<id>&name=<entity>&user=<first name> scopes the board to that client and names the requester
  const EMBED = (() => { try { const q = new URLSearchParams(location.search); return { business: q.get('business') || '', name: q.get('name') || '', user: q.get('user') || '', embedded: q.get('embedded') === '1' }; } catch { return { business: '', name: '', user: '', embedded: false }; } })();
  if (EMBED.embedded) { document.documentElement.classList.add('embedded'); try { const q = new URLSearchParams(location.search); q.delete('embedded'); $('#popout').href = `${location.pathname}${q.toString() ? `?${q}` : ''}#/board`; } catch { /* the link stays inert */ } }
  // A deliverable opens in the program the requester would use for it: workbooks and csv download for Excel, documents open as a PDF
  const FMT = { xlsx: 'Excel workbook', xls: 'Excel workbook', csv: 'CSV file', pdf: 'PDF', docx: 'Word document', html: 'Web page' };
  function openBtn(id, f, cls = '') {
    const u = `/api/requests/${enc(id)}/files/${enc(f.path)}`; const tip = esc(f.why || f.label || f.name);
    if (f.asPdf) return `<a class="btn small ${cls}" href="${u}?as=pdf" target="_blank" rel="noopener" title="${tip}">Open PDF</a>`;
    if (f.format === 'pdf') return `<a class="btn small ${cls}" href="${u}" target="_blank" rel="noopener" title="${tip}">Open PDF</a>`;
    return `<a class="btn small ${cls}" href="${u}?download=1" target="_blank" rel="noopener" title="${tip}">Download ${esc(FMT[f.format] || f.name)}</a>`;
  }
  function renderSide() {
    const b = S.board;
    $('#hero').classList.toggle('compact', b.requests.length > 0);
    if (EMBED.name && !$('#c-body').value) $('#c-body').placeholder = `What do you need for ${EMBED.name}? Describe it, or pick a template above. Paste or drop files.`;
    paint($('#tpls'), (b.templates || []).map((t) => t.id), () => (b.templates || []).map((t) => `<button type="button" data-tpl="${esc(t.id)}" title="${esc(t.body.slice(0, 160))}">${esc(t.label)}</button>`).join(''));
    $('#greet').textContent = `What do you need${S.me ? `, ${S.me.split(/\s+/)[0]}` : ''}?`;
    paint($('#side-list'), [b.requests.map((t) => [t.id, t.title, toneOf(t), t.needs, t.updatedAt]), S.id, S.q], () => {
      const all = b.requests.filter(matches).sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
      const item = (t) => `<a href="#/r/${esc(t.id)}" class="${t.id === S.id ? 'on' : ''}" title="${esc(t.title)}"><span class="dot ${toneOf(t)}"></span><span class="t">${esc(t.title)}</span><em>${esc(t.id.replace(/^[A-Z]+-/, '#'))}</em></a>`;
      const you = all.filter((t) => ['you', 'bad'].includes(toneOf(t))); const run = all.filter((t) => t.active); const queued = all.filter((t) => t.needs === 'queued');
      const rest = all.filter((t) => !you.includes(t) && !run.includes(t) && !queued.includes(t)).slice(0, 30);
      const sec = (h, rows) => (rows.length ? `<h3>${h}</h3>${rows.map(item).join('')}` : '');
      return sec('Waiting on you', you) + sec('Running', run) + sec('Queued', queued) + sec(S.q ? 'Matches' : 'Recent', rest) || `<p class="empty">${S.q ? 'No request matches.' : 'Requests you send appear here.'}</p>`;
    });
  }
  function notifyChanges() {
    const now = Object.fromEntries(S.board.requests.map((t) => [t.id, isDone(t) ? 'done' : t.needs]));
    const before = S.seen; S.seen = now;
    if (!before || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const t of S.board.requests) { const s = now[t.id]; if (before[t.id] === s || before[t.id] === undefined) continue; const words = ATTENTION[s] || (s === 'done' && t.status !== 'cancelled' ? 'is delivered' : null); if (!words || (document.visibilityState === 'visible' && S.id === t.id)) continue; const n = new Notification(`${t.id} ${words}`, { body: t.title, tag: `${t.id}-${s}` }); n.onclick = () => { window.focus(); location.hash = `#/r/${t.id}`; n.close(); }; }
  }
  function renderNotifyButton() { const b = $('#notify'); if (!('Notification' in window)) { b.hidden = true; return; } b.hidden = false; b.textContent = Notification.permission === 'granted' ? 'Notifications are on' : Notification.permission === 'denied' ? 'Notifications are blocked in this browser' : 'Notify me when a request needs me'; b.disabled = Notification.permission !== 'default'; }

  // ---------------------------------------------------------------- completed, system
  function bars(rows, wide, fmt = money) { const max = Math.max(0.01, ...rows.map((r) => r.v)); return rows.map((r) => `<div class="bar${wide ? ' wide' : ''}"><span title="${esc(r.k)}">${esc(r.k)}</span><i style="width:${Math.round((r.v / max) * 100)}%"></i><em>${fmt(r.v)}</em></div>`).join('') || '<p class="empty">Nothing yet</p>'; }
  function renderDone() {
    const b = S.board; if (!b) return;
    paint($('#view-done'), [b.requests, b.byAgent], () => {
      const done = b.requests.filter(isDone); const finished = done.filter((t) => t.status !== 'cancelled');
      const row = (t) => `<tr class="rowlink" data-open="${esc(t.id)}"><td><b>${esc(t.id)}</b></td><td>${esc(t.title)}</td><td>${esc(KIND[t.kind] || t.kind || '–')}</td><td>${esc(t.size || '–')}</td><td>${t.writes ? 'yes' : '–'}</td><td>${esc(t.statusLabel)}</td><td class="num">${t.runs}</td><td class="num">${mins(t.wallMin)}</td><td class="num">${t.deliverables || '–'}</td></tr>`;
      const head = '<tr><th>Request</th><th>Title</th><th>Kind</th><th>Size</th><th>Writes</th><th>Status</th><th class="num">Runs</th><th class="num">Elapsed</th><th class="num">Files</th></tr>';
      const open = b.requests.filter((t) => !done.includes(t));
      return `<div class="wrap"><h1>Completed</h1>
        <div class="tiles"><div class="tile"><b>${finished.length}</b>delivered requests</div><div class="tile"><b>${open.length}</b>in progress</div></div>
        <div class="box"><h3>Completed</h3>${done.length ? `<table>${head}${done.map(row).join('')}</table>` : '<p class="empty">Nothing delivered yet. Finished requests land here.</p>'}</div>
        <div class="box"><h3>In progress</h3>${open.length ? `<table>${head}${open.map(row).join('')}</table>` : '<p class="empty">No open requests</p>'}</div></div>`;
    });
  }
  async function renderSystem(refresh) {
    const el = $('#view-system');
    if (!S.keys['view-system']) el.innerHTML = '<div class="wrap"><h1>System</h1><p class="empty">Checking…</p></div>';
    let h; let t;
    try { [h, t] = await Promise.all([api(`/api/health${refresh ? '?refresh=1' : ''}`), api('/api/trends')]); } catch (e) { el.innerHTML = `<div class="wrap"><h1>System</h1><p class="empty">${esc(e.message)}</p></div>`; return; }
    const agent = (a) => (S.board && S.board.agents[a]) || a; const n = (x) => String(x);
    paint(el, [h, t], () => {
      const bad = h.rows.filter((r) => r.ok === false).length; const iv = t.interventions || {};
      return `<div class="wrap"><h1>System</h1>
        <div class="box"><h3>Can the desk run? <span class="aside">${bad ? `${plural(bad, 'problem')} to fix` : 'everything it needs is in place'} · checked ${esc(when(h.at))}</span><button class="btn small" data-refresh>Check again</button></h3>
          <ul class="checks">${h.rows.map((r) => `<li class="${r.ok === false ? 'fail' : r.ok ? 'pass' : 'info'}"><span class="mark">${r.ok === false ? '✕' : r.ok ? '✓' : 'i'}</span>${esc(r.text)}</li>`).join('')}</ul></div>
        <div class="tiles"><div class="tile"><b>${t.zeroTouch.zero} / ${t.zeroTouch.done}</b>delivered with no human touch</div><div class="tile"><b>${t.gates.approved} / ${t.gates.rejected}</b>gates approved / sent back</div><div class="tile"><b>${t.verify.failed} / ${t.verify.runs}</b>verifications failed</div><div class="tile"><b>${iv.blocked || 0}</b>times a request blocked</div><div class="tile"><b>${(iv.requeue || 0) + (iv.budget || 0) + (iv.loop_grant || 0) + (iv.cancel || 0) + (iv.sendback || 0)}</b>manual interventions<span class="sub">${iv.sendback || 0} sent back · ${iv.budget || 0} budget raised · ${iv.loop_grant || 0} loops granted · ${iv.cancel || 0} cancelled</span></div><div class="tile"><b>${t.receipts.refused || 0} / ${t.receipts.calls || 0}</b>calls refused / made</div><div class="tile"><b>${t.proposals.applied || 0} / ${t.proposals.proposed || 0}</b>changes applied / proposed</div><div class="tile"><b>${t.guard.denials || 0}</b>tool calls stopped by the guard</div></div>
        <div class="two">
          <div class="box"><h3>How long requests wait for a person</h3>${Object.keys(t.humanWait).length ? `<table><tr><th>Gate</th><th class="num">Requests</th><th class="num">Average wait</th></tr>${Object.entries(t.humanWait).map(([g, w]) => `<tr><td>Gate ${esc(g)}</td><td class="num">${w.requests}</td><td class="num">${mins(w.avgMin)}</td></tr>`).join('')}</table>` : '<p class="empty">No gate has been answered yet</p>'}</div>
          <div class="box"><h3>Agents</h3>${Object.keys(t.byAgent).length ? `<table><tr><th>Agent</th><th class="num">Runs</th><th class="num">Not ok</th><th class="num">Avg time</th></tr>${Object.entries(t.byAgent).sort((a, b) => b[1].runs - a[1].runs).map(([a, v]) => `<tr><td>${esc(agent(a))}</td><td class="num">${v.runs}</td><td class="num">${v.fails}</td><td class="num">${mins(v.avgMin)}</td></tr>`).join('')}</table>` : '<p class="empty">No runs yet</p>'}</div>
          <div class="box"><h3>Where work loops back</h3>${bars(Object.entries(t.loopCauses).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v), true, n)}</div>
          <div class="box"><h3>Done-item checks that fire</h3>${bars(Object.entries(t.checks).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 12), true, n)}</div>
        </div></div>`;
    });
  }

  // ---------------------------------------------------------------- request drawer
  function scopePanel(sc, s) {
    if (!sc) return '';
    const list = (title, xs, cls = '') => (xs.length ? `<div class="plist ${cls}"><h4>${title}</h4><ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : '');
    const reads = sc.calls.filter((c) => c.read); const writes = sc.calls.filter((c) => !c.read);
    return `<div class="plan">
      <div class="facts"><div class="fact"><b>${sc.done.length}</b> things the desk will deliver and prove</div><div class="fact"><b>${reads.length}</b> ${TECH ? 'reads planned' : 'reports and lists it will read in Dime'}</div><div class="fact ${sc.writes.length ? 'warn' : ''}"><b>${sc.writes.reduce((n, w) => n + (w.count || 1), 0)}</b> changes expected</div>${sc.children.length ? `<div class="fact"><b>${sc.children.length}</b> parts</div>` : ''}</div>
      <div class="plist"><h4>What you will get, and what the desk will prove</h4><ul class="done-list">${sc.done.map((d) => `<li><span class="id">${esc(d.id)}</span><span>${esc(d.text)}</span>${d.evaluator ? (TECH ? `<span class="ev" title="checked by code">${esc(d.evaluator)}</span>` : '<span class="ev" title="Checked automatically, not by judgment">checked automatically</span>') : ''}</li>`).join('')}</ul></div>
      ${sc.writes.length ? `<div class="plist warn"><h4>Changes that will be proposed (each needs your approval before it is posted)</h4><ul>${sc.writes.map((w) => `<li>${TECH ? `<span class="tier ${esc(w.tier)}">${esc(w.tier)}</span> ` : ''}${esc(w.kind)}${w.count ? ` × ${w.count}` : ''}: ${esc(w.summary)}</li>`).join('')}</ul></div>` : ''}
      ${list('Questions for you', sc.questions.map(esc))}
      ${list('Risks', sc.risks.map(esc))}
      ${list('Documents it will read', sc.inputs.map(esc))}
      ${list('Parts', sc.children.map(esc))}
      ${TECH && (reads.length || writes.length) ? `<details><summary>The calls to Dime (${reads.length} reads${writes.length ? `, ${writes.length} writes staged as proposals` : ''})</summary><ul class="calllist">${sc.calls.map((c) => `<li><span class="${c.read ? 'm' : 'w'}">${esc(c.method)}</span> ${esc(c.path)}${c.purpose ? ` <span class="p">${esc(c.purpose)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${sc.steps && sc.steps.length ? `<details><summary>Steps</summary><ol>${sc.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
    </div>`;
  }
  function proposalsPanel(ps) {
    const pending = ps.filter((p) => ['proposed', 'question'].includes(p.status));
    const row = (p) => {
      const decided = !['proposed', 'question'].includes(p.status);
      const entry = p.entry ? `<table><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${p.entry.lines.map((l) => `<tr><td>${esc(l.account)}</td><td class="num">${l.debit ? l.debit.toFixed(2) : ''}</td><td class="num">${l.credit ? l.credit.toFixed(2) : ''}</td></tr>`).join('')}</table>${p.entry.balanced ? '' : '<p class="hot">This entry does not balance; it cannot be approved.</p>'}` : '';
      let act = '';
      if (!decided && p.tier === 'C') act = `<div class="a-row"><input id="pa-${esc(p.id)}" placeholder="Your answer (kept on record; the desk acts on it)"><button class="btn primary small" data-act="proposal" data-pid="${esc(p.id)}" data-decision="answer">Answer</button></div>`;
      else if (!decided) act = `<div class="a-row">${p.tier === 'B' ? `<label class="inl">Amount <input id="pm-${esc(p.id)}" type="number" step="0.01" value="${p.amount != null ? esc(String(p.amount)) : ''}" title="The desk's estimate; confirm or correct it"></label>` : ''}<input id="pn-${esc(p.id)}" placeholder="Note (required to reject)"><button class="btn primary small" data-act="proposal" data-pid="${esc(p.id)}" data-decision="approve"${p.entry && !p.entry.balanced ? ' disabled' : ''}>Approve</button><button class="btn danger small" data-act="proposal" data-pid="${esc(p.id)}" data-decision="reject">Reject</button></div>`;
      const bodyBox = TECH && p.body ? (decided ? `<details><summary>What was sent to Dime</summary><pre class="raw">${esc(p.body)}</pre></details>` : `<details><summary>What will be sent to Dime (edit before approving if a field is wrong)</summary><textarea id="pb-${esc(p.id)}" rows="6" spellcheck="false" style="font-family:var(--mono);font-size:12px">${esc(p.body)}</textarea></details>`) : '';
      return `<div class="prop${decided ? ' decided' : ''}"><div class="p-h"><span class="tier ${esc(p.tier)}" title="${p.tier === 'A' ? 'One correct answer: one click' : p.tier === 'B' ? 'The amount is an estimate: confirm the number' : 'A judgment call: answer the question'}">${TECH ? esc(p.tier) : p.tier === 'A' ? 'Ready to approve' : p.tier === 'B' ? 'Confirm the amount' : 'Needs your answer'}</span><b>${esc(p.id)} · ${esc(p.kind || 'question')}: ${esc(p.summary)}</b><span class="status-pill ${esc(p.status)}">${esc(p.status)}${p.reviewedBy ? ` by ${esc(p.reviewedBy)}` : ''}</span></div>${TECH && p.route ? `<div class="route">${esc(p.route)}${p.tierReason ? ` · ${esc(p.tierReason)}` : ''}</div>` : ''}${entry}${p.appliedRef ? `<p class="aside">Posted to Dime: ${TECH ? esc(p.appliedRef.id || '') : ''} at ${esc(when(p.appliedRef.at))}</p>` : ''}${p.error ? `<p class="hot">${esc(p.error)}</p>` : ''}${p.note ? `<p class="aside">Note: ${esc(p.note)}</p>` : ''}${bodyBox}${act}</div>`;
    };
    return `<div class="plan">${ps.map(row).join('')}${pending.length ? '' : `<div class="a-row"><button class="btn primary" data-act="approve-gate2">Apply ${plural(ps.filter((p) => p.status === 'approved').length, 'approved change')} and continue</button></div>`}</div>`;
  }

  function renderAction(d) {
    const s = d.summary; const t = d.request; const gate = s.gate;
    const have = new Set(d.files.map((f) => f.path));
    const links = (names) => { const xs = names.filter((n) => have.has(n)); return xs.length ? `<div class="a-links">${xs.map((n) => `<button class="btn small" data-act="file" data-file="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''; };
    const key = [S.mode, s.status, s.active, s.agent, s.needs, s.questions, s.wait, s.blocked, s.runError, d.canStop, t.gates, s.children, gate ? [d.scope, d.proposals, [...have].join()] : '', S.roles, s.budgetUsd, s.costUsd, s.loops, d.summaryMd ? d.summaryMd.length : 0];
    paint($('#d-action'), key, () => {
      let cls = ''; let h = '';
      if (S.mode === 'edit') h = `<div class="a-h">Edit the request</div><p>Allowed until the scope is approved or the work starts. Agents see the new text on their next run.</p><div class="a-col"><input id="e-title" maxlength="200" value="${esc(t.title)}" aria-label="Title"><textarea id="e-body" rows="6" aria-label="Description">${esc(t.body)}</textarea></div><div class="a-row"><button class="btn primary" data-act="save-edit">Save</button><button class="btn" data-act="mode" data-mode="">Discard</button></div>`;
      else if (S.mode === 'cancel') { cls = 'bad'; h = `<div class="a-h">Cancel this request?</div><p>${s.active ? 'The run in progress is stopped. ' : ''}Nothing is deleted and nothing more is written to Dime.</p><div class="a-row"><input id="x-reason" placeholder="Why (recorded on the request)"><button class="btn danger" data-act="do-cancel">Cancel request</button><button class="btn" data-act="mode" data-mode="">Keep it</button></div>`; }
      else if (S.mode === 'sendback') { cls = 'you'; h = `<div class="a-h">Send the work back</div><p>Say what needs to change. The desk redoes the work with your note and reviews it again.</p><div class="a-col"><textarea id="sb-note" rows="3" placeholder="What is wrong or missing"></textarea></div><div class="a-row"><button class="btn primary" data-act="do-sendback">Send back</button><button class="btn" data-act="mode" data-mode="">Never mind</button></div>`; }
      else if (s.active) { cls = 'run'; h = `<div class="a-h"><span class="dot pulse"></span><span class="grow">${TECH ? `${esc(s.agentLabel || 'The desk')} is working on ${esc(STEP[s.status] || s.status)}` : `The desk is working on this · ${esc(STEP[s.status] || s.status)}`}${s.since ? ` · <span data-since="${esc(s.since)}"></span>` : ''}</span>${d.canStop ? '<button class="btn danger small" data-act="stop">Stop</button>' : ''}</div><p>You can close this window; the work continues.</p>`; }
      else if (s.needs === 'queued') h = `<div class="a-h"><span class="grow">Queued${s.wait && s.wait !== 'starting' ? `: ${esc(s.wait)}` : ', starting'}</span><button class="btn small" data-act="stop">Remove from queue</button></div><p>It starts by itself when the desk is free. A request that changes the books never runs beside another on the same business.</p>`;
      else if (s.needs === 'questions') { cls = 'you'; h = `<div class="a-h">The desk needs answers before it continues</div><ul>${t.pendingQuestions.map((q) => `<li>${inline(q)}</li>`).join('')}</ul><p>Reply in the conversation below. The desk continues as soon as you send.</p>`; }
      else if (gate === 2) { cls = 'you'; h = `<div class="a-h">Approve each change before anything is posted to Dime</div><p>Review each one below. Where an amount is an estimate, confirm or correct it. Where the desk asks a question, answer it and it will act on your answer. Rejecting needs a note.</p>${proposalsPanel(d.proposals)}${TECH ? links(['work.md', 'verify.md']) : ''}`; }
      else if (gate === 1) { cls = 'you'; const roles = S.roles.length ? S.roles : ['approver']; h = `<div class="a-h">Approve the plan before the desk starts</div>${scopePanel(d.scope, s)}${TECH ? links(['scope.md', 'triage.md']) : ''}<div class="a-row"><select id="g-role" aria-label="Approving as">${roles.map((r) => `<option value="${r}"${r === 'approver' ? ' selected' : ''}>as ${ROLE[r] || r}</option>`).join('')}</select><input id="g-note" placeholder="Note (required to send back)"><button class="btn primary" data-act="approve">Approve plan</button><button class="btn danger" data-act="reject">Send back</button></div>`; }
      else if (s.needs === 'blocked') {
        cls = 'bad'; const b = s.blocked || {}; const stage = STEP[s.lastStage] || s.lastStage;
        const why = b.reason || '';
        let out;
        if (b.kind === 'budget') out = `<p>This request has used up the work allowed for it before finishing ${esc(stage)}. Allow more work to let it continue, or cancel the request.</p><div class="a-row"><input id="b-usd" type="hidden" value="${Math.ceil((s.budgetUsd * 1.5) / 5) * 5}"><button class="btn primary" data-act="budget">Allow more work and continue</button></div>`;
        else if (b.kind === 'loop_verify') out = `<p>The review has not passed after ${s.loops.verify} attempts. Read the Checks tab first: this usually means the request needs a decision from you.</p><div class="a-row"><button class="btn primary" data-act="loop">Try once more</button><input id="ov-item" placeholder="Check to accept (e.g. D-2)" style="max-width:180px"><input id="ov-note" placeholder="Why it is acceptable (kept on record)"><button class="btn" data-act="override">Accept and deliver</button></div>`;
        else if (b.stage === 'apply') out = `<p>${why ? inline(why.slice(0, 500)) : 'Dime refused a change.'}</p><p>Correct the change that failed and approve it again, or reject it with a note, then post again. Nothing after the failed item was posted.</p>${proposalsPanel(d.proposals.map((p) => (p.status === 'failed' ? { ...p, status: 'proposed', note: p.error } : p)))}<div class="a-row"><button class="btn primary" data-act="retry">Post again</button></div>`;
        else out = `<p>${TECH ? (why ? inline(why.slice(0, 500)) : 'See the conversation for the reason.') : 'The desk could not finish this step. Try it again, or add a note in the conversation if something about the request should change.'}</p><div class="a-row"><button class="btn primary" data-act="retry">Try ${esc(stage)} again</button>${TECH ? '<button class="btn" data-act="resume" title="After a timeout: accept the stage if its artifacts are complete">Judge from artifacts</button>' : ''}</div>`;
        h = `<div class="a-h">On hold at ${esc(stage)}</div>${out}`;
      }
      else if (s.needs === 'error') { cls = 'bad'; h = `<div class="a-h">The work stopped unexpectedly</div><p>${TECH ? esc(s.runError.message) : 'Nothing was lost. Try again; if it stops a second time, tell your Dime contact.'}</p><div class="a-row"><button class="btn primary" data-act="retry">Try again</button>${TECH ? '<button class="btn" data-act="tab" data-tab="cost">See the run log</button>' : ''}</div>`; }
      else if (s.needs === 'start') h = `<div class="a-h"><span class="grow">Ready for ${esc(STEP[s.status] || s.status)}</span><button class="btn primary" data-act="run">${s.runs ? 'Continue' : 'Start'}</button></div><p>The desk works until it needs your approval or an answer.</p>`;
      else if (s.status === 'children') h = `<div class="a-h">Waiting for its parts</div><ul>${s.children.map((k) => `<li><a href="#/r/${esc(k.id)}">${esc(k.id)}</a> ${esc(k.title)} <span class="aside">${esc(STEP[k.status] || k.status)}</span></li>`).join('')}</ul><p>You get one combined result when every part is done.</p>`;
      else if (s.status === 'cancelled') h = `<div class="a-h">Cancelled${t.cancelled ? ` by ${esc(t.cancelled.by)}` : ''}</div><p>${t.cancelled ? esc(t.cancelled.reason) : ''}</p>`;
      else { cls = 'ok'; h = `<div class="a-h"><span class="grow">Delivered</span>${[...d.deliverables].sort((x, y) => Number(y.first) - Number(x.first)).slice(0, 3).map((f) => openBtn(d.request.id, f, f.first ? 'primary' : '')).join('')}${d.deliverables.length > 3 ? `<button class="btn small" data-act="tab" data-tab="deliver">All ${d.deliverables.length} files</button>` : ''}<button class="btn small" data-act="mode" data-mode="sendback">Send back</button></div>${d.summaryMd ? `<div class="md sum">${md((TECH ? d.summaryMd : plainNames(d.summaryMd)).slice(0, 2500))}</div>` : ''}<div class="a-links">${TECH && have.has('evidence.html') ? '<button class="btn small" data-act="file" data-file="evidence.html">evidence.html</button>' : ''}${d.summaryMd ? `<a class="btn small" href="/api/requests/${enc(d.request.id)}/files/summary.md?as=pdf" target="_blank" rel="noopener">Summary as PDF</a>` : ''}</div>`; }
      $('#d-action').className = `action ${cls}`;
      return h;
    });
  }

  // names an accountant would not recognise never reach the client view: draft file names read as the pdf they are delivered as, code spans lose their backticks
  const plainNames = (t) => String(t).replace(/\b([\w-]+)\.md\b/g, (m, n) => (/^(summary|work|verify|triage|scope|memo|lessons)$/.test(n) ? `the ${n === 'verify' ? 'review' : n === 'triage' ? 'intake' : n} notes` : `${n}.pdf`)).replace(/`([^`]+)`/g, '$1').replace(/\b(at|before|after|for) Gate 1\b/gi, '$1 plan approval').replace(/\b(at|before|after|for) Gate 2\b/gi, '$1 your approval').replace(/\bGate 1\b/g, 'plan approval').replace(/\bGate 2\b/g, 'approval of the changes').replace(/\s*\((?:P-\d+(?: to P-\d+)?, )?tier [ABC]\)/gi, '');
  function message(c, id, title) {
    let body = c.body || '';
    if (title) { const rest = body.slice(title.length).replace(/^\n+/, ''); if (body.startsWith(title) && rest.startsWith(title.replace(/…$/, ''))) body = rest; }
    const mv = c.kind === 'system' && /^→ (\w+)(?: \(([\s\S]*)\))?\s*$/.exec(body);
    if (!TECH) {
      // the requester sees progress and plain notes: no run starts, tool warnings or the agents' working notes
      if (mv) return `<div class="sys move" title="${esc(when(c.at))}"><span><b>${esc(STEP[mv[1]] || mv[1])}</b></span></div>`;
      if (c.kind === 'system') return '';
      if (c.kind === 'agent') { const m = /(?:^|\n)— [^:\n]{1,40}: ([\s\S]+)$/.exec(body); if (!m) return ''; const text = plainNames(m[1]).replace(/\s*\((?:R-\d+(?:,\s*| and )?)+\)/g, '').split(/(?<=[.!?])\s+/).filter((x) => !/\bsize [SML]\b|\b(analyst|investigator|preparer|bookkeeper|verifier|planner|deliverer|advisory|evaluators?)\b/i.test(x)).join(' '); if (!text.trim()) return ''; return `<div class="msg agent" title="${esc(when(c.at))}"><span class="av" aria-hidden="true">D</span><div class="bub"><div class="who"><b>Request Desk</b> · ${esc(when(c.at))}</div><div class="body md">${md(text)}</div></div></div>`; }
      body = body.replace(/\bGate 1\b/g, 'the plan').replace(/\bGate 2\b/g, 'the changes').replace(/ \((?:\w+, )?tier [ABC]\)/, '');
    }
    if (mv) return `<div class="sys move" title="${esc(`${when(c.at)}${mv[2] ? ` — ${mv[2]}` : ''}`)}"><span><b>${esc(STEP[mv[1]] || mv[1])}</b>${mv[2] ? ` · ${inline(mv[2].length > 150 ? `${mv[2].slice(0, 150)}…` : mv[2])}` : ''}</span></div>`;
    if (c.kind === 'system') { const cls = /^⚠/.test(body) ? ' warn' : ''; return `<div class="sys${cls}" title="${esc(when(c.at))}">${inline(body.slice(0, 600))}</div>`; }
    const m = /(?:^|\n)Attached: (.+)\s*$/.exec(body); const text = m ? body.slice(0, m.index) : body;
    const names = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
    const thumbs = names.length ? `<div class="thumbs">${names.map((n) => { const u = `/api/requests/${enc(id)}/files/attachments/${enc(n)}`; return IMG.test(n) ? `<a class="img" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${esc(n)}" loading="lazy"></a>` : `<a class="btn small" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`; }).join('')}</div>` : '';
    const initials = c.kind === 'agent' ? c.author.slice(0, 2).toUpperCase() : (c.author || '?').trim().slice(0, 1).toUpperCase();
    return `<div class="msg ${c.kind}"><div class="av" aria-hidden="true">${esc(initials)}</div><div class="bub"><div class="who"><b>${esc(c.author)}</b> · ${esc(STEP[c.stage] || c.stage || '')} · ${esc(when(c.at))}</div><div class="body md">${md(text)}</div>${thumbs}</div></div>`;
  }
  function renderThread(d) {
    const box = $('#thread'); const msgs = $('#msgs');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 90 || S.shown === 0;
    if (d.comments.length < S.shown) { msgs.innerHTML = ''; S.shown = 0; }
    if (d.comments.length > S.shown) { const tmp = document.createElement('div'); tmp.innerHTML = d.comments.slice(S.shown).map((c, i) => message(c, d.request.id, S.shown + i === 0 ? d.request.title : '')).join(''); const added = [...tmp.children]; msgs.append(...added); S.shown = d.comments.length; for (const el of added) { const b = $('.body', el); if (b && b.scrollHeight > 330) { b.classList.add('clamp'); b.insertAdjacentHTML('afterend', '<button class="btn small more" data-act="more">Show all</button>'); } } }
    const changed = paint($('#activity'), [d.summary.active, d.activity], () => (d.summary.active ? (!TECH ? `<div class="a-t"><span class="dot pulse"></span>Working on it · ${esc(STEP[d.summary.status] || '')}</div>` : `<div class="a-t"><span class="dot pulse"></span>${esc(d.summary.agentLabel || 'Desk')} · live</div>${d.activity.map((a) => `<div class="l">${a.kind === 'tool' ? `<b>${esc(a.name)}</b> ${esc(a.text)}` : esc(a.text)}</div>`).join('') || '<div class="l">Starting…</div>'}`) : ''));
    if (stick && (changed || d.comments.length)) box.scrollTop = box.scrollHeight;
    $('#r-body').placeholder = d.summary.questions ? 'Answer the questions above. The desk continues when you send.' : 'Add a note or more detail for the desk.';
    const canInterrupt = d.summary.active && d.canStop; $('#r-int-row').hidden = !canInterrupt; if (!canInterrupt) $('#r-int').checked = false;
  }
  function renderDeliver(d) {
    $('#d-ndeliver').textContent = d.deliverables.length ? `(${d.deliverables.length})` : '';
    paint($('#p-deliver'), [d.deliverables, d.summaryMd], () => {
      const id = d.request.id;
      const row = (f) => { const u = `/api/requests/${enc(id)}/files/${enc(f.path)}`; const ext = f.asPdf ? 'pdf' : f.format || f.name.split('.').pop(); return `<div class="dl${f.first ? ' first' : ''}"><div class="ext">${esc(ext)}</div><div class="grow"><b>${esc(f.label || f.name)}</b><span>${f.first ? `<em class="firstchip">Open this first</em>${f.why ? ` ${esc(f.why)} · ` : ' '}` : ''}${esc(FMT[ext] || ext.toUpperCase())}${f.asPdf ? '' : ` · ${size(f.bytes)}`}</span></div>${TECH && /^(md|csv|txt|png|jpe?g)$/i.test(f.format) ? `<button class="btn small" data-act="file" data-file="${esc(f.path)}">Preview</button>` : ''}${f.asPdf || f.format === 'pdf' ? `<a class="btn small" href="${u}?${f.asPdf ? 'as=pdf&' : ''}download=1" target="_blank" rel="noopener">Download</a>` : ''}${openBtn(id, f, 'primary')}</div>`; };
      return `<div class="pad">${d.summaryMd ? `<div class="summary-box md">${md(TECH ? d.summaryMd : plainNames(d.summaryMd))}<div class="a-links"><a class="btn small" href="/api/requests/${enc(id)}/files/summary.md?as=pdf" target="_blank" rel="noopener">Summary as PDF</a></div></div>` : ''}${d.deliverables.length ? d.deliverables.map(row).join('') : '<p class="empty">No files yet. They appear here as they are prepared.</p>'}${TECH && d.files.some((f) => f.path === 'evidence.html') ? `<div class="a-links"><a class="btn small" href="/api/requests/${enc(id)}/files/evidence.html" target="_blank" rel="noopener">Open the evidence page ↗</a></div>` : ''}</div>`;
    });
  }
  function renderProof(d) {
    const rows = TECH ? d.evidence : (d.assurance || []); const bad = rows.filter((r) => r.state === 'fail').length;
    $('#d-nproof').textContent = rows.length ? (bad ? `(${bad} failing)` : `(${rows.length})`) : '';
    paint($('#p-proof'), [rows, d.lessons], () => {
      const mark = { pass: '✓', fail: '✕', warn: '!' };
      const row = (r) => `<div class="proof ${r.state}"><span class="mark" aria-label="${r.state}">${mark[r.state] || '·'}</span><div class="grow"><div class="p-h"><b>${esc(r.label)}</b>${TECH && r.file ? `<button class="btn small" data-act="file" data-file="${esc(r.file)}">${esc(r.file)}</button>` : ''}</div><div class="p-t">${esc(r.text)}</div>${r.items.length ? `<details${r.state === 'fail' ? ' open' : ''}><summary>${plural(r.items.length, 'detail')}</summary><ul>${r.items.map((i) => `<li class="${i.state}">${esc(i.text)}</li>`).join('')}</ul></details>` : ''}</div></div>`;
      const lessons = TECH && d.lessons ? `<div class="proof ${d.lessons.accepted ? 'pass' : 'warn'}"><span class="mark">${d.lessons.accepted ? '✓' : '!'}</span><div class="grow"><div class="p-h"><b>Lessons the agents propose for next time</b><button class="btn small" data-act="file" data-file="lessons.md">lessons.md</button></div><div class="p-t">${d.lessons.accepted ? 'Accepted into the shared knowledge every agent loads.' : 'Not accepted yet. Read them first.'}</div>${d.lessons.accepted ? '' : '<div class="a-row"><button class="btn" data-act="lessons">Accept into shared knowledge</button></div>'}</div></div>` : '';
      return `<div class="pad">${rows.length || lessons ? '' : '<p class="empty">Nothing to show yet. What was checked and where each figure came from appear here as the work progresses.</p>'}${rows.map(row).join('')}${lessons}</div>`;
    });
  }
  function renderFiles(d) {
    $('#d-nfiles').textContent = d.files.length ? `(${d.files.length})` : '';
    paint($('#f-list'), [d.files.map((f) => f.path), S.file], () => {
      if (!d.files.length) return '<p class="empty">No files yet.</p>';
      const groups = {}; for (const f of d.files) { const i = f.path.lastIndexOf('/'); const g = i < 0 ? '' : f.path.slice(0, i); (groups[g] = groups[g] || []).push(f); }
      return Object.keys(groups).sort().map((g) => `${g ? `<div class="grp">${esc(g)}</div>` : ''}${groups[g].map((f) => `<button data-act="file" data-file="${esc(f.path)}" class="${f.path === S.file ? 'on' : ''}"><span title="${esc(f.path)}">${esc(f.path.slice(g ? g.length + 1 : 0))}</span><em>${size(f.bytes)}</em></button>`).join('')}`).join('');
    });
  }
  async function showFile(p) {
    const d = S.d; if (!d) return; const f = d.files.find((x) => x.path === p); if (!f) return;
    S.file = p; renderFiles(d);
    const url = `/api/requests/${enc(d.request.id)}/files/${enc(p)}`; const view = $('#f-view');
    const head = `<div class="f-h"><b>${esc(p)}</b><span>${size(f.bytes)} · ${esc(when(f.mtime))}</span><a class="btn small" href="${url}${/\.(xlsx|docx|pdf)$/i.test(p) ? '?download=1' : ''}" target="_blank" rel="noopener">${/\.(xlsx|docx)$/i.test(p) ? 'Download' : 'Open'}</a></div>`;
    if (IMG.test(p)) { view.innerHTML = `${head}<img src="${url}" alt="${esc(p)}">`; return; }
    if (!/\.(md|txt|log|csv|json|jsonl|js|ts|ya?ml|html)$/i.test(p) || f.bytes > 1500000) { view.innerHTML = `${head}<p class="empty">No inline preview for this file. Use the button above.</p>`; return; }
    view.innerHTML = `${head}<p class="empty">Loading…</p>`;
    try { let text = await (await fetch(url, { cache: 'no-store' })).text(); if (S.file !== p) return; if (/\.md$/i.test(p)) { view.innerHTML = `${head}<div class="md">${md(text)}</div>`; return; } if (/\.json$/i.test(p)) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* as written */ } } view.innerHTML = `${head}<pre class="raw">${esc(text)}</pre>`; } catch (e) { view.innerHTML = `${head}<p class="empty">${esc(e.message)}</p>`; }
  }
  const agentName = (a) => (S.board && S.board.agents[a]) || a;
  function transcriptHtml(tr, id) {
    const r = tr.run || {}; const base = `/api/requests/${enc(id)}/runs/${r.n}`;
    const item = (i) => { if (i.k === 'text') return `<div class="tr-text md">${md(i.text)}</div>`; if (i.k === 'tool') return `<details class="tr-tool"><summary><b>${esc(i.name)}</b> ${esc(i.summary)}</summary><pre class="raw">${esc(i.input)}</pre></details>`; if (i.k === 'result') return `<details class="tr-res${i.error ? ' err' : ''}"${i.error ? ' open' : ''}><summary>${i.error ? 'refused or failed' : 'result'}</summary><pre class="raw">${esc(i.text)}</pre></details>`; return `<div class="sys move"><span><b>Run ended</b> · ${esc(i.subtype || '')} · ${plural(i.turns, 'turn')}</span></div>`; };
    return `<div class="pad"><div class="f-h"><button class="btn small" data-act="run-close">← All runs</button><b>Run ${esc(r.n)} · ${esc(agentName(r.agent))} · ${esc(STEP[r.stage] || r.stage)}</b><span>${esc(r.status || '')}${r.verdict ? ` · ${esc(r.verdict)}` : ''} · ${dur(r.durationMs) || '–'}</span>${tr.hasPrompt ? `<a class="btn small" href="${base}?part=prompt" target="_blank" rel="noopener">Prompt</a>` : ''}${tr.hasFinal ? `<a class="btn small" href="${base}?part=final" target="_blank" rel="noopener">Final answer</a>` : ''}</div>
      ${tr.denials.length ? `<div class="proof warn"><span class="mark">!</span><div class="grow"><div class="p-h"><b>The guard stopped ${plural(tr.denials.length, 'tool call')} in this run</b></div><ul>${tr.denials.map((x) => `<li><code>${esc(x.tool)}</code> ${esc(x.what)} <span class="aside">${esc(x.reason)}</span></li>`).join('')}</ul></div></div>` : ''}
      ${tr.items.length ? tr.items.map(item).join('') : '<p class="empty">No transcript: this step is code, not a model run.</p>'}${tr.truncated ? '<p class="empty">Long run: showing the first 2,500 steps.</p>' : ''}</div>`;
  }
  function renderCost(d) {
    const t = d.request; const s = d.summary;
    paint($('#p-cost'), [t.runs, s.budgetUsd, s.estimateUsd, s.loops, S.run, S.tr && S.tr.name, d.log], () => {
      if (S.run) return S.tr ? transcriptHtml(S.tr, t.id) : '<div class="pad"><p class="empty">Loading the transcript…</p></div>';
      return `<div class="pad"><div class="tiles"><div class="tile"><b>${t.runs.length}</b>runs</div><div class="tile"><b>${dur(t.runs.reduce((x, r) => x + (r.durationMs || 0), 0)) || '–'}</b>working time</div><div class="tile"><b><span${s.loops.verify >= s.loops.verifyLimit ? ' class="hot"' : ''}>${s.loops.verify}/${s.loops.verifyLimit}</span></b>verify rounds used</div></div>
        <div class="box"><h3>Runs <span class="aside">open one to read everything the agent did</span></h3>${t.runs.length ? `<table><tr><th>#</th><th>Stage</th><th>Agent</th><th>Result</th><th>Started</th><th class="num">Turns</th><th class="num">Stopped calls</th><th class="num">Time</th></tr>${t.runs.map((r) => `<tr class="rowlink" data-act="run-open" data-run="${r.n}"><td>${r.n}</td><td>${esc(STEP[r.stage] || r.stage)}</td><td>${esc(agentName(r.agent))}</td><td>${esc(r.status)}${r.verdict ? ` · ${esc(r.verdict)}` : ''}${r.wrappedUp ? ' · wrapped up at its limit' : ''}</td><td>${esc(when(r.startedAt))}</td><td class="num">${r.numTurns || '–'}</td><td class="num${(r.guardDenials || 0) + (r.permissionDenials || 0) ? ' hot' : ''}">${'guardDenials' in r ? (r.guardDenials || 0) + (r.permissionDenials || 0) : '–'}</td><td class="num">${r.status === 'running' ? 'running' : dur(r.durationMs)}</td></tr>`).join('')}</table>` : '<p class="empty">No runs yet</p>'}</div>
        ${d.log ? `<div class="box"><details><summary>Run log (what the orchestrator printed for runs started here)</summary><pre class="raw">${esc(d.log)}</pre></details></div>` : ''}</div>`;
    });
  }
  async function openRun(n) { S.run = n; S.tr = null; renderCost(S.d); try { const tr = await api(`/api/requests/${enc(S.id)}/runs/${n}`); if (S.run === n) { S.tr = tr; renderCost(S.d); $('#p-cost').scrollTop = 0; } } catch (e) { toast(e.message); S.run = null; renderCost(S.d); } }

  function renderDetail() {
    const d = S.d; if (!d) return; const t = d.request; const s = d.summary;
    paint($('#d-meta'), [s.id, s.kind, s.size, s.writes, s.worker, s.fastLane, t.reporter, t.createdAt, t.parentId, s.subject], () => `<span class="id">${esc(t.id)}</span>${s.kind ? `<span class="tagchip">${esc(KIND[s.kind] || s.kind)}</span>` : ''}${TECH && s.size ? `<span class="tagchip">size ${esc(s.size)}</span>` : ''}${s.writes ? '<span class="tagchip w">changes the books</span>' : ''}${TECH && s.fastLane && s.kind && !s.writes && s.size === 'S' ? '<span class="tagchip" title="Small read-only request: no scope step, no Gate 1">fast lane</span>' : ''}${s.subject.names.length ? `<span>${esc(s.subject.names.join(', '))}</span>` : ''}${s.subject.periods.length ? `<span>${esc(s.subject.periods.map(period).join(', '))}</span>` : ''}<span>from ${esc(t.reporter)} · ${esc(when(t.createdAt))}</span>${t.parentId ? `<a href="#/r/${esc(t.parentId)}">part of ${esc(t.parentId)}</a>` : ''}`);
    $('#d-name').textContent = t.title;
    const terminal = isDone(s);
    paint($('#d-tools'), [d.canEdit, terminal, S.mode], () => `${d.canEdit ? '<button class="btn ghost small" data-act="mode" data-mode="edit">Edit</button>' : ''}${terminal ? '' : '<button class="btn ghost small" data-act="mode" data-mode="cancel">Cancel request</button>'}`);
    const tone = s.active ? '' : (s.needs === 'blocked' || s.needs === 'error') ? ' bad' : (s.needs === 'gate' || s.needs === 'questions') ? ' you' : terminal && s.status !== 'cancelled' ? ' ok' : '';
    paint($('#d-steps'), [d.lane, s.status, s.lastStage, tone], () => { const cur = s.status === 'blocked' ? s.lastStage : s.status; const at = s.status === 'cancelled' ? d.lane.indexOf((t.cancelled || {}).from) : d.lane.indexOf(cur); return d.lane.map((st, i) => `<li class="${/^awaiting_gate/.test(st) ? 'gate ' : ''}${i < at ? 'past' : i === at ? `now${tone}` : ''}"${i === at ? ' aria-current="step"' : ''} title="${esc(STEP[st] || st)}">${esc(SHORT[st] || STEP[st] || st)}</li>`).join(''); });
    paint($('#d-stats'), [s.costUsd, s.budgetUsd, s.estimateUsd, s.runs, s.wallMin, s.loops, s.guardDenials, s.proposals, s.deliverables], () => { return `${TECH ? `<span><b>${s.runs}</b> run${s.runs === 1 ? '' : 's'}</span>` : ''}${s.wallMin != null ? `<span><b>${mins(s.wallMin)}</b> ${isDone(s) ? 'from request to delivery' : 'so far'}</span>` : ''}${TECH && s.loops.verify ? `<span${s.loops.verify >= s.loops.verifyLimit ? ' class="hot"' : ''}><b>${s.loops.verify}/${s.loops.verifyLimit}</b> verify rounds</span>` : ''}${s.proposals.total ? `<span><b>${s.proposals.applied}/${s.proposals.total}</b> changes applied</span>` : ''}${s.deliverables ? `<span><b>${s.deliverables}</b> file${s.deliverables === 1 ? '' : 's'} delivered</span>` : ''}${TECH && s.guardDenials ? `<span class="hot"><b>${s.guardDenials}</b> tool call${s.guardDenials === 1 ? '' : 's'} stopped</span>` : ''}`; });
    renderAction(d); renderThread(d); renderDeliver(d); renderProof(d); renderFiles(d); renderCost(d); tickClocks();
  }
  function setTab(tab) { S.tab = tab; for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab); for (const p of ['chat', 'deliver', 'proof', 'files', 'cost']) $(`#p-${p}`).hidden = p !== tab; if (tab === 'chat') { const box = $('#thread'); box.scrollTop = box.scrollHeight; } }
  function openRequest(id) {
    if (S.id !== id) { S.id = id; S.d = null; S.shown = 0; S.file = null; S.mode = null; S.run = null; S.tr = null; for (const k of ['d-meta', 'd-tools', 'd-steps', 'd-stats', 'd-action', 'activity', 'p-proof', 'p-deliver', 'f-list', 'p-cost']) delete S.keys[k]; $('#msgs').innerHTML = ''; $('#activity').innerHTML = ''; $('#f-view').innerHTML = '<p class="empty">Pick a file to read it here.</p>'; $('#d-name').textContent = id; setTab('chat'); }
    $('#drawer').hidden = false; $('#scrim').hidden = false; loadDetail();
  }
  function closeRequest() { S.id = null; S.d = null; $('#drawer').hidden = true; $('#scrim').hidden = true; }
  async function loadDetail() { const id = S.id; if (!id) return; try { const d = await api(`/api/requests/${enc(id)}`); if (S.id === id) { S.d = d; renderDetail(); } } catch (e) { if (S.id === id && !S.d) { toast(e.message); location.hash = '#/board'; } } }
  async function act(name, body) { if (S.busy || !S.id) return null; S.busy = true; try { const d = await api(`/api/requests/${enc(S.id)}/${name}`, body || {}); S.d = d; renderDetail(); refresh(); return d; } catch (e) { toast(e.message); return null; } finally { S.busy = false; } }

  // ---------------------------------------------------------------- events
  const newFiles = attachBox($('#c-files'), $('#c-file'), $('#c-attach'), $('#composer'), $('#c-body'));
  const replyFiles = attachBox($('#r-files'), $('#r-file'), $('#r-attach'), $('#reply'), $('#r-body'));
  const fitNew = grow($('#c-body'), 320); const fitReply = grow($('#r-body'), 200);
  const submitOnCmdEnter = (form) => (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } };
  $('#composer').addEventListener('keydown', submitOnCmdEnter($('#composer')));
  $('#reply').addEventListener('keydown', submitOnCmdEnter($('#reply')));
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault(); const body = $('#c-body').value.trim(); if (!body) { $('#c-body').focus(); return; }
    const go = $('#c-go'); go.disabled = true;
    try { const kind = (document.querySelector('input[name=c-kind]:checked') || {}).value || undefined; const d = await api('/api/requests', { body, kind, attachments: newFiles.take(), start: true, ...(EMBED.business ? { business: EMBED.business, businessName: EMBED.name } : {}) }); $('#c-body').value = ''; document.querySelector('input[name=c-kind]').checked = true; newFiles.clear(); fitNew(); await refresh(); location.hash = `#/r/${d.request.id}`; } catch (err) { toast(err.message); } finally { go.disabled = false; }
  });
  $('#reply').addEventListener('submit', async (e) => { e.preventDefault(); const text = $('#r-body').value.trim(); if (!text && !replyFiles.count()) return; const d = await act('message', { text, attachments: replyFiles.take(), interrupt: $('#r-int').checked }); if (d) { $('#r-body').value = ''; $('#r-int').checked = false; replyFiles.clear(); fitReply(); } });
  $('#drawer').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act; const val = (id) => (($(id) || {}).value || '').trim();
    if (a === 'close') { location.hash = '#/board'; return; }
    if (a === 'tab') { setTab(b.dataset.tab); return; }
    if (a === 'file') { setTab('files'); showFile(b.dataset.file); return; }
    if (a === 'more') { b.previousElementSibling.classList.remove('clamp'); b.remove(); return; }
    if (a === 'mode') { S.mode = b.dataset.mode || null; renderDetail(); const f = $('#x-reason') || $('#e-title') || $('#sb-note'); if (f) f.focus(); return; }
    if (a === 'run-open') { openRun(Number(b.dataset.run)); return; }
    if (a === 'run-close') { S.run = null; S.tr = null; renderCost(S.d); return; }
    if (['run', 'resume', 'stop', 'retry', 'lessons', 'loop'].includes(a)) { act(a); return; }
    if (a === 'budget') { act('budget', { usd: Number(val('#b-usd')) }); return; }
    if (a === 'override') { if (!val('#ov-item') || !val('#ov-note')) { toast('Name the item and say why it is acceptable.'); return; } act('override', { item: val('#ov-item'), note: val('#ov-note') }); return; }
    if (a === 'save-edit') { if (await act('amend', { title: val('#e-title'), body: val('#e-body') })) { S.mode = null; renderDetail(); } return; }
    if (a === 'do-cancel') { if (!val('#x-reason')) { $('#x-reason').focus(); toast('Say why: the reason is recorded on the request.'); return; } if (await act('cancel', { reason: val('#x-reason') })) { S.mode = null; renderDetail(); } return; }
    if (a === 'do-sendback') { if (!val('#sb-note')) { $('#sb-note').focus(); toast('Say what needs to change.'); return; } if (await act('sendback', { note: val('#sb-note') })) { S.mode = null; renderDetail(); } return; }
    if (a === 'proposal') {
      const pid = b.dataset.pid; const decision = b.dataset.decision; const note = decision === 'answer' ? val(`#pa-${pid}`) : val(`#pn-${pid}`); const amount = $(`#pm-${pid}`) ? val(`#pm-${pid}`) : null;
      if (decision === 'reject' && !note) { toast('A note is required to reject.'); return; } if (decision === 'answer' && !note) { toast('Write your answer first.'); return; }
      let body = null; const box = $(`#pb-${pid}`); const orig = S.d && (S.d.proposals.find((p) => p.id === pid) || {}).body;
      if (decision === 'approve' && box && box.value.trim() !== String(orig || '').trim()) { try { body = JSON.parse(box.value); } catch { toast('The edited body is not valid JSON.'); return; } }
      act('proposal', { id: pid, decision, note, amount, body }); return;
    }
    if (a === 'approve-gate2') { act('approve', { gate: 2, role: 'approver' }); return; }
    const gate = S.d && S.d.summary.gate; const note = val('#g-note');
    if (a === 'approve') act('approve', { gate, role: ($('#g-role') || {}).value, note });
    if (a === 'reject') { if (!note) { $('#g-note').focus(); toast('Say what needs to change: the note goes back to the agents.'); return; } act('reject', { gate, note }); }
  });
  $('#scrim').addEventListener('click', () => { location.hash = '#/board'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.id && !/^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName)) location.hash = '#/board'; });
  $('#view-done').addEventListener('click', (e) => { const r = e.target.closest('[data-open]'); if (r && !e.target.closest('a')) location.hash = `#/r/${r.dataset.open}`; });
  $('#view-system').addEventListener('click', (e) => { if (e.target.closest('[data-refresh]')) { delete S.cache['/api/health']; renderSystem(true); } });
  $('#new').addEventListener('click', () => { location.hash = '#/board'; setTimeout(() => $('#c-body').focus(), 0); });
  $('#tpls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]'); if (!b || !S.board) return;
    const t = (S.board.templates || []).find((x) => x.id === b.dataset.tpl); if (!t) return;
    $('#c-body').value = t.body; fitNew();
    const k = document.querySelector(`input[name=c-kind][value="${t.kind}"]`); if (k) k.checked = true;
    const ta = $('#c-body'); ta.focus(); const i = ta.value.indexOf('{'); if (i >= 0) { const j = ta.value.indexOf('}', i); ta.setSelectionRange(i, j + 1); }
  });
  $('#search').addEventListener('input', () => { S.q = $('#search').value.trim().toLowerCase(); renderBoard(); });
  $('#notify').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { /* unsupported */ } renderNotifyButton(); });

  // ---------------------------------------------------------------- sign in
  function showLogin() { if (S.authed === false && !$('#login').hidden) return; S.authed = false; for (const id of ['app', 'drawer', 'scrim']) $(`#${id}`).hidden = true; $('#login').hidden = false; $('#l-name').value = S.me || ''; $('#l-name-row').hidden = Boolean(S.accountsOnly); (S.me || S.accountsOnly ? $('#l-key') : $('#l-name')).focus(); }
  function showApp(session) { S.authed = true; S.me = session.name; S.roles = session.roles || ['approver']; try { localStorage.setItem('lab.me', S.me); } catch { /* unavailable */ } $('#login').hidden = true; $('#app').hidden = false; $('#me-name').textContent = S.me; $('#me-av').textContent = S.me.slice(0, 1).toUpperCase(); renderNotifyButton(); route(); refresh(); }
  $('#login-form').addEventListener('submit', async (e) => { e.preventDefault(); const name = $('#l-name').value.trim(); const err = $('#l-err'); err.hidden = true; if (!name && !S.accountsOnly) { $('#l-name').focus(); return; } try { const s = await api('/api/login', { key: $('#l-key').value, name }); $('#l-key').value = ''; showApp(s); } catch (x) { err.textContent = x.message; err.hidden = false; $('#l-key').select(); } });
  $('#logout').addEventListener('click', async () => { try { await api('/api/logout', {}); } catch { /* signed out either way */ } S.cache = {}; showLogin(); });
  try { S.me = localStorage.getItem('lab.me') || ''; } catch { S.me = ''; }

  function route() {
    if (!S.authed) return;
    const h = location.hash || '#/board'; const m = /^#\/r\/([A-Za-z0-9_-]+)/.exec(h);
    if (!m) { closeRequest(); S.view = h.startsWith('#/done') ? 'done' : h.startsWith('#/system') ? 'system' : 'board'; for (const v of ['board', 'done', 'system']) $(`#view-${v}`).hidden = v !== S.view; if (S.view === 'system') renderSystem(); } else openRequest(m[1]);
    for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('on', a.dataset.nav === (S.view || 'board'));
    delete S.keys.board; renderBoard();
  }
  window.addEventListener('hashchange', route);
  function tickClocks() { const now = Date.now(); for (const el of document.querySelectorAll('[data-since]')) el.textContent = dur(now - Date.parse(el.dataset.since)); }
  setInterval(tickClocks, 1000);
  async function refresh() { try { S.board = await api('/api/board'); renderBoard(); } catch (e) { if (S.authed) toast(`Cannot reach the dashboard server: ${e.message}`); } }
  async function loop() { if (S.authed) { await refresh(); if (S.id) await loadDetail(); if (S.view === 'system' && !S.id) renderSystem(); } setTimeout(loop, document.hidden ? 6000 : 2000); }
  api('/api/session').then((x) => { S.accountsOnly = Boolean(x.accounts && !x.shared && !x.authed); return x.authed ? showApp(x) : showLogin(); }, () => showLogin()).then(loop);
})();
