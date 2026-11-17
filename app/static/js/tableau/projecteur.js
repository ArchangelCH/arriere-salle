// « Chacun son moment », dans le tableau du MJ : depuis quand chaque héros de la séance n'a rien fait de marquant
// (lignes du journal qui le citent, tours de combat), le plus oublié mis en avant sans alarme, et sous chacun ce qu'il
// cherche, pour lui tisser une scène. Rien ne part vers la TV. Le calcul est dans moments.js.

import { accorderEnfants } from "../commun/accorder.js";
import { echapper as e } from "../api.js";
import { prenom } from "../combats/suivi.js";
import { seanceDuJournal } from "../seances/journal.js";
import { garderCle, lire, lireCle, oublier } from "./donnees.js";
import { depuisEnClair, duree, envieDuHeros, herosDeLaSeance, moments, retenirCombat } from "./moments.js";

const MEMOIRE = "tableau.moments.ouvert";
const VUS = "tableau.moments.vus.";
const couleurSure = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#8a6a34");
const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");

export class Projecteur {
  constructor(panneau) {
    this.section = document.createElement("section");
    this.section.className = "ta-aide ta-moments";
    this.section.setAttribute("aria-label", "Chacun son moment");
    this.ouverte = lireCle(MEMOIRE) !== "non";
    this.deplies = new Set();
    this.actif = false;
    this.jeu = null;
    this.seance = undefined; // pas encore lue
    this.campagne = null;
    panneau.append(this.section);
    this.section.addEventListener("click", (ev) => this.clic(ev));
    // Une ligne notée sur cette page (bouton Journal, bilan d'un combat, PNJ improvisé) : le compte suit aussitôt.
    window.addEventListener("journal-modifie", (ev) => this.surJournal(ev.detail || {}));
    window.addEventListener("seances-modifiees", () => {
      oublier("/api/seances");
      this.relire();
    });
  }

  ouvrir() {
    this.actif = true;
    this.relire();
    this.afficher();
  }

  fermer() {
    this.actif = false;
  }

  recu(jeu) {
    this.jeu = jeu;
    this.retenir();
    this.relire();
    this.afficher();
  }

  // Lu même replié : la ligne du titre dit qui attend, et le combat de la séance doit être retenu (retenir).
  async relire() {
    if (!this.actif) return;
    const [seances, campagne] = await Promise.all([
      lire("/api/seances", 15000).catch(() => null), lire("/api/campagne", 60000).catch(() => null),
    ]);
    if (seances) this.seance = seanceDuJournal(seances);
    if (campagne) this.campagne = campagne;
    this.afficher();
  }

  surJournal({ id, journal }) {
    oublier("/api/seances");
    if (this.seance && this.seance.id === id && Array.isArray(journal)) {
      this.seance = { ...this.seance, journal };
      this.afficher();
    }
  }

