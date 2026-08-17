"use strict";

// Fonctions de calcul pures (testées par logic.test.mjs).
import {
  tripMinutes, ageDays, lineFreshUpdated, pairAge,
  scoreBarWidth, bySort, addableUnits, scuBoxes, cargoBoxes,
  kFromReading, kPlausible,
  ovKey, groupOverridesByTerminal, safeKey, encodeState, decodeState,
  routePasses,
  routeMetrics, enRouteDeals, bestManifest, suggestionsFrom, netMarginRoi,
  commoditySummaries, commodityPoints, compactValue, palierMarge, valueTiers, resolveCommodity, ambiguousCodes,
  manifestTotals, freeAddUnits, manifestLine, freeManifestLine, hydrateManifestLine, stationLabel, parseStationLabel, stationTree,
  multiTrips, tripMetrics, legFromTrip,
  legFromRoute, legFromManifest, stopSuggestions, bestLegBetween,
  manifestJourneyState, manifestIntent, sameIntent, manifestIntentSurvives, journeyMap,
  loadHold, declarerLot, holdScu, freeCargo, holdByCommodity, sellFromHold, refuseHere, refusActif, migrerRefus, sellableAt, sellAllAt,
  offloadPlan, tourneesEcoulement, storeFromHold, takeFromStore, stockApres,
  startJourney, startJourneyAt, journeyStations, journeyEnd,
  journeyConnects, setJourneyPosition, journeyMargin,
  removeJourneyStop as removeStopPure,
  reindexerRangsJambe, detacherLotsDeJambe,
  soldeDuPoint, poserChargement, retirerChargement, migrerChargements,
  encodeJourney, decodeJourney,
  migrerCorrections, exporterCorrections, exporterEntrepots,
} from "./logic.ts";
// Le premier îlot React (ADR-008, #96). `peindre` remplace `innerHTML` sur le conteneur de la
// Tournée, et RIEN d'autre ne change : app.js reste le seul écrivain de l'état, refresh() reste
// l'unique notification. Voir pont.js pour pourquoi il n'y a ni magasin ni abonnement.
import { peindre } from "./pont.js";
import { etat, notifier } from "./etat.ts";
import { fmt, fmtVol, fmtFee, scuBoxesLabel, signe, TEXTE_CAPACITE_INCONNUE } from "./format.ts";
import { readFilters } from "./filtres.ts";
import { effVals, isOv, loadOverrides, ovCount, resetOverrides, saveOverrides, setOverride } from "./corrections.ts";
import { corriger, notifySuperseded, updateOvBadge } from "./corrections-actions.ts";
import { showToast } from "./messages.ts";
import { construireIndex, findCommodity, indexOrigine, indexStationExacte, libellesOrigines, libellesStations, resolveStationLabel, stationCourante, stationMap, termByName } from "./marche.ts";
import { alKey, feeCargoText, feeCell, feeCtx, feeEndText, feeLoadText, feeResolver, globalK, kFmt, lineProfitText, loadAutoloadK, saveAutoloadK } from "./frais.ts";
import { applyState, loadState, saveState, shareURL } from "./persistance.ts";
import { brancher, ensureFeeMarket, ensureStarmap, withMarket } from "./donnees.ts";
import { brancherRendu } from "./rendu.ts";
import { propsLignesSimples, propsTrajetsCommunes } from "./vues/trajets-props.tsx";
import { evaluate } from "./vues/trajets-vue.tsx";
import { pickJourney, syncViewsToJourney } from "./voyage-actions.ts";
import { monterRacine } from "./main.tsx";
import { planData, planHypotheses } from "./vues/plan-vue.tsx";
import { figerJambe, jambeChargee, journeyCarriedCommodities, legEffectiveLines, legFeeCtx, legIntent, legKey, legManifest, legTerminals, loadJourneyEdits, loadJourneyPins, pinLegsForVolume, saveJourneyEdits, saveJourneyPins } from "./voyage-donnees.ts";
// (`vues/tournee.tsx` et `vues/plan.tsx` ne sont plus importés ici : leurs vues vivent dans l'arbre
// depuis #143 et #145, et seuls leurs composants de DÉCISION les consomment désormais.)
// La vue Commodités n'expose plus sa présentation à app.js — seulement ses trois ACTIONS, comme
// `plan-vue.tsx` expose `planData`. Les écouteurs de `#commSortModes` / `#commBoardModes` restent
// ici : leurs conteneurs sont du markup d'index.html (ADR-012 §2).
import { refletBoardCommodites, setCommBoard, setCommSort } from "./vues/commodites-vue.tsx";
import { vueTrajets } from "./vues/trajets.tsx";
import { carteManifeste, indiceSouteInactive, indiceSoutePleine, indiceAucunChargement } from "./vues/manifeste.tsx";
import { carteSoute, carteEntrepots } from "./vues/soute.tsx";
import { carteVoyage, recapVoyage, inviteVoyage } from "./vues/voyage.tsx";
import { carteParcours } from "./vues/carte.tsx";
import { carteDeclaration } from "./vues/declaration.tsx";
import { BUY_STATUS, KIND_ICON, SELL_STATUS } from "./vues/communs.tsx";

// Libellé compact des caisses SCU standard, ex. « 8×32 · 1×16 · 1×4 · 1×2 · 1×1 ».
// `maxBox` = plafond de caisse du terminal de CHARGEMENT, quand on le connaît : c'est une propriété
// physique de la station, indépendante de l'interrupteur de frais. On le propage partout où le
// terminal d'achat est disponible, parce que c'est exactement la décomposition que la facture
// d'autoload utilise — un « 📦 1×32 » à côté d'un montant calculé sur deux caisses de 16 serait
// une incohérence directement visible.

// Même libellé pour un chargement à plusieurs commodités : une caisse ne contient qu'une commodité,
// la décomposition se fait donc ligne par ligne (cargoBoxes) et jamais sur le total des SCU.

// État global
// Tri par défaut : le PROFIT NET par voyage (ADR-005). Le score composite classait mal — la route
// la plus rentable de l'instantané tombait au 8e rang — et le profit horaire repose sur une durée
// fictive pour 49 % des routes, faute de distance. Un montant, lui, ne ment pas.
// Les CINQ caches de rendu du board Commodités — `shownCommodities`, `commTiers`, `commDupCodes`,
// `commMaxMargin`, `commCarried` — sont devenus des variables locales de `vues/commodites-vue.tsx`.
// Ils n'existaient que parce qu'une fonction calculait et que trois autres peignaient ; un composant
// qui fait les deux dans la même passe n'en a pas besoin. Aucun n'avait de lecteur hors de la vue.
// Compagnon de voyage : parcours sélectionné { legs[], current } ou null.
// Affiche la carte du vaisseau correspondant au champ (défini par loadShips ; utilisé à la restauration).
let showShipCard = () => {};


const $ = (id) => document.getElementById(id);
// Volume dont le null veut dire « capacité non communiquée par UEX » et non « zéro » :
// `scu_sell` n'est renseigné que sur une minorité de points de vente. Un « — » s'y lisait
// « aucune demande » alors qu'aucun plafond n'est appliqué dans ce cas — d'où « n.c. ».

// Échappe toute chaîne insérée dans innerHTML. Les données UEX sont communautaires
// (nicknames de terminaux, etc. potentiellement soumis par des utilisateurs) : on les
// traite comme non fiables pour éviter toute injection HTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Formatte le nom d'un système en badge coloré.
function sysBadge(system) {
  const cls = esc(system.toLowerCase());
  return `<span class="sys ${cls}">${esc(system)}</span>`;
}

// L'icône de commodité et le marqueur « illégal » sont rendus par `IconeCommodite` et `TagIllegal`
// (vues/communs.tsx). Leurs versions en chaîne ont disparu avec `multiCargoHTML`, leur dernier
// appelant. `KIND_ICON` reste importé : la table d'emoji n'a qu'une source.

// ---------- Fiabilité : fraîcheur, statut de stock, aberrations ----------
// (ageDays/pairAge et les calculs de temps/score viennent de logic.mjs)
// Fraîcheur d'une ligne de manifeste = le plus ancien des relevés achat/vente (ou l'un des deux).


// `BUY_STATUS` et `SELL_STATUS` sont passées dans `vues/communs.tsx`, à côté de la pastille qui les
// lit : app.js ne faisait que les repasser en props à deux vues.

// ---------- Corrections locales (prix & stock) ----------
// L'utilisateur peut corriger un prix ou un volume (stock à l'achat / demande à la vente)
// quand le relevé UEX est faux. Stocké UNIQUEMENT en local (localStorage), jamais partagé
// ni dans l'URL. Clé : « commodité|terminal|side » (side = "buy" | "vol"… non : "buy"/"sell").
const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- Frais d'autoload : tarif par station + contexte de calcul ----------
// Le calcul est PUR et vit dans logic.mjs (autoloadFee / autoloadPoint / haulFee). app.js n'y
// apporte que ce que logic.mjs ne peut pas deviner sans lire une globale : quel terminal porte
// quel nom, et combien CETTE station facture. Deux résolutions, donc :
//   - nom de terminal -> terminal de market.json, parce que routes.json et loops.json (vues
//     « Trajets » et « Boucles ») ne portent que des noms ;
//   - terminal -> coefficient `k`, relevé par l'utilisateur ou valeur globale par défaut.
// `showToast` est passée dans `messages.ts`, `notifySuperseded` dans `corrections-actions.ts` :
// toutes deux doivent être appelables depuis une vue de l'arbre (ADR-012).

// Applique les corrections à une paire buy/sell et renvoie des copies patchées + marge/roi.


// Calcule les champs dérivés d'une route selon les entrées utilisateur : applique les corrections
// locales (impur, globales OVERRIDES) puis délègue le calcul pur à routeMetrics (logic.mjs).


// Cellule de FIABILITÉ : mini-barre + valeur, de 10 à 100 (ADR-005). Ce n'est plus un classement
// mais ce qu'on sait de la donnée — fraîcheur du relevé × part de volume publiée. Elle ne trie plus
// par défaut : c'est le profit net qui le fait. `scoreBarWidth` borne le dessin par ceinture (#39),
// même si la fiabilité ne peut plus sortir de [0, 100] par construction.
//
// NE PAS SUPPRIMER, malgré l'absence d'appelant : le rendu vit dans `CelluleFiabilite`
// (vues/communs.tsx), mais `logic.test.mjs:117` lit CE fichier comme du TEXTE et cherche
// `function fiabiliteCell(` pour vérifier que la largeur passe bien par `scoreBarWidth`. La retirer
// fait tomber un test unitaire, et l'ancre est délibérée — c'est le seul moyen qu'a un test de
// `node --test` de garder une règle qui vit dans app.js.
function fiabiliteCell(f, age, part) {
  const tier = f >= 70 ? "s-good" : f >= 40 ? "s-ok" : "s-low";
  const quoi = age == null ? "date du relevé inconnue" : `relevé vieux de ${Math.round(age)} j`;
  const titre = `Fiabilité ${f}/100 — ${quoi}, ${Math.round(part * 100)} % du volume publié par UEX. N'entre pas dans le tri.`;
  return `<div class="score-cell" title="${esc(titre)}"><span class="scorebar ${tier}"><i style="width:${scoreBarWidth(f)}%"></i></span><b>${f}</b></div>`;
}

// La valeur éditable est rendue par `ValeurEditable` (vues/communs.tsx). `editv()` fabriquait le
// même span en chaîne pour les vues restées impératives ; la dernière — le manifeste — est passée
// à React, donc plus personne ne l'appelait. `e2e/edition.pw.mjs` vérifie qu'aucun `.editv` de
// l'application n'échappe à React, ce qui est la condition de cette suppression.

// Lit l'état de tous les contrôles de filtre (partagé par les deux vues).


// Message de #empty tel qu'il est écrit dans index.html. Le <p> est PARTAGÉ par les vues Trajets /
// Boucles / En route, et « En route » comme le mode multi-commodité réécrivent son texte : sans
// remise à zéro en tête de rendu, un état vide légitime affichait le message d'une AUTRE vue.

// Ce que les deux modes de Trajets partagent. app.js garde l'ÉTAT — les frais dépendent de
// l'interrupteur d'autoload et des relevés par station, l'écriture d'une correction doit figer les
// jambes déjà planifiées, et `#empty` reste écrit ici (il est partagé par trois vues).


// Ce qui se calcule LIGNE PAR LIGNE, et qui vaut pour les deux tables à lignes simples : « Trajets »
// (`#rows`) et « En route » (`#enrouteRows`). Elles ont toujours partagé leur rendu — c'était la
// fonction `routeRowHTML`, appelée des deux endroits. L'îlot React la remplace, donc il doit servir
// les deux appelants : ne peindre que `#rows` laisserait « En route » sans lignes.




// ---------- Vue « Trajets » en mode MULTI-COMMODITÉ ----------
// Même tableau, mais chaque ligne est un chargement A->B composé de PLUSIEURS commodités
// (remplissage par marge décroissante, plafonné par stock/demande et budget).


// Le chargement déplié d'un trajet multi est rendu par `ChargementDeplie` (vues/trajets.tsx), avec
// l'état d'ouverture — `multiCargoHTML` y a disparu, et `commodityIcon`/`illegalTag` avec lui : ils
// n'avaient pas d'autre appelant.

// Ligne de tableau pour une route évaluée (partagée par « Trajets simples » et « En route »).
// `routeRowHTML` a été remplacé par vues/trajets.tsx, pour `#rows` ET `#enrouteRows`.






// ---------- Mode « En route » (trajet dirigé) + manifeste multi-commodité ----------
let enrouteReady = false;     // datalist/destSystem peuplés une seule fois
// Nom de terminal -> terminal de market.json. Pont indispensable aux frais d'autoload : routes.json
// et loops.json ne portent QUE des noms, et les noms sont déjà la clé métier du dépôt (corrections
// locales, jambes de voyage). Peuplée en même temps que stationMap.
// La dernière station RENDUE. Elle ne sert QU'au garde du champ #station — ne pas re-rendre si la
// station résolue n'a pas changé, sans quoi le rendu différé du debounce détache l'éditeur d'un
// chiffre ouvert entre les deux (même famille que #24). Ce n'est donc PAS la station affichée :
// celle-là se dérive à chaque lecture par `indexStationExacte()`.
//
// `undefined` et non `null` : `null` est une valeur mesurée (« le champ ne désigne rien »), et les
// confondre rendrait la première transition « restaurée par permalien → champ rendu illisible »
// invisible au garde — le panneau resterait sur l'ancienne station à côté d'un champ vide.
let derniereStation;
const memoriserStation = () => { derniereStation = indexStationExacte(); };

// Charge le graphe de marché à la demande. Deux règles, apprises à la dure :
//   - on mémorise la PROMESSE en vol, pas seulement son résultat : sinon chaque frappe pendant le
//     chargement relançait un fetch complet de market.json (4 requêtes concurrentes mesurées) ;
//   - on ne mémorise JAMAIS l'échec. Un marché vide mis en cache verrouillait « En route »,
//     « Chaîne », « Commodités » et « Corrections » pour TOUTE la session — autocomplétion vide,
//     0 tuile, « aucune chaîne rentable » — sans le moindre message, et seul un rechargement
//     complet réparait. L'erreur remonte donc aux appelants, et l'action suivante réessaie.
// Prévient que le marché est indisponible plutôt que de laisser la vue vide ET muette.
const marketUnavailable = () => showToast("⚠ Marché indisponible — vérifie ta connexion, puis réessaie");

// Peuple la liste des terminaux de départ (ceux où l'on peut acheter). Idempotent.
function setupEnRoute() {
  if (enrouteReady) return;
  // Les trois index viennent de `marche.ts` ; ici on ne fait plus que peindre les listes.
  construireIndex(etat.MARKET);
  $("originList").innerHTML = libellesOrigines().map((l) => `<option value="${esc(l)}"></option>`).join("");
  // Datalist de TOUTES les stations (achat ou vente) pour la vue Corrections.
  $("stationList").innerHTML = libellesStations().map((l) => `<option value="${esc(l)}"></option>`).join("");

  // Datalist de TOUTES les commodités (pour l'ajout libre au manifeste).
  $("commodityList").innerHTML = etat.MARKET.commodities
    .map((c) => `<option value="${esc(c.name)}">${esc(c.code || "")}</option>`).join("");

  monteStationPicker();

  enrouteReady = true;
}

