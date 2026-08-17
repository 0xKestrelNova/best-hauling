// Fonctions de calcul PURES (sans DOM ni état) — utilisées par app.js (navigateur) et
// couvertes par logic.test.mjs (node --test). Aucune dépendance.

// ---------- Temps de trajet estimé ----------
// Constantes approximatives — servent surtout à classer les routes entre elles.
// Le vocabulaire du domaine vit dans types.ts (refonte v2, ADR-008). `import type` et non
// `import` : `verbatimModuleSyntax` l'exige, et c'est ce qui permet à Node d'effacer la ligne
// entière à l'exécution — sans quoi il chercherait un module qui ne rend aucune valeur.
import type {
  Ancre, BornesK, Boucle, BoucleFiltrable, Caisse, CandidatChargement, Carte, Chaine,
  ChaineChiffree, ChampCorrection, ChargementDuSaut, Chargements, ClassableParValeur,
  CleDeValeur, Commodite, CommoditeChargeable, CommoditeIdentite, CompositionManifeste,
  ContexteManifeste, Correction, CorrectionRelue, Cote, CoteMarche, CoteResolu, Destination,
  DetailCommodite, EnteteExport, Entrepots, EtatDecode, EtatVoyageManifeste, ExportCorrections,
  ExtremitesFrais, Filtres, FiltresBoard, FiltresListe, FiltresVolume, GrilleAutoload,
  GroupeCorrections, GroupeSoute, InfoTerminal, IntentionLigne, ItemChargeable, Jambe,
  JambeChaine, LigneChargement, LigneManifeste, Lot, Marche, MargeNette, MetriquesBoucle,
  MetriquesRoute, MetriquesTrajet, NoeudSysteme, OptionsChaine, OptionsEcoulement,
  OptionsTournee, PaireFrais, PalierValeur, Parcours, PointFrais, PointMarche, PointVente,
  PorteursDeRang, Prise, Releves, Resolveur, ResolveurCorrections, ResolveurFrais,
  RestantManifeste, ResumeCommodite, Retrait, RetraitArret, Route, RouteFiltrable, RouteResolue,
  SansDebouche, SegmentResolu, Starmap, Station, StoreCorrections, SuggestionArret,
  SystemeCarte, TarifTerminal, Terminal, TotauxManifeste, Tournee, Trajet, ValeurEffective,
  ValeursEffectives, VenteEtape, VenteSoute, VueManifeste,
  VenteAuTerminal, DisqueSysteme,
} from "./types.ts";

export const HANDLING = 3, PER_DIST = 0.06, JUMP = 4;
export function tripMinutes(distance: number | null | undefined, cross: boolean): number {
  return 2 * HANDLING + (distance || 0) * PER_DIST + (cross ? JUMP : 0);
}
export function loopMinutes(distance: number | null | undefined, cross: boolean): number {
  return 4 * HANDLING + (distance || 0) * PER_DIST + (cross ? 2 * JUMP : 0);
}

// ---------- Fraîcheur ----------
// Âge d'un relevé en jours (null si date inconnue). nowSec injectable pour les tests.
export function ageDays(updated: number | null | undefined, nowSec: number = Date.now() / 1000): number | null {
  if (!updated) return null;
  return (nowSec - updated) / 86400;
}
// Âge d'une route/boucle = le relevé le plus ancien des deux extrémités.
export function pairAge(a: number | null | undefined, b: number | null | undefined, nowSec: number = Date.now() / 1000): number | null {
  const u = a && b ? Math.min(a, b) : a || b || 0;
  return ageDays(u, nowSec);
}
// Facteur de fraîcheur : 1.0 tout frais -> 0.2 au-delà de ~11 j ; 0.5 si date inconnue.
export function freshnessFactor(age: number | null): number {
  if (age == null) return 0.5;
  return Math.max(0.2, 1 - age / 14);
}
// Certitude du volume : quelle PART du chargement repose sur une capacité réellement publiée.
//
// Remplace l'ancien `availabilityFactor`, qui punissait les PETITS volumes (ADR-005). Deux raisons
// de l'abandonner, mesurées : `computeUnits` plafonne déjà les unités par le stock, donc le profit
// est déjà amputé — le remultiplier comptait la même contrainte deux fois ; et en multi-commodité,
// une ligne de bouchage de 2 SCU sur 93 faisait tomber le facteur de 0,602 à 0,311, divisant la
// note par 1,93 pour 0,2 % du profit.
//
// Ce qu'on ignore vraiment n'est pas la petitesse, c'est l'ABSENCE de donnée : 494 points d'achat
// sur 494 publient leur stock (100 %), contre 307 points de vente sur 1 879 (16 %) pour la demande.
// Une demande inconnue, c'est un pari sur ce que le comptoir reprendra.
//
// PLANCHER À 0,5, et il est délibéré : une demande non publiée n'est pas une donnée nulle, c'est une
// donnée manquante — le stock d'achat, lui, reste connu, donc le chargement est à moitié vérifié.
// Sans ce plancher, 81 % des routes afficheraient une fiabilité de 0, ce qui ne distinguerait plus
// rien.
export const CERTITUDE_PLANCHER = 0.5;
export function certitudeVolume(scuConnus: number, scuTotal: number): number {
  if (!(scuTotal > 0)) return CERTITUDE_PLANCHER;
  const part = Math.max(0, Math.min(1, scuConnus / scuTotal));
  return CERTITUDE_PLANCHER + (1 - CERTITUDE_PLANCHER) * part;
}
// Volume le plus contraignant de deux segments, en ignorant les capacités inconnues
// (`Math.min(null, x)` vaudrait 0 et ferait passer un segment inconnu pour saturé).
export function tighterVolume(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

// ---------- Profit horaire & score brut (partagés routes/boucles) ----------
// Profit par heure d'un trajet (null si le profit n'est pas borné = pas de contrainte de volume).
export function profitPerHour(profit: number | null, minutes: number): number | null {
  return profit == null ? null : (profit * 60) / minutes;
}
// FIABILITÉ d'une ligne, de 10 à 100. Ce n'est plus un classement : c'est ce qu'on sait de la
// donnée sur laquelle le chiffre repose (ADR-005). Le tri, lui, se fait sur le profit net.
//
// L'ancien score multipliait le profit par ces mêmes facteurs, avec un correctif allant jusqu'à
// 16,7× appliqué à un montant qui s'étale sur plusieurs ordres de grandeur : la route la plus
// rentable de l'instantané (1 759 500 aUEC) tombait ainsi au 8e rang, derrière une route qui
// rapporte 2,7 fois moins. On sépare donc les deux questions au lieu de les mélanger.
export function fiabiliteDe(age: number | null, scuConnus: number, scuTotal: number): number {
  return Math.round(100 * freshnessFactor(age) * certitudeVolume(scuConnus, scuTotal));
}

// Largeur de la mini-barre de fiabilité, en pourcentage. On borne le DESSIN, jamais la MESURE.
// Le garde date de #39, quand le score composite pouvait devenir négatif : `width:-1441%` est une
// déclaration CSS invalide, donc ignorée, donc l'élément retombait en `width:auto`, qui remplit son
// parent — la pire ligne du tableau portait ainsi la plus grosse barre. La fiabilité, elle, ne peut
// plus sortir de [0, 100] par construction (ADR-005) ; ce garde reste en CEINTURE, et parce qu'un
// score absent doit valoir 0 plutôt qu'un `width:NaN%` qui retomberait dans le même piège.
export function scoreBarWidth(score: number | null | undefined): number {
  return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
}

// ---------- Tri (valeurs nulles en bas ; chaînes sensibles à la locale) ----------
export function bySort<T extends Record<string, any> = Record<string, any>>(key: string, dir: number): (a: T, b: T) => number {
  return (a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv, "fr") * dir;
    return av > bv ? dir : av < bv ? -dir : 0;
  };
}

// ---------- Filtrage partagé (routes simples, « En route », boucles) ----------
// f = { sameOnly, noOutpost, legalOnly, sysFilter, maxAge, q }. sysFilter vide = pas de filtre système.
// La vue « En route » passe sysFilter:"" (le système d'achat est déjà fixé par le terminal de départ).
export function routePasses(r: RouteFiltrable, f: FiltresListe): boolean {
  if (f.sameOnly && !r.same_system) return false;
  if (f.noOutpost && (r.buy.outpost || r.sell.outpost)) return false;
  if (f.legalOnly && r.illegal) return false;
  if (f.sysFilter && r.buy.system !== f.sysFilter) return false;
  if (f.maxAge) {
    const a = pairAge(r.buy.updated, r.sell.updated);
    if (a == null || a > f.maxAge) return false;
  }
  if (f.q && !r.commodity.toLowerCase().includes(f.q)) return false;
  return true;
}
// Boucle A⇄B : le filtre système garde la boucle si A OU B correspond ; recherche sur les deux commodités.
export function loopPasses(l: BoucleFiltrable, f: FiltresListe): boolean {
  if (f.sameOnly && l.a.system !== l.b.system) return false;
  if (f.noOutpost && (l.a.outpost || l.b.outpost)) return false;
  if (f.legalOnly && (l.out.illegal || l.back.illegal)) return false;
  if (f.sysFilter && l.a.system !== f.sysFilter && l.b.system !== f.sysFilter) return false;
  if (f.maxAge) {
    const a = pairAge(l.out.updated, l.back.updated);
    if (a == null || a > f.maxAge) return false;
  }
  if (f.q && !(l.out.commodity.toLowerCase().includes(f.q) || l.back.commodity.toLowerCase().includes(f.q))) return false;
  return true;
}

// ---------- Unités achetables selon les contraintes actives ----------
// f = { cargo, budget, capStock, useCargo, useBudget }. Infinity si aucune contrainte de volume.
// demandKnown = true si la demande est fiable (corrigée par l'utilisateur) -> un 0 plafonne à 0.
export function computeUnits(price: number, stock: number, demand: number | null, f: Filtres, demandKnown: boolean = false): number {
  const byCargo = f.useCargo ? f.cargo : Infinity;
  const byBudget = f.useBudget && f.budget > 0 ? Math.floor(f.budget / price) : Infinity;
  let units = Math.min(byCargo, byBudget);
  if (f.capStock) {
    // Stock à l'achat : 0 = terminal vide (dans les données UEX, stock 0 => statut « Vide ») -> plafonne à 0.
    units = Math.min(units, stock);
    // Demande à la vente = capacité restante du terminal. null = capacité inconnue chez UEX
    // (pas de plafond) ; 0 CONNU = terminal saturé, il ne prend plus rien -> plafonne à 0.
    if (demand != null || demandKnown) units = Math.min(units, demand);
  }
  if (isFinite(units) && units < 0) units = 0;
  return units;
}

// ---------- Champs dérivés d'un trajet (unités, profit, temps, score) ----------
// Cœur de calcul PUR d'une route dont les prix/volumes sont déjà résolus (corrections appliquées
// en amont). m = { buyPrice, buyStock, sellDemand, margin, distance, sameSystem, buyUpdated,
// sellUpdated, demandKnown }. Renvoie units/investment (null si non bornés) + profit/minutes/
// profitHour/fiabilite. `evaluate` (app.js) applique d'abord les corrections puis délègue ici.
// `autoload` = { buy, sell } (points de frais résolus par l'appelant, qui seul connaît les
// terminaux) ; null = interrupteur inactif -> `fees` à 0 et profit BRUT, comme avant.
// Une route non bornée n'a pas de volume : aucun frais n'y est calculable (son profit est déjà
// null), et son score reste donc assis sur la marge brute par SCU.
export function routeMetrics(m: RouteResolue, f: FiltresVolume, autoload: PaireFrais | null = null): MetriquesRoute {
  const units = computeUnits(m.buyPrice, m.buyStock, m.sellDemand, f, m.demandKnown);
  const bounded = isFinite(units);
  const fees = bounded ? haulFee(units, autoload) : 0;
  const profit = bounded ? units * m.margin - fees : null;
  const minutes = tripMinutes(m.distance, !m.sameSystem);
  const profitHour = profitPerHour(profit, minutes);
  // Une route ne porte qu'une commodité : sa demande est publiée, ou elle ne l'est pas. La certitude
  // vaut donc 1 ou son plancher, sans nuance possible.
  const scu = bounded ? units : 0;
  const age = pairAge(m.buyUpdated, m.sellUpdated);
  const partVolume = m.sellDemand == null ? 0 : 1;
  const fiabilite = fiabiliteDe(age, partVolume * scu, scu);
  return {
    age, partVolume,
    units: bounded ? units : null,
    investment: bounded ? units * m.buyPrice : null,
    profit, minutes, profitHour, fiabilite, fees,
  };
}

// Idem pour une boucle A⇄B (deux segments). out/back = { buyPrice, stock, demand, margin,
// updated, demandKnown }. La boucle n'est bornée que si SES DEUX segments le sont.
// `autoload` = { a, b } : les points de frais des deux EXTRÉMITÉS (une boucle n'a pas un terminal
// d'achat et un de vente, elle a deux stations qui sont tour à tour l'un et l'autre). D'où QUATRE
// opérations facturées : charge en A + décharge en B pour l'aller, charge en B + décharge en A
// pour le retour. Les paires sont inversées entre les deux jambes parce que les caisses de chaque
// jambe sont faites à SON terminal de départ (hypothèse 1).
export function loopMetrics(out: SegmentResolu, back: SegmentResolu, distance: number | null | undefined, cross: boolean, f: FiltresVolume, autoload: ExtremitesFrais | null = null): MetriquesBoucle {
  const loopMargin = out.margin + back.margin;
  const uOut = computeUnits(out.buyPrice, out.stock, out.demand, f, out.demandKnown);
  const uBack = computeUnits(back.buyPrice, back.stock, back.demand, f, back.demandKnown);
  const bounded = isFinite(uOut) && isFinite(uBack);
  const minutes = loopMinutes(distance, cross);
  const fees = bounded && autoload
    ? haulFee(uOut, { buy: autoload.a, sell: autoload.b }) + haulFee(uBack, { buy: autoload.b, sell: autoload.a })
    : 0;
  const profit = bounded ? uOut * out.margin + uBack * back.margin - fees : null;
  const profitHour = profitPerHour(profit, minutes);
  // Une boucle a DEUX segments, donc deux demandes qui peuvent être publiées indépendamment : la
  // certitude se pondère par les SCU de chaque jambe plutôt que de retenir la plus contrainte —
  // c'est précisément la logique du minimum que l'ADR-005 abandonne.
  const scuOut = bounded ? uOut : 0, scuBack = bounded ? uBack : 0;
  const connus = (out.demand == null ? 0 : scuOut) + (back.demand == null ? 0 : scuBack);
  const age = pairAge(out.updated, back.updated);
  const total = scuOut + scuBack;
  const partVolume = total > 0 ? connus / total : 0;
  const fiabilite = fiabiliteDe(age, connus, total);
  return {
    loopMargin, age, partVolume,
    unitsOut: bounded ? uOut : null,
    unitsBack: bounded ? uBack : null,
    units: bounded ? uOut + uBack : null,
    investment: bounded ? Math.max(uOut * out.buyPrice, uBack * back.buyPrice) : null,
    profit, minutes, profitHour, fiabilite, fees,
  };
}

// ---------- Marge et ROI nets des frais d'autoload (vue « Trajets », mode à une commodité) ----------
// La marge de marché (vente − achat) ne dit pas ce que le joueur encaisse par SCU dès que la
// manutention se paie. On répartit donc les frais sur le volume réellement transporté.
// Deux cas où il n'y a RIEN à répartir et où les valeurs de marché sont rendues telles quelles :
// aucun frais (interrupteur éteint, ou terminal sans autoload), et volume inconnu — une route non
// bornée (soute et budget coupés) n'a pas de SCU sur quoi étaler un coût fixe.
// Le ROI se déduit de la marge nette : (marge × units − frais) / (achat × units) = marge_nette / achat.
export function netMarginRoi(margin: number, buyPrice: number, units: number | null, fees: number): MargeNette {
  const net = fees > 0 && units > 0 ? margin - fees / units : margin;
  return { margin: net, roi: buyPrice > 0 ? Math.round((net / buyPrice) * 1000) / 10 : 0 };
}

// ---------- Corrections locales : décision de fraîcheur (pure, sans effet de bord) ----------
// Durée de validité d'un VOLUME corrigé. Un stock et une demande sont des quantités qui REPOUSSENT :
// le jeu réapprovisionne par paliers de 5 à 15 min, quand UEX ne republie un point que tous les
// 3,1 jours en médiane (mesuré sur 2 592 relevés). Sans cette borne, la déduction d'un chargement
// survivait des JOURS à un stock déjà revenu — un facteur ~70 entre les deux horizons. Un prix, lui,
// n'a pas de durée de vie : rien ne régénère un prix faux, il reste faux.
// Ce n'est PAS une mesure, et aucune ne peut la fonder : depuis le patch 3.20 les inventaires de
// boutique ont quitté les fichiers du jeu, et aucun site ne publie de débit de recharge par terminal
// (cf. docs/superpowers/specs/2026-08-12-peremption-des-volumes-et-corrections-groupees-design.md).
export const DUREE_VOL = 3 * 3600;

// o = correction { price?, vol?, base, pris? } — `base` = date UEX du point au moment de la
// correction, `pris` = heure MURALE de la saisie du volume.
// Renvoie prix/volume effectifs + drapeaux, et DEUX péremptions distinctes :
//   `stale`    = UEX a republié le point -> toute la correction est morte ;
//   `staleVol` = le volume a dépassé sa durée de vie -> lui seul est mort, le prix survit.
// Deux drapeaux et non un objet : `stale` garde exactement son sens d'avant, donc un lecteur qu'on
// aurait oublié de mettre à jour perd la nouveauté au lieu de lire un objet toujours vrai.
export function effValue(o: Correction | null | undefined, price: number | null, vol: number | null, dataUpdated?: number | null, nowSec: number = Date.now() / 1000, dureeVol: number = DUREE_VOL): ValeursEffectives {
  if (!o) return { price, vol, oprice: false, ovol: false, stale: false, staleVol: false };
  const base = o.base != null ? o.base : o.ts != null ? o.ts : Infinity; // legacy: ts ; sinon jamais périmé
  if (dataUpdated && base !== Infinity && dataUpdated > base) {
    return { price, vol, oprice: false, ovol: false, stale: true, staleVol: false };
  }
  // `pris` absent = correction d'un format antérieur : pas de péremption par durée, sinon toutes
  // celles déjà en localStorage disparaîtraient au premier chargement. La frontière appartient à la
  // correction (`> dureeVol`, pas `>=`), même convention que `base == relevé` juste au-dessus.
  const staleVol = o.vol != null && o.pris != null && nowSec - o.pris > dureeVol;
  return {
    price: o.price != null ? o.price : price,
    vol: o.vol != null && !staleVol ? o.vol : vol,
    oprice: o.price != null,
    ovol: o.vol != null && !staleVol,
    stale: false,
    staleVol,
  };
}

// ---------- Manifeste : remplissage glouton ----------
// `items` déjà triés par ordre de priorité — par marge décroissante quand la soute est la seule
// contrainte, par rendement du capital quand le budget borne (`manifestsFrom` essaie les deux et
// garde le meilleur). Plafonné par stock/demande ET budget.
export function fillCargo(items: ItemChargeable[], cargo: number, budget: number): { lines: LigneChargement[]; profit: number } {
  let cargoLeft = cargo;
  let budgetLeft = budget;
  const lines = [];
  let profit = 0;
  for (const it of items) {
    if (cargoLeft <= 0 || budgetLeft <= 0) break;
    let u = cargoLeft;
    u = Math.min(u, it.stock);                          // stock 0 = vide -> ligne exclue (u <= 0)
    if (it.demand != null || it.demandKnown) u = Math.min(u, it.demand); // null = inconnu ; 0 = saturé
    if (isFinite(budgetLeft)) u = Math.min(u, Math.floor(budgetLeft / it.buyPrice));
    if (u <= 0) continue;
    lines.push({ ...it, units: u, cap: u });
    cargoLeft -= u;
    budgetLeft -= u * it.buyPrice;
    profit += u * it.margin;
  }
  return { lines, profit };
}

// ---------- Manifeste : totaux, unités d'ajout libre, assemblage d'une ligne ----------
// Totaux d'un manifeste (liste de lignes { units, buyPrice, margin }). Source unique de vérité
// pour profit/investissement/SCU — utilisée par toutes les vues (En route + jambes de voyage).
// `autoload` = { buy, sell } (points de frais des deux terminaux du chargement) ; null = aucun
// frais, `profit` reste le total brut. HYPOTHÈSE 2 de la spec : une transaction PAR COMMODITÉ,
// donc autant de fois la base de 150 qu'il y a de lignes — c'est le choix pessimiste, faute de
// mesure. `profit` est NET des frais ; `fees` les expose à part pour l'infobulle et le détail.
// Chaque ligne paie les opérations qu'elle subit RÉELLEMENT (cf. lineHaulFee) : une ligne chargée
// ici pour être vendue ailleurs n'est pas déchargée à l'arrivée, une ligne déjà en soute n'a pas
// été chargée au départ.
// L'investissement, lui, reste le capital immobilisé à l'achat : les frais sont une charge
// d'exploitation, pas de la marchandise.
export function manifestTotals(lines: Partial<LigneManifeste>[], autoload: PaireFrais | null = null): TotauxManifeste {
  let profit = 0, invest = 0, scu = 0, fees = 0;
  for (const l of lines) {
    const u = l.units || 0;
    profit += u * (l.margin || 0);
    invest += u * (l.buyPrice || 0);
    scu += u;
    fees += lineHaulFee(u, l, autoload);
  }
  return { profit: profit - fees, invest, scu, fees };
}

// Unités pour un ajout LIBRE au manifeste (commodité choisie à la main, éventuellement carry-only) :
// remplit l'espace restant, plafonné par le stock connu, mais AU MOINS 1 SCU (ajout volontaire).
// Comportement partagé En route / jambe de voyage. Deux cas ne remplissent PAS la soute :
//   - cargoLeft non fini (soute désactivée) : on ne sait pas ce qu'on peut emporter ;
//   - stock non fini : rien à acheter sur place (butin trouvé ailleurs) — proposer une soute pleine
//     d'un fret introuvable au terminal de départ chiffrerait un profit qui n'existe pas.
// Dans les deux cas -> 1 SCU, et l'utilisateur ajuste la quantité à ce qu'il a réellement.
export function freeAddUnits(stock: number | null, cargoLeft: number): number {
  if (!Number.isFinite(stock)) return 1;
  const u = Number.isFinite(cargoLeft) ? Math.max(0, cargoLeft) : 0;
  return Math.max(1, Math.min(u, stock));
}

