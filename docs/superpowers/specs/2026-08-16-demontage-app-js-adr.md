# ADR-011 : `app.js` disparaît — une seule racine React, un seul état

**Statut :** Proposé
**Date :** 2026-08-16
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #96 · **Jalon :** v2.0.0
**Amende :** ADR-008 §4 (le corollaire « verte en permanence »)

## Contexte

Treize îlots React ont remplacé le rendu de toutes les vues et cartes (#109 → #127), la dernière
lecture par rang des tables de trajets a disparu (#129), et le code mort a été retiré (#130).

Le carnet de route disait que les tableaux indexés par rang étaient « le préalable à la suppression
d'`app.js` ». Mesuré : sortir le rang a retiré une soixantaine de lignes, le code mort 123 de plus,
et le fichier fait encore **3 454 lignes**.

### Ce qui reste dedans, mesuré le 2026-08-16 (pas supposé)

| | |
|---|---|
| Lignes | 3 454 |
| Fonctions de premier niveau | 159 |
| **dont touchant le DOM ou une globale mutable** | **135 — 3 110 lignes** |
| dont pures | 24 — 295 lignes |
| Globales **mutables** | 63 |
| Écouteurs (`document` / élément) | 56 (6 / 50) |
| Appels à `peindre()` | 41 |
| `innerHTML` restants | 9, tous légitimes (datalists, `#meta`, `#railStatus`…) |

> **Comment c'est compté**, pour que le chiffre soit rejouable et critiquable : une fonction est
> dite « liée » si son corps contient `$(`, `document.`, `window.`, `localStorage`,
> `addEventListener`, `.innerHTML`, `peindre(`, ou le nom d'une globale mutable. La mesure est donc
> **grossière et par excès** — lire `MARKET` y compte comme l'écrire. Elle suffit à l'ordre de
> grandeur, pas à décider ligne à ligne.

`app.js` porte l'état partagé, le chargement des données, la persistance, l'orchestration du rendu
par `refresh()`, le câblage des 56 écouteurs et l'amorçage. **Ce n'est pas un résidu de migration :
c'est la coquille de l'application.**

### L'erreur que cet ADR corrige

Sa première rédaction concluait : ne pas supprimer `app.js`, l'alléger par les bords, ne pas toucher
à l'état ni à `refresh()`. Le raisonnement s'appuyait, sans le dire, sur une exigence de **livrable
à chaque étape**.

**Cette exigence n'a pas lieu d'être ici.** `v2/main` n'est pas déployée — c'est la raison d'être de
la branche longue (ADR-008 §3) : `main` sert la v1 pendant toute la refonte. Rien de visible ne
casse si `v2/main` est rouge quelques jours.

Le « une branche longue n'est tenable que si elle est verte en permanence » de l'ADR-008 §4 est le
**corollaire de la migration vue par vue** — une phase désormais terminée. Le **critère de fusion**,
lui, n'a jamais été par commit : « tous les tests collectés passent, aucun échec », mesuré **à la
bascule**.

Appliquée à la coquille, l'exigence de livrable écarte mécaniquement la seule option qui atteigne
l'objectif, et laisse ~2 500 lignes de JavaScript non typé. Ce serait un refactor prudent, pas la
refonte que l'ADR-008 a décidée.

### Trois contraintes qui, elles, restent entières

1. **Le contrat de sélecteurs ne bouge pas** — ids, classes, attributs `data-*` (ADR-008 §4). C'est
   ce qui fait des 226 e2e un **harnais** : c'est parce qu'ils ne changent pas qu'un rouge
   transitoire est lisible, et qu'un vert final prouve quelque chose. **Cette contrainte est ce qui
   rend le rouge acceptable, pas ce qui l'interdit.**
2. **Des tests lisent `app.js` comme du TEXTE.** `logic.test.mjs:116` en fait un `readFileSync` puis
   cherche `function fiabiliteCell(` ; `scripts/jetons.test.mjs:131` y cherche des littéraux de
   couleur. Ces ancres suivront le code à la main — rien ne les avertira.
3. **Le nom du fichier est écrit ailleurs** : `index.html:434`, `sw.js:14`,
   `update-data.yml:71` ; `vite.config.mjs` réécrit déjà le `SHELL` de `sw.js` avec ce que le build
   émet réellement.

### Un obstacle voisin, découvert en mesurant — issue #131

`update-data.yml:71` copie encore les sources à la main — dont `logic.mjs`, **qui n'existe plus
depuis #106** — et ne lance aucun build. Le workflow ne tourne que sur `main` : rien n'est cassé
aujourd'hui, tout le sera à la seconde de la bascule. **Ce n'est pas `app.js` qui sépare la v2 de la
production.** À traiter en premier, indépendamment de cet ADR.

## Décision

**`app.js` disparaît pour de bon.** L'application passe à **une seule racine React** possédant la
page, et à **un seul état** que React observe. `refresh()`, les 41 `peindre()` et les 56 écouteurs
disparaissent avec le fichier.

Et, ce qui débloque le reste : **`v2/main` a le droit d'être rouge pendant cette phase.** Le critère
reste celui de l'ADR-008 §4 — tous les tests collectés passent, aucun échec — **mesuré à la
bascule**, pas à chaque commit. Cet ADR amende explicitement le corollaire « verte en permanence »,
qui visait la migration vue par vue et n'a plus d'objet.

### Le mécanisme, et pourquoi il ne crée pas deux vérités

L'objection qui avait fait refuser un magasin (ADR-008, `pont.js`) était juste : `refresh()` est le
point de propagation **unique et prouvé complet** — vérifié sur les 17 écritures de `SOUTE`, les 8
de `JOURNEY`, les 5 d'`OVERRIDES` (`pont.js:7`). Lui donner un rival créerait deux vérités.

Elle ne s'applique pas ici, parce qu'on ne lui donne pas de rival : **on le renomme.** Les globales
deviennent un module d'état ordinaire, mutable, qui reste la seule source de vérité ; `refresh()`
devient sa notification ; React s'y abonne par **`useSyncExternalStore`** (React 19, déjà en place).
Aucun état n'est dupliqué, aucun cadre externe n'est introduit — le point de propagation unique
change de nom, pas de nature.

C'est ce qui fait de C une opération **mécanique**, et non une réécriture de l'état.

## Options considérées

### Option A — Alléger par les bords (la première rédaction de cet ADR)

| Dimension | Évaluation |
|---|---|
| Risque | Faible |
| Ce qu'on atteint | ~2 500 lignes de JS non typé, indéfiniment |

**Pour :** chaque PR est relisible et la branche reste verte.
**Contre :** on ne finit jamais. Trois extractions retirent au mieux 950 lignes sur 3 454, et les
plus grosses tranches restantes (l'état, l'orchestration, le câblage) sont justement celles que
l'option s'interdit de toucher. **C'est un refactor, pas une refonte** — et le jalon v2.0.0 promet
TypeScript et React, pas « un peu moins de JavaScript ».

### Option B — Renommer en `app.ts` d'un bloc, sans changer l'architecture

| Dimension | Évaluation |
|---|---|
| Risque | Moyen |
| Ce qu'on atteint | 3 454 lignes typées, mêmes 63 globales, même `refresh()` |

**Pour :** `tsc` couvre enfin la coquille, pour un diff mécanique.
**Contre :** on type l'architecture qu'on voulait remplacer. Les 41 `peindre()` et les 56 écouteurs
restent ; les îlots restent des îlots pilotés de l'extérieur. C'est une étape possible **à
l'intérieur** de C, pas une destination.

### Option C — Une racine, un état, `app.js` disparaît (retenue)

| Dimension | Évaluation |
|---|---|
| Risque | Élevé, mais **borné et mesurable** : le contrat de sélecteurs est inchangé |
| Ce qu'on atteint | L'objectif de l'ADR-008 : plus de coquille, tout en TypeScript |

**Pour :** les îlots cessent d'être des îlots ; le rendu redevient une fonction de l'état, ce que
41 `peindre()` appelés à la main imitent péniblement. Le câblage disparaît dans le JSX. C'est la
seule option après laquelle il n'y a plus rien à démonter.
**Contre :** la branche sera rouge entre le début et la fin de la phase. C'est le coût, et il est
payable **parce que la branche n'est pas déployée** et que les sélecteurs ne changent pas — donc le
retour au vert est un critère net, pas une impression.

### Option D — Repartir d'une page blanche

**Pour :** le résultat le plus propre en théorie.
**Contre :** on jetterait `logic.ts` (2 584 lignes, 483 tests) et le contrat de sélecteurs, c'est-à-
dire les deux seules choses qui rendent cette refonte vérifiable. Écartée sans hésitation.

## Analyse des arbitrages

**A contre C.** A minimise le risque par PR ; C minimise le risque **total**, parce qu'il est le
seul à finir. Une refonte qui s'arrête à mi-chemin laisse deux architectures à entretenir en même
temps — l'état impératif et les îlots — ce qui est plus coûteux que l'une ou l'autre. **Le vrai
danger de cette étape n'est pas de casser la branche, c'est de ne jamais la terminer.**

**B contre C.** B est une bonne première marche *dans* C : typer avant de déplacer rend chaque
déplacement vérifiable par `tsc` plutôt que par Playwright. Le plan ci-dessous la garde à ce titre,
sans en faire une destination.

**Ce qui pourrait faire changer d'avis.** Si l'étape 1 (l'état sous `useSyncExternalStore`) montre
que le nombre de re-rendus explose — la garde existe déjà : `smoke.pw.mjs` plafonne à **2 lots de
rendu de `#rows` par frappe** —, alors le modèle d'abonnement est à revoir avant d'aller plus loin.
C'est une mesure, pas une opinion, et elle arrive tôt.

## Conséquences

**Ce qui devient plus facile**
- Le rendu redevient une fonction de l'état : plus de `render*()` à appeler dans le bon ordre, plus
  de drapeau `synchrone` à propager à la main (le contrat de mesure d'`ajusterRangeeVoyage`, la
  panne de focus de `#holdAddName`, le `flushSync` de l'édition — trois symptômes du même mal).
- Tout passe sous `tsc`, y compris les 63 globales, aujourd'hui vérifiées par rien.
- `strictNullChecks` et `noImplicitAny` deviennent atteignables : ils échouaient sur du JS invisible
  au compilateur.

**Ce qui devient plus difficile**
- **La branche sera rouge**, et il faut l'assumer sans le banaliser : un rouge qui dure cesse d'être
  informatif. D'où un garde-fou explicite ci-dessous.
- Les tests qui lisent `app.js` comme du texte devront suivre à la main.
- Le diff sera gros. La relecture se fera sur le **résultat** (la suite au vert, le relevé DOM),
  pas sur le patch — c'est le mode de vérification qui change, pas son exigence.

**Ce qu'il faudra revisiter**
- Le découpage du bundle, que `scripts/coquille.test.mjs:31` renvoie à « quand la migration sera
  finie et `app.js` retiré » — cette fois, ce moment existera vraiment.
- Le plafond de coquille (620 000 o), à re-mesurer une fois `app.js` parti.

## Points d'action

1. [ ] **#131, le déploiement** — avant tout le reste : c'est lui qui sépare la v2 de la production.
2. [ ] **Étape 1 — `etat.ts`** : les 63 globales dans un module d'état mutable, `refresh()` devenu
       sa notification, React abonné par `useSyncExternalStore`. `app.js` importe et continue de
       tourner : **la branche reste verte** ici, et la mesure des re-rendus se fait à ce moment.
3. [ ] **Étape 2 — une racine unique** : les 41 `peindre()` fusionnent en un arbre. **La branche
       peut passer au rouge.**
4. [ ] **Étape 3 — le câblage** : les 56 écouteurs deviennent des props JSX ; la persistance et le
       chargement des données deviennent des modules TypeScript.
5. [ ] **Étape 4 — `app.js` est supprimé**, `index.html` charge `main.tsx`. Les ancres textuelles de
       `logic.test.mjs` et `scripts/jetons.test.mjs` sont repointées. **Retour au vert exigé ici.**
6. [ ] **Étape 5** — `strictNullChecks`, puis `noImplicitAny`, chacun dans sa PR.
7. [ ] Corriger la formule périmée de `scripts/coquille.test.mjs:31`.

### Le garde-fou du rouge

Le droit d'être rouge n'est pas un droit d'être aveugle. Pendant les étapes 2 à 4 :

- l'état de la suite est **relevé et écrit dans la PR à chaque poussée** (« 118/226, les 108 échecs
  sont tous dans `smoke` et `plan` ») — un rouge non chiffré est un rouge qu'on ne contrôle plus ;
- **aucune fusion vers `v2/main` tant que la suite n'est pas revenue au vert** : le rouge vit dans
  la branche de travail, jamais dans la branche d'intégration ;
- si le vert n'est pas retrouvé au bout de **deux étapes**, on s'arrête et on rouvre cet ADR plutôt
  que de continuer à l'aveugle.
