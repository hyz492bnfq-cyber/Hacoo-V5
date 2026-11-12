'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vault = require('../lib/publication-vault');

const key = Buffer.alloc(32, 7);

test('AES-256-GCM chiffre et déchiffre les données', () => {
  const plain = Buffer.from('publication privée avec légende et média');
  const encrypted = vault.encryptBuffer(plain, key);
  assert.notDeepEqual(encrypted, plain);
  assert.deepEqual(vault.decryptBuffer(encrypted, key), plain);
});

test('AES-256-GCM refuse une clé erronée et les données altérées', () => {
  const encrypted = vault.encryptBuffer(Buffer.from('secret'), key);
  assert.throws(() => vault.decryptBuffer(encrypted, Buffer.alloc(32, 8)));
  const altered = Buffer.from(encrypted);
  altered[altered.length - 1] ^= 1;
  assert.throws(() => vault.decryptBuffer(altered, key));
});

test('une archive conserve le manifeste et les médias chiffrés, puis vérifie leur intégrité', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hacoo-vault-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const media = Buffer.from('PRIVATE-MEDIA-CONTENT-DO-NOT-STORE-PLAINTEXT');
  const records = [{ messageId: 11, text: 'Légende privée', groupedId: 'album-1', mediaFileId: '11', fileName: 'photo.jpg' }];
  const archive = await vault.createArchive({
    root, key, channelId: '-1001234567890', channelTitle: 'Canal test',
    records, mediaBuffers: new Map([['11', media]])
  });
  const manifest = await vault.readArchive({ root, id: archive.id, key, verify: true });
  assert.equal(manifest.records[0].text, 'Légende privée');
  assert.deepEqual(await vault.readMedia({ root, archiveId: archive.id, fileId: '11', key }), media);
  const files = await fs.readdir(path.join(root, archive.id));
  for (const name of files) {
    const bytes = await fs.readFile(path.join(root, archive.id, name));
    assert.equal(bytes.includes(Buffer.from('PRIVATE-MEDIA-CONTENT-DO-NOT-STORE-PLAINTEXT')), false);
    assert.equal(bytes.includes(Buffer.from('Légende privée')), false);
  }
});

test('la clé est obligatoire et doit contenir exactement 32 octets', () => {
  assert.throws(() => vault.getKey(''));
  assert.throws(() => vault.getKey('not-a-key'));
  assert.equal(vault.getKey(key).length, 32);
});
