import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

// Le budget de la COQUILLE (refonte v2). Ce test ne juge pas la performance : il rend VISIBLE une
// dérive que rien d'autre ne montre.
//
// Le service worker précache la coquille de façon ATOMIQUE, et le plugin de build ramasse
// automatiquement tout nouveau fragment émis (vite.config.mjs). Autrement dit : chaque dépendance
// ajoutée à la v2 — React, Radix, les composants shadcn copiés — grossit ce que chaque visiteur
// télécharge d'un bloc à l'installation, sans qu'aucun test ne bronche et sans que personne n'ait
// eu à décider.
//
// Un plafond qu'on relève sciemment dans une PR est une décision. Une coquille qui grossit sans que
// personne ne le voie n'en est pas une. Ce test transforme la seconde en la première.

const PLAFOND_OCTETS = 420_000;  // mesuré à 392 707 le 2026-08-15 (thème posé, avant Tailwind)
const PLAFOND_ENTREES = 24;      // mesuré à 20

const dist = join(process.cwd(), "dist");

const fichiersDe = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiersDe(join(d, e.name)) : [join(d, e.name)]
  );

test("coquille : le poids précaché reste sous son plafond", { skip: !existsSync(dist) && "pas de build" }, () => {
  // `data/` est exclu : ces fichiers ne sont PAS précachés (sw.js leur applique « réseau d'abord »),
  // et leur taille suit UEX, pas nos décisions.
  const fichiers = fichiersDe(dist).filter((f) => !f.includes("data" + sep));
  const octets = fichiers.reduce((s, f) => s + statSync(f).size, 0);

  assert.ok(
    octets <= PLAFOND_OCTETS,
    `la coquille pèse ${octets} o pour un plafond de ${PLAFOND_OCTETS}. Ce n'est pas forcément une ` +
      `erreur — mais c'est une DÉCISION : relever le plafond dans la même PR, en disant ce qui l'a ` +
      `fait grossir. Rappel des postes mesurés : polices 38 %, JS 35 %, CSS 17 %.`
  );
});

test("coquille : le nombre d'entrées précachées reste sous son plafond", { skip: !existsSync(dist) && "pas de build" }, () => {
  const sw = readFileSync(join(dist, "sw.js"), "utf8");
  const m = sw.match(/const SHELL = (\[[^\]]*\]);/);
  assert.ok(m, "ancre : dist/sw.js porte toujours sa liste de précache écrite par le build");
  const n = JSON.parse(m[1]).length;
  assert.ok(
    n <= PLAFOND_ENTREES,
    `${n} entrées précachées pour un plafond de ${PLAFOND_ENTREES}. Le découpage de code multiplie ` +
      "les fragments, et addAll est ATOMIQUE : plus il y a d'entrées, plus une seule 404 coûte cher."
  );
});
