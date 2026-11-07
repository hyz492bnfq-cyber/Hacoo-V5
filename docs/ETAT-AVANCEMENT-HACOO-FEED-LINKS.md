# État d’avancement — conversion des liens de publications Hacoo

Dernière mise à jour : 7 novembre 2026

## Objectif

Lorsqu’une publication contient une URL Hacoo de la forme `/p/{feedId}`, récupérer le détail de cette publication, prendre **uniquement le premier produit**, puis créer un nouveau lien affilié avec l’API `promoLink` déjà utilisée par le projet.

Règles fonctionnelles :
- Ne jamais passer au deuxième produit si le premier est externe ou invalide.
- Si une étape échoue, conserver le lien de publication d’origine sans le remplacer.
- Ne pas modifier le traitement des commandes ou des rapports de conversion : ce sujet est hors périmètre.

## Dépôt et branche de travail

- Dépôt : `hyz492bnfq-cyber/Hacoo-V5`
- Branche : `feat/hacoo-publication-first-product`
- PR : [#41](https://github.com/hyz492bnfq-cyber/Hacoo-V5/pull/41)

Cette note est enregistrée sur la branche de travail de la PR. Elle ne vaut pas autorisation de fusionner la PR ou de déployer sur FadeHost.

## Éléments déjà présents dans la branche

Commits existants :
- `815d7c9e16377feb1574079ba6b79226013dcaf3` — transport expérimental pour `getFeedDetail`.
- `5c5d3070f2cceab02df44bd4fdb6b2abe5415999` — tests des protections du transport expérimental.
- `722c70df44fe0e75c71322decc4005093d2fa908` — correction de validation de l’identifiant de publication.

Fichiers concernés :
- `lib/hacoo-feed-detail.js` : transport expérimental, dépendant d’un contexte et d’une fonction de signature injectés. Il refuse d’effectuer l’appel si la signature manque.
- `test/hacoo-feed-detail.test.js` : tests simulés des gardes et du traitement des erreurs ; aucun test live Hacoo.
- `lib/hacoo-affiliate.js` : signature déjà utilisée pour `dwp.aff-home-core.modelReportList`.
- `lib/hacoo-promo-link.js` : remplacement des liens de publication et création du lien affilié via `promoLink`.
- `lib/hacoo-publication.js` : sélection du premier produit uniquement.
- `index.js` : l’option de remplacement appelle actuellement `replaceHacooLinks`, mais le récupérateur `fetchFeedDetail` n’est pas encore injecté ; la chaîne complète n’est donc pas opérationnelle.

## Analyse des HAR et du bundle JavaScript

Une capture HAR précédente contient deux appels réussis à :
- `GET /gw/dwp.feed-center.getFeedDetail/1`
- Publication observée : `feedId=15591744`
- Le premier produit retourné a notamment `item_id=40722058`, `extPlat=hacoo`, `out_site=false` et `moduleType=item_detail_card`.

La requête observée dans cette capture est une requête iPhone :
- `plat=iphone`
- Le champ `data` contient `f` et `feedId`.
- La capture contient également des paramètres de session/signature propres à cette requête. Ne pas copier de cookies, jetons ou identifiants de session dans ce document ou dans le dépôt.

Le bundle web `cggv.js` expose un mécanisme de signature DWP H5/PC de la forme :

```text
MD5("1" + api + version + data + ct + salt)
```

Les constantes H5 et PC décodées correspondent aux valeurs déjà présentes dans le code pour le service `modelReportList` :
- H5 : `E8748EF263C69EEE30A77CC6E0CD2CAC`
- PC : `14A49D715D5457F55924291E0941D7E1`

**Limite essentielle :** cette découverte décrit le signataire web H5/PC. Elle ne démontre pas que ce signataire est compatible avec `dwp.feed-center.getFeedDetail` tel qu’observé sur iPhone. Les deux contextes ne doivent pas être assimilés.

Un appel observé à `dwp.feed-center.getShareChannelFeedDetail` en H5 a renvoyé le code métier `103500008` (paramètres d’application non disponibles). Il ne constitue donc pas une solution validée pour récupérer le détail.

## État réel

- [x] Format d’URL de publication identifié : `/p/{feedId}`.
- [x] Appel iPhone `getFeedDetail` observé avec une réponse exploitable.
- [x] Structure du premier produit identifiée dans la réponse HAR.
- [x] Sélection du premier produit et règle « ne pas sauter un premier produit externe » prévues dans le code.
- [x] Mécanisme de signature H5/PC du bundle web décodé.
- [ ] Méthode d’authentification/signature compatible avec `getFeedDetail` depuis le bot.
- [ ] Transport `getFeedDetail` validé de bout en bout.
- [ ] Injection de `fetchFeedDetail` dans `index.js`.
- [ ] Tests d’intégration couvrant la chaîne publication → premier produit → `promoLink`.
- [ ] Validation sur un cas réel autorisé, sans contourner les protections Hacoo.

## Prochaines étapes recommandées

1. Identifier une méthode officielle ou un contexte web documenté qui permet d’obtenir le détail de la publication sans réutiliser à tort le signataire H5/PC.
2. Vérifier la construction exacte de la requête et de son authentification à partir d’éléments non sensibles. Ne jamais demander ni enregistrer de cookies, mots de passe, en-têtes Authorization ou jetons de session.
3. Mettre à jour `lib/hacoo-feed-detail.js` uniquement lorsque la méthode est comprise et vérifiée.
4. Ajouter les tests de non-régression : premier produit externe, publication sans produit, erreur API, contexte absent et conservation du lien original.
5. Injecter le récupérateur dans `index.js` et vérifier que toute erreur laisse l’URL initiale intacte.
6. Laisser la fusion et le déploiement en attente d’une autorisation explicite.

## Sécurité et périmètre

- Aucun appel live supplémentaire à l’API Hacoo n’a été effectué pendant cette analyse.
- Aucune donnée de session ou aucun secret n’est consigné dans cette note.
- Aucun changement n’a été fait sur `main`, `data.json` ou la configuration FadeHost.
- Aucun déploiement n’a été effectué.
- Les rapports de commandes/conversions restent hors périmètre de cette fonctionnalité.
