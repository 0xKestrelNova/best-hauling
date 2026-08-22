// Vocabulaire de types du domaine (refonte v2, ADR-008).
//
// Ces types ne sont pas inventés : ils ont été relevés sur les USAGES RÉELS — logic.ts, les 425
// tests de logic.test.mjs, app.js — et sur les DONNÉES réelles de data/*.json, jamais sur ce qu'on
// imagine que la donnée devrait être.
//
// Deux règles de lecture, qui expliquent la plupart des choix ci-dessous :
//
//   `?` (facultatif) ne veut PAS dire « rare ». Il veut dire : un instantané data/ DÉJÀ PUBLIÉ a
//   pu ne pas porter ce champ. Le service worker sert les données en « réseau d'abord, cache en
//   repli » (sw.js), donc une coquille antérieure peut revenir à tout moment — le critère est donc
//   l'historique du dépôt, pas le contenu du fichier d'aujourd'hui.
//
//   `| null` n'est PAS `?`. Dans ce domaine, `null` porte un SENS : « UEX ne publie pas cette
//   capacité » — ce qui n'est ni zéro ni l'infini. Les confondre inverse la lecture : un 0 CONNU
//   dit « saturé, ne prend plus rien », un `null` dit « on ne sait pas ».
//
// Fichier séparé de logic.ts à dessein : app.js le rejoindra en TypeScript, et le vocabulaire doit
// pouvoir être importé sans traîner les 2 584 lignes de calcul.


// ==============================================================================================
// Trajets, boucles, filtres et fraîcheur
// ==============================================================================================

/** Les contraintes de CHARGEMENT lues par `computeUnits`. Les cinq champs voyagent ensemble :
 *  `readFilters()` (app.js:434) les produit d'un bloc, et `F()` (logic.test.mjs:219) aussi. */
export type FiltresVolume = {
  cargo: number;
  budget: number;
  capStock: boolean;
  useCargo: boolean;
  useBudget: boolean;
};

/** Les filtres de la VUE (barre du haut), lus par `routePasses` / `loopPasses`.
 *  Tous OPTIONNELS : chaque lecture est un test de véracité (`if (f.maxAge)`), et les appelants
 *  qui ne filtrent pas — routeMetrics via logic.test.mjs:4419 — n'en portent aucun. */
export type FiltresListe = {
  sameOnly?: boolean;
  noOutpost?: boolean;
  legalOnly?: boolean;
  /** "" = pas de filtre système (la vue « En route » le neutralise, logic.ts:1386). */
  sysFilter?: string;
  /** en JOURS ; 0 = filtre inactif. */
  maxAge?: number;
  /** sous-chaîne DÉJÀ en minuscules (app.js:446 `.trim().toLowerCase()`). */
  q?: string;
};

/** L'objet de filtres UNIQUE : celui que `readFilters()` (app.js:434-453) fabrique et que TOUTES les
 *  vues font circuler tel quel, parfois dérivé d'un seul champ par recopie — `{ ...f, useBudget: false }`
 *  (logic.ts:1173), `{ ...f, sysFilter: "" }` (app.js:1282), `{ ...f, cargo: libre }` (app.js:1234),
 *  `{ ...readFilters(), board: commBoard }` (app.js:3577).
 *  C'est POUR ces recopies qu'il n'y a qu'un type et pas deux jeux séparés : TypeScript contrôle les
 *  propriétés écrites EN CLAIR dans un littéral, même à côté d'un spread (mesuré). Un `Filtres`
 *  amputé refuserait `useBudget: false` en logic.ts:1173 — du code que 475 tests prouvent juste.
 *
 *  TOUT est optionnel, et ce n'est pas du laxisme : quatre fonctions déclarent `f = {}` en défaut
 *  (commoditySummaries:1198, commodityPoints:1232, offloadPlan:1971, tourneeEcoulement:2096) et les
 *  tests passent des sous-ensembles nus — `pairEligible({}, …)` (logic.test.mjs:3389),
 *  `{ sameOnly: true }` (:1162), `{ maxAge: 3 }` (:1168), `fEcouler()` à 5 champs (:2180). Chaque
 *  champ n'est d'ailleurs lu qu'après un test de vérité (logic.ts:102-110, 115-123, 131-139,
 *  864-886, 1066-1071, 1995-1997) : « absent » et « faux » y disent la même chose.
 *
 *  Les trois familles ci-dessous ne sont PAS trois types. logic.ts:99 et :128 les décrivent
 *  séparément parce que chaque fonction n'en lit qu'une — mais l'objet, lui, est un seul, et le
 *  découper forcerait chaque recopie à choisir une moitié qu'elle ne contrôle pas. */
export type Filtres = {
  // — VOLUME : ce qui borne le remplissage de la soute (computeUnits, logic.ts:128-139).
  //   `useCargo`/`useBudget` sont les INTERRUPTEURS : éteints, la contrainte vaut Infinity, pas 0.
  cargo?: number;              // SCU
  budget?: number;             // aUEC
  capStock?: boolean;          // plafonner au stock publié / à la demande publiée
  useCargo?: boolean;
  useBudget?: boolean;

  // — LISTE : ce qui écarte des lignes (routePasses:101, loopPasses:113, pairEligible:826).
  sameOnly?: boolean;
  noOutpost?: boolean;
  legalOnly?: boolean;
  sysFilter?: string;          // "" = pas de filtre système, et non « le système nommé "" »
  maxAge?: number;             // âge du relevé en JOURS (7 / 3 / 1 ; 0 = inactif — index.html:165-170)
  q?: string;                  // recherche, DÉJÀ minusculée par readFilters (app.js:446)

  // — VUE : réglages qu'aucune fonction de logic.ts ne lit, mais qui voyagent dans le même objet.
  //   Ils sont déclarés ici pour que `readFilters()` puisse un jour s'annoter `: Filtres` : son
  //   littéral les écrit en clair, et un type qui les ignore le rejetterait (mesuré).
  multi?: boolean;             // app.js s'en sert pour CHOISIR la fonction à appeler, pas pour filtrer
  multiAll?: boolean;
  autoload?: boolean;

  // `board`, lui, EST lu (logic.ts:1199) alors qu'il ne vient PAS de readFilters : app.js:3577 le
  //   greffe après coup. Deux valeurs et deux seulement, garanties par le garde d'app.js:3567.
  board?: "market" | "loot";
};

/** Ce qu'UN terminal facture. `k = 0` = ne facture rien, mais le `maxBox` SURVIT : c'est encore
 *  lui qui décide de la taille des caisses (logic.ts:474-482).
 *  `maxBox` optionnel : un instantané de market.json antérieur au build qui l'ajoute n'en a pas. */
export type PointFrais = { maxBox?: number; k: number };

/** Le contexte de frais d'UN chargement : on charge au terminal d'ACHAT, on décharge au terminal
 *  de VENTE, chacun au tarif de SA station (`haulFee`, logic.ts:491-496).
 *
 *  Les deux clés sont TOUJOURS ÉCRITES ; c'est leur VALEUR qui peut être `null`. Les sept sites de
 *  construction posent l'objet complet — logic.ts:800, :899, :1129, :2022, :513-516, app.js:265
 *  et :971 — et `autoloadPoint` (:479) rend `null` dès que le terminal manque. Un côté `null` dit
 *  donc « terminal inconnu », jamais « gratuit » : un terminal connu qui ne facture rien garde son
 *  point avec `k: 0` (:481), précisément pour CONSERVER son `maxBox` — c'est encore lui qui décide
 *  de la taille des caisses, même quand le joueur les empile à la main.
 *
 *  L'objet ENTIER `null` est une TOUTE autre chose : l'interrupteur d'autoload éteint, le chemin
 *  par défaut de tout le moteur. Ce `null`-là appartient au PARAMÈTRE, pas au type —
 *  `haulFee(scu, pair: PaireFrais | null)`, `manifestTotals(lines, autoload: PaireFrais | null)`,
 *  `routeMetrics(m, f, autoload: PaireFrais | null)`, `trip.fee: PaireFrais | null`, et
 *  `leg.fee?: PaireFrais | null` sur la jambe de chaîne (une fixture historique omet carrément la
 *  clé : logic.test.mjs:4138). Le faire entrer dans le type dispenserait chaque appelant de dire
 *  lequel des deux `null` il veut, et c'est exactement la distinction qui porte l'interrupteur.
 *
 *  À NE PAS confondre avec l'`autoload` de `loopMetrics` (:182-189) : une boucle n'a pas un
 *  terminal d'achat et un de vente, elle a deux EXTRÉMITÉS qui sont tour à tour l'un et l'autre.
 *  Sa paire est `{ a, b }`, et elle se RETOURNE entre l'aller et le retour (les caisses se font au
 *  départ de chaque jambe). Même famille, autre forme — ce n'est pas une PaireFrais. */
