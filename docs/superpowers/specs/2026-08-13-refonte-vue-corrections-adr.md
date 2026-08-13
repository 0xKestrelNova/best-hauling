# ADR-003 : Refonte de la vue Corrections — rangée par station, photo à l'appui

**Statut :** Accepté
**Date :** 2026-08-13
**Décideur :** 0xKestrelNova (propriétaire du dépôt)

## Contexte

Trois reproches faits à la vue Corrections, dans les mots du propriétaire :

> « Chaque modification coûte une ligne, donc il faut mettre plein de coups de molette pour
> descendre. En plus c'est pas rangé. Il faudrait savoir quels prix on a changés par station, et que
> ce soit regroupé. La sélection des stations n'est pas top, car les noms sont parfois plus longs que
> l'encadré. Et une petite photo de la station qu'on modifie, c'est plus parlant. »

### Ce que fait le code aujourd'hui (vérifié)

| Symptôme | Cause racine |
|---|---|
| Une ligne par correction, et il faut défiler | `correctionsListHTML` (`app.js:2594`) émet un `.corr-item` par clé de `OVERRIDES`, soit un bloc de ~45 px par correction. Vingt corrections = 900 px de liste. |
| « C'est pas rangé » | La même fonction fait `Object.keys(OVERRIDES).sort()`. La clé est `commodité\|terminal\|side` : le tri est donc **par commodité**. Deux corrections faites au même comptoir se retrouvent à trente lignes d'écart. |
| La liste est loin | `renderCorrections` (`app.js:2609`) empile `#correctionsStation` **puis** `#correctionsList`. Le panneau station mesure jusqu'à 2 600 px (GrimHEX, 92 commodités) : la liste est systématiquement sous l'horizon. |
| Les noms de station sont tronqués | `#station` est un `<input list="stationList">` (`index.html:228`). Un `<datalist>` natif ne se met pas en forme, et sa liste déroulante est calée sur la largeur du champ. Les libellés font 20,6 caractères en moyenne, et jusqu'à 33 (`Terra Gateway (Stanton) — Stanton`). |

### Ce que les données permettent (vérifié contre l'API, pas supposé)

L'endpoint `terminals?type=commodity` d'UEX expose `screenshot`, `screenshot_full` et
`screenshot_author`. Apparié à nos 114 terminaux :

| | Nombre |
|---|---|
| Terminaux appariés | 114 / 114 |
| Avec un `screenshot` | **97** |
| Sans | 17 — les Lagrange (CRU-L1, CRU-L5, HUR-L3, HUR-L4, MIC-L1), Levski, PSS Lambda, Pyro Gateway (Nyx), et 4 avant-postes Pyro |
| Auteurs distincts crédités | 14 |

L'ADR-001 avait déjà repéré ces champs et les avait classés « décor éventuel, hors périmètre ». Le
périmètre les rattrape ici.

Deux autres faits mesurés sur l'API, tous deux structurants :

- **`code` n'est pas unique.** `Pyro Gateway (Stanton)` et `Pyro Gateway (Nyx)` valent tous deux
  `PYROG`. Il sert à l'affichage et à la recherche, **jamais** de clé.
- **12 terminaux n'ont pas de planète** (les 5 portes de saut, les 4 PSS, Levski, et tout Nyx). Le
  fait était déjà relevé par l'ADR-001. `orbit_name` ne comble le trou que pour Levski (`Delamar`) ;
  pour les autres il recopie le nom du terminal.

### Ce qui existe déjà et qu'il ne faut pas réinventer

- **Une autocomplétion maison, avec navigation clavier** : `loadShips` (`app.js:2158-2210`) — filtre
  par sous-chaîne, `role="listbox"`, `aria-expanded` tenu, `.active` sur l'option courante.
- **Une photo distante affichée sans casse** : la carte du vaisseau (`app.js:2199`) filtre sur
  `^https://`, assigne `img.onerror` **en propriété** et masque le cadre à l'échec.
- **Le pont nom → terminal** : `termByName` (`app.js:702`), peuplé en même temps que `stationMap`.
- **Le marqueur de valeur corrigée** : `editv` émet déjà `.editv.ov` et un `<span class="ovmark">✎`
  (`app.js:416`).
- **La grammaire « actif »** : `.vbtn.active` (`style.css:131`) et `.sort-modes button.active`
  (`style.css:901`) disent la même chose de la même façon.

