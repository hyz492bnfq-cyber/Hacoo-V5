'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVICE, ENDPOINT, signH5Request, createFeedDetailFetcher } = require('../lib/hacoo-feed-detail');

test('n’effectue aucun appel si la signature validée est absente', async () => {
  let calls = 0;
  const fetchFeedDetail = createFeedDetailFetcher({
    config: { cookie: 'session=test' },
    contextProvider: async () => ({ ets: '1794576803237', f: 'campaign-context' }),
    fetchImpl: async () => { calls++; throw new Error('unexpected'); }
  });
  await assert.rejects(fetchFeedDetail('15607115'), /Signature getFeedDetail non validée/);
  assert.equal(calls, 0);
});

test('construit une requête H5 getFeedDetail avec contexte et signature injectés', async () => {
  let captured;
  const fetchFeedDetail = createFeedDetailFetcher({
    config: { cookie: 'session=test' },
    contextProvider: async ({ feedId }) => {
      assert.equal(feedId, '15607115');
      return { ets: '1794576803237', f: 'campaign-context' };
    },
    signRequest: async input => {
      assert.equal(input.service, SERVICE);
      assert.deepEqual(input.data, { ets: '1794576803237', f: 'campaign-context', feedId: '15607115' });
      assert.equal(input.platform, 'h5');
      return 'a'.repeat(32);
    },
    fetchImpl: async (url, init) => {
      captured = { url: new URL(url), init };
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: 1001, data: { productCardDetail: [] } }) };
    }
  });

  const result = await fetchFeedDetail('15607115');
  assert.equal(result.code, 1001);
  assert.equal(captured.url.origin + captured.url.pathname, ENDPOINT);
  assert.deepEqual(JSON.parse(captured.url.searchParams.get('data')), {
    ets: '1794576803237', f: 'campaign-context', feedId: '15607115'
  });
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.plat, 'h5');
  assert.equal(captured.init.headers.sign, 'a'.repeat(32));
  assert.equal(captured.init.headers.Cookie, 'session=test');
});

test('refuse les identifiants invalides avant tout accès réseau', async () => {
  let calls = 0;
  const fetchFeedDetail = createFeedDetailFetcher({
    config: { cookie: 'session=test' },
    contextProvider: async () => ({ ets: '1794576803237', f: 'campaign-context' }),
    signRequest: async () => 'a'.repeat(32),
    fetchImpl: async () => { calls++; throw new Error('unexpected'); }
  });
  await assert.rejects(fetchFeedDetail('../15607115'), /Identifiant de publication invalide/);
  assert.equal(calls, 0);
});

test('refuse une réponse métier en erreur', async () => {
  const fetchFeedDetail = createFeedDetailFetcher({
    config: { cookie: 'session=test' },
    contextProvider: async () => ({ ets: '1794576803237', f: 'campaign-context' }),
    signRequest: async () => 'b'.repeat(32),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 401, msg: 'unauthorized' }) })
  });
  await assert.rejects(fetchFeedDetail('15607115'), /getFeedDetail refusé \(401\)/);
});


test('signe la requête H5 avec la forme DWP documentée dans le projet', () => {
  const crypto = require('node:crypto');
  const data = { ets: '1794576803237', f: 'campaign-context', feedId: '15607115' };
  const ct = '1794576803237';
  const expected = crypto.createHash('md5').update('1' + SERVICE + '1' + JSON.stringify(data) + ct + 'E8748EF263C69EEE30A77CC6E0CD2CAC').digest('hex');
  assert.equal(signH5Request({ service: SERVICE, data, ct }), expected);
});
