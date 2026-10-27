# Agent de développement multi-fichiers

Le chat authentifié du dashboard reconnaît les demandes explicites de modification et les confie à `lib/project-agent.js`. L’agent peut préparer des patchs coordonnés dans plusieurs fichiers existants, puis les envoyer sur une branche GitHub avec une Pull Request après validation.

## Validation et protections

- Le modèle propose des patchs exacts; il ne remplace jamais intégralement un gros fichier.
- Les fichiers sont allowlistés. `.env`, `data.json`, `package.json`, `package-lock.json`, les workflows, les modules de sécurité et l’agent lui-même ne peuvent pas être modifiés.
- Les fichiers actifs du projet ne sont pas écrasés. Les candidats et leur rapport sont conservés dans `workspace/candidates/project-agent/`, déjà ignoré par Git.
- Les tests tournent dans une copie temporaire avec un environnement expurgé. `.env`, `data.json`, les journaux, le dépôt Git et les tâches locales ne sont pas copiés.
- La syntaxe JavaScript, `scripts/check-dashboard.js`, `scripts/check-config.js` et la suite complète `node --test` doivent réussir avant toute branche ou PR.
- La PR utilise la configuration GitHub déjà présente (`V6_GITHUB_TOKEN`, `V6_GITHUB_OWNER`, `V6_GITHUB_REPO`, `V6_GITHUB_BRANCH` ou `V6_GITHUB_PR_BASE_BRANCH`). Aucune nouvelle variable n’est requise.
- Si GitHub n’est pas configuré dans l’environnement du service, le candidat validé est conservé sans branche ni PR.
- Aucune fusion automatique n’est faite. FadeHost ne déploie le changement que si une personne fusionne la PR sur la branche suivie par le service.

Cette voie est déclenchée par une demande explicite envoyée dans le chat du dashboard; elle ne lance pas de tâche de développement en arrière-plan.
