'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ARTICLES, VERSION, SUPREME_RULE } = require('./constitution');
const { validateCandidatePath, evaluateActivation } = require('./action-controller');
const { generateText } = require('./provider-manager');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function safeText(value, max = 4000) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, max); }

function createProposal(rootDir, input) {
  const title = safeText(input?.title, 120);
  const rationale = safeText(input?.rationale, 2000);
  const expectedBenefit = safeText(input?.expectedBenefit, 1000);
  if (title.length < 4 || rationale.length < 12) throw new Error('Le titre doit faire au moins 4 caractères et la justification au moins 12.');
  const proposalDir = path.resolve(rootDir, 'workspace', 'proposals');
  ensureDir(proposalDir);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const proposal = {
    id, createdAt: new Date().toISOString(), status: 'proposed', title, rationale,
    expectedBenefit, source: 'dashboard', constitutionVersion: VERSION,
    note: 'Proposition uniquement : aucun code n’a été modifié ni déployé.'
  };
  const file = path.join(proposalDir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return proposal;
}


function extractCode(raw) {
  let code = String(raw || '').trim();
  const match = code.match(/^```(?:javascript|js|node)?\s*\n([\s\S]*?)\n```$/i);
  if (match) code = match[1];
  if (!code || code.length > 30000) throw new Error('Le code candidat est vide ou dépasse 30 Ko.');
  // Static guardrail only: candidate files are never executed by this feature.
  const blocked = [
    [/\beval\s*\(/i, 'eval'],
    [/\bnew\s+Function\s*\(/i, 'Function dynamique'],
    [/\bprocess\s*\.\s*exit\s*\(/i, 'arrêt du processus'],
    [/require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/i, 'child_process'],
    [/\bprocess\s*\.\s*env\b/i, 'accès aux variables d’environnement'],
    [/\b(?:exec|execSync|spawn|spawnSync)\s*\(/i, 'exécution de commande']
  ];
  for (const [pattern, label] of blocked) if (pattern.test(code)) throw new Error(`Code candidat bloqué par contrôle statique : ${label}.`);
  return code;
}

async function generateCandidate(rootDir, input, env = process.env) {
  const title = safeText(input?.title, 120);
  const requirements = safeText(input?.requirements || input?.rationale, 3000);
  if (title.length < 4 || requirements.length < 20) throw new Error('Indique un titre et au moins 20 caractères de besoin.');
  const prompt = [
    'Génère un module JavaScript CommonJS candidat pour HACOO BOT V6.',
    'Le code est seulement une proposition isolée; il ne sera pas exécuté ni déployé automatiquement.',
    'Contraintes : aucun accès à process.env, aucune exécution de commande, aucun eval/Function dynamique, aucune suppression de données, aucun changement de constitution ou de contrôle de sécurité.',
    'Fournis uniquement le code JavaScript complet, sans explication ni bloc Markdown.',
    `Titre : ${title}`,
    `Besoin : ${requirements}`,
    'Le module doit être petit, testable, documenté et exporter ses fonctions avec module.exports.'
  ].join('\n');
  const result = await generateText(prompt, { maxTokens: 1200, timeoutMs: 20000 }, env);
  if (!result.ok) throw new Error('Aucun fournisseur IA n’a pu générer le candidat. Vérifie les clés et les quotas.');
  const code = extractCode(result.text);
  const candidateDir = path.resolve(rootDir, 'workspace', 'candidates');
  ensureDir(candidateDir);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const relative = path.join('workspace', 'candidates', `${id}.js`);
  const validation = validateCandidatePath(rootDir, relative);
  if (!validation.allowed) throw new Error(validation.reason);
  // Syntax check without executing candidate code.
  const vm = require('node:vm');
  try { new vm.Script(code, { filename: `${id}.js` }); }
  catch { throw new Error('Le candidat généré contient une erreur de syntaxe JavaScript.'); }
  fs.writeFileSync(validation.path, code + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const metadata = {
    id, createdAt: new Date().toISOString(), status: 'candidate_review_required', title,
    requirements, file: relative, provider: result.provider, model: result.model,
    syntaxValid: true, executed: false, deployed: false,
    note: 'Fichier isolé non exécuté. Revue humaine, tests dans un environnement isolé et validation de sécurité nécessaires.'
  };
  const proposalDir = path.resolve(rootDir, 'workspace', 'proposals');
  ensureDir(proposalDir);
  fs.writeFileSync(path.join(proposalDir, `${id}.candidate.json`), JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return metadata;
}

function listCandidates(rootDir) {
  const dir = path.resolve(rootDir, 'workspace', 'proposals');
  ensureDir(dir);
  return fs.readdirSync(dir).filter(name => name.endsWith('.candidate.json')).slice(-50).reverse().flatMap(name => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))]; } catch { return []; }
  });
}

function labStatus(rootDir) {
  const proposalsDir = path.resolve(rootDir, 'workspace', 'proposals');
  ensureDir(proposalsDir);
  const proposals = fs.readdirSync(proposalsDir).filter(name => name.endsWith('.json')).slice(-100);
  return {
    enabled: String(process.env.V6_SELF_DEVELOPMENT_ENABLED ?? 'true').toLowerCase() !== 'false',
    mode: 'candidate_generation_review_only',
    candidatesCount: listCandidates(rootDir).length,
    proposalsCount: proposals.length,
    candidateWorkspace: path.resolve(rootDir, 'workspace', 'candidates'),
    constitutionVersion: VERSION,
    supremeRule: SUPREME_RULE,
    articles: ARTICLES,
    automaticProductionDeployment: false,
    note: 'Le laboratoire peut générer des fichiers candidats isolés et vérifier leur syntaxe, mais ne les exécute jamais et ne déploie rien automatiquement.'
  };
}

module.exports = { createProposal, generateCandidate, listCandidates, extractCode, labStatus, validateCandidatePath, evaluateActivation };
