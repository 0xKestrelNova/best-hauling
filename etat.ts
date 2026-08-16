// L'ÉTAT PARTAGÉ (ADR-011, point d'action 2).
//
// Première étape du démontage d'`app.js` : les globales mutables déménagent ici, et `refresh()`
// gagne une notification. `app.js` continue de tourner par-dessus — la branche reste verte à cette
// étape, et rien ne s'abonne encore.
//
// ── POURQUOI UN OBJET, ET PAS CINQUANTE ACCESSEURS ────────────────────────────────────────────
// Les liaisons ES sont vivantes en LECTURE mais NON RÉASSIGNABLES depuis l'extérieur : un module
// qui importe `MARKET` le voit changer, il ne peut pas écrire `MARKET = …`. Or **50 des 53
// globales d'app.js sont réaffectées** (seules `originMap`, `stationMap` et `termByName` ne le sont
// jamais — elles n'ont donc aucun besoin d'être ici). Écrire une PROPRIÉTÉ (`etat.MARKET = …`) ne
// réassigne aucune liaison : le déménagement reste mécanique, et app.js continue d'écrire comme
// avant.
//
// ── POURQUOI LA NOTIFICATION RESTE EXPLICITE ──────────────────────────────────────────────────
// C'est le point qui décide de tout le reste, et ce n'est pas de la prudence : un magasin qui
// notifierait à l'écriture est ICI IMPOSSIBLE, pas seulement risqué.
//
//   1. Des RÉFÉRENCES VIVES sortent de l'état et sont mutées dehors. `legIntent()` (app.js) rend
//      `JOURNEY_EDITS[k]` tel quel, et l'appelant fait `intent[li].units = …`. Aucun proxy, aucun
//      accesseur, aucun compteur ne voit cette écriture. Même fuite pour `CHARGEMENTS[k]`,
//      `MANIFEST_EDIT.lines` et `currentManifest.lines[i].units`.
//   2. `logic.ts` MUTE `OVERRIDES` EN PLACE, pendant le rendu, à quatre endroits (`effFromStore`,
//      `setInStore`, `migrerCorrections`, `groupOverridesByTerminal`). On n'y touche pas : 483
//      tests en dépendent.
//   3. Trois chemins écrivent l'état PENDANT le rendu (`renderCommodities` revalide `commSelected`,
//      `legEffectiveLines` réécrit `JOURNEY_EDITS`, `compositionEnCours` réécrit `MANIFEST_EDIT`).
//      Sous notification automatique, chacun devient une boucle rendu → écriture → rendu.
//   4. `editLegQty` finit par un `setTimeout(renderJourney, 0)` DÉLIBÉRÉ — « le blur précède le
//      mouseup d'un clic en cours ». Notifier à l'écriture rejouerait ce bug.
//
// Donc : à cette étape, ce module est un DÉMÉNAGEMENT plus un canal de notification appelé à la
// main. Le magasin réactif, s'il vient, viendra avec la racine unique.
//
// ── LE SNAPSHOT EST UN COMPTEUR, JAMAIS L'OBJET ───────────────────────────────────────────────
// `useSyncExternalStore` compare par `Object.is`. Un objet muté en place rend toujours la même
// référence : React ne re-rendrait JAMAIS. D'où `version`, incrémentée par `notifier()`.

/** L'état partagé. Une propriété par globale déménagée d'`app.js`. */
export const etat: Record<string, unknown> = {};

let version = 0;
const abonnes = new Set<() => void>();

/**
 * La propagation. C'est `refresh()` renommé — pas un rival : `app.js` l'appelle À LA FIN de son
 * `refresh()`, et aux rendus ciblés qui ne passent pas par lui.
 *
 * `__notifs` est le compteur de MESURE de cette étape (cf. la PR). Il n'existe que si un test l'a
 * armé, donc il ne coûte rien en production. Il compte les PROPAGATIONS, là où
 * `e2e/smoke.pw.mjs:2182` compte des mutations DOM sur `#rows` — ce dernier resterait vert quoi
 * qu'il arrive ici, et donnerait un faux vert.
 */
export function notifier(): void {
  version++;
  const g = globalThis as { __notifs?: number };
  if (g.__notifs != null) g.__notifs++;
  for (const f of abonnes) f();
}

/** S'abonner aux propagations. Rend la fonction de désabonnement (contrat `useSyncExternalStore`). */
export function subscribe(f: () => void): () => void {
  abonnes.add(f);
  return () => { abonnes.delete(f); };
}

/** L'instantané comparé par React. Un nombre, jamais l'objet — voir l'en-tête. */
export function getSnapshot(): number {
  return version;
}
