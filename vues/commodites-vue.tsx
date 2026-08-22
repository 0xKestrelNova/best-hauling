// La VUE Commodités : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// `commodites.tsx` garde la PRÉSENTATION — la tuile, le détail, les deux textes d'aide. Ce
// fichier-ci porte la DÉCISION : marché absent, quelles lignes, dans quel ordre, laquelle est
// choisie, et de quelle couleur.
//
// ── UN SEUL COMPOSANT POUR TROIS CONTENEURS ───────────────────────────────────────────────────
// La vue occupe trois nœuds séparés d'`index.html` : la grille, le détail, l'aide. Le patron de
// l'ADR-011 dirait « un composant sans prop par conteneur ». C'est FAUX ici, et l'ADR-012 §3 le
// tranche : la grille et le détail consomment le MÊME `commoditySummaries` — un parcours de tout le
// marché. Deux composants sans prop le referaient chacun de leur côté, deux fois par `notifier()`,
// soit exactement le gaspillage que la PR #146 vient de payer pour supprimer. Pire, chacun
// re-dériverait la sélection, et deux dérivations qui divergent donnent une tuile `.selected` qui
// ne correspond pas au détail affiché — ce qu'aucun test ne compare.
//
// Donc : la garde de vue en tête, le calcul UNE fois, puis trois portails.
//
// ── LES CINQ CACHES DE RENDU SONT DEVENUS DES LOCALES ─────────────────────────────────────────
// `shownCommodities`, `commTiers`, `commDupCodes`, `commMaxMargin` et `commCarried` étaient cinq
// globales d'`app.js`, écrites par `renderCommodities` et lues par les trois peintres. Un composant
// qui calcule et rend dans la même passe n'en a pas besoin. Elles n'avaient aucun lecteur ailleurs.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { effVals, isOv } from "../corrections.ts";
import { corriger, notifySuperseded } from "../corrections-actions.ts";
import { withMarket } from "../donnees.ts";
import { saveState } from "../persistance.ts";
import { journeyCarriedCommodities } from "../voyage-donnees.ts";
import {
  ambiguousCodes, bySort, commodityPoints, commoditySummaries, compactValue, palierMarge, valueTiers,
} from "../logic.ts";
import type { ResumeCommodite } from "../types.ts";
import { BUY_STATUS, SELL_STATUS } from "./communs.tsx";
import { VueGrilleCommodites, VueDetailCommodite, aideBoard, inviteDetail } from "./commodites.tsx";

// ── Le tri du board ────────────────────────────────────────────────────────────────────────────
// Trois modes, et RIEN d'autre. Le quatrième — `custom`, un tri par colonne — était mort : il ne
// pouvait être atteint que par un clic sur un `th[data-sort]`, or `setupSort` ne branche que ceux
// de `#routes` et `#loops`, et le `<thead>` du détail n'en porte aucun. Il partait avec deux champs
// d'état (`commSortKey`, `commSortDir`) qui n'étaient même pas dans le permalien.
//
// Elle rend TOUJOURS le tableau, y compris si `etat.commMode` sortait des trois valeurs : c'est une
// `string` libre dans `etat.ts`, et une branche par défaut vaut mieux qu'un `undefined` possible.
function trierCommodites(rows: ResumeCommodite[]): ResumeCommodite[] {
  // La « valeur » d'une tuile dépend du board : marge en Marché, prix de revente en Butin.
  const vk = etat.commBoard === "loot" ? "bestSell" : "margin";
  if (etat.commMode === "code") return rows.sort(bySort("code", 1));           // code A→Z
  if (etat.commMode === "kind")                                               // catégorie puis valeur
    return rows.sort((a, b) => (a.kind || "").localeCompare(b.kind || "", "fr") || ((b[vk] ?? -Infinity) - (a[vk] ?? -Infinity)));
  return rows.sort(bySort(vk, -1));                                           // plus lucratif d'abord
}

/**
 * Reflète le board et le tri courants dans les contrôles d'`index.html`.
 *
 * Ces trois nœuds restent VANILLA, et ce n'est pas une dette : `#commSortModes` et
 * `#commBoardModes` portent des écouteurs posés sur les `<div>` eux-mêmes, avec des boutons
 * statiques. Un portail sur ces nœuds AJOUTERAIT ses enfants — `createPortal` n'efface pas,
 * contrairement à `createRoot` — et un portail sur leur parent tuerait les deux écouteurs sans la
 * moindre erreur. Voir ADR-012 §2.
 *
 * Trois mutations, pas deux : la classe `active` de `#commSortModes` vivait dans
 * `renderCommodities` et non dans `syncCommBoardUI`. C'est celle qu'on rate en ne reprenant que la
 * seconde, et le bouton « Marge » resterait allumé après un clic sur « Catégorie ».
 */
export function refletBoardCommodites(): void {
  const butin = etat.commBoard === "loot";
  document.querySelectorAll<HTMLButtonElement>("#commBoardModes button")
    .forEach((b) => b.classList.toggle("active", b.dataset.board === etat.commBoard));
  document.querySelectorAll<HTMLButtonElement>("#commSortModes button")
    .forEach((b) => b.classList.toggle("active", b.dataset.sort === etat.commMode));
  // « Marge » n'a aucun sens quand l'acquisition est gratuite : le premier bouton devient
  // « Revente ». C'est le libellé, pas le mode — `data-sort` reste `margin`.
  const premier = document.querySelector('#commSortModes button[data-sort="margin"]');
  if (premier) premier.textContent = butin ? "Revente" : "Marge";
}

