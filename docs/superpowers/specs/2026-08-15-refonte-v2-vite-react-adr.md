# ADR-008 : La refonte v2.0.0 — Vite + React + TypeScript + shadcn/ui

**Statut :** Accepté
**Date :** 2026-08-15
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #96 · **Jalon :** v2.0.0 — Refonte

## Contexte

Le site tient en cinq fichiers servis tels quels — `index.html` 420 l., `app.js` 4 027 l.,
`logic.mjs` 2 561 l., `style.css` 1 352 l., `rail.js` 28 l. — avec **zéro dépendance de production**,
une seule de développement (`@playwright/test`), et **aucune étape de build** : `update-data.yml:71`
copie huit fichiers dans `_site` et Pages les sert.

**Ce n'est pas un défaut dont on se débarrasse.** C'est ce qui a rendu la CSP tenable (`index.html:23`
la porte en `<meta>`, seul vecteur possible sous Pages), le déploiement lisible, et le
« que voit vraiment l'utilisateur » vérifiable à l'œil nu. Un ADR qui refond doit d'abord dire ce
qu'il casse — la suite de ce document s'y emploie autant qu'à justifier le changement.

### Ce qui a atteint sa limite (mesuré le 2026-08-15, pas supposé)

**1. Le rendu par `innerHTML` — 45 écritures `.innerHTML =` dans `app.js`.** « Un re-rendu efface la
saisie en cours » n'est pas une série d'accidents, c'est la **conséquence mécanique** du modèle :
détruire un sous-arbre détruit l'état du DOM que personne n'a recopié ailleurs. Le dépôt le combat à
la main, garde par garde :

```js
app.js:1684   if (!force && box.contains(document.activeElement)) return;
app.js:3678   // que #24 : tout re-rendu gratuit de cette vue efface une saisie en cours.
app.js:696    // une saisie en cours y survit (#24).
```

**Quatre tests e2e n'existent que pour surveiller ce symptôme** (`smoke.pw.mjs:2525`, `:2557`,
`:2571`, `:2791`), et ils portent trois numéros d'issue différents — #24, #38, #55. Des entrées
contrôlées et une réconciliation par clé le suppriment **par construction** : il n'y a plus de garde
à oublier, parce qu'il n'y a plus de destruction.

**2. Ajouter une vue coûte dix coutures dispersées.** Mesuré sur `8cfa568`, la huitième vue :
**14 hunks** sur `app.js` + `index.html`, +125 l. d'`app.js`, +25 l. d'`index.html`, +50 l. de
`style.css`. Le bouton du rail (`index.html:83`), l'écouteur (`app.js:3638`), le raccourci clavier
(`app.js:3940`), `switchView` (`app.js:2766`), le conteneur, le rendu, l'état partagé, le
permalien — et la **liste blanche d'`applyState`** (`app.js:3083`), qu'il faut connaître pour que la
vue revienne d'un rechargement. Le message du commit le dit lui-même : *« Les dix points d'ajout de
vue sont faits, liste blanche d'`applyState` comprise. »* Une couture oubliée ne casse aucun test
tant qu'on ne l'a pas écrit.

**3. `logic.mjs` rend les types presque gratuits.** 2 561 lignes de fonctions pures, **470 tests
unitaires en 385 ms**. C'est la moitié du dépôt qui bascule sans risque et sans réécriture — on
annote, on ne refait pas.

### L'atout qui rend la refonte crédible, et qu'il ne faut pas gâcher

**176 tests e2e** — 174 verts, 2 ignorés, **1,2 min** en local — et **108 sélecteurs `#id`
distincts**. « Fini » est déjà écrit, exécutable, et indépendant de l'implémentation.