### Rapport avec la spec du 2026-08-12

`2026-08-12-peremption-des-volumes-et-corrections-groupees-design.md` couvre la même vue. État
vérifié le 2026-08-13 :

- **Partie 1 (péremption des volumes à 3 h) : livrée.** `DUREE_VOL`, `staleVol` et le champ `pris`
  sont dans `logic.mjs:208-235` et `:559-588`.
- **Partie 2 (tri alphabétique des tuiles + « mode station ») : non livrée.**
  `stationTableHTML` (`app.js:2534`) parcourt encore `MARKET.commodities` dans l'ordre UEX.

Le présent ADR **ne remplace pas** cette partie 2 : « corrections groupées » y désigne la *saisie*
en lot, ici le *rangement* de la liste. Les deux sont complémentaires. Leur seul recouvrement est
`stationTableHTML` — la partie 2 en réécrit la boucle de tuiles, cet ADR n'en réécrit que la ligne
de titre. L'ordre d'arrivée est donc libre, au prix d'un rebase trivial.

## Décision

La vue Corrections est réorganisée autour de la **station** plutôt que de la correction.

1. La liste plate disparaît. À sa place, une **bande de vignettes**, une par station corrigée, placée
   **au-dessus** du panneau station. Vingt corrections tiennent en une rangée au lieu de 900 px.
2. La station affichée est **épinglée en première position** de cette bande et mise en
   surbrillance : la bande se lit comme une barre d'onglets, le panneau comme son contenu.
3. Le `<datalist>` de `#station` cède la place à une **autocomplétion maison groupée**
   `système › zone › station`, sur le modèle du champ Vaisseau.
4. Le titre du panneau devient un **bandeau collant** portant la photo de la station.
5. La suppression d'une correction isolée migre de la liste **vers le chiffre lui-même**.
6. Les photos viennent du **CDN UEX**, recopiées verbatim dans `market.json` par le pipeline.

### Le socle : deux fonctions pures

Dans `logic.mjs`, où le dépôt met ce qui se teste sans DOM :

```js
// (store, terminalActif) -> [{ terminal, système, corrections, actif }]
// L'actif est en tête, même à zéro correction ; les autres par corrections
// décroissantes puis nom. Ne lit que des clés à TROIS segments.
groupOverridesByTerminal(store, actif)

// terminaux -> [{ système, zones: [{ zone, stations }] }]
// zone = planète || (orbite ≠ nom du terminal ? orbite : « Espace profond »)
// Systèmes dans l'ordre Stanton, Pyro, Nyx ; zones et stations en localeCompare.
stationTree(terminals)
```

`groupOverridesByTerminal` hérite d'une contrainte déjà écrite dans `app.js:217-223` : les relevés
d'autoload vivent dans un store séparé sous une clé à **deux** segments, précisément pour qu'aucun
lecteur de `OVERRIDES` ne les confonde avec une correction. La fonction ne voit que `OVERRIDES`.

### Le socle : trois champs dans `market.json`

Ajoutés au terminal, dans `scripts/build-data.mjs` (index ligne 321, projection ligne 258) :

```js
code: t.code || "",                 // « LEVSKI », « ARCL1 » — non unique
shot: t.screenshot || "",           // miniature CDN, recopiée VERBATIM
shotBy: t.screenshot_author || "",  // le joueur qui l'a soumise
```

**Verbatim est une décision.** Le commentaire du CSP (`index.html:15-18`) documente déjà pourquoi on
ne reconstruit pas ces URL : *« une liste figée ferait disparaître les photos en production sans
qu'aucun test committé ne le voie »*. UEX sert deux formes d'URL selon l'âge de la soumission.

Coût mesuré : `market.json` passe de 83,2 Ko à ~96 Ko brut (20,3 → ~27 Ko gzip). Un fichier séparé
ne gagnerait rien : la vue a besoin de `market.json` de toute façon (`withMarket`).

`screenshot_full` **n'est pas repris** : une visionneuse plein écran est une fonctionnalité en soi.

**Propagation :** `build-data.mjs:288-293` exclut délibérément les champs de terminaux de la
signature de déploiement. Les trois champs n'atteignent la prod qu'au `FORCE=1`, que le workflow pose
sur tout push hors cron — la fusion sur `main` suffit. La régénération de l'amorce part dans son
propre commit `chore(data): …`.

