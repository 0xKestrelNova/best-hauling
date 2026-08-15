# ADR-009 : La veille du journal de jeu — ce que j'ai fait, le jeu l'écrit déjà

**Statut :** Accepté
**Date :** 2026-08-15
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #100 · **Jalon :** v2.1.0 — Le journal de bord

## Contexte

Nos données viennent d'UEX, et UEX périme. Mesuré le 2026-08-12 sur 2 592 relevés : **un point est
republié tous les 3,1 jours en médiane**, et seuls **29,9 %** ont un relevé de moins de 24 h. Tout
le dispositif de corrections — la vue Corrections, la péremption à 3 h de la conception du
2026-08-12, la soute déclarable de #55 — existe pour compenser ça **à la main**.

Or Star Citizen écrit dans `Game.log` tout ce que le joueur fait à un comptoir de commodités, en
clair, horodaté à la milliseconde. Ce n'est pas une hypothèse : c'est vérifié sur une installation
réelle en **`sc-alpha-4.9.0`** (`FileVersion 4.9.188.23497`, `Changelist 12344265`, compilé le
29 juillet 2026), sur **147 journaux archivés**.

### Ce que le journal contient, mesuré

```
<2026-05-25T00:36:28.431Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommodityBuyRequest>
  Sending SShopCommodityBuyRequest - playerId[…] shopId[284221459803] shopName[SCShop_Admin_lt_base_g]
  kioskId[284221459802] price[770740.000000] shopPricePerCentiSCU[34.408001]
  resourceGUID[48c7080a-bbef-43d2-901a-698321ed4340] autoLoading[0] quantity[22400.000000 cSCU]
  Cargo Box Data: boxSize[32.000000] | unitAmount[7] [Team_CoreGameplayFeatures][Shops][UI]
```

| Événement | Occurrences sur 147 journaux |
|---|---|
| `SendCommodityBuyRequest` | 99 |
| `SendCommoditySellRequest` | 114 |
| `RmToken_CommodityTransactionResponse` (niveau `[Error]`) | 15 |
| `LoadShopInventoryData` | 7 131 |
| `RequestLocationInventory` | présent avant **100 %** des 213 transactions |

`shopPricePerCentiSCU × 100` donne le prix au SCU ; multiplié par la quantité en cSCU il redonne
`price` **au aUEC près** sur tous les échantillons vérifiés. La ligne porte aussi la composition
exacte en caisses, et `autoLoading[0|1]` — que le dépôt modélise déjà côté frais.

### Ce que le journal ne contient pas

**Il n'enregistre que ce qu'on fait.** Ni le stock disponible, ni la demande restante, ni le prix
des commodités qu'on n'échange pas. Monter voir un kiosque sans y acheter ne laisse que des noms de
commodités et des tailles de caisse. C'est le périmètre de l'ADR-010, et c'est la raison pour
laquelle cet ADR-là existe.

Deux familles qu'on aurait aimé avoir et qui **ne sont pas là** : `<Jump Drive State Changed>` —
**0 occurrence sur 147 journaux**, donc pas de mesure des temps de trajet réels ; et les tailles de
caisse ne trahissent pas le stock — sur **245 triplets** (lieu, comptoir, commodité) et 7 131
lignes, **aucune ne varie dans le temps**. C'est une propriété statique du comptoir.

### Ce que l'état de l'art nous apprend

