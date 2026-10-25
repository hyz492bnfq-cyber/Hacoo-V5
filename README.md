# HACOO BOT V6 — livraison consolidée

Version 6.2.0 construite sur le code V5 fourni et durcie après audit du processus de déploiement. Cette livraison rassemble les fonctions de modération et de file persistante existantes, puis ajoute des services V6 testables. **Il s’agit d’une release candidate complète au niveau applicatif, pas d’une validation de production FadeHost** : les clés, droits Telegram, stockage persistant, HTTPS et comportement de l’hébergeur doivent encore être validés dans l’environnement réel.

## Fonctions conservées de V5

- Bot Telegram, modération et nettoyage des publications selon les règles configurées.
- Détection des doublons texte/image/album, groupes de photos et vérification des publications modifiées.
- File persistante, reprises et temporisation des erreurs, journal/historique, statistiques, sauvegarde/restauration.
- Tableau de bord protégé par mot de passe, contrôles d’origine, en-têtes de sécurité et limitation des requêtes.
- Correctif de pause : une tâche interrompue par pause/désactivation est différée, jamais marquée terminée par erreur.

## Fonctions V6 incluses

- **Constitution versionnée** et contrôleur d’actions : les propositions ne peuvent pas désactiver la constitution ni les contrôles de sécurité.
- **Cerveau de revue périodique** : boucle d’arrière-plan (intervalle par défaut de 6 h, 4 exécutions maximum/jour) qui examine uniquement des statistiques agrégées, enregistre une proposition et (sauf si `V6_AUTONOMY_GENERATE_CANDIDATES=false`) tente de générer un module candidat isolé; aucun texte de publication, identifiant Telegram ou secret n’est envoyé par ce cycle.
- **Laboratoire de développement** : génération de modules candidats isolés, contrôle syntaxique et contrôle statique; les candidats ne sont pas exécutés automatiquement.
- **Déploiement FadeHost via GitHub (opt-in)** : le candidat est testé dans une copie temporaire, puis peut être poussé pour remplacer un module existant `lib/*.js` sur une branche GitHub suivie par FadeHost. L’état du déploiement runtime doit être vérifié dans FadeHost; le rollback est une action explicite.
- **Gestion des fournisseurs** : Gemini, Groq et OpenRouter; état et test explicite des API.
- **Diagnostic préventif** : signaux de file bloquée, tâches en revue manuelle, album incertain et volume d’erreurs.
- **Politique adaptative** : recommande des changements de seuils mais ne les applique pas sans tests.
- **Contrôle qualité prépublication** : texte vide/trop long, mots et phrases bloqués, doublons exacts récents, alertes de liens nombreux.
- **Publications programmées texte** : stockage persistant, contrôle qualité, canal autorisé, annulation avant envoi; au plus une tentative par cycle. Un résultat d’envoi incertain devient `uncertain` et n’est jamais renvoyé automatiquement.
- **Rapport quotidien** à l’administrateur avec métriques agrégées et analyse IA facultative.
- **Mémoire explicable** : règles ajoutées par l’administrateur avec justification.
- **Commandes en langage naturel limitées** à une liste blanche d’actions; aucune commande shell ou instruction arbitraire n’est exécutée.
- **Optimisation éditoriale** : propose une reformulation mais ne publie jamais automatiquement.
- **Architecture multicanale préparée**; l’activation des canaux secondaires reste désactivée par défaut.

## Variables FadeHost

Obligatoires : `BOT_TOKEN`, `ADMIN_ID`, `CHANNEL_ID`, `DASHBOARD_PASSWORD`.

IA optionnelles : `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`. Modèles configurables : `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GROQ_MODEL`, `OPENROUTER_MODEL`. Les noms et les modèles peuvent changer côté fournisseur; le test API ne garantit ni quotas ni disponibilité future.

V6 : `V6_AUTONOMY_ENABLED`, `V6_AUTONOMY_INTERVAL_MINUTES`, `V6_AUTONOMY_MAX_RUNS_PER_DAY`, `V6_AUTONOMY_GENERATE_CANDIDATES`, `V6_SELF_DEVELOPMENT_ENABLED`, `V6_DAILY_REPORT_ENABLED`, `V6_DAILY_REPORT_HOUR`, `V6_MULTICHANNEL_ENABLED`, `V6_CHANNELS_JSON`, `V6_AUTO_DEPLOY_ENABLED`, `V6_DEPLOY_ADAPTER`, `V6_GITHUB_TOKEN`, `V6_GITHUB_OWNER`, `V6_GITHUB_REPO`, `V6_GITHUB_BRANCH`.

