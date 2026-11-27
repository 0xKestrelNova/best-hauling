import { test, expect } from "@playwright/test";

// L'ESCALE : ce qui se passe au comptoir, et ce que le départ en fait (audit du 2026-11-27).
//
// Tous ces tests jouent le même voyage à trois escales, construit par l'interface elle-même :
// départ Megumi, le manifeste d'En route envoyé au voyage, puis la première suggestion d'arrêt.
// Ils ne nomment AUCUNE commodité ni aucune escale d'arrivée : ce que l'amorce propose aujourd'hui
// changera à la prochaine régénération, et un test qui en dépendrait tomberait sans qu'aucun code
// ait bougé (leçon payée sur `smoke.pw.mjs`).

const lots = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-hold") || "[]"));
const scuDe = (ls) => ls.reduce((s, l) => s + l.units, 0);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

/** Voyage A → B → C, la jambe 0 chargée, et l'on se pose à B. Rend les SCU chargés. */
async function arriveeAvecFret(page) {
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
  await page.locator("#journeyCard .jstep").nth(1).click(); // on se pose à B
  expect(scuDe(await lots(page))).toBe(charge); // arriver ne vend rien : c'est REPARTIR qui vend
  return charge;
}

/** Ouvre le formulaire de vente de la première commodité ; il faut que B la reprenne. */
async function ouvrirVente(page) {
  await page.locator("#holdCard .hold-sell-btn").first().click();
  await expect(page.locator("#holdCard .hold-sell-ok").first()).toBeVisible(); // B la reprend
}

// ---------- #209 : un comptoir qui ne reprend rien ----------

test("Escale : vendre 0 SCU déclare un refus, et le départ garde la soute (#209)", async ({ page }) => {
  // Avant : `vendreIci` sortait sur `if (!r.vendu) return;` AVANT de poser le marqueur. Le geste
  // était muet, et le clic suivant sur l'étape vendait tout — comme si le comptoir avait repris.
  const charge = await arriveeAvecFret(page);
  await ouvrirVente(page);
  const total = await page.locator("#holdCard .hold-sell").first().getAttribute("data-total");
  await page.locator("#holdCard .hold-rest-qty").first().fill(total); // tout reste : rien ne part
  await page.locator("#holdCard .hold-sell-ok").first().click();

  await expect(page.locator("#holdCard .hold-refus").first()).toBeVisible(); // le refus SE VOIT
  expect((await lots(page)).every((l) => l.refuse)).toBe(true);

  await page.locator("#journeyCard .jstep").nth(2).click(); // je repars
  expect(scuDe(await lots(page))).toBe(charge);
});

test("Escale : « ✗ rien repris » garde le fret à bord au départ, et dit jusqu'à quand (#209)", async ({ page }) => {
  const charge = await arriveeAvecFret(page);
  await ouvrirVente(page);
  await page.locator("#holdCard .hold-refuse").first().click();

  // Le formulaire se referme, la ligne porte le refus et son échéance (3 h : DUREE_VOL).
  await expect(page.locator("#holdCard .hold-sell.open")).toHaveCount(0);
  const badge = page.locator("#holdCard .hold-refus").first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/refusé ici/i);
  await expect(badge).toContainText(/\d h|\d+ min/);

  await page.locator("#journeyCard .jstep").nth(2).click();
  expect(scuDe(await lots(page))).toBe(charge);
  // Plus à B : le marqueur ne vaut que pour SON comptoir, la ligne ne le montre plus.
  await expect(page.locator("#holdCard .hold-refus")).toHaveCount(0);
});

test("Escale : un refus déclaré n'empêche pas de vendre quand même, à la main (#209)", async ({ page }) => {
  // Le marqueur protège du départ, pas de l'utilisateur : un geste explicite passe outre.
  await arriveeAvecFret(page);
  await ouvrirVente(page);
  await page.locator("#holdCard .hold-refuse").first().click();
  await ouvrirVente(page);
  await page.locator("#holdCard .hold-sell-ok").first().click(); // « partent » ouvre sur le total
  expect(scuDe(await lots(page))).toBe(0);
});
