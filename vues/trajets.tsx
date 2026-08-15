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
import type { Route } from "../types.ts";
import { BadgeSysteme, TagAvantPoste, TagIllegal, IconeCommodite, PastilleFraicheur, CelluleFiabilite, ValeurEditable, PastilleStatut } from "./communs.tsx";

type Fmt = (n: number) => string;
type CelluleFrais = { attr: string; mark: string; text: string };

export type ProprietesCommunes = {
  fmt: Fmt;
  fmtVol: (n: number | null) => string;
  fmtFee: (n: number, fees: number) => string;
  avecTexteFrais: (base: string, cell: CelluleFrais) => string;
  texteCapaciteInconnue: string;
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
};

function BoutonVoyage({ i }: { i: number }) {
  // `data-row` est un CONTRAT : une délégation posée sur `document` lit `shownRoutes[dataset.row]`.
  return (
    <button className="journey-pick" data-row={i} title="Faire ce trajet — compagnon de voyage" aria-label="Sélectionner ce trajet">▶</button>
  );
}

function LigneSimple({ r, i, celluleFrais, suspect, libelleCaisses, ...c }: {
  r: LigneTrajet; i: number;
  celluleFrais: ProprietesTrajets["celluleFrais"];
  suspect: ProprietesTrajets["suspect"];
  libelleCaisses: ProprietesTrajets["libelleCaisses"];
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
      <ValeurEditable valeur={valeur ?? null} corrige={corrige} fmtVol={c.fmtVol}
                      commodite={r.commodity} terminal={p.terminal} cote={cote} champ={champ} releve={p.updated}
                      texteCapaciteInconnue={c.texteCapaciteInconnue}
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
    <tr data-row={i}>
      <td className="loc">
        <div className="commodity-cell">
          <BoutonVoyage i={i} />
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
      <td className="num" title={titreFrais}>{c.fmtFee(r.margin, r.fees)}</td>
      <td className="num roi-badge" title={titreFrais}>{r.fees > 0 ? "≈ " : ""}{r.roi}%</td>
      <td className="num" title={caisses ? `Caisses : ${caisses}` : undefined}>{c.fmt(r.units)}</td>
      <td className="num">{c.fmt(r.investment)}</td>
      <td className="num profit" title={titreFrais}>
        {c.fmtFee(r.profit, r.fees)}
        {fc.mark ? <> <span className="nofee">⊘</span></> : null}
      </td>
      <td className="num profit" title={c.avecTexteFrais(`Estimation ${Math.round(r.minutes)} min/voyage`, fc)}>
        {c.fmtFee(r.profitHour, r.fees)}
      </td>
    </tr>
  );
}

export function VueTrajets({ lignes, celluleFrais, suspect, libelleCaisses, ...c }: ProprietesTrajets) {
  return (
    <>
      {lignes.map((r, i) => (
        <LigneSimple key={i} r={r} i={i} celluleFrais={celluleFrais} suspect={suspect} libelleCaisses={libelleCaisses} {...c} />
      ))}
    </>
  );
}

// ── Mode MULTI-COMMODITÉ ───────────────────────────────────────────────────────────────────────
export type LigneMulti = {
  origin: { name: string; system: string; planet: string; outpost: boolean; maxBox?: number };
  dest: { name: string; system: string; planet: string; outpost: boolean };
  lines: { name: string; kind: string; units: number; illegal: boolean }[];
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
};

const MAX_ICONES = 6;

function LigneComposee({ t, i, celluleFrais, libelleCaisses, releveLePlusAncien, ...c }: {
  t: LigneMulti; i: number;
  celluleFrais: ProprietesMulti["celluleFrais"];
  libelleCaisses: ProprietesMulti["libelleCaisses"];
  releveLePlusAncien: ProprietesMulti["releveLePlusAncien"];
} & ProprietesCommunes) {
  const n = t.lines.length;
  const fc = celluleFrais(t);
  const titreFrais = fc.text || undefined;
  const caisses = libelleCaisses(t);
  const noms = t.lines.map((l) => `${l.name} (${c.fmt(l.units)} SCU)`).join(" · ");

  const bout = (p: LigneMulti["origin"] | LigneMulti["dest"], fraicheur: number | null) => (
    <td className="loc">
      <div className="term-name">{p.name}</div>
      <div className="loc-badges"><BadgeSysteme system={p.system} /><TagAvantPoste outpost={p.outpost} /></div>
      <div className="loc-sub">{p.planet}</div>
      {fraicheur != null ? <div className="loc-fresh"><PastilleFraicheur updated={fraicheur} /></div> : null}
    </td>
  );

  return (
    <tr data-row={i}>
      <td className="loc">
        <div className="commodity-cell">
          <BoutonVoyage i={i} />
          {/* `.route-toggle` déplie le chargement. Sa délégation lit `shownMulti[dataset.row]` :
              l'index doit correspondre au rang, comme pour `.journey-pick`. */}
          <button className="route-toggle" data-row={i} title="Voir le chargement" aria-label="Voir le chargement">📦</button>
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
      <td className="num" title={c.avecTexteFrais("Marge moyenne pondérée par SCU chargé", fc)}>{c.fmtFee(t.margin, t.fees)}</td>
      <td className="num roi-badge" title={titreFrais}>{t.fees > 0 ? "≈ " : ""}{t.roi}%</td>
      <td className="num" title={caisses ? `Caisses : ${caisses}` : undefined}>{c.fmt(t.units)}</td>
      <td className="num">{c.fmt(t.investment)}</td>
      <td className="num profit" title={titreFrais}>
        {c.fmtFee(t.profit, t.fees)}
        {fc.mark ? <> <span className="nofee">⊘</span></> : null}
      </td>
      <td className="num profit" title={c.avecTexteFrais(`Estimation ${Math.round(t.minutes)} min/voyage`, fc)}>
        {c.fmtFee(t.profitHour, t.fees)}
      </td>
    </tr>
  );
}

export function VueTrajetsMulti({ lignes, celluleFrais, libelleCaisses, releveLePlusAncien, ...c }: ProprietesMulti) {
  return (
    <>
      {lignes.map((t, i) => (
        <LigneComposee key={i} t={t} i={i} celluleFrais={celluleFrais} libelleCaisses={libelleCaisses}
                       releveLePlusAncien={releveLePlusAncien} {...c} />
      ))}
    </>
  );
}

export const vueTrajets = (p: ProprietesTrajets) => <VueTrajets {...p} />;
export const vueTrajetsMulti = (p: ProprietesMulti) => <VueTrajetsMulti {...p} />;
