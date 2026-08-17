// LES GESTES DU COMPAGNON DE VOYAGE (ADR-012).
//
// `voyage-donnees.ts` porte la DONNÉE du parcours — manifestes de jambe, intentions persistées,
// gel — et s'interdit de toucher au cycle de rendu. `voyage-actions.ts` porte les deux gestes dont
// les VUES ont besoin (`pickJourney`, `syncViewsToJourney`) et la génération de la carte.
//
// Ce module-ci porte les seize autres : démarrer un voyage, avancer d'une étape, ajouter ou retirer
// un arrêt, déplier une jambe, ajuster ses SCU, la remettre à l'optimal. Ils ne sont appelés que
// par des délégations d'`app.js` — d'où un fichier à part plutôt qu'un ajout à `voyage-actions.ts`,
// que les vues importent.

import {
  addableUnits, bestLegBetween, bestManifest, detacherLotsDeJambe, freeManifestLine,
  legFromManifest, manifestIntent, manifestJourneyState, reindexerRangsJambe,
  removeJourneyStop as removeStopPure, sameIntent, setJourneyPosition, startJourneyAt,
  stationLabel,
} from "./logic.ts";
import { flushSync } from "react-dom";
import { etat, notifier } from "./etat.ts";
import { readFilters } from "./filtres.ts";
import { effVals } from "./corrections.ts";
import { withMarket } from "./donnees.ts";
import { feeResolver } from "./frais.ts";
import { findCommodity, resolveStationLabel, stationCourante, stationMap } from "./marche.ts";
import { manifesteCourant, manifestRemaining, suggestionsFor } from "./manifeste-donnees.ts";
import { rafraichir } from "./rendu.ts";
import { saveChargements, saveSoute, venteImplicite } from "./soute-actions.js";
import {
  journeyEndIndex, legEffectiveLines, legIntent, legKey, legSuggestCtx, legTerminals,
  saveJourneyEdits, saveJourneyPins,
} from "./voyage-donnees.ts";
import { pickJourney, syncViewsToJourney } from "./voyage-actions.ts";

// Le chargement courant de la carte « En route », dérivé à la demande (cf. manifeste-donnees.ts).
const chargementCourant = () => { const r = manifesteCourant(readFilters()); return r.etat === "ok" ? r.m : null; };

export function setJourneyStop(i) {
  if (!etat.JOURNEY || !Number.isFinite(i)) return;
  // AVANCER sous-entend qu'on a fait son affaire à l'escale qu'on quitte : ce qu'elle reprend part.
  // Reculer, non — on ne revend pas en revenant sur ses pas.
  if (i > etat.JOURNEY.current) venteImplicite(stationCourante());
  etat.JOURNEY = setJourneyPosition(etat.JOURNEY, i);
  syncViewsToJourney();
  rafraichir();
}

export function clearJourney() {
  etat.JOURNEY = null;
  // Sans cette purge, les manifestes édités survivaient à l'effacement du voyage et ressortaient
  // sur un parcours ULTÉRIEUR passant par les mêmes terminaux, badge ✎ compris.
  etat.JOURNEY_EDITS = {}; saveJourneyEdits();
  etat.JOURNEY_PINS = {}; saveJourneyPins();
  // Troisième porteur du rang : l'étiquette posée sur les lots. Le fret, lui, RESTE à bord — le
  // parcours est un plan, la soute est du fret payé (ADR-002). Sans ce détachement, un voyage
  // ultérieur dont la jambe 0 relie les deux mêmes terminaux s'affichait « ⬢ à bord », et le clic
  // déchargeait les lots de l'ancien voyage en restaurant leurs stocks.
  etat.SOUTE = detacherLotsDeJambe(etat.SOUTE); saveSoute();
  // Quatrième porteur du rang : le registre des chargements. Plus aucune jambe n'existe, donc plus
  // rien à décharger — les déductions déjà posées sur les rayons, elles, restent : le fret est bien
  // parti avec. Comme pour les lots qu'on vient de délier, elles ne sont simplement plus annulables.
  etat.CHARGEMENTS = {}; saveChargements();
  etat.journeyExpandedLeg = -1;
  rafraichir();
  // Comme tous les autres mutateurs du parcours : la carte Voyage n'est pas la seule à lire JOURNEY.
  // Les Boucles hissent en tête celles qui partent de la fin du parcours (.from-here) et le board
  // Commodités marque d'un ◆ ce qu'on transporte — sans ce rendu, les deux gardaient l'état d'AVANT
  // l'effacement jusqu'au geste suivant. `refresh` finit par `saveState`, inutile de le doubler.
  rafraichir();
}

