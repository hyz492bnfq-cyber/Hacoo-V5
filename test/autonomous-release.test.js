'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAutonomousTarget, inspectGeneratedCode, autonomousReleaseStatus } = require('../lib/autonomous-release');
const { healthCheckConfig, verifyRuntimeHealth } = require('../lib/fadehost-deployer');

test('autonomous deployment is disabled by default and requires both switches', () => {
  assert.equal(autonomousReleaseStatus({}).enabled, false);
  const configured = { V6_AUTONOMOUS_DEPLOY_SAFE: 'true', V6_AUTO_DEPLOY_ENABLED: 'true', V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/helper.js', V6_DEPLOY_HEALTH_URL: 'https://example.com/health' };
  assert.equal(autonomousReleaseStatus(configured).enabled, true);
  assert.equal(autonomousReleaseStatus({ ...configured, V6_DEPLOY_HEALTH_URL: '' }).enabled, false);
  assert.equal(autonomousReleaseStatus({ V6_AUTONOMOUS_DEPLOY_SAFE: 'true', V6_AUTO_DEPLOY_ENABLED: 'false', V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/helper.js' }).enabled, false);
});

test('only exact allowlisted noncritical lib modules can be auto-deployed', () => {
  const env = { V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/helper.js,lib/formatting.js' };
  assert.equal(validateAutonomousTarget('lib/helper.js', env).allowed, true);
  assert.equal(validateAutonomousTarget('lib/not-listed.js', env).allowed, false);
  assert.equal(validateAutonomousTarget('index.js', { V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'index.js' }).allowed, false);
  assert.equal(validateAutonomousTarget('lib/../index.js', env).allowed, false);
  assert.equal(validateAutonomousTarget('lib/action-controller.js', { V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/action-controller.js' }).allowed, false);
});

test('generated code static gate blocks sensitive capabilities', () => {
  assert.equal(inspectGeneratedCode('module.exports = { ok: true };').ok, true);
  assert.equal(inspectGeneratedCode('const token = process.env.BOT_TOKEN;').ok, false);
  assert.equal(inspectGeneratedCode("const fs = require('fs');").ok, false);
  assert.equal(inspectGeneratedCode('eval("1+1")').ok, false);
  assert.equal(inspectGeneratedCode('module.exports = {};').ok, true);
});


test('runtime health configuration requires a public HTTPS URL', () => {
  assert.equal(healthCheckConfig({}).valid, false);
  assert.equal(healthCheckConfig({ V6_DEPLOY_HEALTH_URL: 'http://example.com/health' }).valid, false);
  assert.equal(healthCheckConfig({ V6_DEPLOY_HEALTH_URL: 'https://user:pass@example.com/health' }).valid, false);
  assert.equal(healthCheckConfig({ V6_DEPLOY_HEALTH_URL: 'https://example.com/health' }).valid, true);
});

test('runtime health checker succeeds on HTTP 2xx and fails closed on errors', async () => {
  const ok = await verifyRuntimeHealth({ V6_DEPLOY_HEALTH_URL: 'https://example.com/health', V6_DEPLOY_HEALTH_ATTEMPTS: '1' }, async () => ({ ok: true, status: 200 }));
  assert.equal(ok.ok, true);
  const bad = await verifyRuntimeHealth({ V6_DEPLOY_HEALTH_URL: 'https://example.com/health', V6_DEPLOY_HEALTH_ATTEMPTS: '1' }, async () => ({ ok: false, status: 503 }));
  assert.equal(bad.ok, false);
  assert.equal(bad.checked, true);
});
