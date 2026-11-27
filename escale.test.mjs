// L'ESCALE : ce que le comptoir a refusé, et pour combien de temps encore (#209).
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { refuseHere, refusRestant, sellAllAt, DUREE_VOL } from "./logic.ts";
import { echeanceTexte } from "./format.ts";

const LOTS = [
  { name: "Agricium", units: 30, paid: 100, from: "A" },
  { name: "Agricium", units: 12, paid: 140, from: "B" },
  { name: "Gold", units: 5, paid: 900, from: "A" },
];
const MARCHE = {
  terminals: [{ name: "GrimHEX", system: "Stanton" }],
  commodities: [
    { name: "Agricium", buys: [], sells: [[0, 300, null, 0]] },
    { name: "Gold", buys: [], sells: [[0, 1200, null, 0]] },
  ],
};

test("refusRestant : rien de refusé ici rend 0", () => {
  assert.equal(refusRestant(LOTS, "Agricium", "GrimHEX", 10_000), 0);
});

test("refusRestant : un refus posé il y a 10 min laisse DUREE_VOL - 600 s", () => {
  const h = refuseHere(LOTS, "Agricium", "GrimHEX", 10_000);
  assert.equal(refusRestant(h, "Agricium", "GrimHEX", 10_600), DUREE_VOL - 600);
});

test("refusRestant : le refus ne vaut que pour sa commodité et sa station", () => {
  const h = refuseHere(LOTS, "Agricium", "GrimHEX", 10_000);
  assert.equal(refusRestant(h, "Gold", "GrimHEX", 10_600), 0);
  assert.equal(refusRestant(h, "Agricium", "Area18", 10_600), 0);
});

test("refusRestant : passé l'échéance, il n'en reste rien", () => {
  const h = refuseHere(LOTS, "Agricium", "GrimHEX", 10_000);
  assert.equal(refusRestant(h, "Agricium", "GrimHEX", 10_000 + DUREE_VOL + 1), 0);
});

test("refuseHere sur un refus TOTAL : le départ ne vend plus rien de la commodité (#209)", () => {
  // Le geste « rien repris » pose le marqueur sur TOUS les lots, sans en vendre aucun. Le départ
  // vend le reste de la soute (l'or), et pas un SCU d'Agricium.
  const h = refuseHere(LOTS, "Agricium", "GrimHEX", 10_000);
  const r = sellAllAt(h, MARCHE, 0, null, 10_600);
  assert.deepEqual(r.ventes.map((v) => [v.name, v.units]), [["Gold", 5]]);
  assert.equal(r.hold.filter((l) => l.name === "Agricium").reduce((s, l) => s + l.units, 0), 42);
});

test("echeanceTexte : minutes arrondies au-dessus, heures et minutes au-delà", () => {
  assert.equal(echeanceTexte(0), "—");
  assert.equal(echeanceTexte(-5), "—");
  assert.equal(echeanceTexte(59), "1 min");   // il en reste : jamais « 0 min »
  assert.equal(echeanceTexte(601), "11 min");
  assert.equal(echeanceTexte(3600), "1 h");
  assert.equal(echeanceTexte(DUREE_VOL - 600), "2 h 50");
  assert.equal(echeanceTexte(3600 + 5 * 60), "1 h 05");
});
