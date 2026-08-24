// Tests de la lecture du journal de jeu (#100, ADR-009).
// Lancer : `node --test`.
//
// Les lignes ci-dessous sont de VRAIES lignes de `Game.log` (Star Citizen 4.9), **anonymisées** :
// `playerId`, `shopId` et `kioskId` sont mis à 0 et le nom du joueur remplacé. Rien d'autre n'est
// touché — c'est le format du jeu qu'on teste, pas une paraphrase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commoditeDuGuid, formesDeCle, lireJournal, terminalDuLieu, LIEUX_AMBIGUS, LIEUX_TERMINAUX } from "./journal.ts";

const MARKET = JSON.parse(readFileSync(new URL("./data/market.json", import.meta.url), "utf8"));
const GUIDS = JSON.parse(readFileSync(new URL("./data/commodites-guid.json", import.meta.url), "utf8"));

const LIEU = "<2026-05-25T00:30:00.000Z> [Notice] <RequestLocationInventory> Player[Joueur] requested inventory for Location[RR_ARC_LEO] [Team_CoreGameplayFeatures][Inventory]";
const ACHAT = "<2026-05-25T00:36:28.431Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommodityBuyRequest> Sending SShopCommodityBuyRequest - playerId[0] shopId[0] shopName[SCShop_Admin_lt_base_g] kioskId[0] price[770740.000000] shopPricePerCentiSCU[34.408001] resourceGUID[48c7080a-bbef-43d2-901a-698321ed4340] autoLoading[0] quantity[22400.000000 cSCU] Cargo Box Data: boxSize[32.000000] | unitAmount[7] [Team_CoreGameplayFeatures][Shops][UI]";
const VENTE = "<2026-05-25T02:47:16.250Z> [Notice] <CEntityComponentCommodityUIProvider::SendCommoditySellRequest> Sending SShopCommoditySellRequest - playerId[0] shopId[0] shopName[SCShop_Levski_CargoOffice_Commodities] kioskId[0] amount[6609.000000] resourceGUID[48c7080a-bbef-43d2-901a-698321ed4340] autoLoading[0] quantity[2] transactionMode[ResourceContainer] Cargo Box Data:  [Team_CoreGameplayFeatures][Shops][UI]";
const REFUS = "<2026-08-12T19:02:43.601Z> [Error] <CEntityComponentCommodityUIProvider::RmToken_CommodityTransactionResponse> Commodity Transaction Response Error - playerId[0] result[CargoCreationFailed] type[Buying] [Team_CoreGameplayFeatures][Shops]";
// Le bruit qui domine un journal réel : 172 533 lignes sur les journaux d'essai, à lui seul.
const BRUIT = "<2026-05-25T00:36:29.000Z> [Notice] <CSCLoadingPlatformManager::TransitionLightGroupState> [Loading Platform] Loading Platform Manager [LoadingPlatform_FreightElevator_Util_Exterior_Manager_Stanton] Platform state changed";

const ALUMINIUM = "48c7080a-bbef-43d2-901a-698321ed4340";

test("lireJournal : un ACHAT se lit entier, et les centi-SCU deviennent des SCU", () => {
  const { transactions } = lireJournal([LIEU, BRUIT, ACHAT].join("\n"));
  assert.equal(transactions.length, 1);
  const t = transactions[0];
  assert.equal(t.cote, "buy");
  assert.equal(t.guid, ALUMINIUM);
  // 22 400 cSCU font 224 SCU. Lire le nombre brut donnerait 22 400 SCU — cent fois trop, et le
  // profit calculé dessus serait absurde sans que rien ne le signale.
  assert.equal(t.scu, 224);
  assert.equal(t.prix, 3440.8001);          // shopPricePerCentiSCU × 100
  assert.equal(t.montant, 770740);
  assert.equal(t.taille, 32);
  assert.equal(t.caisses, 7);
  assert.equal(t.autoload, false);
  assert.equal(t.comptoir, "SCShop_Admin_lt_base_g");
  assert.equal(t.at, Math.round(Date.parse("2026-05-25T00:36:28.431Z") / 1000));
});

test("lireJournal : le total se recalcule à l'aUEC près — la contre-épreuve du format", () => {
  // Si les unités étaient mal lues, ce produit s'effondrerait. C'est le test qui garantit que
  // `scu` et `prix` sont bien ceux qu'on croit, sans dépendre d'aucune table extérieure.
  const [t] = lireJournal(ACHAT).transactions;
  assert.equal(Math.round(t.prix * t.scu), 770739);
  assert.ok(Math.abs(t.prix * t.scu - t.montant) <= 1, `écart ${t.prix * t.scu - t.montant}`);
});

