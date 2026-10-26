'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15000;
// Cooldown mémoire + fichier : un redémarrage ne doit pas provoquer une nouvelle rafale de 429.
const providerCooldowns = new Map();
function cooldownFile(env = process.env) { return path.resolve(String(env.V6_PROVIDER_COOLDOWN_FILE || path.join(__dirname, '..', 'workspace', 'provider-cooldowns.json'))); }
function cooldownKey(file, id) { return `${file}::${id}`; }
function loadCooldown(id, env = process.env) {
  const file = cooldownFile(env), key = cooldownKey(file, id);
  if (providerCooldowns.has(key)) return Number(providerCooldowns.get(key) || 0);
  try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); const until = Number(parsed?.[id] || 0); if (until > 0) providerCooldowns.set(key, until); } catch {}
  return Number(providerCooldowns.get(key) || 0);
}
function saveCooldowns(file) {
  const values = {};
  for (const [key, until] of providerCooldowns) {
    if (!key.startsWith(`${file}::`)) continue;
    const id = key.slice(file.length + 2); if (Number(until) > Date.now()) values[id] = Number(until);
  }
  try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`; fs.writeFileSync(temp, JSON.stringify(values, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); try { fs.chmodSync(file, 0o600); } catch {} } catch {}
}
function quotaCooldownMs(bodyText, status, retryAfterHeader) {
  const text = String(bodyText || '').toLowerCase();
  if (/per[_ ]day|perday|daily|daily quota|quota.*day|requests[_ ]per[_ ]day|free_tier_requests/.test(text)) return 24 * 60 * 60 * 1000;
  const retrySeconds = Number(retryAfterHeader || 0);
  if (retrySeconds > 0) return Math.min(24 * 60 * 60 * 1000, retrySeconds * 1000);
  if (status === 429) return 60 * 1000;
  if (status === 503 || status >= 500) return 30 * 1000;
  return 0;
}
function providerCooldownStatus(id, now = Date.now(), env = process.env) {
  const file = cooldownFile(env), key = cooldownKey(file, id);
  const until = loadCooldown(id, env);
  if (until <= now) { providerCooldowns.delete(key); if (until > 0) saveCooldowns(file); return null; }
  return { id, ok: false, status: 'rate_limited', httpStatus: 429, retryAfterMs: until - now, message: 'Fournisseur temporairement en pause après une limite de requêtes.' };
}
const PROVIDERS = Object.freeze({
  gemini: { env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.8-flash' },
  groq: { env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'openai/gpt-oss-20b' },
  openrouter: { env: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'google/gemma-4-31b' }
});

function providerStatus(env = process.env) {
  return Object.entries(PROVIDERS).map(([id, spec]) => ({
    id,
    configured: Boolean(String(env[spec.env] || '').trim()),
    model: String(env[spec.modelEnv] || spec.defaultModel).trim(),
    keyVariable: spec.env
  }));
}

async function withTimeout(work, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await work(controller.signal); }
  finally { clearTimeout(timer); }
}

function requestBody(id, model, prompt, maxTokens) {
  if (id === 'gemini') return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 }
  };
  return { model, messages: [{ role: 'system', content: 'Tu es un moteur d’analyse prudent. Respecte strictement le format demandé; ne prétends pas avoir exécuté des actions.' }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.1 };
}

async function callProvider(id, prompt, options = {}, env = process.env) {
  const spec = PROVIDERS[id];
  if (!spec) return { id, ok: false, status: 'unknown_provider' };
  const apiKey = String(env[spec.env] || '').trim();
  if (!apiKey) return { id, ok: false, status: 'not_configured', keyVariable: spec.env };
  const cooldown = providerCooldownStatus(id, Date.now(), env);
  if (cooldown) return cooldown;
  const model = String(env[spec.modelEnv] || spec.defaultModel).trim();
  const started = Date.now();
  const maxTokens = Math.max(8, Math.min(6000, Number(options.maxTokens) || 500));
  try {
    const url = id === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : id === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (id === 'gemini') headers['x-goog-api-key'] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
    if (id === 'openrouter') { headers['HTTP-Referer'] = String(env.OPENROUTER_HTTP_REFERER || 'https://example.invalid'); headers['X-Title'] = 'HACOO BOT V6'; }
    const response = await withTimeout(signal => fetch(url, {
      method: 'POST', signal, headers,
      body: JSON.stringify(requestBody(id, model, String(prompt || '').slice(0, 12000), maxTokens))
    }), Math.max(1000, Math.min(30000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)));
    const bodyText = await response.text();
    if (!response.ok) {
      // Lire le corps uniquement pour classer le quota; ne jamais l'exposer au navigateur.
      const cooldownText = bodyText.slice(0, 2000);
      const cooldownMs = quotaCooldownMs(cooldownText, response.status, response.headers.get('retry-after'));
      if (cooldownMs) { const file = cooldownFile(env); providerCooldowns.set(cooldownKey(file, id), Date.now() + cooldownMs); saveCooldowns(file); }
      return { id, ok: false, status: response.status === 429 ? 'rate_limited' : 'api_error', httpStatus: response.status, retryAfterMs: cooldownMs || undefined, message: response.status === 429 ? 'Le fournisseur a limité les requêtes.' : `Le fournisseur a répondu HTTP ${response.status}.`, latencyMs: Date.now() - started, model };
    }
    let body;
    try { body = JSON.parse(bodyText); } catch { return { id, ok: false, status: 'invalid_response', latencyMs: Date.now() - started, model }; }
    const text = id === 'gemini'
      ? (body.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim()
      : String(body.choices?.[0]?.message?.content || '').trim();
    if (!text) return { id, ok: false, status: 'empty_response', latencyMs: Date.now() - started, model };
    providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
    saveCooldowns(cooldownFile(env));
    return { id, ok: true, status: 'connected', text: text.slice(0, 12000), latencyMs: Date.now() - started, model };
  } catch (error) {
    return { id, ok: false, status: error?.name === 'AbortError' ? 'timeout' : 'network_error', message: error?.name === 'AbortError' ? 'Délai de réponse dépassé.' : 'Connexion au fournisseur impossible.', latencyMs: Date.now() - started, model };
  }
}

async function testProvider(id, env = process.env) {
  const result = await callProvider(id, 'Réponds uniquement par OK.', { maxTokens: 8, timeoutMs: 12000 }, env);
  const { text, ...safe } = result;
  return safe;
}

async function testConfiguredProviders(env = process.env) {
  const configured = providerStatus(env).filter(item => item.configured);
  return Promise.all(configured.map(item => testProvider(item.id, env)));
}

async function generateText(prompt, options = {}, env = process.env) {
  const preference = String(options.provider || env.V6_AI_PROVIDER || '').toLowerCase();
  const ids = preference && PROVIDERS[preference] ? [preference, ...Object.keys(PROVIDERS).filter(id => id !== preference)] : ['gemini', 'groq', 'openrouter'];
  const tried = [];
  let longestCooldown = 0;
  let configuredCount = 0;
  for (const id of ids) {
    if (!String(env[PROVIDERS[id].env] || '').trim()) continue;
    configuredCount += 1;
    const cooldown = providerCooldownStatus(id, Date.now(), env);
    if (cooldown) { tried.push({ id, status: cooldown.status, httpStatus: 429 }); longestCooldown = Math.max(longestCooldown, cooldown.retryAfterMs || 0); continue; }
    const result = await callProvider(id, prompt, options, env);
    tried.push({ id, status: result.status, httpStatus: result.httpStatus });
    if (result.status === 'rate_limited') longestCooldown = Math.max(longestCooldown, result.retryAfterMs || 60000);
    if (result.ok) return { ok: true, provider: id, model: result.model, text: result.text, latencyMs: result.latencyMs, tried };
  }
  const allRateLimited = configuredCount > 0 && tried.length === configuredCount && tried.every(item => item.status === 'rate_limited');
  return { ok: false, status: allRateLimited ? 'all_providers_rate_limited' : tried.length ? 'all_providers_failed' : 'no_provider_configured', retryAfterMs: allRateLimited ? longestCooldown : undefined, tried };
}

module.exports = { PROVIDERS, providerStatus, testProvider, testConfiguredProviders, callProvider, generateText };
