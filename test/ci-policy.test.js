'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'ci-fadehost.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('CI uses a locked install and fails on high or critical dependency advisories', () => {
  assert.match(workflow, /npm ci\b/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
});

test('CI cannot deploy production or auto-deploy after only a passing test run', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /FADEHOST_AUTODEPLOY/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /fadehost apps deploy/i);
  assert.doesNotMatch(workflow, /^\s+deploy-fadehost:/m);
});
