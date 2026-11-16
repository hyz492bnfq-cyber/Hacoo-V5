'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { copyRecent, republish, messageId, listChats } = require('../lib/channel-sync-resender');

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

test('Resender transforme une seule légende consolidée sans perdre les médias de l’album', async () => {
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
  assert.equal(sent[0].caption, 'M2REPS: titre produit\\n👉🏼 https://exemple.test');
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
test('Resender distingue les groupes, supergroupes et canaux de diffusion', async () => {
  const chats = await listChats({ async getDialogs() { return [
    { id: 11, isGroup: true, title: 'Groupe classique' },
    { id: 22, isChannel: true, entity: { id: 22, megagroup: true }, title: 'Supergroupe' },
    { id: 33, isChannel: true, entity: { id: 33, megagroup: false }, title: 'Canal de diffusion' }
  ]; } });
  assert.deepEqual(chats, [
    { id: '-11', name: 'Groupe classique', type: 'groupe' },
    { id: '-10022', name: 'Supergroupe', type: 'groupe' },
    { id: '-10033', name: 'Canal de diffusion', type: 'canal' }
  ]);
});

test('Resender regroupe toutes les légendes d’un album dans une seule caption transformée', async () => {
  const sent = [];
  const client = {
    async getEntity(id) { return { id }; },
    async downloadMedia(message) { return Buffer.from(String(message.id)); },
    async sendFile(destination, value) { sent.push({ destination, ...value }); }
  };
  await republish(client, '-1002', [
    { id: 1, groupedId: 7n, message: 'Titre produit\\nLien produit A', photo: true },
    { id: 2, groupedId: 7n, message: 'ℹ️ Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur', photo: true },
    { id: 3, groupedId: 7n, message: '🛍️• ʟɪᴇɴ ᴀꜰꜰɪʟɪᴇ́, ᴄᴏᴍᴍɪssɪᴏɴ ᴘᴏssɪʙʟᴇ. ᴀᴜᴛʜᴇɴᴛɪᴄɪᴛᴇ́ ᴀ̀ ᴠᴇ́ʀɪꜰɪᴇʀ ᴀᴜᴘʀᴇ̀s ᴅᴜ ᴠᴇɴᴅᴇᴜʀ⚡️‼️', photo: true }
  ], text => require('../lib/presentation-cleaner').removeRepeatedPublicationLines(text));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].file.length, 3);
  assert.equal(typeof sent[0].caption, 'string');
  assert.match(sent[0].caption, /Titre produit/);
  assert.match(sent[0].caption, /Lien produit A/);
  assert.equal((sent[0].caption.match(/Lien affilié/giu) || []).length, 1);
});

test('Resender garde une seule caption par lot lorsque l’album dépasse dix médias', async () => {
  const sent = [];
  const client = {
    async getEntity(id) { return { id }; },
    async downloadMedia(message) { return Buffer.from(String(message.id)); },
    async sendFile(destination, value) { sent.push(value); }
  };
  await republish(client, '-1002', Array.from({ length: 12 }, (_, index) => ({
    id: index + 1, groupedId: 8n,
    message: index === 0 ? 'Titre album' : '',
    photo: true
  })), text => text);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].file.length, 10);
  assert.equal(sent[0].caption, 'Titre album');
  assert.equal(sent[1].file.length, 2);
  assert.equal(sent[1].caption, '');
});
