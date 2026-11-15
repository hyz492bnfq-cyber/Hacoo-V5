# CI HACOO BOT et limites du déploiement FadeHost

## Contrôles automatisés

Le workflow `.github/workflows/ci-fadehost.yml` s’exécute sur les pushes et pull requests vers `main` et `staging`, ainsi qu’à la demande. Il :

1. installe Node.js 20;
2. installe exactement les versions du lockfile avec `npm ci`;
3. exécute `npm audit --audit-level=high`;
4. vérifie les fichiers essentiels, les variables documentées et les portes d’autonomie;
5. contrôle la syntaxe du serveur, des modules, des scripts et des dashboards;
6. lance toute la suite `npm test`.

Un échec d’une étape obligatoire fait échouer le job. Le workflow conserve les permissions GitHub à `contents: read`.

## Pourquoi aucun déploiement automatique n’est activé

La documentation officielle de FadeHost décrit `fadehost apps deploy <app>` comme une commande qui « pull[s] the latest commit ». Elle ne documente pas d’option pour déployer un SHA précis. Une vérification de SHA avant la commande ne supprimerait pas la course entre le contrôle et le pull.

À l’audit du 27 octobre 2026, `main` n’est pas protégée. L’API GitHub répond que la protection des branches de ce dépôt privé nécessite GitHub Pro ou un dépôt public; la visibilité du dépôt n’a pas été modifiée. Le déploiement FadeHost automatique sur chaque push pourrait donc publier un commit avant que ses contrôles aient fini.

En conséquence :

- le workflow ne contient aucun appel de déploiement FadeHost;
- définir `FADEHOST_AUTODEPLOY=true` fait échouer le workflow sur un push vers `main` au lieu de déclencher un déploiement;
- le redéploiement automatique sur push dans FadeHost doit rester désactivé;
- aucune fusion automatique, aucun déploiement réel et aucun rollback de production n’ont été effectués.

## État des secrets et variables GitHub

L’API GitHub confirme uniquement les noms, jamais les valeurs :

- secrets Actions présents : `FADEHOST_TOKEN`, `FADEHOST_APP`;
- variables Actions présentes : aucune.

Le workflow de validation ne lit pas ces secrets. Ne crée pas une variable `FADEHOST_APP_ID` pour reproduire l’ancien workflow et ne colle jamais de valeur secrète dans un commit, un log ou une conversation.

## Réglages requis avant une première mise en production

1. Obtenir une méthode FadeHost prise en charge qui déploie exactement le SHA ayant passé la CI, ou une architecture équivalente qui prouve que seul un commit validé est déployable.
2. Activer une protection applicable à `main`, avec CI comme contrôle requis et des restrictions sur les pushs directs. L’API n’a pas permis de consulter ou configurer ces règles dans l’offre actuelle du dépôt privé.
3. Vérifier dans FadeHost le dépôt, la branche, la version Node.js, la commande de démarrage (`npm start`), le stockage persistant, les variables et l’auto-deploy. Aucun connecteur FadeHost n’est disponible dans cette conversation; ces paramètres n’ont pas été lus.
4. Tester dans une application/canal Telegram de staging : `/health/ready`, logs, dashboard, routes authentifiées, persistance de `data.json`, droits Telegram et procédure de retour arrière.
5. Après ces preuves, concevoir et tester un job de déploiement lié au SHA validé. Ne pas réactiver l’ancien job basé sur le dernier commit de la branche.

`/health/ready` renvoie un succès uniquement si le processus n’est pas en arrêt, si le token Telegram est configuré et si une connexion Telegram récente est enregistrée. Le retour HTTP 200 du simple `/health` ne suffit pas à prouver que le bot est connecté.

## Portes d’autonomie de l’application

Dans `.env.example`, les valeurs par défaut de `V6_AUTONOMOUS_ENGINEERING_ENABLED`, `V6_AUTONOMOUS_PR_ENABLED`, `V6_AUTONOMOUS_DEPLOY_SAFE` et `V6_AUTO_DEPLOY_ENABLED` sont `false`. L’agent d’ingénierie produit des candidats et, si explicitement activé, une Pull Request en brouillon; il ne pousse plus directement un candidat vers une branche de déploiement. La fusion et la publication restent des actions distinctes.

Commandes locales :

```sh
npm ci
npm audit --audit-level=high
npm run check
npm test
```

La CI et ces tests ne prouvent pas le bon fonctionnement du déploiement FadeHost, les droits Telegram ou la santé du bot en production.
