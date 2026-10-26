# M2 HACOO BOT V6.3.1 — rapport de construction

- `npm run check` : réussi (serveur, modules, scripts, JavaScript inline du dashboard).
- `npm test` : 44 tests réussis, 0 échec.
- Nouveau script : `scripts/check-dashboard.js`.
- Nouveau workflow : `.github/workflows/ci-fadehost.yml` (CI automatique, déploiement optionnel désactivé par défaut).
- Nouvelle documentation : `AUTONOMIE_FADEHOST_CI.md`.
- Version mise à jour : `package.json`, `VERSION`, `index.txt`.
- Déploiement FadeHost : non effectué; aucun identifiant ni accès de production n'a été utilisé.
- Rollback complet après échec du workflow CI : le workflow signale l'échec et documente le rollback depuis FadeHost; il ne prétend pas appeler une API de rollback non documentée.
- L'agent interne reste limité aux modules auxiliaires autorisés et ne peut pas modifier librement les fichiers critiques.
