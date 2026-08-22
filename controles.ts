// LES CONTRÔLES : la barre de filtres et les réglages propres à chaque vue (ADR-011, ADR-012).
//
// Tous ces champs sont du markup statique d'`index.html`, hors de `#racine`. Aucun portail ne les
// possède, et leur valeur n'entre pas dans `etat.ts` : c'est `readFilters()` (filtres.ts) qui les
// LIT au moment où une vue en a besoin. Les recopier dans l'état créerait une seconde vérité à
// tenir d'accord sur les valeurs les plus lues de l'application.
//
// Chaque champ n'a donc qu'un geste : relancer le cycle. Ce qui les distingue tient en trois règles.
//
// ── SAISIE LIBRE = DÉBOUNCÉ, MENU = IMMÉDIAT ──────────────────────────────────────────────────
// Sans debounce, chaque caractère relançait un cycle complet : mesuré à ~142 ms par frappe sur un
// CPU throttlé ×4 (le coût dominant est le relayout de la table, pas le calcul, ~2 ms), soit plus
// d'une seconde de fil bloqué pour taper « Laranite ». Et `saveState()` réécrit le hash à chaque
// cycle, or WebKit plafonne `history.replaceState` à 100 appels / 10 s : deux noms de terminaux
// tapés d'affilée suffisaient à le franchir, et le partage de lien mourait.
//
// Un `<select>` ou une case n'émettent qu'un événement par geste : ils appellent `rafraichir()` nu.
//
// ── `rafraichirDifferee` EST PARTAGÉE, `debounce()` NE L'EST PAS ──────────────────────────────
// Les six champs de la barre partagent la MÊME instance (rendu.ts) : taper dans « Rechercher » puis
// dans « Soute » ne déclenche qu'un cycle. En refabriquer une par module donnerait six timers, donc
// six rendus, sans qu'aucun test ne bronche.
// À l'inverse, `#origin` et `#destTerminal` ont chacun le LEUR : les fusionner ferait qu'une frappe
// dans l'un annulerait celle en cours dans l'autre.
//
// ── `change` ET `input` NE SONT PAS INTERCHANGEABLES ──────────────────────────────────────────
// Les deux cases maîtresses écoutent `change`, les deux autres `input`. C'est délibéré sur une
// `<input type="checkbox">` ; ne pas uniformiser en passant par ici.
import { debounce, rafraichir, rafraichirDifferee } from "./rendu.ts";
import { synchroniserReglages } from "./filtres.ts";
import { oublierCompositionSiRouteChangee } from "./manifeste-gestes.ts";
import { setCommBoard, setCommSort } from "./vues/commodites-vue.tsx";

import type { Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. `e.target` est un `EventTarget` : il n'a ni `closest`, ni
// `classList`, ni `id`. Le cast est posé UNE fois par module, comme `$` — pas dans un module
// partagé : c'est une expression d'une ligne, et six modules couplés à un alias ne valent pas
// l'économie (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;
/** La même, quand le code a déjà établi que la cible est un champ (garde par `id` ou par classe). */
const champ = (e: Event) => e.target as HTMLInputElement;


// `$` est typé `HTMLInputElement` et non `HTMLElement`, parce que dans CE module il ne sert
// qu'à des contrôles de formulaire — dont on lit ou écrit la `value`. C'est le même choix
// que `filtres.ts` et `persistance.ts` : l'alias dit ce que le module en fait.
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Branche les cinq barres de réglages. Appelé une fois, à l'amorçage. */
export function brancherControles() {
  // La barre de filtres, partagée par toutes les vues.
  ["cargo", "budget", "search", "alk"].forEach((id) => $(id).addEventListener("input", rafraichirDifferee));
  ["system", "freshness", "sameSystem", "noOutpost", "legalOnly", "capStock", "multiMode"].forEach((id) =>
    $(id).addEventListener("input", rafraichir)
  );
  // Ces deux-là commandent en plus l'affichage de leur propre sous-réglage (coefficient k, portée
  // de la liste multi) : ils passent donc par `synchroniserReglages` AVANT de recalculer, parce que
  // `readFilters()` relit `#multiMode` et `#multiCommodity` pendant le cycle.
  ["autoload", "multiCommodity"].forEach((id) =>
    $(id).addEventListener("input", () => { synchroniserReglages(); rafraichir(); })
  );
  ["useCargo", "useBudget"].forEach((id) =>
    $(id).addEventListener("change", () => { synchroniserReglages(); rafraichir(); })
  );

  // « En route ». CHANGER DE ROUTE ABANDONNE LA COMPOSITION, et c'est un GESTE — plus une décision
  // du rendu. `compositionValide` se contente de dire qu'elle ne vaut plus ; c'est ici qu'on
  // l'efface, parce que c'est ici que l'utilisateur a changé d'avis. La laisser en réserve la ferait
  // ressurgir au retour sur cette route, longtemps après le geste qui l'avait écrite.
  const changerDeRoute = () => { oublierCompositionSiRouteChangee(); rafraichir(); };
  $("origin").addEventListener("input", debounce(changerDeRoute));
  $("destSystem").addEventListener("input", changerDeRoute); // <select> : un seul événement, immédiat
  $("destTerminal").addEventListener("input", debounce(changerDeRoute)); // terminal d'arrivée forcé

  // « Chaîne ».
  $("chainOrigin").addEventListener("input", debounce(rafraichir));
  $("hops").addEventListener("input", rafraichir);

  // « Tournée ». Terminal à saisie libre lui aussi, malgré sa `<datalist>` : rien n'oblige à choisir
  // dedans.
  $("tourFrom").addEventListener("input", rafraichirDifferee);
  $("tourScope").addEventListener("input", rafraichir);

  // « Commodités » : les deux segmentés de mode. Leurs `<div>` sont du markup d'`index.html` et
  // leurs boutons sont STATIQUES — la délégation traverse (ADR-012 §2). Ne pas généraliser à
  // `#commGrid` : sa tuile est un vrai `<button>` React qui porte son propre `onClick`, et la
  // délégation qui vivait là doublait l'action — seul un compteur de propagations l'avait vu.
  $("commSortModes").addEventListener("click", (e) => {
    const b = cible(e).closest("button[data-sort]");
    if (b) setCommSort(b.dataset.sort);
  });
  $("commBoardModes").addEventListener("click", (e) => {
    const b = cible(e).closest("button[data-board]");
    if (b) setCommBoard(b.dataset.board);
  });
}
