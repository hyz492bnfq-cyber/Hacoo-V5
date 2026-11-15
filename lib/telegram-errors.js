'use strict';

const MESSAGE_ALREADY_GONE = /message to delete not found|message_id_invalid|message not found/i;

function isTelegramMessageAlreadyGone(error) {
  const description = String(error?.description || error?.message || error || '');
  return MESSAGE_ALREADY_GONE.test(description);
}

module.exports = { isTelegramMessageAlreadyGone };
