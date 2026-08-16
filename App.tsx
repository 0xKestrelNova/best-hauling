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

import { getSnapshot, subscribe } from "./etat.ts";
import { VueTourneeEcoulement } from "./vues/tournee-vue.tsx";

/** Rend `noeud` dans le conteneur `id` s'il existe. Un conteneur absent n'est pas une erreur. */
function Portail({ id, children }: { id: string; children: React.ReactNode }) {
  const cible = document.getElementById(id);
  return cible ? createPortal(children, cible) : null;
}

export function App() {
  // L'abonnement. `getSnapshot` rend un COMPTEUR et jamais l'objet d'état : `useSyncExternalStore`
  // compare par `Object.is`, et un objet muté en place rendrait toujours la même référence — React
  // ne re-rendrait jamais.
  useSyncExternalStore(subscribe, getSnapshot);

  return (
    <Portail id="tour">
      <VueTourneeEcoulement />
    </Portail>
  );
}
