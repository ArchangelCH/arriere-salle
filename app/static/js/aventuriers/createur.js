// Créateur d'aventurier : les dix étapes du guide du kit, vérifiées à mesure ; la fiche au style officiel ;
// la tablée de la campagne (joueur, couleur des dés) tenue à jour ; la progression, niveau par niveau.
// Les champs de texte ne redessinent jamais l'étape (le curseur et les listes de suggestions restent en place) :
// seuls les boutons, les listes déroulantes et les cases à cocher le font.
// L'étape affichée vit dans l'adresse (#/aventuriers/id?etape=n), jamais dans la fiche : changer d'étape n'écrit rien.
// Une fiche modifiée entre-temps sur un autre écran est relue et fusionnée (fusion à trois) : aucune saisie ne se perd.
// En mode joueur (le coin des joueurs, hors de l'atelier), seules restent les dix étapes, l'impression et l'envoi au MJ :
// ni les autres aventuriers, ni la tablée, ni la TV, ni ce qui est noté pour le MJ.

import { api, copie, differer, echapper as e, erreurIA, fusionner, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";
import { Galerie, montrerImageTv, retirerImageTv } from "../illustrations/illustrations.js";
import { Reessai } from "../commun/reessai.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { htmlMedaillon, svgEmbleme, fondMedaillon } from "./embleme.js";
import { corpsDuSac, douteuse, enPleineForme, etatComplet, quantiteDe, resumeEtat } from "./etat.js";
import * as R from "./regles.js";
import * as T from "./tables.js";

const DE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l8.4 4.8v9.2L12 21.4l-8.4-4.8V7.4z"/><path d="M8.6 10.3h6.8L12 16.2z"/><path d="M12 2.6v7.7M3.6 7.4l5 2.9M20.4 7.4l-5 2.9M12 16.2v5.2M8.6 10.3l-5 6.3M15.4 10.3l5 6.3"/></svg>';
const COCHE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4l2.4 2.4 5.2-5.6"/></svg>';
// Chaque joueur a la couleur de ses dés (mêmes teintes que la tablée des séances).
const COULEURS = ["#b3261e", "#2f6ea5", "#3f8f4a", "#c9a227", "#7b4fa0", "#d07a2c", "#4a9aa0"];
const VUES_PLEINES = ["planche", "precedemment", "episode", "heros", "fiches"];
const VUE_AVANT = ["vue", "carte", "camera", "style", "version", "lieu", "url", "titre"];
const CHAMPS_TABLEE = ["nom", "joueur", "couleur", "tablee", "peuple", "genre", "vocations", "specialite", "element"];
const TIRAGES = { avant: T.tirerAvant, pourquoi: T.tirerPourquoi, jamais: T.tirerJamais, allure: T.tirerAllure, defaut: T.tirerDefaut };
const PANNEAUX = { portrait: "Portrait", progression: "Progression", familier: "Familier", mj: "Pour le MJ" };
// Ce que le joueur garde au rail, hors des dix étapes : son familier.
const PANNEAUX_JOUEUR = { familier: PANNEAUX.familier };
const FAMILIERS_MAX = 3;
const familierVide = () => ({ nom: "", espece: "", element: "", taille: "", aspect: "", humeurs: "", caractere: "", lien: "", regles: "", image: "" });
// Côté joueur, pas de portraits peints par le serveur : la fiche montre l'emblème de l'élément.
const GALERIE_MUETTE = { suivre() {}, arreter() {}, html: () => "", action() {}, saisie() {}, importer() {} };
// Les prétirés du kit (aventuriers/kit.js) portent des secrets du kit pour un MJ invité (leurs histoires, leurs « Ne fera
// jamais ») : ils ne partent pas avec ce module, l'accueil qui les montre les charge. Sans eux, la liste est vide.
let PRETIRES = [];
const chargerPretires = () => import("./kit.js").then((m) => { PRETIRES = m.PRETIRES; }, () => {});

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}
const dizaine = (v) => {
  const s = String(v ?? "");
  return s.length > 1 ? `<span class="dizaine">${e(s.slice(0, -1))}</span>${e(s.slice(-1))}` : e(s);
};
const option = (liste, valeur) => liste.map(([v, n]) => `<option value="${e(v)}" ${v === valeur ? "selected" : ""}>${e(n)}</option>`).join("");
// La caractéristique d'une compétence en trois boutons P, S, M, comme les cartons, et son nom écrit en entier à côté
// (E14). Des boutons radio : les flèches passent de l'un à l'autre, le lecteur d'écran dit « Physique ».
const choixPsm = (i, nomComp, valeur) => `<div class="choix-psm" role="radiogroup" aria-label="Caractéristique${nomComp ? ` de ${e(nomComp)}` : ""}">${R.CARACS.map((x) => `
  <label title="${e(x.nom)} : ${e(x.aide)}"><input type="radio" name="avec-${i}" value="${e(x.nom)}" data-comp="${i}" data-cc="avec" data-psm="${x.cle}" aria-label="${e(x.nom)}" ${x.nom === valeur ? "checked" : ""}><span aria-hidden="true">${x.nom.charAt(0)}</span></label>`).join("")}
  <span class="nom-psm" aria-hidden="true">${e(R.CARACS.some((x) => x.nom === valeur) ? valeur : "")}</span></div>`;
