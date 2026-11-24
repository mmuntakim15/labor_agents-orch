'use strict';
// The per-entity policy engine: decide() precedence, gates, preview, set, earned autonomy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox } = require('./helpers');
const tmp = sandbox('policy');
process.env.LAB_POLICY_DIR = path.join(tmp, 'policy');
const T = require('../src/request');
const PR = require('../src/proposals');
const POL = require('../src/policy');

const BIZ = 'biz-widget';
function withBiz(over = {}) { const r = T.createRequest({ title: 'p', body: 'b' }); Object.assign(r, { subject: { businessIds: [BIZ] }, ...over }); T.saveRequest(r); return r; }

test('load: defaults alone when no entity file; the entity file merges on top; the desk kill switch wins', () => {
  const p = POL.load('nobody');
  assert.equal(p.version, 0); assert.equal(p.writesEnabled, true); assert.deepEqual(p.kinds, {}); assert.ok(p.alwaysHuman.includes('period_lock')); assert.equal(p.earned.promoteAfter.approvals, 50);
  POL.set(BIZ, { writesEnabled: true, kinds: { accrual: { tier: 'A', maxAmount: 5000, requires: ['statedServicePeriod'], else: 'B' } } }, 'Mo');
  const e = POL.load(BIZ);
  assert.equal(e.version, 1); assert.equal(e.changedBy, 'Mo'); assert.equal(e.kinds.accrual.tier, 'A'); assert.equal(e.tierDefault, 'B');
  assert.ok(fs.existsSync(path.join(tmp, 'policy', `${BIZ}.json`)));
});

test('decide: the precedence table', () => {
  const pol = { ...POL.load(BIZ), version: 7, kinds: {
    vendor: { tier: 'A' }, recode_to_bill: { tier: 'A', when: 'exact' }, payment_application: { tier: 'A', when: 'exact', else: 'B' },
    accrual: { tier: 'A', maxAmount: 5000, requires: ['statedServicePeriod'], else: 'B' }, journal_entry: { tier: 'B' },
    transaction_bulk_import: { tier: 'A', when: 'mapped', else: 'C' }, transaction_bulk_categorization: { tier: 'A', when: 'rule', else: 'B' }, recon_finalize: { tier: 'human' },
  } };
  const d = (o) => POL.decide({ ...o, policy: pol });
  // 1. alwaysHuman beats everything, even an entity rule that says A
  for (const k of ['period_lock', 'period_reopen', 'recon_finalize', 'delete', 'closed_period', 'payment', 'email', 'master_identity']) { const x = d({ kind: k, facts: { exact: true } }); assert.equal(x.tier, 'human', k); assert.equal(x.autoApply, false); assert.equal(x.gate1, true); assert.equal(x.gate2, true); }
  assert.equal(POL.decide({ kind: 'vendor', policy: { ...pol, alwaysHuman: ['vendor'] } }).tier, 'human', 'an entity may add a kind to alwaysHuman');
  // 2. actor permission ceiling: tier B with the reason; owners and a missing actorContext are unrestricted
  let x = d({ kind: 'vendor', actorContext: { perms: ['bills_write'] } }); assert.equal(x.tier, 'B'); assert.equal(x.reason, 'actor lacks permission'); assert.equal(x.autoApply, false);
  assert.equal(d({ kind: 'vendor', actorContext: { perms: ['vendors_write'] } }).tier, 'A');
  assert.equal(d({ kind: 'vendor', actorContext: { perms: ['VENDORS_EDIT'] } }).tier, 'A', '*_EDIT spelling is accepted');
  assert.equal(d({ kind: 'vendor', actorContext: { perms: [], isOwner: true } }).tier, 'A');
  assert.equal(d({ kind: 'vendor', actorContext: null }).tier, 'A', 'no actorContext: Dime\'s legacy rule, unrestricted');
  assert.equal(d({ kind: 'payment', actorContext: { perms: ['*'] } }).tier, 'human', 'the ceiling never lifts alwaysHuman');
  // 3. entity rules against facts and amount
  assert.equal(d({ kind: 'vendor' }).tier, 'A');
  assert.equal(d({ kind: 'recode_to_bill', facts: { exact: true } }).tier, 'A');
  x = d({ kind: 'recode_to_bill', facts: {} }); assert.equal(x.tier, 'B', 'no else named: an A rule that fails falls to B'); assert.match(x.reason, /exact not established/);
  assert.equal(d({ kind: 'payment_application', facts: { exact: false } }).tier, 'B');
  assert.equal(d({ kind: 'accrual', amount: 4200, facts: { statedServicePeriod: true } }).tier, 'A');
  x = d({ kind: 'accrual', amount: 5200, facts: { statedServicePeriod: true } }); assert.equal(x.tier, 'B'); assert.match(x.reason, /over 5000/);
  x = d({ kind: 'accrual', amount: 4200, facts: {} }); assert.equal(x.tier, 'B'); assert.match(x.reason, /statedServicePeriod/);
  x = d({ kind: 'accrual', facts: { statedServicePeriod: true } }); assert.equal(x.tier, 'B'); assert.match(x.reason, /amount unknown/);
  assert.equal(d({ kind: 'transaction_bulk_import', facts: { mapped: true } }).tier, 'A');
  x = d({ kind: 'transaction_bulk_import', facts: {} }); assert.equal(x.tier, 'C'); assert.equal(x.gate2, true);
  assert.equal(d({ kind: 'transaction_bulk_categorization', facts: { rule: true } }).tier, 'A');
  assert.equal(d({ kind: 'transaction_bulk_categorization', facts: { rule: false } }).tier, 'B');
  assert.equal(d({ kind: 'journal_entry' }).tier, 'B', 'an entity file can hold a kind at B');
  assert.equal(POL.decide({ kind: 'recon_finalize', policy: { ...pol, alwaysHuman: [] } }).tier, 'human', 'an entity rule may itself say human');
  assert.equal(POL.decide({ kind: 'recon_finalize', policy: { ...pol, alwaysHuman: [], kinds: {} } }).tier, 'B', 'sanity: with neither, the desk default');
  // 4. recipe tierRules apply only when the entity file is silent on the kind
  const recipe = { id: 'R56', writes: [{ kind: 'bill', tierRules: [{ when: 'exact', tier: 'A' }, { when: 'else', tier: 'C' }] }, { kind: 'vendor', tierRules: [{ when: 'else', tier: 'C' }] }] };
  assert.equal(d({ kind: 'bill', recipe, facts: { exact: true } }).tier, 'A');
  assert.equal(d({ kind: 'bill', recipe, facts: {} }).tier, 'C');
  assert.equal(d({ kind: 'vendor', recipe }).tier, 'A', 'the entity rule for vendor beats the recipe');
  // 5. desk defaults from config/policy.json
  assert.equal(d({ kind: 'customer' }).tier, 'A'); assert.equal(d({ kind: 'invoice' }).tier, 'B'); assert.equal(d({ kind: 'never_heard_of' }).tier, 'B', 'tierDefault');
  x = d({ kind: 'customer' }); assert.equal(x.autoApply, true); assert.equal(x.gate1, false); assert.equal(x.gate2, false); assert.equal(x.policyVersion, 7);
  // writes disabled: tier unchanged, autoApply off, reason says so
  x = POL.decide({ kind: 'vendor', policy: { ...pol, writesEnabled: false } }); assert.equal(x.tier, 'A'); assert.equal(x.autoApply, false); assert.match(x.reason, /writes disabled/);
  assert.equal(POL.decide({ kind: null, policy: pol }).tier, 'C');
});

