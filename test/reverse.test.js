'use strict';
// Reversal: the inverse call per kind against the fake Dime, the refusals, the 30-day window, the knowledge note.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sandbox, fakeDime, writeTestMap } = require('./helpers');
sandbox('reverse');
const T = require('../src/request');
const PR = require('../src/proposals');
const R = require('../src/receipts');
const RV = require('../src/reverse');
const M = require('../src/map');

let api; let restoreMap;
test.before(async () => { api = await fakeDime(); restoreMap = writeTestMap().restore; });
test.after(async () => { restoreMap(); await api.close(); });

const BIZ = 'b1';
function applied(kind, over = {}) {
  const r = T.createRequest({ title: `rev ${kind}`, body: '', reporter: 'Mo', backend: 't' }); r.status = 'done'; r.subject = { businessIds: [BIZ] }; r.client = { businessId: BIZ, businessName: 'Acme Dental' }; r.recipeId = 'R56'; T.saveRequest(r);
  const { proposal } = PR.add(r.id, { kind, tier: 'A', summary: `${kind} change`, method: 'POST', path: `/api/v1/accountant/${kind}`, body: {}, ...over });
  PR.decideByPolicy(r.id, proposal.id, { version: 1, reason: 'tier A' });
  PR.markApplied(r.id, proposal.id, { appliedRef: { id: over.refId || 'ref-1', route: 'x', status: 201, at: over.appliedAt || new Date().toISOString(), by: 'policy@v1' } });
  return { r, pid: proposal.id };
}

test('reversible: applied within 30 days only', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  assert.equal(RV.reversible(null).ok, false);
  assert.equal(RV.reversible({ id: 'P-1', status: 'proposed' }, { now }).why, 'P-1 is proposed, not applied');
  assert.equal(RV.reversible({ id: 'P-1', status: 'applied', appliedRef: { at: '2026-11-01T00:00:00Z' } }, { now }).ok, true);
  assert.match(RV.reversible({ id: 'P-1', status: 'applied', appliedRef: { at: '2026-10-01T00:00:00Z' } }, { now }).why, /30-day reversal window has passed/);
  assert.match(RV.reversible({ id: 'P-1', status: 'reversed', reversedBy: 'Mo', reversedAt: '2026-11-20T00:00:00Z' }, { now }).why, /already reversed by Mo/);
  assert.equal(RV.memoFor('Mo', 'wrong month', 'REQ-4', 'P-2'), 'Reversed by Mo · wrong month · REQ-4 · P-2');
});

test('vendor and customer: deactivated through the update route, never deleted', async () => {
  const vendor = api.state.vendors[api.state.vendors.push({ _id: 'v-rev', name: 'Dup Co', status: 'active' }) - 1];
  const { r, pid } = applied('vendor', { refId: 'v-rev' });
  const out = await RV.reverse(r.id, pid, 'Mo', 'duplicate vendor');
  assert.equal(out.call.method, 'PUT'); assert.equal(out.call.path, '/api/v1/accountant/vendor/v-rev'); assert.equal(vendor.status, 'inactive'); assert.match(vendor.notes, /Reversed by Mo · duplicate vendor/);
  const it = PR.load(r.id).items[0]; assert.equal(it.status, 'reversed'); assert.equal(it.reversedBy, 'Mo'); assert.equal(it.reversedReason, 'duplicate vendor'); assert.ok(it.reversedAt);
  const rec = R.list(r.id).find((x) => x.run === 'reverse'); assert.equal(rec.proposal, pid); assert.match(rec.purpose, /deactivate the vendor/);
  const notes = RV.notes(r.id); assert.equal(notes.length, 1); assert.equal(notes[0].kind, 'gotcha'); assert.equal(notes[0].body, 'duplicate vendor'); assert.match(notes[0].subject, /vendor · R56 · Acme Dental/);
  assert.equal(T.loadRequest(r.id).reversals[0].proposal, pid);
  assert.deepEqual(api.state.calls.filter((c) => c.method === 'DELETE').length, 0, 'nothing is ever deleted');
  const c = applied('customer', { refId: 'c-9' });
  await assert.rejects(() => RV.reverse(c.r.id, c.pid, 'Mo', 'x'), /no customer update route/, 'no mapped route: refused, nothing called');
});

