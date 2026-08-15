// La vue Tournée, premier îlot React de la refonte v2 (ADR-008, #96).
//
// POURQUOI CELLE-CI EN PREMIÈRE. Mesuré sur les huit vues : 125 lignes exclusives, 4 `#id` et
// 3 classes au contrat e2e, 10 tests dont 8 exclusifs et TOUS dans un seul fichier — et surtout,
// elle n'écrit AUCUNE globale de app.js et ne touche au DOM d'aucune autre vue. Son rendu est même
// totalement inerte : pas un gestionnaire d'événement. C'est la seule qui prouve le mécanisme sans
// rien risquer d'autre. (À l'opposé, « En route » écrit six globales dont JOURNEY, référencée par
// 33 déclarations, et écrit dans le DOM de deux autres vues.)
//
// CE QUI NE CHANGE PAS, et c'est le contrat : les classes, la structure et les textes sont
// reproduits à l'identique. La suite e2e est le harnais de migration — si elle passe sans qu'on
// l'ait touchée, c'est que la vue rend la même chose.
//
// Le calcul n'est pas ici : `tourneesEcoulement` vit dans logic.ts, pure et couverte par les tests
// unitaires. Ce fichier ne fait que présenter.
import { Fragment } from "react";
import type { Tournee, Destination } from "../types.ts";

// Le formateur de app.js est passé en prop plutôt qu'importé : app.js n'exporte rien (c'est un
// script d'entrée), et le dupliquer ici ferait diverger deux formatages de nombres.
type Fmt = (n: number) => string;

type ProprietesArret = { a: Destination; rang: number; fmt: Fmt };

// Le badge de système. Sa classe porte le nom en minuscules — `.sys.pyro`, `.sys.stanton` — et
// style.css la teinte via les jetons. C'est l'une des 29 classes que le dépôt n'écrit que par
// interpolation : elle doit sortir d'ici exactement pareil, sans quoi la couleur disparaît.
const BadgeSysteme = ({ system }: { system: string }) => (
  <span className={"sys " + system.toLowerCase()}>{system}</span>
);

const MAX_LIGNES = 12;

function ArretDeTournee({ a, rang, fmt }: ProprietesArret) {
  const visibles = a.lignes.slice(0, MAX_LIGNES);
  const reste = a.lignes.length - visibles.length;

  // Les trois états de certitude, et ils ne disent PAS la même chose : une capacité publiée, une
  // capacité qu'UEX ne publie pas (ni zéro ni illimitée — 84 % des points de vente), et un entre-deux.
  const certitude =
    a.certitude === "connue" ? (
      <span className="ec-sur" title="Capacité publiée par UEX">{fmt(a.garanti)} SCU garantis</span>
    ) : a.certitude === "inconnue" ? (
      <span className="ec-flou" title="UEX ne publie pas la capacité de ce point : ni zéro, ni illimitée">capacité inconnue</span>
    ) : (
      <span className="ec-flou" title="Capacité publiée pour une partie seulement">{fmt(a.garanti)} SCU garantis, reste inconnu</span>
    );

  return (
    <div className="tour-arret">
      <div className="tour-arret-head">
        <span className="tour-n">{rang}</span>
        <span className="tour-nom">
          {a.terminal}
          <BadgeSysteme system={a.system} />
          {a.cross ? <> <span className="cross" title="Changement de système">⚡</span></> : null}
          {a.outpost ? <> <span className="outpost" title="Avant-poste : élévateur de fret parfois en panne">⚠ avant-poste</span></> : null}
        </span>
        <span className="tour-lignes-n">
          {a.lignes.length} ligne{a.lignes.length > 1 ? "s" : ""} · <b>{fmt(a.scu)}</b> SCU
        </span>
        <span
          className="tour-encaisse"
          title={`Encaissement brut. Profit, prix d'achat déduit : ${a.profit >= 0 ? "+" : ""}${fmt(Math.round(a.profit))} aUEC.`}
        >
          {fmt(Math.round(a.encaisse))}
        </span>
      </div>
      <div className="tour-arret-lignes">
        {visibles.map((l, i) => (
          <span key={i} className={"tour-ligne" + (l.sousLePrixPaye ? " perte" : "")}>
            {l.name} <b>{fmt(l.absorbe)}</b>
            {l.reste > 0 ? `/${fmt(l.absorbe + l.reste)}` : ""} SCU
          </span>
        ))}
        {reste > 0 ? (
          <span className="tour-ligne muted">+ {reste} autre{reste > 1 ? "s" : ""}</span>
        ) : null}
      </div>
      <div className="tour-arret-meta">
        {certitude}
        {a.aPerte ? (
          <> · <span className="ec-perte" title="Le prix ici est inférieur à ce que tu as payé">sous le prix payé</span></>
        ) : null}
      </div>
    </div>
  );
}

export type ProprietesTournee = {
  tournee: Tournee;
  alternative: Tournee | null;
  systeme: string;
  toutSysteme: boolean;
  fmt: Fmt;
};

