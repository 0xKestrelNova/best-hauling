// La seule couture entre les deux mondes, pendant la migration v2 (ADR-008).
//
// app.js reste le SEUL écrivain de l'état : ce module ne fait que remplacer `box.innerHTML = html`
// par un rendu React idempotent. Il n'y a rien de plus à construire — pas de magasin, pas de bus,
// pas d'abonnement — parce que le dépôt a déjà un point de propagation unique et complet :
// TOUTE mutation d'état partagé finit par appeler `refresh()` dans la même pile (vérifié sur les
// 17 écritures de SOUTE, les 8 de JOURNEY, les 5 d'OVERRIDES). Lui ajouter un rival créerait deux
// vérités à tenir d'accord, ce que la refonte cherche justement à supprimer.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

// UNE racine par conteneur, créée UNE SEULE FOIS. La recréer à chaque rendu REMONTERAIT l'arbre :
// on reperdrait la valeur et le focus des champs en cours de saisie — c'est-à-dire #24, #28, #38
// et #55 réintroduits par l'outil même qui devait les supprimer. C'est le seul vrai piège
// d'implémentation de cette étape, et aucun test d'apparence ne le verrait.
const racines = new WeakMap();

export function peindre(el, noeud, { synchrone = false } = {}) {
  let r = racines.get(el);
  if (!r) { r = createRoot(el); racines.set(el, r); }
  // React rend en DIFFÉRÉ. Les rares appelants qui mesurent le DOM juste après doivent demander le
  // rendu synchrone ; les autres non — React réserve flushSync au dernier recours.
  if (synchrone) flushSync(() => r.render(noeud));
  else r.render(noeud);
}
