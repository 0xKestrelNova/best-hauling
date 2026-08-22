// La VUE Boucles : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// `boucles.tsx` garde la PRÉSENTATION — la ligne, ses deux extrémités, le ▶. Ce fichier-ci porte la
// DÉCISION : quelles boucles passent les filtres, comment on les évalue, dans quel ordre, et
// laquelle remonte en tête parce qu'elle part de là où l'on est.
//
// ── LE `<thead>` RESTE VANILLA, ET C'EST LE POINT ─────────────────────────────────────────────
// Le portail vise `#loopRows`, le `<tbody>`. Le `<thead>` et ses `th[data-sort-loop]` restent du
// markup d'`index.html`, câblés par `setupLoopSort` (app.js) qui pose `aria-sort` et les classes de
// tri. React ne possède que le corps du tableau — exactement comme quand `peindre()` s'en chargeait.
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import { bySort, journeyEnd, legsFromLoop, loopMetrics, loopPasses } from "../logic.ts";
import type { Boucle, Filtres, FiltresVolume, SegmentBoucle } from "../types.ts";
import type { BoucleEvaluee } from "./boucles.tsx";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { notifySuperseded } from "../corrections-actions.ts";
import { ensureFeeMarket } from "../donnees.ts";
import { feeCell, feeCtx } from "../frais.ts";
import { fmt } from "../format.ts";
import { pickJourney } from "../voyage-actions.ts";
import { MESSAGE_VIDE, messageVide } from "./message-vide.ts";
import { VueBoucles } from "./boucles.tsx";

// Une jambe de boucle, corrections locales appliquées. `demandKnown` distingue « capacité inconnue
// chez UEX » de « demande nulle » — ni zéro ni illimitée.
function effLeg(leg: SegmentBoucle, buyT: string, sellT: string) {
  const b = effVals(leg.commodity, buyT, "buy", leg.buyPrice, leg.stock, leg.updated);
  const s = effVals(leg.commodity, sellT, "sell", leg.sellPrice, leg.demand, leg.updated);
  return { ...leg, buyPrice: b.price, stock: b.vol, sellPrice: s.price, demand: s.vol, demandKnown: s.ovol, margin: s.price - b.price };
}

function evaluateLoop(l: Boucle, f: Filtres & FiltresVolume): BoucleEvaluee {
  const out = effLeg(l.out, l.a.terminal, l.b.terminal);
  const back = effLeg(l.back, l.b.terminal, l.a.terminal);
  const cross = l.a.system !== l.b.system;
  // Une boucle n'a pas un terminal d'achat et un de vente : elle a deux EXTRÉMITÉS qui sont tour à
  // tour l'un et l'autre, d'où { a, b } et quatre opérations facturées (cf. loopMetrics).
  const feeInfo = feeCtx(f, l.a.terminal, l.b.terminal);
  const metrics = loopMetrics(out, back, l.distance, cross, f, feeInfo && { a: feeInfo.a.point, b: feeInfo.b.point });
  return { ...l, out, back, cross, feeInfo, ...metrics } as BoucleEvaluee;
}

export function VueBouclesArbitrage() {
  // Le relevé des corrections périmées : un effet, donc avant tout retour anticipé.
  useLayoutEffect(notifySuperseded);

  const active = etat.view === "loops";
  const f = readFilters();

  // Le calcul n'a lieu QUE si l'on regarde la vue — la garde de l'ADR-012, en tête. Mais le hook
  // du message vide, lui, doit être appelé à tous les rendus : on prépare donc les lignes avant de
  // sortir, et on ne sort qu'après. `[]` quand la vue est ailleurs ne coûte rien.
  const lignes: BoucleEvaluee[] = [];
  if (active) {
    // `ensureFeeMarket` re-rend la vue RÉELLEMENT active à l'arrivée du marché, pas celle d'alors.
    ensureFeeMarket(f, notifier);
    const rows = etat.LOOPS.filter((l) => loopPasses(l, f)).map((l) => evaluateLoop(l, f));
    rows.sort(bySort(etat.loopSortKey, etat.loopSortDir));
    // Compagnon : remonte en tête (sans filtrer) les boucles qui partent de la FIN du parcours —
    // c'est le point d'extension, une boucle depuis là s'enchaîne au parcours. Cohérent avec
    // `addToJourney`.
    const hereArrival = etat.JOURNEY ? journeyEnd(etat.JOURNEY)?.name : null;
    if (hereArrival) {
      rows.forEach((l) => { l._fromHere = l.a.terminal === hereArrival || l.b.terminal === hereArrival; });
      rows.sort((a, b) => (b._fromHere ? 1 : 0) - (a._fromHere ? 1 : 0)); // tri stable : pertinentes d'abord
    }
    lignes.push(...rows);
  }

  // `#empty` est PARTAGÉ avec Trajets et « En route », toutes deux encore dans `app.js` : on passe
  // donc par l'écrivain unique plutôt que d'y rendre un portail, qui entrerait en conflit avec leurs
  // écritures impératives. En `useLayoutEffect` et non `useEffect` : le message doit être posé avant
  // la peinture, sinon un tableau vide s'affiche une frame sans rien dire.
  useLayoutEffect(() => {
    if (active) messageVide(lignes.length ? null : MESSAGE_VIDE);
  });

  if (!active) return null;

  const cible = document.getElementById("loopRows");
  if (!cible) return null;

  return createPortal(
    <VueBoucles
      lignes={lignes}
      celluleFrais={(l) => feeCell(l.feeInfo, l.fees, () => `${fmt(l.unitsOut)} + ${fmt(l.unitsBack)} SCU, 4 opérations (charge et décharge à chaque bout)`, l.units > 0)}
      avecTexteFrais={(base, cell) => (cell.text ? `${base} · ${cell.text}` : base)}
      // On entre dans le cycle par la FIN du parcours : la boucle l'étend au lieu de le remplacer.
      // `journeyEnd(JOURNEY)` est relu DANS le corps de la flèche, donc AU CLIC — et surtout pas
      // repris de `hereArrival`, calculé au rendu : le parcours a pu bouger entre les deux.
      choisirBoucle={(l) => pickJourney(legsFromLoop(l, etat.JOURNEY ? journeyEnd(etat.JOURNEY)?.name : null))}
    />,
    cible,
  );
}