test('writeTiers and gatesFor', () => {
  const pol = { ...POL.load(BIZ), kinds: { vendor: { tier: 'A' }, accrual: { tier: 'B' } } };
  assert.deepEqual(POL.writeTiers([{ kind: 'vendor' }, 'vendor', { kind: 'accrual' }], { policy: pol }).map((t) => [t.kind, t.tier]), [['vendor', 'A'], ['accrual', 'B']]);
  const base = { size: 'S', recipeId: 'R56' };
  assert.deepEqual(POL.gatesFor(base, [], pol), { gate1: false, gate2: false, policyVersion: pol.version });
  assert.equal(POL.gatesFor({ ...base, size: 'L' }, [], pol).gate1, true);
  assert.equal(POL.gatesFor({ size: 'S', recipeId: null, recipeMatch: { id: 'R56', score: 0.61 } }, [], pol).gate1, true, 'low intake confidence');
  assert.equal(POL.gatesFor({ size: 'S', recipeId: null, recipeMatch: { id: 'R56', score: 0.9 } }, [], pol).gate1, false);
  assert.equal(POL.gatesFor({ ...base, inputsFromClient: true }, [], pol).gate1, true);
  assert.equal(POL.gatesFor({ ...base, inputsNeeded: [{ name: 'statement', source: 'document', fromClient: true }] }, [], pol).gate1, true);
  let g = POL.gatesFor(base, [{ tier: 'A', status: 'proposed' }], pol); assert.equal(g.gate1, false); assert.equal(g.gate2, false);
  g = POL.gatesFor(base, [{ tier: 'B', status: 'proposed' }], pol); assert.equal(g.gate1, true); assert.equal(g.gate2, true);
  g = POL.gatesFor(base, [{ tier: 'B', status: 'applied' }], pol); assert.equal(g.gate2, false, 'a decided proposal needs no gate');
  g = POL.gatesFor(base, [{ tier: 'B', status: 'proposed', policyDecision: { tier: 'A' } }], pol); assert.equal(g.gate2, false, 'the policy-decided tier is the effective one');
  assert.equal(POL.gatesFor(base, [{ tier: 'C', status: 'question' }], pol).gate2, true);
});