export type PaireFrais = { buy: PointFrais | null; sell: PointFrais | null };

/** Les points de frais des deux STATIONS d'une boucle. Une boucle n'a pas un terminal d'achat et
 *  un de vente : elle a deux extrémités qui sont tour à tour l'un et l'autre (logic.ts:177-181). */
export type ExtremitesFrais = { a: PointFrais | null; b: PointFrais | null };

/** Une extrémité de route telle que la sert data/routes.json. `stock` n'existe QUE côté achat,
 *  `demand` QUE côté vente — d'où deux champs optionnels plutôt qu'un type par côté.
 *  `demand: null` = capacité inconnue chez UEX (1 572 relevés sur data/market.json), PAS zéro. */
export type PointRoute = {
  terminal: string;
  system: string;
  planet: string;
  price: number;
  outpost: boolean;
  /** secondes epoch ; 0 = date inconnue. */
  updated: number;
  status: number;
  stock?: number;
  demand?: number | null;
};

// ---------- Vue « Trajets » : une route d'arbitrage à UNE commodité ----------
/** Extrémité d'ACHAT d'une route : un terminal localisé, et ce qu'UEX y a relevé.
 *  `stock` n'est JAMAIS null, et ce n'est pas une facilité de typage : les 494 points d'achat de
 *  l'instantané publient tous le leur (0 null sur 494, mesuré sur data/market.json), quand 1 572
 *  des 1 879 points de vente taisent leur capacité. C'est cette asymétrie que `computeUnits`
 *  encode en plafonnant par le stock SANS garde (logic.ts:136) et par la demande derrière un
 *  `!= null` (logic.ts:139). Écrire `stock: number | null` effacerait la seule distinction sur
 *  laquelle repose tout le calcul de volume — et le dépôt, lui, la tient pour son fait central.
 *  `planet` vaut "" quand le terminal n'orbite rien (18 des 316 achats) : dans ce dépôt l'absence
 *  s'écrit chaîne vide, jamais `undefined`. */
export type PointAchat = {
  terminal: string; system: string; planet: string; outpost: boolean;
  price: number; stock: number; updated: number; status: number;
};

/** Une ligne de data/routes.json (316 entrées) — ET la sortie de `dealFrom` (logic.ts:763-771).
 *  UN seul type pour les deux, parce que c'est un invariant du dépôt et non une commodité :
 *  `routePasses` (l.101), `legFromRoute` (l.1377), `routeRowHTML` (app.js:576) et `evaluate`
 *  (app.js:387) reçoivent indifféremment une route du fichier (vue « Trajets », app.js:469) ou une
 *  route fabriquée à la volée (vue « En route », app.js:1287) — le même tableau les rend déjà.
 *  Rien n'est optionnel : le générateur écrit les onze clés sans condition
 *  (scripts/build-data.mjs:204-216), et `dealFrom` aussi.
 *  `distance: null` n'est pas une précaution — 138 des 316 routes n'ont AUCUNE distance connue,
 *  l'API UEX ne répondant pas pour certaines paires d'orbites (build-data.mjs:410-423, qui rend
 *  `null` sur échec). C'est POURQUOI `tripMinutes` écrit `distance || 0` (l.8). `dealFrom`, lui,
 *  pose 0 : hors routes.json la distance exacte n'existe pas, et l'estimation l'assume.
 *  `kind` reste `string` : 20 catégories dans l'instantané, UEX en ajoute quand il veut — une
 *  union figerait ici une liste que personne ne maintient.
 *  `refBuy`/`refSell` = prix de référence UEX (0 quand inconnu), toujours écrits ; seul
 *  `suspectTag` les lit, derrière un `> 0` (app.js:156). */
export type Route = {
  commodity: string; kind: string; illegal: boolean;
  buy: PointAchat; sell: PointVente;
  refBuy: number; refSell: number;
  margin: number; roi: number; same_system: boolean;
  distance: number | null;
};

/** Le SOUS-ENSEMBLE que `routePasses` lit vraiment. Volontairement structurel et minimal :
 *  `Route` lui est assignable, un deal de `dealFrom` aussi, et les fixtures de test partielles
 *  (logic.test.mjs:145-151) le restent le jour où les tests seront typés. */
export type RouteFiltrable = {
  commodity: string;
  illegal: boolean;
  same_system: boolean;
  buy: { system: string; outpost: boolean; updated: number };
  sell: { outpost: boolean; updated: number };
};

/** Une station d'une boucle A⇄B, telle que la sert data/loops.json. */
export type ExtremiteBoucle = { terminal: string; system: string; planet: string; outpost: boolean };

/** Une jambe de boucle (aller ou retour) telle que la sert data/loops.json. */
export type SegmentBoucle = {
  commodity: string;
  kind: string;
  illegal: boolean;
  buyPrice: number;
  sellPrice: number;
  margin: number;
  stock: number;
  /** null = capacité inconnue chez UEX. */
  demand: number | null;
  updated: number;
};

/** Une ligne de data/loops.json (160 entrées) : le couple de terminaux qui se rentabilise dans les
 *  DEUX sens, pour ne pas repartir à vide. Produite uniquement par le générateur — logic.ts n'en
 *  fabrique aucune, il ne fait que les filtrer (`loopPasses` l.114) et en tirer des jambes
 *  (`legsFromLoop` l.1419).
 *  `distance` est ici un `number` NU, contrairement à celle d'une `Route` : le générateur l'écrit
 *  `(d1 || 0) + (d2 || 0)` (build-data.mjs:472), si bien qu'un aller-retour dont l'API ignore les
 *  distances vaut 0 et jamais null. 160/160 sont des nombres dans l'instantané. Ne pas aligner les
 *  deux « par symétrie » : ce sont deux calculs différents, et c'est le second qui absorbe l'échec.
 *  `loopMargin` = out.margin + back.margin, toujours écrit, et c'est une colonne triable de la vue
 *  (app.js:672, `bySort`) — pas un extra dont on pourrait se passer. */
export type Boucle = {
  a: ExtremiteBoucle; b: ExtremiteBoucle;
  out: SegmentBoucle; back: SegmentBoucle;
  loopMargin: number; distance: number;
};

/** Le sous-ensemble que `loopPasses` lit vraiment ; `Boucle` lui est assignable. */
export type BoucleFiltrable = {
  a: { system: string; outpost: boolean };
  b: { system: string; outpost: boolean };
  out: { illegal: boolean; commodity: string; updated: number };
  back: { illegal: boolean; commodity: string; updated: number };
};

/** L'entrée de `routeMetrics` : une route dont les prix et volumes sont DÉJÀ résolus
 *  (corrections locales appliquées en amont par `evaluate`, app.js:389).
 *  `demandKnown` optionnel : la demande n'est « connue » que si l'utilisateur l'a corrigée. */
export type RouteResolue = {
  buyPrice: number;
  buyStock: number;
  sellDemand: number | null;
  margin: number;
  distance: number | null;
  sameSystem: boolean;
  buyUpdated: number;
  sellUpdated: number;
  demandKnown?: boolean;
};

/** Ce que rend `routeMetrics`. `null` = NON BORNÉ (aucune contrainte de volume), jamais « zéro ». */
export type MetriquesRoute = {
  age: number | null;
  partVolume: number;
  units: number | null;
  investment: number | null;
  profit: number | null;
  minutes: number;
  profitHour: number | null;
  fiabilite: number;
  fees: number;
};

