import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Le filet visuel de la refonte v2 (ADR-008 §2). Il répare un trou mesuré : sur 190 tests e2e, il
// existe QUATRE assertions de couleur, et toutes sont RELATIONNELLES — « le fond du ▶ diffère de
// celui du 📦 », « le bord d'achat diffère du bord de vente ». Aucune n'affirme qu'une couleur EST
// quelque chose. Conséquence : le site pouvait virer entièrement au gris avec 190 tests au vert.
//
// Ces tests-ci lisent la SOURCE, comme scripts/csp.test.mjs et scripts/version.test.mjs : ils
// tournent dans le job `unit` de la CI, qui n'installe rien, et échouent en nommant ce qui a bougé.
// Le pendant à l'exécution (le jeton tel que le NAVIGATEUR le calcule) est dans e2e/jetons.pw.mjs.
//
// Pourquoi épingler des valeurs plutôt que de vérifier « il y a bien un thème » : parce que la
// panne qu'on redoute n'est pas l'absence de thème, c'est sa DÉRIVE — un ambre recopié de travers,
// un palier de gris écrasé, une teinte de système remplacée par un neutre shadcn.

const lire = (f) => readFileSync(join(process.cwd(), f), "utf8");

// ---------- Les jetons d'identité, à la valeur près ----------
// Cette table EST le contrat. La modifier est une décision de design ; la modifier sans le vouloir
// est le bug que ce fichier existe pour attraper.
const IDENTITE = {
  "--acc": "#ffb020",       // l'ambre du HUD, 94 usages — la couleur du site
  "--acc-2": "#a970ff",     // le violet (chaîne, secondaire)
  "--good": "#46e5a0",
  "--warn": "#f5a742",
  "--bad": "#ff5d5d",
  "--bg": "#05060d",
  "--text": "#e8ecf5",
  "--muted": "#8a93a8",
  "--panel-solid": "#0b0f1c",
  // La couleur PAR SYSTÈME. Ces trois-là sont aussi une API publique consommée par le JavaScript :
  // app.js écrit littéralement « var(--stanton) » dans des attributs SVG fill=/stroke=. Les
  // renommer rendrait le fill invalide et les planètes disparaîtraient sur le fond sombre de la
  // carte — sans qu'aucun test de rendu ne le voie.
  "--stanton": "#38bdf8",
  "--pyro": "#ff6a3d",
  "--nyx": "#a970ff",
};

// Les trois familles typographiques : le caractère du HUD tient autant à elles qu'aux couleurs.
const POLICES = {
  "--font": "Chakra Petch",
  "--display": "Orbitron",
  "--mono": "JetBrains Mono",
};

const racine = () => {
  const css = lire("style.css");
  const bloc = css.match(/^:root\s*\{([\s\S]*?)^\}/m);
  assert.ok(bloc, "ancre : style.css déclare toujours son bloc :root");
  return bloc[1];
};

test("jetons : les couleurs d'identité sont exactement celles du HUD", () => {
  const r = racine();
  for (const [nom, valeur] of Object.entries(IDENTITE)) {
    const m = r.match(new RegExp("^\\s*" + nom + ":\\s*([^;]+);", "m"));
    assert.ok(m, `${nom} a disparu de :root — c'est un jeton d'identité, pas un détail`);
    assert.equal(
      m[1].trim().toLowerCase(),
      valeur,
      `${nom} a changé de valeur. Si c'est voulu, la table de scripts/jetons.test.mjs se met à jour ` +
        `DANS LA MÊME PR — sinon c'est une dérive, et c'est précisément ce que ce test attrape.`
    );
  }
});

test("jetons : les trois familles typographiques tiennent", () => {
  const r = racine();
  for (const [nom, famille] of Object.entries(POLICES)) {
    const m = r.match(new RegExp("^\\s*" + nom + ":\\s*([^;]+);", "m"));
    assert.ok(m, `${nom} a disparu de :root`);
    assert.ok(
      m[1].includes(famille),
      `${nom} ne commence plus par « ${famille} » — la police de repli a pris sa place`
    );
  }
});