> **Amendement du 2026-08-15 (PR socle).** Ces chiffres étaient déjà périmés à la rédaction : le
> jalon `v1.1.0` a livré `rail.pw.mjs` entre-temps. **184 collectés** (`playwright test --list` →
> « Total: 184 tests in 6 files »), 182 verts, 2 ignorés. Le socle en ajoute 6 → **190**.
>
> Les **108 sélecteurs `#id`** sont exacts, mais deux d'entre eux sont des fragments d'URL et non
> des sélecteurs : **106 réels**, dont **31 ne sont PAS dans `index.html`** — ils sont émis à
> l'exécution par `app.js`. Et le contrat n'est chiffré qu'à moitié : la suite s'appuie aussi sur
> ~109 sélecteurs de **classe** et 9 attributs `data-*` (`rail.pw.mjs` lit `dataset.view` sur
> `.rail-nav .vbtn`). La structure de classes est un contrat au même titre que les `id`.

> **Les `id` et les classes ne changent pas.** C'est ce qui transforme la suite e2e en **harnais de
> migration** et en contrat anti-régression. Renommer les sélecteurs parce que la nouvelle pile
> invite à le faire détruirait la seule raison objective de croire que cette refonte peut aboutir —
> et rendrait chaque écran « vérifié » par un test qu'on vient d'adapter à ce qu'il produit.

## Décision

### 1. La pile : Vite + React + TypeScript + shadcn/ui

Tranché par le propriétaire. Vite pour le build et le serveur de dev, React pour le rendu,
TypeScript sur tout le code, shadcn/ui (Radix + Tailwind) pour les composants.

*Écarté : Radix ciblé en gardant `style.css`.* C'était ma recommandation — moins de surface, aucune
identité à refaire. Le propriétaire a tranché pour l'**adoption large avec identité visuelle
refaite**, en connaissance du coût. La décision n'est pas à re-litiger ; sa conséquence est en §2.

*Écarté aussi : ne rien faire.* Les trois mesures ci-dessus disent le coût récurrent du statu quo —
il se paie à chaque vue ajoutée et à chaque saisie effacée, pas une fois.

### 2. Les jetons du HUD sont extraits AVANT la première vue migrée

`style.css` porte **19 variables** qui font le caractère du site : `--acc` et `--acc-2` (les ambres),
`--mono` (`style.css:26`), `--stanton` / `--pyro` / `--nyx` (la couleur par système, reprise en
`.sys-*`), et le tramage de fond (`style.css:66`, `repeating-linear-gradient`).

> **Ces jetons deviennent le thème Tailwind d'abord, la première vue ensuite.** Dans l'autre ordre,
> le caractère du site ne se perd pas par décision mais **par accumulation de défauts shadcn** —
> chaque composant posé « provisoirement » en gris neutre, et personne pour dire quand ça a basculé.

C'est la contrepartie exacte de l'adoption large : shadcn donne le comportement, le thème garde
l'identité.

### 3. Bascule unique sur branche longue — `main` sert la v1 jusqu'au bout

Une branche `v2/`, la coquille puis les huit vues, et **une seule fusion**. `main` continue de
déployer la v1 pendant toute la migration.

