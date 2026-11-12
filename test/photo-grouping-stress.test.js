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

test('stress: chaque position possible de la légende est acceptée, puis ferme le groupe', () => {
  let assertions = 0;
  for (let count = 2; count <= 40; count++) {
    for (let captionIndex = 0; captionIndex < count; captionIndex++) {
      const messages = Array.from({ length: count }, (_, i) =>
        photo(count * 100 + captionIndex * 50 + i, i === captionIndex ? 'Légende' : '')
      );
      const state = group(messages[0], []);
      for (let i = 1; i < count; i++) {
        const accepted = accepts(state, messages[i]);
        assert.equal(accepted, i <= captionIndex,
          `count=${count}, captionIndex=${captionIndex}, incomingIndex=${i}`);
        assertions++;
        if (accepted) state.photos.push(messages[i]);
        else break;
      }
    }
  }
  assert.ok(assertions > 10_000, `seulement ${assertions} assertions exécutées`);
});

test('stress: 5 000 rafales déterministes ne réouvrent jamais un groupe après légende', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let run = 0; run < 5_000; run++) {
    const captionAt = Math.floor(random() * 12);
    const state = group(photo(run * 20 + 1, captionAt === 0 ? 'A' : ''));
    let closed = captionAt === 0;
    for (let i = 1; i < 12; i++) {
      const incoming = photo(run * 20 + i + 1, i === captionAt ? 'A' : '');
      const now = 10_000 + Math.floor(random() * 89_000);
      const result = accepts(state, incoming, { now });
      assert.equal(result, !closed, `run=${run}, i=${i}, captionAt=${captionAt}`);
      if (result) {
        state.photos.push(incoming);
        if (readText(incoming).trim()) closed = true;
      }
    }
  }
});

test('stress: délais variés ne permettent jamais de franchir une frontière de légende', () => {
  const gaps = [0, 1, 5, 50, 120, 500, 999, 1_000, 4_999, 5_000, 30_000, 89_999];
  for (const gap of gaps) {
    const state = group(photo(1), [photo(2, 'Description')]);
    assert.equal(accepts(state, photo(3), { now: 10_000 + gap }), false, `gap=${gap}`);
  }
});

test('stress: limite temporelle exacte et dépassement de fenêtre', () => {
  const state = group(photo(1));
  assert.equal(accepts(state, photo(2), { now: 100_000, windowMs: 90_000 }), true);
  assert.equal(accepts(state, photo(3), { now: 100_001, windowMs: 90_000 }), false);
  assert.equal(accepts(state, photo(4), { now: 9_999, windowMs: 90_000 }), false);
});

test('stress: aucune photo d’un autre mode ne rejoint le groupe', () => {
  for (const mode of ['manual', 'automatic', 'unexpected', '', null]) {
    assert.equal(accepts(group(photo(1), [], { mode: 'automatic' }), photo(2), { mode }), mode === 'automatic');
  }
});

test('stress: les albums natifs Telegram sont toujours exclus du regroupement indépendant', () => {
  for (let i = 0; i < 1_000; i++) {
    const incoming = { ...photo(i + 2), media_group_id: `native-${i}` };
    assert.equal(accepts(group(photo(i + 1)), incoming), false);
  }
});

test('stress: messages non-photo et objets incomplets ne sont jamais ajoutés', () => {
  const state = group(photo(1));
  const invalid = [
    null, undefined, {}, { message_id: 2 }, { message_id: 2, photo: [] },
    { message_id: 2, video: [{ file_id: 'v' }] },
    { message_id: 2, document: { file_id: 'd' } }
  ];
  for (const item of invalid) assert.equal(accepts(state, item), false);
  assert.equal(accepts({ mode: 'automatic', startedAt: 10_000 }, photo(2)), true);
  assert.equal(accepts({ mode: 'automatic', startedAt: 'invalid' }, photo(2)), false);
});

test('stress: captions blanches ne ferment pas le groupe, texte réel oui', () => {
  const blank = group(photo(1), [photo(2, '  \n\t ')]);
  assert.equal(accepts(blank, photo(3)), true);
  const real = group(photo(1), [photo(2, '  vraie légende  ')]);
  assert.equal(accepts(real, photo(3)), false);
});

test('stress: les callbacks de texte personnalisés contrôlent bien la frontière', () => {
  const state = group(photo(1), [photo(2)]);
  const customText = message => message.marker || '';
  assert.equal(shouldAppendPhotoToGroup(state, { ...photo(3), marker: 'caption' }, 'automatic', 10_001, 90_000, customText), true);
  const captionedState = group(photo(1), [{ ...photo(2), marker: 'caption' }]);
  assert.equal(shouldAppendPhotoToGroup(captionedState, photo(3), 'automatic', 10_001, 90_000, customText), false);
});

test('stress: un groupe avec plusieurs photos conserve sa frontière même si les IDs sont éloignés', () => {
  const state = group(photo(100), [photo(10_000), photo(900_000, 'Produit A')]);
  for (let i = 0; i < 100; i++) assert.equal(accepts(state, photo(1_000_000 + i)), false);
});
