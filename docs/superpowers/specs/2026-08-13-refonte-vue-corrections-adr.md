# ADR-003 : Refonte de la vue Corrections — rangée par station, photo à l'appui

**Statut :** Accepté — amendé le 2026-08-13 après reconnaissance contre le code et l'API (voir
les blocs « correction du 2026-08-13 »)
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
| Une ligne par correction, et il faut défiler | `correctionsListHTML` (`app.js:2575`) émet un `.corr-item` par clé de `OVERRIDES`, soit un bloc de ~45 px par correction. Vingt corrections = 900 px de liste. |
| « C'est pas rangé » | La même fonction fait `Object.keys(OVERRIDES).sort()`. La clé est `commodité\|terminal\|side` : le tri est donc **par commodité**. Deux corrections faites au même comptoir se retrouvent à trente lignes d'écart. |
| La liste est loin | `renderCorrections` (`app.js:2590`) empile `#correctionsStation` **puis** `#correctionsList`. Le panneau station mesure jusqu'à 2 600 px (GrimHEX, 92 commodités) : la liste est systématiquement sous l'horizon. |
| Les noms de station sont tronqués | `#station` est un `<input list="stationList">` (`index.html:228`). Un `<datalist>` natif ne se met pas en forme, et sa liste déroulante est calée sur la largeur du champ. Les libellés font 20,6 caractères en moyenne, et jusqu'à 33 (`Terra Gateway (Stanton) — Stanton`). |

### Ce que les données permettent (vérifié contre l'API, pas supposé)

L'endpoint `terminals?type=commodity` d'UEX expose `screenshot`, `screenshot_full` et
`screenshot_author`. Apparié à nos 114 terminaux :

| | Nombre |
|---|---|
| Terminaux appariés | 114 / 114 |
| Avec un `screenshot` | **97** |
| Avec un `screenshot_author` | **89** |
| Sans photo | **17** (liste ci-dessous) |
| Hôtes CDN distincts | 2 |

