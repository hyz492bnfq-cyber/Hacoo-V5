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

  // A photo caption may arrive on the first OR a later photo. Once a photo
  // in this group already carries a caption, another captioned photo is a
  // reliable boundary between two independently captioned posts.
  const existingMessages = [
    group.anchor,
    ...(Array.isArray(group.photos) ? group.photos : [])
  ];
  const groupAlreadyHasPhotoCaption = existingMessages.some(item =>
    Boolean(item?.photo?.length) && Boolean(readText(item))
  );

  return !(readText(message) && groupAlreadyHasPhotoCaption);
}

module.exports = { shouldAppendPhotoToGroup };
