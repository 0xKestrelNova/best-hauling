// LES DEUX SÉLECTEURS : la station des Corrections, et le vaisseau (ADR-011, ADR-012).
//
// ── POURQUOI CE N'EST PAS UN COMPOSANT REACT ──────────────────────────────────────────────────
// C'est la règle de la FRONTIÈRE (ADR-012 §2), appliquée telle quelle : `#stationPickList` et
// `#shipList` sont du markup d'`index.html`, et AUCUN portail de l'arbre ne les possède. Les y faire
// entrer voudrait dire soit deux portails de plus pour deux `<ul>` que personne d'autre ne lit, soit
// réécrire `index.html`. Ni l'un ni l'autre ne rend le code plus juste.
//
// Et surtout : `monterAutocompletion` sert DEUX widgets aux contrats différents — la liste des
// stations est groupée par système › zone, non plafonnée, et ses vignettes chargent des photos
// distantes ; celle des vaisseaux est plate, plafonnée à 12, et son choix écrit la soute. Un
// composant unique les réunirait derrière une douzaine de props, ce qui est exactement la migration
// de syntaxe que cette refonte refuse. Six tests e2e tiennent le comportement actuel ; il n'y a rien
// à y gagner et une classe de régressions à y perdre.
//
// ── CE QUI A CHANGÉ EN SORTANT D'`app.js` ─────────────────────────────────────────────────────
// `showShipCard` était un `let` de la coquille RÉASSIGNÉ depuis l'intérieur de `loadShips` : un
// appelant qui le lisait avant la réponse du fetch appelait une fonction vide, sans rien voir.
// La liste des vaisseaux est maintenant l'état du module, et `montrerCarteVaisseau()` la lit.

import { stationTree } from "./logic.ts";
import { etat } from "./etat.ts";
import { esc } from "./format.ts";
import { indexStationExacte } from "./marche.ts";
import { saveState } from "./persistance.ts";
import { rafraichir } from "./rendu.ts";

import type { Noeud } from "./types.ts";
// La CIBLE d'un événement, typée. `e.target` est un `EventTarget` : il n'a ni `closest`, ni
// `classList`, ni `id`. Le cast est posé UNE fois par module, comme `$` — pas dans un module
// partagé : c'est une expression d'une ligne, et six modules couplés à un alias ne valent pas
// l'économie (même choix que `$`, pris huit fois dans ce dépôt).
const cible = (e: Event) => e.target as Noeud;
/** La même, quand le code a déjà établi que la cible est un champ (garde par `id` ou par classe). */
const champ = (e: Event) => e.target as HTMLInputElement;


// `$` est typé `HTMLInputElement` et non `HTMLElement`, parce que dans CE module il ne sert
// qu'à des contrôles de formulaire — dont on lit ou écrit la `value`. C'est le même choix
// que `filtres.ts` et `persistance.ts` : l'alias dit ce que le module en fait.
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

// ── LE WIDGET ──────────────────────────────────────────────────────────────────────────────────
// Autocomplétion maison, partagée par le champ Vaisseau et le sélecteur de station (ADR-003).
// Un `<datalist>` natif ne se met pas en forme et cale sa liste sur la largeur du champ : les noms
// de station y sont tronqués (jusqu'à 33 caractères pour « Terra Gateway (Stanton) — Stanton »).
//
// Trois généralisations par rapport à l'autocomplétion vaisseau dont elle est tirée, chacune
// indispensable au sélecteur de station :
//   1. `options` est une FONCTION relue à chaque ouverture, et non un tableau capturé au montage :
//      les vaisseaux existent dès le départ, les stations seulement après market.json.
//   2. la navigation passe par `li[data-i]` et non par `list.children`. Des en-têtes de groupe
//      brisent la bijection enfants ↔ résultats : sans ce filtre, la 3e flèche bas poserait
//      `.active` sur un en-tête non sélectionnable et Entrée choisirait la mauvaise station.
//   3. `rendu` reçoit le tableau ENTIER et rend le HTML en bloc, ce qui permet d'intercaler
//      ces en-têtes.
/**
 * Monte une autocomplétion sur un champ et sa liste.
 *
 * `max = 0` veut dire « aucun plafond » — les 114 stations tiennent, les vaisseaux se coupent à 12.
 * Plafonner une liste sans le dire masque des entrées.
 */
