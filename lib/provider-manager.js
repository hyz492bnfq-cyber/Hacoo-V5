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
  if (status === 402 || /insufficient_quota|out_of_credits|billing|payment_required/.test(text)) {
    return 60 * 60 * 1000; // 1 heure de pause si plus de crédits/quota
  }
  if (/per[_ ]day|perday|daily|daily quota|quota.*day|requests[_ ]per[_ ]day|free_tier_requests/.test(text)) {
    return 24 * 60 * 60 * 1000;
  }
  const retrySeconds = Number(retryAfterHeader || 0);
  if (retrySeconds > 0) return Math.min(24 * 60 * 60 * 1000, retrySeconds * 1000);
  if (status === 429) return 60 * 1000;
  if (status === 503 || status === 502 || status === 504 || status >= 500) return 30 * 1000;
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
  groq: { env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' },
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

function redactSecrets(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[secret redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[secret redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}/gi, '$1[secret redacted]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|bot[_-]?token)\s*[:=]\s*)(["'`]?)[^\s"'`]{8,}\2/gi, '$1[secret redacted]');
}

async function withTimeout(work, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await work(controller.signal); }
  finally { clearTimeout(timer); }
}

function classifyHttpError(status, bodyText) {
  const text = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) {
    return {
      status: 'auth_error',
      isTemporary: false,
      message: 'Authentification refusée par le fournisseur (clé API invalide ou permissions insuffisantes).'
    };
  }
  if (status === 402 || /insufficient_quota|out_of_credits|billing|payment_required/i.test(text)) {
    return {
      status: 'quota_exceeded',
      isTemporary: false,
      message: 'Quota ou crédits épuisés chez le fournisseur d’API.'
    };
  }
  if (status === 429) {
    const isDaily = /per[_ ]day|perday|daily|daily quota|quota.*day|requests[_ ]per[_ ]day|free_tier_requests/i.test(text);
    return {
      status: 'rate_limited',
      isTemporary: true,
      message: isDaily ? 'Quota journalier dépassé chez le fournisseur.' : 'Limite de requêtes atteinte chez le fournisseur (rate limit).'
    };
  }
  if (status === 400) {
    return {
      status: 'bad_request',
      isTemporary: false,
      message: 'Requête invalide ou paramètre non supporté par le fournisseur (HTTP 400).'
    };
  }
  if (status === 404) {
    return {
      status: 'model_not_found',
      isTemporary: false,
      message: 'Modèle ou endpoint introuvable chez le fournisseur (HTTP 404).'
    };
  }
  if (status >= 500) {
    return {
      status: 'temporary_error',
      isTemporary: true,
      message: `Erreur temporaire du serveur fournisseur (HTTP ${status}).`
    };
  }
  return {
    status: 'api_error',
    isTemporary: false,
    message: `Le fournisseur a répondu HTTP ${status}.`
  };
}

function extractApiErrorDetail(bodyText) {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText);
    const msg = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : null) || parsed?.message;
    if (typeof msg === 'string' && msg.trim()) {
      return redactSecrets(msg.trim()).slice(0, 300);
    }
  } catch {}
  return redactSecrets(String(bodyText).replace(/[\r\n\t]+/g, ' ').trim()).slice(0, 300);
}

function calculateMaxTokens(id, model, requestedTokens) {
  const requested = Number(requestedTokens) || 500;
  if (id === 'groq') {
    // Les modèles Groq ont des limites de tokens de complétion strictes (Gemma: 4096, Llama 3.1: 8192)
    const ceiling = /gemma/i.test(model) ? 4096 : 8192;
    return Math.max(8, Math.min(ceiling, requested));
  }
  return Math.max(8, Math.min(16384, requested));
}

