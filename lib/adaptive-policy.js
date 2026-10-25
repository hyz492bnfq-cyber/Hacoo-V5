'use strict';
function proposeAdaptivePolicy(data) {
  const stats = data?.stats || {}; const jobs = Array.isArray(data?.pendingJobs) ? data.pendingJobs : [];
  const failed = jobs.filter(j => j.status === 'failed' || j.stage === 'manual_review').length;
  const errors = Number(stats.errors || 0); const duplicates = Number(stats.duplicates || 0); const totalSeen = Number(stats.totalSeen || 0);
  const duplicateRate = totalSeen > 0 ? duplicates / totalSeen : 0;
  const suggestions = [];
  if (failed >= 3 || errors >= 10) suggestions.push({ setting: 'retryBackoff', current: 'V5 default', proposed: 'Increase delay between retries and alert the administrator', rationale: `${failed} failed/manual jobs and ${errors} recorded errors indicate instability.`, requiresTests: true, autoApplied: false });
  if (duplicateRate > 0.35 && totalSeen >= 20) suggestions.push({ setting: 'duplicateReview', current: 'current duplicate threshold', proposed: 'Benchmark threshold on a labeled sample before changing it', rationale: `Observed duplicate ratio is ${(duplicateRate * 100).toFixed(1)}%; this alone does not prove false positives.`, requiresTests: true, autoApplied: false });
  if (!suggestions.length) suggestions.push({ setting: 'monitoring', current: 'current', proposed: 'Keep current thresholds and collect more observations', rationale: 'No metric alone justifies an automatic threshold change.', requiresTests: true, autoApplied: false });
  return { generatedAt: new Date().toISOString(), suggestions, policy: 'recommend_only', constitutionProtected: true };
}
module.exports = { proposeAdaptivePolicy };
