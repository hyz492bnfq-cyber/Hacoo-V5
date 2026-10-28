'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  callProvider,
  generateText,
  classifyHttpError,
  extractApiErrorDetail,
  calculateMaxTokens,
  redactSecrets
} = require('../lib/provider-manager');

const { runProjectTask } = require('../lib/project-agent');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-400-test-'));
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'sample.js'), 'let value = 1;\nmodule.exports = value;\n', 'utf8');
  return root;
}

test('classifyHttpError distingue précisément les types d’erreurs HTTP sans les traiter toutes comme temporaires', () => {
  // 400 : bad_request (non temporaire)
  const e400 = classifyHttpError(400, '{"error":{"message":"Invalid parameter response_format"}}');
  assert.equal(e400.status, 'bad_request');
  assert.equal(e400.isTemporary, false);

  // 401 / 403 : auth_error (non temporaire)
  const e401 = classifyHttpError(401, '{"error":"Invalid API key"}');
  assert.equal(e401.status, 'auth_error');
  assert.equal(e401.isTemporary, false);

  // 402 : quota_exceeded (non temporaire)
  const e402 = classifyHttpError(402, '{"error":"insufficient_quota"}');
  assert.equal(e402.status, 'quota_exceeded');
  assert.equal(e402.isTemporary, false);

  // 429 : rate_limited (temporaire)
  const e429 = classifyHttpError(429, 'rate limit reached');
  assert.equal(e429.status, 'rate_limited');
  assert.equal(e429.isTemporary, true);

  // 404 : model_not_found (non temporaire)
  const e404 = classifyHttpError(404, '{"error":"model not found"}');
  assert.equal(e404.status, 'model_not_found');
  assert.equal(e404.isTemporary, false);

  // 503 : temporary_error (temporaire)
  const e503 = classifyHttpError(503, 'service unavailable');
  assert.equal(e503.status, 'temporary_error');
  assert.equal(e503.isTemporary, true);
});

test('extractApiErrorDetail extrait le message utile et masque tout secret', () => {
  const text1 = JSON.stringify({ error: { message: 'Invalid model openai/gpt-oss-20b for sk-abcdef1234567890123456' } });
  const detail1 = extractApiErrorDetail(text1);
  assert.match(detail1, /Invalid model openai\/gpt-oss-20b/);
  assert.equal(detail1.includes('sk-abcdef'), false, 'Clé API masquée');

  const text2 = '{"message": "max_tokens is too large: 16000 with token Bearer gh_12345678901234567890"}';
  const detail2 = extractApiErrorDetail(text2);
  assert.match(detail2, /max_tokens is too large/);
  assert.equal(detail2.includes('gh_1234'), false, 'Token masqué');
});

test('calculateMaxTokens adapte la limite au fournisseur et au modèle', () => {
  // Groq Gemma plafonné à 4096
  assert.equal(calculateMaxTokens('groq', 'gemma2-9b-it', 16000), 4096);
  // Groq Llama plafonné à 8192
  assert.equal(calculateMaxTokens('groq', 'llama-3.1-8b-instant', 16000), 8192);
  // Gemini et OpenRouter autorisent les grands formats
  assert.equal(calculateMaxTokens('gemini', 'gemini-2.5-flash', 16000), 16000);
  assert.equal(calculateMaxTokens('openrouter', 'google/gemma-4-31b', 16000), 16000);
});

