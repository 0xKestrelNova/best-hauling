// Les frais d'autoload (ADR-011).
//
// Le CALCUL est pur et vit dans `logic.ts` (`autoloadFee`, `autoloadPoint`, `haulFee`). Ce module
// n'apporte que ce que `logic.ts` ne peut pas deviner : quel terminal porte quel nom, et combien
// CETTE station facture. Il vivait dans `app.js` ; il n'y avait rien à y faire — il ne peint rien,
// et `feeResolver` est passée dix fois aux fonctions du moteur.
//
// Il lit deux choses hors de lui : `etat.AUTOLOAD_K` (le store des relevés) et le champ `#alk`
// (le coefficient global). Le second reste dans le DOM, comme les quatorze filtres — c'est là qu'est
// sa vérité, et le recopier dans l'état en créerait une seconde.

import {
  AUTOLOAD, autoloadPoint, cargoBoxes, lineHaulFee, lineNet, scuBoxes,
} from "./logic.ts";
import type { LigneManifeste, PaireFrais, Terminal } from "./types.ts";
import { etat } from "./etat.ts";
import { termByName } from "./marche.ts";
import { fmt, fmtFee, signe } from "./format.ts";

/** La cellule « profit » soumise aux frais : un marqueur et un texte d'infobulle. */
export type CelluleFrais = { mark: string; text: string };

const AUTOLOAD_KEY = "best-hauling-autoload";
const K_DEFAULT = 1.2; // milieu des deux seules stations mesurées (Endgame 1,0 et Ruin 1,4)

// { "autoload|<terminal>": { k, amount, scu } } — même forme de clé et même mécanique que les
// corrections locales (localStorage, jamais partagé, jamais dans le lien), mais un STORE À PART.
// Les ranger dans OVERRIDES casserait trois consommateurs qui supposent tous qu'une clé du store
// est une correction prix/stock à TROIS segments : ovCount() les compterait dans le badge « ✎
// Corrections (n) », correctionsListHTML() lirait « autoload|<terminal> » comme commodité/terminal/
// side et rendrait une correction « vente » vide, et « Tout réinitialiser » les effacerait sans le
// dire. S'y ajoutent deux incompatibilités de fond : setInStore arrondit à l'entier (un k de 1,41
// deviendrait 1) et effValue périme une correction dès qu'UEX republie le point, alors qu'un tarif
// de manutention n'a aucune date UEX de référence et n'a donc aucune raison de périmer.
export const alKey = (terminal: string): string => `autoload|${terminal}`;
export function loadAutoloadK(): void { try { etat.AUTOLOAD_K = JSON.parse(localStorage.getItem(AUTOLOAD_KEY)) || {}; } catch { etat.AUTOLOAD_K = {}; } }
export function saveAutoloadK(): void { try { localStorage.setItem(AUTOLOAD_KEY, JSON.stringify(etat.AUTOLOAD_K)); } catch {} }

// Coefficient global, appliqué à toute station non relevée. Une saisie vide ou absurde retombe sur
// le défaut : `Number("")` vaut 0, et un k nul annulerait silencieusement tous les frais.
// Le coefficient global vit dans le champ `#alk` : c'est là qu'est sa vérité, comme pour les
// quatorze filtres. Une saisie vide ou absurde retombe sur le défaut — `Number("")` vaut 0, et un
// k nul annulerait silencieusement tous les frais.
export const globalK = (): number => {
  const champ = document.getElementById("alk") as HTMLInputElement | null;
  const v = Number(champ?.value);
  return v > 0 ? v : K_DEFAULT;
};
export const kFor = (terminal: string): number => {
  const o = etat.AUTOLOAD_K[alKey(terminal)] as { k?: number } | undefined;
  return o && o.k != null && o.k > 0 ? o.k : globalK();
};

