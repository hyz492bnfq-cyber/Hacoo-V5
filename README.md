# HACOO BOT V6 — livraison consolidée

Version 6.4.0 construite sur le code V5 fourni et durcie après audit du processus de déploiement. Cette livraison rassemble les fonctions de modération et de file persistante existantes, puis ajoute des services V6 testables. **Il s’agit d’une release candidate complète au niveau applicatif, pas d’une validation de production FadeHost** : les clés, droits Telegram, stockage persistant, HTTPS et comportement de l’hébergeur doivent encore être validés dans l’environnement réel.

## Fonctions conservées de V5

- Bot Telegram, modération et nettoyage des publications selon les règles configurées.
- Détection des doublons texte/image/album, groupes de photos et vérification des publications modifiées.
- File persistante, reprises et temporisation des erreurs, journal/historique, statistiques, sauvegarde/restauration.
- Tableau de bord protégé par mot de passe, contrôles d’origine, en-têtes de sécurité et limitation des requêtes.
- Correctif de pause : une tâche interrompue par pause/désactivation est différée, jamais marquée terminée par erreur.

## Fonctions V6 incluses

- **Constitution versionnée** et contrôleur d’actions : les propositions ne peuvent pas désactiver la constitution ni les contrôles de sécurité.
- **Cerveau de revue périodique** : boucle d’arrière-plan (intervalle par défaut de 6 h, 4 exécutions maximum/jour) qui examine uniquement des statistiques agrégées, enregistre une proposition et (par défaut, la génération de candidat est désactivée pour économiser le quota; active `V6_AUTONOMY_GENERATE_CANDIDATES=true` pour la demander) peut générer un module candidat isolé; aucun texte de publication, identifiant Telegram ou secret n’est envoyé par ce cycle.
- **Laboratoire de développement** : génération de modules candidats isolés, contrôle syntaxique et contrôle statique; les candidats ne sont pas exécutés automatiquement.
- **Déploiement FadeHost via GitHub (opt-in)** : le candidat est testé dans une copie temporaire, puis peut être poussé pour remplacer un module existant `lib/*.js` sur une branche GitHub suivie par FadeHost. Un contrôle de santé HTTPS est effectué après le push si configuré; le mode autonome exige cette URL et tente un rollback GitHub automatique si le contrôle échoue.
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

## CI GitHub et déploiement FadeHost contrôlé (V6.4.0)

Le fichier `.github/workflows/ci-fadehost.yml` exécute automatiquement `npm run check` et `npm test` sur les pushes et pull requests vers `main` et `staging`. Le déploiement depuis le workflow est **désactivé par défaut**. Pour le configurer depuis GitHub sans SSH, suis `AUTONOMIE_FADEHOST_CI.md` : secret `FADEHOST_TOKEN`, variables `FADEHOST_APP_ID`, `FADEHOST_HEALTH_URL`, puis variable `FADEHOST_AUTODEPLOY=true` après validation en staging. Si tu utilises ce workflow, désactive le redéploiement automatique sur push dans FadeHost pour éviter deux déploiements concurrents; le workflow déploiera le commit validé après les tests. Si le contrôle de santé échoue, le workflow échoue et demande de restaurer le dernier déploiement stable depuis l’onglet Deploys de FadeHost.

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


## Auto-développement, tests isolés et publication GitHub contrôlée (V6.4.0)

Le cycle autonome peut proposer une amélioration, sélectionner une cible uniquement dans une allowlist de modules non critiques disposant de tests ciblés, générer un candidat isolé, lancer les tests du module, transmettre les échecs au modèle pour une correction bornée (1 à 3 tentatives), puis créer une Pull Request GitHub en brouillon si cette option est activée. Les fichiers actifs ne sont pas remplacés par la génération. La fusion et le déploiement de production restent des étapes séparées et contrôlées; aucun accès arbitraire au dépôt ou au serveur n’est donné au modèle.

