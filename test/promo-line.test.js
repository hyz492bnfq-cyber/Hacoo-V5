'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isExistingPromoLine, hasExistingPromoLine } = require('../lib/promo-line');

test('reconnaît les codes promo existants sans modifier leur valeur', () => {
  assert.equal(isExistingPromoLine('-15% coupon : MONCODE 🎁'), true);
  assert.equal(isExistingPromoLine('CODE PROMO : SALE20'), true);
  assert.equal(isExistingPromoLine('Référence produit AB-123'), false);
});

test('détecte un coupon plus bas dans le message avant l insertion du format', () => {
  assert.equal(hasExistingPromoLine(['Titre produit', '-15% coupon : MONCODE 🎁', 'https://example.test'], 0), true);
});
