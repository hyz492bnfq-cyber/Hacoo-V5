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
