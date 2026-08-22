// LE BANDEAU : compagnon de voyage, récapitulatif, soute, entrepôts, déclaration (ADR-012).
//
// Le lot le plus DIFFÉRENT des huit vues d'onglet, et pour une raison de forme : il n'est pas une
// vue. Il est visible dans SIX vues sur huit — seul le Plan de vol le masque, parce qu'une
// conclusion ne s'édite pas (ADR-004). Il ne prend donc pas de garde `si="…"` mais son INVERSE.
//
// ── POURQUOI UN SEUL COMPOSANT POUR CINQ CARTES ───────────────────────────────────────────────
// `ajusterRangeeVoyage` MESURE la hauteur de `#journeyCard` et de `#voyageLeft` pour décider
// d'empiler les colonnes, et elle doit le faire APRÈS que les deux ont été peintes. C'est ce qui
// obligeait `app.js` à peindre les quatre cartes en `{ synchrone: true }` — un `flushSync` par
// carte, quatre fois par rendu, pour que `getBoundingClientRect` ne lise pas l'état d'avant. Mal
// réglé, la carte basculait de 1 172 px à 640 px de large selon l'état, et la bascule s'inversait
// à l'état suivant.
//
// Rendues par le MÊME arbre, les cinq cartes sont commitées dans la même passe, et un
// `useLayoutEffect` posé en fin de composant tourne après toutes les mutations du DOM et avant la
// peinture. Les quatre `flushSync` disparaissent, et la mesure devient exacte par construction au
// lieu de l'être par discipline.
//
// ── LA GÉNÉRATION DU COMPAGNON ────────────────────────────────────────────────────────────────
// Même mécanique que la carte de chargement : elle remonte les champs SCU d'une jambe à chaque
// RECALCUL, et ne bouge pas pendant qu'on tape. `liveLegQty` n'appelle donc que `notifier()`.
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import {
  freeCargo, holdByCommodity, holdScu, journeyMargin, journeyStations, lineFreshUpdated,
  manifestTotals, offloadPlan, parseStationLabel, sellableAt,
} from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { withMarket } from "../donnees.ts";
import { feeResolver, lineProfitText } from "../frais.ts";
import { fmtFee } from "../format.ts";
import { findCommodity, stationCourante } from "../marche.ts";
import { manifestRemaining, suggestionsFor } from "../manifeste-donnees.ts";
import {
  generationVoyage, jambeChargee, journeyCarriedCommodities, journeyStopSuggestions,
  legEffectiveLines, legFeeCtx, legKey, legSuggestCtx,
} from "../voyage-donnees.ts";
import { carteDeclaration } from "./declaration.tsx";
import { carteEntrepots, carteSoute } from "./soute.tsx";
import { carteVoyage, inviteVoyage, recapVoyage } from "./voyage.tsx";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

/**
 * Rend `children` dans `id`, et pose `hidden` sur le conteneur.
 *
 * `hidden` est un attribut du conteneur, qu'un portail ne gère pas : chaque carte du bandeau
 * décide de son propre effacement, exactement comme les `box.hidden = …` d'`app.js`.
 */
function Carte({ id, montrer, children }: { id: string; montrer: boolean; children?: React.ReactNode }) {
  useLayoutEffect(() => {
    const box = document.getElementById(id);
    if (box) box.hidden = !montrer;
  });
  const cible = document.getElementById(id);
  return cible ? createPortal(montrer ? children : null, cible) : null;
}

// ── La soute ───────────────────────────────────────────────────────────────────────────────────
function Soute() {
  if (!etat.SOUTE.length) return null;
  // Du fret à bord et pas de graphe : la vue par défaut ne lit que routes.json, et sans marché la
  // carte ne sait ni nommer une icône, ni proposer une vente, ni classer « où écouler ». Une soute
  // DÉCLARÉE peut naître sur Trajets et y rester.
  if (!etat.MARKET) withMarket(notifier);
  const ici = stationCourante();
  const f = readFilters();
  const groupes = holdByCommodity(etat.SOUTE);
  return carteSoute({
    groupes,
    ici,
    scu: holdScu(etat.SOUTE),
    libre: f.useCargo && f.cargo > 0 ? freeCargo(etat.SOUTE, f.cargo) : null,
    invest: groupes.reduce((s, g) => s + g.invest, 0),
    venteEnCours: etat.venteEnCours,
    ecoulerOuvert: etat.ecoulerOuvert,
    positionConnue: ici != null,
    marchePret: !!etat.MARKET,
    // Le classement n'est calculé QUE si le panneau est ouvert : `offloadPlan` parcourt tous les
    // terminaux, et cette carte se réévalue à chaque geste de l'application.
    ecoulement: etat.ecoulerOuvert && etat.MARKET && ici != null
      ? offloadPlan(etat.MARKET, etat.SOUTE, ici, f, effVals, feeResolver(f), 5)
      : null,
    pointVente: (nom: string) => (ici != null && etat.MARKET ? sellableAt(etat.MARKET, ici, nom, effVals) : null),
    // Le `kind` n'est pas persisté dans le lot : c'est une propriété de la commodité, pas de la
    // transaction. On le relit au marché quand il est là, et on s'en passe sinon.
    kindDe: (nom: string) => { const c = etat.MARKET && findCommodity(nom); return c ? c.kind : null; },
  });
}