export function VueTournee({ tournee: t, alternative: alt, systeme, toutSysteme, fmt }: ProprietesTournee) {
  if (!t.arrets.length && !t.sansDebouche.length) {
    return (
      <div className="tour-vide">
        <p className="muted">
          Aucun comptoir ne reprend ce fret {toutSysteme ? "où que ce soit" : `dans ${systeme}`} avec ces filtres.
          Ouvre la portée aux autres systèmes, ou <b>dépose</b> le fret à une station : il n'est alors ni vendu ni perdu.
        </p>
      </div>
    );
  }

  // Le PLANCHER, dit AVANT les chiffres, et c'est une exigence de l'ADR-007 : 307 des 1 879 points
  // de vente publient leur capacité. Le nombre d'arrêts est presque toujours faux vers le bas, et un
  // total ne s'affiche jamais sans dire s'il est garanti ou parié.
  const parie = t.certitude !== "connue";

  return (
    <>
      <div className="tour-head">
        <span className="tour-titre">◈ Tournée d'écoulement</span>
        <span className="tour-bilan">
          <b>{t.arrets.length}</b> arrêt{t.arrets.length > 1 ? "s" : ""}
          {t.sauts > 0 ? <> · <b>{t.sauts}</b> saut{t.sauts > 1 ? "s" : ""} de système</> : null}
          {" · "}<b>{fmt(t.scu)}</b> SCU écoulés
          {t.resteScu > 0 ? <> · <b className="tour-reste">{fmt(t.resteScu)}</b> SCU resteraient à bord</> : <> · <b>soute vidée</b></>}
        </span>
        <span
          className="tour-total"
          title={`Encaissement brut de la tournée. Profit, prix d'achat déduit : ${t.profit >= 0 ? "+" : ""}${fmt(Math.round(t.profit))} aUEC.`}
        >
          {fmt(Math.round(t.encaisse))} <span>aUEC</span>
        </span>
      </div>

      <div className={"tour-plancher " + (parie ? "parie" : "sur")}>
        {parie ? (
          <>Plancher : UEX ne publie la capacité que d'un point de vente sur six. Il faudra sans doute <b>plus d'arrêts</b> que ce qui est annoncé — la tournée se recalcule après chaque arrêt réel.</>
        ) : (
          <>Toutes les capacités de cette tournée sont publiées par UEX : le nombre d'arrêts est <b>garanti</b>.</>
        )}
      </div>

      {/* Les lignes qui ne s'écoulent nulle part sont NOMMÉES : les taire ferait annoncer une soute
          vidée qui ne l'est pas. 15 commodités sur 113 n'ont aucun débouché dans Pyro. */}
      {t.sansDebouche.length ? (
        <div className="tour-orphelines">
          <b>
            {t.sansDebouche.length} ligne{t.sansDebouche.length > 1 ? "s ne s'écoulent" : " ne s'écoule"} nulle part{" "}
            {toutSysteme ? "dans la portée" : `dans ${systeme}`}
          </b>
          {" :"}{" "}
          {t.sansDebouche.map((g, i) => (
            <span key={i} className="tour-orph">{g.name} {fmt(g.units)} SCU</span>
          ))}
          <span className="muted">— ouvre la portée, dépose-les à une station, ou garde-les à bord.</span>
        </div>
      ) : null}

      <div className="tour-arrets">
        {t.arrets.map((a, i) => <ArretDeTournee key={i} a={a} rang={i + 1} fmt={fmt} />)}
      </div>

      {/* L'alternative « un arrêt de plus », chiffrée. L'ordre reste lexicographique STRICT : la
          plus courte gagne. Un seuil serait un paramètre invérifiable — l'app ne sait pas si tu as
          le temps, si c'est sur ton chemin, ou si tu veux juste te coucher. On montre les deux. */}
      {alt ? (
        <div className="tour-alt">
          <div className="tour-alt-head">
            Un arrêt de plus : <b className="profit">+{fmt(Math.round(alt.ecart))}</b> aUEC
            {alt.ecartPct != null ? <> <span className="muted">(+{alt.ecartPct.toFixed(1)} %)</span></> : null}
          </div>
          <div className="tour-alt-chemin">
            {/* `Fragment` et non un <span> englobant : ici `.tour-alt-chemin` n'est pas un flex,
                donc le rendu ne changerait pas — mais le motif est le même que celui qui a cassé
                `.chain-path` (enfants sortis du contexte flex, espaces perdus). Autant ne pas le
                laisser traîner. */}
            {alt.arrets.map((a, i) => (
              <Fragment key={i}>
                {i > 0 ? <span className="tour-fleche">→</span> : null}
                {i > 0 ? " " : ""}{a.terminal} <span className="muted">({a.lignes.length})</span>{i < alt.arrets.length - 1 ? " " : ""}
              </Fragment>
            ))}
          </div>
          <div className="tour-alt-note muted">À toi de trancher : l'app ne sait pas si tu as le temps, ni si c'est sur ton chemin.</div>
        </div>
      ) : null}
    </>
  );
}

// ── Les fabriques exposées à app.js ────────────────────────────────────────────────────────────
// app.js reste un fichier .js SANS JSX, et c'est délibéré : le renommer en .jsx déplacerait le
// fichier sur lequel tout le harnais est calé — la ligne d'assemblage du déploiement le nomme, le
// service worker aussi, et scripts/csp.test.mjs vérifie les deux. Faire traverser le JSX à tout
// le .js du dépôt pour un seul fichier serait payer cher un confort d'écriture.
//
// Ces fabriques rendent des éléments React déjà construits : app.js n'a qu'à les passer à
// `peindre`, sans connaître ni JSX ni React.

export const vueTournee = (p: ProprietesTournee) => <VueTournee {...p} />;

export const messageSouteVide = () => (
  <div className="tour-vide">
    <p className="muted">
      Ta soute est vide — il n'y a rien à écouler.
      Déclare ce que tu transportes avec <b>« + déclarer ce que j'ai à bord »</b> depuis une vue de recherche,
      ou charge le manifeste d'une jambe avec <b>« ✓ chargé »</b>.
    </p>
  </div>
);

export const messageChargement = () => <p className="muted tour-vide">Chargement du marché…</p>;

export const messageOuEsTu = () => (
  <div className="tour-vide">
    <p className="muted">
      Dis d'abord <b>où tu es</b> : une tournée part d'un terminal.
      Le champ <b>Je suis à</b>, juste au-dessus, l'attend.
    </p>
  </div>
);
