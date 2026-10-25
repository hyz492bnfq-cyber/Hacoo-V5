'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createSchedule, listSchedules, cancelSchedule, recoverSendingSchedules } = require('../lib/publication-scheduler');
test('requires future time, stores schedule, cancels only unsent work', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hacoo-sched-'));
 const row=createSchedule(root,{text:'Publication planifiée sans doublon',scheduledAt:new Date(Date.now()+3600000).toISOString(),targetChannel:'-1001'});
 assert.equal(listSchedules(root).length,1); assert.equal(cancelSchedule(root,row.id).ok,true); assert.equal(listSchedules(root)[0].status,'cancelled');
 fs.rmSync(root,{recursive:true,force:true});
});
test('recovers sending state to uncertain, not queued', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hacoo-sched-')); const dir=path.join(root,'workspace'); fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'scheduled-publications.json'),JSON.stringify([{id:'x',status:'sending',text:'x'}]));
 assert.equal(recoverSendingSchedules(root),1); assert.equal(listSchedules(root)[0].status,'uncertain'); fs.rmSync(root,{recursive:true,force:true});
});
