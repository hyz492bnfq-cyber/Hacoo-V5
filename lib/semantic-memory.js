'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function filePath(root) { return path.join(root, 'workspace', 'memory.json'); }
function read(root) { try { const v = JSON.parse(fs.readFileSync(filePath(root), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function remember(root, input) {
  const category = String(input?.category || '').trim().slice(0, 40);
  const content = String(input?.content || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 600);
  const explanation = String(input?.explanation || '').trim().slice(0, 600);
  if (!category || content.length < 3 || explanation.length < 8) throw new Error('Catégorie, contenu et justification sont requis.');
  const dir = path.dirname(filePath(root)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const items = read(root); const item = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), category, content, explanation, source: 'admin_dashboard', rawPublicationData: false };
  items.push(item); const temp = `${filePath(root)}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(items.slice(-500), null, 2), { mode: 0o600 }); fs.renameSync(temp, filePath(root)); return item;
}
function list(root) { return read(root).slice(-100).reverse(); }
module.exports = { remember, list };
