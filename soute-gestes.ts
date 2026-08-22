// LES GESTES DES TROIS CARTES DE LA SOUTE (ADR-012 §2).
//
// `#holdCard`, `#holdDeclare` et `#depotsCard` sont des conteneurs d'`index.html` que les portails
// du bandeau REMPLISSENT sans les POSSÉDER. Les délégations posées ici une fois traversent donc
// tous les rendus de l'arbre — et les convertir en `onClick` doublerait des gestes qui ne sont pas
// idempotents.
//
// Les GESTES eux-mêmes vivent tous dans `soute-actions.js` ; ce module ne fait que les brancher.
// Y compris les quatre qui portent un contrat de rendu synchrone (`ouvrirDeclaration`,
// `ouvrirVente`) — ils sont là-bas parce que c'est là que vit `flushSync`, pas ici.
//
// ── DEUX ORDRES DE BRANCHES À NE PAS « RANGER » ───────────────────────────────────────────────
//   — `.hold-sell-btn` avant `.hold-sell-no` et `.hold-sell-ok` ;
//   — dans `#holdDeclare`, le keydown se garde par `closest(".hold-add")` — la CLASSE, pas les trois
//     ids : `e2e/declaration.pw.mjs` l'épingle nommément.
import { debounce } from "./rendu.ts";
import { etat } from "./etat.ts";
import {
  basculerEcoulement, declarerABord, deposerIci, fermerDeclaration, fermerVente,
  ouvrirDeclaration, ouvrirVente, poserPosition, reprendreIci, retirerLot, vendreIci, viderSoute,
} from "./soute-actions.ts";
import { copierEntrepots } from "./presse-papiers.ts";

import type { Noeud } from "./types.ts";
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

/** Branche les trois cartes. Appelé une fois, à l'amorçage. */
export function brancherGestesSoute() {
  // ── La soute : vider, écouler, déposer, vendre, retirer un lot ───────────────────────────────
  $("holdCard").addEventListener("click", (e) => {
    if (cible(e).closest("#holdClear")) { viderSoute(); return; }
    if (cible(e).closest("#holdOffload")) { basculerEcoulement(); return; }
    // La quantité ET la station se lisent sur le MÊME conteneur : celui que le rendu a produit.
    // `dataset.idx` absent -> undefined -> NaN -> repli sur `stationCourante()` ; jamais 0.
    const deposer = cible(e).closest(".hold-store");
    if (deposer) {
      const b = deposer.closest(".hold-sell");
      deposerIci(deposer.dataset.name, Number(b!.querySelector<HTMLInputElement>(".hold-sell-qty")!.value), Number(b!.dataset.idx));
      return;
    }
    const ouvrir = cible(e).closest(".hold-sell-btn");
    if (ouvrir) { ouvrirVente(ouvrir.dataset.name); return; }
    if (cible(e).closest(".hold-sell-no")) { fermerVente(); return; }
    const ok = cible(e).closest(".hold-sell-ok");
    if (ok) {
      const b = ok.closest(".hold-sell");
      vendreIci(ok.dataset.name, Number(b!.querySelector<HTMLInputElement>(".hold-sell-qty")!.value), Number(b!.dataset.idx));
      return;
    }
    const del = cible(e).closest(".hold-del");
    if (del) retirerLot(Number(del.dataset.i));
  });

  // Entrée valide la vente, Échap l'annule — même patron que les corrections en place.
  $("holdCard").addEventListener("keydown", (e) => {
    if (!cible(e).classList.contains("hold-sell-qty")) return;
    // Entrée doit encaisser à la MÊME station que le bouton ✓ : même index figé, lu sur le conteneur.
    if (e.key === "Enter") {
      e.preventDefault();
      vendreIci(etat.venteEnCours, Number(champ(e).value), Number(cible(e).closest(".hold-sell")?.dataset.idx));
    } else if (e.key === "Escape") { e.preventDefault(); fermerVente(); }
  });

  // ── Déclarer « j'ai ça à bord » (#55) : le seul chemin qui fait entrer du fret sans jambe ─────
  $("holdDeclare").addEventListener("click", (e) => {
    if (cible(e).closest("#holdAddOpen")) { ouvrirDeclaration(); return; }
    if (cible(e).closest("#holdAddNo")) { fermerDeclaration(); return; }
    if (cible(e).closest("#holdAddOk")) declarerABord();
  });

  // Entrée valide depuis n'importe lequel des trois champs, Échap abandonne.
  $("holdDeclare").addEventListener("keydown", (e) => {
    if (!cible(e).closest(".hold-add")) return;
    if (e.key === "Enter") { e.preventDefault(); declarerABord(); }
    else if (e.key === "Escape") { e.preventDefault(); fermerDeclaration(); }
  });

  // La position se résout à la frappe, DÉBOUNCÉE comme le champ de départ d'« En route » : c'est le
  // même champ derrière, et une résolution par caractère repeindrait toute la page à chaque lettre.
  // On capture la VALEUR tout de suite : l'événement, lui, sera périmé quand le timer se déclenchera.
  const poserPositionDifferee = debounce(poserPosition);
  $("holdDeclare").addEventListener("input", (e) => {
    if (champ(e).id === "holdWhere") poserPositionDifferee(champ(e).value);
  });

  // ── Les entrepôts ───────────────────────────────────────────────────────────────────────────
  // « Reprendre » remet le lot en soute. Un seul geste, pas de champ de quantité — on reprend ce
  // qu'on a laissé ; une reprise partielle se ferait en redéposant. La fonction pure, elle, accepte
  // déjà des SCU : l'interface pourra suivre sans la toucher.
  $("depotsCard").addEventListener("click", (e) => {
    if (cible(e).closest("#copyDepots")) { copierEntrepots(); return; }
    const b = cible(e).closest(".depot-take");
    if (b) reprendreIci(b.dataset.station, b.dataset.name, Number(b.dataset.units));
  });
}
