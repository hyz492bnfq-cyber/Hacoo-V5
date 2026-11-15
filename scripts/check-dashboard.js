'use strict';
// Vérifie la syntaxe des blocs JavaScript inline de tous les dashboards sans les exécuter.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dashboards = ['dashboard.html', 'dashboard-autonomie.html'];
let failed = false;
let checked = 0;
for (const dashboard of dashboards) {
  const htmlPath = path.join(root, dashboard);
  if (!fs.existsSync(htmlPath)) continue;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && !/type\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(match[1]));
  if (!blocks.length) {
    failed = true;
    console.error(`Aucun bloc JavaScript inline trouvé dans ${dashboard}.`);
    continue;
  }
  blocks.forEach((match, index) => {
    checked += 1;
    const file = path.join(os.tmpdir(), `hacoo-dashboard-check-${process.pid}-${checked}.js`);
    try {
      fs.writeFileSync(file, match[2], { mode: 0o600 });
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (result.error || result.status !== 0) {
        failed = true;
        console.error(`Échec de syntaxe JavaScript dans ${dashboard}, bloc ${index + 1}.`);
        if (result.stderr) console.error(result.stderr.trim());
      }
    } finally { try { fs.rmSync(file, { force: true }); } catch {} }
  });
}
if (failed) process.exit(1);
console.log(`${checked} bloc(s) JavaScript inline vérifié(s) dans ${dashboards.filter(name => fs.existsSync(path.join(root, name))).join(', ')} : syntaxe valide.`);
