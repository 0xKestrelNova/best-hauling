# Péremption des volumes corrigés, et corrections groupées par station

*2026-08-12 — conception validée avec l'utilisateur.*

Deux sujets indépendants, livrés en **deux PR séparées** : la péremption des volumes touche le moteur
de corrections (`logic.mjs`), la vue Corrections ne touche que le rendu (`app.js`). Rien ne les lie.

---

## Partie 1 — Un volume corrigé se périme au bout de 3 h

### Le problème, mesuré

Charger un manifeste écrit une correction locale qui retire de la station ce qu'on vient d'y prendre
(`app.js:1201`). Cette correction ne disparaît que lorsqu'UEX republie le point avec un relevé plus
récent. Or **UEX republie un point tous les 3,1 jours en médiane** — mesuré le 2026-08-12 sur les
2 592 relevés de `commodities_prices_all` :

| | p10 | p25 | médiane | p75 | p90 | p99 |
|---|---|---|---|---|---|---|
| âge du dernier relevé | 3,8 h | 20 h | **3,1 j** | 6,6 j | 8,0 j | 19,7 j |

Seuls **29,9 %** des points ont un relevé de moins de 24 h. Pendant ce temps, le jeu réapprovisionne
le comptoir par paliers de l'ordre de 5 à 15 min. L'app annonce donc un stock à zéro **des jours**
après qu'il est revenu — un facteur ~70 entre les deux horizons.

### Ce qu'on a cherché, et pourquoi on ne l'a pas retenu

Le premier réflexe était une **remontée linéaire** du stock vers son plafond, à un débit réglé.
Il aurait fallu deux nombres par comptoir : un plafond et un débit. Recherche faite :