function requestBody(id, model, prompt, maxTokens, options = {}) {
  const jsonMode = Boolean(options.jsonMode || options.responseFormat === 'json');
  if (id === 'gemini') {
    const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.1 };
    if (jsonMode) generationConfig.responseMimeType = 'application/json';
    return {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    };
  }
  const systemPrompt = jsonMode
    ? 'Tu es un moteur d’analyse prudent. Tu réponds exclusivement sous la forme d’un objet JSON valide, sans texte d’introduction ni de conclusion, sans explication et sans balises de code Markdown.'
    : 'Tu es un moteur d’analyse prudent. Respecte strictement le format demandé; ne prétends pas avoir exécuté des actions.';
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.1
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function callProvider(id, prompt, options = {}, env = process.env) {
  const spec = PROVIDERS[id];
  if (!spec) return { id, ok: false, status: 'unknown_provider' };
  const apiKey = String(env[spec.env] || '').trim();
  if (!apiKey) return { id, ok: false, status: 'not_configured', keyVariable: spec.env };
  const cooldown = providerCooldownStatus(id, Date.now(), env);
  if (cooldown) return cooldown;
  let model = String(env[spec.modelEnv] || spec.defaultModel).trim();
  const started = Date.now();
  let maxTokens = calculateMaxTokens(id, model, options.maxTokens);
  const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const maxPromptChars = Math.max(150000, Number(options.maxPromptChars || 150000));
  const promptText = String(prompt || '').slice(0, maxPromptChars);
  try {
    let url = id === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : id === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (id === 'gemini') headers['x-goog-api-key'] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
    if (id === 'openrouter') { headers['HTTP-Referer'] = String(env.OPENROUTER_HTTP_REFERER || 'https://example.invalid'); headers['X-Title'] = 'HACOO BOT V6'; }

    let reqPayload = requestBody(id, model, promptText, maxTokens, options);
    let response = await withTimeout(signal => fetch(url, {
      method: 'POST', signal, headers,
      body: JSON.stringify(reqPayload)
    }), timeoutMs);
    let bodyText = await response.text();

    // Repli contrôlé en cas d'erreur HTTP 400 (Bad Request) ou 404 (Model Not Found)
    if (response.status === 400 || (response.status === 404 && id === 'gemini')) {
      let needsFallback = false;
      let fallbackOptions = { ...options };
      let fallbackModel = model;
      let fallbackMaxTokens = maxTokens;
      let fallbackUrl = url;

      const detailText = String(bodyText || '').toLowerCase();

      // 1. Détection de rejet du mode JSON / response_format / responseMimeType
      const hasJsonModeActive = Boolean(
        reqPayload.response_format ||
        reqPayload.generationConfig?.responseMimeType ||
        options.jsonMode ||
        options.responseFormat === 'json'
      );
      if (hasJsonModeActive) {
        fallbackOptions.jsonMode = false;
        needsFallback = true;
      }

      // 2. Détection d'un dépassement de max_tokens
      const isTokenLimitError = /max_tokens|max_output_tokens|completion_tokens|maximum allowed tokens|token limit|too large/i.test(detailText);
      if (isTokenLimitError) {
        const matchLimit = detailText.match(/allowed (?:tokens )?(?:of )?(\d+)/i) || detailText.match(/maximum (?:is )?(\d+)/i);
        if (matchLimit && Number(matchLimit[1]) > 0) {
          fallbackMaxTokens = Math.max(256, Number(matchLimit[1]) - 32);
        } else {
          fallbackMaxTokens = Math.max(256, Math.min(maxTokens, 4096));
        }
        needsFallback = true;
      }

      // 3. Détection d'un modèle non trouvé ou invalide pour ce fournisseur
      const isModelError = /model.*not found|does not exist|invalid model|not recognized|models\//i.test(detailText) || response.status === 404;
      if (isModelError) {
        if (id === 'gemini') {
          const fallbackList = String(env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean);
          const nextModel = fallbackList.find(m => m !== model);
          if (nextModel) {
            fallbackModel = nextModel;
            fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fallbackModel)}:generateContent`;
            needsFallback = true;
          }
        } else if (id === 'groq') {
          // Si Groq a reçu un slug de modèle OpenAI ou invalide, repli sur le modèle standard Groq
          const groqFallback = 'llama-3.3-70b-versatile';
          if (model !== groqFallback) {
            fallbackModel = groqFallback;
            needsFallback = true;
          }
        }
      }

      if (needsFallback) {
        const fallbackPayload = requestBody(id, fallbackModel, promptText, fallbackMaxTokens, fallbackOptions);
        const fallbackResponse = await withTimeout(signal => fetch(fallbackUrl, {
          method: 'POST', signal, headers,
          body: JSON.stringify(fallbackPayload)
        }), timeoutMs);
        const fallbackBodyText = await fallbackResponse.text();

        response = fallbackResponse;
        bodyText = fallbackBodyText;
        model = fallbackModel;
        maxTokens = fallbackMaxTokens;
      }
    }

    if (!response.ok) {
      const cooldownText = bodyText.slice(0, 2000);
      const cooldownMs = quotaCooldownMs(cooldownText, response.status, response.headers.get('retry-after'));
      if (cooldownMs) {
        const file = cooldownFile(env);
        providerCooldowns.set(cooldownKey(file, id), Date.now() + cooldownMs);
        saveCooldowns(file);
      }
      const classified = classifyHttpError(response.status, bodyText);
      const errorDetail = extractApiErrorDetail(bodyText);
      const fullMessage = errorDetail
        ? `${classified.message} Détail : ${errorDetail}`
        : classified.message;

      // Conserver dans les logs le statut HTTP et le corps de l'erreur (secrets masqués)
      console.warn(`[AI Provider Error] [${id}] [${model}] HTTP ${response.status} (${classified.status}): ${fullMessage}`);

      return {
        id,
        ok: false,
        status: classified.status,
        httpStatus: response.status,
        retryAfterMs: cooldownMs || undefined,
        message: fullMessage,
        errorDetail: errorDetail || undefined,
        errorBody: redactSecrets(bodyText).slice(0, 2000),
        latencyMs: Date.now() - started,
        model
      };
    }

    let body;
    try { body = JSON.parse(bodyText); }
    catch { return { id, ok: false, status: 'invalid_response', message: 'Réponse du fournisseur non JSON ou mal formée.', latencyMs: Date.now() - started, model }; }

    if (id === 'gemini') {
      if (body.promptFeedback?.blockReason) {
        return {
          id,
          ok: false,
          status: 'model_refusal',
          message: `Requête bloquée par les filtres de sécurité du modèle (${body.promptFeedback.blockReason}).`,
          latencyMs: Date.now() - started,
          model
        };
      }
      const candidate = body.candidates?.[0];
      if (!candidate) {
        return {
          id,
          ok: false,
          status: 'empty_response',
          message: 'Le modèle n’a retourné aucun candidat.',
          latencyMs: Date.now() - started,
          model
        };
      }
      const finishReason = String(candidate.finishReason || '');
      if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finishReason)) {
        return {
          id,
          ok: false,
          status: 'model_refusal',
          finishReason,
          message: `Génération refusée par la politique du modèle (${finishReason}).`,
          latencyMs: Date.now() - started,
          model
        };
      }
      const parts = candidate.content?.parts || [];
      const text = parts.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n').trim();
      if (finishReason === 'MAX_TOKENS') {
        return {
          id,
          ok: false,
          status: 'truncated_response',
          finishReason,
          text,
          message: 'Réponse IA tronquée par la limite de tokens de génération.',
          latencyMs: Date.now() - started,
          model
        };
      }
      if (!text) {
        return {
          id,
          ok: false,
          status: 'empty_response',
          finishReason,
          message: 'Le modèle a retourné une réponse textuelle vide.',
          latencyMs: Date.now() - started,
          model
        };
      }
      providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
      saveCooldowns(cooldownFile(env));
      const maxResponseChars = Math.max(500000, Number(options.maxResponseChars || 500000));
      return { id, ok: true, status: 'connected', text: text.slice(0, maxResponseChars), finishReason, latencyMs: Date.now() - started, model };
    }

    // Groq / OpenRouter
    const choice = body.choices?.[0];
    if (!choice) {
      return {
        id,
        ok: false,
        status: 'empty_response',
        message: 'Le fournisseur n’a renvoyé aucun choix.',
        latencyMs: Date.now() - started,
        model
      };
    }
    const finishReason = String(choice.finish_reason || '');
    const refusal = choice.message?.refusal;
    if (refusal) {
      return {
        id,
        ok: false,
        status: 'model_refusal',
        finishReason,
        message: `Le modèle a refusé la requête : ${redactSecrets(String(refusal)).slice(0, 150)}`,
        latencyMs: Date.now() - started,
        model
      };
    }
    if (finishReason === 'content_filter') {
      return {
        id,
        ok: false,
        status: 'model_refusal',
        finishReason,
        message: 'Réponse filtrée par les contrôles de contenu du modèle.',
        latencyMs: Date.now() - started,
        model
      };
    }
    const content = choice.message?.content;
    const text = typeof content === 'string'
      ? content.trim()
      : (Array.isArray(content) ? content.map(p => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim() : '');

    if (finishReason === 'length') {
      return {
        id,
        ok: false,
        status: 'truncated_response',
        finishReason,
        text,
        message: 'Réponse IA tronquée par la limite de tokens de génération.',
        latencyMs: Date.now() - started,
        model
      };
    }
    if (!text) {
      return {
        id,
        ok: false,
        status: 'empty_response',
        finishReason,
        message: 'Le modèle a retourné une réponse textuelle vide.',
        latencyMs: Date.now() - started,
        model
      };
    }
    providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
    saveCooldowns(cooldownFile(env));
    const maxResponseChars = Math.max(500000, Number(options.maxResponseChars || 500000));
    return { id, ok: true, status: 'connected', text: text.slice(0, maxResponseChars), finishReason, latencyMs: Date.now() - started, model };
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
    tried.push({ id, status: result.status, httpStatus: result.httpStatus, message: result.message, errorDetail: result.errorDetail });
    if (result.status === 'rate_limited') longestCooldown = Math.max(longestCooldown, result.retryAfterMs || 60000);
    if (result.ok) return { ok: true, provider: id, model: result.model, text: result.text, latencyMs: result.latencyMs, tried, finishReason: result.finishReason };
  }
  const allRateLimited = configuredCount > 0 && tried.length === configuredCount && tried.every(item => item.status === 'rate_limited');
  const lastTried = tried.at(-1);
  return {
    ok: false,
    status: allRateLimited ? 'all_providers_rate_limited' : lastTried?.status || (tried.length ? 'all_providers_failed' : 'no_provider_configured'),
    message: lastTried?.message,
    errorDetail: lastTried?.errorDetail,
    retryAfterMs: allRateLimited ? longestCooldown : undefined,
    tried
  };
}

module.exports = {
  PROVIDERS,
  providerStatus,
  testProvider,
  testConfiguredProviders,
  callProvider,
  generateText,
  redactSecrets,
  classifyHttpError,
  extractApiErrorDetail,
  calculateMaxTokens
};
