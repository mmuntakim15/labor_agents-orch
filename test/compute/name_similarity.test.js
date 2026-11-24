'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jf, twice, orderInvariant, CM } = require('./_h');
const V = CM.get('name_similarity');
const I = V._internals;

const VENDORS = [
  { id: 'V1', name: 'Acme Supply, LLC', tin: '12-3456789', email: 'ap@acmesupply.com' },
  { id: 'V2', name: 'ACME Supply Inc', taxId: '123456789', email: 'billing@acmesupply.com' },
  { id: 'V3', name: 'Acme Supply Co.', tin: '98-7654321', email: '' },
  { id: 'V4', name: 'Johnson & Johnson', email: 'x@gmail.com' },
  { id: 'V5', name: 'The Johnson and Johnson Inc.', email: 'y@gmail.com' },
  { id: 'V6', name: 'Beta Widgets', address: '12 Main Street, Suite 4' },
  { id: 'V7', name: 'Beta Widget', address: '12 Main St Ste 4' },
  { id: 'V8', name: 'Zeta Consulting' },
];

test('name_similarity: normalisation drops suffixes, punctuation, "&" and leading "The"', () => {
  assert.equal(I.normaliseName('Acme Supply, LLC'), 'acme supply');
  assert.equal(I.normaliseName('The Johnson & Johnson Inc.'), 'johnson and johnson');
  assert.equal(I.normaliseName("O'Brien Co. Ltd"), 'obrien');
  assert.equal(I.jaroWinkler('martha', 'marhta').toFixed(4), '0.9611');
  assert.equal(I.jaccard('a b c', 'b c d'), 0.5);
});

test('name_similarity: same TIN is conclusive, different TIN excludes, free-mail domains do not count, address supports', () => {
  const r = twice(V, { files: [jf('vendors.json', VENDORS)] });
  orderInvariant(V, { files: [jf('vendors.json', VENDORS)] });
  assert.equal(r.scanned, 8); assert.equal(r.comparisons, 28);
  assert.equal(r.excludedDifferentTin, 2, 'V3 vs V1 and V3 vs V2 (same name, different TIN)');
  assert.deepEqual(r.pairs.map((p) => [p.a.id, p.b.id, p.score, p.suggested]), [['V1', 'V2', 1, 'merge candidate'], ['V4', 'V5', 1, 'merge candidate'], ['V6', 'V7', 0.99, 'merge candidate']]);
  assert.deepEqual(r.pairs[0].why, ['same TIN', 'name 1.00', 'same email domain']);
  assert.deepEqual(r.pairs[1].why, ['name 1.00'], 'gmail is not evidence');
  assert.deepEqual(r.pairs[2].why, ['name 0.99', 'same address']);
});

test('name_similarity: requireSameTinIfPresent=false lets a same-name different-TIN pair through as review-worthy; threshold filters', () => {
  const r = twice(V, { files: [jf('vendors.json', VENDORS)], args: { requireSameTinIfPresent: false } });
  const v13 = r.pairs.find((p) => p.a.id === 'V1' && p.b.id === 'V3');
  assert.ok(v13); assert.deepEqual(v13.why, ['name 1.00']); assert.equal(v13.score, 1); assert.equal(r.excludedDifferentTin, 0);
  const strict = twice(V, { files: [jf('vendors.json', VENDORS)], args: { threshold: 0.995 } });
  assert.deepEqual(strict.pairs.map((p) => [p.a.id, p.b.id]), [['V1', 'V2'], ['V4', 'V5']], 'Beta Widget(s) at 0.99 drops out');
});

test('name_similarity: edge — rows without a name are skipped; a single record yields no pairs', () => {
  const r = twice(V, { files: [jf('one.json', [{ id: 'A', name: 'Solo LLC' }, { id: 'B', name: '' }])] });
  assert.deepEqual(r, { pairs: [], pairCount: 0, scanned: 1, comparisons: 0, excludedDifferentTin: 0, threshold: 0.85 });
});