test("jetons : chaque teinte déclinable a son jumeau en CANAUX", () => {
  // Le fait central relevé sur style.css : l'identité n'est pas « l'ambre #ffb020 », c'est « l'ambre
  // à dix-huit opacités ». --acc vit à 18 alphas distincts, --acc-2 à 16, --good et --bad à 10.
  // Un jeton hexadécimal ne peut produire AUCUNE de ces déclinaisons : chacune redevient un rgba()
  // recopié à la main, et le site se dépeuple par accumulation — le scénario exact que l'ADR §2
  // dit vouloir empêcher.
  //
  // D'où le jumeau en canaux : `--acc-rgb: 255 176 32` autorise `rgb(var(--acc-rgb) / .14)`.
  // Le hex, lui, RESTE — c'est app.js qui l'exige (voir plus haut, les attributs SVG).
  const r = racine();
  // La liste est celle des teintes RÉELLEMENT déclinées dans style.css, pas celle qu'on imagine :
  // --text (#e8ecf5) n'apparaît à aucune opacité — il sert d'encre pleine et rien d'autre. Lui
  // donner un jumeau en canaux créerait un jeton mort, que le test suivant rejetterait à raison.
  const DECLINABLES = ["--acc", "--acc-2", "--good", "--warn", "--bad", "--muted", "--stanton", "--pyro", "--nyx"];
  for (const nom of DECLINABLES) {
    const hex = r.match(new RegExp("^\\s*" + nom + ":\\s*#([0-9a-fA-F]{6});", "m"));
    assert.ok(hex, `${nom} doit rester un hex lisible`);
    const canaux = r.match(new RegExp("^\\s*" + nom + "-rgb:\\s*([\\d\\s]+);", "m"));
    assert.ok(canaux, `${nom}-rgb manque : sans lui, toute déclinaison alpha redevient un littéral`);

    const [rr, gg, bb] = canaux[1].trim().split(/\s+/).map(Number);
    const h = hex[1];
    assert.deepEqual(
      [rr, gg, bb],
      [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)],
      `${nom}-rgb ne décrit pas la même couleur que ${nom} — les deux formes doivent rester en phase`
    );
  }
});

test("jetons : les encres sur fond accentué existent, et sont teintées de leur fond", () => {
  // Elles n'existaient nulle part comme jetons et étaient écrites en dur 10 fois. Un bouton qui
  // perd son encre affiche du texte sombre par défaut, ou hérite d'un --text clair sur fond vert
  // vif : illisible dans les deux cas. Et ce sont des noirs TEINTÉS de leur fond, pas un noir
  // générique — c'est ce qui les rend propres.
  const r = racine();
  for (const nom of ["--acc-fg", "--acc-2-fg", "--good-fg"]) {
    assert.ok(
      new RegExp("^\\s*" + nom + ":\\s*#[0-9a-fA-F]{6};", "m").test(r),
      `${nom} manque : l'encre sur fond accentué doit être un jeton, pas un littéral recopié`
    );
  }
});

test("jetons : aucun jeton mort dans :root", () => {
  // --panel-2 était déclaré et utilisé ZÉRO fois, dans style.css comme dans le JavaScript. Un jeton
  // que personne ne lit est une fausse piste pour qui reprend le thème.
  //
  // La seconde source lue était `app.js`, qui n'écrit plus un seul `var(--…)` (mesuré : 0). C'est
  // `vues/carte.tsx` qui les écrit désormais, et elle est SEULE à le faire dans tout le code du
  // dépôt : quatre jetons dans des attributs SVG `fill=`/`stroke=`, parce qu'un attribut de
  // présentation SVG n'est pas atteignable par une règle CSS de la même façon.
  //
  // Cette seconde lecture est INERTE aujourd'hui, et c'est mesuré : les quatre jetons qu'elle
  // couvre (`--stanton`, `--pyro`, `--nyx`, `--acc`) ont tous un usage dans style.css, donc aucun
  // ne survit uniquement par elle. On la garde quand même — le jour où un jeton n'existera QUE pour
  // la carte, il passerait sinon pour mort, on le retirerait de `:root`, et les planètes perdraient
  // leur teinte sans qu'un seul test de rendu ne bronche.
  const css = lire("style.css");
  const carte = lire("vues/carte.tsx");
  const r = racine();
  const declares = [...r.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]);
  const morts = declares.filter((n) => {
    const usages = (css.match(new RegExp("var\\(" + n + "[,)]", "g")) || []).length;
    return usages === 0 && !carte.includes(n);
  });
  assert.deepEqual(morts, [], `jeton(s) déclaré(s) et jamais lu(s) : ${morts.join(", ")}`);
});

test("jetons : le CSS produit n'embarque aucune URI data:", () => {
  // Garde-fou permanent, et il vise une classe entière de régressions invisibles : la CSP du site
  // n'a PAS `data:` dans img-src. Tout plugin qui fabrique une image en CSS — @tailwindcss/forms
  // et ses chevrons de <select>, par exemple — verrait ses images bloquées EN PRODUCTION comme EN
  // TEST, sans qu'aucune assertion ne tombe. 6 <select> et 8 cases à cocher sont concernés.
  const dist = join(process.cwd(), "dist", "assets");
  if (!existsSync(dist)) return; // pas de build sous la main : rien à vérifier, pas d'échec factice
  for (const f of readdirSync(dist).filter((x) => x.endsWith(".css"))) {
    const css = readFileSync(join(dist, f), "utf8");
    const m = css.match(/url\(\s*["']?data:/);
    assert.equal(
      m,
      null,
      `${f} embarque une URI data: — la CSP du site (img-src sans data:) la bloquera en production, ` +
        `et aucun test de rendu ne le verra. Retirer le plugin qui la produit.`
    );
  }
});
