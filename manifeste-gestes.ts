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
import { copyManifest } from "./presse-papiers.ts";
import { manifestToJourney } from "./voyage-gestes.ts";

import type { Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. `e.target` est un `EventTarget` : il n'a ni `closest`, ni
// `classList`, ni `id`. Le cast est posé UNE fois par module, comme `$` — pas dans un module
// partagé : c'est une expression d'une ligne, et six modules couplés à un alias ne valent pas
// l'économie (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;
/** La même, quand le code a déjà établi que la cible est un champ (garde par `id` ou par classe). */
const champCible = (e: Event) => e.target as HTMLInputElement;


// `$` est typé `HTMLInputElement` et non `HTMLElement`, parce que dans CE module il ne sert
// qu'à des contrôles de formulaire — dont on lit ou écrit la `value`. C'est le même choix
// que `filtres.ts` et `persistance.ts` : l'alias dit ce que le module en fait.
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

const champ = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

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
  document.querySelectorAll<HTMLInputElement>("#manifest .mqty-input").forEach((inp) => {
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

/**
 * Branche les trois délégations de la carte de chargement.
 *
 * Elles sont posées sur `#manifest`, et pas dans le délégué global du compagnon : cet écouteur-ci
 * ne voit que SA carte, là où le délégué global voit toute la page. C'est ce qui garde `.suggest-add`
 * sans ambiguïté — le délégué global, lui, ne le teste que sous `.jman-suggest`.
 */
export function brancherGestesManifeste() {
  // Les totaux se recalculent à la FRAPPE, sans re-rendre : le champ SCU est non contrôlé, React
  // garde son nœud, mais un cycle complet remonterait sa valeur calculée sous les doigts.
  $("manifest").addEventListener("input", (e) => {
    if (cible(e).classList.contains("mqty-input")) updateManifestTotals();
  });

  $("manifest").addEventListener("click", (e) => {
    if (cible(e).closest("#manifestToJourney")) { manifestToJourney(); return; }
    if (cible(e).closest("#copyManifest")) { copyManifest(); return; }
    if (cible(e).closest("#manifestAddBtn")) { addManifestCommodity($("manifestAddInput").value); return; }
    if (cible(e).closest("#manifestReset")) { resetManifeste(); return; }
    const del = cible(e).closest(".mline-del");
    if (del) { removeManifestLine(del.dataset.name); return; }
    const add = cible(e).closest(".suggest-add");
    if (add) addSuggestion(add.dataset.name);
  });

  // Le `preventDefault()` est indispensable : le champ vit dans un formulaire implicite avec
  // `#manifestAddBtn`, et Entrée le soumettrait.
  $("manifest").addEventListener("keydown", (e) => {
    if (champCible(e).id === "manifestAddInput" && e.key === "Enter") {
      e.preventDefault();
      addManifestCommodity(champCible(e).value);
    }
  });
}
