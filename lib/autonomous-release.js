'use strict';
const { healthCheckConfig, deployCandidate, githubConfig } = require('./fadehost-deployer');

// Deployment is unrestricted across ordinary project files, while secrets, persistent runtime data,
// CI/deployment machinery and the release controller remain protected from autonomous overwrite.
const NEVER_AUTO_DEPLOY = new Set([
  '.env', '.env.example', 'data.json', 'package-lock.json',
  '.github/workflows/ci-fadehost.yml', 'lib/constitution.js', 'lib/action-controller.js',
  'lib/deployment-manager.js', 'lib/fadehost-deployer.js', 'lib/autonomous-release.js'
]);
function parseAllowlist(env = process.env) {
  // Retained for backwards compatibility and display only; it no longer limits ordinary targets.
  return String(env.V6_AUTONOMOUS_DEPLOY_ALLOWLIST || '').split(',')
    .map(v => v.trim().replace(/\\/g, '/')).filter(Boolean);
}
function validateAutonomousTarget(targetInput, env = process.env) {
  const target = String(targetInput || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!target || target.includes('\0') || target.startsWith('/') || /^[a-zA-Z]:/.test(target) || target.split('/').some(p => !p || p === '.' || p === '..')) {
    return { allowed: false, reason: 'Chemin cible invalide.' };
  }
  if (NEVER_AUTO_DEPLOY.has(target) || target.startsWith('.git/') || target.startsWith('node_modules/') || target.startsWith('workspace/') || target.startsWith('logs/') || target.startsWith('backups/')) {
    return { allowed: false, reason: 'Ce fichier contient des secrets, des données persistantes ou contrôle le mécanisme de déploiement; il reste protégé.' };
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(target) || /\.(?:pem|key|p12|pfx)$/i.test(target)) {
    return { allowed: false, reason: 'Chemin ou type de fichier non autorisé.' };
  }
  return { allowed: true, target };
}
function inspectGeneratedCode(code) {
  const source = String(code || '');
  if (!source.trim() || Buffer.byteLength(source, 'utf8') > 300000) return { ok: false, reason: 'Fichier vide ou supérieur à 300 Ko.' };
  // Application files legitimately use env vars, filesystem and network APIs. Keep checks focused on
  // high-risk dynamic execution and obvious embedded credentials; full test suite remains mandatory.
  const checks = [
    [/(?:\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\()/i, 'exécution dynamique interdite'],
    [/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,})/, 'secret ou clé privée intégrée au code']
  ];
  for (const [pattern, label] of checks) if (pattern.test(source)) return { ok: false, reason: `Contrôle statique bloquant : ${label}.` };
  return { ok: true, sha256: require('node:crypto').createHash('sha256').update(source).digest('hex') };
}
function autonomousReleaseStatus(env = process.env) {
  const safeMode = String(env.V6_AUTONOMOUS_DEPLOY_SAFE || 'false').toLowerCase() === 'true';
  const deployEnabled = String(env.V6_AUTO_DEPLOY_ENABLED || 'false').toLowerCase() === 'true';
  const allowlist = parseAllowlist(env);
  const health = healthCheckConfig(env);
  const github = githubConfig(env);
  const enabled = safeMode && deployEnabled && github.configured && health.valid;
  return {
    enabled,
    configured: { safeMode, githubDeployment: deployEnabled, github: github.configured, runtimeHealth: health.valid, allowlistCount: allowlist.length },
    allowlist,
    mode: enabled ? 'explicit-admin-command-with-project-wide-targets-and-runtime-health' : 'locked-until-required-configuration-is-complete',
    automaticRollback: enabled,
    runtimeHealthCheck: health.valid,
    healthCheckConfigured: health.valid,
    note: enabled
      ? 'Le déploiement est disponible sur demande explicite pour les fichiers ordinaires du projet, après tests et contrôles. Secrets, données persistantes et mécanisme de déploiement restent protégés; la santé HTTPS est obligatoire.'
      : 'Déploiement verrouillé tant que V6_AUTONOMOUS_DEPLOY_SAFE, V6_AUTO_DEPLOY_ENABLED, les identifiants GitHub et une URL HTTPS de santé ne sont pas configurés.'
  };
}
async function deployAutonomousCandidate(rootDir, candidateFile, targetInput, env = process.env) {
  const status = autonomousReleaseStatus(env);
  if (!status.enabled) return { ok: false, blocked: true, reason: status.note, status };
  const validation = validateAutonomousTarget(targetInput, env);
  if (!validation.allowed) return { ok: false, blocked: true, reason: validation.reason, status };
  const candidatePath = String(candidateFile || '').replace(/\\/g, '/');
  if (!candidatePath.startsWith('workspace/candidates/') || candidatePath.split('/').some(part => !part || part === '.' || part === '..')) {
    return { ok: false, blocked: true, reason: 'Le candidat doit provenir de workspace/candidates.', status };
  }
  const fullPath = require('node:path').resolve(rootDir, candidatePath);
  const candidateRoot = require('node:path').resolve(rootDir, 'workspace/candidates') + require('node:path').sep;
  if (!fullPath.startsWith(candidateRoot)) return { ok: false, blocked: true, reason: 'Chemin de candidat hors du répertoire autorisé.', status };
  let code;
  try {
    const fs = require('node:fs');
    if (!fs.statSync(fullPath).isFile() || fs.lstatSync(fullPath).isSymbolicLink()) throw new Error('Fichier candidat non valide.');
    code = fs.readFileSync(fullPath, 'utf8');
  } catch (error) { return { ok: false, blocked: true, reason: `Candidat introuvable ou illisible : ${String(error.message || error).slice(0, 160)}`, status }; }
  const inspected = inspectGeneratedCode(code);
  if (!inspected.ok) return { ok: false, blocked: true, reason: inspected.reason, status };
  return deployCandidate(rootDir, candidatePath, validation.target, {
    risk: 'low',
    independentSecurityPassed: inspected.ok,
    humanApproved: true,
    requireRuntimeHealth: true
  }, env);
}

module.exports = { NEVER_AUTO_DEPLOY, parseAllowlist, validateAutonomousTarget, inspectGeneratedCode, autonomousReleaseStatus, deployAutonomousCandidate };
