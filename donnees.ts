// Le chargement des données à la demande (ADR-011).
//
// `routes.json` est chargé à l'amorçage ; les deux autres non, et c'est délibéré :
//   — `market.json` (85 ko) n'est lu que par les vues qui ont besoin du graphe d'échange ;
//   — `starmap.json` (1,5 ko) n'est lu que s'il y a un voyage à dessiner.
// La vue par défaut ne paie donc ni l'un ni l'autre.
//
// ── DEUX CROCHETS, ET POURQUOI ILS SONT EXPLICITES ────────────────────────────────────────────
// Ce module sait charger ; il ne sait rien des `<datalist>` ni des messages. Or `withMarket` porte
// un CONTRAT que ni l'un ni l'autre ne peut deviner : `setupEnRoute()` doit tourner AVANT le
// rappel, à chaque passage, sans quoi les listes déroulantes se figeraient sur un marché vide.
// Le laisser à chaque appelant, c'est seize occasions de l'oublier. On le déclare donc une fois,
// à l'amorçage, par `brancher()`.

import type { Filtres, Marche, Starmap } from "./types.ts";
import { etat } from "./etat.ts";

let apresMarche: () => void = () => {};
let signalerIndisponible: () => void = () => {};

/** Pose les deux crochets. Appelé une fois, à l'amorçage. */
export function brancher(crochets: { apresMarche: () => void; signalerIndisponible: () => void }): void {
  apresMarche = crochets.apresMarche;
  signalerIndisponible = crochets.signalerIndisponible;
}

// La PROMESSE est mémorisée, jamais l'échec : un `catch` la remet à `null`, donc l'action suivante
// réessaie. Retenir un rejet condamnerait la session entière à une coupure réseau d'une seconde.
let marcheEnCours: Promise<Marche> | null = null;

export function loadMarket(): Promise<Marche> {
  if (etat.MARKET) return Promise.resolve(etat.MARKET);
  if (!marcheEnCours) {
    marcheEnCours = fetch("data/market.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((m: Marche) => (etat.MARKET = m))
      .catch((e) => { marcheEnCours = null; throw e; });
  }
  return marcheEnCours;
}

/**
 * Exécute `then` une fois le marché chargé ET les listes peuplées. Point de passage UNIQUE de
 * toutes les vues qui ont besoin du graphe — c'est lui qui garantit que la préparation ne tourne
 * jamais sur un marché vide.
 */
export function withMarket(then: () => void): void {
  loadMarket().then(() => { apresMarche(); then(); }).catch(signalerIndisponible);
}

// Un échec ne bloque rien : la carte reste simplement absente, le reste du compagnon fonctionne.
// Silencieux à dessein — un panneau décoratif n'alarme personne.
let starmapEnCours = false;

export function ensureStarmap(then: () => void): void {
  if (etat.STARMAP || starmapEnCours) return;
  starmapEnCours = true;
  fetch("data/starmap.json")
    .then((r) => r.json())
    .then((s: Starmap) => { etat.STARMAP = s; starmapEnCours = false; then(); })
    .catch(() => { starmapEnCours = false; });
}

// « Trajets » et « Boucles » lisent `routes.json` / `loops.json`, qui ne portent que des NOMS de
// terminaux : `autoload` et `maxBox` n'existent que dans `market.json`. On le charge en TÂCHE DE
// FOND et on re-rend à l'arrivée, plutôt que de retarder — ou de vider — la vue par défaut derrière
// un fetch de 85 ko : le tableau reste lisible, ses profits simplement bruts le temps du chargement.
//
// En cas d'échec on NE re-rend PAS : ce re-rendu rappellerait cette fonction, qui relancerait un
// fetch (`loadMarket` ne mémorise jamais l'échec) — en boucle. La prochaine action de l'utilisateur
// réessaiera, ce qui est exactement la règle de `loadMarket`.
let fraisEnCours = false;

export function ensureFeeMarket(f: Filtres, then: () => void): void {
  if (!f.autoload || etat.MARKET || fraisEnCours) return;
  fraisEnCours = true;
  loadMarket()
    .then(() => { fraisEnCours = false; apresMarche(); then(); })
    .catch(() => { fraisEnCours = false; signalerIndisponible(); });
}
