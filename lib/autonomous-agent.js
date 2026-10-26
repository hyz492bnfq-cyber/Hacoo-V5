'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { generateText } = require('./provider-manager');
const { inspectCandidate } = require('./deployment-manager');
const { deployCandidate } = require('./fadehost-deployer');
const { validateAutonomousTarget, autonomousReleaseStatus } = require('./autonomous-release');
const { appendAudit } = require('./audit-log');
const { readControl } = require('./autonomy-control');
const { createDraftPullRequest } = require('./github-pr');

const MAX_TASKS = 100;
const MAX_OBJECTIVE = 3000;
const SAFE_TARGETS = Object.freeze(['lib/daily-report.js','lib/adaptive-policy.js','lib/incident-forecaster.js','lib/command-planner.js','lib/multichannel.js','lib/prepublication.js','lib/publication-scheduler.js','lib/semantic-memory.js']);
const PROTECTED = new Set(['index.js','dashboard.html','package.json','package-lock.json','.env','data.json','lib/constitution.js','lib/action-controller.js','lib/deployment-manager.js','lib/fadehost-deployer.js','lib/autonomous-agent.js','lib/autonomous-release.js','lib/autonomy-engine.js','lib/autonomy-control.js','lib/autonomous-supervisor.js','lib/provider-manager.js','lib/self-development-lab.js','lib/audit-log.js']);
function clampInt(value, fallback, min, max) { const n = Number(value); return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function statePath(root) { return path.join(root, 'workspace', 'engineering-tasks.json'); }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, file); try { fs.chmodSync(file, 0o600); } catch {}
}
function loadState(root) {
  try { const s = JSON.parse(fs.readFileSync(statePath(root), 'utf8')); return { tasks: Array.isArray(s.tasks) ? s.tasks.slice(-MAX_TASKS) : [], updatedAt: s.updatedAt || null }; }
  catch { return { tasks: [], updatedAt: null }; }
}
function saveState(root, state) { state.updatedAt = new Date().toISOString(); state.tasks = state.tasks.slice(-MAX_TASKS); atomicWrite(statePath(root), state); }
function safeTarget(input) {
  const target = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!target || target.includes('\0') || target.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Chemin cible invalide.');
  if (!/^lib\/[a-zA-Z0-9_-]+\.js$/.test(target) || PROTECTED.has(target) || !SAFE_TARGETS.includes(target)) throw new Error('La génération autonome accepte uniquement un module lib/*.js non critique explicitement allowlisté et testé. Les autres fichiers nécessitent un workflow de revue distinct.');
  return target;
}
function listSafeEngineeringTargets(root) {
  return SAFE_TARGETS.filter(target => {
    try {
      const source = path.resolve(root, target);
      const test = path.resolve(root, 'test', `${path.basename(target, '.js')}.test.js`);
      return source.startsWith(path.resolve(root) + path.sep) && fs.statSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink() && fs.statSync(source).size <= 10000 && fs.statSync(test).isFile();
    } catch { return false; }
  });
}
function publicTask(task) {
  const { candidateCode, ...rest } = task;
  return rest;
}
function listEngineeringTasks(root) { return loadState(root).tasks.slice().reverse().map(publicTask); }
function createEngineeringTask(root, input) {
  const objective = String(input?.objective || '').replace(/\u0000/g, '').trim().slice(0, MAX_OBJECTIVE);
  const target = safeTarget(input?.target);
  if (objective.length < 20) throw new Error('Décris un objectif concret en au moins 20 caractères.');
  const sourcePath = path.resolve(root, target);
  if (!sourcePath.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || fs.lstatSync(sourcePath).isSymbolicLink()) throw new Error('Le module cible doit exister et être un fichier ordinaire.');
  const source = fs.readFileSync(sourcePath, 'utf8');
  if (Buffer.byteLength(source) > 10000) throw new Error('Le module dépasse 10 Ko; il doit être découpé en modules plus petits avant génération autonome.');
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const task = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'queued', objective, target, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), steps: [{ at: new Date().toISOString(), status: 'queued', message: 'Tâche persistée; aucun fichier de production modifié.' }], result: null, provider: null, model: null, candidateFile: null, deployAttempted: false };
  const state = loadState(root); state.tasks.push(task); saveState(root, state);
  appendAudit(root, { type: 'engineering_task_created', message: 'Tâche de développement autonome créée.', details: { id, target, objectiveLength: objective.length } });
  return publicTask(task);
}
function updateTask(root, id, patch, message) {
  const state = loadState(root); const task = state.tasks.find(t => t.id === id); if (!task) throw new Error('Tâche introuvable.');
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  task.steps = Array.isArray(task.steps) ? task.steps : [];
  task.steps.push({ at: new Date().toISOString(), status: task.status, message: String(message || '').slice(0, 500) });
  saveState(root, state); return task;
}
function extractCode(text) {
  let code = String(text || '').trim();
  code = code.replace(/^```(?:javascript|js|node)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
  if (!code || Buffer.byteLength(code) > 30000) throw new Error('Réponse de code vide ou supérieure à 30 Ko.');
  return code;
}

// Exécute uniquement le test ciblé dans une copie temporaire du dépôt, sans secrets ni données métier.
// Node permission model limite l'accès fichier à la copie et le contrôle statique bloque les API système/réseau usuelles.
function runCandidateTests(root, target, candidateCode, options = {}) {
  const basename = path.basename(target, '.js');
  const testRelative = path.join('test', `${basename}.test.js`);
  const testSource = path.resolve(root, testRelative);
  if (!fs.existsSync(testSource) || !fs.statSync(testSource).isFile()) {
    return { ok: false, status: 'missing_focused_test', testFile: testRelative, output: `Aucun test ciblé trouvé pour ${target}; le candidat reste bloqué.` };
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-candidate-validation-'));
  const tempDir = path.join(sandbox, 'tmp');
  try {
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    fs.cpSync(root, sandbox, { recursive: true, force: false, filter: source => {
      const rel = path.relative(root, source).split(path.sep).join('/');
      if (!rel) return true;
      return !(/^(?:\.git|node_modules|workspace|coverage)(?:\/|$)/.test(rel) || /^(?:\.env(?:\..*)?|data\.json|data\.json\.bak)$/.test(rel) || rel.endsWith('.log'));
    }});
    const candidatePath = path.join(sandbox, target);
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(candidatePath, `${candidateCode.replace(/\s+$/, '')}\n`, { mode: 0o600 });
    const testPath = path.join(sandbox, testRelative);
    const timeoutMs = clampInt(options.timeoutMs, 30000, 5000, 60000);
    const args = ['--permission', `--allow-fs-read=${sandbox}`, `--allow-fs-write=${sandbox}`];
    if (Number(process.versions.node.split('.')[0]) >= 22) args.push('--experimental-test-isolation=none');
    else args.push('--allow-child-process'); // Compatibilité Node 20; le candidat reste soumis au contrôle statique.
    args.push('--test', testRelative);
    const result = spawnSync(process.execPath, args, {
      cwd: sandbox, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { PATH: process.env.PATH || '', NODE_ENV: 'test', TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir, HOME: sandbox }
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-6000);
    const ok = !result.error && result.status === 0;
    return { ok, status: ok ? 'passed' : result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'failed', testFile: testRelative, exitCode: result.status, output: output.slice(-3500) };
  } catch (error) {
    return { ok: false, status: 'harness_error', testFile: testRelative, output: String(error?.message || error).slice(0, 1800) };
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); } catch {}
  }
}
async function runEngineeringTask(root, id, env = process.env) {
  let task = loadState(root).tasks.find(t => t.id === id);
  if (!task) throw new Error('Tâche introuvable.');
  if (task.status === 'running') throw new Error('Cette tâche est déjà en cours.');
  if (readControl(root).paused === true) throw new Error('L’autonomie est en pause.');
  task = updateTask(root, id, { status: 'running', startedAt: new Date().toISOString(), result: null }, 'Lecture du module cible et préparation de la proposition.');
  try {
    const target = safeTarget(task.target);
    const sourcePath = path.resolve(root, target);
    const currentSource = fs.readFileSync(sourcePath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(currentSource).digest('hex');
    if (currentHash !== task.sourceSha256) throw new Error('Le module cible a changé depuis la création de la tâche; crée une nouvelle tâche pour éviter d’écraser un changement récent.');
    const maxAttempts = clampInt(env.V6_ENGINEERING_MAX_ATTEMPTS, 2, 1, 3);
    let lastFailure = '';
    let selected = null;
    let totalProviderCalls = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prompt = [
        'Tu es un ingénieur logiciel senior qui modifie un module Node.js CommonJS existant de HACOO BOT.',
        'Retourne UNIQUEMENT le contenu complet du fichier JavaScript, sans markdown ni commentaire avant/après.',
        'Respecte les exports, les contrats existants, la compatibilité Node.js >=20 et les dépendances déjà présentes.',
        'Ne crée pas d’exécution dynamique, d’accès réseau, de commande système, de lecture de secrets ou de suppression de données.',
        'Conserve les fonctions existantes non concernées. Fais la modification minimale qui répond au besoin.',
        'Le candidat sera contrôlé statiquement puis le test ciblé du module sera exécuté dans une copie isolée sans secrets ni données de production.',
        'Si tu ne peux pas produire une modification sûre et testable, retourne le fichier inchangé; cette tentative sera refusée comme absence de changement.',
        `OBJECTIF ADMINISTRATEUR:\n${task.objective}`,
        `FICHIER CIBLE: ${target}`,
        `TENTATIVE: ${attempt}/${maxAttempts}`,
        lastFailure ? `ÉCHEC PRÉCÉDENT À CORRIGER (ne répète pas la même erreur):\n${lastFailure.slice(0, 2200)}` : '',
        `CONTENU ACTUEL:\n${currentSource}`
      ].filter(Boolean).join('\n\n');
      const generated = await generateText(prompt, { maxTokens: attempt === 1 ? 4500 : 3000, timeoutMs: 30000 }, env);
      totalProviderCalls += Array.isArray(generated.tried) ? generated.tried.length : (generated.ok ? 1 : 0);
      if (!generated.ok) throw new Error(`Aucun fournisseur IA configuré ou disponible (${generated.status || 'indisponible'}); aucune modification effectuée.`);
      let code;
      try { code = extractCode(generated.text); }
      catch (error) { lastFailure = `Réponse invalide: ${String(error?.message || error)}`; continue; }
      if (code.trim() === currentSource.trim()) { lastFailure = 'Le candidat est identique au fichier actuel : aucune modification vérifiable n’a été produite.'; continue; }
      const candidateDir = path.resolve(root, 'workspace', 'candidates'); fs.mkdirSync(candidateDir, { recursive: true, mode: 0o700 });
      const candidateName = `${id}-attempt-${attempt}.js`; const candidatePath = path.join(candidateDir, candidateName);
      fs.writeFileSync(candidatePath, `${code}\n`, { flag: 'wx', mode: 0o600 });
      const relativeCandidate = path.join('workspace', 'candidates', candidateName).split(path.sep).join('/');
      const inspected = inspectCandidate(root, relativeCandidate, { allowFilesystem: ['lib/publication-scheduler.js','lib/semantic-memory.js'].includes(target) });
      if (!inspected.ok) { lastFailure = `Contrôle statique refusé: ${inspected.reason || 'inconnu'}`; continue; }
      const tests = runCandidateTests(root, target, code, { timeoutMs: env.V6_ENGINEERING_TEST_TIMEOUT_MS });
      if (!tests.ok) { lastFailure = `Test ciblé échoué (${tests.status}, ${tests.testFile}):\n${tests.output || 'Aucune sortie de test.'}`; continue; }
      selected = { code, relativeCandidate, inspected, tests, generated, attempt };
      break;
    }
    if (!selected) {
      updateTask(root, id, { status: 'blocked', attempts: maxAttempts, providerCallsAttempted: totalProviderCalls, error: `Aucun candidat validé après ${maxAttempts} tentative(s). ${lastFailure.slice(0, 900)}`, finishedAt: new Date().toISOString() }, 'Les tentatives de génération/correction ont échoué; aucun candidat n’a été livré et aucun code actif n’a été modifié.');
      throw new Error(`Auto-correction arrêtée après ${maxAttempts} tentative(s): ${lastFailure.slice(0, 260)}`);
    }
    const { code, relativeCandidate, inspected, tests, generated, attempt } = selected;
    let pullRequest = null;
    const pullRequestEnabled = String(env.V6_AUTONOMOUS_PR_ENABLED || 'false').toLowerCase() === 'true';
    if (pullRequestEnabled) {
      pullRequest = await createDraftPullRequest({ target, code, taskId: id, title: task.objective.split('. ')[0].replace(/^Amélioration proposée par la revue autonome : /, ''), objective: task.objective, expectedSource: currentSource, env });
    }
    task = updateTask(root, id, {
      provider: generated.provider, model: generated.model, candidateFile: relativeCandidate,
      candidateSha256: crypto.createHash('sha256').update(code).digest('hex'),
      staticReview: { ok: inspected.ok, reason: null, syntaxPassed: inspected.syntaxPassed === true, staticSecurityPassed: inspected.staticSecurityPassed === true },
      candidateTests: tests, attempts: attempt, providerCallsAttempted: totalProviderCalls, pullRequest,
      status: pullRequest?.ok ? 'pull_request_ready' : 'candidate_ready', candidateBytes: Buffer.byteLength(code),
      result: { ok: true, candidateOnly: true, testFile: tests.testFile, testsPassed: true, candidateFile: relativeCandidate, pullRequest: pullRequest?.ok ? { url: pullRequest.pullRequestUrl, number: pullRequest.pullRequestNumber, branch: pullRequest.branch } : null, pullRequestNote: pullRequest?.reason || (pullRequestEnabled ? 'Pull Request non créée; candidat conservé pour examen.' : 'Création de Pull Request désactivée.') }
    }, `Candidat validé après ${attempt} tentative(s): syntaxe, contrôle statique et test ciblé réussis. Production inchangée.`);
    const autoTarget = validateAutonomousTarget(target, env);
    const requireHealth = String(env.V6_DEPLOY_REQUIRE_RUNTIME_HEALTH || 'true').toLowerCase() === 'true';
    const healthConfigured = Boolean(String(env.V6_DEPLOY_HEALTH_URL || '').trim());
    if (!pullRequest?.ok && !pullRequestEnabled && String(env.V6_AUTONOMOUS_ENGINEERING_ENABLED || '').toLowerCase() === 'true' && autonomousReleaseStatus(env).enabled && autoTarget.allowed && requireHealth && healthConfigured) {
      updateTask(root, id, { status: 'deploying', deployAttempted: true }, 'Candidat prêt; tests de pré-déploiement, sauvegarde et contrôle runtime obligatoires.');
      const deployed = await deployCandidate(root, relativeCandidate, target, { risk: 'low', independentSecurityPassed: inspected.staticSecurityPassed === true, humanApproved: false, requireRuntimeHealth: true }, env);
      const finalStatus = deployed.ok && deployed.fadeHostRuntimeConfirmed ? 'completed_runtime_healthy' : deployed.rollback?.attempted ? 'rollback_attempted' : deployed.ok ? 'deployed_runtime_unconfirmed' : 'deploy_blocked';
      task = updateTask(root, id, { status: finalStatus, result: { ok: Boolean(deployed.ok), deployedToRepository: Boolean(deployed.deployedToRepository), runtimeConfirmed: Boolean(deployed.fadeHostRuntimeConfirmed), releaseId: deployed.releaseId || null, commitSha: deployed.commitSha || null, reason: deployed.reason || null, rollback: deployed.rollback || null, tests: deployed.tests || null, note: deployed.note || null } }, deployed.note || deployed.reason || 'Résultat du déploiement enregistré.');
      appendAudit(root, { type: 'engineering_task_deploy_result', message: 'Résultat du cycle de développement et déploiement autonome enregistré.', details: { id, target, status: finalStatus, runtimeConfirmed: Boolean(deployed.fadeHostRuntimeConfirmed) } });
    } else {
      task = updateTask(root, id, { status: pullRequest?.ok ? 'pull_request_ready' : 'candidate_ready', result: { ok: true, candidateOnly: true, deployGate: pullRequest?.ok ? 'Pull Request en brouillon créée; aucune fusion ni mise en production automatique.' : autoTarget.reason || 'Déploiement autonome non activé ou configuration runtime incomplète.', candidateFile: relativeCandidate, syntaxPassed: true, staticSecurityPassed: true, pullRequest: pullRequest?.ok ? { url: pullRequest.pullRequestUrl, number: pullRequest.pullRequestNumber, branch: pullRequest.branch } : null, pullRequestNote: pullRequest?.reason || null } }, pullRequest?.ok ? 'Candidat testé et Pull Request brouillon créée; aucune fusion ni activation en production.' : 'Candidat généré et testé; aucune activation en production.');
    }
    return publicTask(task);
  } catch (error) {
    const current = loadState(root).tasks.find(t => t.id === id);
    if (current && !['blocked','deploy_blocked','rollback_attempted','deployed_runtime_unconfirmed','completed_runtime_healthy'].includes(current.status)) updateTask(root, id, { status: 'failed', error: String(error?.message || error).slice(0, 400), finishedAt: new Date().toISOString() }, 'Tâche arrêtée sans activation non validée.');
    appendAudit(root, { type: 'engineering_task_failed', message: 'Une tâche de développement autonome a échoué sans ignorer les contrôles.', details: { id, reason: String(error?.message || error).slice(0, 180) } });
    throw error;
  }
}
function cancelEngineeringTask(root, id) {
  const state = loadState(root); const task = state.tasks.find(t => t.id === id); if (!task) throw new Error('Tâche introuvable.');
  if (task.status === 'running' || task.status === 'deploying') throw new Error('Une tâche déjà en cours ne peut pas être interrompue à mi-opération. Mets l’autonomie en pause et attends la fin de l’étape sûre.');
  if (['completed_runtime_healthy','deployed_runtime_unconfirmed','rollback_attempted','pull_request_ready'].includes(task.status)) throw new Error('Une tâche déjà déployée ne peut pas être annulée ici; utilise la procédure de rollback dédiée.');
  task.status = 'cancelled'; task.updatedAt = new Date().toISOString(); task.steps.push({ at: task.updatedAt, status: task.status, message: 'Tâche annulée avant déploiement.' }); saveState(root, state);
  appendAudit(root, { type: 'engineering_task_cancelled', message: 'Tâche de développement annulée avant déploiement.', details: { id } }); return publicTask(task);
}
function recoverInterruptedEngineeringTasks(root, now = Date.now()) {
  const state = loadState(root); let changed = false;
  for (const task of state.tasks) {
    if (!['running','deploying'].includes(task.status)) continue;
    const updated = Date.parse(task.updatedAt || task.startedAt || task.createdAt || '');
    if (!Number.isFinite(updated) || now - updated < 10 * 60 * 1000) continue;
    const previousStatus = task.status;
    task.status = 'interrupted_needs_review'; task.updatedAt = new Date(now).toISOString();
    task.error = 'Le processus a été interrompu pendant cette tâche. Aucun nouvel essai automatique n’est lancé car le résultat de déploiement peut être incertain.';
    task.steps = Array.isArray(task.steps) ? task.steps : [];
    task.steps.push({ at: task.updatedAt, status: task.status, message: `Tâche récupérée après interruption (${previousStatus}); vérification des logs/releases requise.` });
    changed = true;
    appendAudit(root, { type: 'engineering_task_interrupted', message: 'Tâche d’ingénierie interrompue récupérée sans relance aveugle.', details: { id: task.id, previousStatus } });
  }
  if (changed) saveState(root, state);
  return changed;
}
async function runNextQueuedEngineeringTask(root, env = process.env) {
  recoverInterruptedEngineeringTasks(root);
  if (String(env.V6_AUTONOMOUS_ENGINEERING_ENABLED || '').toLowerCase() !== 'true' || readControl(root).paused === true) return { ok: false, skipped: true, reason: 'Agent désactivé ou autonomie en pause.' };
  const state = loadState(root);
  if (state.tasks.some(t => ['running','deploying'].includes(t.status))) return { ok: false, skipped: true, reason: 'Une tâche d’ingénierie est déjà en cours.' };
  const task = state.tasks.find(t => t.status === 'queued');
  if (!task) return { ok: true, skipped: true, reason: 'Aucune tâche en attente.' };
  try { return { ok: true, task: await runEngineeringTask(root, task.id, env) }; }
  catch (error) { return { ok: false, taskId: task.id, reason: String(error?.message || error).slice(0, 300) }; }
}

function engineeringAgentStatus(root, env = process.env) {
  const tasks = listEngineeringTasks(root);
  const target = String(env.V6_AUTONOMOUS_DEPLOY_ALLOWLIST || '').split(',').map(x => x.trim()).filter(Boolean);
  const health = String(env.V6_DEPLOY_HEALTH_URL || '').trim();
  return { enabled: String(env.V6_AUTONOMOUS_ENGINEERING_ENABLED || 'false').toLowerCase() === 'true', autoQueueEnabled: String(env.V6_AUTONOMOUS_ENGINEERING_ENABLED || 'false').toLowerCase() === 'true' && (Boolean(String(env.V6_AUTONOMOUS_ENGINEERING_TARGET || '').trim()) || listSafeEngineeringTargets(root).length > 0), automaticTargetConfigured: Boolean(String(env.V6_AUTONOMOUS_ENGINEERING_TARGET || '').trim()), mode: 'persistent_engineering_tasks_with_iterative_repair_and_isolated_focused_tests', automaticTestValidation: true, pullRequestEnabled: String(env.V6_AUTONOMOUS_PR_ENABLED || 'false').toLowerCase() === 'true', maxAttempts: clampInt(env.V6_ENGINEERING_MAX_ATTEMPTS, 2, 1, 3), safeTargets: listSafeEngineeringTargets(root), taskCount: tasks.length, activeTasks: tasks.filter(t => ['queued','running','deploying','candidate_ready','pull_request_ready'].includes(t.status)).length, completed: tasks.filter(t => t.status === 'completed_runtime_healthy').length, deployAllowlist: target, githubConfigured: Boolean(env.V6_GITHUB_TOKEN && env.V6_GITHUB_OWNER && env.V6_GITHUB_REPO), runtimeHealthConfigured: Boolean(health), requiresRuntimeHealth: String(env.V6_DEPLOY_REQUIRE_RUNTIME_HEALTH || 'true').toLowerCase() === 'true', latestTask: tasks[0] || null, note: 'La génération de candidat et les contrôles statiques sont locaux. Le déploiement automatique exige les portes de sécurité, une cible allowlistée, les identifiants GitHub et un endpoint HTTPS de santé.' };
}
module.exports = { createEngineeringTask, listEngineeringTasks, runEngineeringTask, runNextQueuedEngineeringTask, recoverInterruptedEngineeringTasks, cancelEngineeringTask, engineeringAgentStatus, safeTarget, runCandidateTests, listSafeEngineeringTargets };
