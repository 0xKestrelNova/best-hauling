// La persistance et les permaliens (ADR-011).
//
// L'état — filtres, tri, vue, vaisseau, parcours — est sauvé dans `localStorage` ET encodé dans le
// hash de l'URL, pour reprendre où l'on s'est arrêté et partager une vue précise.
//
// **Ce module lit et écrit le DOM, et c'est la bonne place.** Vingt-quatre des trente et une clés
// sont des CHAMPS : leur vérité est dans le formulaire, pas dans `etat.ts`. Les recopier dans
// l'état créerait une seconde vérité sur les réglages les plus lus — c'est la décision prise avec
// le déménagement des globales (#135), et elle tient ici.
//
// Ce qui reste à `app.js` : les trois synchronisations d'INTERFACE que la restauration déclenche
// (indicateurs de tri, cases grisées, bouton de board). Le module les appelle par le rappel
// `apresChamps`, à l'intérieur du verrou `restoring` — c'est ce qui garantit qu'aucune d'elles ne
// puisse resauver au milieu d'une restauration.

import { decodeJourney, decodeState, encodeJourney, encodeState, safeKey } from "./logic.ts";
import type { EtatDecode } from "./types.ts";
import { etat } from "./etat.ts";

const STATE_KEY = "best-hauling-state";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;

const STATE_FIELDS = ["cargo", "budget", "search", "system", "freshness", "ship", "origin", "destSystem", "destTerminal", "chainOrigin", "hops", "station", "alk", "multiMode", "tourFrom", "tourScope"];
const STATE_CHECKS = ["useCargo", "useBudget", "sameSystem", "noOutpost", "legalOnly", "capStock", "multiCommodity", "autoload"];
// Champs qui gardent leur défaut HTML quand la clé est absente de l'état. #system, #freshness et
// #destSystem ont chacun une option VIDE (« Tous », « Toutes », « N'importe où ») : leur poser ""
// resélectionne bien ce défaut. #hops, lui, n'en a pas (2 / 3 / 4) — lui poser "" laisserait le menu
// visuellement VIDE alors que le calcul retomberait silencieusement sur 3 sauts.
const STATE_FIELDS_KEEP_DEFAULT = ["hops"];

let restoring = false; // évite de resauver pendant qu'on applique un état

function collectState(): Record<string, unknown> {
  // `cb` : board des commodités. Vide en mode Marché (défaut) -> encodeState l'omet, l'URL reste courte.
  const s: Record<string, unknown> = { v: etat.view, sk: etat.sortKey, sd: etat.sortDir, lk: etat.loopSortKey, ld: etat.loopSortDir, cb: etat.commBoard === "loot" ? "loot" : "" };
  STATE_FIELDS.forEach((id) => (s[id] = $(id)?.value ?? ""));
  STATE_CHECKS.forEach((id) => (s[id] = $(id)?.checked ? 1 : 0));
  if (etat.JOURNEY) s.j = encodeJourney(etat.JOURNEY); // compagnon de voyage (partageable)
  return s;
}

// Écrit l'état dans localStorage et renvoie sa forme encodée (null pendant une restauration : rien
// à resauver). TOUJOURS synchrone, y compris depuis la variante différée ci-dessous : une session ne
// doit pas se perdre parce que l'onglet a été rechargé ou fermé dans la demi-seconde qui suit.
function persistState(): string | null {
  if (restoring) return null;
  const str = encodeState(collectState());
  try { localStorage.setItem(STATE_KEY, str); } catch {}
  return str;
}

// Recopie l'état dans le hash de l'URL. WebKit plafonne replaceState à 100 appels / 10 s et lève
// SecurityError au-delà. L'URL n'est pas critique (localStorage porte déjà l'état, et l'écriture
// suivante réécrit TOUT, elle n'est pas incrémentale) — mais l'exception remontait jusqu'à
// copyShareLink, qui appelle saveState en PREMIÈRE instruction : le bouton « Partager » ne copiait
// alors plus rien, sans le moindre retour visuel.
function writeHash(str: string | null): void {
  try {
    history.replaceState(null, "", str ? "#" + str : location.pathname + location.search);
  } catch {}
}

