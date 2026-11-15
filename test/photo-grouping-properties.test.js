'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

// Générateur pseudo-aléatoire à graine fixe : les échecs sont reproductibles
// localement et en CI, sans dépendance externe ni hasard non déterministe.
function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

const random = createRandom(0x4d324841);
const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
const caption = message => String(message.caption || message.text || '').trim();
const photo = (id, text = '') => ({
  message_id: id,
  photo: [{ file_id: 'photo-' + id }],
  ...(text ? { caption: text } : {})
});

function makeGroup(messages, mode, startedAt, lastMessageAt) {
  return {
    mode,
    startedAt,
    lastMessageAt,
    anchor: messages[0],
    photos: messages.slice(1)
  };
}

function canAppend(group, message, mode, now) {
  return shouldAppendPhotoToGroup(group, message, mode, now, 30000, caption, 5000);
}

test('propriétés aléatoires : toute séquence contiguë avec au plus une légende est acceptée', () => {
  for (let run = 0; run < 25000; run++) {
    const count = integer(2, 20);
    const captionIndex = integer(-1, count - 1);
    const mode = random() < 0.5 ? 'automatic' : 'manual';
    const startedAt = integer(100000, 900000);
    const messages = Array.from({ length: count }, (_, index) =>
      photo(index + 1, index === captionIndex ? 'Produit #' + run : '')
    );
    const group = makeGroup([messages[0]], mode, startedAt, startedAt);

    for (let index = 1; index < messages.length; index++) {
      const now = group.lastMessageAt + integer(1, 1200);
      assert.equal(
        canAppend(group, messages[index], mode, now),
        true,
        'run=' + run + ', count=' + count + ', captionIndex=' + captionIndex + ', index=' + index
      );
      group.photos.push(messages[index]);
      group.lastMessageAt = now;
    }

    assert.equal(group.photos.length + 1, count);
    assert.equal(
      [group.anchor, ...group.photos].filter(message => Boolean(caption(message))).length,
      captionIndex === -1 ? 0 : 1
    );
  }
});

test('propriétés aléatoires : les frontières invalides ne rejoignent jamais un groupe', () => {
  for (let run = 0; run < 25000; run++) {
    const count = integer(1, 12);
    const captionIndex = integer(-1, count - 1);
    const mode = random() < 0.5 ? 'automatic' : 'manual';
    const startedAt = integer(100000, 900000);
    const messages = Array.from({ length: count }, (_, index) =>
      photo(index + 1, index === captionIndex ? 'Produit #' + run : '')
    );
    const lastMessageAt = startedAt + integer(0, 2000);
    const group = makeGroup(messages, mode, startedAt, lastMessageAt);
    const nextId = messages[count - 1].message_id + 1;
    const validNow = lastMessageAt + 1;

    assert.equal(canAppend(group, photo(nextId), mode, validNow), true, 'séquence valide');

    assert.equal(
      canAppend(group, photo(nextId, 'Deuxième publication'), mode, validNow),
      captionIndex === -1,
      'une seconde légende doit créer une frontière'
    );

    assert.equal(canAppend(group, photo(nextId), mode === 'automatic' ? 'manual' : 'automatic', validNow),
      false, 'un changement de mode doit créer une frontière');
    assert.equal(canAppend(group, { ...photo(nextId), media_group_id: 'native-' + run }, mode, validNow),
      false, 'un album Telegram natif doit rester sur son propre chemin');
    assert.equal(canAppend(group, { message_id: nextId, text: 'message texte' }, mode, validNow),
      false, 'un message non-photo doit créer une frontière');
    assert.equal(canAppend(group, photo(nextId + 1), mode, validNow),
      false, 'un trou dans les identifiants doit créer une frontière');
    assert.equal(canAppend(group, photo(nextId), mode, startedAt + 30001),
      false, 'la fenêtre maximale doit être respectée');
    assert.equal(canAppend(group, photo(nextId), mode, lastMessageAt + 5001),
      false, 'le délai de silence doit être respecté');
    assert.equal(canAppend(group, photo(nextId), mode, lastMessageAt - 1),
      false, 'une horloge qui recule doit être rejetée');
  }
});
