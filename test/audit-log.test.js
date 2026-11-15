'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendAudit, redact, sanitizeDetails } = require('../lib/audit-log');

test('redact masks inline credentials, bearer values and Telegram bot tokens', () => {
  const text = 'api_key=abc123 Authorization: Bearer super-secret-token 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
  const safe = redact(text);
  assert.equal(safe.includes('abc123'), false);
  assert.equal(safe.includes('super-secret-token'), false);
  assert.equal(safe.includes('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi'), false);
});

test('sanitizeDetails redacts sensitive nested keys and secret-like strings', () => {
  const safe = sanitizeDetails({
    provider: 'gemini',
    credentials: { apiKey: 'should-not-appear', nested: { password: 'also-secret' } },
    response: 'Authorization: Bearer bearer-secret-value',
    url: 'https://example.test/?access_token=query-secret'
  });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('should-not-appear'), false);
  assert.equal(serialized.includes('also-secret'), false);
  assert.equal(serialized.includes('bearer-secret-value'), false);
  assert.equal(serialized.includes('query-secret'), false);
  assert.equal(safe.provider, 'gemini');
  assert.equal(safe.credentials, '[REDACTED]');
});

test('sanitizeDetails handles circular objects and bounds deeply nested data', () => {
  const circular = { label: 'safe' };
  circular.self = circular;
  const safe = sanitizeDetails({ circular, deep: { a: { b: { c: { d: { e: { f: 'too-deep' } } } } } } });
  assert.equal(safe.circular.self, '[CIRCULAR]');
  assert.equal(safe.deep.a.b.c.d.e, '[MAX_DEPTH]');
});

test('appendAudit persists only sanitized details and returns the sanitized row', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-audit-redaction-'));
  try {
    const row = appendAudit(root, {
      type: 'provider_check',
      message: 'Diagnostic terminé',
      details: {
        provider: 'nvidia',
        api_key: 'top-level-secret',
        result: { status: 'failed', reason: 'token=embedded-secret' }
      }
    });
    const file = path.join(root, 'logs', 'audit.jsonl');
    const raw = fs.readFileSync(file, 'utf8');
    const persisted = JSON.parse(raw.trim());
    assert.equal(row.details.api_key, '[REDACTED]');
    assert.equal(persisted.details.result.reason, 'token=[REDACTED]');
    assert.equal(raw.includes('top-level-secret'), false);
    assert.equal(raw.includes('embedded-secret'), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
