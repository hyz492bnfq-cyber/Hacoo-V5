'use strict';

function shouldAppendPhotoToGroup(group, message, mode, now, windowMs, getText) {
  if (!message?.photo?.length || message.media_group_id) return false;
  if (!group || group.mode !== mode) return false;

  const startedAt = Number(group.startedAt);
  const currentTime = Number(now);
  const maxWindow = Number(windowMs);
  if (!Number.isFinite(startedAt) || !Number.isFinite(currentTime) ||
      !Number.isFinite(maxWindow) || maxWindow < 0 ||
      currentTime < startedAt || currentTime - startedAt > maxWindow) {
    return false;
  }

  const readText = typeof getText === 'function'
    ? item => String(getText(item) || '').trim()
    : item => String(item?.caption || item?.text || '').trim();

  const existingMessages = [
    group.anchor,
    ...(Array.isArray(group.photos) ? group.photos : [])
  ].filter(Boolean);
  if (!existingMessages.length) return false;

  const anchorHasCaption = Boolean(readText(group.anchor));
  const groupHasCaption = existingMessages.some(item =>
    Boolean(item?.photo?.length) && Boolean(readText(item))
  );
  const incomingHasCaption = Boolean(readText(message));

  // Une légende sur la première photo est le format courant des posts Hacoo :
  // les photos suivantes sans légende appartiennent au même post.
  // Une deuxième légende marque en revanche une nouvelle publication.
  if (groupHasCaption && incomingHasCaption) return false;

  // Si la légende arrive après les premières photos, elle ferme le groupe.
  if (groupHasCaption && !anchorHasCaption) return false;

  const last = existingMessages[existingMessages.length - 1];
  const lastId = Number(last?.message_id);
  const incomingId = Number(message?.message_id);
  // Un trou dans la séquence indique qu'un autre message a pu s'intercaler.
  if (Number.isFinite(lastId) && Number.isFinite(incomingId) && incomingId !== lastId + 1) {
    return false;
  }

  return true;
}

module.exports = { shouldAppendPhotoToGroup };
