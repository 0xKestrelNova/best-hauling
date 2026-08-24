// Lire le journal du jeu (#100, ADR-009).
//
// Star Citizen écrit dans `Game.log` tout ce que le joueur fait à un comptoir de commodités, en
// clair et horodaté à la milliseconde. Ce module ne fait qu'une chose : transformer ce texte en
// transactions. Il ne lit aucun fichier, ne touche à aucun état, ne peint rien — c'est du calcul
// pur, testable sur des lignes écrites à la main.
//
// ── DEUX RÈGLES PAYÉES PAR D'AUTRES ───────────────────────────────────────────────────────────
// 1. ON N'ANCRE JAMAIS UN MOTIF SUR LE TAG D'ÉQUIPE. `sc-trade-companion` exige
//    `[Team_NAPU][Shops][UI]` en fin de ligne et n'a pas été touché depuis février 2025 ; la même
//    famille de lignes porte `[Team_CoreGameplayFeatures]` en 4.9. Leur détection est cassée et
//    personne ne s'en est aperçu — parce qu'un ancrage trop précis échoue EN SILENCE. On s'ancre
//    donc sur le nom de classe et les champs nommés, jamais sur le tag.
// 2. UN MOTIF QUI CESSE DE MORDRE DOIT SE VOIR. Chaque famille compte ses correspondances, et
//    zéro correspondance sur un journal qui CONTIENT la classe attendue est une anomalie
//    signalée. C'est la seule défense contre la panne muette.
//
// ── ET UNE CONTRAINTE DE FONCTIONNEMENT ───────────────────────────────────────────────────────
// `CSCLoadingPlatformManager` pèse à lui seul 172 533 lignes sur les journaux d'essai. Le
// pré-filtre par `String.includes` avant toute expression régulière n'est pas une optimisation,
// c'est ce qui rend la lecture possible.
import type { Commodite, LectureJournal, RefusJournal, TransactionJournal } from "./types.ts";
import { resolveCommodity } from "./logic.ts";

// La classe qui porte les transactions. Présente dans le journal dès qu'on a ouvert un kiosque.
const CLASSE = "CEntityComponentCommodityUIProvider";
const ACHAT = "SendCommodityBuyRequest";
const VENTE = "SendCommoditySellRequest";
const REFUS = "RmToken_CommodityTransactionResponse";
const LIEU = "RequestLocationInventory";

const HORO = /^<(\d{4}-\d{2}-\d{2}T[\d:.]+Z)>/;
const champ = (ligne: string, nom: string): string | null => {
  const m = ligne.match(new RegExp(nom + "\\[([^\\]]*)\\]"));
  return m ? m[1] : null;
};
const nombre = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const secondes = (iso: string): number => Math.round(Date.parse(iso) / 1000);

/**
 * Lit un journal entier. Rend les transactions, les refus, les lieux traversés, et les anomalies.
 *
 * Le LIEU n'est pas sur la ligne de transaction : il vient du dernier `RequestLocationInventory`
 * rencontré au-dessus. Vérifié sur 158 journaux — il en précède **100 % des 222 transactions**.
 * Un journal qui commencerait au milieu d'une session laisserait donc `lieu: null`, et c'est une
 * absence honnête : on n'invente pas le comptoir.
 */
