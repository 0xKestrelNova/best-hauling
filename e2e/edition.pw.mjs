import { test, expect } from "@playwright/test";

// L'édition sur place DANS UN ÎLOT REACT (ADR-008 #96).
//
// C'était le dernier mécanisme qui empêchait de migrer une vue : `startEdit` (app.js) MUTE le nœud
// (`span.replaceChildren(inp)`) depuis une délégation posée sur `document`. Un nœud possédé par
// React et muté hors de React, c'est la seule situation où les deux modèles se contredisent
// vraiment — React ne sait pas que le DOM a bougé et écraserait la saisie au rendu suivant.
//
// Aucun test n'exerçait l'édition ailleurs que dans la vue Trajets (`#rows`), restée vanilla. Ce
// fichier couvre le pendant React, dans le détail du board Commodités, et il vérifie les TROIS
// comportements que la version impérative avait durement acquis — chacun payé par un bug du dépôt.

async function detailOuvert(page) {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#commDetail .comm-points tbody tr").first()).toBeVisible({ timeout: 20000 });
}

const compteur = (page) => page.locator("#viewCorrections .rl").innerText();

test("Édition React : cliquer une valeur ouvre un champ, Entrée l'enregistre (#96)", async ({ page }) => {
  await detailOuvert(page);
  const avant = await compteur(page);

  const cellule = page.locator("#commDetail .comm-points tbody .editv").first();
  await cellule.click();
  const champ = cellule.locator("input.editv-input");
  await expect(champ, "le clic n'a pas ouvert de champ — la délégation a-t-elle été rendue inerte ?").toBeVisible();

  await champ.fill("4321");
  await champ.press("Enter");

  await expect.poll(() => compteur(page), { timeout: 5000 }).not.toBe(avant);
  await expect(page.locator("#viewCorrections .rl")).toContainText("(1)");
});

test("Édition React : CONSULTER un chiffre n'écrit rien (#96)", async ({ page }) => {
  // Le comportement payé par un vrai bug : sans comparaison de valeur, cliquer un chiffre puis
  // cliquer ailleurs créait une correction locale IDENTIQUE au relevé UEX — compteur, marqueur ✎,
  // et plus tard un toast « correction périmée » à propos d'une correction fantôme.
  await detailOuvert(page);
  await expect(page.locator("#viewCorrections .rl")).toHaveText("Corrections");

  const cellule = page.locator("#commDetail .comm-points tbody .editv").first();
  await cellule.click();
  await expect(cellule.locator("input.editv-input")).toBeVisible();
  await page.locator("h1").click(); // on quitte sans rien changer

  await expect(page.locator("#viewCorrections .rl"), "consulter a créé une correction fantôme").toHaveText("Corrections");
});

test("Édition React : Échap annule sans re-rendre toute la vue (#96)", async ({ page }) => {
  // L'autre comportement acquis : un refresh() global détruirait le nœud entre le mousedown et le
  // mouseup, ce qui avalait le clic suivant sur une AUTRE cellule. On vérifie donc qu'après une
  // annulation, la cellule voisine s'ouvre du premier coup.
  await detailOuvert(page);
  const cellules = page.locator("#commDetail .comm-points tbody .editv");

  await cellules.nth(0).click();
  await expect(cellules.nth(0).locator("input.editv-input")).toBeVisible();
  await cellules.nth(0).locator("input.editv-input").press("Escape");
  await expect(cellules.nth(0).locator("input.editv-input")).toHaveCount(0);

  await cellules.nth(1).click();
  await expect(
    cellules.nth(1).locator("input.editv-input"),
    "le clic suivant a été avalé — l'annulation a re-rendu la vue au lieu de rendre la main"
  ).toBeVisible();

  await expect(page.locator("#viewCorrections .rl")).toHaveText("Corrections");
});

test("Édition React : la valeur corrigée porte son marqueur et survit au re-rendu (#96)", async ({ page }) => {
  await detailOuvert(page);
  const cellule = page.locator("#commDetail .comm-points tbody .editv").first();
  await cellule.click();
  await cellule.locator("input.editv-input").fill("777");
  await cellule.locator("input.editv-input").press("Enter");

  // Le ✎ reste DANS le span : le sortir casserait la restauration (#30).
  const corrigee = page.locator("#commDetail .comm-points tbody .editv.ov").first();
  await expect(corrigee).toBeVisible();
  await expect(corrigee.locator(".ovmark")).toHaveCount(1);
  await expect(corrigee).toContainText("777");

  // Et elle survit à un re-rendu déclenché d'ailleurs — c'est tout l'intérêt d'une correction.
  await page.click("#viewRoutes");
  await page.click("#viewCommodities");
  await expect(page.locator("#commDetail .comm-points tbody .editv.ov").first()).toContainText("777");
});

test("Édition React : app.js ne vient PAS muter un nœud possédé par React (#96)", async ({ page }) => {
  // Le garde qui rend tout le reste possible : les deux délégations de app.js ignorent un `.editv`
  // marqué `data-react`. S'il sautait, `startEdit` muterait le nœud — et le symptôme serait un
  // DOUBLE champ, ou une saisie écrasée au rendu suivant.
  await detailOuvert(page);
  const cellule = page.locator("#commDetail .comm-points tbody .editv").first();
  await expect(cellule).toHaveAttribute("data-react", "1");

  await cellule.click();
  await expect(cellule.locator("input.editv-input"), "deux champs : startEdit est venu muter le nœud React").toHaveCount(1);

  // Et il n'y a plus AUCUN `.editv` en dehors de React : le manifeste était le dernier écrit en
  // HTML par app.js, il est passé à l'îlot avec la carte. `editv()` et `startEdit()` ont donc été
  // supprimés — ce test est ce qui autorise leur suppression, et ce qui la rattraperait si un
  // rendu impératif revenait par la bande.
  const vues = ["#viewRoutes", "#viewLoops", "#viewChain", "#viewCommodities", "#viewCorrections", "#viewTour", "#viewPlan"];
  for (const v of vues) {
    await page.click(v);
    await page.waitForTimeout(150);
  }
  await page.click("#viewRoutes");
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await page.click("#viewEnroute");
  await expect(page.locator("#manifest .editv").first()).toBeVisible({ timeout: 8000 });

  const orphelins = await page.evaluate(() =>
    [...document.querySelectorAll(".editv")].filter((e) => !e.dataset.react).length);
  expect(orphelins, "un `.editv` n'est pas possédé par React — startEdit a été supprimé, il ne s'ouvrira pas").toBe(0);
});
