'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const {
  safePath,
  isEngineeringRequest,
  extractPatchPlan,
  applyPatchPlan,
  validateCandidate,
  runCandidateChecks,
  runProjectTask
} = require('../lib/project-agent');

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hacoo-project-agent-test-'));
}

function write(root, relative, content) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  return destination;
}

test('autorise les fichiers utiles mais protège secrets, données et configuration', () => {
  assert.equal(safePath('index.js'), 'index.js');
  assert.equal(safePath('dashboard.html'), 'dashboard.html');
  assert.equal(safePath('dashboard-autonomie.html'), 'dashboard-autonomie.html');
  assert.equal(safePath('lib/command-planner.js'), 'lib/command-planner.js');
  assert.equal(safePath('test/project-agent.test.js'), 'test/project-agent.test.js');
  for (const file of [
    '.env', '.env.production', 'data.json', 'data.json.bak', 'package.json',
    'package-lock.json', '../index.js', 'workspace/x.js', '.github/workflows/ci.yml',
    'lib/provider-manager.js', 'lib/project-agent.js'
  ]) assert.throws(() => safePath(file));
});

test('le chat reconnait les demandes de modification explicites', () => {
  assert.equal(isEngineeringRequest('Intègre un agent multi-fichiers au dashboard'), true);
  assert.equal(isEngineeringRequest('Corrige le filtrage des doublons'), true);
  assert.equal(isEngineeringRequest('Pourquoi la file est bloquée ?'), false);
});

test('le parseur accepte un JSON encadré et ignore les accolades dans les chaînes et le texte après', () => {
  const response = 'Voici le plan : ```json\n' + JSON.stringify({
    summary: 'Conserver {accolades} dans le texte',
    files: [{ path: 'lib/sample.js', patches: [{ find: 'value = 1', replace: 'value = 2' }] }]
  }) + '\n```\nFin.';
  const plan = extractPatchPlan(response);
  assert.equal(plan.summary, 'Conserver {accolades} dans le texte');
  assert.equal(plan.files[0].patches[0].replace, 'value = 2');
});

test('un JSON mal formé expose un diagnostic de parsing sans recopier la réponse', () => {
  assert.throws(
    () => extractPatchPlan('{"summary": "secret-ish", "files": [}'),
    error => /Plan de modifications JSON invalide/.test(error.message) && /position|property|JSON|Unexpected/i.test(error.message)
  );
});

test('le plan accepte des patchs exacts, refuse les doublons et le remplacement intégral', () => {
  const plan = extractPatchPlan(JSON.stringify({
    summary: 'Mise à jour ciblée',
    files: [{ path: 'lib/sample.js', patches: [{ find: 'value: 1', replace: 'value: 2' }] }]
  }));
  assert.equal(plan.files.length, 1);
  assert.throws(() => extractPatchPlan(JSON.stringify({
    files: [
      { path: 'lib/sample.js', patches: [{ find: 'a', replace: 'b' }] },
      { path: 'lib/sample.js', patches: [{ find: 'c', replace: 'd' }] }
    ]
  })));
  assert.throws(() => extractPatchPlan(JSON.stringify({
    files: [{ path: 'lib/sample.js', content: 'module.exports = {};' }]
  })));
  assert.throws(() => extractPatchPlan(JSON.stringify({
    files: [{ path: 'lib/sample.js', patches: [{ find: 'value: 1', replace: 'const api_key=\"123456789secret\";' }] }]
  })));
});

test('un patch mal formé expose un diagnostic précis et les alias usuels sont acceptés', () => {
  // Cas réel observé : le modèle répond avec un find vide pour créer une fonctionnalité entière.
  assert.throws(
    () => extractPatchPlan(JSON.stringify({
      summary: 'Ajout de fonctionnalité',
      files: [{ path: 'lib/text-replacements.js', patches: [{ find: '', replace: 'function replaceText() {}' }] }]
    })),
    error => /Patch n°1 de lib\/text-replacements\.js invalide : "find" manquant ou vide/.test(error.message) && /extrait exact et unique/.test(error.message)
  );
  assert.throws(
    () => extractPatchPlan(JSON.stringify({
      files: [{ path: 'lib/sample.js', patches: [{ find: 'value = 1' }] }]
    })),
    error => /Patch n°1 de lib\/sample\.js invalide : "replace" manquant/.test(error.message)
  );
  assert.throws(
    () => extractPatchPlan(JSON.stringify({
      files: [{ path: 'lib/sample.js', patches: ['const x = 1;'] }]
    })),
    error => /Patch n°1 de lib\/sample\.js invalide : attendu un objet/.test(error.message)
  );
  // Alias usuels renvoyés par les modèles : tolérés pour éviter les échecs inutiles.
  const aliased = extractPatchPlan(JSON.stringify({
    summary: 'Alias',
    files: [{ path: 'lib/sample.js', patches: [{ old: 'value: 1', after: 'value: 2' }] }]
  }));
  assert.equal(aliased.files[0].patches[0].find, 'value: 1');
  assert.equal(aliased.files[0].patches[0].replace, 'value: 2');
});