// URL à partager, reconstruite depuis l'état ENCODÉ — jamais relue dans `location.href`. Une
// écriture de hash plafonnée est perdue pour de bon : la barre d'adresse reste alors figée au
// milieu de la rafale, et copier `location.href` partagerait des filtres périmés tout en
// annonçant « ✓ Lien copié », donc sans que rien ne le signale.
export function shareURL(str: string | null): string {
  const rel = str ? location.pathname + location.search + "#" + str : location.pathname + location.search;
  return new URL(rel, location.href).href;
}

// Sauvegarde complète ; renvoie l'état encodé (null pendant une restauration). Le hash est écrit
// IMMÉDIATEMENT, jamais différé : `loadState()` le fait PRIMER sur localStorage, donc un hash en
// retard — fût-ce de quelques centaines de ms — ressusciterait au rechargement l'état d'AVANT la
// dernière action (vue, filtres, station…). Le plafond WebKit se traite EN AMONT, à la source :
// tous les champs à saisie libre sont débouncés (cf. init), une rafale de frappe ne vaut donc plus
// qu'un seul appel. Le `try/catch` de writeHash n'est que le filet de sécurité.
export function saveState(): string | null {
  const str = persistState();
  if (str == null) return null;
  writeHash(str);
  return str;
}

export function loadState(): EtatDecode | null {
  let str = location.hash.replace(/^#/, "");
  if (!str) { try { str = localStorage.getItem(STATE_KEY) || ""; } catch {} }
  return decodeState(str);
}


/**
 * Restaure un état : les champs, puis les globales de tri et de vue, puis le parcours.
 *
 * `apresChamps` porte les synchronisations d'interface qui vivent encore dans `app.js`. Il est
 * appelé À L'INTÉRIEUR du verrou `restoring` — c'est ce qui empêche l'une d'elles de resauver au
 * milieu de la restauration, et c'est pour ça que ce n'est pas à l'appelant de le faire après.
 */
export function applyState(s: EtatDecode | null, apresChamps: () => void): void {
  if (!s) return;
  restoring = true;
  // Lecture SYMÉTRIQUE de l'écriture : encodeState omet les valeurs vides (URL courte), donc dans un
  // état venant de l'app une clé absente veut dire « champ vidé », pas « champ jamais renseigné ».
  // Sans ça, un budget effacé à la main revenait à 1 000 000 au rechargement — et le destinataire du
  // lien voyait un autre classement que son émetteur.
  // Encore faut-il que l'état VIENNE de l'app : n'importe quelle ancre (#top) se décode elle aussi en
  // objet, et vider tous les champs sur cette foi accueillerait l'arrivant sans soute ni budget.
  // `v` (la vue) est écrite à chaque sauvegarde par collectState et n'est jamais vide : elle signe l'état.
  const mine = s.v != null;
  STATE_FIELDS.forEach((id) => {
    if (s[id] != null) { const el = $(id); if (el) el.value = String(s[id]); }
    else if (mine && !STATE_FIELDS_KEEP_DEFAULT.includes(id)) { const el = $(id); if (el) el.value = ""; }
  });
  STATE_CHECKS.forEach((id) => { if (s[id] != null) { const el = $(id); if (el) el.checked = s[id] === "1"; } });
  if (safeKey(s.sk)) { etat.sortKey = s.sk; etat.sortDir = Number(s.sd) === 1 ? 1 : -1; }
  if (safeKey(s.lk)) { etat.loopSortKey = s.lk; etat.loopSortDir = Number(s.ld) === 1 ? 1 : -1; }
  // Liste blanche des vues restaurables. Y OUBLIER une vue neuve est le piège documenté par
  // l'ADR-004 : elle s'ouvre au clic, mais ne revient ni d'un permalien ni du localStorage — et
  // l'oubli ne se voit qu'au rechargement suivant.
  if (["routes", "loops", "enroute", "chain", "corrections", "commodities", "plan", "tour"].includes(s.v)) etat.view = s.v;
  if (s.cb === "loot") etat.commBoard = "loot";
  if (s.j) etat.JOURNEY = decodeJourney(s.j); // compagnon de voyage restauré (les champs sont déjà repris ci-dessus)
  apresChamps();
  restoring = false;
}

