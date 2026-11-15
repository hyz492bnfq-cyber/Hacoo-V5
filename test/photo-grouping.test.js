'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

const getText = message => message.caption || message.text || '';
const photo = (id, caption = '') => ({
  message_id: id,
  photo: [{ file_id: `photo-${id}` }],
  ...(caption ? { caption } : {})
});
const group = (anchor, photos = [], overrides = {}) => ({
  mode: 'automatic',
  startedAt: 1000,
  anchor,
  photos,
  ...overrides
});
const canAppend = (existing, incoming, options = {}) =>
  shouldAppendPhotoToGroup(
    existing,
    incoming,
    options.mode || 'automatic',
    options.now ?? 2000,
    options.windowMs ?? 90000,
    getText
  );

test('une publication avec légende sur la première photo accepte les photos suivantes sans légende', () => {
  const state = group(photo(1, 'Légende du produit'));
  for (let id = 2; id <= 6; id++) {
    const incoming = photo(id);
    assert.equal(canAppend(state, incoming), true);
    state.photos.push(incoming);
  }
  assert.equal(state.photos.length + 1, 6);
});

test('une deuxième légende ferme le groupe et démarre une nouvelle publication', () => {
  assert.equal(canAppend(group(photo(1, 'Produit A'), [photo(2)]), photo(3, 'Produit B')), false);
});

test('une légende arrivée après les premières photos ferme le groupe', () => {
  const state = group(photo(1), [photo(2)]);
  assert.equal(canAppend(state, photo(3, 'Description')), true);
  state.photos.push(photo(3, 'Description'));
  assert.equal(canAppend(state, photo(4)), false);
});

test('une légende sur la première photo ferme le groupe si une autre légende arrive', () => {
  assert.equal(canAppend(group(photo(1, 'Description')), photo(2, 'Autre publication')), false);
});

test('plusieurs photos non légendées consécutives restent regroupables', () => {
  const state = group(photo(1));
  assert.equal(canAppend(state, photo(2)), true);
  state.photos.push(photo(2));
  assert.equal(canAppend(state, photo(3)), true);
});

test('un groupe d’un autre mode est rejeté', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { mode: 'manual' }), false);
});

test('un groupe expiré est rejeté', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 91001 }), false);
});

test('une photo exactement à la limite temporelle est acceptée', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 91000 }), true);
});

test('une horloge antérieure au début du groupe est rejetée', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 999 }), false);
});

test('un message sans photo ne peut jamais être ajouté par cette fonction', () => {
  assert.equal(canAppend(group(photo(1)), { message_id: 2, text: 'texte indépendant' }), false);
});

test('un message déjà membre d’un album Telegram natif est laissé au traitement natif', () => {
  assert.equal(canAppend(group(photo(1)), { ...photo(2), media_group_id: 'native-album-1' }), false);
});

test('un groupe absent ou incomplet ne provoque pas d’erreur', () => {
  assert.equal(canAppend(null, photo(1)), false);
  assert.equal(canAppend({ mode: 'automatic', startedAt: 1000 }, photo(1)), false);
});

test('les fenêtres invalides et les horodatages invalides sont rejetés', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: NaN }), false);
  assert.equal(canAppend(group(photo(1)), photo(2), { windowMs: -1 }), false);
  assert.equal(shouldAppendPhotoToGroup(group(photo(1)), photo(2), 'automatic', 2000, 90000, null), true);
});

test('une publication légendée sur la première photo peut contenir plusieurs photos sans légende', () => {
  const state = group(photo(10, 'Produit A'));
  for (let id = 11; id <= 15; id++) {
    const incoming = photo(id);
    assert.equal(canAppend(state, incoming), true);
    state.photos.push(incoming);
  }
  assert.equal(state.photos.length, 5);
});

test('deux publications légendées successives ne fusionnent pas', () => {
  const first = group(photo(20, 'Produit A'));
  assert.equal(canAppend(first, photo(21, 'Produit B')), false);
});

test('un message non consécutif ne rejoint pas le groupe', () => {
  assert.equal(canAppend(group(photo(30, 'Produit A')), photo(32)), false);
});

test('une rafale de six photos avec légende initiale est regroupée sans perte', () => {
  const messages = Array.from({ length: 6 }, (_, index) =>
    photo(100 + index, index === 0 ? 'Publication Hacoo' : '')
  );
  const state = group(messages[0]);
  for (const message of messages.slice(1)) {
    assert.equal(canAppend(state, message), true);
    state.photos.push(message);
  }
  assert.deepEqual([state.anchor, ...state.photos].map(message => message.message_id), [100, 101, 102, 103, 104, 105]);
});
