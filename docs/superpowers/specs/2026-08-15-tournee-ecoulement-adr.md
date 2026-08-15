# ADR-007 : La tournée d'écoulement — vider la soute en un minimum d'arrêts

**Statut :** Accepté
**Date :** 2026-08-15
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #57 · **Jalon :** v1.1.0

## Contexte

Je rentre d'une sortie : des caisses ramassées un peu partout, une soute qui porte sept ou huit
commodités dont je n'ai payé aucune. Ce que je veux n'est pas de savoir où chacune vaut le plus
cher — c'est **la suite d'arrêts qui vide tout, en faisant le moins de sauts possible**.

Un comptoir qui reprend trois de mes commodités à prix moyen bat donc un comptoir qui n'en reprend
qu'une au meilleur prix. C'est l'inverse exact de ce que l'app sait faire aujourd'hui.

### Pourquoi ce n'est pas « où écouler »

`offloadPlan` (`logic.mjs:1964`) répond à « **où mon résidu vaut-il le plus ?** » et classe par
profit. Ce n'est pas un défaut : c'est une décision écrite en toutes lettres au-dessus de la
fonction — *« il suppose que VIDER LA SOUTE est l'objectif. Ce n'est pas l'objectif : gagner de
l'argent l'est. »* — et gravée par un test.

Le dépôt a **déjà tranché deux fois en sens opposés** : `68fc1f7` a classé sur l'encaissement,
`d41d9cd` a rétabli le profit. Le message de `68fc1f7` nommait ce chantier-ci d'avance : *« Non
retenu de la spec : la refonte en tournée multi-escales […]. C'est un autre modèle, qui mérite sa
propre décision. »* C'est cette décision-là.

> **Les deux vues coexistent parce qu'elles répondent à deux questions incompatibles.**
> « Où écouler » demande *combien puis-je en tirer* ; la tournée demande *comment m'en débarrasser*.
> Un seul classement ne peut pas servir les deux — et le bricolage d'un compromis est précisément
> l'aller-retour que le dépôt a déjà payé une fois.

**L'écran doit le dire**, pas seulement le code : sans une phrase qui distingue les deux, l'app se
contredit sous les yeux de l'utilisateur, qui lit deux classements opposés du même fret.

## Décision

### 1. L'ordre est LEXICOGRAPHIQUE STRICT

Dans cet ordre, sans pondération ni seuil :

1. **SCU restant à bord**, croissant — une tournée qui ne vide pas n'a pas fait le travail ;
2. **Nombre d'arrêts**, croissant — la demande explicite ;
3. **Changements de système**, croissant — le seul palier de distance que les données permettent de
   tenir honnêtement (voir §4) ;
4. **Encaissement**, décroissant — et **non le profit** : à ce stade le prix payé est coulé et
   identique quelle que soit la destination, il ne peut rien départager. Sur une soute **mixte**, le
   trier comparerait des bases de coût hétérogènes et pénaliserait la ligne réellement achetée, donc
   la destination qui l'écoule. Le profit reste **affiché**, et `sousLePrixPaye` continue de
   signaler le rouge : **informer n'est pas classer**.

**La tournée la plus courte gagne donc toujours.**

### 2. …mais l'alternative « un arrêt de plus » est affichée, chiffrée

La meilleure tournée à un arrêt supplémentaire s'affiche **en second**, avec son écart :
« *un arrêt de plus : +3,60 M, +5,7 %* ».

C'est le cœur de l'arbitrage, et il se justifie par les chiffres. Sur une sortie butin réelle en
Pyro (886 SCU, 7 lignes, tout à `paid = 0`) :

| | Tournée | Arrêts | Encaissement | Écart / T1 |
|---|---|---:|---:|---:|
| **T1** | Ruin Station seul | **1** | 62,64 M | référence |
| **T2** | Jackson's Swap → Ruin Station | 2 | 66,24 M | **+3,60 M (+5,7 %)** |
| **T3** | Seer's Canyon → Ruin Station | 2 | 63,16 M | +0,52 M (+0,8 %) |
| **T4** | chaque ligne à son meilleur prix | **5** | 69,47 M | +6,84 M (+10,9 %) |

**Aucune ne domine.** T1 gagne sur les arrêts, T4 sur l'argent, T2 offre le meilleur rapport — et
**T3 est la pire des deux mondes**, un arrêt de plus pour +0,8 %, alors que c'est exactement celle
que produit la lecture littérale de « prendre d'abord celle qui en a le plus ».

> **Re-vérifié le 2026-08-15 sur le `data/market.json` du dépôt**, parce qu'un contre-exemple gravé
> dans un ADR se périme avec ses données : 886 SCU au total, Ruin Station reprend **7 lignes sur 7**
> pour **62,64 M**, Jackson's Swap **1 sur 7** pour 22,80 M, Seer's Canyon **1 sur 7** pour 3,40 M.
> T2 et T3 retombent au chiffre près. Aucun nombre de ce tableau n'est repris de confiance.

