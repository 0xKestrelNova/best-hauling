"use strict";

// L'AMORÇAGE — ce qui reste quand `app.js` a disparu (ADR-011, ADR-012).
//
// Ce fichier était `app.js` : 2 869 lignes, l'application entière. Il n'exportait rien, et c'est
// ce qui bloquait tout — aucun module ne pouvait l'appeler. Les huit vues vivent maintenant dans
// l'arbre React, les gestes dans leurs modules, le cycle dans `rendu.ts`. Ce qui subsiste est une
// SÉQUENCE : brancher, monter, écouter, charger, restaurer, peindre.
//
// ── POURQUOI CE N'EST PAS UN COMPOSANT ────────────────────────────────────────────────────────
// Rien ici n'a de raison d'entrer dans l'arbre. Les `<datalist>` sont des `<option>` nus posés une
// fois. `#meta`, `#railStatus` et `#railVersion` vivent dans l'en-tête et le rail, hors de
// `#racine`, alimentés par un `meta.json` lu UNE fois. Et les quarante écouteurs sont posés sur du
// markup d'`index.html` : une délégation posée sur un parent que React ne possède pas traverse le
// portail intacte (ADR-012 §2). La convertir en `onClick` doublerait l'action, et seul un compteur
// de propagations le verrait.
//
// ── QUATRE ORDRES SONT DES CONTRATS ───────────────────────────────────────────────────────────
//   1. `brancher()` AVANT `monterRacine()`. Le crochet vaut `() => {}` par défaut : posé après, la
//      première passe de l'arbre appellerait dans le vide, sans la moindre erreur — datalists
//      vides, `stationMap` vide, vue Corrections inerte ;
//   2. `loadChargements()` APRÈS `loadSoute()`. Sa migration reconstruit le registre DEPUIS les
//      lots et resauve les deux. Inversée, elle le reconstruirait sur une soute vide et
//      persisterait la perte, définitivement et sans message ;
//   3. `loadState()` AVANT le premier `await`. Les écouteurs sont déjà posés, et `saveState()`
//      réécrit le hash : décalé après le fetch, un geste fait pendant le chargement écraserait le
//      permalien — c'est-à-dire précisément sur connexion lente, le cas où le lien compte ;
//   4. les `<option>` de `#system` AVANT `applyState()`. Poser `select.value = "Stanton"` sur un
//      `<select>` qui n'a pas l'option retombe SILENCIEUSEMENT sur `""` : le filtre restauré
//      s'évapore, et un lien partagé n'ouvre pas la même vue. Aucun test ne le verrait.
//
// `tsc` ne lit pas ce fichier (hors `include` de `tsconfig.json`) : un identifiant libre ne se voit
// qu'à l'exécution, par les tests Playwright.

// Fonctions de calcul pures (testées par logic.test.mjs).
import { etat } from "./etat.ts";
import { loadOverrides } from "./corrections.ts";
import { updateOvBadge } from "./corrections-actions.ts";
import { showToast } from "./messages.ts";
import { loadAutoloadK } from "./frais.ts";
import { applyState, loadState } from "./persistance.ts";
import { brancher } from "./donnees.ts";
import { basculerVue, brancherNavigation } from "./navigation.js";
import { synchroniserReglages } from "./filtres.ts";
import { brancherTri, poserIndicateursDeTri } from "./tri.js";
import { brancherControles } from "./controles.js";
import { brancherGestesCorrections } from "./corrections-gestes.js";
import { brancherGestesSoute } from "./soute-gestes.js";
import { peuplerListes } from "./listes.js";
import { rafraichir } from "./rendu.ts";
import { loadChargements, loadDepots, loadSoute } from "./soute-actions.js";
import { loadManifestEdit } from "./manifeste-etat.ts";
import { brancherGestesManifeste } from "./manifeste-gestes.js";
import { brancherPressePapiers } from "./presse-papiers.js";
import { brancherGestesVoyage } from "./voyage-gestes.js";


import { chargerVaisseaux, montrerCarteVaisseau } from "./selecteur.js";
import { monterRacine } from "./main.tsx";
import { loadJourneyEdits, loadJourneyPins } from "./voyage-donnees.ts";
// Une seule chose de la vue Commodités arrive ici : le REFLET de son segmenté, que le rappel de
// restauration doit rejouer. Ses écouteurs, eux, sont partis dans `controles.js`.
import { refletBoardCommodites } from "./vues/commodites-vue.tsx";


const $ = (id) => document.getElementById(id);

/** Prévient que le marché est indisponible, plutôt que de laisser la vue vide ET muette. */
const marcheIndisponible = () => showToast("⚠ Marché indisponible — vérifie ta connexion, puis réessaie");