export function manifestToJourney() {
  const m = chargementCourant();
  if (!m || !m.lines.length || !etat.MARKET) return;
  if (manifestJourneyState(etat.JOURNEY, m.origin, m.dest).etat !== "ajouter") return;
  const intent = manifestIntent(m.lines);
  pickJourney([legFromManifest(m)], () => {
    const i = etat.JOURNEY.legs.length - 1;
    const k = legKey(etat.JOURNEY.legs[i], i);
    // Ce que legManifest recalculera pour cette jambe. Si le chargement affiché EST celui-là, on ne
    // persiste rien : la jambe reste branchée sur le marché et sur les filtres, et ne porte pas le
    // badge ✎ à tort. On impose l'état de la clé dans les DEUX sens, pour qu'une édition laissée
    // par un voyage abandonné au même rang et au même couple de stations ne vienne pas contredire
    // le chargement qu'on envoie.
    const opt = bestManifest(etat.MARKET, m.originIdx, "", m.f, effVals, m.destIdx, feeResolver(m.f));
    if (sameIntent(intent, manifestIntent(opt ? opt.lines : []))) delete etat.JOURNEY_EDITS[k];
    else etat.JOURNEY_EDITS[k] = intent;
    saveJourneyEdits();
  });
}

export function toggleLegEditor(i) {
  etat.journeyExpandedLeg = etat.journeyExpandedLeg === i ? -1 : i;
  // SYNCHRONE : l'arbre réécrit tout le compagnon, donc l'en-tête qu'on vient d'activer
  // n'existe plus quand on veut lui rendre le focus. Différé, le `?.` court-circuite.
  flushSync(rafraichir);
  // Le compagnon réécrit : l'en-tête qu'on vient d'activer n'existe plus et le
  // focus retombe sur <body>. À la souris ça ne se voit pas ; au clavier on perdait sa place, la
  // deuxième Entrée (replier) ne partait plus de nulle part et Tab reprenait au début du document.
  document.getElementById("journeyCard")?.querySelector(`.jleg-head[data-leg="${i}"]`)?.focus();
}

export function editLegQty(i, li, val) {
  // Le voyage peut avoir été effacé entre le focus et le blur (cliquer ✕ blure d'abord le champ) :
  // sans cette garde, l'édition en vol était réécrite APRÈS la purge et ressuscitait toute seule.
  if (!etat.JOURNEY || !etat.JOURNEY.legs[i]) return;
  const intent = legIntent(etat.JOURNEY.legs[i], i, readFilters());
  if (intent[li]) { const u = Math.floor(Number(val)); intent[li].units = Number.isFinite(u) && u > 0 ? u : 0; }
  saveJourneyEdits();
  // Ce handler part sur `change`, donc au BLUR — or le blur précède le mouseup d'un clic en cours.
  // Re-rendre tout de suite détruirait le nœud visé et avalerait ce clic (impossible d'effacer le
  // voyage ou de replier une jambe du premier coup). On laisse le tour d'événement se terminer.
  setTimeout(rafraichir, 0);
}

export function liveLegQty(i, li, inp) {
  if (!etat.JOURNEY || !etat.JOURNEY.legs[i]) return; // le parcours a pu disparaître sous la saisie
  const intent = legIntent(etat.JOURNEY.legs[i], i, readFilters());
  if (!intent[li]) return;
  const u = Math.floor(Number(inp.value));
  intent[li].units = Number.isFinite(u) && u > 0 ? u : 0;
  notifier(); // la frappe ne bouge PAS la génération : le champ garde son nœud et son curseur
}

export function addLegSuggestion(i, name) {
  const leg = etat.JOURNEY.legs[i];
  const f = readFilters();
  const ctx = legSuggestCtx(leg, legEffectiveLines(leg, i, f), f);
  if (!ctx) return;
  const it = suggestionsFor(ctx).find((x) => x.name === name);
  if (!it) return;
  const u = addableUnits(it, manifestRemaining(ctx));
  if (u <= 0) return;
  legIntent(leg, i, f).push({ name: it.name, units: u });
  saveJourneyEdits(); rafraichir();
}

export function delLegLine(i, name) {
  const leg = etat.JOURNEY.legs[i];
  etat.JOURNEY_EDITS[legKey(leg, i)] = legIntent(leg, i, readFilters()).filter((e) => e.name !== name);
  saveJourneyEdits(); rafraichir();
}

export function resetLeg(i) {
  const k = legKey(etat.JOURNEY.legs[i], i);
  delete etat.JOURNEY_EDITS[k]; delete etat.JOURNEY_PINS[k];
  saveJourneyEdits(); saveJourneyPins(); rafraichir();
}

