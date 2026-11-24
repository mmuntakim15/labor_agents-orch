'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, jf, twice } = require('./_h');
const V = require('../../src/compute/staleness');

const ASOF = '2026-11-23T18:00:00Z'; // a Monday

test('staleness: Dime connections payload — stale vs healthy vs unavailable vs not connected, business hours', () => {
  assert.equal(new Date(ASOF).getUTCDay(), 1, 'fixture sanity: asOf is a Monday');
  const r = twice(V, { files: [fixture('connections.json')], args: { asOf: ASOF } });
  assert.equal(r.dataAvailable, true); assert.equal(r.businessDaysOnly, true);
  assert.deepEqual(r.healthy.map((h) => [h.provider, h.hoursSince]), [['Plaid', 12]]);
  assert.deepEqual(r.stale.map((s) => [s.provider, s.hoursSince, s.expectedHours, s.severity]), [['Ramp', 24, 24, 'warn'], ['Stripe', 96, 24, 'critical']]);
  assert.match(r.stale[0].why, /status "Sync Error"/, 'Ramp is within the window by hours but its status says error');
  assert.match(r.stale[1].why, /96h since last sync \(expected ≤ 24h, business hours\)/);
  assert.deepEqual(r.unavailable, [
    { provider: 'QuickBooks Online', why: 'connected but no last-sync timestamp (and no processed sync events)' },
    { provider: 'Square', why: 'status lookup failed: timeout talking to Square' },
  ]);
  assert.deepEqual(r.notConnected, ['HubSpot']);
});

test('staleness: wall-clock hours, per-provider expected windows, numeric expectedHours', () => {
  const wall = twice(V, { files: [fixture('connections.json')], args: { asOf: ASOF, businessDaysOnly: false } });
  assert.deepEqual(wall.stale.map((s) => [s.provider, s.hoursSince]), [['Ramp', 72], ['Stripe', 144]]);
  assert.equal(wall.stale[0].severity, 'critical', '72h > 2×24h');
  const lax = twice(V, { files: [fixture('connections.json')], args: { asOf: ASOF, expectedHours: { Stripe: 200, Ramp: 100 } } });
  assert.deepEqual(lax.healthy.map((h) => h.provider), ['Plaid', 'Stripe']);
  assert.deepEqual(lax.stale.map((s) => s.provider), ['Ramp'], 'Sync Error status keeps Ramp stale whatever the window');
  const num = twice(V, { files: [fixture('connections.json')], args: { asOf: ASOF, expectedHours: 8 } });
  assert.deepEqual(num.stale.map((s) => [s.provider, s.severity]), [['Plaid', 'warn'], ['Ramp', 'critical'], ['Stripe', 'critical']]);
});

test('staleness: Plaid sync events move the last-sync forward and count failures; events after asOf are ignored', () => {
  const r = twice(V, { files: [fixture('connections.json'), fixture('plaid_events.json')], args: { asOf: ASOF } });
  const plaid = r.healthy.find((h) => h.provider === 'Plaid');
  assert.equal(plaid.lastSyncedAt, '2026-11-23T10:00:00.000Z', 'the processed event at 10:00 beats last_synced_at 06:00; the 24th is after asOf');
  assert.equal(plaid.hoursSince, 8); assert.equal(plaid.failedEventsSinceSync, 1);
  assert.equal(r.eventsConsidered, 2);
  const generic = twice(V, { files: [jf('c.json', [{ provider: 'Xero', connected: true, status: 'Connected' }]), jf('e.json', [{ provider: 'Xero', status: 'processed', at: '2026-11-23T17:00:00Z' }])], args: { asOf: ASOF } });
  assert.deepEqual(generic.healthy.map((h) => [h.provider, h.hoursSince]), [['Xero', 1]]);
  assert.deepEqual(generic.unavailable, []);
});

test('staleness: distinguishes "no data" from "no exceptions"; refuses without asOf', () => {
  const empty = twice(V, { files: [jf('c.json', { success: true, data: [] })], args: { asOf: ASOF } });
  assert.equal(empty.dataAvailable, false); assert.equal(empty.unavailable[0].provider, '*'); assert.deepEqual(empty.stale, []);
  const quiet = twice(V, { files: [jf('c.json', [{ provider: 'Plaid', connected: true, last_synced_at: '2026-11-23T17:30:00Z' }])], args: { asOf: ASOF } });
  assert.equal(quiet.dataAvailable, true); assert.deepEqual(quiet.stale, []); assert.deepEqual(quiet.unavailable, []); assert.equal(quiet.healthy.length, 1);
  assert.throws(() => V.run({ files: [fixture('connections.json')], args: {} }), /args\.asOf is required/);
  assert.throws(() => V.run({ files: [fixture('connections.json')], args: { asOf: 'now' } }), /not a date-time/);
});
