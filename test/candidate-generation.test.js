'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCode } = require('../lib/self-development-lab');

test('extracts fenced JavaScript candidate', () => {
  assert.equal(extractCode('```js\nmodule.exports = { ok: true };\n```'), 'module.exports = { ok: true };');
});
test('blocks dynamic execution and environment access', () => {
  assert.throws(() => extractCode('eval("bad")'), /eval/);
  assert.throws(() => extractCode('const token = process.env.BOT_TOKEN'), /variables d’environnement/);
  assert.throws(() => extractCode('require("node:child_process")'), /child_process/);
});
