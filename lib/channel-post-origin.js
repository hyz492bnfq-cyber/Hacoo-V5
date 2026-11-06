'use strict';
function isManualAdminPost(message, adminId, channelSyncMessageIds) {
  const senderId = Number(message?.from?.id || 0);
  const expectedAdminId = Number(adminId || 0);
  if (!Number.isSafeInteger(expectedAdminId) || expectedAdminId <= 0 || senderId !== expectedAdminId) return false;
  return !channelSyncMessageIds?.has?.(Number(message?.message_id));
}
module.exports = { isManualAdminPost };
