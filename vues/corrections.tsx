// La vue Corrections, cinquième îlot React (ADR-008 #96) — et la plus grosse des huit.
//
// Elle n'était PAS migrable avant la PR précédente : son cœur est l'édition sur place, que
// `startEdit` mutait impérativement. `ValeurEditable` (communs.tsx) l'a levée.
//
// Trois conteneurs, écrits séparément et pour des raisons différentes :
//   #correctionsStation  le panneau de la station affichée (hero + tuiles par commodité) ;
//   #correctionsIndex    la bande de vignettes, une par station corrigée ;
//   #correctionsFees     le panneau de frais, dont app.js garde le contrôle de re-rendu.
//
// Ce dernier n'est réécrit QUE si sa signature change (#24) : un montant en cours de frappe
// repartait à vide au moindre re-rendu — un filtre tapé, une correction ailleurs. React
// réconcilierait sans doute correctement, mais changer ce garde ET migrer la vue dans la même PR
// rendrait un échec inexploitable. Il reste donc à app.js, à revoir séparément.
import { TEXTE_CAPACITE_INCONNUE, fmtVol } from "../format.ts";
import { Fragment } from "react";
import type { Terminal } from "../types.ts";
import { BadgeSysteme, IconeCommodite, TagIllegal, ValeurEditable } from "./communs.tsx";

type Fmt = (n: number | null) => string;

