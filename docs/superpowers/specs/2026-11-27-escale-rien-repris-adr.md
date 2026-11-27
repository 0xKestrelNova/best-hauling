# ADR-018 : « Rien repris » est un refus, et un refus se voit

**Statut :** Accepté. **Complète** l'ADR-002 (§ « La réserve, sur l'étape implicite » et son
amendement du 2026-08-14) sans rien y contredire.
**Date :** 2026-11-27
**Décideur :** 0xKestrelNova (propriétaire du dépôt), sur l'audit du chargement en station
**Issue :** #209 · **Jalon :** v2.5.0 — La relecture générale
**Voisins :** ADR-002 (la soute et les résidus), #20 (le refus périme en 3 h), #49 (« restants » et
« partent »)

## Contexte

L'ADR-002 a décidé qu'**avancer d'une étape vaut « tout vendu »**, avec une réserve : ce qu'une
vente partielle a laissé à bord est marqué « refusé ici » et traverse le départ intact.

La réserve ne couvre pas le cas où le comptoir n'a **rien** repris. Mesuré sur le build, voyage
Megumi → The Golden Riviera → Devlin Scrap :

1. 96 SCU chargés, arrivée à B ;
2. « vendu », « restants » = 96, donc « partent » = 0, puis ✓ vendre : **rien ne se passe** ;
3. clic sur l'étape C : « ✓ Vendu en quittant The Golden Riviera : 96 WiDoW — +256 416 aUEC ».

La cause tient en une ligne (`soute-actions.ts`, ancienne l. 146) : `if (!r.vendu) return;` sortait
**avant** de poser le marqueur. Une vente de 0 SCU était un geste vide, alors qu'au comptoir c'est
l'information la plus lourde qui soit : tout est encore à bord.

Le marqueur lui-même ne s'affichait nulle part. Même quand il existait, l'utilisateur ne pouvait pas
savoir quels lots le départ épargnerait, ni jusqu'à quand : il périme en 3 h depuis #20.

## Décision

1. **Un geste explicite, « ✗ rien repris »**, dans le formulaire de vente, à côté de ✓ vendre et
   offert dans les mêmes conditions (le comptoir reprend la commodité d'après UEX). Il ne vend rien
   et marque **tous** les lots de la commodité refusés à cette station, à la date du geste.
2. **Une vente de 0 SCU EST ce même geste.** Le champ « restants » rempli au total, puis ✓ ou
   Entrée, aboutit au même refus. Le geste n'est plus muet, et les deux chemins ne divergent pas.
3. **Le refus se voit** : la ligne de soute porte « refusé ici · encore 2 h 50 » tant que le
   marqueur protège les lots **à la station où l'on se trouve**. L'échéance s'arrondit à la minute
   **au-dessus**, pour ne jamais afficher « 0 min » d'un refus encore actif.
4. **Rien ne change dans la règle** : c'est toujours `refuseHere`, la même durée (`DUREE_VOL`), la
   même portée (une commodité, une station). Et une vente **explicite** passe toujours outre :
   le marqueur protège du départ, pas de l'utilisateur.

## Options écartées

| Option | Pourquoi non |
|---|---|
| Le champ « restants » seul (vente de 0 = refus, sans bouton) | Le geste existe, mais personne ne le trouve : « ✓ vendre » pour dire « je n'ai rien vendu » se lit à contresens. Retenu **en plus** du bouton, pas à sa place. |
| Le bouton seul, la vente de 0 restant muette | Laisse en place le piège mesuré : un utilisateur qui tape le chiffre de l'écran du jeu (#49) et valide perdrait sa soute au départ. |
| Un refus sans échéance (« jusqu'à ce que je reparte ») | Contredit #20 : la saturation d'un comptoir tient au shard et à l'instant. Deux durées de vie pour un même fait, c'est le défaut que #20 a corrigé. |
| Un drapeau « refusé » sans durée affichée | Le marqueur périme : un drapeau qui disparaît sans prévenir au bout de 3 h est pire qu'aucun drapeau. |

## Conséquences

- La soute reste juste au départ d'un comptoir saturé, sans ressaisir quoi que ce soit.
- `refusRestant` (`logic.ts`) est la seule source du chiffre affiché. Elle applique la même règle que
  `refusActif`, que consulte la vente : l'affichage et le départ ne peuvent pas se contredire.
- **Non couvert** : lever un refus posé par erreur. Le contournement est une vente explicite, ou
  attendre l'échéance. Un « ↶ » sur le badge serait possible s'il manque à l'usage.

## Décisions prises en même temps, livrées à part

L'audit du 2026-11-27 a tranché trois autres points, chacun dans sa PR :

- **#210** : un chargement de jambe se **plafonne** à la place libre de la soute, avec un message
  qui dit ce qui n'a pas été pris.
- **#211** : le bouton de jambe dit « ⬢ à bord » seulement s'il reste du fret de cette jambe.
- **#212** : la vente au départ **reste**, mais elle devient annulable (« ↶ annuler ») et annoncée
  avant le clic. Les escales sautées sont dites, pas vendues en cascade.
