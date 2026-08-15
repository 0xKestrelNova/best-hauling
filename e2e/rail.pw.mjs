import { test, expect } from "@playwright/test";

// La hiérarchie du rail (#45). Huit vues se sont accumulées une par une, chacune ajoutée en fin de
// liste : l'ordre raconte l'historique du dépôt, pas la parenté des vues. « En route » est une
// lecture des trajets depuis un point de départ, pas une famille à part ; « Corrections » est un
// réglage, et passait avant les vues d'analyse.
//
// Le rail se lit maintenant du général au particulier, et les réglages ferment la marche :
//   recherche de fret │ marché │ soute │ conclusion │ réglage
//
// Ces tests tiennent l'INVARIANT que le réordonnancement doit préserver : un numéro affiché
// désigne la touche qui l'active. Sans lui, autant retirer les numéros.

const ORDRE = ["routes", "enroute", "loops", "chain", "commodities", "tour", "plan", "corrections"];

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("Rail : les huit vues se suivent du général au particulier, réglages en dernier (#45)", async ({ page }) => {
  const vus = await page.locator(".rail-nav .vbtn").evaluateAll((els) => els.map((e) => e.dataset.view));
  expect(vus).toEqual(ORDRE);
});

test("Rail : « En route » se donne pour une sous-entrée de Trajets (#45)", async ({ page }) => {
  await expect(page.locator("#viewEnroute")).toHaveClass(/vbtn-sub/);
  // Une seule sous-entrée : le rail a deux niveaux, pas trois, et rien d'autre ne s'indente.
  await expect(page.locator(".rail-nav .vbtn-sub")).toHaveCount(1);

  // Le filet passe par un ::before et NON par border-left : celui-ci est déjà l'accent de
  // .vbtn.active (style.css), et le marqueur de sous-niveau se serait évanoui pile quand la vue
  // est active — c'est-à-dire quand on la regarde.
  const filet = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("viewEnroute"), "::before");
      return { largeur: parseFloat(cs.width), contenu: cs.content };
    });

  const auRepos = await filet();
  expect(auRepos.contenu).not.toBe("none");
  expect(auRepos.largeur).toBeGreaterThan(0);

  await page.click("#viewEnroute");
  await expect(page.locator("#viewEnroute")).toHaveClass(/active/);
  const actif = await filet();
  expect(actif.largeur).toBeGreaterThan(0); // survit à l'état actif
});

test("Rail : chaque numéro affiché désigne la touche qui l'ouvre, des huit côtés (#45)", async ({ page }) => {
  for (let n = 1; n <= 8; n++) {
    await page.keyboard.press(String(n));
    const actif = page.locator(".rail-nav .vbtn.active");
    await expect(actif, `la touche ${n} n'active pas exactement une vue`).toHaveCount(1);
    await expect(actif.locator(".rn"), `le numéro affiché ne suit pas la touche ${n}`)
      .toHaveText(String(n).padStart(2, "0"));
    // Le title l'annonce aussi : les trois doivent dire la même chose.
    await expect(actif).toHaveAttribute("title", new RegExp(`raccourci\\s*:\\s*${n}\\b`));
    await expect(actif).toHaveAttribute("data-view", ORDRE[n - 1]);
  }
});

test("Rail : Corrections porte enfin son numéro, compteur compris (#45)", async ({ page }) => {
  // Le balisage mort de l'ancien rail : updateOvBadge() écrasait tout le contenu du bouton en
  // textContent, détruisant le <span class="rn"> posé dans index.html. Le numéro de Corrections
  // n'a jamais existé à l'écran — le réordonnancement ne vaut rien s'il le laisse muet.
  await expect(page.locator("#viewCorrections .rn")).toHaveText("08");
  await expect(page.locator("#viewCorrections .rl")).toHaveText("✎ Corrections");

  const cell = page.locator("#rows .editv").first();
  await cell.click();
  await cell.locator("input").fill("12345");
  await page.keyboard.press("Enter");

  // Après réécriture du bouton par updateOvBadge : le numéro tient, le compteur arrive.
  await expect(page.locator("#viewCorrections .rn")).toHaveText("08");
  await expect(page.locator("#viewCorrections .rl")).toHaveText("✎ Corrections (1)");
  // Et le compteur reste dans le NOM ACCESSIBLE. Le libellé passant en .rl (masqué au repli),
  // le bouton gagne un aria-label tenu à jour — même patron que #share.
  await expect(page.locator("#viewCorrections")).toHaveAccessibleName(/Corrections \(1\)/);
});

test("Rail rétracté : les huit entrées restent distinctes, et le repli survit au rechargement (#45)", async ({ page }) => {
  await page.click("#railToggle");
  await expect(page.locator("#app")).toHaveClass(/rail-collapsed/);

  // Le cas le plus contraint : 68 px, tous les .rl masqués. Les huit doivent rester cliquables.
  for (const v of ORDRE) {
    const btn = page.locator(`.rail-nav .vbtn[data-view="${v}"]`);
    await expect(btn, `${v} a disparu du rail rétracté`).toBeVisible();
    const boite = await btn.boundingBox();
    expect(boite.width, `${v} déborde des 68 px du rail rétracté`).toBeLessThanOrEqual(68);
  }

  // La parenté ne doit pas être le seul retrait typographique : replié, il n'en reste rien.
  const largeurFilet = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById("viewEnroute"), "::before").width));
  expect(largeurFilet).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("#app")).toHaveClass(/rail-collapsed/);
  await expect(page.locator("#viewEnroute")).toHaveClass(/vbtn-sub/);
});

test("Rail horizontal : la sous-entrée garde un marqueur quand le rail passe en ligne (#45)", async ({ page }) => {
  // Sous 820 px, .rail-nav bascule en flex-direction: row — une indentation verticale n'y veut
  // plus rien dire. Le filet, lui, borde le côté qui touche Trajets.
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator(".rail-nav")).toHaveCSS("flex-direction", "row");

  const largeurFilet = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById("viewEnroute"), "::before").width));
  expect(largeurFilet).toBeGreaterThan(0);

  // Et l'ordre tient : en ligne, la sous-entrée suit immédiatement son parent.
  const vus = await page.locator(".rail-nav .vbtn").evaluateAll((els) => els.map((e) => e.dataset.view));
  expect(vus.slice(0, 2)).toEqual(["routes", "enroute"]);
});
