'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTelegramMessageAlreadyGone } = require('../lib/telegram-errors');

test('reconnaît les messages déjà absents comme une suppression idempotente', () => {
  assert.equal(isTelegramMessageAlreadyGone({ description: 'Bad Request: message to delete not found' }), true);
  assert.equal(isTelegramMessageAlreadyGone({ error_code: 400, description: 'Bad Request: message_id_invalid' }), true);
  assert.equal(isTelegramMessageAlreadyGone(new Error('Message not found')), true);
});

test('ne masque pas les erreurs de permission, de réseau ou de limitation', () => {
  assert.equal(isTelegramMessageAlreadyGone({ description: 'Forbidden: not enough rights to delete messages' }), false);
  assert.equal(isTelegramMessageAlreadyGone(new Error('ETIMEDOUT while calling Telegram')), false);
  assert.equal(isTelegramMessageAlreadyGone({ error_code: 429, description: 'Too Many Requests' }), false);
  assert.equal(isTelegramMessageAlreadyGone({ description: 'Bad Request: message can not be deleted' }), false);
});
