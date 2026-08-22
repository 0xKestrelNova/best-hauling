// LE GESTE DE REJEU (#62).
//
// Une DÉLÉGATION, pas un `onClick` : `#aideRejouer` est du markup d'`index.html`, posé dans
// `.brand`, que la racine React ne possède pas (ADR-012 §2). Elle est posée sur `.brand` et non sur
// le bouton lui-même, comme `navigation.ts` le fait sur `.rail-nav` — le jour où la marque gagne un
// troisième bouton, il n'y a rien à rebrancher.
//
// Le bouton est FRÈRE de `#brandHome`, jamais son enfant : deux éléments interactifs imbriqués sont
// invalides en ARIA — la règle appliquée en sortant `.scomm-undo` du `.editv` (#38). `index.html`
// réservait la place depuis l'ADR-004, et `e2e/plan.pw.mjs` la garde déjà.
import { ouvrirAide } from "./aide.ts";

import type { Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. Le cast est posé UNE fois par module, comme `$` — pas dans un
// module partagé (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;

export function brancherAide(): void {
  const marque = document.querySelector(".brand");
  if (marque) marque.addEventListener("click", (e) => {
    if (cible(e).closest("#aideRejouer")) ouvrirAide();
  });
}
