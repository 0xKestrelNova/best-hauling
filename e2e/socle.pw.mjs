import { test, expect } from "@playwright/test";

// Le socle de build (ADR-008). Ces tests ne regardent PAS une fonctionnalité : ils regardent ce que
// la fabrication produit. Ils n'ont de sens que parce que la suite sert désormais `dist/`
// (playwright.config.mjs) — sur la racine du dépôt, ils passeraient sans rien prouver.
//
// Tout ce qui est ici est une panne qui NE SE VOIT QU'EN PRODUCTION : un nom de fichier haché, un
// manifeste déplacé, une liste de précache périmée. Aucune n'aurait fait rougir les 184 tests
// existants, et c'est précisément pour ça qu'ils sont écrits.

test("Socle : le manifeste est servi à la RACINE, jamais haché sous assets/ (#96)", async ({ page }) => {
  // Le piège mesuré pendant l'écriture du socle : Vite traite <link rel="manifest"> comme un asset
  // et le range sous assets/ avec un nom haché. Son JSON, lui, n'est pas réécrit — « start_url »,
  // « scope » et « icons[].src » y sont RELATIFS. Déplacé d'un cran, le manifeste faisait démarrer
  // l'app installée sur /assets/ et lui faisait perdre son icône. Rien ne l'aurait signalé.
  await page.goto("/index.html");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href, "le manifeste ne doit pas être haché").toBe("./manifest.webmanifest");

  const reponse = await page.request.get("/manifest.webmanifest");
  expect(reponse.status()).toBe(200);
  const manifeste = await reponse.json();
  expect(manifeste.start_url).toBe("./");
  expect(manifeste.scope).toBe("./");

  // L'icône que le manifeste désigne doit exister À L'ENDROIT où lui la cherche : à côté de lui.
  const icone = await page.request.get("/" + manifeste.icons[0].src);
  expect(icone.status(), `${manifeste.icons[0].src} introuvable à la racine`).toBe(200);
});

test("Socle : l'icône de la page est servie sous son nom d'origine (#96)", async ({ page }) => {
  await page.goto("/index.html");
  for (const rel of ["icon", "apple-touch-icon"]) {
    const href = await page.locator(`link[rel="${rel}"]`).getAttribute("href");
    expect(href, `${rel} ne doit pas être haché`).toBe("./icon.svg");
  }
  expect((await page.request.get("/icon.svg")).status()).toBe(200);
});

test("Socle : la CSP de PRODUCTION traverse le build intacte (#96)", async ({ page }) => {
  // L'assouplissement de la CSP existe pour le serveur de développement, et pour lui seul. S'il
  // fuyait dans le build, la page servie accepterait le script inline et l'eval — exactement ce
  // que la politique du dépôt refuse, et sans qu'aucun test de source ne s'en aperçoive : ceux-ci
  // lisent index.html à la racine, pas l'artefact.
  await page.goto("/index.html");
  const politique = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  // Directive par directive, et non par sous-chaîne : `style-src 'self' 'unsafe-inline'` est la
  // politique LÉGITIME de production, et une recherche naïve d'« unsafe-inline » la confondrait
  // avec une fuite du serveur de dev.
  const directives = Object.fromEntries(
    politique.split(";").map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([n, ...v]) => [n, v.join(" ")])
  );
  expect(directives["script-src"], "l'assouplissement de dev a fui dans le build").toBe("'self'");
  expect(directives["connect-src"], "le ws: du rechargement à chaud a fui dans le build").toBe("'self'");
  // `img-src` sans `data:` est ce qui impose assetsInlineLimit: 0. Les deux se tiennent : si la
  // directive s'assouplit un jour, le réglage de Vite n'a plus de raison d'être — et inversement,
  // si le réglage saute, cette directive fait disparaître la première icône inlinée EN PRODUCTION.
  expect(directives["img-src"]).toBe("'self' https:");
  expect(directives["img-src"], "data: rouvert -> assetsInlineLimit: 0 perd sa raison d'être").not.toContain("data:");
});

test("Socle : rail.js reste un script CLASSIQUE, et le rail replié ne clignote pas (#96)", async ({ page }) => {
  // Invariant documenté dans index.html et dans rail.js depuis toujours, et qu'AUCUN test ne
  // couvrait : rail.js doit s'exécuter pendant l'analyse du document, donc avant le module différé.
  // En faire un module le rendrait différé lui aussi, et le rail s'afficherait déplié le temps d'un
  // rendu. Le socle déplace ce fichier dans la fabrication : c'est le moment de l'attraper.
  const balise = page.locator('script[src="rail.js"]');
  await page.goto("/index.html");
  await expect(balise).toHaveCount(1);
  expect(await balise.getAttribute("type"), "rail.js ne doit pas devenir un module").toBeNull();

  // Et la propriété qui compte vraiment, vue de l'utilisateur : rail déjà replié au tout premier
  // rendu, sans passer par un état déplié.
  await page.evaluate(() => localStorage.setItem("best-hauling-rail", "1"));
  await page.goto("/index.html");
  await expect(page.locator("#app")).toHaveClass(/rail-collapsed/);
});

test("Socle : l'app démarre aussi par « / », l'URL de l'app installée (#96)", async ({ page }) => {
  // `start_url` du manifeste vaut « ./ » : une app installée démarre sur la racine, pas sur
  // /index.html. Les 184 tests existants visent tous /index.html — cette entrée-là n'était
  // couverte par rien, alors que le précache la traite comme une URL distincte.
  await page.goto("/");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(page.locator(".rail-nav .vbtn")).toHaveCount(8);
});

test("Socle : le précache nomme des fichiers qui existent VRAIMENT (#96)", async ({ page }) => {
  // `caches.addAll` est ATOMIQUE : une seule URL en 404 fait rejeter tout l'appel, et le mode
  // hors-ligne ne se dégrade pas — il disparaît, en silence. C'est la panne que la liste écrite à
  // la main garantissait dès le premier build, puisque Vite renomme les fichiers.
  await page.goto("/index.html");
  const sw = await (await page.request.get("/sw.js")).text();

  const liste = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\]);/)[1]);
  expect(liste.length, "le précache doit être écrit par le build, pas rester la liste v1").toBeGreaterThan(9);
  expect(liste).toContain("./");
  expect(liste).toContain("./index.html");
  expect(liste).toContain("./rail.js");

  // Les données ont leur PROPRE stratégie dans sw.js (réseau d'abord) : les précacher les figerait.
  expect(liste.filter((u) => u.includes("/data/"))).toHaveLength(0);

  for (const url of liste) {
    const r = await page.request.get(url === "./" ? "/" : url.replace(/^\.\//, "/"));
    expect(r.status(), `${url} est précaché mais absent du site produit`).toBe(200);
  }
});
