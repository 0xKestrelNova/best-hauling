import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Socle de build de la v2 (ADR-008). Ce fichier ne contient AUCUNE décision d'ergonomie : il ne
// fait qu'une chose, faire traverser au site v1 une étape de fabrication sans rien casser de ce
// que la production tient. Trois contraintes le dictent, toutes vérifiables :
//
//   1. Le site vit sous un SOUS-CHEMIN (https://0xkestrelnova.github.io/best-hauling/,
//      .github/workflows/update-data.yml). Un `base` absolu casse la production seule ; un `base`
//      « /best-hauling/ » casse les tests seuls, qui servent à la racine. Seul « ./ » satisfait
//      les deux, et c'est déjà la convention de tout le reste (start_url et scope du manifeste,
//      SHELL du service worker, les fetch de données).
//   2. La CSP n'a PAS `data:` dans img-src (index.html). Vite inline en base64 tout asset sous
//      4 ko : icon.svg fait 433 octets et disparaîtrait EN PRODUCTION SEULEMENT. D'où
//      assetsInlineLimit à 0, qui n'est pas un réglage de confort mais le pendant mécanique
//      d'une directive de sécurité.
//   3. Le service worker précache une liste de fichiers. Vite les renomme. La liste doit donc
//      être écrite par le build — voir le plugin `precache` plus bas, et son commentaire.
//
// La config reste en .mjs et non en .ts : le socle n'introduit pas TypeScript (tranché avec le
// propriétaire), et tout l'outillage du dépôt est déjà en .mjs.

// Ces trois fichiers portent un NOM SOUS CONTRAT et doivent traverser le build sans être renommés :
// rail.js est nommé par un test de source (scripts/csp.test.mjs) et par la ligne d'assemblage du
// déploiement ; icon.svg est désigné par le manifeste, un JSON que Vite ne réécrit pas ; le
// manifeste lui-même est désigné par index.html. Un hachage rendrait ces références fausses sans
// que rien ne le dise avant la production.
//
// Ils restent À LA RACINE plutôt que dans un `public/`, et c'est une décision, pas une facilité :
// le déploiement actuel assemble le site en copiant les fichiers SOURCES
// (`cp index.html app.js rail.js … _site/` dans .github/workflows/update-data.yml). Les déplacer
// ferait échouer cette copie — donc casserait la mise en ligne — alors que le socle doit être
// invisible pour la production tant que le déploiement n'a pas basculé. `publicDir` est désactivé
// pour la même raison, et le build les copie lui-même.
const FICHIERS_RACINE = ["rail.js", "icon.svg", "manifest.webmanifest"];

// `data/` reste hors du bundler : scripts/build-data.mjs y écrit, le service worker route sur le
// préfixe `/data/`, le mécanisme de non-redéploiement lit une URL publique en dur, et CLAUDE.md
// veut que la régénération des JSON vive dans son propre commit. On copie à la fin du build, sans
// rien faire passer par Vite.
function copierHorsBundle(racine, dist) {
  const copies = [];
  for (const f of FICHIERS_RACINE) {
    const src = join(racine, f);
    if (!existsSync(src)) {
      throw new Error(
        `vite.config.mjs : ${f} est introuvable à la racine. Ce fichier porte un nom sous contrat ` +
          `(index.html, sw.js, le manifeste ou la ligne d'assemblage le nomment). S'il a déménagé, ` +
          `mettre à jour FICHIERS_RACINE **et** la ligne cp d'update-data.yml.`
      );
    }
    copyFileSync(src, join(dist, f));
    copies.push(f);
  }

  const srcData = join(racine, "data");
  if (existsSync(srcData)) {
    const destData = join(dist, "data");
    mkdirSync(destData, { recursive: true });
    for (const f of readdirSync(srcData)) {
      if (!f.endsWith(".json")) continue;
      copyFileSync(join(srcData, f), join(destData, f));
      copies.push("data/" + f);
    }
  }
  return copies;
}

// Liste récursive des fichiers d'un répertoire, en chemins relatifs à séparateurs `/` — le service
// worker parle d'URL, pas de chemins Windows.
function fichiersDe(racine, dossier = racine) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersDe(racine, chemin));
    else sortie.push(relative(racine, chemin).split(sep).join("/"));
  }
  return sortie;
}

