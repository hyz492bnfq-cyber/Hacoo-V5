# M2 HACOO BOT V6.3.0 — rapport de construction

- Version : 6.3.0
- `npm run check` : réussi
- JavaScript inline de `dashboard.html` : `node --check` réussi
- `npm test` : 44 tests réussis, 0 échec
- Nouveauté : agent d’ingénierie persistant, tâches durables, génération de candidats sur modules auxiliaires, contrôles statiques, journalisation, API et dashboard.
- Nouveauté : endpoint `/health/ready` qui vérifie le processus, la configuration du token et une connexion Telegram récente.
- Déploiement autonome : désactivé par défaut; activation exigeante et limitée à une allowlist exacte, une configuration GitHub et une URL HTTPS de santé.
- Pas de déploiement de production exécuté pendant cette construction; les identifiants GitHub/FadeHost et les clés API ne sont pas inclus.
- Les tests de pré-déploiement utilisent une copie temporaire et un environnement sans secrets, mais ne constituent pas une sandbox OS inviolable.
