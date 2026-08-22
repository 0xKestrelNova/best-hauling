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
} from "./soute-actions.js";
import { copierEntrepots } from "./presse-papiers.js";

const $ = (id) => document.getElementById(id);

/** Branche les trois cartes. Appelé une fois, à l'amorçage. */
export function brancherGestesSoute() {
  // ── La soute : vider, écouler, déposer, vendre, retirer un lot ───────────────────────────────
  $("holdCard").addEventListener("click", (e) => {
    if (e.target.closest("#holdClear")) { viderSoute(); return; }
    if (e.target.closest("#holdOffload")) { basculerEcoulement(); return; }
    // La quantité ET la station se lisent sur le MÊME conteneur : celui que le rendu a produit.
    // `dataset.idx` absent -> undefined -> NaN -> repli sur `stationCourante()` ; jamais 0.
    const deposer = e.target.closest(".hold-store");
    if (deposer) {
      const b = deposer.closest(".hold-sell");
      deposerIci(deposer.dataset.name, Number(b.querySelector(".hold-sell-qty").value), Number(b.dataset.idx));
      return;
    }
    const ouvrir = e.target.closest(".hold-sell-btn");
    if (ouvrir) { ouvrirVente(ouvrir.dataset.name); return; }
    if (e.target.closest(".hold-sell-no")) { fermerVente(); return; }
    const ok = e.target.closest(".hold-sell-ok");
    if (ok) {
      const b = ok.closest(".hold-sell");
      vendreIci(ok.dataset.name, Number(b.querySelector(".hold-sell-qty").value), Number(b.dataset.idx));
      return;
    }
    const del = e.target.closest(".hold-del");
    if (del) retirerLot(Number(del.dataset.i));
  });

  // Entrée valide la vente, Échap l'annule — même patron que les corrections en place.
  $("holdCard").addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("hold-sell-qty")) return;
    // Entrée doit encaisser à la MÊME station que le bouton ✓ : même index figé, lu sur le conteneur.
    if (e.key === "Enter") {
      e.preventDefault();
      vendreIci(etat.venteEnCours, Number(e.target.value), Number(e.target.closest(".hold-sell")?.dataset.idx));
    } else if (e.key === "Escape") { e.preventDefault(); fermerVente(); }
  });

  // ── Déclarer « j'ai ça à bord » (#55) : le seul chemin qui fait entrer du fret sans jambe ─────
  $("holdDeclare").addEventListener("click", (e) => {
    if (e.target.closest("#holdAddOpen")) { ouvrirDeclaration(); return; }
    if (e.target.closest("#holdAddNo")) { fermerDeclaration(); return; }
    if (e.target.closest("#holdAddOk")) declarerABord();
  });

  // Entrée valide depuis n'importe lequel des trois champs, Échap abandonne.
  $("holdDeclare").addEventListener("keydown", (e) => {
    if (!e.target.closest(".hold-add")) return;
    if (e.key === "Enter") { e.preventDefault(); declarerABord(); }
    else if (e.key === "Escape") { e.preventDefault(); fermerDeclaration(); }
  });

  // La position se résout à la frappe, DÉBOUNCÉE comme le champ de départ d'« En route » : c'est le
  // même champ derrière, et une résolution par caractère repeindrait toute la page à chaque lettre.
  // On capture la VALEUR tout de suite : l'événement, lui, sera périmé quand le timer se déclenchera.
  const poserPositionDifferee = debounce(poserPosition);
  $("holdDeclare").addEventListener("input", (e) => {
    if (e.target.id === "holdWhere") poserPositionDifferee(e.target.value);
  });

  // ── Les entrepôts ───────────────────────────────────────────────────────────────────────────
  // « Reprendre » remet le lot en soute. Un seul geste, pas de champ de quantité — on reprend ce
  // qu'on a laissé ; une reprise partielle se ferait en redéposant. La fonction pure, elle, accepte
  // déjà des SCU : l'interface pourra suivre sans la toucher.
  $("depotsCard").addEventListener("click", (e) => {
    if (e.target.closest("#copyDepots")) { copierEntrepots(); return; }
    const b = e.target.closest(".depot-take");
    if (b) reprendreIci(b.dataset.station, b.dataset.name, Number(b.dataset.units));
  });
}
