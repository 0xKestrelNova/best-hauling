# ADR-004 : Le Plan de vol — une vue de conclusion, et la seule à porter la carte

**Statut :** Accepté
**Date :** 2026-08-14
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #61 · **Jalon :** v1.1.0

## Contexte

Les six vues actuelles servent toutes à **chercher** : quel trajet, quelle boucle, quelle chaîne,
quel prix corriger. Une fois tout paramétré, il manque l'endroit où **regarder le résultat**.

Dans les mots du propriétaire :

> « C'est un peu, t'as tout paramétré tes routes et tout, et ben t'as le résumé là. […] Ça vaudrait
> le coup dans cet onglet de mettre la map un peu plus grosse. Un bon visu de ta soute. […]
> Finalement c'est plus une conclusion. »

Ce n'est donc **pas une page d'accueil**. On y arrive à la fin du travail, pas au début — et cette
nuance commande tout le reste de cet ADR, à commencer par le nom.

### Ce que fait le code aujourd'hui (vérifié)

| Constat | Où |
|---|---|
| Le récapitulatif n'a pas de vue à lui : il vit dans une rangée posée **au-dessus du contenu de toutes les vues** | `.ship-journey-row#shipJourneyRow`, `index.html:154-188` — bloc **hors** des sections de vue, qu'aucun `hidden = v !== …` de `switchView` ne touche |
| La carte est comprimée dans une colonne étroite | `#journeyMap`, `style.css`, `flex 1 1 460px` |
| La soute est réduite à un encart latéral | `#holdCard` |
| La barre de filtres est **permanente** | `<section class="controls">`, `index.html:92` — **sans `id`**, seule section de contrôles que `switchView` ne bascule pas |
| L'app n'a pas de septième vue | dix points à toucher, dont la liste blanche `app.js:2459` — voir « Conséquences » |

## Décision

Une **septième vue**, nommée **Plan de vol**, qui récapitule le voyage engagé : le parcours étape
par étape, sa carte **en grand**, la soute, la jambe en cours et son manifeste.

### 1. Le nom : « Plan de vol »

« Voyage » ne dit pas ce que c'est. Deux candidats évidents sont **déjà pris par le code** :

- **« Passerelle »** désigne les *jump gates* — `nomPasserelle` (`logic.mjs`), et le routage des
  sauts dans `journeyMap` ;
- **« Vol »** est pris par `DUREE_VOL` et `enVol`.

« Plan de vol » est le terme exact pour ce qu'on dépose une fois l'itinéraire arrêté, et il résonne
avec le `Flight Ops` de la marque. Deux mots, comme « En route » l'est déjà (`index.html:62`).
Identifiant interne : **`plan`** — surtout pas `vol`.

*Écartés : « Pont » (dit « d'ici je commande », donc un accueil — ce que la vue n'est pas),
« Bilan » (registre comptable), « Récap » (familier, dépareillé dans ce rail).*

### 2. Trajets reste la vue par défaut

`app.js:42` (`let view = "routes"`) ne bouge pas. Une conclusion n'est pas un point d'entrée : y
atterrir au premier chargement montrerait un parcours vide et une soute vide, soit l'écran le moins
parlant de l'app.

**Conséquence pour #62** (l'aide de première visite) : elle ne peut pas se loger dans l'état vide de
cette vue, puisqu'on n'y arrive pas. Il lui faut sa propre surface.

### 3. Le bandeau reste dans les autres vues

Le résumé du voyage et la soute continuent d'être visibles partout. Les masquer serait une
régression : on veut garder le coup d'œil sur ce qui est engagé pendant qu'on cherche un trajet.

C'est une **non-régression à tester**, pas une intention : une refonte de disposition casse ce
genre de chose sans le vouloir.

### 4. La carte, elle, ne vit QUE dans le Plan de vol

C'est ce qui justifie l'existence de la vue. Si la carte restait partout, la conclusion ne montrerait
rien qu'on n'ait déjà sous les yeux et on n'aurait fait que déménager un composant. Ça libère au
passage la largeur du bandeau résiduel, donc ça évite que la décision 3 coûte de la place.