// Assemble une ligne de manifeste depuis une commodité `c` et ses valeurs résolues (corrections
// comprises). `buy`/`sell` = { price, vol, ovol } résolus, ou null si le point n'existe pas de ce
// côté. Les deux côtés manquants sont balisés SYMÉTRIQUEMENT, sans quoi le rendu affiche un prix
// d'achat « 0 » indiscernable d'un vrai relevé UEX :
//   - sans vente (`sell` null) -> `carry` : chargée ici pour être écoulée ailleurs ;
//   - sans achat (`buy` null)  -> `acquired` : déjà en soute (butin, minage, salvage), coût nul.
// `paid` (optionnel) = prix RÉELLEMENT payé au SCU pour une cargaison déjà à bord. Sans lui, une
// commodité qu'aucun terminal de départ ne vend est classée `acquired` — butin, coût nul — et son
// profit compte la revente ENTIÈRE comme gain. C'est juste pour du minage ou du salvage, et faux
// de 250 % pour du fret acheté ailleurs qu'on transporte encore (cf. ADR-002).
export function manifestLine(c: CommoditeIdentite, buy: CoteResolu | null, sell: CoteResolu | null, buyUpdated: number, sellUpdated: number, units: number, cap: number, paid: number | null = null): LigneManifeste {
  const porte = paid != null && paid >= 0;          // fret embarqué dont on connaît le coût
  const buyPrice = porte ? paid : buy ? buy.price : 0;
  return {
    name: c.name, kind: c.kind, illegal: c.illegal,
    buyPrice, stock: buy ? buy.vol : Infinity,
    sellPrice: sell ? sell.price : null,
    demand: sell ? sell.vol : null,
    demandKnown: sell ? sell.ovol : false,
    margin: sell ? sell.price - buyPrice : 0,
    buyUpdated: buyUpdated || 0, sellUpdated: sellUpdated || 0,
    units, cap, carry: !sell,
    // `acquired` dit « rien n'a été chargé ici » : vrai pour du butin comme pour du fret embarqué
    // ailleurs — dans les deux cas l'autoload du terminal de départ ne l'a pas manipulé. Ce qui
    // les sépare, c'est le COÛT, et c'est `paid` qui le porte.
    acquired: !buy || porte,
    aBord: porte,
  };
}

// Résout les deux côtés d'une commodité entre deux terminaux (corrections locales comprises).
// `null` d'un côté = ce terminal ne traite pas cette commodité — cas NORMAL, pas une erreur :
// on charge un fret pour l'écouler ailleurs, ou on transporte un butin acquis ailleurs.
function resolveSides(market: Marche, fromIdx: number, toIdx: number, c: Commodite, resolve: ResolveurCorrections): { b?: PointMarche; s?: PointMarche; eb: ValeursEffectives | null; es: ValeursEffectives | null } {
  const ft = market.terminals[fromIdx], tt = market.terminals[toIdx];
  const b = c.buys.find((x) => x[0] === fromIdx);
  const s = c.sells.find((x) => x[0] === toIdx);
  return {
    b, s,
    eb: b ? resolve(c.name, ft.name, "buy", b[1], b[2], b[3]) : null,
    es: s ? resolve(c.name, tt.name, "sell", s[1], s[2], s[3]) : null,
  };
}

// Ligne de manifeste pour un ajout LIBRE : l'utilisateur choisit la commodité, les unités
// remplissent l'espace restant. Partagée par « En route » et par les jambes de voyage, qui en
// tenaient deux copies divergentes — l'une testait le doublon avant de muter l'état, l'autre après.
export function freeManifestLine(market: Marche, fromIdx: number, toIdx: number, c: Commodite, cargoLeft: number, resolve: ResolveurCorrections): LigneManifeste {
  const { b, s, eb, es } = resolveSides(market, fromIdx, toIdx, c, resolve);
  const u = freeAddUnits(eb ? eb.vol : Infinity, cargoLeft);
  return manifestLine(c, eb, es, b ? b[3] : 0, s ? s[3] : 0, u, u);
}

// Ligne RÉ-HYDRATÉE depuis la seule intention persistée { name, units }.
// On ne persiste JAMAIS d'instantané de marché : figé, il continuerait d'afficher le prix du jour
// de l'édition longtemps après qu'UEX l'ait republié, avec une pastille de fraîcheur qui vieillit
// sans jamais refléter le vrai relevé. Prix, stock, demande et dates sont donc relus à chaque rendu.
export function hydrateManifestLine(market: Marche, fromIdx: number, toIdx: number, c: Commodite, units: number, resolve: ResolveurCorrections): LigneManifeste {
  const { b, s, eb, es } = resolveSides(market, fromIdx, toIdx, c, resolve);
  const cap = tighterVolume(eb ? eb.vol : Infinity, es ? es.vol : null);
  return manifestLine(c, eb, es, b ? b[3] : 0, s ? s[3] : 0, units, cap);
}

// ---------- Décomposition en caisses SCU standard ----------
// Répartit N SCU en conteneurs standard (plus grand d'abord). Renvoie [{size, count}, ...].
// `maxBox` (optionnel) plafonne la taille de caisse : un terminal dont max_container_size vaut 16
// ne peut pas sortir une caisse de 32, et le nombre de caisses est ce qui décide des frais
// d'autoload. Absent ou inexploitable (sous la plus petite caisse), on garde la grille complète :
// mieux vaut une décomposition optimiste qu'un volume qui s'évapore faute de caisse capable.
export const SCU_BOX_SIZES: number[] = [32, 24, 16, 8, 4, 2, 1];
export function scuBoxes(n: number | null | undefined, maxBox?: number | null): Caisse[] {
  n = Math.max(0, Math.floor(n || 0));
  const sizes = maxBox >= 1 ? SCU_BOX_SIZES.filter((s) => s <= maxBox) : SCU_BOX_SIZES;
  const out = [];
  for (const size of sizes) {
    const count = Math.floor(n / size);
    if (count > 0) { out.push({ size, count }); n -= count * size; }
  }
  return out;
}

// Caisses d'un chargement à PLUSIEURS commodités. Une caisse n'en contient qu'une seule : le
// décompte se fait donc ligne par ligne, jamais sur le total des SCU. Décomposer le total
// inventerait des caisses pleines qui n'existent pas (quatre commodités de 8 SCU font quatre
// caisses de 8, pas une de 32) — et ce décompte sert à EXPLIQUER un montant que manifestTotals
// facture, lui, une ligne à la fois. Un « 📦 1×32 » à côté d'un montant calculé sur quatre caisses
// serait l'incohérence la plus visible qui soit.
export function cargoBoxes(lines: Partial<LigneManifeste>[], maxBox?: number | null): Caisse[] {
  const parTaille = new Map();
  for (const l of lines) {
    for (const b of scuBoxes(l.units, maxBox)) parTaille.set(b.size, (parTaille.get(b.size) || 0) + b.count);
  }
  return [...parTaille].sort((a, b) => b[0] - a[0]).map(([size, count]) => ({ size, count }));
}

// ---------- Frais d'autoload ----------
// Charger et décharger la soute automatiquement se paie, et la facture ne dépend NI du prix NI de
// la commodité : c'est de la manutention, pas une commission. Ces trois nombres ne sont pas
// choisis, ils se DÉDUISENT de 18 relevés en jeu (4.9) sur deux stations Pyro — le détail des
// mesures est dans docs/superpowers/specs/2026-08-10-frais-autoload-design.md :
//   base   150 : constante retrouvée à l'aUEC près sur les quatre séries d'Endgame
//                (340−190 = 510−360 = 645−494,7 = 830−680) ;
//   perBox  30 : à Ruin, 32 SCU en deux caisses de 16 coûtent exactement 56 de plus qu'en une
//                caisse de 32, soit 30 une fois le coefficient de station retiré ;
//   perScu  20 : la pente de la grille, identique aux deux stations à trois décimales près — ce
//                qui est précisément ce qui autorise à réduire la station à un simple facteur.
// `k` est ce facteur : 1 = tarif Endgame (l'ancrage), 1,4 = Ruin Station. Le modèle colle aux
// 18 relevés à 2,8 % près : c'est une ESTIMATION, tout montant affiché doit porter un « ≈ ».
export const AUTOLOAD: GrilleAutoload = { base: 150, perBox: 30, perScu: 20 };

// Frais d'UNE opération (un chargement ou un déchargement) de `scu` SCU dans un terminal plafonné
// à `maxBox` SCU par caisse, au coefficient de station `k`. Renvoie un entier d'aUEC.
export function autoloadFee(scu: number | null, maxBox: number | null | undefined, k: number): number {
  const units = Math.max(0, Math.floor(scu || 0));
  // Rien à manutentionner, ou station qui ne facture pas (k = 0) : aucun frais. La base de 150
  // paie une transaction, pas une visite — la faire payer à vide grèverait un trajet qu'on
  // n'effectue pas, et surtout les routes non bornées, où computeUnits ne rend aucun volume.
  if (!isFinite(units) || units <= 0 || !(k > 0)) return 0;
  const boxes = scuBoxes(units, maxBox).reduce((a, b) => a + b.count, 0);
  return Math.round(k * (AUTOLOAD.base + AUTOLOAD.perBox * boxes + AUTOLOAD.perScu * units));
}

// ---------- Relevé de station : du montant payé au coefficient ----------
// Déduit `k` d'un montant observé en jeu : personne ne lit un coefficient à l'écran, on lit une
// facture. k = montant payé / montant que la formule prédirait à l'ancrage (k = 1), au plafond de
// caisse du terminal. null quand la mesure ne dit rien : sans quantité il n'y a pas de référence à
// diviser, sans montant il n'y a rien de mesuré (un champ vide donne Number("") = 0, un texte NaN).
export function kFromReading(amount: number, scu: number | null, maxBox: number | null | undefined): number | null {
  const ref = autoloadFee(scu, maxBox, 1);
  if (!(ref > 0) || !(amount > 0)) return null;
  return Math.round((amount / ref) * 1000) / 1000;
}

// Ce k est-il celui d'une station, ou d'une faute de frappe ? Ces bornes ne prétendent PAS connaître
// le tarif des 159 terminaux jamais mesurés — elles écartent le DÉCALAGE DE VIRGULE, seule erreur de
// saisie qui produise un coefficient d'apparence honnête : un zéro de trop (1 159 000 pour 1 159)
// multiplie k par dix, un dernier chiffre oublié le divise par dix. Depuis la plage mesurée (1,0 à
// Endgame, 1,4 à Ruin), le plus petit décalage possible donne 10 d'un côté, 0,14 de l'autre ; toute
// borne entre ces deux valeurs les attrape. On prend ×4 et ÷4 autour de l'ancrage : dix fois l'écart
// réellement observé entre les deux stations, et il reste plus du double de marge avant le premier
// décalage. Hors bornes, l'appelant fait CONFIRMER, il ne refuse pas — une borne qui perdrait un
// relevé véritablement surprenant serait pire que le tarif faux qu'elle corrige, et c'est justement
// parce qu'elle ne coûte qu'un clic qu'on peut la serrer autant.
export const K_PLAUSIBLE: BornesK = { min: 0.25, max: 4 };
export const kPlausible = (k: number | null): boolean => k >= K_PLAUSIBLE.min && k <= K_PLAUSIBLE.max;

// ---------- Contexte de frais : un point par terminal, une paire par chargement ----------
// Tout le moteur reçoit ce contexte en PARAMÈTRE OPTIONNEL, et son absence (null) est le chemin
// par défaut : sans lui, chaque fonction rend exactement les valeurs brutes qu'elle rendait avant
// que les frais n'existent. L'interrupteur de l'interface est donc littéralement « passer null ».
//
// Un « point de frais » décrit ce qu'UN terminal facture : { maxBox, k }. Un terminal qui ne
// propose pas l'autoload prend k = 0 — il ne facture rien — mais GARDE son maxBox : c'est encore
// lui qui décide de la taille des caisses, même quand c'est le joueur qui les empile à la main.
// Les deux champs peuvent manquer du terminal (instantané de market.json antérieur au build qui
// les ajoute, ou coquille servie depuis le cache du service worker) : lecture défensive.
export function autoloadPoint(terminal: Terminal | null | undefined, k: number): PointFrais | null {
  if (!terminal) return null;
  return { maxBox: terminal.maxBox, k: terminal.autoload === true ? k : 0 };
}

// Frais des DEUX opérations d'un chargement de `scu` SCU : chargement au terminal d'achat,
// déchargement au terminal de vente, chacun au tarif de SA station.
// `pair` = { buy, sell } (points de frais) ; null/absent -> aucun frais.
// HYPOTHÈSE 1 de la spec : le nombre de caisses est fixé au CHARGEMENT. On décharge les caisses
// qu'on a — seul le tarif change — d'où le maxBox du terminal d'ACHAT des deux côtés. Le passer
// en paramètre plutôt que de le laisser au site d'appel évite l'erreur symétrique (re-caisser la
// cargaison en vol au plafond du terminal d'arrivée), qu'aucune signature ne saurait interdire.
export function haulFee(scu: number, pair?: PaireFrais | null): number {
  if (!pair) return 0;
  const { buy, sell } = pair;
  const maxBox = buy ? buy.maxBox : sell && sell.maxBox; // sans achat connu, le seul plafond connu
  return (buy ? autoloadFee(scu, maxBox, buy.k) : 0) + (sell ? autoloadFee(scu, maxBox, sell.k) : 0);
}

// Frais d'UNE LIGNE de manifeste, qui ne subit pas toujours les DEUX opérations — et c'est
// manifestLine qui le dit, en balisant les deux côtés manquants :
//   - `carry` (« vend ailleurs ») : chargée ici, elle reste en soute à l'arrivée. Rien n'est
//     déchargé, et sa colonne profit affiche « — » : lui facturer un déchargement retranchait du
//     total un montant qu'aucune ligne à l'écran ne montrait.
//   - `acquired` (« acquis ailleurs » : butin, minage, salvage) : déjà à bord au départ. L'autoload
//     du terminal d'achat ne l'a jamais chargée.
// L'extrémité qui ne manutentionne rien passe à k = 0 au lieu d'être retirée de la paire : elle
// garde ainsi son `maxBox`, donc le décompte de caisses reste celui du terminal de chargement
// (hypothèse 1) — c'est-à-dire exactement celui que le « 📦 » de la ligne affiche.
export function lineHaulFee(units: number, line: Partial<LigneManifeste> | null | undefined, pair: PaireFrais | null): number {
  if (!pair) return 0;
  const { carry, acquired } = line || {};
  if (!carry && !acquired) return haulFee(units, pair);
  const muet = (p) => (p ? { maxBox: p.maxBox, k: 0 } : p);
  return haulFee(units, {
    buy: acquired ? muet(pair.buy) : pair.buy,
    sell: carry ? muet(pair.sell) : pair.sell,
  });
}

// Ce qu'une LIGNE de manifeste rapporte réellement : sa marge sur le volume, moins la manutention
// qu'elle subit. Cette valeur ne sert pas qu'à l'affichage — c'est elle qui DÉCIDE quelles
// commodités le manifeste optimal retient (manifestsFrom) et lesquelles la boîte de suggestions
// propose. Elle vivait dans app.js, hors de portée des tests, alors que son total (manifestTotals)
// est ici et testé : les deux pouvaient diverger sans que rien ne le dise.
// Elle est NÉGATIVE quand les frais mangent la marge — ce n'est pas un cas limite mais le cas
// qu'on cherche : c'est exactement à ce signe qu'on reconnaît une ligne qu'il vaut mieux laisser
// au sol. Tout affichage doit donc porter le signe réel, jamais un « + » posé d'office.
export function lineNet(units: number, line: Partial<LigneManifeste>, pair: PaireFrais | null): number {
  return units * (line.margin || 0) - lineHaulFee(units, line, pair);
}

// ---------- Chaîne multi-sauts (A -> B -> C ...) ----------
// Meilleure chaîne de `hops` sauts depuis `start`, sans revisiter un terminal.
// adj : Map<terminal, leg[]> ; leg = { to, margin, stock, demand, buyPrice, fee?, ... }.
// Recherche par faisceau (beam) : approximation robuste et bornée en temps. Chaque saut
// remplit la soute (`cargo`), plafonnée par stock/demande ; le budget se reconstitue à la
// vente donc n'est pas une contrainte de chaîne. Renvoie { path, legs, profit } ou null.
// Les frais d'autoload arrivent ici PAR LE LEG (`leg.fee` = { buy, sell }, posé par
// buildChainAdjacency) : bestChain ne voit ni terminaux ni filtres, et c'est le seul canal
// disponible. Sans ce champ — donc par défaut — les profits sont strictement ceux d'avant.
// Volume réellement emportable sur un saut, et ce qu'il RAPPORTE une fois ses deux opérations
// payées. Exporté parce que buildChainAdjacency doit classer les candidates d'une paire sur le
// profit que bestChain leur donnera vraiment : un autre plafond de volume et le classement
// porterait sur un saut qui n'existe pas.
// Le chargement mono se dit dans la MÊME forme qu'un manifeste — une liste de lignes : la vue
// Chaîne et le voyage n'ont ainsi qu'un seul format de saut à lire, que l'arc porte le manifeste
// pré-calculé par buildChainAdjacency ou ce repli à une commodité.
const ligneDuSaut = (leg: JambeChaine, units: number): LigneManifeste[] => (units <= 0 ? [] : [{
  name: leg.commodity, kind: leg.kind, illegal: leg.illegal,
  buyPrice: leg.buyPrice, sellPrice: leg.sellPrice, margin: leg.margin,
  stock: leg.stock, demand: leg.demand, demandKnown: leg.demandKnown,
  buyUpdated: leg.buyUpdated || 0, sellUpdated: leg.sellUpdated || 0,
  units, cap: units,
}]);
export function chainLegNet(leg: JambeChaine, cargo: number): ChargementDuSaut {
  // Chargement PRÉ-CALCULÉ à la construction de l'adjacence : on le rend tel quel, c'est ce qui
  // tient le coût du faisceau (cf. estampillerManifestes). La soute fait partie de la clé parce que
  // rien n'oblige l'appelant à passer à bestChain celle qui a bâti le graphe : un chargement composé
  // pour 96 SCU ne dit rien de ce qu'on emporte dans 32, et retomber sur le chiffrage mono vaut
  // mieux qu'un chiffre faux rendu en silence.
  if (leg.net && leg.net.cargo === cargo) return leg.net;
  let u = cargo;
  u = Math.min(u, leg.stock);                     // stock 0 = terminal vide -> saut exclu
  if (leg.demand != null || leg.demandKnown) u = Math.min(u, leg.demand); // null = inconnu ; 0 = saturé
  const units = isFinite(u) ? Math.max(0, u) : 0; // sans borne de volume : rien (chaîne = soute finie)
  return { units, profit: units * leg.margin - haulFee(units, leg.fee), lines: ligneDuSaut(leg, units), cargo };
}

// Le faisceau tronque à chaque saut sur le profit CUMULÉ : un premier saut modeste qui ouvre sur un
// circuit énorme est décapité avant d'avoir pu le montrer. Mesuré sur data/market.json (96 SCU,
// 3 sauts) : à 40, 39 origines sur 107 rendaient plus de 5 % sous l'optimum du graphe, jusqu'à ×4,53
// (Sunset Mesa, 582 816 -> 2 637 576). À 400, plus aucune. Le coût est payé une fois par action
// utilisateur — l'app ne calcule qu'UNE chaîne — soit 8 à 12 ms sur le pire cas de l'UI (4 sauts)
// contre 0,9 ms à faisceau 40 : imperceptible, là où la sous-optimalité, elle, se voyait. Depuis
// #56 le chargement de chaque saut est pré-calculé (`leg.net`) : le prix du manifeste se paie une
// fois, à la construction de l'adjacence, et le faisceau n'y touche plus.
export function bestChain(adj: Map<number, JambeChaine[]>, start: number, hops: number, { cargo = Infinity, beam = 400 }: OptionsChaine = {}): Chaine | null {
  let paths = [{ path: [start], visited: new Set([start]), profit: 0, legs: [] }];
  let best = null;
  for (let h = 0; h < hops; h++) {
    const next = [];
    for (const p of paths) {
      const u = p.path[p.path.length - 1];
      for (const leg of adj.get(u) || []) {
        if (leg.margin <= 0 || p.visited.has(leg.to)) continue;
        // Deux opérations par saut (chargement au départ, déchargement à l'arrivée). Un saut dont
        // les frais mangent la marge fait PERDRE de l'argent : on l'écarte, exactement comme un
        // saut de marge nulle plus haut — sans quoi l'invariant « chaque saut ajoute un profit
        // positif » tomberait et la meilleure chaîne pourrait être plus courte que la retenue.
        const { units, profit: legProfit, lines } = chainLegNet(leg, cargo);
        if (units <= 0 || legProfit <= 0) continue;
        const visited = new Set(p.visited);
        visited.add(leg.to);
        next.push({
          path: [...p.path, leg.to],
          visited,
          profit: p.profit + legProfit,
          // `lines` = le chargement du saut, plusieurs commodités comprises. Les champs scalaires
          // hérités du leg (commodity, margin…) restent ceux du REPLI mono : ils nomment l'arc et
          // servent à le classer, ils ne décrivent plus à eux seuls ce qui voyage.
          legs: [...p.legs, { ...leg, units, profit: legProfit, lines }],
        });
      }
    }
    if (!next.length) break;
    next.sort((a, b) => b.profit - a.profit);
    paths = next.slice(0, beam);
    if (!best || paths[0].profit > best.profit) best = paths[0]; // chaque saut ajoute un profit positif
  }
  return best ? { path: best.path, legs: best.legs, profit: best.profit } : null;
}

