import { test, expect } from "@playwright/test";

// Tests de fumée : chaque scénario encode un bug passé -> non-régression.
// L'app est un module ES (état non global), donc on pilote surtout via l'UI/DOM.

// Playwright isole le contexte (localStorage/hash) par test : on part toujours propre.
// On ne vide PAS via addInitScript (qui se relancerait à chaque reload et effacerait
// les corrections, stockées uniquement en localStorage — d'où l'intérêt du test de persistance).
test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#rows tr").first()).toBeVisible();
});

test("l'app charge et affiche des routes", async ({ page }) => {
  expect(await page.locator("#rows tr").count()).toBeGreaterThan(50);
  await expect(page.locator("#rows tr").first().locator(".score-cell")).toBeVisible();
});

test("navigation entre les cinq vues", async ({ page }) => {
  await page.click("#viewLoops");
  await expect(page.locator("#loops")).toBeVisible();
  await page.click("#viewEnroute");
  await expect(page.locator("#enrouteControls")).toBeVisible();
  await page.click("#viewChain");
  await expect(page.locator("#chainControls")).toBeVisible();
  await page.click("#viewCorrections");
  await expect(page.locator("#correctionsControls")).toBeVisible();
  // les contrôles En route ne doivent PAS fuir hors de leur vue (bug [hidden]/flex)
  await expect(page.locator("#enrouteControls")).toBeHidden();
  await page.click("#viewRoutes");
  await expect(page.locator("#routes")).toBeVisible();
});

test("le vaisseau ET sa carte (image) sont restaurés au rechargement (régression)", async ({ page }) => {
  await page.fill("#ship", "railen");
  await page.locator("#shipList li").first().click();
  await expect(page.locator("#shipCard")).toBeVisible();
  await expect(page.locator("#ship")).toHaveValue(/Railen/i);

  await page.reload();
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(page.locator("#ship")).toHaveValue(/Railen/i);          // nom restauré
  await expect(page.locator("#shipCard")).toBeVisible();               // carte réaffichée (le bug)
  await expect(page.locator("#shipImg")).toHaveAttribute("src", /^https:\/\//); // src d'image posé
});

test("une capacité de vente inconnue s'affiche « n.c. », jamais « — »", async ({ page }) => {
  // « — » se lisait « aucune demande » alors qu'UEX ne renseigne simplement pas `scu_sell` sur
  // la plupart des points : aucun plafond n'est appliqué dans ce cas.
  const vols = page.locator('#rows .editv[data-s="sell"][data-f="vol"]');
  expect(await vols.count()).toBeGreaterThan(0);
  const textes = await vols.allTextContents();
  expect(textes.some((t) => t.trim() === "—")).toBe(false);

  const nc = page.locator("#rows .editv.nc").first();
  test.skip(!(await nc.count()), "aucune capacité inconnue dans le jeu de données");
  await expect(nc).toHaveText("n.c.");
  await expect(nc).toHaveAttribute("title", /non communiquée par UEX/);
  await expect(nc).toHaveAttribute("data-v", ""); // pas la chaîne "null" : le champ number la rejetterait
  // …et reste corrigeable comme n'importe quelle autre valeur.
  await nc.click();
  await expect(nc.locator("input")).toBeVisible();
});

test("capStock : une demande corrigée à 0 met les unités à 0 (régression)", async ({ page }) => {
  await page.check("#capStock");
  const result = await page.evaluate(async () => {
    const span = document.querySelector('#rows tr .editv[data-s="sell"][data-f="vol"]');
    const c = span.dataset.c, t = span.dataset.t;
    span.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const inp = span.querySelector("input");
    inp.value = "0";
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const s2 = [...document.querySelectorAll('#rows .editv[data-s="sell"][data-f="vol"]')]
      .find((s) => s.dataset.c === c && s.dataset.t === t);
    const row = s2.closest("tr");
    return { demand: s2.textContent, units: row.querySelectorAll("td.num")[2].textContent.trim() };
  });
  expect(result.demand).toContain("0");
  expect(result.units).toBe("0"); // demande corrigée à 0 = pas de demande -> 0 unité
});

test("correction locale : marqueur ✎, compteur, et persistance au rechargement", async ({ page }) => {
  const span = page.locator('#rows tr:first-child .editv[data-s="buy"][data-f="price"]');
  await span.click();
  await span.locator("input").fill("4321");
  await span.locator("input").press("Enter");
  await expect(page.locator("#viewCorrections")).toHaveText(/Corrections \(1\)/);

  await page.reload();
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(page.locator("#viewCorrections")).toHaveText(/Corrections \(1\)/); // persistée
  await expect(page.locator("#rows .editv.ov").first()).toBeVisible();            // marqueur conservé
});

test("▶ tient la cible tactile minimale (#29)", async ({ page }) => {
  // ▶ est l'action PRINCIPALE d'une ligne : c'est lui qui démarre le compagnon de voyage. Il
  // mesurait 20×20 px pour un glyphe de 9 px — sous les 24×24 exigés par WCAG 2.2 SC 2.5.8
  // (niveau AA), et plus petit que le dépliant qui n'était que secondaire. Le seuil testé est
  // la règle, pas la taille retenue (30×30) : c'est la règle qui ne doit jamais régresser.
  const b = await page.locator("#rows .journey-pick").first().boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(24);
  expect(b.height).toBeGreaterThanOrEqual(24);
});

test("plus de dépliant 🗺 là où la carte du voyage montre déjà la géographie (#30)", async ({ page }) => {
  // Trajets simples et En route sortent tous deux de routeRowHTML : une seule suppression couvre
  // les deux tables. Les boucles ont leur propre rendu, d'où la seconde vérification.
  await expect(page.locator("#rows .route-toggle")).toHaveCount(0);
  await page.click("#viewLoops");
  await expect(page.locator("#loops tr").first()).toBeVisible();
  await expect(page.locator("#loops .route-toggle")).toHaveCount(0);
});

test("multi-commodité : ▶ reste le seul bouton plein de la ligne, dépliant ouvert (#29)", async ({ page }) => {
  // Le ▶ ayant pris le remplissage plein, l'état ouvert du dépliant ne peut plus le prendre aussi :
  // deux carrés ambre pleins côte à côte annulent la hiérarchie qu'on vient d'établir, et l'emoji
  // 📦 — glyphe en couleurs, que `color` ne repeint pas — devient illisible sur fond ambre.
  await page.check("#multiCommodity");
  await page.locator("#rows tr:first-child .route-toggle").click();
  // `.route-toggle` porte une transition de 0,12 s sur `background` : lue tout de suite, la valeur
  // calculée est celle du DÉPART, et l'assertion passait sans rien prouver. On attend donc la fin
  // des animations des deux boutons — expect.poll ne conviendrait pas non plus, il s'arrête au
  // PREMIER échantillon conforme, c'est-à-dire encore en pleine transition.
  const memeFond = await page.evaluate(async () => {
    const c = document.querySelector("#rows tr:first-child .commodity-cell");
    const t = c.querySelector(".route-toggle.open"), p = c.querySelector(".journey-pick");
    await Promise.all([...t.getAnimations(), ...p.getAnimations()].map((a) => a.finished.catch(() => {})));
    return getComputedStyle(t).backgroundColor === getComputedStyle(p).backgroundColor;
  });
  expect(memeFond).toBe(false);
});

test("multi-commodité : le dépliant garde le chargement, et lui seul (#30)", async ({ page }) => {
  // Seule table où le dépliant ne fait PAS doublon : la carte du voyage n'affiche aucun chiffre,
  // et c'est le seul endroit qui dit ce que contient une ligne « 3 commodités ».
  await page.check("#multiCommodity");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.locator("#rows tr:first-child .route-toggle").click();
  const detail = page.locator("#rows tr.schema-row");
  await expect(detail.locator(".sline").first()).toBeVisible();
  await expect(detail.locator(".schema")).toHaveCount(0); // la géographie part avec le doublon
  await page.locator("#rows tr:first-child .route-toggle").click();
  await expect(page.locator("#rows tr.schema-row")).toHaveCount(0);
});

test("vue Corrections : rechercher une station affiche ses commodités éditables", async ({ page }) => {
  await page.click("#viewCorrections");
  await page.fill("#station", "Levski — Nyx");
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible();
  expect(await page.locator("#correctionsStation .editv").count()).toBeGreaterThan(0);
});

test("vue Corrections : les commodités d'une station tiennent sur PLUSIEURS colonnes", async ({ page }) => {
  // En une seule colonne, GrimHEX (92 commodités) faisait 4 546 px : quatre écrans et demi à
  // parcourir pour corriger un chiffre, pendant que les colonnes du tableau mesuraient 444 px
  // chacune pour du contenu qui en demande 200.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.click("#viewCorrections");
  await page.fill("#station", "GrimHEX — Stanton");
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible();
  const n = await page.locator("#correctionsStation .scomm").count();
  expect(n).toBeGreaterThan(50);

  // Plusieurs tuiles partagent la même ligne : c'est la définition d'une grille multi-colonnes.
  const tops = await page.locator("#correctionsStation .scomm").evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const parLigne = tops.filter((t) => t === tops[0]).length;
  expect(parLigne).toBeGreaterThanOrEqual(3);

  // Et la hauteur totale reste sous ce qu'une colonne unique aurait donné (4 546 px mesurés).
  // On mesure la vue ENTIÈRE, pas une grille : c'est elle qu'on fait défiler, et il y en a deux.
  const h = await page.locator("#correctionsStation").evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeLessThan(2600);

  // Deux sections : ce qu'on achète ici d'abord, ce qu'on y vend ensuite.
  const titres = await page.locator("#correctionsStation .station-section-head").allTextContents();
  expect(titres.length).toBe(2);
  expect(titres[0]).toMatch(/achète/i);
  expect(titres[1]).toMatch(/vend/i);

  // Chaque tuile ne porte QUE son côté réel : plus de ligne « — » sous chaque vente.
  const cotes = await page.locator("#correctionsStation .scomm-side").count();
  expect(cotes).toBe(n); // exactement une ligne de côté par tuile
  expect(await page.locator("#correctionsStation .scomm-side", { hasText: /^\s*(achat|vente)\s*—\s*$/ }).count()).toBe(0);

  // Une commodité n'apparaît jamais deux fois — celle qui serait des deux côtés va aux achats.
  const noms = await page.locator("#correctionsStation .scomm-name").allTextContents();
  expect(new Set(noms).size).toBe(noms.length);

  // La section « achat » ne contient que des lignes d'achat, et réciproquement.
  const sec = page.locator("#correctionsStation .station-section");
  for (const t of await sec.nth(0).locator(".scomm-side .scomm-lbl").allTextContents()) expect(t.trim()).toBe("achat");
  for (const t of await sec.nth(1).locator(".scomm-side .scomm-lbl").allTextContents()) expect(t.trim()).toBe("vente");

  // Le côté se lit à la COULEUR : une tuile n'affiche qu'une ligne, et l'en-tête de section sort
  // de l'écran dès qu'on fait défiler.
  const teintes = await page.locator("#correctionsStation .scomm").evaluateAll((els) => {
    const bord = (e) => getComputedStyle(e).borderLeftColor;
    const a = els.find((e) => e.classList.contains("achat"));
    const v = els.find((e) => e.classList.contains("vente"));
    return { achat: a && bord(a), vente: v && bord(v), memeQueFond: a && bord(a) === getComputedStyle(a).backgroundColor };
  });
  expect(teintes.achat).toBeTruthy();
  expect(teintes.vente).toBeTruthy();
  expect(teintes.achat).not.toBe(teintes.vente);   // deux teintes distinctes
  expect(teintes.memeQueFond).toBe(false);          // et visibles sur le fond

  // …mais la couleur n'est JAMAIS le seul signal : le mot reste écrit sur chaque tuile.
  const etiquettes = await page.locator("#correctionsStation .scomm-lbl").allTextContents();
  expect(etiquettes.length).toBe(n);
  expect(etiquettes.every((t) => /achat|vente/i.test(t))).toBe(true);

  // Étroit : la grille se resserre au lieu de déborder horizontalement.
  await page.setViewportSize({ width: 520, height: 1000 });
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible();
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(debord).toBeLessThanOrEqual(1);
});

test("les filtres s'appliquent aux bonnes vues — légales uniquement (régression câblage)", async ({ page }) => {
  // Trajets : « légales uniquement » retire les routes de commodités illégales (souvent en tête de marge).
  const routesAll = await page.locator("#rows tr").count();
  await page.check("#legalOnly");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  const routesLegal = await page.locator("#rows tr").count();
  expect(routesLegal).toBeLessThan(routesAll);
  await page.uncheck("#legalOnly");

  // Boucles : le filtre doit aussi agir (<= car une boucle illégale n'est pas garantie en tête).
  await page.click("#viewLoops");
  const loopsAll = await page.locator("#loopRows tr").count();
  await page.check("#legalOnly");
  const loopsLegal = await page.locator("#loopRows tr").count();
  expect(loopsLegal).toBeLessThanOrEqual(loopsAll);
  await page.uncheck("#legalOnly");

  // Commodités : LE bug d'origine — « légales uniquement » doit masquer les commodités illégales.
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible();
  const commAll = await page.locator("#commGrid .comm-tile").count();
  await page.check("#legalOnly");
  const commLegal = await page.locator("#commGrid .comm-tile").count();
  expect(commLegal).toBeLessThan(commAll);
  await page.uncheck("#legalOnly");
});

test("Chaîne : le filtre « même système » contraint la chaîne (régression)", async ({ page }) => {
  await page.click("#viewChain");
  await expect(page.locator("#chainControls")).toBeVisible();
  const origin = await page.locator("#originList option").first().getAttribute("value");
  await page.fill("#chainOrigin", origin);
  await expect(page.locator("#chainOut .chain-leg").first()).toBeVisible();
  // Avec « même système », tous les badges système de la chaîne doivent être identiques. Ils sont
  // posés sur le fil d'Ariane `.chain-path` (un badge par étape), jamais dans les `.chain-leg`.
  await page.check("#sameSystem");
  await expect(page.locator("#chainOut .chain-leg").first()).toBeVisible();
  const systems = (await page.locator("#chainOut .chain-path .sys").allInnerTexts()).map((s) => s.trim());
  // Compter les badges AVANT de les comparer : `allInnerTexts()` n'attend rien et rend `[]` sur un
  // sélecteur mort, et `new Set([]).size` vaut 0 — donc toute assertion d'unicité seule reste verte
  // quand la classe visée est renommée. C'est cette garde qui empêche le test de redevenir creux.
  expect(systems.length).toBeGreaterThan(0);
  expect(new Set(systems).size).toBe(1);
});

// Pose la vue Chaîne sur un terminal de départ dont AU MOINS UN saut charge plusieurs commodités,
// et rend son rang. Balayer plutôt que prendre « le premier » : ce que la chaîne compose dépend du
// relevé du jour, et un test adossé à une origine précise décrirait le jeu de données plutôt que la
// propriété. Il échoue franchement si aucune des origines essayées ne convient.
async function chaineAvecSautMultiCommodites(page, essais = 12) {
  await page.click("#viewChain");
  await expect(page.locator("#chainControls")).toBeVisible();
  // `market.json` est chargé À LA DEMANDE : les contrôles de la vue sont visibles bien avant que la
  // liste des terminaux ne soit peuplée. `evaluateAll` n'attend rien et rendrait `[]` — le balayage
  // sortirait alors sans avoir essayé la moindre origine, sur une machine seulement plus chargée.
  await page.locator("#originList option").first().waitFor({ state: "attached", timeout: 15000 });
  const origines = await page.locator("#originList option").evaluateAll((os) => os.map((o) => o.value));
  for (const origine of origines.slice(0, essais)) {
    await page.fill("#chainOrigin", origine);
    // Attendre que la carte parle bien de CETTE origine. Le rendu est débouncé et la carte de
    // l'origine précédente reste à l'écran entre-temps : un simple `isVisible` ne retient rien et
    // ferait compter les lignes de la chaîne d'avant. Sans chaîne rentable, le fil d'Ariane n'existe
    // pas -> on passe à l'origine suivante.
    const depart = page.locator("#chainOut .chain-path .snode").first();
    const vue = await expect(depart).toHaveText(origine.split(" — ")[0], { timeout: 5000 }).then(() => true).catch(() => false);
    if (!vue) continue;
    const sauts = page.locator("#chainOut .chain-leg");
    const n = await sauts.count();
    for (let i = 0; i < n; i++) {
      if ((await sauts.nth(i).locator(".chain-line").count()) > 1) return i;
    }
  }
  throw new Error(`aucune des ${essais} premières origines ne donne un saut à plusieurs commodités`);
}

const nombreDe = (t) => Number(t.replace(/\D/g, ""));

test("Chaîne : un saut détaille les commodités qu'il transporte (#56)", async ({ page }) => {
  const i = await chaineAvecSautMultiCommodites(page);
  const saut = page.locator("#chainOut .chain-leg").nth(i);
  const lignes = saut.locator(".chain-line");
  const n = await lignes.count();
  expect(n).toBeGreaterThan(1);
  // Chaque ligne dit sa commodité, son volume et ce qu'elle rapporte : un saut se lit comme un
  // manifeste d'« En route », pas comme une commodité unique.
  let scu = 0;
  for (let l = 0; l < n; l++) {
    await expect(lignes.nth(l).locator(".commodity-cell")).not.toBeEmpty();
    const u = nombreDe(await lignes.nth(l).locator(".chain-line-scu").innerText());
    expect(u).toBeGreaterThan(0);
    await expect(lignes.nth(l).locator(".chain-line-profit")).not.toBeEmpty();
    scu += u;
  }
  // Le total du saut annonce la somme de ses lignes : c'est ce volume-là qui dit que la soute ne
  // repart plus avec la seule meilleure commodité.
  expect(nombreDe(await saut.locator(".chain-leg-scu").innerText())).toBe(scu);
});

const aPlat = (t) => t.replace(/\s+/g, " ").trim();

test("Chaîne : « ▶ Ajouter au voyage » pousse le chargement RÉEL du saut (#56)", async ({ page }) => {
  // Le budget est coupé pour la durée du test : la chaîne l'ignore par construction (README, note ¹)
  // là où la jambe de voyage le consomme, donc sous un budget bornant les deux chargements peuvent
  // légitimement différer. C'est le seul écart connu, et il ne touche pas ce que ce test prouve.
  await page.uncheck("#useBudget");
  const i = await chaineAvecSautMultiCommodites(page);
  const nSauts = await page.locator("#chainOut .chain-leg").count();
  const saut = page.locator("#chainOut .chain-leg").nth(i);
  const attendu = (await saut.locator(".chain-line").evaluateAll((ls) => ls.map((l) =>
    `${l.querySelector(".commodity-cell").innerText} ${l.querySelector(".chain-line-scu").innerText}`))).map(aPlat);
  const profitChaine = aPlat(await saut.locator(".chain-leg-profit").innerText());

  await page.click("#chainToJourney");
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(nSauts);
  const jambe = page.locator("#journeyCard .jleg").nth(i);
  await expect(jambe.locator(".jcargo-item").first()).toBeVisible({ timeout: 8000 });
  const obtenu = (await jambe.locator(".jcargo-item").evaluateAll((ls) => ls.map((l) => l.innerText))).map(aPlat);
  // Mêmes commodités, mêmes SCU, même profit : la carte Chaîne et la vue Voyage chiffraient deux
  // chargements différents pour le MÊME saut — l'une mono, l'autre multi — et l'affichaient.
  expect(obtenu).toEqual(attendu);
  expect(aPlat(await jambe.locator(".jleg-profit").innerText())).toBe(profitChaine);
});

// Pose la vue « En route » sur le premier terminal de départ proposé et rend la carte Manifeste.
async function enrouteSurLePremierTerminal(page) {
  await page.click("#viewEnroute");
  const origin = await page.locator("#originList option").first().getAttribute("value");
  await page.fill("#origin", origin);
  await expect(page.locator("#manifest")).toBeVisible();
}

test("En route : destination forçable (terminal d'arrivée imposé)", async ({ page }) => {
  await enrouteSurLePremierTerminal(page);
  await expect(page.locator("#destTerminal")).toBeVisible(); // Feature 1 : champ « terminal d'arrivée »
  // Forcer un terminal d'arrivée précis ne casse pas le rendu du manifeste.
  const term = await page.locator("#stationList option").first().getAttribute("value");
  await page.fill("#destTerminal", term);
  await expect(page.locator("#manifest")).toBeVisible();
});

// Séparé du test ci-dessus (#73) : sa précondition, elle, dépend des données. La fusionner rendait
// le `test.skip` fatal aux assertions « destination forçable », qui n'en dépendent pas.
test("En route : ajout LIBRE d'une commodité au manifeste, puis retrait", async ({ page }) => {
  await enrouteSurLePremierTerminal(page);
  // La carte Manifeste est TOUJOURS rendue, mais pas toujours avec son formulaire d'ajout :
  // renderManifest se réduit à une `.manifest-hint` quand la soute est désactivée ou qu'aucun
  // chargement n'est rentable depuis ce terminal — état produit légitime, donc un saut VISIBLE au
  // rapport. Un `if` muet, lui, laissait ce test au vert même si #manifestAddInput disparaissait,
  // alors que `.mline-del` n'est asserté nulle part ailleurs.
  test.skip(!(await page.locator("#manifestAddInput").count()), "aucun chargement rentable depuis ce terminal");
  const have = await page.locator("#manifest .mname").allInnerTexts();
  const opts = await page.locator("#commodityList option").evaluateAll((els) => els.map((e) => e.value));
  const toAdd = opts.find((o) => !have.some((h) => h.includes(o)));
  const before = await page.locator("#manifest .mline").count();
  await page.fill("#manifestAddInput", toAdd);
  await page.click("#manifestAddBtn");
  await expect(page.locator("#manifest .mline")).toHaveCount(before + 1);
  await page.locator("#manifest .mline-del").last().click();
  await expect(page.locator("#manifest .mline")).toHaveCount(before);
});

test("Compagnon de voyage : sélectionner un trajet affiche le parcours", async ({ page }) => {
  // Avant sélection : l'invite « démarrer un voyage » est affichée (plus d'étapes).
  await expect(page.locator("#journeyStartBtn")).toBeVisible();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(0);
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard")).toBeVisible();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2); // 2 stations pour 1 saut
  await expect(page.locator("#journeyCard .jstep.here")).toHaveCount(1);
  await page.locator("#journeyClear").click();
  // Après effacement : retour à l'invite de démarrage.
  await expect(page.locator("#journeyStartBtn")).toBeVisible();
});

test("Compagnon de voyage : sélectionner un trajet pré-remplit En route (départ/arrivée)", async ({ page }) => {
  const row = page.locator("#rows tr").first();
  const buyTerminal = (await row.locator(".term-name").nth(0).innerText()).trim();
  const sellTerminal = (await row.locator(".term-name").nth(1).innerText()).trim();
  await row.locator(".journey-pick").click();
  // Les champs En route sont pré-remplis avec la jambe courante.
  expect(await page.inputValue("#origin")).toContain(buyTerminal);
  expect(await page.inputValue("#destTerminal")).toContain(sellTerminal);
  // La vue En route affiche bien un manifeste vers la station d'arrivée.
  await page.click("#viewEnroute");
  await expect(page.locator("#manifest")).toContainText(sellTerminal);
});

test("Compagnon de voyage : pré-remplit Chaîne + remonte les boucles depuis l'arrivée", async ({ page }) => {
  // Chaîne : chainOrigin = station de départ courante.
  const row = page.locator("#rows tr").first();
  const buyTerminal = (await row.locator(".term-name").nth(0).innerText()).trim();
  await row.locator(".journey-pick").click();
  expect(await page.inputValue("#chainOrigin")).toContain(buyTerminal);

  // Boucles : sélectionne une route qui arrive sur un terminal de boucle -> les from-here remontent.
  await page.click("#viewLoops");
  const loopSet = new Set((await page.locator("#loopRows .term-name").allInnerTexts()).map((t) => t.trim()));
  await page.click("#viewRoutes");
  const routes = page.locator("#rows tr");
  const count = Math.min(await routes.count(), 60);
  let matched = false;
  for (let i = 0; i < count; i++) {
    const sell = (await routes.nth(i).locator(".term-name").nth(1).innerText()).trim();
    if (loopSet.has(sell)) { await routes.nth(i).locator(".journey-pick").click(); matched = true; break; }
  }
  // Précondition de DONNÉES (intersection routes × boucles), pas de code : un `if` muet comptait le
  // test comme réussi sans exécuter la seule assertion d'ORDRE que ce fichier porte (#73).
  test.skip(!matched, "aucune route vers un terminal de boucle dans le jeu de données");
  await page.click("#viewLoops");
  expect(await page.locator("#loopRows tr.from-here").count()).toBeGreaterThan(0);
  await expect(page.locator("#loopRows tr").first()).toHaveClass(/from-here/); // pertinentes en tête
});

test("Compagnon de voyage : effacer le parcours repeint la vue courante (#23)", async ({ page }) => {
  // clearJourney rendait la carte Voyage et sauvegardait, mais ne rappelait pas refresh() comme le
  // font tous les autres mutateurs du parcours. Les vues qui lisent JOURNEY à leur rendu gardaient
  // donc l'état d'avant : boucles hissées en tête avec le fond `.from-here`, tuiles « transportée »
  // encore ◆. L'état SAUVÉ, lui, était déjà correct — d'où l'invisibilité à tout test de persistance.
  await page.click("#viewLoops");
  await expect(page.locator("#loopRows tr").first()).toBeVisible();
  // Une boucle est un cycle A→B→A : la prendre place la fin du parcours sur SON propre terminal A,
  // elle se marque donc « from-here » sans dépendre d'une intersection dans le jeu de données.
  await page.locator("#loopRows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#loopRows tr.from-here").first()).toBeVisible();

  await page.locator("#journeyClear").click();
  await expect(page.locator("#journeyStartBtn")).toBeVisible(); // le parcours est bien effacé…
  await expect(page.locator("#loopRows tr.from-here")).toHaveCount(0); // …et la vue le sait
});

