# État d’avancement — conversion des liens de publications Hacoo

Dernière mise à jour : 7 novembre 2026 (inspection complémentaire des requêtes réseau)

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

## Nouvelle inspection navigateur — 7 novembre 2026

L’utilisateur a ouvert les DevTools de Chrome/Edge sur la publication `https://www.hacoo.app/p/15591744`, onglet Network, filtre **All**.

### Capture d’écran Network et HTML du document

La liste Network initiale montrait :
- La requête document `15591744` avec statut HTTP 200 et type `document`.
- Plusieurs ressources statiques (CSS, JS, images, polices).
- Des requêtes XHR/fetch de télémétrie, notamment `rum`, `dotRecords`, `dotMets` et `collect`.
- Aucun nom de requête visible `getFeedDetail` dans cette capture.

Le fichier `15591744.devtools` (HTML, environ 128 Ko, 130 948 caractères) est le corps HTML du document principal, pas un HAR ni une réponse API de détail. Il contient le chemin `/en-FR/p/15591744`, mais pas l’identifiant produit `40722058`, ni `getFeedDetail`, `productCardDetail`, `feed-center` ou des données produit exploitables.

Le fichier ultérieur `response.txt` a également été inspecté : HTML générique de la page Hacoo (environ 197 020 caractères), sans `40722058`, `getFeedDetail`, `feed-center`, `productCardDetail`, `item_id` ou `feedId`. Il ne contient donc pas la réponse de détail recherchée.

### Requêtes réseau examinées ensuite

L’utilisateur a fourni les commandes cURL de quatre requêtes observées pendant le chargement de la page :

| Endpoint | Nature constatée | Utilité pour le détail de publication |
|---|---|---|
| `/cdn-cgi/rum` sur `www.hacoo.app` | Télémétrie de performance Cloudflare ; le corps contient notamment URL de page, timings et informations navigateur | Aucune donnée produit |
| `/api/dotMets` sur `dot.hacoo.app` | Collecte de mesures/télémétrie au format JSON | Aucune donnée produit |
| `/g/collect` sur `region1.google-analytics.com` | Google Analytics 4, événement `page_view` | URL de page uniquement, aucune donnée produit |
| `/api/v2/dotRecords` sur `dot.hacoo.app` | Trace utilisateur `user_trace`, contexte de page `hacoo~home`, URL de navigation | Aucune donnée produit |

Les quatre requêtes sont des événements de mesure ou de navigation. La présence de `/p/15591744` dans leurs champs URL ne signifie pas qu’elles transportent le contenu de la publication. Aucun de ces corps ne fournit `item_id=40722058`, une liste de produits ou une réponse `getFeedDetail`.

**Conclusion de l’inspection complémentaire :** les requêtes copiées jusqu’ici sont des requêtes de télémétrie, pas l’API métier de détail. Aucune nouvelle méthode de récupération ni signature compatible H5/PC n’a été démontrée. Aucun appel API Hacoo live supplémentaire n’a été effectué par l’assistant pendant cette inspection.

### Sécurité des captures

Plusieurs commandes cURL partagées dans la conversation contenaient des cookies et des jetons d’authentification. Ces valeurs ne sont pas reproduites dans ce document ni dans le dépôt. Considérer les identifiants exposés comme compromis et renouveler la session/les jetons concernés. Pour la suite, ne partager que les URL, méthodes et corps de réponse expurgés ; ne jamais partager les en-têtes Cookie, Authorization ou x-token, ni les identifiants de session.

### Prochaine action exacte avec l’utilisateur

La capture du document principal et les quatre cURL de télémétrie ont été écartés. Reprendre dans DevTools → Network → **Fetch/XHR**, avec la liste vidée avant le rechargement de `https://www.hacoo.app/p/15591744`. Chercher une requête métier vers Hacoo (ou un sous-domaine Hacoo) dont le nom, l’URL ou le corps évoque `feed`, `detail`, `product` ou `item`. Partager une capture de la liste avec Name, Method, Status et Domain, puis uniquement l’URL et le corps **Response** de la requête candidate, après expurgation des données sensibles.

Ne pas demander ni partager **Headers**, **Cookies**, Authorization, paramètres de session ou tokens. Si aucune requête métier de détail n’apparaît dans ce contexte web, documenter ce constat et ne pas inventer d’endpoint.

## État réel

