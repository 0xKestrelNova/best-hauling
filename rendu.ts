// LE CYCLE DE RENDU (ADR-011, ADR-012).
//
// Il fut un CROCHET — `brancherRendu({ rafraichir })`, posé par `app.js` à l'amorçage, parce que
// `refresh()` vivait dans un fichier qui n'exportait rien. Son en-tête d'alors annonçait sa propre
// fin : « ce crochet est TRANSITOIRE, il disparaît quand `renderJourney`, `renderSoute` et
// `renderEntrepots` auront emménagé dans l'arbre ». Elles y sont. Le crochet n'est plus là, et le
// cycle est ce module.
//
// ── CE QU'UN CYCLE FAIT DE PLUS QU'UN `notifier()` ────────────────────────────────────────────
// `notifier()` (etat.ts) réveille l'arbre React, et rien d'autre. Trois choses de plus font qu'un
// geste qui change l'état PARTAGÉ appelle `rafraichir()` et non `notifier()` :
//   — les deux GÉNÉRATIONS. Elles datent les champs SCU à saisie libre — la carte de chargement et
//     les jambes du compagnon — et entrent dans leur `key` React. Un recalcul complet doit les
//     faire adopter la valeur calculée ; une frappe, elle, ne doit surtout pas (sinon le champ se
//     remonte sous les doigts, une lettre à la fois). C'est exactement pourquoi le TRI appelle
//     `notifier()` et jamais `rafraichir()` : trier une colonne ne doit pas effacer une saisie ;
//   — `saveState()`, donc le permalien et la restauration au rechargement.
// Une action migrée qui n'appellerait que `notifier()` laisserait le lien partagé périmé et les
// champs SCU figés à côté d'un tableau à jour. Aucun test ne le verrait : ils regardent la vue.
//
// ── LE DEBOUNCE EST PARTAGÉ, ET C'EST UN CONTRAT ──────────────────────────────────────────────
// `rafraichirDifferee` est UNE instance, pas une fabrique. Les six champs à saisie libre de la
// barre de filtres se partagent son timer : taper dans « Rechercher » puis dans « Soute » ne
// déclenche qu'un cycle. Chaque module qui en referait un aurait le sien, et six timers
// indépendants rendraient six fois — sans qu'aucun test ne bronche, l'application ramerait.
// La raison de fond n'est pas le CPU (mesuré à ×4 par frappe, déjà suffisant) : `saveState()`
// écrit le hash à chaque cycle, et WebKit plafonne `history.replaceState` à 100 appels / 10 s.
// Deux noms de terminaux tapés d'affilée suffisent à l'atteindre, et le partage de lien meurt.
import { notifier } from "./etat.ts";
import { nouvelleGenerationManifeste } from "./manifeste-etat.ts";
import { nouvelleGenerationVoyage } from "./voyage-donnees.ts";
import { saveState } from "./persistance.ts";

/**
 * Rejoue le cycle COMPLET : les deux générations, la persistance, puis la propagation à l'arbre.
 *
 * À appeler par toute action qui change l'état PARTAGÉ — une correction, une écriture en soute, un
 * arrêt de voyage. Une action qui ne touche qu'à l'affichage d'une vue déjà dans l'arbre n'a besoin
 * que de `notifier()`.
 *
 * PLUS AUCUNE BRANCHE DE VUE : les huit vivent dans l'arbre et se réévaluent seules au `notifier()`
 * final, chacune sous sa propre garde.
 */
export function rafraichir(): void {
  nouvelleGenerationManifeste();
  nouvelleGenerationVoyage();
  saveState();
  // La propagation vers l'arbre est APPELÉE, jamais déclenchée par une écriture : des références
  // vives sortent de l'état et sont mutées dehors (`legIntent`), et `logic.ts` mute `OVERRIDES` en
  // place pendant le rendu — aucun accesseur ne les verrait. Voir l'en-tête d'`etat.ts`.
  notifier();
}

/** Regroupe les appels rapprochés en un seul, à la fin de la salve. */
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms = 150) => {
  let t: ReturnType<typeof setTimeout>;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** LE cycle différé, partagé par tous les champs à saisie libre. Une instance, un seul timer. */
export const rafraichirDifferee = debounce(rafraichir);