// ---------- Unités ajoutables d'une commodité candidate (suggestions) ----------
export function addableUnits(it: CommoditeChargeable, rem: RestantManifeste): number {
  let u = rem.cargoLeft;
  u = Math.min(u, it.stock);                          // stock 0 = vide -> non suggéré
  if (it.demand != null || it.demandKnown) u = Math.min(u, it.demand); // null = inconnu ; 0 = saturé
  if (isFinite(rem.budgetLeft)) u = Math.min(u, Math.floor(rem.budgetLeft / it.buyPrice));
  return Math.max(0, u);
}

// ---------- Corrections locales : opérations sur un store injectable ----------
// Le store est un objet { "commodité|terminal|side": { price?, vol?, base } }.
export const ovKey = (commodity: string, terminal: string, side: CoteMarche): string => `${commodity}|${terminal}|${side}`;

// Valeur effective (corrigée si besoin) + retrait de ce qui est périmé.
// Renvoie { price, vol, oprice, ovol, stale, staleVol }. Effets de bord, et rien d'autre :
//   UEX a republié -> la clé entière part ; le volume a vieilli -> lui seul part, et la clé avec
//   s'il ne restait que lui.
export function effFromStore(store: StoreCorrections, key: string, price: number, vol: number, dataUpdated: number, nowSec: number = Date.now() / 1000, dureeVol: number = DUREE_VOL): ValeurEffective {
  const r = effValue(store[key], price, vol, dataUpdated, nowSec, dureeVol);
  if (r.stale) delete store[key];
  else if (r.staleVol) {
    const o = store[key];
    delete o.vol;
    delete o.pris;
    if (o.price == null) delete store[key];
  }
  return r;
}

// Enregistre/efface une correction. field = "price"|"vol". value null/"" efface ce champ.
// baseUpdated = date UEX du point (ancre de fraîcheur). Supprime la clé si plus rien de corrigé.
export function setInStore(store: StoreCorrections, key: string, field: ChampCorrection, value: string | number | null | undefined, baseUpdated: number, nowSec: number = Date.now() / 1000): StoreCorrections {
  const o = store[key] || {};
  const n = value == null || value === "" ? NaN : Math.max(0, Math.round(Number(value)));
  if (Number.isFinite(n)) o[field] = n;
  else delete o[field];
  // DEUX dates de saisie, une par champ, et surtout pas une seule pour les deux : elles ne servent
  // pas à la même chose.
  //   `pris`      = heure murale de la saisie du VOLUME. C'est une HORLOGE : effValue s'en sert pour
  //                 périmer le volume au bout de DUREE_VOL.
  //   `saisiPrix` = heure murale de la saisie du PRIX. Ce n'est PAS une horloge — rien ne régénère un
  //                 prix faux, il ne vieillit pas (cf. DUREE_VOL) et aucun lecteur ne le périme. Elle
  //                 existe parce qu'une correction s'exporte, et qu'un export qui ne peut pas dater
  //                 ce qu'il transporte est inexploitable : on le réappliquerait aveuglément des
  //                 semaines plus tard.
  // Les deux noms sont volontairement distincts de `ts`, que effValue lit encore comme alias
  // historique de `base` — les confondre périmerait les corrections d'anciens formats au lieu de les
  // épargner.
  const dateDe = field === "vol" ? "pris" : field === "price" ? "saisiPrix" : null;
  if (dateDe) {
    if (Number.isFinite(n)) o[dateDe] = Number(nowSec) || 0;
    else delete o[dateDe];
  }
  if (o.price != null || o.vol != null) { o.base = Number(baseUpdated) || 0; store[key] = o; }
  else delete store[key];
  return store;
}

// Range les corrections locales PAR STATION, pour la bande de vignettes de la vue Corrections
// (ADR-003). Renvoie [{ terminal, corrections, actif }], la station affichée épinglée en tête —
// même à zéro correction, pour que la bande dise toujours quelque chose quand on ouvre une station
// jamais corrigée. Les autres suivent, par nombre de corrections décroissant puis par nom.
//
// N'accepte que les clés à TROIS segments. La frontière n'est pas cosmétique : les relevés de tarif
// d'autoload vivent dans un store séparé sous une clé à DEUX segments (`autoload|<terminal>`)
// précisément pour qu'aucun lecteur de OVERRIDES ne les compte, et un test E2E exige que le badge
// « ✎ Corrections » reste sans compteur quand seul un relevé existe.
//
// PURGE au passage, et c'est le point délicat. Un volume corrigé meurt au bout de `dureeVol` ; cette
// péremption est un effet de bord d'effFromStore, déclenché par le RENDU de la seule station
// affichée. Les corrections des autres stations ne sont donc jamais interrogées, donc jamais
// purgées : sans cette passe, leur compteur annoncerait des corrections déjà mortes jusqu'à ce qu'on
// clique dessus. La bande promet un décompte juste ; c'est ici qu'elle le tient.
export function groupOverridesByTerminal(store: StoreCorrections, actif: string | null, nowSec: number = Date.now() / 1000, dureeVol: number = DUREE_VOL): GroupeCorrections[] {
  const parTerminal = new Map();
  for (const cle of Object.keys(store || {})) {
    const seg = cle.split("|");
    if (seg.length !== 3) continue;
    const o = store[cle];
    if (o && o.vol != null && o.pris != null && nowSec - o.pris > dureeVol) {
      delete o.vol;
      delete o.pris;
      if (o.price == null) { delete store[cle]; continue; }
    }
    const terminal = seg[1];
    parTerminal.set(terminal, (parTerminal.get(terminal) || 0) + 1);
  }
  if (actif) parTerminal.set(actif, parTerminal.get(actif) || 0);

  return [...parTerminal.entries()]
    .map(([terminal, corrections]) => ({ terminal, corrections, actif: terminal === actif }))
    .sort((a, b) => (b.actif ? 1 : 0) - (a.actif ? 1 : 0)
      || b.corrections - a.corrections
      || a.terminal.localeCompare(b.terminal, "fr"));
}

// Met à niveau les corrections déjà posées chez l'utilisateur, au chargement. Deux règles, et la
// seconde est la plus importante des deux :
//
//   1. `ts` -> `base`. L'alias historique reste LU par effValue (compat ascendante), mais l'export
//      ne doit pas avoir à connaître deux noms pour la même ancre : il en manquerait un le jour où
//      un troisième apparaîtrait. La normalisation ne change aucune décision de fraîcheur —
//      effValue traitait déjà les deux à l'identique.
//   2. AUCUNE date de saisie n'est inventée. Un prix corrigé avant `saisiPrix` s'exporte « date
//      inconnue » et le reste : lui poser la date du jour le ferait passer pour frais alors qu'il
//      peut dater de trois patchs, et c'est exactement la correction qu'on réappliquerait à tort.
//      Même prudence qu'effValue avec `pris` absent — on épargne les formats antérieurs plutôt que
//      de les périmer, et ici on refuse aussi de les rajeunir.
//
// Renvoie { store, migres } ; `migres` à 0 = rien à persister (même forme que `migrerRefus`).
export function migrerCorrections(store: StoreCorrections): { store: StoreCorrections; migres: number } {
  const s = store || {};
  let migres = 0;
  for (const cle of Object.keys(s)) {
    const o = s[cle];
    if (!o || o.base != null || o.ts == null) continue;
    o.base = o.ts;
    delete o.ts;
    migres++;
  }
  return { store: s, migres };
}

// ---------- État partageable (URL / localStorage) ----------
export const safeKey = (k: unknown): boolean => typeof k === "string" && /^[a-zA-Z]+$/.test(k); // anti-injection de sélecteur

// Encode un objet d'état en query-string (ignore les valeurs vides/nulles).
export function encodeState(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v != null) p.set(k, v); });
  return p.toString();
}
// Décode une query-string en objet (null si vide).
export function decodeState(str: string | null | undefined): EtatDecode | null {
  return str ? Object.fromEntries(new URLSearchParams(str)) : null;
}

// ---------- Marché interactif : recherche de trajets (En route, manifeste, chaîne) ----------
// `market` = { terminals:[{name,system,planet,outpost,autoload,maxBox}],
//              commodities:[{name,kind,illegal,buys,sells}] }
// où chaque buy/sell est un tuple compact [idxTerminal, prix, volume, updated, statut].
// `autoload`/`maxBox` peuvent manquer d'un instantané antérieur : toute lecture est défensive.
// `resolve(commodity, terminalName, side, price, vol, updated)` applique les corrections locales et
// renvoie au moins { price, vol, ovol } (identité si aucune correction). PURES si `resolve` l'est.
// `autoloadFor(terminal)` -> point de frais { maxBox, k } de ce terminal (voir autoloadPoint).
// null = interrupteur inactif, et c'est le défaut : aucun frais n'est alors calculé nulle part.

// Construit un objet « route » (compatible evaluate/routeRowHTML) depuis un achat + une vente bruts.
export function dealFrom(market: Marche, c: Commodite, b: PointMarche, s: PointMarche): Route {
  const bt = market.terminals[b[0]], st = market.terminals[s[0]];
  const margin = s[1] - b[1];
  return {
    commodity: c.name, kind: c.kind, illegal: c.illegal,
    buy: { terminal: bt.name, system: bt.system, planet: bt.planet, outpost: bt.outpost, price: b[1], stock: b[2], updated: b[3], status: b[4] },
    sell: { terminal: st.name, system: st.system, planet: st.planet, outpost: st.outpost, price: s[1], demand: s[2], updated: s[3], status: s[4] },
    margin, roi: Math.round((margin / b[1]) * 1000) / 10,
    same_system: bt.system === st.system,
    distance: 0,       // distance exacte indisponible hors routes.json -> estimation grossière
    refBuy: 0, refSell: 0,
  };
}

// Meilleure vente par commodité depuis le terminal `origin`. `destTerminal` (index) force un
// terminal d'arrivée précis ; sinon `destSystem` filtre par système ("" = n'importe où).
// Données brutes (les corrections sont appliquées ensuite par evaluate) -> pas de `resolve`.
// `f` + `autoloadFor` (optionnels) font retenir la destination sur le profit NET au lieu du prix
// affiché. C'était le dernier point d'entrée aveugle aux frais : deux stations qui paient presque
// pareil ne facturent pas pareil la manutention, et comme cette fonction ne garde qu'UNE vente par
// commodité, la meilleure en net n'entrait jamais dans la liste — le tableau montrait alors une
// destination pendant que la carte Manifeste, sur le MÊME écran, en affichait une autre.
// Sans eux — donc par défaut — le critère reste le prix de vente le plus élevé, à l'identique.
export function enRouteDeals(market: Marche, origin: number, destSystem: string, destTerminal: number | null = null, f: Filtres | null = null, autoloadFor: ResolveurFrais | null = null): Route[] {
  const deals = [];
  const buyPoint = autoloadFor ? autoloadFor(market.terminals[origin]) : null;
  market.commodities.forEach((c) => {
    const b = c.buys.find((x) => x[0] === origin);
    if (!b) return;
    // Profit RÉALISABLE d'une vente candidate, dans les termes exacts de routeMetrics. Le prix au SCU
    // ne suffit pas : `computeUnits` plafonne ensuite par la demande du terminal, si bien qu'une
    // vente très chère mais presque saturée rapporte moins qu'une vente un peu moins chère qui prend
    // toute la soute — et la bonne destination, écartée ici, n'apparaît alors nulle part.
    // Sans `f` (aucune contrainte connue) ou sur un volume non borné, il n'y a rien à comparer que
    // le prix : c'est aussi le cas où toutes les destinations chargent autant, donc où le prix le
    // plus haut EST l'optimum. `routeMetrics` laisse déjà ces routes au brut.
    const score = (s) => {
      if (!f) return s[1];
      const u = computeUnits(b[1], b[2], s[2], f);
      if (!isFinite(u)) return s[1];
      const fee = autoloadFor ? haulFee(u, { buy: buyPoint, sell: autoloadFor(market.terminals[s[0]]) }) : 0;
      return u * (s[1] - b[1]) - fee;
    };
    let best = null, bestScore = 0;
    for (const s of c.sells) {
      if (s[0] === origin) continue;
      if (destTerminal != null) { if (s[0] !== destTerminal) continue; }
      else if (destSystem && market.terminals[s[0]].system !== destSystem) continue;
      // Une vente qui ne bat pas le prix d'achat n'a jamais été un candidat : ce filtre était en
      // sortie de boucle (`best[1] > b[1]`), le remonter ici ne change rien au critère brut et
      // empêche une vente à volume nul — donc à frais nuls, donc au « meilleur » net — de faire
      // disparaître du tableau une commodité qui, ailleurs, se vend avec profit.
      if (s[1] <= b[1]) continue;
      const sc = score(s);
      // Égalité -> le prix brut départage, comme avant (le critère brut ne change donc jamais d'avis).
      if (!best || sc > bestScore || (sc === bestScore && s[1] > best[1])) { best = s; bestScore = sc; }
    }
    if (best) deals.push(dealFrom(market, c, b, best));
  });
  return deals;
}

// Éligibilité d'un couple achat/vente, partagée par le manifeste OPTIMAL et par les SUGGESTIONS
// de remplissage. Les deux en tenaient chacune une copie, et elles avaient divergé : la boîte de
// suggestions ne filtrait que « légales », si bien qu'elle proposait — et permettait d'insérer —
// des commodités que le manifeste venait d'écarter pour relevé trop vieux ou avant-poste exclu.
export function pairEligible(f: Filtres, c: Commodite, sellTerminal: Terminal, buyUpdated: number, sellUpdated: number): boolean {
  if (f.legalOnly && c.illegal) return false;
  if (f.noOutpost && sellTerminal.outpost) return false;
  // Fraîcheur : ignore les relevés trop vieux (0 = filtre inactif -> comportement inchangé).
  if (f.maxAge) { const a = pairAge(buyUpdated, sellUpdated); if (a == null || a > f.maxAge) return false; }
  return true;
}

// Commodités qui pourraient remplir l'espace libre d'un manifeste (même origine -> même
// destination), hors celles déjà chargées, triées par marge décroissante.
// `m` = contexte de manifeste { lines, originIdx, destIdx, origin, dest, f }.
export function suggestionsFrom(market: Marche, m: ContexteManifeste, resolve: Resolveur): CandidatChargement[] {
  const have = new Set(m.lines.map((l) => l.name));
  const st = market.terminals[m.destIdx];
  const out = [];
  market.commodities.forEach((c) => {
    if (have.has(c.name)) return;
    const b = c.buys.find((x) => x[0] === m.originIdx);
    const s = c.sells.find((x) => x[0] === m.destIdx);
    if (!b || !s) return;
    if (!pairEligible(m.f, c, st, b[3], s[3])) return;
    const eb = resolve(c.name, m.origin.name, "buy", b[1], b[2], b[3]);
    const es = resolve(c.name, m.dest.name, "sell", s[1], s[2], s[3]);
    const margin = es.price - eb.price;
    if (margin <= 0) return;
    out.push({ name: c.name, kind: c.kind, illegal: c.illegal, buyPrice: eb.price, stock: eb.vol, sellPrice: es.price, demand: es.vol, demandKnown: es.ovol, margin, buyUpdated: b[3], sellUpdated: s[3] });
  });
  return out.sort((a, b) => b.margin - a.margin);
}

// TOUS les manifestes depuis `origin` : un par destination atteignable, soute remplie par marge
// décroissante (fillCargo). Trié par profit décroissant. `bestManifest` n'en garde que le premier ;
// la vue « Trajets » en mode multi-commodité les garde tous. Renvoie [] si la soute n'est pas bornée.
// Le tri se fait sur le profit NET dès que `autoloadFor` est fourni — c'est ici que la destination
// gagnante se décide, un net calculé après coup par l'appelant arriverait trop tard. Chaque trajet
// emporte le contexte de frais qui l'a produit (`fee`), pour que tripMetrics et les recalculs de
// manifeste d'app.js n'aient pas à le reconstruire — ni à risquer de le reconstruire autrement.
export function manifestsFrom(market: Marche, origin: number, destSystem: string, f: Filtres, resolve: Resolveur, destTerminal: number | null = null, autoloadFor: ResolveurFrais | null = null): Trajet[] {
  if (!f.useCargo || !(f.cargo > 0)) return [];
  const ot = market.terminals[origin];
  const byDest = new Map();
  market.commodities.forEach((c) => {
    if (f.legalOnly && c.illegal) return;
    const b = c.buys.find((x) => x[0] === origin);
    if (!b) return;
    const eb = resolve(c.name, ot.name, "buy", b[1], b[2], b[3]); // prix/stock corrigés
    c.sells.forEach((s) => {
      if (s[0] === origin) return;
      const st = market.terminals[s[0]];
      if (destTerminal != null) { if (s[0] !== destTerminal) return; }
      else if (destSystem && st.system !== destSystem) return;
      if (!pairEligible(f, c, st, b[3], s[3])) return;
      const es = resolve(c.name, st.name, "sell", s[1], s[2], s[3]);
      const margin = es.price - eb.price;
      if (margin <= 0) return;
      if (!byDest.has(s[0])) byDest.set(s[0], []);
      byDest.get(s[0]).push({ name: c.name, kind: c.kind, illegal: c.illegal, buyPrice: eb.price, stock: eb.vol, sellPrice: es.price, demand: es.vol, demandKnown: es.ovol, margin, buyUpdated: b[3], sellUpdated: s[3] });
    });
  });

  const budget = f.useBudget && f.budget > 0 ? f.budget : Infinity;
  const buyPoint = autoloadFor ? autoloadFor(ot) : null;
  const trips = [];
  // Deux ordres de remplissage, parce qu'aucun n'est optimal seul. Par marge décroissante : optimal
  // quand la SOUTE est la seule contrainte. Par rendement du capital : préférable quand le BUDGET
  // borne, car une ligne chère draine sinon le budget et laisse la soute à moitié vide (50 000/SCU
  // épuise 100 000 aUEC en 2 SCU). Mais le rendement n'est pas non plus l'optimum — c'est un sac à
  // dos à deux contraintes — et il dégrade certains cas. On garde donc le meilleur des deux : jamais
  // pire qu'aujourd'hui par construction, et le second passage ne coûte que sous budget borné.
  const parMarge = (a, b) => b.margin - a.margin;
  const parRendement = (a, b) => (b.margin / b.buyPrice) - (a.margin / a.buyPrice) || parMarge(a, b);
  for (const [dest, items] of byDest) {
    const dt = market.terminals[dest];
    const fee = autoloadFor ? { buy: buyPoint, sell: autoloadFor(dt) } : null;
    // Un remplissage jusqu'à son profit FINAL. Comparer les deux ordres sur le brut choisirait sur
    // un chiffre qui n'est pas celui qui classe le manifeste : les frais grossissent avec le volume,
    // donc le remplissage le plus chargé n'est pas toujours le plus rentable une fois déduits.
    // Une ligne dont les frais dépassent la marge fait perdre de l'argent : la charger quand même
    // classerait ce manifeste sous un autre qui, lui, l'aurait laissée au sol. Mais une ligne ne se
    // juge PAS seule, et c'est ce que faisait le filtre `units * margin > lineHaulFee` appliqué
    // après coup (#41) : il ratait les deux moitiés de la question.
    //   - La place de la ligne écartée n'était rendue à personne. Le tri classe sur la marge au SCU,
    //     le filtre coupait sur la marge TOTALE, et les deux ne sont pas monotones l'un dans
    //     l'autre : une petite ligne à très forte marge préempte de la place en tête de tri, puis se
    //     fait écarter faute de couvrir la base de frais — 1 SCU de soute restait vide devant
    //     1 337 SCU à quai.
    //   - Une ligne rentable SEULE peut coûter au manifeste plus qu'elle ne rapporte : 1 SCU de
    //     Methane gagne 667 net, mais prend sa place aux 739 du Nitrogen et paie une base de frais
    //     de plus. Rentable, et pourtant à laisser au sol.
    // D'où le seul critère juste : une ligne reste si le manifeste vaut plus AVEC elle que sans, ce
    // qui suppose de rebâtir le chargement à chaque retrait — la place libérée retourne alors
    // d'elle-même aux candidates suivantes. Le tour qui n'améliore rien s'arrête, et une candidate
    // retirée ne revient jamais : la boucle est bornée par le nombre de candidates.
    // Ça ne rend pas `fillCargo` optimal — le sac à dos à deux contraintes reste hors de portée.
    // Ce qui est acquis : soute seule contrainte, un manifeste ne rapporte jamais moins que sa
    // meilleure commodité seule (0 contre-exemple sur les 167 434 arcs de l'instantané). Sous
    // budget bornant, c'est le budget qui joue la seconde contrainte et il en reste 16 sur 499 772.

    // Remplit, puis retire les lignes qui ne couvrent même pas leurs propres frais (lineNet <= 0) —
    // et recommence, parce que le retrait rend de la place et que les suivantes chargent davantage,
    // ce qui peut à son tour rendre déficitaire une ligne qui tenait à plus petit volume.
    // Ce verdict-là ne vaut QUE pour le chargement qui vient d'être bâti : il dépend du volume
    // attribué, donc de qui d'autre est à bord. 126 SCU de Human Food Bars perdent 60 aUEC là où
    // 128 en gagnent 200 — deux SCU de moins et la cargaison ne tient plus en caisses de 32. Le
    // rejet reste donc LOCAL à cet appel, et `evalue` repart toujours des candidates au complet.
    const remplir = (liste) => {
      let restantes = liste;
      for (;;) {
        const rempli = fillCargo(restantes, f.cargo, budget);
        const jetees = new Set();
        const lines = rempli.lines.filter((l) => {
          if (lineNet(l.units, l, fee) > 0) return true;
          jetees.add(l.name);
          return false;
        });
        if (!jetees.size) return { lines, profit: manifestTotals(lines, fee).profit };
        restantes = restantes.filter((c) => !jetees.has(c.name));
      }
    };
    const evalue = (ordre) => {
      const candidates = [...items].sort(ordre);
      if (!fee) return fillCargo(candidates, f.cargo, budget);
      const laissees = new Set();                       // écartées pour de bon : une par tour, jamais reprises
      let retenu = remplir(candidates);
      for (;;) {
        let mieux = null, sacrifiee = null;
        for (const l of retenu.lines) {
          const essai = remplir(candidates.filter((c) => c.name !== l.name && !laissees.has(c.name)));
          if (!mieux || essai.profit > mieux.profit) { mieux = essai; sacrifiee = l.name; }
        }
        if (!mieux || mieux.profit <= retenu.profit) return retenu;
        laissees.add(sacrifiee);
        retenu = mieux;
      }
    };
    let meilleur = evalue(parMarge);
    if (isFinite(budget)) {
      const alt = evalue(parRendement);
      if (alt.profit > meilleur.profit) meilleur = alt;
    }
    if (!meilleur.lines.length) continue;
    trips.push({ origin: ot, originIdx: origin, dest: dt, destIdx: dest, cross: ot.system !== dt.system, lines: meilleur.lines, profit: meilleur.profit, fee, cargo: f.cargo });
  }
  return trips.sort((a, b) => b.profit - a.profit);
}

