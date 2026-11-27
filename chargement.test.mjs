// CHARGER UNE JAMBE dans la place qui reste vraiment (#210).
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plafonnerLignes } from "./logic.ts";

const L = (name, units, extra = {}) => ({ name, units, buyPrice: 100, ...extra });

test("plafonnerLignes : assez de place, rien ne bouge", () => {
  const r = plafonnerLignes([L("A", 20), L("B", 13)], 40);
  assert.deepEqual(r.lignes.map((l) => [l.name, l.units]), [["A", 20], ["B", 13]]);
  assert.deepEqual(r.laisses, []);
});

test("plafonnerLignes : l'ordre du manifeste décide, la dernière ligne qui déborde est entamée", () => {
  // Le manifeste arrive trié par intérêt (fillCargo) : c'est la fin qu'on laisse au rayon.
  const r = plafonnerLignes([L("A", 20), L("B", 13), L("C", 7)], 27);
  assert.deepEqual(r.lignes.map((l) => [l.name, l.units]), [["A", 20], ["B", 7]]);
  assert.deepEqual(r.laisses, [{ name: "B", units: 6 }, { name: "C", units: 7 }]);
});

test("plafonnerLignes : soute déjà pleine, rien n'est chargé et tout est dit", () => {
  const r = plafonnerLignes([L("A", 20), L("B", 13)], 0);
  assert.deepEqual(r.lignes, []);
  assert.deepEqual(r.laisses, [{ name: "A", units: 20 }, { name: "B", units: 13 }]);
});

test("plafonnerLignes : une ligne déjà à bord traverse sans prendre de place", () => {
  // `aBord` : `loadHold` ne la recharge pas, elle n'occupe donc pas la place libre.
  const r = plafonnerLignes([L("A", 50, { aBord: true }), L("B", 13)], 10);
  assert.deepEqual(r.lignes.map((l) => [l.name, l.units, !!l.aBord]), [["A", 50, true], ["B", 10, false]]);
  assert.deepEqual(r.laisses, [{ name: "B", units: 3 }]);
});

test("plafonnerLignes : une place libre inconnue ne plafonne rien", () => {
  // Soute non bornée dans les filtres : on n'invente pas un plafond.
  const lignes = [L("A", 20)];
  assert.equal(plafonnerLignes(lignes, null).lignes, lignes);
  assert.equal(plafonnerLignes(lignes, NaN).lignes, lignes);
});

test("plafonnerLignes : les SCU restent entiers, la place libre est tronquée", () => {
  const r = plafonnerLignes([L("A", 20)], 6.9);
  assert.deepEqual(r.lignes.map((l) => l.units), [6]);
  assert.deepEqual(r.laisses, [{ name: "A", units: 14 }]);
});