test('journal_entry and accrual: a reversing journal dated today, every line mirrored, with the memo', async () => {
  const lines = [{ account_id: 'gl_999999', accounting_category: 'Cleaning Expense', accounting_accounts: 'Expense', glType: 'debit', amountDirection: 'inflow', amount: 2400, date: '2026-10-31', journal_id: 'ACC-7' }, { account_id: 'gl_999999', accounting_category: 'Accrued Liabilities', accounting_accounts: 'Liability', glType: 'credit', amountDirection: 'outflow', amount: 2400, date: '2026-10-31', journal_id: 'ACC-7' }];
  const { r, pid } = applied('accrual', { method: 'POST', path: `/api/v1/transactions/accounting/businessId/${BIZ}/transactions?glJournal=true`, body: lines, refId: 'j-orig' });
  const today = new Date().toISOString().slice(0, 10);
  const mirrored = RV.reversingLines(PR.load(r.id).items[0], { by: 'Mo', reason: 'posted in the wrong month', requestId: r.id, today });
  assert.deepEqual(mirrored.map((l) => [l.accounting_category, l.glType, l.amountDirection, l.amount, l.date]), [['Cleaning Expense', 'credit', 'outflow', 2400, today], ['Accrued Liabilities', 'debit', 'inflow', 2400, today]]);
  assert.equal(mirrored[0].memo, `Reversed by Mo · posted in the wrong month · ${r.id} · P-1`); assert.equal(mirrored[0].journal_id, 'ACC-7-REV'); assert.equal(mirrored[0].reversal_of, 'j-orig');
  const before = api.state.journals.length;
  const out = await RV.reverse(r.id, pid, 'Mo', 'posted in the wrong month');
  assert.equal(out.call.method, 'POST'); assert.equal(out.call.path, `/api/v1/transactions/accounting/businessId/${BIZ}/transactions?glJournal=true`);
  assert.equal(api.state.journals.length, before + 1); assert.equal(api.state.journals[before].lines[0].glType, 'credit'); assert.equal(out.ref.id, api.state.journals[before]._id);
  assert.equal(PR.load(r.id).items[0].status, 'reversed');
  // the {lines:[{account, debit, credit}]} entry shape works too
  const je = applied('journal_entry', { method: 'POST', path: `/api/v1/transactions/accounting/businessId/${BIZ}/transactions`, body: {}, entry: { lines: [{ account: 'Rent', debit: 100 }, { account: 'Cash', credit: 100 }] } });
  const m2 = RV.reversingLines(PR.load(je.r.id).items[0], { by: 'Mo', reason: 'r', requestId: je.r.id, today });
  assert.deepEqual(m2.map((l) => [l.accounting_category, l.glType, l.amount]), [['Rent', 'credit', 100], ['Cash', 'debit', 100]]);
  const o2 = await RV.reverse(je.r.id, je.pid, 'Mo', 'r'); assert.equal(o2.proposal.status, 'reversed');
  const bare = applied('journal_entry', { body: {}, entry: null });
  await assert.rejects(() => RV.reverse(bare.r.id, bare.pid, 'Mo', 'r'), /no journal lines recorded/);
});

test('payment_application: the remove-payment route with the applied payment id; transaction recodes restore the recorded previous state', async () => {
  const { r, pid } = applied('payment_application', { method: 'PUT', path: `/api/v1/transactions/accounting/bookkeeping/businessId/${BIZ}/bill/bill-77/apply-payment`, body: { amount: 500 }, refId: 'pay-5' });
  const out = await RV.reverse(r.id, pid, 'Jake', 'paid the wrong bill');
  assert.equal(out.call.method, 'PUT'); assert.equal(out.call.path, `/api/v1/transactions/accounting/bookkeeping/businessId/${BIZ}/bill/bill-77/remove-payment`); assert.deepEqual(api.state.removedPayments.slice(-1)[0], { billId: 'bill-77', paymentId: 'pay-5' });
  assert.equal(out.ref.id, 'rev-pay-5');
  // a product refusal blocks nothing that is delivered, records the words, and leaves the proposal applied
  api.state.failRemovePayment = true;
  const p2 = applied('payment_application', { method: 'PUT', path: `/api/v1/transactions/accounting/bookkeeping/businessId/${BIZ}/bill/bill-78/apply-payment`, body: {}, refId: 'pay-6' });
  await assert.rejects(() => RV.reverse(p2.r.id, p2.pid, 'Jake', 'x'), /Dime refused the reversal: This payment came from a bank line/);
  api.state.failRemovePayment = false;
  assert.equal(PR.load(p2.r.id).items[0].status, 'applied'); assert.equal(T.loadRequest(p2.r.id).status, 'done'); assert.equal(T.loadRequest(p2.r.id).blocked.gap, 'change');
  // categorisation: previous state recorded at propose time
  const cat = applied('transaction_categorization', { method: 'PUT', path: `/api/v1/transactions/accounting/businessId/${BIZ}/transactionId/t-1`, body: { accounting_category: 'Software', accounting_accounts: 'Expense' }, previous: { accounting_category: 'Office Supplies', accounting_accounts: 'Expense' }, refId: 't-1' });
  const o3 = await RV.reverse(cat.r.id, cat.pid, 'Mo', 'it was office supplies after all');
  assert.equal(o3.call.method, 'PUT'); assert.equal(o3.call.path, `/api/v1/transactions/accounting/businessId/${BIZ}/transactionId/t-1`);
  assert.equal(api.state.categorized.slice(-1)[0].accounting_category, 'Office Supplies');
  const none = applied('transaction_categorization', { method: 'PUT', path: `/api/v1/transactions/accounting/businessId/${BIZ}/transactionId/t-2`, body: { accounting_category: 'Software' } });
  await assert.rejects(() => RV.reverse(none.r.id, none.pid, 'Mo', 'x'), /no previous state recorded/);
  assert.equal(api.state.categorized.length, 1, 'the refusal called nothing');
  const unknown = applied('budget', { refId: 'b-1' });
  await assert.rejects(() => RV.reverse(unknown.r.id, unknown.pid, 'Mo', 'x'), /no reversal path for kind budget/);
  await assert.rejects(() => RV.reverse(unknown.r.id, unknown.pid, '', 'x'), /--by/);
  await assert.rejects(() => RV.reverse(unknown.r.id, unknown.pid, 'Mo', ''), /reason is required/);
  const stale = applied('vendor', { refId: 'v-old', appliedAt: '2026-01-01T00:00:00Z' });
  await assert.rejects(() => RV.reverse(stale.r.id, stale.pid, 'Mo', 'late'), /30-day reversal window/);
  assert.ok(M.load(), 'sanity: the test map is in place');
  assert.equal(path.basename(RV.NOTES_FILE(stale.r.id)), 'knowledge-notes.jsonl');
});
