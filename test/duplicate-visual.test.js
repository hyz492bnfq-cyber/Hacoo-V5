'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { strongVisualDuplicateEvidence } = require('../lib/duplicate-visual');

test('les mêmes fichiers Telegram sont une preuve visuelle forte', () => {
  assert.equal(strongVisualDuplicateEvidence([{ fileUniqueId: 'same' }], [{ fileUniqueId: 'same' }]).strong, true);
});

test('des photos de couleurs différentes ne sont jamais une preuve de doublon', () => {
  const hash = '0'.repeat(256);
  const black = Array.from({ length: 24 }, (_, i) => i % 8 === 0 ? 1 : 0);
  const blue = Array.from({ length: 24 }, (_, i) => i % 8 === 3 ? 1 : 0);
  assert.equal(strongVisualDuplicateEvidence([{ hash, colorSignature: black }], [{ hash, colorSignature: blue }]).strong, false);
});

test('une image quasi identique avec mêmes couleurs est une preuve visuelle forte', () => {
  const base = '0'.repeat(256);
  const close = `111111${'0'.repeat(250)}`;
  const colors = Array.from({ length: 24 }, (_, i) => i % 8 === 0 ? 1 : 0);
  assert.equal(strongVisualDuplicateEvidence([{ hash: base, colorSignature: colors }], [{ hash: close, colorSignature: colors }]).strong, true);
});