// Sélecteur de station de la vue Corrections : les 114 terminaux rangés système › zone › station
// (ADR-003). Monté une seule fois, depuis setupEnRoute, car il lui faut MARKET.
function monteStationPicker() {
  const input = $("station"), list = $("stationPickList");
  if (!input || !list) return;
  // On aplatit l'arbre : le filtre et la navigation travaillent sur une liste PLATE déjà triée,
  // et c'est sa contiguïté par (système, zone) qui permet au rendu de reposer un en-tête au simple
  // changement de clé. Filtrer l'arbre lui-même casserait cette propriété.
  const plates = stationTree(etat.MARKET.terminals).flatMap((s) => s.zones.flatMap((z) => z.stations));

  // Un `<img onerror>` posé par innerHTML est INERTE sous `script-src 'self'` (index.html:23) et
  // laisserait une image cassée. Les événements `error` ne remontent pas, mais ils descendent :
  // un seul écouteur en phase de CAPTURE, posé une fois, couvre tous les rendus à venir.
  list.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG") e.target.closest("li")?.classList.add("no-shot");
  }, true);

  montePicker({
    input, list,
    options: () => plates,
    // Nom ET code : taper « PYROG » remonte les deux passerelles homonymes, que le badge distingue.
    filtre: (s, q) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    max: 0, // 114 lignes tiennent : plafonner masquerait des stations sans le dire
    rendu: (m) => {
      let grp = "", html = "";
      m.forEach((s, i) => {
        const cle = `${s.system} › ${s.zone}`;
        // En-tête SANS data-i : ni sélectionnable au clavier, ni cliquable.
        if (cle !== grp) { grp = cle; html += `<li role="presentation" class="opt-grp">${sysBadge(s.system)}<span>${esc(s.zone)}</span></li>`; }
        html += `<li role="option" data-i="${i}">${vignetteStation(s)}` +
          `<span class="stn-opt-name">${esc(s.name)}</span>` +
          `<span class="stn-opt-code">${esc(s.code)}</span>` +
          (s.outpost ? '<span class="stn-opt-post" title="Avant-poste : élévateur de fret parfois en panne">⚠ avant-poste</span>' : "") +
          `</li>`;
      });
      return html;
    },
    // Écrit le LIBELLÉ CANONIQUE, jamais le nom seul : `indexStationExacte` résout par
    // correspondance exacte via stationMap, et c'est cette même chaîne que le permalien transporte.
    choisir: (s) => { input.value = s.label; memoriserStation(); refresh(); saveState(); },
  });
}

// Vignette d'une station : la photo UEX si elle existe, sinon un carré teinté par système portant
// le code. 17 terminaux sur 114 n'ont pas de photo — la vignette générée évite le trou, sans
// requête. Le filtre `^https://` est délibéré même si aucune URL non-https n'existe aujourd'hui :
// l'attribut est interpolé dans du HTML, et c'est justement parce qu'aucune donnée ne le déclenche
// qu'aucun test ne l'attraperait s'il manquait.
function vignetteStation(s) {
  // La photo se pose EN ABSOLU par-dessus le repli, dans un conteneur commun. La superposer à coups
  // de marge négative les décalait de la valeur du `gap` flex, et le code débordait derrière la
  // photo (« TA » derrière celle de Nyx Gateway (Stanton), dont le code est NYXSTA).
  const photo = s.shot && /^https:\/\//i.test(s.shot)
    ? `<img class="stn-shot" src="${esc(s.shot)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  return `<span class="stn-vign sys-${esc((s.system || "").toLowerCase())}">` +
    `<span class="stn-shot-gen">${esc(s.code)}</span>${photo}</span>`;
}

// Résout le terminal de départ depuis le texte du champ (libellé exact).

// Résout le terminal d'ARRIVÉE forcé (En route) depuis le champ (libellé exact), ou null.
let enrouteDest = null;
function resolveDest() {
  const v = $("destTerminal").value.trim();
  enrouteDest = stationMap.has(v) ? stationMap.get(v) : null;
}

// dealFrom / enRouteDeals / bestManifest / buildChainAdjacency vivent dans logic.mjs (fonctions
// pures) ; on leur passe MARKET et le résolveur de corrections effVals depuis les vues.

let currentManifest = null; // manifeste courant, mutable (édition SCU + suggestions ajoutées)

// ---------- Le chargement qu'on COMPOSE à la main (#19) ----------
// Lignes ajoutées, SCU ramenés à ce qu'on veut vraiment acheter : cette intention n'existait que
// dans `currentManifest`, que renderManifest remet à null à chaque rendu. Un prix corrigé, une
// frappe dans la recherche ou un vaisseau changé l'effaçaient sans un mot. Elle se persiste donc
// comme le manifeste d'une jambe de voyage, et SOUS LA MÊME FORME : l'INTENTION seule —
// [{ name, units }] — jamais un instantané de marché, dont les prix se figeraient au jour de
// l'édition (cf. hydrateManifestLine). Le couple de terminaux l'accompagne : c'est de LEURS prix
// que ses lignes sont relues, et une composition ne vaut que pour la route qu'on composait.
// Une seule à la fois, là où JOURNEY_EDITS en indexe une par jambe : la carte n'en montre qu'une, et
// une composition rangée sous un couple qu'on ne regarde plus ressortirait des jours plus tard sans
// qu'on l'ait demandée. Le système est stocké avec le nom — deux terminaux peuvent porter le même
// nom dans deux systèmes, et les lignes se relisent par INDEX de terminal.
const MANIFEST_EDIT_KEY = "best-hauling-manifest-edit";
function loadManifestEdit() {
  try { etat.MANIFEST_EDIT = JSON.parse(localStorage.getItem(MANIFEST_EDIT_KEY)) || null; } catch { etat.MANIFEST_EDIT = null; }
  if (!etat.MANIFEST_EDIT || !Array.isArray(etat.MANIFEST_EDIT.lines)) etat.MANIFEST_EDIT = null;
}
function saveManifestEdit() {
  try {
    if (etat.MANIFEST_EDIT) localStorage.setItem(MANIFEST_EDIT_KEY, JSON.stringify(etat.MANIFEST_EDIT));
    else localStorage.removeItem(MANIFEST_EDIT_KEY);
  } catch {}
}
// Retient ce qui est à l'écran comme intention. Appelée par CHAQUE geste de composition — ajout
// suggéré, ajout libre, retrait, SCU ajustés — parce que c'est le geste qui fait la composition,
// pas son résultat : deux gestes qui se compensent laissent quand même une carte à soi.
function retenirManifeste() {
  const m = currentManifest;
  if (!m) return;
  etat.MANIFEST_EDIT = {
    from: m.origin.name, fromSystem: m.origin.system,
    to: m.dest.name, toSystem: m.dest.system,
    lines: manifestIntent(m.lines),
  };
  saveManifestEdit();
}
function oublierManifeste() { etat.MANIFEST_EDIT = null; saveManifestEdit(); }
// « ↺ optimal » : la carte redevient un calcul, et se remet à suivre le marché et les filtres.
function resetManifeste() { oublierManifeste(); refresh(); }

// La marque et le contrôle du chargement composé à la main. Les deux mêmes chaînes servent au rendu
// de la carte ET à leur pose en direct à la première frappe dans un champ SCU : celle-là ne repeint
// pas la carte (elle arracherait le champ qu'on remplit), et sans ces deux-là rien à l'écran ne
// dirait que la carte est désormais la tienne, ni comment la rendre au calcul.
// Le ✎ et le bouton « ↺ optimal » sont rendus par vues/manifeste.tsx d'après `MANIFEST_EDIT`.
// Ils étaient injectés par `insertAdjacentHTML` DANS une carte déjà rendue, faute de pouvoir la
// repeindre sans arracher le champ en cours de frappe — la contrainte a disparu avec l'îlot.

// La composition vaut-elle pour la carte demandée ? Sinon elle est abandonnée SUR PLACE : la garder
// en réserve la ferait ressurgir au retour sur cette route, longtemps après le geste qui l'a écrite.
// Rend { edit, destIdx } ou null ; `destIdx` est l'arrivée que la carte doit alors afficher.
function compositionEnCours(originIdx, destTerminal, destSystem) {
  if (!etat.MANIFEST_EDIT) return null;
  const ot = etat.MARKET.terminals[originIdx];
  const dt = destTerminal == null ? null : etat.MARKET.terminals[destTerminal];
  const destIdx = stationMap.get(stationLabel(etat.MANIFEST_EDIT.to, etat.MANIFEST_EDIT.toSystem));
  const vivante = destIdx != null && manifestIntentSurvives(etat.MANIFEST_EDIT, {
    from: { name: ot.name, system: ot.system },
    dest: dt && { name: dt.name, system: dt.system },
    destSystem,
  });
  if (!vivante) { oublierManifeste(); return null; }
  // Commodité disparue d'UEX : oubliée plutôt qu'affichée en fantôme, comme sur une jambe de voyage.
  // Purge SUR PLACE — les SCU sont adressés par index de ligne (`data-i`), l'intention et l'écran ne
  // peuvent pas diverger d'un cran.
  const gardees = etat.MANIFEST_EDIT.lines.filter((e) => findCommodity(e.name));
  const perdues = gardees.length !== etat.MANIFEST_EDIT.lines.length;
  if (perdues) { etat.MANIFEST_EDIT.lines = gardees; saveManifestEdit(); }
  // Vidée par cette purge, et non par un geste : la composition ne parlait plus que de commodités
  // qui n'existent plus, la carte reprend son calcul. Vidée à la main, elle reste (cf. logic.mjs).
  if (perdues && !gardees.length) { oublierManifeste(); return null; }
  return { edit: etat.MANIFEST_EDIT, destIdx };
}

// Lignes d'une composition, RELUES au marché courant : c'est ce qui fait qu'un prix corrigé
// s'affiche alors que les SCU, eux, ne bougent pas.
const lignesComposees = (edit, fromIdx, toIdx) =>
  edit.lines.map((e) => hydrateManifestLine(etat.MARKET, fromIdx, toIdx, findCommodity(e.name), e.units, effVals));

// Carte d'un couple de terminaux dont plus AUCUN chargement n'est rentable : bestManifest ne rend
// alors rien, et la composition faite à la main disparaîtrait avec lui — alors que le geste qui
// vient de tuer la rentabilité (un prix d'achat corrigé vers le haut) est justement celui qui la
// rend précieuse. Mêmes champs que ceux que manifestsFrom estampille sur un trajet ; les lignes
// viennent de l'appelant.
function manifesteSansOptimal(originIdx, destIdx, f) {
  const ot = etat.MARKET.terminals[originIdx], dt = etat.MARKET.terminals[destIdx];
  const point = feeResolver(f);
  return {
    origin: ot, originIdx, dest: dt, destIdx, cross: ot.system !== dt.system,
    lines: [], profit: 0, cargo: f.cargo,
    fee: point ? { buy: point(ot), sell: point(dt) } : null,
  };
}

// `isOv` est passée dans `corrections.ts`, à côté d'`effVals` : elle lit le même store.

// `m` = manifeste courant (il porte `fee`, le contexte de frais qui l'a produit) ; `t` = ses totaux.
// Les totaux du manifeste sont rendus par vues/manifeste.tsx (`<Totaux>`).

// Espace/budget restants d'après les SCU actuellement affectés.
// m = contexte de manifeste { lines, cargo, f, originIdx, destIdx, origin, dest } ; par défaut
// celui d'« En route », mais une jambe de voyage passe le sien (cf. legSuggestCtx).
function manifestRemaining(m = currentManifest) {
  const { scu, invest } = manifestTotals(m.lines);
  const budgetLeft = m.f.useBudget && m.f.budget > 0 ? m.f.budget - invest : Infinity;
  return { scu, invest, cargoLeft: m.cargo - scu, budgetLeft };
}

// Commodités qui pourraient remplir l'espace libre (même origine -> même destination), non chargées.
// Le calcul vit dans logic.mjs (partagé avec le manifeste optimal, donc éligibilité identique) ;
// app.js ne fournit que le marché et le résolveur de corrections.
const suggestionsFor = (m = currentManifest) => suggestionsFrom(etat.MARKET, m, effVals);

// addableUnits vient de logic.mjs.

// HTML des suggestions de remplissage pour un contexte de manifeste (En route ou jambe de voyage).
// `addAttrs` = attributs data-* posés sur le bouton d'ajout, propres à l'appelant.
// Les suggestions de remplissage sont rendues par vues/manifeste.tsx (`<Suggestions>`), pour la
// carte comme pour une jambe du compagnon. `suggestionsHTML` produisait le MÊME balisage en chaîne
// et n'a plus lieu d'être : deux fabriques du même bloc auraient fini par diverger.

function addSuggestion(name) {
  const it = suggestionsFor().find((x) => x.name === name);
  if (!it) return;
  const u = addableUnits(it, manifestRemaining());
  if (u <= 0) return;
  currentManifest.lines.push({ ...it, units: u, cap: u });
  retenirManifeste();
  paintManifest();
}

// Trouve une commodité par nom OU code (insensible à la casse/espaces). Partagé par les ajouts
// libres. La résolution vit dans logic.mjs : un code UEX peut désigner deux commodités.

// Ajout LIBRE : n'importe quelle commodité (par nom ou code), même si elle n'est pas vendable à
// destination — on la charge pour l'écouler ailleurs (ligne « carry-only », marge nulle ici).
function addManifestCommodity(name) {
  const m = currentManifest;
  if (!m || !etat.MARKET) return;
  const c = findCommodity(name);
  if (!c || m.lines.some((l) => l.name === c.name)) return; // inconnue ou déjà dans le manifeste
  m.lines.push(freeManifestLine(etat.MARKET, m.originIdx, m.destIdx, c, manifestRemaining().cargoLeft, effVals));
  retenirManifeste();
  paintManifest();
}

// Retire une ligne du manifeste (par nom de commodité).
function removeManifestLine(name) {
  const m = currentManifest;
  if (!m) return;
  m.lines = m.lines.filter((l) => l.name !== name);
  retenirManifeste();
  paintManifest();
}

// Engager le chargement dans le voyage : le bouton, ou la phrase qui dit pourquoi il n'y est pas.
// L'état vient de manifestJourneyState (pur, testé) — le rendu ne décide de rien.
// Le bouton n'existe QUE dans l'état « ajouter », donc la branche REMPLACER d'addToJourney, qui
// efface un voyage sans prévenir, est inatteignable depuis cette carte.
// Le bouton « ▶ Ajouter au voyage » et ses phrases sont rendus par vues/manifeste.tsx.

// Dessine le manifeste courant : totaux + lignes (SCU/prix/stock éditables) + suggestions.
// Tout ce qui suit dépend de l'ÉTAT GLOBAL (le marché, les corrections, le parcours, la
// composition à la main) ; la mise en forme, elle, vit dans l'îlot.
function paintManifest() {
  const m = currentManifest;
  $("manifest").hidden = false;
  peindre($("manifest"), carteManifeste({
    m,
    generation: manifestGen,
    compose: !!etat.MANIFEST_EDIT,
    parcours: etat.JOURNEY,
    suggestions: suggestionsFor(m),
    restant: manifestRemaining(m),
    libelleCaisses: (units) => scuBoxesLabel(units, m.origin.maxBox),
    texteBoutFrais: feeEndText,
    minutesTrajet: tripMinutes(0, m.cross),
    estCorrige: isOv,
    corriger, // six arguments dans le même ordre : passé nu, comme pour les Trajets
  }));
}

// Recalcule totaux + profit par ligne d'après les SCU saisis, et rafraîchit les suggestions.
//
// Elle REPEINT la carte, ce que la version impérative s'interdisait (« elle arracherait le champ
// qu'on remplit »). Ce n'est plus vrai : le champ SCU est NON CONTRÔLÉ dans l'îlot, donc React
// garde le même nœud DOM au re-rendu et ne touche ni à sa valeur ni à son curseur. C'est ce qui
// permet de supprimer les trois écritures en place (`.mprofit`, `.mboxes`, `#manifestTot`) — un
// nœud possédé par React et muté hors de React, c'est précisément ce que le garde de #113 interdit.
function updateManifestTotals() {
  if (!currentManifest) return;
  document.querySelectorAll("#manifest .mqty-input").forEach((inp) => {
    const i = Number(inp.dataset.i);
    let u = Math.floor(Number(inp.value));
    if (!Number.isFinite(u) || u < 0) u = 0;
    // Le dépassement du stock UEX est autorisé (vol de fret, relevé périmé…) : on ne plafonne
    // plus à `cap`, on le signale visuellement — la classe `over-stock` est posée au rendu.
    const l = currentManifest.lines[i];
    if (l) l.units = u;
  });
  // À la FRAPPE, pas au blur : le champ ne porte aucun `change`, et le premier refresh venu — un
  // prix corrigé ailleurs, une recherche tapée — repeindrait la carte avant qu'on ait quitté le
  // champ. Ce que ça écrit tient en deux nombres par ligne.
  retenirManifeste();
  paintManifest();
}

// Copie le plan de chargement en texte (pour un 2e écran / des notes).
function copyManifest() {
  const m = currentManifest;
  if (!m) return;
  const { profit, invest, scu, fees } = manifestTotals(m.lines, m.fee);
  const rows = m.lines.map(
    (l) => `${fmt(l.units)} SCU  ${l.name}  @ ${fmt(l.buyPrice)} -> ${fmt(l.sellPrice)}  (${lineProfitText(l.units, l, m.fee)} aUEC)  [${scuBoxesLabel(l.units, m.origin.maxBox)}]`
  );
  const text = [
    `Manifeste — ${m.origin.name} (${m.origin.system}) -> ${m.dest.name} (${m.dest.system})`,
    ...rows,
    `Total : ${fmt(scu)}/${fmt(m.cargo)} SCU · profit ${fmtFee(profit, fees)} aUEC · investissement ${fmt(invest)} aUEC` +
      (fees > 0 ? ` · frais d'autoload ≈ ${fmt(fees)} aUEC (estimation)` : ""),
  ].join("\n");
  copierTexte(text, $("copyManifest"), "⧉ Copier");
}

// Le SEUL chemin de sortie de l'app, pour les trois boutons de copie (manifeste, entrepôts,
// corrections). Un fichier téléchargé était l'autre candidat, écarté parce que les deux issues
// demandaient une liste à ENVOYER et que ce chemin-ci existait déjà, éprouvé par « ⧉ Copier » et
// par « Partager » (ADR-006 §3). Il reste techniquement possible : contrairement à ce qu'une
// première version de l'ADR affirmait, la CSP ne l'interdit pas — la mesure qui le prétendait ne
// s'est pas reproduite en contre-lecture.
// `libelle` est le texte à remettre après le retour visuel : chaque bouton a le sien.
// Un échec de copie DOIT se voir. Il se taisait deux fois (#91) :
//   - `navigator.clipboard` est absent hors contexte sécurisé (http:// sur un LAN). Le `?.` rendait
//     alors `undefined`, et le `.then` qui suivait levait une TypeError — la copie ne se faisait pas
//     et emportait au passage le reste du gestionnaire de clic ;
//   - un refus de permission tombait dans un `.catch(() => {})` vide, donc sans un mot.
// Dans les deux cas l'utilisateur repartait en croyant avoir son texte dans le presse-papiers, et
// collait le contenu précédent. Deux causes, deux messages : « indisponible » et « refusé » ne
// demandent pas la même chose à qui les lit.
function copierTexte(texte, btn, libelle) {
  const copie = navigator.clipboard?.writeText(texte);
  if (!copie) { showToast("⚠ Presse-papiers indisponible — copie impossible depuis cette page"); return; }
  copie.then(() => {
    if (!btn) return;
    btn.textContent = "✓ Copié";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = libelle; btn.classList.remove("copied"); }, 1500);
  }).catch(() => showToast("⚠ Presse-papiers refusé — la copie n'a pas eu lieu"));
}

