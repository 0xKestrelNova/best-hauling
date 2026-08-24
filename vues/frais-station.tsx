// Le panneau de frais d'autoload de la vue Corrections (ADR-012).
//
// C'étaient les DEUX DERNIÈRES fonctions de vue rendant des chaînes HTML dans `app.js` —
// `stationFeeHTML` et `autoloadListHTML`. Elles y avaient survécu à toute la migration pour une
// raison précise, écrite dans `corrections.tsx` : le panneau porte des champs de SAISIE LIBRE
// (`#alAmount`, `#alScu`), et `renderCorrections` le réécrivait inconditionnellement. Un montant en
// cours de frappe repartait à vide au moindre re-rendu — un filtre tapé, une correction ailleurs.
// D'où un garde de signature, `feesRendus`, qui ne réécrivait que si la signature changeait.
//
// ── POURQUOI LE GARDE DISPARAÎT AU LIEU D'ÊTRE PORTÉ ──────────────────────────────────────────
// React ne réécrit PAS un champ non contrôlé qu'il réconcilie : `defaultValue` pose la valeur au
// montage et n'y retouche jamais. La raison d'être du garde s'évapore donc — et le porter dans un
// `useRef` figerait à l'écran des chiffres FAUX, ce qui est exactement le bug que ce commit corrige.
//
// Ce garde était en effet INCOMPLET : sa signature valait `station | relevés`, alors que le panneau
// affiche aussi `kFor(t.name)`, qui retombe sur le coefficient GLOBAL (`#alk`) tant qu'aucun relevé
// n'existe. Changer `#alk` en restant sur la vue laissait donc « Tarif retenu : k = 1,2 » sous les
// yeux d'un utilisateur qui venait d'écrire 2,4 — et personne ne le voyait, puisque le champ `#alk`
// n'est démasqué que la case « frais d'autoload » cochée.
//
// ── LA CLÉ EST L'IDENTITÉ DU RELEVÉ, PAS LE NOM DE LA STATION ─────────────────────────────────
// `defaultValue` a un revers : si React réconcilie le même composant à la même place, les deux
// champs gardent ce qu'ils portaient. Deux conséquences si la clé ne dépend que de la station :
// changer de station laisserait à l'écran le montant de la PRÉCÉDENTE — et `saveStationReading`,
// qui LIT le DOM, persisterait la mesure d'une station sur une autre ; et effacer un relevé
// laisserait ses chiffres dans les champs, prêts à être ressuscités par « Enregistrer ».
// La clé porte donc le relevé lui-même. Le store ne change que sur un geste délibéré (Enregistrer,
// Oublier), jamais au milieu d'une saisie : le remontage ne peut pas tomber sur une frappe.
import { autoloadFee, tailleRetenue } from "../logic.ts";
import type { ReleveTemps, Terminal } from "../types.ts";
import { etat } from "../etat.ts";
import { dureeTexte, fmt } from "../format.ts";
import { alKey, kFmt, kFor, tempsDe, tempsPour } from "../frais.ts";

const heure = (ms: number): string =>
  new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// `taille` est ABSENTE des relevés faits avant l'ADR-014 : ils ont été pris sous le découpage
// glouton, donc leur k porte l'erreur de caissage. On ne les recalcule pas — on ne sait pas quelle
// taille était employée — et on l'affiche franchement dans la liste.
type Releve = { k: number; amount: number; scu: number; taille?: number };

const Panneau = ({ nom, children }: { nom: string; children: React.ReactNode }) => (
  <div className="fee-panel">
    <div className="fee-head">◈ Frais d'autoload — {nom}</div>
    {children}
  </div>
);

/**
 * Relevé du tarif d'autoload d'une station.
 *
 * L'utilisateur ne saisit PAS `k` : personne ne lit un coefficient en jeu, on lit une facture. Il
 * donne un montant observé pour une quantité, et `k` s'en déduit.
 *
 * Les champs ne portent PAS la classe `.editv` : la délégation de l'édition sur place l'attrape
 * partout dans le document et écrirait dans les corrections de prix.
 */
