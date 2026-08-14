# ADR-005 : Le score cesse de classer — on trie sur ce que ça rapporte, la fiabilité se lit à côté

**Statut :** Accepté
**Date :** 2026-08-14
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #51 · **Jalon :** v1.1.0

## Contexte

Dans les mots du propriétaire : « *je trouve que le score n'est pas très pertinent, il faudrait une
refonte de son calcul* ».

Le **Score** est le tri par défaut de Trajets et de Boucles (`app.js:43`, `:45`) et la colonne est
présente dans les quatre listes. Il ne se lit pourtant comme rien : ni un montant, ni un pourcentage
de fiabilité, ni une part du meilleur gain. Un « 62 » ne répond à aucune question qu'on se pose.

### La formule actuelle, terme par terme

```js
rawScoreOf(profitHour, fallbackMargin, age, stock, demand)
  = (profitHour ?? fallbackMargin) × freshnessFactor(age) × availabilityFactor(stock, demand)
```

- `freshnessFactor(age)` = `age == null ? 0.5 : max(0.2, 1 − age/14)` — de **0,2 à 1,0** ;
- `availabilityFactor(stock, demand)` = `volumeFactor(min(stock, demand))`, avec
  `volumeFactor(m) = 0.3 + 0.7 × m/(m+120)` — de **0,3 à 1,0** ;
- `normalizeScores` rapporte le tout au meilleur de la **liste affichée**.

Soit un facteur correctif allant jusqu'à **16,7×**, appliqué à une valeur qui s'étale déjà sur
plusieurs ordres de grandeur.

### Ce que ça produit, mesuré sur `data/routes.json`

Soute 96 SCU, budget 1 000 000, plafonnement par stock actif — les réglages par défaut.

**Contre-exemple 1 — la route la plus rentable du jeu de données est 8ᵉ.**

| | profit net | score | rang par score | rang par profit |
|---|---:|---:|---:|---:|
| Osoian Hides · The Golden Riviera → Devlin Scrap | **1 759 500** | 44 | **8ᵉ** | 1ᵉʳ |
| Dymantium · Rustville → Bueno Ravine | 651 040 | **100** | 1ᵉʳ | 3ᵉ |

La tête du classement rapporte **2,7 fois moins** que la route reléguée en huitième position.

**Contre-exemple 2 — une chute de 179 places pour cause de facteurs.**

Tritium · Hickes Research → Gaslight rapporte **269 234 aUEC**, ce qui la place **29ᵉ** par profit.
Fraîcheur 0,20 (plancher) × disponibilité 0,37 (stock 14) = **0,074** : elle tombe au **208ᵉ rang**.
Un facteur ×13,5 de pénalité, pour une route qui rapporte réellement ce qu'elle annonce.

**Contre-exemple 3 — une ligne de bouchage divise la note par deux.**

Rat's Nest → CBD Lorville, mode multi-commodité, **93 SCU pour 202 082 aUEC** :

| Ligne | stock | chargé | marge | apport au profit |
|---|---:|---:|---:|---:|
| Diamond | 91 | 91 SCU | 2 216 | 201 656 aUEC |
| **Fluorine** | **2** | **2 SCU** | 213 | **426 aUEC — 0,2 %** |

`tripMetrics` prend le **minimum** des stocks (`logic.mjs:937`) :
`availabilityFactor(2) = 0,311` au lieu de `availabilityFactor(91) = 0,602`.
**Le score est divisé par 1,93 par une ligne qui apporte 0,2 % du profit.** Retirer cette ligne —
donc gagner 426 aUEC de moins — doublerait presque la note. Or remplir la place restante avec de
petites lignes est exactement ce que le mode multi-commodité sait faire : la formule pénalise la
fonctionnalité.

### Les autres défauts, tous vérifiés

- **Le score n'est jamais un montant.** Normalisé sur la liste affichée : changer un filtre change
  tous les scores sans qu'aucun prix n'ait bougé, et deux vues ne sont pas comparables.