### La vue

```
#correctionsControls   picker groupé + aide
#correctionsIndex      ← NOUVEAU : la bande
#correctionsStation    bandeau collant (photo) + grilles achat/vente
#correctionsFees       panneau et relevés d'autoload, en pied
```

```
◈ GRIMHEX · en cours          3 autres stations · 17 corrections  [Tout réinitialiser]
┏━━━━━━━━━┓ ┌─────────┐ ┌─────────┐ ┌─────────┐
┃▓ photo ▓┃ │▓ photo ▓│ │  ARCL1  │ │▓ photo ▓│   ← vignette générée
┃ GrimHEX ┃ │ Levski  │ │ ARC-L1  │ │  Ruin   │
┃ ◈Sta  3 ┃ │ ◈Nyx  6 │ │ ◈Sta  9 │ │ ◈Pyr  2 │
┗━━━━━━━━━┛ └─────────┘ └─────────┘ └─────────┘
     ▲ épinglée, EN COURS, aria-current
┌──────────────────────────────────────────────────────────────────┐
│ ▓photo▓  ◈ GrimHEX  ◈Stanton · Yela · GRIM  3 corrections  [✕]   │ ← collant
```

La bande **passe à la ligne** plutôt que de défiler horizontalement : le nombre de stations est petit
par construction — on corrige là où on s'amarre — et un défilement caché coûterait plus en
découvrabilité qu'il ne gagnerait en hauteur.

Le compteur d'en-tête compte les **autres** stations : sinon une station active à zéro correction
gonflerait le total d'une entrée vide.

Le compteur d'une tuile est recalculé à chaque rendu, après que `effVals` a purgé le store. Il reste
donc vrai quand un volume se périme tout seul au bout de 3 h — la bande ne tient aucun état propre.

### La surbrillance de la station active

Reprise mot pour mot de la grammaire du rail (`.vbtn.active`) : texte blanc, `1px solid var(--line2)`,
liseré gauche `2px solid var(--acc)`, fond ambre dégradé, ombre interne. Plus trois choses qui ne
tiennent pas à la couleur :

- **`EN COURS` écrit** en `var(--mono)` dans le coin. C'est la règle maison, posée dans le
  commentaire de `.scomm` (`style.css:817-821`) : *« le mot reste écrit, pour qui ne distingue pas
  les deux teintes »*.
- **`aria-current="true"`**, sans quoi un lecteur d'écran entend cinq boutons identiques.
- **Un cran de raccord** vers le bandeau, qui fait lire l'ensemble comme un onglet et son panneau.
- **`:focus-visible` en `var(--acc-2)`**, distinct de la sélection : le focus clavier ne doit pas se
  confondre avec l'état actif.

