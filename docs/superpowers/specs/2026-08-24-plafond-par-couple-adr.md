# ADR-015 : Le plafond de caisse vaut par (comptoir, commodité), et le tuple de marché fait 5 OU 6 champs

**Statut :** Accepté — **complète** l'ADR-014 sur sa question laissée ouverte n°2 (« d'où vient la
taille ? »), sans rien y contredire.
**Date :** 2026-08-24
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #194 · **Jalon :** v2.2.0 — Le journal de bord
**Voisins :** ADR-014 (une cargaison, une seule taille), la conception du 2026-08-10 (la grille
150/30/20), ADR-009 (la veille du journal de jeu)

## Contexte

L'ADR-014 a tranché *combien* de tailles compose une cargaison — une seule — et a explicitement
laissé ouverte la question de savoir **d'où** cette taille vient. Faute de mieux, elle venait de
`Terminal.maxBox`, c'est-à-dire du `max_container_size` qu'UEX publie **par terminal**.

Ce n'est pas là que la donnée vit. UEX publie aussi `container_sizes` sur la **ligne de prix** —
donc par couple (terminal, commodité) — et `scripts/build-data.mjs` la téléchargeait depuis toujours
sans rien en garder : `grep container` n'y trouvait que `max_container_size`.

### La mesure

Re-faite le 2026-08-24 sur l'API UEX, 2 593 lignes de prix dont **2 579 portent `container_sizes`** :

| mesure | valeur |
|---|---:|
| `max(container_sizes)` **égal** au `max_container_size` du terminal | 1 982 |
| **strictement inférieur** | **597 (23 %)** |
| **supérieur** | **0** |
| listes à **trous** (« 8,16,24,32 » sans 1/2/4) | 210 |
| comptoirs publiant **plusieurs** listes | **103 sur 123 (84 %)** |
| maximum de listes distinctes sur un seul comptoir | **7** (Ashland) |

Deux conséquences, et elles ne sont pas de même nature.

`Terminal.maxBox` est un **majorant exact, jamais un plafond réel** : il n'est jamais dépassé, mais
il est strictement trop grand sur près d'un quart des points de marché. L'application y prêtait au
joueur des caisses plus grosses que ce que le comptoir propose, et **sous-estimait les frais**
d'autant. Ashland en donne le cas extrême : plafond terminal de 24, mais une commodité offerte en
caisses de **2** — douze fois moins de caisses facturées qu'en réalité.

Et surtout : **aucun plafond par terminal ne peut décrire un manifeste multi-commodité.** Quatre
lignes chargées au même comptoir peuvent relever de quatre tailles différentes. Ce n'est pas une
imprécision qu'on resserre, c'est un modèle qui ne tient pas.

## Décision

**1. Le pipeline publie la taille du couple, en 6ᵉ position du tuple de marché.**
`tailleDeCaisse(p)` rend `max(container_sizes)`, des deux côtés (achat **et** vente).

*Écarté : ranger la liste entière.* C'est la donnée fidèle, mais rien ne la consomme — le moteur ne
sait choisir qu'une taille, et l'ADR-014 a écarté d'exposer un choix. On aurait payé le poids du
fichier et la complexité de lecture pour une capacité que personne n'appelle. **La dette est écrite
ici** : le jour où un réglage exposera un choix, il devra proposer la liste réellement offerte — les
210 lignes à trous le rendent obligatoire — et un simple nombre ne saura pas la porter.

**2. Un tuple publié fait 5 OU 6 champs, jamais un `null` de remplissage.**
Le 6ᵉ champ n'est écrit que s'il est connu (14 lignes sur 2 593 ne le portent pas).

*Écarté : toujours écrire six champs, avec 0 ou `null` pour l'inconnu.* Une sentinelle oblige chaque
lecteur à la connaître, et le premier qui l'oublie facture des caisses de zéro SCU. **C'est
l'absence qui porte le sens**, et elle est infalsifiable. Le coût est un invariant qui se **déplace**
au lieu de se contourner : `build-data.test.mjs` exigeait « tous de longueur 5 », il exige désormais
« 5 ou 6, et si 6 alors une vraie taille ».

**3. La lecture passe par UN seul point : `tailleOfferte` (`logic.ts`).**
Elle rend `undefined` pour l'absence **comme** pour un 0 publié.

