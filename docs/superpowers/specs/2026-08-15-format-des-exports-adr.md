# ADR-006 : Un seul format pour les deux exports — ISO 8601 UTC, en-tête versionné, presse-papiers

**Statut :** Accepté
**Date :** 2026-08-15
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issues :** #46, #47 · **Jalon :** v1.1.0 — Plan de vol

## Contexte

Deux demandes indépendantes réclamaient une sortie de données, et se sont explicitement renvoyé
la balle :

- **#46 — les entrepôts.** `⬓ Déposer` et la carte `⬓ Entrepôts` existent depuis la PR #18 : le fret
  déposé est rangé station par station, avec son prix payé et le capital immobilisé. Mais la liste ne
  quitte jamais l'app. Pour relire ce qu'on a laissé quelque part, il faut rouvrir le navigateur qui
  porte le `localStorage`.
- **#47 — les corrections locales.** Elles vivent sous `best-hauling-overrides` et n'en sortent
  jamais : le lien de partage les exclut délibérément, `copyManifest` ne copie que le manifeste
  courant. Vider son cache efface des dizaines de relevés faits comptoir par comptoir.

Trois questions leur étaient communes, et les trancher séparément aurait fait diverger **deux formats
d'export dans le même dépôt** — ce qui est particulièrement grave ici, puisqu'une correction
**périme par sa date** (spec du 2026-08-12) : deux façons d'écrire une date, c'est deux façons de se
tromper en la relisant.

## Décision

### 1. Les dates sortent en ISO 8601 UTC, à la seconde, suffixe `Z`

`2026-08-15T09:12:00Z`. Une seule fonction, `isoUTC` (logic.mjs), sert les deux exports.

Le seul rendu de date du dépôt était jusqu'ici `toLocaleString("fr-FR")` (fraîcheur UEX) : un format
qui dépend de la locale du navigateur et ne se relit pas de façon fiable. Un export se relit **sur
une autre machine, dans un autre fuseau, des mois plus tard**.

La date est **tronquée** à la seconde, jamais arrondie : la seconde *pendant* laquelle le geste a eu
lieu. Arrondir daterait un dépôt de 20:13:20,7 à 20:13:21, une seconde après qu'il s'est produit.

**Une date absente sort `null` (ou « date inconnue » en texte), jamais l'heure courante.** C'est la
règle la plus importante des deux issues : on préfère « je n'en sais rien » à une date fausse, parce
qu'une correction datée d'aujourd'hui à tort est exactement celle qu'on réappliquerait aveuglément.

### 2. En-tête versionné, commun aux deux

`enteteExport(type, nowSec)` rend `{ v: 1, type, emis: "…Z" }`. `FORMAT_EXPORT = 1`.

Sans numéro de format, la première évolution casse tous les fichiers déjà émis. L'export des
entrepôts, qui est du texte, porte le même en-tête sur sa première ligne :
`# Best Hauling — entrepôts · format v1 · émis 2026-08-15T09:12:00Z`.

### 3. Presse-papiers, jamais de fichier téléchargé — et c'est une contrainte, pas un goût

`index.html` pose `default-src 'self'` **sans `blob:`**, verrouillé par `scripts/csp.test.mjs`.

Mesuré, sous Chromium, sur la page réellement servie :

| page | `URL.createObjectURL` | clic sur `<a download href="blob:…">` | erreur console |
|---|---|---|---|
| `index.html` (avec la CSP) | rend bien un `blob:` | **aucun téléchargement** | **aucune** |
| même origine, page sans CSP | rend bien un `blob:` | `essai.txt` téléchargé | aucune |

Le bouton serait donc **mort en silence** : pas d'exception, pas de message, rien à déboguer pour
l'utilisateur. Relâcher `default-src` pour un bouton de copie paierait la politique bien trop cher —
c'est le seul vecteur de sécurité disponible sous GitHub Pages, et `scripts/csp.test.mjs` la
verrouille à raison.

Les trois boutons de copie passent donc par un unique chemin, `copierTexte` (app.js), déjà éprouvé
par `⧉ Copier` du manifeste et par `Partager`.

### 4. Texte pour les entrepôts, JSON pour les corrections

Les deux exports partagent le format de date et l'en-tête ; leur **corps** diffère, parce que leurs
lecteurs diffèrent :

