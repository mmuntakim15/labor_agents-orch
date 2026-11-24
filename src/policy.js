'use strict';
// Per-entity autonomy policy (RD-2). One decide() computes the tier, the gates
// and whether the Applier may post a change without a person, from:
//   config/policy.json                 the desk-wide defaults (tierByKind, tierDefault, writesEnabled kill switch)
//   config/policy/<businessId>.json    the entity's file: kinds rules, alwaysHuman, earned thresholds, writesEnabled
// Precedence inside decide(): alwaysHuman → actor permission ceiling → entity kinds rule → recipe tierRules → defaults.
// writesEnabled=false (desk or entity) never changes a tier; it only turns autoApply off.
// Every function here is pure apart from reading and writing these files; humans (lab policy set, the `policy`
// command) and earned() are the only writers, and both are labelled on the file (changedBy).

const fs = require('fs');
const path = require('path');
const T = require('./request');
const PR = require('./proposals');

const ROOT = path.join(__dirname, '..');
const DEFAULTS_FILE = path.join(ROOT, 'config', 'policy.json');
const DIR = () => process.env.LAB_POLICY_DIR || path.join(ROOT, 'config', 'policy');
const TIERS = ['A', 'B', 'C', 'human'];
const ORDER = { A: 0, B: 1, C: 2, human: 3 };
const ALWAYS_HUMAN = ['period_lock', 'period_reopen', 'recon_finalize', 'delete', 'closed_period', 'payment', 'email', 'master_identity'];
const EARNED = { promoteAfter: { approvals: 50, rejections: 0, days: 30 }, demoteWhen: { reversalRate: 0.01, days: 30 } };
// The Dime role permission a proposal kind needs. An actorContext whose perms lack it caps the kind at tier B
// (a person with the permission confirms); no actorContext at all is Dime's legacy rule: unrestricted.
const PERMS = {
  vendor: 'vendors_write', customer: 'customers_write', product: 'products_write', chart_of_account: 'coa_write',
  journal_entry: 'journal_write', accrual: 'journal_write', bill: 'bills_write', recode_to_bill: 'bills_write', payment_application: 'bills_write',
  invoice: 'invoice_write', transaction_categorization: 'transactions_write', transaction_bulk_categorization: 'transactions_write', transaction_bulk_import: 'transactions_write',
  bank_account: 'accounts_write', budget: 'budgets_write', flux: 'flux_write', report_package: 'reports_write', bank_reconciliation: 'reconciliation_write', policy_change: 'owner',
};
const DAY_MS = 864e5;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function defaults() { return readJson(DEFAULTS_FILE) || { tierByKind: {}, tierDefault: 'B', writesEnabled: true }; }
function safeId(businessId) { const s = String(businessId || '').replace(/[^A-Za-z0-9_-]/g, ''); if (!s) throw new Error('businessId is required'); return s; }
function entityFile(businessId) { return path.join(DIR(), `${safeId(businessId)}.json`); }
function entity(businessId) { return (businessId && readJson(entityFile(businessId))) || null; }

/** The effective policy for one entity: desk defaults with the entity file on top. Never throws. */
function load(businessId) {
  const d = defaults(); const e = entity(businessId) || {};
  return {
    businessId: businessId ? String(businessId) : null,
    version: Number(e.version) || 0, changedBy: e.changedBy || null, changedAt: e.changedAt || null,
    // the kill switch wins: the desk's writesEnabled=false makes every entity read-only; an entity's false makes only that entity read-only
    writesEnabled: d.writesEnabled !== false && e.writesEnabled !== false,
    deskWritesEnabled: d.writesEnabled !== false,
    kinds: e.kinds && typeof e.kinds === 'object' ? e.kinds : {},
    alwaysHuman: Array.isArray(e.alwaysHuman) ? e.alwaysHuman : ALWAYS_HUMAN,
    earned: { promoteAfter: { ...EARNED.promoteAfter, ...((e.earned || {}).promoteAfter || {}) }, demoteWhen: { ...EARNED.demoteWhen, ...((e.earned || {}).demoteWhen || {}) } },
    tierByKind: d.tierByKind || {}, tierDefault: d.tierDefault || 'B',
  };
}

