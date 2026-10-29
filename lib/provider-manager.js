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

const KNOWN_VALID_MODELS = Object.freeze({
  gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct', 'meta-llama/llama-3.1-8b-instruct'],
  nvidia: ['nvidia/llama-3.1-nv-instruct', 'nvidia/llama-3.3-nemotron-70b-instruct', 'meta/llama-3.1-instruct-70b']
});

const PROVIDERS = Object.freeze({
  gemini: { env: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-flash' },
  groq: { env: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { env: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'meta-llama/llama-3.3-70b-instruct' },
  nvidia: { env: 'NVIDIA_API', modelEnv: 'NVIDIA_MODEL', defaultModel: 'nvidia/llama-3.1-nv-instruct', aliases: ['NVIDIA_API_KEY'] }
});

// Chaîne de routage par défaut (fournisseurs configurés uniquement lors de la résolution).
const DEFAULT_PROVIDER_CHAIN = Object.freeze(['gemini', 'groq', 'openrouter', 'nvidia']);
const TASK_PROVIDER_CHAINS = Object.freeze({
  code: Object.freeze(['groq', 'nvidia', 'openrouter', 'gemini']),
  editorial: Object.freeze(['gemini', 'groq', 'openrouter', 'nvidia']),
  general: Object.freeze(['gemini', 'groq', 'openrouter', 'nvidia'])
});

function providerStatus(env = process.env) {
  return Object.entries(PROVIDERS).map(([id, spec]) => ({
    id,
    configured: Boolean(String(env[spec.env] || '').trim()) || (Array.isArray(spec.aliases) && Boolean(String(env[spec.aliases[0]] || '').trim())),
    model: String(env[spec.modelEnv] || spec.defaultModel).trim(),
    keyVariable: spec.env
  }));
}

function providerApiKey(env, id) {
  const spec = PROVIDERS[id];
  if (!spec) return '';
  const names = [spec.env, ...(Array.isArray(spec.aliases) ? spec.aliases : [])];
  for (const name of names) {
    const value = String(env?.[name] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function providerConfigured(env, id) {
  return Boolean(providerApiKey(env, id));
}

function providerModel(env, id) {
  const spec = PROVIDERS[id];
  return String(env?.[spec.modelEnv] || spec.defaultModel || '').trim();
}

function classifyTaskType(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (/\b(code|coding|programmation|developp|bug|fix|refactor|implement|implément|fonction|function|script|api|endpoint|algorithm|regex|sql|typescript|javascript|python|compile|debug|test|tests?|architecture|database|migration|docker|kubernetes)\b/i.test(text)) {
    return 'code';
  }
  if (/\b(editorial|duplicate|optimi[sz]ation|optimisation|r[èe]sum[èe]|social|blog|contenu|content|post|titre|newsletter|presse|commentaire)\b/i.test(text)) {
    return 'editorial';
  }
  return 'general';
}

function resolveProviderChain(env = process.env, options = {}) {
  const preference = String(options.provider || env.V6_AI_PROVIDER || '').toLowerCase();
  const explicit = preference && PROVIDERS[preference] ? preference : null;
  if (explicit) {
    return [explicit, ...Object.keys(PROVIDERS).filter(id => id !== explicit)];
  }
  const task = classifyTaskType(String(options.prompt || ''));
  const candidates = TASK_PROVIDER_CHAINS[task] || TASK_PROVIDER_CHAINS.general;
  const ordered = candidates.filter(id => providerConfigured(env, id));
  if (ordered.length > 0) return ordered;
  return TASK_PROVIDER_CHAINS.general.filter(id => providerConfigured(env, id));
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

function getModelCandidates(id, primaryModel, env = process.env) {
  const candidates = [primaryModel];
  if (id === 'gemini') {
    const fallbackEnv = String(env.GEMINI_FALLBACK_MODELS || '').split(',').map(m => m.trim()).filter(Boolean);
    for (const m of fallbackEnv) {
      if (!candidates.includes(m)) candidates.push(m);
    }
    for (const m of KNOWN_VALID_MODELS.gemini) {
      if (!candidates.includes(m)) candidates.push(m);
    }
  } else if (id === 'groq') {
    for (const m of KNOWN_VALID_MODELS.groq) {
      if (!candidates.includes(m)) candidates.push(m);
    }
  } else if (id === 'openrouter') {
    for (const m of KNOWN_VALID_MODELS.openrouter) {
      if (!candidates.includes(m)) candidates.push(m);
    }
  } else if (id === 'nvidia') {
    const fallbackEnv = String(env.NVIDIA_FALLBACK_MODELS || '').split(',').map(m => m.trim()).filter(Boolean);
    for (const m of fallbackEnv) {
      if (!candidates.includes(m)) candidates.push(m);
    }
    for (const m of KNOWN_VALID_MODELS.nvidia) {
      if (!candidates.includes(m)) candidates.push(m);
    }
  }
  return candidates;
}

function isModelError(status, bodyText) {
  if (status === 404) return true;
  let code = '';
  let msg = '';
  try {
    const j = JSON.parse(bodyText);
    code = String(j.error?.code || j.error?.type || j.status || '');
    msg = String(j.error?.message || j.message || '');
  } catch {
    msg = String(bodyText || '');
  }
  if (code === 'model_not_found' || code === 'model_decommissioned' || code === 'NOT_FOUND') return true;
  const m = msg.toLowerCase();
  if (m.includes('is not found') && (m.includes('models/') || m.includes('model'))) return true;
  if (m.includes('not found') && m.includes('model') && !m.includes('response_format')) return true;
  if (m.includes('does not exist') && m.includes('model')) return true;
  if (/\b(?:unknown|invalid) model\b/i.test(m)) return true;
  if (/\bmodel (?:is )?(?:unknown|invalid|decommissioned)\b/i.test(m)) return true;
  if (m.includes('no endpoint found for model')) return true;
  if (m.includes('not a valid model') || m.includes('invalid model') || m.includes('unknown model') || m.includes('decommissioned')) return true;
  return false;
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

  const messages = options.noSystemRole
    ? [{ role: 'user', content: `${systemPrompt}\n\n${prompt}` }]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ];

  const body = {
    model,
    messages,
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
  const apiKey = providerApiKey(env, id);
  if (!apiKey) return { id, ok: false, status: 'not_configured', keyVariable: spec.env };
  const cooldown = providerCooldownStatus(id, Date.now(), env);
  if (cooldown) return cooldown;

  const started = Date.now();
  const configuredModel = String(env[spec.modelEnv] || spec.defaultModel).trim();
  const candidateModels = getModelCandidates(id, configuredModel, env);
  const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const maxPromptChars = Math.max(150000, Number(options.maxPromptChars || 150000));
  const promptText = String(prompt || '').slice(0, maxPromptChars);

  let lastResponse = null;
  let lastBodyText = '';
  let lastModel = configuredModel;
  let attempts = 0;
  const maxAttempts = 3;

  let currentOptions = { ...options };
  let currentMaxTokens = calculateMaxTokens(id, configuredModel, options.maxTokens);

  for (const model of candidateModels) {
    if (attempts >= maxAttempts) break;
    attempts += 1;
    lastModel = model;

    let url = id === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : id === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : id === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (id === 'gemini') headers['x-goog-api-key'] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
    if (id === 'openrouter') {
      headers['HTTP-Referer'] = String(env.OPENROUTER_HTTP_REFERER || 'https://example.invalid');
      headers['X-Title'] = 'HACOO BOT V6';
    }

    let reqPayload = requestBody(id, model, promptText, currentMaxTokens, currentOptions);
    let response = await withTimeout(signal => fetch(url, {
      method: 'POST', signal, headers,
      body: JSON.stringify(reqPayload)
    }), timeoutMs);
    let bodyText = await response.text();

    lastResponse = response;
    lastBodyText = bodyText;

    if (response.ok) {
      break;
    }

    // Arrêt immédiat si rate limit (429), authentification refusée (401/403), quota épuisé (402) ou erreur serveur (5xx)
    if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402 || response.status >= 500) {
      break;
    }

    const detailText = String(bodyText || '').toLowerCase();
    const modelError = isModelError(response.status, detailText);

    if (!modelError && response.status === 400) {
      // 1. Détection de rejet du format JSON / response_format / responseMimeType
      const hasJsonActive = Boolean(
        reqPayload.response_format ||
        reqPayload.generationConfig?.responseMimeType ||
        currentOptions.jsonMode ||
        currentOptions.responseFormat === 'json'
      );
      if (hasJsonActive) {
        currentOptions.jsonMode = false;
        reqPayload = requestBody(id, model, promptText, currentMaxTokens, currentOptions);
        const retryResponse = await withTimeout(signal => fetch(url, {
          method: 'POST', signal, headers,
          body: JSON.stringify(reqPayload)
        }), timeoutMs);
        const retryBodyText = await retryResponse.text();
        lastResponse = retryResponse;
        lastBodyText = retryBodyText;
        if (retryResponse.ok) {
          break;
        }
      }

      // 2. Détection de rejet du rôle 'system' (ex. modèles Gemma sur OpenRouter)
      const currentDetail = String(lastBodyText || '').toLowerCase();
      if (/system.*(?:role|message)|role.*system/i.test(currentDetail) && !currentOptions.noSystemRole) {
        currentOptions.noSystemRole = true;
        reqPayload = requestBody(id, model, promptText, currentMaxTokens, currentOptions);
        const retryResponse = await withTimeout(signal => fetch(url, {
          method: 'POST', signal, headers,
          body: JSON.stringify(reqPayload)
        }), timeoutMs);
        const retryBodyText = await retryResponse.text();
        lastResponse = retryResponse;
        lastBodyText = retryBodyText;
        if (retryResponse.ok) {
          break;
        }
      }

      // 3. Détection de dépassement de tokens
      const tokenDetail = String(lastBodyText || '').toLowerCase();
      if (/max_tokens|max_output_tokens|completion_tokens|maximum allowed tokens|token limit|too large/i.test(tokenDetail)) {
        const matchLimit = tokenDetail.match(/allowed (?:tokens )?(?:of )?(\d+)/i) || tokenDetail.match(/maximum (?:is )?(\d+)/i);
        currentMaxTokens = (matchLimit && Number(matchLimit[1]) > 0)
          ? Math.max(256, Number(matchLimit[1]) - 32)
          : Math.max(256, Math.min(currentMaxTokens, 4096));
        reqPayload = requestBody(id, model, promptText, currentMaxTokens, currentOptions);
        const retryResponse = await withTimeout(signal => fetch(url, {
          method: 'POST', signal, headers,
          body: JSON.stringify(reqPayload)
        }), timeoutMs);
        const retryBodyText = await retryResponse.text();
        lastResponse = retryResponse;
        lastBodyText = retryBodyText;
        if (retryResponse.ok) {
          break;
        }
      }

      // Si après ces ajustements ce n'est pas un problème de modèle, arrêt immédiat
      if (!isModelError(lastResponse.status, lastBodyText)) {
        break;
      }
    }

    // 4. Si c'est une erreur de modèle (404 ou 400 model_not_found/invalid_argument), la boucle for continue vers le prochain modèle
  }

  if (!lastResponse || !lastResponse.ok) {
    const status = lastResponse ? lastResponse.status : 500;
    const cooldownText = lastBodyText.slice(0, 2000);
    const cooldownMs = quotaCooldownMs(cooldownText, status, lastResponse?.headers?.get('retry-after'));
    if (cooldownMs) {
      const file = cooldownFile(env);
      providerCooldowns.set(cooldownKey(file, id), Date.now() + cooldownMs);
      saveCooldowns(file);
    }
    const classified = classifyHttpError(status, lastBodyText);
    const errorDetail = extractApiErrorDetail(lastBodyText);
    const fullMessage = errorDetail
      ? `${classified.message} Détail : ${errorDetail}`
      : classified.message;

    console.warn(`[AI Provider Error] [${id}] [${lastModel}] HTTP ${status} (${classified.status}): ${fullMessage}`);

    return {
      id,
      ok: false,
      status: classified.status,
      httpStatus: status,
      retryAfterMs: cooldownMs || undefined,
      message: fullMessage,
      errorDetail: errorDetail || undefined,
      errorBody: redactSecrets(lastBodyText).slice(0, 2000),
      latencyMs: Date.now() - started,
      model: lastModel
    };
  }

  let body;
  try { body = JSON.parse(lastBodyText); }
  catch { return { id, ok: false, status: 'invalid_response', message: 'Réponse du fournisseur non JSON ou mal formée.', latencyMs: Date.now() - started, model: lastModel }; }

  if (id === 'gemini') {
    if (body.promptFeedback?.blockReason) {
      return {
        id,
        ok: false,
        status: 'model_refusal',
        message: `Requête bloquée par les filtres de sécurité du modèle (${body.promptFeedback.blockReason}).`,
        latencyMs: Date.now() - started,
        model: lastModel
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
        model: lastModel
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
        model: lastModel
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
        model: lastModel
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
        model: lastModel
      };
    }
    providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
    saveCooldowns(cooldownFile(env));
    const maxResponseChars = Math.max(500000, Number(options.maxResponseChars || 500000));
    return { id, ok: true, status: 'connected', text: text.slice(0, maxResponseChars), finishReason, latencyMs: Date.now() - started, model: lastModel };
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
      model: lastModel
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
      model: lastModel
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
      model: lastModel
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
      model: lastModel
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
      model: lastModel
    };
  }
  providerCooldowns.delete(cooldownKey(cooldownFile(env), id));
  saveCooldowns(cooldownFile(env));
  const maxResponseChars = Math.max(500000, Number(options.maxResponseChars || 500000));
  return { id, ok: true, status: 'connected', text: text.slice(0, maxResponseChars), finishReason, latencyMs: Date.now() - started, model: lastModel };
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
  const ids = resolveProviderChain(env, options);
  const tried = [];
  let longestCooldown = 0;
  let configuredCount = 0;
  for (const id of ids) {
    if (!providerConfigured(env, id)) continue;
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
  KNOWN_VALID_MODELS,
  DEFAULT_PROVIDER_CHAIN,
  TASK_PROVIDER_CHAINS,
  providerStatus,
  providerApiKey,
  providerConfigured,
  providerModel,
  classifyTaskType,
  resolveProviderChain,
  testProvider,
  testConfiguredProviders,
  callProvider,
  generateText,
  redactSecrets,
  classifyHttpError,
  extractApiErrorDetail,
  calculateMaxTokens,
  getModelCandidates,
  isModelError
};
