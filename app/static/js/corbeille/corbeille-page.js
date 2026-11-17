// La corbeille de l'atelier (#/corbeille) et les versions précédentes d'une fiche (#/versions/<collection>/<id>) : ce
// que le serveur gardait déjà sans écran (corbeille.py), avec « Remettre » et « Revenir à cette version ». Rien ne part
// vers la TV d'ici.

import { api, echapper as e, toast } from "../api.js";
import { remettreALaTablee, rouvrir } from "./corbeille.js";
import { ajouterLienAtelier } from "../commun/liens-atelier.js";
import { calculerMurs } from "../plan/modele.js";
import { dessinerPlan } from "../plan/rendu.js";

// Les genres de fiches, dans l'ordre des onglets : leur nom au pluriel et au singulier, l'onglet qui les tient, et où
// rouvrir une fiche remise.
const GENRES = [
  ["cartes", "Cartes", "Carte", "cartes", (id) => `#/carte/${id}`],
  ["plans", "Plans", "Plan", "cartes", (id) => `#/plan/${id}`],
  ["lieux", "Lieux", "Lieu", "lieux", () => "#/lieux"],
  ["pnj", "PNJ", "PNJ", "pnj", (id) => `#/pnj/${id}`],
  ["aventuriers", "Aventuriers", "Aventurier", "aventuriers", (id) => `#/aventuriers/${id}`],
  ["contrats", "Contrats de l'auberge", "Contrat", "auberge", (id) => `#/auberge/contrat/${id}`],
  ["rumeurs", "Rumeurs", "Rumeur", "auberge", (id) => `#/auberge/rumeur/${id}`],
  ["boutiques", "Boutiques", "Boutique", "boutiques", (id) => `#/boutiques/${id}`],
  ["scenarios", "Scénarios", "Scénario", "scenarios", (id) => `#/scenarios/${id}`],
  ["seances", "Séances", "Séance", "seances", (id) => `#/seances/${id}`],
  ["fils", "Fils de la campagne", "Fil", "seances", () => "#/seances"],
  ["rencontres", "Rencontres", "Rencontre", "combats", (id) => `#/combats/${id}`],
  ["idees", "Idées", "Idée", "idees", () => "#/idees"],
  ["documents", "Documents remis aux joueurs", "Document", "documents", (id) => `#/documents/${id}`],
  ["regles-maison", "Règles maison", "Règle", "regles", (id) => `#/regles/${id}`],
];
const GENRE = Object.fromEntries(GENRES.map(([cle, pluriel, singulier, onglet, adresse]) => [cle, { pluriel, singulier, onglet, adresse }]));

// L'onglet à allumer quand on regarde les versions d'une fiche.
export const ongletDe = (collection) => GENRE[collection]?.onglet || "corbeille";

// Le petit lien « Corbeille », à côté du nom de l'atelier.
export function poserLienCorbeille() {
  ajouterLienAtelier({ libelle: "Corbeille", href: "#/corbeille", titre: "Ce qui a été mis à la corbeille, prêt à revenir" });
}

// L'heure ne se coupe pas en fin de ligne : « 18 h 02 », espaces insécables.
const heure = (d) => `${d.getHours()}\u00a0h\u00a0${String(d.getMinutes()).padStart(2, "0")}`.replace(/\u00a0h\u00a000$/, "\u00a0h");

// « aujourd'hui à 18 h 18 », « hier à 9 h », « dimanche 1er novembre à 21 h 43 »
export function quand(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = (x) => x.toLocaleDateString("sv");
  const maintenant = new Date();
  const hier = new Date(maintenant.getTime() - 864e5);
  const date = jour(d) === jour(maintenant) ? "aujourd'hui"
    : jour(d) === jour(hier) ? "hier"
    : d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== maintenant.getFullYear() ? { year: "numeric" } : {}) })
      .replace(/(^|\s)1(\s)/, "$11er$2");
  return `${date} à\u00a0${heure(d)}`;
}

// Un détail qui porte une date brute (« 2026-11-20 ») la dit comme le reste de l'atelier : « vendredi 20 novembre ».
const JOURS_BRUTS = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
export function detailLisible(texte) {
  return String(texte || "").replace(JOURS_BRUTS, (brut, a, m, j) => {
    const d = new Date(Date.UTC(+a, +m - 1, +j, 12));
    if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m - 1) return brut;
    const long = d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC", ...(+a !== new Date().getFullYear() ? { year: "numeric" } : {}) });
    return long.replace(/(^|\s)1(\s)/, "$11er$2");
  });
}