/** Une jambe de boucle prête au calcul (`out` / `back` de `loopMetrics`).
 *  Minimal à dessein : `effLeg` (app.js:615-617) rend un objet PLUS large, et les fixtures
 *  logic.test.mjs:878-879 un objet exactement de cette forme. */
export type SegmentResolu = {
  buyPrice: number;
  stock: number;
  demand: number | null;
  margin: number;
  updated: number;
  demandKnown?: boolean;
};

/** Ce que rend `loopMetrics`. `investment` = le MAX des deux jambes, pas leur somme :
 *  le capital d'une jambe est libéré avant que l'autre ne le mobilise (logic.ts:207). */
export type MetriquesBoucle = {
  loopMargin: number;
  age: number | null;
  partVolume: number;
  unitsOut: number | null;
  unitsBack: number | null;
  units: number | null;
  investment: number | null;
  profit: number | null;
  minutes: number;
  profitHour: number | null;
  fiabilite: number;
  fees: number;
};

/** Marge par SCU et ROI en %, frais d'autoload déduits. Même paire de noms que `dealFrom`
 *  (logic.ts:767) : la colonne garde sa définition d'un mode à l'autre. */
export type MargeNette = { margin: number; roi: number };


// ==============================================================================================
// Manifeste, soute, caisses et frais d'autoload
// ==============================================================================================

/** Une entrée de `market.terminals` (data/market.json), telle que `buildMarket` la publie —
 *  scripts/build-data.mjs:265-269. 114 entrées dans l'instantané courant.
 *  L'INDEX dans ce tableau est la seule clé fiable : `code` n'est PAS unique (PYROG désigne les
 *  deux Pyro Gateway), d'où les tuples de marché qui référencent une position, jamais un nom.
 *
 *  REQUIS vs OPTIONNEL ne se lit pas sur l'instantané — les 9 champs y sont présents à 114/114 —
 *  mais sur l'HISTOIRE du fichier : le service worker sert data/*.json en « réseau d'abord, cache
 *  en repli » (sw.js), donc une coquille ANTÉRIEURE peut revenir à tout moment. Sont donc `?`
 *  exactement les champs qu'un instantané déjà publié a pu ne pas porter :
 *    - `autoload`/`maxBox`, ajoutés le 2026-08-11 (36d5833) — logic.ts:477-479 le dit déjà en
 *      toutes lettres, et autoloadPoint:481 les lit défensivement ;
 *    - `code`/`shot`/`shotBy`, ajoutés le 2026-08-13 (b2ddf9a), soit deux jours : le cas est tout
 *      sauf théorique.
 *  `name`/`system`/`planet`/`outpost` datent de la création du fichier (063a59a, 2026-07-13) :
 *  aucun instantané publié n'a jamais existé sans eux — ils restent REQUIS. */
export type Terminal = {
  name: string;
  /** Système stellaire. Le builder replie sur "?" quand UEX se tait : jamais vide, jamais absent. */
  system: string;
  /** "" pour 12 des 114 terminaux (7 portes de saut, 4 PSS, Levski). C'est une SENTINELLE, pas une
   *  absence — `zoneDe` (logic.ts:1335) la traduit en « Espace profond ». Le passer en `?` mentirait
   *  sur la donnée ET ferait remonter un `string | undefined` dans `dealFrom` (logic.ts:765-766) et
   *  `commodityPoints` (logic.ts:1241), qui le recopient tel quel dans un champ `planet: string`. */
  planet: string;
  /** Avant-poste de surface = élévateur de fret peu fiable ; c'est ce que filtre `noOutpost`. */
  outpost: boolean;
  /** Le terminal (dé)charge tout seul — donc il FACTURE. Absent d'un instantané antérieur au
   *  2026-08-11 : `autoloadPoint` retombe alors sur k = 0, aucun frais, pas un crash. */
  autoload?: boolean;
  /** Plus grosse caisse acceptée (16, 24 ou 32 dans l'instantané) : c'est elle qui décide en combien
   *  de caisses la cargaison se découpe, donc combien de forfaits l'autoload facture. `undefined`
   *  traverse volontairement `autoloadPoint` — logic.test.mjs:3444 EXIGE `{ maxBox: undefined, k: 0 }` —
   *  et `scuBoxes` retombe sur la grille complète. */
  maxBox?: number;
  /** Code court UEX (ARCL1, LEVSKI…). Jamais une clé : ni index, ni Map, ni déduplication.
   *  Lu en `t.code || ""` (logic.ts:1353, app.js:3335). */
  code?: string;
  /** Photo du terminal soumise par un joueur, URL UEX recopiée VERBATIM (deux hôtes CDN, deux
   *  formes d'URL). "" pour 17 des 114. */
  shot?: string;
  /** Auteur de la photo, INDÉPENDANT de `shot` : 97 terminaux ont une photo mais 89 seulement un
   *  crédit — d'où le `t.shot && t.shotBy` d'app.js:3338, qui ne signe que ce qui est signé. */
  shotBy?: string;
};

/** Un point de marché de data/market.json : le tuple compact écrit par `buildMarket`
 *  (scripts/build-data.mjs:283-284) et déjà décrit en logic.ts:752 comme
 *  « [idxTerminal, prix, volume, updated, statut] ».
 *  Mesuré : 2 373 tuples, TOUS de longueur 5 — d'où un tuple nommé et non `number[]`, pour que
 *  `p[5]` soit une erreur et que les libellés s'affichent au survol.
 *  Le premier élément est un INDEX dans `market.terminals`, jamais un nom : le nommer `terminal`
 *  induirait précisément l'erreur que `market.terminals[p[0]]` répare partout. */
export type PointMarche = [
  idxTerminal: number,
  /** aUEC par SCU. Entier et > 0 sur les 2 373 points (minimum relevé : 115). */
  prix: number,
  /** À l'ACHAT : le stock disponible — 0 = terminal vide, et `computeUnits` plafonne alors à 0.
   *  À la VENTE : la capacité RESTANTE, et `null` = capacité INCONNUE, ce qui n'est ni zéro ni
   *  l'infini. 1 572 des 1 879 points de vente (84 %) sont dans ce cas, contre 0 des 494 points
   *  d'achat : c'est ce déséquilibre — et lui seul — qui justifie `certitudeVolume` (logic.ts:38-47)
   *  et les deux chiffres d'`offloadPlan` (absorbe / garanti). Confondre `null` et `0` inverse le
   *  sens : un 0 CONNU dit « saturé, ne prend plus rien ». */
  volume: number | null,
  /** Date du relevé UEX, epoch en SECONDES (l'instantané court du 2026-07-16 au 2026-08-13).
   *  C'est ce que le domaine appelle ensuite `buyUpdated`/`sellUpdated`, et ce que `pairAge` date. */
  releve: number,
  /** Statut d'inventaire UEX, 1..7 — et son sens DÉPEND DU CÔTÉ : à la vente 7 = plein donc saturé
   *  (les 13 points de statut 7 ont tous une capacité publiée à 0, et réciproquement — c'est le seul
   *  zéro fiable du jeu de données, et logic.ts:2015 s'en sert pour ça) ; à l'achat 7 = bien
   *  approvisionné, 251 points sur 494. 0 = UEX n'a rien dit, d'où le `b[4] || 0` de logic.ts:1212.
   *  Pas d'union `1|2|…|7` : elle interdirait justement ce 0. */
  statut: number,
];

/** Le MÊME tuple, côté ACHAT, où le volume est un stock TOUJOURS publié : 494 sur 494 dans
 *  l'instantané, et par construction — `numField` rend toujours un nombre
 *  (scripts/build-data.mjs:137) là où `sellDemand` (l.139-142) rend `null` à dessein.
 *  Assignable à `PointMarche` (un `number` entre dans un `number | null`), donc les consommateurs
 *  qui prennent les DEUX côtés ne bougent pas : `prix()` logic.ts:1201, `point()` logic.ts:1237.
 *  Ce qu'il achète : `computeUnits(b[1], b[2], …)` (logic.ts:798) et `stock: b[2]` (dealFrom,
 *  logic.ts:765) cessent de propager un `null` fantôme le jour où `strictNullChecks` passera. */
