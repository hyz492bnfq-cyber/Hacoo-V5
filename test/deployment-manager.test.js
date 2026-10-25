'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { inspectCandidate, stageCandidate } = require('../lib/deployment-manager');
test('only inspects a candidate inside the isolated workspace and blocks secrets', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hacoo-deploy-')); const dir=path.join(root,'workspace','candidates'); fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'ok.js'),'module.exports = { ok: true };'); fs.writeFileSync(path.join(dir,'bad.js'),'const x = process.env.SECRET;'); fs.writeFileSync(path.join(dir,'dynamic.js'),"import('node:fs');");
 assert.equal(inspectCandidate(root,'workspace/candidates/ok.js').ok,true); assert.equal(inspectCandidate(root,'workspace/candidates/bad.js').ok,false); assert.equal(inspectCandidate(root,'workspace/candidates/dynamic.js').ok,false); assert.equal(inspectCandidate(root,'index.js').ok,false);
 const outside=path.join(root,'outside.js'); fs.writeFileSync(outside,'module.exports = {};'); fs.symlinkSync(outside,path.join(dir,'linked.js')); assert.equal(inspectCandidate(root,'workspace/candidates/linked.js').ok,false);
 const staged=stageCandidate(root,'workspace/candidates/ok.js',{testsPassed:false,independentSecurityPassed:false}); assert.equal(staged.productionChanged,false); assert.equal(staged.release.activated,false);
 fs.rmSync(root,{recursive:true,force:true});
});