export function FraisStation({ terminal }: { terminal: Terminal }) {
  // Deux non-dits distincts, et aucun ne doit se lire « 0 aUEC » : le champ absent (instantané de
  // market.json antérieur au build qui l'ajoute) et le service réellement indisponible.
  if (terminal.autoload == null) {
    return (
      <Panneau nom={terminal.name}>
        <p className="fee-off">Donnée d'autoload absente de cet export UEX : aucun frais n'est facturé à cette station tant qu'elle manque.</p>
      </Panneau>
    );
  }
  if (terminal.autoload !== true) {
    return (
      <Panneau nom={terminal.name}>
        <p className="fee-off">Cette station ne propose pas l'autoload : aucun frais n'y est facturé, quel que soit ton réglage.</p>
      </Panneau>
    );
  }

  const cle = alKey(terminal.name);
  const rec = etat.AUTOLOAD_K[cle] as Releve | undefined;
  const k = kFor(terminal.name);
  const scu = rec ? rec.scu : 32;
  // Prérempli comme `#alScu` l'est à 32, et pour la même raison : un champ vide donnerait
  // `Number("") = 0`, et le relevé se persisterait sous l'hypothèse de repli tout en s'affichant
  // « (ton relevé) » — exactement l'ambiguïté que ce champ existe pour supprimer.
  const taille = tailleRetenue((rec && rec.taille) || terminal.maxBox);
  // Ce panneau est celui d'une STATION : aucune commodité n'y est en portée, et depuis #194 la
  // taille facturée dépend du couple (comptoir, commodité). Le seul nombre qu'il puisse illustrer
  // est donc le plafond du comptoir — qui n'est plus « ce que l'app suppose partout » mais son
  // MAJORANT, strictement trop grand sur 23 % des points de marché. Il l'annonce comme tel : le
  // montant montré ici est le PLANCHER de ce qu'une commodité plafonnée plus bas coûtera.
  // La taille du RELEVÉ, elle, décrit la mesure — pas la facturation — et se dit à part quand les
  // deux diffèrent.
  const tailleMoteur = tailleRetenue(terminal.maxBox);
  // Le chronomètre appartient à UNE station : celle où le chargement a commencé. Affiché ailleurs,
  // il laisserait croire qu'on peut l'arrêter d'où l'on veut — or `arreterChrono` refuse.
  const chrono = etat.CHRONO && etat.CHRONO.terminal === terminal.name ? etat.CHRONO : null;

  return (
    <Panneau nom={terminal.name}>
      <div className="fee-row">
        <span>Montant observé</span>
        <input id="alAmount" type="number" min="0" step="1" defaultValue={rec ? String(rec.amount) : ""}
               placeholder="ex : 1159" aria-label="Montant payé en aUEC" />
        <span>aUEC pour</span>
        <input id="alScu" type="number" min="1" step="1" defaultValue={String(scu)}
               aria-label="Quantité en SCU" />
        <span>SCU en caisses de</span>
        <input id="alBox" type="number" min="1" step="1" defaultValue={String(taille)}
               aria-label="Taille de caisse employée, en SCU" />
        <span>SCU</span>
        {/* Ces trois-là restent pris par la délégation posée sur `#corrections`, le PARENT de ce
            portail : un événement natif y remonte à travers le portail. Leur ajouter un onClick
            doublerait l'action. */}
        <button id="alSave" type="button" className="copy-btn">Enregistrer</button>
        {rec ? (
          <button type="button" className="corr-del al-del" data-key={cle}
                  title="Oublier ce relevé" aria-label="Oublier ce relevé">✕</button>
        ) : null}
      </div>
      <div className="fee-note">
        Tarif retenu : <b>k = {kFmt(k)}</b> {rec ? "(ton relevé)" : "(k global)"} — soit ≈{" "}
        <b>{fmt(autoloadFee(scu, tailleMoteur, k))}</b> aUEC pour {fmt(scu)} SCU en caisses de{" "}
        {fmt(tailleMoteur)} SCU{terminal.maxBox ? " (la plus grosse que ce comptoir accepte, toutes commodités confondues)" : " (par défaut)"}.
        {terminal.maxBox ? " Une commodité peut y être offerte en caisses plus petites — l'app facture alors SA taille, et la note monte." : ""}
        {rec && rec.taille && rec.taille !== tailleMoteur
          ? " Ta mesure, elle, a été faite en caisses de " + fmt(rec.taille) + " SCU : c'est elle qui a donné k, pas la supposition."
          : ""}
        {" "}Charger en plus grosses caisses coûte moins cher : c'est un choix, pas une fatalité du comptoir.
      </div>

      {/* ── Le CHRONOMÈTRE (#192) ──────────────────────────────────────────────────────────────
          Pas de champ de quantité en propre : ce panneau décrit UN chargement observé, et `#alScu`
          / `#alBox` le décrivent déjà. Deux champs de plus les dupliqueraient, et rien ne
          garantirait qu'ils disent la même chose que la ligne du dessus.
          Le chrono ne TIQUE PAS. Il n'a rien à afficher qui bouge : la mesure est la différence
          entre deux instants, et une horloge qui s'anime coûterait un minuteur dans une
          application qui re-rend déjà beaucoup — pour zéro précision de plus. */}
      <div className="fee-row">
        <span>Temps de chargement</span>
        <input id="alSec" type="number" min="1" step="1" defaultValue=""
               placeholder="ex : 145" aria-label="Durée observée, en secondes" />
        <span>s</span>
        <button id="alTSave" type="button" className="copy-btn">Enregistrer</button>
        {chrono ? (
          <>
            <button id="alChronoStop" type="button" className="copy-btn">⏹ Arrêter et enregistrer</button>
            <button id="alChronoCancel" type="button" className="corr-del"
                    title="Abandonner ce chronométrage" aria-label="Abandonner ce chronométrage">✕</button>
          </>
        ) : (
          <button id="alChronoStart" type="button" className="copy-btn">▶ Chronométrer</button>
        )}
      </div>
      {/* Classe DISTINCTE de `.fee-note`, et pas seulement pour le style : quatre tests e2e
          ciblent `#correctionsFees .fee-note` en supposant un seul élément, et un second le
          ferait basculer en violation de mode strict — vert en local tant que le panneau ne
          rend qu une note, rouge dès qu il en rend deux. */}
      <div className="fee-temps">{noteTemps(terminal, chrono)}</div>
    </Panneau>
  );
}

