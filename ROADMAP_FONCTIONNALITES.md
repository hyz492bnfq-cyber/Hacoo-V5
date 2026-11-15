# Feuille de route proposée — M2 HACOO BOT

Cette feuille de route distingue les améliorations d’interface déjà livrées en V6.2.1 des fonctions supplémentaires proposées. Les fonctions proposées ne sont pas présentées comme déjà implémentées.

## Livré en V6.2.1

- Interface mobile-first et navigation basse fixe sur téléphone.
- Menu « Plus » pour accéder aux outils secondaires sans surcharger la navigation.
- Cibles tactiles agrandies, formulaires adaptés au petit écran, marges tenant compte des zones de sécurité iOS.
- Meilleure lisibilité des statuts, cartes, boutons, tableaux et messages.
- Aucun changement aux règles métier de modération ni aux routes API.

## Priorité P0 — visibilité et sécurité opérationnelle

1. **Centre d’attention** : une seule liste des erreurs, tâches à vérifier, doublons ambigus et actions en attente, triée par urgence.
2. **État réel du bot** : distinguer Express en ligne, connexion Telegram, droits du bot, état de la file, disponibilité IA et dernière sauvegarde. Ne jamais présenter un serveur HTTP disponible comme preuve que le bot Telegram fonctionne.
3. **Confirmation pour les actions destructrices** : expliquer l’impact avant suppression massive, restauration ou changement risqué ; fournir une annulation lorsque l’action est réversible.
4. **Mode test non destructif** : montrer les règles qui auraient été déclenchées sur un échantillon, sans suppression Telegram.
5. **Sauvegarde vérifiée** : date de la dernière sauvegarde valide, taille, contrôle d’intégrité et restauration testée dans un emplacement isolé.

## Priorité P1 — modération plus précise

1. **Boîte de vérification des doublons** : niveaux « certain / probable / ambigu », score, raisons et comparaison côte à côte du texte, des images, des variantes et des liens.
2. **Seuils par type de contenu** : seuils différents pour texte, image, album et publications avec variantes, avec une explication des risques de faux positifs.
3. **Exceptions protégées** : liste blanche par domaine, produit, référence, taille, couleur ou canal ; journaliser pourquoi une exception a été appliquée.
4. **Historique recherchable** : filtres par action, règle, plage de dates, identifiant Telegram, statut et type de contenu ; export CSV/JSON.
5. **Aperçu avant/après du nettoyage** : comparaison du texte original et du résultat, avec test sur un exemple avant activation.

## Priorité P2 — automatisation utile

1. **Rapport quotidien compact** : publications analysées, suppressions, faux positifs confirmés, erreurs, file en attente et consommation IA si disponible.
2. **Alertes anti-bruit** : regrouper les erreurs identiques, limiter les notifications répétées et signaler les incidents qui nécessitent réellement une action.
3. **Contrôle du quota IA** : affichage du fournisseur et du dernier test, cache des analyses, temporisation après quota dépassé et bascule sûre vers les règles déterministes.
4. **Planificateur plus clair** : états « brouillon / contrôlé / programmé / envoyé / incertain / annulé », avec confirmation avant envoi et aucune relance automatique si le résultat est incertain.
5. **Paramètres expliqués** : pour chaque option, afficher la valeur actuelle, l’effet concret, le risque, la valeur conseillée et un lien « tester sans appliquer ».

## Priorité P3 — expérience d’administration

1. **Recherche globale des réglages** avec résultats groupés par page.
2. **Profils de règles** : prudent, équilibré, strict, avec aperçu des changements avant application.
3. **Journal des modifications** : qui a changé quel réglage, quand, ancienne valeur et nouvelle valeur.
4. **Assistant IA en mode proposition** : réponse structurée en « problème / changement proposé / risque / test / retour arrière », jamais d’application automatique aux protections critiques.
5. **Accessibilité** : navigation clavier, focus visible, annonces de statut, contraste et tests sur petit écran.

## Ordre conseillé de réalisation

1. Centre d’attention + état réel Telegram/queue/IA.
2. Mode test non destructif + boîte de vérification des doublons.
3. Sauvegardes vérifiées et restauration testée.
4. Recherche/filtrage de l’historique et journal des modifications.
5. Rapports et alertes regroupées.

**Règle de consolidation :** les réglages doivent avoir une seule source de vérité, une validation côté serveur, un état d’enregistrement visible et un retour clair en cas d’échec. Les actions critiques doivent être idempotentes, journalisées et réversibles quand cela est possible.
