// La carte « Soute » et la carte « Entrepôts », dixième îlot React (ADR-008 #96).
//
// Les deux vivent dans `#voyageLeft`, que `switchView` ne touche jamais : les huit vues les
// portent, y compris Trajets et Commodités qui n'ont aucun rapport avec un voyage. Ce ne sont donc
// pas des vues — ce sont deux cartes d'ÉTAT, visibles partout, et c'est pour ça qu'elles migrent
// ensemble : elles répondent à la même question, « qu'est-ce que je transporte, et où ? ».
//
// Tout ce qui décide vit ailleurs : `holdByCommodity`, `offloadPlan` et `sellableAt` sont dans
// logic.ts et déjà testés. app.js ne passe ici que ce qui dépend de l'état global — la station
// courante, le point de vente résolu, l'icône d'une commodité (qui se relit au MARCHÉ), et les
// deux interrupteurs d'affichage (`venteEnCours`, `ecoulerOuvert`).
import { Fragment } from "react";
import type { GroupeSoute, Destination, VenteAuTerminal, Lot, Station } from "../types.ts";
import { BadgeSysteme, TagAvantPoste, IconeCommodite } from "./communs.tsx";

type Fmt = (n: number) => string;

export type ProprietesSoute = {
  groupes: GroupeSoute[];
  /** Le terminal où l'on se trouve, ou `null` : vendre suppose de savoir où l'on est. */
  ici: number | null;
  scu: number;
  /** La place libre, ou `null` quand la soute n'est pas bornée dans les filtres. */
  libre: number | null;
  invest: number;
  /** La commodité dont le champ de quantité est ouvert, ou `null`. */
  venteEnCours: string | null;
  /** Le panneau « où écouler » est-il déplié ? */
  ecoulerOuvert: boolean;
  /** Les destinations d'écoulement, ou `null` quand il n'y a pas de quoi les calculer. */
  ecoulement: Destination[] | null;
  /** `null` quand la position manque : le panneau dit alors ce qui lui manque. */
  positionConnue: boolean;
  /** Le marché est-il là ? Sans lui, ni icône, ni vente, ni classement. */
  marchePret: boolean;
  /** Le point de vente de cette commodité ICI, ou `null` si le comptoir n'en veut pas. */
  pointVente: (nom: string) => VenteAuTerminal | null;
  /** Le `kind` d'une commodité — relu au marché, absent du lot (c'est une propriété de la
   *  commodité, pas de la transaction). */
  kindDe: (nom: string) => string | null;
  fmt: Fmt;
};

// ---------------------------------------------------------------------------------------------
// « Où écouler ce qui reste ? » — le détour manuel par la vue Commodités, en un panneau.
// ---------------------------------------------------------------------------------------------
function OuEcouler({ p }: { p: ProprietesSoute }) {
  if (!p.ecoulerOuvert || !p.marchePret) return null;
  // Une soute DÉCLARÉE peut exister sans le moindre voyage : le panneau n'a alors pas de point de
  // départ. Ne rien rendre laissait le clic sans effet visible — on dit ce qui manque, et où le saisir.
  if (!p.positionConnue)
    return (
      <div className="hold-ecouler">
        <p className="muted">
          {"Dis d'abord "}
          <b>où tu es</b>
          {" : le classement part d'un terminal.\n      Le champ "}
          <b>◈ Je suis à</b>
          {", juste dessous, l'attend."}
        </p>
      </div>
    );
  const dest = p.ecoulement || [];
  if (!dest.length)
    return (
      <div className="hold-ecouler">
        <p className="muted">
          {"Aucune destination ne reprend ce fret avec ces filtres.\n      Tu peux le "}
          <b>déposer</b>
          {" à une station : il n'est alors ni vendu ni perdu."}
        </p>
      </div>
    );
  return (
    <div className="hold-ecouler">
      <div className="ec-head">Où écouler — classé par ce que ça rapporte, prix d'achat déduit</div>
      {dest.map((d) => (
        <LigneEcoulement d={d} fmt={p.fmt} key={d.idx} />
      ))}
    </div>
  );
}

