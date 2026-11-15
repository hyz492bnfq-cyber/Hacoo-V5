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

  const anchorHasCaption = Boolean(readText(group.anchor));
  const groupHasCaption = existingMessages.some(item =>
    Boolean(item?.photo?.length) && Boolean(readText(item))
  );
  const incomingHasCaption = Boolean(readText(message));

  // Le cas visé : la première photo porte la légende, les suivantes non.
  // Une deuxième légende constitue une frontière nette entre deux posts.
  if (groupHasCaption && incomingHasCaption) return false;

  // Si la légende arrive après la première photo, elle ferme la séquence :
  // impossible de savoir si une photo suivante appartient au post ou au suivant.
  if (groupHasCaption && !anchorHasCaption) return false;

  const last = existingMessages[existingMessages.length - 1];
  const lastId = Number(last?.message_id);
  const incomingId = Number(message?.message_id);
  if (Number.isFinite(lastId) && Number.isFinite(incomingId) && incomingId !== lastId + 1) {
    return false;
  }

  return true;
}

module.exports = { shouldAppendPhotoToGroup };
