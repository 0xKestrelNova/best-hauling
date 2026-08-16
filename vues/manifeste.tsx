// La carte « Manifeste » de la vue « En route », neuvième îlot React (ADR-008 #96).
//
// C'est la carte la plus IMPÉRATIVE du dépôt, et c'est pour ça qu'elle passe en dernier avant le
// compagnon de voyage. Trois mécanismes y écrivaient dans le DOM à la main :
//
//   1. `updateManifestTotals()` réécrivait `.mprofit`, `.mboxes` et `#manifestTot` À CHAQUE FRAPPE
//      dans un champ SCU — c'est-à-dire exactement le « app.js mute un nœud possédé par React »
//      que le garde `data-react` interdit depuis #113.
//   2. `marquerManifesteCompose()` injectait le ✎ et le bouton « ↺ optimal » par
//      `insertAdjacentHTML` DANS une carte déjà rendue.
//   3. `renderSuggestions()` réécrivait `#manifestSuggest`, un conteneur enfant de la carte.
//
// Tous les trois deviennent de l'ÉTAT : l'îlot lit `MANIFEST_EDIT` et `currentManifest.lines`, et
// un re-rendu suffit. Ce qui reste à app.js, c'est ce qui dépend de l'état global (le marché, les
// corrections, le parcours) et la persistance.
//
// LE CHAMP SCU RESTE NON CONTRÔLÉ (`defaultValue`), et c'est délibéré : React ne touche pas au
// `value` d'un champ non contrôlé au re-rendu, donc la frappe survit pendant que le profit, les
// caisses et les totaux se recalculent — le comportement exact de l'ancienne mise à jour en place.
// Le passer en contrôlé rendrait la valeur au rendu et déplacerait le curseur en fin de champ.
import { Fragment } from "react";
import { manifestTotals, lineHaulFee, lineNet, addableUnits, manifestJourneyState } from "../logic.ts";
import type {
  LigneManifeste, CandidatChargement, RestantManifeste, PaireFrais, Parcours,
} from "../types.ts";
import { BadgeSysteme, IconeCommodite, TagIllegal, ValeurEditable } from "./communs.tsx";

type Fmt = (n: number) => string;

/** Le contexte de manifeste tel qu'app.js le tient dans `currentManifest`. */
export type ContexteCarte = {
  lines: LigneManifeste[];
  cargo: number;
  aBord: number;
  cross: boolean;
  origin: { name: string; system: string; maxBox?: number };
  dest: { name: string; system: string };
  fee: PaireFrais | null;
  feeInfo: { a: unknown; b: unknown } | null;
};

export type ProprietesManifeste = {
  m: ContexteCarte;
  /** Bougée à chaque RECALCUL du manifeste, jamais à la frappe : elle remonte les champs SCU. */
  generation: number;
  /** `MANIFEST_EDIT != null` : le chargement a été composé à la main. */
  compose: boolean;
  /** Le parcours courant, pour savoir si ce chargement y est déjà. */
  parcours: Parcours | null;
  /** Les suggestions de remplissage, calculées par app.js (elles ont besoin du MARCHÉ). */
  suggestions: CandidatChargement[];
  /** L'espace et le budget qu'il reste — `manifestRemaining`, qui lit les filtres. */
  restant: RestantManifeste;
  fmt: Fmt;
  fmtVol: Fmt;
  fmtFee: (n: number, fees: number) => string;
  signe: (n: number, texte: string) => string;
  libelleCaisses: (units: number) => string;
  texteBoutFrais: (bout: unknown) => string;
  minutesTrajet: number;
  estCorrige: (commodite: string, terminal: string, cote: string, champ: string) => boolean;
  texteCapaciteInconnue: string;
  corriger: (commodite: string, terminal: string, cote: string, champ: string, valeur: string, releve: number) => void;
};

// ---------------------------------------------------------------------------------------------
// Les suggestions de remplissage. Partagées entre la carte et les jambes du compagnon de voyage :
// c'était `suggestionsHTML(m, addAttrs)`, dont le second argument posait un `data-leg` sur le
// bouton. Ici, `attributsAjout` joue le même rôle — la délégation qui lit `data-leg` ne bouge pas.
// ---------------------------------------------------------------------------------------------
export type ProprietesSuggestions = {
  suggestions: CandidatChargement[];
  restant: RestantManifeste;
  frais: PaireFrais | null;
  fmt: Fmt;
  fmtVol: Fmt;
  attributsAjout?: Record<string, string | number>;
};

