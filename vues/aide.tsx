// L'AIDE DE DÉMARRAGE (#62), et le PREMIER dialogue modal du dépôt.
//
// Il n'y avait RIEN à copier, et c'est vérifié : `role="dialog"`, `aria-modal` et `<dialog>` ont zéro
// occurrence dans tout le dépôt. `#holdDeclare` est un `<aside hidden>` avec un simple Échap
// (`soute-gestes.ts`) — sans voile, sans piège de focus, sans restitution. Tout ce qui suit est
// écrit, pas transposé.
//
// ── POURQUOI PAS DE PORTAIL ───────────────────────────────────────────────────────────────────
// Les onze autres vues rendent DANS un conteneur d'`index.html` par `createPortal`, parce que leur
// markup existait avant elles. Celle-ci est neuve et n'a pas de conteneur : elle se pose en voile
// sur toute la page. Elle rend donc dans `#racine` lui-même — le nœud vide de la racine unique,
// DERNIER enfant de <body> — ce qui la place au-dessus du rail sans un z-index à négocier.
//
// ── POURQUOI `onClick` EST LÉGITIME ICI, ET SEULEMENT ICI ─────────────────────────────────────
// L'ADR-012 §2 interdit de convertir en `onClick` une délégation posée sur un conteneur
// d'`index.html` : le portail rend dedans sans le posséder, l'écouteur traverse déjà, et le
// convertir doublerait les gestes non idempotents. Ce markup-ci n'existe QUE dans l'arbre, React le
// possède entièrement, et personne n'a posé de délégation dessus. Le bouton de REJEU, lui, vit dans
// `.brand` (index.html) : il reste une délégation, dans `aide-gestes.ts`.
//
// ── L'AIDE EST DÉRIVÉE DU RAIL, JAMAIS RECOPIÉE ───────────────────────────────────────────────
// « Une aide qui décrit une interface fausse est pire que pas d'aide. » Une liste écrite à la main
// serait une SECONDE table jumelle du rail, à tenir d'accord avec lui — exactement ce que
// `navigation.ts` a refusé pour les raccourcis (« on le dérive du rail lui-même, pour qu'aucune des
// deux listes ne puisse se désynchroniser de l'autre »). Les huit entrées sont donc LUES sur
// `.rail-nav .vbtn` : une neuvième vue apparaît ici sans que personne n'y pense, et aucune
// renumérotation ne peut rendre cette page menteuse.
import { useEffect, useRef } from "react";

import { etat } from "../etat.ts";
import { fermerAide } from "../aide.ts";

/** Ce qui peut recevoir le focus dans le dialogue. */
const FOCUSABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Le « (raccourci : 3) » que porte chaque `title` du rail : la colonne du numéro le redit déjà. */
const SANS_RACCOURCI = /\s*\(raccourci\s*:[^)]*\)\s*$/;

type EntreeRail = { vue: string; num: string; nom: string; quoi: string };

/**
 * Les huit vues, LUES sur le rail.
 *
 * L'ORDRE DES DEUX COUPES EST UN CONTRAT : on retire d'abord « (raccourci : N) », on coupe ensuite
 * sur le premier « : ». L'inverse laisserait « 8) » comme description de Corrections, dont le titre
 * ne porte pas d'autre deux-points. La coupe sert les quatre libellés qui s'expliquent eux-mêmes
 * (« Commodités : tous les points d'achat/vente ») ; les autres passent entiers.
 *
 * `#viewCorrections` voit son libellé réécrit par `updateOvBadge` (« Corrections (3) ») : c'est bien
 * ce qu'on veut afficher — l'aide dit ce que l'écran dit, compteur compris.
 */
function lireLeRail(): EntreeRail[] {
  return [...document.querySelectorAll<HTMLElement>(".rail-nav .vbtn")].map((b) => {
    const titre = (b.getAttribute("title") || "").replace(SANS_RACCOURCI, "").trim();
    const coupe = titre.indexOf(" : ");
    return {
      vue: b.dataset.view || "",
      num: b.querySelector(".rn")?.textContent || "",
      nom: b.querySelector(".rl")?.textContent || "",
      quoi: coupe > 0 ? titre.slice(coupe + 3) : titre,
    };
  });
}