const nomDe = (x, collection) => x.nom || (collection === "aventuriers" ? "Aventurier sans nom" : GENRE[collection]?.singulier || "Sans nom");

export class Corbeille {
  constructor(racine) {
    this.racine = racine;
    this.detruit = false;
    this.elements = [];
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="page-liste corbeille"><div class="chargement">Ouverture de la corbeille…</div></section>`;
    const r = await api.get("/api/corbeille");
    if (this.detruit) return;
    this.elements = r.elements || [];
    this.afficher();
    this.racine.addEventListener("click", (ev) => this.clic(ev));
    this.racine.addEventListener("input", (ev) => ev.target.matches("[data-filtre]") && this.filtrer(ev.target.value));
  }

  // Le filtre masque ce qui ne contient pas les mots tapés (nom, détail, date) et les genres devenus vides.
  filtrer(texte) {
    const mots = String(texte || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
    const plat = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const genre of this.racine.querySelectorAll(".corbeille-genre")) {
      let vus = 0;
      for (const li of genre.querySelectorAll("li[data-fichier]")) {
        const contenu = plat(li.textContent || "");
        const garde = mots.every((m) => contenu.includes(m));
        li.hidden = !garde;
        if (garde) vus++;
      }
      genre.hidden = !vus;
    }
    const aucun = ![...this.racine.querySelectorAll(".corbeille-genre")].some((g) => !g.hidden);
    let vide = this.racine.querySelector(".corbeille-aucun");
    if (aucun && !vide) {
      vide = document.createElement("p");
      vide.className = "vide corbeille-aucun";
      vide.textContent = "Rien ne correspond à ces mots.";
      this.racine.querySelector(".corbeille-genre:last-of-type")?.after(vide);
    }
    if (!aucun) vide?.remove();
  }

  detruire() {
    this.detruit = true;
  }

  afficher() {
    const groupes = GENRES.map(([cle]) => [cle, this.elements.filter((x) => x.collection === cle)]).filter(([, liste]) => liste.length);
    const dernier = this.elements[0];
    this.racine.innerHTML = `
      <section class="page-liste corbeille">
        <header class="titre-page">
          <p class="kicker">Rien ne se perd</p>
          <h1>La corbeille</h1>
          <p class="chapo">Ce qui a été mis à la corbeille attend ici, rangé par genre, le plus récent en premier. «\u00a0Remettre\u00a0» le replace tel qu'il était, sous le même nom, et les liens qui menaient à lui remarchent.</p>
        </header>
        ${groupes.length ? `
        <label class="corbeille-filtre">Chercher dans la corbeille<input type="search" data-filtre autocomplete="off" placeholder="Un nom, une date, un détail"></label>
        <nav class="corbeille-genres" aria-label="Genres">
          ${groupes.map(([cle, liste]) => `<button type="button" class="lien" data-aller="${e(cle)}">${e(GENRE[cle].pluriel)} <span>${liste.length}</span></button>`).join("")}
        </nav>
        ${dernier ? `<p class="corbeille-derniere">Dernière mise à la corbeille : <b>${e(nomDe(dernier, dernier.collection))}</b>
          (${e(GENRE[dernier.collection]?.singulier.toLowerCase() || "")}), ${e(quand(dernier.jete))}.</p>` : ""}
        ${groupes.map(([cle, liste]) => `
          <section class="corbeille-genre" data-genre="${e(cle)}">
            <h2>${e(GENRE[cle].pluriel)} <span class="compte">${liste.length}</span></h2>
            <ul class="corbeille-liste">${liste.map((x) => this.htmlElement(x)).join("")}</ul>
          </section>`).join("")}` : `<p class="vide">La corbeille est vide. Ce que vous y mettrez attendra ici, prêt à revenir.</p>`}
      </section>`;
  }

  htmlElement(x) {
    return `
      <li data-fichier="${e(x.fichier)}" data-collection="${e(x.collection)}">
        <div class="quoi">
          <span class="nom">${e(nomDe(x, x.collection))}</span>
          ${x.detail ? `<span class="detail">${e(detailLisible(x.detail))}</span>` : ""}
        </div>
        <span class="jete-le">${e(quand(x.jete))}</span>
        <button type="button" data-remettre="${e(x.fichier)}" data-a-cote="${x.repris ? 1 : 0}"
          title="${x.repris ? "Revient à côté de la fiche qui a pris sa place" : "Revient à sa place, telle qu'elle était"}">${x.repris ? "Remettre à côté" : "Remettre"}</button>
        ${x.repris ? `<p class="repris">Sa place est prise depuis par « ${e(x.repris_par || "une autre fiche")} » : elle reviendra à côté, sous un autre identifiant, et les liens existants mèneront toujours à la fiche actuelle.</p>` : ""}
      </li>`;
  }

  async clic(ev) {
    const aller = ev.target.closest("[data-aller]");
    if (aller) {
      this.racine.querySelector(`.corbeille-genre[data-genre="${aller.dataset.aller}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    const b = ev.target.closest("[data-remettre]");
    if (!b || b.disabled) return;
    const li = b.closest("li");
    const x = this.elements.find((y) => y.fichier === li.dataset.fichier && y.collection === li.dataset.collection);
    if (!x) return;
    b.disabled = true;
    let r;
    try {
      r = await api.post(`/api/corbeille/${encodeURIComponent(x.collection)}/${encodeURIComponent(x.fichier)}/remettre`, { a_cote: b.dataset.aCote === "1" });
    } catch (err) {
      b.disabled = false;
      toast(`${nomDe(x, x.collection)} n'est pas revenu : ${err.message}`, "erreur");
      if (err.status === 404 || err.status === 409) this.relire();
      return;
    }
    if (x.collection === "aventuriers") {
      try {
        await remettreALaTablee(r.id);
      } catch (err) {
        toast(`Fiche remise, mais ${err.message}.`, "erreur");
      }
    }
    this.elements = this.elements.filter((y) => y !== x);
    if (!this.detruit) this.afficher();
    const adresse = GENRE[x.collection]?.adresse(encodeURIComponent(r.id));
    toast(`« ${r.nom || nomDe(x, x.collection)} » est de retour${r.a_cote ? ", à côté de la fiche qui a pris sa place" : ""}.`, "info", adresse ? {
      action: { libelle: "Ouvrir", faire: () => rouvrir(adresse) },
    } : {});
  }

  async relire() {
    try {
      this.elements = (await api.get("/api/corbeille")).elements || [];
      if (!this.detruit) this.afficher();
    } catch {
      // on garde la liste affichée
    }
  }
}


// Les champs qu'on montre, dans l'ordre de la fiche ; les autres textes suivent.
const CHAMPS = {
  pnj: ["nom", "surnom", "genre", "role", "peuple", "age", "faction", "lieu", "statut", "attitude", "rang", "connu", "apparence", "voix", "envie", "secret", "offre", "capacites", "scenario", "notes"],
  lieux: ["nom", "type", "carte", "connu", "a_valider", "resume", "secrets", "notes"],
  aventuriers: ["nom", "joueur", "genre", "peuple", "vocations", "specialite", "niveau", "physique", "social", "mental", "sante", "psy", "posture", "competences", "dons", "armes", "or", "equipement", "objets", "histoire", "secret", "notes_mj"],
  scenarios: ["nom", "resume", "etat", "chapitres"],
  seances: ["nom", "numero", "date", "heure", "scenario", "objectif", "deroule", "conseils", "fin", "resume", "precedemment", "butin", "questions", "notes"],
  fils: ["nom", "faction", "but", "fin", "etapes", "avance", "actif"],
  rencontres: ["nom", "adversaires", "avant", "moral", "notes"],
  boutiques: ["nom", "accroche", "marchand", "lieu", "ajustement", "articles", "notes_mj"],
  contrats: ["nom", "genre", "etat", "lieu", "affiche", "recompense", "contact", "mention", "verite", "commanditaire"],
  rumeurs: ["texte", "source", "verite", "fond", "etat"],
  idees: ["texte", "etat", "mots"],
  "regles-maison": ["titre", "texte", "statut", "depuis", "publique", "contexte"],
  plans: ["nom", "lieu", "etage", "largeur", "hauteur", "pieces", "pions", "notes"],
  cartes: ["nom", "largeur", "hauteur", "km_case", "style", "marqueurs", "traces", "etiquettes"],
};
const LIBELLES = {
  nom: "Nom", surnom: "Surnom", role: "Rôle", peuple: "Peuple", age: "Âge", faction: "Faction", statut: "Statut",
  attitude: "Attitude", rang: "Rang", connu: "Connu des joueurs", apparence: "Apparence", voix: "Voix",
  envie: "Ce qu'il veut", secret: "Secret", secrets: "Secrets", offre: "Ce qu'il peut offrir", capacites: "Capacités",
  scenario: "Scénario", notes: "Notes", notes_mj: "Notes du MJ", type: "Genre de lieu", carte: "Carte", lieu: "Lieu",
  a_valider: "À valider", resume: "Résumé", joueur: "Joué par", vocations: "Vocations", specialite: "En quelques mots",
  niveau: "Niveau", physique: "Physique", social: "Social", mental: "Mental", sante: "Santé", psy: "Psy",
  posture: "Posture", competences: "Compétences", dons: "Dons", armes: "Armes", or: "Or", equipement: "Équipement",
  objets: "Objets personnels", histoire: "Histoire", etat: "État", chapitres: "Chapitres", numero: "Numéro",
  date: "Date", heure: "Heure", objectif: "Objectif", deroule: "Déroulé", conseils: "Conseils", fin: "Fin",
  precedemment: "Précédemment", butin: "Butin", questions: "Questions", but: "But", etapes: "Étapes", avance: "Avance",
  actif: "Actif", adversaires: "Adversaires", avant: "Avant le combat", moral: "Moral", accroche: "Accroche",
  marchand: "Marchand", ajustement: "Ajustement des prix", articles: "Articles", genre: "Genre",
  affiche: "Texte de l'affiche", recompense: "Récompense", contact: "Contact", mention: "Mention", verite: "Vérité",
  commanditaire: "Commanditaire", texte: "Texte", source: "Source", fond: "Le fond de l'affaire", mots: "Mots-clés",
  titre: "Titre", depuis: "En vigueur depuis", publique: "Publique", contexte: "Contexte", etage: "Niveau ou partie",
  largeur: "Largeur", hauteur: "Hauteur", pieces: "Pièces", pions: "Pions", km_case: "Kilomètres par case",
  style: "Style", marqueurs: "Lieux posés", traces: "Tracés", etiquettes: "Noms de région", etiquette: "Étiquette",
  origine: "Origine des noms", element: "Élément", langues: "Langues", allure: "Allure", defaut: "Défaut",
  particularites: "Particularités", contacts: "Contacts",
};
// Les mêmes champs portent un autre sens selon la fiche.
const LIBELLES_DE = {
  aventuriers: { avant: "Ce qu'il était avant", pourquoi: "Pourquoi l'aventure", jamais: "Ce qu'il ne fera jamais" },
  rumeurs: { texte: "Ce qu'on raconte" },
};
// Les valeurs tenues en abrégé dans les fiches, en toutes lettres.
const VALEURS = {
  ecriture: "en écriture", pret: "prêt", "a-trancher": "à trancher", "en-vigueur": "en vigueur", "a-placer": "à placer",
  "a-creuser": "à creuser", entendue: "entendue", brouillon: "brouillon", affiche: "affiché", pris: "pris",
  defensive: "défensive", offensive: "offensive", focus: "focus", elite: "élite",
};
const GENRES_PERSONNE = { h: "homme", f: "femme" };
// Ce qui ne se lit pas tel quel mais compte : un changement s'y annonce sous ce nom.
const DESSIN = {
  plans: { sol: "le dessin du plan", piece: "le dessin du plan", portes: "les portes", objets: "le mobilier",
    textes: "les textes posés", brouillard: "ce qui est révélé aux joueurs", brume: "la brume", habillage: "l'habillage",
    fond: "l'image de fond", quadrillage: "le quadrillage", brouillard_actif: "le brouillard", m_case: "l'échelle" },
  cartes: { terrain: "le terrain", brouillard: "ce qui est révélé aux joueurs", decor: "le décor", habillage: "l'habillage" },
  pnj: { profil: "le profil de combat" },
  aventuriers: { protection: "l'armure", themes: "les thèmes", progression: "la progression", couleur: "la couleur des dés" },
  rencontres: { verdict: "le verdict de la balance" },
};
// Ni l'intendance (identifiants, dates, images, champs tenus par leurs propres routes), ni les grilles brutes.
const INTENDANCE = new Set(["id", "cree", "modifie", "illustrations", "illustration", "version_base", "texte_modifie",
  "reponses", "relectures", "journal", "combat"]);
const CACHES = new Set([...INTENDANCE, "repere", "ordre", "source", "sol", "piece", "brouillard", "brume", "terrain", "fond",
  "habillage", "portes", "decor", "corbeille", "lien", "lien_avec", "couleur", "progression", "verdict", "profil", "themes",
  "protection", "seances_closes", "vues", "objets_plan", "textes", "quadrillage", "brouillard_actif", "m_case", "scenario_id",
  "fils_touches", "presents", "reputations", "close", "pnj", "lieux", "contrats", "rumeurs", "rencontres", "parent",
  "taille_textes", "mots", "fil"]);

const oui = (v) => (v === true ? "oui" : v === false ? "non" : String(v ?? ""));

function texteDe(x) {
  if (x === null || x === undefined) return "";
  if (typeof x !== "object") return String(x);
  if (Array.isArray(x)) return x.map(texteDe).filter(Boolean).join(" · ");
  return [x.nom || x.titre || x.texte || "", x.nombre > 1 ? `× ${x.nombre}` : "", x.prix ? `${x.prix} po` : "",
    typeof x.stock === "number" ? `(stock ${x.stock})` : ""].filter(Boolean).join(" ");
}

function champsLisibles(collection, fiche) {
  const ordre = CHAMPS[collection] || ["nom"];
  const autres = Object.keys(fiche).filter((k) => !ordre.includes(k) && !CACHES.has(k) && typeof fiche[k] === "string" && fiche[k].trim());
  return [...ordre, ...autres].filter((k) => k in fiche && !CACHES.has(k)).filter((k) => {
    const v = fiche[k];
    return !(v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length));
  });
}

