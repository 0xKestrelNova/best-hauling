// Les index dérivés du marché (ADR-011).
//
// Trois tables construites UNE FOIS à l'arrivée de `market.json`, et consultées partout : le champ
// de départ d'« En route », le sélecteur de station des Corrections, les frais d'autoload, la
// résolution d'un nom de terminal en objet.
//
// **Elles sont exportées telles quelles, et c'est légitime ici** — contrairement aux 27 globales
// parties dans `etat.ts` avec le déménagement (#135). Une liaison ES est vivante en lecture mais non
// réassignable de l'extérieur ; or ces trois-là ne sont JAMAIS réassignées, seulement remplies par
// `.set()`. C'était déjà le constat de l'inventaire : elles étaient les seules des 53 globales
// qu'un `import` nu pouvait partager sans accesseur. Elles n'avaient donc rien à faire dans l'état.

import { journeyStations, parseStationLabel, resolveCommodity, stationLabel } from "./logic.ts";
import { etat } from "./etat.ts";
import type { Marche, Terminal } from "./types.ts";

/** Libellé « Nom — Système » → index du terminal, ACHAT uniquement (le départ d'« En route »). */
export const originMap = new Map<string, number>();

/** Libellé → index, TOUS les terminaux (achat ou vente) — c'est la vue Corrections qui l'exige. */
export const stationMap = new Map<string, number>();

/** Nom de terminal → le terminal lui-même. Le pont qu'utilisent les frais d'autoload. */
export const termByName = new Map<string, Terminal>();

let construits = false;

/**
 * Remplit les trois index depuis le marché. IDEMPOTENT : le rappeler ne refait rien.
 *
 * Séparé du remplissage des `<datalist>` qui l'accompagnait dans `app.js` : construire un index et
 * peindre une liste déroulante ne sont pas le même métier, et seul le premier est réutilisable.
 */
export function construireIndex(marche: Marche): void {
  if (construits) return;

  const vus = new Set<number>();
  for (const c of marche.commodities) {
    for (const b of c.buys) {
      const i = b[0] as number;
      if (vus.has(i)) continue;
      vus.add(i);
      const t = marche.terminals[i];
      originMap.set(stationLabel(t.name, t.system), i);
    }
  }

  marche.terminals.forEach((t, i) => {
    stationMap.set(stationLabel(t.name, t.system), i);
    termByName.set(t.name, t);
  });

  construits = true;
}

/** Les libellés d'origine, triés — ce que la `<datalist>` de départ affiche. */
export const libellesOrigines = (): string[] =>
  [...originMap.keys()].sort((a, b) => a.localeCompare(b, "fr"));

/** Les libellés de toutes les stations, triés. */
export const libellesStations = (): string[] =>
  [...stationMap.keys()].sort((a, b) => a.localeCompare(b, "fr"));

/**
 * Un libellé saisi → l'index du terminal, ou `null`.
 *
 * DEUX passes, et l'ordre compte : d'abord l'égalité EXACTE sur le libellé complet
 * (« Nom — Système »), qui est ce que la `<datalist>` propose et ce que le permalien transporte ;
 * seulement ensuite le repli sur le nom seul, insensible à la casse, pour ce que l'utilisateur tape
 * à la main. Inverser les deux ferait gagner un homonyme d'un autre système contre la valeur exacte.
 */
export function resolveStationLabel(input: string | null | undefined): number | null {
  const v = (input || "").trim();
  if (!v) return null;
  const exact = stationMap.get(v);
  if (exact != null) return exact;
  const lc = v.toLowerCase();
  for (const [label, idx] of stationMap) {
    if (parseStationLabel(label).name.toLowerCase() === lc) return idx;
  }
  return null;
}

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

/**
 * L'index du terminal de DÉPART, dérivé du champ `#origin`. Vif, et non mis en cache.
 *
 * Il l'était : une globale `enrouteOrigin` que `resolveOrigin()` rafraîchissait à quatre endroits,
 * dont un dont le commentaire disait tout — « re-résout depuis le champ, il peut avoir été posé par
 * le parcours, sans événement input ». Une valeur dérivée qu'il faut penser à recalculer est une
 * valeur qui sera un jour lue périmée. La dérivation coûte une lecture de champ et un accès de
 * `Map` ; le cache coûtait une classe de bugs.
 */
export const indexOrigine = (): number | null => indexDepart("origin");

/** Le même, pour le départ de la vue « Chaîne » — même champ de nature, même piège évité. */
export const indexDepartChaine = (): number | null => indexDepart("chainOrigin");

const indexDepart = (id: string): number | null => {
  const v = champ(id);
  return originMap.has(v) ? (originMap.get(v) as number) : null;
};

/**
 * Où l'on se trouve : l'étape courante du parcours s'il y en a un, sinon le départ d'« En route ».
 * `null` est un état normal — la vente est alors impossible, et son bouton absent.
 */
export function stationCourante(): number | null {
  if (etat.JOURNEY) {
    const ici = journeyStations(etat.JOURNEY)[etat.JOURNEY.current];
    if (ici) return stationMap.get(stationLabel(ici.name, ici.system)) ?? null;
  }
  return indexOrigine();
}

/** Une commodité par son nom OU son code UEX. `null` si le marché n'est pas là ou si rien ne colle. */
export const findCommodity = (name: string) =>
  etat.MARKET ? resolveCommodity(etat.MARKET.commodities, name) : null;
