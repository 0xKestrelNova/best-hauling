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
