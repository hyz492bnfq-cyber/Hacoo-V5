'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_STRING_LENGTH = 800;
const MAX_OBJECT_KEYS = 80;
const MAX_ARRAY_ITEMS = 50;
const MAX_AUDIT_DEPTH = 6;
const MAX_DETAILS_BYTES = 24 * 1024;

const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bot[_-]?token|token|password|passwd|secret|credential|authorization|cookie|private[_-]?key)/i;
const INLINE_SECRET = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|bot[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|private[_-]?key)(?:\s*[:=]\s*))(?:bearer\s+)?(["']?)[^\s,;}"']+/gi;

function redact(value) {
  return String(value ?? '')
    .replace(INLINE_SECRET, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeAuditValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth >= MAX_AUDIT_DEPTH) return '[MAX_DEPTH]';

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (Array.isArray(value)) {
      const result = value.slice(0, MAX_ARRAY_ITEMS)
        .map(item => sanitizeAuditValue(item, depth + 1, seen))
        .map(item => item === undefined ? null : item);
      if (value.length > MAX_ARRAY_ITEMS) result.push(`[TRUNCATED ${value.length - MAX_ARRAY_ITEMS} ITEMS]`);
      seen.delete(value);
      return result;
    }

    const result = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [key, child] of entries) {
      if (SENSITIVE_KEY.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }
      const safe = sanitizeAuditValue(child, depth + 1, seen);
      if (safe !== undefined) result[key] = safe;
    }
    if (Object.keys(value).length > MAX_OBJECT_KEYS) result._truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
    seen.delete(value);
    return result;
  }

  return String(value);
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  let safe = sanitizeAuditValue(details);
  try {
    while (Buffer.byteLength(JSON.stringify(safe), 'utf8') > MAX_DETAILS_BYTES) {
      const keys = Object.keys(safe);
      if (!keys.length) return { _truncated: true };
      safe = { ...safe };
      delete safe[keys[keys.length - 1]];
      safe._truncated = true;
    }
  } catch {
    return { _sanitizationError: true };
  }
  return safe;
}

function appendAudit(rootDir, event) {
  const dir = path.resolve(rootDir, 'logs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'audit.jsonl');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      const old = path.join(dir, `audit-${Date.now()}.jsonl`);
      fs.renameSync(file, old);
      // Keep only the latest two rotated files.
      const rotated = fs.readdirSync(dir).filter(n => /^audit-\d+\.jsonl$/.test(n)).sort().reverse();
      for (const name of rotated.slice(2)) fs.rmSync(path.join(dir, name), { force: true });
    }
    const row = {
      time: new Date().toISOString(),
      type: redact(event?.type || 'event'),
      message: redact(event?.message || ''),
      details: sanitizeDetails(event?.details)
    };
    fs.appendFileSync(file, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    return row;
  } catch (error) {
    // Audit failure is surfaced to server logs; it must not crash the bot process.
    console.error('Audit log write failed:', String(error?.message || error).slice(0, 180));
    return null;
  }
}
module.exports = { appendAudit, redact, sanitizeDetails };
