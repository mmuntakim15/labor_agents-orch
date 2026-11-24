'use strict';
// RD-2: a library match is adopted at intake when it clears the threshold or is a clear winner; candidate ids survive classify().
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/orchestrator');

test('adoptable: threshold, clear winner, and refusals', () => {
  assert.equal(O.adoptable({ id: 'R08', score: 0.84, candidates: [{ id: 'R08', score: 0.84 }, { id: 'R21', score: 0.35 }] }), true);
  // below 0.8 but a clear winner (>= 0.6 and >= 1.5x the runner-up): an entity name on top of a library prompt
  assert.equal(O.adoptable({ id: 'R03', score: 0.76, candidates: [{ id: 'R03', score: 0.76 }, { id: 'R22', score: 0.4 }] }), true);
  // below 0.8 with a close rival: Intake confirms, nothing adopted
  assert.equal(O.adoptable({ id: 'R08', score: 0.795, candidates: [{ id: 'R08', score: 0.795 }, { id: 'R21', score: 0.789 }] }), false);
  // too weak even without a rival
  assert.equal(O.adoptable({ id: 'R19', score: 0.375, candidates: [{ id: 'R19', score: 0.375 }, { id: 'R53', score: 0.349 }] }), false);
  assert.equal(O.adoptable(null), false);
  assert.equal(O.adoptable({ id: null, score: 0, candidates: [] }), false);
});

test('classify keeps a library recipe id or a learned candidate id, drops anything else', () => {
  const req = { kind: 'question', size: 'S', writes: false, subject: {}, done: [] };
  assert.equal(O.classify(req, { status: 'ok', kind: 'question', recipeId: 'R08', recipeVersion: 1 }).recipeId, 'R08');
  assert.equal(O.classify(req, { status: 'ok', kind: 'question', recipeId: 'cand-prepaid-vs-open-ar', recipeVersion: 0 }).recipeId, 'cand-prepaid-vs-open-ar');
  assert.equal(O.classify(req, { status: 'ok', kind: 'question', recipeId: 'R8' }).recipeId, undefined);
  assert.equal(O.classify(req, { status: 'ok', kind: 'question', recipeId: '../x' }).recipeId, undefined);
});
