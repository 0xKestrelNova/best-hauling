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
import { TEXTE_CAPACITE_INCONNUE, fmtVol } from "../format.ts";
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

// Le POINT de fraîcheur — à ne pas confondre avec la pastille ci-dessus. Celle-ci porte son
// libellé et sert les tableaux ; celui-là est un simple rond coloré, sans texte, posé devant un nom
// de commodité dans le compagnon de voyage, où la place manque. Deux classes, deux rendus, et les
// seuils diffèrent aussi : le point n'a pas de cas « moins d'un jour » séparé.
export function PointFraicheur({ updated }: { updated: number }) {
  const d = ageDays(updated);
  if (d == null) return <span className="fresh-dot f-old" title="Fraîcheur des données inconnue" />;
  const label = d < 1 ? (d < 1 / 24 ? "moins d'1 h" : Math.round(d * 24) + " h") : Math.round(d) + " j";
  const cls = d < 3 ? "f-good" : d < 7 ? "f-ok" : "f-old";
  return <span className={"fresh-dot " + cls} title={"Relevé UEX il y a " + label} />;
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

// ── L'édition sur place ────────────────────────────────────────────────────────────────────────
// Le pendant React d'`editv` + `startEdit` (app.js). C'était le dernier mécanisme qui empêchait de
// migrer une vue : `startEdit` MUTE le nœud (`span.replaceChildren(inp)`) depuis une délégation
// posée sur `document`, et un nœud possédé par React et muté hors de React, c'est la seule
// situation où les deux modèles se contredisent vraiment.
//
// Ici l'édition passe par l'ÉTAT, pas par la mutation — ce qui rend gratuit ce que la version
// impérative devait organiser : elle mémorisait les enfants détachés pour pouvoir annuler sans
// re-rendu global. React n'a qu'à repasser `enEdition` à false.
//
// TROIS COMPORTEMENTS À PRÉSERVER, chacun payé par un bug du dépôt :
//   1. CONSULTER n'écrit rien. Sans la comparaison de valeur, cliquer un chiffre puis cliquer
//      ailleurs créait une correction locale IDENTIQUE au relevé UEX — compteur, marqueur ✎, et
//      plus tard un toast « correction périmée » à propos d'une correction fantôme.
//   2. ANNULER ne re-rend pas globalement. Un refresh() détruirait le nœud entre le mousedown et
//      le mouseup, ce qui avalait le clic suivant sur une autre cellule.
//   3. Le `✎` reste DANS le span. Le sortir casserait la restauration (#30, cf. app.js).
import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";

export type ProprietesValeurEditable = {
  valeur: number | null;
  /** Les quatre `data-*` du contrat e2e : plusieurs tests visent une cellule PRÉCISE par
   *  `[data-c][data-s][data-f]`, et lisent sa valeur dans `data-v`. Ce sont eux qui identifient un
   *  chiffre parmi les 92 tuiles d'une station — les omettre rend ces tests inécrivables. */
  commodite: string;
  terminal: string;
  cote: "buy" | "sell";
  champ: "price" | "vol";
  /** Date UEX du point, mémorisée comme base de fraîcheur de la correction. */
  releve: number;
  /** true quand une correction locale porte déjà sur ce point : le ✎ s'affiche. */
  corrige: boolean;
  /** Rend « n.c. » pour une capacité qu'UEX ne publie pas — ni zéro, ni illimitée. */
  /** Appelé UNIQUEMENT si la valeur a changé. app.js écrit alors la correction et re-rend. */
  onCorriger: (valeur: string) => void;
};

export function ValeurEditable({ valeur, commodite, terminal, cote, champ, releve, corrige, onCorriger }: ProprietesValeurEditable) {
  const [enEdition, setEnEdition] = useState(false);
  const saisie = useRef<HTMLInputElement>(null);
  const fini = useRef(false);

  useEffect(() => {
    if (enEdition && saisie.current) { saisie.current.focus(); saisie.current.select(); }
  }, [enEdition]);

  const inconnue = valeur == null || !Number.isFinite(Number(valeur));
  const v = inconnue ? "" : String(valeur);

  // OUVERTURE SYNCHRONE, et c'est un contrat, pas un raffinement. La version impérative faisait
  // `span.replaceChildren(inp)` — le champ existait dès le retour du gestionnaire. React, lui,
  // groupe les états et rend au tour suivant : le champ n'apparaîtrait qu'après.
  //
  // Quatorze tests dépendent de la première forme. Ils dispatchent un clic PROGRAMMATIQUE puis
  // lisent `span.querySelector("input")` dans la foulée — sans `flushSync`, ils lisent `null`.
  // Ce n'est pas un artefact de test : c'est le comportement que le dépôt a toujours eu, et le
  // rendre asynchrone le changerait pour tout appelant qui mesure le DOM juste après.
  const ouvrir = () => { fini.current = false; flushSync(() => setEnEdition(true)); };

  const clore = (enregistrer: boolean) => {
    if (fini.current) return;
    fini.current = true;
    const saisi = saisie.current ? saisie.current.value : v;
    // On sort de l'édition DANS TOUS LES CAS, et avant d'écrire. React réutilise l'instance du
    // composant au même emplacement : après `refresh()`, l'état local SURVIT au re-rendu, et le
    // champ resterait ouvert sur l'ancienne valeur. La version impérative n'avait pas ce problème —
    // elle recréait le DOM entier. Mesuré : sans cette ligne, la cellule corrigée gardait son
    // <input> et son ✎ n'apparaissait jamais.
    setEnEdition(false);
    // Comportement 1 : rien n'a changé, rien ne s'écrit. Comportement 2 : l'annulation ne déclenche
    // aucun re-rendu global — sortir de l'édition suffit.
    if (enregistrer && saisi !== v) onCorriger(saisi);
  };

  if (enEdition) {
    return (
      <span className={"editv" + (inconnue ? " nc" : "") + (corrige ? " ov" : "")} data-react="1"
            data-c={commodite} data-t={terminal} data-s={cote} data-f={champ}
            data-v={inconnue ? "" : v} data-u={String(Number(releve) || 0)}>
        <input
          ref={saisie}
          type="number"
          min="0"
          defaultValue={v}
          className="editv-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); clore(true); }
            else if (e.key === "Escape") { e.preventDefault(); clore(false); }
          }}
          onBlur={() => clore(true)}
        />
      </span>
    );
  }

  return (
    // `data-react` fait que les deux délégations d'app.js (clic et clavier) passent leur chemin :
    // ce nœud gère son édition lui-même. Sans ce marqueur, `startEdit` viendrait le muter et React
    // écraserait la saisie au rendu suivant, sans savoir qu'elle avait eu lieu.
    <span
      className={"editv" + (inconnue ? " nc" : "") + (corrige ? " ov" : "")}
      data-react="1"
      data-c={commodite} data-t={terminal} data-s={cote} data-f={champ}
      data-v={inconnue ? "" : v} data-u={String(Number(releve) || 0)}
      role="button"
      tabIndex={0}
      title={inconnue ? `${TEXTE_CAPACITE_INCONNUE}. Clic pour le corriger localement` : "Clic pour corriger localement ce chiffre"}
      onClick={ouvrir}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); } }}
    >
      {fmtVol(valeur)}
      {corrige ? <span className="ovmark" title="Corrigé localement">✎</span> : null}
    </span>
  );
}

