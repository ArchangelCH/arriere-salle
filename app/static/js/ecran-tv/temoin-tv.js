// Le témoin de la TV, dans l'en-tête, à côté de Tableau : un petit cadre « TV · L'Échoppe du Gué » suivi de
// « Retirer », le même sur toutes les pages, lu depuis l'état réel de la table (etat-tv.js). En partie, le MJ regarde
// la table et non son écran : un coup d'œil lui dit ce que voient les joueurs, si la TV est noire (un plan dont rien
// n'est révélé), ou si aucun écran n'est branché. Sa largeur ne bouge pas : la barre des onglets ne se range pas de
// nouveau à chaque changement de la TV.

import { echapper as e, toast } from "../api.js";
import { ecouterTv, phraseCarton, phraseTv, phraseVue, retirerDeLaTv } from "./etat-tv.js";
import { genreRetrait } from "./tv-commun.js";

const majuscule = (t) => String(t || "").replace(/^./, (x) => x.toUpperCase());

// Les écrans branchés, en clair, pour l'infobulle.
function phraseEcrans(d) {
  const n = (k, lieu) => (k ? `${k} écran${k > 1 ? "s" : ""} ${lieu}` : "");
  const parts = [n(d.ecransSalon, "au salon"), n(d.ecransInternet, "sur Internet")].filter(Boolean);
  return parts.length ? `${majuscule(parts.join(", "))}.` : "Aucun écran de table n'est branché : rien ne s'affiche au salon pour l'instant.";
}

// Ce que « Retirer » va faire, dit sur son infobulle et dans le message qui suit.
function phraseRetrait(etat, d) {
  const genre = genreRetrait(etat);
  if (genre === "carton") {
    const cartons = d.cartons.map(phraseCarton).join(" et ");
    return { titre: `Retirer ${cartons} : ${d.quoi === "accueil" ? "l'écran d'accueil reste" : `${phraseVue(d)} revient`}.`, fait: cartons };
  }
  if (genre === "lieu") return { titre: `Retirer le lieu «\u00a0${d.lieu.nom}\u00a0» : la carte reste.`, fait: `le lieu «\u00a0${d.lieu.nom}\u00a0»` };
  if (genre === "vue") return { titre: `Retirer ${phraseVue(d)} : la TV revient à ce qu'elle montrait avant.`, fait: phraseVue(d) };
  if (genre === "tout") return { titre: `Retirer ${phraseVue(d)} : l'écran d'accueil revient.`, fait: phraseVue(d) };
  return null;
}

export class TemoinTv {
  constructor(zone) {
    this.zone = zone;
    this.etat = null;
    this.description = null;
    zone.innerHTML = `
      <a class="temoin-cadre" aria-live="polite"><span class="temoin-mot">TV</span><span class="temoin-nom">…</span></a>
      <button type="button" class="temoin-retirer" hidden>Retirer</button>`;
    zone.hidden = false;
    zone.dataset.etat = "lecture";
    this.cadre = zone.querySelector(".temoin-cadre");
    this.bouton = zone.querySelector(".temoin-retirer");
    this.bouton.addEventListener("click", () => this.retirer());
    ecouterTv((etat, d) => this.afficher(etat, d));
  }

  afficher(etat, d) {
    this.etat = etat;
    this.description = d;
    const z = this.zone;
    const aucun = !d.ecrans;
    // Le nom court : le carton posé par-dessus d'abord (c'est lui que lisent les joueurs), puis le lieu montré sur la
    // carte, sinon la vue (et ce qu'elle montre de près).
    const premier = d.cartons[0];
    const nom = premier ? premier.nom + (d.cartons.length > 1 ? ` +${d.cartons.length - 1}` : "")
      : d.lieu ? d.lieu.nom
      : d.detail && d.quoi !== "precedemment" ? `${d.nom} · ${d.detail}` : d.nom;
    const lien = premier ? premier.lien : d.lieu ? d.lieu.lien : d.lien;
    z.dataset.etat = d.noire && !premier ? "noire" : d.quoi === "accueil" && !premier ? "accueil" : "montre";
    z.dataset.ecrans = aucun ? "aucun" : "oui";
    // L'ordre du combat en haut de l'écran : dit sur l'étiquette du cadre, le nom garde sa place.
    z.dataset.combat = d.combat ? "oui" : "non";
    const tout = majuscule(phraseTv(d));
    const mot = (d.noire && !premier ? "TV noire" : "TV") + (d.combat ? " · combat" : "");
    this.cadre.innerHTML = `<span class="temoin-mot">${mot}</span><span class="temoin-nom">${e(aucun ? "aucun écran branché" : nom)}</span>`;
    this.cadre.title = `La TV montre ${phraseTv(d)}.${d.noire ? " Rien n'est révélé : les joueurs voient un écran noir." : ""} ${phraseEcrans(d)}${lien ? " Cliquez pour l'ouvrir." : ""}`;
    this.cadre.setAttribute("aria-label", `TV : ${aucun ? "aucun écran branché, " : ""}${tout}`);
    if (lien) this.cadre.setAttribute("href", lien);
    else this.cadre.removeAttribute("href");
    const retrait = phraseRetrait(etat, d);
    this.bouton.hidden = !retrait;
    this.bouton.title = retrait ? retrait.titre : "";
  }

  async retirer() {
    const retrait = this.etat && this.description ? phraseRetrait(this.etat, this.description) : null;
    this.bouton.disabled = true;
    try {
      const r = await retirerDeLaTv();
      if (r && retrait) toast(`Retiré de la TV : ${retrait.fait}.`);
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    } finally {
      this.bouton.disabled = false;
    }
  }
}

// Le témoin dans l'emplacement de l'en-tête (.temoin-tv), une fois par page.
export function demarrerTemoin(entete = document.querySelector(".entete")) {
  const zone = entete?.querySelector(".temoin-tv");
  return zone ? new TemoinTv(zone) : null;
}