- **Le terme « valeur » change d'unité.** Route bornée : `profitHour`, en aUEC/heure. Route non
  bornée : `fallbackMargin`, en aUEC/**SCU**, et **brute** — aucun frais n'est calculé sur une route
  non bornée (`logic.mjs:143-144`). Même colonne, même 0-100, deux grandeurs.
- **Le stock est compté deux fois.** `computeUnits` borne déjà les unités — donc le profit — par le
  stock ; `availabilityFactor` le remultiplie ensuite. Deux pénalités pour une seule cause.
- **La « disponibilité » est en pratique un facteur « stock ».** 256 routes sur 316 (81 %) ont
  `sell.demand` à `null` ; le facteur retombe alors sur le seul stock.
- **Le dénominateur horaire est fictif pour la moitié des routes.** **155 des 316** (49 %) n'ont pas
  de distance exploitable, et En route / multi la forcent à 0. Pour toutes celles-là,
  `profitHour = profit × 10` (même système) ou `× 6` (inter-système) : le « par heure » n'est plus
  qu'une constante, qui **divise le profit inter-système par 1,67** quelle que soit la vraie durée.

## Décision

**Le score cesse d'être un instrument de classement.** On trie sur ce que le voyage rapporte ; la
fiabilité se lit à côté, sans déformer l'ordre.

### 1. À quelle question on répond

> **« Combien ce voyage me rapporte-t-il, net ? »**

Un montant, en aUEC. Pas une note, pas une part du meilleur, pas un composite.

### 2. Le tri par défaut devient le **profit net par voyage**

Et non le profit par heure, alors que ce serait la meilleure métrique de décision — parce que le
modèle de temps est fictif pour 49 % des routes. **Classer sur une durée inventée pour la moitié du
jeu de données serait exactement le genre de mensonge que cet ADR existe pour supprimer.**

`Profit/h` **reste une colonne triable**, avec son hypothèse écrite en infobulle : à distance
inconnue, elle vaut `profit × 10` ou `× 6`. Qui veut trier dessus le fait en connaissance de cause.

Le profit par voyage a une autre vertu : c'est un **montant absolu**, donc comparable d'une vue à
l'autre et d'un filtre à l'autre — ce que le score normalisé n'était pas. Il règle du même coup la
demande de #50 (« on a besoin de savoir combien on va gagner »).

### 3. La colonne Score devient **Fiabilité**, et ne trie plus par défaut

Elle garde ce que le score avait d'utile — signaler qu'une ligne repose sur des données fragiles —
en cessant de le faire par multiplication silencieuse.

```
Fiabilité = round(100 × freshnessFactor(âge) × certitude)
```

- **`freshnessFactor` est conservé tel quel** (`logic.mjs:26-29`), avec ses bornes 0,2–1,0. Il est
  déjà éprouvé et testé.
- **`certitude` remplace `availabilityFactor`** : c'est la **part des SCU chargés dont le volume
  contraignant est publié par UEX**. Un chargement entièrement adossé à des volumes connus vaut 1 ;
  un chargement qui parie sur une demande inconnue vaut moins.

Pourquoi ce remplacement règle les trois défauts d'un coup :

- **plus de double comptage** — `computeUnits` a déjà plafonné les unités par le stock ; ce qui est
  chargé est disponible par construction. Il ne reste à mesurer que l'**inconnu**, pas le petit ;
- **plus de punition du bouchage** — dans le contre-exemple 3, la ligne Fluorine a un stock
  **connu** de 2. Elle ne dégrade donc plus rien : 2 SCU sur 93 adossés à une donnée publiée, comme
  les 91 autres. La fiabilité reste haute, et le profit reste 202 082 ;
- **ça mesure ce qu'on ignore vraiment** — 84 % des points de vente ne publient pas leur demande,
  et c'est le vrai risque : le comptoir peut en prendre moins qu'on ne l'espère.

**Elle reste triable**, et son infobulle donne la décomposition (âge du relevé, part de volume
connu). Elle ne participe simplement plus au tri par défaut.

### 4. Le repli sur la marge est **abandonné**

`fallbackMargin` disparaît. Une route non bornée (soute, budget et plafonnement tous décochés) n'a
pas de profit calculable : elle affiche **`—`** et se range en dernier, comme n'importe quelle valeur
absente (`bySort` met déjà les nulls en bas). Mieux vaut un trou honnête qu'un chiffre dans une
autre unité, non net, présenté dans la même colonne.

### 5. La fraîcheur ne réordonne plus, elle signale

Elle quitte le tri et entre dans la Fiabilité. La pastille de fraîcheur et le « ⚠ à vérifier »
(`app.js:148-154`) existent déjà et disent la même chose sans fausser l'ordre — le contre-exemple 2
montre ce que coûtait la version multiplicative.

### 6. Le temps : on assume, on n'invente pas

Aucune constante nouvelle. `tripMinutes` reste ce qu'il est, `profitHour` reste calculé, et
l'infobulle de la colonne dit désormais que la durée est une **estimation grossière** dont la
distance manque pour la moitié des routes. Faute de mesure des temps de trajet en jeu, on ne
raffine pas un modèle qu'on ne peut pas valider — on cesse simplement de bâtir le classement dessus.

*(Faire entrer une vraie distance dans les 155 routes qui n'en ont pas est un travail de
`scripts/build-data.mjs`, à ouvrir séparément si le besoin se confirme.)*

### 7. Comparabilité entre vues

Le profit net par voyage est un montant : il est comparable par construction, ce qu'un score
normalisé sur la liste courante ne pouvait pas être.

**Les boucles gardent leur particularité** : `loopMetrics` additionne les deux jambes
(`logic.mjs:163`, `:173-176`), donc son « profit par voyage » est le profit de l'aller-retour
complet. C'est la bonne unité pour une boucle — on ne la fait pas à moitié — et l'en-tête doit le
dire (« Profit boucle » est déjà en place).

### 8. Migration

| Quoi | Devient |
|---|---|
| `app.js:43` et `:45` — tri par défaut | `profit` au lieu de `score` |
| en-tête + infobulles `index.html:286`, `:304`, `:320` | « **Fiabilité** : fraîcheur du relevé × part de volume publiée. 100 = donnée sûre. » — identiques entre elles |
| `README.md:30` | même phrase |
| `rawScoreOf` | **supprimée** |
| `availabilityFactor`, `volumeFactor` | **supprimées** — plus aucun appelant |
| `freshnessFactor` | **conservée**, réemployée telle quelle |
| `normalizeScores` | **supprimée** — la fiabilité est absolue, elle n'a rien à normaliser |
| `profitPerHour`, `tripMinutes` | conservées, colonne `Profit/h` |

**Aucun test effacé en silence.** `logic.test.mjs:63-137` couvre `freshnessFactor` (gardé),
`availabilityFactor`, `rawScoreOf` et `normalizeScores` (supprimés) : les tests des fonctions
supprimées disparaissent **avec elles**, dans le même commit, et la nouvelle fonction de fiabilité
arrive avec les siens.

**Le test de classement exigé** portera sur le contre-exemple 1 : sur une fixture reproduisant
Osoian Hides et Dymantium, la route à 1 759 500 aUEC doit sortir **avant** celle à 651 040. Ce test
échoue avec la formule actuelle.

**Le score négatif** (point 7 de l'issue) disparaît par construction : la fiabilité est un produit de
deux facteurs positifs bornés. Le garde posé en #39 dans `scoreBarWidth` reste, en ceinture.

## Conséquences

- **Le classement va visiblement changer.** C'est le but, et il faut s'y attendre : les routes
  fraîches à petit stock reculent, les grosses routes remontent. Le README doit le dire.
- **#50** (afficher le bénéfice net dans les suggestions d'arrêt) devient cohérent avec le reste :
  même question, même réponse, même unité. Le formateur compact qu'il introduit servira ici.
- **#81** (chiffres qui débordent) touche les mêmes colonnes : si la colonne Fiabilité remplace
  Score sans changer de largeur, rien ne bouge de ce côté.
- **Ce que l'app perd** : un ordre qui protégeait un peu contre les données périmées. On l'assume —
  l'information reste affichée, elle cesse d'être imposée. C'est le sens de la demande.

## Ce que cet ADR ne tranche pas

- **Le modèle de frais d'autoload** (`2026-08-10-frais-autoload-design.md`) : le score le consomme,
  il ne le rediscute pas.
- **Une mesure réelle des temps de trajet.**
- **La forme exacte du badge de fiabilité** (barre, pastille, nombre) : détail d'implémentation,
  tant que l'état ne tient pas à la seule couleur.
- **Faire entrer une distance dans les 155 routes qui n'en ont pas.**
