# ADR-017 : Lire le journal — la chaîne de résolution, et ce qu'on refuse de deviner

**Statut :** Accepté — **complète** l'ADR-009 et **corrige quatre de ses mesures**. N'en supersède
aucune décision.
**Date :** 2026-08-24
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #100 · **Jalon :** v2.2.0 — Le journal de bord
**Voisins :** ADR-009 (la veille du journal), ADR-010, ADR-016 (le temps mesuré ou rien)

## Contexte

L'ADR-009 a décidé qu'on lirait `Game.log` et a posé les deux ponts à construire. Ce lot construit
le **lecteur** et les **deux ponts**, en pur calcul : rien n'y ouvre de fichier, rien n'y touche à
l'état, rien n'y peint. Le mécanisme d'accès au fichier — la File System Access API et ses **trois
inconnues non levées** — reste pour un lot suivant, et n'a aucune emprise sur ce qui est écrit ici.

Tout ce qui suit est **re-mesuré le 2026-08-24** sur 158 journaux (`Game.log` + 157 archives),
222 transactions, 121 ventes, 101 achats.

### Quatre mesures de l'ADR-009 qui ont bougé

| l'ADR-009 disait | mesuré aujourd'hui |
|---|---|
| « `RR_JP_StantonMagnus` n'a aucun terminal chez nous » | il en a un : **Nyx Gateway (Stanton)**, 3 achats sur 3 |
| « les avant-postes ne se résolvent pas par le prix (trois candidats à égalité) » | `Pyro3_Outpost_col_m_mng_indy_001` donne **Bueno Ravine 5/5** contre Fallow Field 4/5 — un écart, mais trop mince pour trancher |
| « `RR_ARC_LEO` → Baijini Point 10/10 » | **12/12**, avec plus de journaux |
| « `RR_HUR_LEO` → Everus Harbor 24/26 » | **24/26**, inchangé |

Et une mesure que l'ADR-009 n'avait pas faite, qui a bien failli m'égarer : côté vente,
`transactionMode[ResourceContainer]` (108 lignes sur 121) laisse croire que `quantity` compte des
**conteneurs**. Confronté au prix de vente UEX sur les 121 ventes : la lecture « SCU » tombe dans la
fourchette **117 fois**, la lecture « conteneurs de 32 » **zéro fois**. L'ADR-009 avait raison, mon
hypothèse était fausse, et c'est la mesure qui a tranché.

## Décision

**1. La chaîne `Key` → commodité tient en TROIS écritures, et pas une de plus.**
La littérale (`Iron`, et `RMC` qui passe par notre CODE), la desserrée (`ConstructionMaterials` →
`Construction Materials`, `Pressurized_Ice` → `Pressurized Ice`), et le minerai inversé (`Ore_Copper`
→ `Copper (Ore)`). Mesuré : **23 des 24 GUID observés**, soit **220 occurrences sur 222 (99 %)**.

*Écarté : une table d'exceptions à la main.* Le seul manquant est `ShipAmmoSize1` — le jeu en publie
neuf tailles, nous n'avons qu'une « Ship Ammunition », et **notre marché n'en porte aucun point
d'achat**, donc le prix ne peut pas confirmer l'appariement. Deux occurrences sur 222. On préfère
`null` à une supposition invérifiable.

Contre-épreuve exigée par un test : sur les 206 clés, 96 tombent sur une de nos commodités et
**aucune collision** — deux clés ne désignent jamais la même. Une collision voudrait dire qu'une
correction de prix en écrase une autre, en silence.

**2. Les points de Lagrange de Stanton se DÉDUISENT ; les stations nommées se listent.**
`RR_(ARC|CRU|HUR|MIC)_L[1-5]` → `<CODE>-L<n>`, vérifié par le prix là où il y a de quoi (MIC-L1 8/8,
MIC-L2 5/5). La règle ne vaut pas pour Pyro, dont les stations Lagrange portent des noms propres.

**UEX n'en cote que 18 sur 20** : `CRU-L2` et `CRU-L3` n'ont pas de comptoir. Ce n'est pas un défaut
de la règle — la dérivation reste juste, il n'y a rien en face. Les deux sont **nommés dans un test**
plutôt que tolérés : si UEX en ajoute un, le test tombe, et c'est exactement ce qu'on veut savoir.

