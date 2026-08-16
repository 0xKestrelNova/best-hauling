import { test, expect } from "@playwright/test";

// La carte de DÉCLARATION de soute (`#holdDeclare`, #55) — « j'ai déjà ça à bord ».
//
// Ces tests sont écrits AVANT sa migration en îlot React, et ils gardent ce que la suite ne
// regardait pas. Vingt-deux tests répartis sur quatre fichiers TRAVERSENT cette carte pour se
// donner du fret (elle est le seul robinet à soute de la suite), mais presque aucun ne la VISE :
// rien n'y vérifiait le focus, le clavier, ni la structure conditionnelle du panneau.
//
// Ce sont précisément les trois choses qu'un rendu React reconstruit peut casser en silence :
// le focus dépend d'un rendu SYNCHRONE, le clavier d'une classe que le JSX doit réémettre, et la
// structure conditionnelle de la façon dont React réconcilie des emplacements qui apparaissent et
// disparaissent.

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

// Le premier clic sur « déclarer » passe TOUJOURS par `withMarket` (app.js:1535) : la vue par
// défaut ne charge pas market.json. Le formulaire n'apparaît donc qu'après ce chargement.
async function ouvrirFormulaire(page) {
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible({ timeout: 20_000 });
}

test("Déclaration : ouvrir le formulaire y pose le curseur, sans un geste de plus (#55)", async ({ page }) => {
  // `ouvrirDeclaration` rend PUIS prend le focus dans la foulée (app.js:1537-1538) : le champ
  // n'existe pas avant le rendu. Un rendu différé ferait court-circuiter le `?.` et le formulaire
  // s'ouvrirait curseur nulle part — l'utilisateur tape dans le vide. Aucun test ne le voyait :
  // `page.fill` focalise lui-même, donc tous les helpers de la suite masquent la panne.
  await ouvrirFormulaire(page);
  await expect(page.locator("#holdAddName")).toBeFocused();
});

test("Déclaration : Entrée valide depuis n'importe quel champ, Échap abandonne (#55)", async ({ page }) => {
  // La délégation clavier (app.js:3386-3390) se garde par `closest(".hold-add")` : c'est la CLASSE
  // qui porte le contrat, pas les ids. Un JSX qui la renommerait ferait taire tout le clavier de la
  // carte sans casser un seul test existant — la moitié de son ergonomie.
  await ouvrirFormulaire(page);
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "12");
  await page.locator("#holdAddScu").press("Enter");
  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(page.locator("#holdCard")).toContainText("Titanium");
  // Validé : le formulaire se referme et le point d'entrée revient.
  await expect(page.locator("#holdAddOpen")).toBeVisible();

  await ouvrirFormulaire(page);
  await page.fill("#holdAddName", "Gold");
  await page.locator("#holdAddName").press("Escape");
  await expect(page.locator("#holdAddOpen")).toBeVisible();
  await expect(page.locator("#holdAddName")).toHaveCount(0);
});

test("Déclaration : les trois blocs apparaissent et disparaissent chacun à sa condition (#55)", async ({ page }) => {
  // C'est ce que la réconciliation React peut casser : les emplacements ne sont pas tous présents
  // en même temps, et deux d'entre eux changent de rang selon l'état. `.hold-head` sort quand la
  // soute se remplit, `.hold-ici` n'existe que HORS voyage — donc l'index d'un bloc ne dit rien de
  // son identité, et un rendu par liste réutiliserait le mauvais nœud.
  const tete = page.locator("#holdDeclare .hold-head");
  const ici = page.locator("#holdDeclare .hold-ici");

  // Soute vide, formulaire fermé : l'en-tête « ◈ Soute vide » est là, « Je suis à » non.
  await expect(tete).toBeVisible();
  await expect(tete).toContainText("Soute");
  await expect(ici).toHaveCount(0);

  // Formulaire ouvert : « Je suis à » apparaît, l'en-tête reste (la soute est toujours vide).
  await ouvrirFormulaire(page);
  await expect(ici).toBeVisible();
  await expect(tete).toBeVisible();
  await expect(page.locator("#holdDeclare .hold-add-hint")).toBeVisible();

  // Soute remplie : l'en-tête sort — au-dessus d'une carte Soute déjà titrée, un second « ◈ Soute »
  // ferait lire deux panneaux là où il n'y en a qu'un (app.js:1526-1527).
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "20");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(tete).toHaveCount(0);
  await expect(ici).toBeVisible();

  // Sous voyage : « Je suis à » sort à son tour — l'étape courante dit déjà où l'on est, et un
  // champ ici mentirait (app.js:1495-1498).
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  await expect(ici).toHaveCount(0);
});

test("Déclaration : « Je suis à » suit le départ d'« En route », qui est le même champ (#55)", async ({ page }) => {
  // Le sens JAMAIS testé. `#holdWhere` n'est pas un second store : il RELIT `#origin` à chaque
  // rendu (app.js:1502). Un champ non contrôlé n'adopterait plus jamais cette valeur recalculée —
  // c'est exactement le piège payé au manifeste (#117), et ici rien ne l'aurait rattrapé.
  await ouvrirFormulaire(page);
  await expect(page.locator("#holdWhere")).toBeVisible();

  await page.click("#viewEnroute");
  await expect(page.locator("#stationList option").first()).toBeAttached({ timeout: 20_000 });
  await page.fill("#origin", "Megumi — Pyro");
  await page.locator("#origin").blur();

  await expect(page.locator("#holdWhere")).toHaveValue("Megumi — Pyro", { timeout: 10_000 });
});

test("Déclaration : les QUATRE champs survivent à un geste fait ailleurs (#55)", async ({ page }) => {
  // Élargit smoke.pw.mjs:2895, qui ne couvrait que deux des quatre champs. `#holdAddPaid` et
  // `#holdWhere` ne sont gardés par rien, alors que ce sont les deux qui changent de mécanisme à la
  // migration : le premier est un champ libre de plus, le second porte une valeur recalculée.
  await ouvrirFormulaire(page);
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "42");
  await page.fill("#holdAddPaid", "137");
  await page.fill("#holdWhere", "Megumi — Pyro");

  await page.fill("#cargo", "120"); // un geste ailleurs, qui déclenche un rendu
  await page.locator("#cargo").blur();
  await page.waitForTimeout(400);

  await expect(page.locator("#holdAddName")).toHaveValue("Titanium");
  await expect(page.locator("#holdAddScu")).toHaveValue("42");
  await expect(page.locator("#holdAddPaid")).toHaveValue("137");
  await expect(page.locator("#holdWhere")).toHaveValue("Megumi — Pyro");

  await page.click("#viewLoops"); // et un changement de vue
  await page.click("#viewRoutes");
  await expect(page.locator("#holdAddPaid")).toHaveValue("137");
  await expect(page.locator("#holdWhere")).toHaveValue("Megumi — Pyro");
});