/** Pure: the desk-wide default tier for a kind. */
function defaultTier(policy, kind) {
  let base = policy.tierDefault || 'B';
  for (const [tier, kinds] of Object.entries(policy.tierByKind || {})) if ((kinds || []).includes(kind)) base = tier;
  return TIERS.includes(base) ? base : 'B';
}

/** Pure: does the rule's condition hold for these facts and this amount? */
function ruleHolds(rule, { amount, facts }) {
  const f = facts || {};
  if (rule.when && rule.when !== 'else') { if (f[rule.when] !== true) return { ok: false, why: `${rule.when} not established` }; }
  if (rule.maxAmount != null) { if (amount == null || !Number.isFinite(Number(amount))) return { ok: false, why: 'amount unknown' }; if (Math.abs(Number(amount)) > Number(rule.maxAmount)) return { ok: false, why: `amount over ${rule.maxAmount}` }; }
  for (const k of rule.requires || []) if (!f[k]) return { ok: false, why: `${k} not established` };
  return { ok: true, why: null };
}

/** Pure: a kind's rule from the entity file, or from the recipe's write (tierRules), applied to the facts. */
function ruleTier(rule, ctx, source) {
  if (!rule) return null;
  if (Array.isArray(rule)) { // recipe tierRules: [{ when, tier }, …, { when: 'else', tier }]
    for (const r of rule) { if (!r || !TIERS.includes(r.tier)) continue; if (r.when === 'else' || r.when == null) return { tier: r.tier, reason: `${source}: else → ${r.tier}` }; const h = ruleHolds(r, ctx); if (h.ok) return { tier: r.tier, reason: `${source}: ${r.when} → ${r.tier}` }; }
    return null;
  }
  const tier = TIERS.includes(rule.tier) ? rule.tier : null; if (!tier) return null;
  const h = ruleHolds(rule, ctx);
  if (h.ok) return { tier, reason: `${source}: ${[rule.when, rule.maxAmount != null ? `≤ ${rule.maxAmount}` : null, ...(rule.requires || [])].filter(Boolean).join(', ') || 'rule'} → ${tier}` };
  const fallback = TIERS.includes(rule.else) ? rule.else : (ORDER[tier] < ORDER.B ? 'B' : tier);
  return { tier: fallback, reason: `${source}: ${h.why} → ${fallback}` };
}

function hasPerm(actorContext, kind) {
  if (!actorContext || actorContext.isOwner === true || actorContext.unrestricted === true) return true;
  if (!Array.isArray(actorContext.perms)) return true; // nothing to check against: Dime's legacy rule
  const need = (PERMS[kind] || `${kind}_write`).toLowerCase();
  const alt = need.replace(/_write$/, '_edit');
  return actorContext.perms.some((p) => { const x = String(p).toLowerCase(); return x === need || x === alt || x === 'super_admin_access' || x === '*'; });
}

/**
 * The decision for one planned or proposed write.
 * → { tier: 'A'|'B'|'C'|'human', gate1, gate2, autoApply, reason, policyVersion }
 */
function decide({ kind, amount = null, facts = {}, recipe = null, businessId = null, actorContext = null, policy = null } = {}) {
  const pol = policy || load(businessId);
  const ctx = { amount, facts: facts || {} };
  let tier; let reason;
  if (!kind) { tier = 'C'; reason = 'no kind: a question for a person'; }
  else if ((pol.alwaysHuman || []).includes(kind)) { tier = 'human'; reason = `${kind} is always a person's decision`; }
  else if (!hasPerm(actorContext, kind)) { tier = 'B'; reason = 'actor lacks permission'; }
  else {
    const e = ruleTier(pol.kinds[kind], ctx, `entity policy v${pol.version}`);
    const rw = recipe && Array.isArray(recipe.writes) ? recipe.writes.find((w) => w && w.kind === kind) : null;
    const r = e || !rw ? null : ruleTier(rw.tierRules, ctx, `recipe ${recipe.id}`);
    const d = e || r || { tier: defaultTier(pol, kind), reason: `desk default for ${kind}` };
    tier = d.tier; reason = d.reason;
  }
  let autoApply = tier === 'A';
  if (autoApply && !pol.writesEnabled) { autoApply = false; reason = `${reason}; writes disabled`; }
  return { tier, gate1: tier !== 'A', gate2: tier !== 'A', autoApply, reason, policyVersion: pol.version };
}

