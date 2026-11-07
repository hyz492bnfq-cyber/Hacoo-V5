'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectFirstPublicationProduct, resolvePublicationFirstProduct } = require('../lib/hacoo-publication');

test('sélectionne le premier produit Hacoo d’une liste et ignore les suivants', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { item_id: 40860854 } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765 } }
  ] });
  assert.equal(result.status, 'product');
  assert.equal(result.itemId, '40860854');
  assert.equal(result.productUrl, 'https://www.hacoo.pl/en-FR/detail/40860854');
});

test('accepte productCardDetail sous forme d’objet en conservant son ordre', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: {
    short_a: { moduleType: 'item_detail_card', moduleData: { item_id: 40886057 } },
    short_b: { moduleType: 'item_detail_card', moduleData: { item_id: 40665765 } }
  } });
  assert.equal(result.itemId, '40886057');
});

test('ne saute jamais un premier produit externe pour convertir le suivant', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'item_detail_card', moduleData: { out_site: true, extPlat: 'taobao', domain: 'taobao.com' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765 } }
  ] });
  assert.deepEqual(result, { status: 'external', productUrl: null });
});

test('reconnaît les plateformes et domaines externes', () => {
  for (const moduleData of [
    { out_site: true, item_id: 123 },
    { extPlat: 'taobao', item_id: 123 },
    { domain: 'taobao.com', item_id: 123 }
  ]) {
    assert.equal(selectFirstPublicationProduct({ productCardDetail: [{ moduleType: 'item_detail_card', moduleData }] }).status, 'external');
  }
});

test('préserve les cas sans identifiant valide ou structure inconnue', () => {
  assert.equal(selectFirstPublicationProduct({ productCardDetail: [{ moduleType: 'item_detail_card', moduleData: {} }] }).status, 'invalid-item-id');
  assert.equal(selectFirstPublicationProduct({ productCardDetail: [] }).status, 'unrecognized');
  assert.equal(selectFirstPublicationProduct({}).status, 'unrecognized');
});

test('ne saute pas une entrée initiale ambiguë pour choisir une carte ultérieure', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { layout: 'unknown-card-schema', payload: { product: 'possible-first-product' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40665765 } }
  ] });
  assert.deepEqual(result, { status: 'unrecognized', productUrl: null });
});

test('peut ignorer un module explicitement non produit avant la première carte produit', () => {
  const result = selectFirstPublicationProduct({ productCardDetail: [
    { moduleType: 'banner_module', moduleData: { title: 'Promotion' } },
    { moduleType: 'item_detail_card', moduleData: { item_id: 40860854 } }
  ] });
  assert.equal(result.status, 'product');
  assert.equal(result.itemId, '40860854');
});

test('lit le véritable format getFeedDetail : enveloppe code 1001 et cartes indexées par shortlink', () => {
  const result = selectFirstPublicationProduct({
    code: 1001,
    data: {
      feedId: '15607115',
      productCardDetail: {
        'url.com/first': {
          moduleType: 'item_detail_card',
          moduleData: { item_id: 40860854, extPlat: 'hacoo', out_site: false }
        },
        'url.com/second': {
          moduleType: 'item_detail_card',
          moduleData: { item_id: 40665765, extPlat: 'hacoo', out_site: false }
        }
      }
    }
  });
  assert.equal(result.status, 'product');
  assert.equal(result.itemId, '40860854');
  assert.equal(result.productUrl, 'https://www.hacoo.pl/en-FR/detail/40860854');
});

test('refuse un code API en erreur même si une payload partielle contient une carte', () => {
  const result = selectFirstPublicationProduct({
    code: 401,
    data: {
      productCardDetail: {
        first: { moduleType: 'item_detail_card', moduleData: { item_id: 40860854 } }
      }
    }
  });
  assert.deepEqual(result, { status: 'api-error', productUrl: null });
});

test('reconnaît le format getFeedDetail d’une publication externe Taobao', () => {
  const result = selectFirstPublicationProduct({
    code: 1001,
    data: {
      productCardDetail: {
        'taobao.com/short': {
          moduleType: 'item_detail_card',
          moduleData: { out_site: true, extPlat: 'taobao', domain: 'taobao.com', extItemId: '1077940485713' }
        }
      }
    }
  });
  assert.deepEqual(result, { status: 'external', productUrl: null });
});

test('la résolution est fermée par défaut tant que l’authentification serveur n’est pas fournie', async () => {
  assert.equal((await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911')).status, 'unavailable-auth');
});

test('résout uniquement une URL de publication Hacoo via le résolveur injecté', async () => {
  let requested;
  const result = await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911', {
    fetchFeedDetail: async id => {
      requested = id;
      return { productCardDetail: [{ moduleType: 'item_detail_card', moduleData: { item_id: 40886057 } }] };
    }
  });
  assert.equal(requested, '15580911');
  assert.equal(result.itemId, '40886057');
});

test('une erreur API ne produit jamais de lien produit', async () => {
  const result = await resolvePublicationFirstProduct('https://www.hacoo.pl/p/15580911', {
    fetchFeedDetail: async () => { throw new Error('unauthorized'); }
  });
  assert.deepEqual(result, { status: 'api-error', productUrl: null });
});
