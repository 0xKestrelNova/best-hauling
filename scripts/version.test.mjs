// La version ne doit exister qu'à un seul endroit. Ces tests remplacent la vigilance humaine sur
// les deux recopies qu'on ne peut pas éviter — le nom du cache dans `sw.js`, et ce que le build
// écrit dans `meta.json`. Sans eux, un bump de version oublié dans `sw.js` sert l'ancien index.html
// à tous les visiteurs déjà installés, sans que rien ne le signale.
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, nomDuCache, commitCourt } from "./version.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (...p) => readFileSync(join(RACINE, ...p), "utf8").replace(/\r\n/g, "\n");

test("la version de package.json est un semver à trois nombres", () => {
  // Les jalons du dépôt sont des versions (v1.0.1, v1.1.0…) : si celle-ci part en dérive, le lien
  // entre un jalon et ce qui est déployé se casse en silence.
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("le nom du cache de sw.js suit la version — le bump manuel n'est plus oubliable", () => {
  // `sw.js` est servi tel quel au navigateur : il n'importe rien, donc il ÉCRIT la version. C'est
  // la seule recopie inévitable, et ce test est ce qui la tient.
  const cache = lire("sw.js").match(/const CACHE = "([^"]+)"/);
  assert.ok(cache, "ancre : sw.js déclare toujours son cache sous ce nom");
  assert.equal(cache[1], nomDuCache(),
    "bump de version sans bump du cache : les visiteurs installés garderaient l'ancien index.html");
});

test("le build estampille meta.json avec la version et le commit", () => {
  // Lecture de source : `build-data.mjs` fait des appels réseau, on ne le rejoue pas ici. Ce qu'on
  // vérifie est qu'il tire sa version de la source unique au lieu d'en écrire une seconde.
  // `assert.ok` et non `assert.match` : sur un fichier de 900 lignes, `match` déverse tout le
  // contenu dans le rapport d'échec et noie le message.
  const build = lire("scripts", "build-data.mjs");
  assert.ok(/from "\.\/version\.mjs"/.test(build), "le build importe la source unique");
  assert.ok(/app_version:\s*VERSION/.test(build), "meta.json porte la version");
  assert.ok(/commit:\s*commitCourt\(\)/.test(build), "meta.json porte le commit déployé");
});

test("commitCourt : sept caractères en CI, rien en local", () => {
  // Vide en local À DESSEIN : une copie de travail n'a pas de commit « déployé », et afficher le
  // HEAD local laisserait croire que ce qu'on regarde est en ligne.
  assert.equal(commitCourt({ GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567" }), "0123456");
  assert.equal(commitCourt({}), "");
});