/** Pure: the decision for every write kind a request plans (recipe.writes at intake, plan.writes at scope). */
function writeTiers(kinds, { policy, recipe = null, businessId = null, actorContext = null } = {}) {
  const seen = new Set(); const out = [];
  for (const k of kinds || []) { const kind = typeof k === 'string' ? k : k && k.kind; if (!kind || seen.has(kind)) continue; seen.add(kind); const d = decide({ kind, amount: k && k.amount != null ? k.amount : null, facts: (k && k.facts) || {}, recipe, businessId, actorContext, policy }); out.push({ kind, tier: d.tier, autoApply: d.autoApply, reason: d.reason }); }
  return out;
}

/** The tier a proposal carries after policy decided it (policyDecision) else the one it was staged with. */
function effectiveTier(p) { return (p && p.policyDecision && p.policyDecision.tier) || (p && p.tier) || null; }

/** Pure: which gates a request needs, from its triage, its inputs and its proposals. */
function gatesFor(request, proposals = [], policy = null) {
  const pol = policy || load(businessOf(request));
  const items = Array.isArray(proposals) ? proposals : (proposals && proposals.items) || [];
  const pending = items.filter((p) => ['proposed', 'question'].includes(p.status));
  const lowConfidence = Boolean(request.recipeMatch) && !request.recipeId && Number(request.recipeMatch.score || 0) < 0.8;
  const fromClient = Boolean(request.inputsFromClient) || (request.inputsNeeded || []).some((i) => i && i.source === 'document' && i.fromClient);
  const gate1 = lowConfidence || request.size === 'L' || fromClient || pending.some((p) => ['B', 'C', 'human'].includes(effectiveTier(p)));
  const gate2 = pending.some((p) => ['B', 'C', 'human'].includes(effectiveTier(p)));
  return { gate1, gate2, policyVersion: pol.version };
}

function businessOf(req) { return (req && req.client && req.client.businessId) || (req && req.subject && (req.subject.businessIds || [])[0]) || null; }
function requestsOf(businessId) { const b = String(businessId); return T.listRequests().filter((r) => businessOf(r) === b || ((r.subject || {}).businessIds || []).map(String).includes(b)); }
function within(at, days, now) { const t = Date.parse(at || ''); return Number.isFinite(t) && now - t <= days * DAY_MS; }

/** Pure merge of a policy patch onto an entity file's content. */
function merged(cur, patch) {
  const out = { ...(cur || {}) };
  if (patch.writesEnabled !== undefined) out.writesEnabled = Boolean(patch.writesEnabled);
  if (patch.kinds && typeof patch.kinds === 'object') out.kinds = { ...(cur && cur.kinds || {}), ...patch.kinds };
  if (Array.isArray(patch.alwaysHuman)) out.alwaysHuman = patch.alwaysHuman;
  if (patch.earned && typeof patch.earned === 'object') out.earned = { ...(cur && cur.earned || {}), ...patch.earned };
  return out;
}

/** What a policy patch would change: the last `days` of this entity's proposals replayed through decide(). */
function preview(businessId, patch = {}, { days = 30, now = Date.now() } = {}) {
  const current = load(businessId);
  const cur = entity(businessId) || {};
  const next = merged(cur, patch);
  const patched = { ...current, writesEnabled: current.deskWritesEnabled && next.writesEnabled !== false, kinds: next.kinds || {}, alwaysHuman: Array.isArray(next.alwaysHuman) ? next.alwaysHuman : current.alwaysHuman };
  const out = { days, items: 0, amount: 0, byKind: {}, changed: 0, proposals: 0 };
  for (const r of requestsOf(businessId)) for (const p of PR.load(r.id).items) {
    if (!within(p.at, days, now) || p.tier === 'C' || !p.kind) continue;
    out.proposals += 1;
    const amt = Math.abs(Number(p.amountApproved ?? p.amount ?? 0)) || 0;
    const was = decide({ kind: p.kind, amount: amt, facts: p.facts || {}, policy: current }).autoApply;
    const will = decide({ kind: p.kind, amount: amt, facts: p.facts || {}, policy: patched }).autoApply;
    if (will) { out.items += 1; out.amount = Math.round((out.amount + amt) * 100) / 100; const k = (out.byKind[p.kind] = out.byKind[p.kind] || { items: 0, amount: 0 }); k.items += 1; k.amount = Math.round((k.amount + amt) * 100) / 100; }
    if (was !== will) out.changed += 1;
  }
  return out;
}

