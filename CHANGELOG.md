# Journal des versions

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
