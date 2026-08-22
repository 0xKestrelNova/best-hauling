// La vue Chaîne, troisième îlot React (ADR-008 #96).
//
// Ce qu'elle ajoute aux deux précédentes : des CARTES imbriquées — une chaîne porte des sauts, un
// saut porte un manifeste multi-commodités, et chaque ligne de manifeste porte son propre profit
// net. La somme des lignes affichées DOIT faire le total du saut affiché à droite, sinon
// l'incohérence saute aux yeux ; c'est pourquoi le décompte des frais passe par les MÊMES fonctions
// des deux côtés (`lineProfitText` et `manifestTotals`).
//
// La répartition suit celle des deux vues précédentes : le CALCUL vient de logic.ts (pur, testé),
// l'ÉTAT reste dans app.js — qui passe ici les seules fonctions dépendant de lui, celles des frais.
import { fmt, fmtFee } from "../format.ts";
import { Fragment } from "react";
import { manifestTotals, tripMinutes, lineNet } from "../logic.ts";
import type { Chaine, LigneManifeste, PaireFrais, Terminal } from "../types.ts";
import { IconeCommodite, TagIllegal, BadgeSysteme } from "./communs.tsx";

type Fmt = (n: number) => string;
type CelluleFrais = { mark: string; text: string };

export type ProprietesChaine = {
  chaine: Chaine;
  cargo: number;
  // `terminal(i)` résout un index en terminal : c'est MARKET qui les porte, et MARKET est une
  // globale de app.js. L'îlot ne la connaît pas, il reçoit le résolveur.
  terminal: (idx: number) => Terminal;
  // Les frais dépendent de l'état (interrupteur d'autoload, relevés par station) : app.js les
  // calcule et l'îlot n'en reçoit que le résultat.
  celluleFrais: (lignes: LigneManifeste[], fee: PaireFrais | null, a: Terminal, b: Terminal, scu: number, fees: number) => CelluleFrais;
  texteProfitLigne: (units: number, l: LigneManifeste, pair: PaireFrais | null) => string;
  /** ▶ : ajouter CETTE chaîne au voyage. Reçoit la chaîne, jamais une globale relue au clic. */
  choisirChaine: (c: Chaine) => void;
};

const classeProfit = (n: number) => (n < 0 ? "perte" : "profit");

function LigneDeSaut({ l, fee, texteProfitLigne }: {
  l: LigneManifeste; fee: PaireFrais | null;
  texteProfitLigne: ProprietesChaine["texteProfitLigne"];
}) {
  return (
    <div className="chain-line">
      <div className="commodity-cell">
        <IconeCommodite kind={l.kind} />
        <span>{l.name}<TagIllegal illegal={l.illegal} /></span>
      </div>
      <span className="chain-line-scu"><b>{fmt(l.units)}</b> SCU</span>
      <span className="chain-line-price">
        {fmt(l.buyPrice)} → {fmt(l.sellPrice)} <span className="muted">(marge {fmt(l.margin)}/SCU)</span>
      </span>
      <span className={"chain-line-profit " + classeProfit(lineNet(l.units, l, fee))}>
        {texteProfitLigne(l.units, l, fee)}
      </span>
    </div>
  );
}

