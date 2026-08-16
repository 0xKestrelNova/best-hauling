// La vue Trajets, septième îlot React (ADR-008 #96) — et la vue par DÉFAUT.
//
// C'est celle que 74 tests e2e traversent explicitement, plus 49 qui n'en changent jamais : la
// moindre divergence y est visible partout. Elle a deux modes qui partagent le même `<tbody>` :
//   — SIMPLE   : une ligne = un couple achat/vente d'UNE commodité, avec ses valeurs éditables ;
//   — MULTI    : une ligne = un chargement A→B composé de PLUSIEURS commodités, dépliable.
//
// Ce qui reste à app.js et n'a jamais été un obstacle : `#empty`, le <p> de message vide PARTAGÉ
// par Trajets, Boucles et « En route ». Il n'est écrit que par `textContent` et `hidden` — jamais
// en HTML — donc aucun îlot ne le possède et il n'entre en conflit avec rien. Le migrer n'aurait
// rien apporté.
//
// Le `<thead>` et son tri restent eux aussi dans index.html, câblés par `setupSort` : React ne
// possède que le corps du tableau, comme pour Boucles.
import { TEXTE_CAPACITE_INCONNUE, fmt, fmtFee, fmtVol } from "../format.ts";
import { useState } from "react";
import type { LigneManifeste, PaireFrais, Route } from "../types.ts";
import { BadgeSysteme, TagAvantPoste, TagIllegal, IconeCommodite, PastilleFraicheur, CelluleFiabilite, ValeurEditable, PastilleStatut } from "./communs.tsx";

type Fmt = (n: number) => string;
type CelluleFrais = { attr: string; mark: string; text: string };

export type ProprietesCommunes = {
  avecTexteFrais: (base: string, cell: CelluleFrais) => string;
  legendeAchat: Record<number, [string, string]>;
  legendeVente: Record<number, [string, string]>;
  corriger: (commodite: string, terminal: string, cote: "buy" | "sell", champ: "price" | "vol", valeur: string, releve: number) => void;
};

// ── Mode SIMPLE ────────────────────────────────────────────────────────────────────────────────
export type LigneTrajet = Route & {
  fiabilite: number; age: number | null; partVolume: number;
  units: number; investment: number; profit: number; profitHour: number; minutes: number; fees: number;
  feeInfo: unknown;
  buy: Route["buy"] & { ovPrice: boolean; ovVol: boolean };
  sell: Route["sell"] & { ovPrice: boolean; ovVol: boolean };
};

export type ProprietesTrajets = ProprietesCommunes & {
  lignes: LigneTrajet[];
  celluleFrais: (r: LigneTrajet) => CelluleFrais;
  /** « ⚠ à vérifier » : relevé de plus de 10 jours, ou prix très éloigné de la moyenne UEX. */
  suspect: (r: LigneTrajet) => string | null;
  /** Le libellé des caisses, qui dépend du plafond du terminal d'ACHAT — propriété physique de la
   *  station, lue du marché et non du contexte de frais (sans quoi elle disparaît quand
   *  l'interrupteur d'autoload est relâché). */
  libelleCaisses: (r: LigneTrajet) => string | null;
  /** ▶ : faire ce trajet. Reçoit LA ligne, jamais son rang — voir `BoutonVoyage`. */
  choisirTrajet: (r: LigneTrajet) => void;
};

// La CLASSE reste le contrat — 28 clics e2e passaient par elle avant ce lot — mais le rang a
// disparu du bouton, qui est fermé sur SA ligne : il ne peut plus désigner autre chose. C'est ce
// qui remplace `shownRoutes[dataset.row]`, un tableau rempli au RENDU et relu au CLIC.
function BoutonVoyage({ choisir }: { choisir: () => void }) {
  return (
    <button className="journey-pick" onClick={choisir} title="Faire ce trajet — compagnon de voyage" aria-label="Sélectionner ce trajet">▶</button>
  );
}

