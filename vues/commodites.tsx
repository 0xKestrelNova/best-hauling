// La vue Commodités — sa GRILLE et son AIDE (ADR-008 #96). Quatrième îlot React.
//
// PÉRIMÈTRE VOLONTAIREMENT PARTIEL, et c'est la première fois de la migration. Le panneau de détail
// (#commDetail) reste en vanilla, parce qu'il rend des `.editv` : des valeurs éditables sur place
// que `startEdit` MUTE IMPÉRATIVEMENT (`span.replaceChildren(inp)`), depuis une délégation posée sur
// `document`. Un nœud possédé par React et muté hors de React, c'est la seule situation où les deux
// modèles se contredisent vraiment — React ne sait pas que le DOM a bougé sous lui.
//
// Ce n'est pas une difficulté propre à cette vue : `.editv` est TRANSVERSAL (Commodités,
// Corrections, Trajets). Il mérite sa propre décision plutôt qu'un contournement local, exactement
// comme `#empty` a été laissé à app.js lors de la migration de Boucles.
//
// Ce qui passe ici : #commGrid (le gros du rendu, une tuile par commodité) et #commHint (le texte
// d'aide, qui change avec le board).
import type { ResumeCommodite } from "../types.ts";

type Fmt = (n: number) => string;

export type ProprietesGrille = {
  lignes: ResumeCommodite[];
  /** "market" | "loot" — le board change la STRUCTURE, pas seulement des valeurs. */
  butin: boolean;
  selection: string | null;
  /** Les commodités transportées dans le voyage en cours, à surligner. */
  transportees: Set<string>;
  /** Les codes UEX qui désignent PLUSIEURS commodités : ils ne peuvent pas servir d'étiquette. */
  codesAmbigus: Set<string>;
  /** La classe de heatmap, calculée par app.js : elle diffère selon le board (rang en Butin,
   *  ratio à la marge max en Marché) et l'une des deux lit une globale. */
  palier: (c: ResumeCommodite) => string;
  valeurCompacte: (n: number) => string;
  fmt: Fmt;
};

function Tuile({ c, butin, selection, transportees, codesAmbigus, palier, valeurCompacte, fmt }: {
  c: ResumeCommodite;
} & Omit<ProprietesGrille, "lignes">) {
  const val = butin ? c.bestSell : c.margin;
  const transportee = transportees.has(c.name);

  const classes = [
    "comm-tile", palier(c),
    c.name === selection ? "selected" : "",
    c.illegal ? "illegal" : "",
    transportee ? "carried" : "",
    butin && c.sellOnly ? "sell-only" : "",
  ].filter(Boolean).join(" ");

  // Le title diffère ENTIÈREMENT selon le board — en Butin il omet « transportée dans ton voyage »
  // alors que la classe `carried` et le ◆ restent posés. Reproduit tel quel.
  const title = butin
    ? `${c.name}${c.illegal ? " (illégal)" : ""} — revente max ${fmt(c.bestSell)} aUEC/SCU · ${c.nSell} point(s) de vente${c.sellOnly ? " · introuvable à l'achat — butin / minage" : ""}`
    : `${c.name}${c.illegal ? " (illégal)" : ""}${transportee ? " — transportée dans ton voyage" : ""} — marge max ${fmt(c.margin)} aUEC/SCU · ${c.nBuy} achat(s) / ${c.nSell} vente(s)`;

  // Le code ne sert d'étiquette que s'il identifie SA commodité ; sinon on retombe sur le nom
  // (tronqué par CSS), seul moyen de distinguer deux tuiles qui partagent un code UEX. C'est aussi
  // pourquoi `code` ne peut JAMAIS servir de clé React — deux tuiles peuvent le partager.
  const etiquette = c.code && !codesAmbigus.has(c.code) ? c.code : c.name;

  return (
    <button className={classes} data-name={c.name} title={title}>
      <span className="tile-code">
        {transportee ? <span className="tile-carried" title="Dans ton voyage">◆</span> : null}
        {etiquette}
      </span>
      <span className="tile-val">{val == null ? "—" : valeurCompacte(val)}</span>
    </button>
  );
}

export function VueGrilleCommodites({ lignes, ...reste }: ProprietesGrille) {
  // PAS de wrapper autour de la liste : `.comm-grid` est un `display: grid`, et envelopper ses
  // enfants ferait de TOUT le board une seule cellule de grille. Le même piège a déjà cassé
  // `.chain-path` (flex) — ici il serait bien plus visible.
  return (
    <>
      {lignes.map((c) => (
        <Tuile key={c.name} c={c} {...reste} />
      ))}
    </>
  );
}

export const vueGrilleCommodites = (p: ProprietesGrille) => <VueGrilleCommodites {...p} />;

// ── L'aide du board ────────────────────────────────────────────────────────────────────────────
// Son texte est aussi DUPLIQUÉ en dur dans index.html (le rendu initial, avant que le marché
// n'arrive). Les deux doivent rester d'accord : le test ci-dessous n'existe pas, mais un écart se
// verrait à l'écran pendant la première seconde de chargement.
export const AIDE_MARCHE = (
  <>
    Le <b>board de marché</b> : chaque tuile = une commodité (code UEX) et sa <b>marge max</b>,
    colorée selon son intérêt. Clique une tuile — ou cherche via le champ <b>Commodité</b> — pour
    voir <b>tous ses points d'achat / vente</b> (stock, demande, prix) et surtout <b>où l'écouler</b>
    {" "}quand une station est saturée.
  </>
);

export const AIDE_BUTIN = (
  <>
    Tu as <b>trouvé</b> une ressource (minage, salvage, caisse abandonnée) ? Ce board liste{" "}
    <b>tout ce qui se vend</b>, y compris ce qui ne s'achète nulle part, avec son{" "}
    <b>prix de revente max</b> au SCU. Clique une tuile pour voir <b>où l'écouler</b>. Les tuiles en{" "}
    <b>pointillés</b> sont introuvables à l'achat.
  </>
);

export const aideBoard = (butin: boolean) => (butin ? AIDE_BUTIN : AIDE_MARCHE);
