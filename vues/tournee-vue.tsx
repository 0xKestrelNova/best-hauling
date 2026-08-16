// La VUE Tournée : le composant qui décide quoi afficher (ADR-011, étape 3).
//
// C'est le premier morceau d'`app.js` à devenir un composant plutôt qu'une fonction de rendu.
// `renderTour()` faisait exactement ceci, puis appelait `peindre()` ; ici on rend, et la racine
// unique s'occupe du reste.
//
// Il ne reçoit AUCUNE prop, et c'est le point : il lit l'état (`etat.ts`), les filtres
// (`filtres.ts`), résout une station (`marche.ts`), déclenche un chargement (`donnees.ts`) et
// calcule (`logic.ts`). Il ne demande rien à `app.js`. C'est ce que les six PR d'extraction
// précédentes ont rendu possible.
//
// `tournee.tsx` garde la PRÉSENTATION — les arrêts, le bandeau de plancher, l'alternative. Ce
// fichier-ci porte la DÉCISION : soute vide, marché absent, position inconnue, ou le calcul.
import { tourneesEcoulement } from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { feeResolver } from "../frais.ts";
import { resolveStationLabel, stationCourante } from "../marche.ts";
import { withMarket } from "../donnees.ts";
import { messageChargement, messageOuEsTu, messageSouteVide, vueTournee } from "./tournee.tsx";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

export function VueTourneeEcoulement() {
  if (!etat.SOUTE.length) return messageSouteVide();

  // Le graphe d'échange porte les débouchés. `withMarket` reçoit `notifier` et non un rendu ciblé :
  // le fetch dure, et l'utilisateur peut avoir changé de vue entre-temps — c'est la racine qui
  // décidera alors quoi réafficher.
  if (!etat.MARKET) {
    // `notifier` et non un rendu ciblé : à l'arrivée du marché c'est TOUT l'arbre qui se réévalue,
    // et chaque vue décide alors elle-même quoi afficher — y compris si l'utilisateur a changé de
    // vue entre-temps. C'est la même règle que l'ancien `withMarket(refresh)`, sans le rendu.
    withMarket(notifier);
    return messageChargement();
  }

  // Le champ de la vue prime sur la position du voyage : on peut vouloir simuler depuis ailleurs.
  const saisi = champ("tourFrom");
  const ici = saisi ? resolveStationLabel(saisi) : stationCourante();
  if (ici == null) return messageOuEsTu();

  const f = readFilters();
  const systeme = etat.MARKET.terminals[ici].system;
  const toutSysteme = champ("tourScope") === "all";
  // Portée par défaut = le système où l'on se trouve (27 terminaux en Pyro, 80 en Stanton, 7 en Nyx
  // sur 114). L'ouvrir est un geste explicite, et le saut apparaît alors comme une ligne de coût.
  const ft = { ...f, sysFilter: toutSysteme ? f.sysFilter : systeme };
  const { tournee, alternative } = tourneesEcoulement(etat.MARKET, etat.SOUTE, ici, ft, effVals, feeResolver(f));

  return vueTournee({ tournee, alternative, systeme, toutSysteme });
}
