'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isHacooUrl, hasHacooLink, normalizeRules, appendConfiguredText } = require('../lib/hacoo-auto-append');

test('recognises Hacoo store URLs and Hacoo short links only', () => {
  for (const url of ['https://hacoo.app/item/1', 'http://shop.hacoo.app/p/2', 'https://hacoo.pl/x', 'https://onlyaff.app/abc']) assert.equal(isHacooUrl(url), true, url);
  for (const url of ['https://example.com/hacoo.app', 'https://hacoo.app.evil.test/x', 'https://amazon.fr/item', 'javascript:alert(1)']) assert.equal(isHacooUrl(url), false, url);
});

test('detects visible and Telegram hidden Hacoo links', () => {
  assert.equal(hasHacooLink({ text: 'Produit https://hacoo.app/item/1' }), true);
  assert.equal(hasHacooLink({ text: 'Voir le produit', entities: [{ type: 'text_link', offset: 0, length: 16, url: 'https://onlyaff.app/a' }] }), true);
  assert.equal(hasHacooLink({ caption: 'Autre site https://example.com' }), false);
});

test('normalizes per-chat rules and appends once', () => {
  const rules = normalizeRules([{ chatId: '-10012345', enabled: true, text: 'À voir' }, { chatId: 'bad', enabled: true, text: 'x' }]);
  assert.deepEqual(rules, [{ chatId: '-10012345', enabled: true, text: 'À voir' }]);
  const message = { text: 'Produit : https://hacoo.app/p/1', entities: [] };
  const result = appendConfiguredText(message, rules[0]);
  assert.equal(result.changed, true);
  assert.equal(result.text, 'Produit : https://hacoo.app/p/1\n\nÀ voir');
  assert.equal(appendConfiguredText({ ...message, text: result.text }, rules[0]).reason, 'already-appended');
});

test('preserves captions and refuses Telegram length overflow', () => {
  const caption = appendConfiguredText({ caption: 'https://hacoo.pl/p/1', caption_entities: [] }, { enabled: true, text: 'Fin' });
  assert.equal(caption.field, 'caption');
  assert.equal(caption.changed, true);
  const tooLong = appendConfiguredText({ text: 'https://hacoo.app/' + 'x'.repeat(4090) }, { enabled: true, text: 'Fin' });
  assert.equal(tooLong.reason, 'telegram-limit');
});


test('calls grammY editMessageCaption with caption as third argument', async () => {
  const { editOriginalMessage } = require('../lib/hacoo-auto-append');
  const calls = [];
  const api = { editMessageCaption: async (...args) => { calls.push(args); } };
  const message = {
    chat: { id: -100123 },
    message_id: 44,
    caption: 'https://hacoo.app/item/1',
    caption_entities: [{ type: 'bold', offset: 0, length: 4 }]
  };
  const result = appendConfiguredText(message, { enabled: true, text: 'À découvrir' });
  await editOriginalMessage(api, message, result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], -100123);
  assert.equal(calls[0][1], 44);
  assert.equal(calls[0][2], 'https://hacoo.app/item/1\n\nÀ découvrir');
  assert.deepEqual(calls[0][3], { caption_entities: message.caption_entities });
});

test('calls grammY editMessageText with text as third argument', async () => {
  const { editOriginalMessage } = require('../lib/hacoo-auto-append');
  const calls = [];
  const api = { editMessageText: async (...args) => { calls.push(args); } };
  const message = { chat: { id: -100123 }, message_id: 45, text: 'https://hacoo.app/item/2', entities: [] };
  const result = appendConfiguredText(message, { enabled: true, text: 'À découvrir' });
  await editOriginalMessage(api, message, result);
  assert.equal(calls[0][2], 'https://hacoo.app/item/2\n\nÀ découvrir');
  assert.deepEqual(calls[0][3], { entities: [] });
});

test('retains caption editing mode for photo posts', () => {
  const result = appendConfiguredText(
    { chat: { id: -100123 }, message_id: 46, photo: [{}], caption: 'https://hacoo.app/item/3' },
    { enabled: true, text: 'À découvrir' }
  );
  assert.equal(result.field, 'caption');
  assert.equal(result.changed, true);
});

test('does not append a second affiliate disclosure when the original uses small caps and emoji decorations', () => {
  const original = [
    '🛍️Pull RALPH LAUREN⚡️‼️',
    '-15% coupon : M2REPS',
    '👉https://c.onlyaff.app/ene4vd',
    '• ʟɪᴇɴ ᴀꜰꜰɪʟɪᴇ́, ᴄᴏᴍᴍɪssɪᴏɴ ᴘᴏssɪʙʟᴇ. ᴀᴜᴛʜᴇɴᴛɪᴄɪᴛᴇ́ ᴀ̀ ᴠᴇ́ʀɪꜰɪᴇʀ ᴀᴜᴘʀᴇ̀s ᴅᴜ ᴠᴇɴᴅᴇᴜʀ'
  ].join('\\n');
  const configured = '🛍️• Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur⚡️‼️';
  const result = appendConfiguredText(
    { caption: original, photo: [{}] },
    { enabled: true, text: configured }
  );
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'already-appended');
  assert.equal(result.text, original);
});


test('interdit formellement une mention affiliée comme seule légende d’une photo', () => {
  const disclosure = 'Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur';
  const emptyCaption = appendConfiguredText({ photo: [{}], caption: 'https://hacoo.app/p/empty' }, { enabled: true, text: disclosure });
  assert.equal(emptyCaption.changed, false);
  assert.equal(emptyCaption.reason, 'no-product-caption');
  const disclosureOnly = appendConfiguredText({ photo: [{}], caption: disclosure + '\\nhttps://hacoo.app/p/1' }, { enabled: true, text: disclosure });
  assert.equal(disclosureOnly.changed, false);
  assert.equal(disclosureOnly.reason, 'no-product-caption');
  const realCaption = appendConfiguredText({ photo: [{}], caption: 'ASICS Gel Nimbus 16\\nhttps://hacoo.app/p/1' }, { enabled: true, text: disclosure });
  assert.equal(realCaption.changed, true);
  assert.match(realCaption.text, /^ASICS Gel Nimbus 16\n\nLien affilié/u);
});
