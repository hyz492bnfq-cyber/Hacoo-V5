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
  'ᴀ': 'a', 'ᴃ': 'b', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f',
  'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l',
  'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r',
  'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y',
  'ᴢ': 'z'
});

function normalizeDisclosureText(value) {
  return String(value || '')
    .replace(/[ᴀᴃʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ]/gu, character => SMALL_CAPS_TRANSLATION[character] || character)
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function isAffiliateDisclosureLine(value) {
  const normalized = normalizeDisclosureText(value);
  // Reconnaissance stricte : une ligne produit qui contient aussi la mention
  // ne doit jamais être confondue avec une mention affiliée isolée.
  return normalized === 'lienaffiliecommissionpossibleauthenticiteaverifier' ||
    normalized === 'lienaffiliecommissionpossibleauthenticiteaverifieraupresduvendeur';
}

function hasAffiliateDisclosure(value) {
  // Recherche la mention même si une ancienne source l'a collée au titre
  // sur la même ligne. La détection d'une ligne affiliée seule reste stricte.
  return normalizeDisclosureText(value).includes(
    'lienaffiliecommissionpossibleauthenticiteaverifier'
  );
}

// Une mention légale ne constitue jamais, à elle seule, une légende produit.
// Les URL seules ne sont pas non plus considérées comme une description.
function hasSubstantivePublicationText(value) {
  return String(value || '').split(/\r?\n/u).some(line => {
    const trimmed = line.trim();
    if (!trimmed || isAffiliateDisclosureLine(trimmed)) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/iu.test(trimmed)) return false;
    return true;
  });
}

function removeAffiliateDisclosureLines(value) {
  return String(value || '').split(/\r?\n/u)
    .filter(line => !isAffiliateDisclosureLine(line))
    .join('\n').replace(/\n{3,}/gu, '\n\n').trim();
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
    const key = isAffiliateDisclosureLine(line) ? '__affiliate_disclosure__' : (normalizedKey || line.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr'));
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(rawLine);
  }

  return output.join('\n').trim();
}

module.exports = { cleanPresentationLine, removeRepeatedPublicationLines, isAffiliateDisclosureLine, hasAffiliateDisclosure, hasSubstantivePublicationText, removeAffiliateDisclosureLines };
