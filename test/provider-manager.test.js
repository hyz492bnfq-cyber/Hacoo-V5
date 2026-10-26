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
