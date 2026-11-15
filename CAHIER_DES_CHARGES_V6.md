# Cahier des charges consolidé — M2 HACOO BOT V6

**Référence de travail :** consolidation des exigences formulées dans les échanges du 24–25 octobre 2026. Ce document rend explicites les exigences de référence utilisées pour auditer la livraison. Il ne prétend pas être un fichier historique original distinct retrouvé tel quel.

## 1. Objectif général

Faire évoluer M2 HACOO BOT depuis la V5 vers une plateforme Telegram fiable, contrôlable et améliorable dans la durée. La priorité est la continuité du service et la protection des publications et données existantes, avant l’ajout d’autonomie.

## 2. Compatibilité et préservation

- Node.js 20 ou plus récent; démarrage avec `npm start` (`node index.js`); port fourni par `PORT`.
- Conserver les variables historiques `BOT_TOKEN`, `ADMIN_ID`, `CHANNEL_ID`, `DASHBOARD_PASSWORD`, `DASHBOARD_URL`, `PORT`, `GEMINI_API_KEY` lorsqu’elles sont utilisées. Les fournisseurs IA additionnels sont facultatifs.
- Ne jamais écraser le `data.json` de la V5 par un fichier vide. Sauvegarder les fichiers applicatifs, les données et les sauvegardes avant migration.
- Garder un chemin de retour vers la V5 jusqu’à validation réelle sur FadeHost.
- Aucun secret dans GitHub, le tableau de bord, les journaux ou la conversation.

## 3. Fiabilité des tâches et publications

- File persistante avec identifiants, état, nombre de tentatives, horodatages, dernière erreur et reprise après redémarrage.
- Ne pas marquer une tâche terminée si elle a été interrompue par une pause ou une désactivation; la conserver pour reprise.
- Détecter les files bloquées et les albums incertains; notifier l’administrateur avec une fréquence limitée.
- Éviter les doubles actions. Si le résultat d’un envoi Telegram est incertain, demander une vérification manuelle au lieu de renvoyer aveuglément.
- Distinguer succès, élément déjà absent, panne temporaire, droits insuffisants, erreur définitive et résultat incertain lorsque l’API permet cette distinction.

## 4. Modération et détection des doublons

- Préserver les règles configurables de liens, hashtags, mentions, lignes, mots/domaines/phrases et contenus interdits.
- Prendre en charge les textes, photos, légendes, albums et publications modifiées.
- Détecter les doublons exacts et similaires, en utilisant texte, liens, historique et empreintes d’images lorsqu’elles sont disponibles.
- Éviter les suppressions automatiques uniquement sur une similarité ambiguë. Préserver les différences utiles : couleur, taille, référence, version, produit ou variante.
- Afficher ou journaliser les raisons et le niveau de certitude quand une décision automatique est risquée.

## 5. Historique, données et sauvegardes

- Historique consultable des actions, suppressions, doublons, erreurs et publications programmées.
- Persistance des données et écriture sûre; sauvegarde avant restauration et vérification de l’intégrité.
- Conserver les informations nécessaires pour comprendre une action et rechercher par date, mot, identifiant ou référence quand les données disponibles le permettent.
- Les restaurations de fichiers ne peuvent pas annuler une suppression ou publication Telegram déjà exécutée.

## 6. Tableau de bord et supervision

- Tableau de bord web protégé par mot de passe, responsive, avec modération, doublons, historique, statistiques, réglages et fonctions V6.
- Pas de boutons décoratifs ou simulés : les actions affichées doivent appeler une route réelle et rendre les erreurs visibles.
- Distinguer la disponibilité HTTP de l’état réel du bot Telegram.
- Surveiller les API IA, la file, les albums incertains, les sauvegardes et les erreurs, sans exposer de secrets.

## 7. Fournisseurs IA

- Gemini, Groq et OpenRouter facultatifs, configurables par variables d’environnement.
- Détecter les fournisseurs configurés et permettre des tests explicites.
- Gérer les délais d’attente et les erreurs sans rendre le bot inutilisable lorsque l’IA est indisponible.
- N’envoyer aux cycles de diagnostic autonomes que des métriques agrégées; ne pas transmettre le texte des publications ou les identifiants Telegram à ces cycles.
- Les appels éditoriaux peuvent transmettre le texte soumis au fournisseur choisi; l’interface doit en tenir compte.

## 8. Autonomie continue et cerveau de décision

