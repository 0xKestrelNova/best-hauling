// L'AIDE DE DÉMARRAGE (#62) : le drapeau, et les deux gestes qui l'ouvrent et la referment.
//
// ── POURQUOI SA PROPRE CLÉ, ET SURTOUT PAS L'ÉTAT ENCODÉ ──────────────────────────────────────
// `persistance.ts` encode l'état DANS LE HASH, et ce hash est le lien qu'on partage. Un drapeau
// « j'ai déjà vu l'aide » posé là déciderait à la place du destinataire : recevoir le lien d'un
// pilote expérimenté supprimerait l'aide d'une VRAIE première visite — c'est-à-dire exactement le
// cas pour lequel elle existe — et un premier visiteur qui partage l'imposerait à tout le monde.
//
// La séparation n'est pas qu'une intention, elle est MÉCANIQUE : `collectState()` ne lit que
// `STATE_FIELDS`, `STATE_CHECKS` et six clés nommées. Une clé à part ne PEUT pas y entrer par
// accident. Le nom suit les neuf magasins déjà en place (`best-hauling-hold`, `-overrides`…).
//
// ── POURQUOI UN BOOLÉEN DANS `etat` ──────────────────────────────────────────────────────────
// `navigation.ts` doit répondre « l'aide est ouverte » SANS interroger le DOM : après un clic dans
// le voile le focus retombe sur `<body>`, et `closest('[role="dialog"]')` rendrait alors `null` —
// les touches 1…8 traverseraient. Même choix que `declarationOuverte` et `ecoulerOuvert`.
import { etat, notifier } from "./etat.ts";

const CLE = "best-hauling-aide-vue";

/** Le drapeau de visite. `false` en cas de stockage refusé : l'aide se remontre, elle ne plante pas. */
export function aideDejaVue(): boolean {
  try { return localStorage.getItem(CLE) === "1"; } catch { return false; }
}

/** Ouvre l'aide. La restitution du focus, elle, est portée par le composant (voir `vues/aide.tsx`). */
export function ouvrirAide(): void {
  if (etat.aideOuverte) return;
  etat.aideOuverte = true;
  notifier();
}

export function fermerAide(): void {
  if (!etat.aideOuverte) return;
  etat.aideOuverte = false;
  // LE DRAPEAU SE POSE ICI, ET PAS À L'OUVERTURE : un onglet fermé pendant que l'aide s'affiche est
  // une aide NON LUE. Elle doit revenir à la visite suivante.
  try { localStorage.setItem(CLE, "1"); } catch {}
  notifier();
}

/**
 * L'ouverture de PREMIÈRE VISITE. Appelée une fois par l'amorce.
 *
 * `notifier()` et non `rafraichir()` : rien de partagé ne change ici — ni les générations de saisie,
 * ni le permalien. Un cycle complet réécrirait le hash pour un état identique, et pour rien.
 */
export function ouvrirAideSiPremiereVisite(): void {
  if (!aideDejaVue()) ouvrirAide();
}
