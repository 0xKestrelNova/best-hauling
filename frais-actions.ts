// Relever un tarif d'autoload : l'ACTION (ADR-012).
//
// Miroir exact de la paire `corrections.ts` / `corrections-actions.ts`, et pour la même raison.
// `frais.ts` déclare en tête qu'il ne peint rien : `feeResolver` est passée dix fois aux fonctions
// du moteur, elle ne peut pas traîner un `confirm()` ni un toast derrière elle. Ici on est de
// l'autre côté — un geste de l'utilisateur, une fois.
//
// ── UN RELEVÉ EST UNE MESURE, PAS UN RÉGLAGE ──────────────────────────────────────────────────
// On persiste le montant et la quantité OBSERVÉS en plus du coefficient `k` qu'on en tire. C'est
// la mesure qui fait foi ; `k` n'en est que la lecture. Si la grille de tarifs change à un patch,
// un relevé conservé reste réinterprétable — un `k` seul serait devenu illisible.
import {
  caissesDe, kFromReading, kPlausible, nombreDeCaisses, tailleRetenue, tempsPlausible, TEMPS_PLAUSIBLE_MAX,
} from "./logic.ts";
import type { ReleveTemps, Terminal } from "./types.ts";
import { etat } from "./etat.ts";
import { dureeTexte, fmt } from "./format.ts";
import { alKey, kFmt, saveAutoloadK, saveAutoloadT, tempsDe } from "./frais.ts";
import { indexStationExacte } from "./marche.ts";
import { showToast } from "./messages.ts";
import { rafraichir } from "./rendu.ts";

const nombre = (id: string): number =>
  Number((document.getElementById(id) as HTMLInputElement | null)?.value);

/**
 * Enregistre un relevé pour la station affichée, d'après les deux champs du panneau de frais.
 *
 * Elle LIT le DOM plutôt que de recevoir des props, et c'est un contrat : les deux `<input>` sont
 * rendus non contrôlés (`defaultValue`) par `vues/frais-station.tsx`, dont la `key` porte le relevé
 * lui-même. Les « contrôler » en poussant leur valeur ferait qu'un changement de station
 * persisterait la mesure de la PRÉCÉDENTE.
 */
export function enregistrerReleve(): void {
  const S = indexStationExacte();
  if (S == null) return;
  const t = etat.MARKET!.terminals[S];
  const montant = nombre("alAmount");
  const scu = Math.floor(nombre("alScu"));
  // La taille EMPLOYÉE, pas celle qu'on suppose (ADR-014). Devinée au plafond du comptoir, elle met
  // un découpage supposé au dénominateur : le relevé d'Endgame (720 aUEC, 24 SCU, 3 caisses de 8)
  // rendait k = 1,091 à la station qui DÉFINIT k = 1. Le champ est prérempli, donc jamais vide ;
  // le repli sur `t.maxBox` ne couvre que le cas où la vue n'aurait pas rendu le champ.
  //
  // Passée par `tailleRetenue` AVANT d'être persistée : le calcul, lui, y passe de toute façon
  // (`caissesDe`). Persister la saisie brute ferait qu'un « 20 » tapé à la main s'afficherait
  // « caisses de 20 SCU » sous un k calculé sur des caisses de 16 — le relevé mentirait sur sa
  // propre mesure, ce que ce champ existe précisément pour empêcher.
  const taille = tailleRetenue(Math.floor(nombre("alBox")) || t.maxBox);
  const k = kFromReading(montant, scu, taille);
  if (k == null) { showToast("⚠ Relevé inutilisable — indique le montant payé et la quantité chargée"); return; }
  // Un montant tapé à côté (un zéro de trop) donne un k d'apparence honnête, qu'on persiste et
  // qu'on réaffiche « (relevé) » — il se lit alors comme une mesure fiable tout en multipliant les
  // frais de cette station dans toutes les vues. Hors des bornes plausibles on DEMANDE, on ne
  // refuse pas : un relevé surprenant reste une mesure, et c'est l'utilisateur qui l'a faite.
  // Le message montre le montant tel qu'il a été compris et le compare aux deux tarifs connus :
  // sans ce repère, « k = 1 413 » ne dit pas à quel point c'est absurde.
  if (!kPlausible(k) && !confirm(
    `${fmt(montant)} aUEC pour ${fmt(scu)} SCU à ${t.name}, c'est ×${kFmt(k)} le tarif d'Endgame.\n` +
    `Les deux seules stations mesurées valent ×1 et ×1,4. Un zéro de trop ?\n\nEnregistrer ce relevé quand même ?`
  )) return;
  etat.AUTOLOAD_K[alKey(t.name)] = { k, amount: montant, scu, taille };
  saveAutoloadK();
  rafraichir();
}

// ── Chronométrer un chargement (#192) ─────────────────────────────────────────────────────────
// Le jeu ne publie aucune durée : mesuré sur 158 journaux, `autoLoading` n'est qu'un DRAPEAU de la
// requête d'achat, et rien ne marque le début ou la fin du chargement. La durée se chronomètre donc
// à la main, ici, avec le temps de réaction que ça implique — et c'est une raison de plus pour
// n'afficher que des moyennes assorties de leur dispersion.

