'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { generateText } = require('./provider-manager');
const { appendAudit } = require('./audit-log');
function reportStatePath(root) { return path.join(root, 'workspace', 'daily-report-state.json'); }
function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function readState(root) { try { return JSON.parse(fs.readFileSync(reportStatePath(root), 'utf8')); } catch { return {}; } }
function saveState(root, value) { const file = reportStatePath(root); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
function reportMetrics(data) {
  const jobs = Array.isArray(data?.pendingJobs) ? data.pendingJobs : [];
  const stats = data?.stats || {};
  return { queuePending: jobs.length, failedOrManualReview: jobs.filter(j => j.status === 'failed' || j.stage === 'manual_review').length, pendingAlbums: (data?.pendingAlbums || []).length, errors: Number(stats.errors || 0), duplicates: Number(stats.duplicates || 0), deleted: Number(stats.deleted || 0), moderation: Number(stats.moderation || 0), totalSeen: Number(stats.totalSeen || 0), paused: Boolean(data?.botPaused || !data?.enabled), lastErrorPresent: Boolean(stats.lastError?.message) };
}
async function runDailyReport({ rootDir, data, bot, adminId, env = process.env, force = false }) {
  if (String(env.V6_DAILY_REPORT_ENABLED ?? 'true').toLowerCase() === 'false') return { ok: false, status: 'disabled' };
  const now = new Date(); const day = localDateKey(now); const state = readState(rootDir);
  if (state.day === day) return { ok: false, status: state.status === 'sent' ? 'already_sent_today' : 'already_attempted_today' };
  const targetHour = Math.max(0, Math.min(23, Number(env.V6_DAILY_REPORT_HOUR || 9)));
  if (!force && now.getHours() < targetHour) return { ok: false, status: 'not_due' };
  const metrics = reportMetrics(data);
  let narrative = `Rapport HACOO BOT — ${day}\nFile : ${metrics.queuePending} en attente; ${metrics.failedOrManualReview} à vérifier.\nAlbums en attente : ${metrics.pendingAlbums}. Erreurs cumulées : ${metrics.errors}. Doublons : ${metrics.duplicates}. Publications vues : ${metrics.totalSeen}.\nÉtat : ${metrics.paused ? 'en pause/désactivé' : 'actif'}.`;
  // Lock before network calls: a provider or Telegram outage must not trigger a retry storm every 15 seconds.
  saveState(rootDir, { day, status: 'attempting', attemptedAt: new Date().toISOString(), metrics });
  const ai = await generateText(`Rédige en français un bref rapport opérationnel quotidien (maximum 6 puces) pour l’administrateur d’un bot de modération Telegram. Utilise uniquement ces compteurs agrégés; n’invente pas de faits et ne recommande jamais de désactiver la sécurité. Signale ce qui demande vérification. Statistiques: ${JSON.stringify(metrics)}`, { maxTokens: 350, timeoutMs: 12000 }, env);
  if (ai.ok) narrative += `\n\nAnalyse IA (${ai.provider}/${ai.model}) :\n${ai.text.slice(0, 2200)}`;
  await bot.api.sendMessage(adminId, narrative.slice(0, 3900));
  saveState(rootDir, { day, status: 'sent', sentAt: new Date().toISOString(), metrics, aiUsed: ai.ok, provider: ai.provider || null, model: ai.model || null });
  appendAudit(rootDir, { type: 'daily_report_sent', message: 'Rapport opérationnel quotidien envoyé à l’administrateur.', details: { day, aiUsed: ai.ok, metrics } });
  return { ok: true, day, aiUsed: ai.ok };
}
module.exports = { runDailyReport, reportMetrics, localDateKey };
