'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  extractJsonObject,
  extractPatchPlan,
  runProjectTask
} = require('../lib/project-agent');

const {
  callProvider,
  generateText
} = require('../lib/provider-manager');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-ai-test-'));
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'target.js'), 'const count = 0;\nmodule.exports = count;\n', 'utf8');
  return root;
}

test('extractJsonObject gère les objets valides, le markdown, les accolades parasites et la troncature', () => {
  // 1. Objet simple
  assert.equal(extractJsonObject('{"summary":"test"}'), '{"summary":"test"}');

  // 2. Accolades dans du texte avant l’objet réel
  const withPrefixBraces = 'Analyse du fichier {lib/target.js} :\n{"summary":"ok","files":[]}';
  const extracted = extractJsonObject(withPrefixBraces);
  assert.equal(extracted, '{"summary":"ok","files":[]}');

  // 3. Texte tronqué (accolade non fermée)
  assert.equal(extractJsonObject('{"summary": "en cours...'), null);
  assert.equal(extractJsonObject('texte sans JSON'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(null), null);
});

test('extractPatchPlan gère les réponses valides, enveloppées dans Markdown, tronquées et vides', () => {
  const validPlanObj = {
    summary: 'Mise à jour ciblée',
    files: [{ path: 'lib/target.js', patches: [{ find: 'count = 0', replace: 'count = 1' }] }]
  };

  // 1. JSON direct
  const p1 = extractPatchPlan(JSON.stringify(validPlanObj));
  assert.equal(p1.summary, 'Mise à jour ciblée');
  assert.equal(p1.files.length, 1);

  // 2. Enveloppé dans un bloc Markdown avec texte avant et après
  const markdownWrapped = [
    'Voici le plan de modification requis :',
    '```json',
    JSON.stringify(validPlanObj, null, 2),
    '```',
    'Fin de proposition.'
  ].join('\n');
  const p2 = extractPatchPlan(markdownWrapped);
  assert.equal(p2.summary, 'Mise à jour ciblée');

  // 3. Réponse vide
  assert.throws(
    () => extractPatchPlan(''),
    err => /Réponse IA non JSON ou objet JSON incomplet/.test(err.message) && /vide/i.test(err.message)
  );

  // 4. Réponse tronquée (début d’objet mais fin coupée)
  const truncated = '{"summary": "changement", "files": [{"path": "lib/target.js", "patches": [{"find": "count = 0"';
  assert.throws(
    () => extractPatchPlan(truncated),
    err => /Réponse IA non JSON ou objet JSON incomplet/.test(err.message) && /tronquée/i.test(err.message)
  );

  // 5. Refus du modèle ou texte libre non-JSON
  const refusal = "Je ne peux pas répondre à cette demande car elle ne respecte pas les consignes de sécurité.";
  assert.throws(
    () => extractPatchPlan(refusal),
    err => /Réponse IA non JSON ou objet JSON incomplet/.test(err.message)
  );
});

test('callProvider active le mode JSON et détecte réponses vides, refus et troncatures pour Gemini', async () => {
  const originalFetch = global.fetch;
  const env = { GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODEL: 'gemini-3.8-flash' };

  try {
    // A. Mode JSON activé
    let capturedBody = null;
    global.fetch = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"summary":"ok"}' }] }, finishReason: 'STOP' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const resJson = await callProvider('gemini', 'Fais un plan', { jsonMode: true, maxTokens: 2000 }, env);
    assert.equal(resJson.ok, true);
    assert.equal(capturedBody.generationConfig?.responseMimeType, 'application/json');
    assert.equal(resJson.text, '{"summary":"ok"}');

    // B. Réponse tronquée (finishReason MAX_TOKENS)
    global.fetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"summary": "tronqué' }] }, finishReason: 'MAX_TOKENS' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resTrunc = await callProvider('gemini', 'test', {}, env);
    assert.equal(resTrunc.ok, false);
    assert.equal(resTrunc.status, 'truncated_response');
    assert.match(resTrunc.message, /tronquée par la limite de tokens/i);

    // C. Refus du modèle (SAFETY)
    global.fetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resRefusal = await callProvider('gemini', 'test', {}, env);
    assert.equal(resRefusal.ok, false);
    assert.equal(resRefusal.status, 'model_refusal');

    // D. Réponse vide
    global.fetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resEmpty = await callProvider('gemini', 'test', {}, env);
    assert.equal(resEmpty.ok, false);
    assert.equal(resEmpty.status, 'empty_response');
  } finally {
    global.fetch = originalFetch;
  }
});

