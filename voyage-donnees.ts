// Le VOYAGE : manifestes de jambe, intentions persistées (ADR-011).
//
// Le PARCOURS (les arrêts) va dans l'URL ; les manifestes édités restent LOCAUX. On ne persiste que
// l'INTENTION de l'utilisateur — `[{ name, units }]` par jambe — jamais un instantané de marché :
// figé, il continuerait d'afficher le prix du jour de l'édition longtemps après qu'UEX l'ait
// republié, et la pastille de fraîcheur vieillirait sans refléter le vrai relevé.
//
// Ce module porte la DONNÉE — calculer un manifeste, lire une intention, la persister. Les ACTIONS
// qui la modifient (déplier un éditeur, changer des SCU, ajouter une suggestion) restent dans
// `app.js` : elles enchaînent une mutation ET un rendu, et c'est le rendu qui les y retient. Elles
// partiront quand la vue Voyage emménagera dans l'arbre.
//
// ── UNE RÉFÉRENCE VIVE SORT D'ICI, ET C'EST VOULU ─────────────────────────────────────────────
// `legIntent` rend `etat.JOURNEY_EDITS[k]` TEL QUEL, et l'appelant le mute (`intent[li].units = …`).
// Aucun accesseur, aucun proxy ne verrait cette écriture — c'est l'une des quatre raisons pour
// lesquelles `etat.ts` ne notifie pas à l'écriture (cf. son en-tête). Ne pas « corriger » ça en
// rendant une copie : les mutants comptent sur l'identité, et ils appellent `saveJourneyEdits()`
// eux-mêmes.

import {
  bestManifest, journeyEnd, legsToPin, manifestIntent, manifestIntentSurvives, hydrateManifestLine, stopSuggestions,
} from "./logic.ts";
import type { ContexteManifeste, CoteMarche, Filtres, Jambe, LigneManifeste } from "./types.ts";
import { etat } from "./etat.ts";
import { stationLabel } from "./logic.ts";
import { readFilters } from "./filtres.ts";
import { findCommodity, stationMap } from "./marche.ts";
import { effVals } from "./corrections.ts";
import { feeCtx, feeResolver } from "./frais.ts";

export function legManifest(leg: Jambe, f: Filtres) {
  if (!etat.MARKET || !stationMap.size) return null;
  const fromIdx = stationMap.get(stationLabel(leg.from, leg.fromSystem));
  const toIdx = stationMap.get(stationLabel(leg.to, leg.toSystem));
  if (fromIdx == null || toIdx == null) return null;
  return bestManifest(etat.MARKET, fromIdx, "", f, effVals, toIdx, feeResolver(f)); // { lines, profit, … } ou null
}

// Contexte de frais d'une jambe. Le récap du voyage est affiché à CÔTÉ des tableaux : le laisser en
// brut pendant que les six vues passent en net mettrait deux chiffres contradictoires côte à côte.
export const legFeeCtx = (leg: Jambe, f: Filtres) => feeCtx(f, leg.from, leg.to);

// ---------- Édition inline des manifestes de jambe (persistée en localStorage, HORS lien) ----------
// Le PARCOURS (arrêts) va dans l'URL ; les manifestes édités restent locaux.
// On ne persiste que l'INTENTION de l'utilisateur — [{ name, units }] par jambe — jamais un
// instantané de marché : figé, il continuerait d'afficher le prix du jour de l'édition longtemps
// après qu'UEX l'ait republié, et la pastille de fraîcheur vieillirait sans refléter le vrai relevé.
// Prix, stock, demande et dates sont donc RELUS à chaque rendu (cf. hydrateManifestLine).
// Clé versionnée : l'ancien format stockait des lignes complètes sous une clé « from|to » qui
// confondait deux jambes identiques d'un même parcours. Les anciennes éditions sont abandonnées.
const JOURNEY_EDITS_KEY = "best-hauling-journey-edits-v2";
// Jambes dont les quantités ont été FIGÉES par une correction de volume, et non ajustées à la main.
// Store séparé plutôt qu'un champ dans JOURNEY_EDITS : le format persisté de l'intention reste
// intact (aucune migration), et les deux notions se lisent indépendamment. La valeur n'existe que
// si une entrée d'intention existe au même rang — le gel EST une intention, avec un autre motif.
const JOURNEY_PINS_KEY = "best-hauling-journey-pins";
export function loadJourneyPins(): void {
  try { etat.JOURNEY_PINS = JSON.parse(localStorage.getItem(JOURNEY_PINS_KEY)) || {}; } catch { etat.JOURNEY_PINS = {}; }
}
export function saveJourneyPins(): void { try { localStorage.setItem(JOURNEY_PINS_KEY, JSON.stringify(etat.JOURNEY_PINS)); } catch {} }
export function loadJourneyEdits(): void {
  try { etat.JOURNEY_EDITS = JSON.parse(localStorage.getItem(JOURNEY_EDITS_KEY)) || {}; } catch { etat.JOURNEY_EDITS = {}; }
  try { localStorage.removeItem("best-hauling-journey-edits"); } catch {} // format v1 abandonné
}
export function saveJourneyEdits(): void { try { localStorage.setItem(JOURNEY_EDITS_KEY, JSON.stringify(etat.JOURNEY_EDITS)); } catch {} }
// Le RANG de la jambe fait partie de la clé : sans lui, un parcours A→B→A→B partageait un seul
// manifeste entre ses jambes 1 et 3 (éditer l'une réécrivait l'autre, la supprimer supprimait l'autre).
/** Cette jambe est-elle déjà chargée en soute ? Le registre des chargements en est la seule preuve. */
export const jambeChargee = (leg: Jambe, i: number): boolean => !!etat.CHARGEMENTS[legKey(leg, i)];

