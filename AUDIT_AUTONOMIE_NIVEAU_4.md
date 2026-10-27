# Audit HACOO BOT — CI et autonomie de niveau 4

Date de l’audit : 27 octobre 2026  
Dépôt : `hyz492bnfq-cyber/Hacoo-V5`  
Branche auditée : `main`  
Commit audité : `de13f47371e22b2c31a936dffbd3ce5f4d096b94`  
Version annoncée et présente : `6.4.0`

## Audit initial

### Dépôt, runtime et données

- `package.json` indique la version `6.4.0`, un démarrage `npm start` (`node index.js`) et Node.js `>=20.0.0`.
- Il n’y avait ni `package-lock.json` ni `npm-shrinkwrap.json`; l’installation de CI utilisait donc `npm install`, non reproductible.
- Le bot utilise `sharp` `^0.33.5` pour le traitement et le hachage des images. Cette plage inclut des versions signalées par `npm audit` comme vulnérables; `sharp` `0.35.5` demande Node.js `>=20.9.0`.
- `data.json` n’est pas dans l’arbre Git et est ignoré, avec ses sauvegardes. Cela protège les données du dépôt, mais ne prouve pas que le stockage FadeHost est persistant.
- `index.js` charge `DATA_FILE` (par défaut `data.json`), effectue des écritures atomiques et conserve une sauvegarde `.bak`. Le comportement réel du volume FadeHost n’a pas été vérifié.
- Les routes du dashboard arrivent après le middleware d’authentification. `/health` et `/health/ready` sont publics. `/health/ready` vérifie notamment une connexion Telegram récente; `/health` confirme surtout que le processus n’est pas en arrêt.
- La version Node réellement configurée sur l’application, sa commande FadeHost, ses variables d’environnement, les logs, les droits Telegram et les sauvegardes n’étaient pas accessibles depuis cette conversation.

### CI, GitHub et FadeHost

- Le workflow existant exécutait la syntaxe et les tests, mais n’installait pas depuis un lockfile et ne lançait pas d’audit de dépendances.
- Il attendait `vars.FADEHOST_APP_ID`. L’API GitHub expose seulement les noms des deux secrets Actions `FADEHOST_APP` et `FADEHOST_TOKEN`; aucune variable Actions n’est configurée. Aucune valeur de secret n’a été lue.
- Sur le dernier run observé pour `main`, la validation a réussi et le job FadeHost a été ignoré. Aucun PR n’était ouvert au moment de l’audit.
- Toutes les branches observées, dont `main`, étaient signalées comme non protégées. La route GitHub de protection de `main` a répondu HTTP 403 en indiquant que cette fonction exige GitHub Pro ou un dépôt public. Le dépôt est resté privé et aucune règle n’a été changée.
- La documentation officielle FadeHost indique que `fadehost apps deploy <app>` récupère le dernier commit de la branche. Aucune option documentée ne permet d’épingler le SHA validé. Une vérification de branche avant la commande laisse une course possible entre le contrôle et le déploiement.
- Aucun connecteur FadeHost n’était disponible ici; les paramètres de l’application, son statut, les logs, l’auto-déploiement, l’endpoint de santé et la procédure de rollback n’ont pas été vérifiés.

### Autonomie

- Dans `.env.example`, `V6_AUTONOMOUS_ENGINEERING_ENABLED`, `V6_AUTONOMOUS_PR_ENABLED`, `V6_AUTONOMOUS_DEPLOY_SAFE` et `V6_AUTO_DEPLOY_ENABLED` sont à `false`.
- Malgré ces valeurs d’exemple, le code de l’agent d’ingénierie possédait un chemin direct vers `deployCandidate` si plusieurs portes runtime étaient activées et si la création de PR était désactivée. La configuration réelle FadeHost n’étant pas accessible, ces valeurs runtime ne pouvaient pas être confirmées.
- La génération et les tests de candidats étaient présents; la création de PR brouillon était facultative; la fusion automatique n’était pas implémentée dans ce chemin.

## Changements préparés

- Ajout d’un lockfile npm et mise à jour de `sharp` vers `^0.35.5`; minimum Node relevé à `>=20.9.0`.
- CI mise en installation `npm ci`, audit `npm audit --audit-level=high`, contrôle de configuration et fichiers, vérification JavaScript et suite de tests.
- Le workflow ne contient plus d’appel de déploiement FadeHost. Si `FADEHOST_AUTODEPLOY=true` est activé sur un push vers `main`, il échoue explicitement au lieu de publier une branche non épinglée.
- L’agent d’ingénierie est limité aux candidats et aux PR brouillon; le déploiement autonome reste verrouillé même si les anciennes portes sont forcées à `true`.
- Ajout de contrôles pour les fichiers requis, les variables obligatoires documentées, l’exclusion de `.env`/`data.json` et le maintien des portes d’autonomie à `false`.
- Ajout de tests de compatibilité du traitement d’image `sharp`, de verrouillage du déploiement autonome et de la politique CI.
- Mise à jour de `README.md` et `AUTONOMIE_FADEHOST_CI.md` pour supprimer les instructions de déploiement qui n’étaient pas sûres.

## Vérifications locales de cette branche de travail

- `npm ci` : réussi sur Node.js `v24.22.1`.
- `npm audit --audit-level=high` : réussi, 0 vulnérabilité connue dans l’arbre installé.
- `npm run check` : réussi; syntaxe de l’application et des modules, 2 blocs JavaScript de dashboard, configuration et 9 fichiers indispensables.
- `npm test` : 55 tests réussis, 0 échec.
- `yq e '.' .github/workflows/ci-fadehost.yml` : YAML analysé sans erreur.
- Les tests vérifient que le workflow contient les étapes de validation et aucun appel de déploiement, et que l’agent d’ingénierie reste bloqué même si toutes les anciennes portes de déploiement sont à `true`.

## Limites et actions manuelles

- Les tests ont été exécutés localement sur Node.js 24.22.1. Le job GitHub doit encore confirmer le lockfile et la suite sur Node.js 20; la version configurée sur FadeHost reste inconnue.
- Aucun scénario de déploiement FadeHost, de mauvaise santé Telegram, d’erreur CLI, de rollback réel ou de stockage persistant n’a été exécuté.
- La protection de `main` et les contrôles CI requis restent à configurer dans une offre GitHub qui les prend en charge pour ce dépôt privé.
- Avant tout premier déploiement : vérifier la configuration FadeHost, tester un staging et un canal Telegram privé, confirmer `/health/ready`, les logs, dashboard, permissions, stockage et rollback; puis mettre en place un mécanisme qui cible exactement le SHA validé.
- Aucun merge automatique, merge de PR ou déploiement de production n’a été fait.
