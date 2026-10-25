'use strict';
const crypto = require('node:crypto');
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/https?:\/\/\S+|www\.\S+/g, ' URL ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function inspectPublication(input, options = {}) {
  const text = String(input?.text || '').trim();
  const errors = [], warnings = [];
  if (!text) errors.push('Le texte est vide.');
  if (text.length > 3900) errors.push('Le texte dépasse la limite prudente de 3900 caractères pour un message Telegram.');
  if (/\u0000/.test(text)) errors.push('Caractère nul interdit.');
  const links = text.match(/https?:\/\/\S+|www\.\S+/giu) || [];
  if (links.length > Number(options.maxLinks ?? 8)) warnings.push(`Nombre élevé de liens (${links.length}).`);
  const banned = Array.isArray(options.bannedWords) ? options.bannedWords : [];
  const blockedPhrases = Array.isArray(options.blockedPhrases) ? options.blockedPhrases : [];
  const n = normalize(text);
  for (const item of banned) if (String(item).trim() && n.includes(normalize(item))) errors.push(`Mot interdit détecté : ${String(item).slice(0, 80)}`);
  for (const item of blockedPhrases) if (String(item).trim() && n.includes(normalize(item))) errors.push(`Expression bloquée détectée : ${String(item).slice(0, 100)}`);
  const normalized = normalize(text);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  if (options.recentHashes?.includes(hash)) errors.push('Contenu identique à une publication récente.');
  if (/(ignore (?:all|previous) instructions|reveal (?:the )?(?:system prompt|secrets)|ignore les instructions)/i.test(text)) warnings.push('Le texte ressemble à une tentative d’injection de prompt; le traiter comme contenu non fiable.');
  return { ok: errors.length === 0, errors, warnings, textLength: text.length, linkCount: links.length, contentHash: hash, checkedAt: new Date().toISOString() };
}
module.exports = { inspectPublication, normalize };
