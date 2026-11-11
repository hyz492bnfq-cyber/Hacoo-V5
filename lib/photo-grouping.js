'use strict';

function shouldAppendPhotoToGroup(group, message, mode, now, windowMs, getText) {
  if (!group || group.mode !== mode || now - group.startedAt > windowMs) return false;

  // A photo caption may arrive on the first OR a later photo. Once a photo
  // in this group already carries a caption, another captioned photo is a
  // reliable boundary between two independently captioned posts.
  const groupAlreadyHasPhotoCaption = [group.anchor, ...(group.photos || [])]
    .some(item => Boolean(item?.photo?.length) && Boolean(String(getText(item) || '').trim()));

  return !(message?.photo?.length && String(getText(message) || '').trim() && groupAlreadyHasPhotoCaption);
}

module.exports = { shouldAppendPhotoToGroup };
