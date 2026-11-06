'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isManualAdminPost } = require('../lib/channel-post-origin');
test('un post écrit par l’administrateur contourne les doublons', () => assert.equal(isManualAdminPost({ message_id: 10, from: { id: 123 } }, 123, new Set()), true));
test('un transfert manuel de l’administrateur contourne les doublons', () => assert.equal(isManualAdminPost({ message_id: 11, from: { id: 123 }, forward_origin: { type: 'channel' } }, 123, new Set()), true));
test('un post Channel Sync conserve le contrôle anti-doublon', () => assert.equal(isManualAdminPost({ message_id: 12, from: { id: 123 } }, 123, new Set([12])), false));
test('un autre auteur conserve le contrôle anti-doublon', () => assert.equal(isManualAdminPost({ message_id: 13, from: { id: 456 } }, 123, new Set()), false));
test('un auteur masqué ne contourne pas le contrôle anti-doublon', () => assert.equal(isManualAdminPost({ message_id: 14, sender_chat: { id: -100 } }, 123, new Set()), false));
