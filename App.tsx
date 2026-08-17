// LA RACINE UNIQUE (ADR-011, étape 3).
//
// Une seule racine React possède désormais l'arbre. Elle s'abonne à `etat.ts` par
// `useSyncExternalStore` : quand `notifier()` est appelée — c'est-à-dire à la fin de `refresh()` et
// aux cinq rendus ciblés — tout l'arbre se réévalue. Aucun `peindre()` n'est nécessaire pour ce qui
// vit ici, et aucune prop n'est poussée depuis `app.js` : chaque vue lit ce dont elle a besoin.
//
// ── POURQUOI DES PORTAILS, ET POUR COMBIEN DE TEMPS ───────────────────────────────────────────
// `index.html` porte encore 114 balises de structure, et chaque vue a son conteneur nommé. La
// racine rend donc ses vues DANS ces conteneurs, par `createPortal`. Ce n'est pas la forme finale —
// une application écrite de zéro rendrait cette structure elle-même — mais c'est ce qui permet
// d'emménager vue par vue sans réécrire `index.html` d'un bloc. Chaque portail disparaît quand le
// markup de son conteneur devient un composant.
//
// La racine elle-même se monte sur `#racine`, un nœud vide : elle n'affiche rien en propre.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { etat, getSnapshot, subscribe } from "./etat.ts";
import { VueTourneeEcoulement } from "./vues/tournee-vue.tsx";
import { CorpsPlan, EnTetePlan } from "./vues/plan-vue.tsx";
import { VueCommodites } from "./vues/commodites-vue.tsx";
import { PanneauFrais } from "./vues/frais-station.tsx";
import { VueCorrections } from "./vues/corrections-vue.tsx";
import { VueBouclesArbitrage } from "./vues/boucles-vue.tsx";
import { VueChaineArbitrage } from "./vues/chaine-vue.tsx";
import { VueTrajetsArbitrage } from "./vues/trajets-vue.tsx";
import { CarteParcours } from "./vues/carte-vue.tsx";
import { VueEnRoute } from "./vues/enroute-vue.tsx";
import { indexStationExacte } from "./marche.ts";

/**
 * Rend `children` dans le conteneur `id`, et SEULEMENT si la vue `si` est celle qu'on regarde.
 *
 * Le garde n'est pas une optimisation prématurée, il est MESURÉ : sans lui, chaque `notifier()`
 * réévalue TOUTES les vues montées, y compris celles que l'utilisateur ne regarde pas. Relevé avec
 * deux vues dans l'arbre — une frappe dans `#search`, depuis la vue Trajets, évaluait la Tournée
 * ET le Plan. À treize vues, une frappe recalculerait `commoditySummaries` sur tout le marché pour
 * un écran que personne ne voit.
 *
 * Un conteneur absent n'est pas une erreur : `index.html` peut changer sans casser l'arbre.
 */
function Portail({ id, si, children }: { id: string; si?: string; children: React.ReactNode }) {
  if (si != null && etat.view !== si) return null;
  const cible = document.getElementById(id);
  return cible ? createPortal(children, cible) : null;
}

/**
 * Le panneau de frais a besoin de SA station, et il est le seul de son conteneur : il la dérive
 * lui-même, comme toute vue de l'arbre. `etat.MARKET` peut manquer — la vue Corrections est encore
 * peinte par `app.js`, qui déclenche le chargement.
 */
function PanneauFraisStation() {
  const S = etat.MARKET ? indexStationExacte() : null;
  return <PanneauFrais terminal={S != null ? etat.MARKET!.terminals[S] : null} />;
}

export function App() {
  // L'abonnement. `getSnapshot` rend un COMPTEUR et jamais l'objet d'état : `useSyncExternalStore`
  // compare par `Object.is`, et un objet muté en place rendrait toujours la même référence — React
  // ne re-rendrait jamais.
  useSyncExternalStore(subscribe, getSnapshot);

  return (
    <>
      <Portail id="tour" si="tour"><VueTourneeEcoulement /></Portail>
      {/* Le Plan de vol occupe DEUX conteneurs, séparés dans `index.html` par la carte du parcours —
          un élément à écouteurs directs se déménage en frère, jamais en enfant (leçon de #24). */}
      <Portail id="planHead" si="plan"><EnTetePlan /></Portail>
      <Portail id="planBody" si="plan"><CorpsPlan /></Portail>
      {/* Trois conteneurs, mais UN composant — et donc pas de `<Portail si=…>` ici : la garde de
          vue est faite en tête de `VueCommodites`, AU-DESSUS du calcul. La répéter sur trois
          portails frères ferait recalculer tout le marché trois fois (ADR-012 §3). */}
      <VueCommodites />
      {/* La vue Corrections occupe TROIS conteneurs. Les deux premiers vivent dans un seul
          composant, parce que l'ordre dans lequel ils sont calculés est un contrat : les tuiles
          purgent les corrections périmées en chemin, la bande doit compter APRÈS (ADR-012 §4).
          Le panneau de frais, lui, est indépendant — il ne lit ni les corrections ni la purge. */}
      <VueCorrections />
      <Portail id="correctionsFees" si="corrections"><PanneauFraisStation /></Portail>
      {/* Boucles ne rend qu'un `<tbody>`, mais elle écrit AUSSI `#empty`, un `<p>` partagé avec
          Trajets et « En route » qui vivent encore dans app.js. Elle porte donc sa propre garde et
          son propre portail — voir `vues/message-vide.ts` pour pourquoi ce n'en est pas un second. */}
      <VueBouclesArbitrage />
      <VueChaineArbitrage />
      <VueTrajetsArbitrage />
      {/* La carte du parcours vit DANS la section du Plan de vol : garde POSITIVE, l'inverse du
          bandeau. Elle était redessinée à chaque rendu depuis les huit vues. */}
      <Portail id="journeyMap" si="plan"><CarteParcours /></Portail>
      {/* La HUITIÈME et dernière vue d'onglet. Elle occupe deux conteneurs — la carte de chargement
          et la table du fret rentable — qui partagent les filtres, le départ et l'arrivée forcée. */}
      <VueEnRoute />
    </>
  );
}
