'use strict';

function supportsTelegramMediaGroup(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  // Telegram accepte un album de photos/vidéos, ou un album uniquement composé
  // de documents. Un mélange document + photo/vidéo est envoyé séquentiellement.
  return messages.every(message => message.photo || message.video) ||
    messages.every(message => message.document);
}

function manualPhotoContextMedia(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const [anchor, ...media] = messages;
  // Texte reçu juste avant des photos seules : dans la file manuelle, le texte
  // devient la légende du groupe au lieu d'être renvoyé séparément.
  const anchorIsTextOnly = Boolean(anchor?.text) && !anchor.photo && !anchor.video && !anchor.document && !anchor.animation && !anchor.audio && !anchor.voice;
  if (!anchorIsTextOnly || !media.every(message => message?.photo?.length)) return null;
  return media;
}

function nextAlbumWaitMs({ startedAt, lastMessageAt, now = Date.now(), quietMs = 12000, maxWaitMs = 120000 }) {
  const started = Number(startedAt) || now;
  const last = Number(lastMessageAt) || started;
  const remainingQuiet = Math.max(0, quietMs - (now - last));
  const remainingMax = Math.max(0, maxWaitMs - (now - started));
  return Math.min(remainingQuiet, remainingMax);
}

function recoverInterruptedPublications(items, now = new Date().toISOString()) {
  let changed = 0;
  for (const item of items || []) {
    if (item.status === 'publishing') {
      item.status = 'uncertain';
      item.lastError = 'Envoi interrompu par un redémarrage : vérifie le canal avant toute nouvelle publication.';
      item.publishUncertainAt = now;
      changed++;
    } else if (item.status === 'saving') {
      item.status = 'delete_failed';
      item.deleteError = 'Sauvegarde confirmée mais finalisation interrompue : vérifie la suppression du message original avant publication.';
      item.savedAt = item.savedAt || now;
      changed++;
    }
  }
  return changed;
}

function preserveCapturedPublication(item, error, now = new Date().toISOString()) {
  // L'élément a déjà été écrit avant toute suppression Telegram. Il ne doit
  // jamais être retiré de la file si la finalisation de l'état échoue.
  item.status = 'delete_failed';
  item.deleteError = String(error?.description || error?.message || error).slice(0, 300);
  item.savedAt = item.savedAt || now;
  return item;
}

function interceptedMessagesWereRemoved(messages, removedIds) {
  return (messages || []).some(message => removedIds?.has(message?.message_id));
}

function pendingAlbumRecord(album) {
  return {
    groupId: String(album.groupId),
    messages: JSON.parse(JSON.stringify(album.messages || [])),
    startedAt: Number(album.startedAt) || Date.now(),
    lastMessageAt: Number(album.lastMessageAt) || Date.now(),
    mode: album.mode === 'manual' ? 'manual' : 'automatic',
    attempts: Number(album.attempts || 0),
    state: album.state || 'collecting',
    lastError: album.lastError || null
  };
}

function pendingAlbumRetryDelay(attempts) {
  return Math.min(300000, 15000 * Math.pow(2, Math.max(0, Math.min(4, Number(attempts || 1) - 1))));
}

function manualAlbumCaptions(messages, { text = '', edited = false, contextMedia = false } = {}) {
  if (contextMedia || edited) return (messages || []).map((_message, index) => index === 0 ? String(text || '') : '');
  return (messages || []).map(message => String(message?.caption || ''));
}

function remainingAlbumMessages(messages, completedIds = []) {
  const done = new Set((completedIds || []).map(Number));
  return (messages || []).filter(message => !done.has(Number(message?.message_id)));
}

module.exports = { supportsTelegramMediaGroup, manualPhotoContextMedia, nextAlbumWaitMs, recoverInterruptedPublications, preserveCapturedPublication, interceptedMessagesWereRemoved, pendingAlbumRecord, pendingAlbumRetryDelay, manualAlbumCaptions, remainingAlbumMessages };
