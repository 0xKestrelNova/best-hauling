// La VUE « En route » : le composant qui décide quoi afficher (ADR-011 étape 3, ADR-012).
//
// La HUITIÈME et dernière vue d'onglet. Après elle, `refresh()` n'a plus aucune branche de vue.
//
// Elle occupe DEUX conteneurs : la carte de chargement (`#manifest`) et la table du fret rentable
// (`#enrouteRows`). Un seul composant, comme partout ailleurs — ils partagent `readFilters()`, le
// départ, l'arrivée forcée, et l'ordre dans lequel ils sont calculés n'est pas indifférent : la
// carte lit la composition manuelle, la table non.
//
// ── LES DÉLÉGATIONS RESTENT ───────────────────────────────────────────────────────────────────
// Les trois écouteurs de `#manifest` (input, click, keydown) sont posés sur le CONTENEUR, que React
// ne possède pas : il rend dedans. Les événements natifs y remontent à travers le portail. Les
// convertir en `onClick` ne gagnerait rien et coûterait une réécriture de tests (ADR-012 §2).
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import { bySort, enRouteDeals, routePasses } from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { readFilters } from "../filtres.ts";
import { notifySuperseded } from "../corrections-actions.ts";
import { withMarket } from "../donnees.ts";
import { feeEndText, feeResolver } from "../frais.ts";
import { fmt, scuBoxesLabel } from "../format.ts";
import { tripMinutes } from "../logic.ts";
import { isOv } from "../corrections.ts";
import { corriger } from "../corrections-actions.ts";
import { indexArriveeForcee, indexOrigine } from "../marche.ts";
import { manifesteCourant, manifestRemaining, suggestionsFor } from "../manifeste-donnees.ts";
import { generationManifeste } from "../manifeste-etat.ts";
import { messageVide } from "./message-vide.ts";
import { propsLignesSimples, propsTrajetsCommunes } from "./trajets-props.tsx";
import { VueTrajets } from "./trajets.tsx";
import { carteManifeste, indiceAucunChargement, indiceSouteInactive, indiceSoutePleine } from "./manifeste.tsx";
import { evaluate } from "./trajets-vue.tsx";

const champ = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

function Portail({ id, children }: { id: string; children: React.ReactNode }) {
  const cible = document.getElementById(id);
  return cible ? createPortal(children, cible) : null;
}

export function VueEnRoute() {
  useLayoutEffect(notifySuperseded);

  const active = etat.view === "enroute";
  let carte: React.ReactNode = null;
  let carteVisible = false;
  let table: React.ReactNode = null;
  let message: string | null = null;

  if (active && !etat.MARKET) {
    // Cette vue n'a RIEN de vrai à écrire dans `#empty` tant que le marché manque : ce n'est pas un
    // filtre qui vide la table, c'est la donnée qui n'est pas là (#26).
    withMarket(notifier);
  } else if (active) {
    const f = readFilters();
    const origin = indexOrigine();

    // ── La carte de chargement ────────────────────────────────────────────────────────────────
    const r = manifesteCourant(f);
    carteVisible = r.etat !== "sans-depart";
    if (r.etat === "soute-inactive") carte = indiceSouteInactive();
    else if (r.etat === "soute-pleine") carte = indiceSoutePleine(fmt(r.aBord));
    else if (r.etat === "aucun") carte = indiceAucunChargement(r.aBord > 0 ? fmt(r.libre) : null);
    else if (r.etat === "ok") {
      const m = r.m!;
      carte = carteManifeste({
        m,
        generation: generationManifeste(),
        compose: !!etat.MANIFEST_EDIT,
        parcours: etat.JOURNEY,
        suggestions: suggestionsFor(m),
        restant: manifestRemaining(m),
        libelleCaisses: (units: number) => scuBoxesLabel(units, m.origin.maxBox),
        texteBoutFrais: feeEndText,
        minutesTrajet: tripMinutes(0, m.cross),
        estCorrige: isOv,
        corriger, // six arguments dans le même ordre : passé nu, comme pour les Trajets
      });
    }

    // ── La table du fret rentable ─────────────────────────────────────────────────────────────
    if (origin == null) {
      message = "Choisis un terminal de départ pour voir le fret à emporter.";
    } else {
      const destSystem = champ("destSystem");
      // `sysFilter: ""` — le système d'arrivée est filtré par `destSystem` (ou le terminal forcé),
      // pas par le menu « système d'achat ».
      const ef = { ...f, sysFilter: "" };
      // Le contexte de frais descend DANS `enRouteDeals` : elle ne garde qu'UNE vente par
      // commodité, donc une destination meilleure en net n'entrerait jamais dans la liste — et la
      // carte juste au-dessus afficherait la destination inverse.
      const deals = enRouteDeals(etat.MARKET!, origin, destSystem, indexArriveeForcee(), f, feeResolver(f))
        .filter((d) => routePasses(d, ef))
        .map((d) => evaluate(d, f));
      deals.sort(bySort(etat.sortKey, etat.sortDir));
      table = <VueTrajets {...propsTrajetsCommunes()} {...propsLignesSimples()} lignes={deals} />;
      message = deals.length ? null : "Aucun fret rentable depuis ce terminal avec ces filtres.";
    }
  }

  // `#empty` et `hidden` sont des nœuds/attributs qu'aucun portail ne possède.
  useLayoutEffect(() => {
    if (!active) return;
    messageVide(message);
    const card = document.getElementById("manifest");
    if (card) card.hidden = !carteVisible;
  });

  if (!active) return null;
  return (
    <>
      <Portail id="manifest">{carte}</Portail>
      <Portail id="enrouteRows">{table}</Portail>
    </>
  );
}
