# Correctifs issus de l’audit — V6.3.1 (archive de travail)

## Limitation « Trop de requêtes »
- Suppression de la limite globale de 180 requêtes/minute qui comptait aussi les sondes et les appels non liés au dashboard.
- Suppression de la limite excessive de 35 requêtes/5 minutes appliquée à chaque requête authentifiée. Elle était incompatible avec le dashboard autonome qui interrogeait trois endpoints toutes les 30 secondes.
- La protection contre les tentatives de connexion erronées reste active : 10 échecs par IP sur 5 minutes, puis réponse 429 avec `Retry-After`.
- La limite d’API authentifiée est maintenant de 300 requêtes/minute par IP, largement suffisante pour l’usage normal tout en conservant une protection anti-abus.
- Le dashboard autonome utilise un endpoint agrégé (`/api/v6/overview`) au lieu de trois requêtes et actualise son état toutes les 60 secondes.

## Quotas des fournisseurs IA
- Ajout d’un cooldown local après une réponse HTTP 429, en respectant `Retry-After` si le fournisseur le donne.
- Les erreurs de quota quotidien sont mises en pause plus longtemps pour éviter de répéter les appels inutiles.
- L’interface affiche un message plus clair pour les réponses HTTP 429 et indique le délai de réessai quand il est fourni.

## Dashboard
- Harmonisation visuelle, contraste, hiérarchie des titres, cartes et contrôles tactiles.
- Navigation mobile plus lisible et accès explicite au centre « Autonomie V6 » dans le menu mobile.
- Ajout d’un guide rapide sur la page Autonomie pour expliquer le sens des indicateurs et les limites des candidats.

## Auto-développement
- La génération d’un candidat générique est désactivée par défaut pour éviter deux appels IA par cycle sans demande explicite.
- Quand `V6_AUTONOMOUS_ENGINEERING_ENABLED=true` et `V6_AUTONOMOUS_ENGINEERING_TARGET` pointe vers un module auxiliaire admissible, la revue autonome peut créer une tâche d’ingénierie persistante. Le traitement reste soumis aux contrôles existants et ne garantit pas un déploiement automatique.
- Une tâche ouverte pour la même cible empêche la création de doublons.

## Validation locale
- `node --check index.js` : réussi.
- `node --check` sur les modules JavaScript et scripts : réussi.
- `node scripts/check-dashboard.js` : réussi.
- Scripts inline de `dashboard.html` et `dashboard-autonomie.html` : syntaxe valide.
- `npm test` : 45 tests réussis, 0 échec.

## Limites
- Cette archive n’a pas été poussée vers GitHub ni déployée sur FadeHost.
- Les appels réels à Telegram, Gemini, Groq, OpenRouter et FadeHost n’ont pas été testés avec des secrets de production.
- Le système ne dispose pas encore d’une boucle générale complète de réparation itérative des candidats. L’auto-création de tâches est conditionnelle à la configuration; les protections de déploiement restent en place.
