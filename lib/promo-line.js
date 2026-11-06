'use strict';

function isExistingPromoLine(value) {
  const line = String(value || '').trim();
  if (!line) return false;
  if (/(?:code\s*promo|promo(?:tionnel)?\s*code|promo\s*code|coupon|code\s*de\s*réduction|code\s*réduction|use\s*code|discount\s*code)/iu.test(line)) return true;
  // Hacoo posts often use the compact format "Code –15% : M2REPS".
  // Recognize hyphen, en dash and em dash so the formatter does not append
  // the configured coupon a second time.
  if (/\bcode\s*[-–—]?\s*\d{1,3}\s*%?\s*[:：]\s*\S+/iu.test(line)) return true;
  const knownCodes = ['M2REPS', 'LINKCREW10', 'REAL150', '560RIL'];
  const normalized = line.replace(/[🎁🎟️🔥✨👉🏼⭐️:：\s]/gu, '').toUpperCase();
  return knownCodes.some(code => normalized === code || normalized === `-${code}`);
}

function hasExistingPromoLine(lines, titleIndex = -1) {
  return (lines || []).some((line, index) => index !== titleIndex && isExistingPromoLine(line));
}

module.exports = { isExistingPromoLine, hasExistingPromoLine };
