'use strict';
function parseChannelRegistry(env = process.env) {
  const fallback = String(env.CHANNEL_ID || '').trim();
  let supplied = [];
  if (String(env.V6_CHANNELS_JSON || '').trim()) {
    try {
      const parsed = JSON.parse(env.V6_CHANNELS_JSON);
      if (!Array.isArray(parsed)) throw new Error('V6_CHANNELS_JSON doit être un tableau JSON.');
      supplied = parsed.map((item, index) => {
        const id = String(item?.id ?? '').trim();
        if (!id || id.length > 128) throw new Error(`Canal ${index + 1} invalide.`);
        return { id, name: String(item.name || `Canal ${index + 1}`).slice(0, 80), enabled: item.enabled === true };
      });
    } catch (error) { return { ok: false, error: error.message, channels: [] }; }
  }
  if (!supplied.length && fallback) supplied = [{ id: fallback, name: 'Canal principal', enabled: true }];
  const unique = [...new Map(supplied.map(c => [c.id, c])).values()];
  const multiEnabled = String(env.V6_MULTICHANNEL_ENABLED || 'false').toLowerCase() === 'true';
  const channels = multiEnabled ? unique.filter(c => c.enabled) : unique.filter(c => c.id === fallback).map(c => ({ ...c, enabled: true }));
  return { ok: true, enabled: multiEnabled, prepared: unique.length, active: channels.length, channels };
}
module.exports = { parseChannelRegistry };
