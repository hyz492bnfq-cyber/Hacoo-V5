'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readControl, updateControl, readAudit } = require('../lib/autonomy-control');

test('autonomy control persists pause/chat switches and writes an audit event', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-autonomy-control-'));
  try {
    assert.deepEqual(readControl(root), {});
    const next = updateControl(root, { paused: true, chatEnabled: false });
    assert.equal(next.paused, true);
    assert.equal(readControl(root).chatEnabled, false);
    const events = readAudit(root, 10);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'autonomy_control_updated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
