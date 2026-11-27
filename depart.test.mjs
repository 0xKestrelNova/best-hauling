// LE DÉPART D'UNE ESCALE : ce que le message dit, avant et après le clic (#212).
// Lancer : `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { texteApercuDepart, texteDepart } from "./format.ts";

const V = [{ name: "WiDoW", units: 96 }, { name: "Gold", units: 12 }];
// `fmt` écrit les milliers à la française, avec une espace insécable étroite : on compare sans elles.
const plat = (s) => s.replace(/[  ]/g, " ");

test("texteDepart : la vente, son montant signé", () => {
  assert.equal(plat(texteDepart({ quitte: "B", ventes: V, profit: 256416, sautees: [] })),
    "✓ Vendu en quittant B : 96 WiDoW, 12 Gold — +256 416 aUEC");
});

test("texteDepart : une vente à perte garde son signe", () => {
  assert.equal(plat(texteDepart({ quitte: "B", ventes: [V[1]], profit: -1500, sautees: [] })),
    "✓ Vendu en quittant B : 12 Gold — -1 500 aUEC");
});

test("texteDepart : une escale sautée est dite, et rien n'y est vendu", () => {
  assert.equal(texteDepart({ quitte: "A", ventes: [], profit: 0, sautees: ["B"] }),
    "B sautée : rien n'y a été vendu, le fret reste à bord");
});

test("texteDepart : plusieurs escales sautées, au pluriel", () => {
  assert.equal(texteDepart({ quitte: "A", ventes: [], profit: 0, sautees: ["B", "C", "D"] }),
    "B, C et D sautées : rien n'y a été vendu, le fret reste à bord");
});

test("texteDepart : vente ET escales sautées dans le même message", () => {
  assert.equal(plat(texteDepart({ quitte: "A", ventes: [V[1]], profit: 300, sautees: ["B"] })),
    "✓ Vendu en quittant A : 12 Gold — +300 aUEC · B sautée : rien n'y a été vendu");
});

test("texteDepart : ni vente ni saut, aucun message", () => {
  assert.equal(texteDepart({ quitte: "A", ventes: [], profit: 0, sautees: [] }), "");
});

test("texteApercuDepart : au futur, et au prix UEX", () => {
  assert.equal(plat(texteApercuDepart({ quitte: "B", ventes: V, profit: 256416 })),
    "Repartir de B vendra : 96 WiDoW, 12 Gold — +256 416 aUEC au prix UEX");
});
