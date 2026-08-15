# ADR-010 : La lecture de comptoir — prospecter un kiosque sans y commercer

**Statut :** Accepté
**Date :** 2026-08-15
**Décideur :** 0xKestrelNova (propriétaire du dépôt)
**Issue :** #101 · **Jalon :** v2.2.0 — Lecture de comptoir · **Dépend de :** ADR-009

## Contexte

L'ADR-009 lit `Game.log` et en tire, exactement et gratuitement, tout ce que le joueur **fait** :
prix payé, quantité, caisses, autoload, refus, lieu. Cet acquis est si large qu'il a fallu se
demander si la lecture d'écran gardait une raison d'être.

Elle en garde une, et une seule : **le journal n'enregistre que ce qu'on fait.** Monter voir un
kiosque sans y acheter n'y laisse que des noms de commodités et des tailles de caisse. Il manque
donc trois choses, et ce sont précisément celles dont l'app se sert pour décider :

1. **Le prix des commodités qu'on n'échange pas** — c'est-à-dire tout le tableau, alors qu'on
   n'achète qu'une ligne.
2. **Le stock (`scu_buy`)**, qui plafonne ce qu'on peut charger.
3. **La demande restante (`scu_sell − scu_sell_stock`)**, sur laquelle reposent la vue « où
   écouler » et la Tournée. UEX ne renseigne `scu_sell` que sur **~11 %** des points de vente.

Et c'est là qu'est l'avantage : UEX republie un point tous les **3,1 jours en médiane**, seuls
**29,9 %** ont un relevé de moins de 24 h. Qui lit un tableau de ses yeux détient, pour plusieurs
jours, une route que les données publiques ne montrent pas.

**L'alternative n'est pas « OCR ou rien », c'est « OCR ou saisir 45 valeurs ».** Une quinzaine de
commodités × prix d'achat, prix de vente, volume. La saisie manuelle existe déjà dans la vue
Corrections ; à ce volume, personne ne la fera. C'est ce rapport-là qui justifie l'OCR, pas
l'élégance de la technique.

### Ce que l'ADR-009 retire du problème

C'est le cœur de cette décision. `LoadShopInventoryData` liste les commodités du comptoir dès
l'ouverture du kiosque : mesuré sur **27 comptoirs**, **5 commodités en médiane**, 22 au maximum —
dont la moitié sont munitions et carburant. Le vocabulaire réel d'un kiosque tourne autour de
**10 noms, contre 206 dans le jeu**.

| Difficulté chez `sc-trade-companion` | Ce que le journal fournit |
|---|---|
| Lire le lieu dans le panneau gauche — le module `CommodityLocationReader` en entier | le lieu, **avant** la capture |
| Recaler chaque nom lu sur les 206 commodités, avec échec si trop loin | la liste des ~10 de **ce** kiosque |
| Reconstituer « Available cargo size (SCU) » à coups de fusions de paragraphes | les tailles de caisse, déjà connues et **statiques** |
| Vérifier que les nombres sont bien lus | si on achète, le prix exact au aUEC près, comme calibrage dans la même session |

L'OCR n'a plus qu'un travail : **lire des nombres, dans une mise en page connue, pour une courte
liste connue, à un endroit connu.** C'est un problème d'un autre ordre que celui que l'autre projet
affronte depuis quatorze mois — et c'est la raison pour laquelle cet ADR vient *après* le 009 et
non en même temps.

### Ce que l'état de l'art coûte

