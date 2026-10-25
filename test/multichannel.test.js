'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChannelRegistry } = require('../lib/multichannel');
test('keeps only primary channel active unless multichannel explicitly enabled', () => {
  const env = { CHANNEL_ID: '-1001', V6_CHANNELS_JSON: '[{"id":"-1001","name":"Main","enabled":true},{"id":"-1002","name":"Second","enabled":true}]' };
  const safe = parseChannelRegistry(env); assert.equal(safe.active, 1); assert.equal(safe.channels[0].id, '-1001');
  const multi = parseChannelRegistry({ ...env, V6_MULTICHANNEL_ENABLED: 'true' }); assert.equal(multi.active, 2);
});
test('rejects malformed channel registry', () => { assert.equal(parseChannelRegistry({ CHANNEL_ID: '-1001', V6_CHANNELS_JSON: '{bad' }).ok, false); });