export function monterAutocompletion({ input, list, options, filtre, rendu, choisir, max = 12 }) {
  let matches = [];
  let active = -1;
  const items = () => [...list.querySelectorAll("li[data-i]")];

  function hide() {
    list.hidden = true;
    list.innerHTML = "";
    active = -1;
    input.setAttribute("aria-expanded", "false");
  }

  // q vide -> toute la liste (parcours au focus) ; sinon filtre par sous-chaîne.
  function show(q) {
    const tout = options() || [];
    const pool = q ? tout.filter((o) => filtre(o, q)) : tout;
    matches = q && max > 0 ? pool.slice(0, max) : pool;
    if (!matches.length) return hide();
    active = 0;
    list.innerHTML = rendu(matches);
    highlight();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function highlight() {
    items().forEach((li, i) => li.classList.toggle("active", i === active));
    items()[active]?.scrollIntoView({ block: "nearest" });
  }

  function valide(o) {
    if (!o) return;
    hide();
    choisir(o);
  }

  input.addEventListener("input", () => show(input.value.trim().toLowerCase()));
  input.addEventListener("focus", () => show(input.value.trim().toLowerCase()));

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, matches.length - 1);
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      valide(matches[active]);
    } else if (e.key === "Escape") {
      hide();
    }
  });

  // mousedown (et non click) pour devancer le blur du champ.
  list.addEventListener("mousedown", (e) => {
    const li = cible(e).closest("li[data-i]"); // les en-têtes de groupe n'en portent pas : inertes
    if (!li) return;
    e.preventDefault();
    valide(matches[Number(li.dataset.i)]);
  });

  input.addEventListener("blur", () => setTimeout(hide, 150));
  return { hide, show };
}

// ── LE SÉLECTEUR DE STATION (vue Corrections) ──────────────────────────────────────────────────
// La dernière station RENDUE. Elle ne sert QU'au garde du champ `#station` — ne pas re-rendre si la
// station résolue n'a pas changé, sans quoi le rendu différé du debounce détache l'éditeur d'un
// chiffre ouvert entre les deux (même famille que #24). Ce n'est donc PAS la station affichée :
// celle-là se dérive à chaque lecture par `indexStationExacte()`.
//
// `undefined` et non `null` : `null` est une valeur mesurée (« le champ ne désigne rien »), et les
// confondre rendrait la première transition « restaurée par permalien → champ rendu illisible »
// invisible au garde — le panneau resterait sur l'ancienne station à côté d'un champ vide.
let derniereStation;

/** Enregistre la station courante comme étant celle qui vient d'être rendue. */
export const memoriserStation = () => { derniereStation = indexStationExacte(); };

/**
 * La station a-t-elle CHANGÉ depuis le dernier rendu ? Mémorise au passage.
 *
 * Le garde et sa mémoire sont indissociables — les séparer laisserait un appelant tester sans
 * mémoriser, et le rendu suivant se croirait toujours en retard.
 */
export function stationChangee() {
  const avant = derniereStation;
  memoriserStation();
  return derniereStation !== avant;
}

/**
 * Les 114 terminaux rangés système › zone › station (ADR-003). Monté une seule fois, quand le
 * marché est là.
 */
export function monterSelecteurStation() {
  const input = $("station"), list = $("stationPickList");
  if (!input || !list) return;
  // On aplatit l'arbre : le filtre et la navigation travaillent sur une liste PLATE déjà triée,
  // et c'est sa contiguïté par (système, zone) qui permet au rendu de reposer un en-tête au simple
  // changement de clé. Filtrer l'arbre lui-même casserait cette propriété.
  const plates = stationTree(etat.MARKET.terminals).flatMap((s) => s.zones.flatMap((z) => z.stations));

  // Un `<img onerror>` posé par innerHTML est INERTE sous `script-src 'self'` (index.html:23) et
  // laisserait une image cassée. Les événements `error` ne remontent pas, mais ils descendent :
  // un seul écouteur en phase de CAPTURE, posé une fois, couvre tous les rendus à venir.
  list.addEventListener("error", (e) => {
    if (cible(e).tagName === "IMG") cible(e).closest("li")?.classList.add("no-shot");
  }, true);

  monterAutocompletion({
    input, list,
    options: () => plates,
    // Nom ET code : taper « PYROG » remonte les deux passerelles homonymes, que le badge distingue.
    filtre: (s, q) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    max: 0, // 114 lignes tiennent : plafonner masquerait des stations sans le dire
    rendu: (m) => {
      let grp = "", html = "";
      m.forEach((s, i) => {
        const cle = `${s.system} › ${s.zone}`;
        // En-tête SANS data-i : ni sélectionnable au clavier, ni cliquable.
        if (cle !== grp) { grp = cle; html += `<li role="presentation" class="opt-grp">${badgeSysteme(s.system)}<span>${esc(s.zone)}</span></li>`; }
        html += `<li role="option" data-i="${i}">${vignetteStation(s)}` +
          `<span class="stn-opt-name">${esc(s.name)}</span>` +
          `<span class="stn-opt-code">${esc(s.code)}</span>` +
          (s.outpost ? '<span class="stn-opt-post" title="Avant-poste : élévateur de fret parfois en panne">⚠ avant-poste</span>' : "") +
          `</li>`;
      });
      return html;
    },
    // Écrit le LIBELLÉ CANONIQUE, jamais le nom seul : `indexStationExacte` résout par
    // correspondance exacte via stationMap, et c'est cette même chaîne que le permalien transporte.
    choisir: (s) => { input.value = s.label; memoriserStation(); rafraichir(); saveState(); },
  });
}

