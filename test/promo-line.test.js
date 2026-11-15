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

test('reconnaît les codes Hacoo au format Code –15% : M2REPS', () => {
  assert.equal(isExistingPromoLine('Code –15% : M2REPS'), true);
  assert.equal(isExistingPromoLine('Code -15% : M2REPS'), true);
  assert.equal(isExistingPromoLine('Code —15% : M2REPS'), true);
  assert.equal(isExistingPromoLine('Code 15%: M2REPS'), true);
});

test('n’ajoute pas un second coupon lorsque la publication contient déjà Code –15%', () => {
  const lines = [
    '🛍️B25 DIOR⚡️‼️',
    'Code –15% : M2REPS',
    '6 COLORIS',
    'STOCK LIMITER',
    'https://c.onlyaff.app/dUUmbX'
  ];
  assert.equal(hasExistingPromoLine(lines, 0), true);
});
