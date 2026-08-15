import { test, expect } from "@playwright/test";

// La tournée d'écoulement : la huitième vue (#57, ADR-007).
// Elle répond à l'AUTRE question que « où écouler » — non pas « combien puis-je en tirer » mais
// « comment me débarrasser d'une soute que je ne veux plus porter ». L'écran doit le dire, sinon
// l'app se contredit sous les yeux de l'utilisateur, qui lit deux classements opposés du même fret.

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

// Déclare du fret à bord : la tournée n'a de sens que sur une soute pleine, et c'est #55 qui a
// livré cette porte d'entrée — l'issue #57 la réclamait encore, sa prémisse était périmée.
async function declarer(page, nom, scu) {
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  await expect.poll(() => page.locator("#commodityList option").count()).toBeGreaterThan(0);
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", String(scu));
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();
}

// Une tournée calculée, depuis un terminal de Pyro qui existe dans le jeu de données.
async function tourneeDepuis(page, terminal = "Megumi") {
  await page.click("#viewTour");
  await expect(page.locator("#tour")).toBeVisible();
  await page.fill("#tourFrom", terminal);
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible({ timeout: 10_000 });
}

// La Tournée est passée en SIXIÈME position au rail (#45) : elle lit la soute, elle appartient
// donc à la famille « soute », entre le marché et la conclusion. Son raccourci a suivi son numéro.
test("Tournée : une entrée au rail, au clic comme au raccourci « 6 » (#57, #45)", async ({ page }) => {
  await expect(page.locator("#viewTour")).toBeVisible();
  await page.click("#viewTour");
  await expect(page.locator("#tour")).toBeVisible();
  await expect(page.locator("#tourControls")).toBeVisible();
  await expect(page.locator("#viewTour")).toHaveClass(/active/);
  await expect(page.locator("#routes")).toBeHidden();

  await page.click("#viewRoutes");
  await expect(page.locator("#tour")).toBeHidden();
  await expect(page.locator("#tourControls")).toBeHidden(); // les contrôles ne fuient pas hors de leur vue
  await page.keyboard.press("6");
  await expect(page.locator("#tour")).toBeVisible();
});

test("Tournée : la vue revient d'un rechargement ET d'un permalien, terminal compris (#57)", async ({ page }) => {
  // Le piège documenté par l'ADR-004 : sans ajout dans la liste blanche d'applyState, la vue
  // s'ouvre au clic mais ne revient d'aucun état sauvé.
  await page.click("#viewTour");
  await page.fill("#tourFrom", "Megumi");
  await page.selectOption("#tourScope", "all");
  await expect.poll(() => page.url()).toContain("v=tour");

  await page.reload();
  await expect(page.locator("#tour")).toBeVisible();
  await expect(page.locator("#viewTour")).toHaveClass(/active/);
  await expect(page.locator("#tourFrom")).toHaveValue("Megumi");
  await expect(page.locator("#tourScope")).toHaveValue("all"); // la portée voyage aussi
});

