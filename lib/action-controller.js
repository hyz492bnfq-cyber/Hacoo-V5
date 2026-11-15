'use strict';
const path = require('node:path');

const BLOCKED_NAMES = new Set([
  '.env', '.env.local', '.env.production', 'data.json', 'data.json.bak',
  'constitution.js', 'action-controller.js', 'package-lock.json'
]);
const BLOCKED_SEGMENTS = new Set(['node_modules', '.git', 'secrets', 'production', 'backups']);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function validateCandidatePath(rootDir, candidatePath) {
  const root = path.resolve(rootDir, 'workspace', 'candidates');
  const candidate = path.resolve(rootDir, candidatePath);
  if (!isInside(root, candidate)) return { allowed: false, reason: 'Le fichier doit rester dans workspace/candidates.' };
  const segments = path.relative(root, candidate).split(path.sep);
  if (segments.some(segment => BLOCKED_SEGMENTS.has(segment) || BLOCKED_NAMES.has(segment))) {
    return { allowed: false, reason: 'Le chemin vise une zone ou un fichier protégé.' };
  }
  if (!/\.(c?js|mjs|json|md|txt)$/i.test(candidate)) return { allowed: false, reason: 'Extension de fichier non autorisée pour un candidat.' };
  return { allowed: true, path: candidate };
}

function evaluateActivation({ testsPassed, securityPassed, backupReady, rollbackReady, humanApproved = false, risk = 'low' }) {
  const failures = [];
  if (testsPassed !== true) failures.push('tests_non_valides');
  if (securityPassed !== true) failures.push('controle_securite_non_valide');
  if (backupReady !== true) failures.push('sauvegarde_absente');
  if (rollbackReady !== true) failures.push('retour_arriere_absent');
  if (risk !== 'low' && humanApproved !== true) failures.push('autorisation_humaine_requise');
  return { allowed: failures.length === 0, failures, mode: 'guarded' };
}

module.exports = { validateCandidatePath, evaluateActivation };