test('Groq : HTTP 400 sur response_format replie sans response_format et réussit', async () => {
  const originalFetch = global.fetch;
  const env = { GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'llama-3.3-70b-versatile' };
  let calls = 0;
  const payloads = [];

  try {
    global.fetch = async (url, init) => {
      calls += 1;
      const parsed = JSON.parse(init.body);
      payloads.push(parsed);

      if (calls === 1) {
        // Groq retourne 400 car response_format n'est pas supporté sur ce modèle
        return new Response(JSON.stringify({
          error: {
            message: "'response_format' of type 'json_object' is not supported with this model",
            type: 'invalid_request_error',
            code: 'invalid_request_error'
          }
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      // Deuxième tentative (repli) sans response_format
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"modifié sans response_format"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('groq', 'Fais un plan', { jsonMode: true }, env);
    assert.equal(res.ok, true);
    assert.equal(calls, 2, 'Doit effectuer exactement un repli');
    assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
    assert.equal(payloads[1].response_format, undefined, 'Le repli doit avoir retiré response_format');
    assert.equal(res.text, '{"summary":"modifié sans response_format"}');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Groq : HTTP 400 sur max_tokens excessif ajuste la limite et réussit au repli', async () => {
  const originalFetch = global.fetch;
  const env = { GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'llama-3.1-8b-instant' };
  let calls = 0;
  const payloads = [];

  try {
    global.fetch = async (url, init) => {
      calls += 1;
      const parsed = JSON.parse(init.body);
      payloads.push(parsed);

      if (calls === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'max_tokens: 8192 is greater than the maximum allowed tokens of 4096 for model llama-3.1-8b-instant',
            type: 'invalid_request_error'
          }
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"ok tokens ajustés"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('groq', 'Génère du code', { maxTokens: 8192 }, env);
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
    assert.ok(payloads[1].max_tokens <= 4096, `Tokens repliés doivent être <= 4096, reçus: ${payloads[1].max_tokens}`);
    assert.equal(res.text, '{"summary":"ok tokens ajustés"}');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Groq : HTTP 400 sur modèle invalide openai/gpt-oss-20b replie sur llama-3.3-70b-versatile', async () => {
  const originalFetch = global.fetch;
  const env = { GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'openai/gpt-oss-20b' };
  let calls = 0;
  const payloads = [];

  try {
    global.fetch = async (url, init) => {
      calls += 1;
      const parsed = JSON.parse(init.body);
      payloads.push(parsed);

      if (calls === 1) {
        return new Response(JSON.stringify({
          error: {
            message: "Model 'openai/gpt-oss-20b' not found",
            type: 'invalid_request_error',
            code: 'model_not_found'
          }
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"modèle corrigé"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('groq', 'Demande', {}, env);
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
    assert.equal(payloads[0].model, 'openai/gpt-oss-20b');
    assert.equal(payloads[1].model, 'llama-3.3-70b-versatile', 'Le modèle de repli doit être un modèle Groq standard');
    assert.equal(res.model, 'llama-3.3-70b-versatile');
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenRouter : HTTP 400 sur response_format replie sans response_format et réussit', async () => {
  const originalFetch = global.fetch;
  const env = { OPENROUTER_API_KEY: 'test-openrouter-key', OPENROUTER_MODEL: 'google/gemma-4-31b' };
  let calls = 0;
  const payloads = [];

  try {
    global.fetch = async (url, init) => {
      calls += 1;
      const parsed = JSON.parse(init.body);
      payloads.push(parsed);

      if (calls === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'Provider Lepton does not support response_format',
            code: 400
          }
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"openrouter fallback ok"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('openrouter', 'Génère plan', { jsonMode: true }, env);
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
    assert.equal(payloads[1].response_format, undefined);
    assert.equal(res.text, '{"summary":"openrouter fallback ok"}');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini : HTTP 404 sur modèle introuvable replie sur GEMINI_FALLBACK_MODELS', async () => {
  const originalFetch = global.fetch;
  const env = {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash,gemini-2.0-flash'
  };
  let calls = 0;
  const urls = [];

  try {
    global.fetch = async (url) => {
      calls += 1;
      urls.push(url);

      if (calls === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 404,
            message: 'models/gemini-3.8-flash is not found for API version v1beta',
            status: 'NOT_FOUND'
          }
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"summary":"gemini fallback ok"}' }] }, finishReason: 'STOP' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('gemini', 'Test', {}, env);
    assert.equal(res.ok, true);
    assert.equal(calls, 2);
    assert.match(urls[0], /models\/gemini-3\.8-flash/);
    assert.match(urls[1], /models\/gemini-2\.5-flash/);
    assert.equal(res.model, 'gemini-2.5-flash');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Échec définitif après repli : retourne bad_request avec le détail exact sans boucle infinie', async () => {
  const originalFetch = global.fetch;
  const env = { GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'llama-3.3-70b-versatile' };
  let calls = 0;

  try {
    global.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        error: { message: 'Permanent bad request: prompt contains forbidden bytes' }
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await callProvider('groq', 'Test prompt', { jsonMode: true }, env);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'bad_request');
    assert.equal(res.httpStatus, 400);
    assert.match(res.message, /Permanent bad request: prompt contains forbidden bytes/);
    assert.equal(calls, 2, 'Exactement 1 tentative initiale + 1 repli (aucune boucle infinie)');
  } finally {
    global.fetch = originalFetch;
  }
});

test('runProjectTask expose le diagnostic d’erreur HTTP 400 sans fuite de secrets', async () => {
  const root = makeTempProject();
  try {
    let calls = 0;
    await assert.rejects(
      async () => {
        await runProjectTask(root, 'Modifier le projet avec échec 400', {}, {
          generateText: async () => {
            calls += 1;
            return {
              ok: false,
              status: 'bad_request',
              message: 'Requête invalide ou paramètre non supporté (HTTP 400). Détail : Unknown parameter with key=sk-live-secret123456789'
            };
          },
          runCandidateChecks: () => ({ ok: true }),
          createMultiFilePR: async () => ({ ok: false })
        });
      },
      err => {
        assert.match(err.message, /Fournisseur IA indisponible/);
        assert.match(err.message, /bad_request/);
        assert.match(err.message, /HTTP 400/);
        assert.equal(err.message.includes('sk-live-secret'), false, 'Le secret ne doit pas apparaître dans le message d’erreur');
        return true;
      }
    );
    assert.equal(calls, 2, 'runProjectTask effectue 2 tentatives maximum (1 essai + 1 retry)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
