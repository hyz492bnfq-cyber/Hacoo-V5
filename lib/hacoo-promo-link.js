'use strict';

const crypto = require('node:crypto');
const { resolvePublicationFirstProduct } = require('./hacoo-publication');
const API_NAME = 'dwp.aff-home-core.promoLink';
const SALTS = { pc: '14A49D715D5457F55924291E0941D7E1', h5: 'E8748EF263C69EEE30A77CC6E0CD2CAC' };
const ENDPOINT = `https://gw.hacoo.app/gw/${API_NAME}/1`;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[),.!?;:]+$/u;

function isHacooStoreUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'hacoo.pl' || host.endsWith('.hacoo.pl') || host === 'hacoo.app' || host.endsWith('.hacoo.app');
  } catch { return false; }
}

function isOnlyaffShortUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      (host === 'onlyaff.app' || host.endsWith('.onlyaff.app'));
  } catch { return false; }
}

// Extract only a numeric product ID from a recognized Hacoo product route.
// A publication (/p/...) or an unknown route is deliberately not accepted.
function extractHacooProductId(value) {
  try {
    const url = new URL(String(value || ''));
    if (!isHacooStoreUrl(url.toString())) return null;
    const match = url.pathname.match(/\\/(?:detail|product)\\/(\\d+)(?:\\/|$)/i);
    if (!match || match[1] === '0') return null;
    return match[1];
  } catch { return null; }
}

function canonicalHacooProductUrl(itemId) {
  const id = String(itemId || '').trim();
  if (!/^\\d{1,30}$/.test(id) || id === '0') throw new Error('Identifiant produit Hacoo invalide.');
  return 'https://www.hacoo.pl/en-FR/detail/' + encodeURIComponent(id);
}

