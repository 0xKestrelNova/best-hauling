// Barre latérale rétractable (pur vanilla, indépendant de app.js).
// Ce code vivait en <script> inline dans index.html. Il en est sorti pour que `script-src 'self'`
// veuille dire quelque chose : GitHub Pages n'expose aucun en-tête, la CSP tient dans une <meta>,
// et un seul inline toléré (par 'unsafe-inline' ou par un hash à recalculer à chaque retouche)
// rouvrirait la porte à tout script injecté. Reste un script CLASSIQUE, en fin de <body> : en
// module il deviendrait différé, s'exécuterait APRÈS app.js, et la classe `rail-collapsed`
// s'appliquerait après le premier rendu — le rail déplié clignoterait à chaque chargement.
// L'IIFE garde `btn`/`app`/`KEY`/`sync` hors du global, que ce fichier partage désormais.
(function () {
  var btn = document.getElementById("railToggle");
  var app = document.getElementById("app");
  if (!btn || !app) return;
  var KEY = "best-hauling-rail";
  try { if (localStorage.getItem(KEY) === "1") app.classList.add("rail-collapsed"); } catch (e) {}
  var sync = function () {
    var c = app.classList.contains("rail-collapsed");
    btn.textContent = c ? "»" : "«";
    // Le caractère seul ne dit rien à un lecteur d'écran : on tient l'état et le nom à jour.
    btn.setAttribute("aria-expanded", c ? "false" : "true");
    btn.setAttribute("aria-label", c ? "Déplier le menu" : "Rétracter le menu");
  };
  sync();
  btn.addEventListener("click", function () {
    app.classList.toggle("rail-collapsed");
    try { localStorage.setItem(KEY, app.classList.contains("rail-collapsed") ? "1" : "0"); } catch (e) {}
    sync();
  });
})();
