# ADR-012 : Faire emménager une vue qui AGIT

**Statut :** Accepté
**Date :** 2026-08-17
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #96 · **Jalon :** v2.0.0
**Prolonge :** ADR-011 (le démontage d'`app.js`)

## Contexte

L'ADR-011 a décidé qu'`app.js` disparaît. La racine unique existe (#143) et deux vues y vivent :
la **Tournée** (#143) et le **Plan de vol** (#145). Le patron a été écrit et il tient.

Mais ces deux-là sont **inertes**. La Tournée n'a aucun bouton ; le Plan de vol est une conclusion
(ADR-004 §4) où rien n'est actionnable. Les six vues restantes portent toutes des **actions** :
corriger un prix, choisir un trajet, changer de board, sélectionner une commodité. C'est leur
**câblage** qu'il faut savoir déplacer, et le patron de l'ADR-011 ne dit rien là-dessus.

Cet ADR répond à une seule question :

> **Quand une vue de l'arbre doit ÉCRIRE, à qui parle-t-elle ?**

## Le problème, mesuré

`app.js` n'exporte **rien** — 2 869 lignes, pas une ligne `export`. C'est un module ES qui *importe*
onze modules TypeScript et n'en *expose* aucun symbole. La direction des dépendances est donc à sens
unique, et le patron de l'ADR-011 (« le composant ne reçoit AUCUNE prop ») interdit de contourner le
problème en poussant des rappels depuis `app.js`.

Une vue de l'arbre qui veut écrire n'a aujourd'hui qu'un seul interlocuteur : `notifier()`
(`etat.ts`). Or `notifier()` réveille l'arbre React **et rien d'autre**, alors que `refresh()`
(app.js) fait trois choses de plus, dont aucune ne vit encore dans l'arbre :

| ce que `refresh()` fait en plus | conséquence si on ne l'appelle pas |
|---|---|
| `renderJourney()` — la carte du voyage | la carte reste figée à côté d'un tableau à jour |
| `renderSoute()` / `renderEntrepots()` | la place libre, « où écouler » et le prix de vente périment |
| `saveState()` | le permalien et la restauration au rechargement périment |

Aucun test ne verrait ces trois-là : ils regardent tous la vue, pas ce qui l'entoure.

## Décision

### 1. Un canal de rafraîchissement, `rendu.ts`

Même patron que `brancher()` dans `donnees.ts` : le module **déclare** le besoin, l'amorçage
**pose** l'implémentation.

```ts
brancherRendu({ rafraichir: refresh });   // app.js, dans init()
rafraichir();                             // n'importe quel module, y compris un composant
```

C'est un crochet, pas un import, pour deux raisons. Un import est **impossible** tant que `refresh`
vit dans `app.js` (qui n'exporte rien) ; et il resterait **en cycle** une fois `app.js` disparu —
c'est la vue qui déclenche le rendu, pas le rendu qui connaît la vue.

**Le crochet est transitoire**, comme les portails d'`App.tsx`. Il disparaît quand `renderJourney`,
`renderSoute` et `renderEntrepots` auront à leur tour emménagé : `notifier()` redeviendra le point
unique, et `rafraichir()` ne sera plus qu'un alias à supprimer.

**Règle d'emploi.** Une action qui change l'état **partagé** (une correction, une écriture en soute,
un arrêt de voyage) appelle `rafraichir()`. Une action qui ne touche qu'à l'affichage d'une vue déjà
dans l'arbre n'appelle que `notifier()`.

### 2. Ce qui devient un module, et ce qui reste dans `app.js`

Le critère n'est pas « est-ce du rendu ». C'est : **le nœud touché appartient-il à un portail ?**

| bloc | destination | pourquoi |
|---|---|---|
| `showToast` | `messages.ts` | aucun nœud de vue — un toast est un message global |
| `isOv` | `corrections.ts` | trois lignes de lecture du store, à côté d'`effVals` |
| `updateOvBadge`, `notifySuperseded`, `corriger` | `corrections-actions.ts` | l'**action**, distincte de la **donnée** que porte `corrections.ts` |
| `figerJambe`, `pinLegsForVolume`, `journeyCarriedCommodities` | `voyage-donnees.ts` | déjà le module du parcours, et les commentaires y sont |
| `marginTier` → `palierMarge(m, max)` | `logic.ts` | calcul pur, à côté de `valueTiers` — la globale devient un paramètre |
| la délégation `#corrections` | **reste dans `app.js`** | elle est posée sur un parent que React ne possède **jamais** |

Le dernier point est le seul contre-intuitif, et il a un précédent mesuré : `#planHead` (#145). Une
délégation posée sur un **conteneur** que React ne rend pas continue de fonctionner sur des enfants
rendus par React — l'événement remonte, `closest()` trouve. La déplacer vers des `onClick` n'apporte
rien tant que le conteneur lui-même n'est pas un composant, et coûte une réécriture de test.

**Corollaire pour les contrôles vanilla.** `#commSortModes` et `#commBoardModes` restent du markup
d'`index.html` avec des écouteurs directs. Ils **importent** leur action du module de vue plutôt que
de la dupliquer — précédent : `app.js` importe déjà `planData` de `vues/plan-vue.tsx`.

### 3. Un composant par VUE, pas un par conteneur

C'est la décision qui coûte le plus cher si on la rate.

Une vue peut occuper **plusieurs conteneurs séparés** dans `index.html` — le Plan de vol en occupe
deux (#145), Commodités et Corrections en occupent trois chacune. La tentation est d'écrire un
composant sans props par conteneur, comme le patron le dit.

**C'est faux dès que les conteneurs partagent un calcul.** La grille des Commodités et son détail
consomment le même `commoditySummaries(etat.MARKET, f, effVals)` — un parcours de tout le marché.
Deux composants sans props le feraient **deux fois par `notifier()`** : exactement le gaspillage que
la PR #146 vient de payer pour supprimer. Pire, chacun re-dériverait la sélection courante, et deux
dérivations qui divergent font une tuile `.selected` qui ne correspond pas au détail affiché — ce
qu'aucun test ne compare.

La forme retenue :

```tsx
export function VueCommodites() {
  if (etat.view !== "commodities") return null;   // la garde, UNE fois, en tête
  // … le calcul, UNE fois …
  return <>
    <Portail id="commGrid">…</Portail>
    <Portail id="commDetail">…</Portail>
    <Portail id="commHint">…</Portail>
  </>;
}
```

La garde de vue monte **au-dessus** des portails au lieu d'être répétée sur chacun. Effet de bord
bienvenu : l'ordre d'évaluation redevient l'**ordre des instructions**, et non l'ordre des frères
JSX — ce qui compte, parce que certains de ces calculs ont des effets de bord (voir §4).

### 4. Les effets de bord pendant le rendu sont un CONTRAT, pas une négligence

`effVals` (`corrections.ts`) **purge** les corrections périmées et persiste. `groupOverridesByTerminal`
(`logic.ts`) mute `OVERRIDES` en place. Ces deux-là tournent pendant le rendu, et l'ordre dans lequel
on les appelle est observable à l'écran.

`renderCorrections` le documente déjà : la bande des stations est peinte **après** le panneau, bien
qu'elle s'affiche au-dessus, parce que compter d'abord afficherait une correction que le rendu
suivant vient d'effacer.

**Ce contrat survit à la migration, et il descend d'un cran.** Il ne suffit pas d'ordonner les deux
portails : à l'intérieur du panneau, `nbCorrections` doit être calculé **après** `tuilesStation`,
puisque c'est `tuilesStation` qui purge. Écrit en littéral d'objet, l'ordre des propriétés est
l'ordre d'évaluation — ça marche, mais par accident. On l'écrit donc en `const` successives, avec
le commentaire qui dit pourquoi.

C'est aussi ce qui justifie le §3 : un composant, des instructions ordonnées, un ordre lisible.

### 5. Les caches de rendu deviennent des locales, quand ils n'ont qu'un lecteur

Les cinq globales de la vue Commodités (`shownCommodities`, `commTiers`, `commDupCodes`,
`commMaxMargin`, `commCarried`) n'existent que parce que `renderCommodities` calcule et que trois
autres fonctions peignent. Un composant qui calcule et rend dans la même passe n'en a pas besoin :
elles deviennent des `const` locales.

**La vérification n'est pas optionnelle** : chaque globale supprimée doit d'abord être `grep`ée pour
trouver ses lecteurs *hors* de la vue. `commMaxMargin` en avait un (`marginTier`), d'où le
paramètre ajouté au §2.

## Conséquences

**Ce qu'on gagne.** Une vue qui agit peut emménager sans prop et sans rival de propagation. Quatre
copies du même corps `corriger` deviennent une. `refresh()` cesse d'être un privilège d'`app.js`.

**Ce qu'on paie.** Un crochet de plus (`rendu.ts`), qu'il faudra penser à supprimer. Et un canal qui
peut être appelé depuis n'importe où : rien n'empêche un composant d'appeler `rafraichir()` là où
`notifier()` suffirait, ce qui rendrait la mesure de la PR #146 (l'arbre n'évalue que la vue
regardée) trompeuse. C'est la règle d'emploi du §1 qui tient ça, et rien d'autre.

**Ce qu'on ne fait pas.** Le bandeau (`#shipJourneyRow`) reste hors de l'arbre. Il vit dans six vues
sur huit et n'est masqué que par le Plan de vol : il se montera donc **sans** garde `si`, ou avec un
garde négatif. C'est l'inverse du patron des vues d'onglet, et ça mérite sa propre mesure — pas un
passager clandestin dans un lot qui en porte déjà deux.
