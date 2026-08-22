// La VUE Trajets : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// La vue par DÉFAUT, la plus testée du dépôt, et la seule à avoir DEUX modes qui partagent un
// conteneur : les trajets à une commodité, et les chargements COMBINÉS que la case « Multi
// commodité » substitue aux premiers.
//
// `trajets.tsx` garde la PRÉSENTATION des deux. Ce fichier-ci porte la DÉCISION : quel mode, quelles
// lignes, dans quel ordre, et quel message quand il n'y en a aucune.
//
// ── LES DEUX MODES SONT UNE BRANCHE, PAS DEUX VUES ────────────────────────────────────────────
// Ils écrivent le MÊME `<tbody>` et le MÊME `#empty`, et c'est délibéré : basculer la case ne change
// pas d'écran, elle change ce que l'écran répond. Deux composants portails sur `#rows` se
// battraient pour la même racine.
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import {
  bySort, legFromTrip, lineFreshUpdated, multiTrips, netMarginRoi, routeMetrics, routePasses, tripMetrics,
} from "../logic.ts";
import type { Filtres, FiltresVolume, Route } from "../types.ts";
import type { LigneTrajet } from "./trajets.tsx";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { notifySuperseded } from "../corrections-actions.ts";
import { ensureFeeMarket, withMarket } from "../donnees.ts";
import { cargoBoxesLabel, scuBoxesLabel } from "../format.ts";
import { feeCargoText, feeCell, feeCtx, feeResolver, lineProfitText } from "../frais.ts";
import { pickJourney } from "../voyage-actions.ts";
import { MESSAGE_VIDE, messageVide } from "./message-vide.ts";
import { propsLignesSimples, propsTrajetsCommunes } from "./trajets-props.tsx";
import { VueTrajets, VueTrajetsMulti } from "./trajets.tsx";

/** Applique les corrections à une paire buy/sell et rend des copies patchées + marge/ROI. */
function applyOverrides(commodity: string, buy: Route["buy"], sell: Route["sell"]) {
  const b = effVals(commodity, buy.terminal, "buy", buy.price, buy.stock, buy.updated);
  const s = effVals(commodity, sell.terminal, "sell", sell.price, sell.demand, sell.updated);
  const nb = { ...buy, price: b.price, stock: b.vol, ovPrice: b.oprice, ovVol: b.ovol };
  const ns = { ...sell, price: s.price, demand: s.vol, ovPrice: s.oprice, ovVol: s.ovol };
  const margin = ns.price - nb.price;
  const roi = nb.price > 0 ? Math.round((margin / nb.price) * 1000) / 10 : 0;
  return { buy: nb, sell: ns, margin, roi };
}

/** Une ligne de `routes.json`, corrections et frais appliqués. */
export function evaluate(r: Route, f: Filtres & FiltresVolume): LigneTrajet {
  const { buy, sell, margin } = applyOverrides(r.commodity, r.buy, r.sell);
  // `routes.json` et `enRouteDeals` ne donnent que des NOMS de terminaux : c'est ici, du côté
  // impur, qu'ils deviennent des tarifs. `routeMetrics`, lui, reçoit un contexte déjà résolu.
  const feeInfo = feeCtx(f, buy.terminal, sell.terminal);
  const metrics = routeMetrics({
    buyPrice: buy.price, buyStock: buy.stock, sellDemand: sell.demand, margin,
    distance: r.distance, sameSystem: r.same_system,
    buyUpdated: buy.updated, sellUpdated: sell.updated,
    demandKnown: sell.ovVol, // demande corrigée par l'utilisateur = fiable
  }, f, feeInfo && feeInfo.pair);
  // Marge et ROI NETS des frais, comme en mode multi : la même colonne garde la même définition d'un
  // mode à l'autre. Sans frais, `netMarginRoi` rend exactement la marge de marché et l'ancien ROI.
  const net = netMarginRoi(margin, buy.price, metrics.units, metrics.fees);
  return { ...r, buy, sell, buyPrice: buy.price, sellPrice: sell.price, feeInfo, ...metrics, ...net } as LigneTrajet;
}

