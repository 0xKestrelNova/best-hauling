"use strict";

// L'AMORÇAGE — ce qui reste quand `app.js` a disparu (ADR-011, ADR-012).
//
// Ce fichier était `app.js` : 2 869 lignes, l'application entière. Il n'exportait rien, et c'est
// ce qui bloquait tout — aucun module ne pouvait l'appeler. Les huit vues vivent maintenant dans
// l'arbre React, les gestes dans leurs modules, le cycle dans `rendu.ts`. Ce qui subsiste est une
// SÉQUENCE : brancher, monter, écouter, charger, restaurer, peindre.
//
// ── POURQUOI CE N'EST PAS UN COMPOSANT ────────────────────────────────────────────────────────
// Rien ici n'a de raison d'entrer dans l'arbre. Les `<datalist>` sont des `<option>` nus posés une
// fois. `#meta`, `#railStatus` et `#railVersion` vivent dans l'en-tête et le rail, hors de
// `#racine`, alimentés par un `meta.json` lu UNE fois. Et les quarante écouteurs sont posés sur du
// markup d'`index.html` : une délégation posée sur un parent que React ne possède pas traverse le
// portail intacte (ADR-012 §2). La convertir en `onClick` doublerait l'action, et seul un compteur
// de propagations le verrait.
//
// ── QUATRE ORDRES SONT DES CONTRATS ───────────────────────────────────────────────────────────
//   1. `brancher()` AVANT `monterRacine()`. Le crochet vaut `() => {}` par défaut : posé après, la
//      première passe de l'arbre appellerait dans le vide, sans la moindre erreur — datalists
//      vides, `stationMap` vide, vue Corrections inerte ;
//   2. `loadChargements()` APRÈS `loadSoute()`. Sa migration reconstruit le registre DEPUIS les
//      lots et resauve les deux. Inversée, elle le reconstruirait sur une soute vide et
//      persisterait la perte, définitivement et sans message ;
//   3. `loadState()` AVANT le premier `await`. Les écouteurs sont déjà posés, et `saveState()`
//      réécrit le hash : décalé après le fetch, un geste fait pendant le chargement écraserait le
//      permalien — c'est-à-dire précisément sur connexion lente, le cas où le lien compte ;
//   4. les `<option>` de `#system` AVANT `applyState()`. Poser `select.value = "Stanton"` sur un
//      `<select>` qui n'a pas l'option retombe SILENCIEUSEMENT sur `""` : le filtre restauré
//      s'évapore, et un lien partagé n'ouvre pas la même vue. Aucun test ne le verrait.
//
// `tsc` ne lit pas ce fichier (hors `include` de `tsconfig.json`) : un identifiant libre ne se voit
// qu'à l'exécution, par les tests Playwright.

// Fonctions de calcul pures (testées par logic.test.mjs).
import { ovKey, stationLabel } from "./logic.ts";
import { etat } from "./etat.ts";
import { esc } from "./format.ts";
import { loadOverrides, saveOverrides, setOverride } from "./corrections.ts";
import { effacerToutesLesCorrections, updateOvBadge } from "./corrections-actions.ts";
import { enregistrerReleve, oublierReleve, oublierTousLesReleves } from "./frais-actions.ts";
import { showToast } from "./messages.ts";
import {
  construireIndex, indexStationExacte, libellesOrigines, libellesStations, termByName,
} from "./marche.ts";
import { loadAutoloadK } from "./frais.ts";
import { applyState, loadState, saveState } from "./persistance.ts";
import { brancher, withMarket } from "./donnees.ts";
import { basculerVue, brancherNavigation } from "./navigation.js";
import { synchroniserReglages } from "./filtres.ts";
import { brancherTri, poserIndicateursDeTri } from "./tri.js";
import { debounce, rafraichir, rafraichirDifferee } from "./rendu.ts";
import {
  addManifestCommodity, addSuggestion, oublierCompositionSiRouteChangee, removeManifestLine,
  resetManifeste, updateManifestTotals,
} from "./manifeste-gestes.js";
import {
  copierCorrections, copierEntrepots, copierPlan, copyManifest, copyShareLink,
} from "./presse-papiers.js";
import {
  addLegLine, addLegSuggestion, addStopByTerminal, beginJourney, clearJourney, delLegLine,
  editLegQty, liveLegQty, manifestToJourney, removeJourneyStop, resetLeg, setJourneyStop,
  toggleLegEditor,
} from "./voyage-gestes.js";
import {
  basculerEcoulement, chargerJambe, declarerABord, deposerIci, fermerDeclaration, fermerVente,
  loadChargements, loadDepots, loadSoute, ouvrirDeclaration, ouvrirVente, poserPosition,
  reprendreIci, retirerLot, vendreIci, viderSoute,
} from "./soute-actions.js";
import { loadManifestEdit } from "./manifeste-etat.ts";


