'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { appendAudit } = require('./audit-log');
const { autonomyStatus } = require('./autonomy-engine');
const { autonomousReleaseStatus } = require('./autonomous-release');

const WORKSPACE_DIRS = [
  'workspace', 'workspace/proposals', 'workspace/candidates',
  'workspace/releases', 'workspace/backups', 'logs'
];
const STALE_LOCK_MS = 10 * 60 * 1000;
const STATE_FILES = ['workspace/autonomy-state.json', 'workspace/autonomy-control.json'];

function safeMkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function atomicJson(file, value) {
  safeMkdir(path.dirname(file));
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}
function parseJsonFile(file) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (error) { return { ok: false, error: String(error?.message || error).slice(0, 180) }; }
}
function safeRuntimeChecks(rootDir, data, now = Date.now()) {
  const findings = [];
  const repairs = [];
  for (const relative of WORKSPACE_DIRS) {
    const target = path.join(rootDir, relative);
    try {
      if (!fs.existsSync(target)) {
        safeMkdir(target);
        repairs.push({ id: 'workspace_dir_created', target: relative, result: 'repaired' });
      } else if (!fs.statSync(target).isDirectory()) {
        findings.push({ severity: 'critical', code: 'workspace_path_not_directory', target: relative, repairable: false });
      }
    } catch (error) {
      findings.push({ severity: 'error', code: 'workspace_dir_check_failed', target: relative, detail: String(error?.message || error).slice(0, 120), repairable: false });
    }
  }
  for (const relative of STATE_FILES) {
    const target = path.join(rootDir, relative);
    if (!fs.existsSync(target)) continue;
    const parsed = parseJsonFile(target);
    if (!parsed.ok) findings.push({ severity: 'error', code: 'state_json_invalid', target: relative, detail: parsed.error, repairable: false, recommendation: 'Sauvegarder le fichier corrompu puis examiner sa structure avant toute restauration.' });
  }
  const statePath = path.join(rootDir, 'workspace', 'autonomy-state.json');
  const stateResult = parseJsonFile(statePath);
  if (stateResult.ok && stateResult.value?.running === true) {
    const age = now - Number(stateResult.value.runningAt || 0);
    if (age > STALE_LOCK_MS) {
      atomicJson(statePath, { ...stateResult.value, running: false, runningAt: null, recoveredAt: new Date(now).toISOString(), recoveryReason: 'stale_running_lock' });
      repairs.push({ id: 'stale_autonomy_lock_cleared', target: 'workspace/autonomy-state.json', ageMs: age, result: 'repaired' });
    }
  }
  const jobs = Array.isArray(data?.pendingJobs) ? data.pendingJobs : [];
  const oldest = jobs.reduce((min, job) => {
    const stamp = typeof job?.createdAt === 'number' ? job.createdAt : Date.parse(job?.createdAt || '');
    return Number.isFinite(stamp) && stamp > 0 && (!min || stamp < min) ? stamp : min;
  }, 0);
  if (oldest && now - oldest > 15 * 60 * 1000) {
    findings.push({ severity: 'warning', code: 'queue_stale', pendingCount: jobs.length, oldestAgeMinutes: Math.floor((now - oldest) / 60000), repairable: false, recommendation: 'Inspecter les tâches avant toute relance; ne pas renvoyer automatiquement une publication dont le résultat est incertain.' });
  }
  const lastError = data?.stats?.lastError;
  if (lastError) findings.push({ severity: 'warning', code: 'last_error_present', at: lastError.time || lastError.at || null, repairable: false, recommendation: 'Consulter les logs et le journal d’audit; aucune correction de code n’est faite sur la seule base d’un message d’erreur.' });
  return { findings, repairs };
}
function supervisorStatus(rootDir, data, env = process.env) {
  const reportPath = path.join(rootDir, 'workspace', 'supervisor-state.json');
  const parsed = parseJsonFile(reportPath);
  return {
    enabled: String(env.V6_SUPERVISOR_ENABLED ?? 'true').toLowerCase() !== 'false',
    mode: 'continuous_diagnostics_and_safe_repairs',
    lastRunAt: parsed.ok ? parsed.value.lastRunAt || null : null,
    lastStatus: parsed.ok ? parsed.value.status || 'not_run' : 'state_unavailable',
    lastReport: parsed.ok ? parsed.value.report || null : null,
    autoCodeModification: false,
    autoDeployment: autonomousReleaseStatus(env).enabled,
    autonomy: autonomyStatus(rootDir, env)
  };
}
function runSupervisorCycle({ rootDir, data, env = process.env, force = false }) {
  if (String(env.V6_SUPERVISOR_ENABLED ?? 'true').toLowerCase() === 'false') return { ok: false, status: 'disabled', supervisor: supervisorStatus(rootDir, data, env) };
  safeMkdir(path.join(rootDir, 'workspace'));
  const report = safeRuntimeChecks(rootDir, data);
  const result = {
    checkedAt: new Date().toISOString(),
    checks: ['workspace_directories', 'autonomy_state_json', 'stale_autonomy_lock', 'queue_age', 'last_error_marker'],
    findings: report.findings,
    repairs: report.repairs,
    automaticCodeChanges: 0,
    automaticDeployments: 0,
    note: 'Seules les réparations déterministes sans modification du code métier sont automatiques. Les tâches Telegram incertaines ne sont jamais rejouées aveuglément.'
  };
  const status = report.findings.some(f => f.severity === 'critical') ? 'critical' : report.findings.some(f => f.severity === 'error') ? 'needs_attention' : report.findings.length ? 'warning' : 'healthy';
  const saved = { lastRunAt: result.checkedAt, status, report: result };
  atomicJson(path.join(rootDir, 'workspace', 'supervisor-state.json'), saved);
  appendAudit(rootDir, {
    type: 'autonomous_supervisor_cycle',
    message: status === 'healthy' ? 'Supervision autonome terminée : aucun problème détecté dans les contrôles locaux.' : `Supervision autonome terminée : état ${status}.`,
    details: { status, findings: report.findings.length, repairs: report.repairs.length, automaticCodeChanges: 0, automaticDeployments: 0 }
  });
  return { ok: status !== 'critical', status, report: result, supervisor: supervisorStatus(rootDir, data, env) };
}
module.exports = { safeRuntimeChecks, supervisorStatus, runSupervisorCycle, WORKSPACE_DIRS, STATE_FILES };