export function VueChaine({ chaine, cargo, terminal, celluleFrais, texteProfitLigne, choisirChaine }: ProprietesChaine) {
  const totaux = chaine.legs.map((leg) => manifestTotals(leg.lines || [], leg.fee));
  const invest = totaux[0] ? totaux[0].invest : 0;
  const totalFees = totaux.reduce((s, t) => s + t.fees, 0);
  const totalScu = totaux.reduce((s, t) => s + t.scu, 0);

  let minutes = 0;
  for (let i = 0; i < chaine.legs.length; i++) {
    minutes += tripMinutes(0, terminal(chaine.path[i]).system !== terminal(chaine.path[i + 1]).system);
  }

  return (
    <div className="chain">
      <div className="chain-head">
        <span className="chain-path">
          {chaine.path.map((idx, i) => {
            const t = terminal(idx);
            // `Fragment` et NON un <span> englobant : `.chain-path` est un conteneur flex, et
            // envelopper ses enfants les sortirait du contexte flex — mesuré, ils passaient de
            // `display: block` à `inline`, et les espaces entre le nom et le badge disparaissaient
            // (« MegumiPYRO » au lieu de « Megumi PYRO »). Le relevé par rang l'a vu ; une
            // comparaison par classes ne l'aurait pas vu, les mêmes classes étant présentes.
            return (
              <Fragment key={i}>
                {i > 0 ? <span className="chain-arrow">→</span> : null}
                <span className="snode term">{t.name}</span>
                <BadgeSysteme system={t.system} />
              </Fragment>
            );
          })}
        </span>
        <span className="chain-tot">
          Profit <b className="profit">{fmtFee(chaine.profit, totalFees)}</b> aUEC
          {totalFees > 0 ? ` · frais ≈ ${fmt(totalFees)}` : ""}
          {" · "}{chaine.legs.length} saut{chaine.legs.length > 1 ? "s" : ""}
          {" · "}{fmt(totalScu)} SCU chargés · capital de départ {fmt(invest)} · ~{Math.round(minutes)} min
        </span>
        {/* L'id reste un CONTRAT de test (smoke.pw.mjs le clique), mais ce n'est plus lui qui porte
            le geste : le bouton reçoit un rappel fermé sur SA chaîne. Avant, une délégation posée
            sur `document` relisait `shownChain`, une globale écrite au RENDU et lue au CLIC — le
            motif que la migration élimine partout. */}
        <button id="chainToJourney" className="chain-pick" onClick={() => choisirChaine(chaine)}
                title="Ajouter cette chaîne au voyage en cours">▶ Ajouter au voyage</button>
      </div>
      <div className="chain-legs">
        {chaine.legs.map((leg, i) => {
          const a = terminal(chaine.path[i]), b = terminal(chaine.path[i + 1]);
          const t = totaux[i], lignes = leg.lines || [];
          const fc = celluleFrais(lignes, leg.fee, a, b, t.scu, t.fees);
          return (
            <div className="chain-leg" key={i}>
              <span className="chain-step">{i + 1}</span>
              <div className="chain-leg-main">
                {/* `.loc-sub` est un flex à gouttière : sans le <span> qui enveloppe le volume et
                    son plafond, la fraction se lirait « 96 /96 » — 6 px les sépareraient. */}
                <div className="loc-sub">
                  {a.name} → {b.name} · <span><b className="chain-leg-scu">{fmt(t.scu)}</b>/{fmt(cargo)} SCU</span>
                  {" · "}{lignes.length} commodité{lignes.length > 1 ? "s" : ""}
                </div>
                <div className="chain-lines">
                  {lignes.map((l, j) => (
                    <LigneDeSaut key={j} l={l} fee={leg.fee} texteProfitLigne={texteProfitLigne} />
                  ))}
                </div>
              </div>
              <span className="chain-leg-profit profit" title={fc.text || undefined}>
                +{fmtFee(leg.profit, t.fees)}
                {fc.mark ? <> <span className="nofee">⊘</span></> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const vueChaine = (p: ProprietesChaine) => <VueChaine {...p} />;

// Les messages d'attente. Ils passent par React comme le reste : une seule branche restée en
// innerHTML sur un conteneur possédé par React se ferait écraser au rendu suivant, silencieusement.
export const indice = (contenu: React.ReactNode) => <div className="manifest-hint">{contenu}</div>;

export const indiceDepart = () => indice(<>Choisis un <b>terminal de départ</b> pour calculer une chaîne rentable.</>);
export const indiceSoute = () => indice(<>Active la <b>soute (SCU)</b> pour dimensionner la chaîne.</>);
export const indiceAucune = () => indice(<>Aucune chaîne rentable depuis ce terminal avec ces filtres.</>);
