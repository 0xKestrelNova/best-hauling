# Consignes de travail sur ce dépôt

Le dépôt est en **français** : commentaires, messages de commit, titres de PR, libellés d'interface.
Une phrase de code doit se lire comme le code autour d'elle.

## Jamais de commit direct sur `main`

Toute modification passe par une **branche** puis une **PR**. `main` est la branche de déploiement :
un push y déclenche un rebuild complet et un déploiement Pages (`FORCE=1`).

Nommage des branches, comme l'historique : `feat/<sujet-kebab>`, `fix/<sujet-kebab>`,
`chore/<sujet-kebab>`, `docs/<sujet-kebab>`.

## Commits

Conventional Commits **avec portée**, à l'impératif, en français :

```
fix(soute): « où écouler » affiche et classe ce que ça RAPPORTE, prix d'achat déduit
feat(carte): router les sauts par les passerelles, et donner un sens aux jambes
```

Portées en usage : `carte`, `soute`, `uex`, `manifeste`, `voyage`, `autoload`, `ci`, `data`, `doc`.
Le sujet dit **ce que ça change pour l'utilisateur**, pas quel fichier a bougé.

## Pull requests

Une PR n'est prête que si **tout** ce qui suit est fait.

### Titre
Même convention que les commits : `fix(carte): ...`. Pas de « WIP », pas de titre générique.

### Corps
Quatre sections, dans cet ordre :

1. **Ce que ça change** — en une ou deux phrases, du point de vue de l'utilisateur.
2. **Pourquoi** — le symptôme observé, ou la décision de conception. Pour un bug : la **cause
   racine** (`fichier:ligne`), pas seulement le symptôme.
3. **Vérification** — les commandes lancées **et leur sortie** : `node --test` (compteur de tests),
   `npx playwright test` (ou le sous-ensemble `-g` pertinent). Jamais « les tests passent » sans le
   chiffre. Si un test échouait avant le correctif, le dire.
4. **Ce qui n'est pas couvert** — limites connues, cas laissés de côté.

Terminer par le pied de page maison :

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Liens vers les issues — obligatoire
- Un correctif de bug **doit** fermer son issue par un mot-clé GitHub dans le corps de la PR :
  `Closes #12` (ou `Fixes #12`). Un simple `#12` ne ferme rien.
- **Vérifier les issues épinglées avant d'ouvrir la PR** (`gh issue list --state open`, les épinglées
  d'abord) : si le travail touche un bug déjà suivi, on lie l'existante au lieu d'en créer une.
- Si le bug n'a pas d'issue, en **créer une d'abord** (`gh issue create --label bug`) puis la fermer
  par la PR. C'est ce qui garde une trace du symptôme, que le message de commit ne porte pas.
- Une PR qui corrige un bug **sans** issue liée est incomplète.

### Étiquettes — obligatoire
Poser au moins une étiquette à l'ouverture (`gh pr create --label ...`), sur la PR **et** sur
l'issue liée. Étiquettes du dépôt : `bug`, `enhancement`, `documentation`, `question`, `duplicate`,
`invalid`, `wontfix`, `help wanted`, `good first issue`, `ci-failure` (réservée au robot de
`update-data.yml`). Correspondance : correctif → `bug` ; nouveauté ou reprise d'ergonomie →
`enhancement` ; README / ADR seuls → `documentation`. Ne pas inventer d'étiquette sans la créer
explicitement (`gh label create`).

### Avant d'ouvrir
- `node --test` **et** `npx playwright test` au vert.
- Un correctif de bug arrive avec un **test qui échouait avant** (TDD : rouge, puis vert).
- `README.md` mis à jour si le comportement visible change ; un ADR dans `docs/superpowers/specs/`
  si c'est une décision de conception.
- Pas de `data/*.json` régénéré dans une PR de code : l'amorce se régénère dans son propre commit
  `chore(data): ...`.

## Vérification avant toute affirmation

Ne jamais annoncer « corrigé », « ça marche » ou « les tests passent » sans avoir lancé la commande
et lu sa sortie dans le même tour. Un compteur de tests ou un extrait de sortie accompagne toute
affirmation de complétude.