export type PointAchatMarche = [idxTerminal: number, prix: number, stock: number, releve: number, statut: number];

export type CommoditeIdentite = { name: string; kind: string; illegal: boolean };

/** Une entrée de `market.commodities` (data/market.json), publiée par `buildMarket`
 *  — scripts/build-data.mjs:281-285. 113 entrées dans l'instantané courant.
 *  ATTENTION au sosie : `commodityPoints` (logic.ts:1247) et `commoditySummaries` (l.1219) rendent
 *  des objets qui portent name/code/kind/illegal et même buys/sells, mais dont les buys/sells sont
 *  des OBJETS de localisation, pas ces tuples. Ce ne sont PAS des `Commodite` — les annoter ainsi
 *  serait la faute que cette définition doit empêcher. */
export type Commodite = {
  name: string;
  /** Code officiel UEX (AGRI, LARA…), et jamais une clé : COPP désigne À LA FOIS « Copper »
   *  (échangeable) et « Copper (Ore) » (butin) — `resolveCommodity` (logic.ts:1289-1296) refuse
   *  donc de trancher sur un code ambigu plutôt que d'en désigner une au hasard.
   *  Optionnel : ajouté le lendemain de la création du fichier (59bbd78, 2026-07-14), donc un
   *  instantané servi depuis le cache du service worker peut en être dépourvu — et le code se
   *  défend déjà partout : `c.code || ""` (logic.ts:1219, 1247), `c.code &&` (l.1294). */
  code?: string;
  /** Catégorie UEX normalisée en minuscules, casse et fautes de frappe corrigées, repli "other"
   *  (scripts/build-data.mjs:110-121) : ni vide, ni absente. 25 valeurs distinctes dans
   *  l'instantané — `string` et non une union, UEX en ajoute sans prévenir et une union ferait
   *  échouer le typecheck sur une donnée parfaitement valide. */
  kind: string;
  illegal: boolean;
  /** Où l'ACHETER. VIDE pour 36 des 113 : le butin (minerai raffiné, salvage, drogues de wreck) ne
   *  s'achète nulle part, et c'est justement ce que le mode « Butin » chiffre (logic.ts:1206-1207).
   *  Le tableau, lui, existe toujours : `c.buys.find(...)` n'est gardé nulle part (logic.ts:358). */
  buys: PointAchatMarche[];
  /** Où la VENDRE. Jamais vide : une commodité sans point de vente n'entre pas dans le fichier
   *  (scripts/build-data.mjs:280) — sans vente, il n'y a rien à en dire. */
  sells: PointMarche[];
};

export type Marche = { terminals: Terminal[]; commodities: Commodite[] };

export type Correction = { price?: number; vol?: number; base?: number; ts?: number; pris?: number; saisiPrix?: number };

export type ValeursEffectives = {
  price: number | null; vol: number | null;
  oprice: boolean; ovol: boolean; stale: boolean; staleVol: boolean;
};

export type ResolveurCorrections = (
  commodite: string, terminal: string, cote: "buy" | "sell",
  price: number, vol: number | null, dataUpdated: number,
) => ValeursEffectives;

export type CoteResolu = { price: number; vol: number | null; ovol?: boolean };

export type ItemChargeable = {
  name: string; kind?: string; illegal?: boolean;
  buyPrice: number; stock: number | null; demand: number | null; demandKnown?: boolean;
  sellPrice?: number | null; margin: number; buyUpdated?: number; sellUpdated?: number;
};

export type LigneChargement = ItemChargeable & { units: number; cap: number };

/** UNE ligne de chargement : une commodité, ses deux prix, et ce qu'on en embarque.
 *  TROIS fabriques la produisent, et c'est leur INTERSECTION qui décide de ce qui est requis :
 *    - `manifestLine` (logic.ts:333-351) — carte « En route » et ajouts libres : les 16 champs ;
 *    - `fillCargo` (logic.ts:278) sur les candidates de `manifestsFrom` (:882) et de
 *      `suggestionsFrom` (:851) — le manifeste OPTIMAL : 13 champs, jamais les trois drapeaux ;
 *    - `ligneDuSaut` (logic.ts:547-553) — repli mono d'un saut de chaîne : les 13 mêmes.
 *  D'où la règle : tout est requis SAUF `carry`/`acquired`/`aBord`.
 *
 *  Les trois drapeaux absents valent FALSE, et ce n'est pas un confort d'écriture : les deux
 *  fabriques qui ne les posent pas ne composent que des lignes dont les DEUX côtés existent
 *  (`manifestsFrom` exige un achat, une vente et une marge > 0). Il n'y a rien à baliser. Leurs
 *  lecteurs le savent déjà : `lineHaulFee` (:510) déstructure `line || {}`, `loadHold` (:1768)
 *  teste `!l.aBord`. Les rendre requis casserait `fillCargo` et `ligneDuSaut` ; les mettre en
 *  `| null` mentirait — ici « pas posé » veut dire « non », pas « on ne sait pas ». */
export type LigneManifeste = {
  name: string;
  /** Catégorie UEX (metal, gas, drug…) recopiée de la commodité — porte l'icône (app.js:1121). */
  kind: string;
  illegal: boolean;
  /** Prix payé au SCU. 0 quand rien n'a été acheté ici (butin) — d'où `acquired`, sans quoi ce 0
   *  se lirait comme un vrai relevé UEX. Avec `paid` (ADR-002), c'est le coût réel du fret
   *  déjà embarqué : 2 170 SCU achetés 1 000 comptaient 1 400 de marge au lieu de 400. */
  buyPrice: number;
  /** Ce qu'on peut encore acheter ici. TROIS valeurs, trois sens qu'il ne faut pas confondre :
   *    un nombre — le stock publié (494 points d'achat sur 494 en publient un, market.json) ;
   *    Infinity  — aucun point d'achat ici : on ne charge rien, on transporte (logic.ts:338) ;
   *    null      — volume inconnu du résolveur. L'instantané UEX n'en produit aucun côté achat,
   *                mais c'est le type de `ValeurResolue.vol` et une fixture l'écrit noir sur
   *                blanc (logic.test.mjs:1893). `fillCargo` le traite déjà comme 0 par
   *                `Math.min` : quand `strictNullChecks` passera, c'est LÀ qu'il faudra trancher. */
  stock: number | null;
  /** null = ce terminal ne reprend PAS la commodité -> ligne `carry`. Ce n'est pas un prix nul :
   *  `lineProfitText` (app.js:340) et le tag « vend ailleurs » (app.js:2399) testent `== null`. */
  sellPrice: number | null;
  /** null = capacité INCONNUE chez UEX (1 572 des 1 879 points de vente), et surtout PAS zéro :
   *  `fillCargo` (:275) ne plafonne que si `demand != null || demandKnown`, `tripMetrics` (:1008)
   *  ne compte les SCU « connus » que si `demand != null`. Un 0 ici dit saturé, donc exclut. */
  demand: number | null;
  /** La capacité vient d'une CORRECTION locale (`ovol`) et non d'UEX : elle plafonne même à 0 —
   *  l'utilisateur a vu le comptoir de ses yeux. C'est le seul cas où `demand: 0` fait foi. */
  demandKnown: boolean;
  /** `sellPrice − buyPrice`, ou 0 si la ligne ne se vend pas ici. Marge de MARCHÉ, jamais nette :
   *  la marge nette vit dans `lineNet`, et une marge nette figée survivrait à l'interrupteur. */
  margin: number;
  /** Dates UEX des deux relevés ; 0 = inconnue (`pairAge` rend alors null). Les trois fabriques
   *  les normalisent (`|| 0`) : jamais absentes, jamais nulles. */
  buyUpdated: number;
  sellUpdated: number;
  /** SCU réellement embarqués. Ajustable à la main dans l'interface, y compris AU-DELÀ de `cap`
   *  (vol de fret, relevé périmé) : ne jamais supposer `units <= cap`. */
  units: number;
  /** Plafond suggéré (stock ∩ demande, via `tighterVolume`). PEUT VALOIR Infinity — ni achat ni
   *  demande connus (logic.test.mjs:3357) — d'où le garde `isFinite(l.cap)` d'app.js:2188. */
  cap: number;
  /** Chargée ici, vendue AILLEURS : rien à décharger à l'arrivée, donc seul le chargement est
   *  facturé (`lineHaulFee`:515) et la colonne profit affiche « — ». */
  carry?: boolean;
  /** Rien n'a été chargé ici — butin, minage, salvage, ou fret embarqué ailleurs : l'autoload du
   *  terminal de départ ne l'a jamais manipulée (`lineHaulFee`:514). */
  acquired?: boolean;
  /** Déjà en soute ET coût connu (`paid`, ADR-002). Sous-cas d'`acquired` : ce qui les sépare est
   *  le COÛT, pas la manutention. `loadHold` (:1768) ne recharge pas un lot `aBord`.
   *  PIÈGE : sur le TRAJET, `aBord` est un NOMBRE de SCU (app.js:989, :1250). Même nom, autre
   *  champ, autre type — ne pas réutiliser ce booléen pour typer `Trajet`. */
  aBord?: boolean;
};