/** Ce que les chronométrages de cette station disent — et RIEN si on n'en a aucun.
 *
 *  C'est la règle du ticket, et elle n'est pas cosmétique : le jeu ne publie aucune durée (mesuré
 *  sur 158 journaux), donc tout temps affiché sans mesure serait une invention. Le dépôt met déjà
 *  un « ≈ » sur des montants calibrés à 2,8 % près ; un temps est bien plus incertain que ça.
 */
function noteTemps(terminal: Terminal, chrono: { debut: number } | null): React.ReactNode {
  if (chrono) {
    return (
      <>Chronomètre en marche depuis <b>{heure(chrono.debut)}</b> — reviens l'arrêter quand la soute
      est pleine. La quantité et la taille de caisse seront celles des champs ci-dessus.</>
    );
  }
  const t = tempsPour(terminal.name);
  if (!t) {
    return (
      <>Aucun temps relevé ici. Le jeu n'en publie aucun — ni début, ni fin, ni progression de
      chargement au journal —, donc rien ne peut être estimé tant que tu n'as pas mesuré.</>
    );
  }
  return (
    <>
      Temps relevé : <b>{dureeTexte(t.moyenne)}</b> sur {t.n} relevé{t.n > 1 ? "s" : ""}
      {/* À un seul relevé la dispersion n'existe PAS. Écrire « ±0 s » ferait passer une mesure
          unique pour une certitude, ce qui est l'inverse de ce qu'on veut dire. */}
      {t.dispersion == null
        ? " — une seule mesure, donc aucune dispersion : à confirmer."
        : ` (±${dureeTexte(t.dispersion)}, de ${dureeTexte(t.min)} à ${dureeTexte(t.max)})`}
      {t.parScu != null && t.parCaisse != null
        ? ` — soit ${t.parScu.toFixed(1)} s par SCU et ${t.parCaisse.toFixed(0)} s par caisse, sur l'ensemble des relevés.`
        : ""}
      {" "}Un temps dépend aussi de la charge du shard : il est plus bruité qu'un tarif.
    </>
  );
}

/**
 * La liste des relevés d'autoload, à côté des corrections locales et sur le même modèle.
 *
 * Ils sont de même nature — des mesures faites en jeu, purement locales — mais ils ne comptent PAS
 * dans le badge « Corrections (n) » du rail, et « Tout réinitialiser » ne les touche pas : ils ont
 * leur propre store.
 */
