'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeConfig,detectRule,isAllowed,parseAiJson,suspicious}=require('../lib/group-moderation');
test('normalise les IDs et les listes',()=>{const c=normalizeConfig({chatIds:['-1001234567890','abc'],blockedWords:[' spam ','spam']});assert.deepEqual(c.chatIds,['-1001234567890']);assert.deepEqual(c.blockedWords,['spam']);});
test('détecte les mots et expressions sans sous-chaînes',()=>{const c=normalizeConfig({blockedWords:['spam'],blockedPhrases:['rejoins mon groupe']});assert.equal(detectRule('spam ici',c).category,'mot_interdit');assert.equal(detectRule('rejoins mon groupe maintenant',c).category,'expression_interdite');assert.equal(detectRule('spammer',c),null);});
test('les exceptions passent avant les règles',()=>{const c=normalizeConfig({blockedWords:['arnaque'],allowedPhrases:['signaler une arnaque']});assert.equal(isAllowed('Je veux signaler une arnaque',c),true);});
test('analyse le JSON IA de façon bornée',()=>{assert.deepEqual(parseAiJson('```json\n{"violation":true,"category":"spam","confidence":1.2,"reason":"pub"}\n```'),{violation:true,category:'spam',confidence:1,reason:'pub'});assert.equal(parseAiJson('invalide'),null);});
test('ne déclenche IA que sur signaux suspects',()=>{assert.equal(suspicious('Clique pour obtenir un remboursement'),true);assert.equal(suspicious('Bonjour tout le monde'),false);});