test("Compagnon de voyage : cliquer une étape recale En route (position interactive)", async ({ page }) => {
  const row = page.locator("#rows tr").first();
  const buyTerminal = (await row.locator(".term-name").nth(0).innerText()).trim();
  const sellTerminal = (await row.locator(".term-name").nth(1).innerText()).trim();
  await row.locator(".journey-pick").click();
  expect(await page.inputValue("#origin")).toContain(buyTerminal); // au départ
  // Clique la station d'arrivée -> « je suis là » -> En route repart de l'arrivée.
  await page.locator("#journeyCard .jstep").nth(1).click();
  await expect(page.locator("#journeyCard .jstep").nth(1)).toHaveClass(/here/);
  expect(await page.inputValue("#origin")).toContain(sellTerminal);
});

test("Compagnon de voyage : étendre le parcours avec une boucle depuis l'arrivée", async ({ page }) => {
  await page.click("#viewLoops");
  const loopSet = new Set((await page.locator("#loopRows .term-name").allInnerTexts()).map((t) => t.trim()));
  await page.click("#viewRoutes");
  const routes = page.locator("#rows tr");
  const count = Math.min(await routes.count(), 60);
  let matched = false;
  for (let i = 0; i < count; i++) {
    const sell = (await routes.nth(i).locator(".term-name").nth(1).innerText()).trim();
    if (loopSet.has(sell)) { await routes.nth(i).locator(".journey-pick").click(); matched = true; break; }
  }
  test.skip(!matched, "aucune route vers un terminal de boucle dans le jeu de données");
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2); // 1 saut = 2 stations
  await page.click("#viewLoops");
  await page.locator("#loopRows tr.from-here").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(4); // + boucle (2 sauts) = 3 sauts, 4 stations
});

test("Compagnon de voyage : le parcours survit au rechargement (persistance)", async ({ page }) => {
  const row = page.locator("#rows tr").first();
  const sellTerminal = (await row.locator(".term-name").nth(1).innerText()).trim();
  await row.locator(".journey-pick").click();
  await expect(page.locator("#journeyCard")).toBeVisible();
  await page.reload();
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(page.locator("#journeyCard")).toBeVisible();             // restauré
  await expect(page.locator("#journeyCard")).toContainText(sellTerminal);
});

test("Compagnon de voyage : manifeste optimal affiché par jambe", async ({ page }) => {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(1);
  // Le manifeste (cargaison) se calcule (MARKET chargé à la demande).
  await expect(page.locator("#journeyCard .jleg .jcargo-item").first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#journeyCard .jleg-profit").first()).toContainText("+");
  // Chaque matériau porte un indicateur de fraîcheur des données (pastille colorée).
  await expect(page.locator("#journeyCard .jcargo-item .fresh-dot").first()).toBeVisible();
  await expect(page.locator("#journeyCard .jcargo-item .fresh-dot")).toHaveCount(
    await page.locator("#journeyCard .jcargo-item").count()
  );
  // Le récap du voyage (colonne de gauche) affiche profit total + KPIs.
  await expect(page.locator("#journeyRecap")).toBeVisible();
  await expect(page.locator("#journeyRecap .recap-profit")).toContainText("aUEC");
  await expect(page.locator("#journeyRecap .recap-kpi")).toHaveCount(4);
});

test("Compagnon de voyage : les commodités transportées sont surlignées dans le board", async ({ page }) => {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jcargo-item").first()).toBeVisible({ timeout: 8000 });
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile.carried")).not.toHaveCount(0); // au moins une surlignée
  await expect(page.locator("#commGrid .comm-tile.carried .tile-carried").first()).toBeVisible();
});

// Démarre un voyage depuis la première ligne QUI PROPOSE UNE SUGGESTION D'ARRÊT. Ces tests visaient
// la première ligne du tableau, donc une route précise — et le tri par défaut ayant changé pour le
// profit net (ADR-005), cette route n'a plus de suite rentable dans les filtres par défaut. Ils
// testaient l'ordre du classement en croyant tester le compagnon de voyage. On balaie donc les
// premières lignes jusqu'à en trouver une qui a des suggestions, et on échoue franchement si aucune
// n'en a — ce qui reste une vraie régression du dispositif.
async function voyageAvecSuggestion(page, essais = 8) {
  for (let i = 0; i < essais; i++) {
    await page.locator("#rows tr").nth(i).locator(".journey-pick").click();
    const sug = page.locator("#journeyCard .jstop-suggest").first();
    if (await sug.isVisible().catch(() => false)) return;
    await sug.waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
    if (await sug.isVisible().catch(() => false)) return;
    await page.locator("#journeyClear").click().catch(() => {});
  }
  throw new Error(`aucune des ${essais} premières lignes ne propose d'arrêt suivant`);
}

test("Compagnon de voyage : ajouter un arrêt (suggestion) étend le parcours", async ({ page }) => {
  await voyageAvecSuggestion(page);
  const stopsBefore = await page.locator("#journeyCard .jstep").count();
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(stopsBefore + 1);
});

test("Compagnon de voyage : retirer un arrêt du milieu reconnecte le parcours", async ({ page }) => {
  await voyageAvecSuggestion(page);
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3); // 3 arrêts
  const first = (await page.locator("#journeyCard .jstep").nth(0).innerText()).trim();
  const last = (await page.locator("#journeyCard .jstep").nth(2).innerText()).trim();
  await page.locator("#journeyCard .jstep-del").nth(1).click(); // retire le milieu
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2); // reconnecté A->C
  expect((await page.locator("#journeyCard .jstep").nth(0).innerText()).trim()).toBe(first);
  expect((await page.locator("#journeyCard .jstep").nth(1).innerText()).trim()).toBe(last);
});

test("Multi commodité : « avec les simples » remet les trajets à une commodité dans le classement", async ({ page }) => {
  const simples = page.locator("#rows tr .cname").filter({ hasText: /^1 commodité$/ });
  await expect(page.locator("#multiModeField")).toBeHidden(); // réglage de la coche : caché sans elle
  await page.check("#multiCommodity");
  await expect(page.locator("#multiModeField")).toBeVisible();
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(simples).toHaveCount(0); // par défaut : chargements combinés seulement
  await page.selectOption("#multiMode", "all");
  await expect(simples.first()).toBeVisible(); // les deux sortes, dans le MÊME classement
  expect(page.url()).toContain("multiMode=all");
  await page.reload();
  await expect(page.locator("#multiMode")).toHaveValue("all"); // le mode survit au rechargement
  await expect(page.locator("#multiModeField")).toBeVisible();
});

// ---------- La soute (ADR-002) ----------
// Les lots de la soute, tels que persistés — la source de vérité, plus lisible qu'un texte de panneau.
const lots = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-hold") || "[]"));
const holdScuDe = (ls) => ls.reduce((s, l) => s + l.units, 0);
// Le stock EFFECTIF d'un point d'achat, lu là où l'app l'affiche : la vue Corrections. C'est le seul
// endroit qui montre ce que la station annonce APRÈS déduction — donc le seul juge des chargements.
async function stockAchat(page, station, nom) {
  await page.click("#viewCorrections");
  await page.fill("#station", station);
  const c = page.locator(`#correctionsStation .editv[data-c="${nom}"][data-s="buy"][data-f="vol"]`).first();
  await expect(c).toBeVisible({ timeout: 8000 });
  return Number(await c.getAttribute("data-v"));
}

async function jambeChargeable(page) {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg-load")).toBeVisible({ timeout: 8000 });
}

test("Soute : « chargé » prend le manifeste au prix affiché, et le geste s'annule", async ({ page }) => {
  await expect(page.locator("#holdCard")).toBeHidden(); // pas de fret, pas de panneau
  await jambeChargeable(page);
  const cargo = (await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim();

  await page.locator("#journeyCard .jleg-load").click();
  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(page.locator("#journeyCard .jleg-load")).toHaveText(/à bord/i);

  // Un lot par ligne du manifeste, avec le prix que l'app venait d'afficher — jamais 0.
  const lots = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-hold")));
  expect(lots.length).toBeGreaterThan(0);
  for (const l of lots) {
    expect(l.paid).toBeGreaterThan(0); // LE point d'ADR-002 : le coût cesse d'être nul
    expect(l.units).toBeGreaterThan(0);
    expect(l.from).toBe("Megumi");
  }
  // Les SCU de la soute correspondent bien au manifeste chargé.
  const scu = lots.reduce((s, l) => s + l.units, 0);
  await expect(page.locator("#holdCard .hold-meta")).toContainText(String(scu));
  expect(cargo).toContain(String(lots[0].units));

  // Re-cliquer annule le chargement : rien n'est à bord, le panneau disparaît.
  await page.locator("#journeyCard .jleg-load").click();
  await expect(page.locator("#holdCard")).toBeHidden();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-hold")))).toEqual([]);
});

test("Soute : charger DÉDUIT le stock de la station, et annuler le rend", async ({ page }) => {
  // Sans ça, la station continuait d'annoncer un stock qu'on venait d'emporter, et le manifeste
  // suivant le reproposait. Les 494 points d'achat de l'instantané publient tous leur stock.
  const stock = async (nom) => {
    await page.click("#viewCorrections");
    await page.fill("#station", "Megumi — Pyro");
    const c = page.locator(`#correctionsStation .editv[data-c="${nom}"][data-s="buy"][data-f="vol"]`).first();
    await expect(c).toBeVisible({ timeout: 8000 });
    return Number(await c.getAttribute("data-v"));
  };

  await manifesteDepuis(page, "Megumi — Pyro");
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");
  const pris = Number(await page.locator("#manifest .mline", { hasText: nom }).first().locator(".mqty-input").inputValue());
  const avant = await stock(nom);
  expect(pris).toBeGreaterThan(0);

  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();

  expect(await stock(nom)).toBe(Math.max(0, avant - pris)); // le rayon s'est vidé d'autant
  await expect(page.locator("#viewCorrections")).toHaveText(/Corrections \(\d+\)/); // c'est une correction locale

  // Annuler rend EXACTEMENT ce qui avait été retiré — le lot porte la valeur d'avant.
  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeHidden();
  expect(await stock(nom)).toBe(avant);
});

test("Soute : avoir pris plus que le stock publié met le rayon à 0, jamais en négatif", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");
  // On force la prise BIEN au-delà de ce que la station annonce : le relevé était faux.
  await page.locator("#manifest .mline", { hasText: nom }).first().locator(".mqty-input").fill("99999");
  await page.locator("#manifest .mline", { hasText: nom }).first().locator(".mqty-input").blur();
  await page.click("#manifestToJourney");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.click("#viewCorrections");
  await page.fill("#station", "Megumi — Pyro");
  const c = page.locator(`#correctionsStation .editv[data-c="${nom}"][data-s="buy"][data-f="vol"]`).first();
  await expect(c).toBeVisible({ timeout: 8000 });
  expect(Number(await c.getAttribute("data-v"))).toBe(0); // et surtout pas une valeur négative
});