export function Suggestions({ suggestions, restant, frais, fmt, fmtVol, attributsAjout = {} }: ProprietesSuggestions) {
  if (restant.cargoLeft <= 0) return null;
  const retenues = suggestions
    .map((it) => ({ it, u: addableUnits(it, restant) }))
    .filter((x) => x.u >= 1)
    // Frais actifs : une commodité dont la manutention mange la marge fait PERDRE de l'argent, et
    // le manifeste optimal l'écarte déjà (manifestsFrom). La proposer en tête, juste sous le
    // manifeste qui vient de la refuser, serait une contradiction à l'écran.
    .filter((x) => !frais || lineNet(x.u, x.it, frais) > 0)
    .slice(0, 6);

  if (!retenues.length)
    return (
      <div className="suggest-head">
        {fmt(restant.cargoLeft)} SCU libres — aucune autre commodité rentable vers cette destination.
      </div>
    );

  return (
    <>
      <div className="suggest-head">{`Remplir les ${fmt(restant.cargoLeft)} SCU libres — suggestions :`}</div>
      {retenues.map(({ it, u }) => (
        <div className="sline" key={it.name}>
          <IconeCommodite kind={it.kind} />
          <span className="mname">
            {it.name}
            <TagIllegal illegal={it.illegal} />
          </span>
          <span className="mstock">{`stock ${fmt(it.stock ?? 0)} · dem. ${fmtVol(it.demand ?? 0)}`}</span>
          <span className="mprice">{`${fmt(it.buyPrice)} → ${fmt(it.sellPrice ?? 0)} · marge ${fmt(it.margin)}`}</span>
          <button className="suggest-add" data-name={it.name} {...attributsAjout} title="Ajouter au manifeste">
            {`+ ${fmt(u)} SCU`}
          </button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Les totaux, en une phrase.
// ---------------------------------------------------------------------------------------------
function Totaux({ p, totaux }: { p: ProprietesManifeste; totaux: { profit: number; invest: number; scu: number; fees: number } }) {
  const { m, fmt, fmtFee } = p;
  const vides = m.cargo - totaux.scu;
  const profitHeure = (totaux.profit * 60) / p.minutesTrajet;
  // Les frais sont exposés à part plutôt que fondus dans le profit : c'est le seul moyen de voir
  // ce que coûte la manutention d'un chargement à plusieurs commodités (une base par ligne).
  const avecFrais = totaux.fees > 0;
  // `m.aBord` : la soute n'était pas vide, le manifeste ne remplit donc que la place restante. Le
  // dire ici évite de lire « 47/47 SCU » sur un vaisseau de 96 sans comprendre pourquoi.
  const avecBord = m.aBord > 0;

  // LES SÉPARATEURS SONT COLLÉS AU TEXTE QUI LES PRÉCÈDE, et ce n'est pas une coquetterie : le
  // gabarit produisait UN seul nœud de texte entre deux éléments, et le crénage ne traverse pas
  // une frontière de nœud. Écrire {" aUEC"}{" · "} au lieu de {" aUEC · "} coûtait 1/64 px sur la
  // largeur de la phrase — mesuré au relevé, et invisible pour toute autre vérification.
  const restant = (vides > 0 ? ` · ${fmt(vides)} SCU vides` : "")
    + ` · invest. ${fmt(totaux.invest)} · ~${fmtFee(profitHeure, totaux.fees)}/h`;

  return (
    <span className="manifest-tot" id="manifestTot">
      {"Profit "}
      <b className="profit">{fmtFee(totaux.profit, totaux.fees)}</b>
      {" aUEC · "}
      {avecFrais ? (
        <>
          <span
            className="fee-chip"
            title={m.feeInfo ? `${p.texteBoutFrais(m.feeInfo.a)} · ${p.texteBoutFrais(m.feeInfo.b)} · une transaction par commodité · estimation ±3 %` : ""}
          >
            {`frais ≈ ${fmt(totaux.fees)}`}
          </span>
          {" · "}
        </>
      ) : null}
      <b>{fmt(totaux.scu)}</b>
      {avecBord ? (
        <>
          {`/${fmt(m.cargo)} SCU · `}
          <span className="mbord" title="Déjà en soute, payé — cf. panneau Soute">{`${fmt(m.aBord)} SCU à bord`}</span>
          {restant}
        </>
      ) : (
        // Sans badge « à bord », rien ne s'intercale : la queue de phrase doit rester UN nœud.
        `/${fmt(m.cargo)} SCU${restant}`
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Le bouton d'engagement dans le voyage, ou la phrase qui dit pourquoi il n'y est pas.
// L'état vient de `manifestJourneyState` (pur, testé) — le rendu ne décide de rien.
// ---------------------------------------------------------------------------------------------
function Engagement({ m, parcours }: { m: ContexteCarte; parcours: Parcours | null }) {
  if (!m.lines.length) return <span className="journey-hint">Manifeste vide — ajoute une commodité pour l'engager.</span>;
  const st = manifestJourneyState(parcours, m.origin, m.dest);
  if (st.etat === "ajouter") {
    const neuf = !parcours;
    return (
      <button
        id="manifestToJourney"
        className="chain-pick"
        title={neuf ? "Démarrer un voyage avec ce chargement" : "Ajouter ce chargement à la suite du voyage"}
      >
        {neuf ? "▶ Démarrer un voyage" : "▶ Ajouter au voyage"}
      </button>
    );
  }
  // « Déjà » est l'état NORMAL après tout ▶ (En route est pré-rempli avec la jambe courante) et
  // celui où l'on retombe après un ajout réussi : la phrase fait donc office de confirmation, à
  // l'endroit exact du clic. Un bouton y serait un clic mort.
  if (st.etat === "deja") return <span className="journey-hint">{`✓ C'est déjà la jambe ${st.leg + 1} de ton voyage.`}</span>;
  if (!st.fin) return null;
  return (
    <span className="journey-hint">
      {"Ce chargement part de "}
      <b>{m.origin.name}</b>
      {", mais le voyage se termine à "}
      <b>{st.fin}</b>
      {" — seul un chargement au départ de "}
      <b>{st.fin}</b>
      {" s'y ajoute."}
    </span>
  );
}

const MARQUE_TITRE =
  "Chargement composé à la main : ses lignes, ses SCU et cette destination sont les tiens. " +
  "Les prix, eux, continuent de suivre le marché. « ↺ optimal » rend la main au calcul.";

// ---------------------------------------------------------------------------------------------
// Une ligne du manifeste.
// ---------------------------------------------------------------------------------------------
function Ligne({ p, l, i }: { p: ProprietesManifeste; l: LigneManifeste; i: number }) {
  const { m } = p;
  const carry = l.sellPrice == null; // pas vendable à cette destination -> à écouler ailleurs
  // Symétrique : aucun point d'achat au départ -> le fret est DÉJÀ en soute (butin, minage,
  // salvage). Afficher un prix « 0 » éditable le ferait passer pour un achat gratuit sur place.
  const acq = !!l.acquired;
  const fraisLigne = lineHaulFee(l.units, l, m.fee);

  const editable = (terminal: string, cote: "buy" | "sell", champ: "price" | "vol", valeur: number | null, releve: number) => (
    <ValeurEditable
      valeur={valeur}
      commodite={l.name}
      terminal={terminal}
      cote={cote}
      champ={champ}
      releve={releve}
      corrige={p.estCorrige(l.name, terminal, cote, champ)}
      fmtVol={p.fmtVol}
      onCorriger={(v) => p.corriger(l.name, terminal, cote, champ, v, releve)}
      texteCapaciteInconnue={p.texteCapaciteInconnue}
    />
  );

  // Une ligne « vend ailleurs » n'a pas de profit ICI (elle sera écoulée plus loin), mais elle a
  // bien été CHARGÉE ici : ses frais sont retranchés du total. Les taire laissait le total baisser
  // sans qu'aucune ligne à l'écran ne l'explique.
  const texteProfit = carry
    ? fraisLigne > 0
      ? p.fmtFee(-fraisLigne, fraisLigne)
      : "—"
    : p.signe(lineNet(l.units, l, m.fee), p.fmtFee(lineNet(l.units, l, m.fee), fraisLigne));

  return (
    <div className={"mline" + (carry ? " carry" : "") + (acq ? " acquired" : "")}>
      <IconeCommodite kind={l.kind} />
      <span className="mqtywrap">
        {/* NON CONTRÔLÉ, et c'est ce qui fait tenir la frappe : React ne rend pas sa valeur au
            re-rendu, donc le profit et les totaux se recalculent sous les doigts sans déplacer le
            curseur. La contrepartie, c'est qu'un champ déjà tapé n'adopterait JAMAIS une nouvelle
            valeur calculée — d'où la `key` portant la génération, qui le remonte quand le
            manifeste est recalculé (« ↺ optimal », changement de départ) et seulement là. */}
        <input
          key={`${l.name}@${p.generation}`}
          type="number"
          className={"mqty-input" + (l.units > l.cap ? " over-stock" : "")}
          min="0"
          defaultValue={l.units}
          data-i={i}
          data-cap={l.cap}
          title="Ajuste librement — tu peux dépasser le stock UEX (vol de fret, relevé périmé…)"
          aria-label={`SCU ${l.name}`}
        />
        <span className="munit">SCU</span>
      </span>
      <span className="mname">
        {l.name}
        <TagIllegal illegal={l.illegal} />
        <button className="mline-del" data-name={l.name} title="Retirer du manifeste" aria-label="Retirer">✕</button>
      </span>
      <span className="mstock">
        {"stock "}
        {acq ? <span className="muted">—</span> : editable(m.origin.name, "buy", "vol", l.stock, l.buyUpdated)}
        {" · dem. "}
        {carry ? <span className="muted">—</span> : editable(m.dest.name, "sell", "vol", l.demand, l.sellUpdated)}
      </span>
      <span className="mprice">
        {acq ? (
          <span className="carry-tag" title="Introuvable à l'achat ici — fret déjà en soute (butin, minage, salvage). Ajuste les SCU à ce que tu transportes.">
            acquis ailleurs
          </span>
        ) : (
          editable(m.origin.name, "buy", "price", l.buyPrice, l.buyUpdated)
        )}
        {" → "}
        {carry ? (
          <span className="carry-tag" title="Pas vendable à cette destination — à écouler ailleurs">vend ailleurs</span>
        ) : (
          editable(m.dest.name, "sell", "price", l.sellPrice, l.sellUpdated)
        )}
      </span>
      <span
        className={"mprofit " + (carry ? "muted" : "profit")}
        title={carry && fraisLigne > 0 ? "Chargée ici, vendue ailleurs : seul le chargement est facturé sur ce trajet" : undefined}
      >
        {texteProfit}
      </span>
      <span className="mboxes" title="Caisses SCU standard à charger">{`📦 ${p.libelleCaisses(l.units)}`}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// La carte entière.
// ---------------------------------------------------------------------------------------------
export function CarteManifeste(p: ProprietesManifeste) {
  const { m } = p;
  const totaux = manifestTotals(m.lines, m.fee);
  return (
    <>
      <div className="manifest-head">
        <span className="manifest-title">
          {"◈ Manifeste — "}
          {m.origin.name}
          <BadgeSysteme system={m.origin.system} />
          {" → "}
          {m.dest.name}
          <BadgeSysteme system={m.dest.system} />
          {/* L'espace AVANT le badge est significative : le gabarit écrivait `' <span class="cross">'`
              et sans elle le titre perd 5 px — mesuré au relevé, seul écart des 127 formes de la
              carte. JSX ne restitue pas une espace de fin de ligne, il faut l'écrire. */}
          {m.cross ? <>{" "}<span className="cross">⚡ inter-système</span></> : null}
          {/* Le ✎ était injecté APRÈS coup par `marquerManifesteCompose` (insertAdjacentHTML dans
              une carte déjà rendue). Il est ici de l'état : `MANIFEST_EDIT != null`. */}
          {p.compose ? <>{" "}<span className="manifest-edited" title={MARQUE_TITRE}>✎</span></> : null}
        </span>
        <Totaux p={p} totaux={totaux} />
        <Engagement m={m} parcours={p.parcours} />
        <button id="copyManifest" className="copy-btn" title="Copier le plan de chargement">⧉ Copier</button>
      </div>
      <div className="manifest-lines">
        {m.lines.map((l, i) => (
          <Fragment key={l.name}>
            <Ligne p={p} l={l} i={i} />
          </Fragment>
        ))}
      </div>
      <div className="manifest-add">
        <input
          id="manifestAddInput"
          list="commodityList"
          placeholder="Ajouter n'importe quelle commodité (même non vendable ici)…"
          autoComplete="off"
          aria-label="Ajouter une commodité"
        />
        <button id="manifestAddBtn" type="button" className="copy-btn">+ Ajouter</button>
        {p.compose ? (
          <button id="manifestReset" type="button" className="manifest-reset" title="Revenir au chargement optimal calculé pour ce départ">
            ↺ optimal
          </button>
        ) : null}
      </div>
      <div id="manifestSuggest" className="manifest-suggest">
        <Suggestions suggestions={p.suggestions} restant={p.restant} frais={m.fee} fmt={p.fmt} fmtVol={p.fmtVol} />
      </div>
    </>
  );
}

/** Les trois messages qui remplacent la carte quand il n'y a rien à charger. */
export const indiceManifeste = (noeud: React.ReactNode) => <div className="manifest-hint">{noeud}</div>;

export const carteManifeste = (p: ProprietesManifeste) => <CarteManifeste {...p} />;
export const suggestions = (p: ProprietesSuggestions) => <Suggestions {...p} />;