export const legKey = (leg: Jambe, i: number): string => `${i}|${leg.from}|${leg.to}`;

// Indices des terminaux d'une jambe, ou null si le marché ne les connaît pas (encore).
export function legTerminals(leg: Jambe) {
  const fromIdx = stationMap.get(stationLabel(leg.from, leg.fromSystem));
  const toIdx = stationMap.get(stationLabel(leg.to, leg.toSystem));
  return fromIdx == null || toIdx == null ? null : { fromIdx, toIdx };
}

// Manifeste EFFECTIF d'une jambe : intention éditée ré-hydratée si elle existe, sinon l'optimal.
export function legEffectiveLines(leg: Jambe, i: number, f: Filtres): LigneManifeste[] {
  const k = legKey(leg, i);
  const intent = etat.JOURNEY_EDITS[k];
  if (!intent) { const man = legManifest(leg, f); return man ? man.lines : []; }
  const t = legTerminals(leg);
  if (!etat.MARKET || !t) return [];
  const lines = [], gardees = [];
  for (const e of intent) {
    const c = findCommodity(e.name);
    if (!c) continue; // commodité disparue d'UEX : on l'oublie plutôt que d'afficher un fantôme
    gardees.push(e);
    lines.push(hydrateManifestLine(etat.MARKET, t.fromIdx, t.toIdx, c, e.units, effVals));
  }
  // Purge sur place : sans ça l'index des lignes affichées et celui du store divergeraient, et
  // éditer une quantité écrirait dans la mauvaise entrée.
  if (gardees.length !== intent.length) { etat.JOURNEY_EDITS[k] = gardees; saveJourneyEdits(); }
  return lines;
}

// Bascule la jambe en mode « édité » la 1re fois : on y copie l'intention issue de l'optimal.
// Toucher au chargement fait de la jambe une édition PERSONNELLE : si elle n'était que figée par
// une correction de volume, elle cesse de l'être (🔒 -> ✎). Le geste de l'utilisateur prime sur
// la raison technique qui avait gelé les quantités.
export function legIntent(leg: Jambe, i: number, f: Filtres) {
  const k = legKey(leg, i);
  if (!etat.JOURNEY_EDITS[k]) etat.JOURNEY_EDITS[k] = manifestIntent(legManifest(leg, f)?.lines || []);
  if (etat.JOURNEY_PINS[k]) { delete etat.JOURNEY_PINS[k]; saveJourneyPins(); }
  return etat.JOURNEY_EDITS[k];
}

// Fige les SCU d'une jambe : son chargement devient une INTENTION persistée, et le 🔒 dit que ce
// n'est pas la main de l'utilisateur qui l'a voulu. Rend `true` si quelque chose a bougé.
// Une jambe déjà ajustée (✎) ou déjà figée n'est pas retouchée : ses quantités ne bougeaient plus,
// et l'écraser effacerait un ajustement fait à la main.
export function figerJambe(i: number, lignes: LigneManifeste[] | null): boolean {
  if (!etat.JOURNEY) return false;
  const k = legKey(etat.JOURNEY.legs[i], i);
  if (etat.JOURNEY_EDITS[k]) return false;
  etat.JOURNEY_EDITS[k] = manifestIntent(lignes || []);
  etat.JOURNEY_PINS[k] = true;
  return true;
}

