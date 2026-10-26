'use strict';
const crypto = require('node:crypto');
const SAFE_TARGETS = new Set(['lib/adaptive-policy.js','lib/incident-forecaster.js','lib/command-planner.js','lib/multichannel.js','lib/prepublication.js','lib/publication-scheduler.js','lib/semantic-memory.js']);
function githubConfig(env = process.env) {
  const owner = String(env.V6_GITHUB_OWNER || '').trim();
  const repo = String(env.V6_GITHUB_REPO || '').trim();
  const branch = String(env.V6_GITHUB_PR_BASE_BRANCH || env.V6_GITHUB_BRANCH || 'main').trim();
  const token = String(env.V6_GITHUB_TOKEN || '').trim();
  const validName = value => /^[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..');
  return { configured: Boolean(token && validName(owner) && validName(repo) && branch && !branch.startsWith('-') && !branch.includes('..')), owner, repo, branch, tokenPresent: Boolean(token) };
}
async function requestJson(url, init, env, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${String(env.V6_GITHUB_TOKEN || '').trim()}`,
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(init?.headers || {})
    } });
    const bodyText = await response.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch {}
    if (!response.ok) {
      const error = new Error(`GitHub a répondu HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timer); }
}
function apiUrl(config, path) { return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}${path}`; }
async function createDraftPullRequest({ target, code, taskId, title, objective, expectedSource, env = process.env, fetchImpl = global.fetch }) {
  const config = githubConfig(env);
  if (!config.configured) return { ok: false, status: 'not_configured', reason: 'Configuration GitHub incomplète.' };
  if (!SAFE_TARGETS.has(target)) return { ok: false, status: 'blocked_target', reason: 'Le fichier n’est pas dans la liste autorisée pour les Pull Requests autonomes.' };
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 30000) return { ok: false, status: 'invalid_candidate', reason: 'Candidat vide ou trop volumineux.' };
  if (!/^[0-9]{10,}-[a-f0-9]{8}$/.test(String(taskId || ''))) return { ok: false, status: 'invalid_task_id', reason: 'Identifiant de tâche invalide.' };
  const filePath = `/${target.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const current = await requestJson(apiUrl(config, `/contents${filePath}?ref=${encodeURIComponent(config.branch)}`), { method: 'GET' }, env, fetchImpl);
    const remoteSource = Buffer.from(String(current.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
    if (remoteSource !== expectedSource) return { ok: false, status: 'remote_source_changed', reason: 'Le fichier GitHub ne correspond plus au fichier local; création de PR refusée pour éviter d’écraser des changements récents.' };
    const ref = await requestJson(apiUrl(config, `/git/ref/heads/${config.branch.split('/').map(encodeURIComponent).join('/')}`), { method: 'GET' }, env, fetchImpl);
    const branchName = `ai/hacoo-${taskId}`;
    await requestJson(apiUrl(config, '/git/refs'), { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: ref.object.sha }) }, env, fetchImpl);
    const commit = await requestJson(apiUrl(config, `/contents${filePath}`), { method: 'PUT', body: JSON.stringify({
      message: `ai: ${String(title || 'amélioration autonome').slice(0, 100)}`,
      content: Buffer.from(`${code.replace(/\s+$/, '')}\n`, 'utf8').toString('base64'),
      branch: branchName, sha: current.sha
    }) }, env, fetchImpl);
    const pr = await requestJson(apiUrl(config, '/pulls'), { method: 'POST', body: JSON.stringify({
      title: `[IA] ${String(title || 'Amélioration autonome').slice(0, 180)}`,
      head: branchName, base: config.branch, draft: true,
      body: `## Tâche autonome ${taskId}\n\n${String(objective || '').slice(0, 2500)}\n\n- Candidat testé dans un environnement isolé.\n- Cette Pull Request est en brouillon et n'est pas fusionnée automatiquement.\n- Vérifier les contrôles CI et le comportement avant toute fusion.\n\nCommit candidat : ${commit.commit?.sha || 'créé'}.`
    }) }, env, fetchImpl);
    return { ok: true, status: 'draft_pr_created', branch: branchName, pullRequestNumber: pr.number, pullRequestUrl: pr.html_url, commitSha: commit.commit?.sha || null, baseBranch: config.branch };
  } catch (error) {
    return { ok: false, status: 'github_error', reason: String(error?.message || error).slice(0, 300), httpStatus: error?.status || null };
  }
}
module.exports = { githubConfig, createDraftPullRequest };
