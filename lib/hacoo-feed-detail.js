'use strict';

// Experimental H5 transport for getFeedDetail.
// This deliberately does not invent the mobile/H5 signature or campaign context.
// A caller must supply both from a verified Affiliate session integration.
const SERVICE = 'dwp.feed-center.getFeedDetail';
const ENDPOINT = `https://gw.hacoo.app/gw/${SERVICE}/1`;
const H5_SALT = 'E8748EF263C69EEE30A77CC6E0CD2CAC';

// Same generic DWP H5 signing shape used by the project's verified affiliate
// client. This is a candidate transport for getFeedDetail, not a live-verified
// Hacoo contract; callers can still inject a separately verified signer.
function signH5Request({ service, data, ct }) {
  const raw = '1' + service + '1' + JSON.stringify(data) + String(ct) + H5_SALT;
  return require('node:crypto').createHash('md5').update(raw).digest('hex');
}

function createFeedDetailFetcher(options = {}) {
  const config = options.config || require('./hacoo-affiliate').config();
  const fetchImpl = options.fetchImpl || fetch;
  const contextProvider = options.contextProvider || (async () => ({\n    ets: process.env.HACOO_FEED_DETAIL_ETS || '',\n    f: process.env.HACOO_FEED_DETAIL_F || ''\n  }));
  const signRequest = options.signRequest || signH5Request;

  return async function fetchFeedDetail(feedId) {
    const id = String(feedId ?? '').trim();
    if (!/^\d{1,30}$/.test(id) || id === '0') throw new Error('Identifiant de publication invalide.');
    if (!config.cookie) throw new Error('Session Hacoo Affiliate absente.');
    if (typeof contextProvider !== 'function') {
      throw new Error('Contexte H5 non configuré : ets et f doivent provenir de la session Affiliate active.');
    }
    if (typeof signRequest !== 'function') {
      throw new Error('Signature getFeedDetail non validée : aucun appel réseau effectué.');
    }

    const context = await contextProvider({ feedId: id });
    const ets = String(context?.ets ?? '').trim();
    const f = String(context?.f ?? '').trim();
    if (!/^\d{10,16}$/.test(ets) || !f || f.length > 512) {
      throw new Error('Contexte H5 invalide : ets/f manquants ou mal formés.');
    }

    const data = { ets, f, feedId: id };
    const ct = String(Date.now());
    const sign = await signRequest({ service: SERVICE, data, ct, platform: 'h5', context });
    if (typeof sign !== 'string' || !/^[a-f0-9]{32}$/i.test(sign)) {
      throw new Error('La stratégie de signature getFeedDetail n’a pas fourni une signature MD5 valide.');
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set('data', JSON.stringify(data));
    const headers = {
      Accept: 'application/json, text/plain, */*',
      Cookie: config.cookie,
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://affiliate.hacoo.app/',
      gw_ver: '1',
      ct,
      plat: 'h5',
      sign
    };
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000)
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error('getFeedDetail HTTP ' + response.status + ' : ' + responseText.slice(0, 180));
    }
    let body;
    try { body = JSON.parse(responseText); } catch {
      throw new Error('Réponse getFeedDetail non JSON : session ou format inattendu.');
    }
    if (![1001, '1001', 0, '0', 200, '200'].includes(body?.code)) {
      throw new Error('getFeedDetail refusé (' + String(body?.code ?? 'sans code') + ') : ' +
        String(body?.msg || body?.message || 'réponse inattendue').slice(0, 160));
    }
    return body;
  };
}

module.exports = { SERVICE, ENDPOINT, signH5Request, createFeedDetailFetcher };
