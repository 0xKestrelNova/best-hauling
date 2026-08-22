// LA SOUTE : ce qui est à bord, ce qu'on l'a payé, et ce qu'on en fait (ADR-002, ADR-012).
//
// Un lot par chargement — la même commodité peut y figurer deux fois à des prix différents.
// PERSISTÉE ET SANS PÉREMPTION : reprendre le jeu une semaine plus tard avec un vaisseau rangé
// plein, ce n'est pas une soute périmée, c'est une soute exacte. C'est aussi pour ça qu'effacer le
// voyage NE VIDE PAS la soute : le parcours est un plan, la soute est du fret réel.
//
// Trois stores, et leur séparation est un contrat :
//   — la SOUTE, les lots à bord ;
//   — le REGISTRE des chargements : quelle jambe est engagée, et ce qu'elle a pris à quel rayon.
//     La soute se vide par son ✕, par une vente, par la vente implicite du départ — aucun de ces
//     chemins ne rend rien à la station, donc aucun ne décharge la jambe. Le fret peut partir, ce
//     qu'on doit au rayon reste dû ;
//   — les ENTREPÔTS, le fret déposé : ni vendu, ni perdu, du capital immobilisé qu'on peut oublier.
//
// Ces gestes vivaient dans `app.js` faute d'y pouvoir sortir : ils enchaînent une mutation d'état,
// une persistance, un message et un rendu. Le crochet de `rendu.ts` lève le dernier obstacle.

import {
  declarerLot, holdScu, loadHold,
  migrerChargements, migrerRefus, parseStationLabel, poserChargement, refuseHere,
  retirerChargement, sellAllAt, sellFromHold, sellableAt, soldeDuPoint, stationLabel,
  stockApres, storeFromHold, takeFromStore,
} from "./logic.ts";
import { etat, notifier } from "./etat.ts";
import { readFilters } from "./filtres.ts";
import { effVals, setOverride } from "./corrections.ts";
import { updateOvBadge } from "./corrections-actions.ts";
import { fmt } from "./format.ts";
import { findCommodity, stationCourante, stationMap } from "./marche.ts";
import { showToast } from "./messages.ts";
import { rafraichir } from "./rendu.ts";
import {
  figerJambe, legEffectiveLines, legKey, pinLegsForVolume, saveJourneyEdits, saveJourneyPins,
} from "./voyage-donnees.ts";

const nowSec = () => Math.floor(Date.now() / 1000);
const champ = (id) => document.getElementById(id)?.value ?? "";

// Les trois clés de stockage, et le formateur de montant signé des messages.
const HOLD_KEY = "best-hauling-hold";
const CHARGES_KEY = "best-hauling-jambes-chargees";
const DEPOTS_KEY = "best-hauling-depots";
const fmtSigne = (n) => (n >= 0 ? "+" : "") + fmt(Math.round(n));

export function loadSoute() {
  try { etat.SOUTE = JSON.parse(localStorage.getItem(HOLD_KEY)) || []; } catch { etat.SOUTE = []; }
  if (!Array.isArray(etat.SOUTE)) etat.SOUTE = [];
  // Marqueurs de refus hérités d'avant #20 : sans date, ils seraient tenus pour périmés d'un coup
  // et un résidu volontairement gardé pourrait partir à la première étape franchie. On leur donne
  // une fenêtre pleine à partir de maintenant. N'écrit que s'il y avait vraiment à migrer.
  const m = migrerRefus(etat.SOUTE);
  if (m.migres) { etat.SOUTE = m.hold; saveSoute(); }
}

export function loadChargements() {
  try { etat.CHARGEMENTS = JSON.parse(localStorage.getItem(CHARGES_KEY)) || {}; } catch { etat.CHARGEMENTS = {}; }
  if (!etat.CHARGEMENTS || typeof etat.CHARGEMENTS !== "object" || Array.isArray(etat.CHARGEMENTS)) etat.CHARGEMENTS = {};
  const m = migrerChargements(etat.CHARGEMENTS, etat.SOUTE);
  etat.CHARGEMENTS = m.chargements;
  if (m.change) { etat.SOUTE = m.lots; saveSoute(); saveChargements(); }
}

export function pointAchat(nomCommodite, nomTerminal) {
  const c = etat.MARKET && findCommodity(nomCommodite);
  const idx = stationMap.size ? [...stationMap].find(([lab]) => parseStationLabel(lab).name === nomTerminal) : null;
  if (!c || !idx) return null;
  const b = c.buys.find((x) => x[0] === idx[1]);
  if (!b) return null;
  const e = effVals(c.name, nomTerminal, "buy", b[1], b[2], b[3]);
  return { commodite: c.name, stock: e.vol, base: b[3] };
}

