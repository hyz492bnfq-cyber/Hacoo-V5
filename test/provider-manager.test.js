'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerStatus, testProvider } = require('../lib/provider-manager');

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

test('OpenRouter utilise le modèle Gemma demandé par défaut et transmet les prompts longs sans les couper à 12 Ko', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-openrouter-model-'));
  try {
    const env = { OPENROUTER_API_KEY: 'test-key', V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json') };
    const { PROVIDERS, callProvider } = require('../lib/provider-manager');
    assert.equal(PROVIDERS.openrouter.defaultModel, 'google/gemma-4-26b-a4b-it');
    const result = await callProvider('openrouter', 'x'.repeat(20000), { maxTokens: 12000, timeoutMs: 1000 }, env);
    assert.equal(result.ok, true);
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(request.body.model, 'google/gemma-4-26b-a4b-it');
    assert.equal(request.body.max_tokens, 12000);
    assert.equal(request.body.messages[1].content.length, 20000);
    assert.match(request.init.headers.Authorization, /^Bearer test-key$/);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('les erreurs OpenRouter exposent un statut exploitable sans exposer la clé', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-openrouter-errors-'));
  try {
    const result = await require('../lib/provider-manager').callProvider('openrouter', 'hello', {}, {
      OPENROUTER_API_KEY: 'test-key',
      V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json')
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unauthorized');
    assert.equal(result.httpStatus, 401);
    assert.match(result.message, /Invalid API key/);
    assert.equal(JSON.stringify(result).includes('test-key'), false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
