// La COMPOSITION MANUELLE d'un chargement : sa persistance, et sa survie (ADR-012).
//
// Le PARCOURS va dans l'URL ; la composition qu'on ajuste à la main reste LOCALE. On ne persiste
// que l'INTENTION — `[{ name, units }]` plus les deux bouts de la route — jamais un instantané de
// marché : figé, il continuerait d'afficher le prix du jour de l'édition longtemps après qu'UEX
// l'ait republié. Même règle que les manifestes de jambe (`voyage-donnees.ts`).
//
// ── LE RENDU N'ÉCRIT PLUS ─────────────────────────────────────────────────────────────────────
// `compositionEnCours` faisait trois écritures d'état ET de `localStorage` en pleine phase de
// rendu. C'est l'un des trois chemins que l'en-tête d'`etat.ts` cite pour refuser un magasin qui
// notifierait à l'écriture — et sous React, une écriture pendant le rendu qui déclenche un rendu
// est une boucle à deux passes.
//
// La réponse n'est pas « dérivation » ou « effet », c'est LES DEUX, scindés en trois :
//   1. la SURVIE de la composition est une DÉRIVATION — `manifestIntentSurvives` (logic.ts) est
//      déjà pure, et `destIdx` se relit à chaque fois ;
//   2. la PURGE des commodités disparues d'UEX est une DÉRIVATION aussi : on filtre à l'affichage
//      et on ne persiste rien. Le prochain geste de composition réécrit l'objet entier de toute
//      façon, donc rien ne se perd ;
//   3. l'ABANDON est un GESTE : c'est `oublierComposition()`, appelée par ce qui CHANGE de route.
//      Le laisser au rendu, c'était faire décider par l'affichage ce que l'utilisateur avait fait.

import { manifestIntent, manifestIntentSurvives } from "./logic.ts";
import type { CompositionManifeste, LigneManifeste } from "./types.ts";
import { etat } from "./etat.ts";

const CLE_STOCKAGE = "best-hauling-manifest-edit";

export function loadManifestEdit(): void {
  try {
    etat.MANIFEST_EDIT = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || "null") || null;
  } catch {
    etat.MANIFEST_EDIT = null;
  }
  // Toute forme dont `lines` n'est pas un tableau est invalide : elle ferait planter le premier
  // rendu qui la lit, et une composition illisible ne vaut pas mieux qu'aucune.
  if (!etat.MANIFEST_EDIT || !Array.isArray(etat.MANIFEST_EDIT.lines)) etat.MANIFEST_EDIT = null;
}

export function saveManifestEdit(): void {
  try {
    if (etat.MANIFEST_EDIT) localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat.MANIFEST_EDIT));
    else localStorage.removeItem(CLE_STOCKAGE);
  } catch {}
}

/**
 * Retient ce qui est à l'écran comme intention.
 *
 * Appelée par CHAQUE geste de composition — ajout suggéré, ajout libre, retrait, SCU ajustés —
 * parce que c'est le GESTE qui fait la composition, pas son résultat : deux gestes qui se
 * compensent laissent quand même une carte à soi.
 */
export function retenirComposition(m: {
  origin: { name: string; system: string }; dest: { name: string; system: string };
  lines: LigneManifeste[];
} | null): void {
  if (!m) return;
  etat.MANIFEST_EDIT = {
    from: m.origin.name, fromSystem: m.origin.system,
    to: m.dest.name, toSystem: m.dest.system,
    lines: manifestIntent(m.lines),
  } as CompositionManifeste;
  saveManifestEdit();
}

/** L'abandon. Un GESTE — ce qui change de route l'appelle, le rendu jamais. */
export function oublierComposition(): void {
  etat.MANIFEST_EDIT = null;
  saveManifestEdit();
}

/**
 * La composition vaut-elle pour la route demandée, et où va-t-elle ?
 *
 * PURE : elle ne lit que l'état et rend une réponse. Rien n'est écrit, rien n'est persisté — c'est
 * ce qui la rend appelable depuis un rendu. Rend `null` quand la composition ne vaut pas pour cette
 * route, ou qu'il n'en reste rien après la purge des commodités disparues.
 *
 * `lignes` est la composition EFFECTIVE : celle de l'utilisateur, moins ce qu'UEX ne publie plus.
 * La purge est un FILTRE et non une écriture — mais les SCU sont adressés par index de ligne
 * (`data-i`), donc l'écran et l'intention affichée doivent être le MÊME tableau, jamais deux.
 */
export function compositionValide(
  origine: { name: string; system: string },
  arrivee: { name: string; system: string } | null,
  systemeArrivee: string,
  indexDe: (nom: string, systeme: string) => number | null | undefined,
  connait: (nom: string) => unknown,
): { edit: CompositionManifeste; lignes: CompositionManifeste["lines"]; destIdx: number } | null {
  const edit = etat.MANIFEST_EDIT;
  if (!edit) return null;

  const destIdx = indexDe(edit.to, edit.toSystem);
  const vivante = destIdx != null && manifestIntentSurvives(edit, {
    from: origine,
    dest: arrivee,
    destSystem: systemeArrivee,
  });
  if (!vivante) return null;

  // Commodité disparue d'UEX : écartée plutôt qu'affichée en fantôme, comme sur une jambe.
  const lignes = edit.lines.filter((e) => connait(e.name));
  // Vidée par cette purge, et non par un geste : la composition ne parlait plus que de commodités
  // qui n'existent plus, la carte reprend son calcul. Vidée à la main, elle reste (cf. logic.ts).
  if (!lignes.length) return null;

  return { edit, lignes, destIdx: destIdx as number };
}

// ── LA GÉNÉRATION DE LA CARTE ─────────────────────────────────────────────────────────────────
// Elle distingue les DEUX façons de repeindre le chargement, et c'est tout ce qui reste du
// comportement de l'ancien `innerHTML` :
//   — un RECALCUL (départ changé, « ↺ optimal », prix corrigé…) : les champs SCU doivent adopter
//     les nouvelles valeurs, donc ils se remontent — d'où la génération dans leur `key` ;
//   — une FRAPPE : la génération ne bouge pas, le champ garde son nœud, sa valeur et son curseur.
//
// Sans elle, un champ non contrôlé garderait à jamais ce que l'utilisateur y a tapé : « ↺ optimal »
// remettait `value="96"` dans l'attribut pendant que le champ affichait encore 30.
let generation = 0;

/** Appelée par le cycle de rendu complet, jamais par la frappe. */
export const nouvelleGenerationManifeste = (): void => { generation++; };
export const generationManifeste = (): number => generation;