function LigneSimple({ r, celluleFrais, suspect, libelleCaisses, choisirTrajet, ...c }: {
  r: LigneTrajet;
  celluleFrais: ProprietesTrajets["celluleFrais"];
  suspect: ProprietesTrajets["suspect"];
  libelleCaisses: ProprietesTrajets["libelleCaisses"];
  choisirTrajet: ProprietesTrajets["choisirTrajet"];
} & ProprietesCommunes) {
  const fc = celluleFrais(r);
  const titreFrais = fc.text || undefined;
  const alerte = suspect(r);
  const caisses = libelleCaisses(r);

  const bout = (cote: "buy" | "sell") => {
    // Le champ de volume porte un NOM différent selon le côté — `stock` à l'achat, `demand` à la
    // vente — et ce ne sont pas la même chose : `demand: null` veut dire « capacité inconnue chez
    // UEX », ni zéro ni illimitée. Le tuple est donc lu côté par côté.
    const p = cote === "buy" ? r.buy : r.sell;
    const volume = cote === "buy" ? r.buy.stock : r.sell.demand;
    const editable = (champ: "price" | "vol", valeur: number | null | undefined, corrige: boolean) => (
      <ValeurEditable valeur={valeur ?? null} corrige={corrige}
                      commodite={r.commodity} terminal={p.terminal} cote={cote} champ={champ} releve={p.updated}
                      onCorriger={(v) => c.corriger(r.commodity, p.terminal, cote, champ, v, p.updated)} />
    );
    return (
      <td className="loc">
        <div className="term-name">{p.terminal}</div>
        <div className="loc-badges"><BadgeSysteme system={p.system} /><TagAvantPoste outpost={p.outpost} /></div>
        <div className="loc-sub">
          {p.planet} · {editable("price", p.price, p.ovPrice)} aUEC ·{" "}
          <PastilleStatut code={p.status} cote={cote} legende={cote === "buy" ? c.legendeAchat : c.legendeVente} />
          <span className="stock" title={cote === "buy"
            ? "Stock disponible à l'achat (relevé UEX)"
            : "Demande à la vente = capacité restante du terminal (relevé UEX)"}>
            {cote === "buy" ? "stock " : "demande "}{editable("vol", volume, p.ovVol)} SCU
          </span>
        </div>
        <div className="loc-fresh"><PastilleFraicheur updated={p.updated} /></div>
      </td>
    );
  };

  return (
    <tr>
      <td className="loc">
        <div className="commodity-cell">
          <BoutonVoyage choisir={() => choisirTrajet(r)} />
          <IconeCommodite kind={r.kind} />
          <span className="cname">{r.commodity}</span>
        </div>
        <div className="loc-badges">
          <TagIllegal illegal={r.illegal} />
          {alerte ? <> <span className="suspect" title={`À vérifier en jeu : ${alerte}`}>⚠ à vérifier</span></> : null}
          {r.same_system ? null : <span className="cross">⚡ saut inter-système</span>}
        </div>
      </td>
      {bout("buy")}
      {bout("sell")}
      <td><CelluleFiabilite f={r.fiabilite} age={r.age} part={r.partVolume} /></td>
      <td className="num" title={titreFrais}>{fmtFee(r.margin, r.fees)}</td>
      <td className="num roi-badge" title={titreFrais}>{r.fees > 0 ? "≈ " : ""}{r.roi}%</td>
      <td className="num" title={caisses ? `Caisses : ${caisses}` : undefined}>{fmt(r.units)}</td>
      <td className="num">{fmt(r.investment)}</td>
      <td className="num profit" title={titreFrais}>
        {fmtFee(r.profit, r.fees)}
        {fc.mark ? <> <span className="nofee">⊘</span></> : null}
      </td>
      <td className="num profit" title={c.avecTexteFrais(`Estimation ${Math.round(r.minutes)} min/voyage`, fc)}>
        {fmtFee(r.profitHour, r.fees)}
      </td>
    </tr>
  );
}

