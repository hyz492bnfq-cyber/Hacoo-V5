## 6.4.0 — Auto-développement itératif, tests isolés et Pull Requests brouillon

- Le moteur choisit une cible uniquement dans une allowlist de modules non critiques disposant de tests ciblés.
- Les candidats passent les contrôles statiques puis les tests ciblés dans une copie temporaire du dépôt, sans `.env`, `data.json`, workspace ni `node_modules`.
- La génération peut corriger un candidat après un échec, avec 1 à 3 tentatives bornées et une limite de temps.
- Les tâches répétitivement bloquées sont refroidies pendant 24 heures pour réduire les appels IA inutiles.
- Option de création de Pull Request GitHub en brouillon; aucune fusion automatique.
- Les cooldowns fournisseur après HTTP 429 sont persistés sur disque afin qu’un redémarrage ne relance pas immédiatement les appels.
- Aucun code actif ni déploiement de production n’est modifié par la génération du candidat.

## 6.3.1 — CI GitHub et déploiement FadeHost après validation
- Ajout d’un workflow GitHub Actions qui vérifie la syntaxe serveur/modules/scripts et exécute la suite de tests sur les pushes et pull requests vers `main` et `staging`.
- Ajout de `scripts/check-dashboard.js` : la commande `npm run check` valide désormais aussi la syntaxe JavaScript inline du dashboard.
- Ajout d’un déploiement FadeHost optionnel après validation CI, désactivé par défaut et conditionné à une variable GitHub explicite, un secret FadeHost et une URL de santé HTTPS.
- Le workflow vérifie la santé après déploiement et échoue de façon visible si elle n’est pas confirmée. Il n’appelle pas d’API de rollback non documentée; le rollback de déploiement complet reste à lancer depuis l’historique FadeHost si le workflow échoue.
- Ajout de `AUTONOMIE_FADEHOST_CI.md` avec la configuration depuis les interfaces GitHub et FadeHost.
- Validation locale : `npm run check` réussi; `npm test` : 44 tests réussis, 0 échec.
- Aucun accès au dépôt GitHub ou à FadeHost n’a été utilisé et aucun déploiement réel n’a été effectué pendant cette construction.

# Changelog

## 6.2.3 — Vérification runtime et rollback automatique contrôlé
- Ajout d’un contrôle de santé runtime HTTPS après push GitHub, avec nombre de tentatives, délai et timeout configurables.
- Le déploiement autonome est maintenant bloqué tant que `V6_DEPLOY_HEALTH_URL` n’est pas une URL HTTPS valide.
- Si un déploiement autonome est poussé mais que le service ne répond pas sainement, HACOO tente de repousser automatiquement le contenu précédent vers GitHub et journalise le résultat du rollback.
- L’état du rollback est persisté dans le dossier de release et dans le journal d’audit.
- Tests ajoutés pour la validation d’URL, la santé runtime positive/négative et le blocage sans configuration de santé.
- Validation locale : `npm test` (38 tests) et `npm run check` réussis.
- Limites : le rollback dépend de GitHub accessible et de FadeHost connecté à la branche. Aucun test de production FadeHost n’a été exécuté depuis cette session. La modification autonome reste limitée aux modules auxiliaires explicitement autorisés; elle ne réécrit pas librement les fichiers critiques ou les règles de sécurité.

## 6.0.0 — livraison consolidée
- Consolidation du bot V5 et des modules de gouvernance/autonomie V6.
- Cycle périodique de revue autonome et génération facultative de candidats isolés.
- Diagnostic préventif, politique adaptative en mode recommandation, mémoire explicable et commandes en liste blanche.
- Contrôle qualité éditorial, proposition de reformulation sans publication automatique et publications texte programmées avec reprise prudente.
- Rapport quotidien agrégé, architecture multicanale désactivée par défaut, inspection de releases candidates.
- Activation de code de production laissée bloquée tant qu’un adaptateur de déploiement spécifique à l’hébergeur n’a pas été implémenté et validé.


## 6.1.0 — adaptateur de déploiement FadeHost/GitHub
- Ajout d’un adaptateur GitHub Contents API : un candidat testé peut être poussé vers un fichier `lib/*.js` d’une branche configurée; un push peut déclencher le déploiement FadeHost si l’application suit cette branche.
- Exécution de la syntaxe et de la suite de tests dans une copie temporaire isolée où le candidat remplace la cible.
- Sauvegarde du contenu précédent avant le push, journal d’audit et action explicite de rollback vers GitHub. Aucun rollback automatique basé sur la santé runtime n’est revendiqué.
- Contrôles fail-closed, confirmation de revue de sécurité, approbation humaine pour les risques moyens/élevés, cibles de gouvernance et fichiers critiques protégés.
- Le push vers GitHub peut être testé sur une branche de staging. Le succès du push ne prouve pas à lui seul que FadeHost a terminé le démarrage; vérifier les déploiements et `/health` dans le panneau.


## 6.2.0 — durcissement après audit
- Revue des risques liés au test des candidats générés : le processus de test reçoit désormais un environnement minimal sans les secrets FadeHost/API hérités du bot.
- Refus des liens symboliques pour les fichiers candidats et les cibles locales de déploiement.
- Extension des contrôles statiques contre l’importation dynamique, l’accès au processus et aux API système/réseau.
- Statut V6/health enrichi pour distinguer la disponibilité HTTP de la dernière confirmation Telegram.
- Calcul cohérent des dates quotidiennes selon le fuseau local du processus (par exemple Europe/Paris) pour l’autonomie et le rapport quotidien.
- Le contrôle de déploiement reste protégé; aucune réussite runtime FadeHost n’est déduite d’un simple push GitHub.


