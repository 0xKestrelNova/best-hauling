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

import { encodeJourney, exporterCorrections, exporterEntrepots, manifestTotals } from "./logic.ts";
import { etat } from "./etat.ts";
import { readFilters } from "./filtres.ts";
import { fmt, fmtFee, scuBoxesLabel, signe } from "./format.ts";
import { lineProfitText } from "./frais.ts";
import { showToast } from "./messages.ts";
import { saveState, shareURL } from "./persistance.ts";
import { manifesteCourant } from "./manifeste-donnees.ts";
import { planData, planHypotheses } from "./vues/plan-vue.tsx";

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
