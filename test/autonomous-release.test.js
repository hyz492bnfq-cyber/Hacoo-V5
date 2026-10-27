'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAutonomousTarget, inspectGeneratedCode, autonomousReleaseStatus, deployAutonomousCandidate } = require('../lib/autonomous-release');
const { healthCheckConfig, verifyRuntimeHealth } = require('../lib/fadehost-deployer');

test('explicit autonomous deployment requires runtime and GitHub settings but not an allowlist', async () => {
  assert.equal(autonomousReleaseStatus({}).enabled, false);
  const configured = { V6_AUTONOMOUS_DEPLOY_SAFE: 'true', V6_AUTO_DEPLOY_ENABLED: 'true', V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/helper.js', V6_DEPLOY_HEALTH_URL: 'https://example.com/health' };
  const status = autonomousReleaseStatus(configured);
  assert.equal(status.enabled, false); // Missing GitHub credentials keeps it locked.
  assert.equal(status.mode, 'locked-until-required-configuration-is-complete');
  assert.equal(status.automaticRollback, false);
  assert.equal(status.configured.safeMode, true);
  assert.equal(autonomousReleaseStatus({ ...configured, V6_DEPLOY_HEALTH_URL: '' }).enabled, false);
  assert.equal(autonomousReleaseStatus({ V6_AUTONOMOUS_DEPLOY_SAFE: 'true', V6_AUTO_DEPLOY_ENABLED: 'false', V6_AUTONOMOUS_DEPLOY_ALLOWLIST: 'lib/helper.js' }).enabled, false);
  const attempt = await deployAutonomousCandidate('/tmp/hacoo-unused', 'workspace/candidates/candidate.js', 'lib/helper.js', configured);
  assert.equal(attempt.ok, false);
  assert.equal(attempt.blocked, true);
  assert.match(attempt.reason, /verrouillé|bloqué|identifiants/i);
  const fullyConfigured = { ...configured, V6_GITHUB_TOKEN: 'test-token', V6_GITHUB_OWNER: 'owner', V6_GITHUB_REPO: 'repo', V6_GITHUB_BRANCH: 'staging' };
  assert.equal(autonomousReleaseStatus(fullyConfigured).enabled, true);
  assert.equal(autonomousReleaseStatus({ ...fullyConfigured, V6_AUTONOMOUS_DEPLOY_ALLOWLIST: '' }).enabled, true);
});

test('project-wide deployment accepts ordinary files without allowlist but protects secrets and deployment control', () => {
  const env = { V6_AUTONOMOUS_DEPLOY_ALLOWLIST: '' };
  for (const target of ['index.js', 'dashboard.html', 'package.json', 'lib/helper.js', 'lib/not-listed.js', 'README.md']) assert.equal(validateAutonomousTarget(target, env).allowed, true, target);
  for (const target of ['.env', 'data.json', 'lib/../index.js', 'lib/action-controller.js', 'lib/fadehost-deployer.js', '.github/workflows/ci-fadehost.yml']) assert.equal(validateAutonomousTarget(target, env).allowed, false, target);
});

test('generated code static gate blocks sensitive capabilities', () => {
  assert.equal(inspectGeneratedCode('module.exports = { ok: true };').ok, true);
  assert.equal(inspectGeneratedCode('const token = process.env.BOT_TOKEN;').ok, true);
  assert.equal(inspectGeneratedCode("const fs = require('fs');").ok, true);
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
