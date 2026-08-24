# ADR-016 : Un temps de chargement s'affiche mesuré, ou pas du tout

**Statut :** Accepté — n'en supersède aucun. Complète la conception « Frais d'autoload » du
2026-08-10 sur une dimension qu'elle ne traitait pas : le TEMPS.
**Date :** 2026-08-24
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #192 · **Jalon :** v2.2.0 — Le journal de bord
**Voisins :** ADR-009 (la veille du journal de jeu), ADR-014 et ADR-015 (le caissage), la conception
du 2026-08-10 (la grille 150/30/20)

## Contexte

Un fret qui rapporte 15 % de plus mais qui immobilise huit minutes de plus à quai n'est pas le
meilleur fret, et rien dans l'application ne le disait. L'issue #192 proposait de chronométrer
l'autoload, et posait une hypothèse dont elle faisait explicitement le **premier travail du
ticket** : si le journal de jeu porte une trace de début et de fin de chargement, le chrono n'a pas
à être un bouton — « la durée se lit, elle ne se presse pas ».

### La mesure : le journal ne porte AUCUNE durée

Faite le 2026-08-24 sur **158 journaux** (`Game.log` + 157 archives), dont **19 contiennent au moins
un achat en autoload**, pour **88 achats** portant `autoLoading[1]`.

Toute occurrence du mot, quelle que soit la casse, sur l'ensemble des journaux :

| forme | occurrences |
|---|---:|
| `autoLoading` — le **drapeau** de la requête d'achat / de vente | 222 |
| `CEntityComponentCommodityUIProvider::UpdateAutoLoadingTransactionDetails` | **1**, et c'est un `[Error]` : « Box size and Units not found! » |

**Ni évènement de début, ni évènement de fin, ni progression.** Le drapeau dit que la transaction
*demande* un chargement automatique ; rien ne dit qu'il commence, avance ou s'achève.

Contre-épreuve : balayage de **tout** ce que le jeu écrit dans les **180 secondes** suivant chacun
des 88 achats. Aucun n'est suivi du silence, mais rien n'y concerne la soute — le kiosque se
rafraîchit (`AddingCommodityBox`, groupé dans la même milliseconde), la machinerie de shard tourne
(`ContextEstablisher*`, `Seed*`, dont le délai minimal de 41 s montre qu'elle suit le hasard des
sessions et non l'achat), le décor bat (`CSCLoadingPlatformManager::*`, pour les élévateurs de fret
de Stanton, Nyx et Levski), et l'inventaire **du joueur** se recharge. Rien qui porte une sémantique
de durée.

**Cette recherche est close.** Elle a coûté un balayage complet de l'archive ; la reprendre demande
une raison — un patch qui ajouterait ces évènements, par exemple —, pas un doute.

## Décision

**1. Le chrono est un bouton, et il ne tique pas.**
`▶` au lancement du chargement, `⏹` quand la soute est pleine. Pas d'horloge animée : la mesure est
la différence entre deux instants, et un affichage qui s'anime coûterait un minuteur dans une
application qui re-rend déjà beaucoup, pour zéro précision de plus.

*Écarté : lire la durée au journal.* La mesure ci-dessus l'interdit.

**2. Rien ne s'affiche pour une station non mesurée.**
Ni estimation, ni formule, ni extrapolation depuis une autre station. Le panneau dit qu'il n'a rien,
et pourquoi.

C'est la différence de nature avec le tarif, et elle est le cœur de cet ADR : **un tarif est une
GRILLE**, qu'on retrouve à l'aUEC près et dont la station n'est qu'un multiplicateur ; **un temps est
une PERFORMANCE**, bruitée par la charge du shard — la même cause qui rend déjà la saturation d'un
comptoir non modélisable. On ne peut pas traiter les deux pareil.

**3. À une seule mesure, la dispersion vaut `null` — jamais 0.**
Un « ±0 s » ferait passer un relevé unique pour une certitude, ce qui est l'inverse de ce que ce
champ existe pour dire. Au-delà, c'est l'**écart-type d'échantillon** (n−1) : nos relevés sont un
échantillon d'une population bruitée, jamais la population.

**4. Le relevé fait foi, pas la moyenne qu'on en tire.**
On persiste **durée + SCU + taille de caisse + nombre de caisses + date**, par station et en LISTE.
Une moyenne pré-digérée serait devenue illisible le jour où la grille de temps du jeu changerait —
même règle que les relevés de tarif, pour la même raison.

*Écarté : un seul relevé par station, comme pour le tarif.* Un temps est bruité : une mesure ne dit
presque rien, et c'est la dispersion de plusieurs qui porte l'information.

**5. Les débits se prennent en TOTAL SUR TOTAL, jamais en moyenne de rapports.**
Moyenner les rapports donnerait le même poids à un relevé de 4 SCU qu'à un de 400.

**6. Un store à part, et une borne qui DEMANDE au lieu de refuser.**
Au-delà d'une heure, le geste fait confirmer : c'est le seul accident qui produise une durée
d'apparence honnête — le chronomètre laissé courir pendant qu'on joue. Comme `K_PLAUSIBLE`, la borne
n'affirme rien sur la vitesse des comptoirs jamais mesurés, et elle ne refuse rien.

## Conséquences

- **Aucun classement ne bouge.** Le temps n'entre ni dans le profit, ni dans le profit/heure, ni
  dans le tri. « Rapporte le plus par heure » plutôt que « par voyage » est la suite logique, et
  c'est un autre ticket : il n'a de sens qu'une fois des temps mesurés.
- **La campagne de mesure est le livrable.** Ce lot fabrique l'instrument, pas le modèle. La forme
  candidate — `temps ≈ kt × (base + parCaisse × nbCaisses + parScu × SCU)` — reste une hypothèse que
  seuls des relevés pourront confirmer ou casser.
- **Le panneau décrit UN chargement observé.** Le chrono réutilise `#alScu` et `#alBox` plutôt que
  d'ouvrir deux champs de plus : deux quantités dans le même panneau finiraient par se contredire.
  Conséquence assumée : mesurer le temps d'un chargement et le tarif d'un autre demande deux
  passages.
- **Le chrono N'EST PAS dans la `key` du panneau.** L'y mettre remonte le composant au démarrage, et
  les champs non contrôlés repartent à leur `defaultValue` : on tape 64 SCU, on presse `▶`, et la
  mesure se persiste pour 32 sans que rien à l'écran ne le démente. Le défaut a été trouvé par
  l'e2e, pas par relecture — et il est désormais gardé par un test.

## Ce que cet ADR ne tranche pas

- **La formule du temps.** Il n'en propose aucune : seulement une forme à tester et de quoi la
  nourrir.
- **Le déchargement**, alors que `autoloadFee` facture bien les deux extrémités. Il suit
  probablement la même loi ; ce n'est pas mesuré non plus.
- **Combien de relevés avant de se fier à une moyenne.** L'application les montre tous et affiche la
  dispersion : c'est au lecteur de juger, et c'est plus honnête qu'un seuil arbitraire.