export function VueTrajets({ lignes, celluleFrais, suspect, libelleCaisses, choisirTrajet, ...c }: ProprietesTrajets) {
  return (
    <>
      {lignes.map((r, i) => (
        <LigneSimple key={i} r={r} celluleFrais={celluleFrais} suspect={suspect}
                     libelleCaisses={libelleCaisses} choisirTrajet={choisirTrajet} {...c} />
      ))}
    </>
  );
}

// ── Mode MULTI-COMMODITÉ ───────────────────────────────────────────────────────────────────────
export type LigneMulti = {
  origin: { name: string; system: string; planet: string; outpost: boolean; maxBox?: number };
  dest: { name: string; system: string; planet: string; outpost: boolean };
  /** Le chargement ENTIER, et non les quatre champs de la pastille : le dépliant lit aussi le
   *  stock, la demande, les deux prix et la marge. Il était nourri par un gabarit d'app.js, qui
   *  lisait le même objet — c'est le type qui était trop étroit, pas la donnée qui manquait. */
  lines: LigneManifeste[];
  /** Les deux index du couple. Ils font la CLÉ STABLE d'une ligne : `multiTrips` ne produit qu'un
   *  trajet par couple origine/destination, alors que le rang, lui, change à chaque tri. */
  originIdx: number; destIdx: number;
  fee: PaireFrais | null;
  cargo: number;
  cross: boolean;
  fiabilite: number; age: number | null; partVolume: number;
  margin: number; roi: number; units: number; investment: number;
  profit: number; profitHour: number; minutes: number; fees: number;
  feeInfo: unknown;
};

export type ProprietesMulti = ProprietesCommunes & {
  lignes: LigneMulti[];
  celluleFrais: (t: LigneMulti) => CelluleFrais;
  libelleCaisses: (t: LigneMulti) => string | null;
  /** Le relevé le plus ANCIEN du chargement : un trajet ne vaut pas mieux que sa ligne la moins sûre. */
  releveLePlusAncien: (t: LigneMulti) => number;
  /** Ce que rapporte UNE ligne du chargement, frais compris. Reste à app.js : dépend du contexte
   *  de frais, que l'îlot ne connaît pas. */
  texteProfitLigne: (units: number, l: LigneManifeste, fee: PaireFrais | null) => string;
  /** « 8×32 · 1×16 · … » — dépend du plafond de caisse du terminal d'achat. */
  libelleCaissesScu: (units: number, maxBox?: number) => string;
  /** ▶ : faire ce chargement. À passer EXPLICITEMENT — `propsLignesSimples()` d'app.js, qui porte
   *  celui des lignes simples, n'est PAS étalée ici. */
  choisirTrajet: (t: LigneMulti) => void;
};

/** L'identité d'un trajet, indépendante de son RANG. C'est ce qui fait qu'un dépliant ouvert suit
 *  sa ligne quand le classement change, au lieu de rester en place et de décrire un autre trajet
 *  (#125). `multiTrips` groupe par destination et boucle sur les origines : le couple est unique. */
const cleTrajet = (t: LigneMulti) => `${t.originIdx}->${t.destIdx}`;

const MAX_ICONES = 6;

/** Les colonnes d'une ligne multi, que le dépliant doit enjamber d'un `colSpan`. Le gabarit lisait
 *  `tr.children.length` sur le nœud déjà posé ; ici la ligne est écrite juste en dessous, et ses
 *  `<td>` se comptent à l'œil : loc, origine, destination, fiabilité, marge, ROI, SCU, invest,
 *  profit, profit/h. */
const COLONNES = 10;