function Dialogue() {
  const boite = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // QUI a ouvert l'aide : c'est à lui que le focus reviendra. Lu au MONTAGE, donc après le clic.
    const rendreA = document.activeElement as HTMLElement | null;
    const dlg = boite.current;

    // Le focus ENTRE dans le dialogue : sans ça un lecteur d'écran reste sur le <body> et n'annonce
    // rien de ce qui vient de s'afficher.
    dlg?.querySelector<HTMLElement>(FOCUSABLES)?.focus();

    // LE PIÈGE, MOITIÉ 1 — `inert` sur `#app`. C'est le navigateur lui-même qui refuse alors de
    // focaliser quoi que ce soit derrière le voile, et l'AT cesse de le lire. `#racine` est un FRÈRE
    // de `#app` dans index.html, jamais son enfant : le dialogue n'est donc pas atteint.
    const app = document.getElementById("app");
    app?.setAttribute("inert", "");

    // LE PIÈGE, MOITIÉ 2 — le bouclage manuel, pour les moteurs sans `inert`. Sans lui, la
    // tabulation part visiter le rail et les filtres SOUS le voile, qu'aucun clic ne peut atteindre :
    // le clavier et la souris ne verraient plus la même page.
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); fermerAide(); return; }
      if (e.key !== "Tab" || !dlg) return;
      const cibles = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLES)];
      if (!cibles.length) return;
      const premier = cibles[0], dernier = cibles[cibles.length - 1];
      // On ne boucle QU'AUX DEUX BOUTS : entre les deux, laisser faire le navigateur garde l'ordre
      // naturel. Le troisième cas rattrape un focus déjà sorti (clic dans le voile).
      if (!dlg.contains(document.activeElement)) { e.preventDefault(); premier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
      else if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    };
    // En CAPTURE : on passe avant les deux `document` keydown déjà posés (navigation, voyage), sans
    // dépendre de leur ordre de branchement dans l'amorce.
    document.addEventListener("keydown", surTouche, true);

    return () => {
      document.removeEventListener("keydown", surTouche, true);
      app?.removeAttribute("inert");
      // LA RESTITUTION vit ICI et pas dans `fermerAide()` : React démonte le dialogue APRÈS avoir
      // rendu, et poser le focus avant le démontage le rendrait au <body> en disparaissant.
      // Ouverte seule (première visite), personne n'avait le focus — il part alors sur le bouton de
      // rejeu, ce qui montre au passage où retrouver l'aide.
      const cible = (rendreA && rendreA !== document.body ? rendreA : null)
        || document.getElementById("aideRejouer");
      cible?.focus();
    };
  }, []);

  const vues = lireLeRail();

  return (
    <div
      className="aide-voile"
      // `mousedown` et non `click` : une sélection de texte commencée DANS le dialogue et relâchée
      // sur le voile émettrait un `click` dont la cible est le voile, et refermerait l'aide sous les
      // doigts. La garde `target === currentTarget` évite en plus de fermer sur le dialogue lui-même.
      onMouseDown={(e) => { if (e.target === e.currentTarget) fermerAide(); }}
    >
      <div className="aide" id="aide" role="dialog" aria-modal="true" aria-labelledby="aideTitre" ref={boite}>
        <h2 className="aide-titre" id="aideTitre">Bienvenue à bord</h2>

        <p className="aide-intro">
          Cet écran classe les routes de fret de <b>Star&nbsp;Citizen</b> à partir des relevés
          publiés par <b>UEX</b>, rafraîchis toutes les heures. Dis ce que tu pilotes et ce que tu
          peux avancer — <b>vaisseau</b>, <b>soute</b>, <b>budget</b>, en haut de l'écran — puis
          choisis la question que tu te poses&nbsp;:
        </p>

        <ol className="aide-vues">
          {vues.map((v) => (
            <li key={v.vue}>
              <b className="aide-num">{v.num}</b>
              <b className="aide-vue">{v.nom}</b>
              <span className="aide-quoi">{v.quoi}</span>
            </li>
          ))}
        </ol>

        <p className="aide-clavier">
          <b>Au clavier</b> — les touches <kbd>1</kbd> à <kbd>8</kbd> ouvrent ces huit vues dans
          l'ordre ci-dessus, et <kbd>/</kbd> saute au champ <b>Commodité</b>. Tout ce qui s'active au
          clic s'active aussi à <kbd>Entrée</kbd>.
        </p>

        <p className="aide-local">
          <b>Tout reste chez toi</b> — soute, corrections de prix et réglages vivent dans ce
          navigateur, jamais sur un serveur. Le bouton <b>⟐ Partager</b> fabrique un lien qui porte
          tes filtres, et rien d'autre. Une correction que tu saisis est locale et périme d'elle-même
          dès qu'UEX publie un relevé plus récent.
        </p>

        <p className="aide-rejeu">Ce panneau se rouvre par le <b>?</b> posé à côté du logo.</p>

        <button id="aideFermer" className="aide-ok" type="button" onClick={fermerAide}>
          Compris — au travail
        </button>
      </div>
    </div>
  );
}

/**
 * La garde est EN TÊTE, au-dessus de toute lecture du DOM : fermée, l'aide ne parcourt même pas le
 * rail. Et le dialogue est un composant SÉPARÉ pour que son montage soit exactement l'ouverture —
 * c'est ce qui fait du nettoyage de son effet le bon endroit où rendre le focus.
 */
export function Aide() {
  if (!etat.aideOuverte) return null;
  return <Dialogue />;
}
