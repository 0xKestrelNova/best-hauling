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
// La seule fonction PURE dont ce module ait besoin : elle tient l'invariant `part + reste = total`
// des deux champs de vente (#49). Le miroir est un geste, la répartition est un calcul.
import { repartirVente } from "./logic.ts";

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

// ── Les DEUX champs de vente (#49) ────────────────────────────────────────────────────────────
/** Lequel des deux champs est-ce ? `null` pour tout le reste de la carte — c'est LA garde. */
const quelChamp = (n: Noeud): "part" | "reste" | null =>
  n.classList.contains("hold-sell-qty") ? "part" : n.classList.contains("hold-rest-qty") ? "reste" : null;

/** Le conteneur de la vente ouverte et son total, ou `null` si l'un des deux manque. */
const venteDe = (n: Noeud): { b: Noeud; total: number } | null => {
  const b = n.closest(".hold-sell");
  const total = Number(b?.dataset.total);
  return b && Number.isFinite(total) && total > 0 ? { b, total } : null;
};

/**
 * Les SCU qui PARTENT, lus sur le conteneur d'une vente ouverte et ramenés dans leurs bornes.
 *
 * Les trois gestes qui sortent du fret — ⬓ déposer, ✓ vendre, Entrée — passent tous par ici, et
 * c'est ce qui les empêche de diverger : `.hold-sell-qty` porte « ce qui part » et lui seul, quel
 * que soit le champ où l'utilisateur a tapé. C'est aussi le filet des navigateurs qui ne donnent
 * pas le focus à un bouton cliqué, donc où le `focusout` n'a pas eu lieu.
 *
 * Repli sans `data-total` exploitable : on rend la saisie telle quelle. `sellFromHold` et
 * `storeFromHold` bornent déjà à ce qui est réellement à bord — le miroir est un confort, jamais
 * un point de panne.
 */
const scuQuiPartent = (b: Noeud): number => {
  const brut = b.querySelector<HTMLInputElement>(".hold-sell-qty")!.value;
  const total = Number(b.dataset.total);
  return Number.isFinite(total) && total > 0 ? repartirVente(total, brut, "part").part : Number(brut);
};

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
      deposerIci(deposer.dataset.name, scuQuiPartent(b!), Number(b!.dataset.idx));
      return;
    }
    const ouvrir = cible(e).closest(".hold-sell-btn");
    if (ouvrir) { ouvrirVente(ouvrir.dataset.name); return; }
    if (cible(e).closest(".hold-sell-no")) { fermerVente(); return; }
    const ok = cible(e).closest(".hold-sell-ok");
    if (ok) {
      const b = ok.closest(".hold-sell");
      vendreIci(ok.dataset.name, scuQuiPartent(b!), Number(b!.dataset.idx));
      return;
    }
    const del = cible(e).closest(".hold-del");
    if (del) retirerLot(Number(del.dataset.i));
  });

  // Entrée valide la vente, Échap l'annule — même patron que les corrections en place.
  // La garde couvre LES DEUX champs depuis #49 : le curseur s'ouvre désormais dans « restants »,
  // et une garde restée sur `.hold-sell-qty` y aurait rendu Entrée et Échap muets — sans qu'aucun
  // test ne bronche, puisque aucun e2e ne presse Entrée dans ce champ.
  $("holdCard").addEventListener("keydown", (e) => {
    if (!quelChamp(cible(e))) return;
    // Entrée doit encaisser à la MÊME station que le bouton ✓, et le MÊME nombre de SCU. L'index
    // figé COMME la quantité se lisent sur le conteneur, jamais sur le champ frappé : taper dans
    // « restants » puis Entrée aurait sinon envoyé le RESTANT à `vendreIci` — l'exact contraire.
    if (e.key === "Enter") {
      e.preventDefault();
      const b = cible(e).closest(".hold-sell");
      if (b) vendreIci(etat.venteEnCours, scuQuiPartent(b), Number(b.dataset.idx));
    } else if (e.key === "Escape") { e.preventDefault(); fermerVente(); }
  });

  // ── #49 : le miroir entre « ce qui part » et « ce qui reste » ────────────────────────────────
  // Au comptoir on lit CE QUI RESTE (« 2 170 »), l'app ne demandait que CE QUI PART (« 30 ») : une
  // soustraction de tête à chaque escale, et une soustraction fausse se paye en fret vendu qu'on
  // croyait garder. Les deux champs coexistent donc, et l'un tient l'autre à jour.
  //
  // IMPÉRATIF, ET SURTOUT PAS UN ÉTAT REACT. Les deux champs sont NON CONTRÔLÉS (`defaultValue`,
  // vues/soute.tsx) : passer par `etat` + `notifier()` repeindrait la carte Soute à CHAQUE frappe
  // — `holdByCommodity` reclasse par capital engagé, `offloadPlan` recalcule si « où écouler » est
  // ouvert — donc sous les doigts. C'est le raisonnement déjà écrit dans `soute-actions.ts`, qui
  // appelle `flushSync(notifier)` et non `flushSync(rafraichir)` pour la même raison.
  // Écrire `.value` sur le champ voisin n'émet AUCUN `input` (le DOM n'en produit pas pour une
  // écriture programmée) : pas de boucle, et zéro rendu. Ne pas « réparer » ça par un
  // `dispatchEvent`.
  //
  // PAS DE DÉBOUNCE, contrairement au `input` de `#holdDeclare` juste en dessous : celui-là
  // déclenche `poserPosition` → `rafraichir()`, donc un repeint complet ; celui-ci n'écrit que la
  // `.value` d'un input frère, et un délai ne ferait que retarder le seul retour visuel utile.
  //
  // LA GARDE D'ÉTROITESSE. `#holdCard` ne portait jusqu'ici que `click` et `keydown` ; `input` y
  // est NEUF, et une délégation sans garde attraperait tout champ qu'une carte future y rendrait.
  // Même patron que `#holdDeclare`, gardé par `champ(e).id === "holdWhere"` — ici par la CLASSE,
  // parce que ces champs-là n'ont pas d'id et n'ont pas à en avoir (voir vues/soute.tsx).
  $("holdCard").addEventListener("input", (e) => {
    const quel = quelChamp(cible(e));
    if (!quel) return;
    const v = venteDe(cible(e));
    if (!v) return;
    const r = repartirVente(v.total, champ(e).value, quel);
    // On n'écrit QUE dans le miroir. Ramener le champ frappé dans ses bornes ICI mangerait le
    // chiffre en cours de saisie : taper « 2 » vers « 2 170 » deviendrait « 30 » sous les doigts.
    const miroir = v.b.querySelector<HTMLInputElement>(quel === "part" ? ".hold-rest-qty" : ".hold-sell-qty");
    if (miroir) miroir.value = String(quel === "part" ? r.reste : r.part);
  });

  // La valeur hors bornes est ramenée AU DÉPART DU CURSEUR, et là seulement — voir ci-dessus.
  // `focusout` et non `blur` : seul le premier REMONTE, donc seul lui se délègue. Il précède le
  // `click` du ✓ et du ⬓ (mousedown → focusout → click), si bien que les deux boutons lisent déjà
  // un chiffre borné ; `scuQuiPartent` reborne quand même, pour les navigateurs qui ne donnent pas
  // le focus à un bouton cliqué.
  $("holdCard").addEventListener("focusout", (e) => {
    const quel = quelChamp(cible(e));
    if (!quel) return;
    const v = venteDe(cible(e));
    if (!v) return;
    const r = repartirVente(v.total, champ(e).value, quel);
    champ(e).value = String(quel === "part" ? r.part : r.reste);
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