Les 17 sans photo, nommés en entier — la première rédaction de cet ADR n'en listait que 12 :
CRU-L1, CRU-L5, HUR-L3, HUR-L4, MIC-L1, Levski, PSS Lambda, Pyro Gateway (Nyx), Patch City,
Rod's Fuel, Gaslight, Rat's Nest, Dudley & Daughters, et 4 avant-postes (Ashland, Canard View,
Last Landings, Scarper's Turn).

**`shot` et `shotBy` sont indépendants** : 97 photos pour 89 auteurs. Huit terminaux ont une photo
**sans** auteur crédité — HUR-L2, Lorville L19, Orbituary, Orison Providence, Pickers Field,
TDD Orison, Terra Gateway (Stanton), Terra Mills. Un rendu qui écrit « photo de {auteur} » dès que
la photo existe affichera un crédit vide sur ces huit-là.

**Deux hôtes CDN**, et c'est ce qui valide la décision « verbatim » : `cdn.uexcorp.space` (96) et
`uexcorp.us-southeast-1.linodeobjects.com` (1, Nyx Gateway (Pyro)). Une liste figée sur le premier
perdrait déjà une photo aujourd'hui. `img-src 'self' https:` couvre les deux.

L'ADR-001 avait déjà repéré ces champs et les avait classés « décor éventuel, hors périmètre ». Le
périmètre les rattrape ici.

Deux autres faits mesurés sur l'API, tous deux structurants :

- **`code` n'est pas unique.** `Pyro Gateway (Stanton)` et `Pyro Gateway (Nyx)` valent tous deux
  `PYROG`. Il sert à l'affichage et à la recherche, **jamais** de clé. La seule clé fiable est
  l'index dans `MARKET.terminals`, celui que porte déjà `stationMap`.
- **12 terminaux n'ont pas de planète** : les **7** portes de saut, les 4 PSS, et Levski. Le fait
  était déjà relevé par l'ADR-001 — qui écrit bien « 7 passerelles », là où la première rédaction de
  cet ADR-ci en comptait 5 à tort.

#### `orbit_name` ne sauve pas les 12 — correction du 2026-08-13

La première rédaction affirmait qu'`orbit_name` « recopie le nom du terminal » pour les 11 autres, et
en tirait une règle de zone à trois branches. **Les données démentent.** `orbit_name` n'en recopie
pas le nom, il en donne une *variante* : `Pyro Gateway (Stanton system)` pour le terminal
`Pyro Gateway (Stanton)`, `People's Service Station Alpha` pour `PSS Alpha`. Le test « orbite ≠ nom »
est donc vrai **partout**, et les 7 passerelles comme les 4 PSS recevraient une zone parasite au lieu
d'« Espace profond ». La règle échouait sur 11 terminaux sur 12.

Aucune retouche textuelle ne tient : un test de contenance répare les 7 passerelles mais pas les
4 PSS, dont l'abréviation ne se déduit pas de la chaîne longue. Le champ n'achète donc exactement
qu'un libellé — `Delamar` pour Levski — au prix d'une heuristique fausse onze fois.

**Décision : on renonce à `orbit_name`.** La règle devient `zone = planète || « Espace profond »`.
Les 12 sans planète y tombent tous, Levski compris. Effet de bord heureux : le LOT 2 n'a plus besoin
d'un quatrième champ que le LOT 1 ne prévoyait pas.

### Ce qui existe déjà et qu'il ne faut pas réinventer

- **Une autocomplétion maison, avec navigation clavier** : `loadShips` (`app.js:2139-2252` — la
  fonction va bien jusqu'à 2252 : `choose`, `highlight`, le `keydown`, le `mousedown` et le `blur`
  en font partie, et c'est la moitié de ce qu'il y a à reprendre) — filtre
  par sous-chaîne, `role="listbox"`, `aria-expanded` tenu, `.active` sur l'option courante.
- **Une photo distante affichée sans casse** : la carte du vaisseau (`app.js:2178-2180`) filtre sur
  `^https://`, assigne `img.onerror` **en propriété** et masque le cadre à l'échec.
- **Le pont nom → terminal** : `termByName` (déclaré `app.js:683`, peuplé `:772`, juste après
  `stationMap`).
- **Le marqueur de valeur corrigée** : `editv` émet déjà `.editv.ov` et un `<span class="ovmark">✎`
  (signature `app.js:416`, corps qui les émet `:428` — et `.editv` y porte **déjà**
  `role="button" tabindex="0"`, ce qui contraint fortement la suite).
- **La grammaire « actif »** : `.vbtn.active` (`style.css:131`) et `.sort-modes button.active`
  (`style.css:906`) disent la même chose de la même façon.

### Rapport avec la spec du 2026-08-12

`2026-08-12-peremption-des-volumes-et-corrections-groupees-design.md` couvre la même vue. État
vérifié le 2026-08-13 :

- **Partie 1 (péremption des volumes à 3 h) : livrée.** `DUREE_VOL`, `staleVol` et le champ `pris`
  sont dans `logic.mjs:208-235` et `:559-588`.
- **Partie 2 (tri alphabétique des tuiles + « mode station ») : non livrée.**
  `stationTableHTML` (`app.js:2515`) parcourt encore `MARKET.commodities` dans l'ordre UEX.

Le présent ADR **ne remplace pas** cette partie 2 : « corrections groupées » y désigne la *saisie*
en lot, ici le *rangement* de la liste. Les deux sont complémentaires.

**Correction du 2026-08-13.** La première rédaction affirmait que le recouvrement se limitait à la
ligne de titre de `stationTableHTML`, et en concluait « l'ordre d'arrivée est libre, au prix d'un
rebase trivial ». C'est faux sur les deux points. Le LOT 3 sort aussi `stationFeeHTML` de cette
fonction — appelé à **deux** endroits, dont la branche de retour anticipé « aucune commodité » — pour
clore #24 : c'est une restructuration du corps, pas une retouche de titre. Et la partie 2 réécrit ce
même corps. Le rebase demandera de l'attention, et le présent ADR passe **en premier**.

En revanche, la collision sémantique sur le glyphe `✎` — qui aurait signifié « corriger la station »
dans l'une et « revenir à la valeur UEX » dans l'autre — a disparu avec la révision du retour arrière
(voir plus bas).

## Décision

La vue Corrections est réorganisée autour de la **station** plutôt que de la correction.

1. La liste plate disparaît. À sa place, une **bande de vignettes**, une par station corrigée, placée
   **au-dessus** du panneau station. Vingt corrections tiennent en une rangée au lieu de 900 px.
2. La station affichée est **épinglée en première position** de cette bande et mise en
   surbrillance : la bande se lit comme une barre d'onglets, le panneau comme son contenu.
3. Le `<datalist>` de `#station` cède la place à une **autocomplétion maison groupée**
   `système › zone › station`, sur le modèle du champ Vaisseau.
4. Le titre du panneau devient un **bandeau collant** portant la photo de la station.
5. La suppression d'une correction isolée migre de la liste **vers la tuile de la commodité**, par un
   contrôle dédié `↺ UEX 27 400` — et non par le `✎`, qui reste décoratif (voir la révision).
6. Les photos viennent du **CDN UEX**, recopiées verbatim dans `market.json` par le pipeline.

### Le socle : deux fonctions pures

Dans `logic.mjs`, où le dépôt met ce qui se teste sans DOM :

```js
// (store, terminalActif) -> [{ terminal, système, corrections, actif }]
// L'actif est en tête, même à zéro correction ; les autres par corrections
// décroissantes puis nom. Ne lit que des clés à TROIS segments.
groupOverridesByTerminal(store, actif)

// terminaux -> [{ système, zones: [{ zone, stations }] }]
// zone = planète || « Espace profond »  (cf. correction du 2026-08-13 ci-dessus)
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

Coût **mesuré en projetant réellement les champs sur les 114 terminaux** : `market.json` passe de
85 220 à 105 240 octets bruts, et de 20 757 à 25 489 octets gzip. Le premier chiffrage de cet ADR
(« 83,2 → ~96 Ko brut, 20,3 → ~27 Ko gzip ») était faux dans les deux sens : sous-estimé sur le brut
parce que l'amorce committée ne porte **pas encore** `autoload` ni `maxBox`, pourtant émis par le
pipeline depuis la fonctionnalité d'autoload — ils entreront à la même régénération ; surestimé sur
le gzip parce que les URL du CDN partagent un long préfixe commun. Un fichier séparé
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

**Correction du 2026-08-13 — le compteur d'une tuile ne peut pas être « toujours vrai ».** La
première rédaction l'affirmait ; c'est faux. La purge d'un volume périmé est un **effet de bord** de
`effFromStore` (`logic.mjs:561-567`), déclenché par `effVals` (`app.js:187-194`), et
`stationTableHTML` n'appelle `effVals` que pour les commodités de **la station affichée**, et
seulement celles qui passent le filtre. Les corrections des **autres** stations ne sont donc jamais
interrogées, donc jamais purgées : leurs compteurs **surcomptent** les volumes périmés jusqu'à ce
qu'on clique dessus.

`groupOverridesByTerminal` **purge donc explicitement** avant de compter, plutôt que de laisser la
bande mentir. C'est la seule des deux réponses possibles qui tient la promesse faite à l'utilisateur.

### La surbrillance de la station active

Reprise mot pour mot de la grammaire du rail (`.vbtn.active`) : texte blanc, `1px solid var(--line2)`,
liseré gauche `2px solid var(--acc)`, fond ambre dégradé, ombre interne. Plus trois choses qui ne
tiennent pas à la couleur :

- **`EN COURS` écrit** en `var(--mono)` dans le coin. C'est la règle maison, posée dans le
  commentaire de `.scomm` (`style.css:822-826`) : *« le mot reste écrit, pour qui ne distingue pas
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

### Le retour arrière — révisé le 2026-08-13

Contrepartie de la disparition de la liste : il faut pouvoir défaire **une** correction.

**La première rédaction rendait le `✎` actionnable. Elle n'était pas réalisable.** Trois faits
vérifiés la condamnent :

1. **Bouton dans un bouton.** `editv` (`app.js:428`) pose déjà `role="button" tabindex="0"` sur
   `.editv`, et `.ovmark` est **imbriqué dedans**. Y ajouter un second `role="button"` produit une
   imbrication invalide en ARIA, à la restitution imprévisible.
2. **Le sortir en frère casse l'édition.** `startEdit` mémorise `[...span.childNodes]` puis les
   restaure par `replaceChildren` (`app.js:2409-2433`). Le test `smoke.pw.mjs:1374` vérifie
   nommément que *« l'affichage d'origine est restauré, ✎ compris »*.
3. **Neuf sites d'appel, quatre vues hors périmètre.** `editv` est appelé en `app.js:583, 589, 934,
   935, 936, 937, 2532, 2533, 2691` — Trajets, Manifeste, En route et Commodités compris. Un `✎`
   actionnable y deviendrait un retour arrière destructif d'un seul clic, sans confirmation, et
   **sans** l'infobulle qui le justifie : `applyOverrides` (`:382-383`) y a déjà écrasé la valeur
   brute. Aggravant : `isOv` (`:802`) lit `OVERRIDES` en direct sans passer par `effValue`, donc
   ignore `staleVol` — dans ces vues, un volume périmé depuis plus de 3 h affiche encore son `✎`.

**Décision : le `✎` reste le marqueur décoratif qu'il est, partout.** Le retour arrière prend la
forme d'un **contrôle dédié dans la tuile `.scomm`, hors du `.editv`**, et **seulement dans la vue
Corrections** :

> `↺ UEX 27 400`

Ce que ça règle d'un coup : aucune imbrication ARIA, `startEdit` et son test intacts, aucune des
quatre autres vues touchée, et une cible de clic confortable au lieu des **9 × 9 px** du `✎`
(`style.css:683` : `font-size: 9px`, `vertical-align: super`) — 9 px imbriqués dans un autre
déclencheur, où manquer sa cible produit exactement l'inverse du geste voulu.

La valeur UEX d'origine reste nécessaire, et reste disponible : `effValue` ne renvoie que les
booléens `oprice`/`ovol` (`logic.mjs:227-234`), mais `cote()` (`app.js:2529`) tient la valeur brute
dans `p[1]`/`p[2]`.

**`pinLegsForVolume` est obligatoire sur ce nouveau chemin.** Les deux chemins de suppression
existants l'appellent — `startEdit` (`:2425`) avant écriture, et `.corr-del` (`:2849-2852`) — pour la
raison écrite en commentaire en `:2846` : rendre son stock à UEX reste un changement de volume, et un
voyage déjà planifié se rebattrait tout seul. Aucun test actuel n'attraperait cet oubli.

**Effet de bord heureux :** la collision sémantique avec la partie 2 de la spec du 2026-08-12
disparaît. Celle-ci introduit un bouton « ✎ Corriger la station » qui bascule les tuiles en champs
éditables ; le `✎` gardant ici son sens décoratif, le même glyphe ne porte plus deux sens opposés
dans la même vue.

### Le repli photo, et un piège CSP

17 terminaux n'ont pas de screenshot, et une URL peut tomber. Le repli est une **vignette générée** :
dégradé teinté par système (`--stanton`, `--pyro`, `--nyx` existent déjà), code UEX en `var(--mono)`,
glyphe avant-poste. Aucune requête, aucune case vide.

**Le piège :** `script-src 'self'` interdit les attributs `on*`. Un `<img onerror="…">` posé par
`innerHTML` serait **silencieusement bloqué** et laisserait des images cassées. La carte du vaisseau
y échappe pour **deux** raisons et non une : elle filtre `^https://` (`app.js:2178`) **puis** assigne
`img.onerror` en propriété JS (`:2180`).

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

**Elles s'enchaînent en série, et cet ordre est contraint — pas une préférence.** La première
rédaction déclarait le LOT 2 autonome : il ne l'est pas. Le picker filtre sur `code` et affiche
`shot`, or l'amorce committée ne porte que `name`/`system`/`planet`/`outpost`. Le `FORCE=1` règle la
**prod**, pas les **tests**, qui lisent l'instantané versionné — et le CLAUDE.md interdit de
régénérer `data/` dans une PR de code. D'où :

1. [ ] `feat(data): les terminaux portent leur code UEX et leur photo` — `build-data.mjs` +
       `build-data.test.mjs`. Étiquette `enhancement`.
   - [ ] puis `chore(data): régénérer l'amorce`, commit **séparé**, intercalé avant le LOT 2.
2. [ ] `fix(corrections): choisir une station sans que son nom soit tronqué` — picker + `stationTree`.
       Étiquette `bug`, ferme son issue. Autonome vis-à-vis du LOT 3, **mais pas du LOT 1**.
3. [ ] `feat(corrections): les corrections se rangent par station, photo à l'appui` — bande, bandeau
       collant, retour arrière dans la tuile, retrait de la liste plate. Étiquette `enhancement`.

**Deux bumps de service worker.** `sw.js:8` fixe `CACHE`, et le commentaire d'en-tête (`:4-7`) pose
la règle : quand `index.html` et `app.js` changent **ensemble**, il faut bumper, sinon un visiteur
déjà installé reçoit l'ancien `index.html` avec le nouveau `app.js` pendant toute une visite. Les
LOTS 2 et 3 ajoutent chacun un conteneur au HTML et le code qui le vise. Donc v5 → **v6** au LOT 2,
v6 → **v7** au LOT 3. Le LOT 1 ne bumpe pas : il ne touche ni l'un ni l'autre.

**Trois pièges de suppression au LOT 3**, qu'aucun test ne couvre et qui partiraient en silence avec
`correctionsListHTML` : le bouton `#resetAll` (que le délégué attend sous cet id exact, faute de quoi
« Tout réinitialiser » disparaît de l'app et `resetAllOverrides` devient du code mort) ; l'état vide
« Aucune correction locale pour l'instant », distinct du `.manifest-hint` qui traite « aucune station
choisie » ; et `#resetAllK`, qui vit dans `autoloadListHTML` et doit survivre au déménagement. La
liste des **relevés d'autoload** reste, avec son CSS : `.corr-item.autoload` n'est qu'un modificateur
de `.corr-item`, et `autoload.pw.mjs:334` et `:349` l'assertent. C'est un **renommage de conteneur**,
pas une suppression.

**Le LOT 3 est lié à l'issue #24** (« le relevé de tarif d'autoload en cours de saisie est effacé par
tout re-rendu de la vue Corrections »). Sa cause est que `renderCorrections` réécrit inconditionnel-
lement `#correctionsStation.innerHTML`, qui contient `stationFeeHTML`. La bande ajoute un déclencheur
de re-rendu de plus — chaque clic de vignette. Sortir le panneau de frais vers `#correctionsFees`
**clôt** #24 ; le laisser dedans l'**aggrave**. Corollaire à ne pas sous-estimer : ce panneau est
appelé à **deux** endroits de `stationTableHTML`, dont la branche de retour anticipé « aucune
commodité ». L'extraction est donc une restructuration de la fonction, et le rebase avec la partie 2
de la spec du 2026-08-12 n'est **pas** trivial, contrairement à ce qu'affirmait la première rédaction.

Avant d'ouvrir : `gh issue list --state open` (les épinglées d'abord), puis créer les deux issues
manquantes — une `bug` pour la troncature du sélecteur, une `enhancement` pour la liste plate.

