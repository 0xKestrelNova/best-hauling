// LE TRI DES DEUX TABLEAUX : Trajets et Boucles (ADR-005, ADR-012).
//
// Les `<thead>` sont du markup d'`index.html` : React ne possède que les `<tbody>` (`#rows`,
// `#loopRows`). Les écouteurs posés ici une fois survivent donc à tous les rendus de l'arbre —
// c'est la FRONTIÈRE de l'ADR-012 §2, et c'est ce qui rend ce module possible sans composant.
//
// ── POURQUOI `notifier()` ET JAMAIS `rafraichir()` ────────────────────────────────────────────
// C'est le seul geste du dépôt qui persiste À LA MAIN puis propage, au lieu d'appeler le cycle.
// La raison n'est pas l'économie : un cycle complet incrémente les deux GÉNÉRATIONS, qui entrent
// dans la `key` des champs SCU à saisie libre — la carte de chargement et les jambes du compagnon.
// Trier une colonne remonterait donc la valeur calculée sous les doigts de quelqu'un qui est en
// train de saisir des SCU juste à côté. Aucun test ne l'observe ; c'est la « simplification » qui a
// l'air gratuite et qui coûte un bug.
import { safeKey } from "./logic.ts";
import { etat, notifier } from "./etat.ts";
import { saveState } from "./persistance.ts";

/**
 * Rend un `<th>` activable au clavier comme à la souris.
 *
 * Pas de `role="button"`, contrairement aux valeurs corrigeables (`.editv`) : il écraserait le rôle
 * `columnheader`, seul rôle sur lequel `aria-sort` veut dire quelque chose. On perdrait l'annonce
 * de la colonne triée en croyant améliorer son accessibilité — et le raccourci clavier global
 * ignore justement tout `role="button"`, donc un `<th>` qui en porterait un ne répondrait plus aux
 * touches 1…8 après tabulation.
 */
function enTeteTriable(th, appliquer) {
  if (!th.hasAttribute("tabindex")) th.tabIndex = 0;
  th.addEventListener("click", appliquer);
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); appliquer(); } // Espace ne doit pas défiler la page
  });
}

/**
 * Pose l'indicateur ▾/▴ sur la colonne triée des DEUX tables.
 *
 * La flèche est un `::after` CSS accroché aux classes : elle n'existe pas pour un lecteur d'écran.
 * `aria-sort` DOUBLE donc les classes (il ne les remplace pas, le CSS s'en sert) sur les seules
 * colonnes triables — le poser sur un `<th>` décoratif annoncerait une colonne qui ne l'est pas.
 *
 * PUREMENT DOM, et ça doit le rester : elle est appelée depuis le rappel de restauration, à
 * l'intérieur du verrou de `persistance.ts`. Lui ajouter `saveState()` ou `rafraichir()` resauverait
 * au milieu d'une restauration — précisément ce que ce verrou existe pour empêcher.
 */
export function poserIndicateursDeTri() {
  document.querySelectorAll<HTMLElement>("#routes th, #loops th").forEach((h) => {
    h.classList.remove("sorted-asc", "sorted-desc");
    if (h.dataset.sort || h.dataset.sortLoop) h.setAttribute("aria-sort", "none");
  });
  marquer(`#routes th[data-sort="${etat.sortKey}"]`, etat.sortKey, etat.sortDir);
  marquer(`#loops th[data-sort-loop="${etat.loopSortKey}"]`, etat.loopSortKey, etat.loopSortDir);
}

const marquer = (selecteur, cle, sens) => {
  if (!safeKey(cle)) return;
  const th = document.querySelector<HTMLElement>(selecteur);
  if (!th) return;
  th.classList.add(sens === -1 ? "sorted-desc" : "sorted-asc");
  th.setAttribute("aria-sort", sens === -1 ? "descending" : "ascending");
};

let branche = false;

/**
 * Branche les en-têtes des deux tables. IDEMPOTENT, et il faut qu'il le soit : un second appel
 * doublerait les écouteurs, donc l'inversion du sens — le tri reviendrait à l'identique et
 * `saveState()` partirait deux fois. Invisible à l'œil, invisible aux tests.
 */
export function brancherTri() {
  if (branche) return;
  branche = true;

  document.querySelectorAll<HTMLElement>("th[data-sort]").forEach((th) => {
    enTeteTriable(th, () => {
      const cle = th.dataset.sort;
      if (etat.sortKey === cle) etat.sortDir *= -1;
      // Le seul tri par défaut CROISSANT : un nom de commodité se lit de A à Z, pas de Z à A.
      else { etat.sortKey = cle; etat.sortDir = cle === "commodity" ? 1 : -1; }
      appliquer();
    });
  });

  document.querySelectorAll<HTMLElement>("th[data-sort-loop]").forEach((th) => {
    enTeteTriable(th, () => {
      const cle = th.dataset.sortLoop;
      if (etat.loopSortKey === cle) etat.loopSortDir *= -1;
      else { etat.loopSortKey = cle; etat.loopSortDir = -1; }
      appliquer();
    });
  });
}

const appliquer = () => {
  poserIndicateursDeTri(); // classes ET aria-sort, pour les deux tables
  saveState();
  notifier(); // rendu CIBLÉ : voir l'en-tête pour pourquoi ce n'est pas `rafraichir()`
};
