// Les mains levées et les joueurs en ligne, dans le Tableau du MJ (tableau.js, bouton Tableau, touche T), et le signe
// de l'en-tête : un joueur touche « Je veux agir » sur son téléphone, et dans la seconde, le bouton Tableau porte une
// pastille dorée avec le nombre de mains, sur toutes les pages, Tableau fermé compris. Tableau ouvert, en tête : les
// mains dans l'ordre où elles se sont levées, avec le prénom du joueur et son héros, « Donner la parole » (le joueur
// lit « À vous ! ») et « Plus tard » (la main se baisse sans un mot) ; puis « En ligne : Paul, Jeanne ». La ligne du
// héros s'allume aussi, au combat comme hors combat (salle.js, la feuille des marques).

import { accorderEnfants } from "../commun/accorder.js";
import { echapper as e, toast } from "../api.js";
import { enListe, ecouterLaSalle, prenomDe, repondre } from "./salle.js";

const heure = (iso) => {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
};

export class MainsDuTableau {
  constructor(panneau, bouton) {
    this.bouton = bouton;
    this.ouvert = false;
    this.vue = null;
    this.vues = new Set(); // les mains déjà annoncées (une seule fois chacune)
    this.premiere = true;
    this.zone = document.createElement("section");
    this.zone.className = "salle-tableau";
    this.zone.setAttribute("aria-label", "Mains levées et joueurs en ligne");
    this.zone.hidden = true;
    (panneau.querySelector(".tableau-tete") || panneau.firstElementChild)?.after(this.zone);
    // Ce que dit un lecteur d'écran quand une main se lève, Tableau fermé compris.
    this.voix = document.createElement("p");
    this.voix.className = "salle-voix";
    this.voix.setAttribute("aria-live", "polite");
    document.body.append(this.voix);
    this.zone.addEventListener("click", (ev) => this.clic(ev));
    ecouterLaSalle((v) => this.salle(v));
  }

  // L'interface des aides du Tableau (ouvrir, fermer, recu) : la salle arrive par son propre canal.
  ouvrir() {
    this.ouvert = true;
    this.dessiner();
  }

  fermer() {
    this.ouvert = false;
  }

  recu() {}

  salle(v) {
    this.vue = v;
    const mains = v?.mains || [];
    const nouvelles = mains.filter((m) => !this.vues.has(m.id));
    for (const m of mains) this.vues.add(m.id);
    this.signe(mains, nouvelles.length > 0 && !this.premiere);
    if (nouvelles.length && !this.premiere) this.voix.textContent = `${enListe(nouvelles.map(prenomDe))} ${nouvelles.length > 1 ? "lèvent" : "lève"} la main.`;
    this.premiere = false;
    this.dessiner();
  }

  // Le bouton Tableau de l'en-tête : le nombre de mains levées, et qui, dans sa bulle.
  signe(mains, arrivee) {
    const b = this.bouton;
    if (!b) return;
    if (!b.dataset.titre) b.dataset.titre = b.title || "";
    if (mains.length) {
      b.dataset.mainsLevees = String(mains.length);
      b.title = `${enListe(mains.map(prenomDe))} ${mains.length > 1 ? "lèvent" : "lève"} la main : ouvrir le Tableau (touche T)`;
    } else {
      delete b.dataset.mainsLevees;
      b.title = b.dataset.titre;
    }
    if (arrivee) {
      b.classList.remove("main-arrivee");
      void b.offsetWidth; // l'éclat repart à chaque nouvelle main
      b.classList.add("main-arrivee");
    }
  }

  dessiner() {
    const v = this.vue;
    if (!this.ouvert) return;
    this.zone.hidden = !v || !(v.mains.length || v.invites);
    if (this.zone.hidden) return;
    const neuf = document.createElement("div");
    neuf.innerHTML = `${this.htmlMains(v)}${this.htmlEnLigne(v)}`;
    accorderEnfants(this.zone, neuf);
  }

  htmlMains(v) {
    if (!v.mains.length) return "";
    return `
      <div class="salle-mains">
        <h3>${v.mains.length > 1 ? `${v.mains.length} mains levées` : "Main levée"}</h3>
        <ol>${v.mains.map((m) => `
          <li class="main-mj" data-main="${e(m.id)}" data-joueur="${e(m.joueur)}">
            ${v.mains.length > 1 ? `<span class="rang" aria-label="${m.rang}${m.rang === 1 ? "re" : "e"} main">${m.rang}</span>` : ""}
            <span class="qui"><b>${e(prenomDe(m))}</b>${m.heros?.nom ? `<small>${e(m.heros.nom)}</small>` : '<small class="pale">sans héros à la tablée</small>'}</span>
            <span class="gestes">
              <button type="button" class="principal" data-salle="parole" title="${e(`${prenomDe(m)} lit « À vous ! » sur son téléphone`)}">Donner la parole</button>
              <button type="button" data-salle="plus-tard" title="La main se baisse, sans un mot">Plus tard</button>
            </span>
          </li>`).join("")}
        </ol>
      </div>`;
  }

  htmlEnLigne(v) {
    if (!v.invites) return "";
    if (!v.presence?.a_jour) {
      const quand = heure(v.presence?.maj);
      return `<p class="salle-en-ligne muet">Le coin des joueurs ne donne plus de nouvelles${quand ? ` depuis ${quand}` : ""} : qui est en ligne, on ne sait pas.</p>`;
    }
    if (!v.en_ligne.length) return '<p class="salle-en-ligne personne">Personne au coin des joueurs en ce moment.</p>';
    const noms = v.en_ligne.map((x) => `<span class="present" title="${e(x.heros?.nom ? `${prenomDe(x)} joue ${x.heros.nom}` : `${prenomDe(x)}, sans héros à la tablée`)}">${e(prenomDe(x))}</span>`);
    return `<p class="salle-en-ligne"><span class="point" aria-hidden="true"></span>En ligne : ${enListe(noms)}</p>`;
  }

  async clic(ev) {
    const b = ev.target.closest("button[data-salle]");
    const li = b?.closest("[data-main]");
    if (!b || !li || b.getAttribute("aria-busy") === "true") return;
    if (ev.detail) b.blur();
    const main = (this.vue?.mains || []).find((m) => m.id === li.dataset.main && m.joueur === li.dataset.joueur);
    if (!main) return;
    for (const x of li.querySelectorAll("button")) x.disabled = true;
    b.setAttribute("aria-busy", "true");
    try {
      await repondre(main, b.dataset.salle);
      if (b.dataset.salle === "parole") toast(`La parole est à ${prenomDe(main)}.`);
    } catch (err) {
      toast(err.status === 409 ? `${prenomDe(main)} : ${err.message}` : `Main non traitée : ${err.message}`, "erreur");
      for (const x of li.querySelectorAll("button")) x.disabled = false;
    } finally {
      b.removeAttribute("aria-busy");
    }
  }
}