// ── Les entrepôts ──────────────────────────────────────────────────────────────────────────────
function entrepots() {
  const stations = Object.entries(etat.DEPOTS).filter(([, lots]) => Array.isArray(lots) && lots.length);
  if (!stations.length) return null;
  const tous = stations.flatMap(([, lots]) => lots);
  return carteEntrepots({
    stations: stations.map(([label, lots]) => ({
      label, lieu: parseStationLabel(label), scu: holdScu(lots), groupes: holdByCommodity(lots),
    })),
    scuTotal: holdScu(tous),
    invest: holdByCommodity(tous).reduce((s, g) => s + g.invest, 0),
  });
}

// ── Le compagnon de voyage ─────────────────────────────────────────────────────────────────────
// Rend la carte ET son récapitulatif : les totaux du second sont un sous-produit du premier, et les
// recalculer séparément ferait deux passes de manifestes par jambe pour un seul écran.
function compagnon() {
  if (!etat.JOURNEY) return { carte: inviteVoyage(), recap: null };

  // MARKET est nécessaire aux manifestes par jambe. `notifier` et non un rendu ciblé : à son
  // arrivée, c'est l'arbre qui décide quoi refaire.
  if (!etat.MARKET) withMarket(notifier);

  const stations = journeyStations(etat.JOURNEY);
  const n = etat.JOURNEY.legs.length;
  const f = readFilters();
  let totalProfit = 0, totalScu = 0, totalFees = 0;

  const jambes = etat.JOURNEY.legs.map((leg, i) => {
    const lines = etat.MARKET ? legEffectiveLines(leg, i, f) : null;
    const pair = etat.MARKET ? (legFeeCtx(leg, f) || {})?.pair : null;
    const edited = etat.MARKET && !!etat.JOURNEY_EDITS[legKey(leg, i)];
    const expanded = i === etat.journeyExpandedLeg;
    // `nombreTotal` porte le NOMBRE quand `texteTotal` n'en est que le rendu : c'est lui qui décide
    // du signe et de la couleur. Une jambe dont les frais dépassent la marge est une vraie réponse,
    // pas un cas limite — elle s'affichait « +-1 234 », en vert.
    let texteTotal = "—", nombreTotal = 0;
    if (etat.MARKET && lines && lines.length) {
      const t = manifestTotals(lines, pair);
      texteTotal = fmtFee(t.profit, t.fees);
      nombreTotal = t.profit;
      totalProfit += t.profit;
      totalFees += t.fees;
      totalScu += lines.reduce((s, l) => s + l.units, 0);
    } else if (etat.MARKET) texteTotal = "0";
    const sctx = expanded && etat.MARKET && lines ? legSuggestCtx(leg, lines, f) : null;
    return {
      i, from: leg.from, to: leg.to,
      courante: i === etat.JOURNEY!.current,
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

  return {
    carte: carteVoyage({
      stations, courante: etat.JOURNEY.current, nbSauts: n,
      margeCumulee: journeyMargin(etat.JOURNEY),
      marchePret: !!etat.MARKET,
      jambes,
      suggestionsArret: etat.MARKET ? journeyStopSuggestions() : null,
      generation: generationVoyage(),
    }),
    recap: recapVoyage({
      n, totalProfit, totalScu, totalFees,
      systems: new Set(stations.map((s) => s.system)).size,
      materials: etat.MARKET ? journeyCarriedCommodities().size : 0,
      marchePret: !!etat.MARKET,
    }),
  };
}

export function Bandeau() {
  // LA GARDE EST NÉGATIVE, et c'est tout ce qui distingue le bandeau d'une vue d'onglet : il est
  // visible partout SAUF dans le Plan de vol, qui le remplace par un récapitulatif inerte.
  const visible = etat.view !== "plan";

  const { carte, recap } = visible ? compagnon() : { carte: null, recap: null };

  // LA MESURE, en dernier. `useLayoutEffect` tourne après TOUTES les mutations du DOM de la passe
  // et avant la peinture : c'est ce qui remplace les quatre `flushSync` d'`app.js`, et c'est exact
  // par construction au lieu de l'être par discipline.
  useLayoutEffect(() => {
    const row = document.getElementById("shipJourneyRow");
    const jc = document.getElementById("journeyCard");
    const vl = document.getElementById("voyageLeft");
    if (!row || !jc || !vl) return;
    row.classList.remove("stacked"); // on mesure toujours dans la disposition côte-à-côte de base
    if (!visible || jc.hidden) return;
    const h = (el: HTMLElement) => (el && !el.hidden ? el.getBoundingClientRect().height : 0);
    if (h(jc) > h(vl) + 140) row.classList.add("stacked");
  });

  if (!visible) return null;
  return (
    <>
      <Carte id="journeyCard" montrer>{carte}</Carte>
      <Carte id="journeyRecap" montrer={!!recap}>{recap}</Carte>
      <Carte id="holdDeclare" montrer>{carteDeclaration({
        souteVide: !etat.SOUTE.length,
        // « Je suis à » : sans voyage, la position EST le terminal de départ d'« En route » — déjà
        // le repli de `stationCourante()`. On ne crée pas un second store, on rend le premier
        // atteignable d'ici : deux positions divergeraient au premier aller-retour entre les vues.
        avecPosition: !etat.JOURNEY && !!(etat.SOUTE.length || etat.declarationOuverte),
        ouvert: etat.declarationOuverte,
        origine: champ("origin"),
      })}</Carte>
      <Carte id="holdCard" montrer={!!etat.SOUTE.length}><Soute /></Carte>
      <Carte id="depotsCard" montrer={!!Object.values(etat.DEPOTS).some((l) => Array.isArray(l) && l.length)}>
        {entrepots()}
      </Carte>
    </>
  );
}
