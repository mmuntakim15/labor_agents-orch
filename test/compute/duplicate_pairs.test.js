'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, twice, orderInvariant } = require('./_h');
const V = require('../../src/compute/duplicate_pairs');
const F = require('../../src/compute/_fields');

const pairKey = (p) => `${p.a.id}+${p.b.id}`;

test('duplicate_pairs: bills + bank csv, default args — same normalised vendor, same amount, within 30 days', () => {
  const files = [fixture('bills.json'), fixture('bank.csv')];
  const r = twice(V, { files, args: {} });
  assert.equal(r.scanned, 9, '6 bills (one without an amount is unparsed) + 4 bank rows');
  assert.equal(r.unparsed, 1); assert.equal(r.excluded, 0);
  assert.deepEqual(r.pairs.map(pairKey), ['B1+T1', 'B1+B2', 'T1+B2', 'T2+B4', 'B5+T3'], 'a is the earlier item; on the same day the lower source name then id goes first');
  const first = r.pairs[0];
  assert.equal(first.a.source, 'bills.json'); assert.equal(first.b.source, 'bank.csv');
  assert.equal(first.daysApart, 2); assert.equal(first.amountDiff, 0); assert.equal(first.b.amount, 1200, 'bank outflow sign is ignored');
  assert.match(first.why, /same vendor "acme supply"; same amount 1200.00; 2 days apart; bills.json vs bank.csv/);
  assert.equal(r.pairs.find((p) => pairKey(p) === 'B5+T3').a.amount, 49.99, '"($49.99)" parses as 49.99');
  assert.ok(!r.pairs.some((p) => p.a.id === 'B3' || p.b.id === 'B3'), 'B3 is 57+ days away');
  orderInvariant(V, { files, args: {} });
});

test('duplicate_pairs: tolerance (absolute and percent), minAmount, excludeVendors', () => {
  const files = [fixture('bills.json'), fixture('bank.csv')];
  const abs = twice(V, { files, args: { tolerance: 5 } });
  assert.deepEqual(abs.pairs.map(pairKey).filter((k) => k.includes('T4')).sort(), ['B4+T4', 'T2+T4']);
  assert.equal(abs.pairs.find((p) => pairKey(p) === 'B4+T4').amountDiff, 5);
  const pct = twice(V, { files, args: { tolerancePct: 1 } });
  assert.equal(pct.pairs.length, 7, '1% of 505 = 5.05 covers the 5.00 gap');
  const tight = twice(V, { files, args: { tolerancePct: 0.5 } });
  assert.equal(tight.pairs.length, 5, '0.5% of 505 = 2.53 does not');
  const min = twice(V, { files, args: { minAmount: 100 } });
  assert.equal(min.excluded, 2); assert.equal(min.pairs.length, 4);
  const ex = twice(V, { files, args: { excludeVendors: ['Acme Supply, Inc.'] } });
  assert.equal(ex.excluded, 4, 'B1 B2 B3 T1 all normalise to acme supply'); assert.equal(ex.pairs.length, 2);
  assert.deepEqual(ex.args.excludeVendors, ['acme supply']);
});

test('duplicate_pairs: vendor normalisation drops case, punctuation, legal suffixes and a leading "the"', () => {
  assert.equal(F.normVendor('ACME SUPPLY, INC.'), 'acme supply');
  assert.equal(F.normVendor('Acme Supply LLC'), 'acme supply');
  assert.equal(F.normVendor('The Home Depot'), 'home depot');
  assert.equal(F.normVendor('Smith & Co.'), 'smith and');
  assert.equal(F.normVendor('LLC'), 'llc', 'a lone suffix is kept rather than erased');
});

test('duplicate_pairs: edge — same id within one source is never paired, same id across sources is; bad args refused', () => {
  const same = twice(V, { files: [jf('a.json', [{ id: 'X', vendor: 'Foo', date: '2026-01-01', amount: 10 }, { id: 'X', vendor: 'Foo', date: '2026-01-02', amount: 10 }])], args: {} });
  assert.equal(same.pairs.length, 0);
  const cross = twice(V, { files: [jf('a.json', [{ id: 'X', vendor: 'Foo', date: '2026-01-01', amount: 10 }]), jf('b.json', [{ id: 'X', vendor: 'foo inc', date: '2026-01-02', amount: 10 }])], args: {} });
  assert.equal(cross.pairs.length, 1); assert.equal(cross.pairs[0].a.source, 'a.json');
  const empty = twice(V, { files: [jf('e.json', { rows: [] })], args: {} });
  assert.deepEqual(empty, { ...empty, pairs: [], scanned: 0 });
  assert.throws(() => V.run({ files: [jf('a.json', [])], args: { days: -1 } }), /non-negative/);
});