export function VueTrajetsArbitrage() {
  useLayoutEffect(notifySuperseded);

  const active = etat.view === "routes";
  const f = readFilters();
  const multi = !!f.multi;

  // Ce que le rendu produira : le contenu du `<tbody>` et le message de `#empty`. On les prépare
  // AVANT le retour anticipé pour que le hook du message soit appelé à tous les rendus (règle des
  // hooks), mais le calcul lui-même reste sous la garde de vue.
  let contenu: React.ReactNode = null;
  let message: string | null = null;

  if (active && !multi) {
    // `ensureFeeMarket` re-rend la vue RÉELLEMENT active à l'arrivée du marché, pas celle d'alors.
    ensureFeeMarket(f, notifier);
    const lignes = etat.ROUTES.filter((r) => routePasses(r, f)).map((r) => evaluate(r, f));
    lignes.sort(bySort(etat.sortKey, etat.sortDir));
    contenu = <VueTrajets {...propsTrajetsCommunes()} {...propsLignesSimples()} lignes={lignes} />;
    message = lignes.length ? null : MESSAGE_VIDE;
  } else if (active) {
    // ── Mode MULTI-COMMODITÉ ──────────────────────────────────────────────────────────────────
    // Sans soute bornée, « remplir la soute » n'a pas de sens (cf. manifeste d'« En route »).
    if (!f.useCargo || !(f.cargo > 0)) {
      message = "Active la soute (SCU) pour calculer des trajets multi-commodité.";
    } else if (!etat.MARKET) {
      // On VIDE le tableau, comme la branche ci-dessus : laisser les trajets à UNE commodité sous
      // un mode qui promet des chargements combinés, c'est afficher autre chose que ce qu'on
      // annonce. Et `#empty` reste masqué — le tableau n'est pas vide à cause des filtres, c'est le
      // marché qui manque.
      withMarket(notifier);
      message = null;
    } else {
      // Le contexte de frais descend DANS `multiTrips` (et non après coup) : c'est lui qui trie
      // puis TRONQUE à 300 trajets, un trajet meilleur en net serait donc coupé avant d'atteindre
      // le tableau.
      const trips = multiTrips(etat.MARKET, f, effVals, 300, f.multiAll ? 1 : 2, feeResolver(f))
        .map((t) => ({ ...t, feeInfo: feeCtx(f, t.origin.name, t.dest.name, t.origin, t.dest), ...tripMetrics(t) }));
      trips.sort(bySort(etat.sortKey, etat.sortDir));
      contenu = (
        <VueTrajetsMulti
          {...propsTrajetsCommunes()}
          lignes={trips}
          celluleFrais={(t) => feeCell(t.feeInfo, t.fees, () => feeCargoText(t.lines, t.origin.maxBox), t.units > 0)}
          libelleCaisses={(t) => (t.units ? cargoBoxesLabel(t.lines, t.origin.maxBox) : null)}
          // Le relevé le plus ANCIEN du chargement : un trajet ne vaut pas mieux que sa ligne la
          // moins sûre.
          releveLePlusAncien={(t) => t.lines.reduce((m, l) => { const u = lineFreshUpdated(l); return m && u ? Math.min(m, u) : m || u; }, 0)}
          texteProfitLigne={lineProfitText}
          libelleCaissesScu={scuBoxesLabel}
          // EXPLICITE, et pas par `propsLignesSimples()` : cette vue-ci ne l'étale pas, et un
          // chargement multi ne devient pas une jambe par le même chemin qu'une ligne simple.
          choisirTrajet={(t) => pickJourney([legFromTrip(t)])}
        />
      );
      // Rappel : seuls les chargements COMBINÉS (≥ 2 commodités) sont listés — un trajet dont le
      // remplissage optimal tient en une seule commodité est déjà dans la vue normale.
      message = trips.length ? null : (f.multiAll
        ? "Aucun chargement depuis ces terminaux avec ces filtres — élargis la soute ou le budget."
        : "Aucun chargement combinant plusieurs commodités avec ces filtres — agrandis la soute, ou passe la liste sur « avec les simples ».");
    }
  }

  // `#empty` est PARTAGÉ avec « En route », encore dans `app.js` : on passe par l'écrivain commun.
  useLayoutEffect(() => {
    if (active) messageVide(message);
  });

  if (!active) return null;
  const cible = document.getElementById("rows");
  return cible ? createPortal(contenu, cible) : null;
}
