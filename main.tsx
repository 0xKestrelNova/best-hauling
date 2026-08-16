// Le point de montage de la racine unique (ADR-011, étape 3).
//
// `app.js` importe ce module ; il n'y a donc qu'un seul `createRoot` dans toute l'application, là
// où `pont.js` en créait un par conteneur — quarante et un au total. Ceux qui restent partiront au
// fur et à mesure que les vues emménagent dans l'arbre.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

/** Monte la racine sur `#racine`. Idempotent : deux appels ne créent qu'un arbre. */
let montee = false;

export function monterRacine(): void {
  if (montee) return;
  const cible = document.getElementById("racine");
  if (!cible) return;
  createRoot(cible).render(<App />);
  montee = true;
}
