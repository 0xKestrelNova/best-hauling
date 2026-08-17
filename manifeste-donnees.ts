// Le CHARGEMENT : ce qu'il reste à remplir, et de quoi (ADR-012).
//
// Ces deux fonctions ont l'air d'appartenir à la vue « En route » — elles y sont nées, et leur
// paramètre retombait sur `currentManifest`, la globale de cette vue. C'est FAUX : le compagnon de
// voyage les appelle quatre fois avec un contexte de JAMBE, fabriqué par `legSuggestCtx`.
//
// Le défaut par défaut cachait cette double appartenance, et il l'aurait fait payer cher : descendre
// ces fonctions dans le composant d'« En route » aurait cassé le compagnon, et le symptôme serait
// arrivé tard — les suggestions ne sont calculées que pour la jambe DÉPLIÉE, donc un test qui ne
// déplie pas ne verrait rien.
//
// Le contexte devient donc un paramètre REQUIS. Ce n'est pas une précaution de style : c'est ce qui
// rend ces deux fonctions testables unitairement, ce qu'une retombée sur une globale de module
// interdisait.

import { manifestTotals, suggestionsFrom } from "./logic.ts";

import { etat } from "./etat.ts";
import { effVals } from "./corrections.ts";

/**
 * Ce qu'il reste à charger dans un contexte donné — celui d'« En route » comme celui d'une jambe.
 *
 * `budgetLeft` vaut `Infinity` quand l'interrupteur de budget est éteint, et non zéro : une
 * contrainte désactivée ne borne rien.
 */
export function manifestRemaining(m: ContexteManifeste) {
  const { scu, invest } = manifestTotals(m.lines);
  const budgetLeft = m.f.useBudget && m.f.budget > 0 ? m.f.budget - invest : Infinity;
  return { scu, invest, cargoLeft: m.cargo - scu, budgetLeft };
}

/** Ce qu'on pourrait ajouter pour combler la place libre, dans ce contexte-là. */
export const suggestionsFor = (m: ContexteManifeste) => suggestionsFrom(etat.MARKET, m, effVals);

// ── LE CHARGEMENT COURANT, DÉRIVÉ ET NON MIS EN CACHE ─────────────────────────────────────────
// `currentManifest` était une globale d'`app.js` : écrite en tête du rendu de la carte, relue au
// clic par les six gestes de composition. Le motif que la migration élimine partout — et ici il
// coûtait plus cher qu'ailleurs, parce qu'un geste fait avant le premier rendu de la carte lisait
// `null` sans rien dire.
//
// Elle devient une DÉRIVATION, sur le patron d'`indexOrigine` (marche.ts) : « une valeur dérivée
// qu'il faut penser à recalculer est une valeur qui sera un jour lue périmée ». Le coût est un
// `bestManifest` par geste — le même que celui du rendu que le geste déclenche de toute façon.

import { bestManifest, hydrateManifestLine, stationLabel } from "./logic.ts";
import type { ContexteManifeste, Filtres, FiltresVolume, LigneManifeste, PaireFrais, Terminal } from "./types.ts";
import { freeCargo, holdScu } from "./logic.ts";
import { feeCtx, feeResolver } from "./frais.ts";
import { findCommodity, indexArriveeForcee, indexOrigine, stationMap } from "./marche.ts";
import { compositionValide } from "./manifeste-etat.ts";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

/** Les lignes d'une composition, RELUES au marché courant : un prix corrigé s'affiche, les SCU non. */
const lignesComposees = (lignes: { name: string; units: number }[], fromIdx: number, toIdx: number) =>
  lignes.map((e) => hydrateManifestLine(etat.MARKET!, fromIdx, toIdx, findCommodity(e.name), e.units, effVals));

/**
 * Le chargement affiché par la carte d'« En route » — ou une RAISON de ne rien afficher.
 *
 * Rend `{ etat: "sans-depart" | "soute-inactive" | "soute-pleine" | "aucun" }` quand il n'y a rien
 * à charger, et `{ etat: "ok", m }` sinon. Les quatre cas étaient quatre retours anticipés de
 * `renderManifest` : les nommer, c'est ce qui permet à la vue de choisir son message sans
 * reproduire la décision.
 */
