'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PROMPT_CHARS = 100000;
const MAX_PROVIDER_RESPONSE_CHARS = 50000;
const MAX_PROVIDER_ATTEMPTS = 3;
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
  if (/quota|rate.?limit|too many requests|resource exhausted/.test(text)) return 60 * 1000;
  if (status === 429) return 60 * 1000;
  if (status === 503 || status >= 500) return 30 * 1000;
  return 0;
}
function providerCooldownStatus(id, now = Date.now(), env = process.env) {
  const file = cooldownFile(env), key = cooldownKey(file, id);
  const until = loadCooldown(id, env);
  if (until <= now) { providerCooldowns.delete(key); if (until > 0) saveCooldowns(file); return null; }
  return { id, ok: false, status: 'rate_limited', category: 'quota_exceeded', httpStatus: 429, retryAfterMs: until - now, message: 'Fournisseur temporairement en pause après une limite de requêtes.' };
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

function requestBody(id, model, prompt, maxTokens, options = {}) {
  if (id === 'gemini') return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };
  return {
    model,
    messages: [{ role: 'system', content: 'Tu es un moteur d’analyse prudent. Respecte strictement le format demandé; ne prétends pas avoir exécuté des actions.' }, { role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.1,
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {})
  };
}

function safeProviderDetail(value, apiKey = '') {
  let text = String(value || '');
  if (apiKey) text = text.split(apiKey).join('[secret redacted]');
  return text
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[secret redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9_-]{16,}|sk-(?:or-v1-)?[A-Za-z0-9_-]{16,})\b/g, '[secret redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1[secret redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 240);
}

function providerErrorDetail(bodyText, apiKey) {
  let body;
  try { body = JSON.parse(String(bodyText || '')); } catch {}
  const error = body?.error;
  const values = [
    typeof error === 'string' ? error : '',
    error?.message,
    error?.status,
    error?.code,
    error?.type,
    body?.error_description,
    body?.message
  ].filter(value => typeof value === 'string' || typeof value === 'number');
  return safeProviderDetail(values.length ? values.join(' — ') : bodyText, apiKey);
}

function classifyProviderFailure(httpStatus, detail = '', errorName = '') {
  const text = String(detail || '').toLowerCase();
  let category;
  if (errorName === 'AbortError' || /timed?\s*out|deadline exceeded|timeout/.test(text)) category = 'timeout';
  else if (/\b(invalid api key|api key not valid|incorrect api key|invalid key|unauthorized|unauthenticated|authentication failed|invalid token)\b/.test(text) || httpStatus === 401) category = 'authentication_error';
  else if (/\b(quota|rate.?limit|too many requests|resource exhausted|billing limit)\b/.test(text) || httpStatus === 429) category = 'quota_exceeded';
  else if (/\bmodel\b.{0,100}\b(?:not found|unavailable|does not exist|not supported)\b|\bunknown model\b|\bunsupported model\b/.test(text) || httpStatus === 404) category = 'model_unavailable';
  else if (/\b(permission denied|permission required|forbidden|access denied|not authorized to access)\b/.test(text) || httpStatus === 403) category = 'permission_error';
  else if (errorName) category = 'network_error';
  else if (httpStatus >= 500) category = 'service_unavailable';
  else if (httpStatus === 400) category = 'invalid_request';
  else category = 'provider_error';

  const messages = {
    authentication_error: 'Identifiants du fournisseur invalides ou refusés.',
    permission_error: 'Accès refusé pour ce fournisseur ou ce modèle.',
    quota_exceeded: 'Quota ou limite de requêtes atteint.',
    model_unavailable: 'Modèle indisponible ou introuvable.',
    timeout: 'Délai d’attente dépassé.',
    network_error: 'Erreur réseau lors de la connexion au fournisseur.',
    service_unavailable: 'Service du fournisseur temporairement indisponible.',
    invalid_request: 'Requête refusée par le fournisseur.',
    provider_error: 'Erreur renvoyée par le fournisseur.'
  };
  return { category, status: category === 'quota_exceeded' ? 'rate_limited' : category, message: messages[category] };
}

function failureSummary(tried, configuredCount) {
  if (!configuredCount) {
    return 'Aucun fournisseur IA n’est configuré (GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY). Aucune modification n’a été effectuée.';
  }
  const details = tried.map(item => {
    const status = item.message || item.status || 'erreur inconnue';
    const http = item.httpStatus ? ` (HTTP ${item.httpStatus})` : '';
    const detail = item.detail ? ` — ${item.detail}` : '';
    return `${item.id}: ${status}${http}${detail}`;
  }).join(' ; ');
  return `Tous les fournisseurs IA configurés ont été vérifiés une seule fois au maximum. ${details || 'Aucun fournisseur n’a répondu.'} Aucune modification n’a été effectuée.`;
}

