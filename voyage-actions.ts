// Engager un trajet dans le parcours : l'ACTION (ADR-012).
//
// `voyage-donnees.ts` porte la DONNÉE du parcours — manifestes de jambe, intentions persistées,
// gel. Ce module-ci porte le geste qui l'ÉTEND, et il est à part pour une raison de dépendance :
// il appelle `rafraichir()`, donc il touche au cycle de rendu, ce que `voyage-donnees.ts`
// s'interdit.
//
// ── POURQUOI C'EST UN PRÉALABLE ───────────────────────────────────────────────────────────────
// `pickJourney` est le point d'entrée du compagnon de voyage, et les QUATRE vues qui restent dans
// `app.js` l'appellent — Trajets (deux fois, mode simple et mode multi), Boucles, Chaîne — plus le
// manifeste d'« En route » et le déplacement d'arrêt. Aucune d'elles ne peut emménager dans l'arbre
// tant qu'il vit dans un fichier qui n'exporte rien.

import { addToJourney, currentLeg, journeyStations, stationLabel } from "./logic.ts";
import type { Jambe } from "./types.ts";
import { etat } from "./etat.ts";
import { rafraichir } from "./rendu.ts";

const champ = (id: string): HTMLInputElement | null =>
  document.getElementById(id) as HTMLInputElement | null;

/**
 * Aligne les champs de départ et d'arrivée des vues de recherche sur le parcours.
 *
 * Ce sont des champs d'`index.html` qu'aucun portail ne possède : l'écriture reste impérative, et
 * c'est la frontière et non une dette (ADR-012 §2). Elle est SILENCIEUSE — poser `.value` n'émet
 * aucun événement `input`, donc aucun rendu ne part d'ici ; c'est l'appelant qui rafraîchit.
 */
export function syncViewsToJourney(): void {
  if (!etat.JOURNEY) return;
  const here = journeyStations(etat.JOURNEY)[etat.JOURNEY.current]; // station où l'on se trouve
  if (!here) return;
  const originLabel = stationLabel(here.name, here.system);
  const poser = (id: string, v: string) => { const c = champ(id); if (c) c.value = v; };
  poser("origin", originLabel);        // En route : départ = station courante
  poser("chainOrigin", originLabel);   // Chaîne : départ = station courante
  const leg = currentLeg(etat.JOURNEY);
  if (leg) {
    poser("destTerminal", stationLabel(leg.to, leg.toSystem)); // arrivée forcée = jambe courante
    poser("destSystem", "");
  } else {
    poser("destTerminal", ""); // au bout du parcours : on cherche le fret onward, pas d'arrivée imposée
  }
}

/**
 * Ajoute une ou plusieurs jambes au parcours, puis réaligne les vues et rafraîchit.
 *
 * `apresAjout` s'exécute ENTRE l'ajout et la synchronisation : le manifeste s'en sert pour figer
 * l'intention de la jambe qu'il vient de créer, et il a besoin de son index — donc du parcours déjà
 * étendu, mais d'un écran pas encore repeint.
 *
 * `rafraichir()` remplace le couple `renderJourney(); refresh();` de la version d'`app.js` :
 * `refresh()` rejoue déjà la carte du voyage dès que `etat.JOURNEY` existe, et il existe forcément
 * ici — `addToJourney` vient de le poser. Le premier appel ne faisait que peindre la carte un tour
 * plus tôt, dans la même tâche : rien ne pouvait l'observer entre les deux.
 */
export function pickJourney(legs: Jambe[] | null | undefined, apresAjout?: () => void): void {
  if (!legs || !legs.length) return;
  etat.JOURNEY = addToJourney(etat.JOURNEY, legs);
  if (apresAjout) apresAjout();
  syncViewsToJourney();
  rafraichir();
}