export function addLegLine(i, name) {
  const leg = etat.JOURNEY.legs[i];
  const c = findCommodity(name);
  const t = legTerminals(leg);
  if (!c || !t || !etat.MARKET) return;
  const f = readFilters();
  // Le doublon se teste AVANT de matérialiser l'intention : sinon un ajout refusé basculait quand
  // même la jambe en « éditée » (badge ✎, bouton « ↺ optimal »), et elle cessait silencieusement
  // de suivre les prix UEX et les filtres alors que rien n'avait été ajouté.
  if (legEffectiveLines(leg, i, f).some((l) => l.name === c.name)) return;
  const ctx = legSuggestCtx(leg, legEffectiveLines(leg, i, f), f); // null si soute non bornée -> 1 SCU
  const ligne = freeManifestLine(etat.MARKET, t.fromIdx, t.toIdx, c, ctx ? manifestRemaining(ctx).cargoLeft : NaN, effVals);
  legIntent(leg, i, f).push({ name: c.name, units: ligne.units });
  saveJourneyEdits(); rafraichir();
}

export function bestLegTo(fromIdx, toIdx) {
  if (fromIdx == null || toIdx == null) return null;
  return bestLegBetween(etat.MARKET, fromIdx, toIdx, readFilters());
}

export function emptyLeg(fromIdx, toIdx) {
  if (fromIdx == null || toIdx == null) return null;
  const ft = etat.MARKET.terminals[fromIdx], tt = etat.MARKET.terminals[toIdx];
  return { from: ft.name, fromSystem: ft.system, to: tt.name, toSystem: tt.system, commodity: "", buyPrice: 0, sellPrice: 0, margin: 0 };
}

export function addStopByTerminal(label) {
  const fromIdx = journeyEndIndex();
  const toIdx = resolveStationLabel(label);
  if (fromIdx == null || toIdx == null) return; // terminal inconnu / parcours vide
  // Jambe optimale s'il y a du fret rentable, sinon jambe « à vide » (on l'ajoute quand même).
  pickJourney([bestLegTo(fromIdx, toIdx) || emptyLeg(fromIdx, toIdx)]);
}

export function beginJourney(label) {
  const v = (label || "").trim();
  if (!v) return;
  if (!stationMap.size) { withMarket(() => beginJourney(v)); return; } // marché requis pour résoudre
  const startIdx = resolveStationLabel(v);
  if (startIdx == null) return; // terminal inconnu
  const t = etat.MARKET.terminals[startIdx];
  etat.JOURNEY = startJourneyAt({ name: t.name, system: t.system });
  syncViewsToJourney();
  rafraichir();
}

export function reindexerApresRetrait(retrait) {
  const r = reindexerRangsJambe({ edits: etat.JOURNEY_EDITS, pins: etat.JOURNEY_PINS, lots: etat.SOUTE, chargements: etat.CHARGEMENTS }, retrait);
  etat.JOURNEY_EDITS = r.edits; etat.JOURNEY_PINS = r.pins; etat.SOUTE = r.lots; etat.CHARGEMENTS = r.chargements;
  if (etat.journeyExpandedLeg >= retrait.removedFrom) etat.journeyExpandedLeg = -1; // le panneau déplié n'existe plus
  saveJourneyEdits(); saveJourneyPins(); saveSoute(); saveChargements();
}

export function removeJourneyStop(stopIndex) {
  if (!etat.JOURNEY) return;
  const legs = etat.JOURNEY.legs;
  let bridge = null;
  if (stopIndex > 0 && stopIndex < legs.length) {
    // Arrêt du milieu : on reconnecte stations[i-1] -> stations[i+1].
    const prev = legs[stopIndex - 1], next = legs[stopIndex];
    const fromIdx = stationMap.get(stationLabel(prev.from, prev.fromSystem));
    const toIdx = stationMap.get(stationLabel(next.to, next.toSystem));
    bridge = bestLegTo(fromIdx, toIdx) || // aucun fret rentable A->C : jambe « à vide », contiguïté préservée
      { from: prev.from, fromSystem: prev.fromSystem, to: next.to, toSystem: next.toSystem, commodity: "", buyPrice: 0, sellPrice: 0, margin: 0 };
  }
  const r = removeStopPure(etat.JOURNEY, stopIndex, bridge);
  if (!r) { clearJourney(); return; }
  reindexerApresRetrait(r);
  // `start` n'est présent que sur le parcours réduit à un seul arrêt : le reporter tel quel, sinon
  // la station survivante n'a plus rien pour se décrire (journeyStations la lit là) et le voyage
  // s'affiche vide alors qu'il reste un point de départ.
  etat.JOURNEY = r.start ? { legs: [], current: 0, start: r.start } : { legs: r.legs, current: r.current };
  syncViewsToJourney();
  rafraichir();
}