import {
  chargerVaisseaux, memoriserStation, monterSelecteurStation, montrerCarteVaisseau, stationChangee,
} from "./selecteur.js";
import { monterRacine } from "./main.tsx";
import { loadJourneyEdits, loadJourneyPins, pinLegsForVolume } from "./voyage-donnees.ts";
// (`vues/tournee.tsx` et `vues/plan.tsx` ne sont plus importés ici : leurs vues vivent dans l'arbre
// depuis #143 et #145, et seuls leurs composants de DÉCISION les consomment désormais.)
// La vue Commodités n'expose plus sa présentation à app.js — seulement ses trois ACTIONS, comme
// `plan-vue.tsx` expose `planData`. Les écouteurs de `#commSortModes` / `#commBoardModes` restent
// ici : leurs conteneurs sont du markup d'index.html (ADR-012 §2).
import { refletBoardCommodites, setCommBoard, setCommSort } from "./vues/commodites-vue.tsx";


const $ = (id) => document.getElementById(id);

// ── LES TROIS LISTES DÉROULANTES, PEUPLÉES AU MARCHÉ ──────────────────────────────────────────
// Elles ne valent pas un composant : ce sont des `<option>` nus, sans classe et sans événement,
// posés une fois et jamais relus par React. Elles vivent ici et non dans `donnees.ts`, qui déclare
// en tête ne rien savoir des `<datalist>` ni des messages — les deux crochets de `brancher()`
// n'existent que pour ça.
let listesPretes = false;

/** Prévient que le marché est indisponible, plutôt que de laisser la vue vide ET muette. */
const marcheIndisponible = () => showToast("⚠ Marché indisponible — vérifie ta connexion, puis réessaie");

/**
 * Peuple les trois `<datalist>` et monte le sélecteur de station. IDEMPOTENT.
 *
 * ATTENTION : `withMarket` enveloppe son rappel dans un `.catch()`. Toute exception jetée ici —
 * un identifiant libre, par exemple — s'affiche à l'écran comme « ⚠ Marché indisponible ». Et
 * `tsc` ne lit pas ce fichier : seul `e2e/arbre.pw.mjs` garde ce piège.
 */
function peuplerListes() {
  if (listesPretes) return;
  // Les trois index viennent de `marche.ts` ; ici on ne fait plus que peindre les listes.
  construireIndex(etat.MARKET);
  // Départ d'« En route » : les terminaux où l'on peut ACHETER.
  $("originList").innerHTML = libellesOrigines().map((l) => `<option value="${esc(l)}"></option>`).join("");
  // Toutes les stations (achat ou vente) : c'est la vue Corrections qui l'exige.
  $("stationList").innerHTML = libellesStations().map((l) => `<option value="${esc(l)}"></option>`).join("");
  // Toutes les commodités, pour l'ajout libre au chargement.
  $("commodityList").innerHTML = etat.MARKET.commodities
    .map((c) => `<option value="${esc(c.name)}">${esc(c.code || "")}</option>`).join("");

  // Le sélecteur de station (ADR-003) se monte ICI et une seule fois : il lui faut MARKET, et
  // c'est le seul point du cycle où le marché est garanti présent.
  monterSelecteurStation();

  listesPretes = true;
}