// Les lecteurs qui n'en prennent qu'une part n'élargissent PAS ce type — ils annoncent leur propre
// besoin, et c'est ce qui gardera les fixtures à cinq champs valides le jour où les tests seront
// typés : `loadHold` (:1766) veut `{ name; units; buyPrice?; aBord? }[]`, `manifestIntent`
// `{ name; units }[]`, `lineHaulFee`/`lineNet` `{ margin?; carry?; acquired? }`.

export type TotauxManifeste = { profit: number; invest: number; scu: number; fees: number };

export type Caisse = { size: number; count: number };

export type GrilleAutoload = { base: number; perBox: number; perScu: number };

export type BornesK = { min: number; max: number };


// ==============================================================================================
// Chaîne multi-sauts, corrections locales, état partageable
// ==============================================================================================


export type CoteMarche = "buy" | "sell";

export type ChargementDuSaut = { units: number; profit: number; lines: LigneManifeste[]; cargo: number };

/** Une JAMBE du compagnon de voyage : un saut d'un terminal à un autre dans un parcours ORDONNÉ
 *  (`{ legs, current }`, contrat écrit en toutes lettres logic.ts:1369-1374).
 *
 *  HUIT champs, tous OBLIGATOIRES — et cette rigidité est un contrat, pas une préférence. La jambe
 *  est PERSISTÉE telle quelle dans le permalien `j=` sous forme de tuple POSITIONNEL de huit cases
 *  (encodeJourney:2413), que decodeJourney:2432-2436 relit case par case en forçant `String()` et
 *  `Number()`. Un `?` ici, et une case du tuple peut valoir `undefined` -> `JSON.stringify` l'écrit
 *  `null` -> le lien partagé rend une jambe que le rendu ne sait pas peindre. C'est exactement le
 *  TypeError qu'a corrigé le durcissement de `jambeValide` (logic.ts:2430) : le hash vient
 *  potentiellement d'un tiers, la forme est donc une frontière, pas une commodité d'écriture.
 *
 *  `from`/`to` sont des NOMS de terminal, jamais des index ni des libellés « Nom — Système » :
 *  legKey (app.js:2044), journeyConnects:1462 et manifestJourneyState:1489-1494 comparent des noms
 *  seuls. Une seconde règle d'identité (nom + système) ferait diverger deux définitions du même mot.
 *
 *  La jambe « à VIDE » n'est PAS une jambe amputée : app.js:2261 (emptyLeg) et le pont de
 *  removeJourneyStop (app.js:2324) écrivent `commodity: ""` et trois zéros. Le vide se dit par la
 *  valeur neutre — d'où l'absence de `?` ET de `| null` sur les huit champs.
 *
 *  DEUX HOMONYMES, que seul le typage rend visibles :
 *   - l'arc du graphe de chaîne (`ArcChaine`, buildChainAdjacency:1129) : son `to` est un INDEX de
 *     terminal, il n'a pas de `from`, et il porte stock/demande/frais. legsFromChain:1429-1434 le
 *     CONVERTIT en `Jambe` — cette conversion est la preuve que ce sont deux types ;
 *   - le segment de boucle (`SegmentBoucle` de data/loops.json, corrigé par app.js:614-618) : ni
 *     `from` ni `to`, deux extrémités tour à tour achat et vente.
 *
 *  PIÈGE DE SIGNATURE, à ne PAS résoudre en assouplissant ce type : manifestJourneyState:1492
 *  appelle `journeyConnects(journey, [{ from: origin.name }])` avec une jambe réduite à son départ.
 *  Le paramètre de journeyConnects se type donc `readonly Pick<Jambe, "from">[]`, et le `bridge` de
 *  removeJourneyStop:1567 `Jambe | null` (les tests l'omettent : logic.test.mjs:3046, 3061, 3067). */
export type Jambe = {
  /** Nom du terminal de départ. C'est LUI qui porte l'identité de la jambe (legKey, journeyConnects). */
  from: string;
  /** Système du départ : sert à retrouver l'index via stationLabel (app.js:2006) et à écrire le
   *  libellé — jamais à comparer deux jambes. */
  fromSystem: string;
  to: string;
  toSystem: string;
  /** Commodité de TÊTE seulement. Un saut transporte un MANIFESTE (#56) qui n'entre pas dans huit
   *  cases : la vue Voyage recompose le chargement complet au rendu (legManifest, app.js:2004), et
   *  legsFromChain:1432 prend la tête du manifeste — pas le repli mono de l'arc — pour que les deux
   *  vues nomment la même commodité. `""` sur une jambe à vide (logic.test.mjs:3372). */
  commodity: string;
  buyPrice: number;
  sellPrice: number;
  /** Marge de MARCHÉ, toujours BRUTE, jamais nette des frais d'autoload (legFromTrip:1023-1027) :
   *  elle survit dans le permalien à l'extinction de l'interrupteur, et journeyMargin:1749 la cumule
   *  avec des marges brutes venues des trois autres fabriques. Moyenne du chargement quand la jambe
   *  vient d'un manifeste (legFromManifest:1045 injecte `marginGross`). */
  margin: number;
};

/** Une jambe de CHAÎNE une fois chiffrée par `bestChain` : l'arc du graphe, plus ce que ce saut
 *  transporte réellement (logic.ts, `legs: [...p.legs, { ...leg, units, profit, lines }]`).
 *
 *  Elle s'appuie sur `JambeChaine` et NON sur `Jambe` : ce sont deux choses distinctes que deux
 *  zones d'analyse ont nommées pareil. `Jambe` est la jambe du COMPAGNON DE VOYAGE — elle part
 *  d'un terminal nommé (`from: string`) et vit dans un parcours persisté. `JambeChaine` est un ARC
 *  du graphe de la recherche multi-sauts — elle pointe un INDEX de terminal (`to: number`) et
 *  n'existe que le temps d'un calcul. */
export type JambeChiffree = JambeChaine & { units: number; profit: number; lines: LigneManifeste[] };

export type OptionsChaine = { cargo?: number; beam?: number };

/** Le résultat de `bestChain`. `path` porte des INDEX de terminaux, comme tout le graphe de la
 *  chaîne — le premier est le `start` reçu, les suivants sont des `leg.to`. */
export type Chaine = { path: number[]; legs: JambeChiffree[]; profit: number };

export type CommoditeChargeable = { buyPrice: number; stock: number; demand?: number | null; demandKnown?: boolean; margin?: number };

export type RestantManifeste = { cargoLeft: number; budgetLeft: number };

export type StoreCorrections = Record<string, Correction>;

