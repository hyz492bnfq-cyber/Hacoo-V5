'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { deployCandidate, healthCheckConfig } = require('./fadehost-deployer');
const { appendAudit } = require('./audit-log');

// Fail-closed policy: autonomous deployment is opt-in and limited to an exact
// administrator-maintained allowlist. This is a policy gate, not a sandbox.
const NEVER_AUTO_DEPLOY = new Set([
  'index.js', 'dashboard.html', 'package.json', 'package-lock.json', 'data.json',
  '.env', 'lib/constitution.js', 'lib/action-controller.js',
  'lib/deployment-manager.js', 'lib/fadehost-deployer.js', 'lib/autonomous-release.js',
  'lib/publication-scheduler.js', 'lib/semantic-memory.js'
]);
function parseAllowlist(env = process.env) {
  return String(env.V6_AUTONOMOUS_DEPLOY_ALLOWLIST || '').split(',')
    .map(v => v.trim().replace(/\\/g, '/')).filter(Boolean);
}
function validateAutonomousTarget(targetInput, env = process.env) {
  const target = String(targetInput || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!target || target.includes('\0') || target.split('/').some(p => !p || p === '.' || p === '..')) {
    return { allowed: false, reason: 'Chemin cible invalide.' };
  }
  if (!/^lib\/[a-zA-Z0-9_-]+\.js$/.test(target) || NEVER_AUTO_DEPLOY.has(target)) {
    return { allowed: false, reason: 'Le déploiement autonome est limité aux modules lib/*.js non critiques.' };
  }
  if (!parseAllowlist(env).includes(target)) {
    return { allowed: false, reason: 'La cible ne figure pas dans V6_AUTONOMOUS_DEPLOY_ALLOWLIST.' };
  }
  return { allowed: true, target };
}
function inspectGeneratedCode(code) {
  const source = String(code || '');
  if (!source.trim() || source.length > 30000) return { ok: false, reason: 'Code vide ou supérieur à 30 Ko.' };
  const checks = [
    [/(?:process\s*\.\s*env|process\s*\[\s*['"]env['"]\s*\])/i, 'accès aux variables d’environnement'],
    [/(?:child_process|node:fs|require\s*\(\s*['"](?:fs|net|http|https|tls|dgram|worker_threads|cluster|module|vm|inspector|process)['"]\s*\))/i, 'API système ou réseau interdite'],
    [/(?:\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\()/i, 'exécution dynamique'],
    [/(?:\bfetch\s*\(|\bWebSocket\b|XMLHttpRequest)/i, 'accès réseau direct'],
    [/(?:\b(?:unlink|rmdir|rm)Sync?\s*\(|\bwriteFileSync\s*\(|\bappendFileSync\s*\()/i, 'écriture ou suppression de fichiers'],
    [/(?:constitution|action-controller|fadehost-deployer|autonomous-release)/i, 'référence à la gouvernance ou au déploiement']
  ];
  for (const [pattern, label] of checks) if (pattern.test(source)) return { ok: false, reason: `Contrôle statique bloquant : ${label}.` };
  return { ok: true, sha256: require('node:crypto').createHash('sha256').update(source).digest('hex') };
}
function autonomousReleaseStatus(env = process.env) {
  const enabled = String(env.V6_AUTONOMOUS_DEPLOY_SAFE || 'false').toLowerCase() === 'true';
  const deployEnabled = String(env.V6_AUTO_DEPLOY_ENABLED || 'false').toLowerCase() === 'true';
  const allowlist = parseAllowlist(env);
  return {
    enabled: enabled && deployEnabled && allowlist.length > 0 && healthCheckConfig(env).valid,
    configured: { safeMode: enabled, githubDeployment: deployEnabled, allowlistCount: allowlist.length },
    allowlist,
    mode: 'allowlisted-low-risk-only',
    automaticRollback: enabled && deployEnabled && healthCheckConfig(env).valid,
    runtimeHealthCheck: healthCheckConfig(env).valid,
    healthCheckConfigured: healthCheckConfig(env).valid,
    note: healthCheckConfig(env).valid ? 'Déploiement limité à une allowlist exacte, tests requis, contrôle de santé HTTPS après push et rollback GitHub automatique si le runtime échoue.' : 'Déploiement autonome bloqué tant qu’une URL HTTPS de santé runtime n’est pas configurée; le push GitHub seul ne prouve pas le démarrage de FadeHost.'
  };
}
async function deployAutonomousCandidate(rootDir, candidateFile, targetInput, env = process.env) {
  const status = autonomousReleaseStatus(env);
  if (!status.enabled) return { ok: false, blocked: true, reason: 'Déploiement autonome sûr désactivé ou incomplet. Active V6_AUTONOMOUS_DEPLOY_SAFE et V6_AUTO_DEPLOY_ENABLED et configure une allowlist exacte.', status };
  const targetCheck = validateAutonomousTarget(targetInput, env);
  if (!targetCheck.allowed) return { ok: false, blocked: true, reason: targetCheck.reason, status };
  const candidatePath = path.resolve(rootDir, candidateFile);
  const candidateRoot = path.resolve(rootDir, 'workspace', 'candidates') + path.sep;
  if (!candidatePath.startsWith(candidateRoot) || !fs.existsSync(candidatePath) || fs.lstatSync(candidatePath).isSymbolicLink() || !fs.statSync(candidatePath).isFile()) {
    return { ok: false, blocked: true, reason: 'Le candidat doit être un fichier ordinaire de workspace/candidates.', status };
  }
  const code = fs.readFileSync(candidatePath, 'utf8');
  const staticCheck = inspectGeneratedCode(code);
  if (!staticCheck.ok) {
    appendAudit(rootDir, { type: 'autonomous_deploy_blocked', message: 'Le contrôle statique a bloqué le déploiement autonome.', details: { target: targetCheck.target, reason: staticCheck.reason } });
    return { ok: false, blocked: true, reason: staticCheck.reason, status };
  }
  // deployCandidate performs candidate inspection, clean-copy tests, backup creation,
  // policy gates and a guarded GitHub push. Runtime FadeHost health still needs checking.
  const result = await deployCandidate(rootDir, path.relative(rootDir, candidatePath), targetCheck.target, {
    risk: 'low', independentSecurityPassed: true, humanApproved: false, requireRuntimeHealth: true
  }, env);
  appendAudit(rootDir, {
    type: result.ok ? 'autonomous_deploy_push_succeeded' : 'autonomous_deploy_blocked',
    message: result.ok ? 'Déploiement autonome à faible risque poussé vers GitHub après contrôles.' : 'Déploiement autonome refusé ou échoué; production runtime non confirmée.',
    details: { target: targetCheck.target, candidateSha256: staticCheck.sha256, ok: Boolean(result.ok), releaseId: result.releaseId || null, reason: result.reason || null }
  });
  return { ...result, autonomousPolicy: status, target: targetCheck.target, staticCheck, runtimeHealthConfirmed: Boolean(result.fadeHostRuntimeConfirmed), runtimeHealth: result.runtimeHealth || null };
}
module.exports = { NEVER_AUTO_DEPLOY, parseAllowlist, validateAutonomousTarget, inspectGeneratedCode, autonomousReleaseStatus, deployAutonomousCandidate };
