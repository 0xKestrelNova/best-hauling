// La vue Plan de vol, sixième îlot React (ADR-008 #96).
//
// C'est une CONCLUSION, pas un tableau de bord (ADR-004) : on y arrive une fois tout paramétré,
// pour REGARDER le résultat. Rien n'y est actionnable — pas un bouton de vente, pas un ✕, pas un
// champ. Un seul bouton, celui qui copie le récapitulatif, et il ne modifie rien.
//
// Cette propriété la rend simple à migrer malgré ses 230 lignes : aucun état local, aucune
// délégation propre, aucune valeur éditable. Elle n'a que du rendu.
//
// La carte SVG du parcours reste HORS de cet îlot : `#journeyMap` vit entre `#planHead` et
// `#planBody` (et non dedans), parce qu'un élément à écouteurs directs se déménage en FRÈRE, jamais
// en enfant d'un conteneur réécrit — c'est la leçon de #24, rappelée par l'ADR-004.
import { fmt, signe } from "../format.ts";
import { Fragment } from "react";
import { IconeCommodite } from "./communs.tsx";

type Fmt = (n: number) => string;

export type GroupeSoute = { name: string; units: number; paidMoyen: number; lots: unknown[] };
export type LigneJambe = { name: string; kind: string; units: number };
export type JambePlan = {
  i: number; from: string; to: string;
  scu: number; profit: number; fees: number;
  faite: boolean; courante: boolean; chargee: boolean;
  lines: LigneJambe[];
};

export type DonneesPlan = {
  hypotheses: string[];
  stations: { name: string; system: string }[];
  courante: number;
  jambes: JambePlan[];
  groupes: GroupeSoute[];
  scu: number; libre: number | null; invest: number;
  totalScu: number; totalProfit: number; totalFees: number;
  reste: number; nbSauts: number;
  /** La capacité qui sert de dénominateur aux barres de soute — voir plus bas. */
  base: number;
  /** Le marché n'est pas encore là : les manifestes par jambe ne sont pas calculables. */
  marchePret: boolean;
  /** Le `kind` d'une commodité, pour son icône. app.js le résout : MARKET est une globale. */
  kindDe: (nom: string) => string | null;
  fmtProfit: (n: number, fees: number) => string;
};

const classeProfit = (n: number) => (n < 0 ? "perte" : "profit");

export function EnTetePlan({ hypotheses }: { hypotheses: string[] }) {
  return (
    <>
      <div className="plan-title">
        <span className="plan-kicker">◈ Plan de vol</span>
        <button id="planCopy" className="plan-copy" type="button" title="Copier le récapitulatif en texte, à coller dans un salon">
          ⧉ Copier le récapitulatif
        </button>
      </div>
      {/* Les quatre réglages qui ne FILTRENT pas mais changent le SENS des chiffres (ADR-004 §6),
          repris ici en lecture seule : une conclusion énonce ses hypothèses au lieu de les offrir
          à la modification. Les taire la rendrait silencieusement ambiguë — on lirait un profit
          sans savoir s'il est net. */}
      <div className="plan-hyp" id="planHypotheses"
           title="Ces quatre réglages changent le sens des chiffres ci-dessous. Pour les modifier, retourne dans une vue de recherche.">
        {hypotheses.join(" · ")}
      </div>
    </>
  );
}

