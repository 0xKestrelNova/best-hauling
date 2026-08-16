"use strict";

// Fonctions de calcul pures (testées par logic.test.mjs).
import {
  tripMinutes, ageDays, pairAge,
  scoreBarWidth, bySort, addableUnits, scuBoxes, cargoBoxes, bestChain,
  AUTOLOAD, autoloadFee, autoloadPoint, lineHaulFee, lineNet, kFromReading, kPlausible,
  ovKey, DUREE_VOL, groupOverridesByTerminal, safeKey, encodeState, decodeState,
  routePasses, loopPasses,
  routeMetrics, loopMetrics, enRouteDeals, bestManifest, buildChainAdjacency, suggestionsFrom, netMarginRoi,
  commoditySummaries, commodityPoints, compactValue, valueTiers, resolveCommodity, ambiguousCodes,
  manifestTotals, freeAddUnits, manifestLine, freeManifestLine, hydrateManifestLine, stationLabel, parseStationLabel, stationTree,
  multiTrips, tripMetrics, legFromTrip,
  legFromRoute, legsFromLoop, legsFromChain, legFromManifest, stopSuggestions, bestLegBetween,
  manifestJourneyState, manifestIntent, sameIntent, manifestIntentSurvives, legsToPin, journeyMap,
  loadHold, declarerLot, holdScu, freeCargo, holdByCommodity, sellFromHold, refuseHere, refusActif, migrerRefus, sellableAt, sellAllAt,
  offloadPlan, tourneesEcoulement, storeFromHold, takeFromStore, stockApres,
  startJourney, startJourneyAt, journeyStations, journeyEnd,
  journeyConnects, addToJourney, setJourneyPosition, currentLeg, journeyMargin,
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
import { fmt, fmtVol, fmtFee, signe, TEXTE_CAPACITE_INCONNUE } from "./format.ts";
import { readFilters } from "./filtres.ts";
import { effVals, loadOverrides, ovCount, relevePerimees, resetOverrides, saveOverrides, setOverride } from "./corrections.ts";
import { vueTournee, messageSouteVide, messageChargement, messageOuEsTu } from "./vues/tournee.tsx";
import { vueBoucles } from "./vues/boucles.tsx";
import { vueChaine, indiceDepart, indiceSoute, indiceAucune } from "./vues/chaine.tsx";
import { vueGrilleCommodites, aideBoard, vueDetailCommodite, inviteDetail } from "./vues/commodites.tsx";
import { vueStation, vueBandeCorrections, inviteStation } from "./vues/corrections.tsx";
import { enTetePlan, corpsPlan } from "./vues/plan.tsx";
import { vueTrajets, vueTrajetsMulti } from "./vues/trajets.tsx";
import { carteManifeste, indiceSouteInactive, indiceSoutePleine, indiceAucunChargement } from "./vues/manifeste.tsx";
import { carteSoute, carteEntrepots } from "./vues/soute.tsx";
import { carteVoyage, recapVoyage, inviteVoyage } from "./vues/voyage.tsx";
import { carteParcours } from "./vues/carte.tsx";
import { carteDeclaration } from "./vues/declaration.tsx";
import { KIND_ICON } from "./vues/communs.tsx";

// Libellé compact des caisses SCU standard, ex. « 8×32 · 1×16 · 1×4 · 1×2 · 1×1 ».
// `maxBox` = plafond de caisse du terminal de CHARGEMENT, quand on le connaît : c'est une propriété
// physique de la station, indépendante de l'interrupteur de frais. On le propage partout où le
// terminal d'achat est disponible, parce que c'est exactement la décomposition que la facture
// d'autoload utilise — un « 📦 1×32 » à côté d'un montant calculé sur deux caisses de 16 serait
// une incohérence directement visible.
const boxesLabel = (boxes) => (boxes.length ? boxes.map((b) => `${b.count}×${b.size}`).join(" · ") : "");
function scuBoxesLabel(n, maxBox) {
  return boxesLabel(scuBoxes(n, maxBox));
}
// Même libellé pour un chargement à plusieurs commodités : une caisse ne contient qu'une commodité,
// la décomposition se fait donc ligne par ligne (cargoBoxes) et jamais sur le total des SCU.
const cargoBoxesLabel = (lines, maxBox) => boxesLabel(cargoBoxes(lines, maxBox));

// État global
// Tri par défaut : le PROFIT NET par voyage (ADR-005). Le score composite classait mal — la route
// la plus rentable de l'instantané tombait au 8e rang — et le profit horaire repose sur une durée
// fictive pour 49 % des routes, faute de distance. Un montant, lui, ne ment pas.
// Vue « Commodités » : mode de tri (margin|code|kind|custom), clé/sens custom, sélection.
let shownCommodities = [];
// Board « Commodités » : "market" = marge achat→vente ; "loot" = prix de revente d'une ressource
// trouvée (le coût d'acquisition est nul, la marge n'a plus de sens).
let commTiers = new Map();
// Codes UEX portés par plusieurs commodités du board courant : leurs tuiles affichent le nom,
// sinon elles seraient rigoureusement identiques à l'écran (COPP = Copper ET Copper (Ore)).
let commDupCodes = new Set();
let commMaxMargin = 0; // marge max de la liste courante (pour colorer la heatmap en relatif)
let commCarried = new Set(); // commodités transportées au moins 1 fois dans le voyage (highlight board)
// Compagnon de voyage : parcours sélectionné { legs[], current } ou null.
// Affiche la carte du vaisseau correspondant au champ (défini par loadShips ; utilisé à la restauration).
let showShipCard = () => {};

const STATE_KEY = "best-hauling-state";

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
function lineFreshUpdated(l) {
  const b = l.buyUpdated || 0, s = l.sellUpdated || 0;
  return b && s ? Math.min(b, s) : b || s || 0;
}

// Légendes de statut d'inventaire UEX (couleurs officielles).
const BUY_STATUS = { 1: ["Vide", "red"], 2: ["Très bas", "red"], 3: ["Bas", "orange"], 4: ["Moyen", "blue"], 5: ["Élevé", "blue"], 6: ["Très élevé", "green"], 7: ["Plein", "green"] };
const SELL_STATUS = { 1: ["Forte demande", "green"], 2: ["Bonne demande", "green"], 3: ["Demande correcte", "blue"], 4: ["Demande moyenne", "blue"], 5: ["Demande faible", "orange"], 6: ["Demande très faible", "red"], 7: ["Saturé (aucune demande)", "red"] };

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
const AUTOLOAD_KEY = "best-hauling-autoload";
const K_DEFAULT = 1.2; // milieu des deux seules stations mesurées (Endgame 1,0 et Ruin 1,4)

// { "autoload|<terminal>": { k, amount, scu } } — même forme de clé et même mécanique que les
// corrections locales (localStorage, jamais partagé, jamais dans le lien), mais un STORE À PART.
// Les ranger dans OVERRIDES casserait trois consommateurs qui supposent tous qu'une clé du store
// est une correction prix/stock à TROIS segments : ovCount() les compterait dans le badge « ✎
// Corrections (n) », correctionsListHTML() lirait « autoload|<terminal> » comme commodité/terminal/
// side et rendrait une correction « vente » vide, et « Tout réinitialiser » les effacerait sans le
// dire. S'y ajoutent deux incompatibilités de fond : setInStore arrondit à l'entier (un k de 1,41
// deviendrait 1) et effValue périme une correction dès qu'UEX republie le point, alors qu'un tarif
// de manutention n'a aucune date UEX de référence et n'a donc aucune raison de périmer.
const alKey = (terminal) => `autoload|${terminal}`;
function loadAutoloadK() { try { etat.AUTOLOAD_K = JSON.parse(localStorage.getItem(AUTOLOAD_KEY)) || {}; } catch { etat.AUTOLOAD_K = {}; } }
function saveAutoloadK() { try { localStorage.setItem(AUTOLOAD_KEY, JSON.stringify(etat.AUTOLOAD_K)); } catch {} }

// Coefficient global, appliqué à toute station non relevée. Une saisie vide ou absurde retombe sur
// le défaut : `Number("")` vaut 0, et un k nul annulerait silencieusement tous les frais.
const globalK = () => { const v = Number($("alk").value); return v > 0 ? v : K_DEFAULT; };
const kFor = (terminal) => { const o = etat.AUTOLOAD_K[alKey(terminal)]; return o && o.k > 0 ? o.k : globalK(); };

// Ce qu'UNE extrémité facture. `point` est ce que consomme logic.mjs ; les autres champs servent à
// EXPLIQUER le chiffre à l'écran — « cette station ne propose pas l'autoload » et « UEX ne nous a
// pas dit si elle le propose » aboutissent au même 0 mais ne se racontent pas pareil, et aucun des
// deux ne doit se lire comme un frais oublié.
function feeEnd(name, terminal) {
  const t = terminal || termByName.get(name) || null;
  const k = kFor(name);
  return {
    name, k, point: autoloadPoint(t, k),
    known: !!t && t.autoload != null, // champ absent = instantané de market.json antérieur au build
    available: !!t && t.autoload === true,
    maxBox: t ? t.maxBox : undefined,
    measured: !!etat.AUTOLOAD_K[alKey(name)],
  };
}

// Contexte de frais d'un chargement A -> B. `null` dès que l'interrupteur est inactif, et c'est
// littéralement ce que « inactif » veut dire pour tout le moteur : sans contexte, chaque fonction
// de logic.mjs rend exactement les valeurs brutes qu'elle rendait avant que les frais n'existent.
function feeCtx(f, buyName, sellName, buyT, sellT) {
  if (!f.autoload) return null;
  // Marché pas encore chargé (premier rendu de « Trajets » / « Boucles ») : aucun terminal n'est
  // résolvable, donc aucun frais n'est calculable. On rend le brut SANS marqueur — prétendre
  // « aucune de ces stations ne facture » serait faux — et ensureFeeMarket re-rend à l'arrivée.
  if (!buyT && !sellT && !termByName.size) return null;
  const a = feeEnd(buyName, buyT), b = feeEnd(sellName, sellT);
  return { a, b, pair: { buy: a.point, sell: b.point } };
}

// Résolveur passé aux fonctions de logic.mjs qui parcourent le marché : elles découvrent leurs
// terminaux en chemin et n'ont donc aucun nom à nous donner d'avance.
const feeResolver = (f) => (f.autoload ? (t) => autoloadPoint(t, kFor(t && t.name)) : null);

// Un montant qui incorpore des frais d'autoload est une ESTIMATION : la formule colle aux 18
// relevés à 2,8 % près, et `k` varie de 40 % entre les deux seules stations mesurées. Le « ≈ » le
// dit, partout où le chiffre a été amputé.
const kFmt = (k) => k.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const kText = (e) => `×${kFmt(e.k)} ${e.measured ? "(relevé)" : "(k global)"}`;
function feeEndText(e) {
  if (!e.known) return `${e.name} : autoload inconnu (donnée UEX absente) — rien facturé`;
  if (!e.available) return `${e.name} : pas d'autoload — rien facturé`;
  return `${e.name} ${kText(e)}`;
}
// Décrit la manutention facturée, et avec quelle formule : l'infobulle doit permettre de REFAIRE le
// calcul, sinon elle explique un montant qu'elle contredit. D'où deux textes, parce qu'il y a deux
// facturations — une transaction pour un chargement à une commodité, une PAR commodité au-delà
// (hypothèse 2 de la spec), et autant de fois la base de 150.
const FEE_FORMULA = `${AUTOLOAD.base} + ${AUTOLOAD.perBox}/caisse + ${AUTOLOAD.perScu}/SCU`;
const boxCount = (boxes) => boxes.reduce((a, b) => a + b.count, 0);
function feeLoadText(scu, maxBox) {
  const n = boxCount(scuBoxes(scu, maxBox));
  return `${fmt(scu)} SCU en ${n} caisse${n > 1 ? "s" : ""}, chargement + déchargement · ${FEE_FORMULA} par opération`;
}
// Chargement MULTI-commodité : les caisses se comptent ligne par ligne (une caisse = une commodité)
// et la base est facturée par commodité. Décrire le total en une seule opération annonçait un
// nombre de caisses et une formule qui ne redonnaient pas le montant déduit.
function feeCargoText(lines, maxBox) {
  const n = boxCount(cargoBoxes(lines, maxBox));
  const scu = lines.reduce((a, l) => a + (l.units || 0), 0);
  const p = lines.length;
  return `${fmt(scu)} SCU en ${n} caisse${n > 1 ? "s" : ""} sur ${p} commodité${p > 1 ? "s" : ""}, chargement + déchargement · ${FEE_FORMULA} par commodité et par opération`;
}

// Infobulle + marqueur d'une cellule de profit soumise aux frais. `what` décrit la manutention et
// n'est appelée que si elle sert : l'interrupteur inactif est le cas courant, et ce chemin est
// parcouru une fois par ligne de tableau.
// `bounded` = la route a un volume : sans volume aucun frais n'est calculable (le profit est déjà
// « — »), et rien ne doit laisser croire à un oubli. Quand l'interrupteur est actif mais qu'aucune
// des deux stations ne facture, l'infobulle DIT pourquoi et un ⊘ discret le signale — un profit
// resté brut au milieu d'une colonne nette, sans un mot, se lit comme un bug. Le marqueur ne va que
// sur la colonne « profit » : le répéter sur « profit/heure » doublerait le bruit sans rien ajouter.
const NO_FEE_CELL = { attr: "", mark: "", text: "" };
function feeCell(ctx, fees, what, bounded) {
  if (!ctx || !bounded) return NO_FEE_CELL;
  const text = fees > 0
    ? `Frais d'autoload ≈ ${fmt(fees)} aUEC déduits — ${what()} · ${feeEndText(ctx.a)} · ${feeEndText(ctx.b)} · estimation ±3 %`
    : `Aucun frais d'autoload sur ce trajet — ${feeEndText(ctx.a)} · ${feeEndText(ctx.b)}`;
  return { attr: ` title="${esc(text)}"`, mark: fees > 0 ? "" : ' <span class="nofee">⊘</span>', text };
}
// Frais et profit NET d'une ligne de manifeste. Hypothèse 2 de la spec : une transaction PAR
// COMMODITÉ, donc chaque ligne paie sa propre base — sans quoi la somme des lignes affichées ne
// ferait pas le total affiché, l'incohérence la plus visible qui soit. Le décompte des opérations
// vit dans logic.mjs (lineHaulFee), qui sait qu'une ligne « vend ailleurs » n'est pas déchargée et
// qu'une ligne « acquis ailleurs » n'a pas été chargée : c'est la MÊME règle que manifestTotals,
// donc le total et les lignes ne peuvent pas diverger.
// `lineNet` vit dans logic.mjs : c'est une règle de décision (elle filtre les suggestions et le
// manifeste optimal), pas un détail de rendu. Signe compris — un net négatif se dit.
// Préfixe un montant de son signe RÉEL. Un « + » posé d'office écrivait « +-1 234 » dès que les
// frais mangeaient la marge, en vert, sur le seul chiffre qui disait de ne pas charger la ligne.
// Texte de la cellule « profit » d'une ligne de manifeste. Partagé par le premier rendu et par la
// mise à jour en direct : deux conventions différentes et éditer une quantité changerait le sens
// de la cellule. Une ligne « vend ailleurs » n'a pas de profit sur ce trajet — elle a quand même
// été chargée, et ce chargement, lui, est bien retranché du total.
function lineProfitText(units, l, pair) {
  const fees = lineHaulFee(units, l, pair);
  if (l.sellPrice == null) return fees > 0 ? fmtFee(-fees, fees) : "—";
  const net = lineNet(units, l, pair);
  return signe(net, fmtFee(net, fees));
}

// Flash discret quand des corrections ont été périmées par une mise à jour UEX.
let toastTimer = null;
function showToast(msg) {
  let el = $("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}
// DEUX causes de péremption, donc deux messages : dire « mise à jour UEX » à propos d'un volume qui a
// simplement vieilli serait faux, et enverrait chercher un changement de données qui n'a pas eu lieu.
// Si les deux tombent dans le même rendu, la mise à jour UEX passe en premier — c'est un fait
// extérieur, l'autre est une simple horloge.
function notifySuperseded() {
  // Le RELEVÉ vide les compteurs : appeler deux fois de suite ne redit rien. La donnée vit dans
  // `corrections.ts`, le message reste ici — c'est ce qui permet à `effVals` d'être appelée trente
  // fois au fond du rendu sans traîner `showToast` derrière elle.
  const { uex: nUex, age: nAge } = relevePerimees();
  if (!nUex && !nAge) return;
  updateOvBadge();
  const s = (n) => (n > 1 ? "s" : "");
  if (nUex) showToast(`✎ ${nUex} correction${s(nUex)} périmée${s(nUex)} par une mise à jour UEX`);
  if (nAge) {
    const h = Math.round(DUREE_VOL / 3600);
    const msg = `✎ ${nAge} volume${s(nAge)} corrigé${s(nAge)} périmé${s(nAge)} — plus de ${h} h, le comptoir s'est rempli depuis`;
    if (nUex) setTimeout(() => showToast(msg), 1200); else showToast(msg);
  }
}

// Applique les corrections à une paire buy/sell et renvoie des copies patchées + marge/roi.
function applyOverrides(commodity, buy, sell) {
  const b = effVals(commodity, buy.terminal, "buy", buy.price, buy.stock, buy.updated);
  const s = effVals(commodity, sell.terminal, "sell", sell.price, sell.demand, sell.updated);
  const nb = { ...buy, price: b.price, stock: b.vol, ovPrice: b.oprice, ovVol: b.ovol };
  const ns = { ...sell, price: s.price, demand: s.vol, ovPrice: s.oprice, ovVol: s.ovol };
  const margin = ns.price - nb.price;
  const roi = nb.price > 0 ? Math.round((margin / nb.price) * 1000) / 10 : 0;
  return { buy: nb, sell: ns, margin, roi };
}

// Calcule les champs dérivés d'une route selon les entrées utilisateur : applique les corrections
// locales (impur, globales OVERRIDES) puis délègue le calcul pur à routeMetrics (logic.mjs).
function evaluate(r, f) {
  const { buy, sell, margin } = applyOverrides(r.commodity, r.buy, r.sell);
  // routes.json et enRouteDeals ne donnent que des NOMS de terminaux : c'est ici, du côté impur,
  // qu'ils deviennent des tarifs. routeMetrics, lui, reçoit un contexte déjà résolu.
  const feeInfo = feeCtx(f, buy.terminal, sell.terminal);
  const metrics = routeMetrics({
    buyPrice: buy.price, buyStock: buy.stock, sellDemand: sell.demand, margin,
    distance: r.distance, sameSystem: r.same_system,
    buyUpdated: buy.updated, sellUpdated: sell.updated,
    demandKnown: sell.ovVol, // ovVol = demande corrigée par l'utilisateur = fiable
  }, f, feeInfo && feeInfo.pair);
  // Marge et ROI nets des frais, comme en mode multi : la même colonne garde la même définition
  // d'un mode à l'autre. Sans frais, netMarginRoi rend exactement la marge de marché et l'ancien ROI.
  const net = netMarginRoi(margin, buy.price, metrics.units, metrics.fees);
  return { ...r, buy, sell, buyPrice: buy.price, sellPrice: sell.price, feeInfo, ...metrics, ...net };
}

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
const EMPTY_DEFAULT = "Aucune route ne correspond aux filtres.";

// Ce que les deux modes de Trajets partagent. app.js garde l'ÉTAT — les frais dépendent de
// l'interrupteur d'autoload et des relevés par station, l'écriture d'une correction doit figer les
// jambes déjà planifiées, et `#empty` reste écrit ici (il est partagé par trois vues).
function propsTrajetsCommunes() {
  return {
    avecTexteFrais: (base, cell) => (cell.text ? `${base} · ${cell.text}` : base),
    legendeAchat: BUY_STATUS,
    legendeVente: SELL_STATUS,
    corriger: (commodite, terminal, cote, champ, valeur, releve) => {
      if (champ === "vol") pinLegsForVolume(commodite, terminal, cote);
      setOverride(commodite, terminal, cote, champ, valeur === "" ? null : valeur, Number(releve) || 0);
      updateOvBadge();
      refresh();
    },
  };
}

// Ce qui se calcule LIGNE PAR LIGNE, et qui vaut pour les deux tables à lignes simples : « Trajets »
// (`#rows`) et « En route » (`#enrouteRows`). Elles ont toujours partagé leur rendu — c'était la
// fonction `routeRowHTML`, appelée des deux endroits. L'îlot React la remplace, donc il doit servir
// les deux appelants : ne peindre que `#rows` laisserait « En route » sans lignes.
function propsLignesSimples() {
  return {
    celluleFrais: (r) => feeCell(r.feeInfo, r.fees, () => feeLoadText(r.units, (termByName.get(r.buy.terminal) || {}).maxBox), r.units > 0),
    suspect: (r) => {
      const d = pairAge(r.buy.updated, r.sell.updated);
      if (d != null && d > 10) return "relevé de plus de 10 jours";
      if (r.refSell > 0 && r.refBuy > 0 && (r.sell.price > r.refSell * 1.5 || r.buy.price < r.refBuy * 0.67))
        return "prix très éloigné de la moyenne UEX";
      return null;
    },
    // Le plafond de caisse vient du MARCHÉ, pas du contexte de frais : c'est une propriété physique
    // de la station. Le prendre dans `feeInfo` le faisait disparaître dès l'interrupteur relâché, et
    // la ligne annonçait « 3×32 » à côté d'un manifeste qui affichait « 6×16 » pour la même cargaison.
    libelleCaisses: (r) => (r.units ? scuBoxesLabel(r.units, (termByName.get(r.buy.terminal) || {}).maxBox) : null),
    // ▶ : le rappel est ÉTALÉ avec le reste, donc il sert les DEUX tables à lignes simples d'un
    // coup. Le poser au seul site d'appel de `#rows` ferait taire le ▶ d'« En route » — la
    // sur-suppression de #116 en négatif. C'est désormais gardé (e2e/choix-trajet.pw.mjs).
    choisirTrajet: (r) => pickJourney([legFromRoute(r)]),
  };
}

function render() {
  const f = readFilters();
  $("empty").textContent = EMPTY_DEFAULT;
  if (f.multi) return renderMulti(f);
  ensureFeeMarket(f, refresh); // re-rend la vue RÉELLEMENT active à l'arrivée du marché, pas celle d'alors

  let rows = etat.ROUTES.filter((r) => routePasses(r, f)).map((r) => evaluate(r, f));

  rows.sort(bySort(etat.sortKey, etat.sortDir));

  peindre($("rows"), vueTrajets({
    ...propsTrajetsCommunes(),
    ...propsLignesSimples(),
    lignes: rows,
  }));
  $("empty").hidden = rows.length > 0;
  notifySuperseded();
}

// ---------- Vue « Trajets » en mode MULTI-COMMODITÉ ----------
// Même tableau, mais chaque ligne est un chargement A->B composé de PLUSIEURS commodités
// (remplissage par marge décroissante, plafonné par stock/demande et budget).
function renderMulti(f) {
  const empty = $("empty");
  // Sans soute bornée, « remplir la soute » n'a pas de sens (cf. manifeste d'« En route »).
  if (!f.useCargo || !(f.cargo > 0)) {
    peindre($("rows"), null);
    empty.hidden = false;
    empty.textContent = "Active la soute (SCU) pour calculer des trajets multi-commodité.";
    return;
  }
  // Graphe requis. On vide comme le fait la branche « soute inactive » juste au-dessus : laisser
  // les trajets à UNE commodité sous un mode qui promet des chargements combinés, c'est afficher
  // autre chose que ce qu'on annonce. (Historiquement le motif était plus dur : le tableau ne
  // correspondait plus à `shownMulti`, et ▶ comme 📦 y lisaient un index vide — clic mort, #25.
  // Les deux boutons portent maintenant leur ligne, mais vider reste la bonne réponse.)
  // #empty reste masqué : le tableau n'est pas vide à cause des filtres, le marché n'est pas là.
  if (!etat.MARKET) {
    peindre($("rows"), null);
    empty.hidden = true;
    withMarket(refresh);
    return;
  }
  // Le contexte de frais descend DANS multiTrips (et non après coup) : c'est lui qui trie puis
  // TRONQUE à 300 trajets, un trajet meilleur en net serait donc coupé avant d'atteindre le tableau.
  const trips = multiTrips(etat.MARKET, f, effVals, 300, f.multiAll ? 1 : 2, feeResolver(f))
    .map((t) => ({ ...t, feeInfo: feeCtx(f, t.origin.name, t.dest.name, t.origin, t.dest), ...tripMetrics(t) }));
  trips.sort(bySort(etat.sortKey, etat.sortDir));
  peindre($("rows"), vueTrajetsMulti({
    ...propsTrajetsCommunes(),
    lignes: trips,
    celluleFrais: (t) => feeCell(t.feeInfo, t.fees, () => feeCargoText(t.lines, t.origin.maxBox), t.units > 0),
    libelleCaisses: (t) => (t.units ? cargoBoxesLabel(t.lines, t.origin.maxBox) : null),
    // Le relevé le plus ANCIEN du chargement : un trajet ne vaut pas mieux que sa ligne la moins sûre.
    releveLePlusAncien: (t) => t.lines.reduce((m, l) => { const u = lineFreshUpdated(l); return m && u ? Math.min(m, u) : m || u; }, 0),
    // Les deux que le DÉPLIANT réclame. Elles restent ici : la première dépend du contexte de
    // frais, la seconde du plafond de caisse du terminal d'achat — ni l'un ni l'autre n'est connu
    // de l'îlot.
    texteProfitLigne: lineProfitText,
    libelleCaissesScu: scuBoxesLabel,
    // EXPLICITE, et pas par `propsLignesSimples()` : cette vue-ci ne l'étale pas, et un chargement
    // multi ne devient pas une jambe par le même chemin qu'une ligne simple.
    choisirTrajet: (t) => pickJourney([legFromTrip(t)]),
  }));
  empty.hidden = trips.length > 0;
  // Rappel : seuls les chargements COMBINÉS (≥ 2 commodités) sont listés ici — un trajet dont le
  // remplissage optimal tient en une seule commodité est déjà dans la vue « Trajets » normale.
  if (!trips.length) {
    empty.textContent = f.multiAll
      ? "Aucun chargement depuis ces terminaux avec ces filtres — élargis la soute ou le budget."
      : "Aucun chargement combinant plusieurs commodités avec ces filtres — agrandis la soute, ou passe la liste sur « avec les simples ».";
  }
  notifySuperseded();
}

// Le chargement déplié d'un trajet multi est rendu par `ChargementDeplie` (vues/trajets.tsx), avec
// l'état d'ouverture — `multiCargoHTML` y a disparu, et `commodityIcon`/`illegalTag` avec lui : ils
// n'avaient pas d'autre appelant.

// Ligne de tableau pour une route évaluée (partagée par « Trajets simples » et « En route »).
// `routeRowHTML` a été remplacé par vues/trajets.tsx, pour `#rows` ET `#enrouteRows`.
function effLeg(leg, buyT, sellT) {
  const b = effVals(leg.commodity, buyT, "buy", leg.buyPrice, leg.stock, leg.updated);
  const s = effVals(leg.commodity, sellT, "sell", leg.sellPrice, leg.demand, leg.updated);
  return { ...leg, buyPrice: b.price, stock: b.vol, sellPrice: s.price, demand: s.vol, demandKnown: s.ovol, margin: s.price - b.price };
}

function evaluateLoop(l, f) {
  const out = effLeg(l.out, l.a.terminal, l.b.terminal);
  const back = effLeg(l.back, l.b.terminal, l.a.terminal);
  const cross = l.a.system !== l.b.system;
  // Une boucle n'a pas un terminal d'achat et un de vente : elle a deux EXTRÉMITÉS qui sont tour à
  // tour l'un et l'autre, d'où { a, b } et quatre opérations facturées (cf. loopMetrics).
  const feeInfo = feeCtx(f, l.a.terminal, l.b.terminal);
  const metrics = loopMetrics(out, back, l.distance, cross, f, feeInfo && { a: feeInfo.a.point, b: feeInfo.b.point });
  return { ...l, out, back, cross, feeInfo, ...metrics };
}

function renderLoops() {
  const f = readFilters();
  $("empty").textContent = EMPTY_DEFAULT;
  ensureFeeMarket(f, refresh); // idem render() : la vue peut avoir changé pendant le fetch

  let rows = etat.LOOPS.filter((l) => loopPasses(l, f)).map((l) => evaluateLoop(l, f));

  rows.sort(bySort(etat.loopSortKey, etat.loopSortDir));
  // Compagnon : remonte en tête (sans filtrer) les boucles qui partent de la FIN du parcours —
  // c'est le point d'extension (une boucle depuis là s'enchaîne au parcours). Cohérent avec addToJourney.
  const hereArrival = etat.JOURNEY ? journeyEnd(etat.JOURNEY)?.name : null;
  if (hereArrival) {
    rows.forEach((l) => { l._fromHere = l.a.terminal === hereArrival || l.b.terminal === hereArrival; });
    rows.sort((a, b) => (b._fromHere ? 1 : 0) - (a._fromHere ? 1 : 0)); // tri stable : pertinentes d'abord
  }
  // Le <tbody> passe à React ; le <thead> et ses `th[data-sort-loop]` restent dans index.html,
  // câblés par setupLoopSort. React ne possède que le corps du tableau.
  peindre($("loopRows"), vueBoucles({
    lignes: rows,
    celluleFrais: (l) => feeCell(l.feeInfo, l.fees, () => `${fmt(l.unitsOut)} + ${fmt(l.unitsBack)} SCU, 4 opérations (charge et décharge à chaque bout)`, l.units > 0),
    avecTexteFrais: (base, cell) => (cell.text ? `${base} · ${cell.text}` : base),
    // On entre dans le cycle par la FIN du parcours : la boucle l'étend au lieu de le remplacer.
    // `journeyEnd(JOURNEY)` est relu DANS le corps de la flèche, donc au clic — et surtout PAS
    // remplacé par `hereArrival` (calculé plus haut, au rendu) : le parcours a pu bouger entre les
    // deux, et c'est la seule régression que ce lot pourrait introduire.
    choisirBoucle: (l) => pickJourney(legsFromLoop(l, etat.JOURNEY ? journeyEnd(etat.JOURNEY)?.name : null)),
  }));

  $("empty").hidden = rows.length > 0;
  notifySuperseded();
}

// ---------- Mode « En route » (trajet dirigé) + manifeste multi-commodité ----------
let enrouteReady = false;     // datalist/destSystem peuplés une seule fois
let originMap = new Map();    // libellé « Nom — Système » -> index terminal (achat uniquement)
let stationMap = new Map();   // libellé -> index, TOUS les terminaux (pour la vue Corrections)
// Nom de terminal -> terminal de market.json. Pont indispensable aux frais d'autoload : routes.json
// et loops.json ne portent QUE des noms, et les noms sont déjà la clé métier du dépôt (corrections
// locales, jambes de voyage). Peuplée en même temps que stationMap.
let termByName = new Map();
let enrouteOrigin = null;     // index du terminal de départ sélectionné
let stationSel = null;        // index de la station sélectionnée (vue Corrections)
// Signature du panneau de frais déjà peint : tant qu'elle ne bouge pas, on ne le réécrit pas, et
// une saisie en cours y survit (#24).
let feesRendus = null;

// Charge le graphe de marché à la demande. Deux règles, apprises à la dure :
//   - on mémorise la PROMESSE en vol, pas seulement son résultat : sinon chaque frappe pendant le
//     chargement relançait un fetch complet de market.json (4 requêtes concurrentes mesurées) ;
//   - on ne mémorise JAMAIS l'échec. Un marché vide mis en cache verrouillait « En route »,
//     « Chaîne », « Commodités » et « Corrections » pour TOUTE la session — autocomplétion vide,
//     0 tuile, « aucune chaîne rentable » — sans le moindre message, et seul un rechargement
//     complet réparait. L'erreur remonte donc aux appelants, et l'action suivante réessaie.
let MARKET_LOADING = null;
function loadMarket() {
  if (etat.MARKET) return Promise.resolve(etat.MARKET);
  if (!MARKET_LOADING) {
    MARKET_LOADING = fetch("data/market.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((m) => (etat.MARKET = m))
      .catch((e) => { MARKET_LOADING = null; throw e; }); // rien n'est retenu -> réessai possible
  }
  return MARKET_LOADING;
}

// Géométrie des systèmes pour la carte du voyage (cf. ADR-001). 1,5 ko, chargé à la demande et une
// seule fois : la carte n'existe que s'il y a un voyage, inutile de le payer sur une page nue.
// Un échec ne bloque rien — la carte reste simplement absente, le reste du compagnon fonctionne.
let starmapPending = false;
function ensureStarmap(then) {
  if (etat.STARMAP || starmapPending) return;
  starmapPending = true;
  fetch("data/starmap.json")
    .then((r) => r.json())
    .then((s) => { etat.STARMAP = s; starmapPending = false; then(); })
    .catch(() => { starmapPending = false; }); // silencieux : un panneau décoratif n'alarme personne
}

// Prévient que le marché est indisponible plutôt que de laisser la vue vide ET muette.
const marketUnavailable = () => showToast("⚠ Marché indisponible — vérifie ta connexion, puis réessaie");

// Exécute `then` une fois le marché chargé et les datalists peuplées. Point de passage unique de
// toutes les vues qui ont besoin du graphe : c'est lui qui garantit que `setupEnRoute()` ne tourne
// jamais sur un marché vide (il pose `enrouteReady`, qui figerait les datalists une fois pour toutes).
// RÈGLE : une VUE ne se repasse jamais elle-même ici, elle passe `refresh` — le fetch dure, et
// l'utilisateur peut avoir changé de vue entre-temps. Rappeler son propre rendu repeignait alors
// #empty et #manifest (partagés par Trajets / Boucles / En route) par-dessus la vue quittée :
// message « choisis un terminal de départ » sous un tableau de trajets plein, ou inversement
// « aucune route ne correspond » masqué au-dessus d'un tableau vide. `renderJourney`, lui, n'est
// lié à AUCUNE vue (la carte Voyage est toujours à l'écran) et se repasse donc bien lui-même.
function withMarket(then) {
  loadMarket().then(() => { setupEnRoute(); then(); }).catch(marketUnavailable);
}

// Les vues « Trajets » et « Boucles » lisent routes.json / loops.json, qui ne portent que des NOMS
// de terminaux : `autoload` et `maxBox` n'existent que dans market.json, que ces deux vues n'ont
// jamais eu besoin de charger. On le charge donc en TÂCHE DE FOND et on re-rend à l'arrivée, plutôt
// que de retarder — ou de vider — la vue par défaut de l'app derrière un fetch de 85 ko : le tableau
// reste lisible, ses profits simplement bruts le temps du chargement.
// En cas d'échec on NE re-rend PAS : ce re-rendu rappellerait ensureFeeMarket, qui relancerait un
// fetch (loadMarket ne mémorise jamais l'échec), en boucle. La prochaine action de l'utilisateur
// réessaiera, ce qui est exactement la règle de loadMarket.
let feeMarketPending = false;
function ensureFeeMarket(f, then) {
  if (!f.autoload || etat.MARKET || feeMarketPending) return;
  feeMarketPending = true;
  loadMarket()
    .then(() => { feeMarketPending = false; setupEnRoute(); then(); })
    .catch(() => { feeMarketPending = false; marketUnavailable(); });
}

// Peuple la liste des terminaux de départ (ceux où l'on peut acheter). Idempotent.
function setupEnRoute() {
  if (enrouteReady) return;
  const seen = new Set();
  const opts = [];
  etat.MARKET.commodities.forEach((c) => c.buys.forEach((b) => {
    if (!seen.has(b[0])) {
      seen.add(b[0]);
      const t = etat.MARKET.terminals[b[0]];
      const label = stationLabel(t.name, t.system);
      originMap.set(label, b[0]);
      opts.push(label);
    }
  }));
  opts.sort((a, b) => a.localeCompare(b, "fr"));
  $("originList").innerHTML = opts.map((l) => `<option value="${esc(l)}"></option>`).join("");

  // Datalist de TOUTES les stations (achat ou vente) pour la vue Corrections.
  const stations = etat.MARKET.terminals.map((t, i) => ({ label: stationLabel(t.name, t.system), i }));
  stations.forEach((s) => stationMap.set(s.label, s.i));
  etat.MARKET.terminals.forEach((t) => termByName.set(t.name, t)); // pont nom -> terminal (frais d'autoload)
  stations.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  $("stationList").innerHTML = stations.map((s) => `<option value="${esc(s.label)}"></option>`).join("");

  // Datalist de TOUTES les commodités (pour l'ajout libre au manifeste).
  $("commodityList").innerHTML = etat.MARKET.commodities
    .map((c) => `<option value="${esc(c.name)}">${esc(c.code || "")}</option>`).join("");

  monteStationPicker();

  enrouteReady = true;
  resolveOrigin(); // au cas où une valeur a été restaurée
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
    // Écrit le LIBELLÉ CANONIQUE, jamais le nom seul : resolveStation résout par correspondance
    // exacte via stationMap, et c'est cette même chaîne que le permalien transporte.
    choisir: (s) => { input.value = s.label; resolveStation(); refresh(); saveState(); },
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
function resolveOrigin() {
  const v = $("origin").value.trim();
  enrouteOrigin = originMap.has(v) ? originMap.get(v) : null;
}

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

const isOv = (commodity, terminal, side, field) => {
  const o = etat.OVERRIDES[ovKey(commodity, terminal, side)];
  return !!(o && o[field] != null);
};

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
const findCommodity = (name) => resolveCommodity(etat.MARKET.commodities, name);

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
    corriger: (commodite, terminal, cote, champ, valeur, releve) => {
      if (champ === "vol") pinLegsForVolume(commodite, terminal, cote);
      setOverride(commodite, terminal, cote, champ, valeur === "" ? null : valeur, Number(releve) || 0);
      updateOvBadge();
      refresh();
    },
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
  if (enrouteOrigin == null) { card.hidden = true; peindre(card, null); return; }
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
  // EMPTY_DEFAULT posé en tête de render() / renderLoops() (#55), qui manquait ici parce que le
  // retour anticipé précède toute écriture — et withMarket ne re-rend PAS en cas d'échec, donc le
  // message de la vue quittée y serait resté pour de bon, sous le toast « Marché indisponible ».
  if (!etat.MARKET) { $("empty").hidden = true; withMarket(refresh); return; }
  if (!enrouteReady) setupEnRoute();
  resolveOrigin(); // re-résout depuis le champ (peut avoir été posé par le parcours, sans événement input)
  resolveDest();
  const f = readFilters();
  const emptyMsg = $("empty");

  renderManifest(enrouteOrigin, $("destSystem").value, f, enrouteDest);

  if (enrouteOrigin == null) {
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
  let deals = enRouteDeals(etat.MARKET, enrouteOrigin, destSystem, enrouteDest, f, feeResolver(f))
    .filter((r) => routePasses(r, ef))
    .map((r) => evaluate(r, f));

  deals.sort(bySort(etat.sortKey, etat.sortDir));
  peindre($("enrouteRows"), vueTrajets({ ...propsTrajetsCommunes(), ...propsLignesSimples(), lignes: deals }));
  emptyMsg.hidden = deals.length > 0;
  if (!deals.length) emptyMsg.textContent = "Aucun fret rentable depuis ce terminal avec ces filtres.";
  notifySuperseded();
}

// ---------- Vue « Chaîne » (multi-sauts A -> B -> C ...) ----------
let chainOrigin = null; // index du terminal de départ de la chaîne
let shownChain = null;  // chaîne actuellement affichée (pour l'ajout au voyage)

function resolveChainOrigin() {
  const v = $("chainOrigin").value.trim();
  chainOrigin = originMap.has(v) ? originMap.get(v) : null;
}

// buildChainAdjacency vit dans logic.mjs (fonction pure) ; appelée avec MARKET + effVals.

// `chainCardHTML` a été remplacé par vues/chaine.tsx.
function renderChain() {
  if (!etat.MARKET) { withMarket(refresh); return; }
  if (!enrouteReady) setupEnRoute();
  resolveChainOrigin();
  const box = $("chainOut");
  const f = readFilters();
  shownChain = null;
  const hint = (noeud) => { peindre(box, noeud); notifySuperseded(); };
  if (chainOrigin == null) return hint(indiceDepart());
  if (!f.useCargo || !(f.cargo > 0)) return hint(indiceSoute());
  const hops = Number($("hops").value) || 3;
  // Les frais sont estampillés sur chaque leg par buildChainAdjacency — seul endroit de la chaîne
  // où les deux terminaux d'un saut coexistent — puis consommés par bestChain, dont l'élagage et la
  // sélection portent alors sur le profit NET.
  const chain = bestChain(buildChainAdjacency(etat.MARKET, f, effVals, feeResolver(f)), chainOrigin, hops, { cargo: f.cargo });
  if (!chain || !chain.legs.length) return hint(indiceAucune());
  shownChain = chain;
  // Le calcul de présentation vit dans l'îlot (il n'appelle que logic.ts) ; app.js ne lui passe que
  // ce qui dépend de l'ÉTAT : le résolveur de terminaux, et les deux fonctions de frais.
  peindre(box, vueChaine({
    chaine: chain,
    cargo: f.cargo,
    terminal: (idx) => etat.MARKET.terminals[idx],
    celluleFrais: (lignes, fee, a, b, scu, fees) =>
      feeCell(feeCtx(f, a.name, b.name, a, b), fees, () => feeCargoText(lignes, a.maxBox), scu > 0),
    texteProfitLigne: lineProfitText,
  }));
  notifySuperseded();
}

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
const jambeChargee = (leg, i) => !!etat.CHARGEMENTS[legKey(leg, i)];

// « Où suis-je ? » — l'étape courante du voyage, ou à défaut le terminal de départ d'« En route ».
// C'est ce terminal qui fixe le prix d'une vente et qui porte le marqueur « refusé ici ».
function stationCourante() {
  if (etat.JOURNEY) {
    const ici = journeyStations(etat.JOURNEY)[etat.JOURNEY.current];
    if (ici) return stationMap.get(stationLabel(ici.name, ici.system));
  }
  return enrouteOrigin; // peut être null : la vente est alors impossible, et le bouton absent
}

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
  resolveOrigin();
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
// Sélectionne un trajet/une boucle/une chaîne -> met à jour le parcours (étend si ça s'enchaîne).
// `apresAjout` (optionnel) tourne une fois le parcours à jour mais AVANT le rendu : c'est là que le
// manifeste d'« En route » dépose son chargement ajusté, pour que la jambe s'affiche du premier
// coup avec les bons SCU et son badge ✎.
function pickJourney(legs, apresAjout) {
  if (!legs || !legs.length) return;
  etat.JOURNEY = addToJourney(etat.JOURNEY, legs);
  if (apresAjout) apresAjout();
  syncViewsToJourney();
  renderJourney();
  refresh(); // reflète la nouvelle destination/origine dans la vue courante
}

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
function syncViewsToJourney() {
  if (!etat.JOURNEY) return;
  const here = journeyStations(etat.JOURNEY)[etat.JOURNEY.current]; // station où l'on se trouve
  if (!here) return;
  const originLabel = stationLabel(here.name, here.system);
  $("origin").value = originLabel;    // En route : départ = station courante
  $("chainOrigin").value = originLabel; // Chaîne : départ = station courante
  const leg = currentLeg(etat.JOURNEY);
  if (leg) {
    $("destTerminal").value = stationLabel(leg.to, leg.toSystem); // arrivée forcée = jambe courante
    $("destSystem").value = "";
  } else {
    $("destTerminal").value = ""; // au bout du parcours : on cherche le fret onward, pas d'arrivée imposée
  }
}
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
// Ensemble des commodités transportées au moins une fois sur le parcours (union des manifestes).
function journeyCarriedCommodities() {
  const set = new Set();
  if (!etat.JOURNEY || !etat.MARKET) return set;
  const f = readFilters();
  etat.JOURNEY.legs.forEach((leg, i) => legEffectiveLines(leg, i, f).forEach((l) => set.add(l.name)));
  return set;
}

// Manifeste optimal d'une jambe (from -> to) : remplissage multi-commodité, terminal d'arrivée forcé.
function legManifest(leg, f) {
  if (!etat.MARKET || !stationMap.size) return null;
  const fromIdx = stationMap.get(stationLabel(leg.from, leg.fromSystem));
  const toIdx = stationMap.get(stationLabel(leg.to, leg.toSystem));
  if (fromIdx == null || toIdx == null) return null;
  return bestManifest(etat.MARKET, fromIdx, "", f, effVals, toIdx, feeResolver(f)); // { lines, profit, … } ou null
}

// Contexte de frais d'une jambe. Le récap du voyage est affiché à CÔTÉ des tableaux : le laisser en
// brut pendant que les six vues passent en net mettrait deux chiffres contradictoires côte à côte.
const legFeeCtx = (leg, f) => feeCtx(f, leg.from, leg.to);

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
function loadJourneyPins() {
  try { etat.JOURNEY_PINS = JSON.parse(localStorage.getItem(JOURNEY_PINS_KEY)) || {}; } catch { etat.JOURNEY_PINS = {}; }
}
function saveJourneyPins() { try { localStorage.setItem(JOURNEY_PINS_KEY, JSON.stringify(etat.JOURNEY_PINS)); } catch {} }
function loadJourneyEdits() {
  try { etat.JOURNEY_EDITS = JSON.parse(localStorage.getItem(JOURNEY_EDITS_KEY)) || {}; } catch { etat.JOURNEY_EDITS = {}; }
  try { localStorage.removeItem("best-hauling-journey-edits"); } catch {} // format v1 abandonné
}
function saveJourneyEdits() { try { localStorage.setItem(JOURNEY_EDITS_KEY, JSON.stringify(etat.JOURNEY_EDITS)); } catch {} }
// Le RANG de la jambe fait partie de la clé : sans lui, un parcours A→B→A→B partageait un seul
// manifeste entre ses jambes 1 et 3 (éditer l'une réécrivait l'autre, la supprimer supprimait l'autre).
const legKey = (leg, i) => `${i}|${leg.from}|${leg.to}`;

// Indices des terminaux d'une jambe, ou null si le marché ne les connaît pas (encore).
function legTerminals(leg) {
  const fromIdx = stationMap.get(stationLabel(leg.from, leg.fromSystem));
  const toIdx = stationMap.get(stationLabel(leg.to, leg.toSystem));
  return fromIdx == null || toIdx == null ? null : { fromIdx, toIdx };
}

// Manifeste EFFECTIF d'une jambe : intention éditée ré-hydratée si elle existe, sinon l'optimal.
function legEffectiveLines(leg, i, f) {
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
function legIntent(leg, i, f) {
  const k = legKey(leg, i);
  if (!etat.JOURNEY_EDITS[k]) etat.JOURNEY_EDITS[k] = manifestIntent(legManifest(leg, f)?.lines || []);
  if (etat.JOURNEY_PINS[k]) { delete etat.JOURNEY_PINS[k]; saveJourneyPins(); }
  return etat.JOURNEY_EDITS[k];
}

// Fige les jambes qu'une correction de volume rebattrait, AVANT qu'elle soit appliquée : on capture
// donc les quantités telles qu'elles sont encore. La sélection est pure (legsToPin) ; ici on ne
// fournit que ce que logic.mjs ne peut pas connaître — les chargements effectifs du moment.
// Fige les SCU d'une jambe : son chargement devient une INTENTION persistée, et le 🔒 dit que ce
// n'est pas la main de l'utilisateur qui l'a voulu. Rend `true` si quelque chose a bougé.
// Une jambe déjà ajustée (✎) ou déjà figée n'est pas retouchée : ses quantités ne bougeaient plus,
// et l'écraser effacerait un ajustement fait à la main.
function figerJambe(i, lignes) {
  const k = legKey(etat.JOURNEY.legs[i], i);
  if (etat.JOURNEY_EDITS[k]) return false;
  etat.JOURNEY_EDITS[k] = manifestIntent(lignes || []);
  etat.JOURNEY_PINS[k] = true;
  return true;
}

// Le gel consulte désormais l'état « chargée » de chaque jambe (#48) : une jambe qu'on n'a pas
// payée n'est plus figée par une correction de volume, elle RECALCULE. Voir legsToPin (logic.mjs)
// pour le pourquoi du renversement.
function pinLegsForVolume(commodity, terminal, side) {
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
function resolveStationLabel(input) {
  const v = (input || "").trim();
  if (!v) return null;
  if (stationMap.has(v)) return stationMap.get(v);
  const lc = v.toLowerCase();
  for (const [label, idx] of stationMap) if (parseStationLabel(label).name.toLowerCase() === lc) return idx;
  return null;
}
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

function renderTour() {
  const box = $("tour");
  if (!box) return;
  if (!etat.SOUTE.length) {
    peindre(box, messageSouteVide());
    return;
  }
  // Le graphe d'échange porte les débouchés. On passe `refresh` et non `renderTour` : c'est la règle
  // de withMarket — le fetch dure, et l'utilisateur peut avoir changé de vue entre-temps.
  if (!etat.MARKET) { withMarket(refresh); peindre(box, messageChargement()); return; }
  // Le champ de la vue prime sur la position du voyage : on peut vouloir simuler depuis ailleurs.
  const saisi = $("tourFrom").value.trim();
  const ici = saisi ? resolveStationLabel(saisi) : stationCourante();
  if (ici == null) {
    peindre(box, messageOuEsTu());
    return;
  }
  const f = readFilters();
  const systeme = etat.MARKET.terminals[ici].system;
  const toutSysteme = $("tourScope").value === "all";
  // Portée par défaut = le système où l'on se trouve (27 terminaux en Pyro, 80 en Stanton, 7 en Nyx
  // sur 114). L'ouvrir est un geste explicite, et le saut apparaît alors comme une ligne de coût.
  const ft = { ...f, sysFilter: toutSysteme ? f.sysFilter : systeme };
  const { tournee, alternative } = tourneesEcoulement(etat.MARKET, etat.SOUTE, ici, ft, effVals, feeResolver(f));
  peindre(box, vueTournee({ tournee, alternative, systeme, toutSysteme, fmt }));
}

// ---------- Plan de vol : la vue de conclusion (ADR-004) ----------
// Une CONCLUSION, pas un tableau de bord : on y arrive une fois tout paramétré, pour REGARDER le
// résultat. Rien n'y est actionnable — pas un bouton de vente, pas un ✕, pas un champ. Les gestes
// vivent dans les six vues de recherche, et le bandeau (masqué ici, et ici seulement) les y porte.

// Les quatre réglages qui ne FILTRENT pas mais changent le SENS des chiffres (ADR-004 §6). La soute
// donne la place libre ; l'autoload décide si les profits sont nets ou bruts, et son état n'est
// autrement lisible que sur une case à cocher — masquée ici. Les taire rendrait la conclusion
// silencieusement ambiguë : on lirait un profit sans savoir s'il est net.
function planHypotheses(f) {
  return [
    $("ship").value.trim() || "aucun vaisseau",
    f.useCargo && f.cargo > 0 ? `soute ${fmt(f.cargo)} SCU` : "soute non limitée",
    f.useBudget && f.budget > 0 ? `budget ${fmt(f.budget)} aUEC` : "budget non limité",
    f.autoload ? `profits nets (k = ${String(globalK()).replace(".", ",")})` : "profits bruts",
  ];
}

// Tout ce que la vue montre, calculé UNE fois : le rendu et la copie lisent la même chose, sinon
// le texte collé dans un salon dériverait de l'écran qui l'a produit.
// Aucun calcul neuf (ADR-004 : « C'est un déménagement d'interface, les chiffres ne changent pas ») :
// les manifestes par jambe passent par legEffectiveLines, exactement comme le compagnon de voyage.
function planData() {
  const f = readFilters();
  const groupes = holdByCommodity(etat.SOUTE);
  const stations = etat.JOURNEY ? journeyStations(etat.JOURNEY) : [];
  const jambes = (etat.JOURNEY && etat.MARKET ? etat.JOURNEY.legs : []).map((leg, i) => {
    const lines = legEffectiveLines(leg, i, f) || [];
    const t = lines.length ? manifestTotals(lines, (legFeeCtx(leg, f) || {}).pair) : { profit: 0, fees: 0 };
    return {
      i, from: leg.from, to: leg.to, lines,
      scu: lines.reduce((s, l) => s + l.units, 0),
      profit: t.profit, fees: t.fees,
      courante: i === etat.JOURNEY.current,
      faite: i < etat.JOURNEY.current,
      chargee: jambeChargee(leg, i),
    };
  });
  return {
    f, groupes, stations, jambes,
    scu: holdScu(etat.SOUTE),
    libre: f.useCargo && f.cargo > 0 ? freeCargo(etat.SOUTE, f.cargo) : null,
    invest: groupes.reduce((s, g) => s + g.invest, 0),
    totalProfit: jambes.reduce((s, j) => s + j.profit, 0),
    totalFees: jambes.reduce((s, j) => s + j.fees, 0),
    totalScu: jambes.reduce((s, j) => s + j.scu, 0),
    reste: etat.JOURNEY ? Math.max(0, etat.JOURNEY.legs.length - etat.JOURNEY.current) : 0,
  };
}

// La soute EN GRAND : ce qu'il y a à bord commodité par commodité, la place libre, ce qui a été
// payé. Le #holdCard du bandeau dit la même chose dans un encart latéral — mais il porte la vente,
// le dépôt et le retrait de lot. Ici, aucun bouton : c'est la même donnée, en lecture.
// `planHoldHTML` a été remplacé par vues/plan.tsx.
// Le parcours étape par étape, la jambe en cours et son manifeste, et ce qu'il reste à faire.
// `planRouteHTML` a été remplacé par vues/plan.tsx.
function renderPlan() {
  const head = $("planHead"), body = $("planBody");
  if (!head || !body) return;
  // Les manifestes par jambe vivent dans le graphe d'échange, que la vue par défaut ne charge pas.
  // On passe `refresh` et non `renderPlan` : c'est la règle de withMarket — le fetch dure, et
  // l'utilisateur peut avoir changé de vue entre-temps.
  if (etat.JOURNEY && !etat.MARKET) withMarket(refresh);
  const d = planData();
  peindre(head, enTetePlan(planHypotheses(d.f)));
  // L'îlot ne lit AUCUNE globale : app.js lui passe tout, y compris le résolveur de `kind` (MARKET)
  // et la base des barres de soute — la CAPACITÉ quand elle est connue, le chargement sinon. Une
  // barre sans dénominateur ne voudrait rien dire.
  peindre(body, corpsPlan({
    hypotheses: planHypotheses(d.f),
    stations: d.stations,
    courante: etat.JOURNEY ? etat.JOURNEY.current : -1,
    jambes: d.jambes,
    groupes: d.groupes,
    scu: d.scu, libre: d.libre, invest: d.invest,
    totalScu: d.totalScu, totalProfit: d.totalProfit, totalFees: d.totalFees,
    reste: d.reste, nbSauts: etat.JOURNEY ? etat.JOURNEY.legs.length : 0,
    base: d.f.useCargo && d.f.cargo > 0 ? d.f.cargo : d.scu,
    marchePret: !!etat.MARKET,
    kindDe: (nom) => { const c = etat.MARKET && findCommodity(nom); return c ? c.kind : null; },
    fmtProfit: fmtFee,
  }));
}

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
  if (etat.view === "loops") renderLoops();
  else if (etat.view === "enroute") renderEnRoute();
  else if (etat.view === "chain") renderChain();
  else if (etat.view === "corrections") renderCorrections();
  else if (etat.view === "commodities") renderCommodities();
  else if (etat.view === "plan") renderPlan();
  else if (etat.view === "tour") renderTour();
  else render();
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
      render();
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
      renderLoops();
      saveState();
      notifier(); // idem : hors `refresh()`
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
const STATE_FIELDS = ["cargo", "budget", "search", "system", "freshness", "ship", "origin", "destSystem", "destTerminal", "chainOrigin", "hops", "station", "alk", "multiMode", "tourFrom", "tourScope"];
const STATE_CHECKS = ["useCargo", "useBudget", "sameSystem", "noOutpost", "legalOnly", "capStock", "multiCommodity", "autoload"];
// Champs qui gardent leur défaut HTML quand la clé est absente de l'état. #system, #freshness et
// #destSystem ont chacun une option VIDE (« Tous », « Toutes », « N'importe où ») : leur poser ""
// resélectionne bien ce défaut. #hops, lui, n'en a pas (2 / 3 / 4) — lui poser "" laisserait le menu
// visuellement VIDE alors que le calcul retomberait silencieusement sur 3 sauts.
const STATE_FIELDS_KEEP_DEFAULT = ["hops"];
// safeKey / encodeState / decodeState viennent de logic.mjs.

let restoring = false; // évite de resauver pendant qu'on applique un état

function collectState() {
  // `cb` : board des commodités. Vide en mode Marché (défaut) -> encodeState l'omet, l'URL reste courte.
  const s = { v: etat.view, sk: etat.sortKey, sd: etat.sortDir, lk: etat.loopSortKey, ld: etat.loopSortDir, cb: etat.commBoard === "loot" ? "loot" : "" };
  STATE_FIELDS.forEach((id) => (s[id] = $(id).value));
  STATE_CHECKS.forEach((id) => (s[id] = $(id).checked ? 1 : 0));
  if (etat.JOURNEY) s.j = encodeJourney(etat.JOURNEY); // compagnon de voyage (partageable)
  return s;
}

// Écrit l'état dans localStorage et renvoie sa forme encodée (null pendant une restauration : rien
// à resauver). TOUJOURS synchrone, y compris depuis la variante différée ci-dessous : une session ne
// doit pas se perdre parce que l'onglet a été rechargé ou fermé dans la demi-seconde qui suit.
function persistState() {
  if (restoring) return null;
  const str = encodeState(collectState());
  try { localStorage.setItem(STATE_KEY, str); } catch {}
  return str;
}

// Recopie l'état dans le hash de l'URL. WebKit plafonne replaceState à 100 appels / 10 s et lève
// SecurityError au-delà. L'URL n'est pas critique (localStorage porte déjà l'état, et l'écriture
// suivante réécrit TOUT, elle n'est pas incrémentale) — mais l'exception remontait jusqu'à
// copyShareLink, qui appelle saveState en PREMIÈRE instruction : le bouton « Partager » ne copiait
// alors plus rien, sans le moindre retour visuel.
function writeHash(str) {
  try {
    history.replaceState(null, "", str ? "#" + str : location.pathname + location.search);
  } catch {}
}

// URL à partager, reconstruite depuis l'état ENCODÉ — jamais relue dans `location.href`. Une
// écriture de hash plafonnée est perdue pour de bon : la barre d'adresse reste alors figée au
// milieu de la rafale, et copier `location.href` partagerait des filtres périmés tout en
// annonçant « ✓ Lien copié », donc sans que rien ne le signale.
function shareURL(str) {
  const rel = str ? location.pathname + location.search + "#" + str : location.pathname + location.search;
  return new URL(rel, location.href).href;
}

// Sauvegarde complète ; renvoie l'état encodé (null pendant une restauration). Le hash est écrit
// IMMÉDIATEMENT, jamais différé : `loadState()` le fait PRIMER sur localStorage, donc un hash en
// retard — fût-ce de quelques centaines de ms — ressusciterait au rechargement l'état d'AVANT la
// dernière action (vue, filtres, station…). Le plafond WebKit se traite EN AMONT, à la source :
// tous les champs à saisie libre sont débouncés (cf. init), une rafale de frappe ne vaut donc plus
// qu'un seul appel. Le `try/catch` de writeHash n'est que le filet de sécurité.
function saveState() {
  const str = persistState();
  if (str == null) return null;
  writeHash(str);
  return str;
}

function loadState() {
  let str = location.hash.replace(/^#/, "");
  if (!str) { try { str = localStorage.getItem(STATE_KEY) || ""; } catch {} }
  return decodeState(str);
}

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

function applyState(s) {
  if (!s) return;
  restoring = true;
  // Lecture SYMÉTRIQUE de l'écriture : encodeState omet les valeurs vides (URL courte), donc dans un
  // état venant de l'app une clé absente veut dire « champ vidé », pas « champ jamais renseigné ».
  // Sans ça, un budget effacé à la main revenait à 1 000 000 au rechargement — et le destinataire du
  // lien voyait un autre classement que son émetteur.
  // Encore faut-il que l'état VIENNE de l'app : n'importe quelle ancre (#top) se décode elle aussi en
  // objet, et vider tous les champs sur cette foi accueillerait l'arrivant sans soute ni budget.
  // `v` (la vue) est écrite à chaque sauvegarde par collectState et n'est jamais vide : elle signe l'état.
  const mine = s.v != null;
  STATE_FIELDS.forEach((id) => {
    if (s[id] != null) $(id).value = s[id];
    else if (mine && !STATE_FIELDS_KEEP_DEFAULT.includes(id)) $(id).value = "";
  });
  STATE_CHECKS.forEach((id) => { if (s[id] != null) $(id).checked = s[id] === "1"; });
  if (safeKey(s.sk)) { etat.sortKey = s.sk; etat.sortDir = Number(s.sd) === 1 ? 1 : -1; }
  if (safeKey(s.lk)) { etat.loopSortKey = s.lk; etat.loopSortDir = Number(s.ld) === 1 ? 1 : -1; }
  // Liste blanche des vues restaurables. Y OUBLIER une vue neuve est le piège documenté par
  // l'ADR-004 : elle s'ouvre au clic, mais ne revient ni d'un permalien ni du localStorage — et
  // l'oubli ne se voit qu'au rechargement suivant.
  if (["routes", "loops", "enroute", "chain", "corrections", "commodities", "plan", "tour"].includes(s.v)) etat.view = s.v;
  if (s.cb === "loot") etat.commBoard = "loot";
  if (s.j) etat.JOURNEY = decodeJourney(s.j); // compagnon de voyage restauré (les champs sont déjà repris ci-dessus)
  applySortIndicators();
  syncToggles();
  syncCommBoardUI(); // bouton actif + libellé « Revente » restaurés avant le premier rendu
  restoring = false;
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

// Met à jour le libellé du bouton de vue « Corrections » (compteur).
function updateOvBadge() {
  const n = ovCount();
  const bouton = $("viewCorrections");
  const rl = bouton.querySelector(".rl");
  // On écrit DANS le .rl, au lieu d'écraser le bouton entier en textContent : cette écriture-là
  // détruisait le <span class="rn">, et le numéro de Corrections n'a donc jamais existé à l'écran
  // (#45). Le rail annonce une touche par numéro — il ne peut pas en manquer un sur huit.
  rl.textContent = "Corrections";
  // Le compteur en plus petit, sans interlettrage : mesuré, il rend 20 px au libellé. Sans lui
  // « Corrections (123) » repart à la ligne, et le bouton fait deux fois la hauteur des sept
  // autres — un rail qui cède quand la place manque, c'est le symptôme de #86.
  if (n) {
    const compteur = document.createElement("span");
    compteur.className = "ov-n";
    compteur.textContent = `(${n})`;
    rl.append(" ", compteur);
  }
  // Le libellé étant maintenant dans un .rl, il disparaît au rail rétracté : l'aria-label est le
  // seul à porter le compteur à ce moment-là, et il doit donc suivre. Même geste que
  // copyShareLink() sur #share.
  bouton.setAttribute("aria-label", n ? `Corrections (${n})` : "Corrections");
}

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
  if (stationSel == null) return;
  const t = etat.MARKET.terminals[stationSel];
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
function resolveStation() {
  const v = $("station").value.trim();
  stationSel = stationMap.has(v) ? stationMap.get(v) : null;
}

// Relevé du tarif d'autoload d'une station. L'utilisateur ne saisit PAS `k` : personne ne lit un
// coefficient en jeu, on lit une facture. Il donne un montant observé pour une quantité, et `k` s'en
// déduit. Les champs ne portent PAS la classe `.editv` : le handler global de l'édition inline
// l'attrape partout dans le document et écrirait dans les corrections de prix.
function stationFeeHTML(S) {
  const t = etat.MARKET.terminals[S];
  const head = `<div class="fee-head">◈ Frais d'autoload — ${esc(t.name)}</div>`;
  const wrap = (body) => `<div class="fee-panel">${head}${body}</div>`;
  // Deux non-dits distincts, et aucun ne doit se lire « 0 aUEC » : le champ absent (instantané de
  // market.json antérieur au build qui l'ajoute) et le service réellement indisponible.
  if (t.autoload == null) return wrap('<p class="fee-off">Donnée d\'autoload absente de cet export UEX : aucun frais n\'est facturé à cette station tant qu\'elle manque.</p>');
  if (t.autoload !== true) return wrap('<p class="fee-off">Cette station ne propose pas l\'autoload : aucun frais n\'y est facturé, quel que soit ton réglage.</p>');
  const rec = etat.AUTOLOAD_K[alKey(t.name)];
  const k = kFor(t.name);
  const scu = rec ? rec.scu : 32;
  const note = `<div class="fee-note">Tarif retenu : <b>k = ${kFmt(k)}</b> ${rec ? "(ton relevé)" : "(k global)"} — soit ≈ <b>${fmt(autoloadFee(scu, t.maxBox, k))}</b> aUEC pour ${fmt(scu)} SCU${t.maxBox ? `, caisses de ${fmt(t.maxBox)} SCU max` : ""}.</div>`;
  return wrap(
    `<div class="fee-row">
       <span>Montant observé</span>
       <input id="alAmount" type="number" min="0" step="1" value="${rec ? rec.amount : ""}" placeholder="ex : 1159" aria-label="Montant payé en aUEC" />
       <span>aUEC pour</span>
       <input id="alScu" type="number" min="1" step="1" value="${scu}" aria-label="Quantité en SCU" />
       <span>SCU</span>
       <button id="alSave" type="button" class="copy-btn">Enregistrer</button>
       ${rec ? `<button type="button" class="corr-del al-del" data-key="${esc(alKey(t.name))}" title="Oublier ce relevé" aria-label="Oublier ce relevé">✕</button>` : ""}
     </div>${note}`
  );
}

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

// Liste des relevés d'autoload, à côté des corrections locales et sur le même modèle : ils sont de
// la même nature (mesures faites en jeu, purement locales), mais ils ne comptent PAS dans le badge
// « Corrections (n) » du rail et « Tout réinitialiser » ne les touche pas — ils ont leur propre store.
function autoloadListHTML() {
  const keys = Object.keys(etat.AUTOLOAD_K);
  if (!keys.length) return "";
  const items = keys.sort().map((key) => {
    const o = etat.AUTOLOAD_K[key];
    const terminal = key.slice(key.indexOf("|") + 1);
    return `<div class="corr-item autoload"><div><b>${esc(terminal)}</b> <span class="corr-side">autoload</span><div class="loc-sub">k = <b>${kFmt(o.k)}</b> · ${fmt(o.amount)} aUEC observés pour ${fmt(o.scu)} SCU</div></div><button class="corr-del al-del" data-key="${esc(key)}" title="Oublier ce relevé">✕</button></div>`;
  }).join("");
  return `<div class="corr-list-head"><span>${keys.length} relevé${keys.length > 1 ? "s" : ""} d'autoload</span><button id="resetAllK" class="reset-ov">Tout oublier</button></div>${items}`;
}

// Prépare les tuiles d'une station pour l'îlot : app.js reste le seul à lire MARKET et à appeler
// `effVals` — dont la purge d'une correction périmée est un effet de bord assumé.
function tuilesStation(S, q) {
  const t = etat.MARKET.terminals[S];
  const tuiles = [];
  etat.MARKET.commodities.forEach((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return;
    const b = c.buys.find((x) => x[0] === S);
    const s = c.sells.find((x) => x[0] === S);
    if (!b && !s) return;
    const cote = (p, side, libelle, unite) => {
      const e = effVals(c.name, t.name, side, p[1], p[2], p[3]);
      return {
        cote: side, libelle, unite,
        prix: e.price, volume: e.vol,
        prixCorrige: e.oprice, volumeCorrige: e.ovol,
        prixBrut: p[1], volumeBrut: p[2],
        releve: p[3],
      };
    };
    const cotes = [];
    if (b) cotes.push(cote(b, "buy", "achat", "stock"));
    if (s) cotes.push(cote(s, "sell", "vente", "dem."));
    // Une seule ligne par côté RÉEL. La classe de la tuile porte le côté : c'est elle qui donne au
    // liseré et à l'étiquette leur couleur, nécessaire depuis que l'en-tête de section sort de
    // l'écran au défilement.
    tuiles.push({ nom: c.name, kind: c.kind, illegal: c.illegal, achat: !!b, cotes });
  });
  return tuiles;
}

// Les stations corrigées, la station affichée épinglée en tête.
function groupesCorrections() {
  const actif = stationSel != null ? etat.MARKET.terminals[stationSel].name : null;
  return groupOverridesByTerminal(etat.OVERRIDES, actif).map((g) => ({
    terminal: g.terminal,
    corrections: g.corrections,
    actif: g.actif,
    // `null` quand le terminal a disparu de market.json : la vignette s'affiche quand même, sinon
    // la correction deviendrait invisible ET ineffaçable.
    info: termByName.get(g.terminal) || null,
  }));
}

function renderCorrections() {
  if (!etat.MARKET) { withMarket(refresh); return; }
  if (!enrouteReady) setupEnRoute();
  resolveStation();
  const q = $("search").value.trim().toLowerCase();
  // La bande est peinte APRÈS le panneau, bien qu'elle s'affiche au-dessus : la préparation des
  // tuiles appelle effVals, dont la purge des volumes périmés est un EFFET DE BORD. Compter d'abord
  // afficherait une correction que le rendu suivant vient d'effacer. L'ordre est donc un contrat.
  if (stationSel == null) peindre($("correctionsStation"), inviteStation());
  else {
    const t = etat.MARKET.terminals[stationSel];
    peindre($("correctionsStation"), vueStation({
      terminal: t,
      tuiles: tuilesStation(stationSel, q),
      filtre: !!q,
      nbCorrections: Object.keys(etat.OVERRIDES).filter((k) => k.split("|")[1] === t.name).length,
      // L'ÉCRITURE reste à app.js : lui seul sait qu'un VOLUME fige d'abord les jambes planifiées.
      corriger: (commodite, cote, champ, valeur, releve) => {
        if (champ === "vol") pinLegsForVolume(commodite, t.name, cote);
        setOverride(commodite, t.name, cote, champ, valeur === "" ? null : valeur, Number(releve) || 0);
        updateOvBadge();
        refresh();
      },
    }));
  }
  peindre($("correctionsIndex"), vueBandeCorrections({ groupes: groupesCorrections() }));
  // Le panneau de frais n'est réécrit QUE si son contenu a changé (#24). Le sortir de
  // #correctionsStation ne suffisait pas : renderCorrections réécrivait son nouveau conteneur tout
  // aussi inconditionnellement, et un montant en cours de frappe repartait à vide au moindre
  // re-rendu — un filtre tapé, une correction ailleurs. Le panneau ne dépend que de la station
  // affichée et du store des relevés : cette signature suffit à décider.
  const signature = `${stationSel}|${JSON.stringify(etat.AUTOLOAD_K)}`;
  if (signature !== feesRendus) {
    feesRendus = signature;
    $("correctionsFees").innerHTML = (stationSel != null ? stationFeeHTML(stationSel) : "") + autoloadListHTML();
  }
  notifySuperseded();
}

// ---------- Vue « Commodités » : grand tableau + tous les points d'achat/vente ----------
// Tri du tableau : 3 modes prédéfinis (boutons) + tri par colonne (clic en-tête).
function sortCommodities(rows) {
  // La « valeur » d'une tuile dépend du board : marge en Marché, prix de revente en Butin.
  const vk = etat.commBoard === "loot" ? "bestSell" : "margin";
  if (etat.commMode === "margin") return rows.sort(bySort(vk, -1));                        // plus lucratif d'abord
  if (etat.commMode === "code") return rows.sort(bySort("code", 1));                        // code A→Z
  if (etat.commMode === "kind")                                                             // catégorie puis valeur
    return rows.sort((a, b) => (a.kind || "").localeCompare(b.kind || "", "fr") || (b[vk] ?? -Infinity) - (a[vk] ?? -Infinity));
  return rows.sort(bySort(etat.commSortKey, etat.commSortDir));                                  // colonne (mode custom)
}

// Applique un tri (bouton mode ou clic en-tête) et re-rend.
function setCommSort(key) {
  if (key === "margin" || key === "code" || key === "kind") {
    etat.commMode = key;
  } else {
    if (etat.commMode === "custom" && etat.commSortKey === key) etat.commSortDir *= -1;
    else { etat.commSortKey = key; etat.commSortDir = key === "bestBuy" || key === "name" || key === "code" ? 1 : -1; }
    etat.commMode = "custom";
  }
  renderCommodities();
  saveState();
  notifier(); // idem : hors `refresh()`
}

// Palier de couleur d'une tuile, RELATIF à la meilleure marge de la liste (heatmap :
// rouge = tête de peloton → bleu correct → gris atone → sans marge). S'adapte aux données.
function marginTier(m) {
  if (m == null || m <= 0) return "t-none";
  const r = commMaxMargin > 0 ? m / commMaxMargin : 0;
  if (r >= 0.66) return "t-hot";
  if (r >= 0.40) return "t-warm";
  if (r >= 0.18) return "t-mid";
  return "t-low";
}

// Une tuile du board : code UEX + valeur compacte (K/M), colorée par palier.
// En Marché la valeur est la marge (heatmap linéaire) ; en Butin le prix de revente
// (heatmap par rang, cf. valueTiers — les prix s'étalent sur cinq ordres de grandeur).
// `commodityTileHTML` a été remplacé par vues/commodites.tsx.
// Détail d'une commodité : tous ses points d'achat (moins cher d'abord) et de vente (mieux payé
// d'abord). En mode Butin, l'achat n'a pas de sens : on ne garde que « où l'écouler ».
function paintCommodityDetail() {
  const box = $("commDetail");
  const loot = etat.commBoard === "loot";
  if (!etat.commSelected) { peindre(box, inviteDetail(loot)); return; }
  // `effVals` : le détail affiche les valeurs CORRIGÉES, comme les tableaux. Et puisqu'elles le
  // sont, elles passent par une valeur éditable — clic pour corriger sur place. Le board est ainsi
  // le point d'entrée naturel pour rectifier un prix « chez toutes les stations qui la vendent ».
  const p = commodityPoints(etat.MARKET, etat.commSelected, readFilters(), effVals);
  if (!p) { peindre(box, null); return; }
  peindre(box, vueDetailCommodite({
    points: p,
    nomCommodite: p.name,
    butin: loot,
    estCorrige: (terminal, cote, champ) => isOv(p.name, terminal, cote, champ),
    // L'ÉCRITURE reste à app.js : lui seul sait qu'un VOLUME doit d'abord figer les jambes déjà
    // planifiées (avant d'écrire, pour capturer les SCU encore en vigueur), qu'un PRIX ne fige
    // rien, et que le compteur de corrections doit suivre.
    corriger: (terminal, cote, champ, valeur, releve) => {
      if (champ === "vol") pinLegsForVolume(p.name, terminal, cote);
      setOverride(p.name, terminal, cote, champ, valeur === "" ? null : valeur, Number(releve) || 0);
      updateOvBadge();
      refresh();
    },
    legendeAchat: BUY_STATUS,
    legendeVente: SELL_STATUS,
  }));
}
// Reflète le board courant dans les contrôles. « Marge » n'a aucun sens quand l'acquisition est
// gratuite : le premier bouton de tri devient « Revente ».
function syncCommBoardUI() {
  const loot = etat.commBoard === "loot";
  document.querySelectorAll("#commBoardModes button").forEach((b) => b.classList.toggle("active", b.dataset.board === etat.commBoard));
  const first = document.querySelector('#commSortModes button[data-sort="margin"]');
  if (first) first.textContent = loot ? "Revente" : "Marge";
  peindre($("commHint"), aideBoard(loot));
}

function setCommBoard(board) {
  if (board !== "market" && board !== "loot") return;
  if (board === etat.commBoard) return;
  etat.commBoard = board;
  renderCommodities(); // la sélection courante est revalidée par le rendu (elle peut disparaître)
  saveState();
  notifier(); // idem : hors `refresh()`
}

// La grille, peinte à part : la sélection d'une tuile la repeint SANS tout recalculer. Avant React,
// la délégation basculait la classe `selected` à la main sur les nœuds — une mutation qu'un arbre
// React ne voit pas, et qu'il écraserait au rendu suivant sans savoir qu'elle avait eu lieu.
function peindreGrilleCommodites() {
  peindre($("commGrid"), vueGrilleCommodites({
    lignes: shownCommodities,
    butin: etat.commBoard === "loot",
    selection: etat.commSelected,
    transportees: commCarried,
    codesAmbigus: commDupCodes,
    // La heatmap est calculée par app.js : celle du Marché lit une globale (commMaxMargin), celle
    // du Butin vient de logic.ts (valeurTiers, par rang). L'îlot ne connaît ni l'une ni l'autre.
    palier: (c) => (etat.commBoard === "loot" ? commTiers.get(c.name) || "t-none" : marginTier(c.margin)),
    valeurCompacte: compactValue,
  }));
}

function renderCommodities() {
  if (!etat.MARKET) { withMarket(refresh); return; }
  if (!enrouteReady) setupEnRoute();
  const f = { ...readFilters(), board: etat.commBoard };
  const q = f.q;
  // `effVals` : marge, couleur de tuile et rang suivent les corrections locales. Sans lui, la tuile
  // continuait d'afficher la marge d'UEX après qu'on ait corrigé le prix dans un tableau.
  const all = commoditySummaries(etat.MARKET, f, effVals); // légales + avant-postes + board s'appliquent ici
  // Les DEUX heatmaps se calculent sur TOUT le board, jamais sur le sous-ensemble visible : la
  // couleur d'une tuile prétend situer la commodité dans l'ensemble du marché. Calculée après le
  // filtre de recherche, taper « iron » suffisait à repeindre Iron (3 900 aUEC/SCU, le bas du
  // classement) en `t-hot`, le palier réservé aux 15 % les mieux payés — rang 0 sur 1 ligne restante.
  commMaxMargin = all.reduce((mx, c) => Math.max(mx, c.margin || 0), 0); // heatmap relative (Marché)
  commTiers = etat.commBoard === "loot" ? valueTiers(all) : new Map();        // heatmap par rang (Butin)
  const rows = all.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q))
  );
  sortCommodities(rows);
  shownCommodities = rows;
  commDupCodes = ambiguousCodes(rows);                                    // codes UEX non discriminants
  commCarried = journeyCarriedCommodities(); // commodités du voyage à surligner
  // Sélection : garde la commodité choisie si toujours visible, sinon prend la 1re.
  if (etat.commSelected && !rows.some((r) => r.name === etat.commSelected)) etat.commSelected = null;
  if (!etat.commSelected && rows.length) etat.commSelected = rows[0].name;
  peindreGrilleCommodites();
  // Bouton de mode de tri actif.
  document.querySelectorAll("#commSortModes button").forEach((b) => b.classList.toggle("active", b.dataset.sort === etat.commMode));
  syncCommBoardUI();
  paintCommodityDetail();
  notifySuperseded();
}

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
  // #origin et #chainOrigin, faute de quoi chaque frappe re-rendrait ET réécrirait le hash.
  $("tourFrom").addEventListener("input", refreshDebounced);
  $("tourScope").addEventListener("input", refresh); // <select> : un seul événement, immédiat
  // La marque ramène à TRAJETS, la vue principale — pas au Plan de vol (ADR-004 §5). Un <button>
  // natif : Entrée et Espace y viennent sans rien ajouter.
  $("brandHome").addEventListener("click", () => switchView("routes"));
  // Copie du récapitulatif : écouteur DÉLÉGUÉ sur l'en-tête, que renderPlan réécrit à chaque rendu.
  $("planHead").addEventListener("click", (e) => {
    if (e.target.closest("#planCopy")) copierPlan();
  });
  $("share").addEventListener("click", copyShareLink);
  // Contrôles « Commodités » : modes de tri + sélection d'une tuile.
  $("commSortModes").addEventListener("click", (e) => { const b = e.target.closest("button[data-sort]"); if (b) setCommSort(b.dataset.sort); });
  $("commBoardModes").addEventListener("click", (e) => { const b = e.target.closest("button[data-board]"); if (b) setCommBoard(b.dataset.board); });
  $("commGrid").addEventListener("click", (e) => {
    const tile = e.target.closest(".comm-tile");
    if (!tile) return;
    etat.commSelected = tile.dataset.name;
    peindreGrilleCommodites();
    paintCommodityDetail();
    saveState();
    notifier(); // idem : hors `refresh()`
  });
  // Contrôles « En route ». Ces champs de terminal sont eux aussi à SAISIE LIBRE (datalist, mais
  // rien n'oblige à choisir dans la liste) : même debounce que ci-dessus. Sans lui, chaque frappe
  // re-rendait la vue ET réécrivait le hash — or WebKit plafonne history.replaceState à 100 appels
  // par 10 s : taper deux noms de terminal suffisait à le franchir. Les résolveurs restent DANS le
  // rappel, donc dans le même ordre qu'avant ; renderEnRoute / renderChain / renderCorrections les
  // rejouent de toute façon avant de peindre.
  $("origin").addEventListener("input", debounce(() => { resolveOrigin(); refresh(); }));
  $("destSystem").addEventListener("input", refresh); // <select> : un seul événement, immédiat
  $("destTerminal").addEventListener("input", refreshDebounced); // terminal d'arrivée forcé
  // Contrôles « Chaîne ».
  $("chainOrigin").addEventListener("input", debounce(() => { resolveChainOrigin(); refresh(); }));
  $("hops").addEventListener("input", refresh);
  // Contrôles « Corrections » : recherche de station + suppression / reset (délégué).
  // Ne re-rend QUE si la station résolue a CHANGÉ. Le sélecteur, lui, rend immédiatement au choix :
  // sans ce garde, le rendu différé du debounce arrivait ~300 ms après et refaisait le même écran
  // pour rien — en détachant au passage l'éditeur d'un chiffre ouvert entre les deux. Même famille
  // que #24 : tout re-rendu gratuit de cette vue efface une saisie en cours.
  $("station").addEventListener("input", debounce(() => {
    const avant = stationSel;
    resolveStation();
    if (stationSel !== avant) refresh();
  }));
  $("corrections").addEventListener("click", (e) => {
    // Les relevés d'autoload se testent AVANT les corrections : leur ✕ porte aussi `.corr-del`
    // (même bouton à l'écran) et tomberait sinon dans la branche qui écrit dans OVERRIDES.
    const alDel = e.target.closest(".al-del");
    if (alDel) { forgetStationReading(alDel.dataset.key); return; }
    // Vignette de la bande : recharge sa station. Écrit le LIBELLÉ CANONIQUE, comme le sélecteur —
    // resolveStation résout par correspondance exacte, et c'est lui que le permalien transporte.
    const tuile = e.target.closest(".stn-tile");
    if (tuile && !tuile.disabled) {
      const t = termByName.get(tuile.dataset.terminal);
      if (t) { $("station").value = stationLabel(t.name, t.system); resolveStation(); refresh(); saveState(); }
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
      const nom = stationSel != null ? etat.MARKET.terminals[stationSel].name : null;
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
    const del = e.target.closest(".corr-del");
    if (del) {
      // Supprimer une correction de volume rend le stock d'UEX : c'est encore un changement de
      // volume, donc la même règle s'applique — le voyage déjà planifié ne doit pas s'y rebattre.
      const cle = del.dataset.key;
      if (etat.OVERRIDES[cle] && etat.OVERRIDES[cle].vol != null) {
        const [commodity, terminal, side] = cle.split("|");
        pinLegsForVolume(commodity, terminal, side);
      }
      delete etat.OVERRIDES[cle]; saveOverrides(); updateOvBadge(); refresh(); return;
    }
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
    if (e.target.closest("#chainToJourney") && shownChain) { pickJourney(legsFromChain(shownChain, etat.MARKET.terminals)); return; }
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
    applyState(saved);
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