test('preview replays the window of proposals through the patched policy; set writes version, who and when', () => {
  const r = withBiz();
  PR.add(r.id, { kind: 'vendor', tier: 'A', summary: 'v', method: 'POST', path: '/x', body: {}, amount: 100 });
  PR.add(r.id, { kind: 'accrual', tier: 'B', summary: 'a', method: 'POST', path: '/x', body: {}, amount: 2400, facts: { statedServicePeriod: true } });
  PR.add(r.id, { kind: 'accrual', tier: 'B', summary: 'a2', method: 'POST', path: '/x', body: {}, amount: 9000, facts: { statedServicePeriod: true } });
  PR.add(r.id, { kind: null, tier: 'C', summary: 'q', question: 'q' });
  const old = PR.load(r.id); old.items[0].at = new Date(Date.now() - 40 * 864e5).toISOString(); PR.save(r.id, old);
  const other = T.createRequest({ title: 'other biz', body: '' }); other.subject = { businessIds: ['someone-else'] }; T.saveRequest(other);
  PR.add(other.id, { kind: 'vendor', tier: 'A', summary: 'v', method: 'POST', path: '/x', body: {}, amount: 5 });
  let pv = POL.preview(BIZ, {}); // current file: accrual A ≤ 5000 with service period
  assert.equal(pv.proposals, 2, 'the 40-day-old vendor and the question are outside the replay');
  assert.equal(pv.items, 1); assert.equal(pv.amount, 2400); assert.deepEqual(pv.byKind, { accrual: { items: 1, amount: 2400 } }); assert.equal(pv.changed, 0);
  pv = POL.preview(BIZ, { writesEnabled: false }); assert.equal(pv.items, 0); assert.equal(pv.changed, 1);
  pv = POL.preview(BIZ, { kinds: { accrual: { tier: 'A' } } }); assert.equal(pv.items, 2); assert.equal(pv.amount, 11400); assert.equal(pv.changed, 1);
  assert.throws(() => POL.set(BIZ, { writesEnabled: false }, ''), /--by/);
  const f = POL.set(BIZ, { writesEnabled: false }, 'Jake');
  assert.equal(f.version, 2); assert.equal(f.changedBy, 'Jake'); assert.ok(f.changedAt); assert.equal(f.kinds.accrual.tier, 'A', 'kinds kept');
  assert.equal(POL.load(BIZ).writesEnabled, false); assert.equal(POL.decide({ kind: 'vendor', businessId: BIZ }).autoApply, false);
  const v = POL.view(BIZ); assert.equal(v.version, 2); assert.equal(v.writesEnabled, false); assert.ok(Array.isArray(v.alwaysHuman));
  POL.set(BIZ, { writesEnabled: true }, 'Jake');
});

test('earned: promotions need the approvals and no rejection; demotions come from the reversal rate and are written at once', () => {
  const r = withBiz();
  const pol = POL.load(BIZ);
  POL.set(BIZ, { kinds: { ...pol.kinds, bill: { tier: 'B' } }, earned: { promoteAfter: { approvals: 3, rejections: 0, days: 30 }, demoteWhen: { reversalRate: 0.2, days: 30 } } }, 'Mo');
  for (let i = 0; i < 3; i += 1) { const { proposal } = PR.add(r.id, { kind: 'bill', tier: 'B', summary: `b${i}`, method: 'POST', path: '/x', body: {}, amount: 10 }); PR.decide(r.id, proposal.id, { status: 'approved', by: 'Mo' }); }
  for (let i = 0; i < 2; i += 1) { const { proposal } = PR.add(r.id, { kind: 'invoice', tier: 'B', summary: `i${i}`, method: 'POST', path: '/x', body: {}, amount: 10 }); PR.decide(r.id, proposal.id, { status: i ? 'rejected' : 'approved', by: 'Mo', note: 'n' }); }
  for (let i = 0; i < 4; i += 1) { const { proposal } = PR.add(r.id, { kind: 'vendor', tier: 'A', summary: `v${i}`, method: 'POST', path: '/x', body: {} }); PR.decideByPolicy(r.id, proposal.id, { version: 1, reason: 'tier A' }); PR.markApplied(r.id, proposal.id, { appliedRef: { id: `v${i}`, at: new Date().toISOString() } }); }
  PR.markReversed(r.id, 'P-6', { by: 'Mo', reason: 'wrong vendor' });
  const e = POL.earned(BIZ);
  assert.deepEqual(e.promotions.map((p) => p.kind), ['bill']); assert.equal(e.promotions[0].evidence.approvals, 3);
  assert.deepEqual(e.demotions.map((d) => d.kind), ['vendor']); assert.equal(e.demotions[0].evidence.reversalRate, 0.25);
  assert.equal(e.byKind.invoice.rejections, 1, 'one rejection keeps invoice off the promotion list');
  const before = POL.load(BIZ).version;
  const a = POL.applyEarned(BIZ);
  assert.equal(a.written, true); assert.equal(POL.load(BIZ).version, before + 1); assert.equal(POL.load(BIZ).changedBy, 'policy:earned');
  assert.equal(POL.decide({ kind: 'vendor', businessId: BIZ }).tier, 'B', 'vendor demoted for this entity');
  assert.equal(a.promotions[0].proposal.kind, 'policy_change'); assert.match(a.promotions[0].proposal.summary, /Promote bill/);
  assert.equal(POL.decide({ kind: 'bill', businessId: BIZ }).tier, 'B', 'a promotion is proposed, never written by code');
});
