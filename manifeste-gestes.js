// LES GESTES DE COMPOSITION D'UN CHARGEMENT (ADR-012).
//
// `manifeste-donnees.ts` DÉRIVE le chargement courant et `manifeste-etat.ts` le persiste ; ce
// module-ci porte les gestes qui le composent — ajouter une suggestion, ajouter librement une
// commodité, retirer une ligne, ajuster les SCU — et celui qui l'abandonne quand on change de
// route.
//
// Chacun RECALCULE le chargement au lieu de le relire d'une globale. C'est la leçon
// d'`indexOrigine`, et elle vaut ici plus qu'ailleurs : un geste fait avant le premier rendu de la
// carte lisait `null` sans rien dire.

import { addableUnits, freeManifestLine, stationLabel } from "./logic.ts";
import { etat, notifier } from "./etat.ts";
import { readFilters } from "./filtres.ts";
import { effVals } from "./corrections.ts";
import { findCommodity, indexArriveeForcee, indexOrigine, stationMap } from "./marche.ts";
import { rafraichir } from "./rendu.ts";
import { manifesteCourant, manifestRemaining, suggestionsFor } from "./manifeste-donnees.ts";
import { compositionValide, oublierComposition, retenirComposition } from "./manifeste-etat.ts";

const champ = (id) => document.getElementById(id)?.value ?? "";

export function addSuggestion(name) {
  const m = chargementCourant();
  if (!m) return;
  const it = suggestionsFor(m).find((x) => x.name === name);
  if (!it) return;
  const u = addableUnits(it, manifestRemaining(m));
  if (u <= 0) return;
  m.lines.push({ ...it, units: u, cap: u });
  retenirComposition(m);
  notifier();
}

export function addManifestCommodity(name) {
  const m = chargementCourant();
  if (!m || !etat.MARKET) return;
  const c = findCommodity(name);
  if (!c || m.lines.some((l) => l.name === c.name)) return; // inconnue ou déjà dans le manifeste
  m.lines.push(freeManifestLine(etat.MARKET, m.originIdx, m.destIdx, c, manifestRemaining(m).cargoLeft, effVals));
  retenirComposition(m);
  notifier();
}

export function removeManifestLine(name) {
  const m = chargementCourant();
  if (!m) return;
  m.lines = m.lines.filter((l) => l.name !== name);
  retenirComposition(m);
  notifier();
}

export function updateManifestTotals() {
  const m = chargementCourant();
  if (!m) return;
  document.querySelectorAll("#manifest .mqty-input").forEach((inp) => {
    const i = Number(inp.dataset.i);
    let u = Math.floor(Number(inp.value));
    if (!Number.isFinite(u) || u < 0) u = 0;
    // Le dépassement du stock UEX est autorisé (vol de fret, relevé périmé…) : on ne plafonne
    // plus à `cap`, on le signale visuellement — la classe `over-stock` est posée au rendu.
    const l = m.lines[i];
    if (l) l.units = u;
  });
  // À la FRAPPE, pas au blur : le champ ne porte aucun `change`, et le premier refresh venu — un
  // prix corrigé ailleurs, une recherche tapée — repeindrait la carte avant qu'on ait quitté le
  // champ. Ce que ça écrit tient en deux nombres par ligne.
  retenirComposition(m);
  // `notifier()` et non `rafraichir()` : la frappe ne doit PAS bouger la génération de la carte,
  // sans quoi les champs SCU se remonteraient sous les doigts (cf. manifeste-etat.ts).
  notifier();
}

export function oublierCompositionSiRouteChangee() {
  if (!etat.MANIFEST_EDIT || !etat.MARKET) return;
  const origin = indexOrigine();
  if (origin == null) return;
  const arrivee = indexArriveeForcee();
  const ot = etat.MARKET.terminals[origin];
  const dt = arrivee == null ? null : etat.MARKET.terminals[arrivee];
  const valide = compositionValide(
    { name: ot.name, system: ot.system },
    dt && { name: dt.name, system: dt.system },
    champ("destSystem"),
    (nom, systeme) => stationMap.get(stationLabel(nom, systeme)),
    findCommodity,
  );
  if (!valide) oublierComposition();
}

export function resetManifeste() { oublierComposition(); rafraichir(); }

const chargementCourant = () => { const r = manifesteCourant(readFilters()); return r.etat === "ok" ? r.m : null; };
