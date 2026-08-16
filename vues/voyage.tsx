// Le compagnon de voyage — `#journeyCard` et son récap —, onzième et DERNIER îlot de vue (#96).
//
// C'est le plus couplé du dépôt, et c'est pour ça qu'il passe en dernier : il lit six globales
// (dont `JOURNEY`, 33 références), et son rendu déclenchait celui de trois autres cartes. Rien de
// tout ça ne bouge — app.js garde l'orchestration, l'îlot ne reçoit que le résultat.
//
// DEUX CHOSES À NE PAS DÉFAIRE :
//
//  1. Le champ SCU d'une jambe (`.jman-qty`) est NON CONTRÔLÉ, et une `generation` le remonte.
//     Même mécanique que le manifeste (#117) : la frappe doit survivre au re-rendu qu'elle
//     provoque, mais un manifeste RECALCULÉ doit reprendre la main. `renderJourney({frappe:true})`
//     ne bouge pas la génération ; tout autre appel la bouge.
//  2. Les suggestions d'une jambe sont rendues ICI, dans l'arbre. Elles vivaient dans un conteneur
//     peint à part (`renderLegSuggestions`) parce que la carte, elle, était écrite en `innerHTML`
//     et le détruisait à chaque rendu. La carte étant passée à React, ce détour n'a plus de raison
//     d'être — et un conteneur peint à part DANS une carte possédée par React est précisément le
//     piège de #120.
import { Fragment } from "react";
import { PointFraicheur, IconeCommodite, TagIllegal } from "./communs.tsx";
import { Suggestions, type ProprietesSuggestions } from "./manifeste.tsx";

type Fmt = (n: number) => string;

export type LigneJambe = {
  name: string;
  kind: string;
  illegal: boolean;
  units: number;
  /** Introuvable à l'achat ici : le fret est déjà en soute (butin, minage, salvage). */
  acquired: boolean;
  /** `null` quand la commodité n'est pas vendable à l'arrivée — à écouler ailleurs. */
  vendable: boolean;
  /** Le plus ancien des relevés achat/vente de la ligne. */
  releve: number;
  /** Rendu par app.js (`lineProfitText`), qui seul connaît le contexte de frais de la jambe. */
  texteProfit: string;
  /** Le stock UEX est dépassé — signalé, jamais empêché (vol de fret, relevé périmé…). */
  auDela: boolean;
};

export type Jambe = {
  i: number;
  from: string;
  to: string;
  courante: boolean;
  depliee: boolean;
  /** Manifeste personnalisé (✎), et figé par une correction (🔒) plutôt que par toi. */
  editee: boolean;
  figee: boolean;
  /** Ce manifeste est-il déjà en soute ? */
  chargee: boolean;
  /** `null` tant que le marché n'est pas là : la jambe affiche « calcul… ». */
  lignes: LigneJambe[] | null;
  /** Le rendu du total (`fmtFee`) et le NOMBRE qui décide de son signe et de sa couleur. Les
   *  séparer n'est pas un luxe : une jambe dont les frais dépassent la marge s'affichait
   *  « +-1 234 », en vert. */
  texteTotal: string;
  nombreTotal: number;
  /** Les suggestions de remplissage de CETTE jambe, quand elle est dépliée. */
  suggestions: ProprietesSuggestions | null;
};

export type SuggestionArret = { label: string; terminal: string; commodity: string; margin: number };

export type ProprietesVoyage = {
  stations: { name: string; system: string }[];
  courante: number;
  nbSauts: number;
  margeCumulee: number;
  /** Sans marché, ni manifeste par jambe, ni suggestion d'arrêt : la carte le dit au lieu de mentir. */
  marchePret: boolean;
  jambes: Jambe[];
  /** `null` quand le marché manque ; une liste vide est une réponse, pas une absence. */
  suggestionsArret: SuggestionArret[] | null;
  /** Bougée à chaque rendu SAUF pendant la frappe — elle remonte les champs SCU des jambes. */
  generation: number;
  fmt: Fmt;
  signe: (n: number, texte: string) => string;
};

const classeProfit = (n: number) => (n < 0 ? "perte" : "profit");

// ---------------------------------------------------------------------------------------------
// Aucun voyage : l'invite à en démarrer un, depuis un trajet (▶) ou de zéro.
// ---------------------------------------------------------------------------------------------
export const inviteVoyage = () => (
  <>
    <div className="journey-head">
      <span className="journey-title">◈ Nouveau voyage</span>
    </div>
    <p className="journey-hint">Choisis un trajet (▶) dans une vue, ou démarre de zéro :</p>
    <div className="journey-add">
      <input id="journeyStart" list="stationList" placeholder="Point de départ (terminal)…" autoComplete="off" aria-label="Point de départ du voyage" />
      <button id="journeyStartBtn" type="button" className="chain-pick">Commencer</button>
    </div>
  </>
);