*Écarté : les îlots progressifs* (React monté vue par vue dans la coquille actuelle, une PR par
vue). L'argument pour était réel — déploiement continu, retour utilisateur immédiat, pas de branche
qui pourrit. L'argument contre l'emporte ici : ça met **deux runtimes et deux systèmes de styles en
production simultanément** pendant des semaines, avec un état partagé (`localStorage`, permalien,
soute) à tenir juste **des deux côtés à la fois**. Le dépôt a déjà payé ce genre de double tenue
(#22, #21), et la CSP `script-src 'self'` rend la cohabitation plus rigide qu'ailleurs.

Le prix accepté : les correctifs v1 qui tombent pendant la migration sont à reporter à la main sur
`v2/`, et la branche vit longtemps.

### 4. Le critère de fusion est un chiffre, pas une impression

**176/176 e2e sur le build Vite, sélecteurs inchangés.** Rien d'autre ne vaut « fini ». Les
2 ignorés restent ignorés pour la même raison qu'aujourd'hui, ou l'ADR est amendé pour dire pourquoi.

> **Amendement du 2026-08-15 (PR socle).** Le critère se reformule en **« tous les tests collectés
> passent, aucun échec »**, avec le compte du jour comme repère (190 depuis le socle) — et non en
> un rapport figé.
>
> Deux raisons, et la seconde est la vraie. D'abord `176` était périmé : un critère chiffré en dur
> se déclare atteint **en perdant des tests**. Ensuite, « les 2 ignorés restent ignorés » n'était
> pas vérifiable : ces deux-là (`smoke.pw.mjs:1719` et `:1759`) sont ignorés à cause des **DONNÉES**
> — l'instantané `data/` committé n'offre aucune commodité rentable à suggérer sur ces chemins.
> **Neuf autres tests** portent le même `test.skip` conditionnel et peuvent basculer d'un côté ou de
> l'autre à la prochaine régénération, **sans qu'une ligne de code bouge**. Adosser le critère de
> fusion de la refonte à un chiffre que le cron peut changer la nuit était une erreur.
>
> Le corollaire du §4 tient sans changement : la migration se fait vue par vue, chacune rendant vert
> son sous-ensemble `-g` avant la suivante.

Corollaire : la migration se fait **vue par vue à l'intérieur de la branche**, chacune rendant vert
son sous-ensemble `-g` avant qu'on passe à la suivante. Une branche longue n'est tenable que si elle
est verte en permanence.

### 5. `logic.mjs` passe en TypeScript sans changer de tests

Les 470 tests unitaires tournent sous `node --test` sur des fonctions pures : ils restent tels
quels. `logic.mjs` devient `logic.ts` et **les signatures sont annotées, pas réécrites** — toute
réécriture de logique dans la même PR rendrait un échec de test inexploitable (nouveau type ou
nouveau bug ?).

C'est aussi ce qui fait de `logic` la **première** chose migrée : elle est vérifiée par 470 tests en
385 ms, alors qu'une vue demande un tour de Playwright.

### 6. La CSP commande la configuration de Vite, pas l'inverse

`index.html:23` — `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' https:` :

- **`img-src` n'a pas `data:`** → Vite inline en base64 tout asset sous 4 ko : `assetsInlineLimit: 0`
  est **obligatoire**, sinon la première icône embarquée disparaît en production seulement.
- **`script-src 'self'`** sans `unsafe-inline` ni `unsafe-eval` : le build de production passe (Vite
  n'émet que des modules externes), mais le **serveur de dev** injecte son client HMR en inline.
  D'où une CSP assouplie **en dev uniquement**, jamais dans `index.html` de production — et
  `scripts/csp.test.mjs` reste le garde-fou qui le vérifie.
- **`style-src` a déjà `'unsafe-inline'`** : les styles inline de React et de Tailwind passent sans
  toucher à la directive. C'est le seul point où la CSP actuelle est plus permissive que nécessaire,
  et la refonte ne l'aggrave pas.

### 7. Les bundles hachés invalident deux tests d'outillage — et le `cp` du déploiement

Trois choses supposent aujourd'hui des **noms de fichiers écrits à la main** :

| Où | Ce qui est écrit à la main |
|---|---|
| `sw.js:11` | `SHELL = ["./", "./index.html", "./app.js", "./rail.js", "./logic.mjs", …]` |
| `update-data.yml:71` | `cp index.html app.js rail.js logic.mjs style.css … _site/` |
| `scripts/csp.test.mjs`, `scripts/version.test.mjs` | vérifient précisément cette correspondance |

Un build à bundles hachés les casse tous les trois. Le remplacement est **un manifeste de précache
émis par le build** — le service worker et les tests le lisent au lieu de réciter une liste. Le
`cp` de huit fichiers devient `npm ci` + `npm run build` + copie de `dist/`.

**Ces tests ne disparaissent pas, ils changent de cible.** Ils existent parce qu'une CSP relâchée ou
un script manquant du `cp` **ne cassent rien de visible en CI** (les e2e tournent depuis le dépôt,
jamais depuis `_site`) : le risque qu'ils couvrent augmente avec un build, il ne diminue pas.

### 8. Trois composants restent bespoke, et c'est décidé maintenant

shadcn n'a d'équivalent pour aucun des trois. Les chercher ferait perdre du temps deux fois :

- **l'en-tête de tableau triable** — `aria-sort` apparaît 15 fois dans `index.html` et 7 fois dans
  `app.js` ; c'est un contrat d'accessibilité que les e2e lisent ;
- **les valeurs corrigeables `.editv`** — 21 occurrences dans `app.js`, 7 règles dans `style.css` ;
- **la carte 2D du voyage** (ADR-001), dessinée en SVG.

### 9. La chaîne de build est une surface d'attaque neuve, et on l'assume

De **0 dépendance de production et 1 de développement** à quelques centaines de paquets
transitifs. La CSP protège **l'exécution dans le navigateur**, elle ne protège pas contre un
paquet compromis qui s'exécute au build. C'est le coût réel de React/Vite/Tailwind, et il ne se
compense pas par une directive.

Ce que ça impose : `npm ci` verrouillé sur le lockfile (déjà la règle en CI, `ci.yml:57`), les
actions déjà épinglées par SHA (déjà le cas), et une revue des dépendances directes à l'amorçage.

## Conséquences

### Sur le backlog

- **`v1.2.0 — Confort` est dissous dans `v2.0.0`.** Ses 11 issues sont presque toutes `area: ui` —
  hiérarchie des boutons (#53, #52), largeurs et débordements (#81, #86), ordre alphabétique (#60),
  aide de première visite (#62), disposition du voyage (#43). Les traiter en vanilla puis les
  réécrire en shadcn, c'est **payer deux fois une ergonomie qu'on jette**. Elles deviennent des
  exigences de la refonte.
- **`v1.1.0` doit être close et taguée avant la première ligne de v2** : #45 (hiérarchie du rail)
  reste, et elle a du sens en vanilla parce qu'elle **arbitre** une ergonomie que la refonte
  implémentera — décider huit entrées de rail est moins cher à faire une fois qu'à refaire.
- **`v1.3.0 — Habillage`** (#68, #69, #73) reste **après** : ce sont des ajouts de saveur, pas des
  fondations, et #73 (relecture générale) ne s'applique plus au même code.

### Ce qui devient plus facile

- Une vue de plus = un composant et une route, plus dix coutures.
- La classe entière de bugs « le re-rendu a effacé ma saisie » cesse d'exister.
- `logic` typée : les erreurs de forme d'objet sortent au build, pas à l'écran.

### Ce qui devient plus difficile

- **Lire le site déployé.** Aujourd'hui « voir la source » suffit ; demain il faut une source map.
- **Le temps de boucle** : plus d'itération instantanée sur un fichier servi tel quel.
- **La confiance dans le déploiement** passe d'un `cp` de huit lignes lisibles à une chaîne d'outils.
- **Une branche longue à tenir verte**, et les correctifs v1 à reporter dessus.

## Ce que cet ADR ne tranche pas

- **Le routeur** (hash actuel vs `react-router`) — le permalien est un contrat e2e, la décision se
  prend à l'amorçage avec les tests sous les yeux.
- **La gestion d'état** (contexte, Zustand, autre) : le dépôt a un état global unique, sauvegardé et
  restauré ; l'ADR n'impose que la **conservation du format du permalien et du `localStorage`**.
- **Tailwind v3 vs v4** et la version de shadcn.
- **L'ordre de migration des huit vues** — sauf que `logic` vient en premier (§5).
- **Le sort du service worker** : le manifeste de précache est décidé (§7), pas la stratégie de
  cache.
- **#45**, qui reste une décision v1.1.0.
