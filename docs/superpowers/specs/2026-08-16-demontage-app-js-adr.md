# ADR-011 : Finir la refonte — ce qu'on n'aurait pas écrit

**Statut :** Accepté
**Date :** 2026-08-16
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #96 · **Jalon :** v2.0.0
**Amende :** ADR-008 §4 (le corollaire « verte en permanence »)

## Contexte

Treize îlots React ont remplacé le rendu de toutes les vues et cartes (#109 → #127), la dernière
lecture par rang des tables de trajets a disparu (#129), le code mort a été retiré (#130).

La question posée à cet ADR n'est pas « faut-il supprimer `app.js` ». Elle est :

> **Si on avait écrit cette application depuis le début en React + Vite + Tailwind + TypeScript,
> aurait-on écrit ce fichier ?**

Posée à chaque fichier du dépôt, elle donne une réponse que « migrer vue par vue » ne donnait pas.

### Le verdict, fichier par fichier

| Fichier | lignes | L'aurait-on écrit ? |
|---|---:|---|
| `logic.ts` | 2 609 | **Oui.** Calcul pur, 483 tests en 415 ms. C'est le cœur, et il est déjà à sa place. |
| `types.ts` | 1 011 | **Oui.** |
| `vues/*.tsx` | 3 033 | **Oui, mais pas ainsi** — voir plus bas : ce sont des gabarits, pas des composants. |
| `app.js` | 3 454 | **Non.** La coquille impérative : 63 globales, `refresh()`, 41 `peindre()`, 56 écouteurs, 180 accès `$("id")`. |
| `index.html` | 441 | **Non, pas sous cette forme.** 114 balises de structure qui seraient des composants ; il resterait un `<head>` et un `<div id="root">`. |
| `style.css` | 1 529 | **Non à cette taille** — mais **pas pour la raison qu'on croit** (voir « la tentation Tailwind »). |
| `pont.js` | 25 | **Non.** Un pont entre deux mondes. De zéro : un `createRoot`, une fois. |
| `rail.js` | 28 | **Non.** Un script classique séparé pour éviter un flash au chargement — un symptôme, pas une pièce. |

### L'écart entre la pile annoncée et le code, mesuré

L'ADR-008 s'intitule « Vite + React + **TypeScript** + **shadcn/ui** », et la PR #108 a installé
Tailwind 4.3.3. Sur le code d'aujourd'hui :

| | mesure |
|---|---|
| Classes distinctes écrites dans les 3 033 lignes de TSX | **279** |
| dont adossées à une règle de `style.css` | **276** |
| dont **utilitaires Tailwind** | **0** |
| Traces de shadcn/ui | **aucune** |
| Hooks React dans les 12 composants | **13 au total** — 5 `useRef`, 4 `useState`, 4 `useEffect` |
| `useMemo` · `useContext` · `useSyncExternalStore` | **0 · 0 · 0** |
| `esc()` (échappement HTML à la main) restants dans `app.js` | **17** |
| Accès `$("id")` dans `app.js` | **180** |

**Deux des quatre piliers annoncés sont absents du code.** Tailwind est installé, configuré (11
directives dans `style.css`) et utilisé par **personne** : sur les 279 classes que les vues
écrivent, 276 pointent une règle maison et aucune n'est un utilitaire. shadcn n'existe nulle part.

Et treize hooks pour douze composants dit le reste : `vues/*.tsx` ne contient pas des composants
React autonomes, mais des **fabriques d'éléments** pilotées de l'extérieur. On a migré la *syntaxe*
du rendu, pas l'architecture. C'est exactement la « dette technique colossale » qu'une refonte est
censée éviter, et elle vient d'avoir été créée par la refonte elle-même.

### Ce qui rend le travail faisable

`v2/main` **n'est pas déployée** : c'est une branche de développement, `main` sert la v1 (ADR-008
§3). Le « verte en permanence » de l'ADR-008 §4 était le corollaire de la migration **vue par vue**,
une phase terminée ; le critère de fusion se mesure **à la bascule** (« tous les tests collectés
passent, aucun échec »).

Et surtout : **le contrat de sélecteurs ne bouge pas** (ids, classes, `data-*`). C'est ce qui fait
des 226 e2e un harnais — donc ce qui rend un rouge transitoire *lisible* et un vert final
*probant*. C'est la contrainte qui autorise l'audace, pas celle qui l'interdit.

### Un obstacle voisin — issue #131

`update-data.yml:71` copie encore les sources à la main, dont `logic.mjs` **disparu depuis #106**,
et ne lance aucun build. Rien n'est cassé tant que `v2/main` n'est pas fusionnée dans `main` ; tout
le sera à la seconde où elle le sera. **Ce n'est pas `app.js` qui sépare la v2 de la production.**

## Décision

**On finit la refonte, on ne l'arrête pas à mi-chemin.** `app.js`, `pont.js` et `rail.js`
disparaissent ; `index.html` se réduit à sa coquille ; l'état devient un module observé par React ;
le câblage devient du JSX.

**`v2/main` a le droit d'être rouge pendant cette phase**, et on peut y retirer temporairement ce
qu'on sait ne pas encore fonctionner. Cet ADR amende le corollaire « verte en permanence » de
l'ADR-008 §4, qui visait une phase terminée.

### Le mécanisme de l'état, et pourquoi il ne crée pas deux vérités

L'objection qui avait fait refuser un magasin (ADR-008, `pont.js:7`) était juste : `refresh()` est
le point de propagation **unique et prouvé complet** — 17 écritures de `SOUTE`, 8 de `JOURNEY`, 5
d'`OVERRIDES`. Lui donner un rival créerait deux vérités.

**On ne lui donne pas de rival : on le renomme.** Les 63 globales deviennent un module d'état
mutable qui reste la seule source de vérité ; `refresh()` devient sa notification ; React s'y abonne
par **`useSyncExternalStore`** (React 19, déjà présent). Aucun état dupliqué, aucun cadre externe.
Le point de propagation change de nom, pas de nature — ce qui rend l'opération mécanique.

### La tentation Tailwind, et où il faut être critique dans l'autre sens

« Comme si on avait codé avec Tailwind » ne veut pas dire « convertir 1 529 lignes de CSS en
utilitaires ». Deux choses s'y opposent, et elles sont mesurées :

- **L'identité du site est une palette, pas des espacements.** Le HUD ambre, les 18 opacités, les
  teintes par système et par famille de commodité — c'est du CSS de thème, et une application
  écrite de zéro avec Tailwind l'aurait écrit… en CSS de thème (`@theme`), exactement comme
  aujourd'hui. Le convertir en utilitaires ne rendrait pas le code plus idiomatique, il rendrait le
  design illisible.
- **15 règles de `style.css` sont adressées par des classes construites par interpolation**
  (`` `k-${kind}` ``, `"sys-" + system`) : invisibles à toute analyse statique, donc **élaguées**
  par une couche Tailwind qui croirait les voir inutilisées. L'ADR-008 l'avait déjà relevé ; c'est
  toujours vrai.

**Ce qu'une application écrite de zéro aurait fait, et qu'on n'a pas :** la *mise en page* et
l'*espacement* dans les composants (`flex`, `gap-*`, `p-*`, `grid`), le *thème* en CSS. Aujourd'hui
la mise en page est aussi dans `style.css`, par classes nommées — c'est **cette moitié-là** qui
n'aurait pas été écrite. La cible n'est donc pas « `style.css` disparaît », mais « `style.css` ne
garde que ce qui est de l'identité ».

**shadcn/ui n'est pas un objectif en soi.** L'ADR-008 le nommait comme un moyen ; le dépôt n'a
aucun composant assez complexe pour le justifier aujourd'hui (pas de dialogue, pas de menu, pas de
combobox — les `<datalist>` natives font le travail). L'introduire pour tenir un titre serait la
même erreur que d'avoir installé Tailwind sans s'en servir. Et son CLI redéfinirait `--muted`, qui
est une **surface** chez lui et un **texte gris** chez nous — **98 références** dans `style.css`.

## Options considérées

### Option A — Alléger par les bords (première rédaction de cet ADR)

**Pour :** chaque PR relisible, branche toujours verte.
**Contre :** on ne finit jamais. Trois extractions retirent au mieux 950 lignes sur 3 454, et les
tranches restantes — l'état, l'orchestration, le câblage — sont celles que l'option s'interdit de
toucher. On garderait **deux architectures à entretenir**, ce qui coûte plus cher que l'une ou
l'autre. **Écartée.**

### Option B — Renommer `app.js` en `app.ts`, architecture inchangée

**Pour :** `tsc` couvre la coquille, diff mécanique.
**Contre :** on type l'architecture qu'on voulait remplacer. Les 41 `peindre()` et les 180 `$("id")`
restent. Étape possible *dans* C, pas destination.

### Option C — Finir : une racine, un état, le câblage en JSX (retenue)

**Pour :** c'est la seule option après laquelle il ne reste rien à démonter, et la seule qui réponde
« oui » à la question posée en tête de cet ADR.
**Contre :** la branche sera rouge entre le début et la fin. Payable **parce que la branche n'est
pas déployée** et que les sélecteurs ne changent pas.

### Option D — Repartir d'une page blanche

**Contre :** on jetterait `logic.ts` (2 609 lignes, 483 tests) et le contrat de sélecteurs — les
deux seules choses qui rendent cette refonte *vérifiable*. Écartée sans hésitation. Une refonte
n'est pas une réécriture : ce qui est déjà idiomatique se garde.

## Conséquences

**Ce qui devient plus facile**
- Le rendu redevient une fonction de l'état. Disparaissent avec `refresh()` : le drapeau `synchrone`
  propagé à la main, le contrat de mesure d'`ajusterRangeeVoyage`, le `flushSync` de l'édition, la
  panne de focus de `#holdAddName` — quatre symptômes du même mal.
- `data-i`, `data-row`, `data-leg` cessent d'être un **canal de données** : une fermeture remplace
  un aller-retour par le DOM. #125 et #128 sont deux instances de ce défaut ; il n'y en aura plus.
- Les 17 `esc()` disparaissent : React échappe.
- Tout passe sous `tsc`, y compris les 63 globales que rien ne vérifie aujourd'hui.

**Ce qui devient plus difficile**
- **La branche sera rouge**, et un rouge qui dure cesse d'informer — d'où le garde-fou ci-dessous.
- Les tests qui lisent `app.js` **comme du texte** (`logic.test.mjs:116`,
  `scripts/jetons.test.mjs:131`) devront suivre à la main : rien ne les avertira.
- La relecture se fera sur le **résultat** — suite au vert, relevé DOM — et non sur le patch.

## Points d'action

1. [ ] **#131, le déploiement** — avant tout : c'est lui qui sépare la v2 de la production.
2. [ ] **`etat.ts`** — les 63 globales en module d'état, `refresh()` en notification, abonnement
       `useSyncExternalStore`. `app.js` importe et continue de tourner : **la branche reste verte**,
       et c'est là qu'on mesure les re-rendus contre `smoke.pw.mjs:2182` (≤ 2 lots de rendu de
       `#rows` pour 8 frappes). Si ce compteur explose, on s'arrête et on rouvre cet ADR.
3. [ ] **Une racine unique** — `index.html` se réduit à `<head>` + `<div id="root">`, ses 114
       balises deviennent des composants, les 41 `peindre()` fusionnent en un arbre. `pont.js` et
       `rail.js` disparaissent. **Rouge permis.**
4. [ ] **Le câblage** — les 56 écouteurs deviennent des props JSX ; persistance et chargement des
       données deviennent des modules TypeScript qui lisent l'**état**, plus le DOM.
5. [ ] **`app.js` supprimé**, `index.html` charge `main.tsx`, ancres textuelles repointées.
       **Retour au vert exigé ici.**
6. [ ] **La moitié « mise en page » de `style.css`** passe en utilitaires dans les composants. Le
       thème et les 15 règles interpolées **restent en CSS, hors couche élaguable**.
7. [ ] `strictNullChecks`, puis `noImplicitAny`, chacun dans sa PR.
8. [ ] shadcn/ui : **seulement si** un composant à venir le justifie. Ne pas l'introduire pour
       tenir un titre.

### Le garde-fou du rouge

Le droit d'être rouge n'est pas un droit d'être aveugle. Pendant les étapes 3 et 4 :

- l'état de la suite est **relevé et chiffré dans la PR à chaque poussée** (« 118/226, les 108
  échecs sont tous dans `smoke` et `plan` ») ;
- **aucune fusion vers `v2/main` tant que la suite n'est pas revenue au vert** : le rouge vit dans
  la branche de travail, jamais dans la branche d'intégration, jamais sur `main` ;
- si le vert n'est pas retrouvé au bout de **deux étapes**, on s'arrête et on rouvre cet ADR plutôt
  que de continuer à l'aveugle.