- **Entrepôts → texte.** Destiné à être collé dans un bloc-notes, sur un second écran ou dans un
  canal Discord d'org. Du JSON y serait illisible là où il sert. Une ligne **par lot** et non par
  commodité : deux lots de la même commodité peuvent avoir été déposés à des jours d'écart et venir
  de stations différentes — les regrouper effacerait précisément ce que l'export existe pour dire.
- **Corrections → JSON.** Destiné à être **relu**, par `relireCorrections`. Une entrée par *champ*
  corrigé, parce qu'une même clé peut porter un prix et un volume qui ne portent pas la même date de
  saisie.

## Conséquences

### Deux dates de saisie dans le store des corrections, une par champ

`setInStore` posait `pris` **uniquement** sous `if (field === "vol")` : un prix corrigé ne portait
aucune date de saisie. Le store porte désormais :

- `pris` — heure murale de la saisie du **volume**. C'est une **horloge** : `effValue` s'en sert pour
  périmer le volume au bout de `DUREE_VOL` ;
- `saisiPrix` — heure murale de la saisie du **prix**. Ce n'est **pas** une horloge : rien ne
  régénère un prix faux, il ne vieillit pas, et aucun lecteur ne le périme. Elle existe uniquement
  pour que l'export puisse dater ce qu'il transporte.

Les deux noms sont distincts de `ts`, que `effValue` lit encore comme alias historique de `base` :
les confondre périmerait les corrections d'anciens formats au lieu de les épargner.

### Le dépôt est daté, et l'horodatage est injecté

`storeFromHold(hold, entrepots, name, units, station, at)` — `at` en paramètre, comme
`loadHold(hold, lignes, from, at)`. Une fonction pure ne lit pas l'horloge. Le lot porte `deposeAt`,
distinct du `at` de chargement.

`takeFromStore` **ne remonte pas** `deposeAt` avec le lot, et ce n'est pas un oubli : reprendre n'est
pas acheter. Le lot rendu à la soute n'a ni `at` ni `deposeAt` — il n'a pas été chargé maintenant, et
il n'est plus déposé nulle part.

### Migration : on normalise, on n'invente rien

`migrerCorrections(store)` (forme de `migrerRefus` : `{ store, migres }`, `migres` à 0 = rien à
persister) fait exactement deux choses :

1. `ts` → `base`. L'alias historique reste lu par `effValue`, mais l'export ne doit pas avoir à
   connaître deux noms pour la même ancre. La normalisation ne change **aucune** décision de
   fraîcheur : `effValue` traitait déjà les deux à l'identique.
2. **Aucune date de saisie n'est inventée.** Un prix corrigé avant `saisiPrix` s'exporte « date de
   saisie inconnue » et le reste. Même prudence qu'`effValue` avec `pris` absent — on épargne les
   formats antérieurs plutôt que de les périmer, et ici on refuse aussi de les rajeunir.

Idem côté entrepôts : un lot déposé avant ce changement n'a pas de `deposeAt` et s'exporte « déposé à
une date inconnue ».

### La relecture réutilise `effValue`, elle ne réécrit pas la règle

`relireCorrections(exporte, releves, nowSec)` rend un verdict par entrée :

| verdict | quand |
|---|---|
| `appliquer` | datée, ancrée, et le point n'a pas été republié depuis |
| `périmée-uex` | UEX a republié ce point après l'ancrage — c'est exactement `stale` d'`effValue` |
| `périmée-âge` | un **volume** saisi il y a plus de `DUREE_VOL` — c'est `staleVol` |
| `date-inconnue` | format antérieur, sans date de saisie : signalée, jamais acceptée en silence |

L'ordre de priorité est celui d'`effValue` lui-même : `stale` l'emporte sur `staleVol`. Deux
implémentations de la péremption finiraient par diverger, et c'est la relecture qui aurait tort sans
qu'on le voie.

### Ce que la décision n'ouvre pas

- **L'import.** `relireCorrections` rend des verdicts ; rien ne réinjecte encore un export dans le
  store. La fonction existe pour que le format soit relisible *par construction*, pas parce qu'un
  bouton d'import est décidé.
- **Les relevés d'autoload** (`best-hauling-autoload`, clé à deux segments) restent hors des deux
  exports : ils n'ont ni date UEX de référence ni péremption, *par conception*. Les inclure suppose
  de décider s'ils doivent être datés — décision non prise ici.
- **Le lien de partage** continue à ne transporter aucune donnée locale. Frontière assumée.
- **La soute** (`#holdCard`) et le voyage n'ont pas de bouton d'export. Même mécanique possible,
  autre décision.