/**
 * Le chargement ENRICHI que la carte consomme : ce que `bestManifest` rend, plus les trois choses
 * qu' y accrochait à la main — le départ, les filtres retenus, ce qui est déjà à bord, et
 * le contexte de frais. Les nommer, c'est ce qui a permis à `tsc` de voir la carte pour la
 * première fois : elles étaient posées sur un objet non typé.
 */
export type ChargementCourant = {
  lines: LigneManifeste[]; cargo: number; aBord: number; cross: boolean;
  origin: Terminal; originIdx: number; dest: Terminal; destIdx: number;
  fee: PaireFrais | null; feeInfo: ReturnType<typeof feeCtx>;
  profit: number; f: Filtres & FiltresVolume;
};

export function manifesteCourant(f: Filtres & FiltresVolume) {
  const origin = indexOrigine();
  if (origin == null || !etat.MARKET) return { etat: "sans-depart" as const };
  if (!f.useCargo || !(f.cargo > 0)) return { etat: "soute-inactive" as const };

  // La soute n'est pas vide : on ne peut charger QUE la place qui reste. C'est la question de
  // l'ADR-002 — « j'ai 30 SCU de libre, qu'est-ce que j'y mets maintenant ? ». Les autres vues
  // gardent la soute nominale : elles répondent à « quelle est la meilleure route ».
  const aBord = holdScu(etat.SOUTE);
  const libre = freeCargo(etat.SOUTE, f.cargo);
  if (aBord > 0 && libre <= 0) return { etat: "soute-pleine" as const, aBord };

  const fLibre = aBord > 0 ? { ...f, cargo: libre } : f;
  const destSystem = champ("destSystem");
  const destTerminal = indexArriveeForcee();
  const ot = etat.MARKET.terminals[origin];
  const dt = destTerminal == null ? null : etat.MARKET.terminals[destTerminal];

  // Une composition en cours IMPOSE sa destination : laisser la carte se re-router toute seule sous
  // une correction de prix ferait disparaître de l'écran le chargement qu'on est en train de
  // composer — le symptôme même qu'on corrige.
  const compo = compositionValide(
    { name: ot.name, system: ot.system },
    dt && { name: dt.name, system: dt.system },
    destSystem,
    (nom, systeme) => stationMap.get(stationLabel(nom, systeme)),
    findCommodity,
  );
  const cible = compo ? compo.destIdx : destTerminal;
  const man = bestManifest(etat.MARKET, origin, destSystem, fLibre, effVals, cible, feeResolver(f))
    || (compo ? manifesteSansOptimal(origin, cible!, fLibre) : null);
  if (!man) return { etat: "aucun" as const, aBord, libre };

  // Les lignes EFFECTIVES : celles de l'utilisateur, moins ce qu'UEX ne publie plus.
  const carte = man as unknown as ChargementCourant;
  if (compo) carte.lines = lignesComposees(compo.lignes, origin, cible!);
  carte.originIdx = origin;
  carte.f = fLibre;
  carte.aBord = aBord; // pour que la carte dise pourquoi elle ne remplit que ça
  // `man.fee` vient de `bestManifest` : on ne le reconstruit pas, donc on ne risque pas de le
  // reconstruire AUTREMENT que ce qui a servi à choisir la destination.
  carte.feeInfo = feeCtx(f, carte.origin.name, carte.dest.name, carte.origin, carte.dest);
  return { etat: "ok" as const, m: carte, aBord, libre };
}

/**
 * Une carte VIDE sur une route imposée par la composition.
 *
 * Existe pour le cas où `bestManifest` ne trouve rien mais qu'une composition manuelle désigne
 * quand même cette arrivée : sans elle, la carte que l'utilisateur vient de composer disparaîtrait.
 */
function manifesteSansOptimal(originIdx: number, destIdx: number, f: Filtres & FiltresVolume) {
  const ot = etat.MARKET!.terminals[originIdx], dt = etat.MARKET!.terminals[destIdx];
  const point = feeResolver(f);
  return {
    origin: ot, originIdx, dest: dt, destIdx, cross: ot.system !== dt.system,
    lines: [] as ReturnType<typeof lignesComposees>, profit: 0, cargo: f.cargo,
    fee: point ? { buy: point(ot), sell: point(dt) } : null,
  } as ReturnType<typeof bestManifest>;
}