/** Change le mode de tri du board. Appelée par l'écouteur d'`app.js` sur `#commSortModes`. */
export function setCommSort(key: string): void {
  if (key !== "margin" && key !== "code" && key !== "kind") return;
  etat.commMode = key;
  refletBoardCommodites();
  saveState();
  notifier();
}

/** Bascule Marché ↔ Butin. Le board change la STRUCTURE, pas seulement des valeurs. */
export function setCommBoard(board: string): void {
  if (board !== "market" && board !== "loot") return;
  if (board === etat.commBoard) return;
  etat.commBoard = board;
  refletBoardCommodites();
  saveState();
  notifier();
}

/**
 * Rend `children` dans le conteneur `id`. Pas de garde `si` ici : elle est faite UNE FOIS en tête
 * de `VueCommodites`, au-dessus du calcul — la répéter sur chaque portail laisserait le calcul
 * s'exécuter pour rien.
 */
function Portail({ id, children }: { id: string; children: React.ReactNode }) {
  const cible = document.getElementById(id);
  return cible ? createPortal(children, cible) : null;
}

export function VueCommodites() {
  // Le relevé des corrections périmées, en tout premier : c'est un effet, il ne peut pas vivre
  // dans le corps du rendu (il affiche un toast et réécrit le compteur du rail), et un hook ne
  // peut pas être posé après un retour anticipé.
  useEffect(notifySuperseded);

  if (etat.view !== "commodities") return null;

  if (!etat.MARKET) {
    // `notifier` et non un rendu ciblé : à l'arrivée du marché c'est TOUT l'arbre qui se réévalue,
    // et chaque vue décide alors elle-même quoi afficher — y compris si l'utilisateur a changé de
    // vue entre-temps.
    withMarket(notifier);
    return null;
  }

  const f = { ...readFilters(), board: etat.commBoard };
  const q = f.q;
  const butin = etat.commBoard === "loot";

  // `effVals` : marge, couleur de tuile et rang suivent les corrections locales. Sans lui, la tuile
  // continuait d'afficher la marge d'UEX après qu'on ait corrigé le prix dans un tableau.
  const all = commoditySummaries(etat.MARKET, f, effVals); // légales + avant-postes + board s'appliquent ici

  // Les DEUX heatmaps se calculent sur TOUT le board, jamais sur le sous-ensemble visible : la
  // couleur d'une tuile prétend situer la commodité dans l'ensemble du marché. Calculée après le
  // filtre de recherche, taper « iron » suffisait à repeindre Iron (3 900 aUEC/SCU, le bas du
  // classement) en `t-hot`, le palier réservé aux 15 % les mieux payés — rang 0 sur 1 ligne
  // restante (#56).
  const maxMarge = all.reduce((mx, c) => Math.max(mx, c.margin || 0), 0); // heatmap relative (Marché)
  const paliers = butin ? valueTiers(all) : new Map();                    // heatmap par rang (Butin)

  const lignes = trierCommodites(all.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q)),
  ));

  // LA SÉLECTION EST DÉRIVÉE, jamais écrite ici (#149). L'ancienne version remplaçait
  // `etat.commSelected` pendant le rendu dès que la commodité choisie sortait du filtre : le choix
  // était perdu pour de bon, et effacer le filtre ne le ramenait pas. `etat.commSelected` n'est
  // désormais écrit que par le clic sur une tuile — un geste de l'utilisateur, et lui seul.
  const selection = etat.commSelected && lignes.some((r) => r.name === etat.commSelected)
    ? etat.commSelected
    : (lignes[0]?.name ?? null);

  const detail = selection ? commodityPoints(etat.MARKET, selection, readFilters(), effVals) : null;

  return (
    <>
      <Portail id="commGrid">
        <VueGrilleCommodites
          lignes={lignes}
          butin={butin}
          selection={selection}
          transportees={journeyCarriedCommodities()}
          codesAmbigus={ambiguousCodes(lignes)}
          palier={(c) => (butin ? paliers.get(c.name) || "t-none" : palierMarge(c.margin, maxMarge))}
          valeurCompacte={compactValue}
          choisir={(nom) => { etat.commSelected = nom; saveState(); notifier(); }}
        />
      </Portail>
      <Portail id="commDetail">
        {!selection ? inviteDetail(butin) : !detail ? null : (
          <VueDetailCommodite
            points={detail}
            nomCommodite={detail.name}
            butin={butin}
            estCorrige={(terminal, cote, champ) => isOv(detail.name, terminal, cote, champ)}
            corriger={(terminal, cote, champ, valeur, releve) =>
              corriger(detail.name, terminal, cote, champ, valeur, releve)}
            legendeAchat={BUY_STATUS}
            legendeVente={SELL_STATUS}
          />
        )}
      </Portail>
      <Portail id="commHint">{aideBoard(butin)}</Portail>
    </>
  );
}
