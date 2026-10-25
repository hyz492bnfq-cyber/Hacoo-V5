'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeTarget, githubConfig, deployCandidate, rollbackDeployment, runCandidateTests } = require('../lib/fadehost-deployer');
test('FadeHost deployment target is restricted to non-protected JS modules', () => {
  assert.equal(normalizeTarget('lib/feature.js'), 'lib/feature.js');
  for (const target of ['index.js', 'lib/constitution.js', 'lib/action-controller.js', '../lib/x.js', 'lib/x.json', '.env']) {
    assert.throws(() => normalizeTarget(target));
  }
});
test('GitHub deployment configuration requires all credentials and repository fields', () => {
  assert.equal(githubConfig({}).configured, false);
  assert.equal(githubConfig({ V6_GITHUB_TOKEN: 'x', V6_GITHUB_OWNER: 'o', V6_GITHUB_REPO: 'r', V6_GITHUB_BRANCH: 'staging' }).configured, true);
});
test('deployment fails closed when deployment is disabled', async () => {
  const result = await deployCandidate('/tmp', 'workspace/candidates/x.js', 'lib/x.js', {}, {});
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /désactivé/i);
});

test('rollback rejects malformed release identifiers before any network call', async () => {
  const result = await rollbackDeployment('/tmp', '../bad', { V6_AUTO_DEPLOY_ENABLED: 'true' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Identifiant/i);
});


test('pre-deployment test process does not inherit API secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-clean-env-'));
  const prior = process.env.HACOO_TEST_DEPLOY_SECRET;
  process.env.HACOO_TEST_DEPLOY_SECRET = 'should-not-be-inherited';
  try {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'test'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'feature.js'), 'module.exports = { safe: true };');
    fs.writeFileSync(path.join(root, 'test', 'environment.test.js'), [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "test('deployment test environment is clean', () => assert.equal(process.env.HACOO_TEST_DEPLOY_SECRET, undefined));"
    ].join('\n'));
    const result = runCandidateTests(root, 'lib/feature.js', 'module.exports = { candidate: true };');
    assert.equal(result.ok, true, result.output || result.reason);
  } finally {
    if (prior === undefined) delete process.env.HACOO_TEST_DEPLOY_SECRET;
    else process.env.HACOO_TEST_DEPLOY_SECRET = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
