// La VUE Plan de vol : la conclusion (ADR-004, ADR-011 étape 3).
//
// « On y arrive une fois tout paramétré, pour REGARDER le résultat » : rien n'y est actionnable,
// pas un bouton de vente, pas un ✕, pas un champ. C'est ce qui en fait la deuxième vue à emménager
// dans l'arbre après la Tournée — elle n'a aucune action à recâbler.
//
// Elle ne reçoit AUCUNE prop : elle lit l'état, les filtres, les manifestes de jambe et le marché.
// `plan.tsx` garde la présentation ; ce fichier porte le calcul et la décision.
import { freeCargo, holdByCommodity, holdScu, journeyStations, manifestTotals } from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { fmt, fmtFee } from "../format.ts";
import { globalK } from "../frais.ts";
import { findCommodity } from "../marche.ts";
import { withMarket } from "../donnees.ts";
import { jambeChargee, legEffectiveLines, legFeeCtx } from "../voyage-donnees.ts";
import { corpsPlan, enTetePlan } from "./plan.tsx";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

export function planHypotheses(f: ReturnType<typeof readFilters>): string[] {
  return [
    champ("ship") || "aucun vaisseau",
    f.useCargo && f.cargo > 0 ? `soute ${fmt(f.cargo)} SCU` : "soute non limitée",
    f.useBudget && f.budget > 0 ? `budget ${fmt(f.budget)} aUEC` : "budget non limité",
    f.autoload ? `profits nets (k = ${String(globalK()).replace(".", ",")})` : "profits bruts",
  ];
}

// Tout ce que la vue montre, calculé UNE fois : le rendu et la copie lisent la même chose, sinon
// le texte collé dans un salon dériverait de l'écran qui l'a produit.
// Aucun calcul neuf (ADR-004 : « C'est un déménagement d'interface, les chiffres ne changent pas ») :
// les manifestes par jambe passent par legEffectiveLines, exactement comme le compagnon de voyage.
export function planData() {
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

/** L'EN-TÊTE : les quatre hypothèses, reprises en texte et en lecture seule. */
export function EnTetePlan() {
  return enTetePlan(planHypotheses(readFilters()));
}

/** LE CORPS : le parcours, la soute, les jambes, ce qu'il reste à faire. */
export function CorpsPlan() {
  // Les manifestes par jambe vivent dans le graphe d'échange, que la vue par défaut ne charge pas.
  // `notifier` et non un rendu ciblé : à l'arrivée, c'est tout l'arbre qui décide quoi réafficher.
  if (etat.JOURNEY && !etat.MARKET) withMarket(notifier);
  const d = planData();
  return corpsPlan({
    hypotheses: planHypotheses(d.f),
    stations: d.stations,
    courante: etat.JOURNEY ? etat.JOURNEY.current : -1,
    jambes: d.jambes,
    groupes: d.groupes,
    scu: d.scu, libre: d.libre, invest: d.invest,
    totalScu: d.totalScu, totalProfit: d.totalProfit, totalFees: d.totalFees,
    reste: d.reste, nbSauts: etat.JOURNEY ? etat.JOURNEY.legs.length : 0,
    // La base des barres de soute : la CAPACITÉ quand elle est connue, le chargement sinon. Une
    // barre sans dénominateur ne voudrait rien dire.
    base: d.f.useCargo && d.f.cargo > 0 ? d.f.cargo : d.scu,
    marchePret: !!etat.MARKET,
    kindDe: (nom: string) => { const c = findCommodity(nom); return c ? c.kind : null; },
    fmtProfit: fmtFee,
  });
}
