// La palette du mobilier dans l'éditeur de plans : plus de cent pièces, rangées par familles repliables, une recherche
// par nom et les pièces posées dernièrement. L'éditeur rend le panneau (html) à chaque changement ; la palette garde son
// état (familles ouvertes, recherche, récents) et répond seule à la frappe et aux familles qu'on ouvre, sans le refaire.
// Les vignettes ne se dessinent que pour ce qui se voit : une famille fermée n'en coûte aucune.

import { echapper as e } from "../api.js";
import { MOBILIER, MEUBLES } from "./modele.js";

const CLE_RECENTS = "atelier-plan-meubles-recents";
const CLE_OUVERTES = "atelier-plan-meubles-familles";
const MAX_RECENTS = 8;

// Des mots de plus pour la recherche : ce qu'on tape sans connaître le nom exact.
const MOTS = {
  chene: "arbre", sapin: "arbre conifere pin", bouleau: "arbre", saule: "arbre pleureur", "arbre-mort": "arbre sec",
  buisson: "haie arbuste", fougeres: "plante", tonneau: "barrique fut", "tonneau-couche": "barrique fut", "tonneaux-empiles": "barriques futs",
  "etagere-bouteilles": "vin", comptoir: "bar", "comptoir-angle": "bar", "table-banquet": "festin", lit: "couche", "lit-double": "couche",
  etal: "marche echoppe", presentoir: "vitrine armes", ratelier: "armes epees lances", mannequin: "armure", forge: "feu foyer",
  candelabre: "bougies chandelles lumiere feu", torchere: "torche lumiere flambeau feu", brasero: "feu lumiere", "feu-de-camp": "feu lumiere",
  cheminee: "feu foyer", four: "feu pain", tapis: "teinte", stalle: "cheval ecurie", foin: "paille",
  "cheminee-angle": "feu foyer", cristaux: "lumiere gemmes", fosse: "trou puits", herse: "grille porte", "grille-egout": "egout",
  "cercle-rituel": "magie runes", toiles: "araignee", riviere: "eau ruisseau", pont: "riviere", ponton: "quai embarcadere",
  barque: "bateau canot", mat: "navire", gouvernail: "navire barre", bitte: "quai", passerelle: "navire planche",
  "mur-ruine": "ruine", eboulis: "rochers ruine", gravats: "ruine", bibliotheque: "livres", "pile-livres": "livres",
  "tapis-rond": "teinte", "tapis-long": "teinte chemin", tenture: "tapisserie teinte", banniere: "etendard drapeau teinte",
  tente: "camp teinte", sacs: "grain farine", caisses: "cargaison", colimacon: "escalier", "coffre-fer": "tresor", "coffre-ouvert": "tresor or",
};

const simple = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lire(cle, defaut) {
  try {
    const v = JSON.parse(localStorage.getItem(cle));
    return Array.isArray(v) ? v : defaut;
  } catch {
    return defaut;
  }
}

function garder(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // Navigation privée ou stockage refusé : la palette garde son état pour la séance.
  }
}

export class PaletteMeubles {
  // vignette(cle) : l'image d'une pièce dans le style du plan (l'éditeur la garde en cache).
  constructor(vignette) {
    this.vignette = vignette;
    this.recherche = "";
    this.recents = lire(CLE_RECENTS, []).filter((c) => MEUBLES[c]).slice(0, MAX_RECENTS);
    const ouvertes = lire(CLE_OUVERTES, null);
    this.ouvertes = new Set(ouvertes || [MOBILIER[0].groupe]);
    this.index = MOBILIER.flatMap((g) => g.liste.map((m) => ({ m, g: g.groupe, texte: simple(`${m.nom} ${m.cle.replace(/-/g, " ")} ${MOTS[m.cle] || ""} ${g.groupe}`) })));
  }

  // Une pièce posée : elle entre dans les récents (en tête si elle n'y était pas ; sinon elle garde sa place, pour que
  // la rangée ne bouge pas sous le doigt pendant une pose en série).
  noter(cle) {
    if (!MEUBLES[cle] || this.recents.includes(cle)) return;
    this.recents = [cle, ...this.recents].slice(0, MAX_RECENTS);
    garder(CLE_RECENTS, this.recents);
  }

