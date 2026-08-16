// La carte de DÉCLARATION de soute (`#holdDeclare`, #55), treizième îlot React (ADR-008 #96).
//
// « J'ai déjà ça à bord » : le seul chemin qui fait entrer du fret sans jambe — butin ramassé,
// vaisseau rangé plein, cargaison achetée hors de l'app. Carte SÉPARÉE de `#holdCard`, et c'est
// tout le point : celle-ci se masque dès que la soute est vide, un bouton posé dedans serait
// invisible au moment exact où il sert.
//
// ON REND UN FRAGMENT, PAS UN CONTENEUR. `.hold-declare` (`display:flex; column; gap:9px`,
// style.css:697) et `.hold-card` sont posées sur `#holdDeclare` lui-même (index.html:226) : un
// `<div>` d'enrobage ramènerait la carte à UN seul enfant et le `gap` disparaîtrait.
//
// LES QUATRE EMPLACEMENTS SONT FIXES, `null` pour l'absent. Ce n'est pas du style : les blocs
// n'apparaissent pas tous en même temps et changent de RANG selon l'état — `.hold-head` sort quand
// la soute se remplit, `.hold-ici` glisse alors de l'index 1 à l'index 0. Rendus par une liste,
// React verrait `div` contre `div`, RÉUTILISERAIT le nœud et le rapiècerait : le champ « Je suis à »
// serait reconstruit à partir de l'ancien en-tête. Des emplacements fixes rendent la question sans
// objet, chacun se réconciliant avec lui-même.
import { useEffect, useRef } from "react";

export type PropsDeclaration = {
  /** L'en-tête « ◈ Soute vide » n'apparaît QU'à vide : au-dessus d'une carte Soute déjà titrée, un
   *  second « ◈ Soute » ferait lire deux panneaux là où il n'y en a qu'un. */
  souteVide: boolean;
  /** « Je suis à » n'a de sens que HORS voyage : avec un parcours, l'étape courante dit déjà où
   *  l'on est, et un champ ici mentirait. */
  avecPosition: boolean;
  /** Le formulaire est déplié (`declarationOuverte` d'app.js). */
  ouvert: boolean;
  /** La valeur de `#origin`, le champ de départ d'« En route ». Voir `ChampPosition`. */
  origine: string;
};

// « Je suis à » n'est pas un second magasin : c'est une SECONDE ENTRÉE de `#origin`, dans les deux
// sens. La frappe y écrit (délégation `input` d'app.js → `poserPosition`), et le champ relit
// `#origin` à chaque rendu — qui a quatre autres écrivains, dont le permalien et le déplacement du
// voyage. Deux positions divergeraient au premier aller-retour entre les vues.
//
// D'où un champ NON CONTRÔLÉ recopié à la main : `defaultValue` seul le figerait au montage et le
// sens `#origin` → ici se perdrait (c'est le piège payé au manifeste, #117). Et le passer en
// `value=` sans `onChange` le gèlerait pour de bon, React restaurant la valeur de la prop au premier
// changement.
//
// La garde reproduit celle d'`app.js` À L'IDENTIQUE, mais rétrécie d'une carte à un champ : tant
// qu'une saisie est en cours QUELQUE PART dans la carte, on ne réécrit rien. Écrite sur le seul
// champ (`activeElement !== input`), elle écraserait un texte tapé ici puis abandonné pour un autre
// champ, avant que le débounce de 150 ms n'ait propagé la frappe vers `#origin`.
function ChampPosition({ origine }: { origine: string }) {
  const champ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    const carte = el.closest("#holdDeclare");
    if (carte && carte.contains(document.activeElement)) return;
    if (el.value !== origine) el.value = origine;
  });
  return (
    <div className="hold-ici">
      <label htmlFor="holdWhere">◈ Je suis à</label>
      <input
        ref={champ}
        id="holdWhere"
        list="originList"
        type="text"
        autoComplete="off"
        defaultValue={origine}
        placeholder="Tape un terminal (ex : Megumi — Pyro)"
        title="D'où tu pars. Ce terminal fixe le prix d'une vente et le classement de « où écouler » — c'est le même que le départ d'« En route »."
      />
    </div>
  );
}

// Les trois champs sont NON CONTRÔLÉS et n'ont même pas de `defaultValue` : la racine React est
// mémorisée par conteneur (pont.js), donc React réutilise leur nœud DOM d'un rendu à l'autre et
// n'écrit jamais leur valeur. La frappe survit nativement — c'est ce qui rend inutiles, d'un coup,
// la garde de focus d'`app.js` ET la relecture/réémission des valeurs avant repeint. Refermer le
// formulaire démonte les nœuds : rouvrir redonne des champs vides, comme avant.
//
// Leurs ids portent aussi la LARGEUR (`#holdAddName{flex:1 1 130px}`, `#holdAddScu{flex:0 0 62px}`,
// `#holdAddPaid{flex:0 0 96px}`, style.css:706-708) et `declarerABord` les lit dans le DOM SANS `?.`
// — un id renommé lèverait et le lot n'entrerait jamais en soute. La classe `.hold-add` est le
// contrat de la délégation clavier, qui se garde par `closest(".hold-add")`.
function Formulaire() {
  return (
    <div className="hold-add">
      <input id="holdAddName" list="commodityList" type="text" autoComplete="off" placeholder="Commodité (nom ou code UEX)" aria-label="Commodité à déclarer" />
      <input id="holdAddScu" type="number" min="1" step="1" placeholder="SCU" aria-label="SCU à bord" />
      <input
        id="holdAddPaid"
        type="number"
        min="0"
        step="1"
        placeholder="prix payé /SCU"
        aria-label="Prix payé au SCU"
        title="Laisse vide pour du butin : minage, salvage, caisse trouvée — un coût réellement nul."
      />
      <button id="holdAddOk" className="hold-sell-ok" title="Ajouter ce lot à la soute">✓ à bord</button>
      <button id="holdAddNo" className="hold-sell-no" title="Annuler" aria-label="Annuler">✕</button>
    </div>
  );
}

export function carteDeclaration(p: PropsDeclaration) {
  return (
    <>
      {p.souteVide ? (
        <div className="hold-head">
          <span className="hold-title">◈ Soute</span>
          <span className="muted">vide</span>
        </div>
      ) : null}

      {p.avecPosition ? <ChampPosition origine={p.origine} /> : null}

      {p.ouvert ? (
        <Formulaire />
      ) : (
        <button
          id="holdAddOpen"
          className="hold-add-open"
          title="Déclarer du fret déjà à bord : butin ramassé, vaisseau rangé plein, cargaison achetée hors de l'app"
        >
          + déclarer ce que j'ai à bord
        </button>
      )}

      {/* Frère de `.hold-add`, jamais son enfant : dans un conteneur `flex-wrap` il passerait pour
          un sixième contrôle. */}
      {p.ouvert ? (
        <p className="hold-add-hint">Prix vide = <b>butin</b>, coût nul : « où écouler » comptera alors tout l'encaissement comme profit.</p>
      ) : null}
    </>
  );
}
