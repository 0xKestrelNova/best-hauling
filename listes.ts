// LES TROIS LISTES DÉROULANTES, peuplées à l'arrivée du marché (ADR-011).
//
// Elles ne valent pas un composant : ce sont des `<option>` nus, sans classe et sans événement,
// posés une fois et jamais relus par React. Elles ne peuvent pas non plus vivre dans `donnees.ts`,
// qui déclare en tête ne rien savoir des `<datalist>` ni des messages — les deux crochets de
// `brancher()` n'existent que pour ça. Ni dans `marche.ts`, qui ferait cycle avec `selecteur.js`.
import { construireIndex, libellesOrigines, libellesStations } from "./marche.ts";
import { etat } from "./etat.ts";
import { esc } from "./format.ts";
import { monterSelecteurStation } from "./selecteur.ts";

// `$` est typé `HTMLInputElement` et non `HTMLElement`, parce que dans CE module il ne sert
// qu'à des contrôles de formulaire — dont on lit ou écrit la `value`. C'est le même choix
// que `filtres.ts` et `persistance.ts` : l'alias dit ce que le module en fait.
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

// L'état est PRIVÉ et son lecteur est une fonction : exporter la liaison `let` marcherait — les
// liaisons ES sont vives — mais un importateur qui la recopie dans une `const` la figerait à
// `false`. Rien ne casserait, `peuplerListes` étant idempotente ; on reconstruirait juste 114 + 92
// `<option>` à chaque focus, et personne ne le verrait.
let pretes = false;

/** Les listes sont-elles peuplées ? Le compagnon s'en sert pour précharger le marché au focus. */
export const listesPretes = () => pretes;

/**
 * Peuple les trois `<datalist>` et monte le sélecteur de station. IDEMPOTENT.
 *
 * ATTENTION : `withMarket` enveloppe son rappel dans un `.catch()`. Toute exception jetée ici —
 * un identifiant libre, par exemple — s'affiche à l'écran comme « ⚠ Marché indisponible ». Et
 * `tsc` ne lit pas ce fichier : seul `e2e/arbre.pw.mjs` garde ce piège.
 */
export function peuplerListes() {
  if (pretes) return;
  // Les trois index viennent de `marche.ts` ; ici on ne fait plus que peindre les listes.
  construireIndex(etat.MARKET);
  // Départ d'« En route » : les terminaux où l'on peut ACHETER.
  $("originList").innerHTML = libellesOrigines().map((l) => `<option value="${esc(l)}"></option>`).join("");
  // Toutes les stations (achat ou vente) : c'est la vue Corrections qui l'exige.
  $("stationList").innerHTML = libellesStations().map((l) => `<option value="${esc(l)}"></option>`).join("");
  // Toutes les commodités, pour l'ajout libre au chargement.
  $("commodityList").innerHTML = etat.MARKET.commodities
    .map((c) => `<option value="${esc(c.name)}">${esc(c.code || "")}</option>`).join("");

  // Le sélecteur de station (ADR-003) se monte ICI et une seule fois : il lui faut MARKET, et
  // c'est le seul point du cycle où le marché est garanti présent.
  monterSelecteurStation();

  pretes = true;
}