test("Soute : elle survit au rechargement, et effacer le VOYAGE ne la vide pas", async ({ page }) => {
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.reload();
  // La vue restaurée est « En route » (c'est de là qu'on a engagé la jambe) : on attend le
  // compagnon, pas la table des Trajets qui est masquée.
  await expect(page.locator("#journeyCard .jstep").first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#holdCard")).toBeVisible(); // aucune péremption : le fret est réel

  // Le parcours est un PLAN, la soute est du fret payé : effacer l'un ne débarque pas l'autre.
  await page.locator("#journeyClear").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(0);
  await expect(page.locator("#holdCard")).toBeVisible();

  // Seul son propre ✕ la vide.
  await page.locator("#holdClear").click();
  await expect(page.locator("#holdCard")).toBeHidden();
});

test("Soute : sans voyage, la carte suit toujours les filtres (#8)", async ({ page }) => {
  // Effacer le parcours ne vide pas la soute (c'est le contrat), mais `refresh()` ne repeignait le
  // compagnon que `if (JOURNEY)` : la carte restait figée sur son dernier rendu pendant que les
  // tableaux d'à côté, eux, suivaient les filtres.
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  const aBord = holdScuDe(await lots(page));
  expect(aBord).toBeGreaterThan(0);

  await page.locator("#journeyClear").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(0);
  await expect(page.locator("#holdCard")).toBeVisible(); // le fret est réel, il survit au plan

  // Agrandir la soute doit rebattre « X libres » — sans voyage comme avec.
  await page.fill("#cargo", String(aBord + 250));
  await expect(page.locator("#holdCard .hold-meta")).toContainText(/\b250 libres/);

  // Et décocher « Soute (SCU) » doit faire DISPARAÎTRE la place libre : plus de plafond, plus de
  // chiffre — la carte ne doit pas garder l'ancien.
  await page.uncheck("#useCargo");
  await expect(page.locator("#holdCard .hold-meta")).not.toContainText("libres");
});

test("Soute : le champ de vente fige la station résolue au rendu (#8)", async ({ page }) => {
  // L'infobulle annonce un prix ; sans index figé, `vendreIci` relisait `stationCourante()` au clic
  // et pouvait encaisser à une AUTRE station que celle dont l'utilisateur venait de lire le chiffre.
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  await page.locator("#holdCard .hold-sell-btn").first().click();
  // `toMatch` et non `Number.isFinite` : getAttribute rend `null` quand l'attribut manque, et
  // `Number(null)` vaut 0 — un index de terminal parfaitement valide. Le test passerait à faux.
  expect(await page.locator("#holdCard .hold-sell").first().getAttribute("data-idx")).toMatch(/^\d+$/);
});

test("Soute : retirer un arrêt AVANT une jambe chargée ne la rend pas rechargeable (#7)", async ({ page }) => {
  // L'étiquette du lot portait le RANG de la jambe, et seuls DEUX des trois porteurs de ce rang
  // étaient renumérotés. Retirer un arrêt d'avant faisait donc repasser le bouton à « ✓ chargé »
  // alors que le fret était à bord — et le clic suivant doublait la soute en redéduisant le stock.
  await jambeChargeable(page);
  await expect(page.locator("#journeyCard .jstop-suggest").first()).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  // Le bouton n'existe que sur une jambe qui a du fret : viser nth(1) à l'aveugle pourrait
  // désigner la jambe 0 — celle qui va disparaître — et rendre le test faussement vert.
  await expect(page.locator("#journeyCard .jleg-load")).toHaveCount(2);

  await page.locator("#journeyCard .jleg-load").nth(1).click(); // on charge la SECONDE jambe (rang 1)
  await expect(page.locator("#journeyCard .jleg-load").nth(1)).toHaveText(/à bord/i);
  const scu = holdScuDe(await lots(page));
  expect(scu).toBeGreaterThan(0);

  await page.locator("#journeyCard .jstep-del").nth(0).click(); // ✕ 1er arrêt : la jambe passe au rang 0
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/à bord/i); // avant : « ✓ chargé »
  expect(holdScuDe(await lots(page))).toBe(scu);

  // Et re-cliquer ANNULE le chargement, au lieu d'en ajouter un second exemplaire.
  await page.locator("#journeyCard .jleg-load").first().click();
  expect(holdScuDe(await lots(page))).toBe(0);
});

test("Soute : vider la soute ne rend pas la jambe rechargeable, le rayon n'est pas déduit deux fois (#21)", async ({ page }) => {
  // « Cette jambe est chargée » se DÉDUISAIT de la présence de ses lots. Le ✕ de la soute — comme
  // une vente — les faisait disparaître sans rien rendre à la station : le bouton repassait à
  // « ✓ chargé », le clic suivant redéduisait le rayon DEPUIS le stock déjà amputé (100 → 40 → 0),
  // et la valeur d'origine était perdue pour de bon.
  await manifesteDepuis(page, "Megumi — Pyro");
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");
  const pris = Number(await page.locator("#manifest .mline", { hasText: nom }).first().locator(".mqty-input").inputValue());
  expect(pris).toBeGreaterThan(0);
  const avant = await stockAchat(page, "Megumi — Pyro", nom);

  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  expect(await stockAchat(page, "Megumi — Pyro", nom)).toBe(Math.max(0, avant - pris));

  // Le ✕ débarque le fret ; il ne DÉCHARGE pas la jambe — rien n'est revenu au rayon.
  await page.click("#viewEnroute");
  await page.locator("#holdClear").click();
  await expect(page.locator("#holdCard")).toBeHidden();
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/à bord/i);
  expect(await stockAchat(page, "Megumi — Pyro", nom)).toBe(Math.max(0, avant - pris));

  // Le clic suivant ANNULE, il ne recharge pas : le rayon retrouve exactement sa valeur d'origine.
  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/chargé/i);
  expect(await stockAchat(page, "Megumi — Pyro", nom)).toBe(avant);
});

test("Soute : annuler une jambe ne rend au rayon que CE QU'ELLE y a pris (#22)", async ({ page }) => {
  // Parcours A→B→A→C : les jambes 0 et 2 achètent la MÊME commodité au MÊME point. Annuler la
  // première réécrivait un instantané ABSOLU du stock d'avant, effaçant la déduction de la seconde
  // — la station reproposait aussitôt un stock fantôme, toujours à bord.
  const plan = await page.evaluate(async () => {
    const m = await (await fetch("data/market.json")).json();
    const a = m.terminals.findIndex((t) => t.name === "Megumi");
    if (a < 0) return null;
    for (const c of m.commodities) {
      const b = c.buys.find((x) => x[0] === a);
      if (!b || !(b[2] >= 30)) continue;                                  // du stock, et de quoi le partager
      const u = Math.floor(b[2] / 3);
      // Une capacité de vente trop petite plafonnerait la ligne du manifeste, pas la prise.
      const dest = c.sells.filter((x) => x[0] !== a && (x[2] == null || x[2] >= u)).slice(0, 2);
      if (dest.length < 2) continue;
      const nomSys = (i) => [m.terminals[i].name, m.terminals[i].system];
      return { nom: c.name, units: u, a: nomSys(a), b: nomSys(dest[0][0]), d: nomSys(dest[1][0]) };
    }
    return null;
  });
  test.skip(!plan, "aucune commodité de Megumi n'a du stock à partager entre deux débouchés");

  const [A, As] = plan.a, [B, Bs] = plan.b, [D, Ds] = plan.d;
  // Le parcours passe par le lien partageable ; les manifestes des jambes 0 et 2 sont IMPOSÉS, sinon
  // rien ne garantit qu'elles choisiraient la même commodité au même point.
  await page.evaluate(({ A, B, D, nom, units }) => {
    localStorage.setItem("best-hauling-journey-edits-v2", JSON.stringify({
      [`0|${A}|${B}`]: [{ name: nom, units }],
      [`1|${B}|${A}`]: [],
      [`2|${A}|${D}`]: [{ name: nom, units }],
    }));
  }, { A, B, D, nom: plan.nom, units: plan.units });

  const j = JSON.stringify({ c: 0, l: [[A, As, B, Bs], [B, Bs, A, As], [A, As, D, Ds]].map(([f, fs, t, ts]) => [f, fs, t, ts, plan.nom, 0, 0, 0]) });
  await page.goto("/index.html#" + new URLSearchParams({ v: "enroute", cargo: "5000", useCargo: "1", j }).toString());
  await page.reload(); // un `goto` qui ne change que le fragment ne relit pas l'état au démarrage
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(4, { timeout: 8000 });
  await expect(page.locator("#journeyCard .jleg-load")).toHaveCount(2); // la jambe 1 ne charge rien

  const station = `${A} — ${As}`;
  const ref = await stockAchat(page, station, plan.nom);
  expect(ref).toBeGreaterThanOrEqual(plan.units * 2);

  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").nth(0).click(); // jambe 0 : A→B
  expect(await stockAchat(page, station, plan.nom)).toBe(ref - plan.units);
  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").nth(1).click(); // jambe 2 : A→C, même rayon
  expect(await stockAchat(page, station, plan.nom)).toBe(ref - plan.units * 2);

  // On se ravise sur la jambe 0 : le rayon ne récupère QUE ses SCU. Ceux de la jambe 2 sont
  // toujours à bord, prise chez lui — les lui rendre inventerait du stock.
  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").nth(0).click();
  expect(await stockAchat(page, station, plan.nom)).toBe(ref - plan.units);
});

test("Soute : une soute écrite AVANT le registre des chargements reste chargée et annulable", async ({ page }) => {
  // Garde-fou de migration : chez qui a déjà du fret à bord, l'état « chargée » vit sur les lots
  // (`leg`) et le stock d'avant dans `avant`. Sans reprise, la jambe repasserait à « ✓ chargé » au
  // premier rechargement — le bug #21 servi à froid, sans que l'utilisateur ait rien touché.
  await manifesteDepuis(page, "Megumi — Pyro");
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");
  const avant = await stockAchat(page, "Megumi — Pyro", nom);
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  const apresCharge = await stockAchat(page, "Megumi — Pyro", nom);
  expect(apresCharge).toBeLessThan(avant);
  await page.click("#viewEnroute");

  // On rétrograde le stockage au format d'avant : le registre disparaît, `avant` revient sur les lots.
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem("best-hauling-jambes-chargees") || "{}");
    const refs = new Map();
    for (const prises of Object.values(reg)) for (const p of prises) refs.set(`${p.name}|${p.terminal}`, p.ref);
    const vieux = JSON.parse(localStorage.getItem("best-hauling-hold") || "[]")
      .map((l) => (refs.has(`${l.name}|${l.from}`) ? { ...l, avant: refs.get(`${l.name}|${l.from}`) } : l));
    localStorage.setItem("best-hauling-hold", JSON.stringify(vieux));
    localStorage.removeItem("best-hauling-jambes-chargees");
  });
  await page.reload();
  await expect(page.locator("#journeyCard .jleg-load").first()).toHaveText(/à bord/i, { timeout: 8000 });
  expect(await stockAchat(page, "Megumi — Pyro", nom)).toBe(apresCharge); // la correction n'a pas bougé

  await page.click("#viewEnroute");
  await page.locator("#journeyCard .jleg-load").first().click();
  expect(await stockAchat(page, "Megumi — Pyro", nom)).toBe(avant); // annuler rend toujours exactement
});

test("Soute : recharger la même commodité crée un SECOND lot, sans fondre les prix", async ({ page }) => {
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").click();
  const avant = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-hold")));

  // Un second chargement depuis une autre station : les lots s'ajoutent, ils ne fusionnent pas.
  await page.evaluate((lots) => {
    const doubles = lots.map((l) => ({ ...l, paid: l.paid + 500, from: "Ruin Station", leg: "9|X|Y" }));
    localStorage.setItem("best-hauling-hold", JSON.stringify(lots.concat(doubles)));
  }, avant);
  await page.reload();
  await expect(page.locator("#holdCard")).toBeVisible({ timeout: 8000 });

  // Une ligne par commodité, avec le détail des lots dessous.
  await expect(page.locator("#holdCard .hold-line")).toHaveCount(avant.length);
  await expect(page.locator("#holdCard .hold-lot").first()).toBeVisible();
  const total = avant.reduce((s, l) => s + l.units, 0) * 2;
  await expect(page.locator("#holdCard .hold-meta")).toContainText(String(total));
});

test("Soute : vente partielle — le reste est REFUSÉ ici et survit au départ", async ({ page }) => {
  // Le scénario d'ADR-002, de bout en bout : le comptoir ne prend qu'une partie, on repart avec
  // le reste, et quitter l'escale — qui vaut « j'ai tout vendu ici » — ne doit PAS l'effacer.
  await jambeChargeable(page);
  await page.locator("#journeyCard .jstop-suggest").first().click(); // un 3e arrêt, pour pouvoir repartir
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  const totalDepart = holdScuDe(await lots(page));

  // On arrive à l'escale : quitter le DÉPART n'a rien vendu (il ne rachète pas ce qu'on y a pris).
  await page.locator("#journeyCard .jstep").nth(1).click();
  expect(holdScuDe(await lots(page))).toBe(totalDepart);

  // Vente partielle de 10 SCU sur la 1re commodité que l'escale reprend.
  const vendre = page.locator("#holdCard .hold-sell-btn").first();
  test.skip(!(await vendre.count()), "cette escale ne reprend rien de la cargaison du jour");
  const nom = await vendre.getAttribute("data-name");
  await vendre.click();
  await page.locator("#holdCard .hold-sell-qty").fill("10");
  await page.locator("#holdCard .hold-sell-ok").click();

  const apresVente = await lots(page);
  expect(holdScuDe(apresVente)).toBe(totalDepart - 10);
  // Le reliquat de CETTE commodité porte le marqueur de refus ; les autres non.
  const reste = apresVente.filter((l) => l.name === nom);
  expect(reste.length).toBeGreaterThan(0);
  for (const l of reste) expect(l.refuse).toBeTruthy();
  for (const l of apresVente.filter((l) => l.name !== nom)) expect(l.refuse).toBeFalsy();

  // On quitte l'escale : ce qu'elle reprenait part, le refusé reste.
  await page.locator("#journeyCard .jstep").nth(2).click();
  const final = await lots(page);
  expect(final.every((l) => l.name === nom)).toBe(true);          // seul le refusé a survécu
  expect(holdScuDe(final)).toBe(holdScuDe(reste));
});

test("Soute : « où écouler » classe les destinations et affiche la certitude", async ({ page }) => {
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.locator("#holdOffload").click();
  const dest = page.locator("#holdCard .ec-dest");
  await expect(dest.first()).toBeVisible();
  expect(await dest.count()).toBeGreaterThan(1);

  // Classé par ce que ça RAPPORTE, prix d'achat déduit — et le signe est porté, pas gommé.
  const profits = (await dest.locator(".ec-profit").allTextContents())
    .map((t) => Number(t.replace(/\s/g, "").replace(/[^\d+-]/g, "")));
  for (const v of profits) expect(Number.isFinite(v)).toBe(true);
  for (let i = 1; i < profits.length; i++) expect(profits[i - 1]).toBeGreaterThanOrEqual(profits[i]);

  // Chaque destination dit sur quoi son chiffre repose — 84 % des capacités ne sont pas publiées.
  for (const t of await dest.locator(".ec-detail").allTextContents()) {
    expect(t).toMatch(/garantis|capacité inconnue/);
  }
  // Et se referme.
  await page.locator("#holdOffload").click();
  await expect(page.locator("#holdCard .ec-dest")).toHaveCount(0);
});

test("Soute : déposer à la station libère la place sans vendre", async ({ page }) => {
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  const avant = await lots(page);
  const nom = avant[0].name;

  // Déposer marche MÊME si le comptoir ne reprend pas la commodité : c'est tout l'intérêt.
  const ouvrir = page.locator("#holdCard .hold-line", { hasText: nom }).locator(".hold-sell-btn");
  await expect(ouvrir).toBeVisible();
  await ouvrir.click();
  await page.locator("#holdCard .hold-sell-qty").fill("5");
  await page.locator("#holdCard .hold-store").click();

  expect(holdScuDe(await lots(page))).toBe(holdScuDe(avant) - 5);
  const depots = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-depots") || "{}"));
  const tout = Object.values(depots).flat();
  expect(tout.length).toBe(1);
  expect(tout[0].units).toBe(5);
  expect(tout[0].paid).toBeGreaterThan(0); // ni vendu ni perdu : le capital reste tracé
});