let manifestGen = 0; // cf. l'affectation de `currentManifest`, plus bas
function renderManifest(origin, destSystem, f, destTerminal) {
  const card = $("manifest");
  currentManifest = null;
  // Les trois messages ci-dessous passent par React, comme la carte. `#manifest` lui appartient
  // depuis #96 : un `innerHTML` y détacherait les nœuds qu'il a créés sans qu'il le sache, et la
  // racine mémorisée dans pont.js appliquerait ensuite ses différences hors du document — le
  // message resterait à l'écran pour de bon, sans lever (#120).
  if (indexOrigine() == null) { card.hidden = true; peindre(card, null); return; }
  if (!f.useCargo || !(f.cargo > 0)) {
    card.hidden = false;
    peindre(card, indiceSouteInactive());
    return;
  }
  // La soute n'est pas vide : on ne peut charger QUE la place qui reste. C'est la question du
  // scénario d'ADR-002 — « j'ai 30 SCU de libre, qu'est-ce que j'y mets maintenant ? ». Les autres
  // vues gardent la soute nominale : elles répondent à « quelle est la meilleure route », pas à
  // « que puis-je embarquer là, tout de suite ».
  const aBord = holdScu(etat.SOUTE);
  const libre = freeCargo(etat.SOUTE, f.cargo);
  if (aBord > 0 && libre <= 0) {
    card.hidden = false;
    peindre(card, indiceSoutePleine(fmt(aBord)));
    return;
  }
  const fLibre = aBord > 0 ? { ...f, cargo: libre } : f;
  // Une composition en cours IMPOSE sa destination : laisser la carte se re-router toute seule sous
  // une correction de prix ferait disparaître de l'écran le chargement qu'on est en train de
  // composer — le symptôme même qu'on corrige. Forcer l'arrivée au champ, elle, l'abandonne.
  const compo = compositionEnCours(origin, destTerminal, destSystem);
  const cible = compo ? compo.destIdx : destTerminal;
  const man = bestManifest(etat.MARKET, origin, destSystem, fLibre, effVals, cible, feeResolver(f))
    || (compo ? manifesteSansOptimal(origin, cible, fLibre) : null);
  if (!man) {
    card.hidden = false;
    peindre(card, indiceAucunChargement(aBord > 0 ? fmt(libre) : null));
    return;
  }
  if (compo) man.lines = lignesComposees(compo.edit, origin, cible);
  man.originIdx = origin;
  man.f = fLibre;
  man.aBord = aBord; // pour que la carte dise pourquoi elle ne remplit que ça
  // `man.fee` (le contexte de frais) vient de manifestsFrom : on ne le reconstruit pas, on ne
  // risque donc pas de le reconstruire AUTREMENT que ce qui a servi à choisir la destination.
  man.feeInfo = feeCtx(f, man.origin.name, man.dest.name, man.origin, man.dest);
  currentManifest = man;
  // La GÉNÉRATION distingue les deux façons de repeindre la carte, et c'est tout ce qui reste du
  // comportement de l'ancien `card.innerHTML` :
  //   - ici, le manifeste vient d'être RECALCULÉ (départ changé, « ↺ optimal », correction de
  //     prix…) : les champs SCU doivent adopter les nouvelles valeurs, donc ils se remontent ;
  //   - depuis `updateManifestTotals`, on est EN TRAIN de taper : la génération ne bouge pas, le
  //     champ garde son nœud, sa valeur et son curseur.
  // Sans elle, un champ non contrôlé garderait à jamais ce que l'utilisateur y a tapé — « ↺
  // optimal » remettait `value="96"` dans l'attribut pendant que le champ affichait encore 30.
  manifestGen++;
  paintManifest();
}

function renderEnRoute() {
  // #empty est PARTAGÉ avec Trajets / Boucles, et cette vue n'a encore rien de VRAI à y écrire :
  // ce n'est pas un filtre qui vide le tableau, c'est le marché qui manque. Symétrie du
  // Le message par défaut posé en tête des vues à tableau (#55) manquait ici parce que le
  // retour anticipé précède toute écriture — et withMarket ne re-rend PAS en cas d'échec, donc le
  // message de la vue quittée y serait resté pour de bon, sous le toast « Marché indisponible ».
  if (!etat.MARKET) { $("empty").hidden = true; withMarket(refresh); return; }
  if (!enrouteReady) setupEnRoute();
  resolveDest();
  const f = readFilters();
  const emptyMsg = $("empty");

  renderManifest(indexOrigine(), $("destSystem").value, f, enrouteDest);

  if (indexOrigine() == null) {
    peindre($("enrouteRows"), null);
    emptyMsg.hidden = false;
    emptyMsg.textContent = "Choisis un terminal de départ pour voir le fret à emporter.";
    return;
  }

  const destSystem = $("destSystem").value;
  // sysFilter:"" — le système d'arrivée est filtré par destSystem (ou le terminal forcé), pas par le menu « système d'achat ».
  const ef = { ...f, sysFilter: "" };
  // Le contexte de frais descend DANS enRouteDeals : elle ne garde qu'UNE vente par commodité, donc
  // une destination meilleure en net n'entrerait jamais dans la liste — et la carte Manifeste, juste
  // au-dessus, afficherait la destination inverse (bestManifest, lui, tranche déjà sur le net).
  let deals = enRouteDeals(etat.MARKET, indexOrigine(), destSystem, enrouteDest, f, feeResolver(f))
    .filter((r) => routePasses(r, ef))
    .map((r) => evaluate(r, f));

  deals.sort(bySort(etat.sortKey, etat.sortDir));
  peindre($("enrouteRows"), vueTrajets({ ...propsTrajetsCommunes(), ...propsLignesSimples(), lignes: deals }));
  emptyMsg.hidden = deals.length > 0;
  if (!deals.length) emptyMsg.textContent = "Aucun fret rentable depuis ce terminal avec ces filtres.";
  notifySuperseded();
}

// ---------- Vue « Chaîne » (multi-sauts A -> B -> C ...) ----------

// buildChainAdjacency vit dans logic.mjs (fonction pure) ; appelée avec MARKET + effVals.

// `chainCardHTML` a été remplacé par vues/chaine.tsx.


// ---------- La soute : ce qui est à bord, et ce qu'on l'a payé (ADR-002) ----------
// Un lot par chargement — la même commodité peut y figurer deux fois à des prix différents.
// PERSISTÉE ET SANS PÉREMPTION : reprendre le jeu une semaine plus tard avec un vaisseau rangé
// plein, ce n'est pas une soute périmée, c'est une soute exacte. C'est aussi pour ça qu'effacer le
// voyage NE VIDE PAS la soute : le parcours est un plan, la soute est du fret réel.
const HOLD_KEY = "best-hauling-hold";
function loadSoute() {
  try { etat.SOUTE = JSON.parse(localStorage.getItem(HOLD_KEY)) || []; } catch { etat.SOUTE = []; }
  if (!Array.isArray(etat.SOUTE)) etat.SOUTE = [];
  // Marqueurs de refus hérités d'avant #20 : sans date, ils seraient tenus pour périmés d'un coup
  // et un résidu volontairement gardé pourrait partir à la première étape franchie. On leur donne
  // une fenêtre pleine à partir de maintenant. N'écrit que s'il y avait vraiment à migrer.
  const m = migrerRefus(etat.SOUTE);
  if (m.migres) { etat.SOUTE = m.hold; saveSoute(); }
}
function saveSoute() { try { localStorage.setItem(HOLD_KEY, JSON.stringify(etat.SOUTE)); } catch {} }

// Le REGISTRE des chargements (logic.mjs) : quelle jambe est engagée, et ce qu'elle a pris à quel
// rayon. Store à part de la soute, et c'est tout le point : la soute se vide par son ✕, par une
// vente, par la vente implicite du départ — aucun de ces chemins ne rend rien à la station, donc
// aucun ne décharge la jambe. Le fret peut partir, ce qu'on doit au rayon reste dû.
const CHARGES_KEY = "best-hauling-jambes-chargees";
// À appeler APRÈS loadSoute : la migration lit les lots pour reconstruire le registre d'une soute
// écrite avant lui (l'état vivait alors dans la présence des lots, et le stock d'avant dans `avant`).
function loadChargements() {
  try { etat.CHARGEMENTS = JSON.parse(localStorage.getItem(CHARGES_KEY)) || {}; } catch { etat.CHARGEMENTS = {}; }
  if (!etat.CHARGEMENTS || typeof etat.CHARGEMENTS !== "object" || Array.isArray(etat.CHARGEMENTS)) etat.CHARGEMENTS = {};
  const m = migrerChargements(etat.CHARGEMENTS, etat.SOUTE);
  etat.CHARGEMENTS = m.chargements;
  if (m.change) { etat.SOUTE = m.lots; saveSoute(); saveChargements(); }
}
function saveChargements() { try { localStorage.setItem(CHARGES_KEY, JSON.stringify(etat.CHARGEMENTS)); } catch {} }

// Charge le manifeste d'une jambe dans la soute, au prix que l'app venait d'afficher. Les lots
// portent la clé de la jambe : c'est ce qui permet d'annuler un chargement sans deviner.
// Le point d'achat d'une commodité à un terminal, avec son stock EFFECTIF (corrections comprises)
// et la date UEX qui sert d'ancre à toute correction locale.
function pointAchat(nomCommodite, nomTerminal) {
  const c = etat.MARKET && findCommodity(nomCommodite);
  const idx = stationMap.size ? [...stationMap].find(([lab]) => parseStationLabel(lab).name === nomTerminal) : null;
  if (!c || !idx) return null;
  const b = c.buys.find((x) => x[0] === idx[1]);
  if (!b) return null;
  const e = effVals(c.name, nomTerminal, "buy", b[1], b[2], b[3]);
  return { commodite: c.name, stock: e.vol, base: b[3] };
}

// Réécrit la correction de stock d'un point d'achat DEPUIS LE REGISTRE : sa référence, moins tout ce
// que les jambes encore chargées y prennent. Chargement et annulation posent la même question, et
// une seule réponse les empêche de diverger — c'est ce qui manquait quand deux jambes achetaient au
// même point. `prise.ref` sert de repli quand plus aucune jambe ne tient le rayon : on lui rend
// alors exactement ce qu'il annonçait avant qu'on y touche.
// Renvoie le solde appliqué, ou null si le point a disparu d'UEX (rien à corriger).
function ecrireStockDuPoint(prise) {
  const p = pointAchat(prise.name, prise.terminal);
  if (!p) return null;
  const s = soldeDuPoint(etat.CHARGEMENTS, prise.name, prise.terminal);
  const ref = s.ref != null ? s.ref : prise.ref;
  setOverride(prise.name, prise.terminal, "buy", "vol", stockApres(ref, s.pris), p.base);
  return { ref, pris: s.pris };
}

function chargerJambe(i) {
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
  renderJourney();
  refresh();
}
// L'état « chargée » est PORTÉ par le registre, jamais déduit des lots : la soute se vide par
// d'autres chemins que « annuler », et aucun ne défait le chargement — le fret est parti, il n'est
// pas revenu au rayon.

// « Où suis-je ? » — l'étape courante du voyage, ou à défaut le terminal de départ d'« En route ».
// C'est ce terminal qui fixe le prix d'une vente et qui porte le marqueur « refusé ici ».

// Vend `units` SCU ici. Si le comptoir n'a pas tout pris, le reste est marqué REFUSÉ à cette
// station : il traversera la vente implicite du départ sans être effacé.
// `idxFige` : l'index porté par `.hold-sell[data-idx]`, résolu AU RENDU. On vend là où l'utilisateur
// a lu le prix, pas là où il se trouve à la milliseconde du clic — sinon l'infobulle annonce une
// station et la vente en encaisse une autre. Repli sur `stationCourante()` pour tout appel qui n'a
// pas d'affichage derrière lui (venteImplicite, notamment).
function vendreIci(nom, units, idxFige) {
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
  renderSoute(); refresh();
  const reste = avant - r.vendu;
  showToast(`✓ ${fmt(r.vendu)} SCU de ${nom} vendus — ${fmtSigne(r.profit)} aUEC` +
    (reste > 0 ? ` · ${fmt(reste)} SCU restent à bord — le comptoir n'en a pas repris plus` : ""));
}

// Quitter une escale sous-entend qu'on y a fait son affaire : ce qu'elle reprend est vendu.
// Ce qu'une vente partielle y a laissé porte `refuse` et traverse intact.
function venteImplicite(depuis) {
  if (!etat.SOUTE.length || !etat.MARKET || depuis == null) return;
  const r = sellAllAt(etat.SOUTE, etat.MARKET, depuis, effVals);
  if (!r.ventes.length) return;
  etat.SOUTE = r.hold;
  saveSoute();
  const quoi = r.ventes.map((v) => `${fmt(v.units)} ${v.name}`).join(", ");
  showToast(`✓ Vendu en quittant ${etat.MARKET.terminals[depuis].name} : ${quoi} — ${fmtSigne(r.profit)} aUEC`);
}

const fmtSigne = (n) => (n >= 0 ? "+" : "") + fmt(Math.round(n));

// Le fret déposé à une station : ni vendu, ni perdu — du capital immobilisé qu'on peut oublier.
const DEPOTS_KEY = "best-hauling-depots";
function loadDepots() {
  try { etat.DEPOTS = JSON.parse(localStorage.getItem(DEPOTS_KEY)) || {}; } catch { etat.DEPOTS = {}; }
}
function saveDepots() { try { localStorage.setItem(DEPOTS_KEY, JSON.stringify(etat.DEPOTS)); } catch {} }

// Même règle que `vendreIci` : on dépose à la station résolue au rendu, celle que le panneau nomme.
function deposerIci(nom, units, idxFige) {
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
  renderSoute(); renderEntrepots(); refresh();
  showToast(`⬓ ${fmt(units)} SCU de ${nom} déposés à ${t.name} — ni vendus ni perdus`);
}