  bouton(m, choisi, avecImage) {
    return `<button role="radio" aria-checked="${choisi === m.cle}" data-opt-bouton="meuble.cle" data-valeur="${m.cle}" title="${e(m.nom)}">`
      + `<img ${avecImage ? `src="${this.vignette(m.cle)}"` : ""} data-vignette="${m.cle}" alt="" width="40" height="40"><span>${e(m.nom)}</span></button>`;
  }

  trouves() {
    const mots = simple(this.recherche).split(/\s+/).filter(Boolean);
    return mots.length ? this.index.filter((x) => mots.every((w) => x.texte.includes(w))) : [];
  }

  htmlResultats(choisi) {
    const liste = this.trouves();
    return liste.length
      ? `<div class="palette-meubles">${liste.map((x) => this.bouton(x.m, choisi, true)).join("")}</div>`
      : `<p class="aide">Aucune pièce ne s'appelle ainsi. Essayez « arbre », « feu », « tapis », « navire »…</p>`;
  }

  // Le contenu de la palette, pour le panneau de l'outil Mobilier.
  html(choisi) {
    // La famille de la pièce choisie s'ouvre d'elle-même : on voit toujours ce qu'on va poser.
    const famille = MOBILIER.find((g) => g.liste.some((m) => m.cle === choisi));
    if (famille) this.ouvertes.add(famille.groupe);
    const recents = this.recents.filter((c) => MEUBLES[c]);
    const cherche = !!this.recherche.trim();
    return `
      <div class="palette-recherche" role="search">
        <input type="search" data-recherche-meuble placeholder="Chercher : arbre, feu, tapis…" value="${e(this.recherche)}" aria-label="Chercher une pièce de mobilier" autocomplete="off" spellcheck="false">
      </div>
      <div class="palette-resultats" ${cherche ? "" : "hidden"}>${cherche ? this.htmlResultats(choisi) : ""}</div>
      <div class="palette-familles" ${cherche ? "hidden" : ""}>
        ${recents.length ? `<section class="palette-recents"><h4>Posées dernièrement</h4><div class="palette-meubles">${recents.map((c) => this.bouton(MEUBLES[c], choisi, true)).join("")}</div></section>` : ""}
        ${MOBILIER.map((g) => {
          const ouverte = this.ouvertes.has(g.groupe);
          return `<details class="famille-meubles" data-famille="${e(g.groupe)}" ${ouverte ? "open" : ""}>
            <summary><span>${e(g.groupe)}</span><span class="compte">${g.liste.length}</span></summary>
            <div class="palette-meubles">${g.liste.map((m) => this.bouton(m, choisi, ouverte)).join("")}</div>
          </details>`;
        }).join("")}
      </div>`;
  }

  // À brancher une fois sur le panneau de l'éditeur (il garde son élément, seul son contenu change). choisi() : la
  // pièce que l'outil posera.
  brancher(panneau, choisi) {
    panneau.addEventListener("toggle", (ev) => {
      const d = ev.target;
      if (!(d instanceof HTMLDetailsElement) || !d.dataset.famille) return;
      if (d.open) {
        this.ouvertes.add(d.dataset.famille);
        for (const img of d.querySelectorAll("img[data-vignette]:not([src])")) img.src = this.vignette(img.dataset.vignette);
      } else this.ouvertes.delete(d.dataset.famille);
      garder(CLE_OUVERTES, [...this.ouvertes]);
    }, true);
    panneau.addEventListener("input", (ev) => {
      const champ = ev.target;
      if (!champ.matches || !champ.matches("[data-recherche-meuble]")) return;
      this.recherche = champ.value;
      const res = panneau.querySelector(".palette-resultats");
      const fam = panneau.querySelector(".palette-familles");
      if (!res || !fam) return;
      const actif = !!this.recherche.trim();
      res.hidden = !actif;
      fam.hidden = actif;
      res.innerHTML = actif ? this.htmlResultats(choisi()) : "";
    });
    panneau.addEventListener("keydown", (ev) => {
      // Entrée choisit la première pièce trouvée (Échap suit la règle de l'atelier, echap.js : le champ rend la main).
      if (ev.key !== "Enter" || !ev.target.matches || !ev.target.matches("[data-recherche-meuble]")) return;
      ev.preventDefault();
      const premier = panneau.querySelector(".palette-resultats button[data-valeur]");
      if (premier) premier.click();
    });
  }
}
