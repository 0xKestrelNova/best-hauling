// La CARTE DU PARCOURS : le composant qui décide s'il y a quelque chose à dessiner (ADR-012).
//
// `carte.tsx` garde la PRÉSENTATION — le SVG, les nœuds, le vaisseau. Ce fichier-ci décide : pas de
// voyage, pas de marché, pas de starmap, ou pas de géométrie calculable → rien.
//
// ── UNE GARDE POSITIVE, ET C'EST L'INVERSE DU BANDEAU ─────────────────────────────────────────
// `#journeyMap` vit DANS la section du Plan de vol (index.html), entre `#planHead` et `#planBody`.
// Il n'est donc visible que là — une vue sur huit. Or `renderJourney()` le repeignait à CHAQUE
// `refresh()`, depuis les huit vues : un `journeyMap()` complet, la géométrie de tous les arrêts
// recalculée, pour un `<aside>` que sept vues sur huit n'affichent pas.
//
// Il prend donc `si="plan"`, la garde POSITIVE du patron des vues d'onglet. Le bandeau, lui, devra
// faire l'inverse — il est visible partout SAUF dans le Plan.
import { useLayoutEffect } from "react";

import { journeyMap, journeyStations, stationLabel } from "../logic.ts";
import { etat, notifier } from "../etat.ts";
import { ensureStarmap } from "../donnees.ts";
import { stationMap } from "../marche.ts";
import { jambeChargee } from "../voyage-donnees.ts";
import { carteParcours } from "./carte.tsx";

export function CarteParcours() {
  // `hidden` est un attribut du conteneur, pas un de ses enfants : un portail ne le gère pas. Il
  // reste donc posé à la main, comme `#empty` — et en `useLayoutEffect`, avant la peinture.
  const c = calculer();
  useLayoutEffect(() => {
    const box = document.getElementById("journeyMap");
    if (box) box.hidden = !c;
  });
  return c ? carteParcours(c) : null;
}

function calculer() {
  if (!etat.JOURNEY || !etat.MARKET) return null;
  // La starmap est chargée à la demande, et son échec est SILENCIEUX : un panneau décoratif
  // n'alarme personne. `notifier` et non un rendu ciblé — c'est l'arbre qui décidera quoi refaire.
  if (!etat.STARMAP) { ensureStarmap(notifier); return null; }

  const info = (nom: string) => {
    const etape = journeyStations(etat.JOURNEY!).find((s) => s.name === nom);
    const i = stationMap.get(stationLabel(nom, etape?.system || ""));
    return i == null ? null : etat.MARKET!.terminals[i];
  };
  // Jambe courante chargée = on a payé et on est parti : le vaisseau quitte le quai sur la carte.
  const legCourante = etat.JOURNEY.legs[etat.JOURNEY.current];
  const enVol = !!legCourante && jambeChargee(legCourante, etat.JOURNEY.current);
  return journeyMap(journeyStations(etat.JOURNEY), etat.JOURNEY.current, etat.STARMAP, info, enVol);
}
