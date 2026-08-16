// Les corrections locales de prix et de volume (ADR-011).
//
// L'utilisateur peut corriger un prix ou un volume — stock à l'achat, demande à la vente — quand le
// relevé UEX est faux. Stocké UNIQUEMENT en local (`localStorage`), jamais partagé ni mis dans
// l'URL. La clé est « commodité|terminal|côté », et `base` y est la date UEX du point AU MOMENT de
// la correction : une correction vaut « contre cet export », et n'est périmée que si UEX republie ce
// point plus récemment.
//
// Ce module porte la DONNÉE ; `app.js` garde le MESSAGE. La séparation n'est pas cosmétique :
// `effVals` est appelée trente fois, au fond du rendu, et elle a des effets de bord (elle persiste
// et signale). Les deux ensembles de clés périmées vivent donc ici, et l'interface vient les
// relever par `relevePerimees()` — c'est ce qui permet à la fonction de rester appelable depuis
// n'importe où sans traîner `showToast` derrière elle.

import { DUREE_VOL, effFromStore, migrerCorrections, ovKey, setInStore } from "./logic.ts";
import type { ChampCorrection, CoteMarche, ValeurEffective } from "./types.ts";
import { etat } from "./etat.ts";

const CLE_STOCKAGE = "best-hauling-overrides";

// Périmées PENDANT le rendu courant, et pour deux raisons différentes : une republication UEX d'un
// côté, le simple vieillissement du volume de l'autre. Deux causes, deux messages — dire « mise à
// jour UEX » à propos d'un volume qui a juste vieilli enverrait chercher un changement de données
// qui n'a pas eu lieu.
let perimeesUex = new Set<string>();
let perimeesAge = new Set<string>();

export function loadOverrides(): void {
  try {
    etat.OVERRIDES = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || "") || {};
  } catch {
    etat.OVERRIDES = {};
  }
  // Mise à niveau des corrections déjà posées : `ts` devient `base`, et AUCUNE date de saisie n'est
  // inventée pour les prix d'avant — ils s'exportent « date inconnue ». On n'écrit que s'il y avait
  // vraiment quelque chose à normaliser.
  if (migrerCorrections(etat.OVERRIDES).migres) saveOverrides();
}

export function saveOverrides(): void {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat.OVERRIDES));
  } catch {}
}

export const ovCount = (): number => Object.keys(etat.OVERRIDES).length;

/**
 * Prix et volume EFFECTIFS — corrigés si une correction locale existe — avec ses drapeaux.
 *
 * « Intelligent » : si le relevé UEX du point est plus récent que celui contre lequel la correction
 * a été faite, la correction est périmée. `effFromStore` la supprime et rend la valeur UEX ; ici on
 * persiste la suppression et on note la clé, pour que l'interface puisse le dire une fois.
 */
export function effVals(
  commodity: string,
  terminal: string,
  side: CoteMarche,
  price: number,
  vol: number,
  dataUpdated: number,
): ValeurEffective {
  const k = ovKey(commodity, terminal, side);
  const r = effFromStore(etat.OVERRIDES, k, price, vol, dataUpdated);
  if (r.stale) { saveOverrides(); perimeesUex.add(k); }
  else if (r.staleVol) { saveOverrides(); perimeesAge.add(k); }
  return r;
}

/**
 * Enregistre ou efface une correction. `value` à `null` ou `""` efface ce champ.
 * `baseUpdated` est la date UEX du point corrigé — l'état de l'export au moment de la correction.
 */
export function setOverride(
  commodity: string,
  terminal: string,
  side: CoteMarche,
  field: ChampCorrection,
  value: string | number | null | undefined,
  baseUpdated: number,
): void {
  setInStore(etat.OVERRIDES, ovKey(commodity, terminal, side), field, value, baseUpdated);
  saveOverrides();
}

export function resetOverrides(): void {
  etat.OVERRIDES = {};
  saveOverrides();
}

/**
 * Combien de corrections ont péri pendant le rendu qui vient de finir, et pourquoi — puis remet les
 * compteurs à zéro. C'est un RELEVÉ : appeler deux fois de suite rend zéro la seconde fois, ce qui
 * est exactement ce qu'on veut d'une notification.
 */
export function relevePerimees(): { uex: number; age: number } {
  const releve = { uex: perimeesUex.size, age: perimeesAge.size };
  if (releve.uex || releve.age) {
    perimeesUex = new Set();
    perimeesAge = new Set();
  }
  return releve;
}

/** La durée de vie d'un volume corrigé, réexportée pour le message qui l'annonce. */
export { DUREE_VOL };