- `V6_CHANNELS_JSON` est un tableau JSON d’objets `{ "id": "-100123", "name": "Canal secondaire", "enabled": true }`.
- `V6_MULTICHANNEL_ENABLED=false` par défaut : seul `CHANNEL_ID` est actif.
- `V6_AUTO_DEPLOY_ENABLED=false` par défaut. N’active ce réglage qu’après configuration GitHub/FadeHost et validation sur une branche de staging; il autorise l’action de push du tableau de bord, pas la publication autonome automatique de tous les candidats.
- Ne jamais mettre les clés dans le dépôt, les fichiers HTML ou le chat. Utiliser uniquement les variables d’environnement FadeHost.

## Installation prudente

Le cahier de référence est fourni dans `CAHIER_DES_CHARGES_V6.md`; le bilan des vérifications de cette livraison est dans `AUDIT_V6.2.0.md`.

1. Arrêter V5.
2. Télécharger une sauvegarde des fichiers applicatifs, `data.json` et de ses `.bak`.
3. Extraire cette archive et transférer les fichiers du projet dans le dossier de l’application. Conserver le `data.json` existant; ne pas écraser les données par un fichier vide.
4. Vérifier les variables dans FadeHost, et que le stockage utilisé par `DATA_FILE` est persistant.
5. Dans la console : `npm install`, `npm run check`, `npm test`, puis `npm start`. Définis `TZ=Europe/Paris` si tu veux que l’heure du rapport quotidien suive le fuseau français; sinon l’heure suit le fuseau du processus.
6. Vérifier les logs, `/health`, le tableau de bord, les API et les permissions du bot Telegram. Tester d’abord sur un canal privé de test.
7. Ne pas supprimer la sauvegarde V5 tant que les tests de production ne sont pas terminés.

## Contrôle local de cette archive

- `npm run check` : syntaxe JavaScript de l’application et des modules.
- `npm test` : tests unitaires de politiques, file, fournisseurs, planification, mémoire, commandes, sécurité des candidats et diagnostics.
- Les 28 tests unitaires de cette archive passent dans l’environnement de génération. Ils ne valident pas à eux seuls les API réelles ni le fonctionnement de FadeHost. Les tests n’appellent pas les API réelles et ne valident pas les droits Telegram, les clés FadeHost, l’HTTPS, le stockage persistant ou la compatibilité exacte de l’environnement d’hébergement.

## Limites de sécurité non négociables

- La restauration du code ne peut pas annuler un effet externe déjà réalisé (publication/suppression Telegram).
- L’état `sending` d’une publication programmée après arrêt devient `uncertain`; l’administrateur doit vérifier le canal avant toute action.
- Le laboratoire de génération n’exécute pas le candidat. Le déploiement exécute la suite de tests dans une copie temporaire avec un environnement de variables épuré; ce n’est pas une sandbox système et une revue humaine reste nécessaire.
- Le système ne pousse pas automatiquement les candidats générés par le cycle autonome. Le déploiement est une action protégée explicite; aucun succès du push n’est présenté comme preuve de santé runtime FadeHost.
- Les clés API configurées peuvent consommer des quotas et envoyer le texte saisi dans les fonctions éditoriales au fournisseur choisi. Les cycles de diagnostic n’envoient que des compteurs agrégés.


## Déploiement FadeHost protégé (V6.2.0)

L’adaptateur optionnel `lib/fadehost-deployer.js` teste un candidat dans une copie temporaire avec un environnement de variables épuré, sauvegarde le contenu précédent, puis pousse le fichier cible vers GitHub. Cette copie de test n’est pas une sandbox de sécurité au niveau du système d’exploitation; une revue humaine reste nécessaire. FadeHost doit être configuré pour déployer la même branche. Voir `INSTALLATION_FADEHOST.md` avant d’activer le déploiement. Par défaut, `V6_AUTO_DEPLOY_ENABLED=false`; les secrets GitHub doivent être configurés uniquement dans les variables d’environnement de l’hébergeur. Le succès d’un push ne garantit pas à lui seul que le processus FadeHost a redémarré correctement.