/** Le VERDICT DE FRAÎCHEUR d'une correction locale : ce que rendent `effValue` (logic.ts:242-259) et
 *  `effFromStore` (logic.ts:629-638), et eux seuls. À ne pas confondre avec `ValeurResolue`, qui est
 *  ce que logic.ts EXIGE d'un résolveur : celui-ci est plus riche, l'autre est le minimum.
 *
 *  Les six champs sont TOUJOURS là — les trois points de retour d'effValue les posent tous les six,
 *  et deux tests le verrouillent au champ près par `assert.deepEqual` (logic.test.mjs:265 et :745).
 *  Rien n'est optionnel ici, et c'est le cœur de l'affaire : mis en optionnels, `stale` et `staleVol`
 *  deviendraient `boolean | undefined`, et un lecteur qui écrit `if (v.stale)` lirait `undefined` —
 *  donc « pas périmé » — sur un objet incapable de répondre. C'est précisément le contresens
 *  silencieux contre lequel logic.ts:240-241 impose DEUX drapeaux plutôt qu'un objet.
 *
 *  Les deux péremptions ne sont pas interchangeables :
 *    `stale`    — UEX a republié le point : toute la correction est morte, la clé part du store ;
 *    `staleVol` — le volume a dépassé DUREE_VOL : lui seul meurt, le prix corrigé survit.
 *
 *  `vol: number | null` est MESURÉ, pas prudentiel : 1 572 des 1 879 points de vente de
 *  data/market.json ne publient aucun volume (0 sur 494 côté achat). null = capacité INCONNUE chez
 *  UEX — ni zéro, ni l'infini ; c'est ce que `ovol` sert à démentir quand l'utilisateur a vu le
 *  comptoir de ses yeux.
 *
 *  Limite connue : `relireCorrections` (logic.ts:2544) est le SEUL appelant à passer `price = null,
 *  vol = null` — et il ne lit que `stale`/`staleVol`, jamais le prix. `price: number` reste donc le
 *  contrat du chemin marché ; c'est ce site-là qui prendra une annotation quand `strictNullChecks`
 *  montera d'une marche (l'escalier est décrit dans tsconfig.json). */
export type ValeurEffective = {
  price: number;
  vol: number | null;
  oprice: boolean;    // le prix affiché vient d'une correction locale (pastille ✎, app.js:379)
  ovol: boolean;      // le volume affiché vient d'une correction locale — donc FIABLE : un 0 plafonne
  stale: boolean;
  staleVol: boolean;
};

export type ChampCorrection = "price" | "vol";

export type GroupeCorrections = { terminal: string; corrections: number; actif: boolean };

export type EtatDecode = Record<string, string>;


// ==============================================================================================
// Marché interactif : deals, suggestions, manifestes
// ==============================================================================================

/** Ce qu'un `Resolveur` PROMET à logic.ts, et rien de plus. Le contrat est écrit en toutes lettres
 *  en logic.ts:754-755 : « renvoie au moins { price, vol, ovol } (identité si aucune correction) ».
 *
 *  « Au moins » n'a pas besoin d'optionnels pour se dire en TypeScript — le sous-typage structurel le
 *  dit déjà : `effVals` (app.js:192) rend un `ValeurEffective` à six champs et reste assignable ici
 *  sans qu'on ait à l'annoncer. Trois champs, donc, et pas six :
 *    - c'est ce que rendent les cinq résolveurs RÉELS des tests (logic.test.mjs:917, :2302, :2842,
 *      :3328, :3415) ;
 *    - c'est exactement ce que logic.ts lit sur une valeur résolue — `.price`, `.vol`, `.ovol`, et
 *      jamais rien d'autre (338-341, 372, 382, 849-851, 879-882, 1124-1129, 1201, 1242, 1912,
 *      1986, 2008-2033) ;
 *    - et `manifestLine` reçoit directement des littéraux de cette forme (logic.test.mjs:1563-1564,
 *      :1604-1605, :1947), ce qu'un champ obligatoire de plus ferait échouer.
 *  Y ajouter `stale?`/`staleVol?`/`oprice?` en optionnels serait pire qu'inutile : ça autoriserait
 *  `if (e.stale)` sur une valeur qu'aucun résolveur léger ne renseigne — toujours `undefined`, donc
 *  toujours « frais ». Qui a besoin des drapeaux de péremption tient un `ValeurEffective`, pas ceci.
 *
 *  `vol: number | null` : null = capacité INCONNUE chez UEX (1 572 des 1 879 points de vente de
 *  data/market.json), et surtout pas zéro.
 *  `ovol` n'est pas décoratif : `manifestLine` en fait `demandKnown` (logic.ts:341), et c'est lui
 *  qui autorise un 0 à plafonner le remplissage (computeUnits, logic.ts:139) — une demande corrigée
 *  à la main est CONNUE, là où un `vol` null d'UEX ne l'est pas. */
export type ValeurResolue = { price: number; vol: number | null; ovol: boolean };

/** Le PORT par lequel les corrections locales entrent dans des fonctions pures. logic.ts ne connaît
 *  ni localStorage ni l'objet OVERRIDES : il reçoit cette fonction. L'unique implémentation réelle
 *  est `effVals` (app.js:192), qui délègue à `effFromStore` (logic.ts:629) puis y ajoute ses effets
 *  de bord d'application (persistance, notifications). C'est ce port, et lui seul, qui rend
 *  `logic.ts` testable : les tests y injectent une identité.
 *
 *  `terminal` est le NOM du terminal, jamais son index : tous les sites d'appel passent `t.name`
 *  (logic.ts:362-363, 847-848, 871, 878, 1114, 1123, 1201, 1239, 1911, 1985, 2007), parce que la clé
 *  du store est textuelle (`ovKey`, logic.ts:623) et doit survivre à un réordonnancement des
 *  terminaux au prochain export UEX — un index corrigerait alors le mauvais comptoir.
 *
 *  `vol: number | null` À L'ENTRÉE aussi, pas seulement en sortie : c'est le 3ᵉ élément du tuple de
 *  marché, null sur 1 572 des 1 879 points de vente de data/market.json.
 *  `updated` est la date UEX du point (4ᵉ élément) : c'est l'ANCRE de fraîcheur — c'est en la
 *  comparant à `base` qu'effValue décide qu'une correction est périmée, pas en regardant l'heure.
 *
 *  Le type ne porte PAS `| null`. `resolve` est facultatif à presque tous les appels (`resolve = null`
 *  en logic.ts:1198, 1232, 1971, 2096 ; les tests passent `null`, p. ex. logic.test.mjs:2184), mais
 *  c'est le PARAMÈTRE qui s'annote `Resolveur | null` : rendre le type lui-même nullable
 *  contaminerait jusqu'aux sites qui en exigent un (manifestsFrom, buildChainAdjacency).
 *
 *  Rend un `ValeurResolue` — le minimum — et non un `ValeurEffective` : un résolveur de test rend
 *  trois champs, et exiger les six l'exclurait. Un résolveur plus riche reste assignable.
 *  Les fixtures qui ne déclarent que 5 paramètres (le 6ᵉ leur est inutile) restent assignables aussi.
 *  `side` est écrit ici en clair : si le dépôt adopte un alias `Cote = "buy" | "sell"`, il se
 *  substitue sans rien changer d'autre. */
export type Resolveur = (
  commodity: string,
  terminal: string,
  side: "buy" | "sell",
  price: number,
  vol: number | null,
  updated: number,
) => ValeurResolue;

export type ResolveurFrais = (terminal: Terminal) => PointFrais | null;

/** Une entrée de CATALOGUE côté vente : où l'on peut vendre, à quel prix, avec quelle capacité
 *  restante, et depuis quand le relevé date. Deux producteurs, exactement la même forme :
 *  l'extrémité `sell` d'une route (data/routes.json, et `dealFrom` l.766) et les points de vente
 *  du panneau Commodités (`commodityPoints` l.1240-1243, dont la clé de volume est « demand »).
 *  `demand: null` = capacité INCONNUE chez UEX. Ce n'est ni zéro — un comptoir saturé, lui,
 *  publie 0 et porte le statut 7, la seule équivalence fiable du jeu de données (l.2009-2015) —
 *  ni l'infini. 256 des 316 routes et 1 572 des 1 879 points de vente du marché sont dans ce cas :
 *  c'est le cas MAJORITAIRE, et il commande `computeUnits` (l.137-139), la double colonne
 *  absorbe/garanti d'`offloadPlan` et le « plancher » de la tournée d'écoulement. */
export type PointVente = {
  terminal: string; system: string; planet: string; outpost: boolean;
  price: number; demand: number | null; updated: number; status: number;
};