export function lireJournal(texte: string): LectureJournal {
  const transactions: TransactionJournal[] = [];
  const refus: RefusJournal[] = [];
  const lieux: string[] = [];
  const anomalies: string[] = [];
  let lieuCourant: string | null = null;

  for (const ligne of String(texte || "").split("\n")) {
    // LE pré-filtre. Tout ce qui suit ne voit qu'une ligne sur des milliers.
    if (!ligne.includes(CLASSE) && !ligne.includes(LIEU)) continue;

    if (ligne.includes(LIEU)) {
      const l = champ(ligne, "Location");
      if (l) { lieuCourant = l; if (!lieux.includes(l)) lieux.push(l); }
      continue;
    }

    const h = ligne.match(HORO);
    if (!h) continue;                       // une ligne sans horodatage n'est pas datable, donc inutile

    if (ligne.includes(REFUS)) {
      // La ligne de refus ne porte NI commodité NI lieu : seulement le type et la cause. On garde
      // le lieu courant, qui est le seul rattachement disponible — et il reste une déduction.
      refus.push({
        at: secondes(h[1]), lieu: lieuCourant,
        type: champ(ligne, "type") || "", resultat: champ(ligne, "result") || "",
      });
      continue;
    }

    const achat = ligne.includes(ACHAT);
    if (!achat && !ligne.includes(VENTE)) continue;
    const guid = champ(ligne, "resourceGUID");
    if (!guid) continue;

    // La QUANTITÉ n'a pas la même unité des deux côtés, et c'est mesuré, pas supposé :
    //   - à l'ACHAT, `quantity[22400.000000 cSCU]` est en CENTI-SCU. Contre-épreuve arithmétique :
    //     34,408001 × 100 × (22400 / 100) = 770 739 contre 770 740 au journal, soit 1 aUEC ;
    //   - à la VENTE, `quantity[2]` est en SCU malgré `transactionMode[ResourceContainer]`, qui
    //     laisse croire à des conteneurs. Confronté au prix de vente UEX sur 121 ventes : la
    //     lecture « SCU » tombe dans la fourchette 117 fois, la lecture « conteneurs de 32 » ZÉRO.
    const q = nombre(champ(ligne, "quantity"));
    const scu = q == null ? null : achat && /cSCU/.test(champ(ligne, "quantity") || "") ? q / 100 : q;
    if (scu == null || !(scu > 0)) continue;

    // Le prix au SCU n'est publié qu'à l'ACHAT (`shopPricePerCentiSCU`, ×100). À la vente il se
    // déduit du montant — ce qui le rend arrondi, jamais faux.
    const parCenti = nombre(champ(ligne, "shopPricePerCentiSCU"));
    const montant = nombre(champ(ligne, achat ? "price" : "amount"));
    const prix = parCenti != null ? parCenti * 100 : montant != null ? montant / scu : null;

    transactions.push({
      at: secondes(h[1]), cote: achat ? "buy" : "sell", guid: guid.toLowerCase(),
      lieu: lieuCourant, comptoir: champ(ligne, "shopName"),
      scu, prix, montant,
      taille: nombre(champ(ligne, "boxSize")),
      caisses: nombre(champ(ligne, "unitAmount")),
      autoload: champ(ligne, "autoLoading") === "1",
    });
  }

  // La défense contre la panne muette : le journal parle de commodités mais on n'a rien lu.
  if (texte.includes(CLASSE) && !transactions.length && !refus.length) {
    anomalies.push(
      `Le journal contient « ${CLASSE} » mais aucune transaction n'a été lue : les motifs ne mordent ` +
      `plus. C'est ce qui est arrivé à sc-trade-companion, en silence, pendant plus d'un an.`
    );
  }
  return { transactions, refus, lieux, anomalies };
}

// ── Pont n°1 : `resourceGUID` -> commodité ────────────────────────────────────────────────────
// Le journal désigne la commodité par un GUID et RIEN n'y associe jamais un nom : zéro ligne porte
// les deux. La table vient de `scunpacked-data`, figée dans `data/commodites-guid.json` — 206
// entrées `UUID` -> `Key`. Re-mesuré le 2026-08-24 sur 158 journaux : 24 GUID distincts observés,
// **24 sur 24** présents dans la table.
//
// Reste à passer d'une `Key` du jeu à un de nos 113 noms UEX. Trois formes suffisent, et la
// quatrième n'existe pas : on ne devine pas, on laisse `null`.

/** Les écritures candidates d'une clé scunpacked, de la plus littérale à la plus dérivée. */
export function formesDeCle(cle: string): string[] {
  const k = String(cle || "");
  if (!k) return [];
  // « ConstructionMaterials » -> « Construction Materials » ; « Pressurized_Ice » -> « Pressurized Ice ».
  const espaces = k.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const formes = [k, espaces];
  // Nos minerais s'écrivent « Copper (Ore) » là où le jeu dit « Ore_Copper ».
  const minerai = k.match(/^Ore_(.+)$/);
  if (minerai) formes.push(minerai[1] + " (Ore)");
  return formes;
}

/**
 * La commodité désignée par un GUID, ou `null`.
 *
 * `resolveCommodity` fait le gros du travail — il résout un NOM comme un CODE, ce qui suffit à
 * `RMC` -> « Recycled Material Composite ». Mesuré sur les 24 GUID observés : **23 résolus**, soit
 * **220 occurrences sur 222 (99 %)**. Le seul manquant est `ShipAmmoSize1` : le jeu en publie neuf
 * tailles, nous n'avons qu'une « Ship Ammunition », et notre marché n'en porte AUCUN point d'achat
 * — donc le prix ne peut pas confirmer l'appariement. On préfère `null` à une supposition.
 * Sur les 206 clés de la table, 96 tombent sur une de nos commodités et **aucune collision** : deux
 * clés ne désignent jamais la même. Les 110 autres ne sont pas des erreurs — scunpacked catalogue
 * tout ce qui tient dans une caisse (boîtes à indices, casques, limpets), UEX ne cote que ce qui
 * se négocie.
 */