- `V6_AUTONOMOUS_DEPLOY_SAFE=false` : porte dédiée au déploiement autonome, désactivée par défaut.
- `V6_AUTO_DEPLOY_ENABLED=false` : porte existante du push GitHub, désactivée par défaut.
- `V6_AUTONOMOUS_DEPLOY_ALLOWLIST=` : liste explicite et séparée par des virgules de cibles `lib/*.js` autorisées. Les fichiers de gouvernance, `index.js`, le tableau de bord, les dépendances et les données sont interdits.
- `V6_DEPLOY_HEALTH_URL=` : URL publique HTTPS de santé, obligatoire pour autoriser le déploiement autonome; utiliser de préférence `/health/ready`.
- `V6_AUTONOMOUS_ENGINEERING_ENABLED=false` : active le traitement périodique des tâches d’ingénierie persistantes; laisser désactivé tant que le staging n’est pas validé.
- `V6_AUTONOMOUS_ENGINEERING_TARGET=` : cible optionnelle parmi les modules sûrs listés par l’API; si elle est vide, le modèle choisit parmi les cibles allowlistées qui possèdent un test ciblé et respectent la limite de taille.
- `V6_ENGINEERING_MAX_ATTEMPTS=2` : nombre borné de générations/corrections automatiques (1 à 3). Chaque candidat doit passer le contrôle statique et le test ciblé dans une copie isolée sans secrets ni `data.json`.
- `V6_ENGINEERING_TEST_TIMEOUT_MS=30000` : durée maximale du test ciblé, bornée côté serveur entre 5 et 60 secondes.
- `V6_AUTONOMOUS_PR_ENABLED=false` : si activé et si les identifiants GitHub disposent des droits nécessaires, publie une Pull Request en brouillon pour un candidat validé; aucune fusion automatique n’est faite.
- `V6_GITHUB_PR_BASE_BRANCH=main` : branche de base des Pull Requests autonomes, séparée de la branche éventuellement utilisée par FadeHost.
- `V6_DEPLOY_HEALTH_TIMEOUT_MS=4000`, `V6_DEPLOY_HEALTH_ATTEMPTS=6`, `V6_DEPLOY_HEALTH_INTERVAL_MS=5000` : paramètres bornés du contrôle runtime.
- État consultable via `GET /api/v6/autonomy/deployment-status`. L’agent d’ingénierie est piloté via `GET /api/v6/engineering/status`, `GET /api/v6/engineering/tasks`, `POST /api/v6/engineering/tasks`, et les routes `/run` et `/cancel` par identifiant.

Avant la création d’une Pull Request, le système compare le contenu distant à la source locale, crée une branche dédiée et un commit du seul module ciblé. Le PR est en brouillon et n’est jamais fusionné automatiquement. Avant un déploiement autorisé, le contrôleur vérifie la cible, applique une analyse statique restrictive, exécute les tests dans une copie temporaire avec un environnement réduit et crée une sauvegarde du contenu GitHub précédent. Le retour arrière automatique est tenté si le contrôle de santé échoue après le push lorsque l’option de contrôle runtime est exigée. Le contrôle doit pointer vers une route HTTPS qui ne répond 2xx que lorsque le bot est opérationnel. Le rollback confirme seulement que la restauration a été poussée vers GitHub; il ne garantit pas que FadeHost a fini de redémarrer après restauration.

**Recommandation :** laisser les deux variables à `false` tant que le dépôt/branche de staging, les tests sur FadeHost, la vérification runtime et la procédure de rollback n’ont pas été validés. N’ajoute à l’allowlist que des modules auxiliaires non critiques. La génération d’un candidat ne déclenche pas à elle seule le déploiement : une cible exacte autorisée et l’appel de déploiement sont requis. La modification autonome reste limitée aux modules auxiliaires de l’allowlist; les fichiers critiques et la gouvernance ne sont pas librement réécrits.

