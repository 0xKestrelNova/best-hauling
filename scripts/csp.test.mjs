// La CSP et la coquille sont des réglages qui, en régressant, ne cassent RIEN de visible en CI :
// une directive relâchée s'affiche pareil, un script absent du `cp` ne manque qu'en production —
// les e2e tournent depuis le dépôt, jamais depuis `_site`. Rien ne les signale sans un test.
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
// CRLF normalisés : git rend ces fichiers en CRLF sous Windows et les analyses raisonnent en lignes.
const lire = (...p) => readFileSync(join(RACINE, ...p), "utf8").replace(/\r\n/g, "\n");
// Les COMMENTAIRES sont retirés avant toute analyse : ceux du dépôt citent volontiers les balises
// dont ils parlent (« posée AVANT tout <link> »), et une recherche naïve les prendrait pour du
// markup — le test tomberait sur sa propre documentation plutôt que sur une régression.
const html = lire("index.html").replace(/<!--[\s\S]*?-->/g, "");
const brut = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
const directives = Object.fromEntries(
  (brut || "").split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [nom, ...val] = s.split(/\s+/);
    return [nom, val.join(" ")];
  })
);

test("index.html porte une CSP — seul vecteur possible sous GitHub Pages", () => {
  assert.ok(brut, 'aucune <meta http-equiv="Content-Security-Policy">');
  assert.equal(directives["default-src"], "'self'");
  assert.equal(directives["connect-src"], "'self'");
  assert.equal(directives["object-src"], "'none'");
  assert.equal(directives["base-uri"], "'none'");
  assert.equal(directives["form-action"], "'none'");
  // 'unsafe-inline' est concédé au STYLE seulement (les style="" émis par innerHTML côté app.js).
  // Le même mot sur script-src rendrait toute la politique décorative.
  assert.match(directives["style-src"], /'unsafe-inline'/);
  assert.equal(directives["script-src"], "'self'");
  // Sans effet dans une <meta> : les y écrire ne donnerait qu'une fausse assurance anti-clickjacking.
  for (const inop of ["frame-ancestors", "report-uri", "sandbox"]) {
    assert.ok(!(inop in directives), `« ${inop} » est sans effet dans une <meta>`);
  }
});

test("la CSP est déclarée avant tout <link> : le préchargeur ne doit rien lancer avant de la lire", () => {
  const csp = html.indexOf("Content-Security-Policy");
  const premierLink = html.indexOf("<link");
  assert.ok(csp > 0 && csp < premierLink, "la <meta> CSP doit précéder le premier <link>");
});

test("aucun <script> inline dans index.html : script-src 'self' le bloquerait", () => {
  // Réintroduire un inline ne casse rien tant qu'on relâche la CSP « le temps de » — et c'est
  // exactement ce couple qu'on verrouille : l'un sans l'autre échoue ici.
  const inlines = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(inlines, []);
});

test("tout script d'index.html est précaché (sw.js)", () => {
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.includes("rail.js"), "ancre : la bascule du rail est bien devenue un fichier");
  const shell = lire("sw.js").match(/const SHELL = \[([^\]]+)\]/)[1];
  for (const src of srcs) {
    assert.ok(shell.includes(`"./${src}"`), `${src} manque à SHELL : hors-ligne, il ne serait pas servi`);
  }
});

// La seconde moitié de ce test vérifiait que chaque script figurait dans la ligne `cp` de
// l'assemblage. Elle CHANGE DE CIBLE plutôt que de disparaître (ADR-008 §7) : il n'y a plus de
// liste à la main, donc plus rien à comparer nom par nom — mais le risque qu'elle couvrait, lui,
// AUGMENTE avec un build. Un site publié depuis les sources ne casse rien de visible en CI : les
// e2e servent `dist/`, jamais `_site/`.
//
// Ce que garde ce test, c'est donc l'INVARIANT : l'assemblage passe par le build. C'est
// exactement ce qui manquait quand la liste nommait encore `logic.mjs`, disparu depuis son passage
// en TypeScript (#131).
test("l'assemblage du site passe par le BUILD, jamais par une liste de fichiers à la main (#131)", () => {
  const wf = lire(".github", "workflows", "update-data.yml");
  assert.match(wf, /npm ci/, "l'assemblage doit installer avant de construire");
  assert.match(wf, /npm run build:site/, "l'assemblage doit lancer le build Vite");
  assert.match(wf, /cp -r dist\/\. _site\//, "l'assemblage doit publier `dist/`, le site réellement produit");
  assert.ok(
    !/^ *cp +index\.html/m.test(wf),
    "la liste de fichiers à la main est revenue : elle publierait les SOURCES, et se périme en silence"
  );
});
