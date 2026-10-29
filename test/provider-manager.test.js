'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerStatus, testProvider, callProvider, generateText, resolveProviderChain } = require('../lib/provider-manager');

test('provider status reports configuration without exposing API keys', () => {
  const status = providerStatus({ GEMINI_API_KEY: 'secret-g', GROQ_API_KEY: '', OPENROUTER_API_KEY: 'secret-o' });
  assert.deepEqual(status.map(x => [x.id, x.configured]), [['gemini', true], ['groq', false], ['openrouter', true], ['nvidia', false], ['nemotron', false], ['minimax', false]]);
  assert.equal(JSON.stringify(status).includes('secret-g'), false);
  assert.equal(JSON.stringify(status).includes('secret-o'), false);

  const nvidiaStatus = providerStatus({ NVIDIA_API: 'secret-n' });
  assert.equal(nvidiaStatus.find(x => x.id === 'nvidia').configured, true);
  assert.equal(nvidiaStatus.find(x => x.id === 'nvidia').keyVariable, 'NVIDIA_API');
  assert.equal(nvidiaStatus.find(x => x.id === 'minimax').configured, true, 'MiniMax reutilise la variable NVIDIA_API');
  assert.equal(nvidiaStatus.find(x => x.id === 'minimax').keyVariable, 'NVIDIA_API');

  const nemotronStatus = providerStatus({ NVIDIA_APIR: 'secret-n' });
  assert.equal(nemotronStatus.find(x => x.id === 'nemotron').configured, true);
  assert.equal(nemotronStatus.find(x => x.id === 'nemotron').keyVariable, 'NVIDIA_APIR');
});

