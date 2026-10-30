'use strict';

function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) distance++;
  return distance;
}

function colorSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 24 || b.length !== 24) return null;
  let distance = 0;
  for (let index = 0; index < 24; index++) distance += Math.abs(Number(a[index]) - Number(b[index]));
  return Math.max(0, Math.min(1, 1 - distance / 6));
}

function strongVisualDuplicateEvidence(current, previous) {
  for (const source of current || []) {
    for (const candidate of previous || []) {
      if (source.fileUniqueId && candidate.fileUniqueId && source.fileUniqueId === candidate.fileUniqueId) {
        return { strong: true, reason: 'Fichier Telegram identique' };
      }
      const distance = hashDistance(source.hash, candidate.hash);
      const colors = colorSimilarity(source.colorSignature, candidate.colorSignature);
      // Seuil volontairement très strict : deux photos d'un même modèle dans
      // une autre couleur ou sous un autre cadrage ne doivent pas être effacées.
      if (distance <= 6 && colors !== null && colors >= 0.96) {
        return { strong: true, reason: 'Empreinte et couleurs quasi identiques' };
      }
    }
  }
  return { strong: false, reason: 'Photos différentes ou comparaison visuelle insuffisante' };
}

module.exports = { hashDistance, colorSimilarity, strongVisualDuplicateEvidence };
