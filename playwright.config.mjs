import { defineConfig, devices } from "@playwright/test";
import { portDuDepot } from "./scripts/port.mjs";

// Tests E2E de fumée (non-régression des bugs passés). Le site est servi par le
// serveur statique maison (aucune dépendance runtime). Fichiers : e2e/*.pw.mjs
// (le suffixe .pw évite que `node --test` ne les ramasse — ils passent par Playwright).

// Le port est DÉRIVÉ de la copie de travail, jamais écrit ici (#70). Avec un port fixe et
// `reuseExistingServer`, une suite lancée depuis un second worktree testait le code du premier :
// verte, et sans rien vérifier. Un seul littéral suffisait à ramener le défaut, d'où l'unique
// source ci-dessous — et un test de lecture de source qui interdit d'en réécrire un
// (scripts/port.test.mjs).
const PORT = portDuDepot(process.cwd());
const ORIGINE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.mjs",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // En CI : `list` reste le journal lisible dans la sortie du job, et `html` produit en plus le
  // rapport sur disque que l'étape upload-artifact archive avec les traces (`open: "never"` :
  // un runner n'a pas de navigateur à ouvrir, et le serveur du rapport bloquerait le job).
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: ORIGINE,
    trace: "on-first-retry",
    // ── L'AIDE DE PREMIÈRE VISITE EST AMORCÉE POUR TOUTE LA SUITE (#62) ───────────────────────
    // Une modale qui s'ouvre à la première visite s'ouvre dans les 257 tests, pas seulement dans
    // les siens : Playwright isole le contexte par test, donc chaque test EST une première visite.
    // Une quarantaine d'entre eux cliqueraient alors dans le voile, et le diagnostic serait
    // illisible — « element intercepts pointer events » répété partout.
    //
    // Ici et pas dans un helper importé par les quinze fichiers : c'est UN endroit contre 44 points
    // d'appel à `goto()` (16 dans autoload.pw.mjs, 7 dans socle, 6 dans smoke), dont un seul oublié
    // suffirait à ramener la panne. Et `ORIGINE` est déjà DÉRIVÉ de la copie de travail — la règle
    // de #70 tient, aucun port n'est réécrit ici.
    //
    // `e2e/accueil.pw.mjs` s'en désamorce par `test.use({ storageState: { cookies: [], origins: [] } })` :
    // c'est le seul fichier qui doive voir une vraie première visite.
    //
    // MESURÉ avec cet amorçage : 257 tests, 255 passés, 2 ignorés, 0 échec — le coût sur la suite
    // existante est nul.
    storageState: {
      cookies: [],
      origins: [{ origin: ORIGINE, localStorage: [{ name: "best-hauling-aide-vue", value: "1" }] }],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // La suite tourne sur `dist/`, c'est-à-dire sur CE QUI EST RÉELLEMENT PRODUIT (ADR-008 §4).
  // Servir la racine du dépôt la laissait verte sans jamais regarder le build : elle aurait validé
  // un `dist/` cassé, et le critère de fusion « les e2e passent sur le build Vite » n'aurait rien
  // voulu dire. Le build est donc DANS la commande — un `dist/` périmé ferait passer des tests sur
  // un artefact qui n'est plus celui du code sous les yeux.
  //
  // `reuseExistingServer` hors CI reste vrai, mais il change de sens : le serveur relit le disque à
  // chaque requête, donc un `npm run build:site` relancé à côté est pris en compte sans redémarrer.
  // En revanche il ne reconstruit pas tout seul — après une modification de source, relancer la
  // suite entière (qui rejoue la commande) ou rebâtir à la main.
  webServer: {
    command: `npm run build:site && node scripts/serve.mjs ${PORT} dist`,
    url: `${ORIGINE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
