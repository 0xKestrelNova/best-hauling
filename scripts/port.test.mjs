// Le port du serveur de test. Un port FIXE partagé par plusieurs copies de travail est le pire
// défaut d'outillage possible : la suite reste verte en testant le code du voisin (#70). Ces tests
// verrouillent les deux propriétés qui l'empêchent — un port par copie, et aucun port en dur dans
// la configuration.
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { portDuDepot, PORT_BASE, PORT_PLAGE } from "./port.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (...p) => readFileSync(join(RACINE, ...p), "utf8").replace(/\r\n/g, "\n");

test("portDuDepot : deux copies de travail ne partagent jamais leur serveur", () => {
  // Le scénario exact de #70 : le dépôt et un worktree posé dessous.
  const depot = portDuDepot("C:/Projets/best-hauling");
  const worktree = portDuDepot("C:/Projets/best-hauling/.claude/worktrees/wf-1");
  assert.notEqual(depot, worktree);

  // Et sur un échantillon large : aucune collision entre vingt copies plausibles. Une collision
  // ramènerait exactement le défaut, en plus rare donc en plus difficile à croire.
  const ports = new Set();
  for (let i = 0; i < 20; i++) ports.add(portDuDepot(`/home/x/best-hauling-${i}`));
  assert.equal(ports.size, 20);
});

test("portDuDepot : la même copie rend TOUJOURS le même port", () => {
  // Sans quoi `reuseExistingServer` ne servirait plus à rien : chaque relance dans la même copie
  // repaierait le démarrage du serveur.
  const a = portDuDepot("/home/x/best-hauling");
  assert.equal(portDuDepot("/home/x/best-hauling"), a);
  // Un chemin non normalisé désigne la même copie, donc le même port.
  assert.equal(portDuDepot("/home/x/./autre/../best-hauling"), a);
});

test("portDuDepot : le port tombe dans une plage sûre", () => {
  // Hors de la plage dynamique de Windows (49152-65535), où le système attribue les ports
  // éphémères : s'y poser exposerait à un conflit intermittent avec n'importe quelle connexion
  // sortante — c'est-à-dire à un test instable, ce qu'on cherche justement à supprimer.
  for (const p of ["/a", "C:/b", "/very/long/path/to/a/checkout", RACINE]) {
    const port = portDuDepot(p);
    assert.ok(Number.isInteger(port), `${p} rend un entier`);
    assert.ok(port >= PORT_BASE && port < PORT_BASE + PORT_PLAGE, `${p} -> ${port} dans la plage`);
    assert.ok(port < 49152, `${p} -> ${port} hors de la plage dynamique Windows`);
  }
});

test("portDuDepot : sous Windows, la casse du chemin ne change pas le port", () => {
  // Les chemins Windows sont insensibles à la casse : deux terminaux ouverts sur `C:\Projets` et
  // `c:\projets` sont la MÊME copie et doivent partager leur serveur, pas en démarrer deux.
  const attendu = process.platform === "win32";
  const memePort = portDuDepot("C:/Projets/best-hauling") === portDuDepot("c:/projets/best-hauling");
  assert.equal(memePort, attendu);
});

// LECTURE DE SOURCE. C'est LE test qui échoue avant le correctif : la configuration écrivait 4173
// à trois endroits (`baseURL`, la commande du serveur, l'URL de sonde). Un seul oubli et deux
// copies se repartagent un serveur — sans que rien ne le signale, puisque la suite reste verte.
test("playwright.config.mjs ne fixe aucun port en dur", () => {
  const conf = lire("playwright.config.mjs")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const enDur = conf.match(/\b(?:127\.0\.0\.1|localhost):(\d{4,5})|serve\.mjs (\d{4,5})/g) || [];
  assert.deepEqual(enDur, [], "le port doit venir de portDuDepot(), jamais d'un littéral");
  assert.match(conf, /portDuDepot/, "ancre : la configuration dérive bien son port de la copie");
});
