import { test, expect } from "@playwright/test";

// Plan de vol : la septième vue, celle de CONCLUSION (#61, ADR-004).
// Ces tests encodent les huit décisions de l'ADR. Trois d'entre elles ne se voient qu'en NÉGATIF —
// ce qui doit disparaître ici, et surtout REVENIR ailleurs : la carte, la barre de filtres, le
// bandeau. C'est le second sens qui casse en silence, il est donc testé à chaque fois.

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

// Les six vues de RECHERCHE, avec un témoin visible propre à chacune. Le Plan de vol n'y est pas :
// c'est justement ce qui les sépare de lui.
const VUES = [
  ["#viewRoutes", "#routes"],
  ["#viewLoops", "#loops"],
  ["#viewEnroute", "#enrouteControls"],
  ["#viewChain", "#chainControls"],
  ["#viewCorrections", "#correctionsControls"],
  ["#viewCommodities", "#commoditiesControls"],
];

// Un voyage minimal : ▶ sur la première ligne pose deux arrêts et une jambe. Aucun test d'ici ne
// dépend du CLASSEMENT (contrairement à ceux qu'a cassés l'ADR-005) : n'importe quelle ligne fait
// l'affaire, seule compte l'existence d'un parcours.
async function voyageSimple(page) {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
}

// Ouvre un lien en CHARGEMENT COMPLET, sans attendre le tableau : en Plan de vol, #routes est
// masqué — l'attente habituelle sur #rows expirerait au lieu de vérifier quoi que ce soit.
async function ouvrirPlanPermalien(page, hash) {
  await page.goto("about:blank");
  await page.goto("/index.html" + hash);
}

test("Plan de vol : une septième entrée au rail, au clic comme au raccourci « 7 » (#61)", async ({ page }) => {
  await expect(page.locator("#viewPlan")).toBeVisible();
  await page.click("#viewPlan");
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#viewPlan")).toHaveClass(/active/);
  await expect(page.locator("#routes")).toBeHidden();

  await page.click("#viewRoutes");
  await expect(page.locator("#plan")).toBeHidden();
  await page.keyboard.press("7"); // le raccourci, dans la continuité de 1…6
  await expect(page.locator("#plan")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.locator("#routes")).toBeVisible();
});

test("Plan de vol : la vue revient d'un rechargement ET d'un permalien (liste blanche, #61)", async ({ page }) => {
  // LE piège de l'ADR-004 : sans ajout dans la liste blanche d'applyState, la vue s'ouvre au clic
  // mais ne revient d'aucun état sauvé — et l'oubli ne se voit qu'au rechargement suivant.
  await page.click("#viewPlan");
  await expect(page.locator("#plan")).toBeVisible();
  expect(page.url()).toContain("v=plan");

  await page.reload();
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#viewPlan")).toHaveClass(/active/);

  await ouvrirPlanPermalien(page, "#v=plan");
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#viewPlan")).toHaveClass(/active/);
});

test("Plan de vol : la carte du parcours ne vit QUE dans cette vue (#61)", async ({ page }) => {
  await voyageSimple(page);
  await page.click("#viewPlan");
  await expect(page.locator("#journeyMap")).toBeVisible();
  await expect(page.locator("#journeyMap .jm-svg")).toBeVisible({ timeout: 10_000 });

  // C'est la décision 4, et c'est ce qui justifie l'existence de la vue : ailleurs, plus de carte.
  for (const [bouton, temoin] of VUES) {
    await page.click(bouton);
    await expect(page.locator(temoin)).toBeVisible();
    await expect(page.locator("#journeyMap")).toBeHidden();
  }
});

test("Plan de vol : la carte y est NETTEMENT plus large que sa colonne d'avant (#61)", async ({ page }) => {
  // Avant : troisième colonne à `flex 1 1 460px`, dessin plafonné à 760 px. La vue existe pour
  // qu'on la voie en grand — un plafond inchangé ferait un déménagement sans bénéfice.
  await page.setViewportSize({ width: 1600, height: 900 });
  await voyageSimple(page);
  await page.click("#viewPlan");
  const svg = page.locator("#journeyMap .jm-svg");
  await expect(svg).toBeVisible({ timeout: 10_000 });
  const box = await svg.boundingBox();
  expect(box.width).toBeGreaterThan(900);
});

