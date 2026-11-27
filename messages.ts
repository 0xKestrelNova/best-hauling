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

/** Un bouton dans le message : « ↶ annuler » après la vente du départ (#212). */
export type ActionToast = { label: string; run: () => void };

/**
 * Flash discret. Le nœud est créé à la volée : `index.html` n'en porte aucun.
 *
 * Avec une `action`, le message porte un bouton, reste plus longtemps (on doit avoir le temps de
 * lire PUIS de cliquer), et redevient cliquable — il est sinon `pointer-events: none` pour ne
 * jamais masquer ce qu'il recouvre. Le bouton ne sert qu'une fois : il disparaît avec le message,
 * et le message suivant le remplace.
 */
export function showToast(msg: string, action?: ActionToast): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("actionable", !!action);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => { el!.classList.remove("show", "actionable"); action.run(); }, { once: true });
    el.append(" ", b);
  }
  el.classList.add("show");
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove("show", "actionable"), action ? 10_000 : 4500);
}