[`sc-trade-companion`](https://github.com/EtienneLamoureux/sc-trade-companion) (GPL-3.0 — on
s'inspire, on ne copie pas de code sous licence MIT) lit le journal depuis sa PR #86 de
décembre 2024. Son processeur exige `\[Team_NAPU\]\[Shops\]\[UI\]` en fin de ligne et n'a pas été
touché depuis le **2025-02-08**. Or la même famille de lignes porte `[Team_CoreGameplayFeatures]`
en 4.9. **Leur détection de comptoir est cassée, et personne ne s'en est aperçu** — parce qu'un
ancrage trop précis échoue en silence.

[`NexusApp`](https://github.com/T3SoD/NexusApp), maintenu (parseur de commodités mis à jour le
2026-08-05), exclut délibérément le tag d'équipe de ses motifs. `all-slain` versionne ses
gestionnaires par version de jeu. Les deux ont tiré la même leçon.

## Décision

### 1. Le journal se lit dans le navigateur, pas dans un compagnon natif

La File System Access API donne un accès en lecture au fichier, conservable entre sessions par un
handle en IndexedDB. Aucun second produit à construire, signer et mettre à jour ; le déploiement
Pages reste inchangé.

*Écarté : un compagnon local.* Meilleure ergonomie et OCR natif, mais c'est un deuxième logiciel,
Windows seul, et ça rompt le « zéro dépendance de production » qui structure le dépôt depuis le
début.

**Trois inconnues à lever avant la première ligne de code** — elles conditionnent la faisabilité et
aucune n'est vérifiée à ce jour :

1. **Chromium refuse-t-il un dossier sous `C:\Program Files` ?** Une liste noire de répertoires
   sensibles existe. Repli prévu : `showOpenFilePicker` sur le seul `Game.log`, qui ne demande pas
   de permission de dossier, et à défaut le glisser-déposer du fichier.
2. **Le fichier est-il lisible pendant que le jeu tourne ?** Star Citizen le tient ouvert en
   écriture ; tout dépend du partage qu'il accorde.
3. **La permission survit-elle au rechargement** sans redemander un geste utilisateur à chaque fois.

Si la première tombe et que les replis coûtent un geste par session, la décision est à rouvrir.

### 2. On n'ancre jamais un motif sur le tag d'équipe

C'est la leçon payée par `sc-trade-companion`. Les motifs s'ancrent sur l'horodatage, le nom de
classe (`CEntityComponentCommodityUIProvider`) et les champs nommés — jamais sur `[Team_…]`, qui a
démontrablement dérivé (`[Team_NAPU]` en mars 2025 → `[Team_CoreGameplayFeatures]` en 2026).

Corollaire : **un motif qui cesse de mordre doit se voir.** Chaque famille d'événements compte ses
correspondances ; zéro correspondance sur un journal qui contient la classe attendue est une
anomalie signalée, pas un silence.

### 3. Le catalogue des événements retenus, et lui seul

| Famille | Ce qu'on en tire |
|---|---|
| `SendCommodityBuyRequest` | commodité, prix/SCU, SCU, caisses, autoload, comptoir |
| `SendCommoditySellRequest` | idem, prix déduit de `amount ÷ quantity` — **il n'y a pas de `shopPricePerCentiSCU` côté vente** |
| `RmToken_CommodityTransactionResponse` (`[Error]`) | une transaction refusée, horodatée |
| `LoadShopInventoryData` | les commodités du comptoir et leurs tailles de caisse |
| `RequestLocationInventory` | la clé du lieu |

Tout le reste est ignoré. `CSCLoadingPlatformManager` seul pèse **172 533 lignes** — un pré-filtre
par `String.includes` avant toute expression régulière n'est pas une optimisation, c'est une
condition de fonctionnement.

### 4. `resourceGUID` → commodité : une table livrée avec le dépôt

Le journal désigne la commodité par un GUID et **rien n'y associe jamais un nom**. Sur les journaux
d'essai : 24 GUID distincts, **zéro ligne** portant à la fois un GUID et un `ResourceType`.

Deux méthodes maison ont été essayées et **ont échoué** : l'intersection des offres par comptoir
(4 résolutions sur 24, dont trois GUID différents tombant tous sur `ProcessedFood` — impossible), et
le croisement des prix observés contre UEX (3 sur 21). Elles sont documentées ici pour qu'on ne les
retente pas.

Ce qui marche : [`scunpacked-data/resources/commodities.json`](https://github.com/StarCitizenWiki/scunpacked-data),
206 entrées `UUID` → `Key`. **24 GUID sur 24 résolus.** La table est **figée dans le dépôt** — pas
récupérée au vol — parce qu'elle appartient au même régime que `data/*.json` : une amorce
régénérée dans son propre commit `chore(data): …`.

### 5. Lieu → terminal : une table d'appariement, contrôlée par un test

Ni `shopName` ni `shopId` ne désigne un terminal, et c'est contre-intuitif :

- **`shopName` est un gabarit.** `SCShop_Admin_lt_base_g` couvre **32 `shopId` distincts** — c'est
  l'archétype d'un bureau d'avant-poste, réutilisé partout.
- **`shopId` est éphémère.** Sur 178 identifiants observés, **173 n'apparaissent que dans une seule
  session**, 4 dans deux, 1 dans trois.

La clé est `<RequestLocationInventory> … Location[…]`, présente avant **100 % des 213 transactions**,
et le couple **(lieu, `shopName`)** désigne le guichet sans ambiguïté. Les 21 clés observées sont
lisibles : `RR_HUR_LEO`, `RR_ARC_L1`, `RR_P6_L5`, `RR_JP_PyroStanton`, `Stanton4_NewBabbage`,
`Nyx_Levski`…

L'appariement vers nos 114 terminaux est **une table écrite à la main**, d'une trentaine de lignes.
*Écarté : le dériver de scunpacked* — son `trade_locations.json` (965 entrées) n'apparie que **37 de
nos 114 terminaux** par nom affiché, et rate justement Rod's Fuel, les Shubin SM0-xx et les portails.

Ce qui rend la table défendable, c'est qu'elle **se vérifie toute seule** : chaque transaction
portant une commodité et un prix, on confronte au prix UEX du terminal supposé.

| Clé | Terminal | Accord |
|---|---|---|
| `RR_ARC_LEO` | Baijini Point | 10/10 |
| `RR_HUR_LEO` | Everus Harbor | 24/26 |
| `RR_MIC_L1` / `RR_MIC_L2` | MIC-L1 / MIC-L2 | 8/8 · 5/5 |
| `RR_P5_L2` | Gaslight | 7/7 |
| `RR_P6_LEO` | Ruin Station | 6/6 |

**Ce test tourne en CI comme un test.** Une table fausse ou périmée le fait échouer.

Trois limites connues, à consigner plutôt qu'à masquer : les **portails** sont indiscernables par
le prix (`RR_JP_PyroStanton` donne Pyro Gateway et Stanton Gateway à 10/10 — les deux bouts d'un
même saut affichent les mêmes prix ; le système courant tranche) ; **`RR_JP_StantonMagnus` n'a
aucun terminal chez nous** ; et les **avant-postes** ne se résolvent pas par le prix
(`Pyro3_Outpost_col_m_mng_indy_001` renvoie trois candidats à égalité) — ceux-là s'apparient à la
main, ou restent non appariés.

**Un lieu non apparié n'invente rien** : la transaction est lue, affichée, et attend que
l'utilisateur désigne le terminal.

### 6. Ce que la veille écrit : des corrections, jamais des données

Une transaction lue devient une **correction locale**, dans le moteur existant. Elle hérite donc
sans une ligne de code de la péremption à 3 h décidée le 2026-08-12, et de tout le dispositif de la
vue Corrections. `data/market.json` n'est jamais touché : il reste l'instantané UEX, régénéré en CI.

Trois écritures, et pas une de plus :

1. **Prix** — `shopPricePerCentiSCU × 100` à l'achat, `amount ÷ quantity` à la vente.
2. **Soute** — un achat absorbe, une vente retire, avec la composition en caisses. Le résidu se
   construit sur `absorbe`, jamais sur `sellAllAt`, conformément à l'ADR-002.
3. **Refus** — une réponse en `[Error]` de type `Selling` pose une saturation observée
   **horodatée**. C'est exactement ce qui manque à #20, dont le marqueur `refuseHere` est éternel
   faute de date, alors que la même information saisie à la main périme en 3 h.

### 7. Ce qu'on ne lit pas du journal

`playerId`, `Handle[…]`, `geid`, `accountId` sont **appariés puis jetés** — jamais capturés, jamais
stockés, jamais affichés. Le journal contient l'identité du joueur et son historique de session ;
on n'en a besoin pour rien.

## Conséquences

**Ce que ça change pour l'utilisateur.** La soute cesse d'être déclarative. Les prix qu'on a
réellement payés corrigent l'app sans saisie. Un comptoir qui refuse une vente est enregistré avec
sa date, donc il redevient disponible tout seul.

**Ce que ça coûte.** Une permission de fichier à accorder, un mécanisme de veille et de lecture
incrémentale, deux tables de correspondance à maintenir, et une dépendance à des formats de ligne
que CIG peut changer à tout patch — d'où §2.

**Ce que ça ne casse pas.** Aucune vue existante ne change de contrat. La veille est une source
d'entrée supplémentaire pour le moteur de corrections ; sans permission accordée, l'app se comporte
exactement comme aujourd'hui.

**Régime de tests.** Les motifs et l'assemblage sont **purs** : les fixtures sont des lignes de
journal en chaînes de caractères, testées en `node --test`, sans navigateur ni fichier. Seuls
l'accès au système de fichiers et la veille touchent une API, derrière un adaptateur simulable. Le
test d'appariement lieu → terminal tourne sur les données du dépôt.

**Ordonnancement.** Après `v2.0.0 — Refonte`. Écrire ça dans l'`app.js` actuel paierait une
troisième fois la taxe des dix coutures décrite en ADR-008.

## Ce que cet ADR ne tranche pas

- **La lecture d'écran** — stock, demande, et prix des lignes non échangées : c'est l'ADR-010,
  qui s'appuie sur les acquis d'ici (le lieu, le vocabulaire réduit du kiosque, les tailles de
  caisse) au lieu de les redécouvrir.
- **La publication vers UEX.** Le journal fournit pourtant l'essentiel du formulaire `data_submit`
  (`id_terminal` via §5, `price_buy`, la quantité, `container_sizes`). Restent à trancher : les
  deux secrets à saisir, l'assouplissement de `connect-src`, et le fait que `build-data.mjs` ne
  conserve **ni `id_terminal` ni `id_commodity`** — préalable obligatoire, non traité ici.
- **L'appariement des avant-postes**, et le trou de `RR_JP_StantonMagnus`.
- **Le sort des familles d'événements observées mais non retenues** — l'ascenseur à fret
  (172 533 lignes), les changements de juridiction, la destruction de vaisseau. Elles existent ;
  rien ne dit encore ce qu'on en ferait.