/** Write the entity file: version+1, who and when. The only writer besides applyEarned(). */
function set(businessId, patch = {}, by) {
  if (!by || !String(by).trim()) throw new Error('--by <name> is required: the policy file records who changed it');
  const cur = entity(businessId) || {};
  const next = merged(cur, patch);
  next.version = (Number(cur.version) || 0) + 1; next.changedBy = String(by).trim(); next.changedAt = new Date().toISOString();
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(entityFile(businessId), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** The entity's policy in the shape the API mirrors (POST /internal/request-desk/policy/:businessId). */
function view(businessId) {
  const p = load(businessId);
  return { version: p.version, writesEnabled: p.writesEnabled, changedBy: p.changedBy, changedAt: p.changedAt, kinds: p.kinds, alwaysHuman: p.alwaysHuman };
}

/**
 * Earned autonomy over the window: a tier-B kind with enough approvals and no rejection is a promotion candidate
 * (returned, never written: a policy_change proposal for a person); a tier-A kind reversed too often is demoted.
 */
function earned(businessId, { days = null, now = Date.now() } = {}) {
  const pol = load(businessId);
  const pa = pol.earned.promoteAfter; const dw = pol.earned.demoteWhen;
  const byKind = {};
  for (const r of requestsOf(businessId)) for (const p of PR.load(r.id).items) {
    if (!p.kind || p.tier === 'C') continue;
    const k = (byKind[p.kind] = byKind[p.kind] || { approvals: 0, rejections: 0, autoApplied: 0, reversed: 0 });
    const policyMade = /^policy@/.test(String(p.reviewedBy || ''));
    const win = (d) => within(p.reviewedAt || p.at, d, now);
    if (!policyMade && ['approved', 'applied', 'reversed'].includes(p.status) && win(days || pa.days)) k.approvals += 1;
    if (!policyMade && p.status === 'rejected' && win(days || pa.days)) k.rejections += 1;
    if (policyMade && ['applied', 'reversed'].includes(p.status) && within(p.appliedAt || p.reviewedAt || p.at, days || dw.days, now)) { k.autoApplied += 1; if (p.status === 'reversed') k.reversed += 1; }
  }
  const promotions = []; const demotions = [];
  for (const [kind, k] of Object.entries(byKind)) {
    const tier = decide({ kind, policy: pol }).tier;
    if (tier === 'B' && k.approvals >= pa.approvals && k.rejections <= pa.rejections) promotions.push({ kind, from: 'B', to: 'A', evidence: { approvals: k.approvals, rejections: k.rejections, days: days || pa.days } });
    if (tier === 'A' && k.autoApplied > 0) { const rate = k.reversed / k.autoApplied; if (rate > dw.reversalRate) demotions.push({ kind, from: 'A', to: 'B', evidence: { autoApplied: k.autoApplied, reversed: k.reversed, reversalRate: Math.round(rate * 1000) / 1000, threshold: dw.reversalRate, days: days || dw.days } }); }
  }
  return { businessId: String(businessId), policyVersion: pol.version, promotions, demotions, byKind };
}

/** Demotions are written at once (labelled policy:earned); promotions come back for a policy_change proposal. */
function applyEarned(businessId, opts = {}) {
  const e = earned(businessId, opts);
  if (e.demotions.length) {
    const kinds = {}; const cur = load(businessId);
    for (const d of e.demotions) kinds[d.kind] = { ...(cur.kinds[d.kind] || {}), tier: 'B', demotedAt: new Date().toISOString(), demotedFor: d.evidence };
    set(businessId, { kinds }, 'policy:earned');
  }
  return { ...e, promotions: e.promotions.map((p) => ({ kind: p.kind, evidence: p.evidence, proposal: { kind: 'policy_change', tier: 'B', summary: `Promote ${p.kind} to tier A for this entity: ${p.evidence.approvals} approvals and ${p.evidence.rejections} rejections in ${p.evidence.days} days` } })), written: e.demotions.length > 0 };
}

module.exports = { DIR, TIERS, ORDER, ALWAYS_HUMAN, PERMS, defaults, entity, entityFile, load, defaultTier, ruleHolds, decide, writeTiers, effectiveTier, gatesFor, businessOf, requestsOf, preview, set, view, earned, applyEarned, merged };