/** Le DÉBOUCHÉ d'une commodité à un terminal donné : ce comptoir la reprend-il, à quel prix, et
 *  jusqu'où. Rendu par `sellableAt` (l.1905-1913) ; `null` = aucun débouché ici. Le mot est celui
 *  du dépôt, pas une invention : `sansDebouche` (l.2075, l.2104, app.js:2507-2509).
 *  Ce n'est PAS un `PointVente` amputé, c'est une autre question. `PointVente` est une entrée de
 *  catalogue — localisée, datée, triable, faite pour être listée. `Debouche` est la réponse LOCALE
 *  à « puis-je écouler ça ici ? », posée quand on sait déjà où l'on est : d'où trois champs, et
 *  d'où `terminal` conservé alors que l'appelant tient déjà l'index — c'est le NOM qui sert de clé
 *  au refus de vente (`refuseHere`, app.js:1523). Les fondre en une union mentirait sur les deux. */
export type Debouche = { price: number; demand: number | null; terminal: string };

export type CandidatChargement = {
  name: string; kind: string; illegal: boolean;
  buyPrice: number; stock: number | null;
  sellPrice: number | null; demand: number | null; demandKnown: boolean;
  margin: number; buyUpdated: number; sellUpdated: number;
};

// ---------- Vue « Trajets » multi-commodité et vue « En route » : un CHARGEMENT ----------
/** Un chargement multi-commodité d'un terminal vers un autre — ce que `manifestsFrom` construit
 *  (l.967), le seul endroit du dépôt où ces neuf champs sont posés ensemble.
 *  Le « manifeste » de la vue « En route » et le « trajet » de la vue « Trajets multi » sont le
 *  MÊME objet : le commentaire l.1037-1038 le dit en toutes lettres, `legFromManifest` (l.1045) en
 *  dépend, et `manifesteSansOptimal` (app.js:965-972) en fabrique le jumeau exact quand plus aucun
 *  chargement n'est rentable. Deux types diraient qu'ils peuvent diverger : ils ne le peuvent pas.
 *  À NE PAS confondre avec `Route`, la ligne à une commodité de data/routes.json : la vue s'appelle
 *  « Trajets » et montre les deux, mais elles n'ont pas un champ en commun.
 *  Un `Trajet` n'a pas de distance — elle n'existe pas hors routes.json — d'où le
 *  `tripMinutes(0, trip.cross)` de `tripMetrics` (l.995).
 *
 *  Les trois derniers champs ne sont JAMAIS posés par `manifestsFrom` : l'appelant les greffe après
 *  coup. Ils sont déclarés ici parce que logic.ts les LIT, et qu'une propriété non déclarée est une
 *  erreur de compilation même sans `strict` :
 *    `margin` / `marginGross` — versés par `tripMetrics` (app.js:506 fait `{ ...t, ...tripMetrics(t) }`,
 *      `legFromManifest` fait `{ ...man, marginGross }` l.1046), lus par `legFromTrip` l.1033.
 *      La jambe retient la marge BRUTE : elle part dans le permalien `j=`, où une marge nette des
 *      frais d'autoload n'aurait plus de sens l'interrupteur éteint.
 *    `f` — les filtres qui ont produit le chargement, greffés par app.js:1249 et lus par
 *      `suggestionsFrom` l.846 : sans eux la boîte de suggestions proposerait ce que le manifeste
 *      optimal vient d'écarter, exactement le défaut que `pairEligible` a corrigé.
 *  Qui préfère un type distinct pour le trajet greffé (`TrajetAffiche = Trajet & { … }`) peut les
 *  sortir d'ici — mais pas les supprimer : l.846 et l.1033 les lisent. */
export type Trajet = {
  origin: Terminal; originIdx: number; dest: Terminal; destIdx: number;
  cross: boolean;
  lines: LigneManifeste[];
  profit: number;
  fee: PaireFrais | null;
  cargo: number;
  margin?: number; marginGross?: number;
  f?: Filtres;
};

export type MetriquesTrajet = {
  age: number | null; partVolume: number; units: number; investment: number; profit: number;
  margin: number; marginGross: number; roi: number; minutes: number; profitHour: number | null;
  fiabilite: number; fees: number; nLines: number; commodity: string; buyPrice: number; sellPrice: number;
};

/** Un chargement EN COURS, quel que soit le porteur : la carte d'« En route » ou une jambe du
 *  parcours. `suggestionsFrom` (logic.ts) n'en lit que la moitié — `lines`, `destIdx`, `f` — mais
 *  `manifestRemaining` (manifeste-donnees.ts) a besoin de `cargo` pour dire combien il reste, et
 *  `legSuggestCtx` le fabrique complet. Le type porte donc la forme RÉELLE, pas le sous-ensemble
 *  d'un seul lecteur : c'est ce qui permet aux deux porteurs de passer par les mêmes fonctions. */
export type ContexteManifeste = {
  lines: Array<{ name: string }>; originIdx: number; destIdx: number;
  /** Le `system` accompagne le nom parce que `legSuggestCtx` l'a sous la main et que la carte
   *  l'affiche ; `suggestionsFrom` ne lit que le nom. */
  origin: { name: string; system?: string }; dest: { name: string; system?: string }; f: Filtres;
  /** Le plafond de soute retenu. `legSuggestCtx` refuse de fabriquer un contexte sans lui : sans
   *  soute bornée, « SCU libres » n'a aucun sens. */
  cargo: number;
  /** Le contexte de frais de la paire, quand l'autoload est actif. */
  fee?: PaireFrais | null;
};

export type ChiffrageSaut = { units: number; profit: number; lines: LigneManifeste[]; cargo: number };

export type JambeChaine = {
  to: number; commodity: string; kind: string; illegal: boolean;
  margin: number; buyPrice: number; sellPrice: number;
  stock: number | null; demand: number | null; demandKnown: boolean;
  fee: PaireFrais | null; buyUpdated?: number; sellUpdated?: number;
  lines?: LigneManifeste[]; net?: ChiffrageSaut;
};


// ==============================================================================================
// Panneau Commodités, résolution, compagnon de voyage
// ==============================================================================================

export type Cote = "buy" | "sell";

export type Station = { name: string; system: string };

export type BoardCommodites = "market" | "loot";

export type FiltresBoard = Filtres & { board?: BoardCommodites };

export type ResumeCommodite = {
  name: string; code: string; kind: string; illegal: boolean;
  nBuy: number; nSell: number;
  bestBuy: number | null; bestSell: number | null;
  buyStatus: number; sellStatus: number;
  margin: number | null; sellOnly: boolean;
};

type PointCommoditeBase = {
  terminal: string; system: string; planet: string; outpost: boolean;
  price: number; updated: number; status: number;
};
// `stock`/`demand` OPTIONNELS : ils sont posés par clé calculée (`[volKey]`, logic.ts:1242),
// que TypeScript ne sait pas relier à un nom de propriété. Les rendre requis casse le typecheck.
export type PointAchatCommodite = PointCommoditeBase & { stock?: number | null };
export type PointVenteCommodite = PointCommoditeBase & { demand?: number | null };

export type DetailCommodite = {
  name: string; code: string; kind: string; illegal: boolean;
  buys: PointAchatCommodite[]; sells: PointVenteCommodite[];
};

export type CleDeValeur = "bestSell" | "bestBuy" | "margin";
export type ClassableParValeur = {
  name: string; bestSell?: number | null; bestBuy?: number | null; margin?: number | null;
};
export type PalierValeur = "t-hot" | "t-warm" | "t-mid" | "t-low" | "t-none";

export type StationArbre = {
  i: number; name: string; system: string; zone: string;
  code: string; shot: string; outpost: boolean; label: string;
};
export type ZoneArbre = { zone: string; stations: StationArbre[] };
export type NoeudSysteme = { systeme: string; zones: ZoneArbre[] };

export type ArcChaine = {
  to: number; commodity: string; kind?: string; illegal?: boolean;
  margin: number; buyPrice: number; sellPrice: number;
  stock: number; demand: number | null; demandKnown: boolean;
  fee?: unknown; lines?: LigneManifeste[]; net?: unknown; units?: number; profit?: number;
};
export type ChaineChiffree = { path: number[]; legs: ArcChaine[]; profit?: number };

