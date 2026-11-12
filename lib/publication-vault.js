'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('M2PV1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(value = process.env.PUBLICATION_VAULT_KEY) {
  const raw = String(value || '').trim();
  if (/^[a-f0-9]{64}$/iu.test(raw)) return Buffer.from(raw, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const key = Buffer.from(raw, 'base64');
    if (key.length === 32) return key;
  }
  throw new Error('Coffre-fort désactivé : ajoute PUBLICATION_VAULT_KEY (clé aléatoire de 32 octets en hexadécimal ou Base64) dans FadeHost.');
}

function encryptBuffer(input, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBuffer(input, key) {
  if (!Buffer.isBuffer(input) || input.length < MAGIC.length + IV_BYTES + TAG_BYTES || !input.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Archive chiffrée invalide ou tronquée.');
  }
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const bodyStart = tagStart + TAG_BYTES;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, input.subarray(ivStart, tagStart));
  decipher.setAuthTag(input.subarray(tagStart, bodyStart));
  return Buffer.concat([decipher.update(input.subarray(bodyStart)), decipher.final()]);
}

function safeId(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Identifiant d’archive invalide.');
  return id;
}

async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
}

async function writeEncryptedFile(filePath, bytes, key) {
  const temp = `${filePath}.tmp-${crypto.randomBytes(5).toString('hex')}`;
  const encrypted = encryptBuffer(bytes, key);
  try {
    await fs.writeFile(temp, encrypted, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readEncryptedFile(filePath, key) {
  const encrypted = await fs.readFile(filePath);
  return decryptBuffer(encrypted, key);
}

async function createArchive({ root, channelId, channelTitle, records, mediaBuffers, key }) {
  getKey(key);
  await ensurePrivateDir(root);
  const id = `vault-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const finalDir = path.join(root, id);
  const tempDir = path.join(root, `.${id}.tmp`);
  await ensurePrivateDir(tempDir);
  const files = [];
  let totalBytes = 0;
  try {
    for (const [fileId, bytes] of mediaBuffers) {
      const name = safeId(fileId);
      const hash = await writeEncryptedFile(path.join(tempDir, `${name}.enc`), bytes, key);
      files.push({ id: name, sha256: hash, bytes: bytes.length });
      totalBytes += bytes.length;
    }
    const manifest = {
      version: 1,
      id,
      channelId: String(channelId),
      channelTitle: String(channelTitle || '').slice(0, 150),
      createdAt: new Date().toISOString(),
      messageCount: records.length,
      mediaCount: files.length,
      totalBytes,
      records,
      files
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    await writeEncryptedFile(path.join(tempDir, 'manifest.enc'), manifestBytes, key);
    await fs.rename(tempDir, finalDir);
    await fs.chmod(finalDir, 0o700).catch(() => {});
    return { id, manifest };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function readArchive({ root, id, key, verify = false }) {
  const safe = safeId(id);
  const dir = path.join(root, safe);
  const raw = await readEncryptedFile(path.join(dir, 'manifest.enc'), key);
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.version !== 1 || manifest.id !== safe || !Array.isArray(manifest.records) || !Array.isArray(manifest.files)) {
    throw new Error('Manifeste de sauvegarde invalide.');
  }
  if (verify) {
    for (const file of manifest.files) {
      const bytes = await readEncryptedFile(path.join(dir, `${safeId(file.id)}.enc`), key);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (hash !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Intégrité incorrecte pour le média ${file.id}.`);
    }
  }
  return manifest;
}

async function readMedia({ root, archiveId, fileId, key }) {
  return readEncryptedFile(path.join(root, safeId(archiveId), `${safeId(fileId)}.enc`), key);
}

async function listArchives({ root, key }) {
  await ensurePrivateDir(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const archives = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('vault-')) continue;
    try {
      const manifest = await readArchive({ root, id: entry.name, key });
      archives.push({
        id: manifest.id,
        channelId: manifest.channelId,
        channelTitle: manifest.channelTitle,
        createdAt: manifest.createdAt,
        messageCount: manifest.messageCount,
        mediaCount: manifest.mediaCount,
        totalBytes: manifest.totalBytes
      });
    } catch {
      archives.push({ id: entry.name, unreadable: true });
    }
  }
  return archives.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

module.exports = { getKey, encryptBuffer, decryptBuffer, createArchive, readArchive, readMedia, listArchives, ensurePrivateDir };