const poserPsm = (ligne, valeur) => {
  for (const r of ligne.querySelectorAll('[data-cc="avec"]')) r.checked = r.value === valeur;
  const nom = ligne.querySelector(".nom-psm");
  if (nom) nom.textContent = valeur;
};
const prenom = (a) => (a.nom || "").split(/[\s,]+/)[0] || (a.genre === "f" ? "votre aventurière" : "votre aventurier");
// Les versions précédentes d'une fiche (corbeille-page.js), une page de l'atelier : jamais du coin des joueurs.
const lienVersions = (id) => `#/versions/aventuriers/${encodeURIComponent(id)}?retour=${encodeURIComponent(`#/aventuriers/${id}`)}`;
const phrase = (t) => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}`.replace(/[.\s]*$/, "") : "");
const CARACS_SEULES = ["Physique", "Social", "Mental"];
// Un texte que le joueur a confié au MJ seul (confie_au_mj, lot C4), pas encore lu : « nouveau » sur « Pour le MJ ».
const confieNonLu = (a) => Boolean(a?.confie_au_mj && typeof a.confie_au_mj.texte === "string" && !a.confie_au_mj.lu);

// La fiche telle qu'elle part au serveur : sans l'étape, qui n'a rien à y faire (d'anciennes fiches l'ont encore).
function pourLeServeur(a) {
  const { etape, ...fiche } = a;
  return copie(fiche);
}

// Remplace le contenu d'un objet sans changer d'objet : les autres références (liste des aventuriers, galerie) restent bonnes.
function remplacer(cible, source) {
  for (const k of Object.keys(cible)) if (!(k in source)) delete cible[k];
  Object.assign(cible, source);
}

const pareil = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// La place notée d'un héros revenu à la tablée après un nom effacé (quitterSansNom) : juste après la ligne qui le
// précédait si elle y est encore, en tête s'il était le premier, sinon à son ancien rang.
function rangNote(t, a) {
  if (a.apres_tablee === "") return 0;
  const avant = t.findIndex((j) => j.id === a.apres_tablee);
  return avant >= 0 ? avant + 1 : Math.min(Math.max(0, a.rang_tablee), t.length);
}

// « Femme (marquée de l'air), éclaireuse et archère. Cheveux… » : de quoi écrire le prompt d'un portrait.
function descriptionAventurier(a) {
  const qui = { h: "homme", f: "femme" }[a.genre] || "personnage";
  const peuple = R.titre({ ...a, specialite: "", vocations: [] }).toLowerCase();
  const metier = (a.specialite || "").trim() || (a.vocations || []).map((v) => R.vocationAccordee(v, a.genre).toLowerCase()).join(" et ");
  const equipement = [(a.armes || [])[0]?.nom, a.protection?.indice ? a.protection.nom : ""].filter(Boolean).map((x) => x.toLowerCase()).join(", ");
  return [
    [`${qui}${peuple ? ` (${peuple})` : ""}`, metier].filter(Boolean).join(", "),
    a.allure, a.defaut, equipement ? `équipement : ${equipement}` : "", a.element ? `élément : ${a.element.toLowerCase()}` : "",
  ].map(phrase).filter(Boolean).join(". ") + ".";
}

export function nouvelAventurier(existants = []) {
  const prises = existants.filter((x) => x.tablee !== false).map((x) => x.couleur);
  return {
    nom: "", genre: "", joueur: "", couleur: COULEURS.find((c) => !prises.includes(c)) || COULEURS[existants.length % COULEURS.length],
    tablee: true, niveau: 1,
    avant: "", pourquoi: "", jamais: "",
    peuple: "", particularites: "", peuple_cache: false,
    vocations: [], specialite: "",
    physique: 55, social: 55, mental: 55,
    competences: Array.from({ length: 4 }, () => ({ nom: "", bonus: 15, avec: "Physique" })),
    sante: 9, psy: 3,
    dons: [],
    element: "", posture: "", themes: ["", "", ""],
    armes: [], protection: null, bouclier: false, equipement: [], objets: ["", "", ""], or: null, langues: "Commun",
    allure: "", defaut: "", lien: "", lien_avec: "", contacts: "",
    histoire: "", conseils: [], familiers: [],
    secret: "", notes_mj: "",
    progression: [],
  };
}

// Un prétiré du kit devient un aventurier de la tablée ; ses pièces d'or sortent de la liste d'équipement.
function depuisPretire(p, existants) {
  const base = nouvelAventurier(existants);
  const equipement = [];
  let or = null;
  for (const x of p.equipement) {
    const m = /^(\d+)\s+pièces d[’']or(?:,?\s*(?:et\s+)?(.*))?$/.exec(x);
    if (m) {
      or = +m[1];
      if (m[2]) equipement.push(`${m[2].charAt(0).toUpperCase()}${m[2].slice(1)}`);
    } else equipement.push(x);
  }
  const { cle, ...reste } = p;
  return {
    ...base, ...structuredClone(reste), equipement, or, source: cle, peuple_cache: R.peupleSecret(p.peuple),
    themes: [...p.themes, "", "", ""].slice(0, 3),
  };
}

export class Createur {
  constructor(racine, { id, parametres, joueur = false } = {}) {
    this.racine = racine;
    this.joueur = joueur;
    this.idDemande = id;
    this.parametres = parametres || new URLSearchParams();
    this.aventuriers = [];
    this.a = null;
    // La dernière version de la fiche connue du serveur : la base de la fusion quand un autre écran l'a modifiée.
    this.base = null;
    this.modifies = false;
    // La tablée des séances suit la fiche, seulement après que la fiche a bien été enregistrée.
    this.tableeEnAttente = false;
    this.fileEnvois = Promise.resolve();
    this.envois = 0;
    this.detruit = false;
    this.ecoute = new AbortController();
    this.sauver = differer(() => this.enregistrer(), 700);
    // Serveur injoignable : la fiche repart seule (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.brouillonDon = { nom: "", cout: "1", effet: "" };
    this.brouillonNiveau = null;
    this.galerie = joueur ? GALERIE_MUETTE : new Galerie({
      cible: "aventurier",
      fiche: () => this.a,
      trouver: (x) => this.aventuriers.find((a) => a.id === x),
      rafraichir: () => {
        if (this.etape === "portrait") this.afficherEtape();
        this.rafraichir();
      },
      zone: () => this.racine.querySelector(".etape-zone"),
      decrire: descriptionAventurier,
    });
  }

  async demarrer() {
    if (this.joueur) return this.demarrerJoueur();
    const [aventuriers, campagne, table, etats] = await Promise.all([
      api.get("/api/aventuriers"), api.get("/api/campagne"), api.get("/api/table").catch(() => ({})),
      api.get("/api/etats-heros").catch(() => null),
    ]);
    if (this.detruit) return;
    [this.aventuriers, this.campagne, this.table] = [aventuriers, campagne, table];
    // Ce que montre la TV, relu par le témoin de l'en-tête (etat-tv.js, que ce module ne peut pas importer : le coin des
    // joueurs le charge aussi) : les boutons de la TV suivent, même quand un autre écran la change.
    document.addEventListener("etat-tv", (ev) => {
      if (this.detruit || !ev.detail?.etat) return;
      this.table = ev.detail.etat;
      this.majBoutonsTv();
    }, { signal: this.ecoute.signal });
    document.dispatchEvent(new Event("etat-tv-demande"));
    // L'état du jour de chaque héros (Séances › Jouer, le combat) : pour le MJ seul, jamais dans le coin des joueurs.
    this.etatsHeros = etats?.etats || null;
    this.aventuriers.sort((x, y) => (x.cree || "").localeCompare(y.cree || ""));
    if (!this.idDemande) {
      if (this.parametres.has("nouveau")) return this.ouvrirBrouillon();
      await chargerPretires();
      return this.detruit ? undefined : this.afficherAccueil();
    }
    this.a = this.aventuriers.find((a) => a.id === this.idDemande);
    if (!this.a) {
      this.racine.innerHTML = `<section class="page-liste"><p class="vide">Cet aventurier n'existe plus. <a href="#/aventuriers">Retour aux aventuriers</a></p></section>`;
      return;
    }
    this.base = pourLeServeur(this.a);
    delete this.a.etape;
    const demandee = this.parametres.get("etape");
    if (demandee) this.etape = PANNEAUX[demandee] ? demandee : Math.min(10, Math.max(1, +demandee || 1));
    else {
      // Sans étape dans l'adresse : la première qui reste à faire, sinon les finitions.
      const v = R.verifier(this.a);
      this.etape = R.ETAPES.find((x) => v.etapes[x.n].etat !== "ok")?.n || 10;
    }
    this.afficherEditeur();
    this.galerie.suivre();
  }

  // « Créer un aventurier » : la fiche ne s'écrit qu'au premier champ rempli (un clic d'essai ne laisse rien), et tant
  // qu'elle n'a pas de nom elle reste hors de la tablée : ni la TV, ni « Vendre à… », ni « Verser » ne la voient.
  ouvrirBrouillon() {
    this.a = { ...nouvelAventurier(this.aventuriers), tablee: false, tablee_au_nom: true };
    this.base = null;
    const demandee = this.parametres.get("etape");
    this.etape = PANNEAUX[demandee] ? demandee : Math.min(10, Math.max(1, +demandee || 1));
    this.afficherEditeur();
  }

  // Le nom effacé jusqu'à la dernière lettre : l'aventurier quitte la tablée comme un brouillon jamais nommé, et ni la TV,
  // ni les ventes, ni les versements, ni le Tableau ne montrent un « Sans nom ». Sa ligne de la tablée des séances est
  // notée (ligne_tablee) : avec un nom, il la retrouve, et la séance du soir le compte toujours parmi ses présents. Son
  // rang aussi (rang_tablee, et la ligne d'avant : apres_tablee, "" s'il était le premier) : même la page rechargée
  // entre-temps, il revient à sa place, pas au bout de la tablée.
  quitterSansNom() {
    const a = this.a;
    if (this.joueur || a.tablee === false || (a.nom || "").trim()) return;
    const tablee = this.campagne?.tablee || [];
    const rang = tablee.findIndex((j) => j.aventurier === a.id);
    const ligne = tablee[rang];
    if (ligne?.id) {
      a.ligne_tablee = ligne.id;
      a.rang_tablee = rang;
      a.apres_tablee = rang > 0 ? tablee[rang - 1].id || "" : "";
    }
    a.tablee = false;
    a.tablee_au_nom = true;
    const c = this.racine.querySelector('.createur-tete [data-champ="tablee"]');
    if (c) c.checked = false;
    const libelle = this.racine.querySelector(".createur-tete .libelle-tablee");
    if (libelle) libelle.textContent = "À la tablée dès qu'il a un nom";
  }

  // Le brouillon nommé rejoint la tablée de lui-même ; la case « À la tablée », cochée ou décochée à la main, décide seule.
  rejoindreAuNom() {
    const a = this.a;
    if (!a.tablee_au_nom || !(a.nom || "").trim()) return;
    a.tablee = true;
    delete a.tablee_au_nom;
    const c = this.racine.querySelector('.createur-tete [data-champ="tablee"]');
    if (c) c.checked = true;
    const libelle = this.racine.querySelector(".createur-tete .libelle-tablee");
    if (libelle) libelle.textContent = "À la tablée";
  }

  // La page quittée : plus d'écouteurs ni de suivi des portraits, et seulement ce qui attend encore d'être enregistré.
  detruire() {
    this.detruit = true;
    this.galerie.arreter();
    this.ecoute.abort();
    return this.vider();
  }

  // Onglet fermé ou page quittée : une saisie pas encore partie part tout de suite ; sinon, rien n'est écrit.
  vider() {
    if (this.modifies) this.sauver.maintenant();
    return this.fileEnvois;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.modifies || this.sauver.enAttente() || this.envois > 0;
  }

  // ---------------------------------------------------------------- la tablée

  afficherAccueil() {
    const dansTablee = this.aventuriers.filter((a) => a.tablee !== false);
    // Commencés sans nom : ils attendent le leur pour rejoindre la tablée (voir ouvrirBrouillon).
    const brouillons = this.aventuriers.filter((a) => a.tablee === false && a.tablee_au_nom);
    const autres = this.aventuriers.filter((a) => a.tablee === false && !a.tablee_au_nom);
    this.racine.innerHTML = `
      <section class="page-liste accueil-aventuriers">
        <header class="titre-page">
          <p class="kicker">Créateur d'aventurier</p>
          <h1>Les aventuriers</h1>
          <p class="chapo">Les dix étapes du guide du kit, une demi-heure par joueur. L'atelier vérifie chaque règle en chemin, puis imprime la fiche au style des fiches officielles.</p>
        </header>
        <div class="heros-grille">
          ${dansTablee.map((a) => this.htmlCarte(a)).join("")}
          <button class="carte-heros nouvelle" data-action="nouveau"><span>Créer un aventurier</span></button>
        </div>
        ${brouillons.length ? `<h2 class="sous-titre">Commencés, en attente d'un nom</h2><p class="aide">Ils rejoignent la tablée dès qu'ils ont un nom ; d'ici là, ni la TV, ni les ventes, ni les versements ne les voient.</p><div class="heros-grille">${brouillons.map((a) => this.htmlCarte(a)).join("")}</div>` : ""}
        ${autres.length ? `<h2 class="sous-titre">Hors de la tablée</h2><div class="heros-grille">${autres.map((a) => this.htmlCarte(a)).join("")}</div>` : ""}
        <div class="grille-accueil">
          <section class="bloc">
            <h2>Partir d'un prétiré</h2>
            <p>${e(R.GUIDE.pretires)}. Le joueur le reprend tel quel, ou le retouche étape par étape.</p>
            <ul class="liste-pretires">${PRETIRES.map((p) => `
              <li>${htmlMedaillon(p, { classe: "mini" })}
                <span class="texte"><b>${e(p.nom)}</b><i>${e(R.titre(p))}</i></span>
                <button data-pretire="${e(p.cle)}" title="Ajouter ce héros à l'atelier et à la tablée">Ajouter à l'atelier</button></li>`).join("")}
            </ul>
          </section>
          <section class="bloc">
            <h2>À la table</h2>
            <p>Pour la première séance : chaque héros se présente sur la TV depuis sa fiche, puis toute la tablée d'un coup. En partie, « Voir la tablée » montre toutes les fiches côte à côte.</p>
            <div class="actions">
              <a class="bouton" href="#/tablee">Voir la tablée</a>
              <button class="bouton-tv" data-tv-tablee ${dansTablee.length ? "" : "disabled"}></button>
              <a class="bouton" href="/fiche-aventurier?tablee=1" target="_blank" rel="noopener">Imprimer les fiches de la tablée</a>
            </div>
            <p class="aide">La TV montre le nom, le peuple, les vocations, le joueur et le portrait. Jamais ce qui est noté « pour le MJ ».</p>
          </section>
        </div>
        <section class="bloc joueurs-en-ligne">
          <h2>Les joueurs, depuis chez eux</h2>
          <p>Chaque joueur crée son aventurier depuis son compte, étape par étape, et vous l'envoie : accueillez-le ici dans la tablée, ou reliez-le à un héros créé dans l'atelier. Il ne voit rien d'autre de l'atelier.</p>
          <p class="aide">Inviter un joueur, lui créer son compte, un nouveau mot de passe provisoire : <a href="#/reglages/acces">Réglages, Accès</a>. Le carnet des joueurs, ouvert ou fermé : <a href="#/reglages/coin">Réglages, Coin des joueurs</a>.</p>
          <ul class="liste-joueurs"><li class="aide">Chargement…</li></ul>
        </section>
      </section>`;
    const accueil = this.racine.querySelector(".accueil-aventuriers");
    accueil.addEventListener("click", (ev) => this.clicAccueil(ev), { signal: this.ecoute.signal });
    this.majBoutonsTv();
    this.chargerJoueurs();
    // Le carnet des joueurs, les comptes, les MJ et vos appareils sont dans la page Réglages (reglages/reglages.js).
  }

  // ---------------------------------------------------------------- les joueurs, depuis chez eux

  async chargerJoueurs() {
    const zone = this.racine.querySelector(".liste-joueurs");
    if (!zone) return;
    let joueurs;
    try {
      joueurs = await api.get("/api/joueurs");
    } catch (err) {
      zone.innerHTML = `<li class="alerte">Liste des joueurs indisponible : ${e(err.message)}</li>`;
      return;
    }
    // L'état du compte de chacun : un module de l'atelier seul, chargé à la demande (le coin sert ce fichier-ci).
    // Créer le compte, un nouveau provisoire : page Réglages, section Accès.
    const C = await import("./compte-joueur.js");
    if (this.detruit) return;
    this.joueursEnLigne = joueurs;
    const ETATS = { invite: "Pas encore venu", "en-cours": "Création en cours", envoye: "Envoyé : à accueillir", retouche: "Retouché depuis l'envoi", accueilli: "Fiche reçue", relie: "Fiche reliée",
      // Le héros relié est à la corbeille (ou une autre fiche a pris sa place) : le joueur ne lit rien. Remis de la corbeille,
      // il retrouve son joueur ; sinon, « Défaire le lien ».
      "relie-perdu": "Héros introuvable" };
    // Les héros de la tablée qu'aucun joueur ne lit encore : ceux qu'on peut relier à un lien (même règle que le serveur).
    const pris = new Set(joueurs.map((j) => j.heros?.id).filter(Boolean));
    const libres = this.aventuriers.filter((a) => a.tablee !== false && (a.nom || "").trim() && !pris.has(a.id));
    const pourLui = (j) => [...libres].sort((x, y) => Number(R.simple(y.joueur || "") === R.simple(j.nom)) - Number(R.simple(x.joueur || "") === R.simple(j.nom)));
    // Sans héros lu : invité, en création, ou dont l'aventurier accueilli a été jeté (hors de la tablée, il reste le sien).
    const aRelier = (j) => !j.relie && !j.heros && !(j.accueilli && this.aventuriers.some((a) => a.id === j.accueilli)) && libres.length > 0;
    zone.innerHTML = joueurs.length ? joueurs.map((j) => `
      <li class="joueur-en-ligne" data-etat="${e(j.etat)}" data-joueur="${e(j.id)}">
        <div class="qui"><b>${e(j.nom)}</b><span class="en-ligne-joueur" data-en-ligne-joueur="${e(j.id)}">en ligne</span><span class="etat-joueur">${e(ETATS[j.etat] || j.etat)}</span>
          ${j.aventurier ? `<span class="aventurier-joueur">${e(j.aventurier)}${R.titre(j) ? `, ${e(R.titre(j).toLowerCase())}` : ""}</span>` : ""}
          <span class="compte-joueur">${C.htmlEtatCompte(j)}</span></div>
        ${this.htmlCouleurAccueil(j)}
        <div class="actions">
          ${["envoye", "retouche"].includes(j.etat) ? (j.couleur_tv
            ? `<button class="principal" data-joueur-accueillir="${e(j.id)}" data-couleur="${e(j.couleur_tv.tv)}">Accueillir, couleur de la TV <span class="pastille" style="background:${e(j.couleur_tv.tv)}"></span></button>
              <button data-joueur-accueillir="${e(j.id)}">Accueillir avec sa couleur</button>`
            : `<button class="principal" data-joueur-accueillir="${e(j.id)}">Accueillir dans la tablée</button>`) : ""}
          ${j.accueilli ? `<a class="bouton" href="#/aventuriers/${e(j.accueilli)}">Ouvrir sa fiche</a>` : ""}
          <a class="bouton" href="/static/joueurs/apercu.html?joueur=${encodeURIComponent(j.id)}" target="_blank" rel="noopener" title="Son carnet et son échoppe tels qu'il les voit, sans rien écrire chez lui">Voir comme ${e(j.nom)}</a>
          ${aRelier(j) ? `<button data-joueur-relier="${e(j.id)}" aria-expanded="false" title="Pour un héros créé ici, dans l'atelier">Relier à…</button>` : ""}
          ${j.relie ? `<button data-joueur-delier="${e(j.id)}" title="Le héros redevient sans joueur ; le créateur du joueur se rouvre">Défaire le lien</button>` : ""}
          ${j.compte ? "" : '<a class="bouton" href="#/reglages/acces">Créer son compte</a>'}
          <button class="lien-danger" data-joueur-retirer="${e(j.id)}">Retirer</button>
        </div>
        ${aRelier(j) ? `
        <div class="relier-a" hidden>
          <p class="aide">${e(j.nom)} lira la fiche de ce héros dans le carnet et passera commande pour lui, et pour lui seul.</p>
          <div class="actions">${pourLui(j).map((a) => `
            <button data-relier-joueur="${e(j.id)}" data-relier-heros="${e(a.id)}">${e(a.nom)}${a.joueur ? ` <small>joué par ${e(a.joueur)}</small>` : ""}</button>`).join("")}
          </div>
        </div>` : ""}
      </li>`).join("") : '<li class="aide">Aucun joueur invité pour l\'instant.</li>';
  }

  // E06 : la couleur d'un aventurier envoyé, déjà prise à la tablée ou trop sombre pour un plan : la carte le dit avant
  // l'accueil, avec la couleur que la TV lui donnera (couleurs_tv.py) ; « Accueillir, couleur de la TV » la lui donne
  // aussi dans l'atelier, sur sa fiche et dans le carnet.
  htmlCouleurAccueil(j) {
    const avis = j.couleur_tv;
    if (!avis || !["envoye", "retouche"].includes(j.etat)) return "";
    const pastille = (c) => `<span class="pastille" style="background:${e(c)}"></span>`;
    const sienne = avis.pourquoi === "prise"
      ? `Sa couleur ${pastille(j.couleur)} est déjà ${avis.comme ? `celle de ${e(avis.comme)}` : "prise à la tablée"}`
      : `Sa couleur ${pastille(j.couleur)} se perd sur les plans sombres`;
    return `<p class="couleur-accueil">${sienne} : la TV lui donnera celle-ci ${pastille(avis.tv)}.</p>`;
  }

  // Relie un héros de la tablée (créé ici) au lien d'un joueur, ou défait ce lien ; l'un annule l'autre.
  async relier(joueur, heros, { annulable = true } = {}) {
    const j = this.joueursEnLigne?.find((x) => x.id === joueur);
    const a = this.aventuriers.find((x) => x.id === heros);
    if (!j || !a) return;
    if (["en-cours", "envoye", "retouche"].includes(j.etat) && !(await demander({
      titre: `Relier ${j.nom} à ${a.nom} ?`,
      texte: `${j.nom} a commencé son propre aventurier${j.aventurier ? ` (« ${j.aventurier} »)` : ""}. Son brouillon reste de côté et son créateur se ferme.`,
      oui: "Relier",
    }))) return;
    if (this.detruit) return;
    await api.post(`/api/joueurs/${encodeURIComponent(joueur)}/relier`, { heros });
    await this.chargerJoueurs();
    toast(`${a.nom} est ${R.accord("{relié|reliée}", a)} à ${j.nom} : ${j.nom} lira sa fiche dans le carnet et commandera pour ${R.accord("{lui|elle}", a)}.`, "info",
      annulable ? { action: { libelle: "Annuler", faire: () => this.delier(joueur, { annulable: false }).catch((err) => toast(err.message, "erreur")) } } : {});
  }

  async delier(joueur, { annulable = true } = {}) {
    const j = this.joueursEnLigne?.find((x) => x.id === joueur);
    const heros = j?.accueilli;
    await api.del(`/api/joueurs/${encodeURIComponent(joueur)}/relier`);
    await this.chargerJoueurs();
    toast(`Lien défait : ${j?.aventurier || "ce héros"} n'a plus de joueur, et ${j?.nom || "le joueur"} retrouve son créateur.`, "info",
      annulable && heros ? { action: { libelle: "Annuler", faire: () => this.relier(joueur, heros, { annulable: false }).catch((err) => toast(err.message, "erreur")) } } : {});
  }

  htmlCarte(a) {
    const v = R.verifier(a);
    const aFaire = Object.entries(v.etapes).find(([, x]) => x.etat !== "ok");
    return `
      <a class="carte-heros" href="#/aventuriers/${e(a.id)}">
        ${htmlMedaillon(a)}
        <span class="nom">${e(a.nom || "Sans nom")}</span>
        <span class="titre">${e(R.titre(a) || "peuple et vocation à choisir")}</span>
        <span class="joueur"><span class="pastille" style="background:${e(a.couleur || "#888")}"></span>${e(a.joueur || "joueur à trouver")}</span>
        <span class="etat-heros ${v.pret ? "pret" : ""}">${!v.pret ? `En cours : étape ${aFaire ? aFaire[0] : 10}`
          : (this.campagne?.niveau || 1) > (a.niveau || 1) ? `Niveau ${a.niveau || 1} : à faire monter au ${this.campagne.niveau}` : `Niveau ${a.niveau || 1}, ${R.accord("{prêt|prête}", a)} à jouer`}</span>
      </a>`;
  }

  async clicAccueil(ev) {
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    const j = b.dataset;
    try {
      if (j.joueurAccueillir) {
        const a = await api.post(`/api/joueurs/${encodeURIComponent(j.joueurAccueillir)}/accueillir`, j.couleur ? { couleur: j.couleur } : {});
        await this.synchroniserTablee(a);
        toast(`${a.nom || "Le nouvel aventurier"} rejoint la tablée${j.couleur ? ", avec la couleur de la TV" : ""} : relisez sa fiche, validez ses dons, ajoutez ce qui est « pour le MJ ».`);
        if (!this.detruit) location.hash = `#/aventuriers/${a.id}`;
        return;
      }
      if (j.joueurRelier) {
        const panneau = b.closest(".joueur-en-ligne").querySelector(".relier-a");
        panneau.hidden = !panneau.hidden;
        b.setAttribute("aria-expanded", String(!panneau.hidden));
        if (!panneau.hidden) panneau.querySelector("button")?.focus();
        return;
      }
      if (j.relierHeros) return await this.relier(j.relierJoueur, j.relierHeros);
      if (j.joueurDelier) return await this.delier(j.joueurDelier);
      if (j.joueurRetirer) {
        const nom = this.joueursEnLigne?.find((x) => x.id === j.joueurRetirer)?.nom;
        if (!(await demander({
          titre: nom ? `Retirer ${nom} ?` : "Retirer ce joueur ?",
          texte: ["Son compte est fermé (son identifiant ne resert plus) et son brouillon part à la corbeille.", "Un aventurier déjà accueilli reste dans l'atelier."],
          oui: "Retirer", danger: true,
        }))) return;
        await api.del(`/api/joueurs/${encodeURIComponent(j.joueurRetirer)}`);
        return this.chargerJoueurs();
      }
      if (b.dataset.action === "nouveau") {
        location.hash = "#/aventuriers?nouveau";
      } else if (b.dataset.pretire) {
        const p = PRETIRES.find((x) => x.cle === b.dataset.pretire);
        if (this.aventuriers.some((a) => a.source === p.cle)
          && !(await demander({ titre: `${p.nom} est déjà dans l'atelier`, texte: "En prendre un second exemplaire ?", oui: "Un second exemplaire", non: "Non" }))) return;
        const a = await api.post("/api/aventuriers", depuisPretire(p, this.aventuriers));
        await this.synchroniserTablee(a);
        toast(`${p.nom} rejoint la tablée : notez le joueur et la couleur de ses dés.`);
        if (!this.detruit) location.hash = `#/aventuriers/${a.id}`;
      } else if (b.dataset.action === "tv-tablee") {
        const r = await this.basculer({ vue: "heros" });
        toast(r.ecrans ? "À la TV : la tablée." : "Envoyé, mais aucun écran de table n'est branché.");
        this.table = await api.get("/api/table");
        if (!this.detruit) this.majBoutonsTv();
      } else if (b.dataset.action === "tv-tablee-retirer") {
        await this.revenir();
        this.table = await api.get("/api/table");
        toast("Retiré de la TV : la tablée.");
        if (!this.detruit) this.majBoutonsTv();
      }
    } catch (err) {
      toast(err.message, "erreur");
    }
  }

  // ---------------------------------------------------------------- l'éditeur

  afficherEditeur() {
    const a = this.a;
    const lecture = this.lectureSeule ? " disabled" : "";
    this.racine.innerHTML = `
      <section class="createur${this.lectureSeule ? " lecture-seule" : ""}">
        <header class="createur-tete">
          ${this.joueur ? "" : '<a class="retour" href="#/aventuriers">Les aventuriers</a>'}
          <div class="tete-medaillon">${htmlMedaillon(a)}</div>
          <div class="identite-heros">
            <div class="avec-de"><input class="nom-heros" type="text" data-champ="nom" value="${e(a.nom)}" placeholder="Son nom, à l'étape 10" aria-label="Nom"${lecture}><button class="de" data-tirer="nom" title="Tirer un nom qui colle au peuple"${lecture}>${DE}</button>${htmlTemoin()}</div>
            <p class="titre-heros"></p>
          </div>
          <div class="joueur-heros">
            <label class="champ">Joué par<input type="text" data-champ="joueur" value="${e(a.joueur || "")}" placeholder="Prénom"${lecture}></label>
            ${this.joueur ? this.htmlCouleurs() : `<label class="champ couleur" title="${e(R.GUIDE.des)}">Dés<input type="color" data-champ="couleur" value="${e(a.couleur || COULEURS[0])}"${lecture}></label>`}
            ${this.joueur ? "" : `<label class="case"${a.tablee_au_nom ? ' title="Sans nom, il reste hors de la tablée : ni la TV, ni les ventes, ni les versements ne le voient."' : ""}><input type="checkbox" data-champ="tablee" ${a.tablee === false ? "" : "checked"}> <span class="libelle-tablee">${a.tablee_au_nom ? "À la tablée dès qu'il a un nom" : "À la tablée"}</span></label>`}
          </div>
          <div class="actions-heros">
            <span class="niveau-heros"></span>
            <a class="bouton" ${this.attributsFiche()}>Fiche A4</a>
            ${this.joueur ? '<button class="principal" data-action="envoyer-mj">Envoyer au MJ</button>' : '<button class="bouton-tv"></button>'}
          </div>
        </header>
        <div class="createur-corps">
          <nav class="rail" aria-label="Étapes de la création"></nav>
          <div class="barre-fine" role="navigation" aria-label="Étape en cours"></div>
          <article class="etape-zone"></article>
          <aside class="apercu" aria-label="La fiche en cours"></aside>
        </div>
      </section>`;
    this.cleMedaillon = null;
    const s = this.racine.querySelector(".createur");
    const option = { signal: this.ecoute.signal };
    s.addEventListener("input", (ev) => this.saisie(ev, false), option);
    s.addEventListener("change", (ev) => this.saisie(ev, true), option);
    s.addEventListener("click", (ev) => this.clic(ev), option);
    this.afficherEtape();
    this.rafraichir();
  }

  // Les champs de l'en-tête (nom, joueur, dés, tablée) ne se redessinent pas : après une fusion, on y reporte la fiche,
  // sauf dans le champ où l'on écrit.
  majEntete() {
    const tete = this.racine.querySelector(".createur-tete");
    if (!tete) return;
    for (const el of tete.querySelectorAll("[data-champ]")) {
      if (el === document.activeElement) continue;
      const v = this.a[el.dataset.champ];
      if (el.type === "checkbox") el.checked = el.dataset.champ === "tablee" ? v !== false : !!v;
      else if (el.type === "color") el.value = v || COULEURS[0];
      else el.value = v ?? "";
    }
    this.majPastilles();
  }

  // La couleur des dés, côté joueur : les sept teintes de la tablée, celles déjà prises par un héros barrées (E17).
  htmlCouleurs() {
    const a = this.a;
    const actuelle = String(a.couleur || "").toLowerCase();
    const prises = new Set((this.moi?.couleurs_prises || []).map((c) => String(c).toLowerCase()));
    const lecture = this.lectureSeule ? " disabled" : "";
    return `
      <div class="couleurs-des" role="group" aria-label="La couleur de vos dés">
        <span class="lbl">La couleur de vos dés, et de votre pion à la TV</span>
        <span class="pastilles">${COULEURS.map((c) => {
          const prise = prises.has(c) && c !== actuelle;
          return `<button type="button" class="pastille-des${prise ? " prise" : ""}" style="--teinte:${c}" data-couleur="${c}" aria-pressed="${c === actuelle}"
            aria-label="${prise ? "Couleur déjà prise à la tablée" : "Cette couleur"}" title="${prise ? "Déjà prise par un héros de la tablée" : "Cette couleur"}"${prise ? " disabled" : lecture}></button>`;
        }).join("")}
          <input type="color" data-champ="couleur" value="${e(a.couleur || COULEURS[0])}" aria-label="Une autre couleur" title="Une autre couleur"${lecture}></span>
        ${prises.size ? '<span class="aide">Les couleurs barrées sont déjà prises à la tablée : à la TV, chaque héros garde la sienne.</span>' : ""}
      </div>`;
  }

  majPastilles() {
    const actuelle = String(this.a?.couleur || "").toLowerCase();
    for (const b of this.racine.querySelectorAll(".createur-tete .pastille-des")) b.setAttribute("aria-pressed", String(b.dataset.couleur === actuelle));
  }

  // Redessine l'étape après une fusion avec la version d'un autre écran, en rendant le curseur là où il était.
  redessinerApresFusion() {
    if (this.detruit || !this.racine.querySelector(".createur")) return;
    const actif = document.activeElement;
    let selecteur = "";
    let debut = null;
    let fin = null;
    if (actif && this.racine.querySelector(".etape-zone")?.contains(actif)) {
      selecteur = [...actif.attributes].filter((x) => x.name.startsWith("data-")).map((x) => `[${x.name}="${CSS.escape(x.value)}"]`).join("");
      try {
        debut = actif.selectionStart ?? null;
        fin = actif.selectionEnd ?? null;
      } catch {
        // ce champ n'a pas de sélection (liste, case à cocher)
      }
    }
    this.afficherEtape();
    this.majEntete();
    this.rafraichir();
    const el = selecteur && this.racine.querySelector(`.etape-zone ${selecteur}`);
    if (!el) return;
    el.focus();
    if (debut !== null) {
      try {
        el.setSelectionRange(debut, fin);
      } catch {
        // idem
      }
    }
  }

  // Tout ce qui se recalcule sans toucher aux champs : l'en-tête, le rail, l'aperçu, les vérifications, les totaux.
  rafraichir() {
    const a = this.a;
    const s = this.racine.querySelector(".createur");
    if (!s) return;
    const v = R.verifier(a);
    s.querySelector(".titre-heros").textContent = R.titre(a) || "peuple et vocation à choisir";
    const cleMedaillon = `${a.element}|${a.illustration}`;
    if (this.cleMedaillon !== cleMedaillon) {
      this.cleMedaillon = cleMedaillon;
      s.querySelector(".tete-medaillon").innerHTML = htmlMedaillon(a);
    }
    s.querySelector(".niveau-heros").textContent = `Niveau ${a.niveau || 1}`;
    this.majBoutonsTv();
    // Un brouillon pas encore écrit n'a rien à montrer (voir ouvrirBrouillon).
    const btv = s.querySelector(".bouton-tv");
    if (btv) {
      btv.disabled = !a.id;
      btv.title = a.id ? "" : "La fiche s'écrit au premier champ rempli : rien à montrer encore.";
    }
    const barre = s.querySelector(".barre-fine");
    if (barre) barre.innerHTML = this.htmlBarre();
    this.etat(this.etatAffiche);
    for (const b of s.querySelectorAll('[data-action="envoyer-mj"]')) {
      b.textContent = this.moi?.accueilli ? "Accueilli par le MJ" : this.moi?.envoye ? "Renvoyer au MJ" : "Envoyer au MJ";
      b.disabled = !!this.moi?.accueilli;
    }
    s.querySelector(".rail").innerHTML = this.htmlRail(v);
    s.querySelector(".apercu").innerHTML = this.htmlApercu(v);
    const verif = s.querySelector(".etape-zone .verif");
    if (verif && typeof this.etape === "number") verif.innerHTML = this.htmlVerif(this.avecAvertissements(v.etapes[this.etape], this.etape));
    const calculs = this.calculs();
    for (const el of s.querySelectorAll("[data-calc]")) {
      const c = calculs[el.dataset.calc];
      if (c !== undefined) el.innerHTML = c;
    }
  }

  calculs() {
    const a = this.a;
    const att = R.attendus(a.niveau || 1);
    const somme = R.CARACS.reduce((t, c) => t + (+a[c.cle] || 0), 0);
    const bonus = (a.competences || []).reduce((t, c) => t + (+c.bonus || 0), 0);
    const reste = (n, total, unite = " %") => (n === total ? `<b class="juste">Le compte est bon : ${total}${unite}.</b>`
      : n < total ? `Reste à répartir : <b>${total - n}${unite}</b>` : `<b class="trop">${n - total}${unite} de trop</b>`);
    const res = { "reste-carac": reste(somme, att.caracs), "reste-comp": reste(bonus, att.competences) };
    (a.competences || []).forEach((c, i) => { res[`comp-v-${i}`] = c.nom ? `${R.valeurCompetence(a, c)} %` : "–"; });
    (a.armes || []).forEach((w, i) => { res[`arme-v-${i}`] = w.nom ? `${R.valeurArme(a, w)} %` : "–"; });
    const voulu = R.nbDonsCreation(+a.psy || 0);
    const n = (a.dons || []).length;
    res["nb-dons"] = (a.niveau || 1) > 1 ? `${n} don${n > 1 ? "s" : ""}` : `${n} don${n > 1 ? "s" : ""} sur ${voulu}`;
    return res;
  }

  htmlRail(v) {
    const marque = (etat) => (etat === "ok" ? `<span class="marque ok" aria-label="fait">${COCHE}</span>`
      : etat === "erreur" ? '<span class="marque erreur" aria-label="règle à corriger"></span>' : '<span class="marque a-faire" aria-label="à compléter"></span>');
    return `
      <ol class="rail-etapes">${R.ETAPES.map((x) => `
        <li><button data-etape="${x.n}" aria-current="${this.etape === x.n}"><span class="num">${x.n}</span><span class="t">${e(x.titre)}</span>${marque(v.etapes[x.n].etat)}</button></li>`).join("")}
      </ol>
      <ul class="rail-plus">${Object.entries(this.joueur ? PANNEAUX_JOUEUR : PANNEAUX).map(([k, t]) => `
        <li><button data-etape="${k}" aria-current="${this.etape === k}"><span class="t">${t}</span>${k === "progression" ? `<span class="compte">niv. ${this.a.niveau || 1}</span>` : ""}${k === "mj" && confieNonLu(this.a) ? '<span class="nouveau-confie" title="Un texte confié par son joueur, pas encore lu">nouveau</span>' : ""}</button></li>`).join("")}
      </ul>
      <p class="pret ${v.pret ? "oui" : ""}">${v.pret ? R.accord("{Prêt|Prête} à jouer", this.a) : "Création en cours"}</p>`;
  }

  // Une information (« info ») se lit sans rien bloquer : l'étape reste cochée.
  htmlVerif(etape) {
    const liste = (messages) => `<ul>${messages.map((m) => `<li class="${m.niveau}">${e(m.texte)}</li>`).join("")}</ul>`;
    if (!etape || etape.etat === "ok") {
      const infos = (etape?.messages || []).filter((m) => m.niveau === "info");
      return `<p class="ok">${COCHE}Cette étape respecte les règles du kit.</p>${infos.length ? liste(infos) : ""}`;
    }
    return liste(etape.messages);
  }

  // Ce que l'atelier signale sans rien bloquer : un héros fini à qui personne n'est encore noté pour le jouer (d23).
  avertissements(n) {
    if (this.joueur || n !== 10 || (this.a?.joueur || "").trim()) return [];
    return [{ niveau: "info", texte: R.accord("Personne ne {le|la} joue encore : notez son joueur en haut de la fiche, à « Joué par ».", this.a) }];
  }

  avecAvertissements(etape, n) {
    const plus = this.avertissements(n);
    return plus.length && etape ? { ...etape, messages: [...etape.messages, ...plus] } : etape;
  }

  // La barre fine du téléphone (css/createur.css) : l'étape, l'état de l'enregistrement, l'étape suivante ; à la
  // dernière, l'envoi au MJ (coin des joueurs) ou la fiche à imprimer (atelier).
  htmlBarre() {
    const n = this.etape;
    // Le même témoin que l'en-tête, en mot court ; l'en-tête seul l'annonce aux lecteurs d'écran.
    const etat = `<span class="bf-etat" aria-hidden="true">${htmlTemoin()}</span>`;
    if (typeof n !== "number") return `<button class="bf-precedente" disabled aria-hidden="true">‹</button><p class="bf-titre"><span class="bf-etape">${e(PANNEAUX[n] || "")}</span>${etat}</p>`;
    const suite = n < 10 ? `<button class="principal bf-suite" data-etape="${n + 1}" aria-label="Étape ${n + 1} : ${e(R.ETAPES[n].titre)}">Étape ${n + 1} ›</button>`
      : this.joueur ? (this.moi?.accueilli ? "" : '<button class="principal bf-suite" data-action="envoyer-mj">Envoyer au MJ</button>')
      : `<a class="bouton bf-suite" ${this.attributsFiche()}>Fiche A4</a>`;
    return `<button class="bf-precedente" ${n > 1 ? `data-etape="${n - 1}" aria-label="Étape ${n - 1} : ${e(R.ETAPES[n - 2].titre)}"` : 'disabled aria-hidden="true"'}>‹</button>
      <p class="bf-titre"><span class="bf-etape"><b>Étape ${n} / 10</b> · ${e(R.ETAPES[n - 1].titre)}</span>${etat}</p>${suite}`;
  }

  htmlApercu(v) {
    const a = this.a;
    const comps = (a.competences || []).filter((c) => (c.nom || "").trim());
    const armes = (a.armes || []).filter((w) => (w.nom || "").trim());
    const dons = (a.dons || []).map(R.lireDon);
    const posture = R.postureDe(a.posture);
    const messages = Object.entries(v.etapes).flatMap(([n, x]) => x.messages.filter((m) => m.niveau !== "info").map((m) => ({ ...m, n })));
    return `
      <p class="kicker">La fiche</p>
      <div class="apercu-stats">${R.CARACS.map((c) => `<div><span>${c.nom}</span><b>${dizaine(a[c.cle])}</b></div>`).join("")}</div>
      <div class="apercu-jauges">
        <span>Santé <b>${e(a.sante)}</b></span><span>Psy <b>${e(a.psy)}</b></span>
        <span>Armure <b>${e(a.protection?.indice ?? 0)}${a.bouclier ? "+2" : ""}</b></span>
        <span>${posture ? e(posture.nom) : "posture ?"}</span>
      </div>
      ${this.htmlAujourdhui()}
      <h3>Compétences</h3>
      <ul class="apercu-liste">${comps.map((c) => `<li><span>${e(c.nom)} <small>+${e(c.bonus)}</small></span><b>${R.valeurCompetence(a, c)} %</b></li>`).join("") || '<li class="vide">aucune</li>'}</ul>
      <h3>Armes</h3>
      <ul class="apercu-liste">${armes.map((w) => `<li><span>${e(w.nom)} <small>${e(w.degats || "")}</small></span><b>${R.valeurArme(a, w)} %</b></li>`).join("") || '<li class="vide">aucune</li>'}</ul>
      <h3>Dons <small data-calc="nb-dons">${this.calculs()["nb-dons"]}</small></h3>
      <ul class="apercu-liste">${dons.map((d) => `<li><span>${e(d.nom)}</span><span class="cout">${e(d.cout)}</span></li>`).join("") || '<li class="vide">aucun</li>'}</ul>
      ${a.posture_elementaire ? `<p class="apercu-posture"><b>Posture élémentaire</b> ${e(a.posture_elementaire)}</p>` : ""}
      <h3>${messages.length ? (v.pret ? "À compléter" : "À régler") : "Vérifications"}</h3>
      ${messages.length ? `<ul class="a-regler">${messages.slice(0, 9).map((m) => `<li class="${m.niveau}"><button data-etape="${m.n}">${m.n}</button>${e(m.texte)}</li>`).join("")}${messages.length > 9 ? `<li class="plus">et ${messages.length - 9} de plus</li>` : ""}</ul>` : `<p class="ok">${COCHE}Toutes les règles du kit sont respectées.</p>`}`;
  }

  // « Aujourd'hui : Santé 5/8, Psy 2/5, carton jaune en Physique », sur les maximums de la fiche en cours.
  htmlAujourdhui() {
    if (this.joueur || !this.etatsHeros || !this.a) return "";
    const x = etatComplet(this.a, this.etatsHeros[this.a.id]);
    const texte = enPleineForme(x) && !x.notes ? "en pleine forme" : resumeEtat(x, { notes: true });
    return `<p class="apercu-aujourdhui" title="L'état du moment, tenu dans Séances › Jouer et au combat"><b>Aujourd'hui :</b> ${e(texte)}.</p>`;
  }

  // ---------------------------------------------------------------- les étapes

  afficherEtape() {
    const zone = this.racine.querySelector(".etape-zone");
    if (!zone) return;
    const n = this.etape;
    if (PANNEAUX[n]) zone.innerHTML = this[`panneau_${n}`]();
    else {
      const et = R.ETAPES[n - 1];
      const v = R.verifier(this.a).etapes[n];
      zone.innerHTML = `${this.lectureSeule ? this.htmlBandeauAccueilli() : ""}
        <header class="tete-etape">
          <p class="kicker">Étape ${n} sur 10</p>
          <h1>${e(et.titre)}</h1>
          <p class="regle">${e(et.regle)}</p>
        </header>
        ${this.lectureSeule ? `<fieldset class="corps-etape lecture-seule" disabled>${this[`etape${n}`]()}</fieldset>` : `<div class="corps-etape">${this[`etape${n}`]()}</div>`}
        <div class="verif" aria-live="polite">${this.htmlVerif(this.avecAvertissements(v, n))}</div>
        <details class="exemple-etape"><summary>L'exemple du kit : ${e(R.GUIDE.exemple)}</summary><p>${e(et.exemple)}</p></details>
        <nav class="suite-etapes">
          ${n > 1 ? `<button data-etape="${n - 1}">Étape ${n - 1}</button>` : "<span></span>"}
          ${n < 10 ? `<button class="principal" data-etape="${n + 1}">Étape ${n + 1} : ${e(R.ETAPES[n].titre)}</button>` : `<a class="bouton principal" ${this.attributsFiche()}>Imprimer la fiche</a>`}
        </nav>`;
    }
    zone.querySelectorAll("textarea").forEach(ajuster);
    // « Confié au MJ » : ce que le joueur écrit pour le MJ seul, page « Pour le MJ » ; atelier seul.
    if (!this.joueur && this.a?.id) import("./confie-mj.js").then((m) => m.suivreConfie(this)).catch(() => {});
  }

  // Changer d'étape ne touche pas la fiche : l'étape vit dans l'adresse.
  aller(n) {
    this.etape = n;
    history.replaceState(null, "", this.joueur ? `#etape=${n}` : this.a.id ? `#/aventuriers/${this.a.id}?etape=${n}` : `#/aventuriers?nouveau&etape=${n}`);
    this.afficherEtape();
    this.rafraichir();
    this.versLeHautDeLEtape();
  }

  // La nouvelle étape se lit depuis son titre : la colonne remonte (bureau), ou la page, juste sous la barre fine (téléphone).
  versLeHautDeLEtape() {
    const zone = this.racine.querySelector(".etape-zone");
    if (!zone) return;
    if (getComputedStyle(zone).overflowY !== "visible") return zone.scrollTo({ top: 0 });
    const barre = this.racine.querySelector(".barre-fine");
    const colle = barre ? barre.offsetHeight + (parseFloat(getComputedStyle(barre).top) || 0) : 0;
    window.scrollTo({ top: Math.max(0, zone.getBoundingClientRect().top + window.scrollY - colle) });
  }

  question(cle, libelle, indice) {
    return `<label class="champ">${libelle}<span class="avec-de"><textarea rows="2" data-champ="${cle}" placeholder="${e(indice)}">${e(this.a[cle] || "")}</textarea><button class="de" data-tirer="${cle}" title="Une idée au hasard">${DE}</button></span></label>`;
  }

  etape1() {
    const a = this.a;
    return `
      <div class="genre-choix"><span class="lbl">Il ou elle ?</span>
        <button data-genre="h" aria-pressed="${a.genre === "h"}">Un aventurier</button>
        <button data-genre="f" aria-pressed="${a.genre === "f"}">Une aventurière</button>
      </div>
      ${this.question("avant", "Qui étiez-vous avant ?", R.GUIDE.avant)}
      ${this.question("pourquoi", R.accord("Pourquoi être devenu{|e} aventuri{er|ère} ?", a), "une dette, un nom à laver, un village qui vous craint…")}
      ${this.question("jamais", "Ce que vous ne ferez jamais", R.GUIDE.jamais)}
      <p class="aide">${e(R.GUIDE.idees)}</p>`;
  }

  etape2() {
    const a = this.a;
    const connu = R.peupleConnu(a.peuple);
    const donsDe = (liste) => R.DONS.filter((d) => d.liste === liste).map((d) => d.nom).join(", ");
    // La case vient avant les peuples : un peuple secret ne doit jamais passer sur la TV, même le temps d'un clic.
    return `
      <label class="case"><input type="checkbox" data-champ="peuple_cache" ${a.peuple_cache ? "checked" : ""}> ${this.joueur ? "Garder mon peuple secret : seul le MJ le saura" : "Garder le peuple secret : la TV ne l'affiche jamais"}</label>
      <p class="aide">${e(R.GUIDE.peupleSecret)}</p>
      <div class="choix-cartes">${R.PEUPLES.map((p) => `
        <button class="choix-carte" data-peuple="${e(p.nom)}" aria-pressed="${connu?.nom === p.nom}">
          <b>${e(a.genre === "f" ? p.f : p.nom)}</b><span>${e(p.texte)}</span>
          ${p.dons ? `<small>Dons : ${e(donsDe(p.dons))}</small>` : ""}
        </button>`).join("")}
      </div>
      <label class="champ">Un autre peuple, à inventer avec le MJ<input type="text" data-champ="peuple" value="${connu ? "" : e(a.peuple || "")}" placeholder="un peuple des marais, une fée déchue…"></label>
      <label class="champ">Particularités, décidées par le MJ<textarea rows="2" data-champ="particularites" placeholder="rien de spécial, ou ce que le MJ accorde (en bien ou en mal)">${e(a.particularites || "")}</textarea></label>
      <p class="aide">Aucun peuple ne donne de bonus automatique : le MJ décide au cas par cas. La particularité s'imprime sur la fiche.</p>`;
  }

  etape3() {
    const a = this.a;
    const choisies = a.vocations || [];
    const exemple = choisies.map((v) => R.vocationConnue(v)?.exemples.split(", ")[0]).filter(Boolean).join(" et ") || "lancier et marchand";
    return `
      <div class="choix-cartes vocations">${R.VOCATIONS.map((v) => `
        <button class="choix-carte" data-vocation="${e(v.nom)}" aria-pressed="${choisies.includes(v.nom)}">
          <b>${e(R.vocationAccordee(v.nom, a.genre))}</b><i>${e(v.exemples)}</i>
          <span><span class="lbl">Compétences</span> ${e(v.competences.join(", "))}</span>
          <span><span class="lbl">Au départ</span> ${e(v.equipement)}</span>
        </button>`).join("")}
      </div>
      <label class="champ">En quelques mots, sous le nom<input type="text" data-champ="specialite" value="${e(a.specialite || "")}" placeholder="${e(exemple)}"></label>
      <p class="aide">Ce qui s'écrit sous le nom, sur la fiche et à la TV : « paladine de la Lumière », « voleur en fuite ». Vide, on écrit les vocations.</p>`;
  }

  etape4() {
    const a = this.a;
    const att = R.attendus(a.niveau || 1);
    return `
      <div class="caracs">${R.CARACS.map((c) => `
        <div class="carac">
          <span class="lbl-c">${c.nom}</span>
          <div class="reglage">
            <button data-carac-pas="${c.cle}:-5" aria-label="${c.nom} moins 5">−</button>
            <input type="number" step="5" min="25" max="${att.caracMax}" value="${e(a[c.cle])}" data-carac="${c.cle}" aria-label="${c.nom}">
            <button data-carac-pas="${c.cle}:5" aria-label="${c.nom} plus 5">+</button>
          </div>
          <span class="aide-c">${c.aide}</span>
        </div>`).join("")}
      </div>
      <p class="reste" data-calc="reste-carac">${this.calculs()["reste-carac"]}</p>
      <table class="reperes"><tr><th>Valeur</th><th>Ce que cela veut dire</th></tr>${R.REPERES.map(([v, t]) => `<tr><td>${v}</td><td>${e(t)}</td></tr>`).join("")}</table>
      <p class="aide">Une compétence s'ajoute ensuite à la caractéristique : Physique 65 et Lames +20 font une épée à 85 %.</p>`;
  }

  etape5() {
    const a = this.a;
    const creation = (a.niveau || 1) === 1;
    const typiques = [...new Set((a.vocations || []).flatMap((v) => R.vocationConnue(v)?.competences || []))];
    const pris = (a.competences || []).map((c) => R.simple(c.nom));
    return `
      <div class="profils"><span class="lbl">Répartir d'un clic</span>${R.PROFILS_COMP.map(([nom, bonus, pour], i) => `<button data-profil="${i}" title="${e(pour)}">${e(nom)} <small>${bonus.join(" · ")}</small></button>`).join("")}</div>
      <table class="table-comp">
        <thead><tr><th>Compétence</th><th class="n">Bonus</th><th>Avec</th><th class="n">Valeur</th><th></th></tr></thead>
        <tbody>${(a.competences || []).map((c, i) => {
          const k = R.competenceConnue(c.nom);
          return `
          <tr>
            <td><input type="text" list="liste-competences" data-comp="${i}" data-cc="nom" value="${e(c.nom || "")}" placeholder="Lames, Présence, Perception…" aria-label="Compétence ${i + 1}"><small class="aide-comp">${e(k?.aide || "")}</small></td>
            <td class="bonus"><button data-comp-pas="${i}:-5" aria-label="moins 5">−</button><b>+${e(c.bonus)}</b><button data-comp-pas="${i}:5" aria-label="plus 5">+</button></td>
            <td class="avec">${choixPsm(i, c.nom, c.avec || k?.avec || "Physique")}</td>
            <td class="n valeur" data-calc="comp-v-${i}">${c.nom ? `${R.valeurCompetence(a, c)} %` : "–"}</td>
            <td>${!creation || a.competences.length > 4 ? `<button class="retirer" data-action="comp-retirer" data-i="${i}" aria-label="Retirer">×</button>` : ""}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      <datalist id="liste-competences">${R.COMPETENCES.flatMap(([, l]) => l).map(([n]) => `<option value="${e(n)}">`).join("")}</datalist>
      <p class="reste" data-calc="reste-comp">${this.calculs()["reste-comp"]}</p>
      ${!creation ? '<div class="actions"><button data-action="comp-ajouter">Ajouter une compétence</button></div>' : ""}
      ${typiques.length ? `<div class="rapides"><span class="lbl">Typiques de vos vocations</span>${typiques.map((t) => `<button data-comp-rapide="${e(t)}" ${pris.includes(R.simple(t)) ? 'aria-pressed="true"' : ""}>${e(t)}</button>`).join("")}</div>` : '<p class="aide">Choisissez une vocation (étape 3) pour voir ses compétences typiques.</p>'}
      <details class="liste-complete"><summary>Toutes les compétences, et ce qu'elles couvrent</summary>
        <div class="groupes-comp">${R.COMPETENCES.map(([c, l]) => `<div><h3>${c}</h3>${l.map(([n, d]) => `<p><button class="lien" data-comp-rapide="${e(n)}">${e(n)}</button> : ${e(d)}</p>`).join("")}</div>`).join("")}</div>
      </details>
      <p class="aide">La liste est ouverte : inventez une compétence avec le MJ. Sans la compétence, on teste la caractéristique seule.</p>`;
  }

  etape6() {
    const a = this.a;
    const total = R.attendus(a.niveau || 1).santePsy;
    const s = +a.sante || 0;
    const p = +a.psy || 0;
    const voulu = R.nbDonsCreation(p);
    return `
      <div class="partage">
        <div class="jauge-choix sante"><span class="lbl">Santé</span>
          <span class="pas-jauge"><button data-sante-pas="-1" aria-label="Santé moins 1" ${s <= 5 ? "disabled" : ""}>−</button><b>${s}</b><button data-sante-pas="1" aria-label="Santé plus 1" ${s >= total - 1 ? "disabled" : ""}>+</button></span>
          <span>ce que le corps encaisse</span></div>
        <div class="reglette" role="group" aria-label="Partage entre Santé et Psy">${Array.from({ length: total }, (_, i) => `
          <button data-sante="${i + 1}" class="${i < s ? "s" : "p"}" aria-label="Santé ${i + 1}, Psy ${total - i - 1}" title="Santé ${i + 1}, Psy ${total - i - 1}"></button>`).join("")}
        </div>
        <div class="jauge-choix psy"><span class="lbl">Psy</span>
          <span class="pas-jauge"><button data-sante-pas="1" aria-label="Psy moins 1" ${p <= 1 ? "disabled" : ""}>−</button><b>${p}</b><button data-sante-pas="-1" aria-label="Psy plus 1" ${s <= 5 ? "disabled" : ""}>+</button></span>
          <span>ce qui alimente les dons</span></div>
      </div>
      <p class="aide">Touchez une case : tout ce qui est à gauche devient Santé, le reste Psy. Ou réglez point par point avec − et +.</p>
      ${(a.niveau || 1) === 1 ? `
      <table class="paliers"><tr><th>Psy</th><th>Dons à la création</th></tr>
        <tr class="${p < 5 ? "actif" : ""}"><td>1 à 4</td><td>3 dons</td></tr>
        <tr class="${p >= 5 && p < 7 ? "actif" : ""}"><td>5 ou 6</td><td>4 dons</td></tr>
        <tr class="${p >= 7 ? "actif" : ""}"><td>7</td><td>5 dons</td></tr>
      </table>
      <p class="consequence">Avec ${p} en Psy : <b>${voulu} dons</b>. Le guerrier a peu de dons et beaucoup de Santé, le mage l'inverse.</p>` : ""}
      <p class="aide">À 0 de Santé, on tombe dans le coma ; la mort vient à moins la Santé maximum, et jamais avant −10. Une nuit complète rend 1D6 Psy.</p>`;
  }

  etape7() {
    const a = this.a;
    const creation = (a.niveau || 1) === 1;
    const listes = R.listesDe(a);
    const noms = new Set((a.dons || []).map((d) => R.simple(d.nom)));
    const carte = (d) => `
      <button class="carte-don" data-don="${e(d.nom)}" aria-pressed="${noms.has(R.simple(d.nom))}">
        <span class="t"><b>${e(d.nom)}</b><span class="cout">${e(d.cout)}</span></span>
        <span class="effet">${e(d.effet)}</span>${d.heros ? `<small>${e(d.heros)}</small>` : ""}
      </button>`;
    const pourquoi = { peuple: "votre peuple", vocation: "votre vocation", élément: "votre élément" };
    const autres = [...new Set(R.DONS.map((d) => d.liste))].filter((l) => !listes.some((x) => x.liste === l));
    const b = this.brouillonDon;
    return `
      <p class="compte-dons"><b data-calc="nb-dons">${this.calculs()["nb-dons"]}</b>${creation ? ` <span class="aide">(règle : 3 dons, plus 1 avec 5 en Psy, plus 1 avec 7 ; vous avez ${e(a.psy)} en Psy.)</span>` : ""}</p>
      ${!a.element ? `<label class="champ">Votre élément ouvre sa liste de dons (étape 8)<select data-champ="element"><option value="">choisir un élément…</option>${R.ELEMENTS.map((x) => `<option>${e(x.nom)}</option>`).join("")}</select></label>` : ""}
      ${(a.dons || []).length ? `
      <section class="dons-choisis"><h2>Vos dons</h2>
        ${(a.dons || []).map((d, i) => {
          const l = R.lireDon(d);
          // Un don pris hors des listes du personnage est conforme dès que le MJ l'a validé.
          const horsListe = !l.cree && l.liste && !listes.some((x) => x.liste === l.liste);
          return l.cree ? `
          <div class="don-cree">
            <div class="deux"><label class="champ">Don créé avec le MJ<input type="text" data-don-cree="${i}" data-dc="nom" value="${e(d.nom)}"></label>
            <label class="champ">Coût<input type="text" data-don-cree="${i}" data-dc="cout" value="${e(d.cout ?? "")}"></label></div>
            <label class="champ">Effet<textarea rows="2" data-don-cree="${i}" data-dc="effet">${e(d.effet || "")}</textarea></label>
            <button class="lien-danger" data-action="don-retirer" data-i="${i}">Retirer ce don</button>
          </div>` : `<p class="don-pris"><b>${e(l.nom)}</b><span class="cout">${e(l.cout)}</span>${e(l.effet)} <button class="lien-danger" data-action="don-retirer" data-i="${i}">Retirer</button></p>
          ${horsListe ? (this.joueur ? `<p class="aide don-mj">Hors de vos listes (${e(l.liste)}) : à valider par le MJ.</p>` : `<label class="case don-mj"><input type="checkbox" data-don-mj="${i}" ${d.valide_mj ? "checked" : ""}> Validé par le MJ, hors de vos listes (${e(l.liste)})</label>`) : ""}`;
        }).join("")}
      </section>` : ""}
      ${listes.map((l) => `
      <section class="liste-dons-choix"><h2>${e(l.liste)} <small>${pourquoi[l.pourquoi]}</small></h2>
        <div class="dons-grille">${R.DONS.filter((d) => d.liste === l.liste).map(carte).join("")}</div>
      </section>`).join("") || '<p class="aide">Choisissez un peuple, une vocation et un élément : leurs listes de dons apparaîtront ici.</p>'}
      <details class="autres-dons"><summary>Les autres listes, avec l'accord du MJ</summary>
        ${autres.map((l) => `<h3>${e(l)}</h3><div class="dons-grille">${R.DONS.filter((d) => d.liste === l).map(carte).join("")}</div>`).join("")}
      </details>
      <details class="creer-don"><summary>Créer un don avec le MJ</summary>
        <p class="aide">Décrivez ce que fait le don, puis fixez son coût avec le MJ d'après ce barème. Sauf mention contraire, un don dure une scène, touche ce que l'on voit, et se teste s'il vise quelqu'un.</p>
        <table class="bareme"><tr><th>Coût</th><th>Ampleur</th><th>Dons du livret à ce prix</th></tr>${R.BAREME.map(([c, t, x]) => `<tr><td><span class="cout">${e(c)}</span></td><td>${e(t)}</td><td class="doux">${e(x)}</td></tr>`).join("")}</table>
        <div class="deux"><label class="champ">Nom du don<input type="text" data-bd="nom" value="${e(b.nom)}" placeholder="Retour en arrière"></label>
        <label class="champ">Coût<select data-bd="cout">${option(["0", "1", "2", "3", "4", "X"].map((x) => [x, x]), b.cout)}</select></label></div>
        <label class="champ">Effet<textarea rows="2" data-bd="effet" placeholder="Une fois par scène, faites relancer un dé qui vient d'être lancé.">${e(b.effet)}</textarea></label>
        <div class="actions"><button data-action="don-creer">Ajouter ce don</button></div>
      </details>`;
  }

  etape8() {
    const a = this.a;
    const connu = R.elementConnu(a.element);
    const themes = (a.themes || []).map(R.simple);
    return `
      <h2>L'élément</h2>
      <div class="puces-elements">${R.ELEMENTS.map((x) => `
        <button data-element="${e(x.nom)}" aria-pressed="${connu?.nom === x.nom}"><span class="puce-el" style="background:${fondMedaillon({ element: x.nom })}">${svgEmbleme(x.nom)}</span>${e(x.nom)}</button>`).join("")}
      </div>
      <label class="champ">Un autre élément, avec le MJ<input type="text" data-champ="element" value="${connu ? "" : e(a.element || "")}" placeholder="cristal, rêve, poussière…"></label>
      <p class="aide">${e(R.GUIDE.elements)}</p>
      <h2>La posture de base</h2>
      <div class="choix-cartes postures">${R.POSTURES.map((p) => `
        <button class="choix-carte" data-posture="${p.cle}" aria-pressed="${a.posture === p.cle}">
          <b>${e(p.nom)}</b><span><span class="lbl">Donne</span> ${e(p.donne)}</span><span><span class="lbl">Coûte</span> ${e(p.coute)}</span>
        </button>`).join("")}
      </div>
      <h2>Trois thèmes</h2>
      <div class="themes-saisie">${[0, 1, 2].map((i) => `<input type="text" list="liste-themes" data-theme="${i}" value="${e((a.themes || [])[i] || "")}" placeholder="Thème ${i + 1}" aria-label="Thème ${i + 1}">`).join("")}</div>
      <datalist id="liste-themes">${R.THEMES.map((t) => `<option value="${e(t)}">`).join("")}</datalist>
      <div class="nuage-themes">${R.THEMES.map((t) => `<button data-theme-rapide="${e(t)}" aria-pressed="${themes.includes(R.simple(t))}">${e(t)}</button>`).join("")}</div>
      <p class="aide">${e(R.GUIDE.themes)}</p>`;
  }

  // Le nom d'une compétence dans la liste d'une arme : « Physique seul », « Lames », ou « Lames, à apprendre ».
  // Le compteur d'une ligne d'équipement : « − », le nombre, « + ». Rien pour une ligne vide ou qui ne se compte pas.
  htmlQuantite(texte, i) {
    const t = String(texte ?? "");
    if (!t.trim() || douteuse(t)) return "";
    const [objet, n] = quantiteDe(t);
    return `<span class="equip-quantite" role="group" aria-label="Quantité de ${e(objet)}"><button type="button" data-action="equip-quantite" data-i="${i}" data-de="-1" aria-label="Un de moins">−</button><output>${n}</output><button type="button" data-action="equip-quantite" data-i="${i}" data-de="1" aria-label="Un de plus">+</button></span>`;
  }

  // Deux lignes du même nom n'en font qu'une, la quantité de la première monte (« Torche » et « Torche » font
  // « Torche ×2 ») : fait au moment d'ajouter une ligne, jamais pendant la frappe.
  reunirEquipement() {
    let liste = [];
    for (const x of (this.a.equipement || []).map((v) => String(v ?? ""))) {
      const r = x.trim() ? corpsDuSac({ equipement: liste }, { genre: "ajouter", liste: "equipement", texte: x }) : {};
      liste = r.equipement && !r.erreur ? r.equipement.apres : [...liste, x];
    }
    this.a.equipement = liste;
  }

  libelleCompetence(c) {
    if (CARACS_SEULES.includes(c)) return `${c} seul`;
    return (this.a.competences || []).some((x) => (x.nom || "").trim() && R.simple(x.nom) === R.simple(c)) ? c : `${c}, à apprendre`;
  }

  etape9() {
    const a = this.a;
    const vocs = (a.vocations || []).map(R.vocationConnue).filter(Boolean);
    const comps = (a.competences || []).filter((c) => (c.nom || "").trim()).map((c) => c.nom);
    // La compétence de l'arme (même pas encore apprise), celles de la fiche, puis une caractéristique seule.
    const optionsComp = (w) => {
      const valeur = w.competence || "Physique";
      const naturelle = R.armeConnue(w.nom)?.competence;
      const liste = [];
      for (const c of [naturelle, valeur, ...comps, ...CARACS_SEULES]) if (c && !liste.some((x) => R.simple(x) === R.simple(c))) liste.push(c);
      return liste.map((c) => `<option value="${e(c)}" ${R.simple(c) === R.simple(valeur) ? "selected" : ""}>${e(this.libelleCompetence(c))}</option>`).join("");
    };
    const armure = R.armureConnue(a.protection?.nom);
    const bourse = R.bourseDeDepart(a);
    const politicien = bourse.double;
    const tirage = this.dernierTirage;
    return `
      <h2>Le kit de votre vocation</h2>
      ${vocs.length ? `<div class="kits">${vocs.map((v) => `
        <div class="kit"><b>${e(R.vocationAccordee(v.nom, a.genre))}</b><p>${e(v.equipement)}</p><button data-kit="${e(v.nom)}">Prendre ce kit</button></div>`).join("")}</div>`
        : '<p class="aide">Choisissez une vocation (étape 3) : elle donne l\'équipement de départ.</p>'}
      <h2>Armes</h2>
      ${(a.armes || []).length ? `
      <table class="table-armes">
        <thead><tr><th>Arme</th><th>Avec</th><th class="n">Dégâts</th><th>Notes</th><th class="n">Valeur</th><th></th></tr></thead>
        <tbody>${a.armes.map((w, i) => `
          <tr class="${i ? "" : "principale"}">
            <td><input type="text" list="liste-armes" data-arme="${i}" data-ac="nom" value="${e(w.nom || "")}" placeholder="Épée, arc long…" aria-label="Arme"></td>
            <td><select data-arme="${i}" data-ac="competence" aria-label="Compétence">${optionsComp(w)}</select></td>
            <td><input type="text" class="court" data-arme="${i}" data-ac="degats" value="${e(w.degats || "")}" aria-label="Dégâts"></td>
            <td><input type="text" data-arme="${i}" data-ac="notes" value="${e(w.notes || "")}" aria-label="Notes"></td>
            <td class="n valeur" data-calc="arme-v-${i}">${w.nom ? `${R.valeurArme(a, w)} %` : "–"}</td>
            <td class="outils-ligne">${i ? `<button data-action="arme-principale" data-i="${i}" title="En faire l'arme principale" aria-label="En faire l'arme principale">↑</button>` : ""}<button class="retirer" data-action="arme-retirer" data-i="${i}" aria-label="Retirer">×</button></td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
      <datalist id="liste-armes">${R.ARMES.map((w) => `<option value="${e(w.nom)}">${e(w.degats)}</option>`).join("")}</datalist>
      <div class="actions"><button data-action="arme-ajouter">Ajouter une arme</button></div>
      <p class="aide">Valeur : la caractéristique plus la compétence de l'arme. Tant que cette compétence n'est pas sur la fiche, l'arme se sert de la caractéristique seule, et sa valeur monte d'elle-même quand la compétence arrive. La première ligne est l'arme principale : la balance des combats s'en sert.</p>
      <h2>Protection</h2>
      <div class="deux">
        <label class="champ">Armure<select data-protection><option value="">choisir…</option>${R.ARMURES.map((x) => `<option value="${e(x.nom)}" ${armure?.nom === x.nom ? "selected" : ""}>${e(x.nom)} (${x.indice})</option>`).join("")}${a.protection && !armure ? `<option selected>${e(a.protection.nom)}</option>` : ""}</select></label>
        <label class="case bouclier"><input type="checkbox" data-champ="bouclier" ${a.bouclier ? "checked" : ""}> Un bouclier : +2 d'armure en posture défensive</label>
      </div>
      ${armure?.gene ? `<p class="aide">Gêne : ${e(armure.gene)}.</p>` : ""}
      <h2>Équipement</h2>
      <ul class="liste-equipement">${(a.equipement || []).map((x, i) => `<li><input type="text" data-equip="${i}" value="${e(x)}" aria-label="Objet">${this.htmlQuantite(x, i)}<button class="retirer" data-action="equip-retirer" data-i="${i}" aria-label="Retirer">×</button></li>`).join("")}</ul>
      <div class="actions"><button data-action="equip-ajouter">Ajouter un objet</button></div>
      <p class="aide">Plusieurs fois le même objet : « + » et « − », ou écrivez « Potion de soins ×3 ».</p>
      <h3>Trois objets personnels</h3>
      <div class="objets">${[0, 1, 2].map((i) => `<input type="text" data-objet="${i}" value="${e((a.objets || [])[i] || "")}" placeholder="${["un souvenir", "un outil de l'ancien métier", "un objet qu'on ne montre pas"][i]}" aria-label="Objet personnel ${i + 1}">`).join("")}</div>
      <p class="aide">${e(R.SAC)}</p>
      <h2>Bourse et langues</h2>
      <div class="bourse">
        <button data-action="or-lancer">Lancer 3D6 × 10</button>
        <span class="des-or">${tirage ? `${tirage.des.map((d) => `<span class="d6">${d}</span>`).join("")} = ${tirage.somme} × 10${politicien ? " × 2" : ""}` : ""}</span>
        <label class="champ">Pièces d'or<input type="number" min="0" data-champ="or" value="${a.or ?? ""}"></label>
      </div>
      <p class="aide">3D6 × 10 : de ${bourse.min} à ${bourse.max} pièces d'or au départ${politicien ? ", la bourse du politicien étant doublée" : ""}.</p>
      <label class="champ">Langues<input type="text" data-champ="langues" value="${e(a.langues || "")}" placeholder="Commun, nain"></label>
      <p class="aide">Le commun, et au moins une autre langue.</p>
      <div class="rapides"><span class="lbl">Ajouter</span>${R.LANGUES.map((l) => `<button data-langue="${e(l)}">${e(l)}</button>`).join("")}</div>`;
  }

  etape10() {
    const a = this.a;
    const autres = this.aventuriers.filter((x) => x.id !== a.id && x.tablee !== false);
    const v = R.verifier(a);
    const restes = Object.entries(v.etapes).filter(([, x]) => x.etat !== "ok");
    return `
      <label class="champ">Nom<span class="avec-de"><input type="text" data-champ="nom" value="${e(a.nom || "")}" placeholder="${e(R.GUIDE.exemple)}"><button class="de" data-tirer="nom" title="Tirer un nom qui colle au peuple">${DE}</button></span></label>
      ${this.question("allure", "Allure", "grand, barbe mal taillée, une brûlure sur la main gauche")}
      ${this.question("defaut", "Un défaut visible", "il fait plus confiance aux nains qu'aux humains")}
      <div class="lien-groupe">
        ${this.joueur ? `<label class="champ">Un lien avec<input type="text" data-champ="lien_avec_nom" value="${e(a.lien_avec_nom || "")}" placeholder="le personnage d'un autre joueur"></label>`
          : `<label class="champ">Un lien avec<select data-champ="lien_avec"><option value="">un autre aventurier…</option>${autres.map((x) => `<option value="${e(x.id)}" ${a.lien_avec === x.id ? "selected" : ""}>${e(x.nom || "sans nom")}${x.joueur ? ` (${e(x.joueur)})` : ""}</option>`).join("")}</select></label>`}
        ${!this.joueur && a.lien_avec_nom ? `<label class="champ">Lien noté par le joueur<input type="text" data-champ="lien_avec_nom" value="${e(a.lien_avec_nom)}" placeholder="vide si l'aventurier est choisi ci-dessus"></label>` : ""}
        ${this.question("lien", "Le lien : une dette, un souvenir, une rivalité", R.GUIDE.lien)}
      </div>
      <label class="champ">Contacts, dettes et ennemis<textarea rows="2" data-champ="contacts" placeholder="au verso de la fiche">${e(a.contacts || "")}</textarea></label>
      <h2>L'histoire, en tête de fiche</h2>
      <label class="champ">Qui je suis<textarea rows="4" data-champ="histoire" placeholder="Trois ou quatre phrases : ce que tout le monde lira en haut de la fiche.">${e(a.histoire || "")}</textarea></label>
      <div class="actions">
        <button data-action="histoire-composer">Reprendre les réponses de l'étape 1</button>
        ${this.joueur ? "" : `<button data-action="histoire-ia" data-estimation="histoire" title="Rédigée par le serveur, en une vingtaine de secondes">Proposer une histoire</button>`}
      </div>
      <h2>Pour bien jouer ${e(prenom(a))}</h2>
      <label class="champ">Un conseil par ligne<textarea rows="3" data-conseils placeholder="Vide, la fiche imprimée en propose trois d'après les règles.">${e((a.conseils || []).join("\n"))}</textarea></label>
      <div class="actions"><button data-action="conseils-auto">Proposer d'après la fiche</button></div>
      <section class="bilan-heros ${v.pret ? "pret" : ""}">
        <h2>${v.pret ? `${e(prenom(a))} est ${R.accord("{prêt|prête}", a)} à jouer` : this.joueur ? "Avant de l'envoyer au MJ" : "Avant d'imprimer"}</h2>
        ${restes.length && v.pret ? `<p class="aide">Rien ne bloque, mais ${restes.length > 1 ? "ces points restent" : "ce point reste"} à compléter si vous le pouvez :</p>` : ""}
        ${restes.length ? `<ul>${restes.map(([n, x]) => `<li><button class="lien" data-etape="${n}">Étape ${n} : ${e(R.ETAPES[n - 1].titre)}</button> ${e(x.messages.filter((m) => m.niveau !== "info").map((m) => m.texte).join(" "))}</li>`).join("")}</ul>` : ""}
        ${this.avertissements(10).length ? `<ul class="avertis-joueur">${this.avertissements(10).map((m) => `<li>${e(m.texte)}</li>`).join("")}</ul>` : ""}
        <div class="actions">
          <a class="bouton ${this.joueur ? "" : "principal"}" ${this.attributsFiche()}>Imprimer la fiche</a>
          ${this.joueur ? '<button class="principal" data-action="envoyer-mj">Envoyer au MJ</button>' : '<button data-action="tv">Montrer à la TV</button>'}
        </div>
      </section>`;
  }

  // Le familier de l'aventurier (une créature qui le suit : élémentaire, petit animal, esprit) : une fiche libre, jusqu'à
  // trois. Le joueur l'écrit comme le reste de son aventurier ; ses règles (Santé, dons, ce qu'il apporte) se règlent avec
  // le MJ, qui les lit ici. Rien n'en part vers la TV de lui-même.
  panneau_familier() {
    const a = this.a;
    const liste = Array.isArray(a.familiers) ? a.familiers : [];
    const champ = (i, cle, libelle, indice, long) => `<label class="champ">${libelle}${long
      ? `<textarea rows="2" data-fam="${i}" data-fc="${cle}" placeholder="${e(indice)}">${e(liste[i][cle] || "")}</textarea>`
      : `<input type="text" data-fam="${i}" data-fc="${cle}" value="${e(liste[i][cle] || "")}" placeholder="${e(indice)}" maxlength="300">`}</label>`;
    const fiche = (f, i) => `
      <section class="bloc familier" aria-label="Familier ${i + 1}">
        <h2><span data-fam-titre="${i}">${e((f.nom || "").trim() || "Sans nom")}</span></h2>
        ${champ(i, "nom", "Son nom", "Lumi")}
        ${champ(i, "espece", "Ce qu'il est", "Élémentaire de lumière, petit félin ailé…")}
        <label class="champ">Son élément<select data-fam="${i}" data-fc="element"><option value="">aucun, ou je ne sais pas</option>${R.ELEMENTS.map((x) => `<option${f.element === x.nom ? " selected" : ""}>${e(x.nom)}</option>`).join("")}</select></label>
        ${champ(i, "taille", "Sa taille", "35-40 cm sans la queue")}
        ${champ(i, "aspect", "Son aspect, ses signes distinctifs", "Yeux dorés sans pupille, grandes oreilles pointues, mini-cornes recourbées, queue terminée par une flamme…", true)}
        ${champ(i, "humeurs", "Ses humeurs, ce qui change en lui", "Au repos : lueur douce. Quand il soigne : illumination plus forte. En danger : éclat intense.", true)}
        ${champ(i, "caractere", "Son caractère", "Curieux, chapardeur, protecteur, toujours à ses côtés.", true)}
        ${champ(i, "lien", "Son lien avec vous", "Pourquoi il vous a choisi, ce que vous êtes l'un pour l'autre.", true)}
        ${champ(i, "regles", "Ce qu'il fait en jeu (à régler avec le MJ)", "Soigne, éclaire, repère les dangers… Santé, Psy, dons : le MJ tranche avec vous.", true)}
        ${this.joueur ? "" : `<div class="champ image-familier">Son image
          ${/^\/media\/[A-Za-z0-9._-]+$/.test(f.image || "") ? `<p><img src="${e(f.image)}" alt="Image de ${e((f.nom || "").trim() || "ce familier")}" style="max-width:100%;max-height:260px;border-radius:4px"></p>
            <p><button type="button" class="principal" data-action="familier-tv" data-fam="${i}">Montrer à la TV</button>
              <button type="button" data-action="familier-tv-retirer" data-fam="${i}">Retirer de la TV</button>
              <button type="button" data-action="familier-image-retirer" data-fam="${i}">Retirer l'image</button></p>` : ""}
          <input type="file" accept="image/png,image/jpeg,image/webp" data-action="familier-image" data-fam="${i}" aria-label="Choisir l'image de ${e((f.nom || "").trim() || "ce familier")}"></div>`}
        <p><button type="button" data-action="familier-retirer" data-fam="${i}">Retirer ce familier</button></p>
      </section>`;
    return `
      <header class="tete-etape"><p class="kicker">Familier</p><h1>${liste.length > 1 ? "Les familiers" : "Le familier"} de ${e(prenom(a))}</h1>
        <p class="regle">Une créature qui le suit partout. Décrivez-la ici : le MJ la lit, ajuste ses règles avec vous, et peut la montrer à la table.</p></header>
      ${liste.length ? liste.map(fiche).join("") : '<p class="aide">Pas de familier pour l\'instant.</p>'}
      ${liste.length < FAMILIERS_MAX ? '<p><button type="button" class="principal" data-action="familier-ajouter">Ajouter un familier</button></p>' : ""}`;
  }

  // L'image d'un familier (atelier seul : le coin n'a pas la médiathèque) : envoyée comme celle d'un document, rangée dans
  // data/images sous un nom tiré au sort ; la fiche n'en garde que l'adresse.
  async televerserFamilier(i, fichier) {
    const f = (this.a.familiers || [])[i];
    if (!f) return;
    const donnees = new FormData();
    donnees.append("image", fichier);
    try {
      const { url } = await api.post("/api/images", donnees);
      f.image = url;
      this.marquer(false);
      this.afficherEtape();
      this.rafraichir();
    } catch (err) {
      toast(`Image refusée : ${err.message}`, "erreur");
    }
  }

  panneau_portrait() {
    const a = this.a;
    if (!a.id) return `<header class="tete-etape"><p class="kicker">Portrait</p><h1>Le visage de ${e(prenom(a))}</h1>
        <p class="regle">Le portrait se peint sur une fiche commencée : remplissez d'abord un champ, n'importe lequel.</p></header>`;
    return `
      <header class="tete-etape"><p class="kicker">Portrait</p><h1>Le visage de ${e(prenom(a))}</h1>
        <p class="regle">Sans portrait, la fiche et la TV montrent l'emblème de son élément, comme les fiches du kit. Le portrait peint ici le remplace.</p></header>
      <div class="bloc-portraits portrait-heros">${this.galerie.html(a)}</div>`;
  }

  panneau_mj() {
    const a = this.a;
    return `
      <header class="tete-etape"><p class="kicker">Pour le MJ</p><h1>Ce que la table ne voit pas</h1>
        <p class="regle">Rien de cette page ne part vers la TV ni sur la fiche imprimée.</p></header>
      ${this.joueur || !a.id ? "" : '<section class="confie-au-mj" data-confie-mj aria-live="polite"></section>'}
      <label class="champ secret">Ce que les autres joueurs ignorent<textarea rows="3" data-champ="secret" placeholder="${e(R.GUIDE.secret)}">${e(a.secret || "")}</textarea></label>
      <label class="champ">Notes du MJ<textarea rows="4" data-champ="notes_mj" placeholder="Accroches, fils à tirer, ce que le joueur aime jouer…">${e(a.notes_mj || "")}</textarea></label>
      <div class="pied-fiche"><button class="danger" data-action="supprimer">Mettre à la corbeille</button>
        <a class="lien-versions" href="${lienVersions(a.id)}">Versions précédentes</a></div>`;
  }

  panneau_progression() {
    const a = this.a;
    const n = a.niveau || 1;
    const g = R.NIVEAUX.find((x) => x.n === n + 1);
    const campagne = this.campagne?.niveau || 1;
    return `
      <header class="tete-etape"><p class="kicker">Progression</p><h1>Niveau ${n}</h1>
        <p class="regle">Pas de points d'expérience : le MJ annonce le niveau à la fin d'une histoire, ou environ toutes les trois séances. Le niveau arrive souvent après un repos : Santé et Psy remontent au nouveau maximum.</p></header>
      ${campagne > n ? `<p class="alerte">La campagne est au niveau ${campagne} : ${e(prenom(a))} a du retard.</p>` : `<p class="aide">La campagne est au niveau ${campagne}.</p>`}
      <table class="niveaux-kit"><tr><th class="n">Niv.</th><th>Ce que l'on gagne</th></tr>
        <tr class="fait"><td class="n">1</td><td>Création : 170 %, 60 % de compétences, 12 points de Santé et de Psy, 3 à 5 dons.</td></tr>
        ${R.NIVEAUX.map((x) => `<tr class="${x.n <= n ? "fait" : x.n === n + 1 ? "suivant" : ""}"><td class="n">${x.n}</td><td>${e(x.texte)}</td></tr>`).join("")}
      </table>
      ${g ? this.htmlMonter(g) : '<p class="aide">Niveau 10 : au-delà, on entre dans la légende.</p>'}
      <h2>Journal</h2>
      ${(a.progression || []).length ? `<ul class="journal-niveaux">${a.progression.map((p) => `<li><b>Niveau ${p.niveau}</b> <span class="date">${e(new Date(p.date).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" }))}</span> ${e(p.texte)}</li>`).join("")}</ul>
        <div class="actions"><button class="danger" data-action="niveau-annuler">Annuler le niveau ${n}</button></div>
        <p class="aide">Annuler retire seulement ce que ce niveau a apporté : ce qui a été modifié depuis sur la fiche reste.</p>` : `<p class="aide">Rien encore : ${R.accord("{créé|créée}", a)} au niveau 1.</p>`}`;
  }

  htmlMonter(g) {
    const a = this.a;
    const b = (this.brouillonNiveau ||= { sante: 2, choixDon: "nouveau", don: "", donNom: "", donCout: "1", donEffet: "", ameliore: "", amelioration: R.AMELIORATIONS[0], posture: R.POSTURES_ELEM[R.elementConnu(a.element)?.nom] || "", une: "physique", modeComp: "repartir", compA: "", compB: "", nouvelle: "", nouvelleAvec: "", avecChoisi: false });
    const listes = R.listesDe(a).map((l) => l.liste);
    const pris = new Set((a.dons || []).map((d) => R.simple(d.nom)));
    const libres = R.DONS.filter((d) => !pris.has(R.simple(d.nom)));
    const optDons = `<option value="">choisir un don…</option>
      <optgroup label="Vos listes">${libres.filter((d) => listes.includes(d.liste)).map((d) => `<option value="${e(d.nom)}" ${b.don === d.nom ? "selected" : ""}>${e(d.nom)} (${e(d.cout)})</option>`).join("")}</optgroup>
      <optgroup label="Autres listes, avec l'accord du MJ">${libres.filter((d) => !listes.includes(d.liste)).map((d) => `<option value="${e(d.nom)}" ${b.don === d.nom ? "selected" : ""}>${e(d.nom)} (${e(d.liste)}, ${e(d.cout)})</option>`).join("")}</optgroup>
      <option value="*" ${b.don === "*" ? "selected" : ""}>Un don créé avec le MJ…</option>`;
    const comps = (a.competences || []).filter((c) => (c.nom || "").trim());
    const blocs = [];
    if (g.points) blocs.push(`
      <div class="gain"><h3>3 points entre Santé et Psy</h3>
        <div class="segments">${[0, 1, 2, 3].map((s) => `<button data-nv-sante="${s}" aria-pressed="${b.sante === s}">Santé +${s}, Psy +${3 - s}</button>`).join("")}</div>
        <p class="aide">Santé ${(+a.sante || 0) + b.sante}, Psy ${(+a.psy || 0) + 3 - b.sante}.</p></div>`);
    if (g.toutes) blocs.push(`<div class="gain"><h3>+${g.toutes} % à toutes les caractéristiques</h3><p class="aide">Physique ${+a.physique + g.toutes}, Social ${+a.social + g.toutes}, Mental ${+a.mental + g.toutes} : compétences et armes suivent.</p></div>`);
    if (g.une) blocs.push(`<div class="gain"><h3>+${g.une} % à une caractéristique</h3><select data-nv="une">${option(R.CARACS.map((c) => [c.cle, `${c.nom} : ${+a[c.cle] + g.une}`]), b.une)}</select></div>`);
    if (g.competences) blocs.push(`
      <div class="gain"><h3>+10 % de compétences${g.n === 7 ? ", ou une nouvelle compétence à +10" : ""}</h3>
        <div class="segments"><button data-nv-mode="repartir" aria-pressed="${b.modeComp === "repartir"}">Deux fois +5</button>${g.n === 7 ? `<button data-nv-mode="nouvelle" aria-pressed="${b.modeComp === "nouvelle"}">Nouvelle compétence</button>` : ""}</div>
        ${b.modeComp === "nouvelle" && g.n === 7 ? `<div class="deux"><label class="champ">Compétence<input type="text" list="liste-competences-nv" data-nv="nouvelle" value="${e(b.nouvelle)}"></label><label class="champ">Avec<select data-nv="nouvelleAvec">${option(R.CARACS.map((c) => [c.nom, c.nom]), b.nouvelleAvec || R.competenceConnue(b.nouvelle)?.avec || "Physique")}</select></label></div>
          <datalist id="liste-competences-nv">${R.COMPETENCES.flatMap(([, l]) => l).filter(([x]) => !comps.some((c) => R.simple(c.nom) === R.simple(x))).map(([x]) => `<option value="${e(x)}">`).join("")}</datalist>
          <p class="aide">Une compétence que la fiche n'a pas encore, à +10 ; la caractéristique suit celle du livret.</p>`
        : `<div class="deux">${["compA", "compB"].map((k, i) => `<label class="champ">+5 à<select data-nv="${k}"><option value="">choisir…</option>${comps.map((c) => `<option value="${e(c.nom)}" ${b[k] === c.nom ? "selected" : ""}>${e(c.nom)} (+${c.bonus})</option>`).join("")}</select></label>`).join("")}</div>
          <p class="aide">La même deux fois, c'est +10 d'un coup.</p>`}
      </div>`);
    if (g.don) {
      const auChoix = g.don === "au-choix";
      blocs.push(`
      <div class="gain"><h3>${auChoix ? "Un nouveau don, ou un don amélioré" : "Un nouveau don"}</h3>
        ${auChoix ? `<div class="segments"><button data-nv-don="nouveau" aria-pressed="${b.choixDon === "nouveau"}">Nouveau don</button><button data-nv-don="ameliore" aria-pressed="${b.choixDon === "ameliore"}">Améliorer un don</button></div>` : ""}
        ${auChoix && b.choixDon === "ameliore" ? `
          <div class="deux"><label class="champ">Le don<select data-nv="ameliore"><option value="">choisir…</option>${(a.dons || []).map((d) => `<option value="${e(d.nom)}" ${b.ameliore === d.nom ? "selected" : ""}>${e(d.nom)}</option>`).join("")}</select></label>
          <label class="champ">L'amélioration<input type="text" list="liste-ameliorations" data-nv="amelioration" value="${e(b.amelioration)}"></label></div>
          <datalist id="liste-ameliorations">${R.AMELIORATIONS.map((x) => `<option value="${e(x)}">`).join("")}</datalist>`
        : `<label class="champ">Le don<select data-nv="don">${optDons}</select></label>
          ${b.don === "*" ? `<div class="deux"><label class="champ">Nom<input type="text" data-nv="donNom" value="${e(b.donNom)}"></label><label class="champ">Coût<select data-nv="donCout">${option(["0", "1", "2", "3", "4", "X"].map((x) => [x, x]), b.donCout)}</select></label></div>
            <label class="champ">Effet<textarea rows="2" data-nv="donEffet">${e(b.donEffet)}</textarea></label>` : b.don ? `<p class="aide">${e(R.donDuKit(b.don)?.effet || "")}</p>` : ""}`}
      </div>`);
    }
    if (g.postureElementaire) blocs.push(`
      <div class="gain"><h3>La posture élémentaire</h3>
        <p class="aide">Une forme spectaculaire liée à l'élément. Elle coûte un dé d'aventure (ou 3 Psy) et dure jusqu'à la fin du combat : +10 % à tous les tests, et un effet décidé avec le MJ.</p>
        <label class="champ">Son effet<textarea rows="2" data-nv="posture" placeholder="voler, +3 d'armure, une attaque de zone…">${e(b.posture)}</textarea></label></div>`);
    return `
      <section class="monter-niveau">
        <h2>Passer au niveau ${g.n}</h2>
        ${blocs.join("")}
        <div class="actions"><button class="principal" data-action="niveau-monter">Passer au niveau ${g.n}</button></div>
      </section>`;
  }

  // ---------------------------------------------------------------- saisie

  saisie(ev, change) {
    const el = ev.target;
    const d = el.dataset;
    const a = this.a;
    if (!a || this.detruit || this.lectureSeule) return;
    if (d.action === "ill-importer") {
      if (change) this.galerie.importer(el.files[0]);
      return;
    }
    if (d.action === "familier-image") {
      if (change && el.files?.[0]) this.televerserFamilier(+d.fam, el.files[0]);
      return;
    }
    if (d.local) return this.galerie.saisie(el);
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    const discret = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio" || el.type === "color";
    // Les nombres se prennent à la frappe : redessiner au moment où ils perdent le focus avalerait le clic suivant.
    if (discret !== change) return;
    if (d.bd) {
      this.brouillonDon[d.bd] = el.value;
      return;
    }
    if (d.nv) {
      const b = this.brouillonNiveau;
      if (!b) return;
      b[d.nv] = el.value;
      // La nouvelle compétence du niveau 7 prend la caractéristique du livret, tant qu'on n'en a pas choisi une autre.
      if (d.nv === "nouvelle" && !b.avecChoisi) {
        const k = R.competenceConnue(el.value);
        b.nouvelleAvec = k ? k.avec : "";
        const avec = this.racine.querySelector('[data-nv="nouvelleAvec"]');
        if (avec) avec.value = k ? k.avec : "Physique";
      }
      if (d.nv === "nouvelleAvec") b.avecChoisi = true;
      if (discret) this.afficherEtape();
      return;
    }
    const tablee = CHAMPS_TABLEE.includes(d.champ);
    if (d.champ) {
      const k = d.champ;
      if (el.type === "checkbox") a[k] = el.checked;
      else if (el.type === "number") a[k] = el.value === "" ? null : Math.max(0, Math.round(+el.value));
      else a[k] = el.value;
      if (k === "nom") {
        for (const x of this.racine.querySelectorAll('[data-champ="nom"]')) if (x !== el) x.value = el.value;
        if (el.value.trim()) this.rejoindreAuNom();
        else this.quitterSansNom();
      }
      if (k === "couleur") this.majPastilles();
      if (k === "tablee") delete a.tablee_au_nom;
      if (k === "peuple" && R.peupleSecret(el.value) && !a.peuple_cache) {
        a.peuple_cache = true;
        const c = this.racine.querySelector('[data-champ="peuple_cache"]');
        if (c) c.checked = true;
      }
      if (k === "element" && discret) this.afficherEtape();
      if (k === "bouclier") this.afficherEtape();
    } else if (d.carac) {
      a[d.carac] = Math.round(+el.value || 0);
    } else if (d.comp !== undefined) {
      const c = a.competences[+d.comp];
      if (d.cc === "nom") {
        c.nom = el.value;
        const k = R.competenceConnue(el.value);
        const ligne = el.closest("tr");
        if (k) {
          c.avec = k.avec;
          poserPsm(ligne, k.avec);
        }
        ligne.querySelector(".aide-comp").textContent = k?.aide || "";
        ligne.querySelector(".choix-psm")?.setAttribute("aria-label", `Caractéristique${el.value.trim() ? ` de ${el.value.trim()}` : ""}`);
      } else {
        c.avec = el.value;
        poserPsm(el.closest("tr"), el.value);
      }
    } else if (d.theme !== undefined) {
      a.themes = [...(a.themes || []), "", "", ""].slice(0, 3);
      a.themes[+d.theme] = el.value;
    } else if (d.arme !== undefined) {
      const w = a.armes[+d.arme];
      if (!w) return;
      const avant = R.armeConnue(w.nom);
      w[d.ac] = el.value;
      if (d.ac === "nom") {
        const k = R.armeConnue(el.value);
        if (k) {
          const ligne = el.closest("tr");
          if (!w.degats || w.degats === avant?.degats) w.degats = k.degats;
          if (!w.notes || w.notes === avant?.notes) w.notes = k.notes;
          // L'arme garde toujours sa compétence (Lames pour une épée), même pas encore apprise : sa valeur retombe sur
          // le Physique tant qu'elle manque, et monte d'elle-même quand elle arrive sur la fiche.
          if (!w.competence || w.competence === "Physique" || R.simple(w.competence) === R.simple(avant?.competence)) {
            w.competence = (a.competences || []).find((c) => R.simple(c.nom) === R.simple(k.competence))?.nom || k.competence;
          }
          ligne.querySelector('[data-ac="degats"]').value = w.degats;
          ligne.querySelector('[data-ac="notes"]').value = w.notes;
          const sel = ligne.querySelector('[data-ac="competence"]');
          if (![...sel.options].some((o) => o.value === w.competence)) sel.add(new Option(this.libelleCompetence(w.competence), w.competence), 0);
          sel.value = w.competence;
        }
      }
    } else if (d.equip !== undefined) {
      a.equipement[+d.equip] = el.value;
      // Le compteur de la ligne suit ce qui s'écrit (« Corde x3 »), sans redessiner la case où l'on tape.
      const compteur = el.closest("li")?.querySelector(".equip-quantite");
      if (compteur) compteur.outerHTML = this.htmlQuantite(el.value, +d.equip);
      else el.insertAdjacentHTML("afterend", this.htmlQuantite(el.value, +d.equip));
    }
    else if (d.objet !== undefined) {
      a.objets = [...(a.objets || []), "", "", ""].slice(0, 3);
      a.objets[+d.objet] = el.value;
    } else if (d.donCree !== undefined) a.dons[+d.donCree][d.dc] = el.value;
    else if (d.donMj !== undefined) {
      const don = a.dons[+d.donMj];
      if (!don) return;
      don.valide_mj = el.checked;
    } else if (d.protection !== undefined) {
      const k = R.armureConnue(el.value);
      a.protection = k ? { nom: k.nom, indice: k.indice } : null;
      this.afficherEtape();
    } else if (d.conseils !== undefined) a.conseils = el.value.split("\n").map((x) => x.trim()).filter(Boolean);
    else if (d.fam !== undefined && d.fc) {
      // Le familier : un champ de l'une de ses fiches (panneau « Familier »), sans redessiner la case où l'on tape.
      const f = (a.familiers || [])[+d.fam];
      if (!f) return;
      f[d.fc] = el.value;
      if (d.fc === "nom") for (const t of this.racine.querySelectorAll(`[data-fam-titre="${+d.fam}"]`)) t.textContent = el.value.trim() || "Sans nom";
    } else return;
    this.marquer(tablee);
    this.rafraichir();
  }

  marquer(tablee) {
    if (this.detruit || this.perdu || this.suppression) return;
    this.modifies = true;
    if (tablee) this.tableeEnAttente = true;
    this.etat("modifie");
    this.sauver();
  }

  // Après la destruction, la page en montre une autre : l'état n'y est plus écrit. Il se lit à droite du nom, avec les
  // mots de toutes les pages (temoin-enregistrement.js), et dans la barre fine du téléphone.
  etat(x) {
    this.etatAffiche = x;
    if (this.detruit) return;
    const texte = x === undefined && !this.a?.id && !this.joueur ? "S'écrit au premier champ"
      : { perdu: "Mis à la corbeille ailleurs", ferme: "Plus rien n'est enregistré ici" }[x] || "";
    // Fermée (lecture seule, lien du joueur fermé) : dit en bronze, sans la pastille rouge d'une coupure.
    const commun = { modifie: "modifie", erreur: "erreur", perdu: "erreur", ferme: "modifie" }[x] || "ok";
    for (const el of this.racine.querySelectorAll(".createur .temoin-enregistrement")) {
      afficherTemoin(el, commun, { reessai: this.reessai, modifie: this.a?.modifie, texte });
    }
  }

  // Les enregistrements partent l'un après l'autre : chacun envoie la version rendue par le précédent.
  enregistrer() {
    this.envois++;
    this.fileEnvois = this.fileEnvois.then(() => this.envoyerFiche()).catch((err) => toast(`Non enregistré : ${err.message}`, "erreur"))
      .finally(() => this.envois--);
    return this.fileEnvois;
  }

  // La fiche part avec la version sur laquelle elle a été modifiée. Refusée (409) parce qu'un autre écran l'a enregistrée
  // entre-temps : on relit la version du serveur, on y reporte ce que cet écran a changé depuis la dernière version
  // connue (fusion à trois), et on renvoie avec la nouvelle version. Ce qui a été saisi pendant l'envoi est gardé.
  async envoyerFiche() {
    const a = this.a;
    if (!a || !this.modifies || this.perdu) return;
    if (!this.joueur && !a.id) return this.creerFiche();
    this.modifies = false;
    const tablee = this.tableeEnAttente;
    this.tableeEnAttente = false;
    const url = this.joueur ? "/api/moi/aventurier" : `/api/aventuriers/${a.id}`;
    const instantane = pourLeServeur(a);
    let envoye = instantane;
    let base = this.base || instantane;
    let version = a.modifie;
    // Rien n'est perdu : la fiche repartira au nouvel essai (serveur injoignable), au prochain enregistrement ou en
    // quittant la page.
    const echec = (err) => {
      this.reessai.echec(err);
      if (err.status === 404) return this.fichePerdue();
      if (this.joueur && [401, 403, 423].includes(err.status)) return this.joueurFerme(err);
      this.modifies = true;
      this.tableeEnAttente ||= tablee;
      this.etat("erreur");
      this.reessai.signaler(err, "Non enregistré");
    };
    for (let essai = 0; essai < 3; essai++) {
      let srv;
      try {
        srv = await api.put(url, { ...envoye, version_base: version });
      } catch (err) {
        if (err.status !== 409 || essai === 2) return echec(err);
        let serveur;
        try {
          serveur = await api.get(url);
        } catch (err2) {
          return echec(err2);
        }
        envoye = fusionner(base, envoye, serveur);
        base = serveur;
        version = serveur.modifie;
        continue;
      }
      this.base = pourLeServeur(srv);
      remplacer(a, fusionner(instantane, pourLeServeur(a), srv));
      this.reessai.reussite();
      if (!this.modifies) this.etat("ok");
      if (essai) {
        toast("Fiche modifiée aussi sur un autre écran : les deux versions sont réunies.");
        this.redessinerApresFusion();
      }
      // La tablée des séances ne suit qu'une fiche bien enregistrée : jamais après un refus ou une corbeille.
      if (tablee && !(await this.synchroniserTablee(srv))) this.tableeEnAttente = true;
      // Sans nom, la TV garde le carton d'avant plutôt qu'un « Sans nom » le temps d'en taper un autre.
      if (!this.joueur && this.table?.aventurier === a.id && (a.nom || "").trim()) this.rafraichirTv();
      return;
    }
  }

  // Le premier champ rempli d'un brouillon : la fiche naît avec tout ce qui a été saisi, l'adresse prend son identifiant.
  async creerFiche() {
    const a = this.a;
    this.modifies = false;
    const tablee = this.tableeEnAttente;
    this.tableeEnAttente = false;
    const instantane = pourLeServeur(a);
    let srv;
    try {
      srv = await api.post("/api/aventuriers", instantane);
    } catch (err) {
      this.reessai.echec(err);
      this.modifies = true;
      this.tableeEnAttente ||= tablee;
      this.etat("erreur");
      this.reessai.signaler(err, "Non enregistré");
      return;
    }
    this.base = pourLeServeur(srv);
    remplacer(a, fusionner(instantane, pourLeServeur(a), srv));
    this.aventuriers.push(a);
    this.reessai.reussite();
    if (!this.modifies) this.etat("ok");
    if (!this.detruit) {
      const etape = this.etape;
      history.replaceState(null, "", `#/aventuriers/${a.id}?etape=${etape}`);
      for (const lien of this.racine.querySelectorAll("[data-fiche-a4]")) {
        lien.href = this.lienFiche();
        lien.target = "_blank";
        lien.rel = "noopener";
        lien.removeAttribute("aria-disabled");
        lien.removeAttribute("title");
      }
      if (etape === "portrait") this.afficherEtape();
      this.rafraichir();
      this.galerie.suivre();
    }
    if (tablee && !(await this.synchroniserTablee(srv))) this.tableeEnAttente = true;
  }

  // La fiche a été mise à la corbeille depuis un autre écran : plus rien ne part, ni pour elle, ni pour la tablée.
  fichePerdue() {
    this.perdu = true;
    this.modifies = false;
    this.tableeEnAttente = false;
    this.sauver.annuler();
    this.etat("perdu");
    toast(R.accord("{Cet aventurier a été mis|Cette aventurière a été mise} à la corbeille depuis un autre écran : plus rien n'est enregistré.", this.a || {}), "erreur");
  }

  // La tablée des séances suit l'aventurier : joueur, couleur des dés, nom, peuple, vocation. Rend vrai si la tablée
  // est à jour (rien n'est écrit quand sa ligne n'a pas changé).
  async synchroniserTablee(a, retirer = false) {
    if (this.joueur) return true;
    if (!a) return false;
    for (let essai = 0; essai < 3; essai++) {
      try {
        const c = await api.get("/api/campagne");
        const t = [...(c.tablee || [])];
        const i = t.findIndex((j) => j.aventurier === a.id);
        if (retirer || a.tablee === false) {
          if (i < 0) return true;
          // Sa ligne et son rang, gardés pour « Annuler » : la séance du soir le compte parmi ses présents par cette ligne.
          this.ligneRetiree = { ligne: t[i], rang: i };
          t.splice(i, 1);
        } else {
          // De retour à la tablée après un nom effacé (quitterSansNom) : sa ligne d'avant, à son rang si cette page l'a vue partir.
          const garde = typeof a.ligne_tablee === "string" && !t.some((j) => j.id === a.ligne_tablee) ? a.ligne_tablee : null;
          const retiree = garde && this.ligneRetiree?.ligne?.id === garde ? this.ligneRetiree : null;
          const ancien = i >= 0 ? t[i] : retiree ? retiree.ligne : { id: garde || Math.random().toString(36).slice(2, 8), actif: true };
          const ligne = { ...ancien, aventurier: a.id, joueur: a.joueur || "", couleur: a.couleur || COULEURS[0], ...R.identiteTablee(a) };
          if (i >= 0 && Object.keys(ligne).every((k) => pareil(ligne[k], t[i][k]))) {
            this.campagne = c;
            return true;
          }
          if (i >= 0) t[i] = ligne;
          else if (retiree) t.splice(Math.min(Math.max(0, +retiree.rang || 0), t.length), 0, ligne);
          else if (garde && Number.isInteger(a.rang_tablee)) t.splice(rangNote(t, a), 0, ligne);
          else t.push(ligne);
        }
        this.campagne = await api.put("/api/campagne", { ...c, tablee: t, version_base: c.modifie });
        return true;
      } catch (err) {
        if (err.status !== 409 || essai === 2) {
          toast(`Tablée des séances non mise à jour : ${err.message}`, "erreur");
          return false;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- clics

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || !this.a || this.detruit) return;
    const a = this.a;
    const d = b.dataset;
    const redessiner = (tablee = false) => {
      this.marquer(tablee);
      this.afficherEtape();
      this.rafraichir();
    };
    if (d.etape) return this.aller(PANNEAUX[d.etape] ? d.etape : +d.etape);
    if (this.lectureSeule) return;
    if (d.action?.startsWith("ill-")) return this.galerie.action(d.action, d.valeur, b);
    if (d.genre) {
      a.genre = a.genre === d.genre ? "" : d.genre;
      return redessiner(true);
    }
    if (d.action === "familier-tv" || d.action === "familier-tv-retirer") {
      const f = (a.familiers || [])[+d.fam];
      if (!f || !/^\/media\/[A-Za-z0-9._-]+$/.test(f.image || "")) return;
      try {
        await (d.action === "familier-tv" ? montrerImageTv(f.image, (f.nom || "").trim()) : retirerImageTv(f.image));
      } catch (err) {
        toast(err.message, "erreur");
      }
      return;
    }
    if (d.action === "familier-image-retirer") {
      const f = (a.familiers || [])[+d.fam];
      if (!f) return;
      f.image = "";
      return redessiner();
    }
    if (d.action === "familier-ajouter" || d.action === "familier-retirer") {
      a.familiers = Array.isArray(a.familiers) ? a.familiers : [];
      if (d.action === "familier-ajouter") {
        if (a.familiers.length >= FAMILIERS_MAX) return;
        a.familiers.push(familierVide());
      } else {
        const f = a.familiers[+d.fam];
        if (!f) return;
        if (f.nom?.trim() || f.espece?.trim() || f.aspect?.trim() || f.caractere?.trim()) {
          if (!(await demander({ titre: `Retirer ${f.nom?.trim() || "ce familier"} ?`, texte: "Sa fiche disparaît de l'aventurier.", oui: "Retirer", non: "Garder" }))) return;
        }
        a.familiers.splice(+d.fam, 1);
      }
      return redessiner();
    }
    if (d.tirer) {
      if (d.tirer === "nom") {
        a.nom = T.tirerNomAventurier(a);
        for (const x of this.racine.querySelectorAll('[data-champ="nom"]')) x.value = a.nom;
        this.rejoindreAuNom();
        this.marquer(true);
        return this.rafraichir();
      }
      if (d.tirer === "lien") {
        const autre = this.joueur ? { nom: a.lien_avec_nom } : this.aventuriers.find((x) => x.id === a.lien_avec);
        a.lien = T.tirerLien(a.genre, autre?.nom?.split(/[\s,]+/)[0], autre?.genre);
      } else a[d.tirer] = TIRAGES[d.tirer](a.genre);
      return redessiner();
    }
    if (d.peuple) {
      a.peuple = R.peupleConnu(a.peuple)?.nom === d.peuple ? "" : d.peuple;
      // Un peuple secret de la campagne (TRAITS_PEUPLES) : caché d'office, dans le même enregistrement que le peuple.
      if (R.peupleSecret(a.peuple)) a.peuple_cache = true;
      return redessiner(true);
    }
    if (d.vocation) {
      const v = a.vocations || [];
      if (v.includes(d.vocation)) a.vocations = v.filter((x) => x !== d.vocation);
      else if (v.length >= 2) return toast("Deux vocations au plus : retirez-en une d'abord.");
      else a.vocations = [...v, d.vocation];
      return redessiner(true);
    }
    if (d.caracPas) {
      const [cle, pas] = d.caracPas.split(":");
      const max = R.attendus(a.niveau || 1).caracMax;
      a[cle] = Math.min(max, Math.max(25, (+a[cle] || 0) + +pas));
      return redessiner();
    }
    if (d.profil !== undefined) {
      const bonus = R.PROFILS_COMP[+d.profil][1];
      a.competences.slice(0, 4).forEach((c, i) => { c.bonus = bonus[i]; });
      return redessiner();
    }
    if (d.compPas) {
      const [i, pas] = d.compPas.split(":").map(Number);
      const c = a.competences[i];
      const creation = (a.niveau || 1) === 1;
      c.bonus = Math.min(creation ? 25 : 60, Math.max(creation ? 5 : 0, (+c.bonus || 0) + pas));
      return redessiner();
    }
    if (d.compRapide) {
      const deja = a.competences.findIndex((c) => R.simple(c.nom) === R.simple(d.compRapide));
      const k = R.competenceConnue(d.compRapide);
      if (deja >= 0) a.competences[deja].nom = "";
      else {
        const libre = a.competences.find((c) => !(c.nom || "").trim());
        if (!libre) return toast("Les quatre compétences sont choisies : videz-en une pour la remplacer.");
        libre.nom = k?.nom || d.compRapide;
        libre.avec = k?.avec || "Physique";
      }
      return redessiner();
    }
    if (d.sante || d.santePas) {
      const total = R.attendus(a.niveau || 1).santePsy;
      a.sante = Math.min(total - 1, Math.max(5, d.sante ? +d.sante : (+a.sante || 0) + +d.santePas));
      a.psy = total - a.sante;
      return redessiner();
    }
    if (d.couleur) {
      a.couleur = d.couleur;
      const champ = this.racine.querySelector('.createur-tete [data-champ="couleur"]');
      if (champ) champ.value = d.couleur;
      this.majPastilles();
      this.marquer(true);
      return this.rafraichir();
    }
    if (d.don) {
      const dons = a.dons || [];
      const i = dons.findIndex((x) => R.simple(x.nom) === R.simple(d.don));
      if (i >= 0) dons.splice(i, 1);
      else {
        const voulu = R.nbDonsCreation(+a.psy || 0);
        if ((a.niveau || 1) === 1 && dons.length >= voulu) return toast(`Déjà ${voulu} dons avec ${a.psy} en Psy : retirez-en un d'abord.`);
        dons.push({ nom: R.donDuKit(d.don)?.nom || d.don });
      }
      a.dons = dons;
      return redessiner();
    }
    if (d.element) {
      a.element = R.elementConnu(a.element)?.nom === d.element ? "" : d.element;
      return redessiner(true);
    }
    if (d.posture) {
      a.posture = a.posture === d.posture ? "" : d.posture;
      return redessiner();
    }
    if (d.themeRapide) {
      const t = [...(a.themes || []), "", "", ""].slice(0, 3);
      const i = t.findIndex((x) => R.simple(x) === R.simple(d.themeRapide));
      if (i >= 0) t[i] = "";
      else {
        const libre = t.findIndex((x) => !(x || "").trim());
        if (libre < 0) return toast("Trois thèmes déjà : videz-en un pour le remplacer.");
        t[libre] = d.themeRapide;
      }
      a.themes = t;
      return redessiner();
    }
    if (d.kit) return this.prendreKit(R.vocationConnue(d.kit), redessiner);
    if (d.langue) {
      const l = (a.langues || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!l.some((x) => R.simple(x) === R.simple(d.langue))) l.push(d.langue);
      a.langues = l.join(", ");
      return redessiner();
    }
    if (d.nvSante !== undefined) {
      this.brouillonNiveau.sante = +d.nvSante;
      return this.afficherEtape();
    }
    if (d.nvMode) {
      this.brouillonNiveau.modeComp = d.nvMode;
      return this.afficherEtape();
    }
    if (d.nvDon) {
      this.brouillonNiveau.choixDon = d.nvDon;
      return this.afficherEtape();
    }
    const act = d.action;
    if (act === "comp-ajouter") {
      a.competences.push({ nom: "", bonus: 10, avec: "Physique" });
      return redessiner();
    }
    if (act === "comp-retirer") {
      a.competences.splice(+d.i, 1);
      return redessiner();
    }
    if (act === "don-retirer") {
      a.dons.splice(+d.i, 1);
      return redessiner();
    }
    if (act === "don-creer") {
      const bd = this.brouillonDon;
      if (!bd.nom.trim() || !bd.effet.trim()) return toast("Donnez un nom et un effet au don.");
      a.dons = [...(a.dons || []), { nom: bd.nom.trim(), cout: bd.cout, effet: bd.effet.trim(), cree: true }];
      this.brouillonDon = { nom: "", cout: "1", effet: "" };
      return redessiner();
    }
    if (act === "arme-ajouter") {
      // La compétence se pose avec le nom de l'arme ; en attendant, le calcul prend le Physique.
      a.armes = [...(a.armes || []), { nom: "", competence: "", degats: "", notes: "" }];
      redessiner();
      return this.racine.querySelector(`.table-armes tr:last-child [data-ac="nom"]`)?.focus();
    }
    if (act === "arme-retirer") {
      a.armes.splice(+d.i, 1);
      return redessiner();
    }
    if (act === "arme-principale") {
      const [w] = a.armes.splice(+d.i, 1);
      a.armes.unshift(w);
      return redessiner();
    }
    if (act === "equip-ajouter") {
      this.reunirEquipement();
      a.equipement = [...(a.equipement || []), ""];
      redessiner();
      return this.racine.querySelector(".liste-equipement li:last-child input")?.focus();
    }
    if (act === "equip-retirer") {
      a.equipement.splice(+d.i, 1);
      return redessiner();
    }
    if (act === "equip-quantite") {
      // Un de plus, un de moins (au dernier, la ligne s'en va) : le geste du sac de « La compagnie », sur la fiche en cours.
      const liste = (a.equipement || []).map((x) => String(x ?? ""));
      const r = corpsDuSac({ equipement: liste }, { genre: "quantite", liste: "equipement", rang: +d.i, avant: liste[+d.i], de: +d.de });
      if (r.erreur) return toast(r.erreur);
      if (r.equipement) a.equipement = r.equipement.apres;
      return redessiner();
    }
    if (act === "or-lancer") {
      const des = [0, 1, 2].map(() => 1 + Math.floor(Math.random() * 6));
      const somme = des.reduce((s, x) => s + x, 0);
      this.dernierTirage = { des, somme };
      a.or = somme * 10 * (R.bourseDeDepart(a).double ? 2 : 1);
      return redessiner();
    }
    if (act === "histoire-composer") {
      // « Ce qu'il ne fera jamais » a sa ligne sur la fiche : l'histoire reprend seulement qui il était et pourquoi il part.
      const morceaux = [a.avant, a.pourquoi].map((x) => (x || "").trim()).filter(Boolean).map((x) => (/[.!?…»]$/.test(x) ? x : `${x}.`));
      if (!morceaux.length) return toast("Répondez d'abord aux questions de l'étape 1.");
      if ((a.histoire || "").trim() && !(await demander({ titre: "Remplacer l'histoire déjà écrite ?", texte: "Les réponses de l'étape 1 prennent sa place.", oui: "Remplacer", non: "Garder l'histoire" }))) return;
      if (this.detruit || this.a !== a) return;
      a.histoire = morceaux.join(" ");
      return redessiner();
    }
    if (act === "histoire-ia") return this.histoireIa(b);
    if (act === "conseils-auto") {
      a.conseils = R.conseilsAuto(a);
      return redessiner();
    }
    if (act === "envoyer-mj") return this.envoyerAuMj();
    if (act === "tv" || act === "tv-retirer") return this.montrerTv(act === "tv");
    if (act === "niveau-monter") return this.monterNiveau();
    if (act === "niveau-annuler") return this.annulerNiveau();
    if (act === "supprimer" && !a.id && !this.envois) {
      this.sauver.annuler();
      this.modifies = false;
      this.perdu = true;
      toast("Rien n'avait été écrit : aucun aventurier ne reste.");
      if (!this.detruit) location.hash = "#/aventuriers";
      return;
    }
    if (act === "supprimer") {
      // Sans confirmation : « Annuler », dix secondes, remet la fiche et sa place à la tablée des séances.
      // Les dernières saisies partent d'abord (elles suivent la fiche dans la corbeille) ; ensuite plus rien ne part pour
      // elle : elle quitte la tablée, puis va à la corbeille.
      this.suppression = true;
      this.vider();
      await this.fileEnvois;
      this.perdu = true;
      this.tableeEnAttente = false;
      this.ligneRetiree = null;
      try {
        if (!(await this.synchroniserTablee(a, true))) throw new Error("la tablée des séances n'a pas pu être mise à jour");
        await api.del(`/api/aventuriers/${a.id}`);
      } catch (err) {
        this.perdu = false;
        this.suppression = false;
        return toast(`Corbeille impossible : ${err.message}`, "erreur");
      }
      this.a = null;
      const place = this.ligneRetiree;
      // Le module de la corbeille ne sert qu'à l'atelier : le coin des joueurs ne le charge pas.
      const { annoncerCorbeille, remettreALaTablee } = await import("../corbeille/corbeille.js");
      annoncerCorbeille(`« ${a.nom || R.accord("{Aventurier sans nom|Aventurière sans nom}", a)} » ${R.accord("{mis|mise}", a)} à la corbeille, et hors de la tablée.`,
        "aventuriers", a.id, { retour: `#/aventuriers/${a.id}`, apres: (r) => remettreALaTablee(r.id, place) });
      if (!this.detruit) location.hash = "#/aventuriers";
    }
  }

  prendreKit(v, redessiner) {
    const a = this.a;
    if (!v) return;
    const k = v.kit;
    const noms = new Set((a.armes || []).map((w) => R.simple(w.nom)));
    for (const nom of k.armes) {
      if (noms.has(R.simple(nom))) continue;
      const w = R.armeConnue(nom);
      // La compétence de l'arme, même si elle n'est pas encore sur la fiche (voir la saisie d'une arme).
      const comp = (a.competences || []).find((c) => R.simple(c.nom) === R.simple(w.competence));
      a.armes = [...(a.armes || []), { nom: w.nom, competence: comp ? comp.nom : w.competence, degats: w.degats, notes: w.notes }];
    }
    const armure = R.armureConnue(k.protection);
    if (armure && (+a.protection?.indice || 0) <= armure.indice) a.protection = { nom: armure.nom, indice: armure.indice };
    if (k.bouclier) a.bouclier = true;
    const eq = new Set((a.equipement || []).map(R.simple));
    a.equipement = [...(a.equipement || []), ...k.objets.filter((x) => !eq.has(R.simple(x)))];
    toast(`Kit ${R.vocationAccordee(v.nom, a.genre).toLowerCase()} ajouté : retouchez-le à votre guise.`, "info", { duree: 3500 });
    redessiner();
  }

  async histoireIa(bouton) {
    const a = this.a;
    if (![a.avant, a.pourquoi, a.jamais].some((x) => (x || "").trim())) return toast("Répondez d'abord aux questions de l'étape 1.");
    if ((a.histoire || "").trim() && !(await demander({ titre: "Remplacer l'histoire déjà écrite ?", texte: "La nouvelle version prend sa place.", oui: "Remplacer", non: "Garder l'histoire" }))) return;
    if (this.detruit || this.a !== a) return;
    bouton.disabled = true;
    bouton.textContent = "Rédaction en cours…";
    try {
      const r = await api.post("/api/aventurier/histoire", {
        nom: a.nom, genre: a.genre, peuple: R.peupleAccorde(a), vocations: (a.vocations || []).join(" et "), specialite: a.specialite,
        element: a.element, avant: a.avant, pourquoi: a.pourquoi, jamais: a.jamais,
      });
      if (this.detruit || this.a !== a) return;
      a.histoire = r.texte;
      this.marquer(false);
      toast("Histoire proposée : relisez-la avec le joueur.");
    } catch (err) {
      if (this.detruit) return;
      toast(`Rédaction impossible : ${erreurIA(err, "écrivez l'histoire avec le joueur, à partir de ses réponses, elle servira telle quelle")}.`, "erreur");
    }
    this.afficherEtape();
    this.rafraichir();
  }

  // Ce que le niveau suivant va changer, vérifié en entier avant de toucher à la fiche : un niveau ne s'applique jamais
  // à moitié (un don renommé entre-temps, une compétence retirée…). Les changements sont gardés dans le journal, pour
  // pouvoir annuler ce niveau-là seulement.
  planNiveau(g, b) {
    const a = this.a;
    const comps = a.competences || [];
    const dons = a.dons || [];
    const ch = {};
    const texte = [];
    if (g.points) {
      const s = Math.min(3, Math.max(0, +b.sante || 0));
      Object.assign(ch, { sante: s, psy: 3 - s });
      texte.push(`Santé +${s}, Psy +${3 - s}`);
    }
    if (g.toutes) {
      ch.caracs = Object.fromEntries(R.CARACS.map((c) => [c.cle, g.toutes]));
      texte.push(`+${g.toutes} % à toutes les caractéristiques`);
    }
    if (g.une) {
      const c = R.CARACS.find((x) => x.cle === b.une);
      if (!c) return { erreur: "Choisissez la caractéristique qui gagne +5 %." };
      ch.caracs = { ...(ch.caracs || {}), [c.cle]: ((ch.caracs || {})[c.cle] || 0) + g.une };
      texte.push(`${c.nom} +${g.une}`);
    }
    if (g.competences) {
      if (b.modeComp === "nouvelle" && g.n === 7) {
        const k = R.competenceConnue(b.nouvelle);
        const nom = k?.nom || (b.nouvelle || "").trim();
        if (!nom) return { erreur: "Nommez la nouvelle compétence." };
        if (comps.some((c) => R.simple(c.nom) === R.simple(nom))) return { erreur: `${nom} est déjà sur la fiche : choisissez « Deux fois +5 » pour l'augmenter.` };
        ch.nouvelle = { nom, bonus: 10, avec: b.nouvelleAvec || k?.avec || "Physique" };
        texte.push(`nouvelle compétence : ${nom} +10`);
      } else {
        if (!b.compA || !b.compB) return { erreur: "Choisissez les compétences qui gagnent +5." };
        const perdue = [b.compA, b.compB].find((nom) => !comps.some((c) => c.nom === nom));
        if (perdue) return { erreur: `${perdue} n'est plus sur la fiche : choisissez à nouveau.` };
        ch.plus = [b.compA, b.compB];
        texte.push(b.compA === b.compB ? `${b.compA} +10` : `${b.compA} +5, ${b.compB} +5`);
      }
    }
    if (g.don && (g.don === "nouveau" || b.choixDon === "nouveau")) {
      if (!b.don) return { erreur: "Choisissez le nouveau don." };
      let don;
      if (b.don === "*") {
        if (!(b.donNom || "").trim() || !(b.donEffet || "").trim()) return { erreur: "Donnez un nom et un effet au don créé." };
        don = { nom: b.donNom.trim(), cout: b.donCout, effet: b.donEffet.trim(), cree: true };
      } else {
        const kit = R.donDuKit(b.don);
        if (!kit) return { erreur: `${b.don} n'est pas dans la liste du livret.` };
        don = { nom: kit.nom };
      }
      if (dons.some((d) => R.simple(d.nom) === R.simple(don.nom))) return { erreur: `${don.nom} est déjà sur la fiche.` };
      ch.don = { ajoute: don };
      texte.push(`nouveau don : ${don.nom}`);
    } else if (g.don) {
      const don = dons.find((d) => d.nom === b.ameliore);
      if (!don) return { erreur: b.ameliore ? `${b.ameliore} n'est plus sur la fiche : choisissez à nouveau.` : "Choisissez le don à améliorer." };
      const amelioration = (b.amelioration || "").trim();
      if (!amelioration) return { erreur: "Dites comment le don s'améliore." };
      const avant = { cout: don.cout, ameliore: don.ameliore };
      const apres = { cout: don.cout, ameliore: [don.ameliore, amelioration].filter(Boolean).join(" ") };
      if (amelioration === R.AMELIORATIONS[0]) {
        // « Le coût baisse de 1 » : c'est le coût imprimé qui baisse.
        const cout = R.lireDon(don).cout;
        const moins = R.coutBaisse(cout);
        if (!moins) return { erreur: `Le coût de ${don.nom} (${cout}) ne peut pas baisser : choisissez une autre amélioration.` };
        Object.assign(apres, { cout: moins, ameliore: [don.ameliore, `coût ${moins} au lieu de ${cout}.`].filter(Boolean).join(" ") });
      }
      ch.don = { nom: don.nom, avant, apres };
      texte.push(`${don.nom} amélioré`);
    }
    if (g.postureElementaire) {
      ch.posture = { avant: a.posture_elementaire || "", apres: (b.posture || "").trim() };
      texte.push("posture élémentaire");
    }
    return { changements: ch, texte: texte.join(" ; ") };
  }

  monterNiveau() {
    const a = this.a;
    const g = R.NIVEAUX.find((x) => x.n === (a.niveau || 1) + 1);
    const b = this.brouillonNiveau;
    if (!g || !b) return;
    const plan = this.planNiveau(g, b);
    if (plan.erreur) return toast(plan.erreur);
    const ch = plan.changements;
    if (ch.sante !== undefined) {
      a.sante = (+a.sante || 0) + ch.sante;
      a.psy = (+a.psy || 0) + ch.psy;
    }
    for (const [cle, v] of Object.entries(ch.caracs || {})) a[cle] = (+a[cle] || 0) + v;
    if (ch.nouvelle) a.competences = [...(a.competences || []), { ...ch.nouvelle }];
    for (const nom of ch.plus || []) {
      const c = a.competences.find((x) => x.nom === nom);
      c.bonus = (+c.bonus || 0) + 5;
    }
    if (ch.don?.ajoute) a.dons = [...(a.dons || []), { ...ch.don.ajoute }];
    if (ch.don?.apres) this.poserDon(a.dons.find((d) => d.nom === ch.don.nom), ch.don.apres);
    if (ch.posture) a.posture_elementaire = ch.posture.apres;
    a.niveau = g.n;
    a.progression = [...(a.progression || []), { niveau: g.n, date: new Date().toISOString(), texte: plan.texte, changements: ch }];
    this.brouillonNiveau = null;
    this.marquer(false);
    this.afficherEtape();
    this.rafraichir();
    toast(`${prenom(a)} passe au niveau ${g.n}.`);
  }

  // Le coût et l'amélioration d'un don ; un coût absent redevient celui du livret.
  poserDon(don, valeurs) {
    if (!don) return;
    for (const k of ["cout", "ameliore"]) {
      if (valeurs[k] === undefined || valeurs[k] === "") delete don[k];
      else don[k] = valeurs[k];
    }
  }

  // Annuler un niveau retire ce qu'il a apporté, et rien d'autre : ce qui a été modifié depuis sur la fiche reste.
  async annulerNiveau() {
    const a = this.a;
    const journal = a.progression || [];
    const dernier = journal[journal.length - 1];
    if (!dernier) return;
    const ch = dernier.changements;
    if (!ch) {
      // Niveau monté avant le suivi détaillé : seul l'instantané pris juste avant existe.
      if (!dernier.avant || !(await demander({
        titre: `Annuler le niveau ${dernier.niveau} ?`,
        texte: [dernier.texte && `${phrase(dernier.texte)}.`, "Ce niveau date d'avant le suivi détaillé : caractéristiques, compétences, dons, Santé et Psy reviennent à ce qu'ils étaient juste avant, modifications faites depuis comprises."],
        oui: "Annuler le niveau", non: "Garder le niveau", danger: true,
      }))) return;
      if (this.detruit || this.a !== a || (a.progression || [])[(a.progression || []).length - 1]?.niveau !== dernier.niveau) return;
      Object.assign(a, dernier.avant);
    } else {
      const comps = a.competences || [];
      const dons = a.dons || [];
      const introuvables = [];
      if (ch.nouvelle && !comps.some((c) => R.simple(c.nom) === R.simple(ch.nouvelle.nom))) introuvables.push(`la compétence ${ch.nouvelle.nom}`);
      for (const nom of new Set(ch.plus || [])) if (!comps.some((c) => c.nom === nom)) introuvables.push(`la compétence ${nom}`);
      if (ch.don?.ajoute && !dons.some((d) => R.simple(d.nom) === R.simple(ch.don.ajoute.nom))) introuvables.push(`le don ${ch.don.ajoute.nom}`);
      if (ch.don?.apres && !dons.some((d) => d.nom === ch.don.nom)) introuvables.push(`le don ${ch.don.nom}`);
      if (!(await demander({
        titre: `Annuler le niveau ${dernier.niveau} ?`,
        texte: [`${dernier.texte ? `${phrase(dernier.texte)}. ` : ""}Seul ce que ce niveau a apporté est retiré.`,
          ...(introuvables.length ? [`Introuvable sur la fiche, donc laissé tel quel : ${introuvables.join(", ")}.`] : [])],
        oui: "Annuler le niveau", non: "Garder le niveau",
      }))) return;
      if (this.detruit || this.a !== a || (a.progression || [])[(a.progression || []).length - 1]?.niveau !== dernier.niveau) return;
      if (ch.sante !== undefined) {
        a.sante = (+a.sante || 0) - ch.sante;
        a.psy = (+a.psy || 0) - ch.psy;
      }
      for (const [cle, v] of Object.entries(ch.caracs || {})) a[cle] = (+a[cle] || 0) - v;
      const dernierIndex = (liste, test) => liste.map(test).lastIndexOf(true);
      if (ch.nouvelle) {
        const i = dernierIndex(comps, (c) => R.simple(c.nom) === R.simple(ch.nouvelle.nom));
        if (i >= 0) a.competences = comps.filter((_, k) => k !== i);
      }
      for (const nom of ch.plus || []) {
        const c = (a.competences || []).find((x) => x.nom === nom);
        if (c) c.bonus = Math.max(0, (+c.bonus || 0) - 5);
      }
      if (ch.don?.ajoute) {
        const i = dernierIndex(dons, (d) => R.simple(d.nom) === R.simple(ch.don.ajoute.nom));
        if (i >= 0) a.dons = dons.filter((_, k) => k !== i);
      }
      if (ch.don?.apres) this.poserDon((a.dons || []).find((d) => d.nom === ch.don.nom), ch.don.avant);
      if (ch.posture) a.posture_elementaire = ch.posture.avant;
      a.niveau = dernier.niveau - 1;
    }
    a.progression = journal.slice(0, -1);
    this.brouillonNiveau = null;
    this.marquer(false);
    this.afficherEtape();
    this.rafraichir();
  }

  // ---------------------------------------------------------------- le coin des joueurs

  lienFiche() {
    return this.joueur ? "/fiche" : `/fiche-aventurier?id=${encodeURIComponent(this.a.id)}`;
  }

  // Un brouillon pas encore écrit n'a pas de fiche à imprimer : le lien attend le premier champ rempli.
  attributsFiche() {
    return this.joueur || this.a.id ? `href="${e(this.lienFiche())}" target="_blank" rel="noopener" data-fiche-a4`
      : 'aria-disabled="true" title="La fiche s\'écrit au premier champ rempli." data-fiche-a4';
  }

  // Le joueur ne voit que son aventurier : celui de son dossier de propositions, créé ici s'il n'existe pas encore.
  async demarrerJoueur() {
    const moi = await api.get("/api/moi");
    if (this.detruit) return;
    this.moi = moi;
    this.campagne = { niveau: 1 };
    this.table = {};
    if (moi.accueilli && !moi.aventurier) return this.afficherHerosAilleurs();
    if (!moi.aventurier) {
      await chargerPretires();
      return this.detruit ? undefined : this.afficherAccueilJoueur();
    }
    this.a = moi.aventurier;
    this.aventuriers = [this.a];
    this.base = pourLeServeur(this.a);
    const demandee = +this.parametres.get("etape");
    const v = R.verifier(this.a);
    this.etape = demandee >= 1 && demandee <= 10 ? demandee : R.ETAPES.find((x) => v.etapes[x.n].etat !== "ok")?.n || 10;
    // Accueilli par le MJ : la fiche se relit ici, elle ne s'écrit plus (rien de ce qu'on tape ne se perdrait sans le dire).
    this.lectureSeule = Boolean(moi.accueilli);
    if (this.lectureSeule) {
      this.perdu = true;
      this.modifies = false;
    }
    this.afficherEditeur();
    if (this.lectureSeule) this.etat("ferme");
  }

  // « Gerd a rejoint la tablée le 4 novembre : sa fiche vit maintenant chez votre MJ. »
  // Confié par le MJ (un héros créé dans l'atelier), la phrase le dit ; plus à la tablée (mis de côté, ou à la corbeille),
  // elle ne promet pas une fiche que le carnet ne montre plus.
  htmlBandeauAccueilli() {
    const m = this.moi || {};
    const h = m.heros || {};
    const genre = { genre: h.genre || this.a?.genre };
    const qui = (h.nom || "").split(/[\s,]+/)[0] || R.accord("{Votre aventurier|Votre aventurière}", genre);
    const d = new Date(m.accueilli_le || "");
    const quand = Number.isNaN(d.getTime()) ? "" : ` le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
    const relue = this.a ? '<p class="aide">Ci-dessous, la fiche telle que vous l\'aviez envoyée : elle se relit, elle ne se modifie plus.</p>' : "";
    if (m.present === false) return `
      <div class="bandeau-accueilli absent" role="status">
        <p><b>${e(qui)} n'est plus à la tablée pour l'instant</b> : votre MJ ${R.accord("{l'a mis|l'a mise}", genre)} de côté. Une question ? Posez-la-lui.</p>
        ${m.carnet ? '<a class="bouton" href="/carnet">Ouvrir le carnet de la compagnie</a>' : ""}
        ${relue}
      </div>`;
    const tete = m.relie ? `Votre MJ vous a confié ${e(qui)}${e(quand)}` : `${e(qui)} a rejoint la tablée${e(quand)}`;
    return `
      <div class="bandeau-accueilli" role="status">
        <p><b>${tete}</b> : sa fiche vit maintenant chez votre MJ. Une retouche ? Demandez-la-lui.</p>
        ${m.carnet ? `<a class="bouton principal" href="/carnet#heros">Voir ${e(qui)} dans le carnet</a>`
          : '<p class="aide">Le carnet de la compagnie, avec sa fiche telle que le MJ la tient, s\'ouvre entre les séances.</p>'}
        ${relue}
      </div>`;
  }

  // Relié par le MJ à un héros de la tablée, sans avoir rien créé ici : pas de créateur, seulement où le retrouver.
  afficherHerosAilleurs() {
    this.racine.innerHTML = `
      <section class="page-liste accueil-aventuriers accueil-joueur">
        <header class="titre-page">
          <p class="kicker">Le coin des joueurs</p>
          <h1>Bienvenue, ${e(this.moi.joueur)}</h1>
        </header>
        ${this.htmlBandeauAccueilli()}
      </section>`;
  }

  afficherAccueilJoueur() {
    this.racine.innerHTML = `
      <section class="page-liste accueil-aventuriers accueil-joueur">
        <header class="titre-page">
          <p class="kicker">Le coin des joueurs</p>
          <h1>Bienvenue, ${e(this.moi.joueur)}</h1>
          <p class="chapo">Les dix étapes du guide du kit, une demi-heure environ. Tout s'enregistre à mesure : vous pouvez vous arrêter et reprendre plus tard, depuis n'importe quel appareil, avec votre identifiant et votre mot de passe. À la fin, vous envoyez votre aventurier au MJ, qui le valide avec vous.</p>
        </header>
        <div class="heros-grille"><button class="carte-heros nouvelle" data-action="nouveau"><span>Créer mon aventurier</span></button></div>
        <section class="bloc">
          <h2>Ou partir d'un prétiré</h2>
          <p>${e(R.GUIDE.pretires)} : prenez-en un tel quel, ou retouchez-le étape par étape.</p>
          <ul class="liste-pretires">${PRETIRES.map((p) => `
            <li>${htmlMedaillon(p, { classe: "mini" })}
              <span class="texte"><b>${e(p.nom)}</b><i>${e(R.titre(p))}</i></span>
              <button data-pretire="${e(p.cle)}" title="Ajouter ce héros à l'atelier et à la tablée">Ajouter à l'atelier</button></li>`).join("")}
          </ul>
        </section>
      </section>`;
    this.racine.querySelector(".accueil-joueur").addEventListener("click", async (ev) => {
      const b = ev.target.closest("button");
      if (!b || this.detruit) return;
      const p = b.dataset.pretire ? PRETIRES.find((x) => x.cle === b.dataset.pretire) : null;
      if (!p && b.dataset.action !== "nouveau") return;
      b.disabled = true;
      // Les couleurs de la tablée sont prises : la sienne part sur une teinte libre.
      const tablee = (this.moi.couleurs_prises || []).map((couleur) => ({ couleur }));
      try {
        await api.post("/api/moi/aventurier", { ...(p ? depuisPretire(p, tablee) : nouvelAventurier(tablee)), joueur: this.moi.joueur });
        if (!this.detruit) await this.demarrerJoueur();
      } catch (err) {
        b.disabled = false;
        toast(err.message, "erreur");
      }
    }, { signal: this.ecoute.signal });
  }

  // L'envoi au MJ part avec la dernière version enregistrée ; le joueur peut encore retoucher et renvoyer.
  async envoyerAuMj() {
    try {
      if (this.modifies) await this.sauver.maintenant();
      await this.fileEnvois;
      if (this.modifies || this.perdu) return toast("La fiche n'est pas encore enregistrée : réessayez dans un instant.", "erreur");
      const v = R.verifier(this.a);
      if (!v.pret && !(await this.confirmerEnvoi(v))) return;
      this.moi = await api.post("/api/moi/envoyer", {});
      toast("Envoyé : votre MJ le trouvera dans son atelier. Vous pouvez encore le retoucher et le renvoyer.");
      this.rafraichir();
    } catch (err) {
      if ([401, 403, 423].includes(err.status)) return this.joueurFerme(err);
      toast(`Envoi impossible : ${err.message}`, "erreur");
    }
  }

  // Une fiche pas finie : ce qui manque, étape par étape, chacune d'un toucher (E16). Le panneau « À régler » du bureau
  // n'existe pas sur téléphone : c'est ici que le joueur l'apprend. Rend vrai pour envoyer quand même.
  confirmerEnvoi(v) {
    const restes = Object.entries(v.etapes).filter(([, x]) => x.etat !== "ok");
    const d = document.createElement("dialog");
    d.className = "dialogue dialogue-envoi";
    d.innerHTML = `
      <form method="dialog">
        <p class="kicker">Envoyer au MJ</p>
        <h2>${restes.length > 1 ? `Il reste ${restes.length} étapes à finir` : "Il reste une étape à finir"}</h2>
        <ul>${restes.map(([n, x]) => `
          <li><button value="${n}" aria-label="Revoir l'étape ${n} : ${e(R.ETAPES[n - 1].titre)}">Étape ${n}</button>
            <span><b>${e(R.ETAPES[n - 1].titre)}</b> ${e(x.messages.filter((m) => m.niveau !== "info").map((m) => m.texte).join(" "))}</span></li>`).join("")}
        </ul>
        <p class="aide">Touchez une étape pour la finir d'abord. Ou envoyez tel quel : votre MJ la finira avec vous.</p>
        <div class="actions"><button value="non">Pas encore</button><button value="envoyer" class="principal" data-confirmer-envoi>Envoyer quand même</button></div>
      </form>`;
    document.body.append(d);
    return new Promise((ok) => {
      d.addEventListener("close", () => {
        const choix = d.returnValue;
        d.remove();
        if (/^\d+$/.test(choix)) this.aller(+choix);
        ok(choix === "envoyer");
      }, { once: true });
      d.showModal();
    });
  }

  // Accueilli par le MJ (la suite se fait avec lui) ou lien retiré : plus rien ne part d'ici.
  joueurFerme(err) {
    this.perdu = true;
    this.modifies = false;
    this.sauver.annuler();
    this.etat("ferme");
    if (err.status === 423) {
      // Accueilli, ou relié par le MJ à un héros de la tablée : la phrase dit lequel des deux.
      const dire = () => {
        const qui = String(this.moi?.heros?.nom || "").split(/[\s,]+/)[0];
        toast(this.moi?.relie
          ? `Votre MJ vous a confié ${qui || "un héros de la tablée"} : ce que vous venez d'écrire n'a pas été enregistré. La suite se fait avec lui.`
          : "Votre MJ vient d'accueillir votre aventurier : ce que vous venez d'écrire n'a pas été enregistré. Demandez-lui la retouche.", "erreur", { duree: 12000 });
      };
      // La page se relit : bandeau, fiche telle que le MJ l'a reçue, plus aucun champ ouvert.
      this.demarrerJoueur().then(dire, () => {
        this.moi = { ...(this.moi || {}), accueilli: true };
        this.rafraichir();
        dire();
      });
    } else toast("Vous n'êtes plus connecté : reconnectez-vous avec votre identifiant et votre mot de passe.", "erreur");
  }

  // ---------------------------------------------------------------- la TV

  async envoyer(changements) {
    const etat = await api.get("/api/table");
    delete etat.ecrans;
    const nouveau = { ...etat, ...changements };
    const r = await api.put("/api/table", nouveau);
    this.table = nouveau;
    return r;
  }

  async basculer(extra) {
    const etat = await api.get("/api/table");
    const avant = VUES_PLEINES.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
    return this.envoyer({ ...extra, avant, lieu: null });
  }

  async revenir() {
    const etat = await api.get("/api/table");
    const avant = etat.avant && !VUES_PLEINES.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
    return this.envoyer({ ...avant, contrat: null, avant: null });
  }

  async montrerTv(montrer) {
    if (this.joueur || !this.a?.id) return;
    try {
      if (this.modifies) await this.sauver.maintenant();
      const r = await this.envoyer({ aventurier: montrer ? this.a.id : null, aventurier_maj: Date.now() });
      toast(montrer ? (r.ecrans ? `À la TV : ${prenom(this.a)} se présente.` : "Envoyé, mais aucun écran de table n'est branché.") : `Retiré de la TV : le carton ${/^[aeiouyàâéèêëîïôöùûœh]/i.test(prenom(this.a)) ? "d'" : "de "}${prenom(this.a)}.`);
      this.rafraichir();
    } catch (err) {
      toast(`La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  // Les boutons de la TV au modèle commun (bouton-tv.js) : « Montrer à la TV », puis liseré or, « À la TV » et
  // « Retirer de la TV » tant que la TV montre le héros (son carton) ou la tablée.
  majBoutonsTv() {
    const peindre = (b, ici, montrer, retirer, libelle) => {
      b.classList.toggle("montree", ici);
      b.classList.toggle("principal", !ici);
      b.setAttribute("aria-pressed", String(ici));
      b.dataset.action = ici ? retirer : montrer;
      b.innerHTML = ici ? '<span class="tv-etat">À la TV</span><span class="tv-geste">Retirer de la TV</span>' : `<span class="tv-geste">${libelle}</span>`;
    };
    const tablee = this.racine.querySelector("[data-tv-tablee]");
    if (tablee) peindre(tablee, this.table?.vue === "heros", "tv-tablee", "tv-tablee-retirer", "Montrer la tablée à la TV");
    const heros = this.a && this.racine.querySelector(".actions-heros .bouton-tv");
    if (heros) peindre(heros, this.table?.aventurier === this.a.id, "tv", "tv-retirer", "Montrer à la TV");
  }

  // Tant que l'aventurier est sur la TV, chaque enregistrement y est repris : la table le voit prendre forme.
  async rafraichirTv() {
    if (this.joueur) return;
    try {
      const etat = await api.get("/api/table");
      if (etat.aventurier !== this.a?.id) {
        this.table = etat;
        return this.rafraichir();
      }
      await this.envoyer({ aventurier_maj: Date.now() });
    } catch {
      // la TV rattrapera au prochain envoi
    }
  }
}