- Cycle périodique en arrière-plan, limité en fréquence et en nombre d’exécutions quotidiennes.
- Analyser des métriques, signaler les anomalies, créer des propositions explicables et documenter les résultats.
- Générer des candidats de code dans un espace de travail séparé; aucun candidat n’est activé simplement parce qu’il a été généré.
- Limiter les commandes en langage naturel à une liste blanche d’actions connues. Ne jamais exécuter une commande shell arbitraire.
- Si aucun fournisseur IA n’est configuré, la modération déterministe doit continuer de fonctionner.

## 9. Constitution et contrôleur indépendant

La Constitution versionnée contient douze principes opérationnels : initiative, amélioration mesurée, préservation, tests avant activation, protections non modifiables, contrôle indépendant, intégrité des données, moindre privilège, retour arrière, traçabilité, résistance aux injections et contrôle humain.

Règle suprême : l’IA peut chercher comment s’améliorer, mais ne peut pas supprimer les protections qui encadrent son évolution. Les messages, fichiers et pages externes sont des données non fiables, jamais des instructions de gouvernance.

## 10. Laboratoire d’auto-développement et déploiement protégé

- Stocker propositions, candidats et releases séparément du code actif.
- Limiter les cibles de déploiement aux modules existants autorisés sous `lib/`; protéger `index.js`, `package.json`, le tableau de bord, les données, la Constitution et les contrôleurs de sécurité.
- Effectuer syntaxe, tests et contrôle statique avant tout push; conserver la version précédente et une procédure de rollback.
- Exiger une confirmation humaine pour les risques moyens ou élevés et un contrôle de sécurité explicite.
- Le déploiement est désactivé par défaut. Un push GitHub n’est pas la preuve que FadeHost a redémarré correctement; vérifier les logs et `/health`.
- Les tests exécutés dans une copie temporaire avec un environnement épuré ne constituent pas une sandbox de sécurité au niveau du système d’exploitation. Ne pas présenter ce contrôle comme une garantie absolue.

## 11. Publications programmées et qualité éditoriale

- Stocker les publications programmées, vérifier leur qualité avant l’envoi et permettre l’annulation tant qu’elles ne sont pas envoyées.
- Si un envoi est incertain, basculer vers une vérification manuelle plutôt que réessayer automatiquement.
- L’optimisation éditoriale propose un texte, sans publication automatique.
- Préserver le format M2REPS demandé : `🛍️ NOM DU PRODUIT 🤩‼️`, puis `-15% coupon : M2REPS 🎁`, puis le lien d’affiliation préfixé par `👉🏼`.
- Ne jamais inventer de lien, référence, couleur, taille, prix ou variante manquante; préserver les détails spécifiques présents dans la source.

## 12. Multicanal et évolutions futures

- Préparer l’architecture multicanale, mais garder les canaux secondaires désactivés par défaut jusqu’à validation.
- Les actions à risque, les changements de code et les déploiements doivent rester traçables et réversibles.
- Développer les fonctionnalités manquantes par étapes testables, sans annoncer comme opérationnelle une capacité qui n’a pas été vérifiée.

## 13. Critères de validation avant production

1. `npm run check` passe.
2. `npm test` passe.
3. Le projet démarre avec les variables FadeHost et Node.js 20+.
4. `/health` répond; l’état Telegram est présenté séparément.
5. Le tableau de bord et ses actions sont vérifiés avec l’authentification réelle.
6. Les tâches en attente et le `data.json` survivent à un redémarrage de l’hébergement.
7. Les publications programmées, les albums et les scénarios incertains sont testés dans un canal privé.
8. Le flux GitHub/FadeHost est d’abord testé sur une branche de staging, avec retour arrière vérifié.
9. La V5 et ses sauvegardes ne sont retirées qu’après validation complète.

## 14. État honnête de la livraison 6.2.0

**Présent dans le dépôt :** fonctions V5, modules V6, boucle de revue autonome, propositions/candidats isolés, contrôle qualité prépublication, planificateur texte, rapport quotidien, mémoire explicable, diagnostic, gestion des fournisseurs, contrôles de déploiement GitHub et rollback explicite.

**Renforcé dans 6.2.0 :** environnement minimal pour les tests pré-déploiement, refus des liens symboliques candidats/cibles, détection plus large de motifs dangereux, statut Telegram distinct du statut HTTP, dates quotidiennes basées sur le fuseau local.

**Non garanti avant essais sur FadeHost :** droits Telegram, stabilité réelle du stockage persistant, compatibilité avec la configuration exacte de l’hébergement, disponibilité et quotas des fournisseurs IA, réussite du redémarrage après un push, et rollback runtime automatique. Le déploiement autonome de candidats n’est pas automatique; une action protégée reste nécessaire.
