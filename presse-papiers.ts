// EMPORTER CE QUI EST À L'ÉCRAN (ADR-012).
//
// Six gestes qui font tous la même chose : mettre un texte dans le presse-papiers et le dire par le
// bouton qui l'a demandé. Ils n'ont rien à voir avec une vue — ils lisent l'état et écrivent
// ailleurs — et ils vivaient dans `app.js` faute d'un endroit à eux.
//
// `copierTexte` mute le `textContent` du bouton pendant 1 500 ms pour dire « ✓ Copié ». Cinq de
// ces boutons sont rendus par React : la mutation est donc écrasée au prochain rendu, et c'est
// SANS CONSÉQUENCE tant qu'aucun rendu ne tombe dans la fenêtre — mais c'est la même famille que
// #45, et ça mérite d'être écrit noir sur blanc plutôt que découvert.

import { exporterCorrections, exporterEntrepots, manifestTotals } from "./logic.ts";
import { etat } from "./etat.ts";
import { readFilters } from "./filtres.ts";
import { fmt, fmtFee, scuBoxesLabel, signe } from "./format.ts";
import { lineProfitText } from "./frais.ts";
import { showToast } from "./messages.ts";
import { saveState, shareURL } from "./persistance.ts";
import { manifesteCourant } from "./manifeste-donnees.ts";
import { planData, planHypotheses } from "./vues/plan-vue.tsx";

import type { Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. `e.target` est un `EventTarget` : il n'a ni `closest`, ni
// `classList`, ni `id`. Le cast est posé UNE fois par module, comme `$` — pas dans un module
// partagé : c'est une expression d'une ligne, et six modules couplés à un alias ne valent pas
// l'économie (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;
/** La même, quand le code a déjà établi que la cible est un champ (garde par `id` ou par classe). */
const champ = (e: Event) => e.target as HTMLInputElement;


const nowSec = () => Math.floor(Date.now() / 1000);
const bouton = (id) => document.getElementById(id);
const chargementCourant = () => { const r = manifesteCourant(readFilters()); return r.etat === "ok" ? r.m : null; };

export function copierTexte(texte, btn, libelle) {
  const copie = navigator.clipboard?.writeText(texte);
  if (!copie) { showToast("⚠ Presse-papiers indisponible — copie impossible depuis cette page"); return; }
  copie.then(() => {
    if (!btn) return;
    btn.textContent = "✓ Copié";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = libelle; btn.classList.remove("copied"); }, 1500);
  }).catch(() => showToast("⚠ Presse-papiers refusé — la copie n'a pas eu lieu"));
}

export function copyManifest() {
  const m = chargementCourant();
  if (!m) return;
  const { profit, invest, scu, fees } = manifestTotals(m.lines, m.fee);
  const rows = m.lines.map(
    (l) => `${fmt(l.units)} SCU  ${l.name}  @ ${fmt(l.buyPrice)} -> ${fmt(l.sellPrice)}  (${lineProfitText(l.units, l, m.fee)} aUEC)  [${scuBoxesLabel(l.units, m.origin.maxBox)}]`
  );
  const text = [
    `Manifeste — ${m.origin.name} (${m.origin.system}) -> ${m.dest.name} (${m.dest.system})`,
    ...rows,
    `Total : ${fmt(scu)}/${fmt(m.cargo)} SCU · profit ${fmtFee(profit, fees)} aUEC · investissement ${fmt(invest)} aUEC` +
      (fees > 0 ? ` · frais d'autoload ≈ ${fmt(fees)} aUEC (estimation)` : ""),
  ].join("\n");
  copierTexte(text, bouton("copyManifest"), "⧉ Copier");
}

export function copierEntrepots() {
  copierTexte(exporterEntrepots(etat.DEPOTS, nowSec()), bouton("copyDepots"), "⧉ Copier");
}

export function copierPlan() {
  const d = planData();
  const lignes = [`Plan de vol — ${planHypotheses(d.f).join(" · ")}`];
  if (d.stations.length) {
    lignes.push(`Parcours : ${d.stations.map((s) => `${s.name} (${s.system})`).join(" → ")}`);
    d.jambes.forEach((j) => {
      lignes.push(`${j.i + 1}. ${j.from} → ${j.to}  ${fmt(j.scu)} SCU  ${signe(j.profit, fmtFee(j.profit, j.fees))} aUEC${j.courante ? "  <- ici" : ""}`);
      j.lines.forEach((l) => lignes.push(`     ${fmt(l.units)} SCU  ${l.name}`));
    });
  } else {
    lignes.push("Parcours : aucun voyage engagé.");
  }
  if (d.groupes.length) {
    lignes.push(`Soute : ${d.groupes.map((g) => `${fmt(g.units)} SCU ${g.name}`).join(" · ")}`);
    lignes.push(`        ${fmt(d.scu)} SCU à bord${d.libre != null ? ` · ${fmt(d.libre)} libres` : ""} · capital engagé ${fmt(d.invest)} aUEC`);
  }
  const n = etat.JOURNEY ? etat.JOURNEY.legs.length : 0;
  lignes.push(`Total : ${n} saut${n > 1 ? "s" : ""} · ${fmt(d.totalScu)} SCU · ${signe(d.totalProfit, fmtFee(d.totalProfit, d.totalFees))} aUEC`);
  copierTexte(lignes.join("\n"), bouton("planCopy"), "⧉ Copier le récapitulatif");
}

export function copierCorrections() {
  copierTexte(JSON.stringify(exporterCorrections(etat.OVERRIDES, nowSec()), null, 2), bouton("exportCorrections"), "⧉ Exporter");
}

export async function copyShareLink() {
  const str = saveState();
  const btn = bouton("share");
  try {
    await navigator.clipboard.writeText(shareURL(str));
    const prev = btn.textContent;
    const prevLabel = btn.getAttribute("aria-label");
    btn.textContent = "✓ Lien copié";
    // L'aria-label PRIME sur le contenu : sans ce miroir, le retour de copie n'existerait que pour
    // les voyants, le nom accessible restant figé sur « Partager — … ».
    btn.setAttribute("aria-label", "✓ Lien copié");
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.setAttribute("aria-label", prevLabel);
      btn.classList.remove("copied");
    }, 1500);
  } catch {
    // Presse-papiers indisponible (contexte non sécurisé) : on laisse l'URL dans la barre.
  }
}

/**
 * Branche les deux boutons de copie qui ne vivent pas dans une carte déjà déléguée.
 *
 * `#planCopy` passe par une délégation sur `#planHead` — le conteneur, pas le bouton : React le
 * repeint à chaque rendu, et un écouteur posé sur le bouton lui-même mourrait au premier. C'est le
 * précédent de la FRONTIÈRE (ADR-012 §2). `#share`, lui, est un bouton statique du rail.
 */
export function brancherPressePapiers() {
  document.getElementById("planHead").addEventListener("click", (e) => {
    if (cible(e).closest("#planCopy")) copierPlan();
  });
  document.getElementById("share").addEventListener("click", copyShareLink);
}