export function ecrireStockDuPoint(prise) {
  const p = pointAchat(prise.name, prise.terminal);
  if (!p) return null;
  const s = soldeDuPoint(etat.CHARGEMENTS, prise.name, prise.terminal);
  const ref = s.ref != null ? s.ref : prise.ref;
  setOverride(prise.name, prise.terminal, "buy", "vol", stockApres(ref, s.pris), p.base);
  return { ref, pris: s.pris };
}

export function chargerJambe(i) {
  const leg = etat.JOURNEY && etat.JOURNEY.legs[i];
  if (!leg || !etat.MARKET) return;
  const k = legKey(leg, i);
  if (etat.CHARGEMENTS[k]) {
    // Annulation : on rend au rayon ce que CETTE jambe y a pris, et rien de plus. Les lots peuvent
    // avoir quitté la soute entre-temps (vendus, déposés, débarqués) : c'est le registre, pas eux,
    // qui sait ce qu'on doit.
    const prises = etat.CHARGEMENTS[k];
    etat.CHARGEMENTS = retirerChargement(etat.CHARGEMENTS, k);
    for (const pr of prises) ecrireStockDuPoint(pr);
    etat.SOUTE = etat.SOUTE.filter((l) => l.leg !== k);
    updateOvBadge();
  } else {
    const lignes = legEffectiveLines(leg, i, readFilters());
    if (!lignes.length) return;
    const lots = loadHold([], lignes, leg.from, nowSec()).map((l) => ({ ...l, leg: k }));
    // Charger, c'est vider le rayon d'autant.
    const prises = [];
    for (const l of lots) {
      const p = pointAchat(l.name, l.from);
      if (!p || p.stock == null) continue; // stock inconnu : rien à déduire, la jambe reste chargée
      // La référence est celle qu'une AUTRE jambe a déjà retenue pour ce rayon. Relire le stock
      // effectif ici, ce serait relire notre propre déduction et la compter une seconde fois.
      const s = soldeDuPoint(etat.CHARGEMENTS, l.name, l.from);
      prises.push({ name: l.name, terminal: l.from, ref: s.ref != null ? s.ref : p.stock, units: l.units });
    }
    // LE REGISTRE D'ABORD, le gel ensuite (#48). C'est le registre qui porte « chargée », et c'est
    // lui que consulte désormais pinLegsForVolume : figer avant de l'écrire laissait hors du verrou
    // la jambe qu'on vient précisément de charger — celle dont les SCU sont pourtant les plus sûrs.
    etat.CHARGEMENTS = poserChargement(etat.CHARGEMENTS, k, prises);
    // Cette jambe fige ses SCU : le fret est payé et à bord, c'est un FAIT et plus un plan. On la
    // fige EXPLICITEMENT, et pas seulement par ricochet d'une déduction : un chargement dont aucune
    // commodité n'a de stock publié n'entre dans aucune `prise`, et n'était donc jamais figé.
    if (figerJambe(i, lignes)) { saveJourneyEdits(); saveJourneyPins(); }
    // Les AUTRES jambes déjà chargées qui achètent le même fret au même rayon : la déduction qu'on
    // vient d'écrire ne doit pas les rétrécir non plus. Celles qui ne sont PAS chargées, si — c'est
    // le stock déduit qui est leur bon chiffre.
    for (const pr of prises) pinLegsForVolume(pr.name, pr.terminal, "buy");
    const vides = [];
    for (const pr of prises) {
      const s = ecrireStockDuPoint(pr);
      if (s && s.pris > s.ref) vides.push(pr.name); // la station en annonçait moins qu'on n'en a pris
    }
    etat.SOUTE = etat.SOUTE.concat(lots);
    updateOvBadge();
    if (vides.length) {
      showToast(`✓ Chargé — stock mis à 0 pour ${vides.join(", ")} : la station en annonçait moins que ce que tu as pris`);
    }
  }
  saveSoute(); saveChargements();
  rafraichir();
  rafraichir();
}

export function vendreIci(nom, units, idxFige) {
  const idx = Number.isFinite(idxFige) ? idxFige : stationCourante();
  if (idx == null || !etat.MARKET) return;
  const pt = sellableAt(etat.MARKET, idx, nom, effVals);
  if (!pt) return;
  const avant = etat.SOUTE.reduce((s, l) => s + (l.name === nom ? l.units || 0 : 0), 0);
  const r = sellFromHold(etat.SOUTE, nom, units, pt.price);
  if (!r.vendu) return;
  etat.SOUTE = r.vendu < avant ? refuseHere(r.hold, nom, pt.terminal) : r.hold;
  saveSoute();
  etat.venteEnCours = null;
  rafraichir();
  const reste = avant - r.vendu;
  showToast(`✓ ${fmt(r.vendu)} SCU de ${nom} vendus — ${fmtSigne(r.profit)} aUEC` +
    (reste > 0 ? ` · ${fmt(reste)} SCU restent à bord — le comptoir n'en a pas repris plus` : ""));
}