// Ce qu'UNE extrémité facture. `point` est ce que consomme logic.mjs ; les autres champs servent à
// EXPLIQUER le chiffre à l'écran — « cette station ne propose pas l'autoload » et « UEX ne nous a
// pas dit si elle le propose » aboutissent au même 0 mais ne se racontent pas pareil, et aucun des
// deux ne doit se lire comme un frais oublié.
function feeEnd(name: string, terminal: Terminal | null | undefined) {
  const t = terminal || termByName.get(name) || null;
  const k = kFor(name);
  return {
    name, k, point: autoloadPoint(t, k),
    known: !!t && t.autoload != null, // champ absent = instantané de market.json antérieur au build
    available: !!t && t.autoload === true,
    maxBox: t ? t.maxBox : undefined,
    measured: !!etat.AUTOLOAD_K[alKey(name)],
  };
}

// Contexte de frais d'un chargement A -> B. `null` dès que l'interrupteur est inactif, et c'est
// littéralement ce que « inactif » veut dire pour tout le moteur : sans contexte, chaque fonction
// de logic.mjs rend exactement les valeurs brutes qu'elle rendait avant que les frais n'existent.
export function feeCtx(f: { autoload?: boolean }, buyName: string, sellName: string, buyT?: Terminal | null, sellT?: Terminal | null) {
  if (!f.autoload) return null;
  // Marché pas encore chargé (premier rendu de « Trajets » / « Boucles ») : aucun terminal n'est
  // résolvable, donc aucun frais n'est calculable. On rend le brut SANS marqueur — prétendre
  // « aucune de ces stations ne facture » serait faux — et ensureFeeMarket re-rend à l'arrivée.
  if (!buyT && !sellT && !termByName.size) return null;
  const a = feeEnd(buyName, buyT), b = feeEnd(sellName, sellT);
  return { a, b, pair: { buy: a.point, sell: b.point } };
}

// Résolveur passé aux fonctions de logic.mjs qui parcourent le marché : elles découvrent leurs
// terminaux en chemin et n'ont donc aucun nom à nous donner d'avance.
export const feeResolver = (f: { autoload?: boolean }) => (f.autoload ? (t) => autoloadPoint(t, kFor(t && t.name)) : null);

// Un montant qui incorpore des frais d'autoload est une ESTIMATION : la formule colle aux 18
// relevés à 2,8 % près, et `k` varie de 40 % entre les deux seules stations mesurées. Le « ≈ » le
// dit, partout où le chiffre a été amputé.
export const kFmt = (k: number): string => k.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const kText = (e: { k: number; measured: boolean }): string => `×${kFmt(e.k)} ${e.measured ? "(relevé)" : "(k global)"}`;
export function feeEndText(e: ReturnType<typeof feeEnd>): string {
  if (!e.known) return `${e.name} : autoload inconnu (donnée UEX absente) — rien facturé`;
  if (!e.available) return `${e.name} : pas d'autoload — rien facturé`;
  return `${e.name} ${kText(e)}`;
}
// Décrit la manutention facturée, et avec quelle formule : l'infobulle doit permettre de REFAIRE le
// calcul, sinon elle explique un montant qu'elle contredit. D'où deux textes, parce qu'il y a deux
// facturations — une transaction pour un chargement à une commodité, une PAR commodité au-delà
// (hypothèse 2 de la spec), et autant de fois la base de 150.
const FEE_FORMULA = `${AUTOLOAD.base} + ${AUTOLOAD.perBox}/caisse + ${AUTOLOAD.perScu}/SCU`;
const boxCount = (boxes: { count: number }[]): number => boxes.reduce((a, b) => a + b.count, 0);
export function feeLoadText(scu: number, maxBox?: number): string {
  const n = boxCount(scuBoxes(scu, maxBox));
  return `${fmt(scu)} SCU en ${n} caisse${n > 1 ? "s" : ""}, chargement + déchargement · ${FEE_FORMULA} par opération`;
}
// Chargement MULTI-commodité : les caisses se comptent ligne par ligne (une caisse = une commodité)
// et la base est facturée par commodité. Décrire le total en une seule opération annonçait un
// nombre de caisses et une formule qui ne redonnaient pas le montant déduit.
export function feeCargoText(lines: LigneManifeste[], maxBox?: number): string {
  const n = boxCount(cargoBoxes(lines, maxBox));
  const scu = lines.reduce((a, l) => a + (l.units || 0), 0);
  const p = lines.length;
  return `${fmt(scu)} SCU en ${n} caisse${n > 1 ? "s" : ""} sur ${p} commodité${p > 1 ? "s" : ""}, chargement + déchargement · ${FEE_FORMULA} par commodité et par opération`;
}

