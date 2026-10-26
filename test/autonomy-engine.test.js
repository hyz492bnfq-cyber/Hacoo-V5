'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localMetrics, parseModelJson, timestampOf } = require('../lib/autonomy-engine');

test('local metrics never include message text or identifiers', () => {
  const result = localMetrics({
    enabled: true, botPaused: false,
    pendingJobs: [{ id: 'secret-job', createdAt: Date.now() - 120000, status: 'failed', messages: [{ text: 'private user text' }] }],
    pendingAlbums: [], stats: { totalSeen: 10, errors: 2, lastError: { message: 'private error' } }
  });
  assert.equal(result.queuePending, 1);
  assert.equal(result.queueFailedOrManual, 1);
  assert.ok(result.queueOldestAgeMinutes >= 1);
  assert.equal(JSON.stringify(result).includes('private user text'), false);
  assert.equal(JSON.stringify(result).includes('secret-job'), false);
  assert.equal(JSON.stringify(result).includes('private error'), false);
});

test('model response JSON is bounded and parsed', () => {
  const parsed = parseModelJson('```json\n{"title":"Améliorer la reprise","rationale":"Une reprise contrôlée réduit les erreurs de file.","expectedBenefit":"Moins de tâches bloquées"}\n```');
  assert.equal(parsed.title, 'Améliorer la reprise');
  assert.throws(() => parseModelJson('not json'), /JSON/);
  assert.throws(() => parseModelJson('{"title":"x","rationale":"y"}'), /complète/);
});


test('queue age accepts numeric and ISO timestamps', () => {
  const now = Date.now();
  const result = localMetrics({
    pendingJobs: [
      { createdAt: now - 180000, status: 'queued' },
      { createdAt: new Date(now - 120000).toISOString(), status: 'queued' }
    ],
    stats: {}
  });
  assert.ok(result.queueOldestAgeMinutes >= 2);
  assert.ok(timestampOf(new Date(now - 60000).toISOString()) > 0);
  assert.equal(timestampOf('not-a-date'), 0);
});


test('model-selected engineering target is accepted only from the supplied allowlist', () => {
  const raw = '{"title":"Améliorer une validation","rationale":"Une validation plus claire réduit les erreurs utilisateurs.","expectedBenefit":"Moins d’échecs","target":"lib/command-planner.js"}';
  assert.equal(parseModelJson(raw, ['lib/command-planner.js']).target, 'lib/command-planner.js');
  assert.equal(parseModelJson(raw, ['lib/daily-report.js']).target, null);
});