Les tuiles inactives ne sont **pas** estompées dans leur ensemble : `opacity: .62` ferait passer leur
texte `--muted` (#8a93a8 sur #0b0f1c, 5,6:1) sous les 3:1, donc sous AA. L'estompage ne porte que sur
la **photo**, qui ne porte aucun texte, et se lève au survol.

### Le picker

`#station` perd son attribut `list`. **Le `<datalist id="stationList">` reste dans la page** :
`#destTerminal`, `#journeyStart` et `#journeyAddStop` s'en servent encore, et huit assertions E2E
lisent `#stationList option`.

Deux invariants de compatibilité, non négociables :

- **La valeur écrite dans `#station` reste le libellé canonique `Nom — Système`.** `resolveStation`
  est inchangée, l'état partageable `station=…` continue de se décoder, et les `page.fill("#station")`
  des tests continuent de marcher.
- **La saisie libre reste intacte.** Le test `#54` tape `"Levski — Nyx (une station qu'on tape en
  entier)"` et vérifie le champ au caractère près. Le picker propose, il ne corrige jamais la saisie.
  Le debounce qui limite `history.replaceState` reste en place.

Le filtre porte sur le nom **et** sur le code : taper `PYROG` remonte les deux portes de saut
homonymes, que leur badge système distingue. C'est exactement pourquoi le code n'est pas une clé.

### La suppression sur le chiffre

Contrepartie de la disparition de la liste : il faut pouvoir défaire **une** correction.

Le `✎` de `.editv.ov` devient actionnable (`role="button"`), et le gestionnaire de clic global teste
`closest(".ovmark")` **avant** d'ouvrir l'éditeur. Il lui manque une information pour être utile : la
valeur UEX d'origine. `effValue` ne renvoie que les booléens `oprice`/`ovol` (`logic.mjs:227-234`),
mais la valeur brute est disponible sur place — `cote()` la tient dans `p[1]`/`p[2]`. `editv` gagne
donc un paramètre optionnel `orig`, et l'infobulle devient :

> *Corrigé localement · UEX disait 27 400 — clic pour y revenir*

On efface là où on regarde, avec sous les yeux ce vers quoi on revient. L'ancienne liste ne montrait
ni l'un ni l'autre.

### Le repli photo, et un piège CSP

17 terminaux n'ont pas de screenshot, et une URL peut tomber. Le repli est une **vignette générée** :
dégradé teinté par système (`--stanton`, `--pyro`, `--nyx` existent déjà), code UEX en `var(--mono)`,
glyphe avant-poste. Aucune requête, aucune case vide.

**Le piège :** `script-src 'self'` interdit les attributs `on*`. Un `<img onerror="…">` posé par
`innerHTML` serait **silencieusement bloqué** et laisserait des images cassées. La carte du vaisseau
y échappe parce qu'elle assigne `img.onerror` en propriété JS (`app.js:2199`).

Pour une bande rendue en bloc, la solution est un écouteur **délégué en phase de capture** — les
événements `error` ne remontent pas, mais ils descendent :

```js
$("correctionsIndex").addEventListener("error", (e) => {
  if (e.target.tagName === "IMG") e.target.closest(".stn-tile")?.classList.add("no-shot");
}, true);
```

Un seul écouteur, posé une fois, qui survit à tous les re-rendus.

## Options considérées

### Option A — Bande en tête, colonne unique ✅ *retenue*

`picker → bande → bandeau collant → grilles`, en une colonne.

| Dimension | Évaluation |
|---|---|
| Complexité | Faible — le plus petit delta CSS |
| Largeur utile | Intacte : la grille garde 5-6 colonnes en 1600 px |
| Repli mobile | Aucun à écrire : la bande passe à la ligne toute seule |
| Risque | La bande occupe ~110 px en permanence |

### Option B — Deux colonnes

Rail gauche fixe (~280 px) avec picker et index vertical ; panneau à droite, seul à défiler.
Précédent maison : l'ADR-001 a sorti la carte en troisième colonne pour occuper les grands écrans.

**Contre :** contredit la bande horizontale validée ; la grille tombe à 3-4 colonnes ; sous 1 100 px
il faut un repli complet, donc deux mises en page à tenir ; le plus gros delta CSS.

### Option C — A, plus le picker partout

A, plus l'adoption du nouveau picker par les cinq autres champs de terminal.

**Contre :** quadruple la surface E2E, touche les vues Voyage et En route hors demande, et donne une
PR trop large pour être relue. **Reportée** en PR de suivi.

### Option D — Garder la liste, la trier par terminal ❌

Le tri suffirait à répondre à « c'est pas rangé », pas à « plein de coups de molette » : vingt
corrections resteraient vingt lignes. Et ni la photo ni le sélecteur n'y trouveraient leur place.

## Analyse des compromis

**Ce qu'on abandonne, et pourquoi c'est acceptable.** La liste plate donnait une vue exhaustive de
toutes les corrections, tous comptoirs confondus. La bande ne donne que des compteurs. Le geste
qu'elle servait — « supprimer cette correction précise » — est remplacé par un geste **meilleur** :
l'effacer sur le chiffre, en voyant la valeur UEX vers laquelle on revient. Le geste qu'elle ne sert
plus — « relire les 20 corrections d'affilée » — n'a jamais été demandé, et il coûtait le défilement.

**Épingler l'actif plutôt que le placer au-dessus.** Mettre le panneau avant la bande remettrait la
navigation sous 2 600 px de grille. L'épinglage donne la même priorité visuelle sans déplacer quoi
que ce soit, et couvre en prime le cas « station jamais corrigée », où la bande serait sinon vide.

**Le CDN plutôt qu'un dossier local.** Un dossier de 114 images committées marcherait hors-ligne,
mais : sourcing manuel récurrent, ~5-10 Mo de binaires versionnés, droits flous sur des captures
Star Citizen, et rediffusion du travail d'auteurs tiers sans leur hébergement. Le CDN coûte
l'indisponibilité hors-ligne — dégradée en vignette générée, donc sans casse.

## Conséquences

**Devient plus facile**
- Retrouver ce qu'on a corrigé, et où : un coup d'œil au lieu d'un défilement.
- Enchaîner deux stations : un clic, sans défiler ni retaper.
- Choisir une station dont le nom est long, ou dont on ne connaît que le code.
- Savoir sur quelle station on travaille pendant qu'on fait défiler 92 commodités.

**Devient plus difficile**
- Auditer toutes les corrections d'un coup : il faut ouvrir chaque station.
- La vue dépend d'un CDN tiers pour son décor. Dégradation prévue, jamais bloquante.

**À revisiter**
- Si la bande dépasse deux rangées en usage réel, il faudra un repli (`+N`).
- Le picker sera à généraliser aux cinq autres champs (option C).
- `stationTree` deviendra le bon endroit pour un filtre « masquer les avant-postes » : ils sont 58
  sur 114.

## Plan d'action

Trois PRs, pas une. Une seule toucherait le pipeline, `logic.mjs`, le picker, la bande et le hero.

1. [ ] `feat(data): les terminaux portent leur code UEX et leur photo` — `build-data.mjs` +
       `build-data.test.mjs`. Étiquette `enhancement`. Suivie d'un `chore(data): régénérer l'amorce`
       **séparé**.
2. [ ] `fix(corrections): choisir une station sans que son nom soit tronqué` — picker + `stationTree`.
       Étiquette `bug`, ferme son issue. Autonome : la bande n'en dépend pas.
3. [ ] `feat(corrections): les corrections se rangent par station, photo à l'appui` — bande, bandeau
       collant, `✎` réversible, retrait de la liste plate. Étiquette `enhancement`.

Avant d'ouvrir : `gh issue list --state open` (les épinglées d'abord), puis créer les deux issues
manquantes — une `bug` pour la troncature du sélecteur, une `enhancement` pour la liste plate.

