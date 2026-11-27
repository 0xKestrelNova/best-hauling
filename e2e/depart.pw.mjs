import { test, expect } from "@playwright/test";

// LE DÉPART D'UNE ESCALE : annoncé avant le clic, annulable après (#212, audit du 2026-11-27).
//
// La vente au départ reste (ADR-002 : avancer vaut « j'ai fait mon affaire ici »). Ce qui change,
// c'est qu'elle n'est plus ni invisible ni définitive. Le voyage est construit par l'interface et
// aucune commodité n'est nommée.

const lots = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-hold") || "[]"));
const scuDe = (ls) => ls.reduce((s, l) => s + l.units, 0);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

/** Voyage A → B → C, jambe 0 chargée, on est encore à A. Rend les SCU chargés. */
async function voyageCharge(page) {
  await page.click("#viewEnroute");
  await page.fill("#origin", "Megumi — Pyro");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible({ timeout: 8000 });
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg-load")).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  await page.locator("#journeyCard .jleg-load").first().click();
  const charge = scuDe(await lots(page));
  expect(charge).toBeGreaterThan(0);
  return charge;
}

test("Départ : ce que repartir vendra est annoncé AVANT le clic (#212)", async ({ page }) => {
  const charge = await voyageCharge(page);
  // À A, rien ne s'y revend : aucune annonce.
  await expect(page.locator("#journeyCard .jdepart-apercu")).toHaveCount(0);
  await page.locator("#journeyCard .jstep").nth(1).click(); // à B, qui reprend le fret de la jambe
  const apercu = page.locator("#journeyCard .jdepart-apercu");
  await expect(apercu).toBeVisible();
  await expect(apercu).toContainText(/repartir/i);
  await expect(apercu).toContainText(String(charge));
  expect(scuDe(await lots(page))).toBe(charge); // annoncer n'est pas vendre
});

test("Départ : la vente du départ s'annule, soute ET position rétablies (#212)", async ({ page }) => {
  const charge = await voyageCharge(page);
  await page.locator("#journeyCard .jstep").nth(1).click(); // à B
  await page.locator("#journeyCard .jstep").nth(2).click(); // je repars : B reprend tout
  expect(scuDe(await lots(page))).toBeLessThan(charge);

  const annuler = page.locator("#toast .toast-action");
  await expect(annuler).toBeVisible();
  await expect(annuler).toContainText(/annuler/i);
  await annuler.click();

  expect(scuDe(await lots(page))).toBe(charge);
  await expect(page.locator("#journeyCard .jstep").nth(1)).toHaveClass(/here/); // de retour à B
  await expect(page.locator("#toast")).toContainText(/annulé/i);
});

test("Départ : sauter une escale ne vend rien, et le message le dit (#212)", async ({ page }) => {
  const charge = await voyageCharge(page);
  const sautee = (await page.locator("#journeyCard .jstep").nth(1).innerText()).trim();
  await page.locator("#journeyCard .jstep").nth(2).click(); // de A directement à C
  expect(scuDe(await lots(page))).toBe(charge);
  const toast = page.locator("#toast");
  await expect(toast).toContainText(/sautée/i);
  await expect(toast).toContainText(new RegExp(sautee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});
