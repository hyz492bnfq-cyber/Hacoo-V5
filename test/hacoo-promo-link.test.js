'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isHacooStoreUrl, isOnlyaffShortUrl, resolveHacooShortUrl, extractUrls, sign, replaceHacooLinks } = require('../lib/hacoo-promo-link');

test('reconnaît uniquement les domaines de boutique Hacoo sécurisés', () => {
  assert.equal(isHacooStoreUrl('https://www.hacoo.pl/en-FR/detail/40886057'), true);
  assert.equal(isHacooStoreUrl('https://m.hacoo.app/product/123'), true);
  assert.equal(isHacooStoreUrl('http://www.hacoo.pl/detail/1'), false);
  assert.equal(isHacooStoreUrl('https://example.com/hacoo.pl'), false);
  assert.equal(isHacooStoreUrl('https://c.onlyaff.app/dTzXl3'), false);
  assert.equal(isOnlyaffShortUrl('https://c.onlyaff.app/dTzXl3'), true);
  assert.equal(isOnlyaffShortUrl('https://example.com/dTzXl3'), false);
});

test('extrait les URL sans leur ponctuation finale', () => {
  assert.deepEqual(extractUrls('Produit https://www.hacoo.pl/detail/1, puis https://example.com/a.').map(x => x.url), [
    'https://www.hacoo.pl/detail/1', 'https://example.com/a'
  ]);
});

test('la signature promoLink correspond à la requête Hacoo observée', () => {
  assert.equal(sign({ link: 'https://www.hacoo.pl/en-FR/detail/40886057' }, '1793919275815', 'pc'), 'cbc70fd4af0ee56677f66866a8c76259');
});

test('remplace chaque lien Hacoo et conserve les autres domaines et la ponctuation', async () => {
  const config = { cookie: 'sid=test', sid: '10', appname: 'saramart', platform: 'pc' };
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const data = JSON.parse(new URLSearchParams(init.body).get('data'));
    const id = data.link.endsWith('/1') ? 'one' : 'two';
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 1001, data: { promoLink: `https://c.onlyaff.app/${id}`, linkType: 'DETAIL' } }) };
  };
  const result = await replaceHacooLinks('A https://www.hacoo.pl/detail/1, B https://m.hacoo.app/detail/2! C https://example.com/x', { config, fetchImpl, timestamp: '123' });
  assert.equal(calls, 2);
  assert.equal(result.changed, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.text, 'A https://c.onlyaff.app/one, B https://c.onlyaff.app/two! C https://example.com/x');
});

test('en cas de refus Hacoo, conserve le lien original et signale l’erreur', async () => {
  const config = { cookie: 'sid=test', sid: '10', appname: 'saramart', platform: 'pc' };
  const result = await replaceHacooLinks('https://www.hacoo.pl/detail/1', {
    config, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 102500001, msg: 'invalid landing page' }) }), timestamp: '123'
  });
  assert.equal(result.text, 'https://www.hacoo.pl/detail/1');
  assert.equal(result.changed, false);
  assert.equal(result.errors.length, 1);
});

test('résout un lien court onlyaff vers une URL Hacoo en suivant uniquement les redirections autorisées', async () => {
  const seen = [];
  const resolveFetchImpl = async (url, init) => {
    seen.push({ url, redirect: init.redirect });
    if (seen.length === 1) return { status: 302, ok: false, headers: { get: name => name.toLowerCase() === 'location' ? 'https://www.hacoo.pl/en-FR/detail/40886057' : null } };
    return { status: 200, ok: true, headers: { get: () => null } };
  };
  const result = await resolveHacooShortUrl('https://c.onlyaff.app/dTzXl3', { resolveFetchImpl });
  assert.equal(result, 'https://www.hacoo.pl/en-FR/detail/40886057');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].redirect, 'manual');
});

test('refuse une redirection d’un lien court vers un domaine externe', async () => {
  await assert.rejects(
    resolveHacooShortUrl('https://c.onlyaff.app/dTzXl3', {
      resolveFetchImpl: async () => ({ status: 302, ok: false, headers: { get: () => 'https://example.com/steal' } })
    }),
    /domaine non autorisé/
  );
});

test('remplace aussi les liens affiliés reçus avec un nouveau lien généré pour le compte connecté', async () => {
  const config = { cookie: 'sid=test', appname: 'saramart', platform: 'pc' };
  let generated = 0;
  const resolveFetchImpl = async (url, init) => ({
    status: 302, ok: false,
    headers: { get: () => 'https://www.hacoo.pl/en-FR/detail/40886057' }
  });
  const fetchImpl = async (_url, init) => {
    generated++;
    const data = JSON.parse(new URLSearchParams(init.body).get('data'));
    assert.equal(data.link, 'https://www.hacoo.pl/en-FR/detail/40886057');
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 1001, data: { promoLink: 'https://c.onlyaff.app/NEWCODE', linkType: 'DETAIL' } }) };
  };
  const result = await replaceHacooLinks('Regarde : https://c.onlyaff.app/OLD-CODE !', {
    config, resolveFetchImpl, fetchImpl, timestamp: '123'
  });
  assert.equal(generated, 1);
  assert.equal(result.text, 'Regarde : https://c.onlyaff.app/NEWCODE !');
  assert.equal(result.errors.length, 0);
});

test('si le lien court ne mène pas à Hacoo, conserve le lien reçu', async () => {
  const result = await replaceHacooLinks('https://c.onlyaff.app/OLD-CODE', {
    config: { cookie: 'sid=test', appname: 'saramart', platform: 'pc' },
    resolveFetchImpl: async () => ({ status: 302, ok: false, headers: { get: () => 'https://example.com/not-hacoo' } }),
    fetchImpl: async () => { throw new Error('Ne doit pas appeler promoLink'); }
  });
  assert.equal(result.text, 'https://c.onlyaff.app/OLD-CODE');
  assert.equal(result.changed, false);
  assert.equal(result.errors.length, 1);
});
