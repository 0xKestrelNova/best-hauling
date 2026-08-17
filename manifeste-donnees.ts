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
import type { ContexteManifeste } from "./types.ts";
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
