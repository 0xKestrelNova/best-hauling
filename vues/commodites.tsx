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
import { TEXTE_CAPACITE_INCONNUE, fmt, fmtVol } from "../format.ts";
import type { ResumeCommodite } from "../types.ts";
import { IconeCommodite, TagIllegal, BadgeSysteme } from "./communs.tsx";

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
  /** La classe de heatmap : elle diffère selon le board — rang en Butin, ratio à la marge max du
   *  board entier en Marché. La vue la fournit, la présentation ne connaît ni l'une ni l'autre. */
  palier: (c: ResumeCommodite) => string;
  valeurCompacte: (n: number) => string;
  /** Choisir une tuile. C'était une délégation posée sur `#commGrid` : la tuile est un vrai
   *  `<button>`, elle porte donc son propre geste depuis que la vue vit dans l'arbre. */
  choisir: (nom: string) => void;
};

function Tuile({ c, butin, selection, transportees, codesAmbigus, palier, valeurCompacte, choisir }: {
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
    <button className={classes} data-name={c.name} title={title} onClick={() => choisir(c.name)}>
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

// ── Le panneau de DÉTAIL ───────────────────────────────────────────────────────────────────────
// Il était resté en vanilla à la PR précédente parce qu'il rend des `.editv`, que `startEdit`
// mutait impérativement. `ValeurEditable` (communs.tsx) lève cet obstacle : l'édition passe
// désormais par l'état React, et les deux délégations d'app.js ignorent ces nœuds.
import { ValeurEditable, PastilleStatut, PastilleFraicheur, TagAvantPoste } from "./communs.tsx";
import type { DetailCommodite, PointAchatCommodite, PointVenteCommodite } from "../types.ts";

export type ProprietesDetail = {
  points: DetailCommodite;
  /** Le nom de la commodité, porté par `data-c` sur chaque valeur éditable. */
  nomCommodite: string;
  butin: boolean;
  /** Une correction locale porte-t-elle déjà sur ce point ? */
  estCorrige: (terminal: string, cote: "buy" | "sell", champ: "price" | "vol") => boolean;
  /** app.js écrit la correction — il sait figer les jambes, mettre le compteur à jour et re-rendre. */
  corriger: (terminal: string, cote: "buy" | "sell", champ: "price" | "vol", valeur: string, releve: number) => void;
  legendeAchat: Record<number, [string, string]>;
  legendeVente: Record<number, [string, string]>;
};

function LignePoint({ p, cote, ...r }: { p: PointAchatCommodite | PointVenteCommodite; cote: "buy" | "sell" } & Omit<ProprietesDetail, "points" | "butin">) {
  // Le champ de volume porte un NOM différent selon le côté — `stock` à l'achat, `demand` à la
  // vente — et c'est voulu : ce ne sont pas la même chose. `demand: null` veut dire « capacité
  // inconnue chez UEX », ni zéro ni illimitée.
  const volume = cote === "buy"
    ? (p as PointAchatCommodite).stock
    : (p as PointVenteCommodite).demand;
  const cellule = (champ: "price" | "vol", valeur: number | null | undefined) => (
    <ValeurEditable
      valeur={valeur ?? null}
      commodite={r.nomCommodite} terminal={p.terminal} cote={cote} champ={champ} releve={p.updated}
      corrige={r.estCorrige(p.terminal, cote, champ)}
      onCorriger={(v) => r.corriger(p.terminal, cote, champ, v, p.updated)}
    />
  );
  return (
    <tr>
      <td className="loc">
        <div>{p.terminal}<BadgeSysteme system={p.system} /><TagAvantPoste outpost={p.outpost} /></div>
        <div className="loc-sub">{p.planet}</div>
      </td>
      <td className="num">{cellule("price", p.price)}</td>
      {/* L'espace entre la pastille et la valeur est LITTÉRAL dans la version d'origine, et il
          subsiste seul quand le code de statut est absent. Reproduit tel quel. */}
      <td className="num">
        <PastilleStatut code={p.status} cote={cote}
                        legende={cote === "buy" ? r.legendeAchat : r.legendeVente} />
        {" "}
        {cellule("vol", volume)}
      </td>
      <td><PastilleFraicheur updated={p.updated} /></td>
    </tr>
  );
}

function TablePoints({ lignes, entete, cote, ...r }: {
  lignes: (PointAchatCommodite | PointVenteCommodite)[]; entete: string; cote: "buy" | "sell";
} & Omit<ProprietesDetail, "points" | "butin">) {
  if (!lignes.length) return <p className="muted">Aucun point.</p>;
  return (
    <table className="comm-points">
      <thead><tr><th>Terminal</th><th className="num">Prix</th><th className="num">{entete}</th><th>Relevé</th></tr></thead>
      <tbody>{lignes.map((p, i) => <LignePoint key={i} p={p} cote={cote} {...r} />)}</tbody>
    </table>
  );
}

export function VueDetailCommodite({ points: p, butin, ...r }: ProprietesDetail) {
  const meilleur = p.sells[0];
  return (
    <>
      <div className="comm-detail-head">
        <IconeCommodite kind={p.kind} />
        <span className="comm-detail-title">
          {p.code ? <><b className="comm-code">{p.code}</b> · </> : null}
          {p.name}<TagIllegal illegal={p.illegal} />
        </span>
        {/* La valeur de revente n'existe QU'en mode Butin : quand l'acquisition est gratuite, la
            marge n'a pas de sens, seul compte le prix au SCU. */}
        {butin ? (
          meilleur
            ? <span className="loot-value"><b>{fmt(meilleur.price)}</b> aUEC/SCU<span className="loot-where">au mieux — {meilleur.terminal} ({meilleur.system})</span></span>
            : <span className="loot-value muted">aucun point de vente</span>
        ) : null}
      </div>
      <div className={butin ? "comm-cols one" : "comm-cols"}>
        {butin ? null : (
          <div className="comm-col">
            <h4>◈ Où acheter <span className="muted">({p.buys.length} · moins cher d'abord)</span></h4>
            <TablePoints lignes={p.buys} entete="Stock" cote="buy" {...r} />
          </div>
        )}
        <div className="comm-col">
          <h4>◈ Où {butin ? "l'écouler" : "vendre"} <span className="muted">({p.sells.length} · mieux payé d'abord)</span></h4>
          <TablePoints lignes={p.sells} entete="Demande" cote="sell" {...r} />
        </div>
      </div>
    </>
  );
}

export const vueDetailCommodite = (p: ProprietesDetail) => <VueDetailCommodite {...p} />;

export const inviteDetail = (butin: boolean) => (
  <p className="manifest-hint">
    {butin
      ? "Sélectionne une commodité pour savoir combien elle vaut au SCU et où l'écouler."
      : "Sélectionne une commodité (ligne du tableau ou champ « Commodité ») pour voir tous ses points d'achat et de vente."}
  </p>
);
