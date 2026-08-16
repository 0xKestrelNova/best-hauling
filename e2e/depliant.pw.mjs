import { test, expect } from "@playwright/test";

// Le dépliant 📦 du mode multi-commodité (#30), et sa panne #125.
//
// Les deux tests existants (smoke.pw.mjs:135, autoload.pw.mjs:195) ouvrent, lisent et referment
// SANS aucun re-rendu entre les deux : c'est exactement l'angle mort. Le dépliant était injecté
// dans `#rows` — racine React — par `insertAdjacentHTML`, et React n'en savait rien. Il survivait
// donc aux rendus en devenant faux.

async function modeMulti(page) {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.check("#multiCommodity");
  await expect(page.locator("#rows .route-toggle").first()).toBeVisible({ timeout: 20_000 });
}

// L'état du dépliant, vu du DOM : sous quelle ligne il pend, et si cette ligne est bien celle dont
// le bouton est ouvert.
const etatDepliant = (page) =>
  page.evaluate(() => {
    const s = document.querySelector("#rows tr.schema-row");
    if (!s) return { ouvert: false, orphelin: false };
    const hote = s.previousElementSibling;
    const bouton = document.querySelector("#rows .route-toggle.open");
    return {
      ouvert: true,
      orphelin: !bouton,
      surSonHote: !!bouton && !!hote && hote.contains(bouton),
      nbHote: (hote?.querySelector(".cname")?.textContent || "").trim(),
      entete: (s.querySelector(".suggest-head")?.textContent || "").trim(),
    };
  });

test("Dépliant : il décrit toujours la ligne sous laquelle il pend, même après un tri (#125)", async ({ page }) => {
  await modeMulti(page);
  await page.locator("#rows .route-toggle").first().click();
  await expect(page.locator("#rows tr.schema-row")).toHaveCount(1);

  const avant = await etatDepliant(page);
  expect(avant.surSonHote, "le dépliant ne pend pas sous la ligne qu'on vient d'ouvrir").toBe(true);
  expect(avant.entete).toContain(avant.nbHote); // « Chargement — 3 commodités, … » sous « 3 commodités »

  // Deux clics sur la même colonne inversent le sens du tri (app.js:2463) : le trajet au même rang
  // change. Avec un dépliant posé à la main dans un tableau que React re-rend, il restait en place
  // et se mettait à décrire un AUTRE trajet que sa ligne.
  const colonne = page.locator("th[data-sort]").first();
  await colonne.click();
  await page.waitForTimeout(300);
  await colonne.click();
  await page.waitForTimeout(600);

  const apres = await etatDepliant(page);
  if (apres.ouvert) {
    expect(apres.orphelin, "le dépliant a survécu sans son bouton").toBe(false);
    expect(apres.surSonHote, "le dépliant pend sous une autre ligne que celle qui est ouverte").toBe(true);
    expect(apres.entete, "le dépliant décrit un autre chargement que sa ligne").toContain(apres.nbHote);
  }
});

test("Dépliant : repasser en lignes simples ne laisse pas de ligne fantôme (#125)", async ({ page }) => {
  await modeMulti(page);
  await page.locator("#rows .route-toggle").first().click();
  await expect(page.locator("#rows tr.schema-row")).toHaveCount(1);

  // Les lignes simples n'émettent aucun 📦 : un dépliant qui leur survivrait serait INDÉRACINABLE,
  // le seul retrait passant par un clic sur `.route-toggle`. Et il compterait dans `#rows tr`, sur
  // quoi une vingtaine de sélecteurs de la suite font `.first()` / `.nth(i)`.
  await page.uncheck("#multiCommodity");
  await expect(page.locator("#rows .route-toggle")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(400);

  await expect(page.locator("#rows tr.schema-row")).toHaveCount(0);
});
