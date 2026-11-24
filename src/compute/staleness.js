'use strict';
// staleness — which integrations have not synced within their expected window
// at args.asOf, separating "stale" from "we cannot tell" (no timestamp, error).
// Pure: the clock is args.asOf, never Date.now().
const F = require('./_fields');

const HOUR = 36e5;
function parseISO(v) { if (v == null || v === '') return null; const t = typeof v === 'number' ? v : Date.parse(String(v)); return Number.isNaN(t) ? null : t; }
/** Hours between two instants counting only Monday–Friday (UTC). */
function businessHours(fromMs, toMs) {
  if (toMs <= fromMs) return 0;
  let total = 0; let t = fromMs;
  while (t < toMs) {
    const d = new Date(t); const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const end = Math.min(nextMidnight, toMs); const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) total += (end - t) / HOUR;
    t = end;
  }
  return total;
}
const providerKey = (s) => F.normKey(s).replace(/online$/, '').replace(/^quickbook/, 'qbo');

module.exports = {
  name: 'staleness',
  describe: 'Integration sync staleness at asOf: hours since each connected provider last synced (optionally counting business hours only) against an expected window per provider; separates stale, healthy, not-connected and "unavailable" (connected but no timestamp, or an error) so silence is never read as health.',
  inputs: [
    { name: 'connections', shape: "Dime connections status {success, data:[{name, type, status, details:{connected, status, last_synced_at, institutions?, error?}}]} or an array of {provider|name, connected, status, last_synced_at|lastSyncedAt|last_sync_at, details?}." },
    { name: 'syncEvents', shape: "optional: Dime Plaid event-logs {logs|data|events:[{event_type, status, source, createdAt|at, plaid_item_id, error?}]} or an array of {provider?, status, at|createdAt|timestamp}. A 'processed' event newer than the provider's last_synced_at moves the sync time forward (provider defaults to Plaid); 'failed' events after the last sync are reported.", optional: true },
  ],
  args: { asOf: '(required) ISO date-time, e.g. 2026-11-23T18:00:00Z', expectedHours: { default: 24, Plaid: 24, Ramp: 24, Stripe: 24, 'QuickBooks Online': 24, HubSpot: 24, Square: 24, Salesforce: 24 }, businessDaysOnly: true },
  output: "{ stale:[{provider, lastSyncedAt, hoursSince, expectedHours, severity:'warn'|'critical', failedEventsSinceSync}], unavailable:[{provider, why}], healthy:[{provider, lastSyncedAt, hoursSince, expectedHours}], notConnected:[provider], dataAvailable, asOf }",
  run({ files, args = {} }) {
    const asOfRaw = F.requireArg(args, 'asOf', 'an ISO date-time; no wall clock is read');
    const asOf = parseISO(asOfRaw); if (asOf == null) throw new Error(`args.asOf is not a date-time: ${JSON.stringify(asOfRaw)}`);
    const exp = typeof args.expectedHours === 'number' ? { default: args.expectedHours } : { default: 24, ...(args.expectedHours || {}) };
    const expByKey = new Map(Object.keys(exp).map((k) => [providerKey(k), Number(exp[k])]));
    const expectedFor = (name) => { const v = expByKey.get(providerKey(name)); return Number.isFinite(v) && v > 0 ? v : Number(exp.default) || 24; };
    const bizOnly = args.businessDaysOnly !== false;
    const conns = F.rowsFrom(files[0]);
    if (!conns.length) return { asOf: new Date(asOf).toISOString(), dataAvailable: false, stale: [], healthy: [], notConnected: [], unavailable: [{ provider: '*', why: 'connections payload is empty or unreadable: cannot assess sync health' }], businessDaysOnly: bizOnly };
    // sync events: latest processed per provider, failed after last sync
    const events = files[1] ? F.rowsFrom(files[1]) : [];
    const evs = events.map((e) => ({ provider: F.str(e.provider || e.source_provider || e.integration || 'Plaid'), status: F.str(e.status).toLowerCase(), at: parseISO(F.pick(e, ['at', 'createdAt', 'created_at', 'timestamp', 'time', 'updatedAt'])), type: F.str(e.event_type || e.type) })).filter((e) => e.at != null && e.at <= asOf);
    const stale = []; const healthy = []; const notConnected = []; const unavailable = [];
    for (const c of conns.slice().sort(F.by((x) => F.str(x.name || x.provider)))) {
      const provider = F.str(c.name || c.provider || c.integration); if (!provider) continue;
      const d = c.details && typeof c.details === 'object' ? c.details : {};
      if (d.error || (c.error && !d.connected)) { unavailable.push({ provider, why: `status lookup failed: ${d.error || c.error}` }); continue; }
      const connected = d.connected != null ? Boolean(d.connected) : c.connected != null ? Boolean(c.connected) : /connected|sync error/i.test(F.str(c.status));
      if (!connected) { notConnected.push(provider); continue; }
      let last = parseISO(F.pick(d, ['last_synced_at', 'lastSyncedAt', 'last_sync_at'])) ?? parseISO(F.pick(c, ['last_synced_at', 'lastSyncedAt', 'last_sync_at']));
      const mine = evs.filter((e) => providerKey(e.provider) === providerKey(provider));
      const processed = mine.filter((e) => e.status === 'processed').map((e) => e.at); if (processed.length) { const m = Math.max(...processed); if (last == null || m > last) last = m; }
      if (last == null) { unavailable.push({ provider, why: 'connected but no last-sync timestamp (and no processed sync events)' }); continue; }
      if (last > asOf) { unavailable.push({ provider, why: `last sync ${new Date(last).toISOString()} is after asOf` }); continue; }
      const hours = Math.round((bizOnly ? businessHours(last, asOf) : (asOf - last) / HOUR) * 10) / 10;
      const expected = expectedFor(provider);
      const failed = mine.filter((e) => e.status === 'failed' && e.at > last).length;
      const row = { provider, lastSyncedAt: new Date(last).toISOString(), hoursSince: hours, expectedHours: expected, status: F.str(d.status || c.status) || null };
      if (hours > expected || /sync error|error|failed/i.test(row.status || '')) stale.push({ ...row, severity: hours > 2 * expected ? 'critical' : 'warn', failedEventsSinceSync: failed, why: hours > expected ? `${hours}h since last sync (expected ≤ ${expected}h${bizOnly ? ', business hours' : ''})` : `status "${row.status}"` });
      else healthy.push({ ...row, failedEventsSinceSync: failed });
    }
    return { asOf: new Date(asOf).toISOString(), dataAvailable: true, stale, unavailable, healthy, notConnected, businessDaysOnly: bizOnly, eventsConsidered: evs.length };
  },
};
