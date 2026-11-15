'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const files = [path.join(root, 'index.js')];
for (const directory of ['lib', 'scripts']) {
  for (const entry of fs.readdirSync(path.join(root, directory))) {
    if (entry.endsWith('.js')) files.push(path.join(root, directory, entry));
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const script of ['check-dashboard.js', 'check-config.js']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
