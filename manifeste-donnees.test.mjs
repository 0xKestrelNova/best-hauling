import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestRemaining } from "./manifeste-donnees.ts";

// Ces tests n'étaient pas ÉCRIVABLES avant le lot qui a sorti la fonction d'`app.js` : son contexte
// retombait sur `currentManifest`, une globale de module qu'aucun test ne pouvait poser. C'est tout
// l'intérêt du paramètre requis — la fonction sert DEUX porteurs (la carte d'« En route » et une
// jambe du parcours), et rien ne le prouvait.

const ligne = (name, units, buyPrice) => ({ name, units, buyPrice, sellPrice: buyPrice * 2, margin: buyPrice });

test("manifestRemaining : ce qui reste, avec un contexte EXPLICITE", () => {
  const m = {
    lines: [ligne("A", 30, 100), ligne("B", 20, 50)],
    originIdx: 0, destIdx: 1, origin: { name: "X" }, dest: { name: "Y" },
    cargo: 96, f: { useBudget: true, budget: 10_000 },
  };
  const r = manifestRemaining(m);
  assert.equal(r.scu, 50);              // 30 + 20
  assert.equal(r.invest, 4_000);        // 30×100 + 20×50
  assert.equal(r.cargoLeft, 46);        // 96 − 50
  assert.equal(r.budgetLeft, 6_000);    // 10 000 − 4 000
});

test("manifestRemaining : budget éteint = AUCUNE borne, et surtout pas zéro", () => {
  // Une contrainte désactivée ne borne rien. `budgetLeft: 0` ferait refuser tout ajout, en
  // silence : le bouton de suggestion resterait là et ne ferait plus rien.
  const base = { lines: [ligne("A", 10, 100)], originIdx: 0, destIdx: 1, origin: { name: "X" }, dest: { name: "Y" }, cargo: 96 };
  assert.equal(manifestRemaining({ ...base, f: { useBudget: false, budget: 10_000 } }).budgetLeft, Infinity);
  assert.equal(manifestRemaining({ ...base, f: { useBudget: true, budget: 0 } }).budgetLeft, Infinity);
});

test("manifestRemaining : un contexte de JAMBE se calcule exactement pareil", () => {
  // La forme que `legSuggestCtx` (voyage-donnees.ts) fabrique : mêmes clés, plus `system` et `fee`.
  // C'est ce test qui interdit de redescendre un jour cette fonction dans « En route ».
  const jambe = {
    lines: [ligne("Laranite", 64, 2_500)],
    originIdx: 3, destIdx: 7,
    origin: { name: "Megumi", system: "Pyro" },
    dest: { name: "Checkmate", system: "Pyro" },
    cargo: 96, f: { useCargo: true, cargo: 96, useBudget: false, budget: 0 },
    fee: null,
  };
  const r = manifestRemaining(jambe);
  assert.equal(r.scu, 64);
  assert.equal(r.cargoLeft, 32);
  assert.equal(r.budgetLeft, Infinity);
});

test("manifestRemaining : une soute déjà dépassée rend un reste NÉGATIF, jamais zéro", () => {
  // Le manifeste est ajustable à la main et peut dépasser la soute (vol de fret, relevé périmé) :
  // c'est ce négatif que la carte affiche en « 120/96 SCU ». Le borner à zéro effacerait le signal.
  const m = {
    lines: [ligne("A", 120, 10)], originIdx: 0, destIdx: 1,
    origin: { name: "X" }, dest: { name: "Y" }, cargo: 96, f: {},
  };
  assert.equal(manifestRemaining(m).cargoLeft, -24);
});
