'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEngineeringTask, listEngineeringTasks, cancelEngineeringTask, safeTarget, engineeringAgentStatus, runEngineeringTask, recoverInterruptedEngineeringTasks } = require('../lib/autonomous-agent');
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-agent-test-')); fs.mkdirSync(path.join(root,'lib'),{recursive:true}); fs.writeFileSync(path.join(root,'lib','daily-report.js'), "'use strict';\nmodule.exports = { ping: () => 'pong' };\n"); return root; }
test('engineering task persists objective and source hash without editing production file', () => {
  const root = fixture();
  try {
    const before = fs.readFileSync(path.join(root,'lib','daily-report.js'),'utf8');
    const task = createEngineeringTask(root,{target:'lib/daily-report.js',objective:'Ajoute une validation claire pour les entrées invalides et conserve les exports existants.'});
    assert.equal(task.status,'queued'); assert.ok(task.sourceSha256); assert.equal(listEngineeringTasks(root).length,1);
    assert.equal(fs.readFileSync(path.join(root,'lib','daily-report.js'),'utf8'),before);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('engineering task rejects protected paths and traversal', () => {
  assert.throws(()=>safeTarget('index.js'),/uniquement un module/);
  assert.throws(()=>safeTarget('lib/../index.js'),/invalide/);
  assert.throws(()=>safeTarget('lib/action-controller.js'),/non critique/);
});
test('queued engineering task can be cancelled and is persisted', () => {
  const root = fixture();
  try {
    const task = createEngineeringTask(root,{target:'lib/daily-report.js',objective:'Améliore la gestion des erreurs et garde la compatibilité avec les exports actuels.'});
    const cancelled = cancelEngineeringTask(root,task.id);
    assert.equal(cancelled.status,'cancelled'); assert.equal(listEngineeringTasks(root)[0].status,'cancelled');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('engineering status does not claim automatic deployment without configuration', () => {
  const root = fixture();
  try { const status = engineeringAgentStatus(root,{}); assert.equal(status.enabled,false); assert.equal(status.githubConfigured,false); assert.equal(status.runtimeHealthConfigured,false); }
  finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('engineering task refuses to overwrite a module changed after task creation', async () => {
  const root = fixture();
  try {
    const task = createEngineeringTask(root,{target:'lib/daily-report.js',objective:'Améliore la gestion des erreurs et conserve les exports publics actuels.'});
    fs.writeFileSync(path.join(root,'lib','daily-report.js'), "'use strict';\nmodule.exports = { ping: () => 'changed' };\n");
    await assert.rejects(runEngineeringTask(root,task.id,{}),/a changé depuis la création/);
    assert.equal(fs.readFileSync(path.join(root,'lib','daily-report.js'),'utf8').includes("'changed'"),true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('interrupted deployment is flagged for review rather than retried blindly', () => {
  const root = fixture();
  try {
    const task = createEngineeringTask(root,{target:'lib/daily-report.js',objective:'Improve robust handling of malformed input while preserving public exports.'});
    const stateFile = path.join(root,'workspace','engineering-tasks.json');
    const state = JSON.parse(fs.readFileSync(stateFile,'utf8'));
    state.tasks[0].status='deploying'; state.tasks[0].updatedAt=new Date(Date.now()-11*60*1000).toISOString();
    fs.writeFileSync(stateFile,JSON.stringify(state));
    assert.equal(recoverInterruptedEngineeringTasks(root),true);
    assert.equal(listEngineeringTasks(root)[0].status,'interrupted_needs_review');
    assert.match(listEngineeringTasks(root)[0].error,/resultat de déploiement|résultat de déploiement/i);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
