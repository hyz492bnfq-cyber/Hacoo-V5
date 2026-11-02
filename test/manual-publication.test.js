'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { supportsTelegramMediaGroup, manualPhotoContextMedia, nextAlbumWaitMs, recoverInterruptedPublications, preserveCapturedPublication, interceptedMessagesWereRemoved } = require('../lib/manual-publication');

test('albums Telegram : photos/vidéos ensemble et documents homogènes seulement', () => {
  assert.equal(supportsTelegramMediaGroup([{ photo: {} }, { video: {} }]), true);
  assert.equal(supportsTelegramMediaGroup([{ document: {} }, { document: {} }]), true);
  assert.equal(supportsTelegramMediaGroup([{ photo: {} }, { document: {} }]), false);
  assert.equal(supportsTelegramMediaGroup([{ photo: {} }]), false);
});

test('un texte suivi de photos seules devient un album manuel avec légende', () => {
  const text = { message_id: 10, text: 'Produit et lien' };
  const photos = [{ message_id: 11, photo: [{}] }, { message_id: 12, photo: [{}] }];
  assert.deepEqual(manualPhotoContextMedia([text, ...photos]), photos);
  assert.equal(manualPhotoContextMedia([text, photos[0]]).length, 1);
  assert.equal(manualPhotoContextMedia([{ message_id: 10, text: 'Texte' }, { message_id: 11, video: {} }]), null);
  assert.equal(manualPhotoContextMedia([{ message_id: 10, photo: [{}] }, { message_id: 11, photo: [{}] }]), null);
});

test('un album attend le silence après le dernier média, même après une reprise', () => {
  assert.equal(nextAlbumWaitMs({ startedAt: 1000, lastMessageAt: 4000, now: 4000 }), 5000);
  assert.equal(nextAlbumWaitMs({ startedAt: 1000, lastMessageAt: 4000, now: 7000 }), 2000);
  assert.equal(nextAlbumWaitMs({ startedAt: 1000, lastMessageAt: 4000, now: 61000 }), 0);
});

test('une publication interrompue reste à vérifier après redémarrage', () => {
  const items = [{ status: 'publishing' }, { status: 'saving' }, { status: 'pending' }];
  assert.equal(recoverInterruptedPublications(items, '2026-10-30T10:00:00.000Z'), 2);
  assert.equal(items[0].status, 'uncertain');
  assert.equal(items[1].status, 'delete_failed');
  assert.equal(items[2].status, 'pending');
});

test('un échec de finalisation conserve la publication capturée', () => {
  const item = { id: 'channel:1', status: 'saving' };
  preserveCapturedPublication(item, new Error('disque indisponible'), '2026-10-30T10:00:00.000Z');
  assert.equal(item.status, 'delete_failed');
  assert.match(item.deleteError, /disque indisponible/);
  assert.equal(item.savedAt, '2026-10-30T10:00:00.000Z');
});

test('un message supprimé par le contrôle anti-doublon ne doit pas entrer dans la file manuelle', () => {
  assert.equal(interceptedMessagesWereRemoved([{ message_id: 10 }], new Set([10])), true);
  assert.equal(interceptedMessagesWereRemoved([{ message_id: 11 }], new Set([10])), false);
});