// ---------------------------------------------------------------------------------------------
// L'éditeur de manifeste d'une jambe dépliée.
// ---------------------------------------------------------------------------------------------
function EditeurJambe({ j, generation }: { j: Jambe; generation: number }) {
  const lignes = j.lignes || [];
  return (
    <div className="jman">
      {lignes.length ? (
        lignes.map((l, li) => (
          <div className="jman-line" key={l.name}>
            <IconeCommodite kind={l.kind} />
            <span className="mqtywrap">
              {/* Non contrôlé + `key` portant la génération : cf. l'en-tête du fichier. */}
              <input
                key={`${l.name}@${generation}`}
                type="number"
                className={"jman-qty" + (l.auDela ? " over-stock" : "")}
                min="0"
                defaultValue={l.units}
                data-leg={j.i}
                data-i={li}
                aria-label={`SCU ${l.name}`}
              />
              <span className="munit">SCU</span>
            </span>
            <span className="jman-name">
              <PointFraicheur updated={l.releve} />
              {l.name}
              <TagIllegal illegal={l.illegal} />
              {l.acquired ? (
                <>
                  {" "}
                  <span className="carry-tag" title="Introuvable à l'achat ici — fret déjà en soute">acquis ailleurs</span>
                </>
              ) : null}
              {!l.vendable ? (
                <>
                  {" "}
                  <span className="carry-tag">vend ailleurs</span>
                </>
              ) : null}
            </span>
            <span className="jman-profit profit">{l.texteProfit}</span>
            <button className="jman-del" data-leg={j.i} data-name={l.name} title="Retirer">✕</button>
          </div>
        ))
      ) : (
        <div className="muted jman-empty">Aucune commodité.</div>
      )}
      <div className="jman-add">
        <input className="jman-add-input" list="commodityList" data-leg={j.i} placeholder="+ commodité (même non vendable)…" autoComplete="off" />
        <button className="jman-add-btn" data-leg={j.i}>+</button>
        {j.editee ? (
          <button className="jman-reset" data-leg={j.i} title="Revenir au manifeste optimal">↺ optimal</button>
        ) : null}
      </div>
      <div className="jman-suggest manifest-suggest" data-leg={j.i}>
        {j.suggestions ? <Suggestions {...j.suggestions} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Une jambe : son en-tête cliquable, sa cargaison, et son éditeur si elle est dépliée.
// ---------------------------------------------------------------------------------------------
function JambeVoyage({ p, j }: { p: ProprietesVoyage; j: Jambe }) {
  const lignes = j.lignes;
  return (
    <div className={"jleg" + (j.courante ? " current" : "") + (j.depliee ? " expanded" : "")}>
      <div className="jleg-head" data-leg={j.i} role="button" tabIndex={0} aria-expanded={j.depliee} title="Éditer le manifeste de cette jambe">
        <span className="jleg-n">{j.i + 1}</span>
        <span className="jleg-route">{`${j.from} → ${j.to}`}</span>
        {j.editee ? (
          j.figee ? (
            <span
              className="jleg-pinned"
              title="Quantités figées : le stock ou la demande de ce chargement a été corrigé depuis. Le trajet reste tel que tu l'as décidé — les prix, eux, continuent de suivre le marché. « ↺ optimal » recalcule tout."
            >
              🔒
            </span>
          ) : (
            <span className="jleg-edited" title="Manifeste personnalisé">✎</span>
          )
        ) : null}
        {p.marchePret && lignes && lignes.length ? (
          <button
            className={"jleg-load" + (j.chargee ? " charge" : "")}
            data-leg={j.i}
            title={j.chargee ? "Annuler : ce chargement n'est plus à bord" : "J'ai payé et chargé ce manifeste — il entre en soute à ce prix"}
          >
            {j.chargee ? "⬢ à bord" : "✓ chargé"}
          </button>
        ) : null}
        <span className={"jleg-profit " + classeProfit(j.nombreTotal)}>{p.signe(j.nombreTotal, j.texteTotal)}</span>
        <span className="jleg-caret">{j.depliee ? "▾" : "▸"}</span>
      </div>
      <div className="jleg-cargo">
        {!p.marchePret ? (
          <span className="muted">calcul…</span>
        ) : !lignes || !lignes.length ? (
          <span className="muted">aucun fret rentable</span>
        ) : (
          lignes.map((l) => (
            <span className="jcargo-item" key={l.name}>
              <PointFraicheur updated={l.releve} />
              <IconeCommodite kind={l.kind} />
              <span>
                {l.name}
                <TagIllegal illegal={l.illegal} />
              </span>
              {" "}
              <b>{`${p.fmt(l.units)} SCU`}</b>
            </span>
          ))
        )}
      </div>
      {j.depliee && p.marchePret ? <EditeurJambe j={j} generation={p.generation} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// La carte entière.
// ---------------------------------------------------------------------------------------------
export function CarteVoyage(p: ProprietesVoyage) {
  const n = p.nbSauts;
  return (
    <>
      <div className="journey-head">
        <span className="journey-title">{n === 0 ? "◈ Voyage" : "◈ Voyage en cours"}</span>
        <button id="journeyClear" className="journey-clear" title="Effacer le parcours" aria-label="Effacer">✕</button>
      </div>
      <div className="journey-path">
        {p.stations.map((s, i) => (
          // `Fragment` et non un <span> englobant : `.journey-path` est un conteneur flex, et
          // envelopper ses enfants les en sortirait (mesuré sur `.chain-path`, PR #111).
          <Fragment key={i}>
            {i > 0 ? <span className="jsep">→</span> : null}
            <span className="jstep-wrap">
              <button className={"jstep" + (i === p.courante ? " here" : "")} data-i={i} title="Je suis ici">
                <span className={"sys " + s.system.toLowerCase()}>{s.name}</span>
              </button>
              <button className="jstep-del" data-i={i} title="Retirer cet arrêt" aria-label="Retirer">✕</button>
            </span>
          </Fragment>
        ))}
      </div>
      {n === 0 ? <p className="journey-hint">Départ posé — ajoute un arrêt pour construire ton parcours.</p> : null}
      <div className="journey-legs">
        {p.jambes.map((j) => (
          <Fragment key={j.i}>
            <JambeVoyage p={p} j={j} />
          </Fragment>
        ))}
      </div>
      <div className="journey-add">
        <input id="journeyAddStop" list="stationList" placeholder="+ Ajouter un arrêt (terminal)…" autoComplete="off" aria-label="Ajouter un arrêt" />
        <button id="journeyAddBtn" type="button" className="chain-pick">+ Arrêt</button>
      </div>
      {/* Ajout d'arrêt : champ libre (tous terminaux) + suggestions rentables depuis la fin.
          Une liste VIDE est une réponse — « rien ne rapporte d'ici » — et se dit. `null`, lui, veut
          dire que le marché n'est pas encore là, et ne se dit pas du tout. */}
      {p.suggestionsArret == null ? null : p.suggestionsArret.length ? (
        <div className="journey-suggest">
          <span className="suggest-lbl">Suggestions :</span>
          {p.suggestionsArret.map((s) => (
            <button
              className="jstop-suggest"
              data-label={s.label}
              title={`Ajouter ${s.terminal} — via ${s.commodity}, +${p.fmt(s.margin)} marge/SCU`}
              key={s.label}
            >
              {`+ ${s.terminal} `}
              <span className="muted">{`+${p.fmt(s.margin)}`}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="journey-suggest-empty muted">
          Aucune destination rentable depuis ici — ajoute quand même un arrêt au champ ci-dessus (il aura un manifeste vide, à remplir à la main).
        </div>
      )}
      <div className="journey-meta">
        {`${n} saut${n > 1 ? "s" : ""} · marge cumulée `}
        <b className="profit">{p.fmt(p.margeCumulee)}</b>
        {" aUEC/SCU"}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Le récap (colonne de gauche, sous le vaisseau) : remplit l'espace avec des KPIs utiles.
// ---------------------------------------------------------------------------------------------
export type ProprietesRecap = {
  n: number;
  totalProfit: number;
  totalScu: number;
  totalFees: number;
  systems: number;
  materials: number;
  marchePret: boolean;
  fmt: Fmt;
  signe: (n: number, texte: string) => string;
};

const Kpi = ({ v, lbl }: { v: string | number; lbl: string }) => (
  <div className="recap-kpi">
    <b>{v}</b>
    <span>{lbl}</span>
  </div>
);

export function RecapVoyage(p: ProprietesRecap) {
  return (
    <>
      <div className="recap-head">◈ Résumé du voyage</div>
      <div
        className={"recap-profit " + classeProfit(p.totalProfit)}
        title={p.totalFees > 0 ? `Frais d'autoload ≈ ${p.fmt(p.totalFees)} aUEC déjà déduits — estimation (±3 %)` : undefined}
      >
        {p.marchePret ? p.signe(p.totalProfit, (p.totalFees > 0 ? "≈ " : "") + p.fmt(p.totalProfit)) : "…"}
        {" "}
        <span>aUEC</span>
      </div>
      <div className="recap-kpis">
        <Kpi v={p.n} lbl={"saut" + (p.n > 1 ? "s" : "")} />
        <Kpi v={p.marchePret ? p.fmt(p.totalScu) : "…"} lbl="SCU" />
        <Kpi v={p.systems} lbl={"système" + (p.systems > 1 ? "s" : "")} />
        <Kpi v={p.marchePret ? p.materials : "…"} lbl={"matériau" + (p.materials > 1 ? "x" : "")} />
      </div>
    </>
  );
}

export const carteVoyage = (p: ProprietesVoyage) => <CarteVoyage {...p} />;
export const recapVoyage = (p: ProprietesRecap) => <RecapVoyage {...p} />;
