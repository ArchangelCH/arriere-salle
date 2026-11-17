// En tête du Tableau, sur toutes les pages : le fil de la séance qu'on joue aujourd'hui (seances/scene-suivante.js), la
// scène en cours, la suivante et « Jouer », qui la joue sans quitter la page. Le nom de la séance l'ouvre sur Jouer.
// Rien les autres jours, ni sur la page de cette séance, dont le bandeau dit la même chose ; sauf sous 1 100 px, où le
// Tableau couvre la page au lieu de la pousser (iPad en portrait, iPhone déplié) : le « Jouer » du bandeau y est caché.

import { accorderEnfants } from "../commun/accorder.js";
import { toast } from "../api.js";
import { ecouterTable } from "../ecran-tv/canal-table.js";
import { etatMusique, jouerAmbiance } from "../musique/musique.js";
import { seanceDuJour, seanceEnCours } from "../seances/seance-en-cours.js";
import { attenduDuBouton, demanderSceneSuivante, htmlFilDeSeance } from "../seances/scene-suivante.js";
import { lire, oublier } from "./donnees.js";

// Comme atelier.css : à partir de 1 100 px, le Tableau pousse la page ; plus étroit, il la couvre.
const POUSSE = matchMedia("(min-width: 1100px)");

export class SeanceDuTableau {
  constructor(zone) {
    this.zone = zone;
    this.actif = false;
    this.seances = null;
    this.jeu = null;
    zone.addEventListener("click", (ev) => this.clic(ev));
    // L'onglet Séances annonce chaque séance enregistrée : une scène cochée, jouée, une date changée.
    window.addEventListener("seances-modifiees", (ev) => {
      oublier("/api/seances");
      if (Array.isArray(ev.detail?.seances)) this.seances = ev.detail.seances;
      this.afficher();
    });
    window.addEventListener("hashchange", () => this.afficher());
    window.addEventListener("seance-ouverte", () => this.afficher());
    POUSSE.addEventListener("change", () => this.afficher());
  }

  ouvrir() {
    this.actif = true;
    this.relire();
    // Une scène jouée sur un autre écran (la télécommande) envoie souvent son plan à la TV : la séance se relit alors,
    // et sinon toutes les 30 secondes.
    this.finTable ||= ecouterTable(() => this.relire(4000));
    clearInterval(this.minuterie);
    this.minuterie = setInterval(() => this.relire(), 30000);
  }

  fermer() {
    this.actif = false;
    this.finTable?.();
    this.finTable = null;
    clearInterval(this.minuterie);
  }

  recu(jeu) {
    const avant = this.auCombat();
    this.jeu = jeu;
    if (this.auCombat() !== avant) {
      oublier("/api/seances");
      this.relire();
    }
    this.afficher();
  }

  auCombat() {
    return this.jeu?.combat ? this.jeu.seance || "" : "";
  }

  async relire(age = 15000) {
    if (!this.actif) return;
    const seances = await lire("/api/seances", age).catch(() => null);
    if (seances) this.seances = seances;
    this.afficher();
  }

  // La séance en cours, si on la joue aujourd'hui (seance-en-cours.js).
  seance() {
    const auCombat = this.auCombat();
    const s = seanceEnCours(this.seances, { auCombat });
    return s && (s.id === auCombat || seanceDuJour(s)) ? s : null;
  }

  afficher() {
    if (!this.actif) return;
    const s = this.seances ? this.seance() : null;
    const ici = s && POUSSE.matches && decodeURIComponent(location.hash.split("?")[0]) === `#/seances/${s.id}`;
    const html = s && !ici ? htmlFilDeSeance(s, "tableau") : "";
    this.zone.hidden = !html;
    const neuf = document.createElement("div");
    neuf.innerHTML = html;
    accorderEnfants(this.zone, neuf);
  }

  async clic(ev) {
    const b = ev.target.closest('[data-action="jouer-suite"]');
    if (!b || b.disabled) return;
    // Touché à la souris, le bouton ne garde pas le focus : Entrée ne rejoue pas le geste.
    if (ev.detail) b.blur();
    b.disabled = true;
    try {
      const bilan = await demanderSceneSuivante({ seance: b.dataset.seance, attendu: attenduDuBouton(b) }, { lancerAmbiance: jouerAmbiance, musique: etatMusique });
      toast(bilan.texte, bilan.erreur ? "erreur" : undefined, { action: bilan.action });
    } catch (err) {
      toast(`Scène suivante impossible : ${err.message}`, "erreur");
    }
    b.disabled = false;
    oublier("/api/seances");
    this.relire();
  }
}