// Fige les jambes qu'une correction de volume rebattrait, AVANT qu'elle soit appliquée : on capture
// donc les quantités telles qu'elles sont encore. La sélection est pure (legsToPin) ; ici on ne
// fournit que ce que logic.ts ne peut pas connaître — les chargements effectifs du moment.
//
// Le gel consulte l'état « chargée » de chaque jambe (#48) : une jambe qu'on n'a pas payée n'est
// plus figée par une correction de volume, elle RECALCULE. Voir `legsToPin` pour le renversement.
export function pinLegsForVolume(commodity: string, terminal: string, side: CoteMarche): void {
  if (!etat.JOURNEY || !etat.JOURNEY.legs.length || !etat.MARKET) return;
  const f = readFilters();
  const lignes = etat.JOURNEY.legs.map((leg, i) => legEffectiveLines(leg, i, f));
  const chargees = etat.JOURNEY.legs.map((leg, i) => jambeChargee(leg, i));
  let change = false;
  for (const i of legsToPin(etat.JOURNEY.legs, lignes, commodity, terminal, side, chargees)) {
    if (figerJambe(i, lignes[i])) change = true;
  }
  if (change) { saveJourneyEdits(); saveJourneyPins(); }
}

// Ensemble des commodités transportées au moins une fois sur le parcours (union des manifestes).
export function journeyCarriedCommodities(): Set<string> {
  const set = new Set<string>();
  if (!etat.JOURNEY || !etat.MARKET) return set;
  const f = readFilters();
  etat.JOURNEY.legs.forEach((leg, i) => legEffectiveLines(leg, i, f).forEach((l) => set.add(l.name)));
  return set;
}

/**
 * Le contexte de chargement d'une JAMBE, à la forme que `suggestionsFor` et `manifestRemaining`
 * attendent — la même que celle de la carte d'« En route ».
 *
 * Il vit ici et non dans le module du manifeste parce qu'il est lu par le RENDU du compagnon et par
 * deux de ses actions : c'est de la donnée de parcours, pas de la donnée de carte.
 *
 * `null` sans soute bornée : « SCU libres » n'a alors aucun sens, et les suggestions non plus.
 */
export function legSuggestCtx(leg: Jambe, lines: LigneManifeste[], f: Filtres & { cargo?: number; useCargo?: boolean }): ContexteManifeste | null {
  if (!etat.MARKET || !stationMap.size) return null;
  if (!f.useCargo || !(f.cargo && f.cargo > 0)) return null;
  const originIdx = stationMap.get(stationLabel(leg.from, leg.fromSystem));
  const destIdx = stationMap.get(stationLabel(leg.to, leg.toSystem));
  if (originIdx == null || destIdx == null) return null;
  const ctx = legFeeCtx(leg, f);
  return {
    lines, originIdx, destIdx,
    origin: { name: leg.from, system: leg.fromSystem },
    dest: { name: leg.to, system: leg.toSystem },
    cargo: f.cargo, f, fee: ctx && ctx.pair, // même filtrage des suggestions qu'« En route »
  };
}

/** L'index du terminal où le parcours SE TERMINE — le point d'extension d'un arrêt ou d'une boucle. */
export function journeyEndIndex(): number | null {
  const end = journeyEnd(etat.JOURNEY);
  return end && stationMap.size ? stationMap.get(stationLabel(end.name, end.system)) ?? null : null;
}

/** Les arrêts qu'on pourrait ajouter depuis la fin du parcours, filtres appliqués. */
export function journeyStopSuggestions() {
  const fromIdx = journeyEndIndex();
  return fromIdx == null ? [] : stopSuggestions(etat.MARKET!, fromIdx, readFilters());
}

// ── LA GÉNÉRATION DU COMPAGNON ────────────────────────────────────────────────────────────────
// Même mécanique que la carte de chargement (`manifeste-etat.ts`) : elle remonte les champs SCU
// d'une jambe à chaque RECALCUL, et ne bouge pas pendant qu'on tape. Sans elle, la valeur calculée
// reprendrait la main sous les doigts ; avec elle bougeant à la frappe, le champ perdrait son
// curseur à chaque caractère.
//
// Elle est ICI et non dans `voyage-actions.ts` : un compteur n'est pas une action, et c'est le
// CYCLE de rendu qui l'incrémente. `rendu.ts` peut donc l'atteindre sans importer le module
// d'actions — qui, lui, importe `rendu.ts`.
let generation = 0;

/** Appelée par le cycle de rendu complet, jamais par la frappe dans un champ SCU de jambe. */
export const nouvelleGenerationVoyage = (): void => { generation++; };
export const generationVoyage = (): number => generation;
