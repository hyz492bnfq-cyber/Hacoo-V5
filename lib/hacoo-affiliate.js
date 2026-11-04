'use strict';

const crypto = require('node:crypto');

const API_NAME = 'dwp.aff-home-core.modelReportList';
const SALTS = {
  pc: '14A49D715D5457F55924291E0941D7E1',
  h5: 'E8748EF263C69EEE30A77CC6E0CD2CAC'
};
const ENDPOINT = 'https://gw.hacoo.app/';

function config() {
  return {
    cookie: String(process.env.HACOO_AFFILIATE_COOKIE || '').trim(),
    appname: String(process.env.HACOO_AFFILIATE_APPNAME || '').trim(),
    platform: String(process.env.HACOO_AFFILIATE_PLATFORM || 'pc').trim().toLowerCase(),
    sid: String(process.env.HACOO_AFFILIATE_SID || '').trim(),
    webId: String(process.env.HACOO_AFFILIATE_WEB_ID || '').trim()
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.cookie && c.appname && SALTS[c.platform]);
}

function sign(data, timestamp, platform) {
  const raw = '1' + API_NAME + '1' + JSON.stringify(data) + timestamp + SALTS[platform];
  return crypto.createHash('md5').update(raw).digest('hex');
}

async function fetchPage(current = 1) {
  const c = config();
  if (!c.cookie || !c.appname || !SALTS[c.platform]) {
    throw new Error('Configuration Hacoo Affiliate incomplète : renseigne HACOO_AFFILIATE_COOKIE, HACOO_AFFILIATE_APPNAME et HACOO_AFFILIATE_PLATFORM dans FadeHost.');
  }
  const data = { current, size: 40, attrModel: 'order_f_info' };
  const timestamp = String(Date.now());
  const params = new URLSearchParams({
    sid: c.sid,
    data: JSON.stringify(data),
    gw_ver: '1',
    ct: timestamp,
    plat: c.platform,
    appname: c.appname,
    sign: sign(data, timestamp, c.platform)
  });
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Cookie: c.cookie,
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://affiliate.hacoo.app/'
  };
  if (c.webId) headers['x-web-id'] = c.webId;
  const response = await fetch(ENDPOINT + '?' + params.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error('Hacoo Affiliate HTTP ' + response.status + ' : ' + text.slice(0, 240));
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('Réponse Hacoo Affiliate non JSON : vérifie la session et les paramètres de connexion.'); }
  if (body.code && ![0, 200, '0', '200'].includes(body.code)) {
    throw new Error('Hacoo Affiliate a refusé la requête (' + body.code + ') : ' + String(body.msg || body.message || 'erreur inconnue').slice(0, 180));
  }
  const payload = body.data || body.result || {};
  if (!Array.isArray(payload.records)) throw new Error('Format de réponse Hacoo inattendu : liste records absente.');
  return { records: payload.records, total: Number(payload.total || 0), pages: Math.max(1, Number(payload.pages || 1)), current: Number(payload.current || current) };
}

async function fetchAllOrders() {
  const first = await fetchPage(1);
  const records = [...first.records];
  const pages = Math.min(100, first.pages);
  for (let page = 2; page <= pages; page++) {
    const result = await fetchPage(page);
    records.push(...result.records);
  }
  return { records, total: first.total, pages };
}

module.exports = { config, isConfigured, fetchPage, fetchAllOrders };
