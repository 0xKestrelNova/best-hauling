import { test, expect } from "@playwright/test";

// LA PREMIÈRE VISITE (#62). Aucun de ces tests ne peut passer sans l'aide : le dépôt ne portait
// jusqu'ici AUCUN `role="dialog"`, AUCUN `aria-modal`, AUCUN `<dialog>` — il n'y avait rien à
// copier, et donc rien qui puisse rendre l'un d'eux vert par accident.
//
// ── POURQUOI CE FICHIER SE DÉSAMORCE ──────────────────────────────────────────────────────────
// `playwright.config.mjs` pose `best-hauling-aide-vue = "1"` dans le `storageState` de TOUTE la
// suite : sans ça l'aide s'ouvrirait dans les 257 tests, et une quarantaine d'entre eux
// cliqueraient dans le voile. Ce fichier-ci est le SEUL qui doive voir une première visite, il rend
// donc son contexte vierge — `origins: []` et non une clé effacée : c'est l'ABSENCE qu'on teste, et
// c'est elle que voit un vrai premier visiteur.
test.use({ storageState: { cookies: [], origins: [] } });

const NBSP = / /g;
const texte = (s) => (s || "").replace(NBSP, " ").trim();

test("Accueil : à la PREMIÈRE visite l'aide s'ouvre seule, et modale (#62)", async ({ page }) => {
  await page.goto("/index.html");
  const aide = page.locator("#aide");
  await expect(aide).toBeVisible();
  await expect(aide).toHaveAttribute("role", "dialog");
  await expect(aide).toHaveAttribute("aria-modal", "true");
  // Le nom accessible vient du TITRE, pas d'un aria-label recopié à côté qui divergerait de lui.
  await expect(aide).toHaveAccessibleName(/bienvenue/i);
  // `inert` sur #app : c'est le navigateur qui interdit alors d'atteindre quoi que ce soit derrière
  // le voile. #racine est un FRÈRE de #app, jamais son enfant — le dialogue reste vivant.
  await expect(page.locator("#app")).toHaveAttribute("inert", "");
});

test("Accueil : refermée, elle ne revient plus — et le drapeau est LOCAL (#62)", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#aide")).toBeVisible();
  await page.click("#aideFermer");
  await expect(page.locator("#aide")).toBeHidden();
  await expect(page.locator("#app")).not.toHaveAttribute("inert", "");

  expect(await page.evaluate(() => localStorage.getItem("best-hauling-aide-vue"))).toBe("1");

  await page.reload();
  await expect(page.locator("#aide")).toBeHidden();
});

test("Accueil : le drapeau ne part PAS dans le permalien (#62)", async ({ page }) => {
  // Un lien partagé ne doit pas décider à la place de son destinataire s'il a « déjà vu » l'aide :
  // recevoir le lien d'un habitué supprimerait l'aide d'une vraie première visite. Le drapeau vit
  // donc dans SA clé, jamais dans l'état encodé (persistance.ts).
  await page.goto("/index.html");
  await page.click("#aideFermer");
  await page.click("#viewLoops");
  await expect(page.locator("#loops")).toBeVisible();
  expect(await page.evaluate(() => location.hash), "l'état encodé porte le drapeau d'aide")
    .not.toContain("aide");
  expect(await page.evaluate(() => localStorage.getItem("best-hauling-state")))
    .not.toContain("aide");
});

