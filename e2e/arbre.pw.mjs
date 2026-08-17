import { test, expect } from "@playwright/test";

// L'ARBRE N'ÉVALUE QUE LA VUE REGARDÉE (ADR-011 étape 3, ADR-012).
//
// La racine React unique s'abonne à `etat.ts` : `notifier()` réévalue TOUT l'arbre. Le garde `si`
// de `<Portail>` (App.tsx) est ce qui empêche une vue invisible d'être recalculée à chaque geste —
// une frappe dans `#search` faite depuis les Trajets ne doit pas parcourir tout le marché pour un
// board que personne ne regarde.
//
// CE GARDE N'ÉTAIT COUVERT PAR RIEN. La PR #146 qui l'a posé ne touche qu'App.tsx : le compteur par
// vue qui a produit ses mesures était un instrument jeté. Et l'oubli est SILENCIEUX dans les deux
// sens qui comptent — un portail sans `si` rend un écran parfaitement correct, simplement calculé
// pour rien. C'est l'EXCÈS qui est invisible ; l'insuffisance, elle, casse un écran et se voit.
//
// On mesure donc les MUTATIONS DOM du conteneur, pas un compteur interne : c'est la seule preuve
// qui survivra au jour où l'instrument changera. Même patron que le budget de lots de rendu de
// `smoke.pw.mjs`, visant le conteneur du board.

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

// Arme un observateur sur un conteneur et rend un lecteur du nombre de lots de mutation reçus.
async function compterLots(page, id) {
  await page.evaluate((cible) => {
    window.__lots = 0;
    new MutationObserver(() => { window.__lots++; }).observe(
      document.getElementById(cible), { childList: true, subtree: true },
    );
  }, id);
  return () => page.evaluate(() => window.__lots);
}

test("Arbre : taper depuis les Trajets ne repeint pas le board des Commodités", async ({ page }) => {
  // On passe d'abord PAR la vue Commodités : sans ça le test serait vide de sens — un conteneur
  // jamais peint ne se repeint évidemment pas, et il resterait vert même si le garde disparaissait.
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible({ timeout: 20000 });
  await page.click("#viewRoutes");
  await expect(page.locator("#rows tr").first()).toBeVisible();

  const lots = await compterLots(page, "commGrid");

  // Huit frappes, chacune passant par le debounce puis `refresh()` puis `notifier()`.
  await page.locator("#search").pressSequentially("Laranite", { delay: 30 });
  await expect(page).toHaveURL(/search=Laranite/, { timeout: 10000 });
  await expect(page.locator("#rows tr").first()).toBeVisible();

  expect(await lots(), "le board a été repeint depuis une vue qui ne l'affiche pas").toBe(0);
});

test("Arbre : le board se peint bien quand on le regarde, lui", async ({ page }) => {
  // Le volet symétrique, et il n'est pas décoratif : sans lui, le test ci-dessus passerait aussi
  // pour une vue définitivement cassée.
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible({ timeout: 20000 });

  const lots = await compterLots(page, "commGrid");
  await page.locator("#search").pressSequentially("Lar", { delay: 30 });
  await expect(page).toHaveURL(/search=Lar/, { timeout: 10000 });

  expect(await lots(), "le board n'a pas suivi le filtre alors qu'il est à l'écran").toBeGreaterThan(0);
  expect(await page.locator("#commGrid .comm-tile").count()).toBeGreaterThan(0);
});

test("Arbre : taper depuis les Trajets ne repeint pas la vue Corrections", async ({ page }) => {
  // Même mesure, sur la vue la plus chère des deux : `tuilesStation` parcourt tout le catalogue de
  // commodités et appelle `effVals` — qui PURGE et PERSISTE — une à deux fois par tuile. La
  // réévaluer depuis une autre vue ne serait pas seulement du calcul perdu : ce serait des
  // écritures de `localStorage` déclenchées par une frappe qui ne la concerne pas.
  await page.click("#viewCorrections");
  await expect(page.locator("#stationList option").first()).toBeAttached({ timeout: 20000 });
  await page.fill("#station", "Levski — Nyx");
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible({ timeout: 20000 });

  await page.click("#viewRoutes");
  await expect(page.locator("#rows tr").first()).toBeVisible();

  const lots = await compterLots(page, "correctionsStation");
  await page.locator("#search").pressSequentially("Laranite", { delay: 30 });
  await expect(page).toHaveURL(/search=Laranite/, { timeout: 10000 });

  expect(await lots(), "la vue Corrections a été repeinte depuis les Trajets").toBe(0);
});

test("Arbre : taper depuis les Trajets ne repeint pas le tableau des Boucles", async ({ page }) => {
  await page.click("#viewLoops");
  await expect(page.locator("#loopRows tr").first()).toBeVisible({ timeout: 20000 });
  await page.click("#viewRoutes");
  await expect(page.locator("#rows tr").first()).toBeVisible();

  const lots = await compterLots(page, "loopRows");
  await page.locator("#search").pressSequentially("Laranite", { delay: 30 });
  await expect(page).toHaveURL(/search=Laranite/, { timeout: 10000 });

  expect(await lots(), "le tableau des Boucles a été repeint depuis les Trajets").toBe(0);
});

test("Arbre : taper depuis les Trajets ne recalcule pas la Chaîne", async ({ page }) => {
  // La plus chère des cinq : `buildChainAdjacency` construit un graphe sur tout le marché, puis
  // `bestChain` en fait une recherche par faisceau. La rejouer depuis une autre vue serait le
  // gaspillage le plus cher du dépôt.
  await page.fill("#cargo", "96");
  await page.check("#useCargo");
  await page.click("#viewChain");
  await page.fill("#chainOrigin", "Megumi — Pyro");
  await expect(page.locator("#chainOut .chain")).toBeVisible({ timeout: 20000 });

  await page.click("#viewRoutes");
  await expect(page.locator("#rows tr").first()).toBeVisible();

  const lots = await compterLots(page, "chainOut");
  await page.locator("#search").pressSequentially("Laranite", { delay: 30 });
  await expect(page).toHaveURL(/search=Laranite/, { timeout: 10000 });

  expect(await lots(), "la Chaîne a été recalculée depuis les Trajets").toBe(0);
});