*Écarté : un seuil (« accepter un arrêt de plus au-delà de +5 % »).* Ce serait un paramètre
invérifiable et faux pour quelqu'un : l'app ne peut pas savoir si tu as le temps, si c'est sur ton
chemin, ou si tu veux juste te coucher. Montrer les deux rend l'arbitrage à qui a le contexte.

*Écarté aussi : une bascule « moins d'arrêts / plus d'argent ».* Elle ferait **trois** classements
du même fret dans l'app, avec « où écouler ». Deux suffisent, à condition de les nommer.

### 3. Glouton par couverture maximale, rejoué après chaque arrêt

Le problème est une **couverture d'ensemble avec capacités et multiplicités**, doublée d'un
ordonnancement. Le cousin honnête est SET COVER (Karp, 1972), inapproximable en deçà de
`(1−o(1))·ln n` sauf si P = NP (Feige, 1998) — et **le glouton par couverture maximale atteint
exactement cette borne**. Ce n'est pas un pis-aller : c'est l'optimum de ce qu'on peut espérer en
temps polynomial. À 7 lignes, `ln(7) ≈ 1,95`.

La moitié « ordonnancement » est **dégénérée ici**, et c'est la bonne nouvelle : sans matrice de
distances (§4), ordonner un ensemble déjà choisi se réduit à un tri. Tout le NP-difficile est dans
le **choix** des comptoirs — exactement la métrique que la demande énonce.

### 4. « Au plus vite » ne se compte pas en minutes, et il ne faut pas faire semblant

Vérifié : `data/routes.json` compte 316 routes mais **161 seulement portent une distance non
nulle** ; `market.json` (114 terminaux) n'a **aucune coordonnée** — `distance: 0, // distance exacte
indisponible hors routes.json` ; `data/starmap.json` n'a que **17 ancres**, au grain du corps, pour
le dessin.

Le seul coût mesurable est donc le **nombre d'arrêts**, augmenté du booléen inter-système (`cross`,
`logic.mjs:2032`). Inventer des minutes serait une fausse précision, et cet ADR l'interdit.

### 5. `offloadPlan` est PARAMÉTRÉ, jamais dupliqué

Deux ajouts, en paramètre — dupliquer la fonction entretiendrait deux classements divergents,
exactement le défaut que le dépôt corrige ailleurs :

- **un drapeau « inclure l'origine »** : `logic.mjs:1986` fait `if (idx === originIdx) return;`.
  C'est juste pour « où écouler ailleurs » et **faux pour une tournée** — la station où l'on se
  trouve peut être le meilleur premier arrêt, à coût de déplacement nul : on vient justement d'y
  ramasser le butin. Le drapeau n'est vrai qu'au **premier** tour ;
- **un comparateur injectable** : `logic.mjs:2041-2043` trie par profit. Le tri par profit **reste
  le défaut**, la tournée injecte le sien.

### 6. Le résidu se construit sur `lignes`, JAMAIS avec `sellAllAt`

C'est le point d'implémentation le plus facile à rater. `sellAllAt` semble faite pour enchaîner les
arrêts ; elle **ne plafonne pas par la capacité** et **n'applique aucun filtre de vue**. Mesuré :

```
offloadPlan  : absorbe 500 garanti 500 reste 1670     (capacité connue = 500)
sellAllAt    : vendu 2170 -> reste à bord 0           (la capacité n'est pas lue)

offloadPlan legalOnly : 0 destination(s)
sellAllAt   legalOnly : 1 vente(s)                    (aucun filtre)
```

Une tournée bâtie dessus annoncerait des arrêts plus courts que la réalité et vendrait des
commodités que les filtres viennent d'écarter. Le résidu se construit **ligne par ligne**, sur
`absorbe`, que `offloadPlan` a déjà plafonné.

### 7. Plafonds, et pourquoi ils sont là

- **5 arrêts** au maximum, sortie anticipée dès que la soute est vide ou qu'aucun terminal
  n'absorbe plus rien. Au-delà, ce n'est plus « tout écouler au plus vite ».
- **Portée par défaut = le système courant** (27 terminaux en Pyro, 80 en Stanton, 7 en Nyx sur
  114), avec un bouton explicite « ouvrir aux autres systèmes » qui fait apparaître le saut comme
  **une ligne de coût visible**.
- **Jamais d'énumération exhaustive** : à 3 arrêts déjà, C(27,3) = 2 925 sous-ensembles en Pyro et
  C(80,3) = 82 160 en Stanton — et il faudrait encore ordonner chacun.
- **Faisceau étroit** (k = 3 premiers candidats déroulés) **seulement si** le glouton myope déçoit.
  Précédent maison admis : `bestChain(..., { beam: 400 })`.
- **Coût mesuré, pas redouté** : glouton complet en portée Pyro **0,13 ms**, `offloadPlan` sur les
  114 terminaux **0,37 ms**. La `Map` nom → commodité qui supprimerait le `market.commodities.find`
  niché reste une bonne idée, elle devient nécessaire avec un faisceau — **ce n'est pas un
  prérequis**, et il ne faut pas la vendre comme tel.
- **Affichage plafonné aux 12 plus grosses lignes** en valeur écoulable ; le calcul est linéaire en
  H, c'est la lisibilité qui souffre. Les lignes écartées restent visibles en pied de tournée.

### 8. La tournée est un PLANCHER sur le nombre d'arrêts, et doit le dire

**307 des 1 879 points de vente publient leur capacité, soit 16,3 %** (contre 100 % côté achat).
`offloadPlan` est délibérément optimiste quand la capacité est inconnue et expose `certitude`
(`connue` / `partielle` / `inconnue`).

> **Conséquence à écrire noir sur blanc à l'écran : le nombre d'arrêts annoncé est presque toujours
> faux vers le bas.** Ce n'est pas un itinéraire engagé, c'est un plan **recalculé après chaque
> arrêt réel**.

Ce qui tombe juste : le cycle chargé → vendu → étape suivante produit déjà la soute résiduelle qu'il
faut réinjecter. **Ne jamais afficher un total de tournée sans dire s'il est garanti ou parié.**

## Conséquences

### Cas limites tranchés ici

- **Commodité que personne n'achète dans la portée** — massif, pas marginal : **15 commodités sur
  113 n'ont aucun débouché dans Pyro**, 29 dans Nyx, 7 dans Stanton. Ces lignes sont **sorties du
  calcul de couverture avant la boucle** et **nommées** (« 2 lignes ne s'écoulent nulle part dans
  Pyro »), sinon on annonce une soute vidée qui ne l'est pas. Trois issues, dans cet ordre : ouvrir
  la portée, **déposer** (`storeFromHold`, la troisième sortie existe déjà), garder à bord. Le dépôt
  n'est proposé qu'au **dernier** arrêt.
- **Comptoir saturé** — statut UEX 7 à capacité nulle, déjà écarté (`logic.mjs:2007`). Re-mesuré le
  2026-08-15 : **13 points de statut 7, dont 0 à capacité non nulle** — l'équivalence tient toujours
  dans les deux sens. *(Le commentaire de `logic.mjs:2001` en annonce 12 : le chiffre a vieilli avec
  les données, l'équivalence non. À rafraîchir dans la PR d'implémentation.)* Un saturé pris pour
  « illimité » ruinerait toute la tournée.
- **Repasser deux fois au même comptoir** — **interdit, et dit**. La capacité repousse par ticks en
  jeu, mais l'app n'a aucune donnée sur le débit de recharge (recherche close le 2026-08-12 : les
  inventaires ont quitté les fichiers du jeu au patch 3.20). Attendre un tick n'est pas « tout
  écouler au plus vite ». Le résidu ressort en « reste à bord », pas en second passage fantôme.
- **Pas d'origine** — `stationCourante()` rend `null` sans voyage ni terminal « En route ». La vue a
  donc **son propre sélecteur de station**.

### Sur le reste du dépôt

- **La porte d'entrée manuelle vers la soute existe déjà.** L'issue #57 la réclamait en affirmant
  qu'aucune n'existait ; **#55 l'a livrée** (`+ déclarer ce que j'ai à bord`, avec le prix payé, 0
  par défaut pour du butin). Cette prémisse de l'issue est **périmée** — c'est autant de travail en
  moins, et un rappel que ses ancrages de ligne sont à re-vérifier comme les autres.
