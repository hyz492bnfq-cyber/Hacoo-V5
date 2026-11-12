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
function mediaFileName(message) {
  if (message.photo) return 'photo.jpg';
  const media = message.media?.document || message.document;
  const attributes = media?.attributes || [];
  const originalName = attributes.find(attribute => attribute?.fileName)?.fileName;
  if (originalName && !originalName.includes('/') && !originalName.includes('\\') && !originalName.includes('\0')) return originalName;
  const mime = String(media?.mimeType || message.video?.mimeType || '').toLowerCase();
  const extensions = {
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
    'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'application/pdf': '.pdf'
  };
  const extension = extensions[mime] || (mime.startsWith('video/') ? '.mp4' : mime.startsWith('image/') ? '.jpg' : '.bin');
  return `media${extension}`;
}
async function asFile(client, message) {
  const buffer = await client.downloadMedia(message, {});
  if (!buffer?.length) throw new Error(`Téléchargement Resender impossible pour le message ${messageId(message)}.`);
  return new CustomFile(mediaFileName(message), buffer.length, '', buffer);
}
function transformedCaption(message, transformText) {
  const original = String(message?.message || '');
  return typeof transformText === 'function' ? String(transformText(original) ?? '') : original;
}
async function republish(client, destination, messages, transformText) {
  const destinationEntity = await client.getEntity(String(destination));
  const ordered = [...messages].sort((a, b) => messageId(a) - messageId(b));
  if (!ordered.length) throw new Error('Publication Resender vide.');

  if (ordered.length > 1) {
    // Strict one-to-one mapping: no album item or caption may disappear silently.
    const files = [];
    for (const message of ordered) files.push(await asFile(client, message));
    const captions = ordered.map(message => transformedCaption(message, transformText));
    // Telegram supports up to 10 media items per album.
    let result;
    for (let offset = 0; offset < files.length; offset += 10) {
      result = await client.sendFile(destinationEntity, {
        file: files.slice(offset, offset + 10),
        caption: captions.slice(offset, offset + 10)
      });
    }
    return result;
  }

  const message = ordered[0];
  const caption = transformedCaption(message, transformText);
  if (!message.media || message.media instanceof Api.MessageMediaWebPage) {
    const options = { message: caption, linkPreview: true };
    // Formatting offsets are only valid while the caption is unchanged.
    if (caption === String(message.message || '') && message.entities?.length) options.formattingEntities = message.entities;
    return client.sendMessage(destinationEntity, options);
  }
  const file = await asFile(client, message);
  const options = { file, caption };
  if (caption === String(message.message || '') && message.entities?.length) options.formattingEntities = message.entities;
  return client.sendFile(destinationEntity, options);
}
async function copyRecent(client, sourceId, destinationId, count, seen = [], transformText) {
  const source = await client.getEntity(String(sourceId)); const messages = (await client.getMessages(source, { limit: Math.min(500, count * 10) })).filter(Boolean).reverse();
  const groups = new Map(); const posts = [];
  for (const message of messages) { const key = message.groupedId ? String(message.groupedId) : `${message.id}`; if (!groups.has(key)) { const group = []; groups.set(key, group); posts.push(group); } groups.get(key).push(message); }
  const old = new Set(seen); const selected = posts.filter(p => !old.has(`${sourceId}:${p.map(messageId).join('-')}`)).slice(-count);
  for (const post of selected) await republish(client, destinationId, post, transformText);
  return { copied: selected.reduce((n, p) => n + p.length, 0), publications: selected.length, keys: selected.map(p => `${sourceId}:${p.map(messageId).join('-')}`) };
}
function watchConnections(client, getConnections, onPost, onError = () => {}) {
  // Channel Sync uses the logged-in personal account: posts written by that account
  // are outgoing, so an incoming-only builder silently ignores the user's own posts.
  // Listen to both directions and rely on the configured sourceChatId filter below.
  client.addEventHandler(async event => { const message = event?.message; if (!message || message.groupedId) return; for (const connection of getConnections()) if (connection.enabled && String(connection.sourceChatId) === chatId(message)) try { await onPost(connection, [message]); } catch (error) { onError(error); } }, new NewMessage({}));
  client.addEventHandler(async event => { const messages = event?.messages || []; const source = chatId(messages[0]); for (const connection of getConnections()) if (connection.enabled && String(connection.sourceChatId) === source) try { await onPost(connection, messages); } catch (error) { onError(error); } }, new Album({}));
}
module.exports = { Api, CustomFile, createClient, listChats, copyRecent, republish, watchConnections, messageId, chatId };
