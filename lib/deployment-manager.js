'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateCandidatePath, evaluateActivation } = require('./action-controller');
const { appendAudit } = require('./audit-log');
function inspectCandidate(rootDir, relativeFile, options = {}) {
  const checked = validateCandidatePath(rootDir, relativeFile);
  if (!checked.allowed) return { ok: false, reason: checked.reason };
  if (!fs.existsSync(checked.path)) return { ok: false, reason: 'Fichier candidat introuvable.' };
  const root = path.resolve(rootDir, 'workspace', 'candidates');
  try {
    if (fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(checked.path).isSymbolicLink()) return { ok: false, reason: 'Les liens symboliques sont interdits dans les candidats.' };
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(checked.path);
    const relativeReal = path.relative(realRoot, realCandidate);
    if (relativeReal.startsWith('..' + path.sep) || relativeReal === '..' || path.isAbsolute(relativeReal)) return { ok: false, reason: 'Le candidat résout en dehors de workspace/candidates.' };
  } catch { return { ok: false, reason: 'Impossible de vérifier le chemin réel du candidat.' };
  }
  if (!fs.statSync(checked.path).isFile()) return { ok: false, reason: 'Le candidat doit être un fichier ordinaire.' };
  const code = fs.readFileSync(checked.path, 'utf8');
  if (code.length > 30000) return { ok: false, reason: 'Le candidat dépasse 30 Ko.' };
  const checks = [
    [/\bprocess\s*(?:\.\s*env|\[\s*['"]env['"]\s*\]|\.\s*(?:binding|dlopen|exit))\b/i, 'accès au processus ou aux variables secrètes'],
    [/\b(?:require|module\s*\.\s*require)\s*\(\s*['"](?:node:)?(?:child_process|net|http|https|dgram|tls|vm|worker_threads|cluster|os|module|inspector|repl|readline|dns|http2|perf_hooks|process|v8|zlib)['"]\s*\)/i, 'API système ou réseau'],
    [/\bimport\s*\(/i, 'importation dynamique'],
    [/\b(?:eval|Function)\s*\(/i, 'exécution dynamique'],
    [/\bnew\s+Function\b/i, 'exécution dynamique'],
    [/\b(?:unlink|rm|rmdir)Sync?\s*\(/i, 'suppression de fichiers'],
    [/\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/i, 'accès réseau'],
    [/\b(?:constitution|action-controller|fadehost-deployer)\b/i, 'référence à une zone de gouvernance protégée']
  ];
  if (!options.allowFilesystem) checks.push([/\b(?:require|module\s*\.\s*require)\s*\(\s*['"](?:node:)?fs['"]\s*\)/i, 'accès fichier non autorisé pour cette cible']);
  for (const [pattern, label] of checks) if (pattern.test(code)) return { ok: false, reason: `Contrôle de sécurité statique bloqué : ${label}.` };
  const syntax = spawnSync(process.execPath, ['--check', checked.path], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (syntax.error || syntax.status !== 0) return { ok: false, reason: 'Échec du contrôle syntaxique JavaScript.' };
  return { ok: true, path: checked.path, relativeFile, sha256: crypto.createHash('sha256').update(code).digest('hex'), bytes: Buffer.byteLength(code), syntaxPassed: true, staticSecurityPassed: true };
}
function stageCandidate(rootDir, relativeFile, options = {}) {
  const inspect = inspectCandidate(rootDir, relativeFile);
  const activation = evaluateActivation({ testsPassed: options.testsPassed === true, securityPassed: inspect.ok && options.independentSecurityPassed === true, backupReady: options.backupReady === true, rollbackReady: options.rollbackReady === true, humanApproved: options.humanApproved === true, risk: options.risk || 'medium' });
  const autoEnabled = String(process.env.V6_AUTO_DEPLOY_ENABLED || 'false').toLowerCase() === 'true';
  // Staging never activates production. Actual GitHub push is handled separately by fadehost-deployer.js with its own gates.
  const hostAdapter = String(process.env.V6_DEPLOY_ADAPTER || '').trim();
  if (!inspect.ok) return { ok: false, staged: false, inspect, activation, reason: inspect.reason };
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const releaseDir = path.join(rootDir, 'workspace', 'releases', id); fs.mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
  const dest = path.join(releaseDir, path.basename(inspect.path)); fs.copyFileSync(inspect.path, dest); fs.chmodSync(dest, 0o600);
  const record = { id, createdAt: new Date().toISOString(), source: relativeFile, artifact: path.relative(rootDir, dest), sha256: inspect.sha256, syntaxPassed: inspect.syntaxPassed, staticSecurityPassed: inspect.staticSecurityPassed, testsPassed: options.testsPassed === true, independentSecurityPassed: options.independentSecurityPassed === true, backupReady: options.backupReady === true, rollbackReady: options.rollbackReady === true, humanApproved: options.humanApproved === true, risk: options.risk || 'medium', activation, autoDeployEnabled: autoEnabled, hostAdapterConfigured: Boolean(hostAdapter), activationAdapterImplemented: false, activated: false, status: 'staged_not_activated', note: 'Le candidat est copié dans une release isolée. Aucun remplacement du code actif n’est effectué par cette fonction.' };
  fs.writeFileSync(path.join(releaseDir, 'release.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  appendAudit(rootDir, { type: 'candidate_staged', message: 'Candidat validé syntaxiquement et copié dans une release isolée; production inchangée.', details: { id, sha256: inspect.sha256, activationAllowedByPolicy: activation.allowed, autoEnabled, hostAdapterConfigured: Boolean(hostAdapter) } });
  return { ok: true, staged: true, release: record, inspect, activation, productionChanged: false, autoActivationAvailable: false };
}
module.exports = { inspectCandidate, stageCandidate };
