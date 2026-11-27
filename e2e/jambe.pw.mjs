import { test, expect } from "@playwright/test";

// LE BOUTON DE JAMBE dit ce qui est à bord, pas seulement ce qui a été payé (#211).
//
// Le registre des chargements survit volontairement au fret (#21) : il porte ce qu'on doit au rayon,
// et c'est lui qui rend le stock à l'annulation. Mais « ⬢ à bord » est une affirmation sur la SOUTE.
// Le voyage est construit par l'interface et aucune commodité n'est nommée.

const lots = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-hold") || "[]"));

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

async function voyageCharge(page) {
  await page.click("#viewEnroute");
  await page.fill("#origin", "Megumi — Pyro");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible({ timeout: 8000 });
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg-load")).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/à bord/i);
}

test("Jambe : vendue à l'escale, elle ne se dit plus « à bord » (#211)", async ({ page }) => {
  await voyageCharge(page);
  await page.locator("#journeyCard .jstep").nth(1).click(); // à B
  await page.locator("#journeyCard .jstep").nth(2).click(); // je repars : B reprend tout
  expect((await lots(page)).filter((l) => (l.leg || "").startsWith("0|"))).toEqual([]);

  const bouton = page.locator("#journeyCard .jleg-load").first();
  await expect(bouton).not.toHaveText(/à bord/i);
  await expect(bouton).toHaveText(/payé/i);
  // Le clic garde son sens, et l'infobulle le dit : annuler l'ACHAT, rendre le stock au départ.
  await expect(bouton).toHaveAttribute("title", /annuler l'achat/i);
});

test("Jambe : vendue en partie, il en reste à bord — elle le dit encore (#211)", async ({ page }) => {
  await voyageCharge(page);
  await page.locator("#journeyCard .jstep").nth(1).click();
  await page.locator("#holdCard .hold-sell-btn").first().click();
  const total = Number(await page.locator("#holdCard .hold-sell").first().getAttribute("data-total"));
  await page.locator("#holdCard .hold-rest-qty").first().fill(String(Math.max(1, total - 10)));
  await page.locator("#holdCard .hold-sell-ok").first().click();
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/à bord/i);
});
