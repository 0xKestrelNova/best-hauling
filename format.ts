import { cargoBoxes, scuBoxes } from "./logic.ts";
import type { LigneManifeste } from "./types.ts";

// Les formateurs partagés (ADR-011).
//
// Ils étaient définis dans `app.js` et INJECTÉS en props : `fmt` traversait onze composants, `fmtVol`
// et `fmtFee` la moitié. C'est exactement ce qu'une application écrite de zéro n'aurait pas fait —
// on n'injecte pas un formateur, on l'importe. Trente-six déclarations de props disparaissent avec
// ce module.
//
// Ils sont PURS : `tsc` les couvre, et rien n'oblige plus un composant à recevoir de quoi afficher
// un nombre.

/** Un entier, séparateurs français. `—` pour ce qui n'est pas un nombre fini. */
export const fmt = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("fr-FR");

/**
 * Un volume dont le `null` veut dire « capacité non communiquée par UEX », et non « zéro » :
 * `scu_sell` n'est renseigné que sur une minorité de points de vente. Un « — » s'y lisait
 * « aucune demande » alors qu'aucun plafond n'est appliqué dans ce cas — d'où « n.c. ».
 */
export const fmtVol = (n: number | null | undefined): string => (n == null ? "n.c." : fmt(n));

/** L'infobulle qui accompagne un volume inconnu. */
export const TEXTE_CAPACITE_INCONNUE =
  "Capacité non communiquée par UEX : aucun plafond de volume n'est appliqué";

/** Un montant que des frais rendent APPROCHÉ : le « ≈ » dit que le chiffre est une estimation. */
export const fmtFee = (n: number, fees: number): string => (fees > 0 ? "≈ " + fmt(n) : fmt(n));

/**
 * Préfixe un montant de son signe RÉEL. Un « + » posé d'office écrivait « +-1 234 » dès que les
 * frais mangeaient la marge — en vert, sur le seul chiffre qui disait de ne pas charger la ligne.
 */
export const signe = (n: number, texte: string): string => (n < 0 ? texte : "+" + texte);

// ── Les libellés de CAISSES ────────────────────────────────────────────────────────────────────
// Ex. « 8×32 · 1×16 · 1×4 · 1×2 · 1×1 ». `maxBox` est le plafond de caisse du terminal de
// CHARGEMENT quand on le connaît : c'est une propriété physique de la station, indépendante de
// l'interrupteur de frais. On le propage partout où le terminal d'achat est disponible, parce que
// c'est exactement la décomposition que la facture d'autoload utilise — un « 📦 1×32 » à côté d'un
// montant calculé sur deux caisses de 16 serait une incohérence directement visible.
//
// Ils vivaient dans `app.js` alors qu'ils ne lisent aucun état : trois vues les consomment, et deux
// d'entre elles vivent maintenant dans l'arbre.

const boxesLabel = (boxes: { count: number; size: number }[]): string =>
  boxes.length ? boxes.map((b) => `${b.count}×${b.size}`).join(" · ") : "";

export const scuBoxesLabel = (n: number, maxBox?: number | null): string =>
  boxesLabel(scuBoxes(n, maxBox));

// Même libellé pour un chargement à PLUSIEURS commodités : une caisse ne contient qu'une commodité,
// la décomposition se fait donc ligne par ligne (`cargoBoxes`) et jamais sur le total des SCU.
export const cargoBoxesLabel = (lines: LigneManifeste[], maxBox?: number | null): string =>
  boxesLabel(cargoBoxes(lines, maxBox));

// ── L'ÉCHAPPEMENT HTML ─────────────────────────────────────────────────────────────────────────
// Il est ici pour la même raison que `fmt` : c'est la dernière étape avant l'affichage, celle qu'on
// ne veut écrite qu'une fois. Les données UEX sont COMMUNAUTAIRES — noms de terminaux, surnoms,
// codes — donc non fiables par construction, et deux endroits les insèrent encore en chaîne dans du
// `innerHTML` : le sélecteur de station (`selecteur.js`) et les `<datalist>` d'`app.js`.
//
// Les vues React n'en ont pas besoin : JSX échappe déjà tout texte interpolé. Ce module ne grandira
// donc pas de ce côté — au contraire, `esc` disparaîtra avec le dernier `innerHTML` du dépôt.
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