### Tests

**`logic.test.mjs`**
- `groupOverridesByTerminal` : deux clés d'une même station → une entrée ; actif épinglé même à
  zéro ; une clé à deux segments ignorée ; tri stable à égalité.
- `stationTree` : Levski → `Delamar`, portes de saut → `Espace profond` ; ordre Stanton/Pyro/Nyx ;
  `localeCompare` sur les zones.

**`scripts/build-data.test.mjs`** : `code`, `shot`, `shotBy` recopiés verbatim ; une valeur absente
donne `""`, jamais `undefined`.

**`e2e/smoke.pw.mjs`**
- la bande apparaît après une correction, avec le bon compteur ;
- un clic sur une tuile charge la station ;
- la tuile active porte `aria-current` **et** le texte `EN COURS` ;
- taper `PYROG` remonte les deux portes de saut ; `↓ ↓ Entrée` sélectionne ;
- le `✎` ramène à la valeur UEX sans ouvrir l'éditeur ;
- **relire** le plafond de 2 600 px de `smoke.pw.mjs:132` une fois le bandeau en place, sans le
  supposer : il remplace une ligne de titre (~26 px) par un bandeau de ~76 px.

Le correctif du picker arrive en TDD : le test « le nom complet d'une station longue est lisible sans
troncature » doit échouer sur le `<datalist>` actuel avant d'exister.

## Ce qui n'est pas couvert

- Les 17 terminaux sans photo restent en vignette générée. Aucun appoint manuel.
- Pas de visionneuse plein écran : `screenshot_full` n'est pas repris.
- **Tri par récence : possible mais partiel, donc écarté.** Le store porte `pris` depuis la
  péremption des volumes (`logic.mjs:578-584`) — mais `pris` n'existe que pour un **volume**. Une
  station corrigée uniquement en prix n'a aucune date. Un tri mêlant les deux mentirait ; le tri
  retenu reste « corrections décroissantes, puis nom ».
- Les cinq autres champs de terminal gardent le `<datalist>` natif (option C, PR de suivi).
- La vue Commodités (06) n'est pas touchée.
- La partie 2 de la spec du 2026-08-12 (tri alphabétique des tuiles, « mode station ») reste à faire,
  indépendamment de cet ADR.
- Un compte à rebours de péremption sur les vignettes (un volume meurt à 3 h) n'est pas prévu : le
  compteur se corrige tout seul au rendu suivant.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
