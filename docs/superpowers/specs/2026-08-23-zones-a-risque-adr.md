# ADR-013 : Les zones à risque sont un jugement éditorial, et elles n'entrent dans aucun calcul

**Statut :** Accepté
**Date :** 2026-08-23
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #69 · **Jalon :** v2.3.0 — Le Plan de vol vivant
**Voisins :** ADR-001 (la carte 2D), ADR-004 et son amendement du 2026-08-22 (la frontière du Plan de vol)

## Contexte

Un plan de vol dit ce qu'il rapporte. Il ne dit rien de ce qu'il coûte en risque : un trajet qui
traverse Pyro traverse un système sans loi, et on le découvre en route.

### Ce que les données permettent — vérifié, pas supposé

Relevé sur `data/market.json` (114 terminaux) :

| Système | Terminaux | dont avant-postes |
|---------|-----------|-------------------|
| Stanton | 80        | 44                |
| Pyro    | 27        | 14                |
| Nyx     | 7         | **0**             |

Champs d'un terminal : `name`, `system`, `planet`, `outpost`, `autoload`, `maxBox`, `code`, `shot`,
`shotBy`. **Aucun champ de sécurité, de risque ou de juridiction.** UEX n'en publie pas.

Et côté géométrie, `data/starmap.json` porte 17 ancres (Pyro 8, Stanton 7, Nyx 2), toutes au niveau
du **corps**. Une zone se dessine donc au niveau du système, pas plus fin.

## Décision

### 1. Le niveau de risque est ÉDITORIAL, écrit à la main, et daté

`RISQUE_SYSTEME` vit dans `logic.ts`, à côté du code qui la lit, et non dans `data/` : ce n'est pas
une donnée rafraîchie par `update-data.yml`, c'est un jugement. `RISQUE_ETABLI` le date, comme une
correction locale porte sa date, parce qu'il **périmera** sans que rien ne le signale.

### 2. Trois paliers, une seule nuance sous le système

`sûr` (0), `à surveiller` (1), `hostile` (2). La seule nuance sous le système est le booléen
`outpost`, déjà en usage comme filtre (`#noOutpost`) : il approche le « moins à risque près des
stations » de Nyx. **Il ne relève aujourd'hui aucune donnée réelle** — Nyx a 0 avant-poste sur 7 —
et c'est assumé : la règle est écrite pour le jour où UEX en publiera un.

Pas d'échelle plus fine, et pas de grain sous le système : ce serait inventé.

### 3. Le palier 0 ne s'affiche jamais

`risquesDuParcours` FILTRE les systèmes sûrs avant de rendre. Un parcours qui ne quitte pas Stanton
rend `{ zones: [], niveau: 0 }` et l'écran n'affiche rien — pas de bandeau « zone sûre ». Le rendu
n'a donc aucune règle à connaître : il affiche ce qu'on lui donne.

### 4. Un système hors table n'est jamais « sûr »

Au calcul, il ressort à `à surveiller — hors de la table : jugement non porté`. Au test,
`node --test` exige l'égalité EXACTE entre les clés de la table et les systèmes de
`data/market.json`, **dans les deux sens** : un quatrième système publié par UEX fait échouer, et
une entrée que plus aucun terminal ne peuple aussi. C'est ce test, et lui seul, qui empêche la
table de périmer en silence.

### 5. L'avertissement se dit UNE fois, et c'est le CALCUL qui le garantit

`risquesDuParcours` groupe par système. Trois escales dans Pyro rendent une zone, pas trois. Le
groupement n'est pas une règle de rendu qu'une seconde surface pourrait oublier.

### 6. La zone est NOMMÉE, jamais seulement teintée

Règle maison, déjà appliquée par la bande de vignettes de #38 : un état ne dépend pas de la seule
couleur. Sur la carte, `⚠ HOSTILE` / `⚠ À SURVEILLER` sous le nom du système ; dans le bandeau,
« ⚠ Pyro — hostile : sans loi — zone pirate ». La teinte (voile à 7 %) redouble le mot.

Elle emprunte `--warn` et `--bad`, les jetons d'alerte du thème. **Aucun jeton neuf** : une seconde
palette est la dérive que `scripts/jetons.test.mjs` existe pour attraper, et `vues/carte.tsx` étant
le seul fichier que ce test relit comme du texte, un jeton lu là et nulle part ailleurs y
survivrait sans être vu.

### 7. Le risque ne pondère RIEN

Aucun profit ajusté, aucun classement réordonné, aucune route écartée. Le seul consommateur du
calcul hors affichage est `journeyMap`, qui pose la zone sur un disque et n'en tire aucun chiffre.

Un « profit ajusté du risque » reste possible — mais ce serait un ADR, avec une échelle défendue,
une pondération défendue, et une réponse à « que vaut un jugement éditorial dans un classement ? ».
Cette décision-ci ferme le débat d'avance pour que la prochaine issue ne le rouvre pas par accident.

### 8. Le bandeau va dans `#planHead`, la zone sur la carte, et rien n'est actionnable

Cohérent avec l'amendement du 2026-08-22 : le Plan de vol **montre sans restriction** ce qui décrit
le voyage. Afficher n'a jamais été en cause. `#planRisques` ne porte aucun bouton, aucun champ ;
`#planHold` garde ses zéro boutons (`e2e/plan.pw.mjs:211`, intouché).

## Conséquences

- **Une dette assumée** : quelqu'un devra relire cette table après un patch de Star Citizen. Elle
  est datée pour qu'on sache de quand elle parle, et le test de couverture crie quand la
  géographie bouge — pas quand le lore bouge. Ça, rien ne peut le détecter.
- **+2 381 o de coquille** (JS +1 825, CSS +556), et le plafond de `scripts/coquille.test.mjs` passe
  de 620 000 à 630 000. Le relèvement est plus large que nécessaire, à dessein : il n'y restait que
  397 o de marge, donc n'importe quelle PR le faisait tomber sans avoir rien décidé.
- **Rien n'est branché sur des données de sécurité en direct** : il n'y en a pas à brancher.