**La réserve envisagée tombe, vérification faite.** On craignait de perdre le geste « changer
d'étape », que la carte porte (`app.js:3324`). Or la carte Voyage rend **déjà** un bouton par arrêt —
`.jstep`, `title="Je suis ici"` (`app.js:2173`) — et son écouteur appelle `setJourneyStop`
(`app.js:3369-3370`). Le clic sur la carte est un **doublon** de ce geste, pas son unique chemin.
Retirer la carte des autres vues ne retire donc aucune capacité.

### 5. Cliquer `HAULR / Flight Ops` ramène à **Trajets**

La marque avait été envisagée comme retour vers cette vue, quand elle devait être l'accueil. Trajets
étant la vue principale (décision 2), c'est là que « retour au début » doit mener — sinon le geste
atterrit sur une conclusion.

**Contrainte de voisinage** : #62 pose un bouton « rejouer le tuto » dans le même bloc `.brand`. Les
deux cohabitent **à condition de ne pas être imbriqués** — deux éléments interactifs l'un dans
l'autre sont invalides en ARIA et rendent le clic ambigu. C'est la règle que le dépôt vient
d'appliquer en sortant `.scomm-undo` du `.editv` (#38). Deux frères dans `.brand`, pas un dans
l'autre.

### 6. Les filtres sont masqués ; les réglages deviennent indicatifs

On ne change rien au voyage depuis cette vue. La barre de filtres y est du bruit — et pire, elle
laisse croire qu'agir dessus modifierait ce qu'on regarde.

`<section class="controls">` (`index.html:92`) reçoit un `id` et rejoint les sections que
`switchView` bascule. Son contenu se sépare en deux familles, traitées différemment :

| Famille | Champs | Traitement |
|---|---|---|
| **Filtres de recherche** | `#search`, `#system`, `#freshness`, `#sameSystem`, `#noOutpost`, `#legalOnly`, `#capStock`, `#multiCommodity` + `#multiMode` | masqués |
| **Réglages de configuration** | `#ship`, `#useCargo` + `#cargo`, `#useBudget` + `#budget`, `#autoload` + `#alk` | **repris en texte, en lecture seule** |

Ces quatre-là ne filtrent pas : ils **changent le sens des chiffres affichés**. La soute donne la
place libre ; `#autoload` décide si les profits sont nets ou bruts, et son état n'est aujourd'hui
lisible que sur la case à cocher. Les masquer sans rien mettre à la place rendrait la conclusion
silencieusement ambiguë — on lirait un profit sans savoir s'il est net.

D'où une ligne d'hypothèses en clair :

> **Railen · soute 96 SCU · budget 1 000 000 aUEC · profits nets (k = 1,2)**

Une conclusion énonce ses hypothèses au lieu de les offrir à la modification. Pour les changer, on
retourne dans une vue de recherche : c'est là qu'on travaille.

**Masquer n'est pas désactiver** : les valeurs survivent au passage dans la vue et au retour.

### 7. Le Plan de vol se place en **dernier** au rail

Une conclusion se lit après ce qui la produit. Le placer en tête renumérote des raccourcis déjà
appris (`1`→`6`) pour un gain nul.

Décision volontairement **révisable par #45**, qui refond la hiérarchie du menu dans le même jalon :
cet ADR ajoute une entrée, il ne réorganise pas le rail. Si #45 introduit des sous-entrées, le Plan
de vol trouvera sa place dans cette hiérarchie plutôt qu'au bout d'une liste plate.

> **Révisé par #45 (2026-08-15).** C'est arrivé : le Plan de vol est **septième sur huit**, devant
> « ✎ Corrections ». Le principe tient — une conclusion se lit après ce qui la produit — mais il
> s'arrête à ce qui produit quelque chose : un **réglage** se lit après une conclusion. La crainte
> de renuméroter des raccourcis appris ne l'a pas emporté, pour une raison que cet ADR ne pouvait
> pas voir depuis une seule entrée : le rail affiche un numéro par vue, et un numéro qui ne désigne
> pas la touche qui l'active ne vaut rien. Le Plan de vol garde d'ailleurs sa touche `7`.

