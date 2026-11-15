'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftPullRequest, githubConfig } = require('../lib/github-pr');
function response(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
test('GitHub PR configuration never exposes token and requires repository settings', () => {
  const status = githubConfig({ V6_GITHUB_TOKEN: 'secret', V6_GITHUB_OWNER: 'owner', V6_GITHUB_REPO: 'repo', V6_GITHUB_BRANCH: 'main' });
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(githubConfig({}).configured, false);
});
test('validated candidate creates a draft PR on a separate branch without merging', async () => {
  const source = "'use strict';\nmodule.exports = { mapCommand: () => null };\n";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/contents/lib/command-planner.js?ref=main')) return response(200, { content: Buffer.from(source).toString('base64'), sha: 'file-sha' });
    if (String(url).includes('/git/ref/heads/main')) return response(200, { object: { sha: 'base-sha' } });
    if (String(url).endsWith('/git/refs')) return response(201, { ref: 'refs/heads/ai/test' });
    if (String(url).includes('/contents/lib/command-planner.js') && init.method === 'PUT') return response(201, { commit: { sha: 'commit-sha' } });
    if (String(url).endsWith('/pulls')) return response(201, { number: 17, html_url: 'https://github.com/owner/repo/pull/17' });
    return response(404, { message: 'not found' });
  };
  const result = await createDraftPullRequest({
    target: 'lib/command-planner.js', code: source + '// tested candidate', taskId: `${Date.now()}-deadbeef`,
    title: 'Amélioration testée', objective: 'Amélioration sûre', expectedSource: source,
    env: { V6_GITHUB_TOKEN: 'secret', V6_GITHUB_OWNER: 'owner', V6_GITHUB_REPO: 'repo', V6_GITHUB_BRANCH: 'main' }, fetchImpl
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.pullRequestNumber, 17);
  assert.equal(calls.at(-1).body.draft, true);
  assert.equal(calls.at(-1).body.base, 'main');
  assert.equal(calls.some(call => call.method === 'PATCH' || call.body?.merge_method), false);
});
test('GitHub PR refuses when the remote source differs from the audited local file', async () => {
  const result = await createDraftPullRequest({
    target: 'lib/command-planner.js', code: 'module.exports = {};', taskId: `${Date.now()}-deadbeef`,
    expectedSource: 'local', env: { V6_GITHUB_TOKEN: 'secret', V6_GITHUB_OWNER: 'owner', V6_GITHUB_REPO: 'repo', V6_GITHUB_BRANCH: 'main' },
    fetchImpl: async () => response(200, { content: Buffer.from('different remote').toString('base64'), sha: 'file-sha' })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'remote_source_changed');
});
