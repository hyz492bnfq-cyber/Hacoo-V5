'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectPublication } = require('./prepublication');
const { appendAudit } = require('./audit-log');
function schedulePath(root) { return path.join(root, 'workspace', 'scheduled-publications.json'); }
function readAll(root) { try { const v = JSON.parse(fs.readFileSync(schedulePath(root), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function writeAll(root, rows) { const file = schedulePath(root); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(rows.slice(-500), null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
function listSchedules(root) { return readAll(root).slice(-100).reverse().map(({ text, ...rest }) => ({ ...rest, preview: String(text || '').slice(0, 160) })); }
function createSchedule(root, input, options = {}) {
  const text = String(input?.text || '').trim(); const scheduledAt = Date.parse(input?.scheduledAt || '');
  if (!Number.isFinite(scheduledAt) || scheduledAt < Date.now() + 60000) throw new Error('Choisis une date au moins une minute dans le futur.');
  const qc = inspectPublication({ text }, options);
  if (!qc.ok) throw new Error(`Contrôle avant publication refusé : ${qc.errors.join(' ')}`);
  const row = { id: crypto.randomBytes(10).toString('hex'), createdAt: new Date().toISOString(), scheduledAt: new Date(scheduledAt).toISOString(), status: 'scheduled', text, contentHash: qc.contentHash, quality: qc, targetChannel: String(input?.targetChannel || options.defaultChannel || ''), attempts: 0, sentMessageIds: [], lastError: null };
  if (!row.targetChannel) throw new Error('Aucun canal de publication autorisé.');
  const all = readAll(root); all.push(row); writeAll(root, all);
  appendAudit(root, { type: 'publication_scheduled', message: 'Publication programmée après contrôle qualité.', details: { id: row.id, scheduledAt: row.scheduledAt, targetChannel: row.targetChannel, contentHash: row.contentHash } });
  const { text: _text, ...safe } = row; return safe;
}
function cancelSchedule(root, id) { const rows = readAll(root); const row = rows.find(x => x.id === id); if (!row) return { ok: false, reason: 'Publication introuvable.' }; if (!['scheduled', 'blocked'].includes(row.status)) return { ok: false, reason: `Annulation impossible depuis l’état ${row.status}.` }; row.status = 'cancelled'; row.cancelledAt = new Date().toISOString(); writeAll(root, rows); appendAudit(root, { type: 'publication_cancelled', message: 'Publication programmée annulée.', details: { id } }); return { ok: true }; }
async function processDueSchedules({ rootDir, bot, data, allowedChannels, notifyAdmin = async () => {} }) {
  const rows = readAll(rootDir); let changed = false; const now = Date.now();
  for (const row of rows) {
    if (row.status !== 'scheduled' || Date.parse(row.scheduledAt) > now) continue;
    if (!allowedChannels.includes(String(row.targetChannel))) { row.status = 'blocked'; row.lastError = 'Canal cible non autorisé par la configuration actuelle.'; changed = true; continue; }
    const qc = inspectPublication({ text: row.text }, { bannedWords: data?.bannedWords, blockedPhrases: data?.blockedPhrases, recentHashes: (data?.publishedHashes || []).slice(-100) });
    if (!qc.ok) { row.status = 'blocked'; row.lastError = qc.errors.join(' ').slice(0, 500); changed = true; appendAudit(rootDir, { type: 'scheduled_publication_blocked', message: 'Contrôle qualité avant publication bloquant.', details: { id: row.id, errors: qc.errors } }); await notifyAdmin(`Publication programmée bloquée (${row.id}) : ${row.lastError}`); break; }
    // Persist the sending state before the external side effect. After a crash it becomes uncertain, never auto-retried.
    row.status = 'sending'; row.sendingAt = new Date().toISOString(); row.attempts = Number(row.attempts || 0) + 1; changed = true; writeAll(rootDir, rows);
    try {
      const sent = await bot.api.sendMessage(row.targetChannel, row.text, { link_preview_options: { is_disabled: false } });
      row.status = 'sent'; row.sentAt = new Date().toISOString(); row.sentMessageIds = [sent.message_id]; row.lastError = null;
      data.publishedHashes = [...(data.publishedHashes || []).filter(h => h !== row.contentHash), row.contentHash].slice(-500);
      appendAudit(rootDir, { type: 'scheduled_publication_sent', message: 'Publication programmée envoyée.', details: { id: row.id, targetChannel: row.targetChannel, messageId: sent.message_id, contentHash: row.contentHash } });
    } catch (error) {
      row.status = 'uncertain'; row.lastError = String(error?.message || error).slice(0, 300); row.failedAt = new Date().toISOString();
      appendAudit(rootDir, { type: 'scheduled_publication_uncertain', message: 'Résultat d’envoi incertain; renvoi automatique interdit pour éviter un doublon.', details: { id: row.id, reason: row.lastError } });
      await notifyAdmin(`Publication programmée à vérifier manuellement (${row.id}). L’envoi peut avoir réussi; aucun renvoi automatique ne sera tenté.`);
    }
    changed = true;
    break; // au plus une tentative d’envoi par cycle, pour limiter les rafales
  }
  if (changed) writeAll(rootDir, rows);
  return { changed };
}
function recoverSendingSchedules(rootDir) { const rows = readAll(rootDir); let count = 0; for (const row of rows) if (row.status === 'sending') { row.status = 'uncertain'; row.lastError = 'Arrêt détecté pendant la tentative d’envoi; vérification manuelle requise.'; count++; } if (count) writeAll(rootDir, rows); return count; }
module.exports = { createSchedule, listSchedules, cancelSchedule, processDueSchedules, recoverSendingSchedules };
