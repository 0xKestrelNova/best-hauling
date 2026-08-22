// Les props des tables à lignes simples (ADR-012).
//
// DEUX tables partagent exactement le même rendu de ligne : `#rows` (vue Trajets) et
// `#enrouteRows` (vue « En route »). Elles ne partagent PAS leur cycle de vie — la première vit
// dans l'arbre, la seconde encore dans `app.js` — mais chacune construit les mêmes rappels, à
// partir des mêmes modules.
//
// D'où ce fichier : un seul endroit qui les fabrique, importé des deux côtés. C'est ce qui évite la
// duplication que la migration vue-par-vue produit sinon mécaniquement — et une duplication de
// rappels ne fait rougir aucun test, elle se contente de diverger.
//
// ── LE PIÈGE QUE `choisirTrajet` A DÉJÀ PAYÉ ──────────────────────────────────────────────────
// Le ▶ est ÉTALÉ avec le reste, donc il sert les DEUX tables d'un coup. Le poser au seul site
// d'appel de `#rows` ferait taire celui d'« En route » — la sur-suppression de #116 en négatif.
// C'est désormais gardé par `e2e/choix-trajet.pw.mjs`.
import { legFromRoute, pairAge } from "../logic.ts";
import type { LigneTrajet } from "./trajets.tsx";
import { corriger } from "../corrections-actions.ts";
import { scuBoxesLabel } from "../format.ts";
import { feeCell, feeLoadText } from "../frais.ts";
import { termByName } from "../marche.ts";
import { pickJourney } from "../voyage-actions.ts";
import { BUY_STATUS, SELL_STATUS } from "./communs.tsx";

/** Ce que les DEUX modes de la vue Trajets partagent — lignes simples ET chargements combinés. */
export function propsTrajetsCommunes() {
  return {
    avecTexteFrais: (base: string, cell: { text: string }) => (cell.text ? `${base} · ${cell.text}` : base),
    legendeAchat: BUY_STATUS,
    legendeVente: SELL_STATUS,
    // Le contrat de cette vue est celui du module : six arguments, dans le même ordre. On le passe
    // donc NU — c'est l'un des deux seuls sites, avec le manifeste, à pouvoir le faire.
    corriger,
  };
}

/** Ce qui se calcule LIGNE PAR LIGNE, et vaut pour les deux tables à lignes simples. */
export function propsLignesSimples() {
  const plafond = (r: LigneTrajet) => termByName.get(r.buy.terminal)?.maxBox;
  return {
    celluleFrais: (r: LigneTrajet) =>
      feeCell(r.feeInfo, r.fees, () => feeLoadText(r.units, plafond(r)), r.units > 0),
    suspect: (r: LigneTrajet) => {
      const d = pairAge(r.buy.updated, r.sell.updated);
      if (d != null && d > 10) return "relevé de plus de 10 jours";
      if (r.refSell > 0 && r.refBuy > 0 && (r.sell.price > r.refSell * 1.5 || r.buy.price < r.refBuy * 0.67))
        return "prix très éloigné de la moyenne UEX";
      return null;
    },
    // Le plafond de caisse vient du MARCHÉ, pas du contexte de frais : c'est une propriété physique
    // de la station. Le prendre dans `feeInfo` le faisait disparaître dès l'interrupteur relâché, et
    // la ligne annonçait « 3×32 » à côté d'un manifeste qui affichait « 6×16 » pour la même cargaison.
    libelleCaisses: (r: LigneTrajet) => (r.units ? scuBoxesLabel(r.units, plafond(r)) : null),
    choisirTrajet: (r: LigneTrajet) => pickJourney([legFromRoute(r)]),
  };
}
