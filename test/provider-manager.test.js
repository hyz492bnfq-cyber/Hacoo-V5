'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerStatus, testProvider, callProvider } = require('../lib/provider-manager');

test('provider status reports configuration without exposing API keys', () => {
  const status = providerStatus({ GEMINI_API_KEY: 'secret-g', GROQ_API_KEY: '', OPENROUTER_API_KEY: 'secret-o' });
  assert.deepEqual(status.map(x => [x.id, x.configured]), [['gemini', true], ['groq', false], ['openrouter', true]]);
  assert.equal(JSON.stringify(status).includes('secret-g'), false);
  assert.equal(JSON.stringify(status).includes('secret-o'), false);
});

test('unconfigured provider is not called', async () => {
  const result = await testProvider('groq', {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.keyVariable, 'GROQ_API_KEY');
});


test('structured plan responses stay complete beyond the former 12,000-character cutoff', async () => {
  const originalFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-json-'));
  const plan = JSON.stringify({
    summary: 'long plan',
    files: [{ path: 'lib/sample.js', patches: [{ find: 'a', replace: 'b'.repeat(13000) }] }]
  });
  const requests = [];
  global.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, request });
    const body = url.includes('generativelanguage.googleapis.com')
      ? { candidates: [{ content: { parts: [{ text: plan }] } }] }
      : { choices: [{ message: { content: plan } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const cooldownFile = path.join(temp, 'cooldowns.json');
  const providers = [
    ['gemini', { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' }],
    ['groq', { GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' }],
    ['openrouter', { OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test-model' }]
  ];
  try {
    for (const [provider, credentials] of providers) {
      const result = await callProvider(provider, 'Return a JSON plan', { maxTokens: 6000, jsonMode: true }, {
        ...credentials, V6_PROVIDER_COOLDOWN_FILE: cooldownFile
      });
      assert.equal(result.ok, true, provider);
      assert.equal(result.text, plan, provider);
      assert.deepEqual(JSON.parse(result.text), JSON.parse(plan));
    }
    assert.equal(requests[0].request.generationConfig.responseMimeType, 'application/json');
    for (const { request } of requests.slice(1)) {
      assert.deepEqual(request.response_format, { type: 'json_object' });
    }
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('provider cooldown prevents repeated calls after HTTP 429', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response('rate limit exceeded', { status: 429, headers: { 'retry-after': '45' } });
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-cooldown-'));
  try {
    const env = { GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model', V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json') };
    const first = await require('../lib/provider-manager').callProvider('groq', 'hello', {}, env);
    delete require.cache[require.resolve('../lib/provider-manager')];
    const restartedManager = require('../lib/provider-manager');
    const second = await restartedManager.callProvider('groq', 'hello again', {}, env);
    assert.equal(first.status, 'rate_limited');
    assert.equal(first.retryAfterMs, 45000);
    assert.equal(second.status, 'rate_limited');
    assert.equal(calls, 1, 'second attempt should be stopped locally during cooldown');
    const saved = JSON.parse(fs.readFileSync(env.V6_PROVIDER_COOLDOWN_FILE, 'utf8'));
    assert.ok(saved.groq > Date.now(), 'cooldown should survive a process restart');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