export function venteImplicite(depuis) {
  if (!etat.SOUTE.length || !etat.MARKET || depuis == null) return;
  const r = sellAllAt(etat.SOUTE, etat.MARKET, depuis, effVals);
  if (!r.ventes.length) return;
  etat.SOUTE = r.hold;
  saveSoute();
  const quoi = r.ventes.map((v) => `${fmt(v.units)} ${v.name}`).join(", ");
  showToast(`✓ Vendu en quittant ${etat.MARKET.terminals[depuis].name} : ${quoi} — ${fmtSigne(r.profit)} aUEC`);
}

export function loadDepots() {
  try { etat.DEPOTS = JSON.parse(localStorage.getItem(DEPOTS_KEY)) || {}; } catch { etat.DEPOTS = {}; }
}

export function deposerIci(nom, units, idxFige) {
  const idx = Number.isFinite(idxFige) ? idxFige : stationCourante();
  if (idx == null || !etat.MARKET) return;
  const t = etat.MARKET.terminals[idx];
  // L'heure du dépôt est fournie ICI : `storeFromHold` est pure et ne lit pas d'horloge. Sans elle,
  // la liste exportée dirait « 170 SCU d'or à Ruin Station » sans dire si c'était hier ou l'an passé.
  const r = storeFromHold(etat.SOUTE, etat.DEPOTS, nom, units, stationLabel(t.name, t.system), nowSec());
  if (r.hold === etat.SOUTE) return;
  etat.SOUTE = r.hold; etat.DEPOTS = r.entrepots;
  saveSoute(); saveDepots();
  etat.venteEnCours = null;
  rafraichir();
  showToast(`⬓ ${fmt(units)} SCU de ${nom} déposés à ${t.name} — ni vendus ni perdus`);
}

export function reprendreIci(station, nom, units) {
  const r = takeFromStore(etat.SOUTE, etat.DEPOTS, nom, units, station);
  if (r.hold === etat.SOUTE) return;
  const repris = holdScu(r.hold) - holdScu(etat.SOUTE); // ce qui est VRAIMENT revenu, pas ce qu'on demandait
  etat.SOUTE = r.hold; etat.DEPOTS = r.entrepots;
  saveSoute(); saveDepots();
  rafraichir();
  showToast(`◈ ${fmt(repris)} SCU de ${nom} repris à ${parseStationLabel(station).name} — de retour en soute`);
}

export function declarerABord() {
  const c = etat.MARKET && findCommodity(champ("holdAddName"));
  if (!c) { showToast("⚠ Commodité inconnue — choisis-la dans la liste (nom ou code UEX)"); return; }
  const units = Math.floor(Number(champ("holdAddScu")) || 0);
  if (units <= 0) { showToast(`⚠ Indique combien de SCU de ${c.name} tu as à bord`); return; }
  const saisi = champ("holdAddPaid").trim();
  const prix = saisi === "" ? 0 : Number(saisi);
  const avant = etat.SOUTE;
  etat.SOUTE = declarerLot(etat.SOUTE, { name: c.name, units, paid: prix }, nowSec());
  if (etat.SOUTE === avant) return; // la fonction pure a refusé : rien à persister
  saveSoute();
  etat.declarationOuverte = false;
  notifier();
  rafraichir();
  showToast(`◈ ${fmt(units)} SCU de ${c.name} déclarés à bord — ` +
    (prix > 0 ? `${fmt(prix)} aUEC/SCU payés` : "butin, coût nul"));
}

export function poserPosition(v) {
  const c = document.getElementById("origin");
  if (c) c.value = v;
  rafraichir();
}

export function saveSoute() { try { localStorage.setItem(HOLD_KEY, JSON.stringify(etat.SOUTE)); } catch {} }

export function saveChargements() { try { localStorage.setItem(CHARGES_KEY, JSON.stringify(etat.CHARGEMENTS)); } catch {} }

export function saveDepots() { try { localStorage.setItem(DEPOTS_KEY, JSON.stringify(etat.DEPOTS)); } catch {} }

export function viderSoute() { etat.SOUTE = []; saveSoute(); rafraichir(); }

export function retirerLot(i) { etat.SOUTE = etat.SOUTE.filter((_, j) => j !== i); saveSoute(); rafraichir(); }