test("lireJournal : à la VENTE, `quantity` est en SCU malgré `transactionMode[ResourceContainer]`", () => {
  // Le mode laisse croire à des conteneurs. Confronté au prix de vente UEX sur 121 ventes réelles,
  // la lecture « SCU » tombe dans la fourchette 117 fois et la lecture « conteneurs de 32 » ZÉRO.
  // Aluminium se vend 2 900 à 3 900 chez UEX : 6 609 / 2 = 3 304,5 tombe dedans, 6 609 / 64 = 103 non.
  const [t] = lireJournal([LIEU, VENTE].join("\n")).transactions;
  assert.equal(t.cote, "sell");
  assert.equal(t.scu, 2);
  assert.equal(t.prix, 3304.5);             // déduit du montant : la vente ne publie pas de prix/SCU
  assert.equal(t.montant, 6609);
  // La vente ne dit RIEN du caissage — `Cargo Box Data:` y est vide.
  assert.equal(t.taille, null);
  assert.equal(t.caisses, null);
});

test("lireJournal : le LIEU vient de la ligne d'inventaire, jamais de la transaction", () => {
  const { transactions, lieux } = lireJournal([LIEU, ACHAT, VENTE].join("\n"));
  assert.deepEqual(lieux, ["RR_ARC_LEO"]);
  for (const t of transactions) assert.equal(t.lieu, "RR_ARC_LEO");
  // Un journal qui commence au milieu d'une session n'a pas de lieu : on ne l'invente pas.
  const orphelin = lireJournal(ACHAT);
  assert.equal(orphelin.transactions[0].lieu, null);
  assert.deepEqual(orphelin.lieux, []);
});

test("lireJournal : un REFUS est daté et rattaché à la zone courante", () => {
  const { refus, transactions } = lireJournal([LIEU, REFUS].join("\n"));
  assert.equal(transactions.length, 0);
  assert.equal(refus.length, 1);
  assert.equal(refus[0].resultat, "CargoCreationFailed");
  assert.equal(refus[0].type, "Buying");
  // La ligne de refus ne porte NI commodité NI lieu : le rattachement est une déduction, et c'est
  // pour ça qu'il se lit dans un champ à part et non comme une propriété de la transaction.
  assert.equal(refus[0].lieu, "RR_ARC_LEO");
});

test("lireJournal : le tag d'équipe n'est JAMAIS requis — la leçon de sc-trade-companion", () => {
  // Leur processeur exige `[Team_NAPU][Shops][UI]` en fin de ligne et n'a pas bougé depuis
  // février 2025 ; la même famille porte `[Team_CoreGameplayFeatures]` en 4.9. Leur détection est
  // cassée depuis, EN SILENCE. Nos motifs doivent donc survivre à n'importe quel tag, ou à aucun.
  const sansTag = ACHAT.replace(" [Team_CoreGameplayFeatures][Shops][UI]", "");
  const autreTag = ACHAT.replace("Team_CoreGameplayFeatures", "Team_NAPU");
  const inventeDemain = ACHAT.replace("[Team_CoreGameplayFeatures][Shops][UI]", "[Team_QuiSaitQuoi][Boutiques]");
  for (const [nom, ligne] of [["sans tag", sansTag], ["ancien tag", autreTag], ["tag futur", inventeDemain]]) {
    const { transactions } = lireJournal(ligne);
    assert.equal(transactions.length, 1, `${nom} : la ligne doit se lire quand même`);
    assert.equal(transactions[0].scu, 224, `${nom} : et se lire pareil`);
  }
});

test("lireJournal : un motif qui cesse de mordre se VOIT", () => {
  // Un journal qui parle de commodités sans qu'on en lise une seule : c'est exactement la panne
  // muette. Elle doit remonter, pas se confondre avec « le joueur n'a rien acheté ».
  const casse = "<2026-05-25T00:36:28.431Z> [Notice] <CEntityComponentCommodityUIProvider::UnMotifQuOnNeConnaitPas> quelque chose";
  const { anomalies } = lireJournal(casse);
  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0], /motifs ne mordent plus/);
  // Un journal SANS la classe n'est pas une anomalie : le joueur n'a simplement pas ouvert de kiosque.
  assert.deepEqual(lireJournal(BRUIT).anomalies, []);
  assert.deepEqual(lireJournal("").anomalies, []);
});

