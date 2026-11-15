# Installation HACOO BOT V6.2.0 sur FadeHost

## Avant de commencer

- Arrête l’instance V5.
- Télécharge une copie de sauvegarde des fichiers V5 et du `data.json` actuel, ainsi que de `data.json.bak` s’il existe.
- Ne partage jamais le contenu des variables API ou du fichier `.env`.

## Transfert

1. Télécharge `HACOO-BOT-V6-6.2.0-VERITABLE.zip` et extrais-le localement.
2. Transfère le contenu du dossier du projet dans le répertoire applicatif FadeHost. Il doit y avoir `index.js`, `dashboard.html`, `package.json`, le dossier `lib/` et le dossier `test/` à la racine de l’application.
3. **Ne remplace pas le `data.json` V5** et conserve les sauvegardes. Le fichier de données sera chargé puis normalisé par le code V6.
4. Conserve les variables déjà configurées : `BOT_TOKEN`, `ADMIN_ID`, `CHANNEL_ID`, `DASHBOARD_PASSWORD` et les clés API. Les fournisseurs non configurés restent facultatifs.
5. Dans FadeHost, utilise Node.js 20 ou plus récent et définis la commande de démarrage `npm start`.
6. Dans la console si disponible, exécute dans cet ordre :

```bash
npm install
npm run check
npm test
npm start
```

## Après le démarrage

1. Vérifie que `/health` répond avec `ok: true`.
2. Ouvre le tableau de bord HTTPS et vérifie l’état V6 et les clés API (le tableau de bord affiche uniquement si une clé est configurée, jamais sa valeur).
3. Teste les API depuis le tableau de bord. Ce test envoie une courte requête et consomme potentiellement du quota.
4. Teste d’abord les publications programmées sur un canal privé. Le bot doit disposer des droits Telegram nécessaires.
5. Vérifie que le répertoire de données et `workspace/` sont persistants après un redémarrage FadeHost.

## Réglages recommandés au premier lancement

- `V6_AUTONOMY_ENABLED=true`
- `V6_AUTONOMY_INTERVAL_MINUTES=360`
- `V6_AUTONOMY_MAX_RUNS_PER_DAY=4`
- `V6_AUTONOMY_GENERATE_CANDIDATES=true` (consomme des appels API supplémentaires; mettre `false` pour ne générer que des propositions)
- `V6_MULTICHANNEL_ENABLED=false`
- `V6_AUTO_DEPLOY_ENABLED=false` au premier lancement.
   - `V6_AUTONOMOUS_ENGINEERING_ENABLED=false` pendant la validation initiale.
   - `V6_AUTONOMOUS_DEPLOY_SAFE=false` jusqu’à ce que staging, tests, health check et rollback aient été validés.
- `TZ=Europe/Paris` si l’heure du rapport quotidien doit suivre la France.

## Configurer le déploiement via GitHub et FadeHost

FadeHost déploie les applications à partir d’un dépôt GitHub et peut redéployer à chaque push sur la branche configurée. Configure d’abord une application de test/staging qui suit une branche dédiée, conformément à la documentation officielle FadeHost : https://fadehost.com/docs/app-hosting/.

1. Dans GitHub, crée un dépôt privé et une branche `staging`. Assure-toi que l’application FadeHost de test suit cette branche.
2. Crée un jeton GitHub à portée minimale, limité à ce dépôt, avec accès **Contents: read/write**. Ne colle jamais le jeton dans la conversation ni dans le code.
3. Ajoute les variables FadeHost suivantes dans les variables d’environnement de l’application :
   - `V6_GITHUB_TOKEN` : jeton du dépôt.
   - `V6_GITHUB_OWNER` : propriétaire ou organisation GitHub.
   - `V6_GITHUB_REPO` : nom du dépôt.
   - `V6_GITHUB_BRANCH=staging` : branche que l’application FadeHost suit réellement.
   - `V6_AUTO_DEPLOY_ENABLED=false` pendant la configuration et les premiers tests.
