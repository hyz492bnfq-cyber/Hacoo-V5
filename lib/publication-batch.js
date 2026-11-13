'use strict';

/**
 * Telegram media_group_id is the only reliable proof that several incoming
 * messages belong to one native album. Without one shared, non-empty ID,
 * preserve every message as an independent publication.
 */
function splitPublicationBatches(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const ordered = messages.slice().sort((a, b) => Number(a?.message_id || 0) - Number(b?.message_id || 0));
  if (ordered.length === 1) return [ordered];

  const groupId = ordered[0]?.media_group_id;
  const chatId = ordered[0]?.chat?.id;
  const isOneNativeAlbum = groupId !== undefined && groupId !== null && String(groupId).trim() !== '' &&
    ordered.every(message => message?.media_group_id !== undefined &&
      message?.media_group_id !== null &&
      String(message.media_group_id) === String(groupId) &&
      String(message?.chat?.id ?? '') === String(chatId ?? ''));

  // Le media_group_id Telegram est la preuve d'appartenance à un même album.
  // Plusieurs médias d'un album peuvent porter chacun une légende : ne pas les séparer.
  return isOneNativeAlbum ? [ordered] : ordered.map(message => [message]);
}

module.exports = { splitPublicationBatches };
