import { test, expect } from "@playwright/test";

// Le pont entre app.js et le premier îlot React (pont.js, ADR-008 #96).
//
// Ces tests ne regardent pas une apparence : ils regardent la PROPRIÉTÉ qui rend la cohabitation
// tenable. Le dépôt a déjà payé cher la classe de bug visée — #24, #28, #38 et #55 sont tous des
// variantes de « un re-rendu global efface ce que l'utilisateur était en train de faire », et
// quatre tests de smoke.pw.mjs n'existent que pour ça.
//
// Le piège propre à React : `createRoot(el)` rappelé à chaque rendu REMONTE l'arbre au lieu de le
// réconcilier. On reperdrait valeur et focus — c'est-à-dire qu'on réintroduirait ces quatre bugs
// par l'outil même censé les supprimer. Et aucun test d'apparence ne le verrait : le DOM final est
// identique, seul son IDENTITÉ change.

async function souteDeclaree(page, scu = 400) {
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  await expect.poll(() => page.locator("#commodityList option").count()).toBeGreaterThan(0);
  const nom = await page.evaluate(() => document.querySelector("#commodityList option").value);
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", String(scu));
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("Pont : un re-rendu ne remonte PAS l'arbre React (#96)", async ({ page }) => {
  // On marque un nœud rendu par React, on provoque un refresh() par un geste d'une AUTRE vue, et
  // on vérifie que c'est le MÊME nœud. Si la racine était recréée, le marqueur disparaîtrait —
  // signe que React a jeté son arbre au lieu de le réconcilier.
  await souteDeclaree(page);
  await page.click("#viewTour");
  await page.fill("#tourFrom", "Megumi");
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => { document.querySelector("#tour .tour-arret").dataset.temoin = "1"; });

  // Un geste qui passe par refresh() sans toucher à la Tournée : la soute est dans le bandeau,
  // présent dans les huit vues.
  await page.fill("#cargo", "120");
  await page.waitForTimeout(400);

  await expect(
    page.locator('#tour .tour-arret[data-temoin="1"]'),
    "l'arbre React a été remonté : la racine est recréée à chaque rendu au lieu d'être mémorisée"
  ).toHaveCount(1);
});

test("Pont : les gestes des autres vues traversent jusqu'à la vue React (#96)", async ({ page }) => {
  // L'autre sens : app.js écrit l'état, refresh() repeint, et l'îlot doit suivre. Sans ça la vue
  // React afficherait des chiffres périmés — la panne la plus sournoise possible ici, puisque tout
  // paraîtrait normal.
  await souteDeclaree(page, 400);
  await page.click("#viewTour");
  await page.fill("#tourFrom", "Megumi");
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible({ timeout: 15000 });
  const avant = await page.locator("#tour .tour-bilan").innerText();

  // On DÉCLARE un second lot depuis le bandeau — un geste vanilla, dans une zone que la vue React
  // ne connaît pas. Il écrit SOUTE, appelle refresh(), et le bilan de la tournée doit suivre.
  // (Ouvrir la portée ne conviendrait pas : depuis Megumi la tournée est déjà optimale en un
  // arrêt, donc le bilan ne bougerait pas — le test passerait sans rien prouver.)
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  const second = await page.evaluate(() => document.querySelectorAll("#commodityList option")[1].value);
  await page.fill("#holdAddName", second);
  await page.fill("#holdAddScu", "150");
  await page.locator("#holdAddOk").click();

  await expect
    .poll(() => page.locator("#tour .tour-bilan").innerText())
    .not.toBe(avant);
});

test("Pont : la vue React survit à l'aller-retour entre vues (#96)", async ({ page }) => {
  // switchView masque la section par `hidden`, il ne la vide pas. La racine React reste montée sur
  // un conteneur caché, et doit repeindre correctement au retour.
  await souteDeclaree(page);
  await page.click("#viewTour");
  await page.fill("#tourFrom", "Megumi");
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible({ timeout: 15000 });
  const arrets = await page.locator("#tour .tour-arret").count();

  await page.click("#viewRoutes");
  await expect(page.locator("#tour")).toBeHidden();
  await page.click("#viewTour");
  await expect(page.locator("#tour")).toBeVisible();
  await expect(page.locator("#tour .tour-arret")).toHaveCount(arrets);
});

test("Pont : les messages vides passent AUSSI par React (#96)", async ({ page }) => {
  // Une seule branche restée en innerHTML sur un conteneur possédé par React se ferait écraser au
  // rendu suivant, silencieusement — et seulement dans certains enchaînements.
  await page.click("#viewTour");
  await expect(page.locator("#tour .tour-vide")).toContainText(/déclarer ce que j'ai à bord/i);

  await souteDeclaree(page);
  await expect(page.locator("#tour .tour-vide")).toContainText(/où tu es/i);

  await page.fill("#tourFrom", "Megumi");
  await expect(page.locator("#tour .tour-arret").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#tour .tour-vide")).toHaveCount(0);
});
