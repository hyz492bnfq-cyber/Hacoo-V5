'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { copyRecent, republish, messageId } = require('../lib/channel-sync-resender');

test('Resender récupère les dernières publications et traite un album comme une publication', async () => {
  const sent = [];
  const client = {
    async getEntity(id) { return { id }; },
    // Telegram renvoie l’historique du plus récent au plus ancien.
    async getMessages() { return [{ id: 6, media: null, message: 'texte' }, { id: 5, groupedId: 9n, media: {}, message: '' }, { id: 4, groupedId: 9n, media: {}, message: 'album' }]; },
    async downloadMedia() { return Buffer.from('media'); },
    async sendFile(destination, value) { sent.push([destination, value.caption, Array.isArray(value.file)]); },
    async sendMessage(destination, value) { sent.push([destination, value.message, false]); }
  };
  const result = await copyRecent(client, '-1001', '-1002', 2);
  assert.equal(result.publications, 2);
  assert.equal(result.copied, 3);
  assert.deepEqual(result.keys, ['-1001:4-5', '-1001:6']);
  assert.equal(messageId({ id: 6 }), 6);
  assert.deepEqual(sent, [[{ id: '-1002' }, ['album', ''], true], [{ id: '-1002' }, 'texte', false]]);
});

test('Resender transforme chaque légende sans perdre les médias de l’album', async () => {
  const sent = [];
  const client = {
    async getEntity(id) { return { id }; },
    async downloadMedia(message) { return Buffer.from(String(message.id)); },
    async sendFile(destination, value) { sent.push({ destination, ...value }); }
  };
  await republish(client, '-1002', [
    { id: 12, groupedId: 4n, message: 'titre produit', photo: true },
    { id: 13, groupedId: 4n, message: '👉🏼 https://exemple.test', photo: true },
    { id: 14, groupedId: 4n, message: '', photo: true }
  ], text => text ? `M2REPS: ${text}` : text);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].file.length, 3);
  assert.deepEqual(sent[0].caption, [
    'M2REPS: titre produit',
    'M2REPS: 👉🏼 https://exemple.test',
    ''
  ]);
  assert.deepEqual(sent[0].file.map(file => file.name), ['photo.jpg', 'photo.jpg', 'photo.jpg']);
});

test('Resender ne publie jamais un album incomplet si le téléchargement d’un média échoue', async () => {
  let sendCalls = 0;
  const client = {
    async getEntity(id) { return { id }; },
    async downloadMedia(message) { return message.id === 22 ? Buffer.alloc(0) : Buffer.from('ok'); },
    async sendFile() { sendCalls++; }
  };
  await assert.rejects(
    republish(client, '-1002', [
      { id: 21, groupedId: 5n, message: '', photo: true },
      { id: 22, groupedId: 5n, message: '', photo: true }
    ]),
    /Téléchargement Resender impossible/
  );
  assert.equal(sendCalls, 0);
});


test('Resender signale les IDs envoyés afin de garder actifs les contrôles anti-doublons', async () => {
  const reported = [];
  const client = { async getEntity(id) { return { id }; }, async sendMessage(destination, value) { return { id: 99, message: value.message }; } };
  await republish(client, '-1002', [{ id: 1, message: 'hello', media: null }], text => text, result => reported.push(result));
  assert.deepEqual(reported, [{ id: 99, message: 'hello' }]);
});
