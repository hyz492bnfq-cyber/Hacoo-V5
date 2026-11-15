'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

const readText = message => message.caption || message.text || '';
const photo = (id, caption = '') => ({
  message_id: id,
  photo: [{ file_id: `photo-${id}` }],
  ...(caption ? { caption } : {})
});
const group = (anchor, photos = [], overrides = {}) => ({
  mode: 'automatic',
  startedAt: 10_000,
  anchor,
  photos,
  ...overrides
});
const accepts = (state, incoming, options = {}) => shouldAppendPhotoToGroup(
  state,
  incoming,
  options.mode === undefined ? 'automatic' : options.mode,
  options.now ?? 10_001,
  options.windowMs ?? 90_000,
  readText
);

test('stress: 10 000 albums indépendants de six photos avec légende initiale restent groupables', () => {
  for (let run = 0; run < 10_000; run++) {
    const state = group(photo(run * 10 + 1, 'Publication ' + run));
    for (let index = 2; index <= 6; index++) {
      const incoming = photo(run * 10 + index);
      assert.equal(accepts(state, incoming), true, `run=${run}, index=${index}`);
      state.photos.push(incoming);
    }
    assert.equal(state.photos.length, 5);
  }
});

test('stress: 50 000 légendes successives forment toujours une frontière', () => {
  for (let run = 0; run < 50_000; run++) {
    const state = group(photo(run * 3 + 1, 'Produit A'));
    assert.equal(accepts(state, photo(run * 3 + 2, 'Produit B')), false);
  }
});

test('stress: aucun message non consécutif ne traverse une frontière potentielle', () => {
  for (let run = 0; run < 50_000; run++) {
    const state = group(photo(run * 3 + 1, 'Produit A'));
    assert.equal(accepts(state, photo(run * 3 + 3)), false);
  }
});

test('stress: les albums natifs Telegram sont toujours exclus du regroupement indépendant', () => {
  for (let i = 0; i < 10_000; i++) {
    const incoming = { ...photo(i + 2), media_group_id: `native-${i}` };
    assert.equal(accepts(group(photo(i + 1, 'Publication')), incoming), false);
  }
});

test('stress: groupe expiré, mode différent et messages non-photo sont rejetés', () => {
  const state = group(photo(1, 'Publication'));
  assert.equal(accepts(state, photo(2), { now: 100_001 }), false);
  assert.equal(accepts(state, photo(2), { mode: 'manual' }), false);
  assert.equal(accepts(state, { message_id: 2, text: 'texte' }), false);
});
