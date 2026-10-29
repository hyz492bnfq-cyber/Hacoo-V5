'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerStatus, testProvider, callProvider, generateText } = require('../lib/provider-manager');

test('provider status reports configuration without exposing API keys', () => {
  const status = providerStatus({ GEMINI_API_KEY: 'secret-g', GROQ_API_KEY: '', OPENROUTER_API_KEY: 'secret-o' });
  assert.deepEqual(status.map(x => [x.id, x.configured]), [['gemini', true], ['groq', false], ['openrouter', true], ['nvidia', false]]);
  assert.equal(JSON.stringify(status).includes('secret-g'), false);
  assert.equal(JSON.stringify(status).includes('secret-o'), false);

  const nvidiaStatus = providerStatus({ NVIDIA_API: 'secret-n' });
  assert.equal(nvidiaStatus.find(x => x.id === 'nvidia').configured, true);
  assert.equal(nvidiaStatus.find(x => x.id === 'nvidia').keyVariable, 'NVIDIA_API');
});

test('unconfigured provider is not called', async () => {
  const result = await testProvider('groq', {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.keyVariable, 'GROQ_API_KEY');
});

test('callProvider intègre NVIDIA avec NVIDIA_API et NVIDIA_MODEL', async () => {
  const originalFetch = global.fetch;
  try {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody = null;
    global.fetch = async (url, init) => {
      capturedUrl = String(url);
      const headers = init?.headers;
      capturedAuth = headers
        ? (typeof headers.get === 'function' ? String(headers.get('Authorization') || '') : String(headers.Authorization || headers.authorization || ''))
        : '';
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const env = { NVIDIA_API: 'test-nvidia-key', NVIDIA_MODEL: 'nvidia/llama-3.1-nv-instruct' };
    const res = await callProvider('nvidia', 'Réponds uniquement par OK.', { maxTokens: 8 }, env);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'connected');
    assert.equal(res.model, 'nvidia/llama-3.1-nv-instruct');
    assert.ok(capturedUrl.startsWith('https://integrate.api.nvidia.com/v1/chat/completions'), `URL NVIDIA inattendue: ${capturedUrl}`);
    assert.equal(capturedAuth, 'Bearer test-nvidia-key');
    assert.equal(capturedBody.model, 'nvidia/llama-3.1-nv-instruct');
    assert.equal(capturedBody.max_tokens, 8);
  } finally {
    global.fetch = originalFetch;
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

test('generateText bascule automatiquement vers le second fournisseur en cas d erreur API', async () => {
  const originalFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-failover-'));
  try {
    let calls = 0;
    global.fetch = async (url, init) => {
      calls += 1;
      const parsed = JSON.parse(init.body);
      if (calls === 1) {
        // Gemini : quota / rate limit
        return new Response(JSON.stringify({ error: { message: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': '30' } });
      }
      // NVIDIA : succes
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const env = {
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      NVIDIA_API: 'test-nvidia-key',
      NVIDIA_MODEL: 'nvidia/llama-3.1-nv-instruct',
      V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json')
    };
    const res = await generateText('Génère une fonction TypeScript pour l endpoint API', { maxTokens: 900 }, env);
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'nvidia');
    assert.equal(calls, 2, 'Le premier fournisseur en echec doit declarer le basculement vers le second');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