/**
 * Vignette d'une station : la photo UEX si elle existe, sinon un carré teinté par système portant
 * le code. 17 terminaux sur 114 n'ont pas de photo — la vignette générée évite le trou, sans
 * requête. Le filtre `^https://` est délibéré même si aucune URL non-https n'existe aujourd'hui :
 * l'attribut est interpolé dans du HTML, et c'est justement parce qu'aucune donnée ne le déclenche
 * qu'aucun test ne l'attraperait s'il manquait.
 */
function vignetteStation(s) {
  // La photo se pose EN ABSOLU par-dessus le repli, dans un conteneur commun. La superposer à coups
  // de marge négative les décalait de la valeur du `gap` flex, et le code débordait derrière la
  // photo (« TA » derrière celle de Nyx Gateway (Stanton), dont le code est NYXSTA).
  const photo = s.shot && /^https:\/\//i.test(s.shot)
    ? `<img class="stn-shot" src="${esc(s.shot)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  return `<span class="stn-vign sys-${esc((s.system || "").toLowerCase())}">` +
    `<span class="stn-shot-gen">${esc(s.code)}</span>${photo}</span>`;
}

/** Le nom d'un système en badge coloré. */
function badgeSysteme(system) {
  const cls = esc(system.toLowerCase());
  return `<span class="sys ${cls}">${esc(system)}</span>`;
}

// ── LE SÉLECTEUR DE VAISSEAU ───────────────────────────────────────────────────────────────────
// La liste est l'ÉTAT du module, et non une variable capturée par une fermeture : c'est ce qui
// permet à `montrerCarteVaisseau()` d'exister avant que le fetch ait répondu (voir l'en-tête).
let vaisseaux = [];

/**
 * Charge `data/ships.json` et monte le sélecteur.
 *
 * Un tableau vide est un échec ACCEPTÉ et silencieux : sans vaisseaux la soute se saisit à la main,
 * et rien d'autre de l'application n'en dépend.
 */
export async function chargerVaisseaux() {
  const ships = await fetch("data/ships.json").then((r) => r.json()).catch(() => []);
  // Tri par capacité de soute décroissante : les plus gros haulers apparaissent en premier.
  ships.sort((a, b) => b.scu - a.scu);
  vaisseaux = ships;

  const input = $("ship");
  const list = $("shipList");
  const byName = new Map(ships.map((s) => [s.name.toLowerCase(), s.scu]));

  monterAutocompletion({
    input, list,
    options: () => vaisseaux,
    filtre: (s, q) => s.name.toLowerCase().includes(q),
    rendu: (m) => m.map((s, i) =>
      `<li role="option" data-i="${i}"><span>${esc(s.name)}</span>` +
      `<span class="scu">${s.scu.toLocaleString("fr-FR")} SCU</span></li>`).join(""),
    choisir: (s) => {
      input.value = s.name;
      $("cargo").value = s.scu;
      carteVaisseau(s);
      rafraichir();
    },
  });

  // Modifier la soute à la main efface le nom du vaisseau et la carte.
  $("cargo").addEventListener("input", () => {
    const scu = byName.get(input.value.trim().toLowerCase());
    if (String(scu) !== $("cargo").value) {
      input.value = "";
      $("shipCard").hidden = true;
    }
  });
}

/**
 * Affiche la carte du vaisseau déjà présent dans le champ — après restauration d'un état.
 *
 * Sans effet si la liste n'est pas chargée ou si le nom ne correspond à rien : c'est un rappel
 * d'affichage, pas une validation de saisie.
 */
export function montrerCarteVaisseau() {
  const nom = $("ship")?.value.trim().toLowerCase();
  const s = nom && vaisseaux.find((x) => x.name.toLowerCase() === nom);
  if (s) carteVaisseau(s);
}

function carteVaisseau(s) {
  const card = $("shipCard");
  const img = $("shipImg");
  const wrap = img.parentElement;
  // N'accepte que des URL https:// (le flux communautaire pourrait contenir autre chose).
  if (s.photo && /^https:\/\//i.test(s.photo)) {
    wrap.style.display = "";
    img.onerror = () => (wrap.style.display = "none"); // masque si l'image échoue
    img.alt = s.name;
    img.src = s.photo;
  } else {
    wrap.style.display = "none";
  }
  $("shipCardName").textContent = s.name;
  $("shipCardScu").innerHTML = `Soute : <b>${s.scu.toLocaleString("fr-FR")} SCU</b>`;
  card.hidden = false;
}
