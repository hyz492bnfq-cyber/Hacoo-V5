'use strict';

const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

function createClient({ apiId, apiHash, session = '' }) {
  const stringSession = new StringSession(session);
  return { session: stringSession, client: new TelegramClient(stringSession, Number(apiId), apiHash, { connectionRetries: 3 }) };
}

function dialogId(dialog) {
  const knownId = String(dialog?.id || '');
  if (/^-?\d+$/u.test(knownId)) return knownId;
  const entity = dialog?.entity;
  const id = String(entity?.id || '');
  if (!id) return '';
  return entity?.className === 'Channel' ? `-100${id}` : `-${id}`;
}

async function listChats(client) {
  const dialogs = await client.getDialogs({ limit: 1000 });
  return dialogs.filter(dialog => dialog.isChannel || dialog.isGroup).map(dialog => ({ id: dialogId(dialog), name: String(dialog.title || dialog.name || dialog.entity?.title || '').slice(0, 100), type: dialog.isGroup ? 'groupe' : 'canal' })).filter(item => item.id && item.name);
}

async function copyRecent(client, sourceId, destinationId, count, seenKeys = [], onChunkCopied = null) {
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
  const seen = new Set(seenKeys);
  const usable = publications.map(messages => ({ messages, key: `${sourceId}:${messages.map(message => message.id).join('-')}` })).filter(item => !seen.has(item.key));
  const selected = usable.slice(-count);
  if (!selected.length) return { copied: 0, publications: 0, keys: [] };
  // copyMessages retire la mention de la source ; Telegram refuse naturellement les contenus protégés.
  let copied = 0;
  let chunk = [], chunkKeys = [];
  for (const publication of selected) {
    if (chunk.length && chunk.length + publication.messages.length > 100) {
      copied += (await client.copyMessages(destination, { messages: chunk, fromPeer: source })).filter(Boolean).length;
      if (onChunkCopied) await onChunkCopied(chunkKeys); // Une réponse Telegram partielle est traitée comme incertaine : jamais recopiée.
      chunk = []; chunkKeys = [];
    }
    chunk.push(...publication.messages);
    chunkKeys.push(publication.key);
  }
  if (chunk.length) { copied += (await client.copyMessages(destination, { messages: chunk, fromPeer: source })).filter(Boolean).length; if (onChunkCopied) await onChunkCopied(chunkKeys); }
  if (!copied) throw new Error('Telegram n’a confirmé aucune copie. Vérifie les canaux choisis, les droits de publication et la protection de contenu.');
  return { copied, publications: selected.length, keys: selected.map(item => item.key) };
}

module.exports = { Api, createClient, listChats, copyRecent };