test("lireJournal : le bruit ne coûte rien et ne rend rien", () => {
  // `CSCLoadingPlatformManager` pèse 172 533 lignes à lui seul. Le pré-filtre par `includes` n'est
  // pas une optimisation, c'est ce qui rend la lecture possible.
  const gros = Array.from({ length: 5_000 }, () => BRUIT).join("\n");
  const { transactions, anomalies } = lireJournal([gros, LIEU, ACHAT].join("\n"));
  assert.equal(transactions.length, 1);
  assert.deepEqual(anomalies, []);
});

// ---------- Pont n°1 : le GUID ----------
test("commoditeDuGuid : la table livrée résout ce que le journal désigne", () => {
  assert.equal(Object.keys(GUIDS).length, 206);
  const c = commoditeDuGuid(MARKET.commodities, GUIDS, ALUMINIUM);
  assert.equal(c && c.name, "Aluminum");
  // La casse du GUID ne doit pas décider : le journal l'écrit en minuscules, une table pourrait non.
  assert.equal(commoditeDuGuid(MARKET.commodities, GUIDS, ALUMINIUM.toUpperCase()).name, "Aluminum");
  // Un GUID absent ne devient pas une commodité au hasard.
  assert.equal(commoditeDuGuid(MARKET.commodities, GUIDS, "00000000-0000-0000-0000-000000000000"), null);
  assert.equal(commoditeDuGuid(MARKET.commodities, GUIDS, ""), null);
});

test("formesDeCle : trois écritures, et pas une de plus", () => {
  // Littérale d'abord — « Iron » EST un de nos noms, et « RMC » est un de nos codes.
  assert.deepEqual(formesDeCle("Iron"), ["Iron", "Iron"]);
  // Le CamelCase et le trait de soulignement se desserrent en espaces.
  assert.ok(formesDeCle("ConstructionMaterials").includes("Construction Materials"));
  assert.ok(formesDeCle("Pressurized_Ice").includes("Pressurized Ice"));
  // Nos minerais s'écrivent à l'envers de ceux du jeu.
  assert.ok(formesDeCle("Ore_Copper").includes("Copper (Ore)"));
  assert.deepEqual(formesDeCle(""), []);
});

test("commoditeDuGuid : les trois formes tombent toutes sur une commodité réelle", () => {
  const attendu = [
    ["Aluminum", "Aluminum"],                          // littérale
    ["ConstructionMaterials", "Construction Materials"], // décamelisée
    ["Pressurized_Ice", "Pressurized Ice"],            // trait de soulignement
    ["RMC", "Recycled Material Composite"],            // par le CODE, via resolveCommodity
    ["Ore_Copper", "Copper (Ore)"],                    // minerai
  ];
  const parCle = new Map(Object.entries(GUIDS).map(([u, k]) => [k, u]));
  for (const [cle, nom] of attendu) {
    const guid = parCle.get(cle);
    assert.ok(guid, `la table doit contenir la clé ${cle}`);
    const c = commoditeDuGuid(MARKET.commodities, GUIDS, guid);
    assert.equal(c && c.name, nom, `${cle} devrait donner « ${nom} »`);
  }
});

test("commoditeDuGuid : deux clés ne désignent JAMAIS la même commodité", () => {
  // Une collision voudrait dire qu'on range deux marchandises différentes sous un seul nom, et
  // qu'une correction de prix écraserait l'autre. Mesuré sur les 206 clés : aucune.
  const vues = new Map();
  for (const [guid, cle] of Object.entries(GUIDS)) {
    const c = commoditeDuGuid(MARKET.commodities, GUIDS, guid);
    if (!c) continue;
    if (vues.has(c.name)) assert.fail(`« ${c.name} » est désignée par ${vues.get(c.name)} ET ${cle}`);
    vues.set(c.name, cle);
  }
  // Non vacuisant : la table doit vraiment résoudre une bonne part de nos commodités.
  assert.ok(vues.size > 80, `seulement ${vues.size} commodités résolues`);
});

// ---------- Pont n°2 : le lieu ----------
test("terminalDuLieu : les points de Lagrange de Stanton se DÉDUISENT", () => {
  assert.equal(terminalDuLieu("RR_ARC_L1"), "ARC-L1");
  assert.equal(terminalDuLieu("RR_MIC_L2"), "MIC-L2");
  assert.equal(terminalDuLieu("RR_HUR_L4"), "HUR-L4");
  assert.equal(terminalDuLieu("RR_CRU_L1"), "CRU-L1");
  // La règle ne vaut PAS pour Pyro : ses stations Lagrange portent des noms propres.
  assert.equal(terminalDuLieu("RR_P2_L4"), null);
  // Ni pour un point qui n'existe pas.
  assert.equal(terminalDuLieu("RR_ARC_L9"), null);
  assert.equal(terminalDuLieu("RR_XXX_L1"), null);
});