**3. Un lieu ambigu reste NON APPARIÉ, et la raison est écrite à côté.**
Cinq lieux sur les 36 observés ne se tranchent pas : les deux bouts d'un saut affichent les mêmes
prix (10/10 chacun), `RR_P6_L3` met Endgame et Dudley & Daughters à égalité parfaite (4/4), et
l'avant-poste de Pyro III garde Fallow Field à une transaction du gagnant.

*Écarté : trancher au plus grand score.* Un écart de 5 contre 4 n'est pas une preuve, et une
correction de prix rangée sous le mauvais comptoir est pire que pas de correction du tout. La
transaction reste lue et attend que l'utilisateur désigne le terminal.

Les raisons sont **exportées** (`LIEUX_AMBIGUS`), pas enfouies en commentaire : sans ça, le prochain
lecteur refait l'analyse pour retomber sur la même égalité.

**4. La vérification par le prix ne tourne PAS en CI.**
C'est un revirement sur l'ADR-009, qui écrivait « ce test tourne en CI comme un test ». Il ne peut
pas : le rejouer demanderait de **versionner le journal d'un joueur**, et on ne le fera pas.

Une première version du test le tentait sur une ligne d'échantillon — et elle est tombée
immédiatement : l'Aluminium ne s'achète plus à Baijini Point aujourd'hui, alors qu'il s'y achetait
en mai. C'est **exactement la fragilité** qui a fait tomber trois tests de `smoke.pw.mjs` à la
régénération du même jour : dépendre d'une paire (commodité, terminal) présente à l'instant T.

Ce qui tourne en CI à la place, et qui suffit à faire tomber une table périmée :
- tout terminal nommé dans la table **existe** dans `market.json` ;
- la dérivation des Lagrange rend exactement les 18 points cotés, et les 2 absents sont ceux-là ;
- aucune collision de commodités.

Les chiffres d'appariement par le prix vivent dans cet ADR et dans les commentaires de la table.

**5. Le tag d'équipe n'est jamais un ancrage, et un test le prouve.**
La règle vient de l'ADR-009 ; ce qui est neuf, c'est qu'elle est **testée** : la même ligne se lit
sans tag, avec l'ancien `[Team_NAPU]`, et avec un tag inventé. `sc-trade-companion` a payé plus d'un
an de panne muette pour l'avoir supposé.

## Conséquences

- **Rien ne change pour l'utilisateur.** Ce lot n'ajoute aucune vue, aucun bouton, aucun appel de
  fichier. C'est délibéré : le mécanisme d'accès est gouverné par trois inconnues non levées, et
  bâtir dessus avant de les lever risquerait de tout jeter. Le calcul, lui, ne dépend d'aucune.
- **Les trois inconnues de l'ADR-009 restent ouvertes** — Chromium refuse-t-il un fichier sous
  `C:\Program Files` ? le fichier est-il lisible pendant que le jeu tourne ? la permission
  survit-elle au rechargement ? Aucune ne se vérifie sans une boîte de dialogue native, donc sans
  un geste du propriétaire. C'est le prochain pas, et il lui appartient.
- **`data/commodites-guid.json` (206 entrées, 10 802 o) vit hors du bundle**, comme les autres
  `data/*.json` : le service worker route sur ce préfixe, `vite.config.mjs` copie tout `.json` du
  dossier sans rien faire passer par le bundler, et la coquille précachée n'en porte pas un octet.
- **Les fixtures de test sont de vraies lignes, anonymisées** : `playerId`, `shopId` et `kioskId`
  mis à zéro, nom de joueur remplacé. On teste le format du jeu, pas une paraphrase — une
  paraphrase ne détecterait aucun changement de format.

## Ce que cet ADR ne tranche pas

- **L'accès au fichier**, et donc la faisabilité de bout en bout.
- **Ce qu'on fait des transactions lues.** L'ADR-009 décision 6 le dit — elles deviennent des
  corrections locales — mais rien n'est encore branché.
- **Les cinq lieux ambigus.** Ils le resteront jusqu'à ce qu'une autre source les départage, ou que
  l'utilisateur les désigne à la main.
- **`ShipAmmoSize1`**, et les huit autres tailles de munitions.