// Manifeste : destination (terminal) qui maximise le profit d'un chargement multi-commodité depuis
// `origin`, soute remplie par marge décroissante (fillCargo). Toujours plafonné par stock/demande
// (ce qui force à diversifier). Null si la soute n'est pas contrainte.
// `destTerminal` (index) force un terminal d'arrivée précis ; sinon `destSystem` filtre par système.
export function bestManifest(market: Marche, origin: number, destSystem: string, f: Filtres, resolve: Resolveur, destTerminal: number | null = null, autoloadFor: ResolveurFrais | null = null): Trajet | null {
  return manifestsFrom(market, origin, destSystem, f, resolve, destTerminal, autoloadFor)[0] || null;
}

// ---------- Trajets MULTI-COMMODITÉ (vue « Trajets », coche « Multi commodité ») ----------
// Champs dérivés d'un trajet multi-commodité, à la forme attendue par bySort et
// les colonnes du tableau. La marge est la marge MOYENNE pondérée par SCU (profit / SCU chargés).
// Distance exacte indisponible hors routes.json -> tripMinutes(0, cross), comme « En route ».
// Les frais viennent du trajet lui-même (`trip.fee`, posé par manifestsFrom) : tripMetrics est la
// seule fonction de métriques à ne recevoir ni `f` ni terminaux, et un trajet fabriqué à la main
// (donc sans `fee`) reste chiffré au brut.
// Marge et ROI sont NETS des frais, dans les deux modes de la vue « Trajets » : ce qui compte est
// ce que le joueur encaisse par SCU, pas l'écart de prix affiché aux terminaux. Ils suivent donc
// `profit` (déjà net) et non `brut`. `marginGross` conserve la marge de MARCHÉ pour `legFromTrip` :
// une jambe de voyage ne doit pas figer une marge nette dans le parcours, où elle se cumulerait
// avec les marges brutes des jambes venues des autres vues — et où elle survivrait à l'extinction
// de l'interrupteur, jusque dans le permalien `j=`.
export function tripMetrics(trip: Trajet): MetriquesTrajet {
  const { profit, invest, scu, fees } = manifestTotals(trip.lines, trip.fee);
  const minutes = tripMinutes(0, trip.cross);
  const profitHour = profitPerHour(profit, minutes);
  const brut = fees ? profit + fees : profit;
  const marginGross = scu > 0 ? brut / scu : 0;
  const margin = scu > 0 ? profit / scu : 0;
  const roi = invest > 0 ? Math.round((profit / invest) * 1000) / 10 : 0;
  // Fiabilité : le relevé le PLUS VIEUX du chargement, et la part des SCU dont la demande est
  // publiée. C'est ici que l'ADR-005 change le plus : on ne retient plus le MINIMUM des stocks, qui
  // laissait une ligne de bouchage de 2 SCU sur 93 diviser la note par 1,93 pour 0,2 % du profit.
  let age = null, scuConnus = 0;
  for (const l of trip.lines) {
    const a = pairAge(l.buyUpdated, l.sellUpdated);
    if (a != null && (age == null || a > age)) age = a;
    if (l.demand != null) scuConnus += l.units || 0;
  }
  const partVolume = scu > 0 ? scuConnus / scu : 0;
  const fiabilite = fiabiliteDe(age, scuConnus, scu);
  // commodity/buyPrice/sellPrice : valeurs représentatives pour que le tri par colonne du tableau
  // « Trajets » reste utilisable en mode multi (ligne de tête = plus grosse marge, prix moyens/SCU).
  const buyPrice = scu > 0 ? invest / scu : 0;
  return {
    age, partVolume,
    units: scu, investment: invest, profit, margin, marginGross, roi, minutes, profitHour, fiabilite, fees,
    nLines: trip.lines.length, commodity: trip.lines[0] ? trip.lines[0].name : "",
    buyPrice, sellPrice: buyPrice + margin,
  };
}

// Jambe de voyage depuis un trajet multi-commodité (le manifeste de la jambe est recalculé par la
// vue Voyage, donc on ne retient que la commodité de tête comme libellé).
// La jambe retient la marge de MARCHÉ (`marginGross`), jamais la marge nette : elle est persistée
// et voyage dans le permalien `j=`, où des frais estimés au moment du clic n'auraient plus aucun
// sens — l'interrupteur peut être éteint depuis, ou le tarif de la station avoir changé.
export function legFromTrip(t: Omit<Trajet, "lines"> & { lines: any[]; margin?: number; marginGross?: number }): Jambe {
  const top = t.lines[0] || {};
  return {
    from: t.origin.name, fromSystem: t.origin.system, to: t.dest.name, toSystem: t.dest.system,
    commodity: top.name || "", buyPrice: top.buyPrice || 0, sellPrice: top.sellPrice || 0,
    margin: (t.marginGross != null ? t.marginGross : t.margin) || 0,
  };
}

// Jambe de voyage depuis un MANIFESTE (vue « En route »). Un trajet de manifestsFrom a exactement
// la forme d'un trajet multi-commodité — origin, dest, lines, fee, cargo — à une exception près :
// il ne porte pas de marge, celle-ci vit dans tripMetrics. On la calcule donc ici, et on prend
// `marginGross` : la jambe est persistée et voyage dans le permalien `j=`, où une marge NETTE des
// frais d'autoload n'aurait plus de sens (l'interrupteur peut être éteint depuis) et se cumulerait
// avec les marges brutes des jambes venues des autres vues. Sans ce calcul, legFromTrip retomberait
// sur `t.margin` absent -> une jambe à 0 figée dans le lien.
// Ne PAS dériver la marge de `man.profit` : il est déjà net des frais.
export function legFromManifest(man: Trajet): Jambe {
  return legFromTrip({ ...man, marginGross: tripMetrics(man).marginGross });
}

// Balaye TOUT le marché : pour chaque terminal d'achat, tous les remplissages multi-commodité vers
// chaque destination atteignable. Filtres appliqués : sysFilter/noOutpost sur le terminal de départ,
// sameOnly sur le saut, q sur les commodités chargées (legalOnly/noOutpost-arrivée/maxAge le sont
// déjà par manifestsFrom).
// `minLines` = nombre minimum de commodités par chargement (2 par défaut) : un trajet dont le
// remplissage optimal tient en UNE commodité est déjà couvert par la vue « Trajets » normale, on
// ne garde donc ici que les chargements réellement combinés. minLines:1 rend tout.
// Trié par profit décroissant puis TRONQUÉ à `limit` (garde-fou de perf : un tri utilisateur
// ultérieur ne réordonne que ces `limit` meilleurs trajets par profit). Ce profit est le NET dès
// que `autoloadFor` est fourni : la troncature décide QUELS trajets existent, un trajet meilleur
// en net serait donc coupé par le garde-fou avant même d'atteindre le tableau.
export function multiTrips(market: Marche, f: Filtres, resolve: Resolveur, limit = 300, minLines = 2, autoloadFor: ResolveurFrais | null = null): Trajet[] {
  // `Set<number>` et non `new Set()` : ces valeurs sont des INDEX de terminaux (b[0] d'un point de
  // marché), et sans annotation TypeScript infère `unknown` — market.terminals[origin] devient
  // alors inindexable. Le type dit ce que la donnée est, il ne la change pas.
  const origins = new Set<number>();
  market.commodities.forEach((c) => c.buys.forEach((b) => origins.add(b[0])));
  const out = [];
  for (const origin of origins) {
    const ot = market.terminals[origin];
    if (f.sysFilter && ot.system !== f.sysFilter) continue; // filtre système = système d'ACHAT
    if (f.noOutpost && ot.outpost) continue;
    for (const trip of manifestsFrom(market, origin, "", f, resolve, null, autoloadFor)) {
      if (trip.lines.length < minLines) continue;
      if (f.sameOnly && trip.cross) continue;
      if (f.q && !trip.lines.some((l) => l.name.toLowerCase().includes(f.q))) continue;
      out.push(trip);
    }
  }
  return out.sort((a, b) => b.profit - a.profit).slice(0, limit);
}

// Graphe des meilleurs segments : pour chaque paire (départ -> arrivée), la meilleure commodité
// (corrections comprises). Renvoie Map<idxTerminal, leg[]> pour bestChain.
// C'est le SEUL endroit de la chaîne où les deux terminaux d'un saut coexistent : le contexte de
// frais y est donc estampillé sur le leg (`fee`), que bestChain consomme sans jamais voir un
// terminal.
// Le critère de « meilleure » dépend des frais, et c'est indispensable : les frais ne dépendent que
// du VOLUME, or les volumes ne sont PAS égaux d'une commodité à l'autre (stock et demande diffèrent).
// La plus forte marge peut n'avoir que 2 SCU disponibles et se faire manger par la base de 150 —
// bestChain élague alors le saut ENTIER, et la vue Chaîne annonce « aucune chaîne rentable » alors
// que la commodité voisine, elle, remplissait la soute et rapportait. On classe donc sur le profit
// net au volume emportable dès que les frais sont actifs, et sur la marge sinon : le critère
// historique est conservé au caractère près tant que l'interrupteur est inactif.
export function buildChainAdjacency(market: Marche, f: Filtres, resolve: Resolveur, autoloadFor: ResolveurFrais | null = null): Map<number, JambeChaine[]> {
  const best = new Map(); // Map<u, Map<v, leg>>
  const cargo = f.useCargo && f.cargo > 0 ? f.cargo : Infinity;
  // Un seul segment survit par paire de terminaux : le retenir sur la marge nue évince pour de bon
  // une commodité un peu moins margée mais disponible en volume, et bestChain ne peut plus la
  // retrouver. On arbitre donc sur le gain RÉALISABLE, plafonné par stock et demande.
  // Sans soute bornée aucun volume n'est calculable (chainLegNet rend 0 pour tout le monde) : le
  // net ne discriminerait plus rien, on s'en tient alors à la marge.
  const parLeNet = isFinite(cargo);
  const mieux = (cand, cur) =>
    parLeNet ? chainLegNet(cand, cargo).profit > chainLegNet(cur, cargo).profit : cand.margin > cur.margin;
  market.commodities.forEach((c) => {
    if (f.legalOnly && c.illegal) return;
    // `resolve` ne dépend que de (c, s), jamais du point d'achat : sans mémo le même point de vente
    // est re-résolu une fois par achat (facteur ~4 sur les données réelles), chaque appel allouant
    // une clé et un objet pour rien. Le mémo est LOCAL (remis à zéro à chaque commodité) : un cache
    // global survivrait à une correction saisie par l'utilisateur et resservirait une valeur périmée.
    // Il est peuplé APRÈS les gardes, jamais avant : pré-résoudre toutes les ventes ferait payer
    // celles que `s[0]===b[0]`, `noOutpost`, `sameOnly` et surtout `maxAge` écartent — avec un filtre
    // de fraîcheur serré on résoudrait plus de points qu'aujourd'hui, et le correctif coûterait.
    const ventesRes = new Map(); // tuple de vente -> valeur effective (corrections comprises)
    c.buys.forEach((b) => {
      const bt = market.terminals[b[0]];
      if (f.noOutpost && bt.outpost) return;
      const eb = resolve(c.name, bt.name, "buy", b[1], b[2], b[3]);
      const bp = autoloadFor ? autoloadFor(bt) : null;
      c.sells.forEach((s) => {
        if (s[0] === b[0]) return;
        const st = market.terminals[s[0]];
        if (f.noOutpost && st.outpost) return;
        if (f.sameOnly && bt.system !== st.system) return;          // même système uniquement
        if (f.maxAge) { const a = pairAge(b[3], s[3]); if (a == null || a > f.maxAge) return; } // fraîcheur
        let es = ventesRes.get(s);
        if (es === undefined) { es = resolve(c.name, st.name, "sell", s[1], s[2], s[3]); ventesRes.set(s, es); }
        const margin = es.price - eb.price;
        if (margin <= 0) return;
        let m = best.get(b[0]);
        if (!m) { m = new Map(); best.set(b[0], m); }
        const cur = m.get(s[0]);
        const cand = { to: s[0], commodity: c.name, kind: c.kind, illegal: c.illegal, margin, buyPrice: eb.price, sellPrice: es.price, stock: eb.vol, demand: es.vol, demandKnown: es.ovol, fee: autoloadFor ? { buy: bp, sell: autoloadFor(st) } : null };
        if (!cur || mieux(cand, cur)) m.set(s[0], cand);
      });
    });
  });
  // Sans soute bornée il n'y a pas de remplissage à composer (manifestsFrom rend [] et chainLegNet
  // ne chiffre aucun volume) : le graphe reste strictement celui d'avant, une commodité par arc.
  if (isFinite(cargo)) estampillerManifestes(market, best, f, resolve, autoloadFor, cargo);
  const adj = new Map();
  for (const [u, m] of best) adj.set(u, [...m.values()]);
  return adj;
}

// Le CHARGEMENT de chaque arc, composé une fois pour toutes ici (#56). Un saut ne transportait
// qu'une commodité et la soute repartait à moitié vide dès que son stock ou la demande à l'arrivée
// ne suffisait pas à la remplir — 32 % des arcs de l'instantané, alors que « En route » sait déjà
// combler la place sur le MÊME couple de terminaux.
//
// Pourquoi ici, et pas dans la boucle du faisceau : le chargement d'un saut ne dépend PAS du chemin
// qui y mène. bestChain ne thread aucun budget (il se reconstitue à la vente) et passe `cargo`
// inchangé à chaque saut, la soute se vidant à chaque arrivée — le manifeste de u -> v est donc
// entièrement déterminé par (u, v, cargo, filtres). Composé par arc il coûte ≈ 6 ms sur
// l'instantané ; appelé depuis les ≈ 33 000 expansions du faisceau, ≈ 1 s. Qui voudra un jour
// suivre un budget le long de la chaîne devra d'abord renoncer à ce pré-calcul, et en payer le prix.
//
// On n'estampille QUE des arcs déjà retenus par le balayage mono ci-dessus, jamais l'inverse : la
// clé `m.get(destIdx)` est ce qui réapplique les deux filtres que `pairEligible` ne pose pas —
// `sameOnly`, et l'avant-poste d'ORIGINE (celui de vente, lui, est bien testé). Sans elle la chaîne
// se remettrait à proposer des départs d'avant-poste et des sauts inter-systèmes.
//
// Un arc dont le manifeste est vide GARDE son chiffrage mono : `fillCargo` ne retient rien là où le
// balayage produit encore un segment (demande publiée à 0, stock épuisé), 71 arcs sur 4 355 dans
// l'instantané, 136 une fois les frais actifs. Remplacer l'arc par son manifeste les ferait
// disparaître du graphe.
//
// Ce qu'on ne modélise toujours pas, et qu'il ne faut pas croire oublié : la DÉPLÉTION du stock
// entre les sauts d'une même chaîne. Deux sauts peuvent acheter la même commodité à deux terminaux
// différents, et le multi-commodités multiplie ces croisements — c'était déjà le cas avant #56, et
// rien dans les données d'UEX ne dit à quel rythme un terminal se recharge.
function estampillerManifestes(market: Marche, best: Map<number, Map<number, JambeChaine>>, f: Filtres, resolve: Resolveur, autoloadFor: ResolveurFrais | null, cargo: number): void {
  // Budget neutralisé : la chaîne l'ignore par construction (README, matrice des filtres, note ¹),
  // et le laisser borner le remplissage ferait dire à la vue l'inverse de ce qu'elle annonce.
  const sansBudget = { ...f, useBudget: false };
  for (const [u, m] of best) {
    for (const trip of manifestsFrom(market, u, "", sansBudget, resolve, null, autoloadFor)) {
      const leg = m.get(trip.destIdx);
      if (!leg) continue;
      // Le profit du saut est celui du manifeste : une base d'autoload PAR LIGNE (hypothèse 2 de la
      // spec), là où `haulFee` n'en facturait qu'une par saut. Un saut de 4 lignes en paie 4, sans
      // quoi bestChain arbitrerait entre les sauts sur des montants surévalués.
      const { profit, scu } = manifestTotals(trip.lines, leg.fee);
      leg.lines = trip.lines;
      leg.net = { units: scu, profit, lines: trip.lines, cargo };
    }
  }
}

// ---------- Panneau « Commodités » : résumé global + points d'achat/vente ----------
// Une ligne de synthèse par commodité (pour le grand tableau triable).
// f (optionnel) = { legalOnly, noOutpost, board } :
//   - legalOnly / noOutpost : masque les commodités illégales, exclut les points en avant-poste
//     du calcul best/compteurs ;
//   - board = "market" (défaut) -> uniquement les commodités ÉCHANGEABLES (achat ET vente) ;
//     board = "loot" -> mode Butin : tout ce qui se VEND, y compris ce qu'on ne peut acheter
//     nulle part (minerais raffinés, salvage, drogues de wreck) — le cas « je l'ai trouvé ».
// `resolve` applique les corrections locales, comme dans toutes les autres vues. Sans lui, le board
// classait et coloriait sur les prix BRUTS d'UEX : on corrigeait un prix dans un tableau, et la
// tuile de la commodité — sa marge, sa couleur, son rang — continuait d'afficher l'ancien chiffre.
// Optionnel pour rester pur par défaut (les tests l'appellent sans).
export function commoditySummaries(market: Marche, f: FiltresBoard = {}, resolve: Resolveur | null = null): ResumeCommodite[] {
  const loot = f.board === "loot";
  const out = [];
  const prix = (c, p, side) => (resolve ? resolve(c.name, market.terminals[p[0]].name, side, p[1], p[2], p[3]).price : p[1]);
  for (const c of market.commodities) {
    if (f.legalOnly && c.illegal) continue;
    // « Échangeable » se juge sur les données BRUTES : le juger après `noOutpost` ferait
    // disparaître du board Marché une commodité achetable seulement en avant-poste.
    const sellOnly = c.buys.length === 0;
    if (!loot && sellOnly) continue;
    const buys = f.noOutpost ? c.buys.filter((b) => !market.terminals[b[0]].outpost) : c.buys;
    const sells = f.noOutpost ? c.sells.filter((s) => !market.terminals[s[0]].outpost) : c.sells;
    // Achat le moins cher / vente la plus chère + le statut d'inventaire à ce point.
    let bestBuy = null, buyStatus = 0;
    for (const b of buys) { const v = prix(c, b, "buy"); if (bestBuy == null || v < bestBuy) { bestBuy = v; buyStatus = b[4] || 0; } }
    let bestSell = null, sellStatus = 0;
    for (const s of sells) { const v = prix(c, s, "sell"); if (bestSell == null || v > bestSell) { bestSell = v; sellStatus = s[4] || 0; } }
    // En mode Butin, une commodité sans point de vente restant n'a plus de réponse à offrir.
    if (loot && bestSell == null) continue;
    const margin = bestBuy != null && bestSell != null ? bestSell - bestBuy : null;
    out.push({
      name: c.name, code: c.code || "", kind: c.kind, illegal: c.illegal,
      nBuy: buys.length, nSell: sells.length, bestBuy, bestSell, buyStatus, sellStatus, margin,
      sellOnly,
    });
  }
  return out;
}

// Tous les points d'ACHAT (les moins chers d'abord) et de VENTE (les plus chers d'abord)
// d'une commodité, avec la localisation du terminal. Null si commodité inconnue.
// `resolve` : mêmes corrections locales que partout ailleurs (cf. commoditySummaries). Le tri
// « moins cher d'abord » / « mieux payé d'abord » porte donc sur les valeurs CORRIGÉES — sinon la
// liste se serait ordonnée sur des prix que l'utilisateur venait justement de démentir.
export function commodityPoints(market: Marche, name: string, f: Filtres = {}, resolve: Resolveur | null = null): DetailCommodite | null {
  const c = market.commodities.find((x) => x.name === name);
  if (!c) return null;
  const T = (i) => market.terminals[i];
  const keep = (p) => !(f.noOutpost && T(p[0]).outpost); // exclut les avant-postes si demandé
  const point = (p, volKey, side) => {
    const t = T(p[0]);
    const e = resolve ? resolve(c.name, t.name, side, p[1], p[2], p[3]) : null;
    return {
      terminal: t.name, system: t.system, planet: t.planet, outpost: t.outpost,
      price: e ? e.price : p[1], [volKey]: e ? e.vol : p[2], updated: p[3], status: p[4],
    };
  };
  const buys = c.buys.filter(keep).map((b) => point(b, "stock", "buy")).sort((a, b) => a.price - b.price);
  const sells = c.sells.filter(keep).map((s) => point(s, "demand", "sell")).sort((a, b) => b.price - a.price);
  return { name: c.name, code: c.code || "", kind: c.kind, illegal: c.illegal, buys, sells };
}

// Palier de heatmap d'une tuile en mode « Marché », RELATIF à la meilleure marge de la liste :
// rouge = tête de peloton → bleu correct → gris atone → sans marge. L'échelle s'adapte donc aux
// données, ce qu'un barème en aUEC absolus ne ferait pas.
//
// Le maximum est un PARAMÈTRE, et c'était une globale d'`app.js` (`commMaxMargin`). Il doit être
// calculé sur TOUT le board et jamais sur le sous-ensemble visible : la couleur prétend situer la
// commodité dans l'ensemble du marché, et taper « iron » suffisait à repeindre Iron — le bas du
// classement — en `t-hot`, rang 0 sur 1 ligne restante (#56).
export function palierMarge(m: number | null | undefined, max: number): PalierValeur {
  if (m == null || m <= 0) return "t-none";
  const r = max > 0 ? m / max : 0;
  if (r >= 0.66) return "t-hot";
  if (r >= 0.40) return "t-warm";
  if (r >= 0.18) return "t-mid";
  return "t-low";
}

