# M2 HACOO BOT V6.3.0 — autonomie renforcée

## Capacités livrées
- Centre de pilotage autonome avec pause/reprise, chat, journal de décisions et diagnostic manuel.
- API de pilotage authentifiée par le tableau de bord.
- Superviseur périodique, journalisé, qui vérifie les répertoires, l’intégrité JSON des états, les verrous de cycle périmés, l’âge de la file et la présence d’une dernière erreur.
- Réparations automatiques déterministes : création de répertoires de travail manquants et libération d’un verrou autonome clairement périmé.
- Aucune relance aveugle d’envoi Telegram incertain; l’état et les actions sont consignés.
- Génération de propositions et de candidats de code isolés, contrôles de sécurité, tests avant déploiement et politique d’allowlist pour les modules auxiliaires non critiques.
- Vérification de santé HTTPS après le push GitHub, tentatives bornées et rollback automatique vers le contenu précédent si le contrôle runtime échoue; le résultat est audité.

## Vérifications locales
- `npm run check` : réussi.
- `npm test` : 38 tests réussis, 0 échec.
- Syntaxe du JavaScript intégré au tableau de bord vérifiée.
- Ces contrôles ne remplacent pas un test réel avec Telegram, les clés IA et l’instance FadeHost.

## Ce qui n’est pas garanti ni activé
- Aucun logiciel ne peut garantir zéro panne ou une auto-réparation parfaite.
- Le système ne reçoit pas un droit illimité de modifier tous les fichiers et d’exécuter n’importe quelle commande.
- Les candidats de code ne sont pas exécutés aveuglément sur la production. Les fichiers critiques, secrets, données et mécanismes de sécurité sont exclus de la politique de déploiement autonome.
- Le déploiement autonome reste désactivé par défaut et limité à une allowlist explicite. Le push GitHub ne prouve pas que FadeHost a redémarré correctement.
- Le rollback automatique sur échec du contrôle HTTPS est implémenté dans le code et couvert par les tests unitaires de santé; son fonctionnement réel dépend de la configuration GitHub/FadeHost et n’a pas été validé en production depuis cette session.
- Aucun déploiement de production n’a été effectué depuis cette session.

## Variables d’autonomie
- `V6_SUPERVISOR_ENABLED=true` : active le superviseur déterministe.
- `V6_AUTONOMY_ENABLED=true` : autorise les revues IA périodiques si un fournisseur est configuré.
- `V6_AUTONOMOUS_DEPLOY_SAFE=false` et `V6_AUTO_DEPLOY_ENABLED=false` par défaut. Le déploiement autonome exige aussi `V6_DEPLOY_HEALTH_URL` en HTTPS, pointant vers une route qui répond 2xx seulement lorsque le bot est réellement sain. Ne les active pas sans staging, sauvegarde et confirmation que FadeHost suit la bonne branche.

## Mise en service
1. Sauvegarder la version actuellement déployée et ses données.
2. Déployer le code sans écraser `data.json` de production.
3. Renseigner les variables dans le panneau FadeHost, jamais dans une archive partagée.
4. Lancer `npm start`, vérifier les logs, la connexion Telegram, les droits et le tableau de bord.
5. Tester d’abord dans un canal de test et conserver une possibilité de retour arrière.


## Ajouts V6.3.0

- Agent d’ingénierie à tâches persistantes, génération de candidats pour les modules auxiliaires autorisés, contrôles de syntaxe et statiques, et prévention de l’écrasement si la source change.
- API et dashboard de création/suivi des tâches.
- Traitement périodique des tâches en attente lorsque `V6_AUTONOMOUS_ENGINEERING_ENABLED=true`.
- Endpoint `/health/ready` pour vérifier le processus et une connexion Telegram récente.
- Suite locale : 44 tests réussis et syntaxe validée.

## Limites restantes avant autonomie de production

- L’autonomie de modification est limitée à la génération de candidats `lib/*.js` non critiques de moins de 10 Ko; aucun agent ne peut modifier librement tous les fichiers de production via cette interface.
- Les contrôles statiques et l’environnement de test privé de secrets ne sont pas un sandbox système inviolable.
- La publication automatique exige des secrets GitHub, une allowlist, une URL HTTPS de santé et une configuration FadeHost; aucun déploiement réel n’a été exécuté depuis cet environnement.
- La surveillance externe d’un processus entièrement arrêté doit être assurée par l’hébergeur ou un moniteur externe.
- Une URL de santé valide ne garantit pas l’absence de défauts fonctionnels; les scénarios de panne/rollback doivent être validés sur un environnement de test connecté à FadeHost.
