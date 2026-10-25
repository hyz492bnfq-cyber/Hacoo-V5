'use strict';

const DEFAULT_TIMEOUT_MS = 15000;
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
  const model = String(env[spec.modelEnv] || spec.defaultModel).trim();
  const started = Date.now();
  const maxTokens = Math.max(8, Math.min(1200, Number(options.maxTokens) || 500));
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
      // Ne jamais renvoyer le corps d’erreur du fournisseur au navigateur : il peut contenir des données sensibles.
      return { id, ok: false, status: 'api_error', httpStatus: response.status, message: `Le fournisseur a répondu HTTP ${response.status}.`, latencyMs: Date.now() - started, model };
    }
    let body;
    try { body = JSON.parse(bodyText); } catch { return { id, ok: false, status: 'invalid_response', latencyMs: Date.now() - started, model }; }
    const text = id === 'gemini'
      ? (body.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim()
      : String(body.choices?.[0]?.message?.content || '').trim();
    if (!text) return { id, ok: false, status: 'empty_response', latencyMs: Date.now() - started, model };
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
  for (const id of ids) {
    if (!String(env[PROVIDERS[id].env] || '').trim()) continue;
    const result = await callProvider(id, prompt, options, env);
    tried.push({ id, status: result.status, httpStatus: result.httpStatus });
    if (result.ok) return { ok: true, provider: id, model: result.model, text: result.text, latencyMs: result.latencyMs, tried };
  }
  return { ok: false, status: tried.length ? 'all_providers_failed' : 'no_provider_configured', tried };
}

module.exports = { PROVIDERS, providerStatus, testProvider, testConfiguredProviders, callProvider, generateText };
