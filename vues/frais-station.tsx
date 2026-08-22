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
import { autoloadFee } from "../logic.ts";
import type { Terminal } from "../types.ts";
import { etat } from "../etat.ts";
import { fmt } from "../format.ts";
import { alKey, kFmt, kFor } from "../frais.ts";

type Releve = { k: number; amount: number; scu: number };

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

  return (
    <Panneau nom={terminal.name}>
      <div className="fee-row">
        <span>Montant observé</span>
        <input id="alAmount" type="number" min="0" step="1" defaultValue={rec ? String(rec.amount) : ""}
               placeholder="ex : 1159" aria-label="Montant payé en aUEC" />
        <span>aUEC pour</span>
        <input id="alScu" type="number" min="1" step="1" defaultValue={String(scu)}
               aria-label="Quantité en SCU" />
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
        <b>{fmt(autoloadFee(scu, terminal.maxBox, k))}</b> aUEC pour {fmt(scu)} SCU
        {terminal.maxBox ? `, caisses de ${fmt(terminal.maxBox)} SCU max` : ""}.
      </div>
    </Panneau>
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
              <div className="loc-sub">k = <b>{kFmt(o.k)}</b> · {fmt(o.amount)} aUEC observés pour {fmt(o.scu)} SCU</div>
            </div>
            <button className="corr-del al-del" data-key={cle} title="Oublier ce relevé">✕</button>
          </div>
        );
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
  return (
    <>
      {terminal ? (
        <FraisStation key={`${terminal.name}|${rec ? `${rec.amount}/${rec.scu}` : ""}`} terminal={terminal} />
      ) : null}
      <ListeAutoload />
    </>
  );
}