### 8. Le bouton de capture produit du **texte**, pas une image

Le besoin : envoyer son voyage à un collègue.

**La CSP contraint fortement l'implémentation**, et il faut le savoir avant de commencer.
`index.html:23` pose `img-src 'self' https:` — **sans `data:`** — et `scripts/csp.test.mjs` verrouille
la directive. Le procédé habituel (sérialiser du DOM dans un `<svg><foreignObject>`, l'encoder en
`data:` URI, le charger dans une `<img>`, la peindre sur un `<canvas>`) est donc **bloqué**. Aucune
bibliothèque externe non plus : tout doit être auto-porté.

| Voie | Coût | Verdict |
|---|---|---|
| **Récapitulatif en texte** dans le presse-papiers | `navigator.clipboard.writeText`, rien d'autre | **retenue** |
| La carte peinte au Canvas 2D, copiée en PNG | un second moteur de rendu à maintenir en phase avec le SVG | plus tard, si le besoin d'image se confirme |
| Toute la vue en image | demanderait d'assouplir la CSP | écartée |

Le texte se colle partout, se cite ligne par ligne dans un salon, survit aux thèmes, et ne coûte pas
un second moteur de rendu. La voie 2 reste **réalisable** le jour venu, précisément parce que
`journeyMap` (`logic.mjs:1719`) « renvoie tout ce qu'il faut dessiner, en pixels du viewBox — jamais
de HTML » : on pourrait redessiner la même géométrie au Canvas sans charger la moindre ressource.

**Piège à ne pas découvrir en route** si la voie 2 est un jour prise : les photos de terminaux
viennent d'UEX en cross-origin. Les peindre dans un canvas sans en-têtes CORS le **contamine**, et
`toBlob()` lève alors une `SecurityError`.

## Conséquences

### Ce qu'il faut toucher pour ajouter la vue

Dix points, dispersés — en oublier un se voit tard :

- `index.html:60-65` (rail) · `app.js:2116` (dispatch de `refresh`) · `:2143` (classe `active`) ·
  `:2152-2153` (les `hidden`) · `:2155` (neutralisation de `#empty`, déjà source de bugs — cf. #26) ·
  `:2971` (écouteur) · `:3236` (raccourcis) ;
- **`app.js:2459`, la liste blanche** `["routes","loops","enroute","chain","corrections","commodities"]`.
  **C'est le piège** : sans ajout ici, la vue ne revient ni d'un permalien ni du localStorage ;
- `<section class="controls">` (`index.html:92`) doit recevoir un `id` ;
- `README.md:26` — « Six vues » devient « Sept vues ».

### Le piège de rendu

`#journeyMap` porte ses écouteurs **en direct** et une seule fois (`app.js:3324`, `:3328`), hors du
HTML réécrit par `innerHTML`. Le déplacer dans un conteneur re-rendu reproduirait #24 — un geste qui
cesse de répondre après un rendu. La carte doit rester un frère persistant, pas un enfant réécrit.

### Sur les autres issues

- **#43** (« le vaisseau, le voyage et sa carte sont éclatés sur trois colonnes ») visait le même
  inconfort avec une réponse plus faible. Cet ADR l'**absorbe** : à fermer.
- **#42** (ordre des systèmes sur la carte) et **#53** (bouton « ✓ chargé ») portent sur des éléments
  qui déménagent ici. À traiter après, ou en même temps.
- **#57** (tournée d'écoulement) ajoute une huitième vue : raison de plus pour que #45 tranche la
  hiérarchie.
- **#62** : voir la décision 2 et la contrainte de voisinage de la décision 5.

## Ce que cet ADR ne tranche pas

- **La hiérarchie du rail** — c'est #45.
- **Le contenu du récapitulatif au SCU près** : quelles colonnes, quel niveau de détail par jambe.
  Détail d'implémentation, à régler dans la PR.
- **La disposition responsive** de la vue sous 1280 px, qui suivra les mêmes règles que les tableaux
  (voir #81).
- **Aucun calcul.** C'est un déménagement d'interface : les chiffres ne changent pas.
