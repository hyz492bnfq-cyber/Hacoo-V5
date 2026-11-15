'use strict';
function forecastIncidents(data, now = Date.now()) {
  const jobs = Array.isArray(data?.pendingJobs) ? data.pendingJobs : [];
  const oldest = jobs.reduce((v, job) => { const n = Number(job.createdAt || 0); return n > 0 && (!v || n < v) ? n : v; }, 0);
  const staleMinutes = oldest ? Math.floor((now - oldest) / 60000) : 0;
  const failed = jobs.filter(j => j.status === 'failed' || j.stage === 'manual_review').length;
  const uncertainAlbum = ['sending', 'uncertain'].includes(data?.pendingPhotoGroup?.sendState);
  const stats = data?.stats || {};
  const risks = [];
  if (staleMinutes >= 15) risks.push({ code: 'queue_stale', level: staleMinutes >= 60 ? 'high' : 'medium', message: `La tâche la plus ancienne attend depuis ${staleMinutes} minutes.`, action: 'Examiner les tâches et les erreurs avant de relancer.' });
  if (failed > 0) risks.push({ code: 'manual_review', level: failed >= 5 ? 'high' : 'medium', message: `${failed} tâche(s) nécessitent une revue manuelle.`, action: 'Inspecter les erreurs et relancer individuellement après vérification.' });
  if (uncertainAlbum) risks.push({ code: 'album_uncertain', level: 'high', message: 'Le résultat d’envoi d’un album est incertain.', action: 'Vérifier le canal avant toute nouvelle tentative; ne pas renvoyer automatiquement.' });
  if (Number(stats.errors || 0) >= 10) risks.push({ code: 'error_volume', level: Number(stats.errors || 0) >= 50 ? 'high' : 'medium', message: 'Le compteur d’erreurs est élevé.', action: 'Consulter le journal et comparer les erreurs récentes avant de modifier la configuration.' });
  return { generatedAt: new Date(now).toISOString(), riskLevel: risks.some(r => r.level === 'high') ? 'high' : risks.length ? 'medium' : 'low', risks, metrics: { pending: jobs.length, failedOrManual: failed, oldestPendingMinutes: staleMinutes, uncertainAlbum, errors: Number(stats.errors || 0) } };
}
module.exports = { forecastIncidents };
