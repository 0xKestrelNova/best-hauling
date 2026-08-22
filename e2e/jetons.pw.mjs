import { test, expect } from "@playwright/test";

// Le pendant à l'exécution de scripts/jetons.test.mjs. Celui-là lit la SOURCE ; celui-ci lit ce que
// le NAVIGATEUR calcule, sur le site RÉELLEMENT PRODUIT (la suite sert dist/). Les deux sont
// nécessaires et ne disent pas la même chose : une source juste peut rendre une valeur fausse si une
// règle la surcharge, si une couche CSS l'emporte, ou si un outil de build réécrit la déclaration.
//
// C'est ce dernier cas qui motive ce fichier : la refonte v2 va poser Tailwind par-dessus. Une
// déclaration hors @layer bat TOUTE déclaration layered, quelle que soit la spécificité — donc le
// thème peut être parfaitement écrit et parfaitement ignoré, sans erreur ni test rouge.

// Le contrat, en valeurs calculées. Le navigateur normalise les hex en rgb().
const JETONS = {
  "--acc": "#ffb020",
  "--acc-2": "#a970ff",
  "--good": "#46e5a0",
  "--warn": "#f5a742",
  "--bad": "#ff5d5d",
  "--text": "#e8ecf5",
  "--muted": "#8a93a8",
  "--stanton": "#38bdf8",
  "--pyro": "#ff6a3d",
  "--nyx": "#a970ff",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("Jetons : le HUD rend EXACTEMENT ses couleurs d'identité (#96)", async ({ page }) => {
  const lus = await page.evaluate((noms) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(noms.map((n) => [n, cs.getPropertyValue(n).trim().toLowerCase()]));
  }, Object.keys(JETONS));
  expect(lus).toEqual(JETONS);
});

test("Jetons : les canaux décrivent la même couleur que les hex (#96)", async ({ page }) => {
  // Les deux formes doivent rester en phase : c'est le hex que le JavaScript écrit dans les SVG,
  // et les canaux que les déclinaisons alpha consomment. Si elles divergent, la moitié du site
  // prend une teinte et l'autre moitié une autre — sans qu'aucune erreur ne soit levée.
  // Même liste que scripts/jetons.test.mjs : les teintes réellement DÉCLINÉES. `--text` sert
  // d'encre pleine et n'apparaît à aucune opacité — lui donner un jumeau créerait un jeton mort.
  const DECLINABLES = Object.keys(JETONS).filter((n) => n !== "--text");
  const ecarts = await page.evaluate((noms) => {
    const cs = getComputedStyle(document.documentElement);
    const out = [];
    for (const n of noms) {
      const hex = cs.getPropertyValue(n).trim();
      const canaux = cs.getPropertyValue(n + "-rgb").trim();
      if (!canaux) { out.push(`${n}-rgb absent`); continue; }
      const [r, g, b] = canaux.split(/\s+/).map(Number);
      const attendu = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (attendu.toLowerCase() !== hex.toLowerCase()) out.push(`${n}: ${hex} vs ${n}-rgb ${canaux}`);
    }
    return out;
  }, DECLINABLES);
  expect(ecarts, "hex et canaux ont divergé").toEqual([]);
});

test("Jetons : les trois polices du HUD sont bien celles qui s'appliquent (#96)", async ({ page }) => {
  // Pas la variable — la police RÉELLEMENT appliquée à un élément. Une @font-face qui ne charge
  // plus (nom haché par le build, CSP font-src) laisse la variable intacte et le rendu en repli.
  const applique = await page.evaluate(() => ({
    corps: getComputedStyle(document.body).fontFamily,
    titre: getComputedStyle(document.querySelector(".brand-name") || document.querySelector("h1")).fontFamily,
    mono: getComputedStyle(document.querySelector(".rn")).fontFamily,
  }));
  expect(applique.corps).toContain("Chakra Petch");
  expect(applique.titre).toContain("Orbitron");
  expect(applique.mono).toContain("JetBrains Mono");

  // Et les fichiers de police répondent vraiment : `font-src 'self'` les autorise, encore faut-il
  // que le build les ait émis sous le nom que le CSS demande.
  const polices = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".woff2")).length
  );
  expect(polices, "aucune woff2 chargée — le HUD est rendu avec les polices de repli").toBeGreaterThan(0);
});

test("Jetons : la couleur par SYSTÈME arrive jusqu'au SVG de la carte (#96)", async ({ page }) => {
  // app.js écrit littéralement « var(--stanton) » dans des attributs fill= et stroke= (SYS_TEINTE).
  // Renommer ce jeton ne casse rien de visible en test : le fill devient simplement invalide et les
  // planètes retombent en noir sur fond sombre — elles DISPARAISSENT. Aucun des 190 autres tests ne
  // regarde une couleur de SVG.
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await page.click("#viewPlan");
  await expect(page.locator("#journeyMap")).toBeVisible({ timeout: 8000 });

  // On vise `.jm-sysnom`, le nom du système : app.js lui pose `fill="${teinte(sys.nom)}"`. Les
  // premiers <circle> du groupe portent volontairement `fill="none"` — ce sont les anneaux
  // orbitaux en pointillés, dont seule la couleur de TRAIT compte.
  const teintes = await page.locator("#journeyMap .jm-sysnom").evaluateAll((els) =>
    els.map((e) => getComputedStyle(e).fill)
  );
  expect(teintes.length, "aucun nom de système sur la carte").toBeGreaterThan(0);
  for (const t of teintes) {
    expect(t, "un nom de système est rendu sans teinte — le jeton n'arrive pas au SVG").not.toBe("none");
    expect(t, "teinte retombée au noir : le jeton nommé dans le fill= n'existe plus").not.toBe("rgb(0, 0, 0)");
  }
  // Et ce sont bien LES teintes du thème, pas une couleur quelconque.
  const attendues = ["rgb(56, 189, 248)", "rgb(255, 106, 61)", "rgb(169, 112, 255)", "rgb(255, 176, 32)"];
  for (const t of teintes) expect(attendues).toContain(t);
});
