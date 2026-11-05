'use strict';

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Album } = require('telegram/events/Album');
const { CustomFile } = require('telegram/client/uploads');

function createClient({ apiId, apiHash, session = '' }) {
  const stringSession = new StringSession(session);
  return { session: stringSession, client: new TelegramClient(stringSession, Number(apiId), apiHash, { connectionRetries: 5, floodSleepThreshold: 120, autoReconnect: true }) };
}
function dialogId(dialog) { const id = String(dialog?.id || dialog?.entity?.id || ''); return id.startsWith('-') ? id : dialog?.isChannel ? `-100${id}` : `-${id}`; }
async function listChats(client) { const dialogs = await client.getDialogs({ limit: 1000 }); return dialogs.filter(d => d.isChannel || d.isGroup).map(d => ({ id: dialogId(d), name: String(d.title || d.name || d.entity?.title || '').slice(0, 100), type: d.isGroup ? 'groupe' : 'canal' })).filter(x => x.id && x.name); }
function messageId(message) { return Number(message?.id); }
function chatId(message) { return String(message?.chatId || ''); }
async function asFile(client, message) { const buffer = await client.downloadMedia(message, {}); if (!buffer?.length) return null; return new CustomFile(message.photo ? 'photo.jpg' : 'file.bin', buffer.length, '', buffer); }
async function republish(client, destination, messages) {
  const destinationEntity = await client.getEntity(String(destination));
  const ordered = [...messages].sort((a, b) => messageId(a) - messageId(b));
  if (ordered.length > 1) {
    const files = []; for (const message of ordered) { const file = await asFile(client, message); if (file) files.push(file); }
    if (files.length) return client.sendFile(destinationEntity, { file: files, caption: ordered.find(m => m.message)?.message || '' });
  }
  const message = ordered[0]; if (!message) throw new Error('Publication Resender vide.');
  if (!message.media || message.media instanceof Api.MessageMediaWebPage) return client.sendMessage(destinationEntity, { message: message.message || '', formattingEntities: message.entities });
  const file = await asFile(client, message); if (!file) throw new Error('Téléchargement Resender impossible.');
  return client.sendFile(destinationEntity, { file, caption: message.message || '', formattingEntities: message.entities });
}
async function copyRecent(client, sourceId, destinationId, count, seen = []) {
  const source = await client.getEntity(String(sourceId)); const messages = (await client.getMessages(source, { limit: Math.min(500, count * 10) })).filter(Boolean).reverse();
  const groups = new Map(); const posts = [];
  for (const message of messages) { const key = message.groupedId ? String(message.groupedId) : `${message.id}`; if (!groups.has(key)) { const group = []; groups.set(key, group); posts.push(group); } groups.get(key).push(message); }
  const old = new Set(seen); const selected = posts.filter(p => !old.has(`${sourceId}:${p.map(messageId).join('-')}`)).slice(-count);
  for (const post of selected) await republish(client, destinationId, post);
  return { copied: selected.reduce((n, p) => n + p.length, 0), publications: selected.length, keys: selected.map(p => `${sourceId}:${p.map(messageId).join('-')}`) };
}
function watchConnections(client, getConnections, onPost, onError = () => {}) {
  // Channel Sync uses the logged-in personal account: posts written by that account
  // are outgoing, so an incoming-only builder silently ignores the user's own posts.
  // Listen to both directions and rely on the configured sourceChatId filter below.
  client.addEventHandler(async event => { const message = event?.message; if (!message || message.groupedId) return; for (const connection of getConnections()) if (connection.enabled && String(connection.sourceChatId) === chatId(message)) try { await onPost(connection, [message]); } catch (error) { onError(error); } }, new NewMessage({}));
  client.addEventHandler(async event => { const messages = event?.messages || []; const source = chatId(messages[0]); for (const connection of getConnections()) if (connection.enabled && String(connection.sourceChatId) === source) try { await onPost(connection, messages); } catch (error) { onError(error); } }, new Album({}));
}
module.exports = { Api, createClient, listChats, copyRecent, republish, watchConnections, messageId, chatId };