// Les deux LÉGENDES d'inventaire UEX, avec leurs couleurs officielles. Elles vivent ici, à côté de
// la pastille qui les lit : c'était la dernière donnée de présentation restée dans `app.js`, qui ne
// faisait que les repasser en props à deux vues. Une seule source, comme `KIND_ICON`.
export const BUY_STATUS: Record<number, [string, string]> = {
  1: ["Vide", "red"], 2: ["Très bas", "red"], 3: ["Bas", "orange"], 4: ["Moyen", "blue"],
  5: ["Élevé", "blue"], 6: ["Très élevé", "green"], 7: ["Plein", "green"],
};
export const SELL_STATUS: Record<number, [string, string]> = {
  1: ["Forte demande", "green"], 2: ["Bonne demande", "green"], 3: ["Demande correcte", "blue"],
  4: ["Demande moyenne", "blue"], 5: ["Demande faible", "orange"],
  6: ["Demande très faible", "red"], 7: ["Saturé (aucune demande)", "red"],
};

// La pastille de statut d'inventaire UEX. Elle rend RIEN quand le code est absent — et l'espace qui
// la sépare de la valeur reste alors seul en tête de cellule, comme dans la version d'origine.
export function PastilleStatut({ code, cote, legende }: {
  code: number; cote: "buy" | "sell"; legende: Record<number, [string, string]>;
}) {
  const s = legende[code];
  if (!s) return null;
  return <span className={"sdot s-" + s[1]} title={(cote === "buy" ? "Stock à l'achat" : "Demande à la vente") + " : " + s[0]} />;
}