- **Aucun site ne publie de débit de recharge par terminal.** [SC Trade Tools](https://sc-trade.tools/)
  expose une API REST et une app compagnon qui scrape les kiosques, mais ne suit que des prix
  communautaires. [NOVA Intergalactic](https://novaintergalactic.com/wiki/tutorials/user-guide-trade-calculator-app/)
  publie bien un « refill rate » (total max + unités/min par emplacement) — alimenté par des relevés
  Discord, sans API publique.
- **Depuis le patch 3.20, les inventaires de boutique et les prix ne sont plus dans les fichiers du
  jeu** ([StarCitizen-GameData](https://github.com/Dymerz/StarCitizen-GameData)). Plus aucun outil ne
  peut les dataminer : tout est communautaire, sans exception.
- Les deux seuls chiffres qui circulent (TDD Area 18 : 5 000 000 unités + 50 000/min ; ailleurs
  400 000 + 4 000/min, soit 50 000 SCU + 500 SCU/min et 4 000 SCU + 40 SCU/min) donnent tous deux
  exactement 1 % de la capacité par minute. Cette élégance ne survit pas à la confrontation :
  - chez UEX, **les 15 points de vente de Quantainium rapportent tous `scu_sell = 0`**, et la moyenne
    à TDD Area 18 vaut 7 — les 50 000 SCU ne sont corroborés par rien ;
  - la capacité publiée a une **médiane de 539 SCU** (p90 = 2 719, p99 = 10 073) : 50 000 SCU est
    au-delà du 99ᵉ centile, atteint par 1 point sur 295 ;
  - la source dit elle-même « globally across all servers ». Un pool global inter-shards **n'est pas**
    la capacité qu'un comptoir affiche : ce ne sont pas les mêmes grandeurs.

**Décision : pas de remontée progressive.** Sans débit défendable, elle reviendrait à inventer un
nombre qui pèse sur les manifestes. On garde donc une **durée de validité**, qui ne modélise aucune
courbe : elle dit seulement qu'au-delà d'un certain âge, une valeur locale ne vaut plus rien.

Conséquence : le **store de plafonds relevés** et le **débit relevé par comptoir**, envisagés puis
écartés, ne sont pas dans cette spec (YAGNI — sans remontée, ils ne servent à rien).

### La règle

Un volume corrigé (stock à l'achat, demande à la vente, déduction de chargement comprise) est
**périmé au premier des deux événements** :

1. UEX republie le point avec un relevé plus récent — la règle actuelle, inchangée ;
2. la correction a plus de **`DUREE_VOLUME`**, par défaut **3 h**, réglable.

Un **prix** corrigé ne change pas de comportement : rien ne régénère un prix faux, il reste faux des
jours. La péremption par durée est donc **par champ**, ce qui est nouveau.

> **Ceci ne rouvre pas la décision du 2026-08-12 sur la péremption par date.** Il y avait été acté
> qu'une correction ne périmerait pas selon que la valeur UEX republiée a changé ou non — c'est un
> axe *valeur*, et il reste tel quel. Ce qu'on ajoute ici est un axe *âge mural*, indépendant : une
> observation de quantité a une durée de vie, quoi qu'UEX publie. Les deux règles coexistent, et
> c'est la première des deux qui se déclenche qui l'emporte.

> **Contrepartie assumée du choix de 3 h** (arbitrage utilisateur, l'option 1 h était recommandée) :
> sur trois heures, un comptoir vidé a très probablement tout récupéré. L'app continuera donc à
> annoncer un stock trop bas pendant une partie de ce délai. C'est le défaut qu'on corrige, en plus
> petit — mais en échange une correction survit à une session de jeu entière, ce qui était le but.

### Ce qu'il faut changer

**`logic.mjs` — le moteur (pur)**

- `setInStore` écrit un horodatage **mural** `pris` sur la correction quand le champ est `vol`.
  Nouveau champ : **ne pas réutiliser `ts`**, encore lu par `effValue` comme alias historique de
  `base` (`logic.mjs:204`) — le confondre périmerait les corrections d'anciens formats.
- `effValue` prend un paramètre d'horloge `maintenant`, avec valeur par défaut, sur le modèle de
  `ageDays(updated, nowSec = Date.now() / 1000)` (`logic.mjs:16`). La fonction reste pure et testable.
- `effValue` peut désormais périmer **`vol` seul en gardant `price`**. Aujourd'hui elle renvoie un
  `stale` global et `effFromStore` supprime la clé entière (`logic.mjs:527`) : il faut distinguer
  « la clé est morte » de « le volume est mort ». Forme retenue : **deux drapeaux distincts**, `stale`
  (UEX a republié, toute la correction meurt) et `staleVol` (le volume seul meurt), et `effFromStore`
  ne supprime la clé que si plus rien ne survit.

  > Cette forme corrige celle d'abord retenue ici — un objet `stale: { price, vol }`. Un objet rend
  > `if (r.stale)` **toujours vrai** chez ses deux lecteurs (`effFromStore`, `effVals`) : un lecteur
  > qu'on aurait oublié de mettre à jour aurait silencieusement effacé des corrections valides. Avec
  > deux drapeaux, `stale` garde exactement son sens d'avant et un oubli fait seulement rater la
  > nouveauté. Implémenté ainsi dans la PR #6.
- **Compatibilité ascendante** : une correction déjà en localStorage n'a pas de `pris`. Son absence
  vaut « pas de péremption par durée » — sinon toutes les corrections existantes disparaîtraient au
  premier chargement. Elles s'alignent à la prochaine saisie.

**`app.js` — les effets de bord**

- `DUREE_VOLUME` persistée en localStorage, réglable dans la vue Corrections, sur le modèle du
  coefficient `k` global d'autoload. Une seule valeur, pas de réglage par station.
- Le flash « correction périmée par une mise à jour UEX » (`notifySuperseded`) doit distinguer les
  deux causes : « UEX a republié » et « ta valeur a plus de 3 h ». Deux messages, pas un.
- **Vendre déduit la demande.** Aujourd'hui la vente n'écrit aucune correction : les seuls écrivains
  sont le chargement, son annulation et la saisie à la main (`app.js:1184`, `1201`, `2354`). On ajoute
  la déduction symétrique à la vente, avec la même annulation exacte que `chargerJambe` — la valeur
  d'avant est portée par le lot, on restaure donc à l'identique et jamais par addition. Aucun plafond
  n'est nécessaire : une déduction est soustractive, plancher à 0.

### Tests

Unitaires (`logic.test.mjs`), sur le pur :

- un `vol` de moins de 3 h s'applique ; à plus de 3 h il est périmé et la valeur UEX revient ;
- un `price` du même âge **survit** — la péremption est par champ ;
- une clé portant prix + volume perd son volume et garde son prix ; la clé n'est supprimée que quand
  les deux sont tombés ;
- une correction sans `pris` (ancien format) ne périme pas par durée ;
- la règle UEX reste prioritaire : un relevé plus récent périme même un volume de 2 min ;
- frontière exacte : à `pris + 3 h` pile, pas encore périmé (cohérent avec `base == relevé` déjà testé).

E2E (`e2e/smoke.pw.mjs`) : une déduction de vente apparaît puis s'annule exactement ; le réglage de
durée persiste au rechargement.

---

## Partie 2 — Vue Corrections : ordre alphabétique et saisie groupée

### Ordre alphabétique

`stationTableHTML` (`app.js:2443`) parcourt `MARKET.commodities` dans l'ordre de `market.json`, qui
est celui d'UEX. En jeu, le kiosque affiche les commodités par ordre alphabétique : l'œil doit faire
la traduction à chaque relevé.

Tri par `localeCompare` en français sur le nom, appliqué **dans chaque section** (« On y achète »,
« On y vend ») après le remplissage, pour ne pas casser la répartition en deux sections.

### Saisie groupée

Aujourd'hui chaque chiffre est un `editv` qui se corrige seul : `Entrée` ou la perte de focus écrit la
valeur (`app.js:2354`) puis déclenche un `saveOverrides` **et un `refresh()` complet**. Relever une
station de 20 commodités, c'est 20 écritures et 20 re-rendus, et le tableau se réordonne sous la main
entre deux saisies.

Conception retenue — un **mode station** :

- un bouton `✎ Corriger la station` bascule **toutes** les tuiles en champs éditables d'un coup,
  préremplis avec la valeur effective courante ;
- `Appliquer` écrit toutes les valeurs modifiées en **une** passe : un seul `saveOverrides`, un seul
  `refresh`, un seul `pinLegsForVolume` par point touché ;
- `Annuler` jette la saisie sans rien écrire ;
- `Échap` équivaut à `Annuler`, `Entrée` dans un champ passe au suivant sans valider — la validation
  est un geste unique et explicite ;
- hors de ce mode, le clic-sur-un-chiffre existant reste disponible : c'est le geste rapide pour une
  correction isolée, et il est déjà couvert par des tests.

Un champ laissé identique à la valeur affichée **n'écrit rien** — sans quoi ouvrir le mode et
appliquer créerait une correction sur chaque commodité de la station.

### Tests

E2E : les commodités sortent triées dans les deux sections ; le mode station applique plusieurs
valeurs avec **un seul** re-rendu (compté via un compteur exposé au DOM ou l'absence de scintillement
mesurable) ; `Annuler` n'écrit rien ; un champ inchangé ne crée pas de correction.

---

## Risques et limites

- **La durée de 3 h n'est pas une mesure.** Elle est bornée par le seul fait connu (paliers de
  recharge de ~5 à 15 min) et par le confort d'usage. Le README doit le dire, comme il le dit déjà
  du `k` d'autoload.
- **La péremption par champ touche un chemin très utilisé.** Le changement de forme de `stale` n'a que
  **deux lecteurs** — `effFromStore` (`logic.mjs:527`) et `effVals` (`app.js:188`) — mais la valeur
  qu'ils produisent est consommée par les **14 sites** qui appellent le résolveur à chaque rendu. Ces
  deux lecteurs doivent donc être couverts par des tests avant tout le reste.
- **Rien ne se met à jour tout seul.** La péremption est évaluée au rendu, pas par un minuteur : une
  page laissée ouverte 4 h montrera encore l'ancienne valeur jusqu'au prochain rafraîchissement.
  Décision assumée — un `setInterval` ferait scintiller des tableaux qu'on lit.
- **Hors périmètre, mais mesuré et acquis** : `scu_sell_avg` porte un plafond de demande sur **30,0 %**
  des points de vente contre **15,7 %** pour le `scu_sell` utilisé aujourd'hui, et les deux champs
  s'accordent (ratio médian 1,00 ; 91,2 % dans un facteur 2) avec ~1 % d'aberrations à écrêter
  (jusqu'à 87 371 200 SCU). Ce gain est indépendant des deux parties ci-dessus et mérite sa propre
  spec.
