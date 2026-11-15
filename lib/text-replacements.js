'use strict';

// Remplacement de texte configurable : chaque publication (posts du canal et
// publications programmées) passe par ces règles avant d'être envoyée.
// Les règles restent sensibles à la casse et remplacent toutes les occurrences.

const MAX_REPLACEMENTS = 50;
const MAX_FIND_LENGTH = 300;
const MAX_REPLACE_LENGTH = 600;

function normalizeReplacements(value) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return { ok: true, replacements: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'La liste de remplacements doit être un tableau.' };
  }
  if (value.length > MAX_REPLACEMENTS) {
    return { ok: false, error: `Trop de remplacements : ${value.length} (maximum ${MAX_REPLACEMENTS}).` };
  }
  const seenFind = new Set();
  const replacements = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `Remplacement n°${index + 1} invalide : attendu un objet { find, replace }.` };
    }
    const find = String(entry.find ?? '').trim();
    const replace = String(entry.replace ?? '');
    if (/\u0000/.test(find) || /\u0000/.test(replace)) {
      return { ok: false, error: `Remplacement n°${index + 1} invalide : caractère nul interdit.` };
    }
    if (!find) {
      return { ok: false, error: `Remplacement n°${index + 1} invalide : le texte d'origine (find) ne doit pas être vide.` };
    }
    if (find.length > MAX_FIND_LENGTH) {
      return { ok: false, error: `Remplacement n°${index + 1} : le texte d'origine dépasse ${MAX_FIND_LENGTH} caractères.` };
    }
    if (replace.length > MAX_REPLACE_LENGTH) {
      return { ok: false, error: `Remplacement n°${index + 1} : le texte de substitution dépasse ${MAX_REPLACE_LENGTH} caractères.` };
    }
    if (seenFind.has(find)) {
      return { ok: false, error: `Texte d'origine dupliqué : « ${find.slice(0, 80)} ».` };
    }
    seenFind.add(find);
    replacements.push({ find, replace, enabled: entry.enabled === undefined ? true : Boolean(entry.enabled) });
  }
  return { ok: true, replacements };
}

function applyTextReplacements(text, replacements) {
  const original = String(text ?? '');
  const rules = (Array.isArray(replacements) ? replacements : [])
    .filter(rule => rule && rule.enabled !== false && typeof rule.find === 'string' && rule.find.length > 0 && typeof rule.replace === 'string');
  let output = original;
  let applied = 0;
  const used = [];
  for (const rule of rules) {
    if (!output.includes(rule.find)) continue;
    const parts = output.split(rule.find);
    applied += parts.length - 1;
    output = parts.join(rule.replace);
    used.push(rule.find);
  }
  return { text: output, changed: output !== original, applied, used };
}

module.exports = { normalizeReplacements, applyTextReplacements, MAX_REPLACEMENTS, MAX_FIND_LENGTH, MAX_REPLACE_LENGTH };