## Correctifs de maintenance — mise en forme et interface IA

- La mise en forme des publications remplace les anciennes lignes explicitement promotionnelles au lieu d'empiler les codes promo; les références, couleurs et tailles sans contexte promotionnel sont conservées.
- Nettoyage des marqueurs décoratifs en bordure du titre, puis réapplication du préfixe/suffixe configuré. Les autres emojis et informations dans le corps sont préservés.
- Vérification manuelle de l'idempotence : appliquer deux fois le format ne rajoute pas de lignes ni de marqueurs supplémentaires.
- Refonte de la zone IA autonome dans le dashboard : explication des cycles, limites quotidiennes, fréquence, génération de candidats et garde-fous de sécurité; statut plus lisible avec dernière/prochaine exécution.
- Le bouton Telegram `/start` utilise `DASHBOARD_URL` depuis l'environnement au lieu d'une URL codée en dur.
- Validation : syntaxe JavaScript contrôlée et 28 tests automatisés réussis.


## V6.2.1 — refonte mobile-first du tableau de bord

- Refonte visuelle de l’interface : hiérarchie plus nette, contrastes, espacements, cartes et contrôles tactiles cohérents.
- Navigation mobile fixe en bas avec quatre accès principaux (Accueil, Doublons, Modération, Historique) et menu « Plus » pour les pages secondaires.
- Nouveau menu mobile accessible, refermable par bouton, touche Échap ou toucher l’arrière-plan.
- Ajustements iPhone : zones de sécurité, hauteur dynamique, boutons de 44 px minimum, formulaires sur une colonne, tableaux défilants horizontalement et prise en charge de la réduction des animations.
- Les pages et API existantes sont conservées ; aucun nouveau bouton métier factice n’a été ajouté.
- Validation : `npm run check`, `npm test` (28 tests réussis) et contrôle de syntaxe du JavaScript intégré au tableau de bord.


## V6.2.1 — préparation du niveau 3 d’autonomie contrôlée

- Ajout d’une porte de déploiement autonome à faible risque, désactivée par défaut et limitée à une allowlist exacte de modules auxiliaires `lib/*.js`.
- Ajout d’un contrôle statique bloquant pour les accès aux secrets, aux API système/réseau, à l’exécution dynamique et aux écritures/suppressions de fichiers dans le code candidat.
- Ajout des endpoints `GET /api/v6/autonomy/deployment-status` et `POST /api/v6/autonomy/deploy-candidate`.
- Exécution de la suite existante dans une copie temporaire à environnement réduit, sauvegarde du contenu GitHub antérieur avant push, et journalisation des décisions.
- Ajout de tests ciblés et documentation des variables `V6_AUTONOMOUS_DEPLOY_SAFE` et `V6_AUTONOMOUS_DEPLOY_ALLOWLIST`.
- Limites explicites : l’activation autonome n’est pas déclenchée directement par chaque revue IA; le push GitHub n’est pas une confirmation de santé runtime FadeHost; le rollback reste manuel. Ne pas activer en production avant d’avoir ajouté/validé les contrôles de santé et le rollback runtime automatique.

## V6.2.1 — Espace de pilotage autonome (préparation)
- Ajout d'un centre de pilotage avec pause/reprise persistante de l'autonomie, activation/désactivation du chat, état courant et journal des événements.
- Ajout d'un chat IA de diagnostic qui reçoit l'état résumé et les événements récents; le chat ne peut pas directement modifier le code ni déployer.
- Ajout d'API protégées par l'authentification du tableau de bord pour les commandes, la conversation et la consultation du journal.
- Les commandes sont journalisées. La pause est enregistrée dans `workspace/autonomy-control.json`.
- Limite explicite : l'auto-diagnostic ne garantit pas zéro incident; le déploiement autonome général et le rollback runtime automatique ne sont pas activés/achevés. Le déploiement reste fail-closed et limité à l'allowlist configurée.

## V6.2.1 — supervision renforcée
- Ajout d'un superviseur autonome périodique avec contrôles des répertoires, des fichiers d'état, des verrous périmés et de l'âge de la file.
- Réparations automatiques limitées à des opérations locales déterministes; aucune réexécution aveugle de publications et aucune modification libre du code.
- Ajout des routes protégées du centre de pilotage pour pause/reprise, journal, chat, état de déploiement et diagnostic du superviseur.
- Le déploiement autonome demeure désactivé par défaut et doit être validé en staging avant toute utilisation réelle.


## 6.3.0 — Agent d’ingénierie persistant et tableau de bord

- Ajout d’un registre atomique de tâches de développement autonomes avec états, empreinte source, étapes, résultat et audit.
- Ajout de génération de candidat pour modules auxiliaires, contrôles syntaxiques/statistiques et refus en cas de dérive de la source.
- Ajout des API d’ingénierie et du panneau dashboard pour créer, exécuter et suivre les tâches.
- Ajout d’une porte de déploiement nécessitant le mode autonome sûr, une allowlist, les paramètres GitHub et le contrôle de santé HTTPS.
- Augmentation de la limite de tokens de sortie du fournisseur pour les tâches de code (plafond 6000).
- Aucun secret ni donnée de production inclus dans l’archive.
- Limites connues : modifications automatiques restreintes aux modules auxiliaires autorisés; les tests et le rollback doivent être validés sur FadeHost; les contrôles locaux ne garantissent pas l’absence de bogues.
