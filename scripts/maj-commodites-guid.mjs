// Régénère `data/commodites-guid.json` : la table qui traduit le `resourceGUID` du journal de jeu
// en nom de commodité (#100, ADR-009 décision 4).
//
// Lancer à la main — `node scripts/maj-commodites-guid.mjs` — et commiter le résultat dans son
// propre commit `chore(data): …`, comme l'amorce UEX. Ce script n'est PAS appelé par la CI : la
// table décrit les données du JEU, pas le marché, et elle ne bouge qu'aux patchs.
//
// ── POURQUOI UNE TABLE, ET POURQUOI CELLE-LÀ ──────────────────────────────────────────────────
// Le journal désigne une commodité par un GUID et rien n'y associe jamais un nom : sur les journaux
// d'essai, ZÉRO ligne porte à la fois un GUID et un type de ressource. Deux méthodes maison ont été
// essayées et ont ÉCHOUÉ, elles sont consignées dans l'ADR-009 pour qu'on ne les retente pas —
// l'intersection des offres par comptoir (4 sur 24, dont trois GUID tombant tous sur la même
// commodité, ce qui est impossible) et le croisement des prix contre UEX (3 sur 21).
//
// `scunpacked-data` extrait les fichiers du jeu et publie 206 entrées `UUID` -> `Key`.
// Re-mesuré le 2026-08-24 sur 158 journaux : 24 GUID distincts observés, **24 sur 24 résolus**.
import { writeFile } from "node:fs/promises";

const SOURCE = "https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/resources/commodities.json";
const SORTIE = new URL("../data/commodites-guid.json", import.meta.url);

const res = await fetch(SOURCE, { headers: { "User-Agent": "best-hauling/1.0 (github pages trade tool)" } });
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const brut = await res.json();
if (!Array.isArray(brut) || !brut.length) throw new Error("scunpacked : réponse inattendue");

// On ne garde que le couple utile. Le reste du fichier pèse 240 ko pour des champs dont aucun ne
// sert ici — descriptions à `<= PLACEHOLDER =>`, géométries de conteneurs, versions raffinées.
const table = {};
for (const e of brut) {
  const uuid = String(e.UUID || "").toLowerCase();
  const key = String(e.Key || "");
  if (!/^[0-9a-f-]{36}$/.test(uuid) || !key) continue;
  table[uuid] = key;
}

const n = Object.keys(table).length;
// Un garde-fou de volumétrie, comme MIN_TERMINALS pour le marché : une source tierce qui rend
// soudain trois entrées ne doit pas écraser la table en silence.
if (n < 150) throw new Error(`Volumétrie anormale : ${n} entrées (attendu ~206) — publication annulée`);

await writeFile(SORTIE, JSON.stringify(table, null, 0) + "\n");
console.log(`[guid] ${n} entrées écrites dans data/commodites-guid.json`);
