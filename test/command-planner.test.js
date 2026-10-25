'use strict'; const test=require('node:test'); const assert=require('node:assert/strict'); const {planSafeCommand}=require('../lib/command-planner');
test('maps only allowlisted natural language commands',()=>{assert.equal(planSafeCommand('lancer une revue autonome').action,'run_review');assert.equal(planSafeCommand('supprime tous les fichiers').ok,false);});
