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
import { kFromReading, kPlausible } from "./logic.ts";
import { etat } from "./etat.ts";
import { fmt } from "./format.ts";
import { alKey, kFmt, saveAutoloadK } from "./frais.ts";
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
  const k = kFromReading(montant, scu, t.maxBox);
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
  etat.AUTOLOAD_K[alKey(t.name)] = { k, amount: montant, scu };
  saveAutoloadK();
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
