'use strict';

const PRODUCT_URL = 'https://www.hacoo.pl/en-FR/detail/';

function asCards(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function isExternalCard(card, data) {
  const values = [card?.domain, data?.domain].filter(Boolean).map(value => String(value).toLowerCase());
  const platforms = [card?.extPlat, data?.extPlat].filter(Boolean).map(value => String(value).toLowerCase());
  return card?.out_site === true || data?.out_site === true ||
    values.some(domain => !/(^|\\.)hacoo\\.(pl|app)$/.test(domain)) ||
    platforms.some(platform => !['hacoo', 'saramart', ''].includes(platform));
}

/**
 * Selects the first identifiable product card only. Explicit non-product
 * modules may precede it, but an unrecognized leading entry makes the order
 * ambiguous and therefore fails closed rather than silently skipping it.
 */
function selectFirstPublicationProduct(detail) {
  // The mobile endpoint uses code 1001 for a successful business response.
  // If an envelope explicitly reports another code, never trust a partial data payload.
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'code') &&
      ![1001, '1001', 0, '0', 200, '200'].includes(detail.code)) {
    return { status: 'api-error', productUrl: null };
  }
  const cards = asCards(detail?.data?.productCardDetail ?? detail?.productCardDetail);
  const isProductCandidate = card => card && (
    card.moduleType === 'item_detail_card' ||
    card.moduleData?.item_id != null ||
    card.item_id != null ||
    card.out_site === true ||
    card.moduleData?.out_site === true ||
    card.extPlat || card.moduleData?.extPlat ||
    card.domain || card.moduleData?.domain
  );
  const firstIndex = cards.findIndex(isProductCandidate);

  if (firstIndex < 0) return { status: 'unrecognized', productUrl: null };
  // A preceding unknown entry could itself be the first product in a newer
  // response schema. Do not jump over it to a later, recognizable product.
  if (cards.slice(0, firstIndex).some(card =>
    !card || typeof card !== 'object' || !String(card.moduleType || '').trim()
  )) {
    return { status: 'unrecognized', productUrl: null };
  }

  const first = cards[firstIndex];
  const data = first.moduleData && typeof first.moduleData === 'object' ? first.moduleData : first;

  if (isExternalCard(first, data)) return { status: 'external', productUrl: null };
  const rawId = data.item_id ?? first.item_id;
  const itemId = String(rawId ?? '').trim();
  if (!/^\\d{1,30}$/.test(itemId) || itemId === '0') {
    return { status: 'invalid-item-id', productUrl: null };
  }
  return { status: 'product', itemId, productUrl: PRODUCT_URL + encodeURIComponent(itemId) };
}

/**
 * The network/authentication layer is injected intentionally: the mobile
 * getFeedDetail authentication has not yet been validated for the server.
 */
async function resolvePublicationFirstProduct(publicationUrl, options = {}) {
  let url;
  try { url = new URL(String(publicationUrl)); } catch {
    return { status: 'invalid-url', productUrl: null };
  }
  const match = url.pathname.match(/^\\/p\\/(\\d+)\\/?$/);
  if (!['hacoo.pl', 'www.hacoo.pl', 'hacoo.app', 'www.hacoo.app'].includes(url.hostname.toLowerCase()) ||
      url.protocol !== 'https:' || !match) {
    return { status: 'not-publication', productUrl: null };
  }
  if (typeof options.fetchFeedDetail !== 'function') {
    return { status: 'unavailable-auth', productUrl: null };
  }
  try {
    const detail = await options.fetchFeedDetail(match[1]);
    return selectFirstPublicationProduct(detail);
  } catch {
    return { status: 'api-error', productUrl: null };
  }
}

module.exports = { asCards, isExternalCard, selectFirstPublicationProduct, resolvePublicationFirstProduct };