test('les ancres doivent correspondre une seule fois et aucun lien symbolique n’est suivi', () => {
  const root = makeRoot();
  try {
    write(root, 'lib/sample.js', 'const value = 1;\nmodule.exports = value;\n');
    const plan = { files: [{ path: 'lib/sample.js', patches: [{ find: 'value', replace: 'count' }] }] };
    assert.throws(() => applyPatchPlan(root, plan), /absente ou ambiguë/i);
    assert.throws(() => applyPatchPlan(root, plan), /2 occurrences/, 'le diagnostic ambigu indique le nombre d occurrences exactes');
    write(root, 'lib/sample.js', 'const value = 1;\nmodule.exports = value;\n');
    assert.throws(() => applyPatchPlan(root, { files: [{ path: 'lib/sample.js', patches: [{ find: 'Valeur inexistante', replace: 'x' }] }] }), /0 occurrence/, 'le diagnostic absent indique zero occurrence');
    write(root, 'lib/sample.js', 'const value = 1;\n');
    const valid = applyPatchPlan(root, plan);
    assert.equal(valid[0].content, 'const count = 1;\n');

    const outside = write(root, 'outside.js', 'const value = 1;\n');
    fs.unlinkSync(path.join(root, 'lib/sample.js'));
    try {
      fs.symlinkSync(outside, path.join(root, 'lib/sample.js'));
      assert.throws(() => applyPatchPlan(root, plan), /Lien symbolique interdit/i);
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('le contrôle syntaxique bloque un candidat JavaScript invalide', async () => {
  const result = await validateCandidate('', [{ path: 'lib/sample.js', original: '', content: 'const = ;\n' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /syntaxe invalide|SyntaxError/);
});

test('la suite isolée ne reçoit ni data.json, ni .env, ni variables secrètes', async () => {
  const root = makeRoot();
  const previous = process.env.HACOO_TEST_SECRET;
  try {
    process.env.HACOO_TEST_SECRET = 'not-for-child-process';
    write(root, 'data.json', '{"private":"data"}');
    write(root, '.env', 'HACOO_TEST_SECRET=not-for-child-process');
    write(root, 'scripts/check-dashboard.js', [
      "const fs = require('node:fs');",
      "if (fs.existsSync('data.json') || fs.existsSync('.env') || process.env.HACOO_TEST_SECRET) process.exit(1);"
    ].join('\n'));
    write(root, 'test/sandbox.test.js', [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const fs = require('node:fs');",
      "test('sandbox excludes production data and environment', () => {",
      "  assert.equal(fs.existsSync('data.json'), false);",
      "  assert.equal(fs.existsSync('.env'), false);",
      "  assert.equal(process.env.HACOO_TEST_SECRET, undefined);",
      '});'
    ].join('\n'));
    const result = await runCandidateChecks(root, [], { timeoutMs: 20000 });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.equal(result.checks[0].name, 'scripts/check-dashboard.js');
    assert.equal(result.checks.at(-1).name, 'Suite complète node --test');
  } finally {
    if (previous === undefined) delete process.env.HACOO_TEST_SECRET;
    else process.env.HACOO_TEST_SECRET = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('aucune PR n’est créée si les tests échouent; une PR est appelée après validation', async () => {
  const root = makeRoot();
  const source = 'const value = 1;\nmodule.exports = value;\n';
  write(root, 'lib/sample.js', source);
  let order = [];
  const generated = {
    ok: true,
    text: JSON.stringify({
      summary: 'Modification testée',
      files: [{ path: 'lib/sample.js', patches: [{ find: 'value = 1', replace: 'value = 2' }] }]
    })
  };
  try {
    const failed = await runProjectTask(root, 'Modifie le module sample pour le test', {}, {
      generateText: async () => generated,
      runCandidateChecks: () => {
        order.push('tests');
        return { ok: false, checks: [{ name: 'Suite complète', status: 'failed', output: 'échec simulé' }] };
      },
      createMultiFilePR: async () => {
        order.push('pr');
        return { ok: true, pullRequestUrl: 'https://github.com/example/repo/pull/1' };
      }
    });
    assert.deepEqual(order, ['tests']);
    assert.equal(failed.status, 'validation_failed');
    assert.equal(failed.pullRequest.status, 'not_attempted');

    order = [];
    const passed = await runProjectTask(root, 'Modifie le module sample pour le test', {}, {
      generateText: async () => generated,
      runCandidateChecks: () => {
        order.push('tests');
        return { ok: true, checks: [{ name: 'Suite complète', status: 'passed' }] };
      },
      createMultiFilePR: async () => {
        order.push('pr');
        return { ok: true, pullRequestUrl: 'https://github.com/example/repo/pull/2' };
      }
    });
    assert.deepEqual(order, ['tests', 'pr']);
    assert.equal(passed.status, 'pull_request_ready');
    assert.equal(passed.merge, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