/** La station affichée, ou null. Les trois gestes ci-dessous en dépendent tous. */
function stationAffichee(): Terminal | null {
  const S = indexStationExacte();
  return S == null ? null : etat.MARKET!.terminals[S];
}

/** Ajoute un chronométrage à la station affichée. La quantité et la taille de caisse viennent des
 *  champs du panneau — ce sont ceux du MÊME chargement, celui qu'on est en train d'observer. */
function ajouterTemps(t: Terminal, secondes: number): void {
  const scu = Math.floor(nombre("alScu"));
  const taille = tailleRetenue(Math.floor(nombre("alBox")) || t.maxBox);
  const s = Math.round(secondes);
  if (!(s > 0) || !(scu > 0)) {
    showToast("⚠ Chronométrage inutilisable — indique la durée et la quantité chargée");
    return;
  }
  if (!tempsPlausible(s) && !confirm(
    `${dureeTexte(s)} pour ${fmt(scu)} SCU à ${t.name}, c'est plus d'une heure de chargement.\n` +
    `Un chronomètre oublié en route ?\n\nEnregistrer ce relevé quand même ?`
  )) return;
  // `caisses` est DÉRIVÉ ici et persisté quand même : c'est lui que la forme candidate du modèle
  // met en facteur, et le recalculer plus tard supposerait que `tailleRetenue` n'a pas bougé.
  const releve: ReleveTemps = {
    s, scu, taille, caisses: nombreDeCaisses(caissesDe(scu, taille)),
    at: Math.round(Date.now() / 1000),
  };
  etat.AUTOLOAD_T[alKey(t.name)] = [...tempsDe(t.name), releve];
  saveAutoloadT();
  rafraichir();
}

/** Enregistre une durée SAISIE À LA MAIN, pour qui a chronométré de son côté. */
export function enregistrerTemps(): void {
  const t = stationAffichee();
  if (t) ajouterTemps(t, nombre("alSec"));
}

/** Démarre le chronomètre. Un seul à la fois : on ne charge qu'à un comptoir. */
export function demarrerChrono(): void {
  const t = stationAffichee();
  if (!t) return;
  etat.CHRONO = { terminal: t.name, debut: Date.now() };
  saveAutoloadT();
  rafraichir();
}

/** Arrête le chronomètre ET enregistre la mesure. Contrairement au tarif — où un zéro de trop est
 *  l'accident courant — la durée est mesurée par l'application elle-même : la faire re-valider
 *  n'ajouterait aucune sécurité, et coûterait un clic au moment où l'utilisateur est encore en jeu.
 *  Une mesure ratée s'oublie d'un ✕, comme un relevé de tarif. */
export function arreterChrono(): void {
  const c = etat.CHRONO;
  if (!c) return;
  const secondes = (Date.now() - c.debut) / 1000;
  etat.CHRONO = null;
  const t = stationAffichee();
  // Le chrono a pu démarrer à une station et s'arrêter alors qu'on en regarde une autre. C'est la
  // station DE DÉPART qui compte : c'est elle qui a chargé. On ne persiste donc rien si elle n'est
  // plus affichée — un temps rangé sous le mauvais comptoir serait pire que pas de temps du tout.
  if (t && t.name === c.terminal) ajouterTemps(t, secondes);
  else { saveAutoloadT(); showToast(`⚠ Chrono arrêté hors de ${c.terminal} — rien n'a été enregistré`); rafraichir(); }
}

/** Abandonne le chronomètre en cours, sans rien enregistrer. */
export function annulerChrono(): void {
  if (!etat.CHRONO) return;
  etat.CHRONO = null;
  saveAutoloadT();
  rafraichir();
}

/** Oublie UN chronométrage, par sa clé et son rang dans la liste. */
export function oublierTemps(cle: string, rang: number): void {
  const liste = (etat.AUTOLOAD_T[cle] as ReleveTemps[] | undefined) || [];
  if (!liste[rang]) return;
  const reste = liste.filter((_, i) => i !== rang);
  if (reste.length) etat.AUTOLOAD_T[cle] = reste;
  else delete etat.AUTOLOAD_T[cle];      // une station sans mesure ne doit pas rester dans le store
  saveAutoloadT();
  rafraichir();
}

/** Oublie TOUS les chronométrages. Le `confirm()` passe avant la moindre écriture. */
export function oublierTousLesTemps(): void {
  if (!Object.keys(etat.AUTOLOAD_T).length) return;
  if (!confirm("Oublier tous tes chronométrages d'autoload ?")) return;
  etat.AUTOLOAD_T = {};
  etat.CHRONO = null;
  saveAutoloadT();
  rafraichir();
}

/** Oublie UN relevé, par sa clé. */
export function oublierReleve(cle: string): void {
  delete etat.AUTOLOAD_K[cle];
  saveAutoloadK();
  rafraichir();
}

/** Oublie TOUS les relevés. Le `confirm()` passe avant la moindre écriture : annuler n'écrit rien. */
export function oublierTousLesReleves(): void {
  if (!Object.keys(etat.AUTOLOAD_K).length) return;
  if (!confirm("Oublier tous tes relevés de tarif d'autoload ?")) return;
  etat.AUTOLOAD_K = {};
  saveAutoloadK();
  rafraichir();
}