// Paliers de heatmap par RANG, pour le mode « Butin ».
// Les prix de revente s'étalent sur cinq ordres de grandeur (Saldynium à 34 M aUEC/SCU contre
// Iron Ore à 1 000) : une échelle relative au maximum, comme `marginTier`, tasserait tout le
// board dans le palier le plus bas sauf deux tuiles. Le rang, lui, colore toujours.
// Le classement se fait sur la VALEUR, jamais sur l'ordre d'affichage : trier par code A→Z ne
// doit pas recolorer le board. Les ex æquo partagent donc le rang du premier d'entre eux
// (classement « olympique ») : à prix égal, même palier, quel que soit l'ordre reçu.
export function valueTiers(rows: ClassableParValeur[], key: CleDeValeur = "bestSell"): Map<string, PalierValeur> {
  const tiers = new Map();
  const ranked = [];
  for (const r of rows) {
    if (r[key] == null) tiers.set(r.name, "t-none"); // rien à classer -> hors barème
    else ranked.push(r);
  }
  ranked.sort((a, b) => b[key] - a[key]);
  const n = ranked.length;
  let rang = 0; // indice du premier ex æquo de la valeur courante
  ranked.forEach((r, i) => {
    if (i > 0 && r[key] !== ranked[i - 1][key]) rang = i;
    const q = rang / n; // part des commodités strictement mieux payées
    tiers.set(r.name, q < 0.15 ? "t-hot" : q < 0.40 ? "t-warm" : q < 0.70 ? "t-mid" : "t-low");
  });
  return tiers;
}

// Notation compacte K/M pour les tuiles du board (ex. 9600 -> "9.6K", 1_600_000 -> "1.6M").
export function compactValue(n: number | null): string {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return Math.round(n / 1e5) / 10 + "M";
  if (a >= 1e3) return Math.round(n / 100) / 10 + "K";
  return String(Math.round(n));
}

// ---------- Résolution d'une commodité (le code UEX n'est PAS une clé unique) ----------
// Piège : UEX attribue le même code à des commodités DISTINCTES — `COPP` désigne à la fois
// « Copper » (échangeable) et « Copper (Ore) » (butin, aucun point d'achat). Une recherche par
// `find()` sur nom-ou-code renvoyait donc toujours la première et rendait l'autre inatteignable.
// D'où : le nom exact prime, et un code ambigu ne résout RIEN plutôt que d'en désigner une au hasard.
export function resolveCommodity(commodities: Commodite[], query: string | null | undefined): Commodite | null {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return null;
  const byName = commodities.find((c) => c.name.toLowerCase() === q);
  if (byName) return byName;
  const byCode = commodities.filter((c) => c.code && c.code.toLowerCase() === q);
  return byCode.length === 1 ? byCode[0] : null;
}

// Codes portés par PLUSIEURS commodités de la liste. Le board n'affiche le code seul que s'il
// identifie sa commodité : sinon deux tuiles seraient rigoureusement indiscernables à l'écran.
export function ambiguousCodes(rows: { code?: string }[]): Set<string> {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const r of rows) {
    if (!r.code) continue;
    if (seen.has(r.code)) dup.add(r.code);
    else seen.add(r.code);
  }
  return dup;
}

// ---------- Libellé canonique d'une station « Nom — Système » ----------
// Clé unique des datalists et des maps terminal (originMap/stationMap) côté app. Un seul endroit
// définit le format -> pas de divergence entre les ~15 sites qui le construisaient à la main.
export const stationLabel = (name: string, system: string): string => `${name} — ${system}`;
// Sépare un libellé en { name, system }. Coupe au PREMIER « — » (le nom prime), cohérent avec
// l'ancien `label.split(" — ")[0]`. Renvoie system:"" si le séparateur est absent.
export function parseStationLabel(label: string | null | undefined): Station {
  const s = String(label ?? "");
  const i = s.indexOf(" — ");
  return i < 0 ? { name: s, system: "" } : { name: s.slice(0, i), system: s.slice(i + 3) };
}

// Ordre d'affichage des systèmes dans le sélecteur de station : par volume décroissant de
// terminaux (Stanton 80, Pyro 27, Nyx 7). C'est aussi l'ordre dans lequel un joueur les rencontre.
// Un système absent de cette liste n'est pas perdu : il passe en queue, trié par son nom.
const ORDRE_SYSTEMES = ["Stanton", "Pyro", "Nyx"];

// Zone d'un terminal : l'échelon intermédiaire entre le système et la station.
// 12 terminaux sur 114 n'ont pas de planète — les 7 portes de saut, les 4 PSS et Levski. L'ADR-003
// a d'abord voulu combler ce trou avec `orbit_name`, sur la foi qu'il recopiait le nom du terminal.
// Mesuré contre l'API : il en donne une VARIANTE (« Pyro Gateway (Stanton system) » pour le
// terminal « Pyro Gateway (Stanton) », « People's Service Station Alpha » pour « PSS Alpha »). Le
// test « orbite ≠ nom » était donc vrai partout, et la règle fausse sur 11 des 12. Le champ
// n'achetait qu'un seul libellé utile — « Delamar » pour Levski — au prix de cette erreur : on y a
// renoncé, et les 12 tombent ensemble dans « Espace profond ».
const zoneDe = (t: Terminal): string => t.planet || "Espace profond";

// Range les terminaux en système › zone › station, pour un sélecteur qui se parcourt à l'œil.
// Fonction PURE : elle reçoit le tableau, ne lit aucune globale, et ne le modifie pas.
// Renvoie [{ systeme, zones: [{ zone, stations: [...] }] }].
// Chaque station porte `i`, son index dans le tableau d'ENTRÉE : c'est la seule clé fiable, `code`
// n'étant pas unique (PYROG désigne les deux Pyro Gateway). `label` est pré-calculé parce que c'est
// lui, et lui seul, que le champ doit recevoir — resolveStation résout par correspondance exacte.
export function stationTree(terminals: Terminal[] | null): NoeudSysteme[] {
  const parSysteme = new Map();
  (terminals || []).forEach((t, i) => {
    const systeme = t.system || "?";
    const zone = zoneDe(t);
    if (!parSysteme.has(systeme)) parSysteme.set(systeme, new Map());
    const zones = parSysteme.get(systeme);
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push({
      i, name: t.name, system: systeme, zone,
      code: t.code || "", shot: t.shot || "", outpost: !!t.outpost,
      label: stationLabel(t.name, systeme),
    });
  });

  const rang = (s) => { const r = ORDRE_SYSTEMES.indexOf(s); return r < 0 ? ORDRE_SYSTEMES.length : r; };
  return [...parSysteme.entries()]
    .sort((a, b) => rang(a[0]) - rang(b[0]) || a[0].localeCompare(b[0], "fr"))
    .map(([systeme, zones]) => ({
      systeme,
      zones: [...zones.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "fr"))
        .map(([zone, stations]) => ({ zone, stations: stations.sort((x, y) => x.name.localeCompare(y.name, "fr")) })),
    }));
}

// ---------- Compagnon de voyage : modèle de « parcours » (pur, sérialisable) ----------
// Un parcours = suite ORDONNÉE de sauts (legs) contigus + position courante (index de station).
//   leg = { from, fromSystem, to, toSystem, commodity, buyPrice, sellPrice, margin }
//   stations dérivées = [from0, to0(=from1), to1, …]  ->  legs.length + 1 stations.
//   current = index de la station où l'on se trouve (0..legs.length). La « jambe courante »
//   va de stations[current] à stations[current+1].

// Construit une jambe depuis un trajet évalué (vue Trajets / En route).
export function legFromRoute(r: Route): Jambe {
  return {
    from: r.buy.terminal, fromSystem: r.buy.system, to: r.sell.terminal, toSystem: r.sell.system,
    commodity: r.commodity, buyPrice: r.buy.price, sellPrice: r.sell.price, margin: r.margin,
  };
}
// Les filtres de la vue, appliqués à une destination candidate du VOYAGE. `sysFilter` borne le
// système d'ACHAT : dans un parcours l'origine est imposée par la jambe précédente, pas choisie
// dans le menu — le neutraliser ici, comme le fait « En route », est la seule différence.
const legPasses = (r: Route, f: Filtres): boolean => routePasses(r, { ...f, sysFilter: "" });

// Destinations rentables depuis `origin` (index de terminal), pour proposer un arrêt de voyage :
// une entrée par terminal d'arrivée, celle de meilleure marge, les `limit` premières.
// Les filtres de la vue s'appliquent, exactement comme dans « En route ». Sans eux, la boîte
// proposait des trajets qu'AUCUNE vue n'accepte de montrer — commodité illégale alors que
// « légales uniquement » est coché, avant-poste exclu, relevé périmé — et la jambe ajoutée
// s'affichait « aucun fret rentable », son manifeste étant filtré, lui, par pairEligible.
// Même divergence de règles que celle qui a donné pairEligible : une seule source, partagée.
export function stopSuggestions(market: Marche, origin: number, f: Filtres, limit: number = 4): SuggestionArret[] {
  const byDest = new Map();
  for (const d of enRouteDeals(market, origin, "", null, f)) {
    if (!legPasses(d, f)) continue;
    const label = stationLabel(d.sell.terminal, d.sell.system);
    const cur = byDest.get(label);
    if (!cur || d.margin > cur.margin) {
      byDest.set(label, { label, terminal: d.sell.terminal, system: d.sell.system, commodity: d.commodity, margin: d.margin });
    }
  }
  return [...byDest.values()].sort((a, b) => b.margin - a.margin).slice(0, limit);
}
// Meilleure jambe entre deux terminaux (commodité de marge max), filtres appliqués comme
// ci-dessus, ou null si aucun fret éligible : l'appelant pose alors une jambe « à vide ».
export function bestLegBetween(market: Marche, fromIdx: number, toIdx: number, f: Filtres): Jambe | null {
  const deals = enRouteDeals(market, fromIdx, "", toIdx, f).filter((d) => legPasses(d, f));
  if (!deals.length) return null;
  return legFromRoute(deals.reduce((a, b) => (b.margin > a.margin ? b : a)));
}

// Deux jambes depuis une boucle évaluée (aller puis retour).
// `startAt` = terminal par lequel entrer dans le cycle : une boucle A⇄B se parcourt aussi bien
// B->A->B que A->B->A. Sans lui, on partirait toujours de `a`, et une boucle raccordée au parcours
// par son `b` ne s'enchaînerait pas -> addToJourney REMPLACERAIT le voyage au lieu de l'étendre.
export function legsFromLoop(l: Boucle, startAt?: string | null): [Jambe, Jambe] {
  const out = { from: l.a.terminal, fromSystem: l.a.system, to: l.b.terminal, toSystem: l.b.system, commodity: l.out.commodity, buyPrice: l.out.buyPrice, sellPrice: l.out.sellPrice, margin: l.out.margin };
  const back = { from: l.b.terminal, fromSystem: l.b.system, to: l.a.terminal, toSystem: l.a.system, commodity: l.back.commodity, buyPrice: l.back.buyPrice, sellPrice: l.back.sellPrice, margin: l.back.margin };
  return startAt === l.b.terminal && startAt !== l.a.terminal ? [back, out] : [out, back];
}
// N jambes depuis une chaîne (bestChain) : `terminals` résout les index -> noms/systèmes.
// Un saut transporte un MANIFESTE (#56) que le format de jambe ne sait pas porter — comme pour un
// trajet multi-commodité (legFromTrip), la jambe ne retient donc que la ligne de TÊTE en libellé, et
// la vue Voyage recompose le chargement complet à l'affichage (legManifest). Prendre la tête du
// manifeste plutôt que le repli mono de l'arc est ce qui fait dire la même commodité aux deux vues.
export function legsFromChain(chain: ChaineChiffree, terminals: Terminal[]): Jambe[] {
  return chain.legs.map((leg, i) => {
    const from = terminals[chain.path[i]], to = terminals[chain.path[i + 1]];
    const tete = (leg.lines && leg.lines[0]) || { name: leg.commodity, buyPrice: leg.buyPrice, sellPrice: leg.sellPrice, margin: leg.margin };
    return { from: from.name, fromSystem: from.system, to: to.name, toSystem: to.system, commodity: tete.name, buyPrice: tete.buyPrice, sellPrice: tete.sellPrice, margin: tete.margin };
  });
}

// Démarre un parcours neuf à partir de jambes (position au départ).
export function startJourney(legs: Jambe[]): Parcours {
  return { legs: legs.slice(), current: 0 };
}
// Démarre un parcours « de zéro » : juste un point de départ, sans jambe encore.
// On construit ensuite le parcours en ajoutant des arrêts (addToJourney).
export function startJourneyAt(station: Station | null | undefined): Parcours | null {
  if (!station || !station.name) return null;
  return { legs: [], current: 0, start: { name: station.name, system: station.system } };
}
// Stations ordonnées du parcours : [{ name, system }, …] (legs.length + 1 entrées).
// Cas « de zéro » : pas de jambe mais un point de départ -> une seule station.
export function journeyStations(journey: Parcours | null): Station[] {
  if (!journey) return [];
  if (!journey.legs.length) return journey.start ? [{ name: journey.start.name, system: journey.start.system }] : [];
  const st = [{ name: journey.legs[0].from, system: journey.legs[0].fromSystem }];
  for (const leg of journey.legs) st.push({ name: leg.to, system: leg.toSystem });
  return st;
}
// Dernière station (fin du parcours planifié), ou null.
export function journeyEnd(journey: Parcours | null): Station | null {
  const st = journeyStations(journey);
  return st.length ? st[st.length - 1] : null;
}
// Les nouvelles jambes s'enchaînent-elles à la fin du parcours ? (leur départ == dernière station)
export function journeyConnects(journey: Parcours | null, legs: { from: string }[]): boolean {
  const end = journeyEnd(journey);
  return !!(end && legs.length && legs[0].from === end.name);
}
// Politique produit : ÉTENDRE si ça s'enchaîne (ajoute à la fin, garde la position), sinon REMPLACER.
export function addToJourney(journey: Parcours | null, legs: Jambe[]): Parcours {
  if (journeyConnects(journey, legs)) return { legs: journey.legs.concat(legs), current: journey.current };
  return startJourney(legs);
}
// Que peut-on faire d'un chargement (origine -> destination) vis-à-vis du parcours en cours ?
// Renvoie { etat: "ajouter" | "deja" | "conflit", leg, fin }.
//
// L'ORDRE DES BRANCHES EST SIGNIFIANT :
//   1. pas de voyage        -> ajouter (on en démarre un, comme le ▶ des tableaux) ;
//   2. ça se RACCORDE       -> ajouter. Testé AVANT « déjà » : sur un parcours cyclique A→B→A dont
//      on est au bout, le chargement A→B est un nouveau tour, pas la jambe 0 qu'on a déjà faite ;
//   3. c'est la jambe COURANTE, puis n'importe quelle jambe planifiée -> déjà (aucune action) ;
//   4. sinon                -> conflit, en nommant la fin du parcours.
//
// « déjà » est l'état NORMAL, pas une anomalie : après tout ▶, syncViewsToJourney pré-remplit
// « En route » avec la station courante, donc la carte affiche précisément la jambe qu'on vient de
// choisir. C'est aussi l'état d'arrivée après un ajout réussi — la phrase sert alors de
// confirmation, à l'endroit exact du clic.
//
// Le raccord passe par journeyConnects et non par une comparaison recopiée : une seule source de
// vérité, qui suivra son durcissement éventuel. Comme elle — et comme legKey — on compare les NOMS
// de station seuls : introduire ici une seconde règle d'identité (nom + système) ferait diverger
// deux définitions du même mot.
export function manifestJourneyState(journey: Parcours | null, origin: { name: string }, dest: { name: string }): EtatVoyageManifeste {
  if (!journey) return { etat: "ajouter" };
  if (journeyConnects(journey, [{ from: origin.name }])) return { etat: "ajouter" };
  const cur = currentLeg(journey);
  if (cur && cur.from === origin.name && cur.to === dest.name) return { etat: "deja", leg: journey.current };
  const i = journey.legs.findIndex((l) => l.from === origin.name && l.to === dest.name);
  if (i >= 0) return { etat: "deja", leg: i };
  const fin = journeyEnd(journey);
  return { etat: "conflit", fin: fin ? fin.name : null };
}

// Jambes dont les SCU doivent être FIGÉS quand un volume (stock ou demande) change à un terminal.
//
// Le verrou vient du CHARGEMENT, pas de la correction (#48, ADR-002 addendum). Deux gestes, deux
// sens, qu'il ne faut pas confondre :
//   - « ✓ chargé » dit « c'est payé et à bord » : les SCU de cette jambe sont un FAIT, plus un plan.
//     Rien ne doit plus les rétrécir, et surtout pas la déduction de stock que ce chargement vient
//     lui-même de provoquer.
//   - corriger un stock à la main dit « le relevé est faux, recalcule » : la jambe reste branchée
//     sur le marché et se rebat sur la valeur corrigée. C'est le geste de qui est SUR PLACE et voit
//     le rayon. Le figer sur un chiffre qu'on vient soi-même de démentir n'aurait aucun sens.
// L'ancienne règle assimilait les deux — « corriger un volume, c'est constater qu'on vient de vider
// la station ». Ce raccourci ne tient plus depuis que `✓ chargé` existe : c'est LUI qui déduit.
//
// Une jambe n'est de toute façon concernée que si elle touche vraiment ce point : le terminal est
// son départ (stock d'ACHAT) ou son arrivée (demande de VENTE), et son chargement porte cette
// commodité. Un prix, lui, ne rebat aucune quantité : il ne fige rien.
// `lignesPar[i]` = chargement effectif de la jambe i ; `chargees[i]` = son état « payée et à bord ».
// Les deux sont connus de l'appelant, pas d'ici.
// `chargees` par défaut vide : un appelant qui l'oublierait ne fige RIEN plutôt que de retomber en
// silence sur l'ancienne règle. Ne pas figer se rattrape tout seul au rendu suivant ; figer à tort
// ne se défait qu'à la main, par un « ↺ optimal » qui emporte aussi les ajustements légitimes.
export function legsToPin(legs: Jambe[], lignesPar: { name: string }[][], commodity: string, terminal: string, side: Cote, chargees: boolean[] = []): number[] {
  const bouts = legs.map((l) => (side === "buy" ? l.from : l.to));
  return legs.map((_, i) => i).filter((i) =>
    chargees[i] && bouts[i] === terminal && (lignesPar[i] || []).some((l) => l.name === commodity)
  );
}

// INTENTION d'un chargement : la seule forme persistable. Jamais un instantané de marché — prix,
// stock, demande et dates sont relus au rendu (cf. hydrateManifestLine), sinon un manifeste
// continuerait d'afficher le prix du jour de l'édition longtemps après qu'UEX l'ait republié.
// Aucun filtre sur `units` : un 0 posé volontairement est une décision de l'utilisateur
// (editLegQty l'autorise explicitement) et doit survivre.
export function manifestIntent(lines: IntentionLigne[]): IntentionLigne[] {
  return lines.map((l) => ({ name: l.name, units: l.units }));
}
// Deux intentions décrivent-elles le même chargement ? Sert à ne RIEN persister quand le manifeste
// n'a pas été touché : la jambe reste alors branchée sur le marché et sur les filtres.
export function sameIntent(a: IntentionLigne[], b: IntentionLigne[]): boolean {
  return a.length === b.length && a.every((l, i) => l.name === b[i].name && l.units === b[i].units);
}

// La composition en cours de la carte Manifeste vaut-elle encore pour la carte qu'on s'apprête à
// peindre ? Elle porte sur un COUPLE de terminaux — c'est de LEURS prix, stocks et demandes que ses
// lignes sont relues — donc elle survit à tout ce qui ne change pas ce couple : un prix corrigé, une
// frappe dans la recherche, un vaisseau plus grand. La soute ne la borne pas : des SCU ajustés à la
// main restent la décision de l'utilisateur, et le total « 120/32 SCU » la lui redit à l'écran.
// Elle n'est ABANDONNÉE que lorsqu'une AUTRE route est demandée, parce que là c'est un geste.
// `vue` décrit la carte demandée : `from` = { name, system } du terminal de départ affiché,
// `dest` = { name, system } de l'arrivée forcée au champ (null s'il est vide), `destSystem` = le
// filtre de système d'arrivée ("" s'il est vide).
// Une composition SANS ligne en est une : vider le manifeste pour le recomposer à soi est un geste,
// et lui rendre l'optimal au prochain rendu serait exactement le défaut qu'on corrige.
export function manifestIntentSurvives(edit: CompositionManifeste | null, vue: VueManifeste): boolean {
  if (!edit || !Array.isArray(edit.lines)) return false;
  if (edit.from !== vue.from.name || edit.fromSystem !== vue.from.system) return false;
  if (vue.dest && (vue.dest.name !== edit.to || vue.dest.system !== edit.toSystem)) return false;
  return !vue.destSystem || vue.destSystem === edit.toSystem;
}