async function resolveHacooShortUrl(shortUrl, options = {}) {
  if (!isOnlyaffShortUrl(shortUrl)) throw new Error('Lien court non reconnu.');
  const fetchImpl = options.resolveFetchImpl || fetch;
  let current = new URL(shortUrl);
  for (let hop = 0; hop < 6; hop++) {
    const host = current.hostname.toLowerCase();
    const allowedHost = host === 'onlyaff.app' || host.endsWith('.onlyaff.app') ||
      host === 'hacoo.pl' || host.endsWith('.hacoo.pl') ||
      host === 'hacoo.app' || host.endsWith('.hacoo.app');
    if (current.protocol !== 'https:' || !allowedHost || current.username || current.password) {
      throw new Error('Redirection refusée : domaine non autorisé.');
    }
    const response = await fetchImpl(current.toString(), {
      method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(10000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location');
      if (!location) throw new Error('Redirection du lien court sans destination.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error('Résolution du lien court impossible (HTTP ' + response.status + ').');
    const destination = current.toString();
    if (!isHacooStoreUrl(destination)) {
      throw new Error('Le lien court ne mène pas directement à une page produit Hacoo.');
    }
    return destination;
  }
  throw new Error('Trop de redirections pour ce lien court Hacoo.');
}

function extractUrls(text = '') {
  return [...String(text).matchAll(URL_PATTERN)].map(match => {
    const raw = match[0], url = raw.replace(TRAILING_PUNCTUATION, '');
    return { raw, url, index: match.index, suffix: raw.slice(url.length) };
  });
}

function sign(data, timestamp, platform) {
  const salt = SALTS[platform];
  if (!salt) throw new Error('Plateforme Hacoo non prise en charge pour la signature.');
  return crypto.createHash('md5').update('1' + API_NAME + '1' + JSON.stringify(data) + String(timestamp) + salt).digest('hex');
}

async function createPromoLink(productUrl, options = {}) {
  if (!isHacooStoreUrl(productUrl)) throw new Error('URL ignorée : ce n’est pas une URL de boutique Hacoo prise en charge.');
  const config = options.config || require('./hacoo-affiliate').config();
  const platform = String(config.platform || 'pc').toLowerCase();
  const cookieSid = (String(config.cookie || '').match(/(?:^|;\\s*)sid=([^;]+)/i) || [])[1] || '';
  const sid = String(options.sid || config.sid || process.env.HACOO_PROMO_LINK_SID || cookieSid).trim();
  if (!config.cookie || !config.appname || !sid || !SALTS[platform]) {
    throw new Error('Connexion Hacoo Affiliate incomplète : vérifie le cookie, le SID, la plateforme et le nom d’application dans FadeHost.');
  }
  const timestamp = String(options.timestamp || Date.now());
  const data = { link: String(productUrl) };
  const params = new URLSearchParams({
    data: JSON.stringify(data), gw_ver: '1', ct: timestamp, plat: platform,
    appname: config.appname, sign: sign(data, timestamp, platform)
  });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(ENDPOINT + '?sid=' + encodeURIComponent(sid), {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Cookie: config.cookie, 'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://affiliate.hacoo.app',
      Referer: 'https://affiliate.hacoo.app/fr-FR/promotion/link'
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000)
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error('Hacoo Affiliate HTTP ' + response.status + ' : ' + responseText.slice(0, 180));
  let body;
  try { body = JSON.parse(responseText); } catch { throw new Error('Réponse Hacoo non JSON : session probablement expirée.'); }
  const shortUrl = String(body?.data?.promoLink || '').trim();
  if (![1001, '1001', 0, '0', 200, '200'].includes(body?.code) || !shortUrl) {
    throw new Error('Hacoo a refusé la génération (' + String(body?.code ?? 'sans code') + ') : ' + String(body?.msg || body?.dmsg || 'réponse inattendue').slice(0, 180));
  }
  let parsed;
  try { parsed = new URL(shortUrl); } catch { throw new Error('Hacoo a renvoyé un lien affilié invalide.'); }
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'onlyaff.app' || parsed.hostname.endsWith('.onlyaff.app'))) {
    throw new Error('Hacoo a renvoyé un domaine de lien court inattendu.');
  }
  return shortUrl;
}

async function replaceHacooLinks(text = '', options = {}) {
  const source = String(text || '');
  const matches = extractUrls(source).filter(item => isHacooStoreUrl(item.url) || isOnlyaffShortUrl(item.url));
  if (!matches.length) return { text: source, changed: false, errors: [] };
  const cache = options.cache || new Map(), resolvedCache = options.resolvedCache || new Map();
  const replacements = [], errors = [];
  for (const item of matches) {
    try {
      let productUrl = item.url;
      if (isHacooStoreUrl(item.url) && /^\/p\/\d+\/?$/.test(new URL(item.url).pathname)) {
        const publication = await resolvePublicationFirstProduct(item.url, {
          fetchFeedDetail: options.fetchFeedDetail
        });
        if (publication.status !== 'product' || !publication.productUrl) {
          throw new Error('Publication Hacoo non convertie (' + publication.status + ') : lien original conservé.');
        }
        productUrl = publication.productUrl;
      }
      if (isOnlyaffShortUrl(item.url)) {
        let destination = resolvedCache.get(item.url);
        if (!destination) {
          destination = await resolveHacooShortUrl(item.url, options);
          resolvedCache.set(item.url, destination);
        }
        const itemId = extractHacooProductId(destination);
        if (!itemId) {
          throw new Error('Le lien affilié ne mène pas à une fiche produit Hacoo avec identifiant vérifiable : lien original conservé.');
        }
        productUrl = canonicalHacooProductUrl(itemId);
      }
      let shortUrl = cache.get(productUrl);
      if (!shortUrl) {
        shortUrl = await createPromoLink(productUrl, options);
        cache.set(productUrl, shortUrl);
      }
      replacements.push({ ...item, shortUrl });
    } catch (error) {
      errors.push({ url: item.url, message: String(error?.message || error).slice(0, 220) });
    }
  }
  let output = source;
  for (const item of replacements.sort((a, b) => b.index - a.index)) {
    output = output.slice(0, item.index) + item.shortUrl + item.suffix + output.slice(item.index + item.raw.length);
  }
  return { text: output, changed: output !== source, errors };
}

module.exports = { isHacooStoreUrl, isOnlyaffShortUrl, extractHacooProductId, canonicalHacooProductUrl, resolveHacooShortUrl, extractUrls, sign, createPromoLink, replaceHacooLinks };
