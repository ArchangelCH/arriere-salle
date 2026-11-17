// La question de la TV noire : un plan sous brouillard dont rien n'est révélé ne montre que du noir aux joueurs, et une TV
// noire passe pour une panne. Avant de l'envoyer, l'atelier le dit et propose de révéler la pièce des héros. Un petit
// dialogue de l'atelier (le modèle .dialogue), pas la fenêtre grise du navigateur.

import { echapper as e } from "../api.js";
import { garderLaLecture } from "../commun/dialogue.js";

const guillemets = (t) => `«\u00a0${e(t)}\u00a0»`;
const liste = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).map(guillemets).join(", ")} et ${guillemets(noms[noms.length - 1])}` : guillemets(noms[0]));

// nom : le plan ; pieces : les noms des pièces cachées où se tiennent les héros (vide : aucun héros posé dans une pièce
// cachée) ; editeur : la question vient de l'éditeur du plan (on peut y révéler), sinon d'une autre page (on l'ouvre).
// Rend le choix : « reveler » (la pièce des héros), « choisir » (l'outil Révéler), « ouvrir » (l'éditeur du plan),
// « noire » (montrer quand même), ou null (rien ne part).
export function questionTvNoire({ nom, pieces = [], editeur = true }) {
  const d = document.createElement("dialog");
  d.className = "dialogue question dialogue-tv-noire";
  const principal = !editeur ? ["ouvrir", "Ouvrir le plan"]
    : pieces.length ? ["reveler", pieces.length > 1 ? "Révéler les pièces des héros" : "Révéler la pièce des héros"]
    : ["choisir", "Choisir la pièce à révéler"];
  const suite = !editeur ? "Révélez d'abord la pièce où entrent les héros, dans l'éditeur du plan."
    : pieces.length ? `Les héros se tiennent dans ${liste(pieces)}, encore cachée${pieces.length > 1 ? "s" : ""} aux joueurs. Révéler la pièce des héros ?`
    : "Aucun héros n'est encore posé dans une pièce : cliquez celle où ils entrent pour la révéler, puis montrez le plan.";
  d.innerHTML = `
    <form method="dialog">
      <p class="kicker">La TV</p>
      <h2>Rien n'est révélé</h2>
      <p>Rien n'est révélé sur ${guillemets(nom || "ce plan")} : la TV restera noire.</p>
      <p class="aide">${suite}</p>
      <div class="actions">
        <button value="annuler">Annuler</button>
        <button value="noire" title="Les joueurs verront un écran noir jusqu'à la première pièce révélée">Montrer quand même</button>
        <button value="${principal[0]}" class="principal">${principal[1]}</button>
      </div>
    </form>`;
  document.body.append(d);
  return new Promise((ok) => {
    d.addEventListener("close", () => {
      const choix = d.returnValue;
      d.remove();
      ok(["reveler", "choisir", "ouvrir", "noire"].includes(choix) ? choix : null);
    }, { once: true });
    garderLaLecture(d);
    d.showModal();
    d.querySelector("button.principal").focus();
  });
}
