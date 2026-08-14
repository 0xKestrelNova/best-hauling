// Le port du serveur de test, DÉRIVÉ de la copie de travail au lieu d'être fixé.
//
// Pourquoi : `playwright.config.mjs` pose `reuseExistingServer` hors CI. Avec un port fixe, une
// suite lancée depuis une seconde copie (worktree, ou simplement un second clone) trouvait le port
// occupé, considérait que le serveur était le sien, et lui envoyait ses tests — alors que
// `scripts/serve.mjs` sert le répertoire depuis lequel IL a été lancé, c'est-à-dire l'autre copie.
// La suite passait, verte, en ayant mesuré le code du voisin. C'est la pire forme de faux vert :
// celle qui ressemble exactement à un vrai (#70).
//
// Le repli n'existe pas : il n'y a pas de « port par défaut » qu'on pourrait oublier de surcharger.
// Un port dérivé protège sans discipline, une variable d'environnement demande qu'on y pense — donc
// on n'y penserait pas le jour où ça compte.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Plage retenue : 30000-39999. Au-dessus des ports d'applications courants, et SOUS la plage
// dynamique de Windows (49152-65535) où le système attribue les ports éphémères — s'y poser
// exposerait à un conflit intermittent avec n'importe quelle connexion sortante, c'est-à-dire au
// test instable qu'on cherche précisément à supprimer.
export const PORT_BASE = 30000;
export const PORT_PLAGE = 10000;

export function portDuDepot(racine) {
  // `resolve` normalise séparateurs et `..` : deux façons d'écrire le même chemin doivent rendre le
  // même port, sinon deux terminaux sur la MÊME copie démarreraient deux serveurs.
  let cle = resolve(racine);
  // Les chemins Windows sont insensibles à la casse — `C:\Projets` et `c:\projets` sont la même
  // copie. Ailleurs, non : deux répertoires ne différant que par la casse sont bien distincts, et
  // les confondre les ferait se partager un serveur, soit le défaut d'origine à l'envers.
  if (process.platform === "win32") cle = cle.toLowerCase();
  return PORT_BASE + (createHash("sha1").update(cle).digest().readUInt32BE(0) % PORT_PLAGE);
}
