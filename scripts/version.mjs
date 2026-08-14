// LA source de vérité de la version : `package.json`, et rien d'autre.
//
// Elle doit redescendre à trois endroits qui ne peuvent pas la lire eux-mêmes :
//   - le nom du cache du service worker (`sw.js` est servi tel quel au navigateur, il n'importe
//     rien) — d'où un littéral là-bas, et un test ici qui refuse qu'il diverge ;
//   - `data/meta.json`, écrit au build et déjà récupéré par l'app ;
//   - l'écran, via ce meta.
//
// Le nom du cache n'est pas décoratif. `sw.js` sert la coquille en « stale-while-revalidate » :
// sans changement de nom, un visiteur déjà installé continue de recevoir l'ANCIEN index.html
// pendant toute une visite, pendant que les scripts, eux, sont à jour. Le bump était jusqu'ici
// manuel, donc oubliable ; il suit maintenant la version, et un test le vérifie.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8")).version;

// Le nom du cache pour une version donnée. Une fonction plutôt qu'une constante : c'est elle que le
// test applique à `package.json` pour la comparer à ce que `sw.js` écrit vraiment.
export const nomDuCache = (version = VERSION) => `best-hauling-v${version}`;

// Le commit déployé, court. Vient de l'environnement du runner ; vide en local, et c'est voulu —
// une copie de travail n'a pas de commit « déployé », et afficher le HEAD local laisserait croire
// que ce qu'on voit est en ligne.
export const commitCourt = (env = process.env) => (env.GITHUB_SHA || "").slice(0, 7);
