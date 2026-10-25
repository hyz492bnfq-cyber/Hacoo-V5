'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