function LigneEcoulement({ d, fmt }: { d: Destination; fmt: Fmt }) {
  const cert =
    d.certitude === "connue" ? (
      <span className="ec-sur" title="Capacité publiée par UEX">{`${fmt(d.garanti)} SCU garantis`}</span>
    ) : d.certitude === "inconnue" ? (
      <span className="ec-flou" title="UEX ne publie pas la capacité de ce point : ni zéro, ni illimitée">capacité inconnue</span>
    ) : (
      <span className="ec-flou" title="Capacité publiée pour une partie seulement">{`${fmt(d.garanti)} SCU garantis, reste inconnu`}</span>
    );
  const detail = d.lignes.map((l) => `${l.name} ${fmt(l.absorbe)}${l.reste > 0 ? `/${fmt(l.absorbe + l.reste)}` : ""}`).join(" · ");
  return (
    <div className="ec-dest">
      <span className="ec-nom">
        {d.terminal}
        <BadgeSysteme system={d.system} />
        {d.cross ? <>{" "}<span className="cross">⚡</span></> : null}
        <TagAvantPoste outpost={!!d.outpost} />
      </span>
      <span
        className={"ec-profit " + (d.profit < 0 ? "perte" : "profit")}
        title={`Ce que ça rapporte, prix d'achat déduit${d.profit < 0 ? " — négatif : tu vendrais à perte ici" : ""}. Encaissement brut : ${fmt(Math.round(d.encaisse))} aUEC.`}
      >
        {`${d.profit >= 0 ? "+" : ""}${fmt(Math.round(d.profit))}`}
      </span>
      <span className="ec-detail">
        {`${detail} · `}
        {cert}
        {/* Vendre sous le prix payé peut rester le bon choix — libérer la soute vaut parfois une
            perte — mais ça ne doit jamais passer inaperçu derrière un chiffre positif. */}
        {d.aPerte ? (
          <>
            {" · "}
            <span className="ec-perte" title="Le prix ici est inférieur à ce que tu as payé">sous le prix payé</span>
          </>
        ) : null}
        {d.reste > 0 ? (
          <>
            {" · "}
            <b>{fmt(d.reste)}</b>
            {" SCU resteraient à bord"}
          </>
        ) : (
          <>
            {" · "}
            <b>soute vidée</b>
          </>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Une commodité à bord : ce qu'elle est, ce qu'elle a coûté, et les deux sorties (vendre, déposer).
// ---------------------------------------------------------------------------------------------
function LigneSoute({ p, g }: { p: ProprietesSoute; g: GroupeSoute }) {
  const { fmt } = p;
  // Un lot DÉCLARÉ n'a pas de terminal d'achat (`from` vide) : le dire, plutôt qu'afficher « ? »
  // qui laisse croire à une donnée perdue. C'est un fait, pas un trou.
  const ouCharge = (l: Lot) => (l.from ? `Chargé à ${l.from}` : "Déclaré à la main — aucun terminal d'achat");
  const sansAchat = g.lots.every((l) => !l.from) ? " — déclaré à la main, aucun terminal d'achat" : "";
  const pt = p.ici != null && p.marchePret ? p.pointVente(g.name) : null;
  const kind = p.kindDe(g.name);

  return (
    <div className="hold-line">
      <span className="hold-name">
        {kind ? <IconeCommodite kind={kind} /> : null}
        {g.name}
      </span>
      <span className="hold-scu">
        <b>{fmt(g.units)}</b>
        {" SCU"}
      </span>
      <span className="hold-paid" title={`Prix payé au SCU${g.lots.length > 1 ? " (moyenne des lots)" : ""}${sansAchat}`}>
        {`@ ${fmt(Math.round(g.paidMoyen))}`}
      </span>
      {/* Coût nul : « où écouler » comptera tout l'encaissement comme profit. C'est juste — du
          butin n'a rien coûté — mais ça change le sens du chiffre, et ça ne doit pas se deviner. */}
      {g.invest === 0 ? (
        <>
          {" "}
          <span className="hold-butin" title="Rien payé pour ce fret : « où écouler » compte donc tout l'encaissement comme profit">butin</span>
        </>
      ) : null}
      {/* Vendre suppose que le comptoir reprenne la commodité ; DÉPOSER, non — c'est justement la
          sortie quand il n'en veut pas. Les deux ouvrent le même champ de quantité.
          `data-idx` fige la station telle qu'elle a été résolue POUR CE RENDU : c'est elle qui a
          fixé le prix annoncé juste à côté. Sans lui, `vendreIci` relisait `stationCourante()` au
          clic et pouvait encaisser ailleurs qu'à l'endroit dont l'utilisateur venait de lire le
          chiffre. */}
      {p.venteEnCours === g.name ? (
        <span className="hold-sell open" data-idx={p.ici}>
          <input className="hold-sell-qty" type="number" min="0" max={g.units} defaultValue={g.units} aria-label={`SCU de ${g.name}`} />
          {pt ? (
            <button className="hold-sell-ok" data-name={g.name} title={`Vendre ici à ${fmt(pt.price ?? 0)} aUEC/SCU`}>✓ vendre</button>
          ) : null}
          <button className="hold-store" data-name={g.name} title="Déposer à la station : ni vendu, ni perdu">⬓ déposer</button>
          <button className="hold-sell-no" title="Annuler">✕</button>
        </span>
      ) : p.ici != null ? (
        <button
          className="hold-sell-btn"
          data-name={g.name}
          title={
            pt
              ? `Vendre ou déposer ici — ${fmt(pt.price ?? 0)} aUEC/SCU${pt.demand == null ? ", capacité inconnue chez UEX" : `, capacité annoncée ${fmt(pt.demand)} SCU`}`
              : "Ce comptoir ne reprend pas cette commodité — tu peux quand même l'y déposer"
          }
        >
          {pt ? "vendu" : "déposer"}
        </button>
      ) : null}
      {/* Le détail des lots n'apparaît que s'il y en a plusieurs : sinon c'est du bruit. */}
      {g.lots.length > 1 ? (
        <div className="hold-lots">
          {g.lots.map((l) => (
            <span className="hold-lot" title={ouCharge(l)} key={l.i}>
              {`${fmt(l.units)} SCU @ ${fmt(l.paid)}`}
              <button className="hold-del" data-i={l.i} title="Retirer ce lot" aria-label="Retirer">✕</button>
            </span>
          ))}
        </div>
      ) : (
        <button className="hold-del solo" data-i={g.lots[0].i} title="Retirer ce lot" aria-label="Retirer">✕</button>
      )}
    </div>
  );
}

export function CarteSoute(p: ProprietesSoute) {
  return (
    <>
      <div className="hold-head">
        <span className="hold-title">◈ Soute</span>
        <button id="holdClear" className="journey-clear" title="Vider la soute (le fret est débarqué)" aria-label="Vider la soute">✕</button>
      </div>
      <div className="hold-lines">
        {p.groupes.map((g) => (
          <Fragment key={g.name}>
            <LigneSoute p={p} g={g} />
          </Fragment>
        ))}
      </div>
      {/* `.hold-meta` est en `display: block` : ses espaces COMPTENT, à la différence de
          `.hold-line` qui est flex. Le gabarit terminait par « aUEC » suivi d'un retour à la ligne
          et de son indentation avant le bouton, ce qui rend UNE espace — 2,67 px à 11 px de police,
          et sans elle toute la carte rétrécissait d'autant
          (mesuré : 410,78 → 408,11 px). Les séparateurs sont donc collés au texte qui les précède,
          et l'espace avant le bouton est explicite. */}
      <div className="hold-meta">
        <b>{p.fmt(p.scu)}</b>
        {p.libre != null ? " SCU à bord · " : " SCU à bord · capital engagé "}
        {p.libre != null ? (
          <>
            <b>{p.fmt(p.libre)}</b>
            {" libres · capital engagé "}
          </>
        ) : null}
        <b>{p.fmt(p.invest)}</b>
        {" aUEC\n       "}
        <button id="holdOffload" className="hold-offload">{p.ecoulerOuvert ? "▾ où écouler ?" : "▸ où écouler ?"}</button>
      </div>
      <OuEcouler p={p} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Les entrepôts : ce qui dort à une station, ni vendu ni perdu.
// ---------------------------------------------------------------------------------------------
export type StationEntrepot = {
  /** Le libellé complet, tel que la délégation le relit dans `data-station`. */
  label: string;
  lieu: Station;
  scu: number;
  groupes: GroupeSoute[];
};

export type ProprietesEntrepots = {
  stations: StationEntrepot[];
  scuTotal: number;
  invest: number;
  fmt: Fmt;
};

export function CarteEntrepots({ stations, scuTotal, invest, fmt }: ProprietesEntrepots) {
  return (
    <>
      {/* Le bouton de sortie vit dans l'en-tête, sur le modèle exact du `⧉ Copier` du manifeste. Il
          n'existe donc que quand la carte est visible — inutile de le masquer à part : la carte
          entière sort dès qu'il ne dort plus rien nulle part. */}
      <div className="hold-head">
        <span className="hold-title">⬓ Entrepôts</span>
        <button id="copyDepots" className="copy-btn" title="Copier la liste du fret déposé, dates comprises">⧉ Copier</button>
      </div>
      <div className="depot-stations">
        {stations.map((s) => (
          <div className="depot-station" key={s.label}>
            <div className="depot-lieu">
              {s.lieu.name}
              <BadgeSysteme system={s.lieu.system} />
              {" "}
              <span className="muted">{`${fmt(s.scu)} SCU`}</span>
            </div>
            {s.groupes.map((g) => (
              <div className="hold-line" key={g.name}>
                <span className="hold-name">{g.name}</span>
                <span className="hold-scu">
                  <b>{fmt(g.units)}</b>
                  {" SCU"}
                </span>
                <span className="hold-paid" title={`Prix payé au SCU${g.lots.length > 1 ? " (moyenne des lots)" : ""}`}>
                  {`@ ${fmt(Math.round(g.paidMoyen))}`}
                </span>
                <button
                  className="depot-take"
                  data-station={s.label}
                  data-name={g.name}
                  data-units={g.units}
                  title={`Remettre ces ${fmt(g.units)} SCU en soute, à leur prix payé`}
                >
                  ↑ reprendre
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hold-meta">
        <b>{fmt(scuTotal)}</b>
        {" SCU déposés · capital immobilisé "}
        <b>{fmt(invest)}</b>
        {" aUEC"}
      </div>
    </>
  );
}

export const carteSoute = (p: ProprietesSoute) => <CarteSoute {...p} />;
export const carteEntrepots = (p: ProprietesEntrepots) => <CarteEntrepots {...p} />;