// Le manifeste de précache (ADR-008 §7). Sans lui, le premier `vite build` casserait le mode
// hors-ligne EN SILENCE : sw.js nomme app.js, logic.mjs et style.css, que le build vient de
// renommer. Et `caches.addAll` est ATOMIQUE — une seule URL en 404 fait rejeter l'ensemble. Le
// hors-ligne ne se dégraderait pas, il disparaîtrait, sans erreur visible et en production seule.
//
// On réécrit donc le littéral `SHELL` de sw.js avec ce que le build a RÉELLEMENT émis. Le source
// garde sa liste v1 en clair : il reste lisible, exécutable tel quel, et scripts/version.test.mjs
// continue d'y lire `CACHE` sans rien savoir de ce plugin.
//
// `data/` est exclu à dessein : ces fichiers ont leur PROPRE stratégie dans sw.js (réseau d'abord,
// cache en repli). Les précacher les figerait à la version du déploiement.
const ANCRE_SHELL = /^const SHELL = \[[^\]]*\];$/m;

// Vite traite `<link rel="icon">` et `<link rel="manifest">` comme des assets : il les hache et les
// range sous assets/. Pour le manifeste, c'est une TRIPLE panne de production, invisible en test —
// son JSON n'est pas réécrit, donc ses chemins relatifs se retrouvent résolus depuis assets/ :
//
//     "src": "icon.svg"   -> assets/icon.svg, qui n'existe pas (il est haché) : plus d'icône
//     "start_url": "./"   -> l'app INSTALLÉE démarre sur /assets/
//     "scope": "./"       -> la PWA ne contrôle plus les pages du site
//
// On sort donc ces fichiers du bundle et on remet les href d'origine dans la page. Le repérage se
// fait par `originalFileNames`, ce que Rollup a réellement lu, et non par un motif sur les noms
// hachés : un futur `icon-2.svg` légitime ne doit pas être emporté par erreur.
function horsBundle() {
  let racine = process.cwd();
  let sortie = "dist";
  return {
    name: "best-hauling:hors-bundle",
    apply: "build",
    configResolved(config) {
      racine = config.root;
      sortie = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      for (const [nom, emis] of Object.entries(bundle)) {
        const origines = emis.originalFileNames || (emis.originalFileName ? [emis.originalFileName] : []);
        if (origines.some((o) => FICHIERS_RACINE.includes(o.split("/").pop()))) delete bundle[nom];
      }
    },
    // La réécriture des href se fait sur le FICHIER PRODUIT, pas via transformIndexHtml : ce hook,
    // même en `order: "post"`, passe avant la substitution finale des URL d'assets par Vite — on
    // remplaçait donc des chaînes qui n'existaient pas encore, et dist/index.html sortait en
    // pointant vers des fichiers que generateBundle venait de supprimer. Mesuré, pas supposé.
    closeBundle() {
      const page = join(racine, sortie, "index.html");
      if (!existsSync(page)) return;
      const avant = readFileSync(page, "utf8");
      const apres = avant
        .replace(/href="[^"]*manifest-[^"]+\.webmanifest"/g, 'href="./manifest.webmanifest"')
        .replace(/href="[^"]*icon-[^"]+\.svg"/g, 'href="./icon.svg"');
      if (apres === avant) return;
      writeFileSync(page, apres);
    },
  };
}

