# ADR-014 : Une cargaison se charge en caisses d'UNE seule taille, et cette taille est choisie

**Statut :** Accepté — **supersède** la conception « Frais d'autoload » du 2026-08-10 sur son
hypothèse n°1, et elle seule.
**Date :** 2026-08-23
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #193 · **Jalon :** v2.2.0 — Le journal de bord
**Voisins :** la conception du 2026-08-10 (la grille 150/30/20), ADR-009 (la veille du journal de
jeu, d'où viennent les 101 achats), ADR-004 et son amendement (la frontière du Plan de vol)

## Contexte

Depuis le 2026-08-10, l'application déduit le nombre de caisses d'un chargement à partir de deux
nombres : le volume et le **plafond du terminal**. `scuBoxes(n, maxBox)` fait un remplissage
glouton, plus grosse caisse d'abord, et le reste retombe en petites caisses jusqu'à 1 SCU.

C'est faux, et le dépôt le démontrait déjà contre lui-même.

### L'argument qui ne dépend d'aucune donnée nouvelle

La conception du 2026-08-10 annonce ses deux stations « toutes deux `max_container_size = 32` »
(spec:26), puis tabule **12 relevés sur 18 en caisses de 8, 16 ou 24** (spec:32-44). Un comptoir
plafonné à 32 ne *produit* pas une caisse de 8 : la spec a fait varier la taille comme **variable
d'expérience**, puis l'a modélisée comme une **dérivée du terminal**.

Sa propre fixture le confirme : elle appelle `autoloadFee(r.boxSize * r.count, r.boxSize, r.k)`
(`logic.test.mjs:542`) — elle **fournit** la taille observée. Les « moins de 3 % d'écart » validaient
donc la grille tarifaire **à nombre de caisses connu**, jamais le remplissage glouton.

### Ce que le code fait aujourd'hui — mesuré, pas supposé

| Constat | Ancrage | Mesure |
|---|---|---|
| Le glouton fabrique des caisses que personne ne charge | `logic.ts:428-437` | `scuBoxes(95, 32)` rend **six** caisses : 2×32, 1×24, 1×4, 1×2, 1×1 |
| Donc l'app surfacture un volume non rond | `logic.ts:470-478` | `autoloadFee(95, 32, 1)` = **2 230** aUEC ; en caisses de 32 uniformes, 2 140 |
| Et la facture n'est même pas monotone | `logic.test.mjs:614` | `autoloadFee(31,32,1)` = **890** > `autoloadFee(32,32,1)` = **820** : un SCU de moins coûte 70 aUEC de plus — et c'est **gravé comme un contrat** |
| Le relevé de station porte le vice | `logic.ts:485-489`, `frais-actions.ts:37` | `kFromReading(720, 24, 32)` = **1,091** pour le relevé d'Endgame, la station qui **définit** k = 1. À la taille réellement employée (8), il rend exactement **1** |
| L'écran nomme des tailles imaginaires | `format.ts:51` | `scuBoxesLabel(95, 32)` écrit « 2×32 · 1×24 · 1×4 · 1×2 · 1×1 » |

### Ce que 101 achats réels confirment

Relevés dans les `Game.log` du propriétaire (13 sessions, mai à août 2026, 10 comptoirs, #192) :
**101 achats sur 101 emploient une seule taille de caisse.** Jamais un assortiment. Et le même
comptoir en voit passer sept (32, 24, 16, 8, 4, 2, 1). Contre-exemple le plus net : **624 SCU en
39 caisses de 16**, là où le glouton en prédit 20 — **+4,31 %** sur la facture (13 230 → 13 800 aUEC
à k = 1), sur un modèle annoncé juste à 3 % près.

### Ce qui reste vrai, et qu'on ne touche pas

Sur ces mêmes 101 achats, `price` égale `shopPricePerCentiSCU × quantity` **au aUEC près, 100 fois
sur 101**. Les frais d'autoload ne sont pas noyés dans le prix des marchandises — la séparation que
`manifestTotals` opère depuis le début est la bonne.

## Décision

### 1. La taille de caisse est une ENTRÉE, jamais une dérivation

`caissesDe(n, taille)` remplace `scuBoxes(n, maxBox)` : une cargaison part en caisses **toutes de la
même taille**, la dernière éventuellement partielle. `[{ size: taille, count: ceil(n / taille) }]`,
au plus **une** entrée, quelle que soit `n`.

### 2. L'invariant change de nature, et il faut le dire

« La somme des caisses redonne N » devient **faux par construction** dès qu'une caisse est
partielle. Il est remplacé par un invariant de **capacité** : `taille × count ≥ n`, et
`taille × count − n < taille` — on couvre le volume sans gaspiller une caisse entière.

### 3. `Terminal.maxBox` est conservé, et requalifié

Ce n'est plus le décideur du découpage : c'est **la plus grosse caisse que ce comptoir accepte**,
donc la taille retenue **par défaut** et un **majorant**. Le champ garde son nom sur le terminal ;
c'est le point de frais qui change de sens, et `PointFrais.maxBox` devient `PointFrais.taille`.

### 4. Le relevé de station porte désormais la taille employée

Un troisième champ, `#alBox`, rejoint le montant et le volume, **prérempli à `terminal.maxBox`**.
Sans lui, `kFromReading` met le découpage *supposé* au dénominateur et le k « relevé » mesure la
station **multipliée par l'erreur de caissage**. Les relevés déjà persistés ne sont pas recalculés :
ils s'affichent « taille non renseignée ».

### 5. Le repli reste optimiste

Quand la taille est absente, nulle, négative ou non finie, on retombe sur 32. C'est le comportement
déjà documenté (`logic.ts:422-426`) et il faut le garder : il **sous-estime** les frais au lieu de
les inventer, ce qui est le sens prudent que l'application a choisi partout ailleurs.

*Écarté : garder le remplissage glouton et ne corriger que l'affichage.* Le montant est faux, pas
seulement son explication — et `logic.test.mjs:499` verrouille précisément l'accord entre les deux.

*Écarté : exposer un choix de taille à l'utilisateur dans cette décision.* C'est une question de
**produit**, pas de code : ce serait un quinzième réglage, il entrerait dans le permalien et dans
les hypothèses du Plan de vol. Le défaut « la plus grosse caisse que ce comptoir accepte » suffit à
livrer la correction. La question se rouvrira quand le plafond par commodité existera — c'est
seulement là qu'un menu pourra proposer les tailles **réellement** offertes.

*Écarté : ranger le plafond par commodité dans le même lot.* Vérifié contre l'API UEX ce jour :
`commodities_prices_all` rend 2 593 lignes dont **2 579 portent un champ `container_sizes`**, que
`scripts/build-data.mjs` télécharge à chaque construction puis **jette** (0 occurrence). **103 des
123 comptoirs (84 %) exposent plusieurs listes**, jusqu'à sept sur un seul, et `max(container_sizes)`
est strictement inférieur au `max_container_size` du terminal **597 fois sur 2 579 (23 %)**, jamais
supérieur. C'est donc faisable sans nouvelle source — mais ça change le schéma de `market.json`,
donc ça vit dans sa propre PR, précédée d'une mesure de performance.

## Conséquences

- **105 occurrences de `maxBox`** sur 18 fichiers sont concernées, mais **aucune signature de moteur
  ne bouge** : la taille continue de voyager par `PointFrais`, exactement comme `maxBox`
  aujourd'hui. `routeMetrics`, `loopMetrics`, `enRouteDeals`, `chainLegNet` et `feeResolver` gardent
  leur forme au caractère près.
- **Huit assertions sont des photographies du glouton** et sont réécrites délibérément, dont
  `logic.test.mjs:614` qui gravait la non-monotonie comme une règle du jeu. Elles sont énumérées
  dans la PR, une par une, avec ce qu'elles disaient et ce qu'elles disent.
- **Les frais baissent** pour tout volume qui n'est pas un multiple exact de la taille, et **montent**
  pour un volume qui tenait dans un assortiment plus fin. Deux compteurs d'instantané
  (`logic.test.mjs:4135` et `:4328`) mesurent le classement des routes : s'ils bougent, c'est une
  information sur l'ampleur du changement — à rapporter, jamais à ajuster à la main.
- **Une hypothèse assumée, non mesurée** : une caisse partielle se facture plein tarif. Les 18
  relevés de la spec et le contre-exemple des 624 SCU sont tous des multiples exacts de leur taille ;
  aucune donnée disponible ne tranche. Elle rejoint les hypothèses 1 et 2 de la spec du 2026-08-10,
  avec la même clause : **à réviser si le jeu la contredit**.

## Ce que cet ADR ne tranche pas

- **L'exposition d'un choix de taille à l'utilisateur** — question de produit, laissée ouverte (#193).
- **Le recalcul des coefficients déjà persistés** : ils ont été relevés sous l'ancien découpage, donc
  possiblement faux. On ne les touche pas sans savoir quelle taille était employée.
- **L'appariement des `shopName` du jeu (`SCShop_Admin_lt_base_g`) avec les noms UEX**, explicitement
  non tranché depuis ADR-009.
- **L'alimentation du plafond par le journal du jeu** plutôt que par UEX : les deux sources existent,
  `container_sizes` est simplement la moins chère à brancher.
