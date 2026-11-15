'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { appendAudit } = require('./audit-log');

function controlPath(rootDir) { return path.join(rootDir, 'workspace', 'autonomy-control.json'); }
function readControl(rootDir) {
  try {
    const value = JSON.parse(fs.readFileSync(controlPath(rootDir), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function writeControl(rootDir, value) {
  const file = controlPath(rootDir), dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
  return value;
}
function updateControl(rootDir, patch, actor = 'dashboard-admin') {
  const current = readControl(rootDir);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString(), updatedBy: actor };
  if (typeof next.paused !== 'boolean') next.paused = false;
  if (typeof next.chatEnabled !== 'boolean') next.chatEnabled = true;
  writeControl(rootDir, next);
  appendAudit(rootDir, { type: 'autonomy_control_updated', message: 'Contrôle de l’espace autonome modifié depuis le tableau de bord.', details: { paused: next.paused, chatEnabled: next.chatEnabled, updatedAt: next.updatedAt } });
  return next;
}
function readAudit(rootDir, limit = 100) {
  const file = path.join(rootDir, 'logs', 'audit.jsonl');
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(250, Number(limit) || 100)));
    return lines.reverse().flatMap(line => { try { const row = JSON.parse(line); return [{ time: row.time, type: row.type, message: row.message, details: row.details && typeof row.details === 'object' ? row.details : {} }]; } catch { return []; } });
  } catch { return []; }
}
module.exports = { readControl, writeControl, updateControl, readAudit };