test("terminalDuLieu : la table nommée, et le refus d'apparier ce qui est ambigu", () => {
  assert.equal(terminalDuLieu("RR_HUR_LEO"), "Everus Harbor");
  assert.equal(terminalDuLieu("RR_P5_L2"), "Gaslight");
  assert.equal(terminalDuLieu("Nyx_Levski"), "Levski");
  // Un lieu AMBIGU rend `null` — et c'est le comportement voulu, pas un trou. Les deux bouts d'un
  // même saut affichent les mêmes prix : rien ne les départage.
  for (const lieu of Object.keys(LIEUX_AMBIGUS)) {
    assert.equal(terminalDuLieu(lieu), null, `${lieu} doit rester non apparié`);
  }
  assert.equal(terminalDuLieu("QuelqueChoseDInconnu"), null);
  assert.equal(terminalDuLieu(null), null);
  assert.equal(terminalDuLieu(""), null);
});

test("terminalDuLieu : tout terminal nommé dans la table EXISTE dans le marché", () => {
  // C'est ce test qui rend la table périssable au lieu de fausse en silence : un terminal renommé
  // ou retiré par UEX le fait tomber, au lieu de laisser une correction se ranger dans le vide.
  const noms = new Set(MARKET.terminals.map((t) => t.name));
  for (const [lieu, terminal] of Object.entries(LIEUX_TERMINAUX)) {
    assert.ok(noms.has(terminal), `${lieu} -> « ${terminal} » : ce terminal n'est plus dans market.json`);
  }
  // Et la règle des Lagrange aussi. UEX n'en cote que 18 sur 20 : CRU-L2 et CRU-L3 manquent, et
  // c'est une propriété du marché, pas un défaut de la règle — la dérivation reste juste, il n'y a
  // simplement pas de comptoir en face. On les nomme, plutôt que d'affaiblir le test : si UEX en
  // ajoute un, CE test tombe, et c'est exactement ce qu'on veut savoir.
  const SANS_COMPTOIR = ["CRU-L2", "CRU-L3"];
  const absents = [];
  for (const code of ["ARC", "CRU", "HUR", "MIC"]) {
    for (let n = 1; n <= 5; n++) {
      const attendu = terminalDuLieu(`RR_${code}_L${n}`);
      assert.equal(attendu, `${code}-L${n}`, "la dérivation elle-même ne doit pas bouger");
      if (!noms.has(attendu)) absents.push(attendu);
    }
  }
  assert.deepEqual(absents, SANS_COMPTOIR,
    "la liste des points de Lagrange non cotés par UEX a changé — vérifier et mettre à jour");
});

test("la CHAÎNE complète tient : une ligne brute devient une commodité et un terminal", () => {
  // De bout en bout, sur une vraie ligne : texte -> transaction -> commodité -> terminal.
  const [t] = lireJournal([LIEU, ACHAT].join("\n")).transactions;
  assert.equal(terminalDuLieu(t.lieu), "Baijini Point");
  assert.equal(commoditeDuGuid(MARKET.commodities, GUIDS, t.guid).name, "Aluminum");
  assert.equal(t.scu, 224);
  assert.equal(Math.round(t.prix), 3441);

  // CE QUE CE TEST NE FAIT PAS, ET POURQUOI : il ne confronte PAS le prix du journal au prix UEX
  // de ce terminal. Une première version le faisait et tombait aussitôt — l'Aluminium ne s'achète
  // plus à Baijini Point aujourd'hui, alors qu'il s'y achetait en mai. Un test qui dépend d'une
  // paire (commodité, terminal) présente à l'instant T est une fragilité, exactement celle qui a
  // fait tomber trois tests de `smoke.pw.mjs` à la régénération du 2026-08-24.
  //
  // L'appariement des lieux a bien été vérifié par le prix, mais HORS CI, sur les 158 journaux du
  // propriétaire : Everus Harbor 24/26, Baijini Point 12/12, MIC-L1 8/8, Gaslight 7/7, Ruin Station
  // 6/6, Megumi 4/4. Ces chiffres vivent dans l'ADR-016 et dans les commentaires de la table.
  // Les rejouer en CI demanderait de versionner le journal d'un joueur — ce qu'on ne fera pas.
});
