'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectFirstPublicationProduct, parsePublicPublicationHtml, resolvePublicationFirstProduct } = require('../lib/hacoo-publication');

test('sélectionne le premier produit Hacoo valide', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { item_id: 40860854, extPlat: 'hacoo', out_site: false } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.equal(result.status, 'product');
  assert.equal(result.itemId, '40860854');
  assert.equal(result.productUrl, 'https://www.hacoo.pl/en-FR/detail/40860854');
});

test('ne convertit pas une publication dont le premier produit est externe', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { out_site: true, extPlat: 'taobao', domain: 'taobao.com' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.deepEqual(result, { status: 'external-first-product', productUrl: null });
});

test('ne saute pas un premier produit Hacoo dont l’identifiant est invalide', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { item_id: 'bad-id', extPlat: 'hacoo', out_site: false } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.deepEqual(result, { status: 'invalid-item-id', productUrl: null });
});

test('conserve la première carte Hacoo sans identifiant plutôt que de prendre la suivante', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { extPlat: 'hacoo', out_site: false } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.deepEqual(result, { status: 'invalid-item-id', productUrl: null });
});

test('ne saute pas plusieurs produits externes pour atteindre un produit Hacoo', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { extPlat: 'taobao', domain: 'taobao.com' } },
    { moduleType: 'item_detail_card', moduleData: { out_site: true, extPlat: 'aliexpress', domain: 'aliexpress.com' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40886057, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.deepEqual(result, { status: 'external-first-product', productUrl: null });
});

test('ignore les modules explicitement non produits', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'banner_module', moduleData: { title: 'Promotion' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40860854, extPlat: 'hacoo', out_site: false } }
  ] });
  assert.equal(result.itemId, '40860854');
});

test('refuse les structures inconnues ambiguës', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { layout: 'unknown-card-schema', payload: { product: 'possible-first-product' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo' } }
  ] });
  assert.deepEqual(result, { status: 'unrecognized', productUrl: null });
});

test('lit l’enveloppe getFeedDetail code 1001 et les cartes objet', () => {
  const result = selectFirstPublicationProduct({
    code: 1001,
    data: { productCardDetail: {
      first: { moduleType: 'item_detail_card', moduleData: { item_id: 40860854, extPlat: 'hacoo', out_site: false } },
      second: { moduleType: 'item_detail_card', moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false } }
    } }
  });
  assert.equal(result.itemId, '40860854');
});

test('refuse un code API en erreur même avec une payload partielle', () => {
  assert.deepEqual(selectFirstPublicationProduct({
    code: 401, data: { productCardDetail: { first: { moduleType: 'item_detail_card', moduleData: { item_id: 123 } } } }
  }), { status: 'api-error', productUrl: null });
});

test('signale un premier produit externe même si aucune carte Hacoo ne suit', () => {
  assert.deepEqual(selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { extPlat: 'taobao', domain: 'taobao.com' } }
  ] }), { status: 'external-first-product', productUrl: null });
});

test('la résolution reste fermée par défaut sans authentification injectée', async () => {
  assert.equal((await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911')).status, 'no-public-product-data');
});

test('résout une publication Hacoo avec le résolveur injecté', async () => {
  let requested;
  const result = await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911', {
    fetchFeedDetail: async id => {
      requested = id;
      return { productCardDetail: [{ moduleType: 'item_detail_card', moduleData: { item_id: 40886057, extPlat: 'hacoo', out_site: false } }] };
    }
  });
  assert.equal(requested, '15580911');
  assert.equal(result.itemId, '40886057');
});

test('une erreur API ne produit jamais de lien produit', async () => {
  assert.deepEqual(await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911', {
    fetchFeedDetail: async () => { throw new Error('unauthorized'); }
  }), { status: 'api-error', productUrl: null });
});


test('parse la forme exacte observée dans la réponse HAR getFeedDetail', () => {
  const result = selectFirstPublicationProduct({
    api: 'dwp.feed-center.getFeedDetail',
    code: 1001,
    data: {
      productCardDetail: {
        'https://www.hacoo.pl/en-FR/detail/40870813': {
          moduleType: 'item_detail_card',
          moduleData: {
            item_id: 40870813,
            extItemId: 40870813,
            extPlat: 'hacoo',
            out_site: false
          }
        },
        'https://www.hacoo.pl/en-FR/detail/another-product': {
          moduleType: 'item_detail_card',
          moduleData: {
            item_id: 40665765,
            extPlat: 'hacoo',
            out_site: false
          }
        }
      }
    }
  });
  assert.equal(result.status, 'product');
  assert.equal(result.itemId, '40870813');
  assert.equal(result.productUrl, 'https://www.hacoo.pl/en-FR/detail/40870813');
});
