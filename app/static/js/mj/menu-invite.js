// Le menu d'un MJ invité : ses onglets seulement. Ses scénarios, ses séances, ses PNJ, ses lieux, ses plans,
// ses contrats et rumeurs (l'onglet Auberge), ses documents, ses boutiques, ses rencontres et le bestiaire (Combats), ses
// idées et ses fils (Séances) ; la tablée en lecture, la bible des joueurs, et « Le monde » tel que les joueurs le
// connaissent. Ni la campagne du MJ principal, ni ses cartes du monde (« Le monde » les montre en lecture), ni les joueurs et leur
// coin, ni le sanctuaire et les règles maison, ni les réglages du compte principal.
//
// Les mêmes familles et la même barre (onglets.js) : seul le contenu change, avant que la barre ne se range. Le compte
// principal ne passe jamais par ici et garde son menu tel qu'il était.

import { FAMILLES } from "../commun/onglets.js";

// Les pages qu'un MJ invité n'ouvre pas (le premier morceau de l'adresse, « #/carte/… ») : le serveur les lui refuse.
export const PAGES_FERMEES = new Set(["carte", "aventuriers", "sanctuaire", "regles"]);

export function menuDeLInvite(entete) {
  const nav = entete.querySelector(".onglets");
  const lien = (onglet) => nav.querySelector(`a[data-onglet="${onglet}"]`);
  for (const onglet of ["sanctuaire", "regles"]) lien(onglet)?.remove();
  // « Cartes » devient « Plans » : la page ne montre que les siens ; les cartes du monde sont dans « Le monde ».
  const plans = lien("cartes");
  if (plans) {
    plans.textContent = "Plans";
    const monde = document.createElement("a");
    monde.href = "#/monde";
    monde.dataset.onglet = "monde";
    monde.textContent = "Le monde";
    plans.after(monde);
  }
  // « Aventuriers » (les joueurs, leurs comptes, le créateur) devient la tablée en lecture.
  const tablee = lien("aventuriers");
  if (tablee) {
    tablee.textContent = "La tablée";
    tablee.href = "#/tablee";
  }
  const famille = (cle) => FAMILLES.find((f) => f.cle === cle).onglets;
  const preparer = famille("preparer");
  preparer.splice(preparer.indexOf("cartes") + 1, 0, "monde");
  for (const [cle, onglet] of [["compagnie", "sanctuaire"], ["jouer", "regles"]]) {
    const liste = famille(cle);
    if (liste.includes(onglet)) liste.splice(liste.indexOf(onglet), 1);
  }
}
