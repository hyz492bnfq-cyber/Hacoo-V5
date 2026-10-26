# M2 HACOO BOT V6.4.0 — rapport de construction

## Objectif de la version
Faire évoluer les composants existants vers un cycle d'auto-développement vérifiable : proposition, sélection d'une cible non critique, génération de candidat, contrôle statique, tests ciblés isolés, correction bornée et création facultative d'une Pull Request GitHub en brouillon.

## Changements
- Ajout d'une allowlist de modules `lib/*.js` non critiques, de moins de 10 Ko et disposant de tests ciblés.
- Le moteur de revue demande au modèle de sélectionner une cible dans cette liste; les chemins non autorisés sont rejetés côté code.
- L'agent effectue jusqu'à 3 tentatives configurables et transmet les erreurs de contrôle/test à la tentative suivante.
- Les tests ciblés tournent dans une copie temporaire du projet, sans `.env`, `data.json`, workspace runtime ni `node_modules`, avec un environnement réduit et les permissions Node activées.
- Les candidats identiques à la source ou sans test ciblé sont refusés.
- Ajout de `lib/github-pr.js` : comparaison du contenu distant avec la source locale, branche dédiée, commit d'un seul fichier et Pull Request en brouillon. Aucune fusion automatique.
- Les tâches bloquées/échouées sur une cible sont refroidies 24 heures pour éviter de répéter des appels IA identiques sur la même cible.
- Les cooldowns fournisseurs HTTP 429 sont persistés dans `workspace/provider-cooldowns.json`, ce qui évite une rafale de requêtes après redémarrage.
- Le dashboard Autonomie affiche les étapes du cycle, les cibles testées, la limite de tentatives et les liens de Pull Request.
- Le vérificateur de dashboard valide les scripts inline de `dashboard.html` et `dashboard-autonomie.html`.
- Version package/API mise à jour en 6.4.0.

## Validation locale
- `npm run check` : réussi; syntaxe des modules serveur et scripts, plus les deux dashboards.
- `npm test` : 51 tests réussis, 0 échec.
- Tests ajoutés : validation des candidats dans une copie isolée, rejet d'un candidat cassé, choix de cible limité à l'allowlist, Pull Request brouillon simulée et refus si la source distante a changé, persistance du cooldown HTTP 429.

## Limites connues
- Aucune connexion réelle à GitHub, aucun appel fournisseur IA avec des clés réelles et aucun déploiement FadeHost n'ont été effectués pendant cette construction.
- La création de Pull Request exige `V6_AUTONOMOUS_PR_ENABLED=true` et les variables GitHub nécessaires. Les droits de dépôt doivent autoriser la création de branches, commits et Pull Requests.
- La Pull Request est créée en brouillon et n'est jamais fusionnée automatiquement. La production reste séparée de l'auto-développement.
- La boucle automatique ne modifie que les modules allowlistés; elle ne réécrit pas `index.js`, le dashboard, les dépendances ou les modules de gouvernance/sécurité.
- La vérification statique et le modèle de permissions Node réduisent les risques mais ne constituent pas un bac à sable de sécurité équivalent à une VM dédiée. Les candidats doivent rester limités et examinés avant fusion.
- Les quotas gratuits des fournisseurs peuvent bloquer le cycle; le cooldown persistant évite les appels répétés, mais ne crée pas de capacité supplémentaire.