test("Entrepôts : le fret déposé s'affiche, et « reprendre » le rend à la soute (#10)", async ({ page }) => {
  // Le dépôt n'existait qu'en localStorage : sans panneau, il était indiscernable d'une perte, et
  // rien ne permettait de le récupérer — alors que le toast promet « ni vendus ni perdus ».
  await expect(page.locator("#depotsCard")).toBeHidden();
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  const avant = await lots(page);
  const nom = avant[0].name;

  await page.locator("#holdCard .hold-line", { hasText: nom }).locator(".hold-sell-btn").click();
  await page.locator("#holdCard .hold-sell-qty").fill("5");
  await page.locator("#holdCard .hold-store").click();

  // La carte apparaît, nomme la station et chiffre le capital immobilisé.
  await expect(page.locator("#depotsCard")).toBeVisible();
  await expect(page.locator("#depotsCard")).toContainText("5 SCU");
  await expect(page.locator("#depotsCard .hold-meta")).toContainText("capital immobilisé");
  expect(holdScuDe(await lots(page))).toBe(holdScuDe(avant) - 5);

  // Reprendre : le fret revient à bord, la station vidée disparaît, la carte se masque.
  await page.locator("#depotsCard .depot-take").first().click();
  expect(holdScuDe(await lots(page))).toBe(holdScuDe(avant));
  await expect(page.locator("#depotsCard")).toBeHidden();
  const depotsApres = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-depots") || "{}"));
  expect(Object.keys(depotsApres)).toEqual([]);

  // Et il survit à un rechargement : c'est du fret réel, pas un état de vue.
  await page.locator("#holdCard .hold-line", { hasText: nom }).locator(".hold-sell-btn").click();
  await page.locator("#holdCard .hold-sell-qty").fill("3");
  await page.locator("#holdCard .hold-store").click();
  await expect(page.locator("#depotsCard")).toBeVisible();
  await page.reload();
  await expect(page.locator("#depotsCard")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#depotsCard")).toContainText("3 SCU");
});

test("Soute : reculer d'une étape ne revend rien", async ({ page }) => {
  // Revenir sur ses pas n'est pas une transaction : seule l'AVANCÉE vaut « j'ai fait mon affaire ».
  await jambeChargeable(page);
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await page.locator("#journeyCard .jleg-load").first().click();
  await expect(page.locator("#holdCard")).toBeVisible();
  await page.locator("#journeyCard .jstep").nth(2).click(); // on avance jusqu'au bout
  const apres = holdScuDe(await lots(page));
  await page.locator("#journeyCard .jstep").nth(0).click();  // puis on recule
  expect(holdScuDe(await lots(page))).toBe(apres);           // inchangé
});

// ---------- Carte 2D du parcours (ADR-001) ----------
// ---------- Déclarer « j'ai ça à bord » sans passer par une jambe (#55) ----------
// L'ADR-002 réservait ce repli (option D) sans jamais le câbler : la soute n'avait qu'un robinet,
// au bout d'un entonnoir de six gestes, et rien n'y entrait sans voyage, jambe et marché chargé.

// Les milliers sont séparés par une espace insécable étroite en fr-FR : on tolère n'importe quelle
// espace plutôt que de coder en dur le caractère qu'ICU a choisi ce mois-ci.
const fr = (n) => new RegExp(String(n).replace(/\B(?=(\d{3})+$)/g, "\\s*"));

async function ouvrirDeclaration(page) {
  await page.locator("#holdAddOpen").click();
  await expect(page.locator("#holdAddName")).toBeVisible();
  // Le marché n'est chargé qu'à la demande (la vue par défaut ne lit que routes.json) : c'est le
  // clic lui-même qui le réclame, et l'autocomplétion arrive avec lui.
  await expect.poll(() => page.locator("#commodityList option").count()).toBeGreaterThan(0);
}

async function declarer(page, nom, scu, prix = null) {
  await ouvrirDeclaration(page);
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", String(scu));
  if (prix != null) await page.fill("#holdAddPaid", String(prix));
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();
}

// « Je suis à » : sans voyage, c'est le terminal de départ d'« En route » qui fait office de
// position — un seul champ pour les deux, pas deux vérités.
async function positionner(page, label) {
  await page.fill("#holdWhere", label);
  await expect(page.locator("#origin")).toHaveValue(label);
}

// Les commodités proposées par l'autocomplétion, dans l'ordre du marché.
const commodites = (page) =>
  page.locator("#commodityList option").evaluateAll((o) => o.map((x) => x.value));

test("Soute : déclarer du fret à bord sans voyage, sans jambe et sans manifeste (#55)", async ({ page }) => {
  // À vide, la carte Soute est masquée : sans point d'entrée ailleurs, la fonctionnalité était
  // littéralement indécouvrable — zéro bouton dans la page pour ouvrir quoi que ce soit.
  await expect(page.locator("#holdCard")).toBeHidden();
  await expect(page.locator("#holdAddOpen")).toBeVisible();

  await ouvrirDeclaration(page);
  const nom = (await commodites(page))[0];
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", "220");
  await page.fill("#holdAddPaid", "1000");
  await page.locator("#holdAddOk").click();

  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(page.locator("#holdCard .hold-line")).toContainText(nom);
  await expect(page.locator("#holdCard .hold-meta")).toContainText(fr(220));
  await expect(page.locator("#holdCard .hold-meta")).toContainText(fr(220000)); // capital engagé

  // La place libre compte le lot déclaré comme n'importe quel autre : c'est le même fret.
  await page.fill("#cargo", "1000");
  await expect(page.locator("#holdCard .hold-meta")).toContainText(/780 libres/);

  const ls = await lots(page);
  expect(ls.length).toBe(1);
  expect(ls[0]).toMatchObject({ name: nom, units: 220, paid: 1000, from: "" });
  // Le contrat du lot manuel : pas de jambe, donc aucune jambe ne prétend l'avoir chargé.
  expect("leg" in ls[0]).toBe(false);
  const registre = await page.evaluate(() => localStorage.getItem("best-hauling-jambes-chargees"));
  expect(JSON.parse(registre || "{}")).toEqual({});
});

test("Soute : la déclaration est atteignable depuis les SIX vues (#55)", async ({ page }) => {
  const vues = ["viewRoutes", "viewLoops", "viewEnroute", "viewChain", "viewCorrections", "viewCommodities"];
  for (const v of vues) {
    await page.click(`#${v}`);
    await expect(page.locator("#holdAddOpen"), `point d'entrée soute absent de #${v}`).toBeVisible();
  }
  // Et le geste marche vraiment là où rien ne parle de voyage : Commodités, puis Trajets.
  await page.click("#viewCommodities");
  await ouvrirDeclaration(page);
  const noms = await commodites(page);
  await page.fill("#holdAddName", noms[0]);
  await page.fill("#holdAddScu", "40");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();
  await expect(page.locator("#commodities")).toBeVisible(); // déclarer n'a pas changé de vue

  await page.click("#viewRoutes");
  await declarer(page, noms[1], 60, 500);
  expect(holdScuDe(await lots(page))).toBe(100);
});

test("Soute : prix laissé vide = BUTIN, et l'écran le dit (#55)", async ({ page }) => {
  await ouvrirDeclaration(page);
  const nom = (await commodites(page))[0];
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", "150");
  await page.locator("#holdAddOk").click(); // prix laissé vide

  const ls = await lots(page);
  expect(ls[0].paid).toBe(0); // du butin n'a rien coûté
  // Ce zéro change le sens du profit de « où écouler » : il ne doit pas passer inaperçu.
  const ligne = page.locator("#holdCard .hold-line", { hasText: nom });
  await expect(ligne.locator(".hold-butin")).toBeVisible();
  await expect(ligne.locator(".hold-butin")).toHaveAttribute("title", /profit|coût nul|rien payé/i);
});

test("Soute : « où écouler » répond à une soute DÉCLARÉE, sans le moindre voyage (#55)", async ({ page }) => {
  // Le vrai bénéfice : « j'ai 2 200 SCU de X, qui les reprend ? » — la question à laquelle l'app ne
  // savait répondre qu'après un manifeste, un voyage et un « ✓ chargé ».
  await ouvrirDeclaration(page);
  const noms = (await commodites(page)).slice(0, 12);
  await page.locator("#holdAddNo").click();

  // Aucune ligne « bien connue » en dur : on balaie jusqu'à une commodité qui a un débouché depuis
  // ce quai, et on échoue franchement si aucune des douze n'en a.
  let trouve = null;
  for (const nom of noms) {
    await declarer(page, nom, 2200, 1000);
    await positionner(page, "Megumi — Pyro");
    if (!(await page.locator("#holdCard .ec-head").count())) await page.locator("#holdOffload").click();
    await expect(page.locator("#holdCard .hold-ecouler")).toBeVisible();
    if ((await page.locator("#holdCard .ec-dest").count()) > 0) { trouve = nom; break; }
    await page.locator("#holdClear").click();
  }
  expect(trouve, "aucune des douze commodités balayées n'a de débouché : le test ne prouverait rien").toBeTruthy();

  await expect(page.locator("#journeyCard .jstep")).toHaveCount(0); // aucun voyage n'a été créé
  const dest = page.locator("#holdCard .ec-dest");
  const profits = (await dest.locator(".ec-profit").allTextContents())
    .map((t) => Number(t.replace(/\s/g, "").replace(/[^\d+-]/g, "")));
  for (const v of profits) expect(Number.isFinite(v)).toBe(true);
  for (let i = 1; i < profits.length; i++) expect(profits[i - 1]).toBeGreaterThanOrEqual(profits[i]);
});

test("Soute : déclarer un lot ne corrige AUCUN stock de station (#55)", async ({ page }) => {
  // `✓ chargé` vide le rayon parce qu'on vient d'y acheter. Un lot déclaré n'a été pris nulle part
  // que l'app connaisse : y déduire quoi que ce soit serait inventer un achat.
  await expect(page.locator("#viewCorrections")).toHaveText("✎ Corrections");
  await ouvrirDeclaration(page);
  const nom = (await commodites(page))[0];
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", "9999");
  await page.locator("#holdAddOk").click();

  await expect(page.locator("#viewCorrections")).toHaveText("✎ Corrections"); // compteur inchangé
  const ov = await page.evaluate(() => localStorage.getItem("best-hauling-overrides"));
  expect(JSON.parse(ov || "{}")).toEqual({});
});

test("Soute : un lot déclaré survit au rechargement et sort par les sorties existantes (#55)", async ({ page }) => {
  await ouvrirDeclaration(page);
  const nom = (await commodites(page))[0];
  await page.fill("#holdAddName", nom);
  await page.fill("#holdAddScu", "300");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.reload();
  await expect(page.locator("#holdCard")).toBeVisible({ timeout: 8000 }); // aucune péremption
  expect(holdScuDe(await lots(page))).toBe(300);

  // Le ✕ du lot d'abord : c'est la sortie fine, elle doit connaître le lot manuel.
  await page.locator("#holdCard .hold-del").first().click();
  await expect(page.locator("#holdCard")).toBeHidden();
  expect(await lots(page)).toEqual([]);
});

test("Soute : un lot déclaré ne rend AUCUNE jambe « à bord » (#55)", async ({ page }) => {
  // Un lot manuel n'a pas de jambe : le registre des chargements (#21, #22) ne doit pas le voir
  // passer, sans quoi le bouton d'une jambe prétendrait avoir chargé un fret qu'elle n'a pas pris —
  // et l'annuler rendrait à une station un stock qu'elle n'a jamais cédé.
  await jambeChargeable(page);
  const bouton = page.locator("#journeyCard .jleg-load").first();
  await expect(bouton).toHaveText(/chargé/i);
  const stockAvant = await page.locator("#viewCorrections").innerText();

  await page.click("#viewRoutes");
  await ouvrirDeclaration(page);
  await page.fill("#holdAddName", (await commodites(page))[0]);
  await page.fill("#holdAddScu", "120");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#holdCard")).toBeVisible();

  await page.click("#viewEnroute");
  await expect(bouton).toHaveText(/chargé/i);      // toujours pas « ⬢ à bord »
  await expect(bouton).not.toHaveText(/à bord/i);
  expect(await page.locator("#viewCorrections").innerText()).toBe(stockAvant); // aucun rayon touché
});

test("Soute : une commodité inconnue ne crée pas un lot que l'app ne saurait pas écouler (#55)", async ({ page }) => {
  await ouvrirDeclaration(page);
  await page.fill("#holdAddName", "Kryptonite");
  await page.fill("#holdAddScu", "100");
  await page.locator("#holdAddOk").click();
  await expect(page.locator("#toast")).toContainText(/inconnue/i);
  await expect(page.locator("#holdCard")).toBeHidden();
  expect(await lots(page)).toEqual([]);
});

test("Carte : absente sans voyage, dessinée dès qu'il y en a un", async ({ page }) => {
  await expect(page.locator("#journeyMap")).toBeHidden();
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyMap")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#journeyMap .jm-arret")).toHaveCount(2); // un arrêt par étape
  await expect(page.locator("#journeyMap .jm-vaisseau")).toBeVisible();
  // Purement décoratif : effacer le voyage retire le panneau.
  await page.locator("#journeyClear").click();
  await expect(page.locator("#journeyMap")).toBeHidden();
});

test("Carte : cliquer une escale déplace « je suis ici », comme le fil d'étapes", async ({ page }) => {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyMap .jm-arret")).toHaveCount(2);
  const depart = (await page.locator("#journeyCard .jstep").nth(0).innerText()).trim();
  await expect(page.locator("#journeyCard .jstep.here")).toHaveText(memeStation(depart)); // on part du 1er arrêt

  const avant = await page.locator("#journeyMap .jm-vaisseau").getAttribute("style");
  await page.locator("#journeyMap .jm-arret").nth(1).locator(".jm-cible").click();

  // Les DEUX chemins mènent à la même commande : le vaisseau bouge et le fil d'étapes suit.
  await expect(page.locator("#journeyMap .jm-vaisseau")).not.toHaveAttribute("style", avant);
  const arrivee = (await page.locator("#journeyCard .jstep").nth(1).innerText()).trim();
  await expect(page.locator("#journeyCard .jstep.here")).toHaveText(memeStation(arrivee));
});

test("Carte : un saut inter-système dessine deux disques et un corridor", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyMap")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#journeyMap .jm-saut")).toHaveCount(0); // intra-système : aucun saut

  await page.fill("#journeyAddStop", "Stanton Gateway (Pyro) — Pyro");
  await page.click("#journeyAddBtn");
  await page.fill("#journeyAddStop", "Pyro Gateway (Stanton) — Stanton");
  await page.click("#journeyAddBtn");

  await expect(page.locator("#journeyMap .jm-saut")).toHaveCount(1);
  await expect(page.locator("#journeyMap .jm-sys")).toHaveCount(2); // Pyro et Stanton côte à côte
  // `allInnerTexts` rend `undefined` sur du <text> SVG : ces nœuds n'ont pas d'innerText.
  const noms = await page.locator("#journeyMap .jm-sysnom").allTextContents();
  expect(noms).toEqual(["PYRO", "STANTON"]); // dans l'ordre du parcours
});

test("Carte : un saut est routé par les passerelles, et chaque jambe porte son sens", async ({ page }) => {
  // On ne change pas de système n'importe où : le trajet emprunte la passerelle d'ici puis celle
  // de là-bas. Ici le parcours ne les mentionne PAS — c'est la carte qui les intercale.
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyMap")).toBeVisible({ timeout: 8000 });
  await page.fill("#journeyAddStop", "TDD Area 18 — Stanton");
  await page.click("#journeyAddBtn");
  await expect(page.locator("#journeyMap .jm-saut")).toHaveCount(1);

  // 3 étapes -> 2 jambes, dont une inter-système routée en 3 segments : 4 au total.
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  expect(await page.locator("#journeyMap .jm-jambe, #journeyMap .jm-saut").count()).toBe(4);

  // Chaque segment intra-système porte un chevron de sens ; le corridor a son nœud ⚡.
  await expect(page.locator("#journeyMap .jm-sens")).toHaveCount(3);
  await expect(page.locator("#journeyMap .jm-saut-glyphe")).toHaveCount(1);

  // Les tracés sont des ARCS (quadratiques) et non des segments droits : c'est ce qui sépare
  // l'aller du retour quand un parcours revient sur ses pas.
  const d = await page.locator("#journeyMap .jm-jambe").first().getAttribute("d");
  expect(d).toContain("Q");
});

// ---------- Carte Manifeste (« En route ») -> jambe de voyage ----------
// Ouvre « En route » sur un terminal de départ donné et attend que la carte Manifeste soit peinte.
async function manifesteDepuis(page, label) {
  await page.click("#viewEnroute");
  await page.fill("#origin", label);
  await expect(page.locator("#manifest .manifest-head")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible();
}
// Les noms d'étape sont mis en capitales par le CSS : on compare donc sans tenir compte de la casse.
const memeStation = (nom) => new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
// Parcours encodé dans le lien partageable (paramètre `j` du hash), ou null.
const lienVoyage = (page) => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("j"));

test("Manifeste -> voyage : sans voyage, le bouton en démarre un", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await expect(page.locator("#manifestToJourney")).toHaveText(/Démarrer un voyage/);
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(1);
  await expect(page.locator("#journeyCard .jstep").nth(0)).toHaveText(memeStation("Megumi"));
  // La carte confirme sur place : le bouton cède la place à la phrase, à l'endroit du clic.
  await expect(page.locator("#manifest .journey-hint")).toHaveText(/déjà la jambe 1/);
  await expect(page.locator("#manifestToJourney")).toHaveCount(0);
});

test("Manifeste -> voyage : la jambe COURANTE n'offre pas de bouton (non-destruction)", async ({ page }) => {
  // LE test qui compte : après un ▶, En route est pré-rempli avec la jambe courante. Sans garde,
  // un clic passait par la branche REMPLACER d'addToJourney et réduisait le voyage à cette jambe.
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  await page.click("#viewEnroute");
  await expect(page.locator("#manifest")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#manifestToJourney")).toHaveCount(0);
  await expect(page.locator("#manifest .journey-hint")).toHaveText(/déjà la jambe 1/);
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2); // le voyage n'a pas bougé
});

test("Manifeste -> voyage : un départ étranger au parcours nomme les deux bouts, sans agir", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  const fin = (await page.locator("#journeyCard .jstep").nth(1).innerText()).trim();
  // Le terminal « étranger » est CHOISI DANS LES DONNÉES, jamais codé en dur : « Rod's Fuel » l'a
  // été pendant un temps, jusqu'à ce qu'une régénération de l'amorce en fasse la jambe 1 du meilleur
  // trajet — le test lisait alors « ✓ C'est déjà la jambe 1 de ton voyage » et échouait.
  const arrets = (await page.locator("#journeyCard .jstep").allInnerTexts()).map((s) => s.trim().split(" — ")[0]);
  const etranger = await page.locator("#originList option").evaluateAll(
    (els, pris) => els.map((e) => e.value).find((v) => !pris.some((p) => v.includes(p))),
    arrets,
  );
  expect(etranger, "l'instantané doit offrir un terminal de départ hors du parcours").toBeTruthy();
  await page.fill("#origin", etranger);
  await expect(page.locator("#manifest .journey-hint")).toContainText(etranger.split(" — ")[0]);
  await expect(page.locator("#manifest .journey-hint")).toContainText(memeStation(fin));
  await expect(page.locator("#manifestToJourney")).toHaveCount(0);
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2); // aucune modification du voyage
});

test("Manifeste -> voyage : un chargement AJUSTÉ part tel quel (et hors du lien)", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  const qty = page.locator("#manifest .mqty-input").first();
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");
  await qty.fill("13");
  await qty.blur();
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1); // ✎ = manifeste personnalisé
  await expect(page.locator("#journeyCard .jleg-cargo").first()).toContainText(`${nom} 13 SCU`);
  const edits = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2")));
  expect(edits[Object.keys(edits)[0]]).toContainEqual({ name: nom, units: 13 });
  // Le lien ne transporte que le PARCOURS : la jambe y tient en 8 champs, sans aucun SCU.
  const legs = JSON.parse(await lienVoyage(page)).l;
  expect(legs[0]).toHaveLength(8);
  expect(legs.flat()).not.toContain(13);
});

test("Manifeste -> voyage : un chargement INTACT ne persiste rien (la jambe suit le marché)", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(1);
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(0); // pas de ✎ à tort
  const edits = await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2"));
  expect(Object.keys(JSON.parse(edits || "{}"))).toHaveLength(0);
});

// Corrige une valeur éditable de la carte Manifeste et rend l'ancienne valeur.
async function corrige(page, champ, cote, valeur) {
  const cell = page.locator(`#manifest .editv[data-f='${champ}'][data-s='${cote}']`).first();
  const avant = await cell.getAttribute("data-v");
  await cell.click();
  await page.locator("#manifest .editv-input").first().fill(String(valeur));
  await page.keyboard.press("Enter");
  return avant;
}
const profitJambe = (page) => page.locator("#journeyCard .jleg-profit").first();

// ---------- Le chargement qu'on COMPOSE à la main sur la carte Manifeste (#19) ----------
// Ajoute au manifeste une commodité qui n'y est pas encore, et rend son nom.
async function ajouteAuManifeste(page) {
  const dejaLa = await page.locator("#manifest .mname").allInnerTexts();
  const opts = await page.locator("#commodityList option").evaluateAll((els) => els.map((e) => e.value));
  const nom = opts.find((o) => !dejaLa.some((h) => h.includes(o)));
  await page.fill("#manifestAddInput", nom);
  await page.click("#manifestAddBtn");
  return nom;
}

test("Manifeste : une composition à la main survit à un prix corrigé (#19)", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  test.skip(!(await page.locator("#manifestAddInput").count()), "aucun chargement rentable depuis ce terminal");
  const ajoutee = await ajouteAuManifeste(page);
  const lignes = await page.locator("#manifest .mline").count();
  const qty = page.locator("#manifest .mqty-input").first();
  await qty.fill("30");
  await qty.blur();

  // Le geste du bug : corriger un prix d'achat depuis la carte, qui rend ses chiffres en `editv` et
  // invite donc explicitement au geste. renderManifest remettait `currentManifest` à null et
  // recalculait tout : la ligne ajoutée disparaissait et les SCU repartaient à leur valeur optimale.
  await corrige(page, "price", "buy", 4321);

  await expect(page.locator("#manifest .mline")).toHaveCount(lignes);
  // `.mline .mname` et non `.mname` : les suggestions de remplissage portent le même nom de classe.
  await expect(page.locator("#manifest .mline .mname").last()).toContainText(ajoutee);
  await expect(page.locator("#manifest .mqty-input").first()).toHaveValue("30");
  // …et la carte affiche bien le prix qu'on vient de corriger : l'intention survit, pas le marché.
  await expect(page.locator("#manifest .editv[data-f='price'][data-s='buy']").first())
    .toHaveAttribute("data-v", "4321");
});

