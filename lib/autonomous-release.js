'use strict';
const { healthCheckConfig } = require('./fadehost-deployer');

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
  const health = healthCheckConfig(env);
  return {
    // Kept fail-closed until a validated-commit deployment path and enforceable
    // branch protection are available. These legacy flags cannot unlock it.
    enabled: false,
    configured: { safeMode: enabled, githubDeployment: deployEnabled, allowlistCount: allowlist.length },
    allowlist,
    mode: 'candidate-and-draft-pr-only',
    automaticRollback: false,
    runtimeHealthCheck: health.valid,
    healthCheckConfigured: health.valid,
    note: 'Déploiement autonome verrouillé : le chemin FadeHost ne peut pas épingler le SHA validé et la branche principale ne dispose pas de protection vérifiable.'
  };
}
async function deployAutonomousCandidate(_rootDir, _candidateFile, _targetInput, env = process.env) {
  const status = autonomousReleaseStatus(env);
  return {
    ok: false,
    blocked: true,
    reason: 'Déploiement autonome verrouillé : un SHA validé et une protection de branche vérifiable sont requis.',
    status
  };
}
module.exports = { NEVER_AUTO_DEPLOY, parseAllowlist, validateAutonomousTarget, inspectGeneratedCode, autonomousReleaseStatus, deployAutonomousCandidate };
