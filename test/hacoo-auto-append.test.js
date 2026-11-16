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
