// Le message « rien à afficher », partagé par TROIS vues (ADR-012).
//
// `#empty` est un `<p>` unique d'`index.html`, frère de `#routes` dans `.table-shell`. Trois vues
// se le disputent — Trajets, Boucles et « En route » — et chacune y écrit son propre texte : « Aucune
// route ne correspond aux filtres. » pour les deux premières, « Choisis un terminal de départ… »
// pour la troisième. `switchView` le masque en plus pour les cinq vues qui n'ont pas de tableau.
//
// ── POURQUOI UNE FONCTION ET PAS UN PORTAIL ───────────────────────────────────────────────────
// Un portail gérerait les ENFANTS du nœud, pas ses ATTRIBUTS : `hidden` resterait à poser à la
// main. Et pendant la migration, deux mondes écrivent tour à tour dans le même nœud — un portail
// React face à un `textContent` impératif, c'est la seule situation où les deux modèles se
// contredisent vraiment.
//
// D'où une FONCTION, appelable des deux côtés. Elle n'est pas encore le seul écrivain — `app.js`
// garde les siens tant que Trajets et « En route » y vivent, et les convertir maintenant mêlerait
// deux migrations dans un même lot. Ce qu'elle garantit dès aujourd'hui, c'est qu'une vue de
// l'arbre n'a pas besoin de connaître ce nœud pour lui parler.
//
// Elle disparaîtra quand les trois vues vivront dans l'arbre : `#empty` deviendra alors un enfant
// de la vue active, et n'aura plus à être partagé du tout.

/** Le texte par défaut, celui des tableaux de trajets. Écrit aussi en dur dans `index.html`. */
export const MESSAGE_VIDE = "Aucune route ne correspond aux filtres.";

/**
 * Affiche `texte` dans `#empty`, ou le masque si `texte` est `null`.
 *
 * Le nœud est réutilisé et non recréé : c'est ce que faisaient les trois vues, et c'est ce qui
 * permet à `switchView` de le masquer sans savoir qui l'avait rempli.
 */
export function messageVide(texte: string | null): void {
  const el = document.getElementById("empty");
  if (!el) return;
  if (texte == null) {
    el.hidden = true;
    return;
  }
  el.textContent = texte;
  el.hidden = false;
}
