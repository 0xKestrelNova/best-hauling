// Le message éphémère (ADR-012).
//
// Un toast n'appartient à aucune vue : il se pose sur `document.body`, il survit au changement de
// vue, et il n'a pas de conteneur dans `index.html`. C'est ce qui le rend extractible seul, sans
// rien décider du reste — et c'est aussi ce qui l'empêchera un jour d'être un portail : le nœud
// qu'il touche n'est possédé par personne.
//
// Il sort d'`app.js` parce que `notifySuperseded()` le suit (voir `corrections-actions.ts`), et que
// celui-là doit devenir appelable depuis une vue de l'arbre.

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Flash discret. Le nœud est créé à la volée : `index.html` n'en porte aucun. */
export function showToast(msg: string): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}