// Retire un ARRÊT du parcours (stopIndex indexe les STATIONS, pas les jambes).
// `bridge` = jambe de remplacement pour un arrêt du MILIEU, calculée par l'appelant depuis le
// marché (elle reconnecte stations[stopIndex-1] à stations[stopIndex+1]) ; ignorée aux extrémités.
// Renvoie { legs, current, removedFrom, removedCount, insertedCount }, plus `start` quand il ne
// reste qu'un arrêt (parcours « départ posé »), ou null quand il ne reste plus rien du tout.
// Les trois compteurs servent à réindexer les manifestes édités par jambe.
export function removeJourneyStop(journey: Parcours, stopIndex: number, bridge?: Jambe | null): RetraitArret | null {
  const legs = journey.legs;
  // Parcours déjà réduit à son point de départ : retirer ce dernier arrêt efface tout.
  if (!legs.length) return null;
  let newLegs, removedFrom, removedCount, insertedCount = 0;
  if (stopIndex <= 0) {
    newLegs = legs.slice(1); removedFrom = 0; removedCount = 1;          // 1er arrêt -> 1re jambe
  } else if (stopIndex >= legs.length) {
    newLegs = legs.slice(0, -1); removedFrom = legs.length - 1; removedCount = 1; // dernier arrêt
  } else {
    // Arrêt du milieu : deux jambes disparaissent, remplacées par une seule (le pont).
    newLegs = [...legs.slice(0, stopIndex - 1), bridge, ...legs.slice(stopIndex + 1)];
    removedFrom = stopIndex - 1; removedCount = 2; insertedCount = 1;
  }
  // Une seule jambe, dont on retire une extrémité : l'AUTRE extrémité reste un arrêt légitime.
  // Le parcours ne disparaît donc pas — il retombe sur sa forme « départ posé » (startJourneyAt),
  // celle d'un voyage qu'on vient de commencer, prête à recevoir un nouvel arrêt. Renvoyer null
  // ici faisait s'évanouir les DEUX arrêts d'un coup, alors qu'un seul avait été cliqué.
  if (!newLegs.length) {
    const reste = stopIndex <= 0
      ? { name: legs[0].to, system: legs[0].toSystem }     // on a retiré le départ -> l'arrivée survit
      : { name: legs[0].from, system: legs[0].fromSystem }; // on a retiré l'arrivée -> le départ survit
    return { legs: [], current: 0, start: reste, removedFrom, removedCount, insertedCount };
  }
  // `current` indexe les STATIONS. Retirer l'arrêt `stopIndex` fait reculer d'un cran TOUTES les
  // stations situées à partir de lui : sans ce décalage, le marqueur « je suis ici » sautait à la
  // station suivante, `currentLeg` devenait null (parcours cru terminé) et « En route » se
  // préremplissait avec le mauvais terminal de départ.
  const c = journey.current >= stopIndex ? journey.current - 1 : journey.current;
  return {
    legs: newLegs,
    current: Math.max(0, Math.min(c, newLegs.length)),
    removedFrom, removedCount, insertedCount,
  };
}

// ---------- Le RANG d'une jambe, et ses QUATRE porteurs ----------
// Quatre choses sont indexées par le rang d'une jambe : le manifeste ÉDITÉ, le 🔒 qui dit pourquoi
// il l'est, l'étiquette `leg` que le chargement pose sur les lots de la soute, et l'entrée du
// REGISTRE des chargements (plus bas). Retirer un arrêt renumérote les jambes : n'en décaler que
// trois les fait diverger. C'est d'en avoir oublié un que venait le double chargement — la jambe
// renumérotée se croyait vide alors que son fret était à bord.

// Nouvelle clé d'une jambe après un retrait d'arrêt : la même, renumérotée — ou `null` si la jambe
// a disparu du parcours. Une clé illisible ressort INTACTE : on ne renumérote pas ce qu'on n'a pas
// su lire, et surtout on n'écrit pas de « NaN| » dans un store persisté.
// `retrait` = ce que removeJourneyStop vient de renvoyer.
export function cleApresRetrait(cle: string, { removedFrom, removedCount, insertedCount = 0 }: Retrait): string | null {
  const s = String(cle), sep = s.indexOf("|");
  const i = sep < 0 ? NaN : Number(s.slice(0, sep));
  if (!Number.isInteger(i) || i < 0) return cle;
  if (i < removedFrom) return cle;                               // avant la coupe : inchangée
  if (i < removedFrom + removedCount) return null;               // jambe disparue
  return `${i - (removedCount - insertedCount)}${s.slice(sep)}`; // après : recule d'autant
}

const sansEtiquette = (lot: Lot): Lot => { const { leg, ...reste } = lot; return reste; };

// Réindexe LES QUATRE PORTEURS d'un seul appel — c'est tout l'intérêt : ils ne peuvent plus
// diverger, et un appelant ne peut plus en oublier un. Les STORES perdent l'entrée d'une jambe
// disparue (le plan qu'elle portait n'existe plus) ; les LOTS, jamais : le fret est réellement à
// bord. On leur retire seulement leur étiquette — ils restent en soute, visibles, vendables, mais
// rattachés à aucune jambe. Les recoller au pont A→C serait pire : sa cargaison est RECALCULÉE, le
// voyage prétendrait l'avoir chargée, et son vrai chargement deviendrait impossible.
// Le registre suit la même règle que les stores : la déduction d'une jambe disparue reste posée sur
// le rayon — le fret est parti avec, il n'est pas revenu — mais plus rien ne peut l'annuler, comme
// pour les lots qu'on vient de délier.
export function reindexerRangsJambe({ edits = {}, pins = {}, lots = [], chargements = {} }: PorteursDeRang, retrait: Retrait): Required<PorteursDeRang> {
  const decale = (store) => {
    const suivant = {};
    for (const [k, v] of Object.entries(store)) {
      const n = cleApresRetrait(k, retrait);
      if (n != null) suivant[n] = v;
    }
    return suivant;
  };
  return {
    edits: decale(edits),
    pins: decale(pins),
    chargements: decale(chargements),
    lots: lots.map((l) => {
      if (l.leg == null) return l;
      const n = cleApresRetrait(l.leg, retrait);
      return n === l.leg ? l : n != null ? { ...l, leg: n } : sansEtiquette(l);
    }),
  };
}

// Effacer le parcours DÉLIE les lots sans les débarquer : le parcours est un plan, la soute est du
// fret payé (ADR-002). Sans ça, un voyage ultérieur dont la jambe 0 relie les deux mêmes terminaux
// s'affichait « ⬢ à bord » et le clic déchargeait les lots de l'ancien — la résurrection déjà
// corrigée pour les manifestes édités, à laquelle les étiquettes avaient échappé.
export function detacherLotsDeJambe(lots: Lot[]): Lot[] {
  return lots.map((l) => (l.leg == null ? l : sansEtiquette(l)));
}

// ---------- Le REGISTRE des chargements : quelle jambe a pris quoi, et où ----------
// « Cette jambe est chargée » se DÉDUISAIT de la présence de ses lots en soute. Or la soute se vide
// par bien d'autres chemins que « annuler » — son ✕, une vente, la vente implicite du départ — et
// aucun ne rend quoi que ce soit au rayon. La jambe repassait donc à « ✓ chargé », le clic suivant
// redéduisait, et la valeur d'origine du rayon partait avec les lots qui la portaient (100 → 40 → 0).
// Le registre porte l'état EXPLICITEMENT, et il survit au fret : le fret peut quitter la soute, ce
// qu'on doit au rayon reste dû.
//
//   { "<rang>|<from>|<to>": [ { name, terminal, ref, units }, … ] }
//
// Une entrée = une jambe chargée, même avec zéro prise (rayon au stock inconnu : rien à déduire,
// mais la jambe est bel et bien engagée).
//
// `ref` est le stock du rayon AVANT toute déduction de jambe. C'est la TROISIÈME forme, la seule qui
// tienne avec DEUX chargements au même point :
//   - l'instantané absolu (« annuler rend les 100 d'avant ») efface la prise de l'autre jambe, et la
//     station reproprose un stock fantôme qui est toujours à bord ;
//   - le relatif (« stock effectif + units ») repart d'un chiffre que stockApres a pu écrêter à 0,
//     et rend alors au rayon plus qu'il n'a jamais annoncé ;
//   - la référence MOINS la somme des prises encore en cours tient dans les deux cas.

// Ce qu'un point d'achat doit annoncer : sa `ref` (null si plus aucune jambe n'y prend rien) et le
// total `pris` par les jambes encore chargées. `sauf` exclut une jambe — celle qu'on annule.
// La `ref` retenue est la PLUS GRANDE : deux prises au même point la partagent par construction,
// sauf après migration d'une soute ancienne où chaque lot portait le stock déjà amputé qu'il avait
// lu. La plus grande est alors la plus ancienne, donc ce que la station annonçait vraiment.
export function soldeDuPoint(chargements: Chargements | null, name: string, terminal: string, sauf: string | null = null): { ref: number | null; pris: number } {
  let ref = null, pris = 0;
  for (const [cle, prises] of Object.entries(chargements || {})) {
    if (cle === sauf || !Array.isArray(prises)) continue;
    for (const p of prises) {
      if (p.name !== name || p.terminal !== terminal || p.ref == null) continue;
      if (ref == null || p.ref > ref) ref = p.ref;
      pris += Math.max(0, Math.floor(p.units || 0));
    }
  }
  return { ref, pris };
}

export function poserChargement(chargements: Chargements, cle: string, prises: Prise[] | null): Chargements {
  return {
    ...chargements,
    [cle]: (prises || []).map((p) => ({ name: p.name, terminal: p.terminal, ref: p.ref, units: p.units })),
  };
}

export function retirerChargement(chargements: Chargements | null, cle: string): Chargements {
  const { [cle]: _parti, ...reste } = chargements || {};
  return reste;
}

// Une soute écrite AVANT le registre : l'état vivait dans la présence des lots, et le stock d'avant
// dans leur champ `avant`. On reconstruit le registre à partir d'eux — sans quoi une jambe déjà
// chargée repasserait à « ✓ chargé » au premier rechargement de page, chez un utilisateur qui n'a
// rien touché. Aucune correction n'est écrite : on ne fait que retrouver qui a pris quoi.
// `avant` est ensuite retiré des lots — le registre le porte, et deux sources divergeraient.
// Renvoie { chargements, lots, change } ; `change` faux = rien à persister.
export function migrerChargements(chargements: Chargements | null, lots: Lot[] | null): { chargements: Chargements; lots: Lot[]; change: boolean } {
  const connus = chargements || {};
  const source = lots || [];
  const ajout = {};
  let vieux = false;
  for (const l of source) {
    if ("avant" in l) vieux = true;
    if (l.leg == null || connus[l.leg]) continue; // le registre existant fait foi sur ses jambes
    const prises = ajout[l.leg] || (ajout[l.leg] = []);
    if (l.avant == null) continue;                // rien de déductible : la jambe est chargée, sans prise
    prises.push({ name: l.name, terminal: l.from, ref: l.avant, units: l.units || 0 });
  }
  const suivant = Object.keys(ajout).length ? { ...connus, ...ajout } : connus;
  return {
    chargements: suivant,
    lots: vieux ? source.map((l) => { const { avant: _a, ...reste } = l; return reste; }) : source,
    change: vieux || suivant !== connus,
  };
}

// Déplace la position courante (bornée à 0..legs.length).
export function setJourneyPosition(journey: Parcours, i: number): Parcours {
  return { ...journey, current: Math.max(0, Math.min(journey.legs.length, i | 0)) };
}
// Jambe courante (stations[current] -> [current+1]), ou null si on est à la dernière station.
export function currentLeg(journey: Parcours | null): Jambe | null {
  return journey && journey.current < journey.legs.length ? journey.legs[journey.current] : null;
}
// Profit total du parcours = somme des marges (les unités sont décidées ailleurs par vue).
export function journeyMargin(journey: Parcours | null): number {
  return journey ? journey.legs.reduce((a, l) => a + (l.margin || 0), 0) : 0;
}

// ---------- La soute : ce qui est à bord, et ce qu'on l'a payé (cf. ADR-002) ----------
// Une LIGNE PAR LOT. La même commodité peut y figurer plusieurs fois, à des prix différents : la
// moyenne pondérée était plus simple, les lots sont justes. Chaque lot :
//   { name, units, paid, from, at }   `paid` = prix d'achat au SCU, `at` = horodatage du chargement
//
// `paid` est la SEULE donnée de marché que le dépôt persiste volontairement. Ailleurs la règle est
// stricte — on ne garde que l'intention, jamais un instantané de prix, parce qu'un prix figé
// continuerait de s'afficher longtemps après qu'UEX l'ait republié. `paid` y échappe parce que ce
// n'est pas un prix affiché : c'est le montant d'une transaction qui a eu lieu. Il ne vieillit pas.

// Charge un manifeste dans la soute : un lot par ligne, au prix que l'app venait d'afficher.
// Les lignes sans quantité ne créent pas de lot (on n'a rien chargé), et une ligne déjà à bord
// (`aBord`) n'est pas rechargée — elle ne fait que traverser le manifeste.
export function loadHold(hold: Lot[], lignes: LigneManifeste[], from: string, at: number): Lot[] {
  const lots = lignes
    .filter((l) => (l.units || 0) > 0 && !l.aBord)
    .map((l) => ({ name: l.name, units: l.units, paid: l.buyPrice || 0, from: from || "", at: at || 0 }));
  return hold.concat(lots);
}

// La DEUXIÈME entrée de la soute, et la seule qui ne suppose ni voyage, ni jambe, ni manifeste :
// « j'ai ça à bord ». C'est le repli que l'option D d'ADR-002 réservait aux cargaisons que l'app
// n'a PAS calculées — butin ramassé, vaisseau rangé plein, achat fait hors du site.
//
// Le lot produit a exactement la forme de ceux de `loadHold`, à deux absences près, et ce sont
// elles le contrat :
//   - AUCUNE clé `leg`. Rien ne l'a chargé, donc aucune jambe ne peut s'en dire responsable :
//     l'annulation d'une jambe (`l.leg !== k`) ne l'emporte pas, `detacherLotsDeJambe` et
//     `reindexerRangsJambe` le rendent tel quel, et `migrerChargements` ne lui invente pas
//     d'entrée au registre. `leg: null` aurait d'ailleurs fait l'affaire pour les quatre — vérifié,
//     `null !== "0|A|B"` conserve bien le lot. On ne le pose pas pour être cohérent avec
//     `sansEtiquette`, qui SUPPRIME la clé : un lot détaché de sa jambe n'en a déjà plus, un lot
//     déclaré ne doit pas s'en distinguer par une clé vide.
//   - `from` VIDE. Il n'a été pris à aucun rayon que l'app connaisse, et c'est ce qui interdit
//     toute déduction de stock : les déductions se lisent dans le registre, que ce lot n'atteint
//     jamais. Déduire ici serait inventer un achat.
//
// `paid` omis vaut 0 — du butin n'a rien coûté (ADR-002 : « butin offert d'un clic »). Un prix
// NÉGATIF est ramené à 0 : un achat ne rapporte pas d'argent, le pire cas est le coût nul.
// Sans nom ou sans quantité, on rend la MÊME soute : l'identité dit « rien n'a bougé », et
// l'appelant y rend la main sans écrire — même convention que `storeFromHold`.
export function declarerLot(hold: Lot[], { name, units, paid }: { name?: string; units?: number; paid?: number } = {}, at: number = 0): Lot[] {
  const nom = typeof name === "string" ? name.trim() : "";
  const scu = Math.floor(Number(units) || 0);
  if (!nom || scu <= 0) return hold;
  return hold.concat([{ name: nom, units: scu, paid: Math.max(0, Number(paid) || 0), from: "", at: at || 0 }]);
}

// SCU à bord, toutes commodités confondues — donc la place qu'il reste pour charger.
export const holdScu = (hold: Lot[]): number => hold.reduce((s, l) => s + (l.units || 0), 0);
export const freeCargo = (hold: Lot[], cargo: number): number => Math.max(0, (cargo || 0) - holdScu(hold));

// Regroupe les lots par commodité, pour l'affichage : un total, et le détail dessous.
// `paidMoyen` n'est calculé QUE pour l'affichage — les ventes, elles, consomment lot par lot.
export function holdByCommodity(hold: Lot[]): GroupeSoute[] {
  const par = new Map();
  hold.forEach((l, i) => {
    if (!par.has(l.name)) par.set(l.name, { name: l.name, units: 0, invest: 0, lots: [] });
    const g = par.get(l.name);
    g.units += l.units || 0;
    g.invest += (l.units || 0) * (l.paid || 0);
    g.lots.push({ ...l, i });
  });
  return [...par.values()]
    .map((g) => ({ ...g, paidMoyen: g.units > 0 ? g.invest / g.units : 0 }))
    .sort((a, b) => b.invest - a.invest); // le capital le plus engagé d'abord
}

// Vend `units` SCU d'une commodité au prix `price`. FIFO : le lot le plus ancien part en premier.
// Retenu parce que déterministe et explicable ; « le plus cher d'abord » gonflerait le profit
// affiché sans rien changer à la réalité, et choisir à chaque vente coûterait une décision pour
// un gain nul. Le rendu affiche quel lot part, donc rien ne se décide en silence.
// Renvoie { hold, vendu, recette, cout, profit, lots } — `lots` détaille ce qui a été consommé.
// `at` (nom de station, optionnel) : les lots qu'une vente partielle a laissés à bord ICI portent
// `refuse: <station>` et sont alors SAUTÉS. C'est ce qui protège le résidu de la vente implicite
// déclenchée en avançant d'une étape. Un geste EXPLICITE, lui, ne passe pas `at` et vend quand
// même : l'intention de l'utilisateur prime toujours sur un marqueur posé plus tôt.
export function sellFromHold(hold: Lot[], name: string, units: number, price: number, at: string | null = null, nowSec: number = Date.now() / 1000): VenteSoute {
  let reste = Math.max(0, Math.floor(units || 0));
  const suivant = [], consommes = [];
  let vendu = 0, cout = 0;
  for (const l of hold) {
    if (l.name !== name || reste <= 0 || (at && refusActif(l, at, nowSec))) { suivant.push(l); continue; }
    const pris = Math.min(l.units || 0, reste);
    if (pris <= 0) { suivant.push(l); continue; }
    reste -= pris; vendu += pris; cout += pris * (l.paid || 0);
    consommes.push({ name: l.name, units: pris, paid: l.paid || 0, from: l.from });
    if ((l.units || 0) > pris) suivant.push({ ...l, units: l.units - pris }); // le lot survit, entamé
  }
  const recette = vendu * (price || 0);
  return { hold: suivant, vendu, recette, cout, profit: recette - cout, lots: consommes };
}

// Ce qu'il reste en rayon après avoir chargé `units`. Charger, c'est vider d'autant : sans ça, la
// station continue d'annoncer un stock qu'on vient d'emporter, et le manifeste suivant le reproposte.
//
// JAMAIS NÉGATIF. Avoir pris plus que le stock publié ne signifie pas que la station nous en doit :
// ça signifie que le relevé était faux — d'un achat par un autre joueur, ou d'un export UEX en
// retard. Le seul fait dont on soit sûr est qu'il n'en reste plus, donc zéro.
// `null` en entrée (capacité inconnue) ressort `null` : on ne déduit pas d'un chiffre qu'on n'a pas.
// En pratique les 494 points d'achat de l'instantané publient tous leur stock, mais la vente, elle,
// ne le fait que dans 15,6 % des cas — la fonction sert aussi là.
export function stockApres(stock: number | null, units: number): number | null {
  if (stock == null) return null;
  return Math.max(0, stock - Math.max(0, Math.floor(units || 0)));
}

// Marque le reste d'une commodité comme REFUSÉ à cette station : le comptoir n'en a pas voulu.
// Sans ce marqueur, avancer d'une étape — qui vaut « j'ai tout vendu ici » — effacerait le résidu
// au moment exact où il devient le sujet.
//
// Le marqueur est DATÉ, et c'est tout le sujet de #20. Un comptoir n'est plein que sur son shard et
// à cet instant : en changeant de shard, ou simplement dix minutes plus tard, le même terminal en
// reprend. La saturation observée est donc périssable, exactement comme un stock — et la même
// information saisie à la main dans la vue Corrections périmait déjà en 3 h. Sans date ici, le
// refus était éternel : deux durées de vie pour un seul fait, dont l'une n'avait été décidée par
// personne.
export function refuseHere(hold: Lot[], name: string, station: string, at: number = Date.now() / 1000): Lot[] {
  return hold.map((l) => (l.name === name ? { ...l, refuse: station, refuseAt: at } : l));
}

// Ce lot est-il encore protégé à cette station ? UNE règle, consultée par les deux chemins de vente
// — sinon ils divergent, ce qui est précisément le défaut qu'on corrige.
// Réemploie `DUREE_VOL`, l'horloge des volumes corrigés : le refus décrit le même phénomène (« ce
// comptoir ne prend plus »), il n'a aucune raison de vieillir autrement.
export function refusActif(lot: Lot | null, station: string, nowSec: number = Date.now() / 1000, dureeVol: number = DUREE_VOL): boolean {
  if (!lot || lot.refuse !== station) return false;
  // Marqueur sans date : hérité d'avant #20. `migrerRefus` les date au chargement ; si l'un passe
  // malgré tout, on le tient pour périmé plutôt qu'éternel — un refus d'âge inconnu ne prouve rien.
  if (!(lot.refuseAt > 0)) return false;
  return nowSec - lot.refuseAt <= dureeVol;
}

// Date les marqueurs hérités d'avant #20, au chargement de la soute. Sans cette passe ils seraient
// tous tenus pour périmés d'un coup (voir `refusActif`) et un résidu volontairement gardé pourrait
// partir à la première étape franchie. On leur offre donc une fenêtre pleine à partir de
// maintenant : c'est le seul choix qui ne perd rien.
// Renvoie { hold, migres } — `migres` vaut 0 quand il n'y avait rien à faire, ce qui permet à
// l'appelant de n'écrire dans localStorage que s'il le faut.
export function migrerRefus(hold: Lot[] | null, nowSec: number = Date.now() / 1000): { hold: Lot[]; migres: number } {
  let migres = 0;
  const suivant = (hold || []).map((l) => {
    if (!l || !l.refuse || l.refuseAt > 0) return l;
    migres++;
    return { ...l, refuseAt: nowSec };
  });
  return { hold: migres ? suivant : hold, migres };
}

// Prix et capacité d'une commodité à un terminal donné, corrections appliquées. null si ce
// terminal ne la reprend pas. `demand` peut valoir null : capacité INCONNUE, ce qui n'est ni zéro
// ni l'infini — 84 % des points de vente sont dans ce cas.
export function sellableAt(market: Marche, terminalIdx: number, name: string, resolve: Resolveur | null): VenteAuTerminal | null {
  const c = market.commodities.find((x) => x.name === name);
  if (!c) return null;
  const s = c.sells.find((x) => x[0] === terminalIdx);
  if (!s) return null;
  const t = market.terminals[terminalIdx];
  const e = resolve ? resolve(name, t.name, "sell", s[1], s[2], s[3]) : { price: s[1], vol: s[2] };
  return { price: e.price, demand: e.vol, terminal: t.name };
}

