'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { csv, twice, CM } = require('./_h');
const V = CM.get('remittance_parse');
const txt = (name, text) => ({ name, path: `/inline/${name}`, sha: 'inline', text });

const EMAIL = [
  'From: Acme Dental Group',
  'Remittance advice for check #4471 dated 2026-03-05',
  '',
  'INV-1001  $1,250.00',
  'INV 1002        300.50',
  'Credit memo CM-55 (45.00)',
  'INV-1003 and INV-1004: 100.00 200.00',
  'Total paid: $1,805.50',
].join('\n');

test('remittance_parse: pairs with cited lines, stated total, unparsed amount lines, payer', () => {
  const r = twice(V, { files: [txt('remit.txt', EMAIL)] });
  assert.deepEqual(r.pairs, [
    { invoice: 'INV-1001', amount: 1250, line: 'INV-1001  $1,250.00', lineNo: 4 },
    { invoice: 'INV-1002', amount: 300.5, line: 'INV 1002        300.50', lineNo: 5 },
    { invoice: 'INV-1003', amount: 100, line: 'INV-1003 and INV-1004: 100.00 200.00', lineNo: 7 },
    { invoice: 'INV-1004', amount: 200, line: 'INV-1003 and INV-1004: 100.00 200.00', lineNo: 7 },
  ]);
  assert.equal(r.total, 1850.5); assert.equal(r.statedTotal, 1805.5); assert.equal(r.totalMatchesStated, false);
  assert.deepEqual(r.unparsed, [{ line: 'Credit memo CM-55 (45.00)', lineNo: 6, amounts: [-45] }]);
  assert.equal(r.payer, 'Acme Dental Group'); assert.equal(r.currency, 'USD'); assert.equal(r.lineCount, 8);
  assert.deepEqual(r.duplicateInvoices, []); assert.deepEqual(r.invoicesWithoutAmount, []);
});

test('remittance_parse: CSV rows, custom invoice pattern, duplicate invoice flagged, invoice without amount', () => {
  const f = csv('remit.csv', 'Reference,Paid\nSO-778,"99.99"\nSO-778,"0.01"\nSO-779,see attached\nsubtotal,100.00');
  const r = twice(V, { files: [f], args: { invoicePattern: 'SO-\\d+', currency: 'EUR' } });
  assert.deepEqual(r.pairs.map((p) => [p.invoice, p.amount, p.lineNo]), [['SO-778', 99.99, 2], ['SO-778', 0.01, 3]]);
  assert.equal(r.total, 100); assert.deepEqual(r.duplicateInvoices, ['SO-778']);
  assert.deepEqual(r.invoicesWithoutAmount, [{ invoice: 'SO-779', line: 'SO-779 | see attached', lineNo: 4, amounts: [] }]);
  assert.equal(r.statedTotal, 100); assert.equal(r.totalMatchesStated, true); assert.equal(r.currency, 'EUR');
});

test('remittance_parse: edge — json { text } input; bare integers and dates are never read as money', () => {
  const r = twice(V, { files: [{ name: 'body.json', path: '/inline/body.json', sha: 'x', json: { text: 'Payment of 1200 on 2026-03-05 for INV-5000 total 1200.00\nRef 889900' } }] });
  assert.deepEqual(r.pairs, [{ invoice: 'INV-5000', amount: 1200, line: 'Payment of 1200 on 2026-03-05 for INV-5000 total 1200.00', lineNo: 1 }]);
  assert.deepEqual(r.unparsed, []); assert.equal(r.payer, null);
});
