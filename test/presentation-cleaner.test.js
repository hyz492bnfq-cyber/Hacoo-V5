'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPresentationLine } = require('../lib/presentation-cleaner');

test('retire les anciennes décorations en bordure avant de reformater', () => {
  assert.equal(cleanPresentationLine('🔥 ✨ Veste noire 🤩‼️'), 'Veste noire');
  assert.equal(cleanPresentationLine('👉🏼 https://example.test/produit 🔗'), 'https://example.test/produit');
});

test('préserve un emoji informatif au milieu du texte', () => {
  assert.equal(cleanPresentationLine('Veste avec logo ⭐ discret', { edgesOnly: true }), 'Veste avec logo ⭐ discret');
});

test('le nettoyage de présentation ne retire jamais une URL', () => {
  assert.equal(cleanPresentationLine('🔥 https://example.test/produit ✨'), 'https://example.test/produit');
});