function CarteSoute({ d }: { d: DonneesPlan }) {
  if (!d.groupes.length) {
    return (
      <div className="plan-card" id="planHold">
        <div className="plan-card-head">◈ Soute</div>
        <p className="plan-muted">Rien à bord. Charge un manifeste depuis une jambe, ou déclare ce que tu transportes depuis le bandeau d'une vue de recherche.</p>
      </div>
    );
  }
  return (
    <div className="plan-card" id="planHold">
      <div className="plan-card-head">◈ Soute</div>
      <div className="plan-hold-lines">
        {d.groupes.map((g) => {
          // La part de soute occupée est rapportée à la CAPACITÉ quand elle est connue, au
          // chargement sinon : une barre sans dénominateur ne voudrait rien dire.
          const part = d.base > 0 ? Math.min(100, (g.units / d.base) * 100) : 0;
          const kind = d.kindDe(g.name);
          return (
            <div className="plan-hold-line" key={g.name}>
              <span className="plan-hold-name">
                {kind ? <IconeCommodite kind={kind} /> : null}
                <span>{g.name}</span>
              </span>
              <span className="plan-hold-bar" aria-hidden="true"><i style={{ width: part.toFixed(1) + "%" }} /></span>
              <span className="plan-hold-scu"><b>{fmt(g.units)}</b> SCU</span>
              <span className="plan-hold-paid" title={"Prix payé au SCU" + (g.lots.length > 1 ? " (moyenne des lots)" : "")}>
                @ {fmt(Math.round(g.paidMoyen))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="plan-card-meta">
        <b>{fmt(d.scu)}</b> SCU à bord
        {d.libre != null ? <> · <b>{fmt(d.libre)}</b> SCU libres</> : null}
        {" · capital engagé "}<b>{fmt(d.invest)}</b> aUEC
      </div>
    </div>
  );
}

function CarteParcours({ d }: { d: DonneesPlan }) {
  if (!d.stations.length && !d.jambes.length && !d.nbSauts) {
    return (
      <div className="plan-card" id="planRoute">
        <div className="plan-card-head">◈ Parcours</div>
        <p className="plan-muted">Aucun voyage engagé. Démarre-en un depuis <b>Trajets</b> — le ▶ d'une ligne — ou de zéro en posant un point de départ dans le bandeau.</p>
      </div>
    );
  }
  return (
    <div className="plan-card" id="planRoute">
      <div className="plan-card-head">◈ Parcours</div>
      <div className="plan-path">
        {d.stations.map((s, i) => (
          // `Fragment` et non un <span> englobant : `.plan-path` est un conteneur flex, et
          // envelopper ses enfants les en sortirait (mesuré sur `.chain-path`, PR #111).
          <Fragment key={i}>
            {i > 0 ? <span className="plan-sep">→</span> : null}
            <span className={"plan-step" + (i === d.courante ? " here" : "")}>
              <span className={"sys " + s.system.toLowerCase()}>{s.name}</span>
            </span>
          </Fragment>
        ))}
      </div>
      {d.marchePret ? (
        <div className="plan-legs">
          {d.jambes.map((j) => (
            <div className={"plan-leg " + (j.courante ? "current" : j.faite ? "done" : "")} key={j.i}>
              <div className="plan-leg-head">
                <span className="plan-leg-n">{j.i + 1}</span>
                <span className="plan-leg-route">{j.from} → {j.to}</span>
                <span className="plan-leg-state">{j.faite ? "faite" : j.courante ? "courante" : "à venir"}{j.chargee ? " · chargée" : ""}</span>
                <span className={"plan-leg-profit " + classeProfit(j.profit)}>{signe(j.profit, d.fmtProfit(j.profit, j.fees))}</span>
              </div>
              <div className="plan-leg-cargo">
                {j.lines.length
                  ? j.lines.map((l, k) => (
                      <span className="plan-cargo-item" key={k}>
                        <IconeCommodite kind={l.kind} />{l.name} <b>{fmt(l.units)} SCU</b>
                      </span>
                    ))
                  : <span className="plan-muted">aucun fret rentable</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="plan-muted">Calcul des manifestes…</p>
      )}
      <div className="plan-card-meta">
        <b>{d.nbSauts}</b> saut{d.nbSauts > 1 ? "s" : ""} · <b>{d.reste}</b> à faire · <b>{fmt(d.totalScu)}</b> SCU transportés ·
        {" profit "}
        {d.marchePret
          ? <b className={classeProfit(d.totalProfit)}>{signe(d.totalProfit, d.fmtProfit(d.totalProfit, d.totalFees))}</b>
          : "…"}
        {d.marchePret ? " aUEC" : ""}
      </div>
    </div>
  );
}

export function CorpsPlan({ d }: { d: DonneesPlan }) {
  return (
    <div className="plan-grid">
      <CarteSoute d={d} />
      <CarteParcours d={d} />
    </div>
  );
}

export const enTetePlan = (hypotheses: string[]) => <EnTetePlan hypotheses={hypotheses} />;
export const corpsPlan = (d: DonneesPlan) => <CorpsPlan d={d} />;