// Reprendre : le fret déposé remonte à bord avec son prix payé. Aucun contrôle de position — l'app
// ne sait pas où le vaisseau est RÉELLEMENT, et refuser au motif « tu n'y es pas » bloquerait le
// geste au moment exact où il est vrai. La station est écrite en toutes lettres sur la ligne :
// savoir qu'on y est relève de l'utilisateur, pas d'une donnée qu'on n'a pas.
function reprendreIci(station, nom, units) {
  const r = takeFromStore(etat.SOUTE, etat.DEPOTS, nom, units, station);
  if (r.hold === etat.SOUTE) return;
  const repris = holdScu(r.hold) - holdScu(etat.SOUTE); // ce qui est VRAIMENT revenu, pas ce qu'on demandait
  etat.SOUTE = r.hold; etat.DEPOTS = r.entrepots;
  saveSoute(); saveDepots();
  renderSoute(); renderEntrepots(); refresh();
  showToast(`◈ ${fmt(repris)} SCU de ${nom} repris à ${parseStationLabel(station).name} — de retour en soute`);
}

// Les entrepôts : le fret déposé, station par station. Masquée tant que rien n'y dort, comme la
// soute. Elle ne peut PAS vivre dans renderSoute : celle-ci sort dès que la soute est vide, ce qui
// est justement le cas le plus fréquent quand on vient de tout déposer.
// Le capital immobilisé est le chiffre qui compte : de l'argent déjà sorti, que plus rien dans
// l'app ne rappelait — c'était tout le sujet.
// Les clés de DEPOTS viennent du localStorage : elles sont échappées comme n'importe quelle donnée
// tierce (cf. e2e/injection.pw.mjs).
function renderEntrepots(synchrone = false) {
  const box = $("depotsCard");
  if (!box) return;
  const stations = Object.entries(etat.DEPOTS).filter(([, lots]) => Array.isArray(lots) && lots.length);
  if (!stations.length) { box.hidden = true; peindre(box, null); return; }
  box.hidden = false;
  const tous = stations.flatMap(([, lots]) => lots);
  peindre(box, carteEntrepots({
    stations: stations.map(([label, lots]) => ({
      label, lieu: parseStationLabel(label), scu: holdScu(lots), groupes: holdByCommodity(lots),
    })),
    scuTotal: holdScu(tous),
    invest: holdByCommodity(tous).reduce((s, g) => s + g.invest, 0),
  }), { synchrone });
}

// La liste de ce qui dort en entrepôt, en texte, dans le presse-papiers : elle ne quittait jamais
// l'app, et il fallait rouvrir le navigateur qui porte le localStorage pour la relire.
function copierEntrepots() {
  copierTexte(exporterEntrepots(etat.DEPOTS, nowSec()), $("copyDepots"), "⧉ Copier");
}

// « Où écouler ce qui reste ? » — le détour manuel par la vue Commodités, en un panneau.
// Le panneau « où écouler » est rendu par vues/soute.tsx (`<OuEcouler>`). Le CALCUL, lui, reste
// ici : `offloadPlan` a besoin du marché, des filtres et du résolveur de corrections — et il n'est
// appelé que si le panneau est ouvert, parce qu'il parcourt tous les terminaux à chaque rendu.

// ---------- Déclarer « j'ai ça à bord » : la deuxième entrée de la soute (#55) ----------
// Le repli que l'ADR-002 réservait (option D) et n'avait jamais câblé. Jusqu'ici rien n'entrait en
// soute sans une jambe de voyage et son « ✓ chargé » : ni le butin ramassé au sol, ni un vaisseau
// rangé plein la semaine dernière, ni une cargaison achetée hors du site.
//
// Carte SÉPARÉE de #holdCard, et c'est tout le point : celle-ci se masque dès que la soute est
// vide — un bouton posé dedans serait invisible au moment exact où il sert. Elle vit dans
// #voyageLeft, que switchView ne touche jamais : les six vues l'ont donc, y compris Trajets et
// Commodités, qui n'ont aucun rapport avec un voyage.

// Le dessin vit dans `vues/declaration.tsx` ; ici il ne reste que le branchement à l'état.
//
// LE GARDE DE FOCUS A DISPARU, et avec lui la relecture des valeurs tapées qui le doublait. Les
// deux existaient parce qu'un `innerHTML` détruit les champs qu'il réécrit : cette carte est rendue
// à CHAQUE rafraîchissement — donc à chaque frappe ailleurs et à chaque arrivée du marché — et elle
// effaçait la saisie en cours. Des champs non contrôlés sous une racine mémorisée rendent le
// repeint inoffensif : React réutilise leur nœud et n'écrit jamais leur valeur.
//
// `synchrone` remplace l'ancien `force`, et ne dit plus du tout la même chose : deux appelants
// MESURENT ou FOCALISENT juste après le rendu et ne peuvent pas attendre le lot de React. Voir
// `renderSoute` pour le même contrat sur la carte voisine.
function renderDeclaration(synchrone = false) {
  const box = $("holdDeclare");
  if (!box) return;
  box.hidden = false;
  peindre(box, carteDeclaration({
    souteVide: !etat.SOUTE.length,
    // « Je suis à » : sans voyage, la position EST le terminal de départ d'« En route » — déjà le
    // repli de stationCourante(). On ne crée pas un second store, on rend le premier atteignable
    // d'ici : deux positions divergeraient au premier aller-retour entre les deux vues. Avec un
    // voyage, l'étape courante la dit déjà, et un champ ici mentirait.
    avecPosition: !etat.JOURNEY && !!(etat.SOUTE.length || etat.declarationOuverte),
    ouvert: etat.declarationOuverte,
    origine: $("origin").value,
  }), { synchrone });
}

function ouvrirDeclaration() {
  // La vue par défaut ne lit que routes.json : sans le graphe, ni autocomplétion ni résolution du
  // nom saisi. On l'attend plutôt que d'ouvrir un formulaire inerte.
  if (!etat.MARKET) { withMarket(ouvrirDeclaration); return; }
  etat.declarationOuverte = true;
  // SYNCHRONE, et c'est un contrat : le champ naît avec le formulaire, il n'existe donc pas avant
  // le rendu. Différé, le `?.` ci-dessous court-circuiterait et le formulaire s'ouvrirait sans
  // curseur — l'utilisateur taperait dans le vide. Même piège que `.hold-sell-qty` sur la soute.
  renderDeclaration(true);
  $("holdAddName")?.focus();
}
function fermerDeclaration() { etat.declarationOuverte = false; renderDeclaration(); }

// Le geste : cette commodité, ce nombre de SCU, à ce prix. Le prix est FACULTATIF et vaut 0 — du
// butin n'a rien coûté (ADR-002). Une commodité que le marché ne connaît pas est refusée : l'app ne
// saurait ni la classer, ni dire où l'écouler, et une ligne muette en soute ne vaut pas mieux que rien.
function declarerABord() {
  const c = etat.MARKET && findCommodity($("holdAddName").value);
  if (!c) { showToast("⚠ Commodité inconnue — choisis-la dans la liste (nom ou code UEX)"); return; }
  const units = Math.floor(Number($("holdAddScu").value) || 0);
  if (units <= 0) { showToast(`⚠ Indique combien de SCU de ${c.name} tu as à bord`); return; }
  const saisi = $("holdAddPaid").value.trim();
  const prix = saisi === "" ? 0 : Number(saisi);
  const avant = etat.SOUTE;
  etat.SOUTE = declarerLot(etat.SOUTE, { name: c.name, units, paid: prix }, nowSec());
  if (etat.SOUTE === avant) return; // la fonction pure a refusé : rien à persister
  saveSoute();
  etat.declarationOuverte = false;
  renderDeclaration();
  refresh();
  showToast(`◈ ${fmt(units)} SCU de ${c.name} déclarés à bord — ` +
    (prix > 0 ? `${fmt(prix)} aUEC/SCU payés` : "butin, coût nul"));
}

// Poser la position revient à écrire dans le champ de départ d'« En route » : c'est lui que
// stationCourante() lit sans voyage, et lui que le permalien transporte déjà.
function poserPosition(v) {
  $("origin").value = v;
  refresh();
}

// Débarquer le fret n'est pas le remettre en rayon : le registre des chargements n'est pas touché,
// donc les jambes restent chargées (🔒 « ⬢ à bord ») et leur déduction reste posée. C'est ce qui
// garde le chemin « annuler » atteignable — le seul qui rende vraiment son stock à la station.
function viderSoute() { etat.SOUTE = []; saveSoute(); renderSoute(); refresh(); }
function retirerLot(i) { etat.SOUTE = etat.SOUTE.filter((_, j) => j !== i); saveSoute(); renderSoute(); refresh(); }

// `synchrone` : la délégation du bouton « vendu » sélectionne le champ de quantité JUSTE APRÈS ce
// rendu (`…querySelector(".hold-sell-qty")?.select()`). Un rendu React groupé n'aurait pas encore
// créé le champ, le `?.` court-circuiterait, et le champ s'ouvrirait sans le focus — visible au
// relevé : sa bordure passait de l'ambre pleine à l'ambre à 30 %.
function renderSoute(synchrone = false) {
  const box = $("holdCard");
  if (!box) return;
  // AVANT le retour anticipé : le point d'entrée « déclarer », lui, doit exister précisément quand
  // la carte n'existe pas. C'est le seul rendu appelé depuis tous les chemins qui repeignent la soute.
  //
  // Le drapeau se PROPAGE, et ça n'a rien de décoratif : `ajusterRangeeVoyage` mesure la hauteur de
  // `#voyageLeft` juste après `renderSoute(true)`, et `#holdDeclare` en est un enfant direct. Rendue
  // en différé, cette carte ferait mesurer la hauteur du rendu PRÉCÉDENT. `innerHTML` étant
  // synchrone par nature, la question ne se posait pas — le drapeau n'était donc pas transmis.
  renderDeclaration(synchrone);
  if (!etat.SOUTE.length) { box.hidden = true; peindre(box, null); return; }
  box.hidden = false;
  // Du fret à bord et pas de graphe : la vue par défaut ne lit que routes.json, et sans marché la
  // carte ne sait ni nommer une icône, ni proposer une vente, ni classer « où écouler ». Ça se
  // voyait peu tant qu'on ne pouvait charger que depuis « En route » — qui le charge ; une soute
  // déclarée, elle, peut naître sur Trajets et y rester.
  if (!etat.MARKET) withMarket(renderSoute);
  const ici = stationCourante();
  const f = readFilters();
  peindre(box, carteSoute({
    groupes: holdByCommodity(etat.SOUTE),
    ici,
    scu: holdScu(etat.SOUTE),
    libre: f.useCargo && f.cargo > 0 ? freeCargo(etat.SOUTE, f.cargo) : null,
    invest: holdByCommodity(etat.SOUTE).reduce((s, g) => s + g.invest, 0),
    venteEnCours: etat.venteEnCours,
    ecoulerOuvert: etat.ecoulerOuvert,
    positionConnue: ici != null,
    marchePret: !!etat.MARKET,
    // Le classement n'est calculé QUE si le panneau est ouvert : `offloadPlan` parcourt tous les
    // terminaux, et cette carte se repeint à chaque rafraîchissement de l'application.
    ecoulement: etat.ecoulerOuvert && etat.MARKET && ici != null
      ? offloadPlan(etat.MARKET, etat.SOUTE, ici, f, effVals, feeResolver(f), 5)
      : null,
    pointVente: (nom) => (ici != null && etat.MARKET ? sellableAt(etat.MARKET, ici, nom, effVals) : null),
    // Le `kind` n'est pas persisté dans le lot : c'est une propriété de la commodité, pas de la
    // transaction. On le relit au marché quand il est là, et on s'en passe sinon.
    kindDe: (nom) => { const c = etat.MARKET && findCommodity(nom); return c ? c.kind : null; },
  }), { synchrone });
}

// ---------- Carte 2D du parcours (ADR-001) ----------
// Le calcul est PUR (journeyMap, logic.ts) et le dessin vit dans `vues/carte.tsx` : ici il ne reste
// que le branchement à l'état — les globales JOURNEY / MARKET / STARMAP, qu'un îlot ne lit pas.

// Dessine (ou masque) le panneau carte. Appelé par renderJourney, donc à chaque refresh.
function renderJourneyMap() {
  const box = $("journeyMap");
  if (!box) return;
  // Masquer NE SUFFIT PAS : le conteneur reste possédé par React, donc on le repeint à vide. Une
  // branche qui se contenterait de poser `hidden` laisserait le dessin précédent en place, prêt à
  // réapparaître tel quel — c'est la même règle que pour les messages vides des autres îlots.
  if (!etat.JOURNEY || !etat.MARKET) { box.hidden = true; peindre(box, null); return; }
  if (!etat.STARMAP) { ensureStarmap(renderJourneyMap); box.hidden = true; peindre(box, null); return; }
  const info = (nom) => {
    const i = stationMap.get(stationLabel(nom, (journeyStations(etat.JOURNEY).find((s) => s.name === nom) || {}).system || ""));
    return i == null ? null : etat.MARKET.terminals[i];
  };
  // Jambe courante chargée = on a payé et on est parti : le vaisseau quitte le quai sur la carte.
  const legCourante = etat.JOURNEY.legs[etat.JOURNEY.current];
  const enVol = !!legCourante && jambeChargee(legCourante, etat.JOURNEY.current);
  const c = journeyMap(journeyStations(etat.JOURNEY), etat.JOURNEY.current, etat.STARMAP, info, enVol);
  if (!c) { box.hidden = true; peindre(box, null); return; }
  box.hidden = false;
  peindre(box, carteParcours(c));
}

// ---------- Compagnon de voyage : résumé du parcours (près du vaisseau) ----------
// `pickJourney` et `syncViewsToJourney` sont passées dans `voyage-actions.ts` : les QUATRE vues qui
// restent ici les appellent, et aucune ne peut emménager tant qu'elles vivent dans un fichier qui
// n'exporte rien (ADR-012).

// « Je suis ici » : pose la position courante et recale les vues. Deux chemins y mènent — le fil
// d'étapes textuel (⦿) et les escales de la carte — et c'est délibéré : la carte n'introduit pas
// une commande, elle en offre une seconde entrée.
function setJourneyStop(i) {
  if (!etat.JOURNEY || !Number.isFinite(i)) return;
  // AVANCER sous-entend qu'on a fait son affaire à l'escale qu'on quitte : ce qu'elle reprend part.
  // Reculer, non — on ne revend pas en revenant sur ses pas.
  if (i > etat.JOURNEY.current) venteImplicite(stationCourante());
  etat.JOURNEY = setJourneyPosition(etat.JOURNEY, i);
  syncViewsToJourney();
  renderJourney();
  refresh();
}

// Pré-remplit les contrôles des vues d'après la POSITION COURANTE du parcours.
// « Pré-rempli » : on pose les défauts, l'utilisateur reste libre de les changer.

function clearJourney() {
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
  renderJourney();
  // Comme tous les autres mutateurs du parcours : la carte Voyage n'est pas la seule à lire JOURNEY.
  // Les Boucles hissent en tête celles qui partent de la fin du parcours (.from-here) et le board
  // Commodités marque d'un ◆ ce qu'on transporte — sans ce rendu, les deux gardaient l'état d'AVANT
  // l'effacement jusqu'au geste suivant. `refresh` finit par `saveState`, inutile de le doubler.
  refresh();
}
// `journeyCarriedCommodities`, `figerJambe` et `pinLegsForVolume` sont passées dans
// `voyage-donnees.ts` : elles ne rendent rien, et le gel doit être appelable depuis une vue de
// l'arbre (ADR-012). Leurs commentaires les y attendaient déjà, orphelins.

