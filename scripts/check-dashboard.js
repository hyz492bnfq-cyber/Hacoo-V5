'use strict';
// Syntax-check every inline JavaScript block in dashboard.html without evaluating it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const htmlPath = path.resolve(__dirname, '..', 'dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && !/type\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(match[1]));
if (!blocks.length) {
  console.error('Aucun bloc JavaScript inline trouvé dans dashboard.html.');
  process.exit(1);
}
let failed = false;
blocks.forEach((match, index) => {
  const file = path.join(os.tmpdir(), `hacoo-dashboard-check-${process.pid}-${index}.js`);
  try {
    fs.writeFileSync(file, match[2], { mode: 0o600 });
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error || result.status !== 0) {
      failed = true;
      console.error(`Échec de syntaxe JavaScript dans le bloc inline ${index + 1}.`);
      if (result.stderr) console.error(result.stderr.trim());
    }
  } finally {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
});
if (failed) process.exit(1);
console.log(`${blocks.length} bloc(s) JavaScript inline de dashboard.html : syntaxe valide.`);