- **Huitième vue au rail**, placée en fin de liste comme le Plan de vol, et **révisable par #45** qui
  refond la hiérarchie dans le même jalon. Le piège reste le même : la **liste blanche de
  restauration** (`applyState`, `app.js`) — sans ajout, la vue ne revient ni d'un permalien ni du
  localStorage.
- **Tout tenir dans `app.js` / `logic.mjs`** : un fichier neuf obligerait à toucher `sw.js` (`SHELL`),
  `scripts/csp.test.mjs` et `.github/workflows/update-data.yml`.
- **Le modèle de frais pénalise déjà les tournées longues**, tout seul : la base d'autoload est
  facturée **par commodité**, donc éclater la même soute sur trois arrêts multiplie les bases et
  recompte les caisses. À condition que l'interrupteur soit actif — sinon `feeResolver` rend `null`
  et il n'y a aucun frais nulle part.

### Pour les tests

**Les trois destinations divergentes du contre-exemple (Jackson's Swap, Seer's Canyon, Fallow Field)
sont toutes des avant-postes.** Cocher « exclure les avant-postes » effondre T2, T3 et T4 sur T1 :
toute démo ou tout test de cet arbitrage doit se faire **avec les avant-postes activés**, sinon le
cas intéressant n'existe pas.

Base directe : le marché-jouet `MARCHE_ECOULER` et le helper `fEcouler` de `logic.test.mjs`, plus
les huit tests `offloadPlan` déjà écrits.

## Ce que cet ADR ne tranche pas

- **La hiérarchie du rail** — c'est #45.
- **Le faisceau** : prévu, conditionnel, à n'introduire que si le glouton myope déçoit sur des cas
  réels. Pas d'optimisation préventive.
- **La `Map` nom → commodité** : bonne idée, pas un prérequis.
- **#22** (annuler un chargement écrase la déduction d'une autre jambe) et **#21** (soute vidée
  autrement que par « annuler ») : la tournée lit la soute, elle n'en corrige pas la tenue.
