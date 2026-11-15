'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'package.json',
  'package-lock.json',
  'index.js',
  'dashboard.html',
  'dashboard-autonomie.html',
  '.env.example',
  '.gitignore',
  '.github/workflows/ci-fadehost.yml',
  'scripts/check-dashboard.js'
];
const errors = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Fichier indispensable absent : ${file}`);
}

if (!errors.length) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (lock.name !== pkg.name || lock.version !== pkg.version || lock.lockfileVersion < 3) {
    errors.push('package-lock.json ne correspond pas à package.json ou n’utilise pas le lockfile v3.');
  }
  if (!String(pkg.engines?.node || '').includes('20.9.0')) {
    errors.push('Le moteur Node.js minimal doit refléter la compatibilité requise par sharp.');
  }
  if (!String(pkg.dependencies?.sharp || '').includes('0.35.5')) {
    errors.push('sharp doit rester sur la version corrigée 0.35.5 ou une version compatible plus récente.');
  }

  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const entries = new Map();
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) entries.set(match[1], match[2]);
  }
  for (const key of ['BOT_TOKEN', 'ADMIN_ID', 'CHANNEL_ID', 'DASHBOARD_PASSWORD']) {
    if (!entries.has(key)) errors.push(`Variable obligatoire non documentée : ${key}`);
  }
  for (const key of [
    'V6_AUTONOMOUS_ENGINEERING_ENABLED',
    'V6_AUTONOMOUS_PR_ENABLED',
    'V6_AUTONOMOUS_DEPLOY_SAFE',
    'V6_AUTO_DEPLOY_ENABLED'
  ]) {
    if (entries.get(key)?.toLowerCase() !== 'false') {
      errors.push(`La porte d’autonomie doit rester à false par défaut : ${key}`);
    }
  }

  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    .split(/\r?\n/).map(line => line.trim());
  if (!ignore.includes('.env') || !ignore.includes('data.json')) {
    errors.push('.gitignore doit exclure .env et data.json.');
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Configuration et ${requiredFiles.length} fichiers indispensables vérifiés; valeurs secrètes non lues.`);
}