// Vend à ce terminal TOUT ce que la soute peut y écouler — c'est la vente implicite : quitter une
// escale sous-entend qu'on y a fait son affaire. Ce qu'une vente partielle y a explicitement laissé
// (`refuse`) traverse l'étape intact. Renvoie { hold, ventes, recette, cout, profit }.
export function sellAllAt(hold: Lot[], market: Marche, terminalIdx: number, resolve: Resolveur | null, nowSec: number = Date.now() / 1000): VenteEtape {
  const t = market.terminals[terminalIdx];
  if (!t) return { hold, ventes: [], recette: 0, cout: 0, profit: 0 };
  let courant = hold;
  const ventes = [];
  let recette = 0, cout = 0;
  for (const nom of [...new Set(hold.map((l) => l.name))]) {
    const pt = sellableAt(market, terminalIdx, nom, resolve);
    if (!pt) continue; // ce terminal ne reprend pas cette commodité : elle reste à bord
    const dispo = courant.reduce((s, l) => s + (l.name === nom && !refusActif(l, t.name, nowSec) ? l.units || 0 : 0), 0);
    if (dispo <= 0) continue;
    const r = sellFromHold(courant, nom, dispo, pt.price, t.name, nowSec);
    if (!r.vendu) continue;
    courant = r.hold;
    recette += r.recette; cout += r.cout;
    ventes.push({ name: nom, units: r.vendu, price: pt.price, recette: r.recette, cout: r.cout, profit: r.profit, lots: r.lots });
  }
  return { hold: courant, ventes, recette, cout, profit: recette - cout };
}

// OÙ ÉCOULER ce qui reste à bord. Dual de `manifestsFrom` : celui-ci remplit la soute par marge
// décroissante, celui-là la VIDE par valeur décroissante, plafonné par la demande.
//
// Le fait qui commande tout, et qui n'est PAS la symétrie qu'on attendrait : 494 points d'achat sur
// 494 publient leur stock (100 %), contre 293 points de vente sur 1 879 (15,6 %) pour la demande.
// `fillCargo` travaille donc sur une donnée complète ; son dual travaille sur une donnée absente
// quatre fois sur cinq. Ce n'est pas le même problème retourné.
// Pour ces 84 %, `demand` vaut null — ni zéro, ni l'infini. On rend donc DEUX chiffres par
// destination, jamais un seul : `absorbe` (optimiste, l'inconnu prend tout) et `garanti`
// (pessimiste, l'inconnu ne prend rien). Le classement suit l'optimiste, et `certitude` dit sur
// quoi il repose — afficher un plafond avec assurance quand la donnée ne le permet pas serait
// exactement le défaut qui a rendu cette fonction nécessaire.
//
// LE CLASSEMENT PORTE SUR LE PROFIT — ce que ça rapporte une fois le prix d'achat déduit, quitte à
// être NÉGATIF. L'argument inverse (le prix payé est un coût coulé, donc seul l'encaissement
// compte) est juste en comptabilité et faux ici, parce qu'il suppose que VIDER LA SOUTE est
// l'objectif. Ce n'est pas l'objectif : gagner de l'argent l'est. Écouler 671 SCU à forte marge en
// gardant 1 499 SCU revendables ailleurs rapporte plus que solder les 2 170 à marge nulle — et le
// résidu a 15 débouchés en médiane, donc il repart.
// L'encaissement reste calculé et rendu (`encaisse`), il n'ordonne simplement rien. `sousLePrixPaye`
// et `aPerte` disent franchement quand une destination fait perdre de l'argent.
//
// La priorité posée (« la commodité qui rapporte le plus ») joue au CLASSEMENT et non au partage :
// la demande d'une station est par commodité, les résidus ne se disputent donc rien. La « reine »
// est celle qui RAPPORTE le plus — units × meilleur prix atteignable — et non celle qui a coûté le
// plus cher : `holdByCommodity` trie par capital engagé, ce qui est un autre critère.
// `opts` (ADR-007) : la tournée d'écoulement PARAMÈTRE cette fonction au lieu de la dupliquer —
// deux fonctions entretiendraient deux classements divergents, exactement le défaut que le dépôt
// corrige ailleurs. Deux réglages, et les deux défauts sont ceux d'« où écouler » :
//   `inclureOrigine` — le terminal de départ est écarté ici (« où écouler AILLEURS »), ce qui est
//     faux pour une tournée : la station où l'on se trouve peut être le meilleur premier arrêt, à
//     coût de déplacement nul — on vient justement d'y ramasser le butin ;
//   `comparer` — le tri par profit reste le défaut ; la tournée injecte son tri par couverture.
export function offloadPlan(market: Marche, hold: Lot[], originIdx: number, f: Filtres = {}, resolve: Resolveur | null = null, autoloadFor: TarifTerminal | null = null, limit: number = 6, opts: OptionsEcoulement = {}): Destination[] {
  if (!hold || !hold.length) return [];
  const inclureOrigine = !!opts.inclureOrigine;
  const origine = market.terminals[originIdx];
  const parNom = holdByCommodity(hold);
  // La reine : celle qui rapporte le plus, au meilleur prix qu'on puisse en tirer quelque part.
  let reine = null, reineValeur = -1;
  for (const g of parNom) {
    const c = market.commodities.find((x) => x.name === g.name);
    if (!c) continue;
    let meilleur = 0;
    for (const sv of c.sells) {
      const t = market.terminals[sv[0]];
      if (!t || (sv[0] === originIdx && !inclureOrigine)) continue;
      const e = resolve ? resolve(g.name, t.name, "sell", sv[1], sv[2], sv[3]) : { price: sv[1] };
      if (e.price > meilleur) meilleur = e.price;
    }
    const v = g.units * meilleur;
    if (v > reineValeur) { reineValeur = v; reine = g.name; }
  }
  const out = [];

  market.terminals.forEach((t, idx) => {
    if (idx === originIdx && !inclureOrigine) return;                // on y est déjà
    if (f.noOutpost && t.outpost) return;
    if (f.sameOnly && origine && t.system !== origine.system) return;
    if (f.sysFilter && t.system !== f.sysFilter) return;

    const lignes = [];
    let scu = 0, garanti = 0, profit = 0, encaisse = 0, scuReine = 0, inconnues = 0, aPerte = false;
    for (const g of parNom) {
      const c = market.commodities.find((x) => x.name === g.name);
      if (!c) continue;
      const s = c.sells.find((x) => x[0] === idx);
      if (!s) continue;                                              // ce terminal n'en veut pas
      if (!pairEligible(f, c, t, s[3], s[3])) continue;
      const e = resolve ? resolve(g.name, t.name, "sell", s[1], s[2], s[3]) : { price: s[1], vol: s[2] };
      if (!(e.price > 0)) continue;
      // Statut UEX 7 = « saturé ». Mesuré sur l'instantané : les 12 points de statut 7 ont TOUS une
      // capacité publiée à 0, et réciproquement — équivalence parfaite dans les deux sens. C'est le
      // seul zéro fiable de tout le jeu de données. On s'en sert là où la capacité n'est PAS
      // publiée : sans ça, un comptoir saturé passerait pour « inconnu », donc pour « il prend
      // tout » — le pire contresens possible ici. Une correction locale, elle, prime toujours :
      // l'utilisateur a vu le comptoir de ses yeux.
      if (s[4] === 7 && e.vol == null) continue;
      const connue = e.vol != null;
      const prend = connue ? Math.min(g.units, e.vol) : g.units;     // optimiste
      if (prend <= 0) continue;                                      // capacité connue et nulle : saturé
      // Le coût vient des LOTS réellement consommés (FIFO), pas d'une moyenne : c'est la seule
      // façon d'annoncer un profit qui se réalisera tel quel.
      const sim = sellFromHold(hold, g.name, prend, e.price);
      const frais = autoloadFor ? lineHaulFee(prend, { acquired: true }, { buy: null, sell: autoloadFor(t) }) : 0;
      const recette = prend * e.price - frais;
      lignes.push({
        name: g.name, absorbe: prend, garanti: connue ? prend : 0, reste: g.units - prend,
        price: e.price, demand: e.vol, connue, profit: sim.profit - frais, encaisse: recette,
        // Vendre sous le prix payé reste parfois le bon choix (libérer la soute), mais ça ne doit
        // jamais passer inaperçu : le classement, lui, ignore le coût coulé.
        sousLePrixPaye: prend > 0 && sim.cout > prend * e.price,
      });
      scu += prend; garanti += connue ? prend : 0; profit += sim.profit - frais; encaisse += recette;
      if (g.name === reine) scuReine += prend;
      if (sim.cout > prend * e.price) aPerte = true;
      if (!connue) inconnues++;
    }
    if (!lignes.length) return;
    lignes.sort((a, b) => b.profit - a.profit);
    out.push({
      idx, terminal: t.name, system: t.system, planet: t.planet, outpost: t.outpost,
      cross: !!origine && t.system !== origine.system,
      lignes, scu, garanti, profit, encaisse, scuReine, reine, aPerte,
      certitude: inconnues === 0 ? "connue" : inconnues === lignes.length ? "inconnue" : "partielle",
      reste: holdScu(hold) - scu,
    });
  });

  // Profit d'abord ; à égalité, celle qui écoule le plus de la reine — un booléen « solde-t-elle la
  // reine ? » abandonnerait la priorité dans tous les cas où AUCUNE destination ne la solde.
  return out
    .sort(opts.comparer || ((a, b) => b.profit - a.profit || b.scuReine - a.scuReine || b.garanti - a.garanti))
    .slice(0, limit);
}

// ---------- La tournée d'écoulement (ADR-007, #57) ----------
// « Comment me débarrasser d'une soute que je ne veux plus porter ? » — l'autre question, celle
// qu'`offloadPlan` ne pose PAS. Lui demande « combien puis-je en tirer » et classe par profit ;
// ici le fret est déjà à bord, le coût est coulé, et ce qui compte est le NOMBRE D'ARRÊTS.
// Un comptoir qui reprend trois commodités à prix moyen bat donc un comptoir qui n'en reprend
// qu'une au meilleur prix. Les deux vues coexistent parce que les deux questions sont
// incompatibles — un seul classement ne peut pas servir les deux.

// Le choix d'un arrêt : couverture d'abord (c'est elle qui réduit les arrêts À VENIR), puis on
// préfère rester dans le système, puis le volume, puis l'argent. L'argent ne départage qu'en
// dernier, et c'est l'ENCAISSEMENT, pas le profit : le prix payé est coulé et identique quelle que
// soit la destination — sur une soute mixte, le profit comparerait des bases de coût hétérogènes
// et pénaliserait la ligne réellement achetée, donc la destination qui l'écoule.
const parCouverture = (a: Destination, b: Destination): number =>
  b.lignes.length - a.lignes.length ||
  (a.cross === b.cross ? 0 : a.cross ? 1 : -1) ||
  b.scu - a.scu ||
  b.encaisse - a.encaisse;

// Agrège une suite d'arrêts. `certitude` vaut « connue » seulement si TOUS les arrêts le sont :
// 16,3 % des points de vente publient leur capacité, donc un total est presque toujours un pari.
function bilanTournee(arrets: Destination[], reste: Lot[], sansDebouche: SansDebouche[]): Tournee {
  const somme = (cle) => arrets.reduce((s, a) => s + a[cle], 0);
  const connus = arrets.filter((a) => a.certitude === "connue").length;
  return {
    arrets, reste, sansDebouche,
    resteScu: holdScu(reste),
    scu: somme("scu"), garanti: somme("garanti"),
    encaisse: somme("encaisse"), profit: somme("profit"),
    sauts: arrets.filter((a) => a.cross).length,
    certitude: !arrets.length || connus === arrets.length ? (arrets.length ? "connue" : "inconnue")
      : connus === 0 ? "inconnue" : "partielle",
  };
}

// Glouton par couverture maximale, rejoué après chaque arrêt. C'est SET COVER (Karp, 1972),
// inapproximable en deçà de (1−o(1))·ln n sauf si P = NP (Feige, 1998) — et le glouton par
// couverture maximale atteint EXACTEMENT cette borne. Ce n'est pas un pis-aller : c'est l'optimum
// de ce qu'on peut espérer en temps polynomial. À 7 lignes, ln(7) ≈ 1,95.
// L'autre moitié du problème — ordonner les arrêts choisis — est dégénérée ici : sans matrice de
// distances (aucune coordonnée dans market.json, 161 routes sur 316 portant une distance), il n'y
// a rien à ordonner. Tout le NP-difficile est dans le CHOIX des comptoirs.
export function tourneeEcoulement(market: Marche, hold: Lot[], originIdx: number, f: Filtres = {}, resolve: Resolveur | null = null, autoloadFor: TarifTerminal | null = null, opts: OptionsTournee = {}): Tournee {
  const maxArrets = opts.maxArrets || 5;
  const tous = market.terminals.length; // jamais de `limit` ici : on filtre nous-mêmes, après
  // Les lignes qui ne s'écoulent NULLE PART dans la portée, sorties du calcul avant la boucle et
  // nommées : sinon on annonce une soute vidée qui ne l'est pas. On les déduit d'un `offloadPlan`
  // complet plutôt que d'une seconde règle d'éligibilité — deux règles finiraient par diverger.
  const portee = offloadPlan(market, hold, originIdx, f, resolve, autoloadFor, tous, { inclureOrigine: true });
  const ecoulables = new Set(portee.flatMap((d) => d.lignes.map((l) => l.name)));
  const sansDebouche = holdByCommodity(hold)
    .filter((g) => !ecoulables.has(g.name))
    .map((g) => ({ name: g.name, units: g.units }));

  const arrets = [], vus = new Set();
  let h = hold, ici = originIdx;
  while (holdScu(h) > 0 && arrets.length < maxArrets) {
    const cands = offloadPlan(market, h, ici, f, resolve, autoloadFor, tous, {
      inclureOrigine: !arrets.length, comparer: parCouverture,
    }).filter((d) => !vus.has(d.idx));
    // Un premier arrêt imposé sert à dérouler les alternatives : on ne force que le tout premier.
    const best = !arrets.length && opts.premierForce != null
      ? cands.find((d) => d.idx === opts.premierForce)
      : cands[0];
    if (!best) break; // plus rien d'écoulable : on sort avec ce qui reste, et on le dit
    // PAS `sellAllAt` : il ignore la capacité ET les filtres de vue (mesuré). Le résidu se
    // construit ligne par ligne, sur `absorbe`, qu'offloadPlan a déjà plafonné.
    h = best.lignes.reduce((acc, l) => sellFromHold(acc, l.name, l.absorbe, l.price).hold, h);
    arrets.push(best);
    vus.add(best.idx); // on ne repasse jamais deux fois : la recharge par ticks n'est pas modélisable
    ici = best.idx;
  }
  return bilanTournee(arrets, h, sansDebouche);
}

// La tournée retenue, et la meilleure « à un arrêt de plus » — affichée avec son écart chiffré.
// L'ordre lexicographique est STRICT (la plus courte gagne toujours) : un seuil serait un paramètre
// invérifiable, l'app ne sachant ni si tu as le temps, ni si c'est sur ton chemin. Montrer les deux
// rend l'arbitrage à qui a le contexte.
// L'alternative se cherche en FORÇANT un autre premier arrêt, puis en déroulant le même glouton :
// borné à `k` essais, c'est le faisceau étroit de l'ADR, appliqué au seul endroit qui en a besoin.
export function tourneesEcoulement(market: Marche, hold: Lot[], originIdx: number, f: Filtres = {}, resolve: Resolveur | null = null, autoloadFor: TarifTerminal | null = null, opts: OptionsTournee = {}): { tournee: Tournee; alternative: Tournee | null } {
  const tournee = tourneeEcoulement(market, hold, originIdx, f, resolve, autoloadFor, opts);
  const k = opts.k || 3;
  const premiers = offloadPlan(market, hold, originIdx, f, resolve, autoloadFor, market.terminals.length,
    { inclureOrigine: true }) // par PROFIT : c'est là que se cachent les tournées plus payantes
    .filter((d) => d.idx !== (tournee.arrets[0] || {}).idx)
    .slice(0, k);

  let alternative = null;
  for (const d of premiers) {
    const t = tourneeEcoulement(market, hold, originIdx, f, resolve, autoloadFor, { ...opts, premierForce: d.idx });
    // « Un arrêt de plus », et pas deux : au-delà, ce n'est plus la même question.
    if (t.arrets.length !== tournee.arrets.length + 1) continue;
    if (t.resteScu > tournee.resteScu) continue;          // elle doit au moins vider autant
    if (t.encaisse <= tournee.encaisse) continue;          // et rapporter plus, sinon elle n'a aucun sens
    if (!alternative || t.encaisse > alternative.encaisse) alternative = t;
  }
  if (alternative) {
    alternative.ecart = alternative.encaisse - tournee.encaisse;
    alternative.ecartPct = tournee.encaisse > 0 ? (alternative.ecart / tournee.encaisse) * 100 : null;
  }
  return { tournee, alternative };
}

// Dépose des SCU à une station : ils quittent la soute SANS être vendus. Troisième sortie du fret,
// et souvent la bonne quand le seul débouché est saturé — on libère la place sans vendre à perte.
// Renvoie { hold, entrepots } ; les lots déposés gardent leur prix payé, c'est du capital immobilisé.
//
// `at` = horodatage du DÉPÔT (epoch en secondes), INJECTÉ comme celui de `loadHold` : une fonction
// pure ne lit pas l'horloge. Le lot le porte sous `deposeAt` — un nom à lui, distinct du `at` de
// chargement que `sellFromHold` laisse tomber en reconstruisant les lots consommés. Sans cette date,
// une liste « j'ai laissé 170 SCU d'or à Ruin Station » ne dit pas si c'était hier ou il y a trois
// patchs. Absente (0), elle s'exporte « date inconnue » : on n'invente pas celle du jour.
export function storeFromHold(hold: Lot[], entrepots: Entrepots, name: string, units: number, station: string, at?: number): { hold: Lot[]; entrepots: Entrepots } {
  const r = sellFromHold(hold, name, units, 0); // même consommation FIFO, sans recette
  if (!r.vendu) return { hold, entrepots };
  const deja = entrepots[station] || [];
  const deposes = r.lots.map((l) => ({ ...l, deposeAt: at || 0 }));
  return { hold: r.hold, entrepots: { ...entrepots, [station]: deja.concat(deposes) } };
}

// Reprend `units` SCU d'une commodité DÉPOSÉE à une station : elle repasse en soute avec son prix
// payé intact. Duale exacte de storeFromHold — un dépôt suivi d'une reprise doit rendre la soute
// d'avant, sinon le capital immobilisé devient un capital perdu, et déposer redevient un piège.
// Un lot d'entrepôt a la forme d'un lot de soute : sellFromHold sait donc déjà les consommer en
// FIFO, à recette nulle — reprendre n'est pas une vente, c'est le dépôt joué à l'envers.
// La station vidée DISPARAÎT plutôt que de laisser un entrepôt à zéro : il s'afficherait comme un
// lieu où l'on a du fret.
//
// La date du dépôt (`deposeAt`) NE REMONTE PAS avec le lot, et ce n'est pas un oubli : reprendre
// n'est pas acheter. `sellFromHold` reconstruit les lots consommés en { name, units, paid, from } —
// le lot rendu à la soute n'a donc ni `at` de chargement ni `deposeAt`, ce qui est exactement juste :
// il n'a pas été chargé maintenant, et il n'est plus déposé nulle part.
export function takeFromStore(hold: Lot[], entrepots: Entrepots, name: string, units: number, station: string): { hold: Lot[]; entrepots: Entrepots } {
  const stock = entrepots[station];
  if (!stock || !stock.length) return { hold, entrepots };
  const r = sellFromHold(stock, name, units, 0); // même consommation FIFO, sans recette
  if (!r.vendu) return { hold, entrepots };
  const suivant = { ...entrepots };
  if (r.hold.length) suivant[station] = r.hold; else delete suivant[station];
  return { hold: hold.concat(r.lots), entrepots: suivant };
}

// ---------- Carte 2D du parcours (cf. ADR-001) ----------
// Projection PURE d'un parcours en coordonnées de dessin. app.js n'a plus qu'à émettre du SVG.
// La géométrie vient de data/starmap.json : `au` (distance à l'étoile) et `lon` (degrés), relevés
// sur la starmap publiée par RSI. On ne dessine QUE des corps qui portent un terminal — c'est ce
// filtre, appliqué à la collecte, qui tient les systèmes du lore hors de la carte.
export const CARTE = { largeur: 680, hauteur: 296, marge: 26 };

// Ordre CANONIQUE des systèmes sur la carte, de gauche à droite (#42). Il ne vient pas de la
// donnée : les clés de data/starmap.json sont dans l'ordre `Pyro, Stanton, Nyx`, et s'y fier
// donnerait justement le mauvais. Il ne vient pas non plus du parcours — c'était le défaut : la
// même géographie se dessinait en miroir selon le sens du voyage, et on ne reconnaissait jamais
// la carte. Un système hors de cette liste n'est pas perdu, il se range après (voir rangCarte).
//
// À NE PAS CONFONDRE avec `ORDRE_SYSTEMES` (logic.mjs:1325), qui range le SÉLECTEUR de station par
// volume de terminaux — `["Stanton", "Pyro", "Nyx"]`, soit exactement l'inverse. Les deux ordres
// sont légitimes et ne fusionneront pas : une liste déroulante se parcourt du plus fourni au moins
// fourni, une carte se lit dans l'ordre où les systèmes sont posés dans l'espace.
const ORDRE_CARTE = ["Nyx", "Pyro", "Stanton"];
const rangCarte = (nom: string): number => {
  const i = ORDRE_CARTE.indexOf(nom);
  return i === -1 ? ORDRE_CARTE.length : i;
};

// Angle déterministe dérivé d'un nom : deux terminaux d'une même planète ne se superposent pas,
// et la carte ne bouge pas d'un rendu à l'autre (aucun hasard, donc aucun scintillement).
export function nameAngle(nom: string): number {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) % 360;
  return h;
}

// Les rayons réels s'étalent de 0,55 à 13 UA : à l'échelle, tout se tasserait sur l'étoile. On
// compresse par une racine — l'ORDRE et les écarts relatifs survivent, la lisibilité aussi.
// C'est le seul endroit où la carte s'écarte du réel, et c'est assumé (cf. ADR « schéma »).
const rayonRelatif = (au: number, auMax: number): number => 0.24 + 0.72 * Math.sqrt(Math.max(au, 0) / (auMax || 1));