async function init() {
  // Les deux crochets du chargement : `donnees.ts` sait charger, il ne sait rien des `<datalist>`
  // ni des messages. `peuplerListes` DOIT tourner avant chaque rappel de `withMarket` — le déclarer
  // ici une fois vaut mieux que de le répéter à seize appels.
  brancher({ apresMarche: peuplerListes, signalerIndisponible: marcheIndisponible });
  // (Le second crochet, `brancherRendu`, n'existe plus : le cycle EST `rendu.ts`, et tout le monde
  // l'importe — y compris ce fichier. Il n'y a plus rien à brancher.)
  // La racine unique. Elle s'abonne à `etat` : à partir d'ici, une vue qui y vit se re-rend
  // toute seule à chaque `notifier()`, sans que `rafraichir()` ait à la nommer.
  monterRacine();
  brancherTri();
  poserIndicateursDeTri(); // aria-sort/classes du tri par défaut, sans dépendre des attributs du HTML
  // Les champs à SAISIE LIBRE sont débouncés : sans ça, chaque caractère relançait un cycle
  // complet calcul + réécriture de #rows par innerHTML. Mesuré à ~142 ms par frappe sur un CPU
  // throttlé ×4 (le coût dominant est le relayout de la table, pas le calcul : ~2 ms), soit plus
  // d'une seconde de thread bloqué pour taper « Laranite », et deux recalculs sur des valeurs
  // absurdes quand on tape « 696 » dans la soute (6 puis 69 SCU).
  // Menus et cases à cocher restent IMMÉDIATS : ils n'émettent qu'un seul événement.
  ["cargo", "budget", "search", "alk"].forEach((id) => $(id).addEventListener("input", rafraichirDifferee));
  ["system", "freshness", "sameSystem", "noOutpost", "legalOnly", "capStock", "multiMode"].forEach((id) =>
    $(id).addEventListener("input", rafraichir)
  );
  // Ces deux-là commandent en plus l'affichage de leur propre sous-réglage (coefficient k, portée
  // de la liste multi) : ils passent donc par synchroniserReglages avant de recalculer.
  ["autoload", "multiCommodity"].forEach((id) =>
    $(id).addEventListener("input", () => { synchroniserReglages(); rafraichir(); })
  );
  ["useCargo", "useBudget"].forEach((id) =>
    $(id).addEventListener("change", () => {
      synchroniserReglages();
      rafraichir();
    })
  );
  // Contrôles « Tournée ». Terminal à SAISIE LIBRE (datalist, mais rien n'oblige à choisir dedans) :
  // même debounce que `#origin` et `#chainOrigin`, faute de quoi chaque frappe re-rendrait ET
  // réécrirait le hash.
  $("tourFrom").addEventListener("input", rafraichirDifferee);
  $("tourScope").addEventListener("input", rafraichir); // <select> : un seul événement, immédiat
  brancherNavigation(); // le rail, la marque et les touches 1…8
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
  // rappel, donc dans le même ordre qu'avant ; les vues de l'arbre les
  // rejouent de toute façon avant de peindre.
  // CHANGER DE ROUTE ABANDONNE LA COMPOSITION, et c'est un GESTE — plus une décision du rendu.
  // `compositionValide` se contente désormais de dire qu'elle ne vaut plus ; c'est ici qu'on
  // l'efface, parce que c'est ici que l'utilisateur a changé d'avis. La laisser en réserve la
  // ferait ressurgir au retour sur cette route, longtemps après le geste qui l'avait écrite.
  const changerDeRoute = () => { oublierCompositionSiRouteChangee(); rafraichir(); };
  $("origin").addEventListener("input", debounce(changerDeRoute));
  $("destSystem").addEventListener("input", changerDeRoute); // <select> : un seul événement, immédiat
  $("destTerminal").addEventListener("input", debounce(changerDeRoute)); // terminal d'arrivée forcé
  // Contrôles « Chaîne ».
  $("chainOrigin").addEventListener("input", debounce(rafraichir));
  $("hops").addEventListener("input", rafraichir);
  // Contrôles « Corrections » : recherche de station + suppression / reset (délégué).
  // Ne re-rend QUE si la station résolue a CHANGÉ. Le sélecteur, lui, rend immédiatement au choix :
  // sans ce garde, le rendu différé du debounce arrivait ~300 ms après et refaisait le même écran
  // pour rien — en détachant au passage l'éditeur d'un chiffre ouvert entre les deux. Même famille
  // que #24 : tout re-rendu gratuit de cette vue efface une saisie en cours.
  $("station").addEventListener("input", debounce(() => { if (stationChangee()) rafraichir(); }));
  $("corrections").addEventListener("click", (e) => {
    // Les relevés d'autoload se testent AVANT les corrections : leur ✕ porte aussi `.corr-del`
    // (même bouton à l'écran) et tomberait sinon dans la branche qui écrit dans OVERRIDES.
    const alDel = e.target.closest(".al-del");
    if (alDel) { oublierReleve(alDel.dataset.key); return; }
    // Vignette de la bande : recharge sa station. Écrit le LIBELLÉ CANONIQUE, comme le sélecteur —
    // la résolution est exacte, et c'est ce libellé-là que le permalien transporte.
    const tuile = e.target.closest(".stn-tile");
    if (tuile && !tuile.disabled) {
      const t = termByName.get(tuile.dataset.terminal);
      if (t) { $("station").value = stationLabel(t.name, t.system); memoriserStation(); rafraichir(); saveState(); }
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
      rafraichir();
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
        saveOverrides(); updateOvBadge(); rafraichir();
      }
      return;
    }
    // La branche `.corr-del` générique est partie : elle était MORTE. Les deux seuls producteurs de
    // cette classe (`vues/frais-station.tsx`) posent aussi `.al-del`, interceptée trois lignes plus
    // haut avec un `return`. Elle datait de la liste plate de corrections, remplacée par la bande de
    // vignettes. La garder « par prudence » rouvrirait un chemin d'écriture d'OVERRIDES qui n'existe
    // plus — et un test asserte au contraire qu'aucun `.corr-item:not(.autoload)` ne subsiste.
    if (e.target.closest("#alSave")) { enregistrerReleve(); return; }
    if (e.target.closest("#resetAllK")) { oublierTousLesReleves(); return; }
    // Avant « Tout réinitialiser » ici aussi : rien ne doit s'effacer sans qu'on ait pu l'emporter.
    if (e.target.closest("#exportCorrections")) { copierCorrections(); return; }
    if (e.target.closest("#resetAll")) effacerToutesLesCorrections();
  });
  // Validation du relevé d'autoload à la touche Entrée (les deux champs sont dans le même panneau).
  $("corrections").addEventListener("keydown", (e) => {
    if ((e.target.id === "alAmount" || e.target.id === "alScu") && e.key === "Enter") { e.preventDefault(); enregistrerReleve(); }
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
  // La soute : vider, écouler, déposer, vendre, retirer un lot.
  $("holdCard").addEventListener("click", (e) => {
    if (e.target.closest("#holdClear")) { viderSoute(); return; }
    if (e.target.closest("#holdOffload")) { basculerEcoulement(); return; }
    // La quantité ET la station se lisent sur le MÊME conteneur : celui que le rendu a produit.
    // `dataset.idx` absent -> undefined -> NaN -> repli sur stationCourante() ; jamais 0.
    const deposer = e.target.closest(".hold-store");
    if (deposer) { const b = deposer.closest(".hold-sell"); deposerIci(deposer.dataset.name, Number(b.querySelector(".hold-sell-qty").value), Number(b.dataset.idx)); return; }
    const ouvrir = e.target.closest(".hold-sell-btn");
    if (ouvrir) { ouvrirVente(ouvrir.dataset.name); return; }
    if (e.target.closest(".hold-sell-no")) { fermerVente(); return; }
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
    else if (e.key === "Escape") { e.preventDefault(); fermerVente(); }
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
  // Carte du parcours : cliquer une escale déplace « je suis ici », comme le fil d'étapes.
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
  // (même corps, cf. `enTeteTriable` dans tri.js). On teste `e.target` LUI-MÊME et non `closest()` — modèle
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
    if ((e.target.id === "journeyStart" || e.target.id === "journeyAddStop") && !listesPretes) {
      if (etat.MARKET) peuplerListes();
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
  loadOverrides();
  loadAutoloadK();
  loadJourneyEdits();
  loadJourneyPins();
  loadManifestEdit();
  loadSoute();
  loadChargements(); // après loadSoute : la migration reconstruit le registre depuis les lots
  loadDepots();
  updateOvBadge();
  synchroniserReglages();

  // État à restaurer (URL partagée en priorité, sinon dernière session locale).
  const saved = loadState();

  try {
    const [routes, loops, meta] = await Promise.all([
      fetch("data/routes.json").then((r) => r.json()),
      fetch("data/loops.json").then((r) => r.json()).catch(() => []),
      fetch("data/meta.json").then((r) => r.json()).catch(() => null),
      chargerVaisseaux(),
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
    applyState(saved, () => { poserIndicateursDeTri(); synchroniserReglages(); refletBoardCommodites(); });
    montrerCarteVaisseau(); // ré-affiche la carte du vaisseau restauré (image comprise)
    // Le compagnon de voyage vient d'un permalien, donc de données non fiables. S'il échoue, il ne
    // doit pas emporter TOUTE l'app dans le catch ci-dessous, qui accuserait alors data/routes.json
    // — parfaitement chargé — et laisserait l'utilisateur devant une page vide et un message faux.
    try {
      rafraichir();
    } catch (err) {
      etat.JOURNEY = null;
      rafraichir();
      showToast("⚠ Parcours illisible dans le lien — il a été ignoré");
    }
    basculerVue(etat.view);
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