// Engage le manifeste d'« En route » comme nouvelle jambe du voyage (bouton de la carte Manifeste).
// La garde d'état est REJOUÉE ici : le rendu peut dater d'avant un changement de parcours.
function manifestToJourney() {
  const m = currentManifest;
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

// Contexte de manifeste d'une jambe, à la forme attendue par suggestionsFor/manifestRemaining
// (mêmes suggestions de remplissage qu'« En route »). null si le terminal ou la soute manque.
function legSuggestCtx(leg, lines, f) {
  if (!etat.MARKET || !stationMap.size) return null;
  if (!f.useCargo || !(f.cargo > 0)) return null; // sans soute bornée, « SCU libres » n'a pas de sens
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

// Actions d'édition d'une jambe (i = index de jambe).
function toggleLegEditor(i) {
  etat.journeyExpandedLeg = etat.journeyExpandedLeg === i ? -1 : i;
  renderJourney();
  // renderJourney() réécrit tout le compagnon : l'en-tête qu'on vient d'activer n'existe plus et le
  // focus retombe sur <body>. À la souris ça ne se voit pas ; au clavier on perdait sa place, la
  // deuxième Entrée (replier) ne partait plus de nulle part et Tab reprenait au début du document.
  $("journeyCard")?.querySelector(`.jleg-head[data-leg="${i}"]`)?.focus();
}
function editLegQty(i, li, val) {
  // Le voyage peut avoir été effacé entre le focus et le blur (cliquer ✕ blure d'abord le champ) :
  // sans cette garde, l'édition en vol était réécrite APRÈS la purge et ressuscitait toute seule.
  if (!etat.JOURNEY || !etat.JOURNEY.legs[i]) return;
  const intent = legIntent(etat.JOURNEY.legs[i], i, readFilters());
  if (intent[li]) { const u = Math.floor(Number(val)); intent[li].units = Number.isFinite(u) && u > 0 ? u : 0; }
  saveJourneyEdits();
  // Ce handler part sur `change`, donc au BLUR — or le blur précède le mouseup d'un clic en cours.
  // Re-rendre tout de suite détruirait le nœud visé et avalerait ce clic (impossible d'effacer le
  // voyage ou de replier une jambe du premier coup). On laisse le tour d'événement se terminer.
  setTimeout(renderJourney, 0);
}
// Saisie en direct : met à jour l'intention, puis repeint la carte AVEC LA GÉNÉRATION FIGÉE.
//
// L'ancienne version s'interdisait tout re-rendu — « un renderJourney() à chaque frappe ferait
// perdre le focus de l'input » — et mettait donc à jour `.jman-profit`, `over-stock` et la boîte de
// suggestions à la main. C'était vrai d'un `innerHTML`, qui détruit le champ ; ça ne l'est plus
// d'un rendu React, qui garde le nœud et n'écrit pas dans un champ non contrôlé. Le seul risque
// serait que la valeur CALCULÉE reprenne la main sous les doigts : `frappe: true` l'empêche en ne
// bougeant pas la génération (cf. `renderJourney`).
function liveLegQty(i, li, inp) {
  if (!etat.JOURNEY || !etat.JOURNEY.legs[i]) return; // le parcours a pu disparaître sous la saisie
  const intent = legIntent(etat.JOURNEY.legs[i], i, readFilters());
  if (!intent[li]) return;
  const u = Math.floor(Number(inp.value));
  intent[li].units = Number.isFinite(u) && u > 0 ? u : 0;
  renderJourney({ frappe: true });
}

// Ajoute une commodité suggérée à une jambe, remplie au max possible.
function addLegSuggestion(i, name) {
  const leg = etat.JOURNEY.legs[i];
  const f = readFilters();
  const ctx = legSuggestCtx(leg, legEffectiveLines(leg, i, f), f);
  if (!ctx) return;
  const it = suggestionsFor(ctx).find((x) => x.name === name);
  if (!it) return;
  const u = addableUnits(it, manifestRemaining(ctx));
  if (u <= 0) return;
  legIntent(leg, i, f).push({ name: it.name, units: u });
  saveJourneyEdits(); renderJourney();
}
function delLegLine(i, name) {
  const leg = etat.JOURNEY.legs[i];
  etat.JOURNEY_EDITS[legKey(leg, i)] = legIntent(leg, i, readFilters()).filter((e) => e.name !== name);
  saveJourneyEdits(); renderJourney();
}
// « ↺ optimal » lève les deux formes d'intention, l'ajustement manuel comme le gel.
function resetLeg(i) {
  const k = legKey(etat.JOURNEY.legs[i], i);
  delete etat.JOURNEY_EDITS[k]; delete etat.JOURNEY_PINS[k];
  saveJourneyEdits(); saveJourneyPins(); renderJourney();
}
// Ajout LIBRE d'une commodité à une jambe (même non vendable à l'arrivée -> ligne « carry-only »).
// Même règle qu'« En route » : freeManifestLine (logic.mjs) en est la source unique.
function addLegLine(i, name) {
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
  saveJourneyEdits(); renderJourney();
}

// Index du terminal de FIN de parcours (point d'extension), ou null.
function journeyEndIndex() {
  const end = journeyEnd(etat.JOURNEY);
  return end && stationMap.size ? stationMap.get(stationLabel(end.name, end.system)) : null;
}
// Meilleure jambe (commodité de marge max) entre deux terminaux, ou null si aucun fret rentable.
// `readFilters()` fait choisir la vente au profit RÉALISABLE et non au prix affiché : sans lui,
// la jambe proposée peut viser un terminal déjà saturé, qui n'écoulera qu'une poignée de SCU.
function bestLegTo(fromIdx, toIdx) {
  if (fromIdx == null || toIdx == null) return null;
  return bestLegBetween(etat.MARKET, fromIdx, toIdx, readFilters());
}
// Jambe « à vide » (aucune commodité) entre deux terminaux — pour ajouter un arrêt même sans fret rentable.
function emptyLeg(fromIdx, toIdx) {
  if (fromIdx == null || toIdx == null) return null;
  const ft = etat.MARKET.terminals[fromIdx], tt = etat.MARKET.terminals[toIdx];
  return { from: ft.name, fromSystem: ft.system, to: tt.name, toSystem: tt.system, commodity: "", buyPrice: 0, sellPrice: 0, margin: 0 };
}
// Résout un terminal depuis le texte : libellé exact « Nom — Système », sinon par nom seul.
// Suggestions d'arrêts : meilleures destinations rentables depuis la fin du parcours (top 4).
function journeyStopSuggestions() {
  const fromIdx = journeyEndIndex();
  return fromIdx == null ? [] : stopSuggestions(etat.MARKET, fromIdx, readFilters());
}
// Ajoute un arrêt (terminal) : nouvelle jambe optimale depuis la fin du parcours -> étend.
function addStopByTerminal(label) {
  const fromIdx = journeyEndIndex();
  const toIdx = resolveStationLabel(label);
  if (fromIdx == null || toIdx == null) return; // terminal inconnu / parcours vide
  // Jambe optimale s'il y a du fret rentable, sinon jambe « à vide » (on l'ajoute quand même).
  pickJourney([bestLegTo(fromIdx, toIdx) || emptyLeg(fromIdx, toIdx)]);
}

// Démarre un voyage « de zéro » depuis un terminal de départ (sans passer par un trajet ▶).
// On pose juste le point de départ ; l'utilisateur construit ensuite avec « + Arrêt ».
function beginJourney(label) {
  const v = (label || "").trim();
  if (!v) return;
  if (!stationMap.size) { withMarket(() => beginJourney(v)); return; } // marché requis pour résoudre
  const startIdx = resolveStationLabel(v);
  if (startIdx == null) return; // terminal inconnu
  const t = etat.MARKET.terminals[startIdx];
  etat.JOURNEY = startJourneyAt({ name: t.name, system: t.system });
  syncViewsToJourney();
  renderJourney();
  refresh();
}

// Réindexe tout ce qui est indexé par le RANG des jambes après une modification du parcours. Les
// QUATRE porteurs — manifeste édité, 🔒, étiquette `leg` des lots de la soute, entrée du registre
// des chargements — passent par le même appel pur : les décaler séparément les ferait diverger, et
// c'est d'en avoir oublié un que venait le double chargement (la jambe renumérotée se croyait vide
// alors que son fret était à bord).
function reindexerApresRetrait(retrait) {
  const r = reindexerRangsJambe({ edits: etat.JOURNEY_EDITS, pins: etat.JOURNEY_PINS, lots: etat.SOUTE, chargements: etat.CHARGEMENTS }, retrait);
  etat.JOURNEY_EDITS = r.edits; etat.JOURNEY_PINS = r.pins; etat.SOUTE = r.lots; etat.CHARGEMENTS = r.chargements;
  if (etat.journeyExpandedLeg >= retrait.removedFrom) etat.journeyExpandedLeg = -1; // le panneau déplié n'existe plus
  saveJourneyEdits(); saveJourneyPins(); saveSoute(); saveChargements();
}

// Retire un arrêt (index de station) et RECONNECTE les voisins (recalcule la jambe A->C).
function removeJourneyStop(stopIndex) {
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
  renderJourney();
  refresh();
}

// `frappe` : on est EN TRAIN de taper dans un champ SCU de jambe. La génération ne bouge alors pas,
// donc les champs non contrôlés gardent leur valeur et leur curseur pendant que profits, totaux et
// suggestions se recalculent — même mécanique que le manifeste (#117). Tout autre appel la bouge,
// ce qui remonte les champs : c'est ce que faisait l'ancien `card.innerHTML`.
let journeyGen = 0;
function renderJourney({ frappe = false } = {}) {
  const card = $("journeyCard");
  if (!card) return;
  if (!frappe) journeyGen++;
  // Aucun voyage -> invite à en démarrer un : depuis un trajet (▶) OU « de zéro » (point de départ).
  if (!etat.JOURNEY) {
    card.hidden = false;
    const recap0 = $("journeyRecap"); if (recap0) { recap0.hidden = true; peindre(recap0, null); } // pas de récap sans voyage
    const row0 = $("shipJourneyRow"); if (row0) row0.classList.remove("stacked");
    renderJourneyMap();
    renderSoute();
    renderEntrepots();
    peindre(card, inviteVoyage(), { synchrone: true });
    return;
  }
  card.hidden = false;
  // MARKET nécessaire pour les manifestes par jambe -> charge à la demande puis re-render.
  if (!etat.MARKET) { withMarket(renderJourney); }
  else if (!enrouteReady) setupEnRoute();

  const stations = journeyStations(etat.JOURNEY);
  const n = etat.JOURNEY.legs.length;
  const f = readFilters();
  let totalProfit = 0, totalScu = 0, totalFees = 0; // récap : profit réel, SCU et frais du voyage
  // Manifeste (cargaison) de chaque jambe — optimal ou édité ; jambe dépliable pour l'éditer.
  const jambes = etat.JOURNEY.legs.map((leg, i) => {
    const lines = etat.MARKET ? legEffectiveLines(leg, i, f) : null;
    const pair = etat.MARKET ? (legFeeCtx(leg, f) || {}).pair : null;
    const edited = etat.MARKET && !!etat.JOURNEY_EDITS[legKey(leg, i)];
    const expanded = i === etat.journeyExpandedLeg;
    // `nombreTotal` porte le NOMBRE quand `texteTotal` n'en est que le rendu : c'est lui qui décide
    // du signe et de la couleur. Une jambe dont les frais dépassent la marge est une vraie réponse,
    // pas un cas limite — elle s'affichait « +-1 234 », en vert.
    let texteTotal = "—", nombreTotal = 0;
    if (etat.MARKET && lines.length) {
      const t = manifestTotals(lines, pair);
      texteTotal = fmtFee(t.profit, t.fees);
      nombreTotal = t.profit;
      totalProfit += t.profit;
      totalFees += t.fees;
      totalScu += lines.reduce((s, l) => s + l.units, 0);
    } else if (etat.MARKET) texteTotal = "0";
    // Les suggestions de la jambe DÉPLIÉE sont calculées ici et rendues dans l'arbre : elles
    // vivaient dans un conteneur peint à part, détour qui n'existait que parce que la carte était
    // réécrite en innerHTML à chaque rendu.
    const sctx = expanded && etat.MARKET ? legSuggestCtx(leg, lines, f) : null;
    return {
      i, from: leg.from, to: leg.to,
      courante: i === etat.JOURNEY.current,
      depliee: expanded,
      editee: !!edited,
      figee: !!(edited && etat.JOURNEY_PINS[legKey(leg, i)]), // figée par une correction, pas par toi
      chargee: !!(etat.MARKET && jambeChargee(leg, i)),       // ce manifeste est-il déjà en soute ?
      lignes: lines && lines.map((l) => ({
        name: l.name, kind: l.kind, illegal: !!l.illegal, units: l.units,
        acquired: !!l.acquired, vendable: l.sellPrice != null,
        releve: lineFreshUpdated(l),
        texteProfit: lineProfitText(l.units, l, pair),
        auDela: Number.isFinite(l.cap) && l.units > l.cap,
      })),
      texteTotal, nombreTotal,
      suggestions: sctx ? {
        suggestions: suggestionsFor(sctx), restant: manifestRemaining(sctx), frais: sctx.fee,
        attributsAjout: { "data-leg": i },
      } : null,
    };
  });

  peindre(card, carteVoyage({
    stations, courante: etat.JOURNEY.current, nbSauts: n,
    margeCumulee: journeyMargin(etat.JOURNEY),
    marchePret: !!etat.MARKET,
    jambes,
    suggestionsArret: etat.MARKET ? journeyStopSuggestions() : null,
    generation: journeyGen,
  }), { synchrone: true });

  renderJourneyRecap({ n, totalProfit, totalScu, totalFees, systems: new Set(stations.map((s) => s.system)).size });
  renderJourneyMap();
  // SYNCHRONES, les quatre : `ajusterRangeeVoyage` MESURE les hauteurs juste en dessous
  // (`getBoundingClientRect`) pour décider d'empiler les colonnes. Un rendu React groupé les lui
  // ferait lire AVANT peinture — la carte basculait de 1172 px à 640 px de large selon l'état,
  // et la bascule s'inversait à l'état suivant. L'ancien `innerHTML` était synchrone ; on le reste.
  renderSoute(true);
  renderEntrepots(true);
  ajusterRangeeVoyage(); // après la carte ET la soute : les deux pèsent sur l'équilibre des colonnes
}

// Récap du voyage (colonne de gauche, sous le vaisseau) : remplit l'espace avec des KPIs utiles.
function renderJourneyRecap({ n, totalProfit, totalScu, totalFees, systems }) {
  const recap = $("journeyRecap");
  if (!recap) return;
  recap.hidden = false;
  peindre(recap, recapVoyage({
    n, totalProfit, totalScu, totalFees, systems,
    materials: etat.MARKET ? journeyCarriedCommodities().size : 0,
    marchePret: !!etat.MARKET,
  }), { synchrone: true });
}

// ---------- La tournée d'écoulement : la huitième vue (ADR-007, #57) ----------
// « Comment me débarrasser d'une soute que je ne veux plus porter ? » — l'AUTRE question, celle
// qu'« où écouler » ne pose pas. Les deux vues coexistent parce que les deux classements sont
// incompatibles, et l'écran doit le dire : sans ça l'app se contredit sous les yeux de
// l'utilisateur, qui lit deux ordres opposés du même fret.


// ---------- Plan de vol : la vue de conclusion (ADR-004) ----------
// Une CONCLUSION, pas un tableau de bord : on y arrive une fois tout paramétré, pour REGARDER le
// résultat. Rien n'y est actionnable — pas un bouton de vente, pas un ✕, pas un champ. Les gestes
// vivent dans les six vues de recherche, et le bandeau (masqué ici, et ici seulement) les y porte.

// Les quatre réglages qui ne FILTRENT pas mais changent le SENS des chiffres (ADR-004 §6). La soute
// donne la place libre ; l'autoload décide si les profits sont nets ou bruts, et son état n'est
// autrement lisible que sur une case à cocher — masquée ici. Les taire rendrait la conclusion
// silencieusement ambiguë : on lirait un profit sans savoir s'il est net.

// Le récapitulatif EN TEXTE (ADR-004 §8). Pas une image : la CSP pose `img-src 'self' https:` sans
// `data:`, ce qui bloque le procédé habituel (<foreignObject> sérialisé en data: URI). Et le texte
// se colle partout, se cite ligne par ligne dans un salon, et survit aux thèmes.
function copierPlan() {
  const d = planData();
  const lignes = [`Plan de vol — ${planHypotheses(d.f).join(" · ")}`];
  if (d.stations.length) {
    lignes.push(`Parcours : ${d.stations.map((s) => `${s.name} (${s.system})`).join(" → ")}`);
    d.jambes.forEach((j) => {
      lignes.push(`${j.i + 1}. ${j.from} → ${j.to}  ${fmt(j.scu)} SCU  ${signe(j.profit, fmtFee(j.profit, j.fees))} aUEC${j.courante ? "  <- ici" : ""}`);
      j.lines.forEach((l) => lignes.push(`     ${fmt(l.units)} SCU  ${l.name}`));
    });
  } else {
    lignes.push("Parcours : aucun voyage engagé.");
  }
  if (d.groupes.length) {
    lignes.push(`Soute : ${d.groupes.map((g) => `${fmt(g.units)} SCU ${g.name}`).join(" · ")}`);
    lignes.push(`        ${fmt(d.scu)} SCU à bord${d.libre != null ? ` · ${fmt(d.libre)} libres` : ""} · capital engagé ${fmt(d.invest)} aUEC`);
  }
  const n = etat.JOURNEY ? etat.JOURNEY.legs.length : 0;
  lignes.push(`Total : ${n} saut${n > 1 ? "s" : ""} · ${fmt(d.totalScu)} SCU · ${signe(d.totalProfit, fmtFee(d.totalProfit, d.totalFees))} aUEC`);
  copierTexte(lignes.join("\n"), $("planCopy"), "⧉ Copier le récapitulatif");
}

// Bascule intelligente : si la carte Voyage est bien plus haute que ce qui l'accompagne
// (voyage long / jambe dépliée), on empile en pleine largeur pour supprimer le grand vide.
// La carte du parcours ne compte PLUS dans cette mesure : elle a quitté la rangée pour le Plan de
// vol (ADR-004 §4), où elle occupe toute la largeur. Tant qu'elle était la troisième colonne, il
// fallait la mesurer — c'était souvent elle qui remplissait le vide. Il ne reste que la colonne de
// gauche, et le bandeau est de toute façon masqué dans la vue où vit désormais la carte.
// À appeler APRÈS le rendu des cartes : mesurées avant, elles sont encore masquées (ou à leur
// taille du rendu précédent) et la rangée s'empilait sur une hauteur qui n'existait plus.
// Mesure synchrone (getBoundingClientRect force le reflow) -> fiable même onglet non peint.
function ajusterRangeeVoyage() {
  const row = $("shipJourneyRow"), jc = $("journeyCard"), vl = $("voyageLeft");
  if (!row || !jc || !vl || jc.hidden) return;
  row.classList.remove("stacked"); // mesure toujours dans la disposition côte-à-côte de base
  const h = (el) => (el && !el.hidden ? el.getBoundingClientRect().height : 0);
  if (h(jc) > h(vl) + 140) row.classList.add("stacked");
}

// Bascule entre les vues et rafraîchit la bonne.
// Regroupe les appels rapprochés en un seul, à la fin de la salve.
const debounce = (fn, ms = 150) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function refresh() {
  // « En route » est la DERNIÈRE vue d'onglet encore peinte ici. Les sept autres vivent dans
  // l'arbre et se réévaluent seules au `notifier()` de la fin — chacune sous sa propre garde de
  // vue, donc sans que celle qu'on ne regarde pas ne coûte rien (ADR-012 §3).
  if (etat.view === "enroute") renderEnRoute();
  // La carte Voyage est affichée À CÔTÉ des tableaux, dans toutes les vues : la laisser hors du
  // cycle de rendu la figeait sur l'état d'avant. Corriger un prix ne mettait donc pas à jour les
  // bénéfices du voyage — alors qu'une jambe non ajustée est justement, par contrat, branchée sur
  // le marché et sur les filtres (cf. README). Le coût est celui d'un manifeste par jambe, sur un
  // parcours qui en compte une poignée ; les champs à saisie libre passent déjà par un debounce.
  if (etat.JOURNEY) renderJourney();
  // Effacer le parcours NE VIDE PAS la soute (c'est le contrat, cf. README), et le fret DÉPOSÉ y
  // survit de même : hors du cycle de rendu, la place libre, « où écouler », le prix du bouton de
  // vente et les entrepôts restaient figés pendant que les tableaux d'à côté suivaient les filtres.
  // On appelle les deux rendus DIRECTEMENT plutôt que renderJourney() : la branche « sans voyage »
  // de celui-ci réécrit l'invite « Nouveau voyage », donc détruirait le champ #journeyStart en
  // cours de saisie (texte et focus) à chaque frappe faite ailleurs dans l'app. Le coût est nul
  // quand il n'y a rien : les deux sortent tout de suite en masquant leur carte.
  else { renderSoute(); renderEntrepots(); }
  saveState();
  // La propagation vers `etat.ts` (ADR-011). Elle est APPELÉE, jamais déclenchée par une écriture :
  // des références vives sortent de l'état et sont mutées dehors (`legIntent`), et `logic.ts` mute
  // `OVERRIDES` en place pendant le rendu — aucun accesseur ne les verrait. Voir l'en-tête d'etat.ts.
  notifier();
}
const refreshDebounced = debounce(refresh);

function switchView(v) {
  etat.view = v;
  $("viewRoutes").classList.toggle("active", v === "routes");
  $("viewLoops").classList.toggle("active", v === "loops");
  $("viewEnroute").classList.toggle("active", v === "enroute");
  $("viewChain").classList.toggle("active", v === "chain");
  $("viewCorrections").classList.toggle("active", v === "corrections");
  $("viewCommodities").classList.toggle("active", v === "commodities");
  $("viewPlan").classList.toggle("active", v === "plan");
  $("viewTour").classList.toggle("active", v === "tour");
  $("routes").hidden = v !== "routes";
  $("loops").hidden = v !== "loops";
  $("enroute").hidden = v !== "enroute";
  $("enrouteControls").hidden = v !== "enroute";
  $("chainControls").hidden = v !== "chain";
  $("chainOut").hidden = v !== "chain";
  $("correctionsControls").hidden = v !== "corrections";
  $("corrections").hidden = v !== "corrections";
  $("commoditiesControls").hidden = v !== "commodities";
  $("commodities").hidden = v !== "commodities";
  $("plan").hidden = v !== "plan";
  $("tourControls").hidden = v !== "tour";
  $("tour").hidden = v !== "tour";
  // Les deux blocs jusqu'ici PERMANENTS, que seule la vue de conclusion masque (ADR-004 §4 et §6).
  // La barre de filtres : on ne change rien au voyage depuis le Plan de vol, l'y laisser ferait
  // croire le contraire. Le bandeau : ses cartes sont éditables (✕ du parcours, vente en soute) et
  // c'est tout ce que cette vue n'est pas — le Plan de vol le remplace par un récapitulatif inerte.
  // Aucune valeur n'est touchée : les deux reviennent intacts au retour dans une vue de recherche.
  $("controls").hidden = v === "plan";
  $("shipJourneyRow").hidden = v === "plan";
  if (v !== "enroute") $("manifest").hidden = true;
  if (v === "chain" || v === "corrections" || v === "commodities" || v === "plan" || v === "tour") $("empty").hidden = true;
  refresh();
}

// Trier est une action à part entière : une souris ne doit pas être la seule façon de la déclencher.
// Même patron clavier que les valeurs corrigeables (`.editv`) : le clic et Entrée/Espace passent par
// le MÊME corps, et `tabindex` est posé ici si index.html ne l'a pas fait. Pas de `role="button"`
// ici, contrairement à `.editv` : il écraserait le rôle `columnheader` du <th>, seul rôle sur lequel
// `aria-sort` veut dire quelque chose — on perdrait l'annonce de la colonne triée en la corrigeant.
function sortableHeader(th, apply) {
  if (!th.hasAttribute("tabindex")) th.tabIndex = 0;
  th.addEventListener("click", apply);
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apply(); } // Espace ne doit pas défiler la page
  });
}