export function ListeAutoload() {
  const cles = Object.keys(etat.AUTOLOAD_K).sort();
  if (!cles.length) return null;
  return (
    <>
      <div className="corr-list-head">
        <span>{cles.length} relevé{cles.length > 1 ? "s" : ""} d'autoload</span>
        <button id="resetAllK" className="reset-ov">Tout oublier</button>
      </div>
      {cles.map((cle) => {
        const o = etat.AUTOLOAD_K[cle] as Releve;
        const terminal = cle.slice(cle.indexOf("|") + 1);
        return (
          <div className="corr-item autoload" key={cle}>
            <div>
              <b>{terminal}</b> <span className="corr-side">autoload</span>
              <div className="loc-sub">k = <b>{kFmt(o.k)}</b> · {fmt(o.amount)} aUEC observés pour {fmt(o.scu)} SCU
                {" "}{o.taille ? `en caisses de ${fmt(o.taille)} SCU` : "— taille de caisse non renseignée"}</div>
            </div>
            <button className="corr-del al-del" data-key={cle} title="Oublier ce relevé">✕</button>
          </div>
        );
      })}
    </>
  );
}

/**
 * La liste des chronométrages, station par station. Chaque MESURE y figure — jamais leur moyenne :
 * c'est le relevé qui fait foi, et une moyenne pré-digérée serait illisible le jour où la grille de
 * temps du jeu changerait.
 */
export function ListeTemps() {
  const cles = Object.keys(etat.AUTOLOAD_T).sort();
  if (!cles.length) return null;
  const total = cles.reduce((a, c) => a + ((etat.AUTOLOAD_T[c] as ReleveTemps[]) || []).length, 0);
  return (
    <>
      <div className="corr-list-head">
        <span>{total} chronométrage{total > 1 ? "s" : ""} d'autoload</span>
        <button id="resetAllT" className="reset-ov">Tout oublier</button>
      </div>
      {cles.map((cle) => {
        const liste = (etat.AUTOLOAD_T[cle] as ReleveTemps[]) || [];
        const terminal = cle.slice(cle.indexOf("|") + 1);
        return liste.map((o, i) => (
          <div className="corr-item autoload" key={`${cle}#${i}`}>
            <div>
              <b>{terminal}</b> <span className="corr-side">chrono</span>
              <div className="loc-sub"><b>{dureeTexte(o.s)}</b> pour {fmt(o.scu)} SCU
                {" "}en {fmt(o.caisses)} caisse{o.caisses > 1 ? "s" : ""} de {fmt(o.taille)} SCU</div>
            </div>
            <button className="corr-del al-tdel" data-key={cle} data-rang={String(i)}
                    title="Oublier ce chronométrage">✕</button>
          </div>
        ));
      })}
    </>
  );
}

/**
 * Le conteneur `#correctionsFees` en entier : le panneau de la station affichée, puis les relevés.
 *
 * `key` porte l'IDENTITÉ DU RELEVÉ et pas seulement la station — voir l'en-tête. Sans elle, les
 * deux champs non contrôlés survivraient à un changement de station comme à la suppression du
 * relevé qu'ils affichent.
 */
export function PanneauFrais({ terminal }: { terminal: Terminal | null }) {
  const rec = terminal ? (etat.AUTOLOAD_K[alKey(terminal.name)] as Releve | undefined) : undefined;
  // La `key` porte AUSSI le nombre de chronométrages : `#alSec` est un champ non contrôlé, donc
  // sans remontage il garderait à l'écran la durée qu'on vient d'enregistrer — prête à être
  // enregistrée une seconde fois. Même raison que pour le relevé de tarif, en-tête.
  //
  // Le CHRONO EN COURS, lui, n'y est PAS, et c'est le contraire d'un oubli. L'y mettre remonte le
  // panneau au démarrage du chronomètre, et les trois champs non contrôlés repartent à leur
  // `defaultValue` : on tape 64 SCU, on presse ▶, on charge, on presse ⏹ — et la mesure se persiste
  // pour 32 SCU, sans que rien à l'écran ne le démente. Le ▶ qui devient ⏹ n'a besoin d'aucun
  // remontage : React réconcilie ces boutons comme n'importe quels enfants. Trouvé par l'e2e.
  const nTemps = terminal ? tempsDe(terminal.name).length : 0;
  return (
    <>
      {terminal ? (
        <FraisStation key={`${terminal.name}|${rec ? `${rec.amount}/${rec.scu}` : ""}|${nTemps}`} terminal={terminal} />
      ) : null}
      <ListeAutoload />
      <ListeTemps />
    </>
  );
}
