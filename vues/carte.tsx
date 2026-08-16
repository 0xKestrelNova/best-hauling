// La carte 2D du parcours (ADR-001), douzième îlot React de la refonte (ADR-008 #96).
//
// C'est le premier qui ne soit pas une VUE : `#journeyMap` est un `<aside>` frère de `#planHead` et
// `#planBody`, pas un conteneur de vue. Il vit là parce qu'un élément à écouteurs DIRECTS se
// déménage en frère, jamais en enfant d'un conteneur réécrit (leçon de #24, rappelée par l'ADR-004
// et par l'en-tête de `plan.tsx`).
//
// Ces écouteurs — le clic et le clavier sur `.jm-arret` — restent posés par app.js sur `#journeyMap`
// LUI-MÊME, une seule fois. React ne peint qu'à l'INTÉRIEUR du conteneur : ils survivent donc à
// chaque rendu sans rien changer, à condition que `data-i`, `role` et `tabindex` restent sur le
// groupe. Ce n'est pas de la décoration : sans `role="button"`, Playwright ne parvient même plus à
// cliquer `.jm-cible` (le `.jm-point` concentrique intercepte le pointeur), et le test des
// écouteurs directs tombe.
//
// Le calcul est PUR et vit ailleurs (`journeyMap`, logic.ts) : ici on n'émet que du SVG. Aucun
// asset, aucune image — la CSP du dépôt n'en voudrait pas.
import { Fragment } from "react";
import type { Carte, SystemeCarte } from "../types.ts";

const SYS_TEINTE: Record<string, string> = { Stanton: "var(--stanton)", Pyro: "var(--pyro)", Nyx: "var(--nyx)" };
const teinte = (nom: string) => SYS_TEINTE[nom] || "var(--acc)";

// Les coordonnées restent des CHAÎNES à une décimale. Passer les nombres bruts à React écrirait
// `cx="510"` là où le gabarit écrivait `cx="510.0"` : même dessin, mais le relevé attribut par
// attribut ne pourrait plus servir de preuve d'identité.
const nf = (v: number) => Number(v).toFixed(1);

// Semis d'étoiles déterministe (générateur congruentiel) : même ciel à chaque rendu, donc aucun
// scintillement quand la carte se redessine — et statique, décision de l'ADR : rien ne doit bouger
// en périphérie de tableaux qu'on lit.
//
// L'ORDRE DES TIRAGES EST LE MÉCANISME : x, y, o, puis r. Le gabarit calculait `o` avant `r`, et
// écrire `r={…} opacity={o}` en JSX les inverserait — l'ordre d'évaluation des props est celui de
// l'écriture. Le ciel entier changerait, silencieusement, dès la deuxième étoile.
function etoiles(n: number, w: number, h: number) {
  let s = 20260812;
  const suivant = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (suivant() * w).toFixed(1), y = (suivant() * h).toFixed(1), o = (0.12 + suivant() * 0.45).toFixed(2);
    const r = suivant() > 0.9 ? 0.9 : 0.5;
    out.push(<circle key={i} cx={x} cy={y} r={r} fill="#dfe6f5" opacity={o} />);
  }
  return out;
}

function Systeme({ sys }: { sys: SystemeCarte }) {
  const t = teinte(sys.nom);
  return (
    <g className="jm-sys">
      <circle cx={nf(sys.cx)} cy={nf(sys.cy)} r={nf(sys.r * 1.1)} fill="none" stroke={t} strokeOpacity="0.13" strokeDasharray="2 5" />
      {sys.corps.map((b, i) => (
        <Fragment key={i}>
          <circle cx={nf(sys.cx)} cy={nf(sys.cy)} r={nf(b.orbite)} fill="none" stroke={t} strokeOpacity="0.15" />
          <circle cx={nf(b.x)} cy={nf(b.y)} r="3.2" fill={t} fillOpacity="0.85" />
          {/* Le libellé du corps s'efface quand une escale s'y pose : son nom est déjà écrit là. */}
          {!b.occupe && <text className="jm-corps" x={nf(b.x + 6)} y={nf(b.y + 3)}>{b.nom}</text>}
        </Fragment>
      ))}
      <circle cx={nf(sys.cx)} cy={nf(sys.cy)} r="6.5" fill={t} fillOpacity="0.18" />
      <circle cx={nf(sys.cx)} cy={nf(sys.cy)} r="3" fill={t} />
      <text className="jm-sysnom" x={nf(sys.cx)} y={nf(Math.max(13, sys.cy - sys.r * 1.22))} fill={t}>{sys.nom.toUpperCase()}</text>
    </g>
  );
}