// Infobulle + marqueur d'une cellule de profit soumise aux frais. `what` décrit la manutention et
// n'est appelée que si elle sert : l'interrupteur inactif est le cas courant, et ce chemin est
// parcouru une fois par ligne de tableau.
// `bounded` = la route a un volume : sans volume aucun frais n'est calculable (le profit est déjà
// « — »), et rien ne doit laisser croire à un oubli. Quand l'interrupteur est actif mais qu'aucune
// des deux stations ne facture, l'infobulle DIT pourquoi et un ⊘ discret le signale — un profit
// resté brut au milieu d'une colonne nette, sans un mot, se lit comme un bug. Le marqueur ne va que
// sur la colonne « profit » : le répéter sur « profit/heure » doublerait le bruit sans rien ajouter.
const CELLULE_SANS_FRAIS: CelluleFrais = { mark: "", text: "" };
export function feeCell(ctx: ReturnType<typeof feeCtx>, fees: number, what: () => string, bounded: boolean): CelluleFrais {
  if (!ctx || !bounded) return CELLULE_SANS_FRAIS;
  const text = fees > 0
    ? `Frais d'autoload ≈ ${fmt(fees)} aUEC déduits — ${what()} · ${feeEndText(ctx.a)} · ${feeEndText(ctx.b)} · estimation ±3 %`
    : `Aucun frais d'autoload sur ce trajet — ${feeEndText(ctx.a)} · ${feeEndText(ctx.b)}`;
  return { mark: fees > 0 ? "" : ' <span class="nofee">⊘</span>', text };
}
// Frais et profit NET d'une ligne de manifeste. Hypothèse 2 de la spec : une transaction PAR
// COMMODITÉ, donc chaque ligne paie sa propre base — sans quoi la somme des lignes affichées ne
// ferait pas le total affiché, l'incohérence la plus visible qui soit. Le décompte des opérations
// vit dans logic.mjs (lineHaulFee), qui sait qu'une ligne « vend ailleurs » n'est pas déchargée et
// qu'une ligne « acquis ailleurs » n'a pas été chargée : c'est la MÊME règle que manifestTotals,
// donc le total et les lignes ne peuvent pas diverger.
// `lineNet` vit dans logic.mjs : c'est une règle de décision (elle filtre les suggestions et le
// manifeste optimal), pas un détail de rendu. Signe compris — un net négatif se dit.
// Préfixe un montant de son signe RÉEL. Un « + » posé d'office écrivait « +-1 234 » dès que les
// frais mangeaient la marge, en vert, sur le seul chiffre qui disait de ne pas charger la ligne.
// Texte de la cellule « profit » d'une ligne de manifeste. Partagé par le premier rendu et par la
// mise à jour en direct : deux conventions différentes et éditer une quantité changerait le sens
// de la cellule. Une ligne « vend ailleurs » n'a pas de profit sur ce trajet — elle a quand même
// été chargée, et ce chargement, lui, est bien retranché du total.
export function lineProfitText(units: number, l: LigneManifeste, pair: PaireFrais | null): string {
  const fees = lineHaulFee(units, l, pair);
  if (l.sellPrice == null) return fees > 0 ? fmtFee(-fees, fees) : "—";
  const net = lineNet(units, l, pair);
  return signe(net, fmtFee(net, fees));
}

