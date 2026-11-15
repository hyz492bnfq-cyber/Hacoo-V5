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
const makeGroup = (anchor, photos = [], overrides = {}) => ({
  mode: 'automatic', startedAt: 10000, lastMessageAt: 10000,
  anchor, photos, ...overrides
});
const canAppend = (state, incoming, now = 10001) =>
  shouldAppendPhotoToGroup(state, incoming, 'automatic', now, 30000, readText, 5000);

test('stress: 100 000 décisions préservent la règle caption-first', () => {
  for (let run = 0; run < 20000; run++) {
    const state = makeGroup(photo(run * 10 + 1, 'Post'));
    for (let offset = 2; offset <= 6; offset++) {
      const next = photo(run * 10 + offset);
      assert.equal(canAppend(state, next), true);
      state.photos.push(next);
      state.lastMessageAt = 10000;
    }
    assert.equal(canAppend(state, photo(run * 10 + 7, 'New post')), false);
  }
});

test('stress: une légende intermédiaire autorise les photos suivantes sans légende', () => {
  for (let run = 0; run < 20000; run++) {
    const state = makeGroup(photo(run * 3 + 1), [photo(run * 3 + 2, 'Caption')]);
    assert.equal(canAppend(state, photo(run * 3 + 3)), true);
  }
});

test('stress: les séquences non contiguës sont toujours séparées', () => {
  for (let run = 0; run < 20000; run++) {
    assert.equal(canAppend(makeGroup(photo(run * 3 + 1, 'A')), photo(run * 3 + 3)), false);
  }
});

test('stress: délai de silence et délai maximal sont respectés', () => {
  const state = makeGroup(photo(1, 'Post'));
  state.lastMessageAt = 10000;
  assert.equal(canAppend(state, photo(2), 15000), true);
  assert.equal(canAppend(state, photo(2), 15001), false);
  assert.equal(canAppend(state, photo(2), 40001), false);
});

test('stress: albums natifs et messages non photo ne rejoignent jamais le groupe', () => {
  const state = makeGroup(photo(1, 'Post'));
  assert.equal(canAppend(state, { ...photo(2), media_group_id: 'native-1' }), false);
  assert.equal(canAppend(state, { message_id: 2, text: 'text' }), false);
});
