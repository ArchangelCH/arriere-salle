// Le bouton de la TV d'une fiche : un seul couple de mots partout, « Montrer à la TV » et « Retirer de la TV », sur un
// bouton qui bascule. Tant que la TV montre la fiche, il porte un liseré or et les mots « À la TV ». Il lit l'état réel
// de la table (etat-tv.js), comme le témoin de l'en-tête : un autre écran ou la télécommande qui change la TV le change
// aussi. Posé dans son cadre collant (cadre), il reste en haut à droite de la fiche quand elle défile.

import { toast } from "../api.js";
import { ecouterTv, relireTv } from "./etat-tv.js";

export class BoutonTv {
  // estIci(etat) : la TV montre-t-elle cette fiche ? (etat : l'état de la table, vrais identifiants) ; montrer() et
  // retirer() : les gestes de la page (promesses). libelle : ce que dit le bouton quand la fiche n'est pas à la TV
  // (« Montrer à la TV » ; une fonction peut le changer selon l'état) ; titre et titreIci : ses infobulles.
  constructor({ estIci, montrer, retirer, libelle = "Montrer à la TV", titre = "", titreIci = "", principal = true }) {
    this.estIci = estIci;
    this.faireMontrer = montrer;
    this.faireRetirer = retirer;
    this.libelle = libelle;
    this.titre = titre;
    this.titreIci = titreIci;
    this.principal = principal;
    this.ici = false;
    this.occupe = false;
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "bouton-tv";
    this.el.addEventListener("click", () => this.basculer());
    this.cadre = document.createElement("div");
    this.cadre.className = "tv-colle";
    this.cadre.append(this.el);
    this.dernier = null;
    this.peindre();
    this.arreter = ecouterTv((etat) => this.maj(etat));
  }

  maj(etat = this.dernier) {
    this.dernier = etat;
    if (etat) this.ici = Boolean(this.estIci(etat));
    this.peindre();
  }

  peindre() {
    const b = this.el;
    const libelle = typeof this.libelle === "function" ? this.libelle(this.dernier) : this.libelle;
    b.classList.toggle("montree", this.ici);
    b.classList.toggle("principal", this.principal && !this.ici);
    b.setAttribute("aria-pressed", String(this.ici));
    b.innerHTML = this.ici ? '<span class="tv-etat">À la TV</span><span class="tv-geste">Retirer de la TV</span>' : `<span class="tv-geste">${libelle}</span>`;
    b.title = this.ici ? this.titreIci || "La TV montre cette fiche : la retirer" : this.titre || "La montrer aux joueurs, sur la TV";
    b.setAttribute("aria-label", this.ici ? "À la TV : retirer de la TV" : libelle);
    b.disabled = this.occupe || this.inactif === true;
  }

  // Rendu inutilisable (une fiche secrète, une liste vide) avec la raison en infobulle ; null : de nouveau utilisable.
  desactiver(raison) {
    this.inactif = Boolean(raison);
    this.peindre();
    if (raison) this.el.title = raison;
  }

  async basculer() {
    if (this.occupe) return;
    this.occupe = true;
    this.peindre();
    try {
      await (this.ici ? this.faireRetirer() : this.faireMontrer());
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    } finally {
      this.occupe = false;
      this.peindre();
      relireTv();
    }
  }

  detruire() {
    this.arreter();
    this.cadre.remove();
  }
}

// Le message qui suit un envoi : « À la TV : … » ou « Retiré de la TV », le même partout.
export function annoncerTv(r, quoi, { montre = true } = {}) {
  if (!montre) return toast(quoi ? `Retiré de la TV : ${quoi}.` : "Retiré de la TV.");
  toast(r && r.ecrans === 0 ? `Envoyé, mais aucun écran de table n'est branché.` : `À la TV : ${quoi}.`);
}