function setupSort() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    sortableHeader(th, () => {
      const key = th.dataset.sort;
      if (etat.sortKey === key) etat.sortDir *= -1;
      else {
        etat.sortKey = key;
        etat.sortDir = key === "commodity" ? 1 : -1;
      }
      applySortIndicators(); // classes ET aria-sort, pour les deux tables
      saveState();
      notifier(); // rendu CIBLÉ : il ne passe pas par `refresh()`, il propage lui-même
    });
  });
}

function setupLoopSort() {
  document.querySelectorAll("th[data-sort-loop]").forEach((th) => {
    sortableHeader(th, () => {
      const key = th.dataset.sortLoop;
      if (etat.loopSortKey === key) etat.loopSortDir *= -1;
      else { etat.loopSortKey = key; etat.loopSortDir = -1; }
      applySortIndicators();
      saveState();
      notifier(); // la vue Boucles vit dans l'arbre : la propagation suffit, hors `refresh()`
    });
  });
}

// Autocomplétion maison, partagée par le champ Vaisseau et le sélecteur de station (ADR-003).
// Un `<datalist>` natif ne se met pas en forme et cale sa liste sur la largeur du champ : les noms
// de station y sont tronqués (jusqu'à 33 caractères pour « Terra Gateway (Stanton) — Stanton »).
//
// Trois généralisations par rapport à l'autocomplétion vaisseau dont elle est tirée, chacune
// indispensable au sélecteur de station :
//   1. `options` est une FONCTION relue à chaque ouverture, et non un tableau capturé au montage :
//      les vaisseaux existent dès le départ, les stations seulement après market.json.
//   2. la navigation passe par `li[data-i]` et non par `list.children`. Des en-têtes de groupe
//      brisent la bijection enfants ↔ résultats : sans ce filtre, la 3e flèche bas poserait
//      `.active` sur un en-tête non sélectionnable et Entrée choisirait la mauvaise station.
//   3. `rendu` reçoit le tableau ENTIER et rend le HTML en bloc, ce qui permet d'intercaler
//      ces en-têtes.
// `max: 0` = pas de plafond (les 114 stations tiennent ; les vaisseaux, eux, se coupent à 12).
function montePicker({ input, list, options, filtre, rendu, choisir, max = 12 }) {
  let matches = [];
  let active = -1;
  const items = () => [...list.querySelectorAll("li[data-i]")];

  function hide() {
    list.hidden = true;
    list.innerHTML = "";
    active = -1;
    input.setAttribute("aria-expanded", "false");
  }

  // q vide -> toute la liste (parcours au focus) ; sinon filtre par sous-chaîne.
  function show(q) {
    const tout = options() || [];
    const pool = q ? tout.filter((o) => filtre(o, q)) : tout;
    matches = q && max > 0 ? pool.slice(0, max) : pool;
    if (!matches.length) return hide();
    active = 0;
    list.innerHTML = rendu(matches);
    highlight();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function highlight() {
    items().forEach((li, i) => li.classList.toggle("active", i === active));
    items()[active]?.scrollIntoView({ block: "nearest" });
  }

  function valide(o) {
    if (!o) return;
    hide();
    choisir(o);
  }

  input.addEventListener("input", () => show(input.value.trim().toLowerCase()));
  input.addEventListener("focus", () => show(input.value.trim().toLowerCase()));

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, matches.length - 1);
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      valide(matches[active]);
    } else if (e.key === "Escape") {
      hide();
    }
  });

  // mousedown (et non click) pour devancer le blur du champ.
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]"); // les en-têtes de groupe n'en portent pas : inertes
    if (!li) return;
    e.preventDefault();
    valide(matches[Number(li.dataset.i)]);
  });

  input.addEventListener("blur", () => setTimeout(hide, 150));
  return { hide, show };
}

// Charge les vaisseaux et branche leur autocomplétion.
async function loadShips() {
  const ships = await fetch("data/ships.json").then((r) => r.json()).catch(() => []);
  // Tri par capacité de soute décroissante : les plus gros haulers apparaissent en premier.
  ships.sort((a, b) => b.scu - a.scu);
  const input = $("ship");
  const list = $("shipList");
  const byName = new Map(ships.map((s) => [s.name.toLowerCase(), s.scu]));

  function showCard(s) {
    const card = $("shipCard");
    const img = $("shipImg");
    const wrap = img.parentElement;
    // N'accepte que des URL https:// (le flux communautaire pourrait contenir autre chose).
    if (s.photo && /^https:\/\//i.test(s.photo)) {
      wrap.style.display = "";
      img.onerror = () => (wrap.style.display = "none"); // masque si l'image échoue
      img.alt = s.name;
      img.src = s.photo;
    } else {
      wrap.style.display = "none";
    }
    $("shipCardName").textContent = s.name;
    $("shipCardScu").innerHTML = `Soute : <b>${s.scu.toLocaleString("fr-FR")} SCU</b>`;
    card.hidden = false;
  }

  // Affiche la carte du vaisseau déjà présent dans le champ (ex. après restauration d'état).
  showShipCard = () => {
    const s = ships.find((x) => x.name.toLowerCase() === input.value.trim().toLowerCase());
    if (s) showCard(s);
  };

  montePicker({
    input, list,
    options: () => ships,
    filtre: (s, q) => s.name.toLowerCase().includes(q),
    rendu: (m) => m.map((s, i) =>
      `<li role="option" data-i="${i}"><span>${esc(s.name)}</span>` +
      `<span class="scu">${s.scu.toLocaleString("fr-FR")} SCU</span></li>`).join(""),
    choisir: (s) => {
      input.value = s.name;
      $("cargo").value = s.scu;
      showCard(s);
      refresh();
    },
  });

  // Modifier la soute à la main efface le nom du vaisseau et la carte.
  $("cargo").addEventListener("input", () => {
    const scu = byName.get(input.value.trim().toLowerCase());
    if (String(scu) !== $("cargo").value) {
      input.value = "";
      $("shipCard").hidden = true;
    }
  });
}

// ---------- Persistance & permaliens ----------
// L'état (filtres, tri, vue, vaisseau) est sauvé dans localStorage ET encodé dans le
// hash de l'URL, pour reprendre là où on s'est arrêté et partager une vue précise.
// `alk` = coefficient d'autoload global : partageable, comme tous les réglages. Les relevés PAR
// STATION, eux, restent locaux — c'est la même frontière que pour les corrections de prix.
// Positionne l'indicateur ▾/▴ sur la bonne colonne des deux tables.
// La flèche est un `::after` CSS accroché aux classes : elle n'existe pas pour un lecteur d'écran.
// `aria-sort` DOUBLE donc les classes (il ne les remplace pas, le CSS s'en sert) sur les seules
// colonnes triables — le poser sur un <th> décoratif annoncerait une colonne triable qui ne l'est pas.
function applySortIndicators() {
  document.querySelectorAll("#routes th, #loops th").forEach((h) => {
    h.classList.remove("sorted-asc", "sorted-desc");
    if (h.dataset.sort || h.dataset.sortLoop) h.setAttribute("aria-sort", "none");
  });
  if (safeKey(etat.sortKey)) {
    const th = document.querySelector(`#routes th[data-sort="${etat.sortKey}"]`);
    if (th) {
      th.classList.add(etat.sortDir === -1 ? "sorted-desc" : "sorted-asc");
      th.setAttribute("aria-sort", etat.sortDir === -1 ? "descending" : "ascending");
    }
  }
  if (safeKey(etat.loopSortKey)) {
    const th = document.querySelector(`#loops th[data-sort-loop="${etat.loopSortKey}"]`);
    if (th) {
      th.classList.add(etat.loopSortDir === -1 ? "sorted-desc" : "sorted-asc");
      th.setAttribute("aria-sort", etat.loopSortDir === -1 ? "descending" : "ascending");
    }
  }
}

async function copyShareLink() {
  const str = saveState();
  const btn = $("share");
  try {
    await navigator.clipboard.writeText(shareURL(str));
    const prev = btn.textContent;
    const prevLabel = btn.getAttribute("aria-label");
    btn.textContent = "✓ Lien copié";
    // L'aria-label PRIME sur le contenu : sans ce miroir, le retour de copie n'existerait que pour
    // les voyants, le nom accessible restant figé sur « Partager — … ».
    btn.setAttribute("aria-label", "✓ Lien copié");
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.setAttribute("aria-label", prevLabel);
      btn.classList.remove("copied");
    }, 1500);
  } catch {
    // Presse-papiers indisponible (contexte non sécurisé) : on laisse l'URL dans la barre.
  }
}

// L'édition en place vit désormais dans `ValeurEditable` (vues/communs.tsx), qui la gère PAR SON
// ÉTAT. `startEdit` la faisait en mutant le span (`replaceChildren`) depuis une délégation posée
// sur `document` : c'est la seule situation où les deux modèles se contredisaient vraiment. Les
// trois comportements qu'elle avait durement acquis — consulter n'écrit rien, Échap ne re-rend
// pas la vue, le ✎ reste DANS le span — sont portés par le composant, et couverts par
// `e2e/edition.pw.mjs`.

// `updateOvBadge` est passée dans `corrections-actions.ts`. Elle y reste impérative : le nœud
// qu'elle touche est dans le RAIL, qu'aucun portail ne possède (ADR-012).

function resetAllOverrides() {
  if (!ovCount()) return;
  if (!confirm("Effacer toutes tes corrections locales de prix et de stock ?")) return;
  resetOverrides();
  updateOvBadge();
  refresh();
}

// Enregistre un relevé de tarif d'autoload pour la station affichée. On mémorise le montant et la
// quantité observés en plus de `k` : c'est la MESURE qui fait foi, `k` n'en est que la lecture — si
// la grille change à un patch, un relevé conservé reste réinterprétable.
function saveStationReading() {
  const S = indexStationExacte();
  if (S == null) return;
  const t = etat.MARKET.terminals[S];
  const amount = Number($("alAmount").value);
  const scu = Math.floor(Number($("alScu").value));
  const k = kFromReading(amount, scu, t.maxBox);
  if (k == null) { showToast("⚠ Relevé inutilisable — indique le montant payé et la quantité chargée"); return; }
  // Un montant tapé à côté (un zéro de trop) donne un k d'apparence honnête, qu'on persiste et
  // qu'on réaffiche « (relevé) » — il se lit alors comme une mesure fiable tout en multipliant les
  // frais de cette station dans toutes les vues. Hors des bornes plausibles on DEMANDE, on ne
  // refuse pas : un relevé surprenant reste une mesure, et c'est l'utilisateur qui l'a faite.
  // Le message montre le montant tel qu'il a été compris et le compare aux deux tarifs connus :
  // sans ce repère, « k = 1 413 » ne dit pas à quel point c'est absurde.
  if (!kPlausible(k) && !confirm(
    `${fmt(amount)} aUEC pour ${fmt(scu)} SCU à ${t.name}, c'est ×${kFmt(k)} le tarif d'Endgame.\n` +
    `Les deux seules stations mesurées valent ×1 et ×1,4. Un zéro de trop ?\n\nEnregistrer ce relevé quand même ?`
  )) return;
  etat.AUTOLOAD_K[alKey(t.name)] = { k, amount, scu };
  saveAutoloadK();
  refresh();
}
function forgetStationReading(key) { delete etat.AUTOLOAD_K[key]; saveAutoloadK(); refresh(); }
function resetAllReadings() {
  if (!Object.keys(etat.AUTOLOAD_K).length) return;
  if (!confirm("Oublier tous tes relevés de tarif d'autoload ?")) return;
  etat.AUTOLOAD_K = {};
  saveAutoloadK();
  refresh();
}