export function carteParcours(c: Carte) {
  const v = c.vaisseau;
  return (
    <>
      {/* Les espaces y sont SIGNIFIANTES et tiennent en DEUX nœuds de texte, « ◈ » et le blanc qui
          suit le titre. Les écrire comme littéraux séparés reproduit exactement le gabarit ; les
          laisser tomber recollerait « ◈Carte du parcoursschéma » (piège n°2, #111 et #116). */}
      <span className="jm-label">{"◈ "}<b>Carte du parcours</b>{" "}<span className="muted">schéma — rayons compressés</span></span>
      <svg
        className="jm-svg"
        viewBox={`0 0 ${c.largeur} ${c.hauteur}`}
        role="img"
        aria-label={`Carte du parcours : ${c.arrets.map((a) => a.nom).join(", puis ")}`}
      >
        <rect width={c.largeur} height={c.hauteur} fill="#080b14" />
        {etoiles(70, c.largeur, c.hauteur)}

        {c.systemes.map((sys, i) => <Systeme key={i} sys={sys} />)}

        {c.jambes.map((j, i) => {
          // Arc plutôt que segment : la courbure suit le sens du trajet, donc l'aller et le retour
          // d'un même couple ne se superposent plus. Le chevron dit dans quel sens on va.
          const d = `M${nf(j.x1)} ${nf(j.y1)} Q${nf(j.cx)} ${nf(j.cy)} ${nf(j.x2)} ${nf(j.y2)}`;
          return j.saut ? (
            <Fragment key={i}>
              <path className="jm-saut" d={d} />
              <circle className="jm-saut-noeud" cx={nf(j.fleche.x)} cy={nf(j.fleche.y)} r="7" />
              <text className="jm-saut-glyphe" x={nf(j.fleche.x)} y={nf(j.fleche.y + 3)}>⚡</text>
            </Fragment>
          ) : (
            <Fragment key={i}>
              <path className={`jm-jambe${j.faite ? " faite" : ""}`} d={d} />
              <path
                className={`jm-sens${j.faite ? " faite" : ""}`}
                d="M-3 -2.6 L2.6 0 L-3 2.6"
                style={{ transform: `translate(${nf(j.fleche.x)}px, ${nf(j.fleche.y)}px) rotate(${nf(j.fleche.angle)}deg)` }}
              />
            </Fragment>
          );
        })}

        {/* Les arrêts sont des boutons : cliquer une escale déplace « je suis ici », comme le fil
            d'étapes textuel juste au-dessus (décision de l'ADR — un second chemin, pas une
            nouveauté). `data-i` est ce que lisent les deux écouteurs directs d'app.js. */}
        {c.arrets.map((a, i) => {
          const fait = i < v.arret, ici = i === v.arret;
          const droite = a.x < c.largeur / 2;
          return (
            <g
              key={i}
              className={`jm-arret${fait ? " fait" : ""}${ici ? " ici" : ""}`}
              data-i={i}
              role="button"
              tabIndex={0}
              aria-label={`Se placer à ${a.nom}`}
            >
              <circle className="jm-cible" cx={nf(a.x)} cy={nf(a.y)} r="11" />
              <circle className="jm-point" cx={nf(a.x)} cy={nf(a.y)} r="4.5" />
              <text className="jm-nom" x={nf(a.x + (droite ? 9 : -9))} y={nf(a.y - 9)} textAnchor={droite ? "start" : "end"}>{a.nom}</text>
            </g>
          );
        })}

        <g className={`jm-vaisseau${v.enVol ? " en-vol" : ""}`} style={{ transform: `translate(${nf(v.x)}px, ${nf(v.y)}px) rotate(${nf(v.angle)}deg)` }}>
          <circle r="10" fill="var(--acc)" fillOpacity="0.12" />
          <path d="M8 0 L-5 5 L-2.5 0 L-5 -5 Z" fill="var(--acc)" stroke="#140c00" strokeWidth="0.5" />
        </g>
      </svg>
    </>
  );
}
