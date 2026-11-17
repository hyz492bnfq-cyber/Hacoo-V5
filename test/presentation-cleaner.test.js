'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPresentationLine } = require('../lib/presentation-cleaner');

test('retire les anciennes décorations en bordure avant de reformater', () => {
  assert.equal(cleanPresentationLine('🔥 ✨ Veste noire 🤩‼️'), 'Veste noire');
  assert.equal(cleanPresentationLine('👉🏼 https://example.test/produit 🔗'), 'https://example.test/produit');
});

test('préserve un emoji informatif au milieu du texte', () => {
  assert.equal(cleanPresentationLine('Veste avec logo ⭐ discret', { edgesOnly: true }), 'Veste avec logo ⭐ discret');
});

test('le nettoyage de présentation ne retire jamais une URL', () => {
  assert.equal(cleanPresentationLine('🔥 https://example.test/produit ✨'), 'https://example.test/produit');
});

test('supprime les lignes strictement répétées sans fusionner les informations différentes', () => {
  const { removeRepeatedPublicationLines } = require('../lib/presentation-cleaner');
  const input = [
    '🛍️APPLE AIRPODS PRO 3⚡️‼️',
    'CODE PROMO :',
    '👉https://c.onlyaff.app/ebYkh9',
    '• Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    'ℹ️ • Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    '👉https://c.onlyaff.app/ebYkh9',
    'CODE PROMO :',
    'Une autre information produit'
  ].join('\n');

  assert.equal(removeRepeatedPublicationLines(input), [
    '🛍️APPLE AIRPODS PRO 3⚡️‼️',
    'CODE PROMO :',
    '👉https://c.onlyaff.app/ebYkh9',
    '• Lien affilié · Commission possible · Authenticité à vérifier auprès du vendeur',
    'Une autre information produit'
  ].join('\n'));
});

test('déduplique les mentions affiliées malgré petites capitales, puces et ponctuation différentes', () => {
  const { removeRepeatedPublicationLines, hasAffiliateDisclosure } = require('../lib/presentation-cleaner');
  const input = [
    'Produit A',
    '• Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur',
    '🛍️• ʟɪᴇɴ ᴀꜰꜰɪʟɪᴇ́, ᴄᴏᴍᴍɪssɪᴏɴ ᴘᴏssɪʙʟᴇ. ᴀᴜᴛʜᴇɴᴛɪᴄɪᴛᴇ́ ᴀ̀ ᴠᴇ́ʀɪꜰɪᴇʀ ᴀᴜᴘʀᴇ̀s ᴅᴜ ᴠᴇɴᴅᴇᴜʀ⚡️‼️',
    'ℹ️ • LIEN AFFILIÉ — COMMISSION POSSIBLE — AUTHENTICITÉ À VÉRIFIER AUPRÈS DU VENDEUR'
  ].join('\n');
  const result = removeRepeatedPublicationLines(input);
  assert.equal(result.split('\n').length, 2);
  assert.equal(hasAffiliateDisclosure(result), true);
});

test('reconnaît une mention affiliée même si elle est au milieu du texte', () => {
  const { hasAffiliateDisclosure } = require('../lib/presentation-cleaner');
  assert.equal(hasAffiliateDisclosure('Titre\nℹ️ Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur\nLien produit'), true);
});

test('ne fusionne pas des informations produit ou des liens distincts', () => {
  const { removeRepeatedPublicationLines } = require('../lib/presentation-cleaner');
  const input = 'Produit rouge\nProduit bleu\nhttps://example.test/a\nhttps://example.test/b';
  assert.equal(removeRepeatedPublicationLines(input), input);
});


test('une mention affiliée seule ne constitue jamais une légende produit', () => {
  const { hasSubstantivePublicationText, removeAffiliateDisclosureLines } = require('../lib/presentation-cleaner');
  const disclosure = '🛍️• ʟɪᴇɴ ᴀꜰꜰɪʟɪᴇ́, ᴄᴏᴍᴍɪssɪᴏɴ ᴘᴏssɪʙʟᴇ. ᴀᴜᴛʜᴇɴᴛɪᴄɪᴛᴇ́ ᴀ̀ ᴠᴇ́ʀɪꜰɪᴇʀ ᴀᴜᴘʀᴇ̀s ᴅᴜ ᴠᴇɴᴅᴇᴜʀ⚡️‼️';
  assert.equal(hasSubstantivePublicationText(disclosure), false);
  assert.equal(removeAffiliateDisclosureLines(disclosure), '');
  assert.equal(hasSubstantivePublicationText('ASICS Gel Nimbus 16\n' + disclosure), true);
  assert.equal(hasSubstantivePublicationText('https://c.onlyaff.app/eohYlc'), false);
});


test('reconnaît la mention affiliée collée au titre sans confondre les deux', () => {
  const { hasAffiliateDisclosure, hasSubstantivePublicationText } = require('../lib/presentation-cleaner');
  const value = 'ASICS Gel Nimbus 16 \\n • Lien affilié, commission possible. Authenticité à vérifier auprès du vendeur';
  assert.equal(hasAffiliateDisclosure(value), true);
  assert.equal(hasSubstantivePublicationText(value), true);
});