async function callProvider(id, prompt, options = {}, env = process.env) {
  const spec = PROVIDERS[id];
  if (!spec) return { id, ok: false, status: 'unknown_provider', message: 'Fournisseur inconnu.' };
  const apiKey = String(env[spec.env] || '').trim();
  if (!apiKey) return { id, ok: false, status: 'not_configured', keyVariable: spec.env, message: 'Fournisseur non configuré.' };
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
    const { response, bodyText } = await withTimeout(async signal => {
      const response = await fetch(url, {
        method: 'POST', signal, headers,
        body: JSON.stringify(requestBody(id, model, String(prompt || '').slice(0, MAX_PROMPT_CHARS), maxTokens, options))
      });
      const bodyText = await response.text();
      return { response, bodyText };
    }, Math.max(1000, Math.min(30000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)));
    if (!response.ok) {
      const detail = providerErrorDetail(bodyText.slice(0, 4000), apiKey);
      const failure = classifyProviderFailure(response.status, detail);
      const cooldownMs = quotaCooldownMs(detail, response.status, response.headers.get('retry-after'));
      if (cooldownMs) { const file = cooldownFile(env); providerCooldowns.set(cooldownKey(file, id), Date.now() + cooldownMs); saveCooldowns(file); }
      return { id, ok: false, ...failure, httpStatus: response.status, detail, retryAfterMs: cooldownMs || undefined, latencyMs: Date.now() - started, model };
    }
    let body;
    try { body = JSON.parse(bodyText); } catch {
      return { id, ok: false, status: 'invalid_response', category: 'invalid_response', message: 'Réponse du fournisseur illisible.', detail: safeProviderDetail(bodyText, apiKey), latencyMs: Date.now() - started, model };
    }
    const text = id === 'gemini'
      ? (body.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim()
      : String(body.choices?.[0]?.message?.content || '').trim();
    if (!text) return { id, ok: false, status: 'empty_response', category: 'empty_response', message: 'Le fournisseur a renvoyé une réponse vide.', latencyMs: Date.now() - started, model };
    providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
    saveCooldowns(cooldownFile(env));
    return { id, ok: true, status: 'connected', text: text.slice(0, MAX_PROVIDER_RESPONSE_CHARS), latencyMs: Date.now() - started, model };
  } catch (error) {
    const detail = safeProviderDetail(error?.message || error, apiKey);
    return { id, ok: false, ...classifyProviderFailure(0, detail, error?.name), detail, latencyMs: Date.now() - started, model };
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
  const orderedIds = preference && PROVIDERS[preference]
    ? [preference, ...Object.keys(PROVIDERS).filter(id => id !== preference)]
    : Object.keys(PROVIDERS);
  const ids = [...new Set(orderedIds)].slice(0, MAX_PROVIDER_ATTEMPTS);
  const tried = [];
  const skipped = [];
  let longestCooldown = 0;
  let configuredCount = 0;
  for (const id of ids) {
    if (!String(env[PROVIDERS[id].env] || '').trim()) {
      skipped.push({ id, status: 'not_configured', keyVariable: PROVIDERS[id].env });
      continue;
    }
    configuredCount += 1;
    const cooldown = providerCooldownStatus(id, Date.now(), env);
    if (cooldown) {
      tried.push({ id, status: cooldown.status, category: cooldown.category, message: cooldown.message, httpStatus: 429, retryAfterMs: cooldown.retryAfterMs });
      longestCooldown = Math.max(longestCooldown, cooldown.retryAfterMs || 0);
      continue;
    }
    const result = await callProvider(id, prompt, options, env);
    tried.push({
      id,
      status: result.status,
      category: result.category,
      message: result.message,
      detail: result.detail,
      httpStatus: result.httpStatus,
      retryAfterMs: result.retryAfterMs,
      model: result.model
    });
    if (result.status === 'rate_limited') longestCooldown = Math.max(longestCooldown, result.retryAfterMs || 60000);
    if (result.ok) return { ok: true, provider: id, model: result.model, text: result.text, latencyMs: result.latencyMs, tried, skipped };
  }
  const allRateLimited = configuredCount > 0 && tried.length === configuredCount && tried.every(item => item.status === 'rate_limited');
  const status = allRateLimited ? 'all_providers_rate_limited' : tried.length ? 'all_providers_failed' : 'no_provider_configured';
  const errorMessage = failureSummary(tried, configuredCount);
  return { ok: false, status, message: errorMessage, errorMessage, retryAfterMs: allRateLimited ? longestCooldown : undefined, tried, skipped };
}

module.exports = { PROVIDERS, providerStatus, testProvider, testConfiguredProviders, callProvider, generateText };
