'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

const text = message => message.caption || message.text || '';
const photo = (id, caption = '') => ({
  message_id: id,
  photo: [{ file_id: `photo-${id}` }],
  ...(caption ? { caption } : {})
});
const group = (anchor, photos = [], overrides = {}) => ({
  mode: 'automatic',
  startedAt: 1000,
  lastMessageAt: 1000,
  anchor,
  photos,
  ...overrides
});
const accepts = (state, incoming, options = {}) => shouldAppendPhotoToGroup(
  state, incoming, options.mode || 'automatic',
  options.now ?? 1100, options.windowMs ?? 30000, text,
  options.quietMs ?? 5000
);

test('regroupe six photos successives avec légende sur la première', () => {
  const state = group(photo(1, 'Produit Hacoo'));
  for (let id = 2; id <= 6; id++) {
    const incoming = photo(id);
    assert.equal(accepts(state, incoming, { now: 1000 + id * 100 }), true);
    state.photos.push(incoming);
    state.lastMessageAt = 1000 + id * 100;
  }
  assert.equal(state.photos.length + 1, 6);
});

test('une légende sur la deuxième photo peut être suivie de photos sans légende', () => {
  const state = group(photo(1));
  const captioned = photo(2, 'Description');
  assert.equal(accepts(state, captioned), true);
  state.photos.push(captioned);
  state.lastMessageAt = 1100;
  assert.equal(accepts(state, photo(3), { now: 1200 }), true);
});

test('une deuxième légende ferme le groupe et sépare deux publications', () => {
  assert.equal(accepts(group(photo(1, 'Produit A')), photo(2, 'Produit B')), false);
});

test('les photos sans légende peuvent se suivre avant la légende', () => {
  const state = group(photo(1));
  assert.equal(accepts(state, photo(2)), true);
  state.photos.push(photo(2));
  state.lastMessageAt = 1100;
  assert.equal(accepts(state, photo(3, 'Légende')), true);
});

test('une légende tardive ne ferme pas le groupe à elle seule', () => {
  assert.equal(accepts(group(photo(1), [photo(2, 'Légende')]), photo(3)), true);
});

test('un message avec media_group_id est laissé au regroupement natif', () => {
  assert.equal(accepts(group(photo(1, 'Produit')), { ...photo(2), media_group_id: 'native' }), false);
});

test('un message non-photo est rejeté', () => {
  assert.equal(accepts(group(photo(1)), { message_id: 2, text: 'texte' }), false);
});

test('un mode différent est rejeté', () => {
  assert.equal(accepts(group(photo(1)), photo(2), { mode: 'manual' }), false);
});

test('un trou dans les identifiants de messages est une frontière', () => {
  assert.equal(accepts(group(photo(1, 'Produit')), photo(3)), false);
});

test('une photo reçue après le délai de silence est séparée', () => {
  const state = group(photo(1, 'Produit'));
  state.lastMessageAt = 1000;
  assert.equal(accepts(state, photo(2), { now: 6001 }), false);
});

test('une photo reçue après la fenêtre maximale est séparée', () => {
  assert.equal(accepts(group(photo(1, 'Produit')), photo(2), { now: 31001 }), false);
});

test('une horloge incohérente ou une donnée de groupe absente est rejetée', () => {
  assert.equal(accepts(null, photo(2)), false);
  assert.equal(accepts({ mode: 'automatic', startedAt: 1000 }, photo(2)), false);
  assert.equal(accepts(group(photo(1)), photo(2), { now: 999 }), false);
});

test('les légendes blanches ne ferment pas le groupe', () => {
  const state = group(photo(1), [photo(2, '   ')]);
  assert.equal(accepts(state, photo(3, 'Description')), true);
});

test('stress : 10 000 séquences de six photos légendées sur la première', () => {
  for (let run = 0; run < 10000; run++) {
    const state = group(photo(run * 10 + 1, 'Produit'));
    for (let offset = 2; offset <= 6; offset++) {
      const incoming = photo(run * 10 + offset);
      assert.equal(accepts(state, incoming, { now: 1000 + offset * 100 }), true);
      state.photos.push(incoming);
      state.lastMessageAt = 1000 + offset * 100;
    }
    assert.equal(state.photos.length, 5);
  }
});

test('stress : 50 000 frontières avec une deuxième légende', () => {
  for (let run = 0; run < 50000; run++) {
    assert.equal(accepts(group(photo(run * 2 + 1, 'A')), photo(run * 2 + 2, 'B')), false);
  }
});

test('stress : 10 000 albums Telegram natifs restent exclus', () => {
  for (let run = 0; run < 10000; run++) {
    assert.equal(accepts(group(photo(run * 2 + 1, 'A')), {
      ...photo(run * 2 + 2), media_group_id: `native-${run}`
    }), false);
  }
});


test('la légende peut être portée par la première, une photo intermédiaire ou la dernière', () => {
  for (const captionIndex of [0, 2, 5]) {
    const messages = Array.from({ length: 6 }, (_, index) =>
      photo(index + 1, index === captionIndex ? 'Description du produit' : '')
    );
    const state = group(messages[0]);
    for (let index = 1; index < messages.length; index++) {
      const incoming = messages[index];
      const now = 1000 + index * 100;
      assert.equal(accepts(state, incoming, { now }), true,
        `captionIndex=${captionIndex}, incomingIndex=${index}`);
      state.photos.push(incoming);
      state.lastMessageAt = now;
    }
    assert.equal(state.photos.length + 1, 6);
  }
});

test('deux photos légendées indépendantes forment deux publications prudentes', () => {
  const state = group(photo(1, 'Produit A'));
  assert.equal(accepts(state, photo(2, 'Produit B')), false);
});

test('une légende intermédiaire peut être suivie de photos sans légende', () => {
  const state = group(photo(1));
  const second = photo(2);
  assert.equal(accepts(state, second, { now: 1100 }), true);
  state.photos.push(second);
  state.lastMessageAt = 1100;
  const captioned = photo(3, 'Description');
  assert.equal(accepts(state, captioned, { now: 1200 }), true);
  state.photos.push(captioned);
  state.lastMessageAt = 1200;
  const last = photo(4);
  assert.equal(accepts(state, last, { now: 1300 }), true);
});