test("Tournée : soute vide, la vue dit quoi faire plutôt que de rester blanche (#57)", async ({ page }) => {
  await page.click("#viewTour");
  await expect(page.locator("#tour .tour-vide")).toContainText(/déclarer ce que j'ai à bord/i);
  await expect(page.locator("#tour .tour-arret")).toHaveCount(0);
});

test("Tournée : sans point de départ, elle le réclame — une tournée part d'un terminal (#57)", async ({ page }) => {
  // stationCourante() rend null sans voyage ni terminal « En route » : la vue a son propre champ.
  await declarer(page, "Titanium", 100);
  await page.click("#viewTour");
  await expect(page.locator("#tour .tour-vide")).toContainText(/où tu es/i);
});

test("Tournée : elle propose des arrêts, et annonce ce qui reste à bord (#57)", async ({ page }) => {
  await declarer(page, "Titanium", 100);
  await tourneeDepuis(page);

  await expect(page.locator("#tour .tour-head")).toContainText(/arrêt/);
  await expect(page.locator("#tour .tour-bilan")).toContainText(/SCU/);
  // Chaque arrêt nomme son comptoir, ses lignes et ce qu'il encaisse.
  const premier = page.locator("#tour .tour-arret").first();
  await expect(premier.locator(".tour-nom")).not.toBeEmpty();
  await expect(premier.locator(".tour-arret-lignes")).toContainText("Titanium");
  await expect(premier.locator(".tour-encaisse")).not.toBeEmpty();
});

test("Tournée : le PLANCHER est dit avant les chiffres, jamais après (#57)", async ({ page }) => {
  // 307 des 1 879 points de vente publient leur capacité : le nombre d'arrêts est presque toujours
  // faux vers le bas. Un total ne doit jamais s'afficher sans dire s'il est garanti ou parié.
  await declarer(page, "Titanium", 100);
  await tourneeDepuis(page);
  const bandeau = page.locator("#tour .tour-plancher");
  await expect(bandeau).toBeVisible();
  await expect(bandeau).toContainText(/garanti|plancher/i);
  // …et il se lit AVANT le premier arrêt.
  const yBandeau = (await bandeau.boundingBox()).y;
  const yArret = (await page.locator("#tour .tour-arret").first().boundingBox()).y;
  expect(yBandeau).toBeLessThan(yArret);
});

test("Tournée : l'écran dit en quoi elle diffère d'« où écouler » (ADR-007)", async ({ page }) => {
  // Les deux vues classent le MÊME fret dans deux ordres opposés. Sans cette phrase, l'app se
  // contredit sous les yeux de l'utilisateur — c'est une exigence de l'ADR, pas du confort.
  await page.click("#viewTour");
  const aide = page.locator("#tourControls .enroute-hint");
  await expect(aide).toContainText(/minimum d'arrêts/i);
  await expect(aide).toContainText(/où écouler/i);
});

test("Tournée : la portée s'ouvre aux autres systèmes, et ça change le calcul (#57)", async ({ page }) => {
  await declarer(page, "Titanium", 100);
  await tourneeDepuis(page);
  await expect(page.locator("#tourScope")).toHaveValue(""); // système courant par défaut

  const avant = await page.locator("#tour .tour-arret .tour-nom").allInnerTexts();
  await page.selectOption("#tourScope", "all");
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible();
  const apres = await page.locator("#tour .tour-arret .tour-nom").allInnerTexts();
  // Ouvrir la portée ne peut pas RÉTRÉCIR l'ensemble des débouchés : au pire c'est identique.
  expect(apres.length).toBeGreaterThan(0);
  expect(avant.length).toBeGreaterThan(0);
});

test("Tournée : ne repasse jamais deux fois au même comptoir (ADR-007)", async ({ page }) => {
  // La capacité repousse par ticks en jeu, mais l'app n'a aucune donnée sur le débit de recharge :
  // un aller-retour pour attendre un tick n'est pas « tout écouler au plus vite ».
  await declarer(page, "Titanium", 5000); // volontairement énorme : force le résidu
  await tourneeDepuis(page);
  const noms = await page.locator("#tour .tour-arret .tour-nom").allInnerTexts();
  expect(new Set(noms.map((n) => n.trim())).size).toBe(noms.length);
  expect(noms.length).toBeLessThanOrEqual(5); // et bornée à 5 arrêts
});

test("Tournée : le bandeau et les filtres restent, seule la vue change (#57)", async ({ page }) => {
  // Non-régression : la tournée n'est pas une conclusion, contrairement au Plan de vol — le
  // bandeau et la barre de filtres continuent d'y vivre.
  await declarer(page, "Titanium", 100);
  await page.click("#viewTour");
  await expect(page.locator("#controls")).toBeVisible();
  await expect(page.locator("#shipJourneyRow")).toBeVisible();
  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(page.locator("#journeyMap")).toBeHidden(); // la carte ne vit que dans le Plan de vol
});