// ---------- Vue « Corrections » : liste + édition par station ----------
// `resolveStation` et la globale `stationSel` sont remplacées par `indexStationExacte()`
// (marche.ts) : la station se dérive du champ à chaque lecture, au lieu d'être mise en cache par
// une fonction de rendu. Voir marche.ts pour pourquoi ce n'est pas `resolveStationLabel`.

// `stationFeeHTML` et `autoloadListHTML` sont passées dans `vues/frais-station.tsx` : c'étaient
// les DEUX DERNIÈRES fonctions de vue rendant des chaînes HTML. Leur garde de signature part avec
// elles — React ne réécrit pas un champ non contrôlé qu'il réconcilie (ADR-012).



// Tableau éditable des commodités d'une station (prix/stock à l'achat, prix/demande à la vente).
// `stationTableHTML` a été remplacé par vues/corrections.tsx.
// Bandeau COLLANT de la station affichée : sa photo, son nom, sa zone, son code, et ce qu'on y a
// corrigé. Il remplace la ligne de titre, qui sortait de l'écran au premier coup de molette — après
// quoi plus rien ne disait quelle station on éditait, au milieu de 92 tuiles.
// `stationHeroHTML` a été remplacé par vues/corrections.tsx.
// Retour à la valeur UEX d'un chiffre corrigé. Contrôle DÉDIÉ, posé dans la tuile et hors du
// `.editv` : celui-ci porte déjà `role="button"`, et y imbriquer un second bouton serait invalide en
// ARIA — tandis que sortir le `✎` casserait la restauration de startEdit (qui mémorise puis rejoue
// les childNodes du span) et l'assertion qui la couvre. Il annonce la valeur vers laquelle il
// ramène : c'est ce que l'ancienne liste plate ne montrait jamais.
// `retourUEX` a été remplacé par vues/corrections.tsx.
// La bande : une vignette par station corrigée, la station affichée épinglée en tête. C'est elle qui
// remplace la liste plate — vingt corrections y tenaient en 900 px, elles tiennent ici en une rangée.
// `correctionsIndexHTML` a été remplacé par vues/corrections.tsx.
// Les corrections, en JSON daté, dans le presse-papiers. Du JSON et non du texte libre — celui-ci
// est fait pour être RELU (cf. relireCorrections), et une correction qu'on ne peut pas dater est
// une correction qu'on réappliquerait aveuglément des semaines plus tard.
function copierCorrections() {
  copierTexte(JSON.stringify(exporterCorrections(etat.OVERRIDES, nowSec()), null, 2), $("exportCorrections"), "⧉ Exporter");
}






// `renderCorrections`, `tuilesStation` et `groupesCorrections` sont passées dans
// `vues/corrections-vue.tsx` : la vue vit dans l'arbre (ADR-012).


// ---------- Vue « Commodités » ----------
// `marginTier` est passée dans `logic.ts` sous le nom `palierMarge`, avec le maximum en PARAMÈTRE
// au lieu de la globale `commMaxMargin` — et donc testable unitairement, ce qu'elle n'était pas.

// Toute la vue Commodités vit désormais dans `vues/commodites-vue.tsx` : la grille, le détail et
// l'aide y sont rendus par UN composant, dans trois portails (ADR-012 §3). Sont partis d'ici :
// `paintCommodityDetail`, `syncCommBoardUI`, `setCommBoard`, `setCommSort`, `sortCommodities`,
// `peindreGrilleCommodites` et `renderCommodities` — plus les cinq caches de rendu du board, qui
// n'avaient aucun lecteur ailleurs et sont devenus des variables locales du composant.

// Grise le champ soute/budget quand sa contrainte est désactivée.
function syncToggles() {
  const cargoOff = !$("useCargo").checked;
  const budgetOff = !$("useBudget").checked;
  $("cargo").disabled = cargoOff;
  $("ship").disabled = cargoOff;
  $("budget").disabled = budgetOff;
  // Multi-commodité : remplir la soute n'a pas de sens sans soute bornée -> coche grisée.
  $("multiCommodity").disabled = cargoOff;
  $("multiCommodityLabel").classList.toggle("disabled", cargoOff);
  // Frais d'autoload : le coefficient global n'a de sens que l'interrupteur actif -> champ masqué
  // sinon (il reste dans l'état, donc dans le lien). La coche, elle, n'est PAS grisée sans soute :
  // le budget ou le plafond de stock bornent aussi le volume, et un volume borné suffit à facturer.
  $("alkField").hidden = !$("autoload").checked;
  // Portée de la liste multi : ne se règle que si la liste multi existe.
  $("multiModeField").hidden = !$("multiCommodity").checked;
}

