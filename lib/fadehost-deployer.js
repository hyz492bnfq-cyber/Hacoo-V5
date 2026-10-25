'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inspectCandidate } = require('./deployment-manager');
const { evaluateActivation } = require('./action-controller');
const { appendAudit } = require('./audit-log');

const PROTECTED_TARGETS = new Set([
  'lib/constitution.js', 'lib/action-controller.js', 'lib/deployment-manager.js',
  'lib/fadehost-deployer.js', 'index.js', 'package.json', 'package-lock.json',
  '.env', 'data.json', 'dashboard.html'
]);
function normalizeTarget(input) {
  const value = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.includes('\0') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Chemin cible invalide.');
  if (!value.startsWith('lib/') || !/^[a-zA-Z0-9_./-]+\.js$/.test(value) || PROTECTED_TARGETS.has(value)) {
    throw new Error('La cible doit être un module JavaScript sous lib/, hors fichiers de gouvernance et fichiers critiques.');
  }
  return value;
}
function healthCheckConfig(env = process.env) {
  const raw = String(env.V6_DEPLOY_HEALTH_URL || '').trim();
  if (!raw) return { configured: false, valid: false, reason: 'V6_DEPLOY_HEALTH_URL absent.' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return { configured: true, valid: false, reason: 'L’URL de santé doit être HTTPS, sans identifiants ni adresse locale.' };
    }
    const timeoutMs = Math.max(1000, Math.min(10000, Number(env.V6_DEPLOY_HEALTH_TIMEOUT_MS) || 4000));
    const attempts = Math.max(1, Math.min(12, Number(env.V6_DEPLOY_HEALTH_ATTEMPTS) || 6));
    const intervalMs = Math.max(1000, Math.min(15000, Number(env.V6_DEPLOY_HEALTH_INTERVAL_MS) || 5000));
    return { configured: true, valid: true, url: url.toString(), timeoutMs, attempts, intervalMs };
  } catch { return { configured: true, valid: false, reason: 'V6_DEPLOY_HEALTH_URL invalide.' }; }
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function verifyRuntimeHealth(env = process.env, fetchImpl = fetch) {
  const config = healthCheckConfig(env);
  if (!config.valid) return { ok: false, checked: false, reason: config.reason || 'Contrôle de santé non configuré.' };
  const attempts = [];
  for (let i = 1; i <= config.attempts; i++) {
    try {
      const response = await fetchImpl(config.url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs), headers: { 'Accept': 'application/json,text/plain' } });
      const healthy = response.ok;
      attempts.push({ attempt: i, status: response.status, healthy });
      if (healthy) return { ok: true, checked: true, attempts, url: config.url };
    } catch (error) {
      attempts.push({ attempt: i, error: String(error?.name || 'Error').slice(0, 40), healthy: false });
    }
    if (i < config.attempts) await wait(config.intervalMs);
  }
  return { ok: false, checked: true, attempts, url: config.url, reason: 'Le service n’a pas répondu sainement après le déploiement.' };
}
function githubConfig(env = process.env) {
  const token = String(env.V6_GITHUB_TOKEN || '').trim();
  const owner = String(env.V6_GITHUB_OWNER || '').trim();
  const repo = String(env.V6_GITHUB_REPO || '').trim();
  const branch = String(env.V6_GITHUB_BRANCH || '').trim();
  return { configured: Boolean(token && owner && repo && branch), token, owner, repo, branch };
}
async function githubRequest(config, url, options = {}) {
  const response = await fetch(url, { ...options, headers: {
    'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${config.token}`,
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HACOO-BOT-V6',
    ...(options.headers || {})
  }, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`GitHub API (${response.status}): ${String(body.message || 'requête refusée').slice(0, 180)}`);
  return body;
}
function runCandidateTests(rootDir, target, candidateCode) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-v6-predeploy-'));
  try {
    fs.cpSync(rootDir, temp, { recursive: true, filter: source => {
      const rel = path.relative(rootDir, source).split(path.sep);
      return !rel.some(part => ['node_modules', '.git', 'workspace', 'logs', 'backups', 'releases'].includes(part)) && !['.env', 'data.json'].includes(path.basename(source));
    }});
    const targetPath = path.join(temp, target);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, candidateCode, { mode: 0o600 });
    const safeEnv = { PATH: process.env.PATH || '', HOME: temp, TMPDIR: temp, TMP: temp, TEMP: temp, NODE_ENV: 'test', CI: 'true' };
    if (process.platform === 'win32' && process.env.SystemRoot) safeEnv.SystemRoot = process.env.SystemRoot;
    const check = spawnSync(process.execPath, ['--check', targetPath], { cwd: temp, env: safeEnv, encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (check.error || check.status !== 0) return { ok: false, reason: 'Échec de syntaxe du module cible dans l’environnement isolé.' };
    // The child process receives no application/API secrets. This is a clean test copy, not an OS-level security sandbox.
    const tests = spawnSync(process.execPath, ['--test'], { cwd: temp, env: safeEnv, encoding: 'utf8', timeout: 90000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const output = `${tests.stdout || ''}\n${tests.stderr || ''}`.slice(-5000);
    if (tests.error || tests.status !== 0) return { ok: false, reason: 'La suite de tests complète a échoué avec le candidat appliqué dans la copie temporaire.', output };
    return { ok: true, output };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
async function deployCandidate(rootDir, relativeFile, targetInput, options = {}, env = process.env) {
  if (String(env.V6_AUTO_DEPLOY_ENABLED || '').toLowerCase() !== 'true') return { ok: false, blocked: true, reason: 'Déploiement désactivé : définis V6_AUTO_DEPLOY_ENABLED=true après configuration et validation.' };
  const config = githubConfig(env);
  if (!config.configured) return { ok: false, blocked: true, reason: 'Configuration GitHub incomplète : V6_GITHUB_TOKEN, V6_GITHUB_OWNER, V6_GITHUB_REPO et V6_GITHUB_BRANCH sont requis.' };
  const healthConfig = healthCheckConfig(env);
  if (options.requireRuntimeHealth === true && !healthConfig.valid) return { ok: false, blocked: true, reason: `Déploiement autonome refusé : contrôle de santé runtime obligatoire. ${healthConfig.reason || ''}`.trim() };
  let target;
  try { target = normalizeTarget(targetInput); } catch (e) { return { ok: false, blocked: true, reason: e.message }; }
  const localTarget = path.resolve(rootDir, target);
  if (!localTarget.startsWith(path.resolve(rootDir) + path.sep) || !fs.existsSync(localTarget) || fs.lstatSync(localTarget).isSymbolicLink() || !fs.statSync(localTarget).isFile()) {
    return { ok: false, blocked: true, reason: 'La cible doit être un module existant dans le projet local afin que les tests puissent vérifier le remplacement.' };
  }
  const inspected = inspectCandidate(rootDir, relativeFile);
  if (!inspected.ok) return { ok: false, blocked: true, reason: inspected.reason, inspect: inspected };
  const code = fs.readFileSync(inspected.path, 'utf8');
  const risk = String(options.risk || 'medium');
  const securityPassed = options.independentSecurityPassed === true;
  const humanApproved = options.humanApproved === true;
  const tests = runCandidateTests(rootDir, target, code);
  const activation = evaluateActivation({ testsPassed: tests.ok, securityPassed: securityPassed && inspected.staticSecurityPassed, backupReady: true, rollbackReady: true, humanApproved, risk });
  if (!activation.allowed) return { ok: false, blocked: true, reason: 'Les portes de sécurité ont bloqué le déploiement.', activation, tests, inspect: inspected };
  if (!tests.ok) return { ok: false, blocked: true, reason: tests.reason, tests, activation };
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${target.split('/').map(encodeURIComponent).join('/')}`;
  let existing = null;
  try { existing = await githubRequest(config, `${apiRoot}?ref=${encodeURIComponent(config.branch)}`); }
  catch (e) { if (!String(e.message).includes('(404)')) return { ok: false, blocked: true, reason: `Impossible de lire la version actuelle : ${e.message}` }; }
  const previousContent = existing?.content ? Buffer.from(existing.content.replace(/\n/g, ''), 'base64') : null;
  const previousSha = existing?.sha || null;
  const releaseId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const releaseDir = path.join(rootDir, 'workspace', 'releases', releaseId);
  fs.mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
  const backup = { id: releaseId, createdAt: new Date().toISOString(), target, owner: config.owner, repo: config.repo, branch: config.branch, previousSha, previousContentBase64: previousContent?.toString('base64') || null, candidateSha256: inspected.sha256, status: 'prepared', note: 'Sauvegarde pré-déploiement. La restauration nécessite une action explicite.' };
  fs.writeFileSync(path.join(releaseDir, 'rollback.json'), JSON.stringify(backup, null, 2), { mode: 0o600 });
  const payload = { message: `HACOO V6 guarded deploy ${releaseId}: ${target}`, content: Buffer.from(code).toString('base64'), branch: config.branch, ...(previousSha ? { sha: previousSha } : {}) };
  try {
    const result = await githubRequest(config, apiRoot, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    backup.status = 'pushed_to_github'; backup.commitSha = result.commit?.sha || null; backup.committedAt = new Date().toISOString();
    fs.writeFileSync(path.join(releaseDir, 'rollback.json'), JSON.stringify(backup, null, 2), { mode: 0o600 });
    appendAudit(rootDir, { type: 'fadehost_deploy_pushed', message: 'Module candidat validé et poussé vers la branche configurée; vérification runtime en cours.', details: { releaseId, target, branch: config.branch, commitSha: backup.commitSha, testsPassed: true, securityPassed: true } });
    let runtimeHealth = { ok: false, checked: false, reason: 'Contrôle runtime non demandé.' };
    if (options.requireRuntimeHealth === true || healthConfig.valid) runtimeHealth = await verifyRuntimeHealth(env);
    if (options.requireRuntimeHealth === true && !runtimeHealth.ok) {
      let rollback;
      try { rollback = await rollbackDeployment(rootDir, releaseId, env); }
      catch (rollbackError) { rollback = { ok: false, reason: String(rollbackError?.message || rollbackError).slice(0, 200) }; }
      backup.status = rollback?.ok ? 'automatic_rollback_pushed' : 'automatic_rollback_failed';
      backup.runtimeHealth = runtimeHealth;
      backup.automaticRollback = { attempted: true, ...rollback, at: new Date().toISOString() };
      fs.writeFileSync(path.join(releaseDir, 'rollback.json'), JSON.stringify(backup, null, 2), { mode: 0o600 });
      appendAudit(rootDir, { type: rollback?.ok ? 'fadehost_auto_rollback_succeeded' : 'fadehost_auto_rollback_failed', message: rollback?.ok ? 'Contrôle runtime négatif : restauration automatique poussée vers GitHub.' : 'Contrôle runtime négatif et restauration automatique non confirmée; intervention requise.', details: { releaseId, target, runtimeHealth, rollbackOk: Boolean(rollback?.ok) } });
      return { ok: false, deployedToRepository: true, fadeHostRuntimeConfirmed: false, releaseId, target, branch: config.branch, commitSha: backup.commitSha, runtimeHealth, rollback: { available: true, automatic: true, attempted: true, ...rollback }, reason: runtimeHealth.reason, note: rollback?.ok ? 'Le contrôle runtime a échoué; la version précédente a été repoussée automatiquement. Vérifie les logs FadeHost.' : 'Le contrôle runtime a échoué et le rollback n’est pas confirmé. Intervention immédiate requise.' };
    }
    backup.runtimeHealth = runtimeHealth;
    backup.status = runtimeHealth.ok ? 'runtime_healthy' : 'pushed_runtime_unconfirmed';
    fs.writeFileSync(path.join(releaseDir, 'rollback.json'), JSON.stringify(backup, null, 2), { mode: 0o600 });
    return { ok: true, deployedToRepository: true, fadeHostRuntimeConfirmed: runtimeHealth.ok, releaseId, target, branch: config.branch, commitSha: backup.commitSha, tests: { ok: true, summary: 'Syntaxe et suite de tests exécutées dans une copie temporaire avec environnement épuré; ce n’est pas une sandbox système.' }, runtimeHealth, rollback: { available: true, file: path.relative(rootDir, path.join(releaseDir, 'rollback.json')), automatic: options.requireRuntimeHealth === true }, note: runtimeHealth.ok ? 'Le contrôle de santé HTTPS a répondu avec succès après le push.' : 'Le push GitHub est confirmé, mais le runtime FadeHost n’a pas été confirmé.' };
  } catch (e) {
    appendAudit(rootDir, { type: 'fadehost_deploy_failed', message: 'Le push GitHub du candidat a échoué.', details: { releaseId, target, error: String(e.message || e).slice(0, 200) } });
    return { ok: false, blocked: true, reason: `Le push GitHub a échoué : ${e.message}`, releaseId, rollbackFile: path.relative(rootDir, path.join(releaseDir, 'rollback.json')) };
  }
}

async function rollbackDeployment(rootDir, releaseId, env = process.env) {
  if (String(env.V6_AUTO_DEPLOY_ENABLED || '').toLowerCase() !== 'true') return { ok: false, blocked: true, reason: 'Déploiement/rollback désactivé.' };
  if (!/^\d{10,}-[a-f0-9]{8}$/.test(String(releaseId || ''))) return { ok: false, blocked: true, reason: 'Identifiant de release invalide.' };
  const config = githubConfig(env);
  if (!config.configured) return { ok: false, blocked: true, reason: 'Configuration GitHub incomplète.' };
  const rollbackPath = path.join(rootDir, 'workspace', 'releases', releaseId, 'rollback.json');
  if (!fs.existsSync(rollbackPath)) return { ok: false, blocked: true, reason: 'Sauvegarde de retour arrière introuvable.' };
  const backup = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
  if (backup.owner !== config.owner || backup.repo !== config.repo || backup.branch !== config.branch) return { ok: false, blocked: true, reason: 'La sauvegarde appartient à un autre dépôt ou une autre branche.' };
  const target = normalizeTarget(backup.target);
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${target.split('/').map(encodeURIComponent).join('/')}`;
  const current = await githubRequest(config, `${apiRoot}?ref=${encodeURIComponent(config.branch)}`);
  if (!current?.sha) return { ok: false, blocked: true, reason: 'Impossible de lire la version actuellement déployée.' };
  if (backup.previousContentBase64 === null) {
    await githubRequest(config, apiRoot, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `HACOO V6 rollback ${releaseId}: remove ${target}`, sha: current.sha, branch: config.branch }) });
  } else {
    await githubRequest(config, apiRoot, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `HACOO V6 rollback ${releaseId}: restore ${target}`, content: backup.previousContentBase64, sha: current.sha, branch: config.branch }) });
  }
  backup.status = 'rollback_pushed'; backup.rollbackAt = new Date().toISOString();
  fs.writeFileSync(rollbackPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  appendAudit(rootDir, { type: 'fadehost_rollback_pushed', message: 'Restauration de la version précédente poussée vers GitHub; vérifier le redéploiement FadeHost.', details: { releaseId, target, branch: config.branch } });
  return { ok: true, releaseId, target, branch: config.branch, runtimeConfirmed: false, note: 'Restauration poussée vers GitHub. Vérifie le redéploiement et les logs FadeHost.' };
}

module.exports = { deployCandidate, rollbackDeployment, githubConfig, normalizeTarget, runCandidateTests, healthCheckConfig, verifyRuntimeHealth };
