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

test('supprime les lignes strictement répétées sans fusionner les informations différentes', () => {
  const { removeRepeatedPublicationLines } = require('../lib/presentation-cleaner');
  const input = [
    '🛍️APPLE AIRPODS PRO 3⚡️‼️',
    'CODE PROMO :',
    '👉https://c.onlyaff.app/ebYkh9',
    '• Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    '👉https://c.onlyaff.app/ebYkh9',
    'CODE PROMO :',
    'Une autre information produit'
  ].join('\n');

  assert.equal(removeRepeatedPublicationLines(input), [
    '🛍️APPLE AIRPODS PRO 3⚡️‼️',
    'CODE PROMO :',
    '👉https://c.onlyaff.app/ebYkh9',
    '• Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    'ℹ️ Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    'Une autre information produit'
  ].join('\n'));
});
