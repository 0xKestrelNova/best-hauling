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