### Espace de pilotage autonome
Le panneau V6 comprend un centre de pilotage pour consulter l'état, demander un diagnostic, discuter avec le fournisseur IA configuré, mettre en pause/reprendre les cycles et consulter les événements récents. Les préférences de pause/chat sont conservées dans `workspace/autonomy-control.json`; ce fichier peut être recréé si absent.

Le chat est explicatif : il n'exécute pas de commandes libres, ne modifie pas directement le code et ne déploie pas. Les propositions/candidats restent séparés de la production. L'auto-diagnostic réduit certains risques mais ne garantit jamais zéro problème. Le déploiement autonome doit rester désactivé tant que les contrôles de test isolé, de santé runtime FadeHost et de rollback automatique ne sont pas validés dans un dépôt de staging. Ces mécanismes ne constituent pas une modification libre de tout fichier du projet.

## Supervision autonome et limites réelles

Le superviseur exécute périodiquement des contrôles locaux et répare seulement des problèmes déterministes sans toucher au code métier (par exemple recréer des dossiers de travail manquants et libérer un verrou de cycle autonome clairement périmé). Il consigne ses constats et ses réparations dans `workspace/supervisor-state.json` et le journal d'audit. Une file Telegram vieillissante est signalée, jamais renvoyée aveuglément, car l'issue d'un envoi peut être incertaine.

Le centre de pilotage propose pause/reprise, chat, journal de décisions et lancement manuel d'un diagnostic. Le chat explique et recommande, mais ne dispose pas d'une exécution de commandes arbitraires. Le laboratoire peut générer des candidats isolés; cela ne signifie pas que tout le code du projet peut être modifié sans risque.

Le déploiement autonome reste désactivé par défaut et, s'il est activé explicitement, limité aux modules `lib/*.js` non critiques listés exactement dans `V6_AUTONOMOUS_DEPLOY_ALLOWLIST`. Un push GitHub ne garantit pas que FadeHost a démarré correctement. La validation de santé du runtime et le rollback automatique sur échec doivent être testés dans l'environnement réel avant de compter dessus. Aucun logiciel ne peut garantir zéro panne ou une auto-réparation parfaite.


## Agent d’auto-développement contrôlé (V6.4.0)

Le centre de pilotage comprend un registre persistant de tâches d’ingénierie. En mode automatique, la revue choisit une cible dans une liste stricte de modules testés; l’agent génère un candidat isolé, exécute le test ciblé dans une copie temporaire, transmet un échec à une nouvelle tentative (jusqu’à trois), puis peut créer une Pull Request GitHub en brouillon. Une tâche conserve l’empreinte du fichier source et refuse de continuer si le fichier local ou distant a changé. Les modules à accès fichier sont exécutés uniquement dans la copie isolée et ne sont pas autorisés au déploiement autonome.

Le déploiement automatique depuis une tâche n’est tenté que si `V6_AUTONOMOUS_ENGINEERING_ENABLED=true`, `V6_AUTONOMOUS_DEPLOY_SAFE=true`, `V6_AUTO_DEPLOY_ENABLED=true`, une cible exacte est présente dans `V6_AUTONOMOUS_DEPLOY_ALLOWLIST`, les paramètres GitHub sont configurés et une URL HTTPS publique de santé est définie dans `V6_DEPLOY_HEALTH_URL` (recommandé : endpoint public `/health/ready`, qui vérifie aussi une connexion Telegram récente). Les tests pré-déploiement et le contrôle runtime sont requis.

**Limites importantes :** les candidats sont limités à sept modules `lib/*.js` non critiques de moins de 10 Ko qui disposent de tests ciblés. Les contrôles statiques et le modèle de permissions Node réduisent le risque mais ne constituent pas un sandbox OS inviolable. Le modèle ne peut pas modifier librement `index.js`, le dashboard, les dépendances, les secrets ou les données de production via ce mécanisme. Le push GitHub déclenche FadeHost seulement si le dépôt est relié à l’hébergeur; l’URL de santé doit vérifier une vraie fonction de santé. Les clés et l’accès à la production ne sont pas fournis dans cette archive et aucun déploiement de production n’est prétendu.
