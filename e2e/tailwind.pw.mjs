import { test, expect } from "@playwright/test";

// Tailwind est installé mais utilisé par AUCUN élément de l'app. Ces tests ne vérifient donc pas
// une apparence : ils vérifient que la CONFIGURATION produit ce qu'on croit, et surtout que la
// cascade est dans le sens décidé.
//
// Pourquoi ça mérite des tests alors que rien ne l'utilise : les deux pannes possibles ici sont
// silencieuses. Un ordre de couches inversé fait que la feuille maison perd sans erreur ni test
// rouge ; une configuration de couleur mal branchée produit la bonne teinte sous une autre FORME
// (color-mix au lieu de rgb), ce qui casse toute assertion qui compare des rgba(…) le jour où une
// vue s'en sert. Les deux se découvriraient au pire moment : pendant la migration d'une vue.

// Pose un élément témoin dans la page et rend ses styles calculés.
const temoin = (page, html, sel = null) =>
  page.evaluate(([h, s]) => {
    const hote = document.createElement("div");
    hote.id = "__temoin";
    hote.innerHTML = h;
    document.body.appendChild(hote);
    // `sel` quand l'élément qui porte les classes n'est pas la racine du fragment — c'est le cas
    // du SVG, où le <circle> est ce qui nous intéresse et non le <svg> qui l'enveloppe.
    const el = s ? hote.querySelector(s) : hote.firstElementChild;
    const cs = getComputedStyle(el);
    const out = {
      color: cs.color,
      background: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      fontFamily: cs.fontFamily,
      padding: cs.paddingTop,
      display: cs.display,
      fill: cs.fill,
      stroke: cs.stroke,
    };
    hote.remove();
    return out;
  }, [html, sel]);

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("Tailwind : les utilitaires de teinte passent par NOS canaux (#96)", async ({ page }) => {
  // Le piège que cette configuration existe pour éviter : la voie normale de Tailwind 4 produit
  // `color-mix(in oklab, …)`, que Chromium calcule en `oklab(0.813 …)`. Même couleur à l'œil, mais
  // une chaîne différente — et toute assertion de couleur du dépôt compare des `rgba(…)`.
  const t = await temoin(page, `<div class="bg-acc/14 text-muted border-good">x</div>`);
  expect(t.background, "bg-acc/14 ne rend pas un rgba() — la config est repassée par color-mix")
    .toBe("rgba(255, 176, 32, 0.14)");
  expect(t.color).toBe("rgb(138, 147, 168)");
  expect(t.borderColor).toBe("rgb(70, 229, 160)");
});

test("Tailwind : la teinte des systèmes s'applique aussi au SVG (#96)", async ({ page }) => {
  const t = await temoin(page, `<svg><circle class="fill-stanton stroke-pyro/50" r="3"/></svg>`, "circle");
  expect(t.fill).toBe("rgb(56, 189, 248)");
  expect(t.stroke).toBe("rgba(255, 106, 61, 0.5)");
});

test("Tailwind : les trois familles du HUD sont exposées en utilitaires (#96)", async ({ page }) => {
  expect((await temoin(page, `<div class="font-display">x</div>`)).fontFamily).toContain("Orbitron");
  expect((await temoin(page, `<div class="font-mono">x</div>`)).fontFamily).toContain("JetBrains Mono");
});

test("Tailwind : les utilitaires NATIFS survivent à la surcharge de bg-/text-/border- (#96)", async ({ page }) => {
  // On redéfinit `bg-*`, `text-*`, `border-*` : il fallait vérifier que Tailwind retombe bien sur
  // ses propres utilitaires quand notre valeur ne résout pas. Sinon la moitié du vocabulaire
  // standard disparaîtrait, et on ne s'en apercevrait qu'en écrivant la première vue.
  const t = await temoin(page, `<div class="flex p-4">x</div>`);
  expect(t.display).toBe("flex");
  expect(t.padding).not.toBe("0px");
});

test("Tailwind : la feuille MAISON bat les utilitaires — l'ordre des couches (#96)", async ({ page }) => {
  // LE test de cette PR. style.css est hors couche, et une déclaration hors couche bat TOUTE
  // déclaration layered, quelle que soit la spécificité. C'est ce qui garantit qu'installer
  // Tailwind ne déplace pas un pixel tant que personne n'écrit une classe.
  //
  // Si cet ordre s'inversait un jour, rien ne le signalerait : pas d'erreur, pas de test rouge,
  // juste des règles maison qui cessent de s'appliquer là où un utilitaire passe par là.
  const t = await temoin(page, `<div class="kicker text-acc-2/50">x</div>`);
  const kicker = await page.evaluate(() => {
    const e = document.createElement("div");
    e.className = "kicker";
    document.body.appendChild(e);
    const c = getComputedStyle(e).color;
    e.remove();
    return c;
  });
  expect(t.color, "un utilitaire Tailwind a battu style.css : l'ordre des couches s'est inversé")
    .toBe(kicker);
});

test("Tailwind : aucune palette étrangère n'entre dans le thème (#96)", async ({ page }) => {
  // `--color-*: initial` retire la palette de Tailwind. Deux palettes côte à côte, c'est la dérive
  // que le thème existe pour empêcher : le jour où quelqu'un écrit `bg-amber-500` parce que ça
  // ressemble à notre ambre, l'identité commence à se dissoudre.
  const t = await temoin(page, `<div class="bg-red-500 text-blue-300">x</div>`);
  expect(t.background, "la palette Tailwind est revenue").toBe("rgba(0, 0, 0, 0)");
  expect(t.color).not.toBe("rgb(147, 197, 253)");
});
