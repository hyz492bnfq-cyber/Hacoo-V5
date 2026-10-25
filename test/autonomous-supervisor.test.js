'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeRuntimeChecks, runSupervisorCycle } = require('../lib/autonomous-supervisor');
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-supervisor-')); }

test('supervisor repairs missing workspace directories without touching business data', () => {
  const root = temp();
  try {
    const data = { pendingJobs: [], stats: { totalSeen: 3 } };
    const result = safeRuntimeChecks(root, data);
    assert.ok(result.repairs.some(r => r.id === 'workspace_dir_created'));
    assert.equal(fs.existsSync(path.join(root, 'workspace/candidates')), true);
    assert.equal(data.stats.totalSeen, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('supervisor clears only a stale autonomy lock', () => {
  const root = temp();
  try {
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workspace/autonomy-state.json'), JSON.stringify({ running: true, runningAt: Date.now() - 11 * 60 * 1000, runsToday: 1 }));
    const result = safeRuntimeChecks(root, { pendingJobs: [], stats: {} });
    const state = JSON.parse(fs.readFileSync(path.join(root, 'workspace/autonomy-state.json'), 'utf8'));
    assert.equal(state.running, false);
    assert.ok(result.repairs.some(r => r.id === 'stale_autonomy_lock_cleared'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('supervisor flags stale queue without retrying or mutating queued jobs', () => {
  const root = temp();
  try {
    const jobs = [{ id: 'job-1', createdAt: Date.now() - 20 * 60 * 1000, status: 'sending' }];
    const result = safeRuntimeChecks(root, { pendingJobs: jobs, stats: {} });
    assert.ok(result.findings.some(f => f.code === 'queue_stale'));
    assert.equal(jobs[0].status, 'sending');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('supervisor cycle persists its report and explicitly records zero code changes', () => {
  const root = temp();
  try {
    const result = runSupervisorCycle({ rootDir: root, data: { pendingJobs: [], stats: {} }, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.report.automaticCodeChanges, 0);
    assert.equal(fs.existsSync(path.join(root, 'workspace/supervisor-state.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
