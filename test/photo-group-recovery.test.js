'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { photoGroupRecoveryAction } = require('../lib/photo-group-recovery');

test('un crash avant le début d’un envoi confirmé peut reprendre l’envoi', () => {
  assert.equal(photoGroupRecoveryAction('collecting'), 'resume_send');
  assert.equal(photoGroupRecoveryAction('ready'), 'resume_send');
});

test('un crash pendant un appel Telegram ne déclenche jamais un renvoi automatique', () => {
  assert.equal(photoGroupRecoveryAction('sending'), 'manual_review');
  assert.equal(photoGroupRecoveryAction('uncertain'), 'manual_review');
});

test('un crash après confirmation reprend uniquement le nettoyage des originaux', () => {
  assert.equal(photoGroupRecoveryAction('sent'), 'cleanup_only');
  assert.equal(photoGroupRecoveryAction('cleanup_failed'), 'cleanup_only');
});

test('les anciens journaux sans état gardent leur compatibilité, les états invalides sont bloqués', () => {
  assert.equal(photoGroupRecoveryAction(undefined), 'resume_send');
  assert.equal(photoGroupRecoveryAction(null), 'resume_send');
  assert.equal(photoGroupRecoveryAction(''), 'manual_review');
  assert.equal(photoGroupRecoveryAction('half_sent'), 'manual_review');
  assert.equal(photoGroupRecoveryAction('unknown'), 'manual_review');
});

test('stress: 100 000 journaux simulés ne rejouent aucun envoi incertain ou confirmé', () => {
  const states = ['collecting', 'ready', 'sending', 'uncertain', 'sent', 'cleanup_failed', 'corrupt'];
  for (let index = 0; index < 100000; index++) {
    const state = states[index % states.length];
    const action = photoGroupRecoveryAction(state);
    if (state === 'sending' || state === 'uncertain' || state === 'corrupt') {
      assert.equal(action, 'manual_review', 'state=' + state + ', index=' + index);
    }
    if (state === 'sent' || state === 'cleanup_failed') {
      assert.equal(action, 'cleanup_only', 'state=' + state + ', index=' + index);
    }
  }
});
