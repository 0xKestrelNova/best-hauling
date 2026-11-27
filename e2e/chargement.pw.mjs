import { test, expect } from "@playwright/test";

// CHARGER AVEC DU FRET DÉJÀ À BORD (#210, audit du 2026-11-27).
//
// Le voyage est construit par l'interface (départ Megumi, manifeste d'En route, première
// suggestion d'arrêt) et aucune commodité n'est nommée : l'amorce change à chaque régénération.

const lots = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-hold") || "[]"));
const scuDe = (ls) => ls.reduce((s, l) => s + l.units, 0);
// Les SCU qu'une jambe ANNONCE dans son en-tête : « 2 SCU … 21 SCU … ».
const scuAnnonces = (texte) =>
  [...texte.matchAll(/(\d[\d\s  ]*)\s*SCU/g)].reduce((s, m) => s + Number(m[1].replace(/\D/g, "")), 0);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("Soute : charger la jambe suivante avec un reste à bord ne dépasse pas la soute (#210)", async ({ page }) => {
  // Avant : `legManifest` chiffrait la jambe sur la capacité TOTALE, et `loadHold` chargeait sans
  // plafond — 90 SCU invendus + la jambe suivante donnaient 123 SCU dans une soute de 96.
  const cargo = Number(await page.locator("#cargo").inputValue());
  await page.click("#viewEnroute");
  await page.fill("#origin", "Megumi — Pyro");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible({ timeout: 8000 });
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg-load")).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jleg-load")).toHaveCount(2); // les deux jambes ont du fret

  await page.locator("#journeyCard .jleg-load").first().click();
  await page.locator("#journeyCard .jstep").nth(1).click(); // à B

  // Vente partielle : presque tout reste. 6 SCU de place libre, pas un rond.
  await page.locator("#holdCard .hold-sell-btn").first().click();
  const total = Number(await page.locator("#holdCard .hold-sell").first().getAttribute("data-total"));
  await page.locator("#holdCard .hold-rest-qty").first().fill(String(total - 6));
  await page.locator("#holdCard .hold-sell-ok").first().click();
  const reste = scuDe(await lots(page));
  const libre = cargo - reste;
  expect(libre).toBe(6);

  // La jambe 1 en annonce PLUS que la place libre : sans ça le test ne prouverait rien.
  const annonce = scuAnnonces(await page.locator("#journeyCard .jleg-cargo").nth(1).innerText());
  expect(annonce).toBeGreaterThan(libre);

  await page.locator("#journeyCard .jleg-load").nth(1).click();
  const apres = await lots(page);
  expect(scuDe(apres)).toBe(cargo); // pleine, et pas un SCU de plus
  await expect(page.locator(".toast")).toContainText(/laissé/i); // ce qui n'a pas été pris est DIT

  // La jambe se fige sur ce qui a VRAIMENT été chargé : elle ne promet plus ce qui est resté au rayon.
  const chargeJ1 = scuDe(apres.filter((l) => (l.leg || "").startsWith("1|")));
  expect(chargeJ1).toBe(libre);
  expect(scuAnnonces(await page.locator("#journeyCard .jleg-cargo").nth(1).innerText())).toBe(chargeJ1);
});
