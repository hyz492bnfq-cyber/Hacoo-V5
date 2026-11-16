'use strict';

// Marqueurs décoratifs fréquents dans les publications. Ils ne portent pas
// d'information produit et doivent être remplacés, pas cumulés.
const KNOWN_DECORATIONS = /(?:🛍️?|🤩|‼️?|🔥|🎟️?|🎁|🔗|👉🏼?|🚨|⭐️?|✨|💥|⚡️?|📦|🛒|✅|❌|💯|⬇️?|⬆️?|➡️?|➜|➤)/gu;
const EDGE_EMOJIS = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\s]+|[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\s]+$/gu;

function cleanPresentationLine(value, { edgesOnly = false } = {}) {
  let output = String(value || '');
  if (!edgesOnly) output = output.replace(KNOWN_DECORATIONS, '');
  // Les emojis au milieu d'une phrase peuvent décrire le produit. Seuls les
  // marqueurs placés au bord de la ligne sont supprimés systématiquement.
  output = output.replace(EDGE_EMOJIS, '').replace(/[ \t]{2,}/g, ' ').trim();
  return output;
}

const SMALL_CAPS_TRANSLATION = Object.freeze({
  'ᴀ': 'a', 'ᴃ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f',
  'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l',
  'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r',
  'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y',
  'ᴢ': 'z'
});

function normalizeDisclosureText(value) {
  return String(value || '')
    .replace(/[ᴀᴃᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ]/gu, character => SMALL_CAPS_TRANSLATION[character] || character)
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\\p{L}\\p{N}]+/gu, '');
}

function isAffiliateDisclosureLine(value) {
  const normalized = normalizeDisclosureText(value);
  return normalized.includes('lienaffilie') &&
    normalized.includes('commissionpossible') &&
    normalized.includes('authenticiteaverifier');
}

function hasAffiliateDisclosure(value) {
  return String(value || '').split('\\n').some(isAffiliateDisclosureLine);
}

function removeRepeatedPublicationLines(value) {
  const seen = new Set();
  const output = [];
  let previousBlank = false;

  for (const rawLine of String(value || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (!previousBlank && output.length) output.push('');
      previousBlank = true;
      continue;
    }

    previousBlank = false;
    const normalizedKey = line.replace(/^ℹ️?/u, '').normalize('NFKC').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
    const key = normalizedKey || line.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(rawLine);
  }

  return output.join('\n').trim();
}

module.exports = { cleanPresentationLine, removeRepeatedPublicationLines, isAffiliateDisclosureLine, hasAffiliateDisclosure };
