// La vue Boucles, second îlot React (ADR-008 #96).
//
// Plus exigeante que la Tournée malgré ses 73 lignes, et c'est pour ça qu'elle vient en second :
// elle exerce trois choses que la Tournée n'avait pas.
//
//   1. Elle rend des LIGNES INTERACTIVES. Le ▶ recevait son rang par `data-row`, qu'une délégation
//      posée sur `document` relisait dans `shownLoops` — un tableau rempli au RENDU et relu au
//      CLIC. Il reçoit désormais un rappel fermé sur SA boucle : plus de rang, plus de globale.
//   2. Elle vit dans un `<tbody>` dont le `<thead>` reste VANILLA (index.html), avec ses
//      `th[data-sort-loop]` câblés par `setupLoopSort`. React ne possède que le corps du tableau.
//   3. Ses cellules passent par des aides PARTAGÉES avec d'autres vues — d'où `communs.tsx`.
//
// Ce qui reste dans app.js, et doit y rester tant que Trajets n'est pas migrée : l'écriture de
// `#empty`, le `<p>` de message vide PARTAGÉ par Trajets, Boucles et « En route ». Le déplacer ici
// le ferait disparaître des deux autres vues.
import type { Boucle } from "../types.ts";
import { BadgeSysteme, TagAvantPoste, TagIllegal, IconeCommodite, PastilleFraicheur, CelluleFiabilite } from "./communs.tsx";

type Fmt = (n: number) => string;

// Ce que `feeCell` (app.js) rend déjà : un title, un marqueur, et le texte brut. On le reçoit tel
// quel plutôt que de le recalculer — c'est app.js qui connaît le contexte de frais, et le
// dupliquer ferait diverger deux façons de dire le même montant.
type CelluleFrais = { attr: string; mark: string; text: string };

// La boucle ÉVALUÉE : la ligne de data/loops.json enrichie par `evaluateLoop` (app.js) des champs
// que `loopMetrics` calcule. `_fromHere` est posé par la vue quand la boucle part de la fin du
// parcours en cours — elle remonte alors en tête, sans être filtrée.
export type BoucleEvaluee = Boucle & {
  cross: boolean;
  fiabilite: number; age: number | null; partVolume: number;
  units: number | null; unitsOut: number; unitsBack: number;
  profit: number; profitHour: number; minutes: number; fees: number;
  feeInfo: unknown;
  _fromHere?: boolean;
};

export type ProprietesBoucles = {
  lignes: BoucleEvaluee[];
  fmt: Fmt;
  // Les trois fonctions que app.js garde : elles connaissent l'état des frais, que l'îlot ignore.
  celluleFrais: (l: BoucleEvaluee) => CelluleFrais;
  fmtFee: (n: number, fees: number) => string;
  avecTexteFrais: (base: string, cell: CelluleFrais) => string;
  /** ▶ : ajouter cette boucle au voyage. Reçoit LA boucle, jamais son rang. */
  choisirBoucle: (l: BoucleEvaluee) => void;
};

function LigneBoucle({ l, fmt, celluleFrais, fmtFee, avecTexteFrais, choisirBoucle }: {
  l: BoucleEvaluee; fmt: Fmt;
  celluleFrais: ProprietesBoucles["celluleFrais"];
  fmtFee: ProprietesBoucles["fmtFee"];
  avecTexteFrais: ProprietesBoucles["avecTexteFrais"];
  choisirBoucle: ProprietesBoucles["choisirBoucle"];
}) {
  const fc = celluleFrais(l);
  // Le title des frais arrive déjà échappé depuis app.js (` title="…"`). React échappe de son côté,
  // donc on prend le TEXTE et on laisse React poser l'attribut — sinon on afficherait les guillemets.
  const titreFrais = fc.text || undefined;

  // La fraîcheur de la boucle est celle du plus ANCIEN des deux relevés : une boucle ne vaut pas
  // mieux que sa jambe la moins sûre.
  const releve = l.out.updated && l.back.updated
    ? Math.min(l.out.updated, l.back.updated)
    : l.out.updated || l.back.updated || 0;

  return (
    <tr className={l._fromHere ? "from-here" : undefined}>
      <td className="loc loop-cell">
        <button className="journey-pick" onClick={() => choisirBoucle(l)} title="Ajouter cette boucle au voyage" aria-label="Ajouter au voyage">▶</button>
        <div className="loop-ends">
          <div className="loop-end">
            <span className="term-name">{l.a.terminal}</span>
            <BadgeSysteme system={l.a.system} />
            <TagAvantPoste outpost={l.a.outpost} />
          </div>
          <div className="loop-mid">
            <span className="loop-arrow">⇄</span>
            {l.cross ? <span className="cross">⚡ inter-système</span> : null}
          </div>
          <div className="loop-end">
            <span className="term-name">{l.b.terminal}</span>
            <BadgeSysteme system={l.b.system} />
            <TagAvantPoste outpost={l.b.outpost} />
          </div>
          <div className="loc-fresh"><PastilleFraicheur updated={releve} /></div>
        </div>
      </td>
      <td>
        <div className="commodity-cell">
          <IconeCommodite kind={l.out.kind} />
          <span>{l.out.commodity}<TagIllegal illegal={l.out.illegal} /></span>
        </div>
        <div className="loc-sub">{fmt(l.out.buyPrice)} → {fmt(l.out.sellPrice)} · marge {fmt(l.out.margin)}</div>
      </td>
      <td>
        <div className="commodity-cell">
          <IconeCommodite kind={l.back.kind} />
          <span>{l.back.commodity}<TagIllegal illegal={l.back.illegal} /></span>
        </div>
        <div className="loc-sub">{fmt(l.back.buyPrice)} → {fmt(l.back.sellPrice)} · marge {fmt(l.back.margin)}</div>
      </td>
      <td><CelluleFiabilite f={l.fiabilite} age={l.age} part={l.partVolume} /></td>
      <td className="num">{fmt(l.loopMargin)}</td>
      <td className="num">{l.units == null ? "—" : fmt(l.unitsOut) + " + " + fmt(l.unitsBack)}</td>
      <td className="num profit" title={titreFrais}>
        {fmtFee(l.profit, l.fees)}
        {fc.mark ? <> <span className="nofee">⊘</span></> : null}
      </td>
      <td className="num profit" title={avecTexteFrais(`Estimation ${Math.round(l.minutes)} min/boucle`, fc)}>
        {fmtFee(l.profitHour, l.fees)}
      </td>
    </tr>
  );
}

export function VueBoucles({ lignes, fmt, celluleFrais, fmtFee, avecTexteFrais, choisirBoucle }: ProprietesBoucles) {
  return (
    <>
      {lignes.map((l, i) => (
        <LigneBoucle key={i} l={l} fmt={fmt} celluleFrais={celluleFrais} fmtFee={fmtFee}
                     avecTexteFrais={avecTexteFrais} choisirBoucle={choisirBoucle} />
      ))}
    </>
  );
}

export const vueBoucles = (p: ProprietesBoucles) => <VueBoucles {...p} />;
