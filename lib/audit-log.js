'use strict';
const fs = require('node:fs');
const path = require('node:path');

function redact(value) {
  return String(value || '')
    .replace(/(api[_-]?key|token|password|secret)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .slice(0, 800);
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
      details: event?.details && typeof event.details === 'object' ? event.details : {}
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
module.exports = { appendAudit };
