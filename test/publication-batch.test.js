'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitPublicationBatches } = require('../lib/publication-batch');

const photo = (id, caption = '', groupId = undefined, chatId = -1001) => ({
  message_id: id,
  chat: { id: chatId },
  photo: [{ file_id: 'photo-' + id }],
  ...(caption ? { caption } : {}),
  ...(groupId === undefined ? {} : { media_group_id: groupId })
});

test('deux photos légendées sans media_group_id restent deux publications', () => {
  const result = splitPublicationBatches([
    photo(2, 'Légende B'),
    photo(1, 'Légende A')
  ]);
  assert.deepEqual(result.map(batch => batch.map(message => message.message_id)), [[1], [2]]);
  assert.equal(result[0][0].caption, 'Légende A');
  assert.equal(result[1][0].caption, 'Légende B');
});

test('une légende sur une photo et une photo sans légende indépendante ne fusionnent pas', () => {
  assert.deepEqual(splitPublicationBatches([
    photo(10, 'Produit A'),
    photo(11)
  ]).map(batch => batch.length), [1, 1]);
});

test('un album natif Telegram partageant le même ID reste groupé', () => {
  const result = splitPublicationBatches([
    photo(3, '', 'album-42'),
    photo(1, 'Légende album', 'album-42'),
    photo(2, '', 'album-42')
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].map(message => message.message_id), [1, 2, 3]);
});

test('un album natif reste groupé même si plusieurs photos ont une légende', () => {
  const result = splitPublicationBatches([
    photo(1, 'Légende photo 1', 'album-captions'),
    photo(2, 'Légende photo 2', 'album-captions'),
    photo(3, '', 'album-captions')
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 3);
});

test('un album natif provenant de deux chats différents est séparé', () => {
  const result = splitPublicationBatches([
    photo(1, 'A', 'same-id', -1001),
    photo(2, 'B', 'same-id', -1002)
  ]);
  assert.deepEqual(result.map(batch => batch.map(message => message.message_id)), [[1], [2]]);
});

test('deux media_group_id différents ne sont jamais fusionnés', () => {
  assert.deepEqual(splitPublicationBatches([
    photo(1, 'A', 'album-A'),
    photo(2, 'B', 'album-B')
  ]).map(batch => batch.length), [1, 1]);
});

test('un mélange album natif + message indépendant est séparé sans perdre de message', () => {
  const result = splitPublicationBatches([
    photo(1, 'Album', 'album-A'),
    photo(2, '', 'album-A'),
    photo(3, 'Post indépendant')
  ]);
  assert.deepEqual(result.map(batch => batch.map(message => message.message_id)), [[1], [2], [3]]);
});

test('un texte séparé et deux photos indépendantes ne deviennent pas un album', () => {
  const text = { message_id: 1, text: 'Légende du post A' };
  const result = splitPublicationBatches([text, photo(2), photo(3, 'Post B')]);
  assert.deepEqual(result.map(batch => batch.map(message => message.message_id)), [[1], [2], [3]]);
});

test('les ID vides, null ou absents ne constituent jamais une preuve d’album', () => {
  for (const id of ['', null, undefined]) {
    const a = photo(1, 'A', id);
    const b = photo(2, 'B', id);
    assert.equal(splitPublicationBatches([a, b]).length, 2);
  }
});

test('les doublons exacts de légende ne provoquent pas de fusion', () => {
  const result = splitPublicationBatches([
    photo(1, 'Même texte'),
    photo(2, 'Même texte'),
    photo(3, 'Même texte')
  ]);
  assert.deepEqual(result.map(batch => batch.length), [1, 1, 1]);
});

test('les contenus différents et les légendes vides restent séparés sans ID Telegram', () => {
  const messages = [
    photo(1, 'Produit A'),
    photo(2, ''),
    photo(3, 'Produit B'),
    photo(4, ' '),
    photo(5, 'Produit C')
  ];
  assert.equal(splitPublicationBatches(messages).length, messages.length);
});

test('entrée vide ou invalide : aucune exception et aucun faux album', () => {
  assert.deepEqual(splitPublicationBatches([]), []);
  assert.deepEqual(splitPublicationBatches(null), []);
  assert.deepEqual(splitPublicationBatches([photo(1)]).map(batch => batch.length), [1]);
});

test('stress: 100 000 paires de publications indépendantes ne fusionnent jamais', () => {
  for (let i = 0; i < 100_000; i++) {
    const result = splitPublicationBatches([
      photo(i * 2 + 1, 'Légende A ' + i),
      photo(i * 2 + 2, 'Légende B ' + i)
    ]);
    assert.equal(result.length, 2, 'paire=' + i);
    assert.equal(result[0].length, 1);
    assert.equal(result[1].length, 1);
  }
});

test('stress: 25 000 albums natifs de 2 à 10 photos restent intacts', () => {
  for (let run = 0; run < 25_000; run++) {
    const groupId = 'native-' + run;
    const count = 2 + (run % 9);
    const messages = Array.from({ length: count }, (_, index) =>
      photo(run * 20 + index + 1, index === count - 1 ? 'Légende native' : '', groupId)
    ).reverse();
    const result = splitPublicationBatches(messages);
    assert.equal(result.length, 1, 'run=' + run);
    assert.equal(result[0].length, count, 'run=' + run);
    assert.ok(result[0].every(message => message.media_group_id === groupId));
  }
});

test('stress: 50 000 lots mixtes ne perdent ni ne dupliquent de message', () => {
  for (let run = 0; run < 50_000; run++) {
    const count = 2 + (run % 8);
    const messages = Array.from({ length: count }, (_, index) => {
      const kind = (run + index) % 4;
      const groupId = kind === 0 || kind === 1 ? 'g-' + run : undefined;
      return photo(run * 20 + index + 1, index % 2 ? 'Caption ' + index : '', groupId);
    });
    const batches = splitPublicationBatches(messages);
    const flattened = batches.flat();
    assert.equal(flattened.length, messages.length, 'run=' + run);
    assert.equal(new Set(flattened.map(message => message.message_id)).size, messages.length, 'run=' + run);
    for (const batch of batches) {
      if (batch.length > 1) {
        const id = batch[0].media_group_id;
        assert.ok(id);
        assert.ok(batch.every(message => message.media_group_id === id));
      }
    }
  }
});
