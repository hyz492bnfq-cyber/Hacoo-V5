'use strict';

function supportsTelegramMediaGroup(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  // Telegram accepte un album de photos/vidéos, ou un album uniquement composé
  // de documents. Un mélange document + photo/vidéo est envoyé séquentiellement.
  return messages.every(message => message.photo || message.video) ||
    messages.every(message => message.document);
}

function nextAlbumWaitMs({ startedAt, lastMessageAt, now = Date.now(), quietMs = 5000, maxWaitMs = 60000 }) {
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

module.exports = { supportsTelegramMediaGroup, nextAlbumWaitMs, recoverInterruptedPublications, preserveCapturedPublication };