test("Manifeste : la composition se recharge, et « ↺ optimal » rend la main au calcul (#19)", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  const qty = page.locator("#manifest .mqty-input").first();
  const optimal = await qty.inputValue();
  test.skip(optimal === "30", "le chargement optimal charge déjà les SCU que le test va saisir");
  await qty.fill("30");
  await qty.blur();
  await expect(page.locator("#manifest .manifest-edited")).toHaveCount(1); // ✎ : composé à la main

  // Persistée comme le manifeste d'une jambe de voyage : le rechargement ne l'efface pas.
  await page.reload();
  await expect(page.locator("#manifest .mqty-input").first()).toHaveValue("30", { timeout: 8000 });

  await page.click("#manifestReset");
  await expect(page.locator("#manifest .mqty-input").first()).toHaveValue(optimal);
  await expect(page.locator("#manifest .manifest-edited")).toHaveCount(0);
});

test("Manifeste : changer de quai de départ abandonne la composition (#19)", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  const qty = page.locator("#manifest .mqty-input").first();
  const optimal = await qty.inputValue();
  test.skip(optimal === "30", "le chargement optimal charge déjà les SCU que le test va saisir");
  await qty.fill("30");
  await qty.blur();

  // Un autre quai : la composition ne le suit pas — ses lignes se lisent aux prix de Megumi.
  const autre = await page.locator("#originList option").evaluateAll(
    (els) => els.map((e) => e.value).find((v) => !v.startsWith("Megumi")),
  );
  await page.fill("#origin", autre);
  await expect(page.locator("#manifest .manifest-edited")).toHaveCount(0);
  // Et de retour à Megumi : le calcul, pas la composition d'avant, qui ressortirait sans qu'on
  // l'ait demandée.
  await page.fill("#origin", "Megumi — Pyro");
  await expect(page.locator("#manifest .mqty-input").first()).toHaveValue(optimal);
});

test("Corrections : un prix corrigé se retrouve dans le board Commodités", async ({ page }) => {
  // Le board lisait market.json BRUT, sans résolveur : on corrigeait un prix dans un tableau et la
  // tuile gardait la marge d'UEX — donc un classement et une heatmap sur un chiffre démenti.
  const ligne = page.locator("#rows tr").first();
  const commodite = (await ligne.locator(".cname").innerText()).trim();
  const cell = ligne.locator(".editv[data-f='price'][data-s='sell']").first();
  const terminal = await cell.getAttribute("data-t");
  const avant = Number(await cell.getAttribute("data-v"));
  await cell.click();
  await page.locator(".editv-input").first().fill(String(avant * 3));
  await page.keyboard.press("Enter");

  await page.click("#viewCommodities");
  await page.fill("#search", commodite);
  const tuile = page.locator("#commGrid .comm-tile").first();
  await expect(tuile).toBeVisible({ timeout: 8000 });
  await tuile.click();

  // La ligne du terminal corrigé porte la nouvelle valeur ET le marqueur ✎.
  const rang = page.locator("#commDetail .comm-points tbody tr", { hasText: terminal }).first();
  await expect(rang).toContainText(String(avant * 3).replace(/\B(?=(\d{3})+(?!\d))/g, " "));
  await expect(rang.locator(".ovmark")).toHaveCount(1);
});

test("Corrections : un PRIX corrigé met à jour les bénéfices du voyage en cours", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(1);
  const avant = (await profitJambe(page).innerText()).trim();
  const cargo = (await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim();

  const prix = await corrige(page, "price", "sell", Math.round(Number(await page.locator("#manifest .editv[data-f='price'][data-s='sell']").first().getAttribute("data-v")) * 1.5));
  expect(Number(prix)).toBeGreaterThan(0);
  // Avant : la carte Voyage restait hors du cycle de rendu et gardait le profit d'avant.
  await expect(profitJambe(page)).not.toHaveText(avant);
  expect((await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim()).toBe(cargo); // un prix ne rebat pas les SCU
  await expect(page.locator("#journeyCard .jleg-pinned")).toHaveCount(0); // et ne fige rien
});

test("Corrections : un STOCK corrigé fige la jambe engagée, mais pas les trajets suivants", async ({ page }) => {
  await manifesteDepuis(page, "Megumi — Pyro");
  await page.click("#manifestToJourney");
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(1);
  const cargo = (await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim();
  const nom = await page.locator("#manifest .mline-del").first().getAttribute("data-name");

  await corrige(page, "vol", "buy", 3); // « j'ai vidé la station en chargeant »
  // Le trajet est décidé : ses SCU ne rétrécissent pas sous les pieds du joueur.
  await expect(page.locator("#journeyCard .jleg-pinned")).toHaveCount(1);
  expect((await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim()).toBe(cargo);
  expect(await page.evaluate(() => localStorage.getItem("best-hauling-journey-pins"))).toContain("true");

  // ...mais un chargement calculé APRÈS coup, lui, ne voit plus que ce qui reste.
  await page.fill("#origin", "Megumi — Pyro");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible();
  const ligne = page.locator("#manifest .mline", { hasText: nom }).first();
  if (await ligne.count()) await expect(ligne.locator(".mqty-input")).toHaveValue(/^[0-3]$/);

  // « ↺ optimal » lève le gel : la jambe redevient branchée sur le marché.
  await page.locator("#journeyCard .jleg-head").first().click();
  await page.locator("#journeyCard .jman-reset").click();
  await expect(page.locator("#journeyCard .jleg-pinned")).toHaveCount(0);
  expect((await page.locator("#journeyCard .jleg-cargo").first().innerText()).trim()).not.toBe(cargo);
});

test("Compagnon de voyage : retirer l'arrivée d'un parcours à DEUX arrêts garde le départ", async ({ page }) => {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  const depart = (await page.locator("#journeyCard .jstep").nth(0).innerText()).trim();
  await page.locator("#journeyCard .jstep-del").nth(1).click(); // ✕ sur l'arrivée
  // Avant le correctif : les DEUX arrêts disparaissaient, le voyage revenait à « Nouveau voyage ».
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(1);
  expect((await page.locator("#journeyCard .jstep").nth(0).innerText()).trim()).toBe(depart);
  // Le survivant est un vrai point de départ : il propose des arrêts et en accepte un.
  await expect(page.locator("#journeyCard .jstop-suggest").first()).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  expect((await page.locator("#journeyCard .jstep").nth(0).innerText()).trim()).toBe(depart);
});

test("Compagnon de voyage : une suggestion filtrée par la vue n'est jamais proposée", async ({ page }) => {
  // Bug : « Commodités légales uniquement » coché, la boîte proposait quand même une destination
  // atteignable seulement via une commodité illégale (Megumi → Devlin Scrap via WiDoW). L'arrêt
  // s'ajoutait, et sa jambe s'affichait « aucun fret rentable » — une route qui n'existait nulle part.
  await page.check("#legalOnly");
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstop-suggest").first()).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jstop-suggest").first().click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3);
  // La jambe ajoutée porte un vrai chargement, et aucune jambe n'est vide.
  await expect(page.locator("#journeyCard .jleg").last().locator(".jcargo-item").first()).toBeVisible();
  await expect(page.locator("#journeyCard .jleg-cargo", { hasText: "aucun fret rentable" })).toHaveCount(0);
  // Et rien d'illégal n'a pu s'inviter dans le voyage.
  await expect(page.locator("#journeyCard .jcargo-item .illegal")).toHaveCount(0);
});

// Démarre un voyage depuis la première ligne DONT LA JAMBE A UN MANIFESTE ÉDITABLE.
//
// Ces amorces cliquaient la première ligne du tableau. Elles dépendaient donc de l'ORDRE du
// classement, qui a changé avec l'ADR-005 (tri sur le profit net) : la nouvelle tête de liste mène
// à une jambe sans manifeste à éditer, et `.jman` n'apparaît jamais. Le défaut n'était pas visible
// chez moi et l'était en CI — la démonstration qu'un test adossé à « la première ligne » teste le
// classement en croyant tester autre chose.
//
// On balaie donc les premières lignes jusqu'à en trouver une qui convient, et on échoue franchement
// si aucune ne convient : ça, ce serait une vraie régression de l'éditeur de jambe.
async function ouvrirUneJambeEditable(page, essais = 10, convient = null) {
  for (let i = 0; i < essais; i++) {
    const lignes = page.locator("#rows tr");
    if (i >= (await lignes.count())) break;
    await lignes.nth(i).locator(".journey-pick").click();
    const charge = page.locator("#journeyCard .jcargo-item").first();
    if (await charge.isVisible({ timeout: 4000 }).catch(() => false)) {
      await page.locator("#journeyCard .jleg-head").first().click();
      if (await page.locator("#journeyCard .jman").isVisible({ timeout: 2000 }).catch(() => false)) {
        if (!convient || (await convient())) return;
      }
    }
    await page.locator("#journeyClear").click().catch(() => {});
    // Un voyage effacé laisse une entrée vide dans le store d'intentions : on la retire, sinon les
    // tests qui vérifient « aucune intention enregistrée » liraient les traces du balayage.
    await page.evaluate(() => localStorage.removeItem("best-hauling-journey-edits-v2"));
  }
  throw new Error("aucune des premières lignes ne mène à une jambe qui convienne");
}

test("Compagnon de voyage : éditer le manifeste d'une jambe (SCU) persiste hors lien", async ({ page }) => {
  await ouvrirUneJambeEditable(page);
  await page.locator("#journeyCard .jman-qty").first().fill("7");
  await page.locator("#journeyCard .jman-qty").first().blur();
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1);  // ✎ = manifeste personnalisé
  // Les édits sont en localStorage, pas dans l'URL (lien léger).
  expect(await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2"))).toBeTruthy();
  expect(page.url()).not.toContain("Aluminum");
  await page.reload();
  await expect(page.locator("#journeyCard .jcargo-item").first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1);  // édits restaurés
});

// Déplie l'éditeur de la 1re jambe et vide les SCU de chaque ligne (1 SCU) pour libérer la soute,
// quel que soit le manifeste optimal du jour -> il reste forcément de la place à suggérer.
// Ouvre une jambe ET libère de la place — assez pour qu'une saisie de plusieurs dizaines de SCU
// laisse encore des SCU libres. Sans ce seuil, la boîte de suggestions disparaît en cours de test
// sur une jambe étroite, et l'assertion échoue sur un élément absent plutôt que sur son contenu.
async function openLegEditorWithFreeSpace(page, libresMin = 60) {
  const libres = async () => {
    const t = await page.locator("#journeyCard .jman-suggest .suggest-head").innerText().catch(() => "");
    const m = t.match(/(\d+)\s*SCU libres/i);
    return m ? Number(m[1]) : 0;
  };
  await ouvrirUneJambeEditable(page, 10, async () => {
    const qty = page.locator("#journeyCard .jman-qty");
    for (let i = 0; i < (await qty.count()); i++) await qty.nth(i).fill("1");
    await qty.first().blur();
    return (await libres()) >= libresMin;
  });
}

test("Compagnon de voyage : libérer des SCU dans une jambe propose de quoi remplir", async ({ page }) => {
  await openLegEditorWithFreeSpace(page);
  // Même sans commodité rentable, l'en-tête annonce les SCU libres (le message diffère).
  const box = page.locator("#journeyCard .jman-suggest");
  await expect(box.locator(".suggest-head")).toContainText(/SCU libres/);

  const add = box.locator(".suggest-add").first();
  test.skip(!(await box.locator(".suggest-add").count()), "aucune commodité rentable à suggérer sur cette jambe");

  // Le bouton annonce combien de SCU il ajoute -> la ligne créée porte ce tonnage.
  const units = (await add.innerText()).replace(/\D/g, "");
  const before = await page.locator("#journeyCard .jman-line").count();
  const name = await add.getAttribute("data-name");
  await add.click();
  await expect(page.locator("#journeyCard .jman-line")).toHaveCount(before + 1);
  const added = page.locator("#journeyCard .jman-line").last();
  await expect(added.locator(".jman-name")).toContainText(name);
  await expect(added.locator(".jman-qty")).toHaveValue(units);
  // La cargaison de la jambe (repliée) reflète l'ajout, et l'édit est persisté hors URL.
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2"))).toContain(name);
});

// Encode la décision de conception : le rafraîchissement est incrémental (handler `input`), pas un
// renderJourney() — sinon l'input perdrait le focus à chaque caractère saisi.
test("Compagnon de voyage : les suggestions d'une jambe suivent la frappe sans voler le focus", async ({ page }) => {
  await openLegEditorWithFreeSpace(page);
  const box = page.locator("#journeyCard .jman-suggest");
  const qty = page.locator("#journeyCard .jman-qty").first();
  await expect(box.locator(".suggest-head")).toContainText(/SCU libres/);
  const avant = await box.locator(".suggest-head").innerText();

  // Saisie au clavier, sans blur : les SCU libres doivent suivre AVANT validation.
  await qty.focus();
  await qty.press("Control+a");
  await qty.pressSequentially("42");
  await expect(box.locator(".suggest-head")).not.toHaveText(avant);
  expect(await page.evaluate(() => document.activeElement?.classList.contains("jman-qty"))).toBe(true);
});

test("En route : les suggestions de remplissage restent rendues (non-régression du partage avec le voyage)", async ({ page }) => {
  // Passe par ▶ : ça pré-remplit départ/arrivée avec une route réelle -> manifeste garanti,
  // là où le 1er terminal du datalist n'a pas forcément de chargement rentable.
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await page.click("#viewEnroute");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible({ timeout: 8000 });

  await page.locator("#manifest .mqty-input").first().fill("1");
  const box = page.locator("#manifestSuggest");
  await expect(box.locator(".suggest-head")).toContainText(/SCU libres/);
  test.skip(!(await box.locator(".suggest-add").count()), "aucune commodité rentable à suggérer");
  const before = await page.locator("#manifest .mline").count();
  await box.locator(".suggest-add").first().click();
  await expect(page.locator("#manifest .mline")).toHaveCount(before + 1);
});

test("Compagnon de voyage : on peut ajouter n'importe quel arrêt (même sans fret rentable)", async ({ page }) => {
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
  // Attend le chargement du marché (suggestions ou message vide).
  await expect(page.locator("#journeyCard .jstop-suggest, #journeyCard .journey-suggest-empty").first()).toBeVisible({ timeout: 8000 });
  // Ajoute un terminal NON suggéré, par NOM SEUL (sans « — Système »).
  const sug = new Set(await page.locator("#journeyCard .jstop-suggest").evaluateAll((els) => els.map((e) => e.dataset.label)));
  const opts = await page.locator("#stationList option").evaluateAll((els) => els.map((e) => e.value));
  const notSuggested = opts.find((o) => !sug.has(o));
  await page.fill("#journeyAddStop", notSuggested.split(" — ")[0]);
  await page.click("#journeyAddBtn");
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(3); // ajouté quoi qu'il arrive
});

test("Compagnon de voyage : démarrer un voyage « de zéro » (sans passer par un trajet)", async ({ page }) => {
  // L'invite « Nouveau voyage » est visible dès le départ, sans avoir cliqué ▶.
  await expect(page.locator("#journeyStartBtn")).toBeVisible();
  await expect(page.locator("#journeyCard .journey-title")).toHaveText(/Nouveau voyage/);
  // Focus le champ -> précharge le marché -> le datalist se peuple.
  await page.locator("#journeyStart").focus();
  await expect
    .poll(async () => page.locator("#stationList option").count(), { timeout: 8000 })
    .toBeGreaterThan(0);
  const first = await page.locator("#stationList option").first().getAttribute("value");
  // Démarre depuis ce terminal (par nom seul).
  await page.fill("#journeyStart", first.split(" — ")[0]);
  await page.click("#journeyStartBtn");
  // Voyage « de zéro » : une seule station, pas encore de jambe, champ d'ajout présent.
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(1);
  await expect(page.locator("#journeyCard .jleg")).toHaveCount(0);
  await expect(page.locator("#journeyAddStop")).toBeVisible();
  // Ajoute un arrêt -> le parcours s'étend à 2 stations.
  const opts = await page.locator("#stationList option").evaluateAll((els) => els.map((e) => e.value));
  await page.fill("#journeyAddStop", opts.find((o) => o !== first));
  await page.click("#journeyAddBtn");
  await expect(page.locator("#journeyCard .jstep")).toHaveCount(2);
});

test("mode Butin : le board expose les commodités qu'on ne peut pas acheter", async ({ page }) => {
  await page.click("#viewCommodities");
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible();
  // Marché : que de l'échangeable, donc aucune tuile « introuvable à l'achat ».
  expect(await page.locator("#commGrid .comm-tile.sell-only").count()).toBe(0);
  const nMarket = await page.locator("#commGrid .comm-tile").count();

  await page.click('#commBoardModes button[data-board="loot"]');
  expect(await page.locator("#commGrid .comm-tile").count()).toBeGreaterThan(nMarket);
  expect(await page.locator("#commGrid .comm-tile.sell-only").count()).toBeGreaterThan(0);
  await expect(page.locator('#commSortModes button[data-sort="margin"]')).toHaveText("Revente");

  await page.click('#commBoardModes button[data-board="market"]');
  expect(await page.locator("#commGrid .comm-tile.sell-only").count()).toBe(0);
});

test("mode Butin : le détail ne montre que la revente", async ({ page }) => {
  await page.click("#viewCommodities");
  await page.click('#commBoardModes button[data-board="loot"]');
  await page.locator("#commGrid .comm-tile.sell-only").first().click();
  await expect(page.locator("#commDetail .loot-value")).toBeVisible();   // prix au SCU en tête
  await expect(page.locator("#commDetail .comm-col")).toHaveCount(1);    // une seule colonne
  await expect(page.locator("#commDetail")).toContainText("Où l'écouler");
  await expect(page.locator("#commDetail")).not.toContainText("Où acheter");

  // Retour en Marché : la sélection « butin » n'existe plus, le rendu retombe sur la 1re tuile.
  await page.click('#commBoardModes button[data-board="market"]');
  await expect(page.locator("#commDetail .comm-col")).toHaveCount(2);
  await expect(page.locator("#commDetail .loot-value")).toHaveCount(0);
});

test("le mode Butin survit au rechargement (permalien)", async ({ page }) => {
  await page.click("#viewCommodities");
  await page.click('#commBoardModes button[data-board="loot"]');
  await expect(page.locator('#commBoardModes button[data-board="loot"]')).toHaveClass(/active/);

  await page.reload();
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible();
  await expect(page.locator('#commBoardModes button[data-board="loot"]')).toHaveClass(/active/);
  await expect(page.locator('#commSortModes button[data-sort="margin"]')).toHaveText("Revente");
  expect(await page.locator("#commGrid .comm-tile.sell-only").count()).toBeGreaterThan(0);
});

// ---------- Régressions du mode Butin (PR #37) ----------

test("Butin : deux tuiles ne portent jamais la même étiquette (code UEX non unique)", async ({ page }) => {
  // UEX attribue le même code à des commodités distinctes (COPP = Copper ET Copper (Ore)).
  // Invariant indépendant des données : une étiquette de tuile identifie sa commodité.
  await page.click("#viewCommodities");
  // `allInnerTexts()` n'attend RIEN : sans ces deux attentes il lit la grille avant l'arrivée de
  // market.json et le test devient fragile sous charge (il passait seul, échouait en parallèle).
  await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible({ timeout: 10000 });
  await page.click('#commBoardModes button[data-board="loot"]');
  await expect(page.locator("#commGrid .comm-tile.sell-only").first()).toBeVisible({ timeout: 10000 });
  const labels = await page.locator("#commGrid .comm-tile .tile-code").allInnerTexts();
  expect(labels.length).toBeGreaterThan(50);
  expect(new Set(labels).size).toBe(labels.length);
});

test("Butin : une commodité au code ambigu reste atteignable par son nom", async ({ page }) => {
  await page.click("#viewCommodities");
  await page.click('#commBoardModes button[data-board="loot"]');
  // Prend une commodité de butin et vérifie que cliquer sa tuile ouvre BIEN la sienne.
  const tile = page.locator("#commGrid .comm-tile.sell-only").first();
  const name = await tile.getAttribute("data-name");
  await tile.click();
  await expect(page.locator("#commDetail .comm-detail-title")).toContainText(name);
});

test("Butin : ajouter un fret trouvé n'invente ni la quantité ni un achat sur place", async ({ page }) => {
  // Récupère une commodité réellement introuvable à l'achat (tuile pointillée du board Butin).
  await page.click("#viewCommodities");
  await page.click('#commBoardModes button[data-board="loot"]');
  const loot = await page.locator("#commGrid .comm-tile.sell-only").first().getAttribute("data-name");
  expect(loot).toBeTruthy();

  // Manifeste réel via ▶ (garantit des lignes), puis ajout libre de ce fret.
  await page.click("#viewRoutes");
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await page.click("#viewEnroute");
  await expect(page.locator("#manifest .mqty-input").first()).toBeVisible({ timeout: 8000 });
  await page.fill("#manifestAddInput", loot);
  await page.click("#manifestAddBtn");

  const line = page.locator("#manifest .mline.acquired");
  await expect(line).toHaveCount(1);
  // 1 SCU par défaut : on ne remplit pas la soute d'un fret qu'on ne peut pas acheter ici.
  await expect(line.locator(".mqty-input")).toHaveValue("1");
  // Le côté achat est balisé, plus chiffré à 0 comme un vrai relevé UEX. (La ligne peut être
  // AUSSI « carry » si ce butin n'est pas vendable à l'arrivée : les deux tags coexistent.)
  const prix = (await line.locator(".mprice").innerText()).trim();
  expect(prix).toContain("acquis ailleurs");
  expect(prix.startsWith("0")).toBe(false);
  // Le stock d'un fret introuvable sur place n'est pas un chiffre corrigeable.
  await expect(line.locator(".mstock")).toContainText("stock —");
});

test("Butin : filtrer la recherche ne recolore pas la heatmap du board (#56)", async ({ page }) => {
  // La couleur d'une tuile situe la commodité dans TOUT le board (t-hot = les 15 % les mieux
  // payées). Calculée après le filtre de recherche, taper « iron » suffisait à repeindre Iron
  // (3 900 aUEC/SCU, le bas du classement) en t-hot : rang 0 sur 1 seule ligne restante.
  await page.click("#viewCommodities");
  const tuiles = page.locator("#commGrid .comm-tile");
  await expect(tuiles.first()).toBeVisible({ timeout: 10000 });
  await page.click('#commBoardModes button[data-board="loot"]');
  await expect(page.locator("#commGrid .comm-tile.sell-only").first()).toBeVisible({ timeout: 10000 });

  const avant = await tuiles.evaluateAll((els) => els.map((e) => ({ nom: e.dataset.name, cls: e.className })));
  // La dernière tuile en t-low : la moins bien payée du board, donc celle que le calcul sur les
  // lignes filtrées faisait basculer le plus haut. Aucune valeur en dur — les données bougent.
  const cible = [...avant].reverse().find((t) => /\bt-low\b/.test(t.cls));
  expect(cible, "aucune tuile t-low : la heatmap par rang ne colorerait plus rien").toBeTruthy();

  await page.fill("#search", cible.nom);
  await expect.poll(() => tuiles.count()).toBeLessThan(avant.length); // la recherche a bien filtré
  const tuile = page.locator(`#commGrid .comm-tile[data-name="${cible.nom}"]`);
  await expect(tuile).toHaveClass(/\bt-low\b/);
  await expect(tuile).not.toHaveClass(/\bt-hot\b/);
});

// ---------- Chargement du marché : l'échec réseau ne doit pas être collant (#38) ----------

// Le service worker est BLOQUÉ ici : on teste la logique de chargement d'app.js, pas le cache.
// (page.route n'intercepte de toute façon pas les requêtes émises par un service worker.)
test.describe("chargement du marché", () => {
  test.use({ serviceWorkers: "block" });


  test("marché indisponible : l'échec n'est pas mémorisé et l'action suivante réessaie", async ({ page }) => {
    let hits = 0;
    await page.route("**/data/market.json", (route) => {
      hits++;
      return hits === 1 ? route.abort("failed") : route.continue(); // 1re tentative KO, puis réseau OK
    });

    await page.click("#viewEnroute"); // 1er besoin du marché -> échoue
    await expect(page.locator("#toast")).toContainText("Marché indisponible");
    expect(hits).toBe(1);

    // Le repli vide n'est pas mémorisé : revenir sur la vue relance un chargement, qui aboutit.
    await page.click("#viewRoutes");
    await page.click("#viewEnroute");
    await expect(page.locator("#originList option").first()).toBeAttached({ timeout: 8000 });
    expect(hits).toBeGreaterThan(1);
  });

  test("marché : une salve de frappes pendant le chargement ne déclenche qu'un seul fetch", async ({ page }) => {
    let hits = 0;
    await page.route("**/data/market.json", async (route) => {
      hits++;
      await new Promise((r) => setTimeout(r, 800)); // chargement lent : laisse le temps de taper
      return route.continue();
    });

    await page.click("#viewCommodities");
    for (const c of ["l", "a", "r", "a"]) await page.type("#search", c, { delay: 20 });
    await expect(page.locator("#commGrid .comm-tile").first()).toBeVisible({ timeout: 15000 });
    expect(hits).toBe(1); // la promesse en vol est mémorisée, pas re-déclenchée à chaque frappe
  });

  test("marché lent : le rendu tardif d'« En route » n'écrase pas la vue Trajets (#55)", async ({ page }) => {
    // #empty et #manifest sont PARTAGÉS par Trajets / Boucles / En route. Chaque vue se rappelait
    // elle-même à l'arrivée du marché : quitter « En route » pendant le fetch faisait donc
    // repeindre, par-dessus un tableau de trajets plein, le « Choisis un terminal de départ… »
    // d'une vue qu'on avait quittée. Le correctif rappelle refresh(), qui rend la vue ACTIVE.
    await page.route("**/data/market.json", async (route) => {
      await new Promise((r) => setTimeout(r, 1200)); // le marché arrive après le changement de vue
      return route.continue();
    });

    await page.click("#viewEnroute"); // 1er besoin du marché -> withMarket en vol
    await page.click("#viewRoutes");  // ...et on repart avant qu'il n'arrive
    await expect(page.locator("#rows tr").first()).toBeVisible();

    // Le marché finit par arriver (les datalists se peuplent) : c'est le moment du rendu tardif.
    await expect(page.locator("#originList option").first()).toBeAttached({ timeout: 15000 });
    await expect(page.locator("#empty")).toBeHidden(); // et non « Choisis un terminal de départ… »
    await expect(page.locator("#manifest")).toBeHidden();
    await expect(page.locator("#routes")).toBeVisible();
  });

  test("marché lent : « En route » n'affiche pas le message vide d'une autre vue (#26)", async ({ page }) => {
    // Symétrie exacte de #55, laissée dans un seul sens : render() et renderLoops() remettent
    // #empty à sa valeur d'index.html en tête de rendu, mais renderEnRoute sortait AVANT toute
    // écriture quand le marché manquait. Le message de la vue qu'on quitte restait donc sous un
    // tableau « En route » vide — et si le fetch échoue, withMarket ne re-rend pas : il y reste.
    // 2,5 s : le test observe un état TRANSITOIRE, il faut que la fenêtre survive à un runner chargé.
    await page.route("**/data/market.json", async (route) => {
      await new Promise((r) => setTimeout(r, 2500)); // le marché arrive bien après le changement de vue
      return route.continue();
    });

    // On ATTEND que le filtre ait vidé le tableau : le rendu est débouncé, et changer de vue avant
    // qu'il ne parte laisserait #empty masqué — le test passerait alors sans rien prouver.
    await page.fill("#search", "zzz"); // aucune route -> #empty affiche le message des Trajets
    await expect(page.locator("#rows tr")).toHaveCount(0);
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#empty")).toHaveText("Aucune route ne correspond aux filtres.");

    await page.click("#viewEnroute");
    await expect(page.locator("#enroute")).toBeVisible();
    await expect(page.locator("#empty")).toBeHidden(); // sans marché, cette vue n'a rien de vrai à dire
    // À l'arrivée du marché seulement, elle dit ce qui lui manque VRAIMENT.
    await expect(page.locator("#empty")).toHaveText(
      "Choisis un terminal de départ pour voir le fret à emporter.", { timeout: 15000 });
  });

  test("marché lent : le mode multi n'affiche pas les lignes des trajets simples (#25)", async ({ page }) => {
    // renderMulti sortait le temps du fetch sans toucher à #rows : l'écran gardait les trajets à UNE
    // commodité sous un mode qui promet des chargements combinés, et ▶ comme 📦 indexaient alors
    // `shownMulti`, resté vide — clic mort, sans le moindre message.
    // 2,5 s : idem, l'état observé est transitoire (il dure le temps du fetch et pas plus).
    await page.route("**/data/market.json", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      return route.continue();
    });

    await expect(page.locator("#rows tr").first()).toBeVisible(); // trajets à une commodité
    await page.check("#multiCommodity");
    await expect(page.locator("#rows tr")).toHaveCount(0);  // le tableau suit son tableau de données
    await expect(page.locator("#empty")).toBeHidden();      // et ne prétend pas que c'est un filtre
    // Le mode finit par se remplir de VRAIS chargements combinés (plusieurs icônes par ligne).
    await expect(page.locator("#rows .multi-icons").first()).toBeVisible({ timeout: 15000 });
  });
});

