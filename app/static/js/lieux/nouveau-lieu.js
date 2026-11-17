// « Nouveau lieu », en tête de l'onglet Lieux : son nom et son genre, puis où le poser. Sur une carte, elle s'ouvre avec
// l'outil Lieu prêt à le poser d'un clic, comme « Nouveau PNJ ici » dans l'autre sens ; sans carte, sa fiche s'ouvre,
// à remplir (lieux/fiche-lieu.js), et « Poser sur une carte » l'y mettra plus tard. La fiche naît sous son vrai nom.

import { api, echapper as e, toast } from "../api.js";
import { TYPES_LIEUX } from "../carte/biomes.js";

let dialogue = null;

// cartes : celles de la liste ({ id, nom }).
export function ouvrirNouveauLieu(cartes = []) {
  dialogue?.remove();
  dialogue = document.createElement("dialog");
  dialogue.className = "dialogue dialogue-nouveau-lieu";
  dialogue.innerHTML = `
    <form method="dialog">
      <h2>Nouveau lieu</h2>
      <div class="deux">
        <label class="champ">Nom<input type="text" name="nom" required autocomplete="off" placeholder="Le gué aux Cendres"></label>
        <label class="champ">Genre<select name="type">${TYPES_LIEUX.map((t) => `<option value="${t.cle}" ${t.cle === "village" ? "selected" : ""}>${e(t.nom)}</option>`).join("")}</select></label>
      </div>
      <fieldset class="choix-modele">
        <label class="modele"><input type="radio" name="ou" value="carte" ${cartes.length ? "checked" : "disabled"}>
          <span><strong>Sur une carte</strong>${cartes.length ? "Elle s'ouvre, l'outil Lieu prêt : cliquez là où il se trouve." : "Il n'y a pas encore de carte."}</span></label>
        ${cartes.length ? `<label class="champ">Carte<select name="carte">${cartes.map((c) => `<option value="${e(c.id)}">${e(c.nom)}</option>`).join("")}</select></label>` : ""}
        <label class="modele"><input type="radio" name="ou" value="sans" ${cartes.length ? "" : "checked"}>
          <span><strong>Sans carte pour l'instant</strong>Sa fiche s'ouvre, à remplir : ce que savent les joueurs, vos secrets, vos notes. « Poser sur une carte » l'y mettra quand vous saurez où.</span></label>
      </fieldset>
      <div class="actions">
        <button value="annuler" formnovalidate>Annuler</button>
        <button class="principal" value="creer">Créer le lieu</button>
      </div>
    </form>`;
  document.body.append(dialogue);
  const form = dialogue.querySelector("form");
  form.addEventListener("change", (ev) => {
    if (ev.target.name === "carte") form.elements.ou.value = "carte";
  });
  dialogue.addEventListener("close", async () => {
    const d = dialogue;
    const el = form.elements;
    const choix = d.returnValue === "creer" ? { nom: el.nom.value.trim(), type: el.type.value, ou: el.ou.value, carte: el.carte?.value } : null;
    d.remove();
    if (!choix?.nom) return;
    let lieu;
    try {
      lieu = await api.post("/api/lieux", { nom: choix.nom, type: choix.type, etiquette: "maison", connu: false, a_valider: false, resume: "", secrets: "", notes: "" });
    } catch (err) {
      return toast(`Création impossible : ${err.message}`, "erreur");
    }
    if (choix.ou === "carte" && choix.carte) location.hash = `#/carte/${encodeURIComponent(choix.carte)}?poser=${encodeURIComponent(lieu.id)}`;
    else location.hash = `#/lieu/${encodeURIComponent(lieu.id)}`;
  }, { once: true });
  dialogue.returnValue = "";
  dialogue.showModal();
  form.elements.nom.focus();
}