// Le chargement déplié, en FRÈRE de sa ligne — une `<tr>` de plus, comme le faisait le gabarit.
// Il était injecté à la main dans `#rows` par `insertAdjacentHTML` alors que React possède ce
// `<tbody>` : React n'en savait rien, ne le déplaçait pas au re-tri et ne l'effaçait pas au
// changement de mode. Il survivait donc aux rendus en devenant faux (#125). Rendu ici, il n'a plus
// d'existence propre : il est une conséquence de l'état, comme le reste du tableau.
function ChargementDeplie({ t, colonnes, texteProfitLigne, libelleCaissesScu }: {
  t: LigneMulti; colonnes: number;
  texteProfitLigne: ProprietesMulti["texteProfitLigne"];
  libelleCaissesScu: ProprietesMulti["libelleCaissesScu"];
}) {
  return (
    <tr className="schema-row">
      <td colSpan={colonnes}>
        <div className="multi-cargo">
          <div className="suggest-head">{`Chargement — ${t.lines.length} commodité${t.lines.length > 1 ? "s" : ""}, ${fmt(t.units)}/${fmt(t.cargo)} SCU`}</div>
          {t.lines.map((l, k) => (
            <div className="sline" key={k}>
              <IconeCommodite kind={l.kind} />
              <span className="mname">{l.name}<TagIllegal illegal={l.illegal} /></span>
              <span className="mstock">{`stock ${fmt(l.stock as number)} · dem. ${fmtVol(l.demand as number | null)}`}</span>
              <span className="mprice">{`${fmt(l.buyPrice)} → ${fmt(l.sellPrice)} · marge ${fmt(l.margin)}`}</span>
              <span className="mprofit profit">{texteProfitLigne(l.units, l, t.fee)}</span>
              <span className="mboxes" title="Caisses SCU standard à charger">{`📦 ${fmt(l.units)} SCU · ${libelleCaissesScu(l.units, t.origin.maxBox)}`}</span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

function LigneComposee({ t, celluleFrais, libelleCaisses, releveLePlusAncien, texteProfitLigne, libelleCaissesScu, choisirTrajet, deplie, basculer, ...c }: {
  t: LigneMulti;
  celluleFrais: ProprietesMulti["celluleFrais"];
  libelleCaisses: ProprietesMulti["libelleCaisses"];
  releveLePlusAncien: ProprietesMulti["releveLePlusAncien"];
  texteProfitLigne: ProprietesMulti["texteProfitLigne"];
  libelleCaissesScu: ProprietesMulti["libelleCaissesScu"];
  choisirTrajet: ProprietesMulti["choisirTrajet"];
  deplie: boolean;
  basculer: () => void;
} & ProprietesCommunes) {
  const n = t.lines.length;
  const fc = celluleFrais(t);
  const titreFrais = fc.text || undefined;
  const caisses = libelleCaisses(t);
  const noms = t.lines.map((l) => `${l.name} (${fmt(l.units)} SCU)`).join(" · ");

  const bout = (p: LigneMulti["origin"] | LigneMulti["dest"], fraicheur: number | null) => (
    <td className="loc">
      <div className="term-name">{p.name}</div>
      <div className="loc-badges"><BadgeSysteme system={p.system} /><TagAvantPoste outpost={p.outpost} /></div>
      <div className="loc-sub">{p.planet}</div>
      {fraicheur != null ? <div className="loc-fresh"><PastilleFraicheur updated={fraicheur} /></div> : null}
    </td>
  );

  const ligne = (
    <tr>
      <td className="loc">
        <div className="commodity-cell">
          <BoutonVoyage choisir={() => choisirTrajet(t)} />
          {/* La classe `open` est DÉRIVÉE de l'état, et n'est plus posée à la main sur le nœud :
              c'est ce qui la faisait survivre à un re-rendu, React ne réécrivant jamais un
              `className` littéral constant (#125). */}
          <button
            className={deplie ? "route-toggle open" : "route-toggle"}
            onClick={basculer}
            title="Voir le chargement"
            aria-label="Voir le chargement"
            aria-expanded={deplie}
          >📦</button>
          <span className="multi-icons" title={noms}>
            {t.lines.slice(0, MAX_ICONES).map((l, k) => <IconeCommodite key={k} kind={l.kind} />)}
            {n > MAX_ICONES ? <span className="muted">+{n - MAX_ICONES}</span> : null}
          </span>
          {/* UNE seule expression, et non `{n} commodité{n > 1 ? "s" : ""}` : cette forme-là produit
              TROIS nœuds de texte (« 3 », «  commodité », « s ») là où le gabarit n'en produisait
              qu'un. Le crénage ne traverse pas une frontière de nœud, et la largeur du span y perdait
              1/32 px — mesuré sur les 300 lignes du mode multi, contre zéro écart partout ailleurs. */}
          <span className="cname">{`${n} commodité${n > 1 ? "s" : ""}`}</span>
        </div>
        <div className="loc-badges">
          {t.lines.some((l) => l.illegal) ? <TagIllegal illegal={true} /> : null}
          {t.cross ? <span className="cross">⚡ saut inter-système</span> : null}
        </div>
      </td>
      {bout(t.origin, releveLePlusAncien(t))}
      {bout(t.dest, null)}
      <td><CelluleFiabilite f={t.fiabilite} age={t.age} part={t.partVolume} /></td>
      <td className="num" title={c.avecTexteFrais("Marge moyenne pondérée par SCU chargé", fc)}>{fmtFee(t.margin, t.fees)}</td>
      <td className="num roi-badge" title={titreFrais}>{t.fees > 0 ? "≈ " : ""}{t.roi}%</td>
      <td className="num" title={caisses ? `Caisses : ${caisses}` : undefined}>{fmt(t.units)}</td>
      <td className="num">{fmt(t.investment)}</td>
      <td className="num profit" title={titreFrais}>
        {fmtFee(t.profit, t.fees)}
        {fc.mark ? <> <span className="nofee">⊘</span></> : null}
      </td>
      <td className="num profit" title={c.avecTexteFrais(`Estimation ${Math.round(t.minutes)} min/voyage`, fc)}>
        {fmtFee(t.profitHour, t.fees)}
      </td>
    </tr>
  );

  return deplie
    ? <>{ligne}<ChargementDeplie t={t} colonnes={COLONNES} texteProfitLigne={texteProfitLigne} libelleCaissesScu={libelleCaissesScu} /></>
    : ligne;
}

export function VueTrajetsMulti({ lignes, celluleFrais, libelleCaisses, releveLePlusAncien, texteProfitLigne, libelleCaissesScu, choisirTrajet, ...c }: ProprietesMulti) {
  // L'état du dépliant vit ICI, dans l'îlot, et il est porté par la CLÉ du trajet — jamais par son
  // rang. Un `Set` et non un seul ouvert : rien n'a jamais empêché d'en déplier plusieurs, et ce
  // correctif n'est pas l'endroit pour changer ça.
  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set());
  const basculer = (cle: string) =>
    setOuverts((avant) => {
      const apres = new Set(avant);
      if (!apres.delete(cle)) apres.add(cle);
      return apres;
    });

  return (
    <>
      {lignes.map((t) => {
        const cle = cleTrajet(t);
        return (
          <LigneComposee key={cle} t={t} celluleFrais={celluleFrais} libelleCaisses={libelleCaisses}
                         releveLePlusAncien={releveLePlusAncien} texteProfitLigne={texteProfitLigne}
                         libelleCaissesScu={libelleCaissesScu} choisirTrajet={choisirTrajet}
                         deplie={ouverts.has(cle)} basculer={() => basculer(cle)} {...c} />
        );
      })}
    </>
  );
}

export const vueTrajets = (p: ProprietesTrajets) => <VueTrajets {...p} />;
export const vueTrajetsMulti = (p: ProprietesMulti) => <VueTrajetsMulti {...p} />;