test('les fournisseurs legacy sont absents du tableau de bord (liste active)', async () => {
  const { activeProviders, testConfiguredProviders } = require('../lib/provider-manager');
  const env = { OPENROUTER_API_KEY: 'legacy-key', NVIDIA_API: 'shared-key', GEMINI_API_KEY: 'g' };
  const active = activeProviders(env);
  assert.deepEqual(active.map(x => x.id), ['gemini', 'nemotron', 'minimax']);
  assert.equal(active.find(x => x.id === 'minimax').configured, true, 'MiniMax reutilise NVIDIA_API dans la liste active');

  const originalFetch = global.fetch;
  const calledUrls = [];
  try {
    const bodyByHost = (url) => /generativelanguage\.googleapis\.com/.test(String(url))
      ? { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }
      : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
    global.fetch = async (url) => {
      calledUrls.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify(bodyByHost(url)), headers: { get: () => null } };
    };
    const tested = await testConfiguredProviders(env);
    assert.deepEqual(tested.map(x => x.id).sort(), ['gemini', 'minimax'], 'Tout tester ignore les fournisseurs legacy');
    assert.equal(calledUrls.some(u => /api\.groq\.com|openrouter\.ai/.test(u)), false);
  } finally {
    global.fetch = originalFetch;
  }
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

test('generateText bascule automatiquement vers Gemini en cas d erreur ou de quota NVIDIA (tache raisonnement)', async () => {
  const originalFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-failover-'));
  try {
    let calls = 0;
    global.fetch = async (url, init) => {
      calls += 1;
      if (calls === 1) {
        // Nemotron (NVIDIA_APIR) : quota / rate limit -> le fournisseur suivant (Gemini) prend le relais
        return new Response(JSON.stringify({ error: { message: 'insufficient_quota', code: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': '30' } });
      }
      // Gemini : succes
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"ok"}' }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const env = {
      NVIDIA_APIR: 'test-nemotron-key',
      NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json')
    };
    const res = await generateText('Analyse approfondie les publications pour detection de doublons', { maxTokens: 900 }, env);
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'gemini');
    assert.equal(calls, 2, 'Le fournisseur principal en echec doit declarer le basculement vers le second');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('generateText bascule automatiquement vers le modele NVIDIA compatible en cas d erreur ou de quota Gemini (tache image)', async () => {
  const originalFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-failover-'));
  try {
    let calls = 0;
    global.fetch = async (url, init) => {
      calls += 1;
      if (calls === 1) {
        // Gemini : quota / rate limit -> le fournisseur suivant (Nemotron, modele NVIDIA compatible) prend le relais
        return new Response(JSON.stringify({ error: { message: 'insufficient_quota', code: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': '30' } });
      }
      // Nemotron : succes
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const env = {
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      NVIDIA_APIR: 'test-nemotron-key',
      NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json')
    };
    const res = await generateText('Analyse cette image de produit', { maxTokens: 900 }, env);
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'nemotron');
    assert.equal(calls, 2, 'Le premier fournisseur en echec doit declarer le basculement vers le second');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('generateText ne boucle pas indéfiniment entre les fournisseurs en échec persistant', async () => {
  const originalFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-provider-failover-'));
  try {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    };

    const env = {
      NVIDIA_APIR: 'test-nemotron-key',
      NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      V6_PROVIDER_COOLDOWN_FILE: path.join(temp, 'cooldowns.json')
    };
    const res = await generateText('Analyse approfondie les publications pour detection de doublons', { maxTokens: 900 }, env);
    assert.equal(res.ok, false);
    assert.equal(calls, 2, 'Chaîne bornée : un fournisseur par position, aucune boucle infinie');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('resolveProviderChain route la tache raisonnement vers Nemotron puis Gemini en secours', () => {
  const env = { NVIDIA_APIR: 'k', NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-2.5-flash' };
  const chain = resolveProviderChain(env, { prompt: 'Analyse approfondie les publications pour detection de doublons' });
  assert.deepEqual(chain, ['nemotron', 'gemini']);
});

test('resolveProviderChain route la tache code vers MiniMax puis Gemini en secours', () => {
  const env = { NVIDIA_API: 'k', NVIDIA_MINIMAX_MODEL: 'minimaxai/minimax-m3.1-flash', GEMINI_API_KEY: 'g' };
  const chain = resolveProviderChain(env, { prompt: 'Génère une fonction TypeScript pour l endpoint API' });
  assert.deepEqual(chain, ['minimax', 'gemini']);
});

test('resolveProviderChain route la tache image vers Gemini puis Nemotron en secours', () => {
  const env = { GEMINI_API_KEY: 'g', NVIDIA_APIR: 'k', NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b' };
  const chain = resolveProviderChain(env, { prompt: 'Analyse cette image de produit' });
  assert.deepEqual(chain, ['gemini', 'nemotron']);
});

test('testProvider Nemotron interroge l endpoint NVIDIA avec la variable NVIDIA_APIR', async () => {
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

    const env = { NVIDIA_APIR: 'test-nemotron-key', NVIDIA_NEMOTRON_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b' };
    const res = await testProvider('nemotron', env);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'connected');
    assert.ok(capturedUrl.startsWith('https://integrate.api.nvidia.com/v1/chat/completions'), `URL NVIDIA inattendue: ${capturedUrl}`);
    assert.equal(capturedAuth, 'Bearer test-nemotron-key');
    assert.equal(capturedBody.model, 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('testProvider MiniMax interroge l endpoint NVIDIA avec la variable NVIDIA_API', async () => {
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

    const env = { NVIDIA_API: 'test-nvidia-key', NVIDIA_MINIMAX_MODEL: 'minimaxai/minimax-m3.1-flash' };
    const res = await testProvider('minimax', env);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'connected');
    assert.ok(capturedUrl.startsWith('https://integrate.api.nvidia.com/v1/chat/completions'), `URL NVIDIA inattendue: ${capturedUrl}`);
    assert.equal(capturedAuth, 'Bearer test-nvidia-key');
    assert.equal(capturedBody.model, 'minimaxai/minimax-m3.1-flash');
  } finally {
    global.fetch = originalFetch;
  }
});

test('testProvider Gemini interroge l endpoint Gemini avec la variable GEMINI_API_KEY', async () => {
  const originalFetch = global.fetch;
  try {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody = null;
    global.fetch = async (url, init) => {
      capturedUrl = String(url);
      const headers = init?.headers;
      capturedAuth = headers
        ? (typeof headers.get === 'function' ? String(headers.get('x-goog-api-key') || '') : String(headers['x-goog-api-key'] || ''))
        : '';
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const env = { GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODEL: 'gemini-2.5-flash' };
    const res = await testProvider('gemini', env);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'connected');
    assert.ok(capturedUrl.includes('models/gemini-2.5-flash'), `URL Gemini inattendue: ${capturedUrl}`);
    assert.equal(capturedAuth, 'test-gemini-key');
    assert.equal(capturedBody.generationConfig.maxOutputTokens, 8);
  } finally {
    global.fetch = originalFetch;
  }
});