// Position d'une ancre (corps ou passerelle) dans le disque de son système.
function posAncre(sys: SystemeCarte, ancre: Ancre): { x: number; y: number } {
  const rr = rayonRelatif(ancre.au, sys.auMax);
  const rad = (ancre.lon * Math.PI) / 180;
  return { x: sys.cx + Math.cos(rad) * rr * sys.r, y: sys.cy + Math.sin(rad) * rr * sys.r };
}

// Nom de la passerelle qui, DEPUIS `de`, mène vers `vers`. UEX les nomme « <destination> Gateway
// (<système courant>) » — le nom porte donc le lien, sans donnée supplémentaire.
export const nomPasserelle = (de: string, vers: string): string => `${vers} Gateway (${de})`;

// Projette le parcours. `stations` = journeyStations(journey) ; `infoTerminal(nom)` rend
// { system, planet } ou null ; `starmap` = data/starmap.json.
// Renvoie tout ce qu'il faut dessiner, en pixels du viewBox — jamais de HTML.
export function journeyMap(stations: Station[], current: number, starmap: Starmap, infoTerminal: InfoTerminal, enVol: boolean = false): Carte | null {
  if (!stations || !stations.length) return null;
  const { largeur, hauteur, marge } = CARTE;

  // Un disque par système TRAVERSÉ — et seulement ceux-là : on collecte d'abord, on trie ensuite.
  // Projeter sur les trois cases de l'ordre canonique laisserait un trou au milieu d'un parcours
  // Nyx -> Stanton, et le corridor ⚡ traverserait un disque inutilisé.
  const ordre = [];
  for (const s of stations) if (s.system && !ordre.includes(s.system)) ordre.push(s.system);
  if (!ordre.length) return null;
  // L'ordre de gauche à droite est CANONIQUE, jamais celui de la rencontre (#42) : sinon la même
  // géographie se dessine en miroir selon le sens du voyage. Le tri est STABLE (garanti par la
  // spec depuis ES2019), donc les systèmes inconnus — tous à rang égal — gardent entre eux
  // l'ordre du parcours au lieu d'être réordonnés au gré du moteur.
  ordre.sort((a, b) => rangCarte(a) - rangCarte(b));
  const n = ordre.length;
  const rayon = Math.min((largeur - marge * 2) / (n * 2.35), (hauteur - marge * 2) / 2);
  const systemes: DisqueSysteme[] = ordre.map((nom, i) => ({
    nom,
    cx: (largeur / n) * (i + 0.5),
    cy: hauteur / 2,
    r: rayon,
    corps: [],
  }));
  const parSysteme = new Map(systemes.map((s) => [s.nom, s]));

  // Les corps du système, aux vraies distances et longitudes.
  for (const sys of systemes) {
    const ancres = (starmap[sys.nom] && starmap[sys.nom].ancres) || {};
    const auMax = Math.max(...Object.values(ancres).map((a) => a.au), 1);
    sys.auMax = auMax;
    for (const [nom, a] of Object.entries(ancres)) {
      const rr = rayonRelatif(a.au, auMax);
      const rad = (a.lon * Math.PI) / 180;
      sys.corps.push({ nom, orbite: rr * sys.r, x: sys.cx + Math.cos(rad) * rr * sys.r, y: sys.cy + Math.sin(rad) * rr * sys.r });
    }
    sys.corps.sort((a, b) => a.orbite - b.orbite);
  }

  // Un arrêt se pose sur son corps parent — sa planète, ou lui-même s'il est une passerelle.
  // Sans corps connu (Levski et tout Nyx : UEX ne les rattache à rien), anneau externe. Cas
  // NOMINAL : 12 terminaux sur 114 sont dans ce cas.
  const rattache = stations.map((st) => {
    const info = infoTerminal(st.name) || {};
    const ancres = (starmap[st.system] && starmap[st.system].ancres) || {};
    const parent = ancres[st.name] ? st.name : (info.planet && ancres[info.planet] ? info.planet : null);
    return { nom: st.name, systeme: st.system, parent, sys: parSysteme.get(st.system) };
  });

  // Deux terminaux d'une MÊME planète (Rod's Fuel et Rat's Nest sont tous deux sur Pyro V) se
  // superposaient : un décalage tiré du nom ne garantit aucune distance minimale, et deux escales
  // à 6 px l'une de l'autre rendent la seconde inatteignable au clic. On répartit donc les escales
  // d'un même corps sur une couronne, à intervalles réguliers — déterministe, et jamais confondu.
  const grappes = new Map();
  rattache.forEach((a, i) => {
    const k = `${a.systeme}|${a.parent || "*"}`;
    if (!grappes.has(k)) grappes.set(k, []);
    grappes.get(k).push(i);
  });

  const borne = (v, max) => Math.max(marge * 0.4, Math.min(max - marge * 0.4, v));
  const arrets = rattache.map((a, i) => {
    const sys = a.sys;
    if (!sys) return { nom: a.nom, systeme: a.systeme, orphelin: true, x: largeur / 2, y: hauteur / 2 };
    const groupe = grappes.get(`${a.systeme}|${a.parent || "*"}`);
    const rang = groupe.indexOf(i), n = groupe.length;
    if (!a.parent) {
      // Orphelins : répartis sur l'anneau externe, à intervalles réguliers.
      const base = nameAngle(a.nom);
      const ang = ((n > 1 ? (360 / n) * rang : base) * Math.PI) / 180;
      return { nom: a.nom, systeme: a.systeme, orphelin: true, x: borne(sys.cx + Math.cos(ang) * sys.r * 1.06, largeur), y: borne(sys.cy + Math.sin(ang) * sys.r * 1.06, hauteur) };
    }
    const { x: bx, y: by } = posAncre(sys, starmap[a.systeme].ancres[a.parent]);
    // Couronne autour du corps : rayon suffisant pour que les cibles de clic (r = 11) ne se
    // touchent pas, angle de départ vers l'extérieur du système pour ne pas rentrer dans l'étoile.
    const couronne = n > 1 ? Math.max(13, 4 + 3.4 * n) : 7;
    const depart = Math.atan2(by - sys.cy, bx - sys.cx);
    const ang = depart + (n > 1 ? (2 * Math.PI * rang) / n : 0);
    return {
      nom: a.nom, systeme: a.systeme, parent: a.parent, orphelin: false,
      x: borne(bx + Math.cos(ang) * couronne, largeur), y: borne(by + Math.sin(ang) * couronne, hauteur),
    };
  });

  // Les jambes. Un SAUT ne se dessine pas comme un vol intra-système — et surtout il ne se dessine
  // pas en ligne droite : on ne passe pas d'un système à l'autre n'importe où. Le trajet réel
  // emprunte les DEUX passerelles, et la carte le montre en trois segments : départ -> passerelle
  // d'ici, corridor ⚡ entre les deux passerelles, passerelle de là-bas -> arrivée.
  const passerelles = (a, b) => {
    if (a.systeme === b.systeme) return [];
    const nomA = nomPasserelle(a.systeme, b.systeme), nomB = nomPasserelle(b.systeme, a.systeme);
    const sysA = parSysteme.get(a.systeme), sysB = parSysteme.get(b.systeme);
    const ancreA = (starmap[a.systeme] || {}).ancres || {}, ancreB = (starmap[b.systeme] || {}).ancres || {};
    // Une extrémité qui EST déjà la passerelle de son côté ne se réinsère pas — mais chaque côté se
    // décide SÉPARÉMENT : partir de la passerelle ne dispense pas de ressortir par celle d'en face,
    // parce qu'un saut débouche toujours de l'autre côté du tunnel. Les traiter d'un bloc coupait
    // « Stanton Gateway (Pyro) -> New Babbage » en ligne droite, sans Pyro Gateway (Stanton).
    const points = [];
    for (const [ici, sys, ancres, nom] of [[a, sysA, ancreA, nomA], [b, sysB, ancreB, nomB]]) {
      if (ici.nom === nom) continue;
      if (!sys || !ancres[nom]) return []; // géométrie absente : ligne droite
      points.push({ ...posAncre(sys, ancres[nom]), nom, systeme: ici.systeme, passerelle: true });
    }
    return points;
  };

  // Chaque segment est un ARC, et sa courbure suit le SENS du trajet : l'aller et le retour d'un
  // même couple bombent de part et d'autre au lieu de se superposer. C'est ce qui règle les
  // croisements d'un parcours qui revient sur ses pas, sans placement à la main.
  const segment = (p, q, saut, faite) => {
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(0.09 * d, 26);                       // flèche de l'arc, bornée
    const cx = (p.x + q.x) / 2 - (dy / d) * k, cy = (p.y + q.y) / 2 + (dx / d) * k;
    return {
      x1: p.x, y1: p.y, x2: q.x, y2: q.y, cx, cy, saut, faite,
      // Sur une quadratique, la tangente au milieu est parallèle à la corde : le chevron du sens
      // se pose donc au point milieu de la courbe, orienté par (q - p).
      fleche: { x: (p.x + 2 * cx + q.x) / 4, y: (p.y + 2 * cy + q.y) / 4, angle: (Math.atan2(dy, dx) * 180) / Math.PI },
    };
  };

  const jambes = [];
  for (let i = 1; i < arrets.length; i++) {
    const a = arrets[i - 1], b = arrets[i];
    const points = [a, ...passerelles(a, b), b];
    for (let j = 1; j < points.length; j++) {
      const p = points[j - 1], q = points[j];
      jambes.push(segment(p, q, p.systeme !== q.systeme, i <= current));
    }
  }

  // Le vaisseau, sur l'arrêt courant, orienté vers le suivant (ou depuis le précédent au bout).
  // `enVol` : la jambe courante est CHARGÉE, donc on n'est plus à quai — on est parti. Le vaisseau
  // se pose alors entre les deux escales. La carte cesse ainsi de montrer un itinéraire prévu pour
  // montrer où l'on en est réellement (cf. ADR-002).
  const i = Math.max(0, Math.min(current | 0, arrets.length - 1));
  const ici = arrets[i], suiv = arrets[i + 1], prec = arrets[i - 1];
  const vers = suiv || prec || ici;
  const angle = (Math.atan2(vers.y - ici.y, vers.x - ici.x) * 180) / Math.PI + (suiv ? 0 : 180);
  if (enVol && suiv) {
    return {
      largeur, hauteur, systemes, arrets, jambes,
      vaisseau: { x: (ici.x + suiv.x) / 2, y: (ici.y + suiv.y) / 2, angle, arret: i, enVol: true },
    };
  }
  // Un corps qui porte une escale n'a pas besoin de son propre libellé : le nom de l'escale est
  // juste à côté, et les deux se chevauchaient. Le rendu s'en sert pour ne pas l'écrire.
  const occupes = new Set(arrets.filter((a) => a.parent).map((a) => `${a.systeme}|${a.parent}`));
  for (const sys of systemes) for (const b of sys.corps) b.occupe = occupes.has(`${sys.nom}|${b.nom}`);

  return {
    largeur, hauteur, systemes, arrets, jambes,
    vaisseau: { x: ici.x, y: ici.y, angle: vers === ici ? 0 : angle, arret: i, enVol: false },
  };
}

// Encode un parcours en chaîne compacte auto-suffisante (pour localStorage / URL partageable).
// Chaque jambe -> tuple [from, fromSystem, to, toSystem, commodity, buyPrice, sellPrice, margin].
export function encodeJourney(journey: Parcours | null): string {
  if (!journey) return "";
  // Parcours « de zéro » : encode juste le point de départ.
  if (!journey.legs.length) return journey.start ? JSON.stringify({ c: 0, s: [journey.start.name, journey.start.system] }) : "";
  return JSON.stringify({
    c: journey.current,
    l: journey.legs.map((g) => [g.from, g.fromSystem, g.to, g.toSystem, g.commodity, g.buyPrice, g.sellPrice, g.margin]),
  });
}
// Reconstruit un parcours depuis la chaîne (null si vide/invalide). Robuste aux entrées malformées.
export function decodeJourney(str: string | null): Parcours | null {
  if (!str) return null;
  try {
    const p = JSON.parse(str);
    if (!p) return null;
    // Parcours « de zéro » : juste un point de départ.
    if (Array.isArray(p.s) && typeof p.s[0] === "string" && p.s[0]) {
      return { legs: [], current: 0, start: { name: p.s[0], system: String(p.s[1] ?? "") } };
    }
    // Le hash est PARTAGEABLE : son contenu vient donc potentiellement d'un tiers. On ne validait
    // que la forme du conteneur, si bien qu'un tuple vide ou mal typé produisait une jambe dont
    // `from`/`system` valaient `undefined` -> TypeError au rendu, et l'app entière tombait.
    if (!Array.isArray(p.l) || !p.l.length) return null;
    const jambeValide = (a) => Array.isArray(a) && typeof a[0] === "string" && a[0] && typeof a[2] === "string" && a[2];
    if (!p.l.every(jambeValide)) return null;
    const legs = p.l.map((a) => ({
      from: a[0], fromSystem: String(a[1] ?? ""), to: a[2], toSystem: String(a[3] ?? ""),
      commodity: String(a[4] ?? ""),
      buyPrice: Number(a[5]) || 0, sellPrice: Number(a[6]) || 0, margin: Number(a[7]) || 0,
    }));
    // `| 0` tronquait sur 32 bits : un `c` géant devenait négatif au lieu d'être borné.
    const c = Math.trunc(Number(p.c)) || 0;
    return { legs, current: Math.max(0, Math.min(legs.length, c)) };
  } catch {
    return null;
  }
}

// ---------- Exports datés : entrepôts et corrections (cf. ADR-006) ----------
// Deux sorties, un seul format, décidé une fois pour les deux : ISO 8601 UTC à la seconde et
// en-tête versionné. Les traiter séparément aurait fait diverger deux formats de date dans le même
// dépôt, et une correction périme ici PAR SA DATE — deux façons de l'écrire, c'est deux façons de
// se tromper en la relisant.
//
// Le format seulement : où va le texte ne regarde pas ce module. Voir ADR-006 §3.
export const FORMAT_EXPORT = 1;

// Une date, écrite pour être relue sur une autre machine, dans un autre fuseau, des mois plus tard.
// `null` quand la date n'existe pas — JAMAIS l'heure courante en remplacement : c'est la règle
// commune aux deux exports, et le seul moyen de distinguer « déposé hier » de « je n'en sais rien ».
export function isoUTC(sec: number | null | undefined): string | null {
  const n = Number(sec);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  // TRONQUÉE, pas arrondie : la seconde PENDANT laquelle le geste a eu lieu. Arrondir daterait un
  // dépôt de 20:13:20,7 à 20:13:21, une seconde après qu'il s'est produit.
  return new Date(Math.floor(n) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function secDepuisISO(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round(t / 1000) : null;
}
// En-tête commun aux deux sorties : le numéro de format d'abord (sans lui, la première évolution
// casse tous les fichiers déjà émis), la date d'émission ensuite.
export const enteteExport = (type: string, nowSec: number): EnteteExport => ({ v: FORMAT_EXPORT, type, emis: isoUTC(nowSec) });

// Séparateur de milliers DÉTERMINISTE (espace simple). `toLocaleString("fr-FR")` aurait fait
// l'affaire à l'écran, mais son séparateur dépend de l'ICU embarquée : un export comparé en test
// deviendrait vert ou rouge selon la build de Node. Un export doit être reproductible.
const milliers = (n: number): string => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// L'export des corrections : un OBJET sérialisable, parce que celui-ci est fait pour être relu par
// la machine (cf. relireCorrections) autant que par un humain.
// UNE ENTRÉE PAR CHAMP corrigé : une même clé peut porter un prix ET un volume, et les deux ne
// portent pas la même date de saisie. Deux dates par entrée, qui ne disent pas la même chose :
//   `saisi` = quand JE l'ai corrigée (`saisiPrix` pour un prix, `pris` pour un volume) ;
//   `base`  = la date UEX du point CONTRE laquelle la correction vaut.
// Seules les clés à TROIS segments sortent : les relevés de tarif d'autoload vivent dans un store
// séparé sous une clé à deux segments, et n'ont ni date UEX de référence ni péremption (même
// frontière que `groupOverridesByTerminal`).
export function exporterCorrections(overrides: StoreCorrections | null, nowSec: number): ExportCorrections {
  const store = overrides || {};
  const corrections = [];
  for (const cle of Object.keys(store)) {
    const seg = cle.split("|");
    if (seg.length !== 3) continue;
    const [commodite, terminal, side] = seg;
    const o = store[cle] || {};
    const commun = {
      commodite, terminal,
      cote: side === "buy" ? "achat" : "vente",
      base: isoUTC(o.base != null ? o.base : o.ts),
    };
    if (o.price != null) corrections.push({ ...commun, champ: "prix", valeur: o.price, saisi: isoUTC(o.saisiPrix) });
    if (o.vol != null) corrections.push({ ...commun, champ: "volume", valeur: o.vol, saisi: isoUTC(o.pris) });
  }
  // Rangé PAR STATION, comme la vue Corrections (ADR-003) : c'est ainsi qu'on relit ses relevés,
  // comptoir par comptoir. L'ordre est total et explicite — un export dont l'ordre dépend de celui
  // des clés de localStorage ne se compare pas d'une machine à l'autre.
  const rang = (c) => `${c.cote === "achat" ? 0 : 1}${c.champ === "prix" ? 0 : 1}`;
  corrections.sort((a, b) =>
    a.terminal.localeCompare(b.terminal, "fr")
    || a.commodite.localeCompare(b.commodite, "fr")
    || rang(a).localeCompare(rang(b)));
  // Les champs sont réordonnés pour que chaque entrée se lise dans l'ordre où on la décrit.
  return {
    ...enteteExport("corrections", nowSec),
    corrections: corrections.map((c) => ({
      commodite: c.commodite, terminal: c.terminal, cote: c.cote,
      champ: c.champ, valeur: c.valeur, saisi: c.saisi, base: c.base,
    })),
  };
}

// La relecture : que vaut encore chaque correction d'un export, aujourd'hui ? Un verdict par entrée,
// jamais une application silencieuse.
//   `appliquer`     — datée, ancrée, et le point n'a pas été republié depuis ;
//   `périmée-uex`   — UEX a republié ce point après l'ancrage ;
//   `périmée-âge`   — un VOLUME saisi il y a plus de DUREE_VOL (un prix ne vieillit jamais) ;
//   `date-inconnue` — format antérieur, sans date de saisie : signalée, pas acceptée en silence.
//
// Les deux premières règles ne sont pas réécrites ici : on reconstruit la correction et on la
// soumet à `effValue`, la MÊME fonction que le rendu. Deux implémentations de la péremption
// finiraient par diverger, et c'est la relecture qui aurait tort sans qu'on le voie.
// `releves` = { "Commodité|Terminal|side": date UEX courante du point }. Un point absent n'est pas
// rejeté : ne pas connaître le relevé n'est pas la même chose que le savoir plus récent.
export function relireCorrections(exporte: ExportCorrections | null, releves: Releves = {}, nowSec: number = Date.now() / 1000, dureeVol: number = DUREE_VOL): CorrectionRelue[] {
  const entrees = exporte && Array.isArray(exporte.corrections) ? exporte.corrections : [];
  return entrees.map((c) => {
    const side = c.cote === "achat" ? "buy" : "sell";
    const saisi = secDepuisISO(c.saisi);
    // `base` null couvre deux cas indistinguables à l'export (ancre à 0, ancre absente) ; on les
    // relit comme le store les écrit — `setInStore` pose toujours `Number(baseUpdated) || 0`.
    const o: Correction = { base: secDepuisISO(c.base) || 0 };
    if (c.champ === "prix") o.price = c.valeur;
    else { o.vol = c.valeur; if (saisi != null) o.pris = saisi; }
    const r = effValue(o, null, null, releves[ovKey(c.commodite, c.terminal, side)], nowSec, dureeVol);
    const verdict = r.stale ? "périmée-uex"
      : r.staleVol ? "périmée-âge"
      : saisi == null ? "date-inconnue"
      : "appliquer";
    return { ...c, verdict };
  });
}

// L'export des entrepôts : du TEXTE, et c'est délibéré — celui-ci n'est pas fait pour être relu par
// la machine mais collé dans un bloc-notes, un second écran ou un canal Discord d'org. Du JSON y
// serait illisible là où il sert.
// UNE LIGNE PAR LOT, pas par commodité : deux lots de la même commodité peuvent avoir été déposés
// des jours d'écart et venir de stations différentes — les regrouper effacerait précisément ce que
// cet export existe pour dire.
export function exporterEntrepots(entrepots: Entrepots | null, nowSec: number): string {
  const e = entrepots || {};
  const stations = Object.keys(e)
    .filter((s) => Array.isArray(e[s]) && e[s].length)
    .sort((a, b) => a.localeCompare(b, "fr"));
  const entete = enteteExport("entrepots", nowSec);
  const lignes = [`# Best Hauling — entrepôts · format v${entete.v} · émis ${entete.emis}`];
  let scuTotal = 0, investTotal = 0;
  for (const station of stations) {
    const lots = e[station];
    const scu = lots.reduce((s, l) => s + (l.units || 0), 0);
    const invest = lots.reduce((s, l) => s + (l.units || 0) * (l.paid || 0), 0);
    scuTotal += scu;
    investTotal += invest;
    lignes.push("", `## ${station}`);
    for (const l of lots) {
      const date = isoUTC(l.deposeAt);
      lignes.push(`- ${milliers(l.units || 0)} SCU · ${l.name} @ ${milliers(l.paid || 0)} aUEC/SCU`
        + ` · ${date ? `déposé ${date}` : "déposé à une date inconnue"}`
        + ` · ${l.from ? `chargé à ${l.from}` : "provenance inconnue"}`);
    }
    lignes.push(`  sous-total ${milliers(scu)} SCU · ${milliers(invest)} aUEC immobilisés`);
  }
  // Les deux chiffres que la carte affiche déjà, repris en pied : de l'argent déjà sorti.
  lignes.push("", `Total : ${milliers(scuTotal)} SCU déposés · ${milliers(investTotal)} aUEC immobilisés`);
  return lignes.join("\n");
}