- [x] Format d’URL de publication identifié : `/p/{feedId}`.
- [x] Appel iPhone `getFeedDetail` observé avec une réponse exploitable dans une capture HAR antérieure.
- [x] Structure du premier produit identifiée dans la réponse HAR antérieure.
- [x] Sélection du premier produit et règle « ne pas sauter un premier produit externe » prévues dans le code.
- [x] Mécanisme de signature H5/PC du bundle web décodé.
- [x] Inspection Network de la page web effectuée ; aucun `getFeedDetail` visible dans la liste fournie.
- [x] Réponse HTML du document principal et fichier `response.txt` inspectés ; ils ne contiennent pas le détail produit.
- [x] Quatre requêtes réseau identifiées comme télémétrie/analytics (`rum`, `dotMets`, `g/collect`, `dotRecords)) et écartées comme sources du détail.
- [ ] Identifier la requête métier web qui fournit les données de la publication, si elle existe dans ce contexte.
- [ ] Méthode d’authentification/signature compatible avec `getFeedDetail` depuis le bot.
- [ ] Transport `getFeedDetail` validé de bout en bout.
- [x] Fallback public anonyme branché dans le flux de résolution ; aucun transport iPhone/H5 ni signature propriétaire n’est reproduit.\n- [ ] Vérifier sur une publication réelle si le HTML public expose des données JSON de produits ; les captures déjà fournies ne les exposent pas.
- [x] Tests simulés couvrant la chaîne publication → premier produit → `promoLink` lorsque `fetchFeedDetail` est fourni par un intégrateur validé.
- [x] Garde ajoutée : les URL Hacoo directes qui ne correspondent pas à une fiche `/detail/{id}` ou `/product/{id}` ne sont plus envoyées à `promoLink` ; l’URL d’origine est conservée.
- [ ] Validation sur un cas réel autorisé, sans contourner les protections Hacoo.

## Instructions de reprise pour la prochaine IA

Lire ce document en entier avant toute action, puis reprendre sur la branche `feat/hacoo-publication-first-product` et la PR #41.

**Ne pas recommencer l’analyse depuis zéro et ne pas supposer que la fonctionnalité est terminée.** Le blocage actuel reste l’identification d’une requête métier web sûre et vérifiée pour obtenir le détail de la publication `15591744`. Le HTML du document et les quatre cURL examinés ensuite ne contiennent pas les produits : les cURL correspondent à des collectes de télémétrie/analytics.

Le fallback public anonyme est maintenant en place. Après validation des tests, vérifier une URL `/p/` réelle : si le HTML public ne contient pas de données JSON `productCardDetail`, il faudra encore identifier une API métier documentée ou accepter que ce type de publication conserve son URL d’origine. Ne jamais demander ou enregistrer des cookies, mots de passe, Authorization, SID, web IDs ou jetons.

## Prochaines étapes techniques après identification de la requête

1. Identifier une méthode officielle ou un contexte web documenté qui permet d’obtenir le détail de la publication sans réutiliser à tort le signataire H5/PC.
2. Vérifier la construction exacte de la requête et de son authentification à partir d’éléments non sensibles.
3. Mettre à jour `lib/hacoo-feed-detail.js` uniquement lorsque la méthode est comprise et vérifiée.
4. Ajouter les tests de non-régression : premier produit externe, publication sans produit, erreur API, contexte absent et conservation du lien original.
5. Injecter le récupérateur dans `index.js` et vérifier que toute erreur laisse l’URL initiale intacte.
6. Laisser la fusion et le déploiement en attente d’une autorisation explicite.

## Sécurité et périmètre

- Aucun appel live supplémentaire à l’API Hacoo n’a été effectué pendant cette analyse navigateur.
- Aucune donnée de session ou aucun secret n’est consigné dans cette note.
- Aucun changement n’a été fait sur `main`, `data.json` ou la configuration FadeHost.
- Aucun déploiement n’a été effectué.
- Les rapports de commandes/conversions restent hors périmètre de cette fonctionnalité.


## HAR supplémentaire analysé — 7 novembre 2026

Une seconde capture HAR fournie ensuite contient une réponse réussie à `dwp.feed-center.getFeedDetail` pour la publication `15611867`. La réponse expose `data.productCardDetail` sous forme d’objet indexé par URL. La première carte produit observée est de type `item_detail_card`, avec `moduleData.item_id=40870813`, `extPlat=hacoo` et `out_site=false`. Le lien OnlyAff observé redirige vers la publication Hacoo correspondante.

Cette capture confirme donc le **format de réponse réel** et un exemple de premier produit. Elle ne valide pas un transport exécutable depuis le bot : la requête HAR est liée à une session/appareil et ses paramètres de signature/session ne doivent pas être copiés dans le dépôt. Aucun secret ni en-tête d’authentification n’est conservé ici.

Aucun appel `promoLink` n’apparaît dans cette capture. La génération d’un nouveau lien affilié n’est donc pas validée en conditions réelles.

### Conséquence code

- Le parseur `selectFirstPublicationProduct` accepte déjà l’enveloppe `{ code: 1001, data: { productCardDetail: { ... } } }` et lit `moduleData.item_id`.
- Un test de non-régression est ajouté avec la forme de données observée dans ce HAR.
- `index.js` n’injecte toujours pas `fetchFeedDetail`. Le bot conserve donc le lien original `/p/{feedId}` si le HTML public ne révèle pas de données produit. C’est volontaire tant qu’un contexte d’appel documenté et compatible n’est pas disponible.
- Ne pas réutiliser la signature `modelReportList` comme preuve de compatibilité avec `getFeedDetail`.

**État après cette capture :** récupération du produit confirmée à partir du HAR fourni et parsing couvert par test simulé ; transport bot → `getFeedDetail` non intégré ; `promoLink` live non validé ; aucune conversion bout en bout revendiquée.
