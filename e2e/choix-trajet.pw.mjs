import { test, expect } from "@playwright/test";

// Le bouton ▶ — « faire ce trajet » — dans les tables qui le portent.
//
// Il est le pont entre un tableau et le compagnon de voyage, et c'était le geste le moins gardé du
// dépôt : sur les 28 clics `.journey-pick` que comptait la suite, aucun ne visait le mode
// multi-commodité ni « En route », et aucun ne recliquait après un changement de tri. Trois
// branches sur quatre de l'ancienne délégation étaient donc aveugles.
//
// Ce qui rendait le trou dangereux : chaque branche indexait un tableau global par le RANG de la
// ligne (`data-row`). Un rang qui ne correspond plus à son tableau ne casse rien de visible — il
// ouvre simplement le mauvais trajet. Ces tests comparent donc les deux bouts de la ligne CLIQUÉE
// aux étapes du parcours obtenu ; ils gardent ce contrat quel que soit le mécanisme derrière.

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

// Les deux bouts d'une ligne, tels qu'elle les affiche.
const boutsDe = (ligne) => ligne.locator(".term-name").allTextContents();

// Les étapes du parcours, dans l'ordre.
const etapes = (page) => page.locator("#journeyCard .jstep").allTextContents();

test("▶ en mode MULTI-COMMODITÉ ajoute le trajet de SA ligne (#96)", async ({ page }) => {
  await page.check("#multiCommodity");
  // On attend `.route-toggle`, PAS `.journey-pick` : le ▶ est partagé avec les lignes simples, donc
  // l'attendre laisserait le test vert sur un tableau resté en mode simple — c'est-à-dire
  // exactement la régression #25 que ce test doit voir. Le 📦 n'est émis que par `LigneComposee`.
  await expect(page.locator("#rows .route-toggle").first()).toBeVisible({ timeout: 20_000 });

  const ligne = page.locator("#rows tr").first();
  const bouts = await boutsDe(ligne);
  expect(bouts, "la ligne multi n'affiche pas ses deux bouts").toHaveLength(2);
  await ligne.locator(".journey-pick").click();

  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  expect(await etapes(page)).toEqual(bouts);
});

test("▶ dans « En route » ajoute le trajet de SA ligne (#96)", async ({ page }) => {
  // Le second appelant de `vueTrajets` (`#enrouteRows`), que rien ne gardait : les deux tables à
  // lignes simples partagent leur rendu ET leurs props — un rappel posé sur un seul des deux sites
  // ferait taire ce ▶-ci.
  await page.click("#viewEnroute");
  await expect(page.locator("#originList option").first()).toBeAttached({ timeout: 10_000 });
  await page.fill("#origin", await page.locator("#originList option").first().getAttribute("value"));

  // On laisse le tableau se remplir AVANT de conclure : compter tout de suite renverrait zéro sur
  // un rendu simplement pas encore arrivé, et le saut ci-dessous avalerait le test au lieu de le
  // protéger. Le jeu de données étant régénéré chaque jour, ce terminal peut n'avoir aucun fret
  // rentable — on saute alors plutôt que d'échouer, sinon une régression de DONNÉES se lirait
  // comme une régression du ▶ (le dépôt a déjà tranché ce cas, cf. e2e/smoke.pw.mjs:371).
  const lignes = page.locator("#enrouteRows .journey-pick");
  await lignes.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  test.skip(!(await lignes.count()), "aucun fret rentable depuis ce terminal avec ces filtres");

  const ligne = page.locator("#enrouteRows tr").first();
  const bouts = await boutsDe(ligne);
  expect(bouts).toHaveLength(2);
  await ligne.locator(".journey-pick").click();

  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  expect(await etapes(page)).toEqual(bouts);
});

test("▶ suit sa ligne quand le classement change (#96)", async ({ page }) => {
  // L'invariant central du lot. Le tri est une MISE EN SCÈNE, donc on vérifie qu'elle a bien eu
  // lieu : sans ça, le test passerait aussi le jour où les deux clics de tri ne changeraient plus
  // rien, et il garderait une situation qui ne se produit jamais.
  const ligne = page.locator("#rows tr").first();
  const avant = await boutsDe(ligne);

  const colonne = page.locator("th[data-sort]").first();
  await colonne.click();
  await page.waitForTimeout(300);
  await colonne.click(); // sens inversé
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.waitForTimeout(300);

  const apres = await boutsDe(ligne);
  expect(apres, "le tri n'a pas changé la première ligne : le test ne prouverait rien").not.toEqual(avant);

  await ligne.locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  expect(await etapes(page)).toEqual(apres);
});
