'use strict';
function planSafeCommand(value) {
  const command = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const routes = [
    { patterns: [/^(statut|etat|status)( du bot)?$/], action: 'status', mutating: false },
    { patterns: [/^(lancer|demarrer) (une )?(revue|analyse) (ia|autonome)?$/], action: 'run_review', mutating: true },
    { patterns: [/^(envoyer|generer) (le )?rapport( quotidien)?( maintenant)?$/], action: 'daily_report', mutating: true },
    { patterns: [/^(voir|lister) (les )?(publications )?programmees$/], action: 'list_schedules', mutating: false },
    { patterns: [/^(voir|lister) (les )?propositions$/], action: 'list_proposals', mutating: false },
    { patterns: [/^(verifier|inspecter) (la )?sante( du bot)?$/], action: 'health', mutating: false }
  ];
  for (const route of routes) if (route.patterns.some(p => p.test(command))) return { ok: true, action: route.action, mutating: route.mutating, requiresAdmin: true };
  return { ok: false, action: 'unsupported', mutating: false, requiresAdmin: true, message: 'Commande non reconnue. Commandes disponibles : statut du bot, lancer une revue autonome, envoyer le rapport quotidien, voir les publications programmées, voir les propositions, vérifier la santé.' };
}
module.exports = { planSafeCommand };
