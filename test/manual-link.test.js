'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { productLinks, replaceProductLink } = require('../lib/manual-link');

test('extrait les liens produits et ignore la ponctuation finale', () => {
  assert.deepEqual(productLinks('Produit : https://example.test/item?a=1. Puis autre https://shop.test/x'), ['https://example.test/item?a=1', 'https://shop.test/x']);
});

test('remplace seulement le premier lien produit par le lien affilié', () => {
  assert.equal(replaceProductLink('Produit\nhttps://source.test/a\nhttps://autre.test/b', 'https://affiliate.test/a?ref=me'), 'Produit\nhttps://affiliate.test/a?ref=me\nhttps://autre.test/b');
});
