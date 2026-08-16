# ADR-011 : Démonter `app.js` — par la persistance, pas par l'état

**Statut :** Proposé
**Date :** 2026-08-16
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #96 · **Jalon :** v2.0.0

## Contexte

Treize îlots React ont remplacé le rendu de toutes les vues et cartes (#109 → #127), la dernière
lecture par rang des tables de trajets a disparu (#129), et le code mort laissé derrière a été
retiré (#130). Le carnet de route disait alors, en toutes lettres, que les tableaux indexés par rang
étaient « **le préalable à la suppression d'`app.js`** ».

**C'était faux, et il vaut mieux l'écrire que le contourner.** Sortir le rang a retiré une
soixantaine de lignes. Retirer tout le code mort en a retiré 123 de plus. `app.js` fait encore
**3 454 lignes**.

### Ce qui reste dedans, mesuré le 2026-08-16 (pas supposé)

| | |
|---|---|
| Lignes | 3 454 |
| Fonctions de premier niveau | 159 |
| **dont touchant le DOM ou une globale mutable** | **135 — 3 110 lignes** |
| dont pures | **24 — 295 lignes** |
| Globales **mutables** | 63 |
| Écouteurs (`document` / élément) | 56 (6 / 50) |
| Appels à `peindre()` | 41 |
| `innerHTML` restants | 9, tous légitimes (datalists, `#meta`, `#railStatus`…) |

Les fonctions « pures » ne sont pas une réserve à extraire : les plus grosses de cette liste étaient
précisément le **code mort** retiré en #130. Ce qui reste de pur est fait de formateurs de trois
lignes, déjà à leur place.

> **Comment c'est compté**, pour que le chiffre soit rejouable et critiquable : une fonction est
> dite « liée » si son corps contient `$(`, `document.`, `window.`, `localStorage`,
> `addEventListener`, `.innerHTML`, `peindre(`, ou le nom d'une des globales mutables. La mesure est
> donc **grossière et par excès** — une fonction qui ne fait que *lire* `MARKET` y tombe comme celle
> qui l'écrit. Elle suffit à l'ordre de grandeur, qui est ce que cet ADR utilise ; elle ne suffirait
> pas à décider quoi extraire ligne à ligne.

**`app.js` n'est pas un résidu de migration : c'est la coquille de l'application.** Il porte l'état
partagé (`ROUTES`, `MARKET`, `JOURNEY`, `SOUTE`, `OVERRIDES`, `STARMAP`, la vue courante, les clés
de tri…), le chargement des données, la persistance et les permaliens, l'orchestration du rendu par
`refresh()`, le câblage des 56 écouteurs et l'amorçage. Rien de tout cela ne « part dans un îlot ».

### Les six blocs, par taille

| lignes | bloc |
|---:|---|
| 576 | Vue « Commodités » — **inclut le câblage complet et l'amorçage** (la dernière section court jusqu'à la fin du fichier) |
| 417 | Édition inline des manifestes de jambe (persistée en `localStorage`, hors lien) |
| 377 | Plan de vol |
| 359 | Le chargement qu'on compose à la main (#19) |
| 303 | Frais d'autoload |
| 245 | La soute |
| 223 | **Persistance & permaliens** |
| 191 | « En route » |
| … | le reste, par tranches de 12 à 156 |

### Quatre contraintes que tout découpage doit respecter

1. **`refresh()` est le point de propagation UNIQUE et prouvé complet.** C'est l'atout qui a permis
   la cohabitation React sans magasin : `pont.js` le dit, et l'ADR-008 s'y adosse. Toute mutation
   d'état partagé finit par l'appeler dans la même pile — vérifié sur les 17 écritures de `SOUTE`,
   les 8 de `JOURNEY`, les 5 d'`OVERRIDES`. Lui ajouter un rival crée deux vérités à tenir
   d'accord, ce que la refonte cherchait justement à supprimer.
2. **Des tests lisent `app.js` comme du TEXTE.** `logic.test.mjs:116` en fait un `readFileSync` puis
   cherche `function fiabiliteCell(` ; `scripts/jetons.test.mjs:131` y cherche des littéraux de
   couleur. Déplacer ou renommer une fonction ancrée ainsi **casse un test unitaire** sans
   qu'aucun type ni aucun e2e ne prévienne. C'est délibéré : c'est le seul moyen qu'a `node --test`
   de garder une règle qui vit hors de `logic.ts`.
3. **Le nom du fichier est une API.** `index.html:434`, `sw.js:14` et `.github/workflows/
   update-data.yml:71` le nomment ; `vite.config.mjs` réécrit le `SHELL` de `sw.js` avec ce que le
   build a réellement émis, précisément parce que ces noms sont écrits à la main quelque part.
4. **Le contrat e2e ne bouge pas** : ids, classes et attributs `data-*` restent (ADR-008 §4). Un
   découpage qui les touche perd le harnais qui le valide.

### Un obstacle voisin, découvert en mesurant (issue #131)

`update-data.yml` copie encore les sources à la main — dont `logic.mjs`, **qui n'existe plus depuis
#106** — et ne lance aucun build. Le workflow ne tourne que sur `main`, donc rien n'est cassé
aujourd'hui ; il le sera à la seconde de la bascule. **Ce n'est pas `app.js` qui sépare la v2 de la
production.** À traiter avant, et indépendamment de cet ADR.

## Décision

**On ne « supprime » pas `app.js`. On l'allège par les BORDS, en commençant par la persistance, et
on ne touche ni à l'état ni à `refresh()` tant qu'un ADR distinct ne l'aura pas tranché.**

Concrètement, dans cet ordre :

1. **`persistance.ts`** — les 223 lignes de « Persistance & permaliens » (`collectState`,
   `applyState`, `saveState`, la liste blanche, le hash d'URL, `localStorage`). C'est le seul bloc
   qui soit à la fois gros, cohérent, **déjà couvert par des tests de permalien**, et sans état
   propre : il lit et écrit des champs par id, il n'en possède aucun.
2. **`frais.ts`** — la part calculatoire des frais d'autoload (303 l.), après avoir séparé ce qui
   lit `AUTOLOAD_K` de ce qui ne fait que calculer. Le calcul rejoint `logic.ts` et passe alors sous
   les 483 tests unitaires (415 ms) au lieu de dépendre de Playwright.
3. **`manifestes-jambe.ts`** — les 417 lignes de l'édition inline, qui ont leur propre persistance.
4. **Puis on s'arrête et on réévalue.** L'état et `refresh()` ne bougent pas dans cette séquence.

Chaque étape est **une PR, avec sa mesure avant/après**, et laisse la suite verte.

## Options considérées

### Option A — Ne rien faire

| Dimension | Évaluation |
|---|---|
| Risque | Nul |
| Coût | Nul |
| Ce qu'on garde | Un fichier dense mais densément commenté, couvert par 224 e2e |

**Pour :** aucune régression possible ; le fichier n'est pas illisible, il est long.
**Contre :** 3 454 lignes de JavaScript **hors du périmètre de `tsc`** (`tsconfig.json` exclut
`app.js` à dessein) ; 63 globales mutables que rien ne vérifie ; le fichier reste le point de
contention de toute session, et le jalon v2.0.0 promettait TypeScript.

### Option B — Renommer en `app.ts` d'un bloc, sans découper

| Dimension | Évaluation |
|---|---|
| Risque | Élevé, et concentré sur un seul commit |
| Coût | Une PR énorme, impossible à relire |
| Gain | `tsc` couvre enfin 3 454 lignes et 63 globales |

**Pour :** le plus gros gain de sûreté par ligne changée ; c'est la marche que `logic.ts` a montée
avec succès en #106.
**Contre :** `logic.ts` faisait 2 584 lignes de **fonctions pures** — annoter n'y changeait aucun
comportement. Ici, 135 fonctions sur 159 touchent le DOM ou une globale : les annotations
révéleraient des dizaines d'erreurs vraies (nullabilité de `$()`, unions de `MARKET | null`) au
milieu d'artefacts de réglage, dans une PR que personne ne peut relire. Et le renommage casse
`logic.test.mjs:116` (`new URL("./app.js")`), `sw.js:14`, `index.html:434` et le `cp` de
`update-data.yml` **le même jour**.

### Option C — Découper en modules ES, `refresh()` préservé (retenue)

| Dimension | Évaluation |
|---|---|
| Risque | Faible par étape, mesurable |
| Coût | Plusieurs PR, étalées |
| Gain | Chaque module extrait entre dans `tsconfig.include` et devient typé |

**Pour :** l'unité de travail est la PR, pas le fichier ; chaque étape se juge sur son propre
avant/après ; on peut s'arrêter à tout moment sans laisser un chantier ouvert.
**Contre, et c'est le vrai obstacle technique :** les liaisons ES sont **vivantes en lecture, mais
non réassignables depuis l'extérieur**. Un module qui importe `MARKET` le voit changer ; il ne peut
pas écrire `MARKET = …`. Donc tout bloc extrait qui **écrit** une globale a besoin d'un accesseur —
c'est-à-dire d'un embryon de magasin. **C'est pourquoi l'ordre commence par la persistance :** elle
lit l'état et écrit des champs du DOM, elle ne réassigne aucune globale. Elle est la seule grosse
tranche à passer sans rien inventer.

### Option D — Introduire un magasin et dissoudre l'état

| Dimension | Évaluation |
|---|---|
| Risque | Le plus élevé du lot |
| Coût | Une refonte dans la refonte |
| Gain | L'architecture « propre » |

**Pour :** c'est la fin logique du chemin, et ça rendrait les 63 globales explicites.
**Contre :** l'ADR-008 et `pont.js` ont **explicitement refusé** un magasin, avec un argument qui n'a
pas changé — `refresh()` est déjà le point de propagation unique et prouvé complet. Le remplacer
n'est pas un découpage : c'est changer la vérité de l'application, en une fois, sur une branche
longue. À décider dans son propre ADR, si un besoin le justifie un jour. Le confort de lecture n'en
est pas un.

## Analyse des arbitrages

**B contre C.** B maximise le gain de typage par ligne changée ; C maximise la relisibilité. Le
départage n'est pas esthétique : `logic.ts` a réussi parce que **470 tests en 385 ms** (ADR-008 §5)
disaient si une annotation avait changé un comportement. `app.js` n'a pas d'équivalent — ce qui le
couvre, ce sont **224 e2e à 1,4 min**, qui ne disent rien tant que l'application ne démarre pas. Une
PR de 3 454 lignes s'y débogue par bissection manuelle. **C gagne parce que le harnais de
vérification est lent, pas parce que le code serait plus beau.**

**C contre D.** Les deux finissent au même endroit si on va au bout. C peut s'arrêter en chemin sans
rien laisser d'incohérent ; D est indivisible. Sur une branche longue qui doit rester verte en
permanence, l'indivisible est le vrai coût.

**Ce qui pourrait faire changer d'avis.** Si l'extraction de la persistance montre que le typage
révèle des bugs réels (et non du bruit), la marche B redevient intéressante pour le reste : on
saurait alors que le rapport signal/bruit est bon. **Cette première PR est donc aussi une mesure.**

## Conséquences

**Ce qui devient plus facile**
- Chaque bloc extrait entre dans `tsconfig.include` et gagne `tsc` — la seule vérification rapide
  dont dispose ce dépôt hors des tests unitaires.
- La persistance, une fois isolée, devient testable par `node --test` au lieu d'un aller-retour
  Playwright sur un permalien.
- `app.js` rétrécit sans qu'aucune session ait à le relire en entier.

**Ce qui devient plus difficile**
- **Une frontière de plus à traverser** pour lire un chemin de bout en bout. Aujourd'hui tout est
  dans un fichier ; demain il faudra savoir dans lequel regarder.
- Les tests qui lisent `app.js` comme du texte devront suivre chaque déplacement, **à la main** :
  rien ne les avertira.
- Le nom `app.js` reste, et reste écrit dans `sw.js` et le déploiement. Tant qu'il subsiste, la
  situation est *hybride* — c'est le prix assumé de ne pas tout renommer d'un coup.

**Ce qu'il faudra revisiter**
- Le sort de l'état et de `refresh()`, quand les bords seront partis. C'est là que se pose la vraie
  question du magasin, et elle mérite son ADR.
- Le découpage du bundle, que `scripts/coquille.test.mjs:31` renvoie explicitement à « quand la
  migration sera finie et `app.js` retiré ». Cet ADR remplace cette formule : il n'y aura pas de
  moment où `app.js` disparaît d'un coup.

## Points d'action

1. [ ] Corriger le déploiement de la bascule — **issue #131**, indépendante et prioritaire sur tout
       le reste : c'est elle qui sépare la v2 de la production, pas `app.js`.
2. [ ] **PR 1 — `persistance.ts`** : extraire les 223 lignes, entrer dans `tsconfig.include`,
       mesurer avant/après (lignes, erreurs `tsc`, temps de suite). Rapporter si le typage a révélé
       des bugs **réels** — c'est la mesure qui commande la suite.
3. [ ] **PR 2 — la part calculatoire des frais d'autoload** vers `logic.ts`, avec ses tests
       unitaires.
4. [ ] **PR 3 — `manifestes-jambe.ts`**.
5. [ ] Réévaluer. Ne pas enchaîner sur l'état sans un nouvel ADR.
6. [ ] Corriger la formule périmée de `scripts/coquille.test.mjs:31` quand cet ADR sera accepté.
