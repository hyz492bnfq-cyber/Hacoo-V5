'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPublication } = require('../lib/prepublication');
test('rejects empty and too-long publication text', () => {
  assert.equal(inspectPublication({ text: '' }).ok, false);
  assert.equal(inspectPublication({ text: 'x'.repeat(3901) }).ok, false);
});
test('blocks configured phrase and recent exact duplicate', () => {
  assert.equal(inspectPublication({ text: 'Cette offre test est prête.' }, { blockedPhrases: ['offre test'] }).ok, false);
  const first = inspectPublication({ text: 'Texte original et utile' });
  assert.equal(inspectPublication({ text: 'Texte original et utile' }, { recentHashes: [first.contentHash] }).ok, false);
});
test('warns about high link count without silently blocking', () => {
  const result = inspectPublication({ text: Array.from({ length: 9 }, (_, i) => `https://example${i}.com`).join(' ') });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.length);
});
