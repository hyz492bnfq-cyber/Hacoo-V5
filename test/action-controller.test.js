'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateCandidatePath, evaluateActivation } = require('../lib/action-controller');
const root = path.resolve(__dirname, '..');

test('candidate JS path inside isolated workspace is allowed', () => {
  const result = validateCandidatePath(root, 'workspace/candidates/example.js');
  assert.equal(result.allowed, true);
});

test('production data and paths are blocked', () => {
  assert.equal(validateCandidatePath(root, 'data.json').allowed, false);
  assert.equal(validateCandidatePath(root, 'index.js').allowed, false);
  assert.equal(validateCandidatePath(root, 'workspace/candidates/.env').allowed, false);
});

test('activation requires tests, security, backup and rollback', () => {
  assert.equal(evaluateActivation({ testsPassed: true, securityPassed: true, backupReady: true, rollbackReady: true }).allowed, true);
  assert.equal(evaluateActivation({ testsPassed: true, securityPassed: false, backupReady: true, rollbackReady: true }).allowed, false);
});

test('medium/high risk requires explicit human approval', () => {
  assert.equal(evaluateActivation({ testsPassed: true, securityPassed: true, backupReady: true, rollbackReady: true, risk: 'high' }).allowed, false);
  assert.equal(evaluateActivation({ testsPassed: true, securityPassed: true, backupReady: true, rollbackReady: true, risk: 'high', humanApproved: true }).allowed, true);
});