async function init() {
  // Les deux crochets du chargement : `donnees.ts` sait charger, il ne sait rien des `<datalist>`
  // ni des messages. `setupEnRoute` DOIT tourner avant chaque rappel de `withMarket` — le déclarer
  // ici une fois vaut mieux que de le répéter à seize appels.
  brancher({ apresMarche: setupEnRoute, signalerIndisponible: marketUnavailable });
  // Le crochet de rendu : c'est ce qui rend `refresh()` joignable depuis un module, et donc depuis
  // une vue de l'arbre qui porte une ACTION. `notifier()` seule ne suffirait pas — elle ne rejoue
  // ni la carte du voyage, ni la soute, ni `saveState()`. Voir l'en-tête de `rendu.ts`.
  brancherRendu({ rafraichir: refresh });
  // La racine unique. Elle s'abonne à `etat` : à partir d'ici, une vue qui y vit se re-rend
  // toute seule à chaque `notifier()`, sans que `refresh()` ait à la nommer.
  monterRacine();
  setupSort();
  setupLoopSort();
  applySortIndicators(); // aria-sort/classes du tri par défaut, sans dépendre des attributs du HTML
  // Les champs à SAISIE LIBRE sont débouncés : sans ça, chaque caractère relançait un cycle
  // complet calcul + réécriture de #rows par innerHTML. Mesuré à ~142 ms par frappe sur un CPU
  // throttlé ×4 (le coût dominant est le relayout de la table, pas le calcul : ~2 ms), soit plus
  // d'une seconde de thread bloqué pour taper « Laranite », et deux recalculs sur des valeurs
  // absurdes quand on tape « 696 » dans la soute (6 puis 69 SCU).
  // Menus et cases à cocher restent IMMÉDIATS : ils n'émettent qu'un seul événement.
  ["cargo", "budget", "search", "alk"].forEach((id) => $(id).addEventListener("input", refreshDebounced));
  ["system", "freshness", "sameSystem", "noOutpost", "legalOnly", "capStock", "multiMode"].forEach((id) =>
    $(id).addEventListener("input", refresh)
  );
  // Ces deux-là commandent en plus l'affichage de leur propre sous-réglage (coefficient k, portée
  // de la liste multi) : ils passent donc par syncToggles avant de recalculer.
  ["autoload", "multiCommodity"].forEach((id) =>
    $(id).addEventListener("input", () => { syncToggles(); refresh(); })
  );
  ["useCargo", "useBudget"].forEach((id) =>
    $(id).addEventListener("change", () => {
      syncToggles();
      refresh();
    })
  );
  $("viewRoutes").addEventListener("click", () => switchView("routes"));
  $("viewLoops").addEventListener("click", () => switchView("loops"));
  $("viewEnroute").addEventListener("click", () => switchView("enroute"));
  $("viewChain").addEventListener("click", () => switchView("chain"));
  $("viewCorrections").addEventListener("click", () => switchView("corrections"));
  $("viewCommodities").addEventListener("click", () => switchView("commodities"));
  $("viewPlan").addEventListener("click", () => switchView("plan"));
  $("viewTour").addEventListener("click", () => switchView("tour"));
  // Terminal à SAISIE LIBRE (datalist, mais rien n'oblige à choisir dedans) : même debounce que
  // #origin et #indexDepartChaine(), faute de quoi chaque frappe re-rendrait ET réécrirait le hash.
  $("tourFrom").addEventListener("input", refreshDebounced);
  $("tourScope").addEventListener("input", refresh); // <select> : un seul événement, immédiat
  // La marque ramène à TRAJETS, la vue principale — pas au Plan de vol (ADR-004 §5). Un <button>
  // natif : Entrée et Espace y viennent sans rien ajouter.
  $("brandHome").addEventListener("click", () => switchView("routes"));
  // Copie du récapitulatif : écouteur DÉLÉGUÉ sur `#planHead`, que React repeint à chaque rendu.
  // Posé sur le CONTENEUR et non sur le bouton, il survit donc aux rendus — même règle qu'avant,
  // pour une autre raison (c'était `renderPlan` qui réécrivait, c'est l'arbre maintenant).
  $("planHead").addEventListener("click", (e) => {
    if (e.target.closest("#planCopy")) copierPlan();
  });
  $("share").addEventListener("click", copyShareLink);
  // Contrôles « Commodités » : modes de tri + sélection d'une tuile.
  $("commSortModes").addEventListener("click", (e) => { const b = e.target.closest("button[data-sort]"); if (b) setCommSort(b.dataset.sort); });
  $("commBoardModes").addEventListener("click", (e) => { const b = e.target.closest("button[data-board]"); if (b) setCommBoard(b.dataset.board); });
  // La délégation sur `#commGrid` est partie avec la vue : la tuile est un vrai `<button>`, elle
  // porte donc son propre `onClick`. La laisser doublerait l'action, ce que seul le compteur de
  // propagations aurait vu. Les deux au-dessus restent : leurs `<div>` sont du markup d'index.html
  // qu'aucun portail ne possède, et leurs boutons sont statiques (ADR-012 §2).
  // Contrôles « En route ». Ces champs de terminal sont eux aussi à SAISIE LIBRE (datalist, mais
  // rien n'oblige à choisir dans la liste) : même debounce que ci-dessus. Sans lui, chaque frappe
  // re-rendait la vue ET réécrivait le hash — or WebKit plafonne history.replaceState à 100 appels
  // par 10 s : taper deux noms de terminal suffisait à le franchir. Les résolveurs restent DANS le
  // rappel, donc dans le même ordre qu'avant ; renderEnRoute / renderChain / renderCorrections les
  // rejouent de toute façon avant de peindre.
  $("origin").addEventListener("input", debounce(refresh));
  $("destSystem").addEventListener("input", refresh); // <select> : un seul événement, immédiat
  $("destTerminal").addEventListener("input", refreshDebounced); // terminal d'arrivée forcé
  // Contrôles « Chaîne ».
  $("chainOrigin").addEventListener("input", debounce(refresh));
  $("hops").addEventListener("input", refresh);
  // Contrôles « Corrections » : recherche de station + suppression / reset (délégué).
  // Ne re-rend QUE si la station résolue a CHANGÉ. Le sélecteur, lui, rend immédiatement au choix :
  // sans ce garde, le rendu différé du debounce arrivait ~300 ms après et refaisait le même écran
  // pour rien — en détachant au passage l'éditeur d'un chiffre ouvert entre les deux. Même famille
  // que #24 : tout re-rendu gratuit de cette vue efface une saisie en cours.
  $("station").addEventListener("input", debounce(() => {
    const avant = derniereStation;
    memoriserStation();
    if (derniereStation !== avant) refresh();
  }));
  $("corrections").addEventListener("click", (e) => {
    // Les relevés d'autoload se testent AVANT les corrections : leur ✕ porte aussi `.corr-del`
    // (même bouton à l'écran) et tomberait sinon dans la branche qui écrit dans OVERRIDES.
    const alDel = e.target.closest(".al-del");
    if (alDel) { forgetStationReading(alDel.dataset.key); return; }
    // Vignette de la bande : recharge sa station. Écrit le LIBELLÉ CANONIQUE, comme le sélecteur —
    // la résolution est exacte, et c'est ce libellé-là que le permalien transporte.
    const tuile = e.target.closest(".stn-tile");
    if (tuile && !tuile.disabled) {
      const t = termByName.get(tuile.dataset.terminal);
      if (t) { $("station").value = stationLabel(t.name, t.system); memoriserStation(); refresh(); saveState(); }
      return;
    }
    // Retour à la valeur UEX d'un chiffre corrigé.
    const undo = e.target.closest(".scomm-undo");
    if (undo) {
      const { c, t: term, s: side, f: field } = undo.dataset;
      // Rendre son stock à UEX reste un changement de volume : sans ce gel, un voyage déjà planifié
      // se rebattrait tout seul. Même règle que startEdit et que l'ancien ✕ de la liste plate.
      if (field === "vol") pinLegsForVolume(c, term, side);
      const o = etat.OVERRIDES[ovKey(c, term, side)];
      setOverride(c, term, side, field, null, o ? o.base : 0);
      updateOvBadge();
      refresh();
      return;
    }
    // Efface les corrections de la SEULE station affichée (bouton du bandeau).
    if (e.target.closest("#stnClear")) {
      const S = indexStationExacte();
      const nom = S != null ? etat.MARKET.terminals[S].name : null;
      if (nom) {
        for (const k of Object.keys(etat.OVERRIDES)) {
          const [commodity, terminal, side] = k.split("|");
          if (terminal !== nom) continue;
          if (etat.OVERRIDES[k].vol != null) pinLegsForVolume(commodity, terminal, side);
          delete etat.OVERRIDES[k];
        }
        saveOverrides(); updateOvBadge(); refresh();
      }
      return;
    }
    // La branche `.corr-del` générique est partie : elle était MORTE. Les deux seuls producteurs de
    // cette classe (`vues/frais-station.tsx`) posent aussi `.al-del`, interceptée trois lignes plus
    // haut avec un `return`. Elle datait de la liste plate de corrections, remplacée par la bande de
    // vignettes. La garder « par prudence » rouvrirait un chemin d'écriture d'OVERRIDES qui n'existe
    // plus — et un test asserte au contraire qu'aucun `.corr-item:not(.autoload)` ne subsiste.
    if (e.target.closest("#alSave")) { saveStationReading(); return; }
    if (e.target.closest("#resetAllK")) { resetAllReadings(); return; }
    // Avant « Tout réinitialiser » ici aussi : rien ne doit s'effacer sans qu'on ait pu l'emporter.
    if (e.target.closest("#exportCorrections")) { copierCorrections(); return; }
    if (e.target.closest("#resetAll")) resetAllOverrides();
  });
  // Validation du relevé d'autoload à la touche Entrée (les deux champs sont dans le même panneau).
  $("corrections").addEventListener("keydown", (e) => {
    if ((e.target.id === "alAmount" || e.target.id === "alScu") && e.key === "Enter") { e.preventDefault(); saveStationReading(); }
  });
  // Manifeste : ajustement des SCU + ajout (suggéré ou libre) + retrait d'une ligne.
  $("manifest").addEventListener("input", (e) => {
    if (e.target.classList.contains("mqty-input")) updateManifestTotals();
  });
  $("manifest").addEventListener("click", (e) => {
    // Ici et pas dans le délégué global du compagnon. La raison d'origine a disparu avec la
    // délégation `.journey-pick` (elle lisait `pick.closest("table").id`, qui levait depuis une
    // carte) ; ce qui reste vaut toujours : cet écouteur est posé sur `#manifest`, donc il ne voit
    // que sa carte, là où le délégué global voit toute la page.
    if (e.target.closest("#manifestToJourney")) { manifestToJourney(); return; }
    if (e.target.closest("#copyManifest")) { copyManifest(); return; }
    if (e.target.closest("#manifestAddBtn")) { addManifestCommodity($("manifestAddInput").value); return; }
    if (e.target.closest("#manifestReset")) { resetManifeste(); return; }
    const del = e.target.closest(".mline-del");
    if (del) { removeManifestLine(del.dataset.name); return; }
    const add = e.target.closest(".suggest-add");
    if (add) addSuggestion(add.dataset.name);
  });
  $("manifest").addEventListener("keydown", (e) => {
    if (e.target.id === "manifestAddInput" && e.key === "Enter") { e.preventDefault(); addManifestCommodity(e.target.value); }
  });
  // Chargement d'un trajet multi-commodité : déplie/replie le manifeste sous la ligne cliquée.
  // Le dépliant (#30) n'a plus de délégation : son ouverture est un ÉTAT de `VueTrajetsMulti`, et
  // sa ligne un frère rendu par le JSX. Celle qui vivait ici injectait une `<tr>` dans `#rows` par
  // `insertAdjacentHTML` et posait `open` à la main sur un bouton rendu par React — deux écritures
  // que React ne voyait pas, donc qui survivaient à ses rendus en devenant fausses (#125).
  //
  // La garde `isMultiRoutes()` que cette délégation portait disparaît avec elle — elle existait
  // parce qu'un bouton cliqué après un retour en lignes simples indexait `shownMulti` avec le rang
  // d'un autre tableau (#25). Un rappel fermé sur SON trajet ne peut pas se tromper de tableau.
  // `isMultiRoutes` a suivi le même chemin avec le ▶ : plus personne ne demande « quel mode ? »
  // au moment du clic, puisqu'aucun bouton de CES TABLES n'a plus de rang à interpréter.
  // Carte du parcours : cliquer une escale déplace « je suis ici », comme le fil d'étapes.
  $("holdCard").addEventListener("click", (e) => {
    if (e.target.closest("#holdClear")) { viderSoute(); return; }
    if (e.target.closest("#holdOffload")) { etat.ecoulerOuvert = !etat.ecoulerOuvert; renderSoute(); return; }
    // La quantité ET la station se lisent sur le MÊME conteneur : celui que le rendu a produit.
    // `dataset.idx` absent -> undefined -> NaN -> repli sur stationCourante() ; jamais 0.
    const deposer = e.target.closest(".hold-store");
    if (deposer) { const b = deposer.closest(".hold-sell"); deposerIci(deposer.dataset.name, Number(b.querySelector(".hold-sell-qty").value), Number(b.dataset.idx)); return; }
    const ouvrir = e.target.closest(".hold-sell-btn");
    if (ouvrir) { etat.venteEnCours = ouvrir.dataset.name; renderSoute(true); $("holdCard").querySelector(".hold-sell-qty")?.select(); return; }
    if (e.target.closest(".hold-sell-no")) { etat.venteEnCours = null; renderSoute(); return; }
    const ok = e.target.closest(".hold-sell-ok");
    if (ok) { const b = ok.closest(".hold-sell"); vendreIci(ok.dataset.name, Number(b.querySelector(".hold-sell-qty").value), Number(b.dataset.idx)); return; }
    const del = e.target.closest(".hold-del");
    if (del) retirerLot(Number(del.dataset.i));
  });
  // Entrée valide la vente, Échap l'annule — même patron que les corrections inline.
  $("holdCard").addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("hold-sell-qty")) return;
    // Entrée doit encaisser à la même station que le bouton ✓ : même index figé, lu sur le conteneur.
    if (e.key === "Enter") { e.preventDefault(); vendreIci(etat.venteEnCours, Number(e.target.value), Number(e.target.closest(".hold-sell")?.dataset.idx)); }
    else if (e.key === "Escape") { e.preventDefault(); etat.venteEnCours = null; renderSoute(); }
  });
  // Déclarer « j'ai ça à bord » (#55) : le seul chemin qui fait entrer du fret sans jambe.
  $("holdDeclare").addEventListener("click", (e) => {
    if (e.target.closest("#holdAddOpen")) { ouvrirDeclaration(); return; }
    if (e.target.closest("#holdAddNo")) { fermerDeclaration(); return; }
    if (e.target.closest("#holdAddOk")) declarerABord();
  });
  // Entrée valide depuis n'importe lequel des trois champs, Échap abandonne — même patron que la
  // vente inline de la soute et que les corrections.
  $("holdDeclare").addEventListener("keydown", (e) => {
    if (!e.target.closest(".hold-add")) return;
    if (e.key === "Enter") { e.preventDefault(); declarerABord(); }
    else if (e.key === "Escape") { e.preventDefault(); fermerDeclaration(); }
  });
  // La position se résout à la frappe, DÉBOUNCÉE comme le champ de départ d'« En route » : c'est le
  // même champ derrière, et une résolution par caractère repeindrait toute la page à chaque lettre.
  // On capture la valeur tout de suite : l'événement, lui, sera périmé quand le timer se déclenchera.
  const poserPositionDifferee = debounce(poserPosition);
  $("holdDeclare").addEventListener("input", (e) => {
    if (e.target.id === "holdWhere") poserPositionDifferee(e.target.value);
  });
  // Entrepôts : « reprendre » remet le lot en soute. Un seul geste, pas de champ de quantité — on
  // reprend ce qu'on a laissé ; une reprise partielle se ferait en redéposant. La fonction pure,
  // elle, accepte déjà des SCU : l'UI pourra suivre sans la toucher.
  $("depotsCard").addEventListener("click", (e) => {
    if (e.target.closest("#copyDepots")) { copierEntrepots(); return; }
    const b = e.target.closest(".depot-take");
    if (b) reprendreIci(b.dataset.station, b.dataset.name, Number(b.dataset.units));
  });
  $("journeyMap").addEventListener("click", (e) => {
    const a = e.target.closest(".jm-arret");
    if (a) setJourneyStop(Number(a.dataset.i));
  });
  $("journeyMap").addEventListener("keydown", (e) => {
    const a = e.target.closest(".jm-arret");
    if (a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setJourneyStop(Number(a.dataset.i)); }
  });
  // Compagnon de voyage : ✕ efface le parcours, ▶ n'est plus ici.
  //
  // Le ▶ était la dernière lecture par rang DES TABLES DE TRAJETS : la délégation lisait
  // `pick.dataset.row` puis indexait l'un des quatre tableaux `shown*` selon
  // `pick.closest("table").id`. Un tableau rempli au RENDU et relu au CLIC, avec ce que ça suppose :
  // que les deux soient d'accord. Chaque îlot ferme désormais son bouton sur SA ligne.
  //
  // Le motif SURVIT ailleurs, et il faut le dire pour ne pas croire le dossier clos : la soute
  // (`retirerLot`), le fil d'étapes, la carte du parcours et surtout l'autocomplétion
  // (`matches[Number(li.dataset.i)]`) lisent tous un rang posé au rendu. Ce lot ne traite que les
  // tables de trajets.
  //
  // Trois choses partent avec la délégation : le `closest("table").id` (et son TypeError si un ▶
  // naissait hors table), le `else` fourre-tout qui faisait retomber toute table inconnue sur
  // `shownRoutes`, et la garde `isMultiRoutes()` qui rattrapait le mode déjà changé au moment du
  // clic (#25) — un rappel fermé sur SON trajet ne peut pas se tromper de tableau.
  document.addEventListener("click", (e) => {
    if (e.target.closest("#journeyClear")) { clearJourney(); return; }
    // Démarrer un voyage « de zéro » : bouton « Commencer » depuis l'invite.
    if (e.target.closest("#journeyStartBtn")) { beginJourney($("journeyStart").value); return; }
    // Ajout d'arrêt : bouton « + Arrêt » ou une suggestion.
    if (e.target.closest("#journeyAddBtn")) { addStopByTerminal($("journeyAddStop").value); return; }
    const sug = e.target.closest(".jstop-suggest");
    if (sug) { addStopByTerminal(sug.dataset.label); return; }
    // Retirer un arrêt (✕ sur une étape) -> reconnexion des voisins.
    const del = e.target.closest(".jstep-del");
    if (del) { removeJourneyStop(Number(del.dataset.i)); return; }
    // Édition du manifeste d'une jambe : déplier / retirer / ajouter / réinitialiser.
    const legSug = e.target.closest(".jman-suggest .suggest-add");
    if (legSug) { addLegSuggestion(Number(legSug.dataset.leg), legSug.dataset.name); return; }
    const legDel = e.target.closest(".jman-del");
    if (legDel) { delLegLine(Number(legDel.dataset.leg), legDel.dataset.name); return; }
    const load = e.target.closest(".jleg-load");
    if (load) { chargerJambe(Number(load.dataset.leg)); return; } // AVANT .jleg-head : le bouton y vit
    if (e.target.closest(".jman-reset")) { resetLeg(Number(e.target.closest(".jman-reset").dataset.leg)); return; }
    const addBtn = e.target.closest(".jman-add-btn");
    if (addBtn) { addLegLine(Number(addBtn.dataset.leg), addBtn.closest(".jman-add").querySelector(".jman-add-input").value); return; }
    const head = e.target.closest(".jleg-head");
    if (head) { toggleLegEditor(Number(head.dataset.leg)); return; }
    // Parcours interactif : clic sur une étape (⦿) = « je suis ici » -> recale les vues.
    const step = e.target.closest(".jstep");
    if (step) setJourneyStop(Number(step.dataset.i));
  });
  // L'en-tête d'une jambe est annoncé `role="button"` : Entrée/Espace doivent l'activer comme le clic
  // (même corps, cf. sortableHeader). On teste `e.target` LUI-MÊME et non `closest()` — modèle
  // `.editv` plutôt que `.jm-arret` : le bouton « ✓ chargé » vit DANS l'en-tête, et un closest()
  // déplierait l'éditeur EN PLUS de charger la soute à chaque Entrée sur ce bouton.
  $("journeyCard").addEventListener("keydown", (e) => {
    if (!e.target.classList || !e.target.classList.contains("jleg-head")) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); // Espace ne doit pas défiler la page
    toggleLegEditor(Number(e.target.dataset.leg));
  });
  // Ajout d'arrêt / de commodité à la touche Entrée.
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "journeyStart" && e.key === "Enter") { e.preventDefault(); beginJourney(e.target.value); }
    else if (e.target.id === "journeyAddStop" && e.key === "Enter") { e.preventDefault(); addStopByTerminal(e.target.value); }
    else if (e.target.classList && e.target.classList.contains("jman-add-input") && e.key === "Enter") { e.preventDefault(); addLegLine(Number(e.target.dataset.leg), e.target.value); }
  });
  // Précharge le marché quand on focus un champ terminal du compagnon -> peuple le datalist.
  document.addEventListener("focusin", (e) => {
    if ((e.target.id === "journeyStart" || e.target.id === "journeyAddStop") && !enrouteReady) {
      if (etat.MARKET) setupEnRoute();
      else withMarket(() => {});
    }
  });
  // SCU d'une ligne de jambe : suggestions/profit en direct à la frappe, persistance au blur/Entrée.
  document.addEventListener("input", (e) => {
    if (e.target.classList && e.target.classList.contains("jman-qty")) liveLegQty(Number(e.target.dataset.leg), Number(e.target.dataset.i), e.target);
  });
  document.addEventListener("change", (e) => {
    if (e.target.classList && e.target.classList.contains("jman-qty")) editLegQty(Number(e.target.dataset.leg), Number(e.target.dataset.i), e.target.value);
  });
  // Les deux délégations qui ouvraient l'édition (clic, Entrée/Espace) ont disparu avec
  // `startEdit` : `ValeurEditable` porte ses propres `onClick`/`onKeyDown`. Le garde `data-react`
  // qu'elles consultaient n'a plus rien à garder — mais l'attribut RESTE sur le composant, c'est
  // lui que `e2e/edition.pw.mjs` interroge pour vérifier qu'aucun `.editv` n'échappe à React.
  // Raccourcis clavier : / (recherche), 1 à 8 (vues). Ignorés pendant la saisie.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    // `role="button"` couvre d'un coup tout ce que l'app rend activable sans être un <button> :
    // l'en-tête d'une jambe, une escale de la carte, une valeur corrigeable. Sans lui, tabuler
    // jusqu'à l'un d'eux puis taper « 1 »…« 8 » changeait de vue — l'utilisateur clavier perdait son
    // contexte au moment précis où il essayait d'agir dessus.
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ||
               el.getAttribute("role") === "button" || el.classList.contains("editv"))) return;
    if (e.key === "/") { e.preventDefault(); $("search").focus(); }
    // L'ordre suit celui du rail (#45), et c'est le contrat : le numéro lu sur un bouton EST la
    // touche qui l'ouvre. Quatre destinations changent de touche — le prix payé une fois pour que
    // les deux se disent la même chose.
    else if (e.key === "1") switchView("routes");
    else if (e.key === "2") switchView("enroute");
    else if (e.key === "3") switchView("loops");
    else if (e.key === "4") switchView("chain");
    else if (e.key === "5") switchView("commodities");
    else if (e.key === "6") switchView("tour");
    else if (e.key === "7") switchView("plan");
    else if (e.key === "8") switchView("corrections");
  });
  loadOverrides();
  loadAutoloadK();
  loadJourneyEdits();
  loadJourneyPins();
  loadManifestEdit();
  loadSoute();
  loadChargements(); // après loadSoute : la migration reconstruit le registre depuis les lots
  loadDepots();
  updateOvBadge();
  syncToggles();

  // État à restaurer (URL partagée en priorité, sinon dernière session locale).
  const saved = loadState();

  try {
    const [routes, loops, meta] = await Promise.all([
      fetch("data/routes.json").then((r) => r.json()),
      fetch("data/loops.json").then((r) => r.json()).catch(() => []),
      fetch("data/meta.json").then((r) => r.json()).catch(() => null),
      loadShips(),
    ]);
    etat.ROUTES = routes;
    etat.LOOPS = loops;

    // Remplit les filtres système (achat + vente) : #system et la destination « En route ».
    const systems = [...new Set(routes.flatMap((r) => [r.buy.system, r.sell.system]))].sort();
    const sel = $("system"), dest = $("destSystem");
    systems.forEach((s) => {
      sel.appendChild(new Option(s, s));
      dest.appendChild(new Option(s, s));
    });

    if (meta) {
      const d = new Date(meta.generated_at * 1000);
      const ageH = (Date.now() / 1000 - meta.generated_at) / 3600;
      const rel = ageH < 1 ? "il y a moins d'1 h" : ageH < 24 ? `il y a ${Math.round(ageH)} h` : `il y a ${Math.round(ageH / 24)} j`;
      const stale = ageH > 6; // données rafraîchies chaque heure : au-delà de 6 h, pipeline suspect
      const tier = stale ? "f-old" : ageH < 3 ? "f-good" : "f-ok"; // couleurs de fraîcheur partagées
      const exact = d.toLocaleString("fr-FR");
      // Haut-droite : indicateur de fraîcheur uniquement.
      $("meta").innerHTML =
        `<span class="freshness-ind ${tier}" title="Données UEX du ${exact}"><span class="fi-dot"></span>Données ${rel}${stale ? " ⚠" : ""}</span>`;
      // Bas du rail (« Flux UEX ») : dernière mise à jour + compteurs.
      const rs = $("railStatus");
      if (rs) rs.innerHTML =
        `<div class="rs-updated">Dernière MàJ<br><b>${exact}</b></div>` +
        `<div class="rs-counts"><b>${meta.routes}</b> routes · <b>${meta.loops ?? etat.LOOPS.length}</b> boucles · <b>${meta.commodities}</b> commodités</div>`;
      // Version déployée, et le commit qui l'a produite. Sans ça, un rapport de bug n'est
      // rattachable à rien : on ne sait pas si l'utilisateur regarde le `main` d'il y a dix minutes
      // ou une coquille servie depuis son cache d'il y a trois semaines. Silencieux si l'estampille
      // manque — l'amorce versionnée dans data/ ne la porte pas tant qu'un build n'est pas passé,
      // et « v— » vaudrait moins que rien.
      const rv = $("railVersion");
      if (rv && meta.app_version) {
        rv.textContent = `v${meta.app_version}${meta.commit ? ` · ${meta.commit}` : ""}`;
        rv.title = `Version déployée${meta.commit ? ` — commit ${meta.commit}` : ""}. À citer dans un rapport de bug.`;
      }
    }
    // Applique l'état restauré une fois le menu système peuplé, puis affiche la bonne vue.
    // Les trois synchros d'interface restent ici ; le module les appelle DANS le verrou de
    // restauration, pour qu'aucune ne puisse resauver au milieu.
    applyState(saved, () => { applySortIndicators(); syncToggles(); refletBoardCommodites(); });
    showShipCard(); // ré-affiche la carte du vaisseau restauré (image comprise)
    // Le compagnon de voyage vient d'un permalien, donc de données non fiables. S'il échoue, il ne
    // doit pas emporter TOUTE l'app dans le catch ci-dessous, qui accuserait alors data/routes.json
    // — parfaitement chargé — et laisserait l'utilisateur devant une page vide et un message faux.
    try {
      renderJourney();
    } catch (err) {
      etat.JOURNEY = null;
      renderJourney();
      showToast("⚠ Parcours illisible dans le lien — il a été ignoré");
    }
    switchView(etat.view);
  } catch (e) {
    $("meta").textContent = "Erreur de chargement des données.";
    $("empty").hidden = false;
    $("empty").textContent = "Impossible de charger data/routes.json — lance le script de mise à jour.";
    console.error(e);
  }
}

init();

// PWA : installable + consultable hors-ligne (ignoré si non supporté / hors contexte sécurisé).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
