#!/usr/bin/env node
'use strict';
// Builds the attachments for the Request Desk demo (run: node demo/make-demo-files.js). Fictitious vendors, test EINs.
const fs = require('fs'); const path = require('path');
const X = require('../src/xlsx'); const PDF = require('../src/pdf');
const out = __dirname;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const w9 = (v) => `<!doctype html><html><head><meta charset="utf-8"><title>W-9 ${esc(v.name)}</title><style>
@page { size: letter; margin: 22mm; } body { font-family: Helvetica, Arial, sans-serif; color: #111; }
h1 { font-size: 19pt; margin: 0 0 14px; } .note { font-style: italic; font-size: 11pt; margin-bottom: 14px; }
.box { border: 1.5px solid #888; } .row { border-bottom: 1.5px solid #888; padding: 8px 10px; } .row:last-child { border-bottom: 0; }
.l { font-size: 8.5pt; color: #555; } .v { font-size: 12.5pt; } .tin { font-weight: 700; }</style></head><body>
<h1>Form W-9 (Rev. March 2024) — Request for Taxpayer Identification Number and Certification</h1>
<div class="note">Sample form for a test environment. Not a real taxpayer.</div><div class="box">
<div class="row"><div class="l">1 Name (as shown on your income tax return)</div><div class="v">${esc(v.name)}</div></div>
<div class="row"><div class="l">2 Business name/disregarded entity name, if different from above</div><div class="v">${esc(v.dba || v.name)}</div></div>
<div class="row"><div class="l">3 Federal tax classification</div><div class="v">${esc(v.cls)}</div></div>
<div class="row"><div class="l">5 Address (number, street, and apt. or suite no.)</div><div class="v">${esc(v.address)}</div></div>
<div class="row"><div class="l">Email for remittance</div><div class="v">${esc(v.email)}</div></div>
<div class="row"><div class="l">Part I Taxpayer Identification Number — Employer identification number</div><div class="v tin">${esc(v.ein)}</div></div>
<div class="row"><div class="l">Part II Certification</div><div class="v">Signature of U.S. person: /s/ Authorized signer &nbsp;&nbsp; Date: ${esc(v.date)}</div></div>
</div></body></html>`;
const vendors = [
  { file: 'W-9-Cedar-Ridge-Landscaping-LLC.pdf', name: 'Cedar Ridge Landscaping LLC', cls: 'Limited liability company (P)', address: '48 Orchard Lane, Columbus, OH 43215', email: 'ap.cedarridge@example.com', ein: '99-9999903', date: '2026-10-05' },
  { file: 'W-9-Bluewater-Freight-Inc.pdf', name: 'Bluewater Freight Inc', dba: 'Bluewater Freight', cls: 'C Corporation', address: '900 Dockside Avenue, Suite 210, Savannah, GA 31401', email: 'billing.bluewater@example.com', ein: '99-9999904', date: '2026-10-06' },
  // already set up in Dime for Widget Co: attach it as a third W-9 to show that the desk does not create a duplicate
  { file: 'W-9-Harbor-Supply-LLC.pdf', name: 'Harbor Supply LLC', cls: 'Limited liability company (C)', address: '120 Pier Road, Baltimore, MD 21230', email: 'ap@harborsupply.example', ein: '99-9999901', date: '2026-10-02' },
];
for (const v of vendors) { PDF.toPdfSync(w9(v), path.join(out, v.file)); console.log('wrote', v.file); }

// Old-system AP aging as of 2026-09-30. Against Dime's AP aging for Widget Co: Supply Co ties, Proserv Supply is off by 150.00,
// the two new vendors and Harbor Supply have balances Dime does not carry.
const inv = [
  ['Supply Co', 'SUPP-01', '2026-09-18', '2026-10-18', 10000],
  ['Proserv Supply', '1001', '2026-09-22', '2026-10-22', 2150],
  ['Cedar Ridge Landscaping LLC', 'CR-2207', '2026-08-20', '2026-09-19', 1400],
  ['Bluewater Freight Inc', 'BF-5512', '2026-09-12', '2026-10-12', 2750],
  ['Bluewater Freight Inc', 'BF-5391', '2026-07-28', '2026-08-27', 900],
  ['Harbor Supply LLC', 'HS-0931', '2026-09-25', '2026-10-25', 1250],
];
const asOf = new Date('2026-09-30T00:00:00Z'); const BUCKETS = ['Current', '1-30', '31-60', '61-90'];
const bucket = (due) => { const d = Math.round((asOf - new Date(`${due}T00:00:00Z`)) / 86400000); return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : 3; };
const by = {}; for (const [v, , , due, amt] of inv) { (by[v] = by[v] || [0, 0, 0, 0])[bucket(due)] += amt; }
const rows = Object.entries(by).map(([v, b]) => [v, ...b, b.reduce((s, x) => s + x, 0)]);
const total = ['Total', ...[0, 1, 2, 3, 4].map((i) => rows.reduce((s, r) => s + r[i + 1], 0))];
const money = ['text', 'money', 'money', 'money', 'money', 'money'];
fs.writeFileSync(path.join(out, 'old-system-ap-aging-2026-09-30.xlsx'), X.writeXlsx([
  { name: 'AP Aging 2026-09-30', header: ['Vendor', ...BUCKETS, 'Total'], rows: [...rows, total], formats: money },
  { name: 'Open bills', header: ['Vendor', 'Bill number', 'Bill date', 'Due date', 'Amount', 'Bucket'], rows: inv.map((r) => [...r, BUCKETS[bucket(r[3])]]), formats: ['text', 'text', 'text', 'text', 'money', 'text'] },
]));
console.log('wrote old-system-ap-aging-2026-09-30.xlsx', JSON.stringify([...rows, total]));