export function commoditeDuGuid(
  commodites: Commodite[], table: Record<string, string>, guid: string
): Commodite | null {
  const cle = table && table[String(guid || "").toLowerCase()];
  if (!cle) return null;
  for (const f of formesDeCle(cle)) {
    const c = resolveCommodity(commodites, f);
    if (c) return c;
  }
  return null;
}

// ── Pont n°2 : lieu -> terminal ───────────────────────────────────────────────────────────────
// Ni `shopName` ni `shopId` ne désigne un terminal, et c'est contre-intuitif :
//   - `shopName` est un GABARIT : `SCShop_Admin_lt_base_g` couvre 32 `shopId` distincts, c'est
//     l'archétype d'un bureau d'avant-poste réutilisé partout ;
//   - `shopId` est ÉPHÉMÈRE : sur 178 identifiants observés, 173 n'apparaissent que dans une seule
//     session.
// La clé est le `Location[…]` du dernier `RequestLocationInventory`.
//
// Deux mécanismes, et le second n'est pas une paresse du premier :

/**
 * Les points de Lagrange se déduisent, ils ne se listent pas. `RR_ARC_L1` -> `ARC-L1`, pour les
 * quatre codes de Stanton (ARC, CRU, HUR, MIC) et leurs cinq points. La règle est vérifiée par le
 * prix là où il y a de quoi : MIC-L1 8 achats sur 8, MIC-L2 5 sur 5.
 * Elle ne vaut PAS pour Pyro, dont les stations Lagrange portent des noms propres (Gaslight,
 * Endgame, Megumi…) — d'où la table ci-dessous.
 */
const LAGRANGE_STANTON = /^RR_(ARC|CRU|HUR|MIC)_L([1-5])$/;

/**
 * Les lieux qui ne se déduisent pas. Chaque entrée est APPARIÉE PAR LE PRIX : on confronte le prix
 * au SCU lu au journal aux prix UEX du terminal supposé, et on ne garde que les gagnants NETS.
 * Le compte entre parenthèses est le nombre d'achats qui tombent dans la fourchette du terminal
 * retenu, sur le total observé à ce lieu (mesuré le 2026-08-24, 158 journaux).
 *
 * Ce qui rend cette table défendable, c'est qu'elle se VÉRIFIE : `journal.test.mjs` refait
 * l'appariement sur les relevés d'échantillon et tombe si une entrée devient fausse.
 */
export const LIEUX_TERMINAUX: Record<string, string> = {
  RR_ARC_LEO: "Baijini Point",       // 12/12
  RR_HUR_LEO: "Everus Harbor",       // 24/26
  RR_MIC_LEO: "Port Tressler",       // le LEO de microTech, par construction
  RR_P5_L2: "Gaslight",              // 7/7
  RR_P6_LEO: "Ruin Station",         // 6/6
  RR_P6_L5: "Megumi",                // 4/4
  RR_JP_StantonMagnus: "Nyx Gateway (Stanton)", // 3/3, seul candidat
  Nyx_Levski: "Levski",              // nom propre, sans ambiguïté possible
};

/**
 * Les lieux OBSERVÉS qu'on refuse d'apparier, et pourquoi. Les lister vaut mieux que les taire :
 * sans ça, le prochain lecteur refera l'analyse pour retomber sur la même égalité.
 *
 * Un lieu non apparié n'invente rien — la transaction est lue et attend que l'utilisateur désigne
 * le terminal.
 */
export const LIEUX_AMBIGUS: Record<string, string> = {
  RR_JP_PyroStanton: "les deux bouts d'un même saut affichent les mêmes prix (Pyro Gateway et Stanton Gateway, 10/10 chacun)",
  RR_JP_StantonPyro: "idem, 8/8 chacun",
  RR_P6_L3: "égalité parfaite entre Endgame et Dudley & Daughters (4/4 chacun)",
  RR_P3_L1: "trois candidats à 2/2 (Starlight Service, Rayari Anvik, Rayari Kaltag)",
  Pyro3_Outpost_col_m_mng_indy_001: "Bueno Ravine mène 5/5 mais Fallow Field suit à 4/5 — trop serré",
};

/**
 * Le terminal d'un lieu du journal, ou `null`.
 *
 * `null` n'est pas un échec : c'est le comportement attendu pour un lieu ambigu ou inconnu. La
 * transaction reste lisible, et c'est à l'utilisateur de trancher.
 */
export function terminalDuLieu(lieu: string | null | undefined): string | null {
  const l = String(lieu || "");
  if (!l || LIEUX_AMBIGUS[l]) return null;
  if (LIEUX_TERMINAUX[l]) return LIEUX_TERMINAUX[l];
  const lag = l.match(LAGRANGE_STANTON);
  return lag ? `${lag[1]}-L${lag[2]}` : null;
}
