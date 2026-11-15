'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeReplacements, applyTextReplacements } = require('../lib/text-replacements');
const { createSchedule, processDueSchedules, listSchedules } = require('../lib/publication-scheduler');

test('normalizeReplacements valide, nettoie et tolère une liste vide', () => {
  assert.deepEqual(normalizeReplacements(undefined), { ok: true, replacements: [] });
  assert.deepEqual(normalizeReplacements('x').ok, false);

  const result = normalizeReplacements([
    { find: ' 12345678 ', replace: '87654321', enabled: false },
    { find: 'Promo', replace: 'OFFRE' }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.replacements[0].find, '12345678');
  assert.equal(result.replacements[0].enabled, false);
  assert.equal(result.replacements[1].enabled, true);
});

test('normalizeReplacements refuse les entrées invalides avec un diagnostic', () => {
  assert.match(normalizeReplacements([{ replace: 'x' }]).error, /find.*vide/);
  assert.match(normalizeReplacements([{ find: 'abc', replace: 'x' }, { find: 'abc', replace: 'y' }]).error, /dupliqué/);
  assert.match(normalizeReplacements({ find: 'x', replace: 'y' }).error, /tableau/);
  assert.match(normalizeReplacements(Array.from({ length: 51 }, (_, i) => ({ find: `t${i}`, replace: 'r' }))).error, /Trop de remplacements/);
  assert.match(normalizeReplacements([{ find: 'a\u0000b', replace: 'r' }]).error, /caractère nul/);
  assert.match(normalizeReplacements([{ find: 'x'.repeat(301), replace: 'r' }]).error, /300 caractères/);
  assert.match(normalizeReplacements([{ find: 'x', replace: 'r'.repeat(601) }]).error, /600 caractères/);
  assert.equal(normalizeReplacements([{ find: 'x', replace: 'r', extra: 1 }]).ok, true, 'les champs inconnus sont tolérés');
});

test('applyTextReplacements remplace toutes les occurrences et ignore les désactivés', () => {
  const rules = [
    { find: '12345678', replace: '87654321', enabled: true },
    { find: 'OFFRE', replace: 'PROMO', enabled: false }
  ];
  const result = applyTextReplacements('Achat: 12345678 et rappel 12345678', rules);
  assert.equal(result.text, 'Achat: 87654321 et rappel 87654321');
  assert.equal(result.changed, true);
  assert.equal(result.applied, 2);

  const unchanged = applyTextReplacements('Texte sans cible', rules);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.applied, 0);
  assert.equal(unchanged.text, 'Texte sans cible');

  const disabled = applyTextReplacements('Code OFFRE', rules);
  assert.equal(disabled.text, 'Code OFFRE');
});

test('processDueSchedules envoie le texte remplacé et conserve le texte d origine', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-replacements-'));
  try {
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true, mode: 0o700 });
    const schedule = createSchedule(
      root,
      { text: 'Contact 12345678 pour commander', scheduledAt: new Date(Date.now() + 120000).toISOString() },
      { defaultChannel: '-100123' }
    );
    const replacedHash = require('node:crypto').createHash('sha256').update('Contact 87654321 pour commander'.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/https?:\/\/\S+|www\.\S+/g, ' URL ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()).digest('hex');
    assert.notEqual(schedule.contentHash, replacedHash, 'le hash d origine differe du texte remplace');

    // Rend la publication déjà arrivée à échéance sans réécrire createSchedule.
    const store = path.join(root, 'workspace', 'scheduled-publications.json');
    const rows = JSON.parse(fs.readFileSync(store, 'utf8'));
    rows[0].scheduledAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(store, JSON.stringify(rows));

    const sentTexts = [];
    const bot = { api: { sendMessage: async (chatId, text) => { sentTexts.push({ chatId, text }); return { message_id: 42 }; } } };
    const data = {
      publishedHashes: [],
      textReplacements: [{ find: '12345678', replace: '87654321', enabled: true }]
    };
    await processDueSchedules({ rootDir: root, bot, data, allowedChannels: ['-100123'], notifyAdmin: async () => {} });

    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].text, 'Contact 87654321 pour commander');
    assert.equal(sentTexts[0].chatId, '-100123');
    assert.equal(data.publishedHashes.includes(replacedHash), true, 'le hash du texte remplacé sert au dédoublonnage');
    assert.equal(data.publishedHashes.includes(schedule.contentHash), true, 'le hash d origine reste conservé');
    const after = listSchedules(root).find(row => row.id === schedule.id);
    assert.equal(after.status, 'sent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('processDueSchedules sans remplacement conserve le comportement initial', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-replacements-'));
  try {
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true, mode: 0o700 });
    createSchedule(
      root,
      { text: 'Texte inchangé', scheduledAt: new Date(Date.now() + 120000).toISOString() },
      { defaultChannel: '-100123' }
    );
    const store = path.join(root, 'workspace', 'scheduled-publications.json');
    const rows = JSON.parse(fs.readFileSync(store, 'utf8'));
    rows[0].scheduledAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(store, JSON.stringify(rows));

    const sentTexts = [];
    const bot = { api: { sendMessage: async (chatId, text) => { sentTexts.push(text); return { message_id: 7 }; } } };
    await processDueSchedules({ rootDir: root, bot, data: {}, allowedChannels: ['-100123'] });

    assert.equal(sentTexts[0], 'Texte inchangé');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
