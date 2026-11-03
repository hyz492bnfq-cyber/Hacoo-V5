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
  const messages = (await client.getMessages(source, { limit: count })).filter(message => message && !message.empty).reverse();
  if (!messages.length) return { copied: 0 };
  // copyMessages retire la mention de la source ; Telegram refuse naturellement les contenus protégés.
  const sent = await client.copyMessages(destination, { messages, fromPeer: source });
  return { copied: sent.filter(Boolean).length };
}

module.exports = { Api, createClient, listChats, copyRecent };