// ---------- Service worker : le cache doit réellement se remplir (#66) ----------

test("service worker : les données atterrissent vraiment dans le cache", async ({ page }) => {
  // Régression : `putInCache` appelait `res.clone()` DANS le `.then()` de `caches.open()`, donc
  // après que la page ait consommé le corps -> « Response body is already used ». Le cache ne
  // contenait que les 8 fichiers précachés à l'installation : le repli hors-ligne, qui est toute
  // la raison d'être du mode « réseau d'abord, cache en repli », n'avait jamais rien à servir.
  // On ATTEND l'activation avant de recharger. Recharger « à l'aveugle » était une course : si le
  // worker s'active pendant la navigation, le nouveau document est créé NON contrôlé (il n'était
  // pas encore un client quand `clients.claim()` est passé) et le reste pour toute sa vie — ses
  // requêtes ne traversent jamais le gestionnaire `fetch`, donc aucun data/*.json n'est mis en
  // cache. Observé 1 fois sur 12 en parallèle : `controller: null`, cache réduit à la coquille.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
  await page.reload(); // le worker est actif : la navigation naît contrôlée
  await expect(page.locator("#rows tr").first()).toBeVisible();
  // Sans contrôleur, l'attente ci-dessous ne prouverait rien : elle échouerait pour la mauvaise
  // raison (SW hors circuit) au lieu de la bonne (putInCache cassé).
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const dataEnCache = async () => page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return [];
    const c = await caches.open(keys[0]);
    return (await c.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.includes("/data/"));
  });
  await expect.poll(dataEnCache, { timeout: 15000 }).toContain("/data/routes.json");
});

// ---------- Corrections locales & réactivité des filtres (#39, #49) ----------

test("consulter un chiffre ne crée aucune correction locale", async ({ page }) => {
  await expect(page.locator("#viewCorrections")).toHaveText("✎ Corrections"); // aucune au départ
  const cell = page.locator("#rows .editv").first();
  const avant = await cell.innerText();

  await cell.click();
  await expect(cell.locator("input")).toBeVisible();
  await page.locator("h1").click(); // blur SANS rien modifier

  await expect(page.locator("#viewCorrections")).toHaveText("✎ Corrections"); // toujours aucune
  await expect(page.locator("#rows .editv.ov")).toHaveCount(0);
  await expect(cell).toHaveText(avant); // l'affichage d'origine est restauré, ✎ compris

  // Effet de bord réglé : le clic suivant n'est plus avalé par un re-render global.
  const autre = page.locator("#rows .editv").nth(3);
  await autre.click();
  await expect(autre.locator("input")).toBeVisible();
});

test("modifier un chiffre crée bien une correction (contre-épreuve)", async ({ page }) => {
  const cell = page.locator("#rows .editv").first();
  await cell.click();
  await cell.locator("input").fill("12345");
  await page.keyboard.press("Enter");
  await expect(page.locator("#viewCorrections")).toContainText("Corrections (1)");
  await expect(page.locator("#rows .editv.ov").first()).toBeVisible();
});

test("les filtres à saisie libre sont débouncés : un mot tapé ne re-rend qu'une fois", async ({ page }) => {
  await page.evaluate(() => {
    window.__rendus = 0;
    new MutationObserver(() => { window.__rendus++; }).observe(document.getElementById("rows"), { childList: true });
  });
  await page.type("#search", "Laranite", { delay: 20 }); // 8 frappes

  // saveState() tourne à la FIN de refresh() : le hash ne bouge qu'une fois le debounce tiré.
  await expect(page).toHaveURL(/search=Laranite/);
  // Sans debounce : 8 reconstructions complètes de la table (528 Ko de HTML chacune).
  expect(await page.evaluate(() => window.__rendus)).toBeLessThanOrEqual(2);
});

// ---------- Manifestes de jambe : intention persistée, pas instantané (#40, #42, #48) ----------

// Ouvre l'éditeur d'une jambe SANS y toucher (le helper ci-dessus, lui, ajuste les SCU et bascule
// donc la jambe en « éditée » — ce qu'on veut justement éviter ici).
async function openLegEditorPristine(page) {
  await ouvrirUneJambeEditable(page);
}

test("jambe : un ajout refusé pour doublon ne bascule pas la jambe en « éditée »", async ({ page }) => {
  await openLegEditorPristine(page);
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(0); // manifeste encore optimal
  const deja = (await page.locator("#journeyCard .jman-line .jman-name").first().innerText()).trim().split("\n")[0];

  await page.fill("#journeyCard .jman-add-input", deja);
  await page.click("#journeyCard .jman-add-btn");

  // Rien n'a été ajouté ET la jambe n'est pas devenue « personnalisée » : sans le correctif,
  // materializeLeg s'exécutait AVANT la garde et gelait le manifeste sur les prix du jour.
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(0);
  // Sur le CONTENU, pas sur la chaîne : un voyage effacé écrit "{}", qui est « truthy » tout en
  // n'enregistrant aucune intention. C'est l'absence d'intention qu'on veut ici.
  const edits = await page.evaluate(() => JSON.parse(localStorage.getItem("best-hauling-journey-edits-v2") || "{}"));
  expect(Object.keys(edits)).toEqual([]);
});

test("jambe : seule l'intention est persistée, jamais un instantané de marché", async ({ page }) => {
  await openLegEditorWithFreeSpace(page);
  await page.locator("#journeyCard .jman-qty").first().fill("3");
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1);

  const stock = JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2")));
  const lignes = Object.values(stock)[0];
  expect(lignes.length).toBeGreaterThan(0);
  // Ni buyPrice, ni sellPrice, ni margin, ni buyUpdated : ces champs se figeaient pour toujours
  // et la carte Voyage continuait d'annoncer un profit calculé sur des prix périmés.
  for (const l of lignes) expect(Object.keys(l).sort()).toEqual(["name", "units"]);
  // La clé porte le RANG de la jambe : deux jambes identiques ne partagent plus un manifeste.
  expect(Object.keys(stock)[0]).toMatch(/^\d+\|/);
});

test("effacer le voyage purge les manifestes édités", async ({ page }) => {
  await openLegEditorWithFreeSpace(page);
  await page.locator("#journeyCard .jman-qty").first().fill("3");
  await expect(page.locator("#journeyCard .jleg-edited")).toHaveCount(1);

  await page.locator("#journeyClear").click();
  // Sans la purge, ces éditions ressortaient sur un parcours ULTÉRIEUR passant par les mêmes
  // terminaux, badge ✎ compris, alors que l'utilisateur n'avait rien édité dans ce voyage-là.
  expect(await page.evaluate(() => localStorage.getItem("best-hauling-journey-edits-v2"))).toBe("{}");
});

// ---------- Permalien : l'état encodé doit être fidèle, y compris les champs VIDÉS (#63) ----------

test("permalien : un champ vidé le reste au rechargement (défaut HTML non vide)", async ({ page }) => {
  // #budget vaut 1 000 000 dans le HTML. Vidé case cochée, l'état est légitime (readFilters donne
  // budget: 0 -> aucun plafond) mais encodeState omet les valeurs vides : au rechargement, l'input
  // revenait à 1 000 000, le plafond se réactivait et le classement changeait — chez l'émetteur du
  // lien comme chez son destinataire.
  await page.fill("#budget", "12345");
  await expect(page).toHaveURL(/budget=12345/); // le hash suit bien la saisie
  await page.fill("#budget", "");
  await expect(page).not.toHaveURL(/budget=/);  // ...et l'omet une fois le champ vide

  await page.reload();
  await expect(page.locator("#rows tr").first()).toBeVisible();
  await expect(page.locator("#budget")).toHaveValue("");
  await expect(page.locator("#useBudget")).toBeChecked(); // la case, elle, n'a pas bougé
});

// Ouvre un lien en CHARGEMENT COMPLET : la page est déjà sur /index.html (beforeEach), et un goto
// qui ne change que le fragment serait une navigation same-document — init() ne serait pas rejoué et
// le test passerait à vide. Le détour par about:blank force le rechargement, comme le ferait un
// destinataire ouvrant le lien partagé.
async function ouvrirPermalien(page, hash) {
  await page.goto("about:blank");
  await page.goto("/index.html" + hash);
  await expect(page.locator("#rows tr").first()).toBeVisible();
}