// ── La vignette de station ─────────────────────────────────────────────────────────────────────
// La photo se pose EN ABSOLU par-dessus le repli, dans un conteneur commun. La superposer à coups
// de marge négative les décalait de la valeur du `gap` flex, et le code débordait derrière la photo
// (« TA » derrière celle de Nyx Gateway (Stanton), dont le code est NYXSTA).
export function VignetteStation({ nom, systeme, code, photo }: {
  nom: string; systeme: string; code: string; photo: string;
}) {
  const affichable = photo && /^https:\/\//i.test(photo);
  return (
    <span className={"stn-vign sys-" + (systeme || "").toLowerCase()}>
      <span className="stn-shot-gen">{code}</span>
      {affichable ? <img className="stn-shot" src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
    </span>
  );
}

// ── Le bandeau collant de la station ───────────────────────────────────────────────────────────
// Il remplace la ligne de titre, qui sortait de l'écran au premier coup de molette — après quoi
// plus rien ne disait quelle station on éditait, au milieu de 92 tuiles.
function HeroStation({ t, total, filtre, nbCorrections }: {
  t: Terminal; total: number; filtre: boolean; nbCorrections: number;
}) {
  return (
    <div className="stn-hero">
      <VignetteStation nom={t.name} systeme={t.system} code={t.code || ""} photo={t.shot || ""} />
      <div className="stn-hero-txt">
        <div className="stn-hero-line">
          <span className="stn-hero-name">{t.name}</span><BadgeSysteme system={t.system} />
          <span className="stn-hero-zone">{t.planet || "Espace profond"}</span>
          <span className="stn-hero-code">{t.code || ""}</span>
          <span className="station-count">{total} commodité{total > 1 ? "s" : ""}{filtre ? " filtrées" : ""}</span>
          {nbCorrections ? (
            <button type="button" id="stnClear" className="reset-ov" title="Effacer les corrections de cette station">
              ✕ {nbCorrections} correction{nbCorrections > 1 ? "s" : ""}
            </button>
          ) : null}
        </div>
        <div className="stn-hero-sub">
          clique un chiffre pour le corriger localement
          {/* Crédit à l'auteur de la capture, et SEULEMENT s'il existe : 97 terminaux ont une photo
              pour 89 auteurs — huit afficheraient sinon un « photo : » suivi de rien. */}
          {t.shot && t.shotBy ? <span className="stn-hero-credit">photo : {t.shotBy}</span> : null}
        </div>
      </div>
    </div>
  );
}

// ── Le retour à la valeur UEX ──────────────────────────────────────────────────────────────────
// Contrôle DÉDIÉ, posé dans la tuile et HORS du `.editv` : celui-ci porte déjà `role="button"`, et
// y imbriquer un second bouton serait invalide en ARIA. Il annonce la valeur vers laquelle il
// ramène — ce que l'ancienne liste plate ne montrait jamais.
// Il ne porte PAS de gestionnaire : la délégation d'app.js le prend déjà par ses `data-*`, et elle
// sait ce que React ignore — qu'un retour de VOLUME doit d'abord figer les jambes déjà planifiées,
// et où retrouver la date de base de la correction. Lui ajouter un onClick doublerait l'action.
function RetourUEX({ commodite, terminal, cote, champ, brut }: {
  commodite: string; terminal: string; cote: "buy" | "sell"; champ: "price" | "vol";
  brut: number | null;
}) {
  const quoi = champ === "price" ? "le prix" : cote === "buy" ? "le stock" : "la demande";
  const v = Number.isFinite(Number(brut)) ? Number(brut) : null;
  return (
    <button type="button" className="scomm-undo"
            data-c={commodite} data-t={terminal} data-s={cote} data-f={champ}
            title={`Revenir à ${quoi} publié par UEX`}>
      ↺ {fmtVol(v)}
    </button>
  );
}

export type CoteCommodite = {
  cote: "buy" | "sell";
  libelle: string; unite: string;
  prix: number | null; volume: number | null;
  prixCorrige: boolean; volumeCorrige: boolean;
  prixBrut: number | null; volumeBrut: number | null;
  releve: number;
};

export type TuileCommodite = {
  nom: string; kind: string; illegal: boolean;
  achat: boolean;
  cotes: CoteCommodite[];
};

export type ProprietesStation = {
  terminal: Terminal;
  tuiles: TuileCommodite[];
  filtre: boolean;
  nbCorrections: number;
  corriger: (commodite: string, cote: "buy" | "sell", champ: "price" | "vol", valeur: string, releve: number) => void;
};

function Tuile({ t, terminal, corriger }: {
  t: TuileCommodite; terminal: string;
} & Pick<ProprietesStation, "corriger">) {
  return (
    <div className={"scomm " + (t.achat ? "achat" : "vente")}>
      <div className="scomm-name">
        <IconeCommodite kind={t.kind} />
        <span>{t.nom}<TagIllegal illegal={t.illegal} /></span>
      </div>
      {t.cotes.map((c) => {
        const retours = [
          c.prixCorrige ? { champ: "price" as const, brut: c.prixBrut } : null,
          c.volumeCorrige ? { champ: "vol" as const, brut: c.volumeBrut } : null,
        ].filter(Boolean) as { champ: "price" | "vol"; brut: number | null }[];
        return (
          <Fragment key={c.cote}>
            <div className="scomm-side">
              <span className="scomm-lbl">{c.libelle}</span>
              <ValeurEditable valeur={c.prix} corrige={c.prixCorrige}
                              commodite={t.nom} terminal={terminal} cote={c.cote} champ="price" releve={c.releve}
                              onCorriger={(v) => corriger(t.nom, c.cote, "price", v, c.releve)} />
              {" aUEC · "}{c.unite}{" "}
              <ValeurEditable valeur={c.volume} corrige={c.volumeCorrige}
                              commodite={t.nom} terminal={terminal} cote={c.cote} champ="vol" releve={c.releve}
                              onCorriger={(v) => corriger(t.nom, c.cote, "vol", v, c.releve)} />
            </div>
            {/* Les boutons de retour vivent sur LEUR PROPRE ligne, sous les valeurs. Glissés parmi
                elles, ils comprimaient l'étiquette dans une tuile de 236 px : « aUEC · stock » se
                coupait en deux. */}
            {retours.length ? (
              <div className="scomm-undos">
                {retours.map((r) => (
                  <RetourUEX key={r.champ} commodite={t.nom} terminal={terminal} cote={c.cote}
                             champ={r.champ} brut={r.brut} />
                ))}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export function VueStation({ terminal, tuiles, filtre, nbCorrections, ...r }: ProprietesStation) {
  const achats = tuiles.filter((t) => t.achat);
  const ventes = tuiles.filter((t) => !t.achat);
  const total = tuiles.length;

  // DEUX sections : ce qu'on peut acheter ici, puis ce qu'on peut y vendre. Mesuré sur l'instantané,
  // aucune commodité n'est des deux côtés au même comptoir — mais la répartition est très
  // déséquilibrée (GrimHEX : 3 achats pour 89 ventes), et ces trois-là se perdaient au milieu.
  const Section = ({ cle, titre, aide, liste }: { cle: string; titre: string; aide: string; liste: TuileCommodite[] }) =>
    liste.length ? (
      <div className="station-section">
        <h4 className={"station-section-head " + cle}>
          ◈ {titre} <span className="station-count">{liste.length}</span>
          <span className="station-section-aide">{aide}</span>
        </h4>
        <div className="station-grid">
          {liste.map((t) => <Tuile key={t.nom + "|" + (t.achat ? "b" : "s")} t={t} terminal={terminal.name} {...r} />)}
        </div>
      </div>
    ) : null;

  return (
    <>
      <HeroStation t={terminal} total={total} filtre={filtre} nbCorrections={nbCorrections} />
      {!total ? (
        <p className="empty">Aucune commodité {filtre ? "correspondante " : ""}à {terminal.name}.</p>
      ) : (
        <>
          <Section cle="achat" titre="On y achète" aide="ce que la station te vend — prix et stock" liste={achats} />
          <Section cle="vente" titre="On y vend" aide="ce qu'elle te reprend — prix et demande" liste={ventes} />
        </>
      )}
    </>
  );
}

// ── La bande des stations corrigées ────────────────────────────────────────────────────────────
export type GroupeCorrections = {
  terminal: string; corrections: number; actif: boolean;
  /** null quand le terminal a disparu de market.json. */
  info: Terminal | null;
};

export type ProprietesBande = { groupes: GroupeCorrections[] };

export function VueBandeCorrections({ groupes }: ProprietesBande) {
  if (!groupes.length) {
    return <p className="empty">Aucune correction locale pour l'instant. Cherche une station ci-dessus pour en créer.</p>;
  }
  const autres = groupes.filter((g) => !g.actif);
  const total = groupes.reduce((s, g) => s + g.corrections, 0);

  return (
    <>
      <div className="corr-list-head">
        <span>
          ◈ {autres.length ? `${autres.length} autre${autres.length > 1 ? "s" : ""} station${autres.length > 1 ? "s" : ""} · ` : ""}
          {total} correction{total > 1 ? "s" : ""}
        </span>
        {/* L'export précède « Tout réinitialiser » — c'est l'ordre des gestes : on emporte ses
            relevés avant de les effacer. */}
        <button id="exportCorrections" className="copy-btn" title="Copier toutes les corrections locales, avec leur date de saisie et leur date UEX">⧉ Exporter</button>
        <button id="resetAll" className="reset-ov">Tout réinitialiser</button>
      </div>
      <div className="stn-band">
        {groupes.map((g) => (
          // Terminal disparu de market.json : la vignette s'affiche quand même, sinon la correction
          // deviendrait invisible ET ineffaçable. Elle n'est simplement pas cliquable.
          <button key={g.terminal} type="button"
                  className={"stn-tile" + (g.actif ? " active" : "") + (g.info ? "" : " orphelin")}
                  aria-current={g.actif ? "true" : undefined}
                  data-terminal={g.terminal} disabled={!g.info}>
            <VignetteStation nom={g.terminal} systeme={g.info ? g.info.system : ""}
                             code={g.info ? g.info.code || "" : ""} photo={g.info ? g.info.shot || "" : ""} />
            <span className="stn-tile-name">{g.terminal}</span>
            <span className="stn-tile-meta">
              {g.info ? <BadgeSysteme system={g.info.system} /> : <span className="sys">inconnu</span>}
              <b>{g.corrections}</b>
            </span>
            {g.actif ? <span className="stn-tile-flag">en cours</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export const vueStation = (p: ProprietesStation) => <VueStation {...p} />;
export const vueBandeCorrections = (p: ProprietesBande) => <VueBandeCorrections {...p} />;
export const inviteStation = () => (
  <p className="manifest-hint">Cherche une station ci-dessus pour voir et corriger ses prix et stocks.</p>
);