const pareil = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const libelle = (k, collection) => LIBELLES_DE[collection]?.[k] || LIBELLES[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function vignettePlan(p) {
  if (!p || !p.largeur || !p.hauteur || !Array.isArray(p.sol)) return "";
  const k = Math.max(3, Math.min(9, Math.floor(420 / Math.max(p.largeur, p.hauteur * 1.5))));
  const toile = document.createElement("canvas");
  toile.width = p.largeur * k;
  toile.height = p.hauteur * k;
  const ctx = toile.getContext("2d");
  ctx.setTransform(k, 0, 0, k, 0, 0);
  try {
    dessinerPlan(ctx, p, calculerMurs(p), { x0: 0, y0: 0, x1: p.largeur, y1: p.hauteur }, { style: "couleur", quadrillage: false });
  } catch {
    return "";
  }
  return toile.toDataURL("image/png");
}

export class Versions {
  constructor(racine, { collection, id, parametres }) {
    this.racine = racine;
    this.collection = collection;
    this.id = id;
    this.retour = parametres?.get("retour") || GENRE[collection]?.adresse(encodeURIComponent(id)) || "#/cartes";
    this.detruit = false;
    this.choisie = null;
    this.cache = new Map();
    this.noms = { lieu: {}, carte: {}, marchand: {} };
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="versions"><div class="chargement">Lecture des versions…</div></section>`;
    const c = this.collection;
    // Les fiches liées s'affichent sous leur nom : le lieu d'un PNJ, la carte d'un lieu, le marchand d'une boutique.
    const nomsDe = (url, garder) => (garder ? api.get(url).then((l) => Object.fromEntries(l.map((x) => [x.id, x.nom]))).catch(() => ({})) : {});
    const [liste, actuelle, lieux, cartes, pnj] = await Promise.all([
      api.get(`/api/versions/${encodeURIComponent(c)}/${encodeURIComponent(this.id)}`),
      api.get(`/api/${encodeURIComponent(c)}/${encodeURIComponent(this.id)}`),
      nomsDe("/api/lieux", ["pnj", "plans", "boutiques", "contrats"].includes(c)),
      nomsDe("/api/cartes", c === "lieux"),
      nomsDe("/api/pnj", c === "boutiques"),
    ]);
    if (this.detruit) return;
    this.noms = { lieu: lieux, carte: cartes, marchand: pnj };
    this.liste = liste;
    this.actuelle = actuelle;
    this.racine.innerHTML = this.gabarit();
    this.racine.addEventListener("click", (ev) => this.clic(ev));
    if (liste.versions.length) await this.choisir(liste.versions[0].version);
  }

  detruire() {
    this.detruit = true;
  }

  gabarit() {
    const g = GENRE[this.collection];
    const l = this.liste;
    return `
      <section class="versions">
        <aside class="versions-liste">
          <header>
            <p class="kicker">Versions précédentes</p>
            <h1>${e(l.nom || "Sans nom")}</h1>
            <a class="versions-retour" href="${e(this.retour)}">Retour à la fiche</a>
          </header>
          ${l.versions.length ? `<ol>${l.versions.map((v) => `
            <li><button type="button" data-version="${e(v.version)}">
              <span class="version-date">${e(quand(v.modifie || v.date))}</span>
              <span class="meta">${v.nom && v.nom !== l.nom ? `sous le nom « ${e(v.nom)} » · ` : ""}remplacée ${e(quand(v.date))}</span>
            </button></li>`).join("")}</ol>` : ""}
          <p class="aide">Une version est gardée à chaque changement, toutes les cinq minutes au plus, et les ${this.collection === "scenarios" ? "deux cents" : "quarante"} dernières restent. Revenir à l'une d'elles garde l'actuelle dans cette liste.</p>
        </aside>
        <article class="version-apercu">${l.versions.length ? "" : `<p class="vide">Aucune version gardée pour l'instant : la première le sera au prochain changement de la fiche.</p>`}</article>
      </section>`;
  }

  async choisir(version) {
    this.choisie = version;
    for (const b of this.racine.querySelectorAll("[data-version]")) b.setAttribute("aria-current", String(b.dataset.version === version));
    const zone = this.racine.querySelector(".version-apercu");
    let fiche = this.cache.get(version);
    if (!fiche) {
      zone.innerHTML = `<p class="chargement">Lecture de la version…</p>`;
      try {
        fiche = await api.get(`/api/versions/${encodeURIComponent(this.collection)}/${encodeURIComponent(this.id)}/${encodeURIComponent(version)}`);
      } catch (err) {
        if (this.choisie === version) zone.innerHTML = `<p class="vide">Version illisible : ${e(err.message)}.</p>`;
        return;
      }
      this.cache.set(version, fiche);
    }
    if (this.detruit || this.choisie !== version) return;
    zone.innerHTML = this.htmlApercu(version, fiche);
    zone.scrollTop = 0;
  }

  // Une valeur lisible : un texte avec ses paragraphes, une liste, oui ou non, le nom d'une fiche liée.
  htmlValeur(cle, v) {
    if (typeof v === "boolean") return e(oui(v));
    if (this.noms[cle] && typeof v === "string") return e(this.noms[cle][v] || v);
    if (cle === "genre" && GENRES_PERSONNE[v]) return e(GENRES_PERSONNE[v]);
    if (typeof v === "string" && VALEURS[v]) return e(VALEURS[v]);
    if (Array.isArray(v)) {
      if (cle === "chapitres") {
        const avant = Object.fromEntries((this.actuelle.chapitres || []).map((c) => [c.id, c]));
        return v.map((c) => {
          const change = !pareil(c, avant[c.id]);
          return `<details ${change ? "open" : ""}><summary>${e(c.titre || "Sans titre")}${change ? ' <span class="pastille-change">changé depuis</span>' : ""}</summary><div class="texte-version">${e(c.texte || "")}</div></details>`;
        }).join("");
      }
      if (["marqueurs", "traces", "etiquettes", "pions"].includes(cle)) return e(String(v.length));
      const lignes = v.map(texteDe).filter((x) => x.trim());
      return lignes.length ? `<ul>${lignes.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "<i>rien</i>";
    }
    if (v && typeof v === "object") return e(texteDe(v));
    return `<div class="texte-version">${e(String(v ?? ""))}</div>`;
  }

  htmlApercu(version, fiche) {
    const v = this.liste.versions.find((x) => x.version === version);
    const actuelle = this.actuelle;
    const champs = champsLisibles(this.collection, fiche);
    const actuels = new Set(champsLisibles(this.collection, actuelle));
    const changes = [...new Set([...champs, ...actuels])].filter((k) => !pareil(fiche[k], actuelle[k]));
    // Ce qui a changé sans se lire ici : le dessin d'un plan, le terrain d'une carte…
    const dessin = DESSIN[this.collection] || {};
    const autres = [...new Set(Object.keys({ ...fiche, ...actuelle }))]
      .filter((k) => !INTENDANCE.has(k) && !champs.includes(k) && !actuels.has(k) && !pareil(fiche[k], actuelle[k]));
    const nomsAutres = [...new Set(autres.map((k) => dessin[k] || "d'autres réglages"))];
    const changeQuelqueChose = changes.length || autres.length;
    const plan = this.collection === "plans" && (autres.some((k) => dessin[k]) || changes.includes("pieces"));
    const image = this.collection === "plans" ? vignettePlan(fiche) : "";
    const imageActuelle = plan ? vignettePlan(actuelle) : "";
    const morceaux = [...changes.map((k) => libelle(k, this.collection).toLowerCase()), ...nomsAutres];
    return `
      <header class="apercu-tete">
        <div>
          <p class="kicker">Telle qu'elle était</p>
          <h2>${e(quand(v?.modifie || v?.date))}</h2>
        </div>
        <button class="principal" data-revenir="${e(version)}" ${changeQuelqueChose ? "" : 'disabled title="Elle est en tout point pareille à la fiche actuelle"'}>Revenir à cette version</button>
      </header>
      <p class="aide apercu-changes">${changeQuelqueChose
        ? `Changé depuis : ${morceaux.map(e).join(", ")}.`
        : "Rien n'a changé depuis : cette version est pareille à la fiche actuelle."}</p>
      ${image ? `<div class="apercu-plans">
        <figure><img src="${image}" alt=""><figcaption>Cette version</figcaption></figure>
        ${imageActuelle ? `<figure><img src="${imageActuelle}" alt=""><figcaption>Aujourd'hui</figcaption></figure>` : ""}
      </div>` : ""}
      <dl class="apercu-champs">${champs.map((k) => `
        <div class="${changes.includes(k) ? "change" : ""}">
          <dt>${e(libelle(k, this.collection))}${changes.includes(k) ? ' <span class="pastille-change">changé depuis</span>' : ""}</dt>
          <dd>${this.htmlValeur(k, fiche[k])}</dd>
        </div>`).join("")}</dl>
      ${changes.filter((k) => !champs.includes(k)).length ? `<p class="aide">Absent de cette version, présent aujourd'hui : ${changes.filter((k) => !champs.includes(k)).map((k) => e(libelle(k, this.collection).toLowerCase())).join(", ")}.</p>` : ""}`;
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    if (b.dataset.version) return this.choisir(b.dataset.version);
    if (b.dataset.revenir) return this.revenir(b.dataset.revenir, b);
  }

  async revenir(version, bouton) {
    bouton.disabled = true;
    const v = this.liste.versions.find((x) => x.version === version);
    let r;
    try {
      r = await api.post(`/api/versions/${encodeURIComponent(this.collection)}/${encodeURIComponent(this.id)}/${encodeURIComponent(version)}/remettre`);
    } catch (err) {
      bouton.disabled = false;
      return toast(`Retour impossible : ${err.message}`, "erreur");
    }
    const collection = this.collection;
    const id = this.id;
    const retour = this.retour;
    toast(`La fiche est revenue telle qu'elle était ${quand(v?.modifie || v?.date)}. Celle d'avant est gardée dans les versions précédentes.`, "info", r.gardee ? {
      action: {
        libelle: "Annuler",
        async faire() {
          try {
            await api.post(`/api/versions/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/${encodeURIComponent(r.gardee)}/remettre`);
          } catch (err) {
            return toast(`Rien n'a changé : ${err.message}`, "erreur");
          }
          toast("La fiche a retrouvé la version d'avant.");
          rouvrir(retour);
        },
      },
    } : {});
    rouvrir(retour);
  }
}
