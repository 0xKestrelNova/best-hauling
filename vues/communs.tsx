// Les fragments de présentation partagés par plusieurs vues (refonte v2, ADR-008 #96).
//
// Ils existaient en tant que fonctions de app.js rendant des CHAÎNES HTML — `sysBadge`,
// `outpostTag`, `illegalTag`, `commodityIcon`, `freshChip`, `fiabiliteCell`. Chacune est courte et
// entièrement échappée ; les réécrire en composants ne demandait donc aucune décision de design,
// seulement de la transcription vérifiée.
//
// UNE SEULE SOURCE : `KIND_ICON` est exporté ICI et importé par app.js, qui a perdu sa copie. Le
// dupliquer aurait créé deux tables d'emoji vouées à diverger — et une divergence d'emoji ne fait
// rougir aucun test.
//
// Ce qu'ils ne font PAS : lire une globale, ni décider. Le calcul reste dans logic.ts (d'où
// `ageDays` et `scoreBarWidth` viennent), et l'état reste dans app.js.
import { ageDays, scoreBarWidth } from "../logic.ts";

// Le badge de système. Sa classe porte le nom en minuscules — `.sys.pyro`, `.sys.stanton` — et
// c'est l'une des 29 classes que le dépôt n'écrit que par interpolation : elle doit sortir d'ici
// exactement pareil, sans quoi la couleur du système disparaît sans qu'un test le voie.
export const BadgeSysteme = ({ system }: { system: string }) => (
  <span className={"sys " + system.toLowerCase()}>{system}</span>
);

// L'espace qui précède ces deux marqueurs est SIGNIFICATIF : il séparait le nom du terminal dans
// les chaînes d'origine (`${esc(nom)}${outpostTag(...)}`), et le retirer collerait les mots.
export const TagAvantPoste = ({ outpost }: { outpost: boolean }) =>
  outpost ? <> <span className="outpost" title="Avant-poste : élévateur de fret parfois en panne">⚠ avant-poste</span></> : null;

export const TagIllegal = ({ illegal }: { illegal: boolean }) =>
  illegal ? <> <span className="illegal" title="Commodité illégale : contrebande, risque de scan">⛔ illégal</span></> : null;

// Icône emoji par catégorie de commodité. La classe `k-${kind}` porte la palette catégorielle des
// 12 familles (style.css) — c'est encore l'une des 29 classes interpolées.
export const KIND_ICON: Record<string, string> = {
  metal: "🔩", alloy: "⛓️", mineral: "💎", raw: "⛏️", nonmetal: "🪨",
  gas: "💨", halogen: "⚗️", fuel: "⛽",
  agricultural: "🌾", food: "🍎", natural: "🌿", organic: "🧬",
  drug: "☠️", vice: "🍸", medical: "⚕️",
  scrap: "♻️", waste: "🗑️", manmade: "⚙️", explosive: "💥",
  temporary: "⏳", other: "📦",
};

export const IconeCommodite = ({ kind }: { kind: string | null | undefined }) => {
  const k = kind || "other";
  return <span className={"cicon k-" + k} title={k}>{KIND_ICON[k] || KIND_ICON.other}</span>;
};

// Pastille de fraîcheur du relevé UEX. Le seuil est le même que dans app.js : moins d'un jour →
// bon, moins de trois → bon, moins de sept → correct, au-delà → vieux.
export function PastilleFraicheur({ updated }: { updated: number }) {
  const d = ageDays(updated);
  if (d == null) return <span className="fresh f-old" title="Date de relevé inconnue">?</span>;
  let cls: string, label: string;
  if (d < 1) { cls = "f-good"; label = d < 1 / 24 ? "<1 h" : Math.round(d * 24) + " h"; }
  else { label = Math.round(d) + " j"; cls = d < 3 ? "f-good" : d < 7 ? "f-ok" : "f-old"; }
  return <span className={"fresh " + cls} title={"Relevé UEX il y a " + label}>{label}</span>;
}

// La cellule de fiabilité. Elle N'ENTRE PAS DANS LE TRI, et son title le dit — c'est une décision
// de l'ADR-005 : la fiabilité informe, elle ne classe pas.
export function CelluleFiabilite({ f, age, part }: { f: number; age: number | null; part: number }) {
  const tier = f >= 70 ? "s-good" : f >= 40 ? "s-ok" : "s-low";
  const quoi = age == null ? "date du relevé inconnue" : `relevé vieux de ${Math.round(age)} j`;
  const titre = `Fiabilité ${f}/100 — ${quoi}, ${Math.round(part * 100)} % du volume publié par UEX. N'entre pas dans le tri.`;
  return (
    <div className="score-cell" title={titre}>
      <span className={"scorebar " + tier}><i style={{ width: scoreBarWidth(f) + "%" }} /></span>
      <b>{f}</b>
    </div>
  );
}
