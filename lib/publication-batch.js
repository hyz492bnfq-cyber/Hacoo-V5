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

  // Un album Telegram normal porte au maximum une légende de publication.
  // Plusieurs légendes indiquent des publications distinctes : ne jamais les fusionner.
  const captionCount = ordered.filter(message =>
    String(message?.caption || message?.text || '').trim().length > 0
  ).length;

  return isOneNativeAlbum && captionCount <= 1 ? [ordered] : ordered.map(message => [message]);
}

module.exports = { splitPublicationBatches };
