// La VUE Corrections : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// `corrections.tsx` garde la PRÉSENTATION — le bandeau de station, les tuiles, la bande des
// stations corrigées. Ce fichier-ci porte la DÉCISION : marché absent, station résolue ou non,
// quelles cotes, combien de corrections.
//
// ── L'ORDRE EST UN CONTRAT, ET IL DESCEND D'UN CRAN ───────────────────────────────────────────
// La bande des stations s'affiche AU-DESSUS du panneau (index.html), mais elle est calculée APRÈS
// lui. Ce n'est pas une coquetterie : `tuilesStation` appelle `effVals`, qui PURGE les corrections
// périmées et persiste (corrections.ts). Compter d'abord annoncerait sur la vignette une correction
// que le rendu suivant vient d'effacer.
//
// `renderCorrections` le documentait déjà entre ses deux `peindre()`. Ici le contrat va plus loin :
// à l'intérieur du panneau, `nbCorrections` doit lui aussi être compté APRÈS `tuilesStation`. Écrit
// en littéral d'objet, l'ordre des propriétés le donnait — mais par accident. On l'écrit donc en
// `const` successives, dans un SEUL composant : l'ordre d'évaluation redevient l'ordre des
// instructions, et non l'ordre des frères JSX (ADR-012 §3 et §4).
//
// ── LA DÉLÉGATION NE DÉMÉNAGE PAS ─────────────────────────────────────────────────────────────
// `#corrections` (index.html) est le PARENT des deux conteneurs de portail, donc hors de tout arbre
// React : les événements natifs y remontent à travers le portail. C'est le précédent
// `#planHead`/`#planCopy` (#145). Aucun `onClick` React n'est donc posé sur `.stn-tile`,
// `.scomm-undo`, `#stnClear`, `#exportCorrections` ni `#resetAll` — le doublement serait invisible
// (ces gestes sont idempotents à l'échelle d'un clic) SAUF pour `pinLegsForVolume`, dont un second
// passage APRÈS l'écriture figerait les jambes sur des SCU déjà recalculés.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { groupOverridesByTerminal } from "../logic.ts";
import type { CoteCommodite, GroupeCorrections, TuileCommodite } from "./corrections.tsx";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals } from "../corrections.ts";
import { corriger, notifySuperseded } from "../corrections-actions.ts";
import { withMarket } from "../donnees.ts";
import { indexStationExacte, termByName } from "../marche.ts";
import { VueBandeCorrections, VueStation, inviteStation } from "./corrections.tsx";

/**
 * Les tuiles d'une station : une par commodité qu'on peut y acheter ou y vendre, filtrées par la
 * recherche.
 *
 * APPELLE `effVals`, dont la purge d'une correction périmée est un EFFET DE BORD assumé — c'est
 * pour lui que l'ordre d'évaluation de cette vue est un contrat.
 */
function tuilesStation(S: number, q: string): TuileCommodite[] {
  const marche = etat.MARKET!;
  const t = marche.terminals[S];
  const tuiles: TuileCommodite[] = [];
  marche.commodities.forEach((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return;
    const b = c.buys.find((x) => x[0] === S);
    const s = c.sells.find((x) => x[0] === S);
    if (!b && !s) return;
    const cote = (p: number[], side: "buy" | "sell", libelle: string, unite: string): CoteCommodite => {
      const e = effVals(c.name, t.name, side, p[1], p[2], p[3]);
      return {
        cote: side, libelle, unite,
        prix: e.price, volume: e.vol,
        prixCorrige: e.oprice, volumeCorrige: e.ovol,
        prixBrut: p[1], volumeBrut: p[2],
        releve: p[3],
      };
    };
    const cotes: CoteCommodite[] = [];
    if (b) cotes.push(cote(b, "buy", "achat", "stock"));
    if (s) cotes.push(cote(s, "sell", "vente", "dem."));
    // Une seule ligne par côté RÉEL. La classe de la tuile porte le côté : c'est elle qui donne au
    // liseré et à l'étiquette leur couleur, nécessaire depuis que l'en-tête de section sort de
    // l'écran au défilement.
    tuiles.push({ nom: c.name, kind: c.kind, illegal: c.illegal, achat: !!b, cotes });
  });
  return tuiles;
}

/** Les stations corrigées, la station affichée épinglée en tête. */
function groupesCorrections(S: number | null): GroupeCorrections[] {
  const actif = S != null ? etat.MARKET!.terminals[S].name : null;
  return groupOverridesByTerminal(etat.OVERRIDES, actif).map((g) => ({
    terminal: g.terminal,
    corrections: g.corrections,
    actif: g.actif,
    // `null` quand le terminal a disparu de market.json : la vignette s'affiche quand même, sinon
    // la correction deviendrait invisible ET ineffaçable.
    info: termByName.get(g.terminal) || null,
  }));
}

/** Rend `children` dans le conteneur `id`. La garde de vue est faite une fois, au-dessus. */
function Portail({ id, children }: { id: string; children: React.ReactNode }) {
  const cible = document.getElementById(id);
  return cible ? createPortal(children, cible) : null;
}

export function VueCorrections() {
  // Un effet, donc avant tout retour anticipé : il affiche un toast et réécrit le compteur du rail.
  useEffect(notifySuperseded);

  if (etat.view !== "corrections") return null;

  if (!etat.MARKET) {
    withMarket(notifier);
    return null;
  }

  // UNE dérivation, en tête : la station ne peut pas changer entre deux lectures de la même passe.
  const S = indexStationExacte();
  // `readFilters().q` et non une lecture brute du champ : c'est exactement la même expression, et
  // une seule source vaut mieux que deux qui doivent rester d'accord.
  const q = readFilters().q;

  // L'ORDRE : les tuiles PURGENT, on compte ensuite, et la bande se calcule en dernier.
  const t = S != null ? etat.MARKET.terminals[S] : null;
  const tuiles = S != null ? tuilesStation(S, q) : [];
  const nbCorrections = t
    ? Object.keys(etat.OVERRIDES).filter((k) => k.split("|")[1] === t.name).length
    : 0;
  const groupes = groupesCorrections(S);

  return (
    <>
      <Portail id="correctionsStation">
        {!t ? inviteStation() : (
          <VueStation
            terminal={t}
            tuiles={tuiles}
            filtre={!!q}
            nbCorrections={nbCorrections}
            // Cette vue ferme sur SA station : cinq arguments, pas six. L'enveloppe remet le
            // terminal à sa place — passer `corriger` nu décalerait tout, en silence.
            corriger={(commodite, cote, champ, valeur, releve) =>
              corriger(commodite, t.name, cote, champ, valeur, releve)}
          />
        )}
      </Portail>
      <Portail id="correctionsIndex"><VueBandeCorrections groupes={groupes} /></Portail>
    </>
  );
}
