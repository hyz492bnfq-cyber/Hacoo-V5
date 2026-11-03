'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { copyRecent, messageId } = require('../lib/channel-sync-resender');

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
  assert.deepEqual(sent, [[{ id: '-1002' }, 'album', true], [{ id: '-1002' }, 'texte', false]]);
});
