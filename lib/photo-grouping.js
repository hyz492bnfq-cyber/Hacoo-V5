'use strict';

function shouldAppendPhotoToGroup(group, message, mode, now, windowMs, getText, quietMs = windowMs) {
  if (!message?.photo?.length || message.media_group_id) return false;
  if (!group?.anchor?.photo?.length || group.mode !== mode) return false;

  const startedAt = Number(group.startedAt);
  const lastMessageAt = Number(group.lastMessageAt ?? group.startedAt);
  const currentTime = Number(now);
  const maxWindow = Number(windowMs);
  const maxQuiet = Number(quietMs);
  if (![startedAt, lastMessageAt, currentTime, maxWindow, maxQuiet].every(Number.isFinite) ||
      maxWindow < 0 || maxQuiet < 0 || currentTime < lastMessageAt ||
      currentTime - startedAt > maxWindow || currentTime - lastMessageAt > maxQuiet) {
    return false;
  }

  const readText = typeof getText === 'function'
    ? item => String(getText(item) || '').trim()
    : item => String(item?.caption || item?.text || '').trim();
  const existingMessages = [group.anchor, ...(Array.isArray(group.photos) ? group.photos : [])]
    .filter(Boolean);
  if (!existingMessages.length) return false;

  const groupHasCaption = existingMessages.some(item =>
    Boolean(item?.photo?.length) && Boolean(readText(item))
  );
  const incomingHasCaption = Boolean(readText(message));

  // Une seule légende peut se trouver à n'importe quelle position de la séquence.
  // Une deuxième légende est une frontière prudente entre deux publications :
  // les albums Telegram natifs (media_group_id) restent gérés séparément.
  if (groupHasCaption && incomingHasCaption) return false;

  const last = existingMessages[existingMessages.length - 1];
  const lastId = Number(last?.message_id);
  const incomingId = Number(message?.message_id);
  if (Number.isFinite(lastId) && Number.isFinite(incomingId) && incomingId !== lastId + 1) {
    return false;
  }

  return true;
}

module.exports = { shouldAppendPhotoToGroup };
