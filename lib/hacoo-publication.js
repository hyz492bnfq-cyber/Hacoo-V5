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
    values.some(domain => !/(^|\.)hacoo\.(pl|app)$/.test(domain)) ||
    platforms.some(platform => !['hacoo', 'saramart', ''].includes(platform));
}

function selectFirstPublicationProduct(detail) {
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'code') &&
      ![1001, '1001', 0, '0', 200, '200'].includes(detail.code)) {
    return { status: 'api-error', productUrl: null };
  }

  const cards = asCards(detail?.data?.productCardDetail ?? detail?.productCardDetail);
  for (const card of cards) {
    // Only explicitly identified non-product modules may be skipped safely.
    if (card && typeof card === 'object' && card.moduleType &&
        card.moduleType !== 'item_detail_card' &&
        card.moduleData?.item_id == null && card.item_id == null &&
        card.out_site !== true && card.moduleData?.out_site !== true &&
        !card.extPlat && !card.moduleData?.extPlat && !card.domain && !card.moduleData?.domain) {
      continue;
    }

    if (!card || typeof card !== 'object') return { status: 'unrecognized', productUrl: null };
    const data = card.moduleData && typeof card.moduleData === 'object' ? card.moduleData : card;

    // Foreign products are skipped; keep looking for the first Hacoo product.
    if (isExternalCard(card, data)) continue;

    // Unknown card shape is ambiguous: do not jump over it.
    if (card.moduleType !== 'item_detail_card' && data.item_id == null && card.item_id == null) {
      return { status: 'unrecognized', productUrl: null };
    }

    // The first Hacoo product is decisive. An invalid ID does not permit
    // falling through to a later Hacoo product.
    const itemId = String(data.item_id ?? card.item_id ?? '').trim();
    if (!/^\d{1,30}$/.test(itemId) || itemId === '0') {
      return { status: 'invalid-item-id', productUrl: null };
    }
    return { status: 'product', itemId, productUrl: PRODUCT_URL + encodeURIComponent(itemId) };
  }

  return { status: 'no-valid-hacoo-product', productUrl: null };
}

async function resolvePublicationFirstProduct(publicationUrl, options = {}) {
  let url;
  try { url = new URL(String(publicationUrl)); } catch {
    return { status: 'invalid-url', productUrl: null };
  }
  const match = url.pathname.match(/^\/p\/(\d+)\/?$/);
  if (!['hacoo.pl', 'www.hacoo.pl', 'hacoo.app', 'www.hacoo.app'].includes(url.hostname.toLowerCase()) ||
      url.protocol !== 'https:' || !match) {
    return { status: 'not-publication', productUrl: null };
  }
  if (typeof options.fetchFeedDetail !== 'function') {
    return { status: 'unavailable-auth', productUrl: null };
  }
  try {
    return selectFirstPublicationProduct(await options.fetchFeedDetail(match[1]));
  } catch {
    return { status: 'api-error', productUrl: null };
  }
}

module.exports = { asCards, isExternalCard, selectFirstPublicationProduct, resolvePublicationFirstProduct };