[`sc-trade-companion`](https://github.com/EtienneLamoureux/sc-trade-companion) a changé de moteur
**quatre fois en quatorze mois** — Tesseract, puis PaddleOCR (PR #107), Windows OCR (#112, #116),
OneOCR par wrapper .NET (#123), OneOCR par JNA (#125) — avec une cinquième PR ouverte (#126). Ses
bugs sur écrans ultra-larges (#104) et sous Wayland (#84) sont toujours ouverts, et chaque patch qui
bouge le kiosque a coûté une PR (#76 pour la mise en page 3.24, #131 pour le format des nombres).

C'est un **impôt permanent**, pas un coût unique. Il est accepté ici en connaissance de cause,
mais il commande deux choix de structure (§2 et §3).

## Décision

### 1. Le journal pré-sélectionne, l'utilisateur tranche toujours

**Une station détectée est une proposition, jamais un fait.** L'écran de relecture affiche le
terminal retenu et permet d'en choisir un autre à la main, sans quitter l'écran, sans recommencer
la capture. Cela vaut aussi quand la détection a réussi : l'utilisateur peut la contredire.

Ce n'est pas une soupape de secours ajoutée par prudence, c'est la règle. Trois cas la rendent
obligatoire : les **portails**, indiscernables par les prix (les deux bouts d'un même saut affichent
les mêmes tarifs) ; les **avant-postes**, non résolus par l'appariement de l'ADR-009 ; et les lieux
sans terminal chez nous, comme `RR_JP_StantonMagnus`. Une correction manuelle **enrichit la table
d'appariement** pour les fois suivantes.

### 2. Le moteur OCR est derrière une interface, et l'interface est le livrable

`lire(image) → MotSitué[]`, où un mot situé porte son texte et sa boîte englobante. Une seule
implémentation au départ. On ne parie pas sur un moteur : on parie sur le fait qu'on en changera.

*Écarté : appeler directement une bibliothèque depuis le code d'analyse.* C'est ce qui a rendu
douloureux chacun des quatre changements de moteur du projet de référence.

**Conséquence sur la CSP.** Un moteur WASM dans le navigateur exige `'wasm-unsafe-eval'` dans
`script-src`, et la publication (§5) exige `https://api.uexcorp.uk` dans `connect-src`. Notre CSP est
aujourd'hui `script-src 'self'` et `connect-src 'self'` : **l'app ne fait actuellement aucun appel
réseau à l'exécution.** Ces deux assouplissements sont le vrai prix de cet ADR, et ils doivent être
posés explicitement dans `index.html`, pas découverts en route.

### 3. L'analyse est pure, et c'est elle qu'on teste

Le découpage sépare ce qui touche une API de ce qui porte la difficulté :

| Unité | Rôle | Pur ? |
|---|---|---|
| `capture/source` | collage, dépôt de fichier, ou dossier de captures du jeu | non |
| `ocr/pretraitement` | gris égalisé, seuil adaptatif, agrandissement, sur canvas | **oui** |
| `ocr/moteur` | l'interface du §2 | non |
| `kiosque/analyse` | `MotSitué[]` → `LigneLue[]` : colonnes, appariement, nombres | **oui** |

**Les fixtures sont des `MotSitué[]` en JSON, pas des images.** L'analyse spatiale — la partie qui
casse à chaque patch — se teste en `node --test`, sans navigateur et sans moteur. Un petit jeu
d'images de référence avec leur sortie OCR figée sert de garde-fou au moteur lui-même. En e2e, on
injecte par le chemin « dépôt de fichier », seul chemin scriptable.

On reprend de `sc-trade-companion` deux idées qui ont fait leurs preuves, et **pas leur code**
(GPL-3.0 contre notre MIT) : la lecture **spatiale** — deux colonnes repérées par densité, appariées
par recouvrement en Y — et le **recalage sur vocabulaire fermé**, qui devient ici presque trivial
puisque le vocabulaire fait dix mots.

*Écarté au départ : l'alignement homographique et la stratégie « meilleur effort » à N seuillages.*
Ils y sont venus après avoir mesuré ; on fera pareil. La structure les accueille sans réécriture.

### 4. Rien de lu n'entre dans l'état sans relecture

Chaque ligne lue s'affiche **à côté de la valeur UEX connue** dans la vue Corrections, que
l'ADR-003 a déjà rangée par station. Attention à ne pas confondre deux images : la photo que cette
vue affiche déjà est celle **du terminal, publiée par UEX** (`screenshot`, présente sur 97 de nos
114 terminaux) ; la vignette de notre capture est un **élément nouveau**, qui se pose à côté.
Validation en bloc ou ligne à ligne. Ce qui est validé devient une correction locale, donc
**périmée à 3 h** comme tout le reste, sans code supplémentaire.

Une lecture douteuse ne coûte donc jamais plus qu'un rejet d'un clic — c'est ce qui rend acceptable
un OCR imparfait.

### 5. La publication UEX n'a pas besoin de savoir lire

C'est le point qui a failli nous égarer. `POST https://api.uexcorp.uk/2.0/data_submit` réclame une
capture en base64 pendant les 90 jours d'évaluation d'un nouveau datarunner — **comme preuve, pas
comme source**. Rien n'exige qu'on ait *lu* l'image.

L'envoi est **opt-in** et conditionné aux deux secrets saisis par l'utilisateur : sa `secret-key` de
compte et son propre jeton d'application (`Authorization: Bearer`, créé sur « My Apps »). Chacun a
ainsi son quota et répond de ses envois ; aucun secret ne vit dans le dépôt.

**On n'envoie que ce que l'utilisateur a validé**, et **jamais la capture brute** : seul le
recadrage sur la zone des listings part, celle que l'analyse vient de délimiter. Un écran complet
porte le solde du joueur, son nom et le chat — le projet de référence en est réduit à demander
« coupez le chat global » dans ses bonnes pratiques. Recadrage impossible → pas de publication.

Préalable non négociable : **`build-data.mjs` ne conserve ni `id_terminal` ni `id_commodity`**,
alors que l'API les exige. Un terminal y est `{name, code:"RODSF"}` et son index ; une commodité
`{name, code:"ALUM"}`. Ce petit changement de pipeline précède tout le volet réseau.

## Conséquences

**Ce que ça change pour l'utilisateur.** Il peut faire un détour par un comptoir, prendre une
capture, et repartir avec un tableau à jour que personne d'autre n'a — puis, s'il le veut, le rendre
à la communauté.

**Ce que ça coûte.** Deux assouplissements de CSP sur une app qui n'avait aucun appel réseau à
l'exécution, un modèle WASM à charger, et l'impôt de maintenance décrit plus haut : chaque patch qui
déplace le kiosque demandera une correction.

**Ce que ça ne casse pas.** Sans capture, l'app fonctionne exactement comme avant ; sans secrets
UEX, rien ne sort de la machine.

**Le rapport au 009 est une dépendance, pas un ordre de confort.** Écrire cet ADR-là d'abord
reviendrait à réimplémenter la lecture du lieu et le recalage sur 206 noms — c'est-à-dire les deux
modules les plus coûteux du projet de référence, pour rien.

## Ce que cet ADR ne tranche pas

- **Le moteur OCR retenu.** Le §2 impose une interface, pas un choix. Il se fera sur mesure, sur des
  captures réelles de kiosque, pas sur une réputation.
- **Le raccourci de capture.** Un navigateur n'a pas de raccourci global ; la voie la plus prometteuse
  — laisser la touche de capture du jeu écrire un fichier que l'app surveille — dépend des trois
  inconnues de système de fichiers listées en ADR-009 §1.
- **Les écrans ultra-larges**, bug ouvert chez le projet de référence, et la lecture des kiosques
  d'équipement, hors sujet pour du fret.
- **Le sort des lectures rejetées.** Une valeur qu'on refuse dit quelque chose sur le moteur ; rien
  n'est décidé sur ce qu'on en garde.
