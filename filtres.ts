// La barre de filtres (ADR-011).
//
// `readFilters()` fabrique l'objet que TOUTES les vues consultent : les quatorze contrôles du haut,
// lus au moment où on en a besoin. Il vivait dans `app.js` et y était appelé 22 fois ; il n'y avait
// aucune raison qu'il y reste — il ne touche ni à l'état partagé ni au rendu, il lit le DOM et rend
// un objet.
//
// **Il lit le DOM, et c'est délibéré.** Les quatorze champs sont la vérité de ces réglages : les
// recopier dans `etat.ts` créerait une seconde vérité à tenir d'accord, sur les valeurs les plus
// lues de l'application. Ils entreront dans l'état avec leur composant, pas avant — c'est la
// décision prise avec le déménagement des globales (#135).

import type { Filtres, FiltresVolume } from "./types.ts";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;

/** La valeur d'un champ, `""` si l'élément a disparu (aucune vue ne le suppose, mais rien ne le garantit). */
const val = (id: string): string => $(id)?.value ?? "";

/** L'état d'une case. */
const coche = (id: string): boolean => !!($(id) as HTMLInputElement | null)?.checked;

/**
 * Les quatorze contrôles de la barre, lus d'un coup.
 *
 * Le type de retour croise `FiltresVolume`, dont les cinq champs sont OPTIONNELS dans `Filtres` —
 * parce que d'autres appelants en construisent des morceaux — mais que cette fonction-ci écrit
 * TOUJOURS, toutes les cinq, sans branche. Le dire permet de passer le résultat directement à
 * `routeMetrics`/`loopMetrics`/`computeUnits`, qui les exigent : sans ça, chaque vue migrée devrait
 * poser un cast, c'est-à-dire affirmer sans preuve ce qui se lit ici en quatre lignes.
 */
export function readFilters(): Filtres & FiltresVolume {
  return {
    cargo: Math.max(0, Number(val("cargo")) || 0),
    budget: Math.max(0, Number(val("budget")) || 0),
    capStock: coche("capStock"),
    useCargo: coche("useCargo"),
    useBudget: coche("useBudget"),
    sameOnly: coche("sameSystem"),
    noOutpost: coche("noOutpost"),
    legalOnly: coche("legalOnly"),
    sysFilter: val("system"),
    maxAge: Number(val("freshness")) || 0,
    q: val("search").trim().toLowerCase(),
    multi: coche("multiCommodity"),
    // « avec les simples » : les chargements à UNE commodité rentrent dans le même classement que
    // les combinés. Par défaut ils en sont exclus — ils sont déjà dans la vue « Trajets » normale.
    multiAll: val("multiMode") === "all",
    autoload: coche("autoload"),
  };
}

/**
 * Grise et masque les sous-réglages qui n'ont plus de sens, d'après les trois interrupteurs.
 *
 * Elle est la sœur de `readFilters()` : mêmes quatorze contrôles, même doctrine — le DOM est la
 * vérité de ces réglages, et rien ici n'entre dans l'état partagé. C'est pour ça qu'elle vit dans
 * ce module et pas ailleurs.
 *
 * ELLE DOIT RESTER PUREMENT DOM. Elle est appelée depuis le rappel de restauration, à l'intérieur
 * du verrou de `persistance.ts` : lui ajouter une persistance ou un cycle resauverait au milieu
 * d'une restauration.
 */
export function synchroniserReglages(): void {
  const sansSoute = !coche("useCargo");
  const sansBudget = !coche("useBudget");
  desactiver("cargo", sansSoute);
  desactiver("ship", sansSoute);
  desactiver("budget", sansBudget);
  // Multi-commodité : remplir la soute n'a pas de sens sans soute bornée -> coche grisée.
  desactiver("multiCommodity", sansSoute);
  document.getElementById("multiCommodityLabel")?.classList.toggle("disabled", sansSoute);
  // Frais d'autoload : le coefficient global n'a de sens que l'interrupteur actif -> champ masqué
  // sinon (il reste dans l'état, donc dans le lien). La coche, elle, n'est PAS grisée sans soute :
  // le budget ou le plafond de stock bornent aussi le volume, et un volume borné suffit à facturer.
  masquer("alkField", !coche("autoload"));
  // Portée de la liste multi : ne se règle que si la liste multi existe.
  masquer("multiModeField", !coche("multiCommodity"));
}

const desactiver = (id: string, oui: boolean): void => { const el = $(id); if (el) el.disabled = oui; };
const masquer = (id: string, oui: boolean): void => {
  const el = document.getElementById(id);
  if (el) el.hidden = oui;
};
