// Les index dérivés du marché (ADR-011).
//
// Quatre tables construites UNE FOIS à l'arrivée de `market.json`, et consultées partout : le champ
// de départ d'« En route », le sélecteur de station des Corrections, les frais d'autoload, la
// résolution d'un nom de terminal en objet, et la taille de caisse d'un couple.
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

/** « commodité|terminal » → plus grosse caisse que CE comptoir propose pour CETTE commodité (#194).
 *  Les vues MONO-commodité — Trajets, Boucles — ne reçoivent que des NOMS : `routes.json` et
 *  `loops.json` ne portent pas les tuples de marché, et `feeCtx` n'a donc aucun moyen de retrouver
 *  la taille du couple sans cet index. Les vues multi-commodité, elles, n'en ont pas besoin : la
 *  taille voyage sur la LIGNE de manifeste, posée par les fabriques de `logic.ts`.
 *  Clé par NOM, comme `termByName` et pour la même raison : vérifié sur l'instantané, 114
 *  terminaux pour 114 noms distincts. C'est le `code` UEX qui n'est pas unique, pas le nom. */
export const tailleParCouple = new Map<string, number>();
const cleCouple = (commodite: string, terminal: string): string => `${commodite}|${terminal}`;

/** La taille du couple, ou `undefined` — l'appelant retombe alors sur `Terminal.maxBox`, qui est un
 *  MAJORANT (jamais dépassé sur 2 579 lignes UEX). Passer par cet accesseur et jamais par la Map :
 *  trois lecteurs la consultent — la facture, l'infobulle et le libellé 📦 — et ils DOIVENT rendre
 *  le même décompte, sinon le « 📦 3×32 » contredit le montant qu'il explique. */
export const tailleDuCouple = (commodite: string, terminal: string): number | undefined =>
  tailleParCouple.get(cleCouple(commodite, terminal));

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
      // La taille se range AVANT le court-circuit : elle vaut par COUPLE, là où `originMap` ne
      // retient qu'un terminal une fois pour toutes. La poser après aurait perdu toutes les
      // commodités d'un comptoir sauf la première — en silence, et sans qu'aucun test ne bronche.
      if (b[5] != null) tailleParCouple.set(cleCouple(c.name, marche.terminals[i].name), b[5] as number);
      if (vus.has(i)) continue;
      vus.add(i);
      const t = marche.terminals[i];
      originMap.set(stationLabel(t.name, t.system), i);
    }
    // Côté vente aussi : une boucle charge à ses DEUX extrémités, et une cargaison acquise ailleurs
    // se décharge au comptoir d'arrivée sans y avoir jamais été chargée.
    for (const s of c.sells) {
      if (s[5] != null) tailleParCouple.set(cleCouple(c.name, marche.terminals[s[0] as number].name), s[5] as number);
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

/**
 * La station affichée par la vue « Corrections », dérivée du champ `#station`. Vif, comme les deux
 * ci-dessus, et pour la même raison : c'était une globale `stationSel` qu'une seule fonction de
 * rendu rafraîchissait. Une valeur dérivée qu'il faut penser à recalculer est une valeur qui sera
 * un jour lue périmée — ici, par « Enregistrer » un relevé après une restauration par permalien,
 * qui repose le champ sans le résoudre.
 *
 * Correspondance EXACTE, et surtout PAS `resolveStationLabel` : sa seconde passe retombe sur le nom
 * seul, insensible à la casse, et deux homonymes de systèmes différents — Pyro Gateway (Stanton) et
 * Pyro Gateway (Nyx) — se résoudraient au premier trouvé. Ce champ-ci porte toujours le libellé
 * canonique : le sélecteur l'écrit, la vignette de la bande l'écrit, le permalien le transporte.
 */
export const indexStationExacte = (): number | null => {
  const v = champ("station");
  return stationMap.has(v) ? (stationMap.get(v) as number) : null;
};

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

/**
 * Le terminal d'ARRIVÉE forcé de la vue « En route », dérivé du champ `#destTerminal`.
 *
 * Vif comme ses trois voisins ci-dessus, et pour la même raison : c'était une globale
 * `enrouteDest` qu'une fonction `resolveDest()` rafraîchissait en tête de rendu. Tous ses lecteurs
 * dépendaient donc d'avoir été appelés APRÈS elle.
 */
export const indexArriveeForcee = (): number | null => {
  const v = champ("destTerminal");
  return stationMap.has(v) ? (stationMap.get(v) as number) : null;
};
