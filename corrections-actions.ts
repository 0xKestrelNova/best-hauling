// Corriger un chiffre : l'ACTION (ADR-012).
//
// `corrections.ts` porte la DONNÉE — lire le store, écrire une correction, relever ce qui a péri.
// Son en-tête dit « `app.js` garde le MESSAGE » : ce module EST ce message, et il est ce qui reste
// quand `app.js` s'en va.
//
// La séparation tient à un fait précis : `effVals` est appelée trente fois au fond du rendu. Elle
// ne peut donc traîner derrière elle ni un toast, ni un compteur de rail, ni un cycle de rendu.
// Ici on est de l'autre côté — un geste de l'utilisateur, une fois.
//
// ── CE QUE `corriger` UNIFIE ──────────────────────────────────────────────────────────────────
// Le même corps était écrit QUATRE fois dans `app.js` : Trajets, Manifeste, Corrections et le
// détail des Commodités. Quatre copies d'un enchaînement dont chaque maillon est un contrat :
//   1. un VOLUME fige d'abord les jambes déjà planifiées — avant l'écriture, pour capturer les SCU
//      encore en vigueur (#48) ; un PRIX ne fige rien ;
//   2. `""` efface le champ, il ne vaut pas zéro ;
//   3. `releve` est la date UEX du point : c'est contre CET export que la correction vaut ;
//   4. le compteur du rail suit, puis le cycle de rendu complet.
// Une copie qui rate le point 1 ne casse aucun test — elle laisse simplement un voyage se recalculer
// sur un stock qu'on vient de contredire.

import { DUREE_VOL } from "./logic.ts";
import type { ChampCorrection, CoteMarche } from "./types.ts";
import { ovCount, relevePerimees, resetOverrides, setOverride } from "./corrections.ts";
import { pinLegsForVolume } from "./voyage-donnees.ts";
import { showToast } from "./messages.ts";
import { rafraichir } from "./rendu.ts";

/**
 * Met à jour le libellé du bouton de vue « Corrections » (compteur).
 *
 * Le nœud touché est dans le RAIL — `#viewCorrections .rl` — qu'aucun portail ne possède et qui ne
 * passera jamais par React tant que `rail.js` existe. Cette fonction restera donc impérative après
 * la migration des vues : ce n'est pas une dette, c'est la frontière.
 */
export function updateOvBadge(): void {
  const n = ovCount();
  const bouton = document.getElementById("viewCorrections");
  const rl = bouton?.querySelector(".rl");
  if (!bouton || !rl) return;
  // On écrit DANS le .rl, au lieu d'écraser le bouton entier en textContent : cette écriture-là
  // détruisait le <span class="rn">, et le numéro de Corrections n'a donc jamais existé à l'écran
  // (#45). Le rail annonce une touche par numéro — il ne peut pas en manquer un sur huit.
  rl.textContent = "Corrections";
  // Le compteur en plus petit, sans interlettrage : mesuré, il rend 20 px au libellé. Sans lui
  // « Corrections (123) » repart à la ligne, et le bouton fait deux fois la hauteur des sept
  // autres — un rail qui cède quand la place manque, c'est le symptôme de #86.
  if (n) {
    const compteur = document.createElement("span");
    compteur.className = "ov-n";
    compteur.textContent = `(${n})`;
    rl.append(" ", compteur);
  }
  // Le libellé étant maintenant dans un .rl, il disparaît au rail rétracté : l'aria-label est le
  // seul à porter le compteur à ce moment-là, et il doit donc suivre.
  bouton.setAttribute("aria-label", n ? `Corrections (${n})` : "Corrections");
}

/**
 * Dit une fois ce que le rendu qui vient de finir a périmé.
 *
 * DEUX causes de péremption, donc deux messages : dire « mise à jour UEX » à propos d'un volume qui
 * a simplement vieilli serait faux, et enverrait chercher un changement de données qui n'a pas eu
 * lieu. Si les deux tombent dans le même rendu, la mise à jour UEX passe en premier — c'est un fait
 * extérieur, l'autre est une simple horloge.
 */
export function notifySuperseded(): void {
  // Le RELEVÉ vide les compteurs : appeler deux fois de suite ne redit rien.
  const { uex: nUex, age: nAge } = relevePerimees();
  if (!nUex && !nAge) return;
  updateOvBadge();
  const s = (n: number) => (n > 1 ? "s" : "");
  if (nUex) showToast(`✎ ${nUex} correction${s(nUex)} périmée${s(nUex)} par une mise à jour UEX`);
  if (nAge) {
    const h = Math.round(DUREE_VOL / 3600);
    const msg = `✎ ${nAge} volume${s(nAge)} corrigé${s(nAge)} périmé${s(nAge)} — plus de ${h} h, le comptoir s'est rempli depuis`;
    if (nUex) setTimeout(() => showToast(msg), 1200); else showToast(msg);
  }
}

/**
 * Écrit une correction, et tout ce qui doit suivre. Le point d'entrée UNIQUE des quatre vues qui
 * laissent corriger un chiffre.
 *
 * L'ordre est un contrat, pas un style — voir l'en-tête. `rafraichir()` et non `notifier()` : une
 * correction change le prix des jambes du voyage, la valeur de la soute et l'URL partagée, et rien
 * de tout cela ne vit encore dans l'arbre.
 */
export function corriger(
  commodite: string,
  terminal: string,
  cote: CoteMarche,
  champ: ChampCorrection,
  valeur: string,
  releve: number | string,
): void {
  if (champ === "vol") pinLegsForVolume(commodite, terminal, cote);
  setOverride(commodite, terminal, cote, champ, valeur === "" ? null : valeur, Number(releve) || 0);
  updateOvBadge();
  rafraichir();
}

/**
 * « Tout réinitialiser » : efface toutes les corrections locales, après confirmation.
 *
 * Le `confirm()` passe AVANT la moindre écriture d'état. Il bloque le fil ; un `notifier()`
 * optimiste posé avant lui peindrait un écran que l'annulation devrait ensuite défaire.
 */
export function effacerToutesLesCorrections(): void {
  if (!ovCount()) return;
  if (!confirm("Effacer toutes tes corrections locales de prix et de stock ?")) return;
  resetOverrides();
  updateOvBadge();
  rafraichir();
}
