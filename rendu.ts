// LE CANAL DE RAFRAÎCHISSEMENT (ADR-012).
//
// `app.js` n'exporte RIEN — 2 869 lignes, pas une ligne `export`. Un module ne peut donc pas
// l'appeler, et c'est exactement ce qui bloque les vues qui portent une ACTION : les deux déjà
// installées dans l'arbre (Tournée, Plan de vol) sont inertes et n'ont jamais eu ce besoin.
//
// ── POURQUOI `notifier()` NE SUFFIT PAS ───────────────────────────────────────────────────────
// `notifier()` (etat.ts) réveille l'arbre React, et rien d'autre. Or `refresh()` fait trois choses
// de plus, dont AUCUNE ne vit encore dans l'arbre :
//   — `renderJourney()` (app.js) : la carte du voyage, affichée à côté des tableaux dans six vues ;
//   — `renderSoute()` / `renderEntrepots()` : la place libre, « où écouler », le prix de vente ;
//   — `saveState()` : le permalien et la restauration au rechargement.
// Une action migrée qui n'appellerait que `notifier()` laisserait la carte du voyage, la soute et
// les entrepôts figés à côté d'un tableau à jour — et le lien partagé périmé. Aucun test ne le
// verrait : ils regardent tous la vue, pas ce qui l'entoure.
//
// ── POURQUOI UN CROCHET, ET PAS UN IMPORT ─────────────────────────────────────────────────────
// Même patron que `brancher()` dans `donnees.ts` : le module DÉCLARE le besoin, l'amorçage POSE
// l'implémentation. L'inverse — un module qui importerait `refresh` — est impossible tant que
// `refresh` vit dans `app.js`, et le resterait de toute façon en cycle une fois `app.js` disparu :
// c'est la vue qui déclenche le rendu, pas le rendu qui connaît la vue.
//
// Ce crochet est TRANSITOIRE, comme les portails d'`App.tsx`. Il disparaît quand `renderJourney`,
// `renderSoute` et `renderEntrepots` auront à leur tour emménagé dans l'arbre : `notifier()`
// redeviendra alors le point unique, et `rafraichir()` ne sera plus qu'un alias à supprimer.

let rafraichirCrochet: () => void = () => {};

/** Pose le crochet. Appelé une fois, à l'amorçage, par `app.js`. */
export function brancherRendu(crochets: { rafraichir: () => void }): void {
  rafraichirCrochet = crochets.rafraichir;
}

/**
 * Rejoue le cycle de rendu complet — ce que `refresh()` fait dans `app.js`, y compris `notifier()`.
 *
 * À appeler par toute action migrée qui change l'état PARTAGÉ (une correction, une écriture en
 * soute, un arrêt de voyage). Une action qui ne touche qu'à l'affichage d'une vue déjà dans l'arbre
 * n'a besoin que de `notifier()` : ce module ne la concerne pas.
 */
export function rafraichir(): void {
  rafraichirCrochet();
}