test("Plan de vol : le bandeau (résumé + soute) reste dans les six autres vues (#61)", async ({ page }) => {
  // Décision 3, et non-régression pure : une refonte de disposition casse ça sans le vouloir.
  await voyageSimple(page);
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "20");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();

  for (const [bouton] of VUES) {
    await page.click(bouton);
    await expect(page.locator("#journeyCard")).toBeVisible();
    await expect(page.locator("#journeyRecap")).toBeVisible();
    await expect(page.locator("#holdCard")).toBeVisible();
    // Le chemin vers « changer d'étape » que la carte portait ailleurs : il reste au bandeau.
    await expect(page.locator("#journeyCard .jstep").first()).toBeVisible();
  }
});

test("Plan de vol : Trajets reste la vue par défaut au premier chargement (#61)", async ({ page }) => {
  // Décision 2. Une conclusion n'est pas un point d'entrée : y atterrir sans état sauvé montrerait
  // un parcours vide et une soute vide, soit l'écran le moins parlant de l'app.
  await expect(page.locator("#routes")).toBeVisible();
  await expect(page.locator("#viewRoutes")).toHaveClass(/active/);
  await expect(page.locator("#plan")).toBeHidden();
});

test("la marque HAULR ramène à Trajets, à la souris et au clavier (#61)", async ({ page }) => {
  // Décision 5 : « retour au début » mène à la vue principale, pas à la conclusion.
  const marque = page.locator("#brandHome");
  await expect(marque).toHaveAccessibleName(/Trajets/i);

  await page.click("#viewPlan");
  await expect(page.locator("#plan")).toBeVisible();
  await marque.click();
  await expect(page.locator("#routes")).toBeVisible();

  await page.click("#viewLoops");
  await expect(page.locator("#loops")).toBeVisible();
  await marque.press("Enter");
  await expect(page.locator("#routes")).toBeVisible();

  // Contrainte de voisinage de l'ADR : le bouton de tuto (#62) viendra en FRÈRE dans .brand.
  // Deux éléments interactifs imbriqués sont invalides en ARIA (règle appliquée par #38).
  expect(await marque.locator("button, a, [role='button']").count()).toBe(0);
});

test("Plan de vol : les filtres de recherche sont masqués, et REVIENNENT au retour (#61)", async ({ page }) => {
  await expect(page.locator("#controls")).toBeVisible();
  await page.click("#viewPlan");
  await expect(page.locator("#controls")).toBeHidden();
  await expect(page.locator("#search")).toBeHidden();
  await expect(page.locator("#multiCommodity")).toBeHidden();

  // Le second sens : c'est celui qui casse en silence.
  await page.click("#viewRoutes");
  await expect(page.locator("#controls")).toBeVisible();
  await expect(page.locator("#search")).toBeVisible();
});

test("Plan de vol : masquer n'est pas désactiver — les filtres survivent au passage (#61)", async ({ page }) => {
  await page.fill("#search", "Titanium");
  // La recherche est DEBOUNCÉE : compter les lignes tout de suite compterait le tableau NON filtré,
  // et le test se comparerait ensuite à un chiffre qui n'a jamais correspondu au filtre. L'état
  // sauvé dans le hash n'est écrit qu'en FIN de refresh : c'est le signal que le rendu a eu lieu.
  await page.waitForFunction(() => location.hash.includes("search=Titanium"));
  const avant = await page.locator("#rows tr").count();

  await page.click("#viewPlan");
  await page.click("#viewRoutes");
  await expect(page.locator("#search")).toHaveValue("Titanium");
  await expect(page.locator("#rows tr")).toHaveCount(avant);
});

test("Plan de vol : les quatre réglages sont repris en TEXTE, en lecture seule (#61)", async ({ page }) => {
  // Décision 6. Ces quatre-là ne filtrent pas : ils changent le SENS des chiffres affichés. Les
  // masquer sans rien mettre à la place ferait lire un profit sans savoir s'il est net.
  await page.fill("#ship", "railen");
  await page.locator("#shipList li").first().click();
  const soute = await page.locator("#cargo").inputValue();

  await page.click("#viewPlan");
  const hyp = page.locator("#planHypotheses");
  await expect(hyp).toContainText(/Railen/i);
  await expect(hyp).toContainText(new RegExp(`${soute}\\s*SCU`));
  await expect(hyp).toContainText(/bruts/i); // l'interrupteur d'autoload est inactif par défaut
  // Lecture seule : le contrôle lui-même n'est pas actionnable ici.
  await expect(page.locator("#autoload")).toBeHidden();
  await expect(page.locator("#ship")).toBeHidden();

  // Cocher depuis une AUTRE vue change le texte affiché ici : c'est un miroir, pas une copie figée.
  await page.click("#viewRoutes");
  await page.check("#autoload");
  await page.click("#viewPlan");
  await expect(hyp).toContainText(/nets/i);
  await expect(hyp).toContainText(/k\s*=\s*1,2/);
});

