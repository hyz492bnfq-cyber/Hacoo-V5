'use strict';

const SEND_STATES = new Set(['collecting', 'ready', 'sending', 'uncertain', 'sent', 'cleanup_failed']);

function photoGroupRecoveryAction(sendState) {
  const state = String(sendState || 'collecting');
  if (!SEND_STATES.has(state)) return 'manual_review';
  if (state === 'sending' || state === 'uncertain') return 'manual_review';
  if (state === 'sent' || state === 'cleanup_failed') return 'cleanup_only';
  return 'resume_send';
}

module.exports = { photoGroupRecoveryAction };
