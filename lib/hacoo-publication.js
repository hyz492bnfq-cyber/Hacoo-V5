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
 * Selects the first product card only. It deliberately does not skip an
 * external first card to try a later Hacoo product.
 */
function selectFirstPublicationProduct(detail) {
  const cards = asCards(detail?.data?.productCardDetail ?? detail?.productCardDetail);
  const first = cards.find(card => card && (
    card.moduleType === 'item_detail_card' ||
    card.moduleData?.item_id != null ||
    card.item_id != null ||
    card.out_site === true ||
    card.moduleData?.out_site === true ||
    card.extPlat || card.moduleData?.extPlat ||
    card.domain || card.moduleData?.domain
  ));

  if (!first) return { status: 'unrecognized', productUrl: null };
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
