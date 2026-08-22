// LA NAVIGATION : quelle vue on regarde, et les trois façons d'en changer (ADR-004, ADR-012).
//
// Une seule vue est visible à la fois, et c'est ce module qui le fait. Il reste IMPÉRATIF, et pas
// par paresse : les quinze conteneurs qu'il masque sont des sections d'`index.html`, dont SIX sont
// aussi des cibles de portail (`#tour`, `#corrections`, `#commodities`, `#plan`, `#chainOut`,
// `#manifest`). Or `createPortal` rend DEDANS sans posséder le nœud, et n'écrit jamais `hidden`.
// Un composant qui poserait `hidden` en `useLayoutEffect` deviendrait un SECOND écrivain du même
// attribut, et lequel gagne dépendrait de sa position dans l'arbre.
//
// ── L'ORDRE EST UN CONTRAT, DEUX FOIS ─────────────────────────────────────────────────────────
//   — `#empty` est masqué AVANT le cycle, donc avant les `useLayoutEffect` de Trajets, Boucles et
//     « En route » : la vue active a toujours le dernier mot. Inverser, c'est effacer le message de
//     la vue qu'on vient d'ouvrir — le bug #147, à l'envers ;
//   — `#shipJourneyRow` est démasqué AVANT le cycle, parce que le bandeau MESURE sa hauteur pour
//     décider d'empiler ses colonnes (`bandeau-vue.tsx`). Mesurée sur une rangée encore masquée,
//     elle vaut zéro, et l'empilement ne se pose jamais. Rien ne le teste : c'est du CSS.
//
// ── POURQUOI `rafraichir()` ET NON `notifier()` ───────────────────────────────────────────────
// `etat.view` part dans le hash et dans le localStorage, et c'est lui qui SIGNE l'état restauré.
// Un changement de vue qui ne saverait pas laisserait le permalien pointer sur la vue précédente,
// et le rechargement rouvrirait la mauvaise.
import { etat } from "./etat.ts";
import { rafraichir } from "./rendu.ts";

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

/**
 * Les sections que chaque vue démasque. Une vue absente de la table n'en démasque aucune — ce qui
 * n'arrive pas, mais évite qu'une faute de frappe fasse disparaître l'écran sans rien dire.
 *
 * La table remplace vingt-trois lignes de `hidden = v !== "…"`. Elle dit la même chose et, à
 * l'ajout d'une neuvième vue, il n'y a qu'un endroit où l'oublier.
 */
const SECTIONS = {
  routes: ["routes"],
  loops: ["loops"],
  enroute: ["enroute", "enrouteControls"],
  chain: ["chainControls", "chainOut"],
  corrections: ["correctionsControls", "corrections"],
  commodities: ["commoditiesControls", "commodities"],
  plan: ["plan"],
  tour: ["tourControls", "tour"],
};

/** Les vues SANS tableau : aucune d'elles n'a de ligne à compter, donc aucune n'a de « rien ici ». */
const SANS_TABLEAU = new Set(["chain", "corrections", "commodities", "plan", "tour"]);

const TOUTES = [...new Set(Object.values(SECTIONS).flat())];

/** Bascule vers la vue `v`, puis rejoue le cycle complet. */
export function basculerVue(v) {
  etat.view = v;

  // Le rail : un `.active` et un seul. La boucle sur `data-view` le garantit par construction —
  // huit `classList.toggle` écrits à la main en oublieraient un à la neuvième vue.
  document.querySelectorAll<HTMLElement>(".rail-nav .vbtn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === v);
  });

  const visibles = new Set(SECTIONS[v] || []);
  for (const id of TOUTES) { const el = $(id); if (el) el.hidden = !visibles.has(id); }

  // Les deux blocs jusqu'ici PERMANENTS, que seule la vue de conclusion masque (ADR-004 §4 et §6).
  // La barre de filtres : on ne change rien au voyage depuis le Plan de vol, l'y laisser ferait
  // croire le contraire. Le bandeau : ses cartes sont éditables (✕ du parcours, vente en soute) et
  // c'est tout ce que cette vue n'est pas — le Plan de vol le remplace par un récapitulatif inerte.
  // Aucune valeur n'est touchée : les deux reviennent intacts au retour dans une vue de recherche.
  $("controls").hidden = v === "plan";
  $("shipJourneyRow").hidden = v === "plan";

  // La carte de chargement n'appartient qu'à « En route » ; personne d'autre ne la referme.
  if (v !== "enroute") $("manifest").hidden = true;
  if (SANS_TABLEAU.has(v)) $("empty").hidden = true;

  rafraichir();
}

/**
 * Branche les trois façons de changer de vue : les huit boutons du rail, la marque, et les touches.
 *
 * Le rail passe par UNE délégation — `.rail-nav` est du markup d'`index.html` qu'aucun portail ne
 * possède, et ses boutons portent déjà leur `data-view`. `#brandHome` en est exclu : il vit hors du
 * rail et ramène toujours aux Trajets (ADR-004 §5).
 */
export function brancherNavigation() {
  const rail = document.querySelector(".rail-nav");
  if (rail) rail.addEventListener("click", (e) => {
    const b = cible(e).closest(".vbtn[data-view]");
    if (b) basculerVue(b.dataset.view);
  });
  $("brandHome")?.addEventListener("click", () => basculerVue("routes"));

  // Raccourcis clavier : / (recherche), 1 à 8 (vues). Ignorés pendant la saisie.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    // `role="button"` couvre d'un coup tout ce que l'app rend activable sans être un <button> :
    // l'en-tête d'une jambe, une escale de la carte, une valeur corrigeable. Sans lui, tabuler
    // jusqu'à l'un d'eux puis taper « 1 »…« 8 » changeait de vue — l'utilisateur clavier perdait son
    // contexte au moment précis où il essayait d'agir dessus.
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ||
               el.getAttribute("role") === "button" || el.classList.contains("editv"))) return;
    if (e.key === "/") { e.preventDefault(); $("search").focus(); return; }
    // L'ordre suit celui du rail (#45), et c'est le contrat : le numéro lu sur un bouton EST la
    // touche qui l'ouvre. On le dérive du rail lui-même, pour qu'aucune des deux listes ne puisse
    // se désynchroniser de l'autre — c'était deux tables jumelles à tenir à la main.
    const rang = "12345678".indexOf(e.key);
    if (rang < 0) return;
    const b = document.querySelectorAll<HTMLElement>(".rail-nav .vbtn")[rang];
    if (b) basculerVue(b.dataset.view);
  });
}