async function init() {
  // Les deux crochets du chargement : `donnees.ts` sait charger, il ne sait rien des `<datalist>`
  // ni des messages. `peuplerListes` DOIT tourner avant chaque rappel de `withMarket` — le déclarer
  // ici une fois vaut mieux que de le répéter à seize appels.
  brancher({ apresMarche: peuplerListes, signalerIndisponible: marcheIndisponible });
  // (Le second crochet, `brancherRendu`, n'existe plus : le cycle EST `rendu.ts`, et tout le monde
  // l'importe — y compris ce fichier. Il n'y a plus rien à brancher.)
  // La racine unique. Elle s'abonne à `etat` : à partir d'ici, une vue qui y vit se re-rend
  // toute seule à chaque `notifier()`, sans que `rafraichir()` ait à la nommer.
  monterRacine();
  brancherTri();
  poserIndicateursDeTri(); // aria-sort/classes du tri par défaut, sans dépendre des attributs du HTML
  // LE CÂBLAGE, en sept lignes. Chaque module pose SES écouteurs sur le markup d'`index.html` qui
  // le concerne. Aucun n'est converti en `onClick` React : posés sur des conteneurs que les portails
  // remplissent sans les posséder, ils traversent les rendus (ADR-012 §2), et les convertir
  // doublerait les gestes non idempotents.
  //
  // L'ORDRE COMPTE POUR UN SEUL COUPLE, et il est écrit des deux côtés : `navigation.js` et
  // `voyage-gestes.js` posent chacun un `keydown` sur `document`. Ils ne se recouvrent pas — celui
  // des raccourcis sort si `activeElement` est un champ de saisie — mais leur ordre d'exécution est
  // devenu leur ordre de branchement ici.
  brancherControles();
  brancherNavigation();
  brancherPressePapiers();
  brancherGestesCorrections();
  brancherGestesManifeste();
  brancherGestesSoute();
  brancherGestesVoyage();

  loadOverrides();
  loadAutoloadK();
  loadJourneyEdits();
  loadJourneyPins();
  loadManifestEdit();
  loadSoute();
  loadChargements(); // après loadSoute : la migration reconstruit le registre depuis les lots
  loadDepots();
  updateOvBadge();
  synchroniserReglages();

  // État à restaurer (URL partagée en priorité, sinon dernière session locale).
  const saved = loadState();

  try {
    const [routes, loops, meta] = await Promise.all([
      fetch("data/routes.json").then((r) => r.json()),
      fetch("data/loops.json").then((r) => r.json()).catch(() => []),
      fetch("data/meta.json").then((r) => r.json()).catch(() => null),
      chargerVaisseaux(),
    ]);
    etat.ROUTES = routes;
    etat.LOOPS = loops;

    // Remplit les filtres système (achat + vente) : #system et la destination « En route ».
    const systems = [...new Set(routes.flatMap((r) => [r.buy.system, r.sell.system]))].sort();
    const sel = $("system"), dest = $("destSystem");
    systems.forEach((s) => {
      sel.appendChild(new Option(s, s));
      dest.appendChild(new Option(s, s));
    });

    if (meta) {
      const d = new Date(meta.generated_at * 1000);
      const ageH = (Date.now() / 1000 - meta.generated_at) / 3600;
      const rel = ageH < 1 ? "il y a moins d'1 h" : ageH < 24 ? `il y a ${Math.round(ageH)} h` : `il y a ${Math.round(ageH / 24)} j`;
      const stale = ageH > 6; // données rafraîchies chaque heure : au-delà de 6 h, pipeline suspect
      const tier = stale ? "f-old" : ageH < 3 ? "f-good" : "f-ok"; // couleurs de fraîcheur partagées
      const exact = d.toLocaleString("fr-FR");
      // Haut-droite : indicateur de fraîcheur uniquement.
      $("meta").innerHTML =
        `<span class="freshness-ind ${tier}" title="Données UEX du ${exact}"><span class="fi-dot"></span>Données ${rel}${stale ? " ⚠" : ""}</span>`;
      // Bas du rail (« Flux UEX ») : dernière mise à jour + compteurs.
      const rs = $("railStatus");
      if (rs) rs.innerHTML =
        `<div class="rs-updated">Dernière MàJ<br><b>${exact}</b></div>` +
        `<div class="rs-counts"><b>${meta.routes}</b> routes · <b>${meta.loops ?? etat.LOOPS.length}</b> boucles · <b>${meta.commodities}</b> commodités</div>`;
      // Version déployée, et le commit qui l'a produite. Sans ça, un rapport de bug n'est
      // rattachable à rien : on ne sait pas si l'utilisateur regarde le `main` d'il y a dix minutes
      // ou une coquille servie depuis son cache d'il y a trois semaines. Silencieux si l'estampille
      // manque — l'amorce versionnée dans data/ ne la porte pas tant qu'un build n'est pas passé,
      // et « v— » vaudrait moins que rien.
      const rv = $("railVersion");
      if (rv && meta.app_version) {
        rv.textContent = `v${meta.app_version}${meta.commit ? ` · ${meta.commit}` : ""}`;
        rv.title = `Version déployée${meta.commit ? ` — commit ${meta.commit}` : ""}. À citer dans un rapport de bug.`;
      }
    }
    // Applique l'état restauré une fois le menu système peuplé, puis affiche la bonne vue.
    // Les trois synchros d'interface restent ici ; le module les appelle DANS le verrou de
    // restauration, pour qu'aucune ne puisse resauver au milieu.
    applyState(saved, () => { poserIndicateursDeTri(); synchroniserReglages(); refletBoardCommodites(); });
    montrerCarteVaisseau(); // ré-affiche la carte du vaisseau restauré (image comprise)
    // Le compagnon de voyage vient d'un permalien, donc de données non fiables. S'il échoue, il ne
    // doit pas emporter TOUTE l'app dans le catch ci-dessous, qui accuserait alors data/routes.json
    // — parfaitement chargé — et laisserait l'utilisateur devant une page vide et un message faux.
    try {
      rafraichir();
    } catch (err) {
      etat.JOURNEY = null;
      rafraichir();
      showToast("⚠ Parcours illisible dans le lien — il a été ignoré");
    }
    basculerVue(etat.view);
  } catch (e) {
    $("meta").textContent = "Erreur de chargement des données.";
    $("empty").hidden = false;
    $("empty").textContent = "Impossible de charger data/routes.json — lance le script de mise à jour.";
    console.error(e);
  }
}

init();

// PWA : installable + consultable hors-ligne (ignoré si non supporté / hors contexte sécurisé).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
