// La VUE Chaîne : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// `chaine.tsx` garde la PRÉSENTATION — la chaîne, ses sauts, leurs manifestes. Ce fichier-ci porte
// la DÉCISION : marché absent, départ non choisi, soute désactivée, aucune chaîne rentable, ou le
// calcul.
//
// ── LA GLOBALE `shownChain` DISPARAÎT ─────────────────────────────────────────────────────────
// Le ▶ « Ajouter au voyage » était pris par une délégation posée sur `document`, qui relisait
// `shownChain` — une globale écrite au RENDU et lue au CLIC. C'est le motif que la migration
// élimine partout ailleurs (les ▶ des trajets et des boucles l'ont perdu en #129), et il survivait
// ici faute d'un composant à qui confier le rappel.
//
// Le bouton étant rendu par React, il porte désormais son `onClick`. La branche de délégation part
// AU MÊME COMMIT : la laisser doublerait l'ajout, et deux `pickJourney` de suite posent deux fois
// les mêmes jambes — visible, mais seulement après coup, dans le parcours.
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import { bestChain, buildChainAdjacency, legsFromChain } from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { notifySuperseded } from "../corrections-actions.ts";
import { withMarket } from "../donnees.ts";
import { feeCargoText, feeCell, feeCtx, feeResolver, lineProfitText } from "../frais.ts";
import { indexDepartChaine } from "../marche.ts";
import { pickJourney } from "../voyage-actions.ts";
import { VueChaine, indiceAucune, indiceDepart, indiceSoute } from "./chaine.tsx";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

export function VueChaineArbitrage() {
  // Un effet, donc avant tout retour anticipé. Il tournait ici à CHAQUE branche de `renderChain`,
  // y compris les trois messages d'attente : `effVals` a pu purger pendant `buildChainAdjacency`.
  useLayoutEffect(notifySuperseded);

  if (etat.view !== "chain") return null;

  const cible = document.getElementById("chainOut");
  if (!cible) return null;
  const dans = (noeud: React.ReactNode) => createPortal(noeud, cible);

  if (!etat.MARKET) {
    withMarket(notifier);
    return null;
  }

  const depart = indexDepartChaine();
  if (depart == null) return dans(indiceDepart());

  const f = readFilters();
  if (!f.useCargo || !(f.cargo > 0)) return dans(indiceSoute());

  const hops = Number(champ("hops")) || 3;
  // Les frais sont estampillés sur chaque saut par `buildChainAdjacency` — seul endroit de la
  // chaîne où les deux terminaux d'un saut coexistent — puis consommés par `bestChain`, dont
  // l'élagage et la sélection portent alors sur le profit NET.
  const chaine = bestChain(
    buildChainAdjacency(etat.MARKET, f, effVals, feeResolver(f)),
    depart, hops, { cargo: f.cargo },
  );
  if (!chaine || !chaine.legs.length) return dans(indiceAucune());

  return dans(
    <VueChaine
      chaine={chaine}
      cargo={f.cargo}
      terminal={(idx) => etat.MARKET!.terminals[idx]}
      celluleFrais={(lignes, fee, a, b, scu, fees) =>
        feeCell(feeCtx(f, a.name, b.name, a, b), fees, () => feeCargoText(lignes, a.maxBox), scu > 0)}
      texteProfitLigne={lineProfitText}
      // La chaîne est passée au rappel, jamais relue d'une globale : c'est CETTE chaîne-là qu'on
      // ajoute, celle qui était à l'écran au moment du clic.
      choisirChaine={(c) => pickJourney(legsFromChain(c, etat.MARKET!.terminals))}
    />,
  );
}
