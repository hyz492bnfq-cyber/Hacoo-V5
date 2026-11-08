'use strict';

const PRODUCT_URL = 'https://www.hacoo.pl/en-FR/detail/';
const PUBLIC_HOSTS = new Set(['hacoo.pl', 'www.hacoo.pl', 'hacoo.app', 'www.hacoo.app']);
const MAX_HTML_BYTES = 1_500_000;

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
    if (card && typeof card === 'object' && card.moduleType &&
        card.moduleType !== 'item_detail_card' &&
        card.moduleData?.item_id == null && card.item_id == null &&
        card.out_site !== true && card.moduleData?.out_site !== true &&
        !card.extPlat && !card.moduleData?.extPlat && !card.domain && !card.moduleData?.domain) continue;
    if (!card || typeof card !== 'object') return { status: 'unrecognized', productUrl: null };
    const data = card.moduleData && typeof card.moduleData === 'object' ? card.moduleData : card;
    // The first product card is authoritative: never skip an external product
    // to silently convert a later card from the same publication.
    if (isExternalCard(card, data)) return { status: 'external-first-product', productUrl: null };
    if (card.moduleType !== 'item_detail_card' && data.item_id == null && card.item_id == null) {
      return { status: 'unrecognized', productUrl: null };
    }
    const itemId = String(data.item_id ?? card.item_id ?? '').trim();
    if (!/^\d{1,30}$/.test(itemId) || itemId === '0') return { status: 'invalid-item-id', productUrl: null };
    return { status: 'product', itemId, productUrl: PRODUCT_URL + encodeURIComponent(itemId) };
  }
  return { status: 'no-valid-hacoo-product', productUrl: null };
}

function findProductDetail(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return null;
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, 'productCardDetail')) return value;
  const values = Array.isArray(value) ? value : Object.values(value);
  for (const child of values) {
    const found = findProductDetail(child, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function parsePublicPublicationHtml(html) {
  const source = String(html || '');
  if (!source || Buffer.byteLength(source, 'utf8') > MAX_HTML_BYTES) {
    return { status: 'no-public-product-data', productUrl: null };
  }
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu);
  for (const match of scripts) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const isJson = /type\s*=\s*["']application\/(?:ld\+)?json["']/iu.test(attrs) ||
      /(?:__NEXT_DATA__|__NUXT__|initialState|initialData)/iu.test(attrs);
    if (!isJson || !body.trim()) continue;
    try {
      const detail = findProductDetail(JSON.parse(body.trim()));
      if (detail) return selectFirstPublicationProduct(detail);
    } catch {
      // Ignore unrelated scripts; never execute page JavaScript.
    }
  }
  return { status: 'no-public-product-data', productUrl: null };
}

async function fetchPublicPublicationDetail(publicationUrl, options = {}) {
  let current;
  try { current = new URL(String(publicationUrl)); } catch {
    return { status: 'invalid-url', productUrl: null };
  }
  if (current.protocol !== 'https:' || !PUBLIC_HOSTS.has(current.hostname.toLowerCase()) ||
      !/^\/p\/\d+\/?$/.test(current.pathname)) return { status: 'not-publication', productUrl: null };

  const fetchImpl = options.fetchImpl || fetch;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetchImpl(current.toString(), {
        method: 'GET', redirect: 'manual',
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.('location');
        if (!location || hop === 3) return { status: 'public-page-unavailable', productUrl: null };
        const next = new URL(location, current);
        if (next.protocol !== 'https:' || !PUBLIC_HOSTS.has(next.hostname.toLowerCase())) {
          return { status: 'public-page-unavailable', productUrl: null };
        }
        current = next;
        continue;
      }
      if (!response.ok) return { status: 'public-page-unavailable', productUrl: null };
      const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) {
        return { status: 'public-page-unavailable', productUrl: null };
      }
      return parsePublicPublicationHtml(await response.text());
    }
  } catch {
    return { status: 'public-page-unavailable', productUrl: null };
  }
  return { status: 'public-page-unavailable', productUrl: null };
}

async function resolvePublicationFirstProduct(publicationUrl, options = {}) {
  let url;
  try { url = new URL(String(publicationUrl)); } catch {
    return { status: 'invalid-url', productUrl: null };
  }
  const match = url.pathname.match(/^\/p\/(\d+)\/?$/);
  if (!PUBLIC_HOSTS.has(url.hostname.toLowerCase()) || url.protocol !== 'https:' || !match) {
    return { status: 'not-publication', productUrl: null };
  }
  // Prefer an explicitly configured, verified API transport. Otherwise try
  // public page HTML only; never replay mobile credentials or invent a signature.
  if (typeof options.fetchFeedDetail === 'function') {
    try { return selectFirstPublicationProduct(await options.fetchFeedDetail(match[1])); }
    catch { return { status: 'api-error', productUrl: null }; }
  }
  return fetchPublicPublicationDetail(url.toString(), options);
}

module.exports = {
  asCards, isExternalCard, selectFirstPublicationProduct,
  parsePublicPublicationHtml, fetchPublicPublicationDetail,
  resolvePublicationFirstProduct
};
