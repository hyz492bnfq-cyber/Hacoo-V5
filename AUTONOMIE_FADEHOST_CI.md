# V6.3.1 — CI et déploiement FadeHost depuis GitHub

## Ce que cette version ajoute

- `npm run check` vérifie maintenant la syntaxe du serveur, de tous les modules et scripts, ainsi que le JavaScript inline du dashboard.
- GitHub Actions exécute `npm run check` et `npm test` sur les pushes et pull requests vers `main` et `staging`.
- Le déploiement FadeHost après validation est désactivé par défaut et ne se déclenche que sur un push vers `main` si `FADEHOST_AUTODEPLOY=true` est défini dans les variables GitHub.
- Après le déploiement, le workflow attend un HTTP 200 à l'URL de santé HTTPS configurée.

## Configuration avec accès au panneau uniquement

1. Dans le dépôt GitHub, ouvre **Settings → Secrets and variables → Actions**.
2. Dans **Secrets**, ajoute `FADEHOST_TOKEN` avec un jeton FadeHost à portée minimale. Ne le mets jamais dans le dépôt ni dans un fichier `.env` versionné.
3. Dans **Variables**, ajoute `FADEHOST_APP_ID` avec l'identifiant ou le nom exact de l'application visible dans FadeHost.
4. Ajoute `FADEHOST_HEALTH_URL` avec l'URL publique HTTPS qui répond `200` uniquement lorsque l'application est prête, idéalement `https://<ton-domaine>/health/ready`.
5. Laisse `FADEHOST_AUTODEPLOY` absent ou à `false` pendant les premiers essais.
6. Pousse la version sur une branche de staging et ouvre **Actions** pour vérifier que syntaxe et tests passent.
7. Déploie staging depuis FadeHost, puis teste le bot Telegram, les logs, le dashboard et `/health/ready`.
8. Prépare et teste un rollback avec **FadeHost → application → Deploys** avant toute activation.
9. Pour activer les déploiements automatiques validés par CI, définis la variable GitHub `FADEHOST_AUTODEPLOY` à `true` seulement après les essais de staging. L'application FadeHost doit suivre la même branche que le workflow (ici `main`).

## Limites connues et comportement sûr

- Un échec du contrôle post-déploiement fait échouer le workflow et donne la procédure de rollback dans le journal. Ce workflow n'exécute pas de rollback automatique via une API FadeHost non documentée.
- Le moteur interne `lib/fadehost-deployer.js` possède un rollback de contenu pour un fichier auxiliaire précis après un échec du contrôle runtime; cela ne remplace pas un rollback de déploiement complet sur FadeHost.
- Ne confonds pas le succès du workflow avec la preuve que toutes les fonctions métier Telegram marchent. Teste le bot sur un canal privé avant production.
- Cette pipeline automatise la validation et peut automatiser le déploiement après configuration, mais elle ne rend pas l'IA libre de modifier tous les fichiers. Les modules de gouvernance, `index.js`, le dashboard, les secrets et les données restent protégés.

## Documentation FadeHost

- https://fadehost.com/docs/app-hosting/
- https://fadehost.com/docs/cli/

## Ajouts V6.4.0 — auto-développement contrôlé
La version 6.4.0 ajoute une boucle de génération/correction bornée, les tests ciblés dans une copie isolée et la possibilité de créer une Pull Request GitHub en brouillon avec `V6_AUTONOMOUS_PR_ENABLED=true`. Cette option nécessite `V6_GITHUB_TOKEN`, `V6_GITHUB_OWNER` et `V6_GITHUB_REPO` avec les droits de création de branche, de commit et de Pull Request. La Pull Request n’est pas fusionnée automatiquement. Les cooldowns fournisseur après HTTP 429 sont persistés pour éviter les rafales d’appels après redémarrage.