test("Accueil : l'aide DÉCRIT LE RAIL RÉEL, dérivé de lui (#62)", async ({ page }) => {
  // « Une aide qui décrit une interface fausse est pire que pas d'aide » : la liste n'est pas écrite
  // à la main, elle est LUE sur le rail. Deux listes jumelles divergeraient à la neuvième vue, et
  // rien ne le verrait — c'est très exactement l'argument déjà retenu pour les raccourcis
  // (navigation.ts : « on le dérive du rail lui-même »).
  await page.goto("/index.html");
  const entrees = page.locator("#aide .aide-vues li");
  await expect(entrees).toHaveCount(8);

  const rail = await page.evaluate(() =>
    [...document.querySelectorAll(".rail-nav .vbtn")].map((b) => ({
      rn: b.querySelector(".rn").textContent,
      rl: b.querySelector(".rl").textContent,
    })));

  for (let i = 0; i < 8; i++) {
    const ligne = entrees.nth(i);
    await expect(ligne.locator(".aide-num"), `entrée ${i + 1} : mauvais numéro`).toHaveText(rail[i].rn);
    expect(texte(await ligne.locator(".aide-vue").textContent()),
      `entrée ${i + 1} : le nom ne suit pas le rail`).toBe(texte(rail[i].rl));
  }
});

test("Accueil : les raccourcis NE TRAVERSENT PAS le voile (#62)", async ({ page }) => {
  // LA fuite mesurée : la garde de `navigation.ts` ne couvre que INPUT/SELECT/TEXTAREA/
  // role="button"/.editv. Le bouton de fermeture de l'aide est un <button> NATIF — comme
  // #brandHome, mesuré : focus dessus, touche « 3 », la vue bascule sur Boucles. Sans garde de
  // modalité, refermer l'aide découvrait un autre écran que celui qu'on venait de quitter.
  await page.goto("/index.html");
  await expect(page.locator("#aide")).toBeVisible();
  await expect(page.locator("#viewRoutes")).toHaveClass(/active/);

  await page.keyboard.press("3");
  await expect(page.locator("#viewRoutes"), "« 3 » a traversé le voile").toHaveClass(/active/);
  await expect(page.locator("#loops")).toBeHidden();

  await page.keyboard.press("/");
  expect(await page.evaluate(() => document.activeElement.id),
    "« / » a donné le focus au champ de recherche DERRIÈRE l'aide").not.toBe("search");

  // Et la garde LÈVE : refermée, les huit raccourcis reprennent leur service.
  await page.click("#aideFermer");
  await page.keyboard.press("3");
  await expect(page.locator("#loops")).toBeVisible();
});

test("Accueil : le focus est PIÉGÉ dans l'aide, et rendu à la fermeture (#62)", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#aide")).toBeVisible();

  // À l'ouverture, le focus ENTRE dans le dialogue — sinon un lecteur d'écran reste sur le <body> et
  // n'annonce rien de ce qui vient de s'afficher.
  expect(await page.evaluate(() => document.getElementById("aide").contains(document.activeElement)),
    "le focus n'est pas entré dans l'aide").toBe(true);

  // Le piège : douze tabulations ne sortent jamais du dialogue.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.getElementById("aide").contains(document.activeElement)),
      `le focus a fui du dialogue à la tabulation ${i + 1}`).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.getElementById("aide").contains(document.activeElement)),
    "le focus a fui du dialogue en arrière").toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator("#aide")).toBeHidden();
});

test("Accueil : le bouton de rejeu rouvre l'aide, et rend le focus À LUI (#62)", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#aideFermer");
  await expect(page.locator("#aide")).toBeHidden();

  const rejeu = page.locator("#aideRejouer");
  await expect(rejeu).toBeVisible();
  await expect(rejeu).toHaveAccessibleName(/aide/i);

  await rejeu.click();
  await expect(page.locator("#aide")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#aide")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement.id),
    "le focus n'est pas revenu au bouton qui a ouvert l'aide").toBe("aideRejouer");
});

test("Accueil : le rejeu est FRÈRE de la marque, jamais son enfant (#62)", async ({ page }) => {
  // Deux éléments interactifs imbriqués sont invalides en ARIA — la règle que le dépôt a appliquée
  // en sortant .scomm-undo du .editv (#38), et que `plan.pw.mjs` garde déjà sur #brandHome.
  await page.goto("/index.html");
  await page.click("#aideFermer");
  expect(await page.locator("#brandHome button, #brandHome a, #brandHome [role='button']").count()).toBe(0);
  expect(await page.locator(".brand > #aideRejouer").count(), "le rejeu n'est pas dans .brand").toBe(1);
});