function precache() {
  let racine = process.cwd();
  let sortie = "dist";
  return {
    name: "best-hauling:precache",
    apply: "build",
    configResolved(config) {
      racine = config.root;
      sortie = config.build.outDir;
    },
    closeBundle() {
      const dist = join(racine, sortie);
      // La copie vient AVANT le listage : ce qui n'est pas encore dans dist/ n'entrerait pas dans
      // le manifeste, et `addAll` étant atomique, un seul oubli supprimerait tout le hors-ligne.
      const horsBundle = copierHorsBundle(racine, dist);

      const aPrecacher = fichiersDe(dist)
        .filter((f) => !f.startsWith("data/") && f !== "sw.js")
        .sort();
      // « ./ » d'abord : c'est l'URL par laquelle une app installée démarre (start_url du
      // manifeste), et elle est distincte de « ./index.html » pour le cache.
      const shell = ["./", ...aPrecacher.map((f) => "./" + f)];

      const source = readFileSync(join(racine, "sw.js"), "utf8");
      if (!ANCRE_SHELL.test(source)) {
        // Échec BRUYANT plutôt qu'un service worker silencieusement périmé : si l'ancre bouge,
        // le build s'arrête au lieu de déployer un hors-ligne qui ne s'installe plus.
        this.error(
          "sw.js : ancre `const SHELL = [...];` introuvable — le manifeste de précache ne peut pas " +
            "être injecté. Corrige l'ancre dans sw.js ou ANCRE_SHELL dans vite.config.mjs."
        );
      }
      const injecte = source.replace(
        ANCRE_SHELL,
        "// Liste ÉCRITE PAR LE BUILD (vite.config.mjs, plugin best-hauling:precache).\n" +
          "const SHELL = " + JSON.stringify(shell) + ";"
      );
      writeFileSync(join(dist, "sw.js"), injecte);

      this.info(
        `précache : ${shell.length} entrées, ${horsBundle.length} fichiers copiés hors bundle`
      );
    },
  };
}

// La CSP de DÉVELOPPEMENT, et uniquement de développement. `script-src 'self'` interdit tout
// script inline : c'est voulu, c'est la raison d'être de rail.js en fichier séparé, et
// scripts/csp.test.mjs le verrouille. Mais le serveur de dev de Vite injecte son client de
// rechargement à chaud EN INLINE — sans assouplissement, le dev est inutilisable.
//
// L'assouplissement vit ici, dans la réponse HTTP du serveur de dev, et NULLE PART ailleurs :
//   - `apply: "serve"` fait que ce plugin n'existe pas au build ;
//   - la réécriture porte sur la réponse, jamais sur le fichier — index.html sur disque garde sa
//     politique stricte, donc scripts/csp.test.mjs continue de lire la vraie.
//
// Deux voies ont été écartées, et il faut le savoir pour ne pas les reprendre : `server.headers`
// ajouterait une SECONDE politique, or deux CSP s'appliquent en INTERSECTION — un en-tête ne
// relâche jamais une <meta>, et on finit par éditer index.html « juste pour le dev ». Et retirer
// la <meta> du template pour l'injecter au build ferait échouer csp.test.mjs, à raison.
function cspDev() {
  return {
    name: "best-hauling:csp-dev",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(")/,
        (_, avant, politique, apres) => {
          const assoupli = politique
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
            .replace("connect-src 'self'", "connect-src 'self' ws:");
          return avant + assoupli + apres;
        }
      );
    },
  };
}

export default defineConfig({
  // Voir la contrainte 1 en tête de fichier. Ne jamais mettre « / » ni « /best-hauling/ ».
  base: "./",
  // Pas de `public/` : les fichiers à nom contractuel restent à la racine pour que la ligne
  // d'assemblage du déploiement continue de les trouver (voir FICHIERS_RACINE ci-dessus).
  publicDir: false,
  build: {
    outDir: "dist",
    // Voir la contrainte 2. Ce zéro est la contrepartie de `img-src` sans `data:`.
    assetsInlineLimit: 0,
    emptyOutDir: true,
  },
  // Aucun port n'est décidé ici, et c'est délibéré : le port des tests est DÉRIVÉ de la copie de
  // travail (scripts/port.mjs) et scripts/port.test.mjs interdit tout littéral dans
  // playwright.config.mjs. Un port posé ici serait invisible à ce garde-fou.
  // L'ordre compte : `horsBundle` retire les assets à nom contractuel et rétablit leurs href, et
  // `precache` liste ensuite dist/ tel qu'il est réellement. Inverser produirait un manifeste qui
  // précache des fichiers hachés que plus personne ne référence.
  //
  // Tailwind est écrit en tête pour que la lecture corresponde à l'exécution, mais sa position est
  // COSMÉTIQUE : ses trois sous-plugins portent tous `enforce: "pre"`, donc Vite les trie devant les
  // nôtres quoi qu'on écrive. Nos trois-là n'en souffrent pas — ils n'agissent qu'en
  // generateBundle/closeBundle, soit après toute transformation, et `precache` liste dist/ tel
  // qu'il est : le CSS retravaillé par Tailwind y entre seul, sous son nom haché.
  plugins: [tailwindcss(), cspDev(), horsBundle(), precache()],
});