  // Le combat de cette séance, vu passer : l'heure où chacun y a eu la main reste (moments.js, retenirCombat).
  vus() {
    if (!this.seance) return {};
    try {
      const v = JSON.parse(lireCle(VUS + this.seance.id) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }

  combatDeLaSeance() {
    return this.jeu?.combat && this.seance && this.jeu.seance === this.seance.id ? this.jeu.combat : null;
  }

  retenir() {
    const combat = this.combatDeLaSeance();
    if (!combat) return;
    const avant = this.vus();
    const apres = retenirCombat(avant, combat, Date.now());
    if (apres !== avant) garderCle(VUS + this.seance.id, JSON.stringify(apres));
  }

  calcul() {
    const fiches = this.jeu?.fiches || [];
    const heros = herosDeLaSeance({ tablee: this.campagne?.tablee, seance: this.seance, fiches });
    const r = moments({
      journal: this.seance?.journal || [], heros: heros.map((f) => ({ id: f.id, nom: f.nom })), maintenant: Date.now(),
      combat: this.combatDeLaSeance(), vus: this.vus(),
    });
    return { heros, r };
  }

  afficher() {
    if (!this.actif) return;
    const neuf = document.createElement("div");
    neuf.innerHTML = this.html();
    accorderEnfants(this.section, neuf);
  }

  html() {
    const { heros, r } = this.seance && this.jeu ? this.calcul() : { heros: [], r: null };
    const oublies = r ? heros.filter((f) => r.oublies.includes(f.id)) : [];
    const resume = oublies.length ? `${enListe(oublies.map((f) => prenom(f.nom)))} ${oublies.length > 1 ? "attendent leur" : "attend son"} moment` : "";
    return `
      <h3 class="ta-tete">
        <button type="button" data-ta="replier" aria-expanded="${this.ouverte}">Chacun son moment</button>
        ${!this.ouverte && resume ? `<small>${e(resume)}</small>` : ""}
      </h3>
      ${this.ouverte ? `<div class="ta-corps">${this.htmlCorps(heros, r, oublies)}</div>` : ""}`;
  }

  htmlCorps(heros, r, oublies) {
    if (this.seance === undefined || !this.jeu) return '<p class="vide">Lecture…</p>';
    if (!this.seance) return '<p class="vide">Aucune séance ouverte : créez-la dans Séances, le journal dira qui a eu son moment.</p>';
    if (!heros.length) return '<p class="vide">Personne à la tablée.</p>';
    const x0 = oublies[0];
    const qui = (f) => (f.genre === "f" ? "elle" : "lui");
    const conseil = oublies.length === 1
      ? `${e(prenom(x0.nom))} attend son moment depuis ${e(duree(r.heros.find((x) => x.id === x0.id).minutes))}. Une scène pour ${qui(x0)} ?`
      : oublies.length ? `${e(enListe(oublies.map((f) => prenom(f.nom))))} attendent leur moment depuis ${e(duree(r.heros.find((x) => x.id === x0.id).minutes))}.` : "";
    return `
        ${conseil ? `<p class="ta-conseil">${conseil}</p>` : ""}
        <ul class="ta-heros">${heros.map((f) => this.htmlHeros(f, r)).join("")}</ul>
        ${r.debut === null ? '<p class="aide">Rien au journal aujourd\'hui. Notez ce qui se passe (bouton Journal, touche N) : chacun aura son compte ici.</p>' : ""}`;
  }

  htmlHeros(fiche, r) {
    const x = r.heros.find((h) => h.id === fiche.id);
    const oublie = r.oublies.includes(fiche.id);
    const nom = prenom(fiche.nom) || "Sans nom";
    let depuis = "";
    let titre = "";
    if (x.minutes !== null) {
      if (x.depuis === "combat" && x.auCombat) [depuis, titre] = ["au combat", "A déjà eu la main dans le combat en cours"];
      else if (x.depuis === "combat") [depuis, titre] = [depuisEnClair(x.minutes), "Son dernier tour de combat"];
      else if (x.depuis === "debut") [depuis, titre] = [x.minutes < 1 ? "rien encore" : `rien depuis ${duree(x.minutes)}`, `Aucune ligne du journal ne ${fiche.genre === "f" ? "la" : "le"} cite depuis le début de la séance`];
      else [depuis, titre] = [depuisEnClair(x.minutes), `Au journal : « ${x.ligne} »`];
    }
    const part = x.minutes === null ? 0 : Math.min(1, x.minutes / r.echelle);
    const envie = envieDuHeros(fiche);
    const deplie = this.deplies.has(fiche.id);
    return `
          <li class="ta-heros-ligne${oublie ? " oublie" : ""}">
            <div class="ta-heros-tete" title="${e(fiche.nom || "")}">
              <span class="puce-heros" style="background:${e(couleurSure(fiche.couleur))}"></span>
              <b>${e(nom)}</b>
              ${x.minutes !== null ? `<span class="ta-barre" aria-hidden="true"><i style="width:${Math.round(part * 100)}%"></i></span>` : '<span class="ta-barre vide" aria-hidden="true"></span>'}
              <span class="ta-depuis" title="${e(titre)}">${e(depuis)}</span>
            </div>
            ${envie
              ? `<button type="button" class="ta-envie${deplie ? " deplie" : ""}" data-ta="envie" data-id="${e(fiche.id)}" aria-expanded="${deplie}" title="${e(envie.entier)}">${e(deplie ? envie.entier : envie.ligne)}</button>`
              : `<p class="ta-envie vide">Sa fiche ne dit pas ce qu'${fiche.genre === "f" ? "elle" : "il"} cherche.</p>`}
          </li>`;
  }

  clic(ev) {
    const b = ev.target.closest("[data-ta]");
    if (!b) return;
    if (ev.detail) b.blur?.();
    if (b.dataset.ta === "replier") {
      this.ouverte = !this.ouverte;
      garderCle(MEMOIRE, this.ouverte ? "oui" : "non");
      this.relire();
      return this.afficher();
    }
    if (b.dataset.ta === "envie") {
      const id = b.dataset.id;
      if (this.deplies.has(id)) this.deplies.delete(id);
      else this.deplies.add(id);
      this.afficher();
    }
  }
}
