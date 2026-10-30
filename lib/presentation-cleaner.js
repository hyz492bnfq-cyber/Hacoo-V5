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

module.exports = { cleanPresentationLine };