export type Parcours = { legs: Jambe[]; current: number; start?: Station };

export type RetraitArret = Parcours & { removedFrom: number; removedCount: number; insertedCount: number };

export type SuggestionArret = { label: string; terminal: string; system: string; commodity: string; margin: number };

export type IntentionLigne = { name: string; units: number };

export type CompositionManifeste = {
  from: string; fromSystem: string; to: string; toSystem: string; lines?: IntentionLigne[];
};
export type VueManifeste = { from: Station; dest: Station | null; destSystem: string };

export type EtatVoyageManifeste =
  | { etat: "ajouter" }
  | { etat: "deja"; leg: number }
  | { etat: "conflit"; fin: string | null };


// ==============================================================================================
// Jambes, soute, tournée d'écoulement, carte du parcours
// ==============================================================================================

export type TarifTerminal = (terminal: Terminal) => PointFrais | null;

export type IntentionManifeste = { name: string; units: number };

export type Retrait = { removedFrom: number; removedCount: number; insertedCount?: number };

export type Lot = {
  name: string; units: number; paid: number; from: string;
  at?: number;        // horodatage du chargement — ABSENT d'un lot repris d'entrepôt
  leg?: string;       // "<rang>|<from>|<to>" — la CLÉ est supprimée, jamais mise à null
  refuse?: string; refuseAt?: number;
  deposeAt?: number;  // posé par storeFromHold
  avant?: number;     // format ANTÉRIEUR au registre, retiré par migrerChargements
};

export type LotConsomme = { name: string; units: number; paid: number; from: string };

export type Entrepots = Record<string, Lot[]>;

export type GroupeSoute = { name: string; units: number; invest: number; lots: (Lot & { i: number })[]; paidMoyen: number };

export type VenteSoute = { hold: Lot[]; vendu: number; recette: number; cout: number; profit: number; lots: LotConsomme[] };

export type VenteLigne = { name: string; units: number; price: number; recette: number; cout: number; profit: number; lots: LotConsomme[] };

export type VenteEtape = { hold: Lot[]; ventes: VenteLigne[]; recette: number; cout: number; profit: number };

export type Prise = { name: string; terminal: string; ref: number | null; units: number };

export type Chargements = Record<string, Prise[]>;

export type PorteursDeRang = {
  edits?: Record<string, IntentionManifeste[]>;
  pins?: Record<string, boolean>;
  lots?: Lot[];
  chargements?: Chargements;
};

export type Certitude = "connue" | "inconnue" | "partielle";

export type LigneEcoulement = {
  name: string; absorbe: number; garanti: number; reste: number;
  price: number; demand: number | null; connue: boolean;
  profit: number; encaisse: number; sousLePrixPaye: boolean;
};

export type Destination = {
  idx: number; terminal: string; system: string; planet?: string; outpost?: boolean;
  cross: boolean; lignes: LigneEcoulement[];
  scu: number; garanti: number; profit: number; encaisse: number;
  scuReine: number; reine: string | null; aPerte: boolean;
  certitude: Certitude; reste: number;
};

export type OptionsEcoulement = {
  inclureOrigine?: boolean;
  comparer?: (a: Destination, b: Destination) => number;
};

export type OptionsTournee = { maxArrets?: number; premierForce?: number; k?: number };

export type SansDebouche = { name: string; units: number };

export type Tournee = {
  arrets: Destination[]; reste: Lot[]; sansDebouche: SansDebouche[];
  resteScu: number; scu: number; garanti: number; encaisse: number; profit: number;
  sauts: number; certitude: Certitude;
  // Posés SEULEMENT sur l'alternative, après coup (logic.ts:2153-2154) :
  ecart?: number; ecartPct?: number | null;
};

export type Ancre = { au: number; lon: number };

export type Starmap = Record<string, { ancres: Record<string, Ancre> }>;

export type InfoTerminal = (nom: string) => { planet?: string } | null;

export type CorpsCarte = { nom: string; orbite: number; x: number; y: number; occupe?: boolean };

export type SystemeCarte = { nom: string; cx: number; cy: number; r: number; auMax?: number; corps: CorpsCarte[] };

export type ArretCarte = { nom: string; systeme: string; orphelin: boolean; parent?: string; x: number; y: number };

export type JambeCarte = {
  x1: number; y1: number; x2: number; y2: number; cx: number; cy: number;
  saut: boolean; faite: boolean; fleche: { x: number; y: number; angle: number };
};

export type Carte = {
  largeur: number; hauteur: number;
  systemes: SystemeCarte[]; arrets: ArretCarte[]; jambes: JambeCarte[];
  vaisseau: { x: number; y: number; angle: number; arret: number; enVol: boolean };
};

export type Releves = Record<string, number>;

export type EnteteExport = { v: number; type: string; emis: string | null };

export type CorrectionExportee = {
  commodite: string; terminal: string; cote: "achat" | "vente";
  champ: "prix" | "volume"; valeur: number; saisi: string | null; base: string | null;
};

export type ExportCorrections = EnteteExport & { corrections: CorrectionExportee[] };

export type Verdict = "appliquer" | "périmée-uex" | "périmée-âge" | "date-inconnue";

export type CorrectionRelue = CorrectionExportee & { verdict: Verdict };


// ==============================================================================================
// Types nés de la réconciliation (une zone en cachait deux)
// ==============================================================================================

// ==============================================================================================
// Types nés du typecheck : là où une annotation d'agent promettait plus que la fonction ne rend
// ==============================================================================================

/** Ce que `sellableAt` rend vraiment : le prix et la capacité d'UN terminal pour UNE commodité,
 *  vus APRÈS corrections locales. Volontairement plus petit qu'un `PointVente` — la fonction ne
 *  connaît ni le système, ni la planète, ni le statut UEX, et promettre ces champs aurait fait
 *  mentir la signature. `demand: null` garde ici son sens habituel : capacité inconnue, ni zéro
 *  ni infinie. */
export type VenteAuTerminal = { price: number | null; demand: number | null; terminal: string };

/** Un disque de système sur la carte du parcours, pendant sa construction. `auMax` et `corps` se
 *  remplissent en DEUX TEMPS : le disque est d'abord posé (position, rayon), puis les ancres de
 *  starmap.json y ajoutent le rayon orbital maximal et les corps. D'où deux champs qui ne sont pas
 *  optionnels par tolérance, mais parce que l'objet existe réellement sans eux un instant. */
export type DisqueSysteme = {
  nom: string;
  cx: number; cy: number; r: number;
  corps: CorpsCarte[];
  auMax?: number;
};

/**
 * L'estampille que le pipeline écrit dans `data/meta.json` : d'où viennent les données, de quand,
 * et combien il y en a. Lue UNE fois à l'amorçage, jamais relue — c'est ce qui lui vaut de ne pas
 * entrer dans `etat.ts`.
 *
 * `app_version` et `commit` sont FACULTATIFS et c'est délibéré : l'amorce versionnée dans `data/`
 * ne les porte pas tant qu'un build n'est pas passé, et le rail préfère alors ne rien afficher
 * plutôt qu'un « v— ».
 */
export type Meta = {
  generated_at: number;
  source: string;
  source_url: string;
  commodities: number;
  terminals: number;
  routes: number;
  loops?: number;
  systems: string[];
  data_signature: string;
  app_version?: string;
  commit?: string;
};

/**
 * Un nœud de NOTRE arbre, tel que les délégations le manipulent.
 *
 * `Element.closest()` rend `Element | null` dans `lib.dom`, ce qui est exact en général et faux
 * ici : tout ce que cette application rend est du HTML, et chaque délégation lit ensuite un
 * `dataset`. Sans ce type, les 39 `closest(...).dataset` du dépôt demanderaient 39 casts.
 *
 * L'interface se referme sur elle-même — `closest` rend un `Noeud` — pour que la chaîne
 * `e.target.closest(a).closest(b)` reste typée. C'est un rétrécissement LÉGITIME : `Noeud | null`
 * est assignable à `Element | null`, donc rien n'est promis qui ne soit vrai.
 */
export interface Noeud extends HTMLElement {
  closest(selecteurs: string): Noeud | null;
}