test("permalien : une clé absente d'un état SIGNÉ vide le champ, sauf ceux sans option vide", async ({ page }) => {
  // `v` (la vue) est écrite à chaque sauvegarde et n'est jamais vide : c'est elle qui signe un état
  // venu de l'app et autorise à lire une clé absente comme « champ vidé ».
  await ouvrirPermalien(page, "#v=routes");
  await expect(page.locator("#cargo")).toHaveValue("");
  await expect(page.locator("#budget")).toHaveValue("");
  // #hops n'a AUCUNE option vide (2 / 3 / 4) : lui poser "" laisserait le menu visuellement vide
  // alors que le calcul retomberait silencieusement sur 3 sauts.
  await expect(page.locator("#hops")).toHaveValue("3");
});

test("permalien : une ancre quelconque n'est pas un état — les défauts du HTML tiennent", async ({ page }) => {
  // Sans signature `v`, vider tous les champs accueillerait l'arrivant sans soute ni budget.
  await ouvrirPermalien(page, "#top");
  await expect(page.locator("#cargo")).toHaveValue("96");
  await expect(page.locator("#budget")).toHaveValue("1000000");
});

// ---------- Accessibilité : tri au clavier, activation des jambes, aria, noms accessibles (#9, #57, #58, #59) ----------

test("tri : Entrée puis Espace sur un en-tête trient la table, et aria-sort suit (#58)", async ({ page }) => {
  // Le tri par défaut est le PROFIT NET depuis l'ADR-005 — plus le score composite, qui classait
  // la route la plus rentable de l'instantané au 8e rang.
  const score = page.locator('#routes th[data-sort="profit"]');
  const commodite = page.locator('#routes th[data-sort="commodity"]');
  await expect(score).toHaveAttribute("aria-sort", "descending"); // tri par défaut, annoncé
  await expect(commodite).toHaveAttribute("aria-sort", "none");

  // Entrée sur « Commodité » : nouvelle clé -> ordre alphabétique croissant (bySort, dir 1).
  await commodite.press("Enter");
  await expect(commodite).toHaveAttribute("aria-sort", "ascending");
  await expect(score).toHaveAttribute("aria-sort", "none"); // une seule colonne triée à la fois
  const noms = await page.locator("#rows .cname").allInnerTexts();
  expect(noms.length).toBeGreaterThan(1);
  expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, "fr")));

  // Espace sur la même colonne : inversion du sens (et la page ne défile pas, preventDefault).
  await commodite.press(" ");
  await expect(commodite).toHaveAttribute("aria-sort", "descending");
  const inverses = await page.locator("#rows .cname").allInnerTexts();
  expect(inverses).toEqual([...noms].reverse());
});

test("tri : les en-têtes de Boucles sont eux aussi actionnables au clavier (#58)", async ({ page }) => {
  await page.click("#viewLoops");
  // Le tri par défaut est le profit depuis l'ADR-005 ; on vérifie qu'il se DÉPLACE sur une autre
  // colonne, donc il en faut bien deux distinctes.
  const profit = page.locator('#loops th[data-sort-loop="profit"]');
  const fiabilite = page.locator('#loops th[data-sort-loop="fiabilite"]');
  await expect(profit).toHaveAttribute("aria-sort", "descending");
  await fiabilite.press("Enter");
  await expect(fiabilite).toHaveAttribute("aria-sort", "descending");
  await expect(profit).toHaveAttribute("aria-sort", "none");
  await expect(fiabilite).toHaveClass(/sorted-desc/); // l'indicateur ▾ visuel suit la même colonne
});

test("jambe : Entrée puis Espace sur l'en-tête déplient et replient l'éditeur, aria-expanded suit (#9)", async ({ page }) => {
  // L'en-tête est annoncé `role="button"` et prend le focus (tabindex=0) : ne rien faire sous Entrée
  // promet une action qui n'existe pas. L'éditeur de manifeste était donc à la souris seulement.
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jcargo-item").first()).toBeVisible({ timeout: 8000 });
  const head = () => page.locator("#journeyCard .jleg-head").first();

  await head().press("Enter");
  await expect(page.locator("#journeyCard .jman")).toBeVisible();          // avant le correctif : rien
  await expect(head()).toHaveAttribute("aria-expanded", "true");           // le caret ▾ est visuel seul
  // Le re-rendu détruit l'en-tête activé : sans restitution du focus, la deuxième Entrée part de
  // <body> et la tabulation repart du haut du document.
  expect(await page.evaluate(() => document.activeElement?.classList.contains("jleg-head"))).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.dataset.leg)).toBe("0");

  await head().press(" ");                                                // et la page ne défile pas
  await expect(page.locator("#journeyCard .jman")).toHaveCount(0);
  await expect(head()).toHaveAttribute("aria-expanded", "false");
});

test("jambe : Entrée sur « ✓ chargé » charge la soute SANS déplier l'éditeur (#9)", async ({ page }) => {
  // Le bouton vit DANS l'en-tête : un handler clavier posé sur closest(".jleg-head") ferait les deux
  // gestes d'un coup — charger la soute ET basculer l'éditeur.
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").press("Enter");
  await expect(page.locator("#journeyCard .jleg-load")).toHaveText(/à bord/i);
  await expect(page.locator("#journeyCard .jman")).toHaveCount(0);
  await expect(page.locator("#journeyCard .jleg-head").first()).toHaveAttribute("aria-expanded", "false");
});

test("raccourcis : focus sur un élément activable, « 1 »…« 6 » ne changent plus de vue (#9)", async ({ page }) => {
  // La garde des raccourcis ne testait que INPUT/SELECT/TEXTAREA/.editv — un div `role="button"`
  // n'est rien de tout ça. Tabuler jusqu'à l'en-tête d'une jambe puis taper « 2 » faisait basculer
  // sur Boucles : l'utilisateur clavier perdait son contexte au moment d'agir dessus.
  await page.locator("#rows tr").first().locator(".journey-pick").click();
  await expect(page.locator("#journeyCard .jcargo-item").first()).toBeVisible({ timeout: 8000 });
  await page.locator("#journeyCard .jleg-head").first().press("2");
  await expect(page.locator("#viewRoutes")).toHaveClass(/active/); // on est resté sur Trajets
  await expect(page.locator("#loops")).toBeHidden();
});

test("noms accessibles : soute et budget ont chacun le leur (#57)", async ({ page }) => {
  // Les deux champs n'étaient rattachés à AUCUN label : un lecteur d'écran annonçait « champ
  // numérique », sans dire lequel. Le `for` du label, lui, revient à la case à cocher.
  await expect(page.locator("#cargo")).toHaveAccessibleName(/SCU/i);
  await expect(page.locator("#budget")).toHaveAccessibleName(/aUEC/i);
  await expect(page.getByRole("checkbox", { name: /Soute/i })).toHaveAttribute("id", "useCargo");
  await expect(page.getByRole("checkbox", { name: /Budget/i })).toHaveAttribute("id", "useBudget");
});

test("rail rétracté : les boutons gardent un nom accessible descriptif (#59)", async ({ page }) => {
  const toggle = page.locator("#railToggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Rétracter le menu");

  await toggle.click();
  await expect(page.locator("#app")).toHaveClass(/rail-collapsed/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("Déplier le menu");
  // Replié, le libellé .rl passe en display:none : sans aria-label le nom accessible tombait au
  // simple numéro de la vue (« 01 », « 02 »…), illisible pour qui n'a pas l'icône sous les yeux.
  await expect(page.locator("#viewRoutes")).toHaveAccessibleName("Trajets simples");
  await expect(page.locator("#viewLoops")).toHaveAccessibleName("Boucles aller-retour");
  await expect(page.locator("#viewCommodities")).toHaveAccessibleName(/Commodités/);
  await expect(page.locator("#share")).toHaveAccessibleName(/lien/i);
  // L'aria-label PRIME sur le contenu : il doit donc reprendre le libellé visible, sinon
  // « clic Partager » au pilotage vocal ne trouve plus le bouton (SC 2.5.3 « Label in Name »).
  await expect(page.locator("#share")).toHaveAccessibleName(/Partager/);
  // Le nom survit à un changement de vue (rien dans app.js ne réécrit ces attributs).
  await page.click("#viewLoops");
  await expect(page.locator("#viewRoutes")).toHaveAccessibleName("Trajets simples");
});

test("rail : le retour de copie et le compteur de corrections restent DANS le nom accessible (#59)", async ({ page, context }) => {
  // Contrepartie de l'aria-label : ce que app.js écrit dans ces deux boutons doit continuer
  // d'atteindre un lecteur d'écran, sinon le nom accessible fige un texte périmé.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click("#share");
  await expect(page.locator("#share")).toHaveAccessibleName("✓ Lien copié");

  const span = page.locator('#rows tr:first-child .editv[data-s="buy"][data-f="price"]');
  await span.click();
  await span.locator("input").fill("4321");
  await span.locator("input").press("Enter");
  await expect(page.locator("#viewCorrections")).toHaveAccessibleName(/Corrections \(1\)/);
});

test("saisie : pas un history.replaceState par frappe, et « Partager » ne copie jamais un lien périmé (#54)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click("#viewCorrections");
  await expect(page.locator("#stationList option").first()).toBeAttached({ timeout: 15000 });
  // WebKit plafonne replaceState à 100 appels / 10 s puis lève SecurityError. La suite tourne sur
  // Chromium (qui se contente d'un avertissement) : on compte donc les appels, et on simule le
  // plafond en faisant lever la méthode.
  await page.evaluate(() => {
    window.__rs = 0;
    const vrai = history.replaceState.bind(history);
    history.replaceState = function (...a) {
      window.__rs++;
      if (window.__rsPlafonne) throw new DOMException("throttled", "SecurityError");
      return vrai(...a);
    };
  });
  const saisie = "Levski — Nyx (une station qu'on tape en entier)";
  await page.locator("#station").pressSequentially(saisie, { delay: 1 });
  await expect(page.locator("#station")).toHaveValue(saisie);
  await page.waitForTimeout(400); // le temps que le debounce retombe
  expect(await page.evaluate(() => window.__rs)).toBeLessThan(10); // avant : 1 par frappe, soit 47

  // Plafond atteint : l'écriture du hash est perdue (l'exception est avalée), la barre d'adresse
  // reste donc en arrière — mais le lien copié, lui, est reconstruit depuis l'état, sinon le bouton
  // annonçait « ✓ Lien copié » pour un partage faux.
  const gare = "Port Olisar — Crusader";
  await page.evaluate(() => { window.__rsPlafonne = true; });
  await page.fill("#station", gare);
  await page.waitForTimeout(400);
  await page.click("#share");
  await expect(page.locator("#share")).toHaveText("✓ Lien copié");
  const copie = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URLSearchParams(copie.split("#")[1] || "").get("station")).toBe(gare);
  // Témoin : sans le plafond simulé, le test passerait pour de mauvaises raisons.
  const barre = await page.evaluate(() => location.hash.replace(/^#/, ""));
  expect(new URLSearchParams(barre).get("station")).not.toBe(gare);
});

// ---------- Sélecteur de station groupé (ADR-003, LOT 2) ----------
// Ouvre le sélecteur de la vue Corrections et rend la main quand il est peuplé.
async function ouvrePicker(page, q = "") {
  await page.click("#viewCorrections");
  await expect(page.locator("#stationList option").first()).toBeAttached({ timeout: 15000 }); // marché arrivé
  if (q) await page.locator("#station").pressSequentially(q, { delay: 1 });
  else await page.locator("#station").focus();
  await expect(page.locator("#stationPickList")).toBeVisible();
}

test("sélecteur : le nom complet d'une station longue est lisible sans troncature (#36)", async ({ page }) => {
  // « Terra Gateway (Stanton) — Stanton » fait 33 caractères, le plus long des 114 terminaux.
  // Un <datalist> natif cale sa liste sur la largeur du champ et le coupe : c'est le défaut corrigé.
  await ouvrePicker(page, "terra gateway");
  const opt = page.locator("#stationPickList li[data-i]").first();
  await expect(opt).toContainText("Terra Gateway (Stanton)");

  // Aucun débordement interne : le texte tient dans sa ligne, il n'est pas rogné.
  const rogne = await opt.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(rogne, "l'option ne doit pas déborder de sa propre ligne").toBe(false);

  // Et la liste s'affranchit de la largeur du champ — c'est ce qui rend la place nécessaire.
  const [wListe, wChamp] = await Promise.all([
    page.locator("#stationPickList").evaluate((e) => e.getBoundingClientRect().width),
    page.locator("#station").evaluate((e) => e.getBoundingClientRect().width),
  ]);
  expect(wListe).toBeGreaterThan(wChamp);
});

test("sélecteur : chercher par code UEX remonte les deux passerelles homonymes (#36)", async ({ page }) => {
  // PYROG désigne À LA FOIS Pyro Gateway (Stanton) et Pyro Gateway (Nyx) : le code n'est pas unique,
  // et c'est leur badge système qui les distingue à l'œil.
  await ouvrePicker(page, "pyrog");
  const opts = page.locator("#stationPickList li[data-i]");
  await expect(opts).toHaveCount(2);
  await expect(opts.nth(0)).toContainText("Pyro Gateway");
  await expect(opts.nth(1)).toContainText("Pyro Gateway");
  // Ce qui les distingue à l'œil, c'est leur EN-TÊTE : chacune tombe dans le groupe de son système,
  // et le filtrage n'en conserve que deux. Sans cela l'utilisateur verrait deux lignes identiques.
  const groupes = await page.locator("#stationPickList li.opt-grp .sys").allTextContents();
  expect(new Set(groupes.map((s) => s.trim()))).toEqual(new Set(["Stanton", "Nyx"]));
});

test("sélecteur : les flèches ne s'arrêtent jamais sur un en-tête de groupe (#36)", async ({ page }) => {
  // Les en-têtes brisent la bijection enfants ↔ résultats : sans filtrage sur li[data-i], la 3e
  // flèche bas poserait .active sur un en-tête et Entrée choisirait la mauvaise station.
  await ouvrePicker(page);
  await expect(page.locator("#stationPickList li.opt-grp").first()).toBeVisible();
  for (let i = 0; i < 3; i++) await page.locator("#station").press("ArrowDown");
  await expect(page.locator("#stationPickList li.opt-grp.active")).toHaveCount(0);
  await expect(page.locator("#stationPickList li[data-i].active")).toHaveCount(1);
});

test("sélecteur : Entrée écrit le libellé canonique, et la station s'affiche (#36)", async ({ page }) => {
  await ouvrePicker(page, "levski");
  await page.locator("#station").press("Enter");
  // Libellé canonique « Nom — Système » : c'est ce qu'attend resolveStation, et ce qu'encode le lien.
  await expect(page.locator("#station")).toHaveValue("Levski — Nyx");
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible();
});

test("sélecteur : la datalist historique survit pour les autres champs (#36)", async ({ page }) => {
  // #destTerminal, #journeyStart et #journeyAddStop s'en servent encore, et huit assertions la lisent.
  await ouvrePicker(page);
  await expect(page.locator("#stationList option")).toHaveCount(114);
  await expect(page.locator("#station")).not.toHaveAttribute("list", /.+/);
});

test("sélecteur : quand la photo existe, la vignette de repli ne dépasse pas derrière (#36)", async ({ page }) => {
  // Photo et vignette générée occupent la MÊME case : la seconde n'est qu'un repli. Superposées à
  // coups de marge négative, elles se décalaient de la valeur du `gap` flex et le code débordait —
  // on lisait « TA » derrière la photo de Nyx Gateway (Stanton), dont le code est NYXSTA.
  await ouvrePicker(page, "gate");
  // La mesure est prise DANS le document, jamais via une poignée capturée à l'avance : chaque
  // frappe réécrit la liste, et un élément détaché entre l'assertion de visibilité et la mesure
  // rendait un rectangle [0,0,0,0]. On sonde donc jusqu'à obtenir une case réellement peinte.
  const lis = () => page.evaluate(() => {
    const li = [...document.querySelectorAll("#stationPickList li[data-i]")]
      .find((e) => e.querySelector("img.stn-shot") && !e.classList.contains("no-shot"));
    if (!li) return null;
    const r = (s) => { const b = li.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
    return { img: r("img.stn-shot"), gen: r(".stn-shot-gen") };
  });
  await expect.poll(async () => ((await lis())?.img?.[2] ?? 0) > 0, { timeout: 8000 }).toBe(true);
  const boites = await lis();
  // Exactement superposées : aucun pixel du repli n'est visible à côté de la photo.
  expect(boites.gen).toEqual(boites.img);
});

// ---------- Vue Corrections rangée par station (ADR-003, LOT 3) ----------
// Choisit une station dans le sélecteur groupé et attend son panneau.
async function ouvreStation(page, nom) {
  await page.click("#viewCorrections");
  await expect(page.locator("#stationList option").first()).toBeAttached({ timeout: 15000 });
  await page.locator("#station").fill(""); // sinon la 2e station s'AJOUTE à la première et rien ne résout
  await page.locator("#station").pressSequentially(nom, { delay: 1 });
  await page.locator("#station").press("Enter");
  await expect(page.locator(".stn-hero-name")).toHaveText(nom);
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible();
}
// Corrige le premier chiffre éditable de la station affichée.
async function corrigePremier(page, valeur) {
  const cible = page.locator("#correctionsStation .editv").first();
  const nom = await cible.getAttribute("data-c");
  await cible.click();
  const champ = page.locator("#correctionsStation input.editv-input").first();
  await champ.fill(String(valeur));
  await champ.press("Enter");
  return nom;
}

test("corrections : la bande de stations remplace la liste plate (#38)", async ({ page }) => {
  await ouvreStation(page, "Levski");
  await corrigePremier(page, 4242);
  // Une vignette par station, et non une ligne par correction.
  await expect(page.locator("#correctionsIndex .stn-tile")).toHaveCount(1);
  await expect(page.locator("#correctionsIndex .stn-tile").first()).toContainText("Levski");
  // La liste plate n'existe plus.
  await expect(page.locator("#correctionsList")).toHaveCount(0);
  await expect(page.locator(".corr-item:not(.autoload)")).toHaveCount(0);
});

test("corrections : la bande est AU-DESSUS du panneau de station (#38)", async ({ page }) => {
  // C'est le déplacement qui règle les coups de molette : la liste vivait sous 1 481 px de grille.
  await ouvreStation(page, "Levski");
  await corrigePremier(page, 4242);
  const [yBande, yPanneau] = await Promise.all([
    page.locator("#correctionsIndex").evaluate((e) => e.getBoundingClientRect().top),
    page.locator("#correctionsStation").evaluate((e) => e.getBoundingClientRect().top),
  ]);
  expect(yBande).toBeLessThan(yPanneau);
});

test("corrections : la station affichée est épinglée en tête et en surbrillance (#38)", async ({ page }) => {
  await ouvreStation(page, "Levski");
  await corrigePremier(page, 4242);
  await ouvreStation(page, "GrimHEX"); // station SANS correction : elle doit quand même s'épingler
  const tuiles = page.locator("#correctionsIndex .stn-tile");
  await expect(tuiles).toHaveCount(2);
  await expect(tuiles.first()).toContainText("GrimHEX");
  await expect(tuiles.first()).toHaveClass(/\bactive\b/);
  await expect(tuiles.first()).toHaveAttribute("aria-current", "true");
  // La surbrillance ne tient pas qu'à la couleur : le mot est écrit.
  await expect(tuiles.first()).toContainText("en cours");
});

test("corrections : cliquer une vignette recharge sa station (#38)", async ({ page }) => {
  await ouvreStation(page, "Levski");
  await corrigePremier(page, 4242);
  await ouvreStation(page, "GrimHEX");
  await page.locator("#correctionsIndex .stn-tile", { hasText: "Levski" }).click();
  await expect(page.locator("#station")).toHaveValue("Levski — Nyx");
  await expect(page.locator("#correctionsIndex .stn-tile").first()).toContainText("Levski");
});

test("corrections : le retour arrière rend la valeur UEX, sur un contrôle dédié (#38)", async ({ page }) => {
  await ouvreStation(page, "Levski");
  const cible = page.locator("#correctionsStation .editv").first();
  const avant = (await cible.innerText()).trim();
  await corrigePremier(page, 4242);
  await expect(page.locator("#correctionsStation .editv.ov").first()).toBeVisible();

  // Le contrôle vit DANS la tuile, hors du .editv — qui porte déjà role="button" : un bouton dans
  // un bouton est invalide en ARIA, et sortir le ✎ casserait la restauration de startEdit.
  const retour = page.locator("#correctionsStation .scomm .scomm-undo").first();
  await expect(retour).toBeVisible();
  await expect(retour).toContainText(avant.replace(/\s+/g, " ")); // annonce la valeur de retour
  const dansEditv = await retour.evaluate((el) => !!el.closest(".editv"));
  expect(dansEditv, "le contrôle ne doit pas être imbriqué dans le .editv").toBe(false);

  await retour.click();
  await expect(page.locator("#correctionsStation .editv.ov")).toHaveCount(0);
  await expect(page.locator("#correctionsIndex .stn-tile").first()).toContainText("0");
});

test("corrections : « Tout réinitialiser » survit au déménagement (#38)", async ({ page }) => {
  await ouvreStation(page, "Levski");
  await corrigePremier(page, 4242);
  await expect(page.locator("#resetAll")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.locator("#resetAll").click();
  await expect(page.locator("#correctionsStation .editv.ov")).toHaveCount(0);
});

test("corrections : le panneau de frais quitte le conteneur re-rendu (#24, #38)", async ({ page }) => {
  // #24 : toute frappe dans le relevé d'autoload était effacée par un re-rendu de la vue, parce que
  // renderCorrections réécrit #correctionsStation.innerHTML — qui contenait le panneau.
  await ouvreStation(page, "Levski");
  const panneau = page.locator("#correctionsFees .fee-panel");
  await expect(panneau).toBeVisible();
  const dedans = await panneau.evaluate((el) => !!el.closest("#correctionsStation"));
  expect(dedans, "le panneau de frais ne doit plus vivre dans #correctionsStation").toBe(false);
});

test("corrections : le retour arrière ne comprime pas la ligne des valeurs (#38)", async ({ page }) => {
  // Glissés parmi les valeurs, les boutons de retour écrasaient le texte de l'étiquette : « aUEC ·
  // stock » se coupait en deux lignes, la tuile ne faisant que 236 px. Ils vivent sur leur propre
  // ligne, et la hauteur de la ligne des valeurs ne bouge donc pas quand on corrige.
  await ouvreStation(page, "Levski");
  const ligne = page.locator("#correctionsStation .scomm").first().locator(".scomm-side").first();
  const avant = await ligne.evaluate((e) => e.getBoundingClientRect().height);
  await corrigePremier(page, 4242);
  await expect(page.locator("#correctionsStation .scomm-undo").first()).toBeVisible();

  const mesures = await page.locator("#correctionsStation .scomm").first().evaluate((tuile) => {
    const v = tuile.querySelector(".scomm-side").getBoundingClientRect();
    const u = tuile.querySelector(".scomm-undo").getBoundingClientRect();
    return { hauteur: v.height, basValeurs: v.bottom, hautRetour: u.top };
  });
  // Le bouton est SOUS la ligne des valeurs, pas dedans : c'est la correction du défaut.
  expect(mesures.hautRetour).toBeGreaterThanOrEqual(mesures.basValeurs);
  // Et la ligne des valeurs n'a pas replié : elle gagne ~2 px, ceux du ✎ en vertical-align: super,
  // là où un repli la faisait DOUBLER (17 -> 35 px mesurés avant correction du défaut).
  expect(mesures.hauteur).toBeLessThan(avant * 1.4);
});

test("corrections : choisir une station ne rend pas l'écran deux fois (#24, #38)", async ({ page }) => {
  // Le sélecteur rend immédiatement au choix ; le debounce du champ rendait une SECONDE fois ~300 ms
  // plus tard. Un chiffre ouvert à l'édition entre les deux voyait son champ détaché du DOM.
  await ouvreStation(page, "Levski");
  await page.locator("#correctionsStation .editv").first().click();
  const champ = page.locator("#correctionsStation input.editv-input").first();
  await expect(champ).toBeVisible();
  await page.waitForTimeout(600); // largement plus que le debounce
  await expect(champ).toBeVisible(); // toujours là : aucun re-rendu gratuit ne l'a emporté
  await champ.fill("4242");
  await champ.press("Enter");
  await expect(page.locator("#correctionsStation .editv.ov").first()).toBeVisible();
});

test("corrections : un relevé d'autoload en cours de saisie survit à un re-rendu (#24)", async ({ page }) => {
  // Cause de #24 : renderCorrections réécrivait inconditionnellement le conteneur qui porte le
  // panneau de frais. Le sortir de #correctionsStation ne suffit pas — encore faut-il ne pas
  // réécrire son nouveau conteneur quand rien de ce qu'il affiche n'a changé.
  await ouvreStation(page, "Seraphim"); // une des 45 stations qui proposent l’autoload
  const montant = page.locator("#alAmount");
  await expect(montant).toBeVisible();
  await montant.fill("1159");
  // Un re-rendu déclenché par autre chose que le panneau : le filtre par commodité.
  await page.locator("#search").fill("aluminum");
  await expect(page.locator("#correctionsStation .scomm")).toHaveCount(1);
  await page.waitForTimeout(500); // le debounce du filtre est retombé
  await expect(montant).toHaveValue("1159"); // la saisie n'a pas été effacée
});

test("score : une barre de score négatif est vide, jamais pleine (#39)", async ({ page }) => {
  // Cause racine de #39 : `.scorebar i` n'avait aucune `width` par défaut. Une largeur négative
  // (`width:-1441%`, ce que scoreCell écrivait pour une route qui perd de l'argent) est une
  // déclaration CSS INVALIDE, donc ignorée — l'élément retombait en `width:auto`, et un bloc en
  // auto remplit son parent. La pire ligne du tableau portait donc la plus grosse barre.
  // On mesure la règle CSS elle-même : aucune donnée de l'amorce ne garantit qu'une route soit
  // déficitaire aujourd'hui, et ce test ne doit pas dépendre du relevé du jour.
  const largeurs = await page.evaluate(() => {
    const hote = document.createElement("div");
    // Le gabarit exact de scoreCell, pour les trois largeurs qui ont pu s'écrire dans le style.
    hote.innerHTML = `
      <span class="scorebar s-low" id="t-neg"><i style="width:-1441%"></i></span>
      <span class="scorebar s-low" id="t-vide"><i></i></span>
      <span class="scorebar s-good" id="t-plein"><i style="width:100%"></i></span>`;
    document.body.append(hote);
    const large = (id) => document.querySelector(`#${id} i`).getBoundingClientRect().width;
    const mesures = { negatif: large("t-neg"), sansLargeur: large("t-vide"), plein: large("t-plein") };
    hote.remove();
    return mesures;
  });

  expect(largeurs.plein).toBeGreaterThan(40);   // une barre pleine occupe bien les 46 px du parent
  expect(largeurs.negatif).toBe(0);             // 46 px avant le correctif : le bug
  expect(largeurs.sansLargeur).toBe(0);         // la ceinture : plus aucun repli sur `auto`
});

test("score : le tableau n'écrit jamais une largeur hors [0, 100] (#39)", async ({ page }) => {
  // Le correctif porte sur le RENDU : scoreCell borne la largeur, le chiffre garde son signe.
  const styles = await page.locator("#rows .scorebar i").evaluateAll((els) =>
    els.map((e) => e.getAttribute("style") || ""));
  expect(styles.length).toBeGreaterThan(50);
  const horsBornes = styles.filter((s) => !/^width:\s*(100|\d{1,2})%;?$/.test(s.trim()));
  expect(horsBornes).toEqual([]);
});

// #54 : les tableaux débordaient de leur cadre, et la barre pour rattraper les 21 px était collée
// au bas de 316 lignes — 33 écrans à descendre, pousser, remonter. Le contrôle porte sur
// `.table-shell`, JAMAIS sur documentElement : au niveau page le débordement est nul, puisque c'est
// le conteneur qui défile tout seul. Un test au niveau page passerait à tort, et c'est exactement
// pour ça que rien ne voyait le défaut. La tolérance de 1 px couvre `.table-shell::after`, dont le
// crochet décoratif déborde en permanence (style.css:613) — même convention qu'à la ligne 219.
for (const { largeur, hauteur } of [{ largeur: 1920, hauteur: 1080 }, { largeur: 1280, hauteur: 720 }]) {
  test(`tableaux : aucune barre horizontale en ${largeur}×${hauteur} (#54)`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: hauteur });
    const debord = (sel) => page.locator(sel).evaluate((e) => {
      const cadre = e.closest(".table-shell");
      return cadre.scrollWidth - cadre.clientWidth;
    });

    await expect(page.locator("#rows tr").first()).toBeVisible();
    expect(await debord("#routes"), "Trajets").toBeLessThanOrEqual(1);

    await page.click("#viewLoops");
    await expect(page.locator("#loopRows tr").first()).toBeVisible();
    expect(await debord("#loops"), "Boucles").toBeLessThanOrEqual(1);

    // « En route » partage le rendu de Trajets ; il faut un terminal de départ pour qu'il peuple.
    await page.click("#viewEnroute");
    const depart = await page.locator("#originList option").first().getAttribute("value");
    await page.fill("#origin", depart);
    await expect(page.locator("#enrouteRows tr").first()).toBeVisible();
    expect(await debord("#enroute"), "En route").toBeLessThanOrEqual(1);
  });
}

