// LES GESTES DE LA VUE CORRECTIONS (ADR-012 §2).
//
// UNE délégation sur `#corrections`, qui est le PARENT des trois conteneurs de portail de la vue
// (`#correctionsBand`, `#correctionsStation`, `#correctionsFees`). React rend DEDANS sans posséder
// le nœud : l'écouteur posé ici une fois traverse tous les rendus à venir. Le convertir en `onClick`
// sur les boutons ne gagnerait rien et doublerait `pinLegsForVolume`, qui n'est pas idempotent.
//
// ── L'ORDRE DES BRANCHES EST UN CONTRAT, ET AUCUN TEST NE LE TESTE ────────────────────────────
// Les tests exercent chaque bouton isolément ; c'est l'enchaînement qui porte les deux règles :
//   1. `.al-del` en PREMIER. Le ✕ d'un relevé d'autoload porte AUSSI `.corr-del` (c'est le même
//      bouton à l'écran) et tomberait sinon dans une branche qui écrit dans `OVERRIDES` ;
//   2. `#exportCorrections` AVANT `#resetAll` — rien ne s'efface sans qu'on ait pu l'emporter.
//
// La branche `.corr-del` générique a disparu : elle était MORTE. Les deux seuls producteurs de
// cette classe (`vues/frais-station.tsx`) posent aussi `.al-del`, interceptée plus haut avec un
// `return`. Elle datait de la liste plate, remplacée par la bande de vignettes ; la garder « par
// prudence » rouvrirait un chemin d'écriture qui n'existe plus.
import { stationLabel } from "./logic.ts";
import { debounce, rafraichir } from "./rendu.ts";
import { effacerStation, effacerToutesLesCorrections, revenirAUEX } from "./corrections-actions.ts";
import { enregistrerReleve, oublierReleve, oublierTousLesReleves } from "./frais-actions.ts";
import { copierCorrections } from "./presse-papiers.ts";
import { termByName } from "./marche.ts";
import { saveState } from "./persistance.ts";
import { memoriserStation, stationChangee } from "./selecteur.ts";

import type { ChampCorrection, CoteMarche, Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. `e.target` est un `EventTarget` : il n'a ni `closest`, ni
// `classList`, ni `id`. Le cast est posé UNE fois par module, comme `$` — pas dans un module
// partagé : c'est une expression d'une ligne, et six modules couplés à un alias ne valent pas
// l'économie (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;
/** La même, quand le code a déjà établi que la cible est un champ (garde par `id` ou par classe). */
const champ = (e: Event) => e.target as HTMLInputElement;


// `$` est typé `HTMLInputElement` et non `HTMLElement`, parce que dans CE module il ne sert
// qu'à des contrôles de formulaire — dont on lit ou écrit la `value`. C'est le même choix
// que `filtres.ts` et `persistance.ts` : l'alias dit ce que le module en fait.
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Branche le champ de station et la délégation de la vue. Appelé une fois, à l'amorçage. */
export function brancherGestesCorrections() {
  // Le champ de recherche ne re-rend QUE si la station résolue a CHANGÉ. Le sélecteur, lui, rend
  // immédiatement au choix : sans ce garde, le rendu différé du debounce arrivait ~300 ms après et
  // refaisait le même écran pour rien — en détachant au passage l'éditeur d'un chiffre ouvert entre
  // les deux. Même famille que #24 : tout re-rendu gratuit de cette vue efface une saisie en cours.
  //
  // Il est branché ICI et non dans `selecteur.js` : celui-ci ne monte qu'à l'arrivée du marché,
  // alors que ce garde doit exister dès l'amorçage.
  $("station").addEventListener("input", debounce(() => { if (stationChangee()) rafraichir(); }));

  $("corrections").addEventListener("click", (e) => {
    const relDel = cible(e).closest(".al-del"); // EN PREMIER : voir l'en-tête
    if (relDel) { oublierReleve(relDel.dataset.key); return; }

    // Vignette de la bande : recharge sa station. Écrit le LIBELLÉ CANONIQUE, comme le sélecteur —
    // la résolution est exacte, et c'est ce libellé-là que le permalien transporte.
    const tuile = cible(e).closest(".stn-tile") as HTMLButtonElement | null;
    if (tuile && !tuile.disabled) {
      const t = termByName.get(tuile.dataset.terminal);
      if (t) { $("station").value = stationLabel(t.name, t.system); memoriserStation(); rafraichir(); saveState(); }
      return;
    }

    const undo = cible(e).closest(".scomm-undo");
    if (undo) {
      // Les quatre `data-*` sont posés ENSEMBLE par `vues/corrections.tsx` : ils existent ou la
      // branche n'est pas atteinte. Le cast dit ce contrat, il ne le contourne pas.
      const { c, t: terminal, s: cote, f: champ } = undo.dataset as
        { c: string; t: string; s: CoteMarche; f: ChampCorrection };
      revenirAUEX(c, terminal, cote, champ);
      return;
    }

    if (cible(e).closest("#stnClear")) { effacerStation(); return; }
    if (cible(e).closest("#alSave")) { enregistrerReleve(); return; }
    if (cible(e).closest("#resetAllK")) { oublierTousLesReleves(); return; }
    if (cible(e).closest("#exportCorrections")) { copierCorrections(); return; } // AVANT #resetAll
    if (cible(e).closest("#resetAll")) effacerToutesLesCorrections();
  });

  // Validation du relevé d'autoload à la touche Entrée. Testé par `champ(e).id` et non par
  // `closest()` : les deux `<input>` sont rendus NON CONTRÔLÉS (`defaultValue`) par
  // `vues/frais-station.tsx`, dont la `key` porte le relevé lui-même. Les passer à `value=` les
  // gèlerait — c'est écrit en toutes lettres dans l'en-tête de ce composant.
  $("corrections").addEventListener("keydown", (e) => {
    if ((champ(e).id === "alAmount" || champ(e).id === "alScu") && e.key === "Enter") {
      e.preventDefault();
      enregistrerReleve();
    }
  });
}