**4. Le repli est le majorant du terminal, puis 32.**
Même règle que la décision 5 de l'ADR-014 : **le repli sous-estime, il n'invente pas.** La mesure
l'autorise — `max(container_sizes)` ne dépasse jamais `max_container_size`, 0 fois sur 2 579 — donc
retomber sur le terminal ne peut que sous-facturer, jamais surfacturer.

**5. La taille vit sur la LIGNE de manifeste, pas sur le point de frais.**
`PointFrais` décrit ce qu'**un comptoir** facture ; la taille dépend du couple. La poser sur le point
aurait forcé un point par (comptoir, commodité) et rendu impossible le seul cas qui motive tout
l'ADR : plusieurs tailles sous un seul comptoir. Les cinq fabriques de lignes la recopient du tuple,
et `lineHaulFee` la préfère à celle du point.

**6. Les vues MONO-commodité passent par un index `commodité|terminal → taille` (`marche.ts`).**
Trajets et Boucles ne lisent pas `market.json` mais `routes.json` / `loops.json`, qui ne portent que
des **noms**.

*Écarté : publier la taille dans `routes.json` et `loops.json`.* Ç'aurait été un second et un
troisième changement de schéma, chacun avec ses invariants et son instantané versionné, pour une
donnée que `market.json` porte déjà et que ces vues chargent de toute façon pour les frais.

*Écarté : deux paramètres positionnels de plus sur `feeCtx`.* Elle en portait déjà cinq. Le dépôt a
payé cette leçon sur `enTetePlan` (v2.1.0) : deux branches ajoutent chacune LEUR argument, et une
résolution de conflit naïve passe la mauvaise valeur au bon paramètre, **en silence**. C'est un
objet `{ buy, sell }` — et il en faut bien **deux**, parce qu'une boucle charge une commodité
différente à chacun de ses deux bouts.

## Conséquences

- **Les frais MONTENT** sur les couples plafonnés sous leur terminal, et ne bougent nulle part
  ailleurs. C'est le sens inverse de #195, et c'est normal : #195 retirait des caisses fantômes,
  #194 ajoute des caisses réelles.
- **Aucun compteur d'instantané ne bouge dans cette PR**, et ce n'est pas une bonne nouvelle : le
  `data/market.json` versionné ne porte pas encore de 6ᵉ champ (la CI ne re-commite jamais les
  `data/*.json`), donc la suite unitaire exerce le **repli**. Le chemin nominal n'est tenu que par
  l'e2e, qui injecte les tailles à la volée — et par les tests sur fixture. Les chiffres bougeront
  au prochain `chore(data)`, et il faudra les RE-MESURER, jamais les ajuster.
- **Le coût en performance n'est pas mesurable.** L'issue redoutait de devoir redescendre les points
  de frais dans la boucle des commodités ; ce n'était pas nécessaire — seule la **taille** varie par
  commodité, `k` reste par terminal, donc les points restent hissés et seule une substitution de
  deux champs a lieu. Mesuré contre le code d'avant sur un marché enrichi : ×0,66 à ×1,42 selon les
  passes, c'est-à-dire **noyé dans la variance**. Le rapport de la garde (`logic.test.mjs`) reste
  entre ×4,1 et ×6,0 contre un seuil de ×20.
- **Trois lecteurs doivent rendre le même décompte** — la facture, l'infobulle et le badge 📦 — d'où
  l'accesseur unique `tailleDuCouple`. Un quatrième lecteur qui rouvrirait la Map en direct serait
  le prochain bug.

## Ce que cet ADR ne tranche pas

- **L'exposition d'un choix de taille à l'utilisateur** — toujours ouverte, toujours écartée
  (ADR-014). C'est seulement maintenant qu'un menu pourrait proposer les tailles **réellement**
  offertes plutôt que la grille théorique : la donnée est là. La question reste du produit.
- **Les listes à trous** : on n'en garde que le maximum. Voir la décision 1.
- **Le rapprochement des `shopName` du jeu avec les noms UEX**, non tranché depuis l'ADR-009 — donc
  les 101 achats du journal ne peuvent toujours pas être confrontés automatiquement à
  `container_sizes`. La vérification reste manuelle.