### Tests

**`logic.test.mjs`**
- `groupOverridesByTerminal` : deux clés d'une même station → une entrée ; actif épinglé même à
  zéro ; une clé à deux segments ignorée ; tri stable à égalité.
- `stationTree` : les 12 sans planète tombent dans `Espace profond` (Levski compris) ; ordre
  Stanton/Pyro/Nyx même si l'entrée est en ordre inverse ; un système inconnu passe en queue ;
  `localeCompare("fr")` sur les zones et les stations ; deux terminaux de même `code` restent deux
  entrées distinctes ; `label` vaut bien `Nom — Système` ; les stations d'un même couple
  (système, zone) sont **contiguës** dans l'aplatissement — c'est ce qui permet au rendu de grouper
  par simple comparaison au précédent.

**`scripts/build-data.test.mjs`** : `code`, `shot`, `shotBy` recopiés verbatim ; une valeur absente
donne `""`, jamais `undefined`.

**`e2e/smoke.pw.mjs`**
- la bande apparaît après une correction, avec le bon compteur ;
- un clic sur une tuile charge la station ;
- la tuile active porte `aria-current` **et** le texte `EN COURS` ;
- taper `PYROG` remonte les deux portes de saut ; `↓ ↓ Entrée` sélectionne ;
- le `✎` ramène à la valeur UEX sans ouvrir l'éditeur ;
- **relire** le plafond de 2 600 px, qui est en `smoke.pw.mjs:175` et non 132 (132 est aujourd'hui
  une assertion sans rapport, issue de la PR #31). Marge mesurée : `#correctionsStation` fait
  **1 481 px** pour GrimHEX en 1600×1000, soit 1 119 px de réserve ; `.station-title` fait 47 px et
  non les ~26 supposés, et le panneau de frais 87 px, qui **quittent** le conteneur en partant en
  pied. Un bandeau de ~76 px est donc indolore — mais la mesure est à refaire avant toute
  affirmation, elle vient d'une reconnaissance en lecture seule qui n'a pas lancé Playwright.

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
- La partie 2 de la spec du 2026-08-12 (tri alphabétique des tuiles, « mode station ») reste à faire.
  Elle n'est plus en collision sémantique avec cet ADR — le `✎` y garde son sens — mais elle réécrit
  le corps de `stationTableHTML`, que le LOT 3 restructure : le rebase demandera de l'attention.
- Un compte à rebours de péremption sur les vignettes (un volume meurt à 3 h) n'est pas prévu.
- **La bande n'est pas une vraie barre d'onglets.** Elle se *lit* comme telle, mais ne porte que des
  boutons et `aria-current` : ni `role="tablist"`, ni `aria-selected`, ni `tabindex` roving, ni
  navigation aux flèches. Vingt vignettes feront vingt arrêts de tabulation, là où le picker voisin,
  lui, a ses flèches. Assumé pour ce lot ; le jeton `aria-current` retenu est `"true"`, et le test
  E2E doit s'accorder sur ce jeton exact.
- **L'anneau de focus violet est le violet de Nyx** : `--acc-2` et `--nyx` valent tous deux `#a970ff`.
  Sur une vignette Nyx de repli — Levski, PSS Lambda, Pyro Gateway (Nyx) — l'anneau se confondra avec
  la teinte qu'il entoure. À traiter si ça gêne à l'usage, pas avant.
- **Les photos du CDN ne sont jamais mises en cache** : `sw.js:41` ignore volontairement le
  cross-origin. Elles se retéléchargent à chaque visite — ce qui est aussi ce qui rend le repli
  hors-ligne prévisible.
- Aucune des 10 issues ouvertes (#19 à #28) n'est corrigée par cet ADR, hormis #24 que le LOT 3 est
  en position de clore.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