test("Plan de vol : la soute a un vrai visuel — à bord, place libre, capital engagé (#61)", async ({ page }) => {
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "20");
  await page.fill("#holdAddPaid", "100");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.click("#viewPlan");
  const soute = page.locator("#planHold");
  await expect(soute).toContainText("Titanium");
  await expect(soute).toContainText("20");
  await expect(soute).toContainText(/libre/i);
  await expect(soute).toContainText(/2\s*000/); // 20 SCU × 100 aUEC : le capital engagé
  // On ne change RIEN depuis cette vue : ni vente, ni retrait de lot.
  expect(await soute.locator("button").count()).toBe(0);
});

test("Plan de vol : la carte garde ses écouteurs directs après un re-rendu (#61)", async ({ page }) => {
  // #journeyMap porte ses écouteurs EN DIRECT, une seule fois, hors du HTML réécrit par innerHTML.
  // Le déménager dans un conteneur re-rendu reproduirait #24 : un geste qui cesse de répondre.
  await voyageSimple(page);
  await page.click("#viewPlan");
  const arrets = page.locator("#journeyMap .jm-arret");
  await expect(arrets.first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#journeyMap .jm-arret.ici")).toHaveCount(1);

  await page.click("#viewRoutes"); // un cycle de rendu complet, ailleurs
  await page.click("#viewPlan");
  // `.jm-cible` et non le <g> : c'est le disque transparent qui porte la cible de clic, le centre
  // du groupe tombant entre le point et son libellé (idiome déjà en place dans smoke.pw.mjs).
  await arrets.nth(1).locator(".jm-cible").click(); // « je suis ici » sur le second arrêt
  await expect(arrets.nth(1)).toHaveClass(/ici/);
});

test("Plan de vol : sans voyage, un état vide utile plutôt qu'une page blanche (#61)", async ({ page }) => {
  await page.click("#viewPlan");
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("#planBody")).toContainText(/Trajets/);
  await expect(page.locator("#journeyMap")).toBeHidden();
});

test("Plan de vol : le bouton de capture copie le récapitulatif en texte (#61)", async ({ page, context }) => {
  // Décision 8 : du TEXTE, pas une image — la CSP interdit le procédé habituel (img-src sans data:).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await voyageSimple(page);
  await page.click("#viewPlan");
  await page.click("#planCopy");
  await expect(page.locator("#planCopy")).toHaveText(/Copié/);

  const texte = await page.evaluate(() => navigator.clipboard.readText());
  expect(texte).toContain("Plan de vol");
  expect(texte).toContain("→"); // le parcours, étape par étape
  expect(texte).toMatch(/soute/i); // les hypothèses voyagent avec le récapitulatif
});

// Les deux causes d'échec de `copierTexte`, chacune la sienne (#91). Elles valent pour les trois
// autres boutons de copie du dépôt : le point de sortie est partagé.
test("Plan de vol : un presse-papiers INDISPONIBLE le dit, jamais en silence (#91)", async ({ page }) => {
  await voyageSimple(page);
  await page.click("#viewPlan");
  // Le cas d'un contexte non sécurisé (http:// sur un LAN) : Chrome ne pose pas navigator.clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
  });
  await page.click("#planCopy");
  await expect(page.locator("#toast")).toContainText(/presse-papiers indisponible/i);
  await expect(page.locator("#planCopy")).not.toHaveText(/Copié/); // surtout pas un faux succès
});

test("Plan de vol : un presse-papiers REFUSÉ le dit, jamais en silence (#91)", async ({ page }) => {
  await voyageSimple(page);
  await page.click("#viewPlan");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => ({ writeText: () => Promise.reject(new Error("permission refusée")) }),
    });
  });
  await page.click("#planCopy");
  await expect(page.locator("#toast")).toContainText(/presse-papiers refusé/i);
  await expect(page.locator("#planCopy")).not.toHaveText(/Copié/);
});