4. Redémarre l’application, ouvre le tableau de bord V6 et vérifie que l’état indique une configuration GitHub prête.
5. Génère ou sélectionne un candidat. Choisis un module **existant** et non critique sous `lib/` (un nouveau fichier non importé ne modifierait pas le comportement du bot), confirme la revue de sécurité et, pour un risque moyen/élevé, coche l’autorisation humaine.
6. Clique **Tester et pousser vers GitHub/FadeHost**. Le code candidat est appliqué à une copie temporaire du projet, puis la syntaxe et les tests sont exécutés. Si tout passe, le module est poussé sur la branche configurée. Le push doit déclencher le déploiement FadeHost si l’application suit bien cette branche.
7. Vérifie le déploiement et les logs dans FadeHost, puis contrôle `/health`. Le tableau de bord confirme le push GitHub, pas à lui seul la réussite du redémarrage FadeHost.
8. N’active `V6_AUTO_DEPLOY_ENABLED=true` qu’après validation du processus sur staging. Le bouton reste une action explicite; la génération autonome de candidats ne pousse pas automatiquement du code.

## Limites et protections

- Les cibles sont limitées à des fichiers `.js` sous `lib/`; `index.js`, le tableau de bord, `package.json`, la Constitution, les contrôleurs de sécurité et le gestionnaire de déploiement sont protégés.
- Le test exécute `node --test` dans une copie temporaire avec le candidat substitué à la cible et un environnement de variables épuré. Ce n’est pas une sandbox système; cela réduit l’exposition des secrets mais ne remplace pas une revue humaine, une isolation OS ni des tests de charge.
- Avant le push, la version précédente est enregistrée dans `workspace/releases/<id>/rollback.json`. Le tableau de bord propose une action explicite **Pousser le rollback** à partir de cet identifiant; le retour arrière n’est pas automatique.
- Le logiciel ne peut pas garantir que FadeHost a fini de démarrer ni effectuer un rollback runtime automatique à partir du seul succès du push. Vérifie l’état dans le panneau FadeHost.
- Le déploiement reste désactivé par défaut et échoue fermé si la configuration, les tests ou les validations requises manquent.


### Déploiement autonome à faible risque (optionnel, désactivé par défaut)

V6.3.0 expose `GET /api/v6/autonomy/deployment-status` et les routes `GET /api/v6/engineering/status`, `GET /api/v6/engineering/tasks`, `POST /api/v6/engineering/tasks`, ainsi que `/run` et `/cancel` par identifiant. N’active pas le traitement automatique directement sur la branche de production. Commence par un dépôt et une branche de staging reliés à FadeHost. Les variables nécessaires sont :

```env
V6_AUTO_DEPLOY_ENABLED=false
V6_AUTONOMOUS_DEPLOY_SAFE=false
V6_AUTONOMOUS_DEPLOY_ALLOWLIST=
```

Après validation en staging seulement, les deux interrupteurs peuvent être évalués et une liste exacte de modules auxiliaires `lib/*.js` peut être configurée. Ne mets jamais `index.js`, `dashboard.html`, `package.json`, `data.json`, `.env` ou les fichiers de gouvernance dans la liste. Le système sauvegarde le contenu GitHub antérieur avant le push et tente un rollback automatique si le contrôle HTTPS runtime obligatoire échoue. Cette tentative restaure le contenu vers GitHub, mais ne prouve pas que FadeHost a terminé le redéploiement; vérifie les logs et l’endpoint `/health/ready`. Conserve le `data.json` de production hors de toute opération de remplacement de code.


### Configuration agent d’ingénierie V6.3.0

L’agent accepte uniquement les modules auxiliaires `lib/*.js` non critiques et de moins de 10 Ko dans ce flux. Pour activer le traitement des tâches en attente après validation en staging, configure `V6_AUTONOMOUS_ENGINEERING_ENABLED=true`. Pour que le déploiement autonome puisse être tenté, les quatre conditions supplémentaires sont requises : `V6_AUTONOMOUS_DEPLOY_SAFE=true`, `V6_AUTO_DEPLOY_ENABLED=true`, une cible exacte dans `V6_AUTONOMOUS_DEPLOY_ALLOWLIST` et `V6_DEPLOY_HEALTH_URL=https://votre-domaine/health/ready`, plus les variables GitHub déjà décrites. Le endpoint `/health/ready` renvoie 503 tant qu’il ne constate pas une connexion Telegram récente.

Une tâche interrompue pendant une phase de déploiement est marquée `interrupted_needs_review`; elle n’est pas relancée automatiquement car l’état distant peut être incertain. Le mécanisme de test retire les secrets de l’environnement enfant mais ne constitue pas une sandbox OS inviolable.
