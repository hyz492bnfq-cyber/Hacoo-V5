'use strict';

const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

function createClient({ apiId, apiHash, session = '' }) {
  const stringSession = new StringSession(session);
  return { session: stringSession, client: new TelegramClient(stringSession, Number(apiId), apiHash, { connectionRetries: 3 }) };
}

function dialogId(entity) {
  const id = String(entity?.id || '');
  if (!id) return '';
  return entity?.className === 'Channel' ? `-100${id}` : `-${id}`;
}

async function listChats(client) {
  const dialogs = await client.getDialogs({ limit: 200 });
  return dialogs.map(dialog => ({ id: dialogId(dialog.entity), name: String(dialog.title || dialog.entity?.title || '').slice(0, 100), type: dialog.entity?.megagroup ? 'groupe' : 'canal' })).filter(item => item.id && item.name);
}

async function copyRecent(client, sourceId, destinationId, count) {
  const source = await client.getEntity(String(sourceId));
  const destination = await client.getEntity(String(destinationId));
  // On lit plus large afin de compter un album comme une seule publication logique.
  const messages = (await client.getMessages(source, { limit: Math.min(500, count * 10) })).filter(message => message && !message.empty).reverse();
  const publications = [];
  const albums = new Map();
  for (const message of messages) {
    const groupId = message.groupedId ? String(message.groupedId) : '';
    if (!groupId) { publications.push([message]); continue; }
    let album = albums.get(groupId);
    if (!album) { album = []; albums.set(groupId, album); publications.push(album); }
    album.push(message);
  }
  const selected = publications.slice(-count).flat();
  if (!selected.length) return { copied: 0, publications: 0 };
  // copyMessages retire la mention de la source ; Telegram refuse naturellement les contenus protégés.
  const sent = await client.copyMessages(destination, { messages: selected, fromPeer: source });
  return { copied: sent.filter(Boolean).length, publications: publications.slice(-count).length };
}

module.exports = { Api, createClient, listChats, copyRecent };
