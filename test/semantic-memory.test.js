'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { remember, list } = require('../lib/semantic-memory');
test('stores explainable memory with restrictive file permissions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-memory-'));
  const item = remember(root, { category: 'style', content: 'Ton concis et clair', explanation: 'Préférence éditoriale confirmée' });
  assert.equal(list(root)[0].id, item.id);
  assert.equal(list(root)[0].rawPublicationData, false);
  fs.rmSync(root, { recursive: true, force: true });
});