// #75 : l'app n'affichait AUCUNE version. Un rapport de bug n'était rattachable à rien — on ne
// savait pas si l'utilisateur regardait le `main` d'il y a dix minutes ou une coquille servie
// depuis son cache d'il y a trois semaines. L'estampille vient de meta.json, écrite au build : on
// l'injecte ici, parce que l'amorce versionnée dans data/ ne la porte pas tant qu'aucun build n'est
// passé (même raison que l'enrichissement de market.json dans autoload.pw.mjs).
test.describe("version déployée", () => {
  // `serviceWorkers: "block"` est INDISPENSABLE, comme dans autoload.pw.mjs : le service worker sert
  // data/meta.json depuis son cache (réseau d'abord, cache en repli), et page.route ne voit alors
  // jamais passer la requête — l'interception ci-dessous serait silencieusement sans effet.
  test.use({ serviceWorkers: "block" });

  test("version : l'estampille du déploiement s'affiche dans le rail (#75)", async ({ page }) => {
    await page.route("**/data/meta.json", async (route) => {
      const res = await route.fetch();
      const meta = await res.json();
      await route.fulfill({ response: res, json: { ...meta, app_version: "9.9.9", commit: "abc1234" } });
    });
    await page.goto("/index.html");
    await expect(page.locator("#rows tr").first()).toBeVisible();

    const v = page.locator("#railVersion");
    await expect(v).toHaveText("v9.9.9 · abc1234");
    await expect(v).toHaveAttribute("title", /rapport de bug/);
  });

  test("version : sans estampille, le rail ne montre rien plutôt qu'un « v— » (#75)", async ({ page }) => {
    // L'amorce du dépôt n'a pas encore d'app_version : c'est le cas nominal en local, il ne doit pas
    // produire de trou dans le rail. `:empty { display: none }` s'en charge, encore faut-il que le
    // code ne remplisse pas l'élément avec un repli.
    await page.route("**/data/meta.json", async (route) => {
      const res = await route.fetch();
      const meta = await res.json();
      delete meta.app_version;
      delete meta.commit;
      await route.fulfill({ response: res, json: meta });
    });
    await page.goto("/index.html");
    await expect(page.locator("#rows tr").first()).toBeVisible();
    await expect(page.locator("#railVersion")).toHaveText("");
    await expect(page.locator("#railVersion")).toBeHidden(); // :empty le retire du flux
  });
});

// ---------- Exports datés : entrepôts (#46) et corrections (#47) ----------
// Les deux tests vivent côte à côte parce que les deux exports partagent leur format de date, et
// que c'est précisément ce qu'on les empêche de laisser diverger.
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

test("Entrepôts : « ⧉ Copier » sort la liste du fret déposé, station et date comprises (#46)", async ({ page, context }) => {
  // Le dépôt ne quittait jamais l'app : pour relire ce qu'on avait laissé quelque part, il fallait
  // rouvrir le navigateur qui porte le localStorage.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await jambeChargeable(page);
  await page.locator("#journeyCard .jleg-load").first().click();
  const nom = (await lots(page))[0].name;

  await page.locator("#holdCard .hold-line", { hasText: nom }).locator(".hold-sell-btn").click();
  await page.locator("#holdCard .hold-sell-qty").fill("5");
  await page.locator("#holdCard .hold-store").click();
  await expect(page.locator("#depotsCard")).toBeVisible();

  // Le bouton n'existe que quand la carte est là — elle est `hidden` tant que rien n'y dort.
  const bouton = page.locator("#depotsCard #copyDepots");
  await expect(bouton).toBeVisible();
  await bouton.click();
  await expect(bouton).toHaveText("✓ Copié");

  const copie = await page.evaluate(() => navigator.clipboard.readText());
  expect(copie).toMatch(/^# Best Hauling — entrepôts · format v1 · émis \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  // La station où le fret dort, telle que la carte la nomme, et non un index de terminal.
  const station = Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem("best-hauling-depots"))))[0];
  expect(copie).toContain(`## ${station}`);
  expect(copie).toContain(`5 SCU · ${nom} @`);
  // La date du dépôt : posée à l'instant, donc connue, et écrite en ISO 8601 UTC.
  const depose = copie.match(/déposé (\S+)/);
  expect(depose, "aucune date de dépôt dans l'export").not.toBeNull();
  expect(depose[1]).toMatch(ISO_Z);
  expect(copie).toMatch(/Total : 5 SCU déposés · [\d ]+ aUEC immobilisés/);
});

test("Corrections : « ⧉ Exporter » emporte prix ET stock, chacun avec sa date de saisie (#47)", async ({ page, context }) => {
  // Vider son cache effaçait des dizaines de relevés faits comptoir par comptoir, et un prix corrigé
  // ne portait AUCUNE date de saisie : `setInStore` ne posait `pris` que pour les volumes.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click("#viewCorrections");
  await page.fill("#station", "Megumi — Pyro");
  await expect(page.locator("#correctionsStation .scomm").first()).toBeVisible({ timeout: 8000 });

  // Une case ne convient que si elle porte une DATE UEX (`data-u` > 0) : c'est elle qui doit
  // ressortir en `base`. On balaie jusqu'à en trouver une, plutôt que de parier sur un rang — et la
  // valeur saisie doit DIFFÉRER de celle d'UEX, sinon `startEdit` n'écrit rien (consulter n'est pas
  // corriger) et le test passerait pour de mauvaises raisons.
  async function corriger(field) {
    const cases = page.locator(`#correctionsStation .editv[data-s="buy"][data-f="${field}"]`);
    for (let i = 0; i < (await cases.count()); i++) {
      const c = cases.nth(i);
      const [u, v, commodite] = await Promise.all(
        ["data-u", "data-v", "data-c"].map((a) => c.getAttribute(a)));
      if (!(Number(u) > 0) || v === "") continue; // ni date UEX, ni valeur d'origine : rien à prouver
      const valeur = Number(v) + 1;
      await c.click();
      const champ = c.locator("input");
      if (!(await champ.count())) continue;
      await champ.fill(String(valeur));
      await champ.press("Enter");
      return { commodite, valeur };
    }
    throw new Error(`aucune case « ${field} » datée par UEX sur cette station : le test ne peut rien prouver`);
  }
  const prixSaisi = await corriger("price");
  const volSaisi = await corriger("vol");

  const bouton = page.locator("#exportCorrections");
  await expect(bouton).toBeVisible();
  await bouton.click();
  await expect(bouton).toHaveText("✓ Copié");

  const sortie = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(sortie.v).toBe(1);
  expect(sortie.type).toBe("corrections");
  expect(sortie.emis).toMatch(ISO_Z);

  const prix = sortie.corrections.find((c) => c.commodite === prixSaisi.commodite && c.champ === "prix");
  const vol = sortie.corrections.find((c) => c.commodite === volSaisi.commodite && c.champ === "volume");
  expect(prix, "le prix corrigé manque à l'export").toBeTruthy();
  expect(vol, "le stock corrigé manque à l'export").toBeTruthy();
  expect(prix.valeur).toBe(prixSaisi.valeur);
  expect(vol.valeur).toBe(volSaisi.valeur);
  // Les DEUX dates, sur les DEUX corrections, toutes en Z — c'est tout l'objet de l'issue : sans
  // `saisi`, un prix exporté ne peut plus être daté, donc plus jamais périmé à la relecture.
  for (const c of [prix, vol]) {
    expect(c.terminal).toBe("Megumi");
    expect(c.cote).toBe("achat");
    expect(c.saisi, `${c.champ} : aucune date de saisie`).toMatch(ISO_Z);
    expect(c.base, `${c.champ} : aucune date UEX`).toMatch(ISO_Z);
  }
});



test("Soute : une déclaration en cours de saisie survit à un geste fait ailleurs (#55)", async ({ page }) => {
  // La garde de focus de `renderDeclaration` ne protégeait que tant que le curseur restait dans la
  // carte. Toucher la soute ou changer de vue repeignait des champs sans `value` : le texte tapé
  // disparaissait en silence, le formulaire restant ouvert et vide. Deux gestes ordinaires.
  await page.click("#holdAddOpen");
  await page.fill("#holdAddName", "Titanium");
  await page.fill("#holdAddScu", "42");

  await page.fill("#cargo", "120");        // un geste ailleurs, qui déclenche un rendu
  await page.locator("#cargo").blur();
  await expect(page.locator("#holdAddName")).toHaveValue("Titanium");
  await expect(page.locator("#holdAddScu")).toHaveValue("42");

  await page.click("#viewLoops");          // et un changement de vue
  await page.click("#viewRoutes");
  await expect(page.locator("#holdAddName")).toHaveValue("Titanium");
  await expect(page.locator("#holdAddScu")).toHaveValue("42");
});