test('callProvider active le mode JSON et détecte réponses vides, refus et troncatures pour Groq / OpenAI', async () => {
  const originalFetch = global.fetch;
  const env = { GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'test-groq-model' };

  try {
    // A. Mode JSON activé
    let capturedBody = null;
    global.fetch = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"ok"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const resJson = await callProvider('groq', 'Plan', { jsonMode: true }, env);
    assert.equal(resJson.ok, true);
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });

    // B. Réponse tronquée (finish_reason length)
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"partial": "json' }, finish_reason: 'length' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resTrunc = await callProvider('groq', 'test', {}, env);
    assert.equal(resTrunc.ok, false);
    assert.equal(resTrunc.status, 'truncated_response');

    // C. Refus explicite (refusal message)
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { refusal: 'Demande non autorisée sk-secret1234567890123456' }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resRefusal = await callProvider('groq', 'test', {}, env);
    assert.equal(resRefusal.ok, false);
    assert.equal(resRefusal.status, 'model_refusal');
    assert.equal(resRefusal.message.includes('sk-secret'), false, 'Les secrets doivent être masqués');

    // D. Réponse vide
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const resEmpty = await callProvider('groq', 'test', {}, env);
    assert.equal(resEmpty.ok, false);
    assert.equal(resEmpty.status, 'empty_response');

    // E. Repli en cas d’erreur HTTP 400 sur response_format
    let callCount = 0;
    global.fetch = async (url, init) => {
      callCount += 1;
      const parsed = JSON.parse(init.body);
      if (parsed.response_format) {
        return new Response(JSON.stringify({ error: { message: 'response_format is not supported' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"sans format"}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const resFallback = await callProvider('groq', 'Plan', { jsonMode: true }, env);
    assert.equal(resFallback.ok, true);
    assert.equal(resFallback.text, '{"summary":"sans format"}');
    assert.equal(callCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('runProjectTask effectue au maximum une nouvelle tentative contrôlée en cas de réponse invalide', async () => {
  const root = makeTempProject();
  try {
    let calls = 0;
    const promptsReceived = [];

    // Cas 1 : Succès immédiat (0 retry)
    calls = 0;
    const resSuccess1 = await runProjectTask(root, 'Mets à jour le compteur', {}, {
      generateText: async (prompt) => {
        calls += 1;
        promptsReceived.push(prompt);
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Mis à jour',
            files: [{ path: 'lib/target.js', patches: [{ find: 'count = 0', replace: 'count = 1' }] }]
          })
        };
      },
      runCandidateChecks: () => ({ ok: true, checks: [{ name: 'test', status: 'passed' }] }),
      createMultiFilePR: async () => ({ ok: false, status: 'not_attempted' })
    });
    assert.equal(calls, 1, 'Un seul appel IA doit être fait si la première tentative est valide');
    assert.equal(resSuccess1.status, 'validated_without_pull_request');

    // Cas 2 : Tentative 1 échoue (réponse tronquée/invalide), Tentative 2 réussit (1 retry)
    calls = 0;
    promptsReceived.length = 0;
    const resRetrySuccess = await runProjectTask(root, 'Mets à jour le compteur bis', {}, {
      generateText: async (prompt) => {
        calls += 1;
        promptsReceived.push(prompt);
        if (calls === 1) {
          return { ok: true, text: '{"summary": "incomplet' }; // Réponse tronquée au 1er essai
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Corrigé au 2eme essai',
            files: [{ path: 'lib/target.js', patches: [{ find: 'count = 0', replace: 'count = 2' }] }]
          })
        };
      },
      runCandidateChecks: () => ({ ok: true, checks: [{ name: 'test', status: 'passed' }] }),
      createMultiFilePR: async () => ({ ok: false, status: 'not_attempted' })
    });
    assert.equal(calls, 2, 'Doit retenter une fois et réussir');
    assert.match(promptsReceived[1], /TENTATIVE DE CORRECTION \(2\/2\)/);
    assert.equal(resRetrySuccess.summary, 'Corrigé au 2eme essai');

    // Cas 3 : Les deux tentatives échouent (maximum 1 nouvelle tentative = 2 appels au total)
    calls = 0;
    await assert.rejects(
      async () => {
        await runProjectTask(root, 'Mets à jour le compteur en échec', {}, {
          generateText: async () => {
            calls += 1;
            return { ok: true, text: 'Désolé, je ne peux pas faire cette modification.' };
          },
          runCandidateChecks: () => ({ ok: true }),
          createMultiFilePR: async () => ({ ok: false })
        });
      },
      err => {
        assert.match(err.message, /Réponse IA non JSON ou objet JSON incomplet/);
        return true;
      }
    );
    assert.equal(calls, 2, 'Ne doit jamais dépasser 2 appels (1 essai + 1 retry)');

    // Cas 4 : Fournisseur indisponible avec message de diagnostic utile sans fuite de secrets
    calls = 0;
    await assert.rejects(
      async () => {
        await runProjectTask(root, 'Demande avec erreur fournisseur', {}, {
          generateText: async () => {
            calls += 1;
            return {
              ok: false,
              status: 'truncated_response',
              message: 'Réponse IA tronquée par la limite de tokens avec api_key=AIzaSySecret1234567890'
            };
          },
          runCandidateChecks: () => ({ ok: true }),
          createMultiFilePR: async () => ({ ok: false })
        });
      },
      err => {
        assert.match(err.message, /Fournisseur IA indisponible/);
        assert.match(err.message, /truncated_response/);
        assert.equal(err.message.includes('AIzaSySecret'), false, 'Aucun secret ne doit fuiter');
        return true;
      }
    );
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
