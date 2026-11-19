// Éditeur de plans intérieurs : tracer les pièces (les murs suivent), poser portes, mobilier et pions, révéler les pièces
// aux joueurs et montrer le plan sur la TV. Enregistré au fil de l'eau, avec annulation.

import { api, differer, echapper as e, erreurIA, toast } from "../api.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { questionTvNoire } from "../ecran-tv/tv-noire.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";
import { AVIS_PAVE, chargerImage, chargerPolices, garderDefilement, lireDefilement, molette, premierGlisser } from "../carte/vue.js";
import { CREATURES, GENS, RANGS } from "../combats/bestiaire.js";
import { cartonVerifie } from "../pnj/carton-pnj.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { donnerLaMain, rendreLaMain } from "../commun/clavier-editeur.js";
import { Attente, DELAI, aGlisse, auDoigt } from "../commun/doigt.js";
import { Reessai } from "../commun/reessai.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { ecouterEtatJeu, poserPlanCourant } from "../commun/etat-jeu.js";
import { adversairesSurPlan, jaugesDuPlan, mainDuPlan } from "./jauges.js";
import { Pointeur, panneauPointeur, textePortee } from "../ecran-tv/pointeur.js";
import { montrerPointeursJoueurs } from "../commun/pointeurs-joueurs.js";
import { MODELES, generer } from "./generateurs.js";
import { cameraElargie, changeDeCase, entrer, herosVisible, marquerPiece, piecesEntrees } from "./entrer.js";
import { brancherMouvements, recevoirMouvements } from "./mouvements-joueurs.js";
import {
  CALCINE, COULEURS_PIONS, ETATS_PORTE, FEUX, GENRES_PIECES, KITS_HABILLAGE, MEUBLES, PORTES, SOLS, SOLS_DEDANS, areteProche, boitePiece,
  boiteRevelee, cacheParLaBrume, calculerMurs, casesArete, dedans, emprise, idx, nouvelId, piece as lirePiece,
} from "./modele.js";
import { AMBIANCES } from "./peint.js";
import { ordreDesFigurines, vignetteMeuble } from "./rendu.js";
import { dansFigurine } from "./figurine.js";
import { PaletteMeubles } from "./palette-meubles.js";
import { htmlLumiere, htmlMurs, htmlTeintes } from "./reglages-decor.js";
import * as lum from "./lumieres.js";
import * as sg from "./sang.js";
import { htmlSang } from "./sang-menu.js";
import { htmlLumiereChoisie, htmlLumieres } from "./lumieres-menu.js";
import { VuePlan } from "./vue.js";
// Lot H2 : les pions enrichis et les images du MJ (bibliothèque, décors, pions).
import { actionImage, clicImage, panneauImageObjet, panneauImages, reglerImage } from "./editeur-images.js";
import { actionPion, htmlApparencePion, htmlEtatsPion, reglerPion, suivreVolets } from "./editeur-pions.js";
import { anneauxDe, avecLesSelles, basculer, dansRectangle, idsDe, pasDuGroupe, placeDuGroupe, selectionDe, suiveurs } from "./groupe-pions.js";
import { estImage } from "./images.js";
import { attente, importerUvtt } from "./importer-uvtt.js";
import { AIDE_UVTT, PERTES_UVTT } from "./uvtt.js";
import { TAILLES_PION, numeroLibre, poserCavaliers } from "./pions.js";

const ICONES = {
  multi: '<path d="M4 4h16v16H4z" stroke-dasharray="3 2.6"/><circle cx="9.2" cy="9.8" r="2.3"/><circle cx="14.8" cy="14.4" r="2.3"/>',
  main: '<path d="M6 3l12 8-5.2 1.3L10 18z"/>',
  piece: '<path d="M4 5h16v14H4z"/><path d="M4 12h7v7"/><path d="M14 5v4"/>',
  sol: '<path d="M19.5 3.5l1.5 1.5-9 9-1.9-1.9z"/><path d="M9.6 12.6c-2.1 0-3.6 1.4-3.6 3.4 0 1.3-.7 2.3-2 3 3 .9 7.2-.3 7.6-4.4"/>',
  porte: '<path d="M6 21V4h12v17"/><path d="M3.5 21h17"/><circle cx="14.6" cy="12.6" r=".9"/>',
  meuble: '<path d="M3.5 9h17M6 9v10M18 9v10M8 13h8"/><path d="M9 9V6h6v3"/>',
  pion: '<circle cx="12" cy="7" r="3"/><path d="M8 19.5c0-4 1.8-7 4-7s4 3 4 7z"/><path d="M5.5 20h13"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 16.5l5-5 4 4 2.5-2.5 5.5 5"/><circle cx="15.5" cy="9.5" r="1.6"/>',
  brouillard: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  brume: '<path d="M3 8.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M3 13c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M6 17.5c1.8-1.3 3.6-1.3 5.4 0s3.6 1.3 5.4 0"/>',
  feu: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-2.9 1.9-4.8 3.3-6.6.3 1.7 1.1 2.8 2.2 3.3-.2-3.4 1.2-6.4 3.6-8.6-.2 2.6.8 4.4 2.2 6.1 1.2 1.5 1.7 3 1.7 4.9 0 4-2.7 7-6.5 7z"/><path d="M12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.5 1-2.4 1.9-3.4.4 1 1 1.5 1.6 1.7.1-1.2.6-2.2 1.4-3 .8 1.3 1.5 2.5 1.5 4 0 2-1.6 3.3-3.7 3.3z"/>',
  texte: '<path d="M5 7V4.5h14V7M12 4.5V20M9 20h6"/>',
  sang: '<path d="M12 3c3 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 3-6.8 6-11z"/><path d="M9.2 15.2a3 3 0 0 0 2.2 2.4"/>',
  lumiere: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  mesure: '<path d="M12 3v3M12 6L6.5 21M12 6l5.5 15M8.4 15.5h7.2"/>',
  pointeur: '<circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="6.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6"/>',
  annuler: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12h-2" transform="translate(0 -6)"/>',
  refaire: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12h2" transform="translate(0 -6)"/>',
  exporter: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  pave: '<path d="M5 6h14v9H5z"/><path d="M3 18h18"/><path d="M10 16.5h4"/>',
  souris: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
  gauche: '<path d="M16 5l-7 7 7 7"/>',
  droite: '<path d="M8 5l7 7-7 7"/>',
};
const icone = (cle) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[cle]}</svg>`;

// Les lettres des outils, montrées aussi sur la carte des touches (touches.js).
export const OUTILS = [
  ["main", "Sélection et déplacement", "V"],
  ["piece", "Tracer une pièce", "P"],
  ["sol", "Peindre le sol", "B"],
  ["porte", "Portes et fenêtres", "D"],
  ["meuble", "Mobilier", "M"],
  ["pion", "Pions", "J"],
  // L comme la bibliothèque des images : I note une idée partout dans l'atelier.
  ["image", "Images (pions et décors)", "L"],
  ["brouillard", "Révéler aux joueurs", "F"],
  // U comme brume : B est le sol, R tourne un meuble.
  ["brume", "Brume", "U"],
  // A comme allumer : F révèle déjà, et I note une idée partout dans l'atelier.
  ["feu", "Feu", "A"],
  // O comme ombre et lumière : L est la bibliothèque des images, F révèle, A allume le feu.
  ["lumiere", "Lumières", "O"],
  // S comme sang : taches posées ou peintes au pinceau, à même le sol (sang.js).
  ["sang", "Sang", "S"],
  // E comme écrire : T ouvre le Tableau partout dans l'atelier.
  ["texte", "Texte", "E"],
  // G comme graduer : M est le mobilier, et la carte prend la même touche.
  ["mesure", "Mesurer", "G"],
  // C comme cible : P est déjà « Tracer une pièce », et la carte prend la même touche.
  ["pointeur", "Pointeur pour la TV", "C"],
];
const CHAMPS_ETAT = ["nom", "lieu", "etage", "largeur", "hauteur", "m_case", "style", "quadrillage", "brouillard_actif", "sol", "piece", "brouillard", "brume", "brume_teinte", "feu", "feu_effet", "etapes", "etape", "pieces", "portes", "objets", "pions", "textes", "fond", "notes", "generateur", "habillage"];
// Les étapes d'un plan (plan.etapes) : le feu et la brume gardés pour être rappelés d'un clic pendant la partie.
const ETAPES_MAX = 12;
const NOMS_FEU = { 1: "braises", 2: "flammes", 3: "brasier", 4: "calciné" };
const option = (liste, valeur) => liste.map(([v, n]) => `<option value="${e(v)}" ${String(v) === String(valeur) ? "selected" : ""}>${e(n)}</option>`).join("");
const virgule = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

// L'habillage (plan.habillage) : objets d'ambiance, lumières, ambiance et étiquettes proposés par la rédaction, dessinés en style peint.
const HEURES = [["jour", "Jour"], ["soir", "Soir"], ["nuit", "Nuit"]];
const NOMS_KITS = Object.fromEntries(KITS_HABILLAGE.map((k) => [k.cle, k.nom]));
// Rayon de prise d'un objet d'habillage sous le pointeur, en cases (les petits objets de table : 0,22).
const PRISES = { "table-ronde": 0.45, abreuvoir: 0.5, "tas-bois": 0.45, "feu-de-camp": 0.45, paille: 0.4, flaque: 0.4, botte: 0.3, toile: 0.35 };
const deux = (x) => Math.round(x * 100) / 100;
const resumeHabillage = (h) => {
  const n = (l, un, plusieurs) => `${l} ${l > 1 ? plusieurs : un}`;
  const o = Array.isArray(h?.objets) ? h.objets.length : 0;
  const l = Array.isArray(h?.lumieres) ? h.lumieres.length : 0;
  const t = Array.isArray(h?.legende) ? h.legende.length : 0;
  return `${n(o, "objet", "objets")}, ${n(l, "lumière", "lumières")}, ${n(t, "étiquette", "étiquettes")}`;
};

// Deux boîtes en cases réunies (la première peut manquer).
const reunir = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);

// « Entrer révèle la pièce » : coché par défaut, retenu sur ce navigateur. Les deux outils qui déplacent les pions
// suivent la même règle : un héros glissé à la flèche ne disparaît pas de la TV dans une pièce restée cachée.
const OUTILS_QUI_ENTRENT = ["pion", "main"];
function lireEntrer() {
  try {
    return localStorage.getItem("plan.entrer-revele") !== "non";
  } catch {
    return true;
  }
}

function garderEntrer(oui) {
  try {
    localStorage.setItem("plan.entrer-revele", oui ? "oui" : "non");
  } catch {
    // préférence perdue, sans conséquence
  }
}

// « Jauges sur les pions » (dans l'atelier ; la TV montre toujours celles des héros) : coché par défaut, retenu ici.
function lireJauges() {
  try {
    return localStorage.getItem("plan.jauges") !== "non";
  } catch {
    return true;
  }
}

function garderJauges(oui) {
  try {
    localStorage.setItem("plan.jauges", oui ? "oui" : "non");
  } catch {
    // préférence perdue, sans conséquence
  }
}

function normaliser(p) {
  const n = p.largeur * p.hauteur;
  // Un plan d'avant la brume ou le feu n'en a pas : sans brume, sans feu.
  for (const cle of ["sol", "piece", "brouillard", "brume", "feu"]) if (!Array.isArray(p[cle]) || p[cle].length !== n) p[cle] = Array(n).fill(0);
  for (const cle of ["pieces", "portes", "objets", "pions", "textes"]) if (!Array.isArray(p[cle])) p[cle] = [];
  // Les étapes : un nom, un feu et une brume de la taille du plan chacune ; celle qui a été rappelée en dernier.
  const grille = (t) => (Array.isArray(t) && t.length === n ? t : Array(n).fill(0));
  p.etapes = (Array.isArray(p.etapes) ? p.etapes : []).filter((et) => et && typeof et === "object").slice(0, ETAPES_MAX).map((et, k) => ({
    nom: typeof et.nom === "string" && et.nom.trim() ? et.nom.trim().slice(0, 60) : `Étape ${k + 1}`, feu: grille(et.feu), brume: grille(et.brume),
  }));
  if (!(Number.isInteger(p.etape) && p.etapes[p.etape])) p.etape = null;
  // L'effet des flammes en combat (combats/flammes.js) : un texte du MJ, vide tant qu'il ne l'a pas écrit.
  if (typeof p.feu_effet !== "string") p.feu_effet = "";
  p.style ||= "couleur";
  p.m_case ||= 1.5;
  if (p.quadrillage === undefined) p.quadrillage = true;
  if (p.brouillard_actif === undefined) p.brouillard_actif = true;
  return p;
}

// Remplacer un plan retouché : la même question pour le générateur et le plan programmé.
const QUESTION_RETOUCHE = (par) => ({
  titre: "Remplacer ce plan retouché",
  texte: `Ce plan a été retouché (pions, textes, notes, pièces révélées, image de fond…). Le remplacer ${par} ?`,
  aide: "Ctrl+Z revient en arrière.",
  oui: "Remplacer le plan",
});

export class EditeurPlan {
  constructor(racine, planJson) {
    this.racine = racine;
    this.plan = normaliser(planJson);
    this.outil = "main";
    this.optPiece = { genre: "salle", sol: 2 };
    this.optSol = { sol: 1, rayon: 1 };
    this.optPorte = { genre: "porte", etat: "fermee" };
    this.optMeuble = { cle: "table", rot: 0 };
    // La palette du mobilier (palette-meubles.js) : familles, recherche, récents.
    this.palette = new PaletteMeubles((cle) => this.vignette(cle));
    this.optBrume = { mode: "piece", rayon: 1 };
    // L'outil Brume (plan.brume, l'effet que voient les joueurs ; optBrume, au-dessus, est celle du brouillard) : la
    // densité que pose le pinceau (1 voile, 2 épaisse, 0 efface) et sa taille.
    this.optNappe = { valeur: 1, rayon: 2 };
    // L'outil Feu (plan.feu) : la valeur que pose le pinceau (1 braises, 2 flammes, 3 brasier, 4 calciné, 0 éteint) et
    // sa taille.
    this.optFeu = { valeur: 2, rayon: 1 };
    // L'outil Lumières (plan.habillage.lumieres) : le type de la prochaine lumière posée (lumieres.js).
    this.optLumiere = { type: "torche" };
    // L'outil Sang (plan.habillage.sang) : forme, taille en cases, fraîcheur (0 frais, 1 sec), teinte, caché aux joueurs.
    this.optSang = { forme: "pinceau", taille: 1, age: 0.15, teinte: "rouge", cache: false };
    this.optPion = null;
    // Outil Pions : un héros posé dans une pièce cachée la révèle (entrerRevele) ; entree garde les pièces ainsi
    // révélées pour rappeler leurs notes dans le panneau du pion, elargir ce que la TV doit encore montrer.
    this.entrerRevele = lireEntrer();
    this.entree = null;
    this.elargir = null;
    // Pavé tactile (deux doigts déplacent la vue) ou souris (la molette zoome), retenu sur ce navigateur.
    this.defilement = lireDefilement();
    // Habillage : la demande en cours (habillement), puis la proposition montrée avant d'être gardée (apercu).
    this.optHab = { heure: "soir", idee: "" };
    this.habillement = null;
    this.apercu = null;
    // Ce qui est choisi : un élément ({ genre, id }), ou plusieurs pions ({ genre: "pions", ids }, groupe-pions.js).
    this.selection = null;
    // « Sélection multiple » (au doigt, sans touche Maj) : toucher un pion l'ajoute ou le retire, glisser sur le plan
    // trace un rectangle.
    this.multiple = false;
    this.passe = [];
    this.futur = [];
    this.pointeurs = new Map();
    // Au doigt (doigt), l'action du premier contact attend son lever ou un petit glissé (attente) : voir doigt.js.
    this.doigt = false;
    this.attente = null;
    // Outil Pointeur (pointeur.js) : la liaison vers la TV, le doigt qui pointe, et ce que le serveur dit de la portée
    // du point (undefined : rien appris depuis la dernière lecture de la table ; null : liaison coupée).
    this.pointeur = null;
    this.doigtPointe = null;
    this.portee = undefined;
    this.lieux = [];
    this.aventuriers = [];
    this.pnj = [];
    this.rencontres = [];
    this.detruit = false;
    // Enregistrement : un envoi à la fois (enVol), un seul autre en file (relance) ; suspendu après un conflit.
    this.enVol = null;
    this.relance = null;
    this.suspendu = false;
    this.fileTable = Promise.resolve();
    this.sauver = differer(() => this.enregistrer(), 900);
    this.suivreTable = differer(() => this.envoyerTable(), 220);
    this.clavier = (ev) => this.touche(ev);
    this.relache = (ev) => {
      if (ev.code === "Space") this.espace = false;
    };
    // Serveur injoignable : le plan repart seul (3 s, 10 s, puis toutes les 30 s) ; l'état affiché compte les secondes.
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatSauvegarde === "erreur") this.etat("erreur");
    });
    // Retour sur cet onglet : une image a pu être montrée depuis un autre.
    this.auRetour = () => this.lireTable();
  }

  // Chaque attente peut voir la page quittée : l'éditeur détruit s'arrête là, sans poser d'écouteurs.
  async demarrer() {
    this.racine.innerHTML = this.gabarit();
    this.dom = this.racine.querySelector(".editeur-plan");
    this.canvas = this.dom.querySelector("canvas");
    this.panneau = this.dom.querySelector(".panneau");
    this.infos = this.dom.querySelector(".infos");
    this.pointe = this.dom.querySelector(".curseur-plan");
    // Le pointeur d'un joueur posé depuis le coin (« Montrer au MJ ») paraît sur ce plan, à la couleur de son héros.
    this.finPointeursJoueurs = montrerPointeursJoueurs({ hote: this.dom.querySelector(".scene"), genre: "plan", id: this.plan.id, vue: () => this.vue });
    await chargerPolices();
    if (this.detruit) return;
    this.texture = await chargerImage("/static/img/carte-parchemin.jpg").catch(() => null);
    if (this.detruit) return;
    this.vue = new VuePlan(this.canvas, { style: this.plan.style, texture: this.texture, mj: true, fond: "#0e0b09", brume: () => this.toileBrume(), feu: () => this.toileFeu() });
    this.vue.charger(this.plan);
    this.vue.cadrer();
    this.vue.dessusEditeur = (ctx, zone) => this.dessinerEditeur(ctx, zone);
    // Les jauges des pions : l'état des héros et le combat en cours, relus pendant qu'on joue (etat-jeu.js).
    this.jeu = null;
    this.vue.jauges = () => (this.jaugesVisibles() ? jaugesDuPlan(this.plan, this.jeu) : null);
    // La figurine de qui a la main luit, comme sur la TV.
    this.vue.main = () => (this.jaugesVisibles() ? mainDuPlan(this.plan, this.jeu?.combat) : null);
    this.finEcouteJeu = ecouterEtatJeu((jeu) => {
      if (this.detruit) return;
      this.jeu = jeu;
      this.vue.demander();
    });
    poserPlanCourant(() => (this.detruit ? null : this.plan));
    // Les pions que les joueurs bougent depuis leur coin : posés ici sans recharger, fantômes de ceux qui attendent.
    this.finMouvements = brancherMouvements(this);
    // Un nom touché dans le tableau du MJ : son pion est choisi sur le plan.
    this.pionDuTableau = (ev) => this.choisirPionDuTableau(ev.detail || {});
    window.addEventListener("tableau-pion", this.pionDuTableau);
    // Une étape rappelée depuis la télécommande (relais-telecommande.js) : le même geste que la barre Étapes ; le relais
    // attend l'enregistrement, qui met la TV à jour.
    this.etapeDistante = (ev) => {
      const d = ev.detail || {};
      if (this.detruit || this.suspendu || d.plan !== this.plan.id || !this.plan.etapes[d.etape]) return;
      ev.preventDefault();
      this.appliquerEtape(d.etape);
      d.enregistre = Promise.resolve(this.enVol).then(() => !this.suspendu && this.etatSauvegarde !== "erreur");
    };
    window.addEventListener("telecommande-etape", this.etapeDistante);
    this.vue.surCamera = () => {
      if (this.suivre) this.suivreTable();
    };
    // « Montrer à la TV » : le bouton commun (bouton-tv.js), qui suit l'état réel de la table, comme le témoin.
    this.boutonTv = new BoutonTv({
      estIci: (t) => t.vue === "plan" && t.plan === this.plan.id,
      montrer: () => this.montrerALaTv(),
      // tableAccueil dit lui-même un échec : le message ne suit qu'un retrait fait.
      retirer: async () => {
        await this.tableAccueil();
        if (!this.tableIci) toast(`Retiré de la TV : le plan «\u00a0${this.plan.nom}\u00a0».`);
      },
      libelle: () => (this.retour ? "Revenir au plan" : "Montrer à la TV"),
      titre: "Ce plan sur la TV, cadré sur ce que les joueurs connaissent",
      titreIci: "La TV montre ce plan : le retirer, l'écran d'accueil revient",
    });
    this.dom.querySelector(".place-bouton-tv").replaceWith(this.boutonTv.el);
    this.lier();
    this.choisirOutil("main");
    this.majBarre();
    this.etat("ok");
    this.lireTable();
    this.finTv = ecouterTv((t) => this.tableRecue(t));
    const manquent = [];
    const lire = (url, nom) => api.get(url).catch(() => {
      manquent.push(nom);
      return [];
    });
    const [lieux, aventuriers, pnj, rencontres] = await Promise.all([
      lire("/api/lieux", "les lieux"), lire("/api/aventuriers", "la tablée"), lire("/api/pnj", "les PNJ"), lire("/api/rencontres", "les rencontres"),
    ]);
    if (this.detruit) return;
    if (manquent.length) toast(`Lecture impossible (${manquent.join(", ")}) : le panneau sera incomplet.`, "erreur");
    this.lieux = lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    this.aventuriers = aventuriers.filter((a) => a.tablee !== false).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    this.pnj = pnj.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    this.rencontres = rencontres;
    if (!this.panneau.contains(document.activeElement)) this.afficherPanneau();
  }

  // Page quittée : plus d'écouteurs ; la promesse rendue se résout quand le dernier enregistrement est parti.
  detruire() {
    this.detruit = true;
    this.finEcouteJeu?.();
    this.finMouvements?.();
    poserPlanCourant(null);
    window.removeEventListener("tableau-pion", this.pionDuTableau);
    window.removeEventListener("telecommande-etape", this.etapeDistante);
    this.attente?.annuler();
    this.pointeur?.fermer();
    this.finPointeursJoueurs?.();
    clearInterval(this.minuterieHab);
    this.vue?.detruire();
    window.removeEventListener("keydown", this.clavier);
    window.removeEventListener("keyup", this.relache);
    window.removeEventListener("focus", this.auRetour);
    this.suivreTable.annuler();
    this.finTv?.();
    this.boutonTv?.detruire();
    return this.vider();
  }

  // Onglet fermé ou passé en arrière-plan : ce qui attend part tout de suite, un envoi raté compris. Rien à attendre,
  // rien de rendu.
  vider() {
    if (this.etatSauvegarde === "erreur" && !this.sauver.enAttente()) return this.enregistrer();
    return this.sauver.vider() || this.relance || this.enVol || undefined;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return ["modifie", "enregistrement", "erreur"].includes(this.etatSauvegarde) || this.sauver.enAttente();
  }

  gabarit() {
    return `
    <div class="editeur editeur-plan">
      <header class="barre-carte">
        <a class="retour" href="#/cartes" title="Toutes les cartes et les plans">Cartes</a>
        <h1 class="nom-carte" title="${e(this.plan.nom)}">${e(this.plan.nom)}</h1>
        ${htmlTemoin()}
        <div class="segments" role="group" aria-label="Rendu">
          <button data-style="couleur">Couleur</button><button data-style="parchemin">Parchemin</button><button data-style="peint">Peint</button>
        </div>
        <div class="segments" role="group" aria-label="Aperçu">
          <button data-mode="mj" title="Tout voir">Vue du MJ</button><button data-mode="joueurs" title="Ce que verront les joueurs">Vue joueurs</button>
        </div>
        <button class="icone-seule" data-action="annuler" title="Annuler (Ctrl+Z)">${icone("annuler")}</button>
        <button class="icone-seule" data-action="refaire" title="Rétablir (Ctrl+Y)">${icone("refaire")}</button>
        <div class="menu-exporter">
          <button class="icone-seule" data-action="exporter" title="Exporter en image">${icone("exporter")}</button>
          <div class="menu" hidden>
            <button data-action="export-mj">Plan du MJ (PNG)</button>
            <button data-action="export-joueurs">Plan des joueurs (PNG)</button>
          </div>
        </div>
        <div class="segments defilement" role="group" aria-label="Défilement">
          <button data-defilement="pave" title="Pavé tactile : glisser à deux doigts déplace la vue, pincer zoome" aria-label="Pavé tactile">${icone("pave")}</button><button data-defilement="souris" title="Souris : la molette zoome" aria-label="Souris">${icone("souris")}</button>
        </div>
        <div class="espace"></div>
        <div class="table-ctrl">
          <span class="ecrans" title="Écrans de table connectés"></span>
          <span class="place-bouton-tv"></span>
          <label class="bascule" title="La TV suit chacun de vos déplacements"><input type="checkbox" data-action="table-suivre"><span>Suivre</span></label>
          <button data-action="table-accueil" title="Remettre l'écran d'accueil sur la TV">Accueil</button>
        </div>
      </header>
      <nav class="outils" aria-label="Outils">
        ${OUTILS.map(([cle, nom, t]) => `<button data-outil="${cle}" title="${e(nom)} (${t})" aria-label="${e(nom)}">${icone(cle)}<kbd>${t}</kbd></button>`).join("")}
        <button data-multi aria-pressed="false" title="Sélection multiple de pions : toucher un pion l'ajoute ou le retire, glisser sur le plan trace un rectangle (à la souris : Maj + clic, Maj + glisser)" aria-label="Sélection multiple de pions">${icone("multi")}</button>
      </nav>
      <div class="scene"><canvas tabindex="0" aria-label="Plan"></canvas><div class="curseur-plan" hidden></div><div class="infos"></div><div class="bandeau-ia" aria-live="polite" hidden></div><div class="etapes-plan" role="group" aria-label="Étapes du feu et de la brume" hidden></div></div>
      <aside class="panneau"></aside>
    </div>`;
  }

  lier() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (ev) => this.pointeurBas(ev));
    c.addEventListener("pointermove", (ev) => this.pointeurBouge(ev));
    c.addEventListener("pointerup", (ev) => this.pointeurHaut(ev));
    c.addEventListener("pointercancel", (ev) => this.pointeurHaut(ev));
    c.addEventListener("pointerleave", (ev) => {
      this.curseur = null;
      this.majCurseur();
      // La souris sort du plan : son point quitte la TV. Un doigt levé (ou un stylet) le laisse s'estomper.
      if (ev.pointerType === "mouse") this.pointeur?.effacer();
      this.survolerPion(null);
    });
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const g = molette(this.vue, ev, this.defilement);
      if (!g) return;
      // Le plan a bougé sous le pointeur immobile : le curseur de l'outil et les infos suivent, le point de la TV aussi.
      this.curseur = this.position(ev);
      this.majInfos();
      this.majCurseur();
      if (this.outil === "pointeur") this.pointeur.bouger(...this.curseur);
      if (g.glisser && premierGlisser()) toast(AVIS_PAVE);
    }, { passive: false });
    c.addEventListener("contextmenu", (ev) => ev.preventDefault());
    window.addEventListener("keydown", this.clavier);
    window.addEventListener("keyup", this.relache);
    window.addEventListener("focus", this.auRetour);
    const barre = this.dom.querySelector(".barre-carte");
    barre.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.style) this.changerStyle(b.dataset.style);
      if (b.dataset.mode) this.changerMode(b.dataset.mode);
      if (b.dataset.defilement) this.changerDefilement(b.dataset.defilement);
      const a = b.dataset.action;
      if (a === "annuler") this.annuler();
      if (a === "refaire") this.refaire();
      if (a === "exporter") this.dom.querySelector(".menu-exporter .menu").hidden ^= true;
      if (a === "export-mj" || a === "export-joueurs") this.exporter(a === "export-joueurs");
      if (a === "table-accueil") this.tableAccueil();
    });
    barre.querySelector('[data-action="table-suivre"]').addEventListener("change", (ev) => {
      this.suivre = ev.target.checked;
      if (this.suivre) this.envoyerTable({ forcer: true });
      // Le MJ a cadré la TV à la main : le chemin du retour au cadrage automatique est dit tout de suite (b12).
      else if (this.tableIci && this.plan.brouillard_actif) toast("La TV garde ce cadre.", "info", { action: { libelle: "Cadrage auto", faire: () => this.cadrageAuto() } });
    });
    this.dom.querySelector(".outils").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-outil]");
      if (b) this.choisirOutil(b.dataset.outil);
      else if (ev.target.closest("[data-multi]")) this.basculerMultiple();
    });
    this.panneau.addEventListener("input", (ev) => this.saisie(ev, false));
    this.panneau.addEventListener("change", (ev) => this.saisie(ev, true));
    this.palette.brancher(this.panneau, () => this.optMeuble.cle);
    // Une action qui échoue (réseau, générateur) le dit au lieu de s'arrêter en silence.
    this.panneau.addEventListener("click", (ev) => this.actionPanneau(ev).catch((err) => toast(`Action impossible : ${err.message}`, "erreur")));
    // La barre des étapes, sous la main pendant la partie : un clic rappelle le feu et la brume d'une étape.
    this.dom.querySelector(".etapes-plan").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-etape]");
      if (b) this.appliquerEtape(+b.dataset.etape);
    });
    // À la souris, le nom d'une étape survolée s'écrit dans la barre. Pas au doigt : un texte qui change sous le doigt
    // fait prendre le toucher pour un survol sur iPad, et l'étape ne se rappellerait qu'au second.
    this.dom.querySelector(".etapes-plan").addEventListener("pointerover", (ev) => ev.pointerType === "mouse" && this.apercuEtape(ev.target.closest("[data-etape]")));
    this.dom.querySelector(".etapes-plan").addEventListener("pointerout", (ev) => ev.pointerType === "mouse" && this.apercuEtape(null));
    this.bandeau = this.dom.querySelector(".bandeau-ia");
    this.bandeau.addEventListener("click", (ev) => {
      const a = ev.target.closest("button")?.dataset.action;
      if (a === "hab-garder") this.garderApercu();
      if (a === "hab-ecarter") this.ecarterApercu();
      if (a === "hab-peint") this.changerStyle("peint");
    });
  }

  // ---------------------------------------------------------------- état, sauvegarde, annulation

  // Après la destruction, this.dom n'est plus dans la page : ces écritures ne touchent pas la page suivante.
  etat(x) {
    this.etatSauvegarde = x;
    const suspendu = x === "suspendu";
    afficherTemoin(this.dom?.querySelector(".barre-carte .temoin-enregistrement"), suspendu ? "erreur" : x,
      { reessai: this.reessai, modifie: this.plan.modifie, texte: suspendu ? "Enregistrement suspendu" : "" });
  }

  // vite : pendant la partie (pions, brouillard), la TV doit suivre sans attendre.
  modifie(vite = false) {
    if (this.suspendu) return;
    this.etat("modifie");
    this.sauver();
    if (vite) this.sauver.maintenant();
  }

  // Un seul envoi à la fois ; un appel pendant un envoi en programme un seul autre, avec l'état le plus récent. La
  // promesse rendue se résout quand l'état de cet instant est parti (ou a échoué).
  enregistrer() {
    if (this.suspendu) return Promise.resolve();
    if (this.enVol) {
      this.relance ||= this.enVol.then(() => {
        this.relance = null;
        return this.enregistrer();
      });
      return this.relance;
    }
    this.enVol = this.envoyer().finally(() => {
      this.enVol = null;
    });
    return this.enVol;
  }

  async envoyer() {
    this.etat("enregistrement");
    try {
      const r = await api.put(`/api/plans/${this.plan.id}`, { ...this.plan, habillage: this.habillageGarde(), version_base: this.plan.modifie });
      // Des déplacements de joueurs que le serveur a rejoués sur cet envoi (mouvements.py) : posés ici aussi.
      if (r.rejoues) recevoirMouvements(this, r.rejoues, { version: false });
      this.plan.modifie = r.modifie;
      this.reessai.reussite();
      this.etat(this.sauver.enAttente() || this.relance ? "modifie" : "ok");
      // La TV qui montre ce plan reçoit la nouvelle version, sans changer de cadrage (après un nouvel essai aussi).
      this.envoyerTable({ apresEnregistrement: true });
    } catch (err) {
      if (err.status === 409) return this.conflit();
      this.reessai.echec(err);
      this.etat("erreur");
      this.reessai.signaler(err, "Enregistrement impossible");
    }
  }

  // Un autre écran a enregistré ce plan entre-temps : plus aucun envoi d'ici, et une seule question.
  async conflit() {
    if (this.suspendu) return;
    this.suspendu = true;
    this.sauver.annuler();
    this.reessai.arreter();
    this.etat("suspendu");
    const message = "Ce plan a été modifié depuis un autre écran : vos derniers changements ici n'ont pas été enregistrés.";
    if (this.detruit) return toast(message, "erreur");
    if (await demander({ titre: "Modifié sur un autre écran", texte: message, aide: "Recharger reprend la dernière version enregistrée ; les changements faits ici depuis sont perdus.", oui: "Recharger", non: "Rester sur cette version", danger: true })) location.reload();
    else toast("Enregistrement suspendu sur cet écran : rechargez la page pour reprendre.", "erreur");
  }

  // L'habillage enregistré : pendant l'aperçu d'une proposition, celui d'avant (la proposition n'est que montrée, ni
  // enregistrée, ni prise dans l'historique).
  habillageGarde() {
    return (this.apercu ? this.apercu.avant : this.plan.habillage) || null;
  }

  etatCourant() {
    const etat = {};
    for (const k of CHAMPS_ETAT) etat[k] = k === "habillage" ? this.habillageGarde() : this.plan[k];
    return JSON.stringify(etat);
  }

  instantane() {
    this.passe.push(this.etatCourant());
    if (this.passe.length > 60) this.passe.shift();
    this.futur = [];
    this.majBarre();
  }

  restaurer(depuis, vers) {
    const etat = depuis.pop();
    if (!etat) return;
    // Annuler pendant un aperçu l'écarte d'abord : on revient sur ce qui était enregistré.
    if (this.apercu) this.ecarterApercu({ dessiner: false });
    vers.push(this.etatCourant());
    Object.assign(this.plan, JSON.parse(etat));
    this.selection = null;
    this.entree = null;
    this.elargir = null;
    this.vue.selection = null;
    this.vue.style = this.plan.style || "couleur";
    this.vue.charger(this.plan);
    Object.assign(this.dom.querySelector(".nom-carte"), { textContent: this.plan.nom, title: this.plan.nom });
    this.afficherPanneau();
    this.majBarre();
    this.modifie();
  }

  annuler() {
    this.restaurer(this.passe, this.futur);
  }

  refaire() {
    this.restaurer(this.futur, this.passe);
  }

  majBarre() {
    for (const b of this.dom.querySelectorAll("[data-style]")) b.setAttribute("aria-pressed", b.dataset.style === this.vue.style);
    for (const b of this.dom.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", (b.dataset.mode === "joueurs") === this.vue.joueurs);
    for (const b of this.dom.querySelectorAll("[data-defilement]")) b.setAttribute("aria-pressed", b.dataset.defilement === this.defilement);
    this.dom.querySelector('[data-action="annuler"]').disabled = !this.passe.length;
    this.dom.querySelector('[data-action="refaire"]').disabled = !this.futur.length;
  }

  // Le style s'annule comme le reste ; la TV le reçoit avec l'enregistrement, tout de suite.
  changerStyle(style) {
    if (style === this.vue.style) return;
    this.instantane();
    this.plan.style = style;
    this.vue.style = style;
    this.vue.rafraichirTout();
    this.majBarre();
    // Les vignettes du mobilier suivent le style.
    this.afficherPanneau();
    this.modifie(true);
  }

  changerMode(mode) {
    this.vue.joueurs = mode === "joueurs";
    this.vue.rafraichirTout();
    this.majBarre();
  }

  changerDefilement(mode) {
    this.defilement = mode;
    garderDefilement(mode);
    this.majBarre();
  }

  choisirOutil(outil) {
    // Le point quitte la TV avec l'outil ; l'outil choisi relit ce que montre la TV, pour dire si le point y passera.
    if (outil !== "pointeur") {
      this.pointeur?.effacer();
      this.doigtPointe = null;
    } else {
      this.pointeur ||= new Pointeur("plan", this.plan.id, (p) => {
        this.portee = p;
        this.majPortee();
      });
      if (this.outil !== "pointeur") this.lireTable();
    }
    // La règle de l'outil Mesurer se montre aux joueurs du coin tant que l'outil est pris, et s'efface avec lui.
    if (outil === "mesure") {
      this.pointeur ||= new Pointeur("plan", this.plan.id, (p) => {
        this.portee = p;
        this.majPortee();
      });
    } else this.pointeur?.effacerRegle();
    this.outil = outil;
    this.mesure = null;
    this.cadre = null;
    if (outil !== "pion") this.optPion = null;
    // La sélection multiple ne vaut que pour les deux outils qui déplacent les pions.
    if (!OUTILS_QUI_ENTRENT.includes(outil)) this.multiple = false;
    // Un nouvel outil montre son panneau : la sélection d'avant s'efface.
    if (outil !== "main" && this.selection) {
      this.selection = null;
      if (this.vue) this.vue.selection = null;
    }
    for (const b of this.dom.querySelectorAll("[data-outil]")) b.setAttribute("aria-pressed", b.dataset.outil === outil);
    this.dom.querySelector("[data-multi]").setAttribute("aria-pressed", this.multiple);
    this.canvas.dataset.curseur = outil;
    this.afficherPanneau();
    this.vue.demander();
  }

  // Après un changement de structure : murs, noms et tuiles de la zone touchée.
  structure(zone) {
    this.nettoyerPortes();
    this.nettoyerHabillage();
    this.vue.majStructure(zone ? { x0: zone.x0 - 1, y0: zone.y0 - 1, x1: zone.x1 + 1, y1: zone.y1 + 1 } : null);
  }

  // Un objet ou une lumière d'habillage sur une case effacée s'en va avec elle ; une étiquette suit sa pièce.
  nettoyerHabillage() {
    const p = this.plan;
    const h = p.habillage;
    if (!h || typeof h !== "object") return;
    const sur = (x, y) => dedans(p, Math.floor(x), Math.floor(y)) && p.sol[idx(p, Math.floor(x), Math.floor(y))];
    if (Array.isArray(h.objets)) h.objets = h.objets.filter((o) => Array.isArray(o.case) && sur(o.case[0], o.case[1]));
    if (Array.isArray(h.lumieres)) h.lumieres = h.lumieres.filter((l) => sur(l.x, l.y));
    if (Array.isArray(h.sang)) h.sang = h.sang.filter((s) => sur(s.x, s.y));
    const ids = new Set(p.pieces.map((pc) => pc.id));
    if (Array.isArray(h.legende)) h.legende = h.legende.filter((l) => ids.has(l.piece));
  }

  // Une porte n'a de sens que sur un mur : entre deux pièces, ou entre une pièce et le vide.
  nettoyerPortes() {
    const p = this.plan;
    const pieceA = (x, y) => (dedans(p, x, y) && p.sol[idx(p, x, y)] ? p.piece[idx(p, x, y)] : 0);
    p.portes = p.portes.filter((d) => {
      const [[ax, ay], [bx, by]] = casesArete(d.sens, d.x, d.y);
      const a = pieceA(ax, ay);
      const b = pieceA(bx, by);
      return a !== b;
    });
  }

  // ---------------------------------------------------------------- pointeur

  position(ev) {
    return this.vue.versCarte(ev.offsetX, ev.offsetY);
  }

  pointeurBas(ev) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(ev.pointerId);
    this.pointeurs.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (this.pointeurs.size > 1) {
      if (this.pointeurs.size === 2) this.geste = { type: "pincer", ...this.mesurePincement() };
      if (this.mesure?.actif) {
        this.mesure = null;
        this.pointeur?.effacerRegle();
      }
      // Un glissé d'objet interrompu est défait même au stylet : un pion lâché en route révélerait la pièce survolée.
      return this.interrompre(this.doigt || this.glisse?.type === "objet");
    }
    this.doigt = auDoigt(ev);
    const [x, y] = this.position(ev);
    if (ev.button === 1 || ev.button === 2 || this.espace) {
      this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };
      return;
    }
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    switch (this.outil) {
      case "main": return this.basSelection(x, y, ev);
      case "piece":
        this.cadre = { x0: cx, y0: cy, x1: cx, y1: cy, effacer: ev.altKey, etendre: ev.shiftKey };
        this.glisse = { type: "cadre" };
        return this.vue.demander();
      case "sol":
        return this.auTrait(ev, () => {
          this.instantane();
          this.glisse = { type: "peinture", zone: null, nouvelle: 0, debut: this.plan.modifie };
          this.peindre(x, y);
        });
      case "porte": return this.auLever(ev, () => this.clicPorte(x, y));
      case "meuble": {
        const t = this.toucher(x, y, ["meuble"]);
        if (t) return this.basSelection(x, y, ev, ["meuble"]);
        return this.auLever(ev, () => this.poserMeuble(x, y));
      }
      case "pion": {
        if (this.optPion) return this.auLever(ev, () => this.poserPions(x, y));
        return this.basSelection(x, y, ev, ["pion"]);
      }
      case "image": return clicImage(this, x, y, ev);
      case "brouillard": {
        if (this.optBrume.mode === "piece") return this.auLever(ev, () => this.basculerPiece(cx, cy));
        const valeur = ev.altKey ? 0 : this.optBrume.valeur ?? 1;
        return this.auTrait(ev, () => {
          this.instantane();
          this.glisse = { type: "brume", valeur, debut: this.plan.modifie };
          this.brumer(x, y);
        });
      }
      case "brume": {
        const valeur = ev.altKey ? 0 : this.optNappe.valeur;
        return this.auTrait(ev, () => {
          this.instantane();
          this.glisse = { type: "nappe", valeur, debut: this.plan.modifie };
          this.poserNappe(x, y);
        });
      }
      case "feu": {
        const valeur = ev.altKey ? 0 : this.optFeu.valeur;
        return this.auTrait(ev, () => {
          this.instantane();
          this.glisse = { type: "feu", valeur, debut: this.plan.modifie };
          this.poserFeu(x, y);
        });
      }
      case "texte": {
        const t = this.toucher(x, y, ["texte"]);
        if (t) return this.basSelection(x, y, ev, ["texte"]);
        return this.auLever(ev, () => this.creerTexte(x, y));
      }
      case "sang": {
        const effacer = ev.altKey;
        return this.auTrait(ev, () => {
          this.instantane();
          this.glisse = { type: "sang", effacer, debut: this.plan.modifie, depart: [x, y], dernier: [x, y], premier: true, fin: null };
          this.poserSang(x, y);
        });
      }
      case "lumiere": {
        if (this.toucher(x, y, ["lumiere"])) return this.basSelection(x, y, ev, ["lumiere"]);
        return this.auLever(ev, () => this.ajouterLumiere(x, y));
      }
      case "mesure":
        this.mesure = { x0: x, y0: y, x1: x, y1: y, actif: true };
        return this.vue.demander();
      case "pointeur": return this.basPointeur(ev, x, y);
    }
  }

  // Pointeur : à la souris ou au stylet, un clic fait une onde sur la TV. Au doigt, un toucher bref la fait au lever ;
  // un doigt qui glisse, ou reste posé un instant, pointe. Rien ne change dans le plan.
  basPointeur(ev, x, y) {
    if (!this.doigt) return this.pointeur.onde(x, y);
    const id = ev.pointerId;
    this.attente = new Attente(ev, () => this.pointeur.onde(x, y), ([px, py]) => {
      this.doigtPointe = id;
      this.pointeur.bouger(...this.vue.versCarte(px, py));
    }, DELAI);
  }

  // Au doigt, une action ponctuelle (révéler une pièce, poser des pions, une porte, un meuble, un texte) part au lever
  // du doigt, s'il n'a pas glissé et qu'aucun deuxième doigt n'est venu entre-temps ; s'il glisse, la vue le suit.
  auLever(ev, action) {
    if (!this.doigt) return action();
    this.attente = new Attente(ev, action, ([px, py]) => {
      this.glisse = { type: "camera", px, py };
    });
  }

  // Un trait au pinceau : au doigt, il ne commence qu'après un court délai ou un petit glissé ; un simple toucher
  // donne une touche de pinceau au lever.
  auTrait(ev, commencer) {
    if (!this.doigt) return commencer();
    this.attente = new Attente(ev, commencer, commencer, DELAI);
  }

  // Un deuxième doigt (ou Échap) interrompt le geste en cours. defaire : ce qu'il avait changé est défait, sans rien
  // enregistrer ni envoyer à la TV (au doigt, un pincement ne révèle ni ne pose rien ; un objet glissé, au stylet aussi) ;
  // sinon il finit comme au lâcher (trait ou cadre à la souris ou au stylet).
  interrompre(defaire) {
    this.attente?.annuler();
    this.attente = null;
    // Deux doigts déplacent ou zooment la vue : ils ne pointent pas.
    if (this.doigtPointe !== null) {
      this.doigtPointe = null;
      this.pointeur?.effacer();
    }
    const g = this.glisse;
    this.glisse = null;
    if (!g) return;
    if (!defaire) return this.lacher(g);
    if (g.type === "cadre") this.cadre = null;
    if (g.type === "peinture" || g.type === "brume" || g.type === "nappe" || g.type === "feu" || g.type === "sang" || (g.type === "objet" && g.bouge)) this.oublierGeste(g.debut);
    // Un rectangle de sélection abandonné : les anneaux reviennent à ce qui était choisi.
    if (g.type === "lasso") this.vue.selection = anneauxDe(this.selection);
    this.vue.demander();
  }

  // Le plan revient à l'instantané pris au début du geste, et ce pas d'annulation disparaît. Si un enregistrement est
  // parti pendant le geste (une retouche d'avant qui attendait), le plan défait repart à son tour.
  oublierGeste(debut) {
    const etat = this.passe.pop();
    if (!etat) return;
    const avant = JSON.parse(etat);
    // Pendant l'aperçu d'un habillage, l'instantané garde celui d'avant : l'aperçu montré reste en place.
    if (this.apercu) delete avant.habillage;
    Object.assign(this.plan, avant);
    this.vue.charger(this.plan);
    this.afficherPanneau();
    this.majBarre();
    if (this.enVol || this.plan.modifie !== debut) this.modifie();
  }

  mesurePincement() {
    const [a, b] = [...this.pointeurs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  pointeurBouge(ev) {
    if (this.pointeurs.has(ev.pointerId)) this.pointeurs.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    const [x, y] = this.position(ev);
    this.curseur = [x, y];
    this.majInfos();
    if (ev.pointerType === "mouse") this.survolerPion(x, y);
    if (this.geste?.type === "pincer" && this.pointeurs.size === 2) {
      const m = this.mesurePincement();
      this.vue.deplacer(m.cx - this.geste.cx, m.cy - this.geste.cy);
      this.vue.zoomer(m.d / this.geste.d, m.cx, m.cy);
      this.geste = { type: "pincer", ...m };
      return;
    }
    // Le curseur de l'outil vit sur son propre calque : bouger la souris ne redessine pas le plan.
    this.majCurseur();
    // Un doigt posé qui n'a pas encore assez glissé ne fait rien d'autre (pas de trait, pas de déplacement).
    if (this.attente?.bouge(ev)) return;
    const g = this.glisse;
    // Le point de la TV suit la souris, le stylet, ou le doigt qui pointe (pas celui d'un pincement fini).
    if (this.outil === "pointeur" && g?.type !== "camera" && (!auDoigt(ev) || this.doigtPointe === ev.pointerId)) this.pointeur.bouger(x, y);
    // La mesure suit le pointeur tant que le bouton est enfoncé (elle ne passe pas par un glissé).
    if (this.mesure?.actif && !g) {
      this.mesure.x1 = x;
      this.mesure.y1 = y;
      this.envoyerRegle();
      return this.vue.demander();
    }
    if (!g) return;
    if (g.type === "camera") {
      this.vue.deplacer(ev.offsetX - g.px, ev.offsetY - g.py);
      g.px = ev.offsetX;
      g.py = ev.offsetY;
      return;
    }
    if (g.type === "cadre") {
      this.cadre.x1 = Math.floor(x);
      this.cadre.y1 = Math.floor(y);
      return this.vue.demander();
    }
    if (g.type === "peinture") return this.peindre(x, y);
    if (g.type === "brume") return this.brumer(x, y);
    if (g.type === "nappe") return this.poserNappe(x, y);
    if (g.type === "feu") return this.poserFeu(x, y);
    if (g.type === "sang") return this.poserSang(x, y);
    if (g.type === "lasso") {
      // Le rectangle ne part qu'après un vrai glissé : un clic sur le plan ne change rien à la sélection.
      if (!g.bouge && !aGlisse(g.ecran, ev)) return;
      g.bouge = true;
      g.x1 = x;
      g.y1 = y;
      this.vue.selection = anneauxDe(this.pionsDuRectangle(g));
      return this.vue.demander();
    }
    if (g.type === "objet") {
      // Au doigt, un objet ne part qu'après un vrai glissé : le premier doigt d'un pincement ne le déplace pas.
      if (g.ecran && !g.bouge && !aGlisse(g.ecran, ev)) return;
      return this.glisserObjet(x, y);
    }
  }

  pointeurHaut(ev) {
    this.pointeurs.delete(ev.pointerId);
    if (this.pointeurs.size < 2) this.geste = null;
    // Le doigt levé laisse le point à la TV, qui l'estompe de lui-même.
    if (this.doigtPointe === ev.pointerId) this.doigtPointe = null;
    // Un doigt levé sans avoir glissé : son action part maintenant (un trait au pinceau commence, fini juste après).
    if (this.attente?.id === ev.pointerId) {
      const a = this.attente;
      this.attente = null;
      a.leve(ev);
    }
    if (this.mesure?.actif) {
      this.mesure.actif = false;
      this.vue.demander();
    }
    // Au doigt, un geste repris par le navigateur est défait, comme au deuxième doigt.
    if (ev.type === "pointercancel" && this.doigt) return this.interrompre(true);
    const g = this.glisse;
    this.glisse = null;
    if (g) this.lacher(g);
  }

  lacher(g) {
    if (g.type === "cadre") this.finCadre();
    if (g.type === "peinture") this.finPeinture(g);
    if (g.type === "brume") this.finBrume();
    if (g.type === "nappe") this.finNappe();
    if (g.type === "feu") this.finFeu();
    if (g.type === "sang") this.finSang(g);
    if (g.type === "objet") this.finGlisse(g);
    if (g.type === "lasso") this.finRectangle(g);
  }

  // ---------------------------------------------------------------- sélection

  // À la souris, le pion survolé garde son prénom même serré contre d'autres (placerNomsMJ) ; x nul : la souris est sortie.
  survolerPion(x, y) {
    const id = x === null ? null : this.toucher(x, y, ["pion"])?.id || null;
    if (!this.vue || id === this.vue.survol) return;
    this.vue.survol = id;
    this.vue.demander();
  }

  // Ce qui est sous le pointeur, dans l'ordre : pions, textes, habillage, meubles, portes, pièce.
  toucher(x, y, genres = ["pion", "texte", "habillage", "meuble", "porte", "piece"]) {
    const p = this.plan;
    if (genres.includes("pion")) {
      // Tels qu'ils sont dessinés, celui du dessus d'abord : un cavalier sur sa monture se prend avant elle, une figurine
      // par sa tête comme par son socle (figurine.js).
      const pions = ordreDesFigurines(poserCavaliers(p.pions));
      for (let i = pions.length - 1; i >= 0; i--) {
        const t = pions[i];
        if (dansFigurine(t, x, y)) return { genre: "pion", id: t.id };
      }
    }
    if (genres.includes("texte")) {
      for (const t of p.textes) {
        const l = (t.taille || 0.6) * 0.62 * t.texte.length;
        if (Math.abs(x - t.x) <= l / 2 + 0.2 && Math.abs(y - t.y) <= (t.taille || 0.6) * 0.7) return { genre: "texte", id: t.id };
      }
    }
    // L'outil Lumières ne prend que les lumières, dans n'importe quel style (seul le style Peint les dessine).
    if (genres.includes("lumiere") && !this.vue.joueurs) {
      for (const l of lum.lumieresDe(p)) {
        if (l.id && Math.hypot(l.x - x, l.y - y) <= 12 / this.vue.cam.z) return { genre: "hab-lumiere", id: l.id };
      }
    }
    if (genres.includes("habillage") && this.habillageModifiable()) {
      const h = p.habillage;
      const vu = (o) => !(this.vue.joueurs && o.cache);
      const objets = Array.isArray(h.objets) ? h.objets : [];
      for (let i = objets.length - 1; i >= 0; i--) {
        const o = objets[i];
        if (!o.id || o.cle === "ornieres" || !vu(o)) continue;
        const [ox, oy] = this.positionHab(o, "hab-objet");
        if (Math.hypot(ox - x, oy - y) <= (PRISES[o.cle] || 0.22)) return { genre: "hab-objet", id: o.id };
      }
      if (!this.vue.joueurs) {
        for (const l of Array.isArray(h.lumieres) ? h.lumieres : []) {
          if (l.id && Math.hypot(l.x - x, l.y - y) <= 12 / this.vue.cam.z) return { genre: "hab-lumiere", id: l.id };
        }
      }
    }
    if (genres.includes("meuble")) {
      // Dans l'ordre inverse du dessin : un lit posé sur un tapis se prend avant le tapis.
      for (const tapis of [false, true]) {
        for (let i = p.objets.length - 1; i >= 0; i--) {
          const o = p.objets[i];
          if ((o.cle === "tapis") !== tapis) continue;
          const b = emprise(o);
          if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { genre: "meuble", id: o.id };
        }
      }
    }
    if (genres.includes("porte")) {
      const a = areteProche(x, y, 0.22);
      const d = a && p.portes.find((q) => q.sens === a.sens && q.x === a.x && q.y === a.y);
      if (d) return { genre: "porte", id: d.id };
    }
    if (genres.includes("piece")) {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (dedans(p, cx, cy) && p.sol[idx(p, cx, cy)]) {
        const id = p.piece[idx(p, cx, cy)];
        if (id) return { genre: "piece", id };
      }
    }
    return null;
  }

  selectionner(sel) {
    if (!idsDe(sel).includes(this.entree?.pion)) this.entree = null;
    this.selection = sel;
    this.vue.selection = anneauxDe(sel);
    this.afficherPanneau();
    this.vue.demander();
  }

  element(sel = this.selection) {
    if (!sel) return null;
    const liste = { pion: "pions", texte: "textes", meuble: "objets", porte: "portes" }[sel.genre];
    if (liste) return this.plan[liste].find((x) => x.id === sel.id) || null;
    if (sel.genre === "piece") return lirePiece(this.plan, sel.id);
    const hab = { "hab-objet": "objets", "hab-lumiere": "lumieres" }[sel.genre];
    if (hab) {
      const l = this.plan.habillage?.[hab];
      return (Array.isArray(l) && l.find((x) => x.id === sel.id)) || null;
    }
    return null;
  }

  // L'habillage se retouche dans le style qui le dessine, une fois gardé (pas pendant l'aperçu d'une proposition).
  habillageModifiable() {
    const h = this.plan.habillage;
    return !!h && typeof h === "object" && !this.apercu && this.vue.style === "peint";
  }

  positionHab(o, genre) {
    if (genre === "hab-lumiere") return [o.x, o.y];
    const d = Array.isArray(o.decalage) ? o.decalage : [0.5, 0.5];
    return [o.case[0] + d[0], o.case[1] + d[1]];
  }

  basSelection(x, y, ev, genres) {
    const t = this.toucher(x, y, genres);
    const p = this.plan;
    // Plusieurs pions à la fois, dans les deux outils qui les déplacent : Maj, Ctrl ou Cmd à la souris, « Sélection
    // multiple » au doigt.
    const plusieurs = OUTILS_QUI_ENTRENT.includes(this.outil) && (this.multiple || ev.shiftKey || ev.ctrlKey || ev.metaKey);
    const ids = idsDe(this.selection);
    if (plusieurs && t?.genre !== "pion") {
      // Ailleurs que sur un pion : un rectangle, qui ajoute les pions qu'il couvre à ceux déjà choisis.
      this.glisse = { type: "lasso", x0: x, y0: y, x1: x, y1: y, deja: ids, bouge: false, ecran: [ev.offsetX, ev.offsetY] };
      return;
    }
    if (!t) {
      if (this.selection) this.selectionner(null);
      this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };
      return;
    }
    // Un pion parmi plusieurs. Déjà choisi : glissé, il emmène les autres ; lâché sans avoir bougé, Maj + clic le retire
    // et un clic simple ne garde que lui. Pas encore choisi, avec Maj : il rejoint les autres.
    const groupe = t.genre === "pion" && OUTILS_QUI_ENTRENT.includes(this.outil) && (plusieurs || (ids.length > 1 && ids.includes(t.id)));
    let auLacher = null;
    if (!groupe) this.selectionner(t);
    else if (ids.includes(t.id)) auLacher = plusieurs ? "retirer" : "seul";
    else this.selectionner(selectionDe(p.pions, [...ids, t.id]));
    if (["pion", "meuble", "texte", "hab-objet", "hab-lumiere"].includes(t.genre)) {
      const o = this.element(t);
      const [ox, oy] = t.genre.startsWith("hab-") ? this.positionHab(o, t.genre) : [o.x, o.y];
      // Au doigt, ou avec Maj : rien ne bouge avant un vrai glissé (un Maj + clic qui tremble ne déplace pas le groupe).
      this.glisse = { type: "objet", sel: t, dx: x - ox, dy: y - oy, bouge: false, depart: [ox, oy], debut: this.plan.modifie,
        ecran: auDoigt(ev) || plusieurs ? [ev.offsetX, ev.offsetY] : null, auLacher };
      if (t.genre === "pion") {
        // Maj + glisser un héros visible, sans autre pion choisi : tous les héros visibles viennent, choisis au départ du
        // glissé (glisserObjet). Le geste d'avant, dans les deux outils.
        this.glisse.tous = ev.shiftKey && herosVisible(o) && ids.every((id) => id === t.id);
        // Ceux qui suivent : les autres pions choisis, et la monture ou les cavaliers de chacun.
        this.glisse.groupe = suiveurs(p.pions, groupe ? idsDe(this.selection) : [], o);
      }
    }
  }

  // Les pions pris par le rectangle en cours, avec ceux qui étaient déjà choisis.
  pionsDuRectangle(g) {
    return selectionDe(this.plan.pions, [...g.deja, ...dansRectangle(this.plan.pions, g)]);
  }

  finRectangle(g) {
    if (!g.bouge) return;
    this.selectionner(this.pionsDuRectangle(g));
    const n = idsDe(this.selection).length;
    if (!n) toast("Aucun pion dans ce rectangle.");
  }

  // « Sélection multiple », pour l'iPad et le téléphone : le bouton de la barre d'outils et celui du panneau des pions.
  basculerMultiple() {
    const oui = !this.multiple;
    if (oui && !OUTILS_QUI_ENTRENT.includes(this.outil)) this.choisirOutil("main");
    this.multiple = oui;
    if (oui) this.optPion = null;
    this.dom.querySelector("[data-multi]").setAttribute("aria-pressed", oui);
    this.afficherPanneau();
    if (oui) toast("Sélection multiple : touchez les pions à réunir, ou glissez sur le plan pour tracer un rectangle. Glisser l'un d'eux les emmène tous.");
  }

  // « Tous les héros » : les héros que voient les joueurs, choisis ensemble.
  choisirLesHeros() {
    const heros = this.plan.pions.filter(herosVisible).map((t) => t.id);
    if (!heros.length) return toast("Aucun héros visible sur ce plan.");
    if (!OUTILS_QUI_ENTRENT.includes(this.outil)) this.choisirOutil("main");
    this.selectionner(selectionDe(this.plan.pions, heros));
  }

  // Les pions emmenés par celui qu'on glisse, avec leur écart à lui.
  groupe(g) {
    return (g.groupe || []).map((m) => ({ ...m, t: this.plan.pions.find((h) => h.id === m.id) })).filter((m) => m.t);
  }

  // Un objet ou une lumière d'habillage suit le pointeur ; la lumière ne se recalcule qu'au lâcher (le marqueur bouge).
  glisserHab(o, genre, x, y) {
    const p = this.plan;
    x = Math.max(0.02, Math.min(p.largeur - 0.02, x));
    y = Math.max(0.02, Math.min(p.hauteur - 0.02, y));
    const [ax, ay] = this.positionHab(o, genre);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const piece = p.sol[idx(p, cx, cy)] ? p.piece[idx(p, cx, cy)] : 0;
    if (piece) o.piece = piece;
    if (genre === "hab-lumiere") {
      o.x = deux(x);
      o.y = deux(y);
      return this.vue.demander();
    }
    o.case = [cx, cy];
    o.decalage = [deux(x - cx), deux(y - cy)];
    this.vue.rafraichirZone({ x0: Math.min(ax, x) - 1.2, y0: Math.min(ay, y) - 1.2, x1: Math.max(ax, x) + 1.2, y1: Math.max(ay, y) + 1.2 });
  }

  glisserObjet(x, y) {
    const g = this.glisse;
    const o = this.element(g.sel);
    if (!o) return;
    if (!g.bouge) {
      this.instantane();
      g.bouge = true;
      if (g.tous) {
        const heros = [o.id, ...this.plan.pions.filter((h) => h !== o && herosVisible(h)).map((h) => h.id)];
        this.selectionner(selectionDe(this.plan.pions, heros));
        g.groupe = suiveurs(this.plan.pions, heros, o);
      }
    }
    if (g.sel.genre.startsWith("hab-")) return this.glisserHab(o, g.sel.genre, x - g.dx, y - g.dy);
    if (g.sel.genre === "meuble") {
      const avant = emprise(o);
      o.x = Math.round(x - g.dx);
      o.y = Math.round(y - g.dy);
      this.bornerMeuble(o);
      const apres = emprise(o);
      if (avant.x0 !== apres.x0 || avant.y0 !== apres.y0) {
        this.vue.rafraichirZone({ x0: Math.min(avant.x0, apres.x0) - 1, y0: Math.min(avant.y0, apres.y0) - 1, x1: Math.max(avant.x1, apres.x1) + 1, y1: Math.max(avant.y1, apres.y1) + 1 });
      }
    } else {
      const [ax, ay] = [o.x, o.y];
      o.x = x - g.dx;
      o.y = y - g.dy;
      if (g.sel.genre === "pion") {
        // Le groupe s'arrête en bloc au bord du plan : la formation ne se tasse pas.
        const suite = this.groupe(g);
        [o.x, o.y] = placeDuGroupe(o, suite, o.x, o.y, this.plan.largeur, this.plan.hauteur);
        for (const m of suite) {
          m.t.x = o.x + m.dx;
          m.t.y = o.y + m.dy;
        }
      } else this.bornerTexte(o);
      if (g.sel.genre === "texte") this.vue.rafraichirZone({ x0: Math.min(ax, o.x) - 6, y0: Math.min(ay, o.y) - 2, x1: Math.max(ax, o.x) + 6, y1: Math.max(ay, o.y) + 2 });
      this.vue.demander();
    }
  }

  finGlisse(g) {
    if (!g.bouge) {
      // Un pion déjà choisi parmi d'autres, lâché sans avoir bougé : Maj + clic le retire, un clic simple ne garde que lui.
      if (g.auLacher === "retirer") this.selectionner(selectionDe(this.plan.pions, basculer(idsDe(this.selection), g.sel.id)));
      else if (g.auLacher === "seul") this.selectionner(g.sel);
      return;
    }
    const o = this.element(g.sel);
    if (g.sel.genre === "pion" && o) {
      const poses = [[o, g.depart], ...this.groupe(g).map((m) => [m.t, m.depart])];
      for (const [t] of poses) this.calerPion(t);
      // Seuls les pions qui ont changé de case entrent : un clic qui tremble ne révèle rien.
      const entres = poses.filter(([t, depart]) => changeDeCase(t, depart)).map(([t]) => t);
      if (entres.length) this.entrerDans(entres, o);
      this.vue.demander();
      return this.modifie(true);
    }
    if (g.sel.genre === "texte" || g.sel.genre === "hab-lumiere") this.vue.rafraichirTout();
    this.modifie();
  }

  // Rien ne se pose à cheval sur le bord : un redimensionnement ne ferait plus rien disparaître.
  bornerMeuble(o) {
    const b = emprise(o);
    o.x = Math.max(0, Math.min(o.x, this.plan.largeur - b.l));
    o.y = Math.max(0, Math.min(o.y, this.plan.hauteur - b.h));
  }

  // Un pion se pose au centre d'une case (au coin commun pour les grandes créatures).
  calerPion(o) {
    const t = o.taille || 1;
    o.x = t % 2 ? Math.floor(o.x) + 0.5 : Math.round(o.x);
    o.y = t % 2 ? Math.floor(o.y) + 0.5 : Math.round(o.y);
    this.bornerPion(o);
  }

  bornerPion(t) {
    const r = (t.taille || 1) / 2;
    t.x = Math.max(r, Math.min(t.x, this.plan.largeur - r));
    t.y = Math.max(r, Math.min(t.y, this.plan.hauteur - r));
  }

  bornerTexte(t) {
    t.x = Math.max(0, Math.min(t.x, this.plan.largeur));
    t.y = Math.max(0, Math.min(t.y, this.plan.hauteur));
  }

  // ---------------------------------------------------------------- pièces et sols

  finCadre() {
    const c = this.cadre;
    this.cadre = null;
    if (!c) return;
    const p = this.plan;
    const x0 = Math.max(0, Math.min(c.x0, c.x1));
    const y0 = Math.max(0, Math.min(c.y0, c.y1));
    const x1 = Math.min(p.largeur - 1, Math.max(c.x0, c.x1));
    const y1 = Math.min(p.hauteur - 1, Math.max(c.y0, c.y1));
    // Un simple clic ne trace rien : il choisit la pièce sous le pointeur.
    if (c.x0 === c.x1 && c.y0 === c.y1 && !c.effacer) {
      const t = this.toucher(c.x0 + 0.5, c.y0 + 0.5, ["piece"]);
      return this.selectionner(t);
    }
    if (x1 < x0 || y1 < y0) return;
    this.instantane();
    let id = 0;
    if (c.effacer) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        p.sol[idx(p, x, y)] = 0;
        p.piece[idx(p, x, y)] = 0;
      }
      this.oublierPiecesVides();
    } else {
      const sousDepart = dedans(p, c.x0, c.y0) && p.sol[idx(p, c.x0, c.y0)] ? p.piece[idx(p, c.x0, c.y0)] : 0;
      if (c.etendre && sousDepart) id = sousDepart;
      else {
        id = Math.max(0, ...p.pieces.map((q) => q.id)) + 1;
        const nom = { salle: "Pièce", grotte: "Galerie", exterieur: "Dehors" }[this.optPiece.genre] || "Pièce";
        p.pieces.push({ id, nom: `${nom} ${p.pieces.length + 1}`, genre: this.optPiece.genre, notes: "", nom_visible: false });
      }
      const sol = c.etendre && sousDepart ? p.sol[idx(p, c.x0, c.y0)] : this.optPiece.sol;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        p.sol[idx(p, x, y)] = sol;
        p.piece[idx(p, x, y)] = id;
      }
      this.oublierPiecesVides();
    }
    this.structure({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
    if (id) this.selectionner({ genre: "piece", id });
    else this.afficherPanneau();
    this.modifie();
  }

  oublierPiecesVides() {
    const p = this.plan;
    const utilisees = new Set();
    for (let i = 0; i < p.sol.length; i++) if (p.sol[i]) utilisees.add(p.piece[i]);
    p.pieces = p.pieces.filter((q) => utilisees.has(q.id));
  }

  casesPinceau(x, y, rayon) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const r = rayon - 1;
    const res = [];
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) if (dedans(this.plan, i, j)) res.push([i, j]);
    return res;
  }

  peindre(x, y) {
    const p = this.plan;
    const g = this.glisse;
    const s = this.optSol.sol;
    for (const [i, j] of this.casesPinceau(x, y, this.optSol.rayon)) {
      const k = idx(p, i, j);
      if (s === 0) {
        p.sol[k] = 0;
        p.piece[k] = 0;
      } else if (p.sol[k]) p.sol[k] = s;
      else {
        // Une case neuve rejoint la pièce sélectionnée, sinon une pièce voisine, sinon une nouvelle zone.
        let id = this.selection?.genre === "piece" ? this.selection.id : 0;
        if (!id) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (dedans(p, i + dx, j + dy) && p.sol[idx(p, i + dx, j + dy)]) {
              id = p.piece[idx(p, i + dx, j + dy)];
              break;
            }
          }
        }
        if (!id) {
          if (!g.nouvelle) {
            g.nouvelle = Math.max(0, ...p.pieces.map((q) => q.id)) + 1;
            p.pieces.push({ id: g.nouvelle, nom: `Zone ${p.pieces.length + 1}`, genre: s === 6 ? "grotte" : s === 5 || s === 4 ? "exterieur" : "salle", notes: "", nom_visible: false });
          }
          id = g.nouvelle;
        }
        p.sol[k] = s;
        p.piece[k] = id;
      }
      g.zone = g.zone ? { x0: Math.min(g.zone.x0, i), y0: Math.min(g.zone.y0, j), x1: Math.max(g.zone.x1, i + 1), y1: Math.max(g.zone.y1, j + 1) } : { x0: i, y0: j, x1: i + 1, y1: j + 1 };
    }
    const r = this.optSol.rayon;
    this.vue.murs = calculerMurs(p);
    // Zoomé, seules les tuiles fines se repeignent pendant le trait ; en vue d'ensemble, c'est le fond qu'on voit.
    this.vue.rafraichirZone({ x0: Math.floor(x) - r - 1, y0: Math.floor(y) - r - 1, x1: Math.floor(x) + r + 2, y1: Math.floor(y) + r + 2 }, { tuilesSeules: this.vue.niveau() > 0 });
  }

  finPeinture(g) {
    this.oublierPiecesVides();
    this.structure(g.zone);
    this.afficherPanneau();
    this.modifie();
  }

  // ---------------------------------------------------------------- portes

  clicPorte(x, y) {
    const p = this.plan;
    const a = areteProche(x, y, 0.35);
    if (!a) return toast("Cliquez tout près d'un mur.");
    const deja = p.portes.find((d) => d.sens === a.sens && d.x === a.x && d.y === a.y);
    if (deja) return this.selectionner({ genre: "porte", id: deja.id });
    const [[ax, ay], [bx, by]] = casesArete(a.sens, a.x, a.y);
    const pieceA = (i, j) => (dedans(p, i, j) && p.sol[idx(p, i, j)] ? p.piece[idx(p, i, j)] : 0);
    if (pieceA(ax, ay) === pieceA(bx, by)) return toast("Il n'y a pas de mur ici.");
    this.instantane();
    const d = { id: nouvelId(), sens: a.sens, x: a.x, y: a.y, genre: this.optPorte.genre, etat: this.optPorte.etat, note: "" };
    if (d.genre === "secrete") d.decouverte = false;
    p.portes.push(d);
    this.vue.rafraichirZone({ x0: a.x - 2, y0: a.y - 2, x1: a.x + 2, y1: a.y + 2 });
    this.selectionner({ genre: "porte", id: d.id });
    this.modifie();
  }

  // ---------------------------------------------------------------- meubles, pions, textes

  // La place du meuble choisi sous le pointeur, entière dans le plan : celle que l'aperçu montre.
  placeMeuble(x, y) {
    const m = MEUBLES[this.optMeuble.cle];
    if (!m) return null;
    const tourne = this.optMeuble.rot % 180 !== 0;
    const l = tourne ? m.h : m.l;
    const h = tourne ? m.l : m.h;
    return {
      x: Math.max(0, Math.min(Math.round(x - l / 2), this.plan.largeur - l)),
      y: Math.max(0, Math.min(Math.round(y - h / 2), this.plan.hauteur - h)),
      l, h,
    };
  }

  poserMeuble(x, y) {
    const m = MEUBLES[this.optMeuble.cle];
    const place = this.placeMeuble(x, y);
    if (!m || !place) return;
    const rot = this.optMeuble.rot;
    this.instantane();
    const o = { id: nouvelId(), cle: m.cle, x: place.x, y: place.y, l: m.l, h: m.h, rot, cache: !!m.cache, note: "" };
    this.plan.objets.push(o);
    this.palette.noter(m.cle);
    const b = emprise(o);
    this.vue.rafraichirZone({ x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 });
    this.selectionner({ genre: "meuble", id: o.id });
    this.modifie();
  }

  tourner(sens = 1) {
    const o = this.selection?.genre === "meuble" ? this.element() : null;
    if (o) {
      this.instantane();
      const avant = emprise(o);
      o.rot = ((o.rot || 0) + 90 * sens + 360) % 360;
      this.bornerMeuble(o);
      const apres = emprise(o);
      this.vue.rafraichirZone({ x0: Math.min(avant.x0, apres.x0) - 1, y0: Math.min(avant.y0, apres.y0) - 1, x1: Math.max(avant.x1, apres.x1) + 1, y1: Math.max(avant.y1, apres.y1) + 1 });
      this.modifie();
      return this.afficherPanneau();
    }
    this.optMeuble.rot = (this.optMeuble.rot + 90 * sens + 360) % 360;
    this.afficherPanneau();
  }

  // Les pions à poser : un seul, ou un groupe qui se range autour du clic.
  modelesPions(choix) {
    const [genre, ref, n] = choix;
    if (genre === "aventurier") {
      const liste = ref === "*" ? this.aventuriers : this.aventuriers.filter((a) => a.id === ref);
      return liste.map((a) => ({ genre: "heros", ref: `aventurier:${a.id}`, nom: a.nom || "Aventurier", couleur: a.couleur || COULEURS_PIONS.heros, image: a.illustration || "" }));
    }
    // Le familier d'un aventurier (19/11) : un pion à part, à la couleur de son héros et à son image ; son joueur le bouge
    // depuis la table du coin comme son héros (ref « familier:<aventurier> »).
    if (genre === "familier") {
      const [aid, rang] = String(ref).split(":");
      const a = this.aventuriers.find((x) => x.id === aid);
      const f = a && (a.familiers || [])[Number(rang)];
      if (!f) return [];
      return [{ genre: "autre", ref: `familier:${a.id}`, nom: (f.nom || "").trim() || "Familier", couleur: a.couleur || COULEURS_PIONS.heros,
        ...(/^\/media\/[A-Za-z0-9._-]+$/.test(f.image || "") ? { image_libre: f.image } : {}) }];
    }
    if (genre === "pnj") {
      const q = this.pnj.find((x) => x.id === ref);
      return q ? [{ genre: "pnj", ref: `pnj:${q.id}`, nom: q.nom, image: q.illustration || "", cache: !q.connu }] : [];
    }
    if (genre === "ennemi") {
      const b = [...RANGS, ...CREATURES, ...GENS].find((x) => x.cle === ref);
      if (!b) return [];
      // Les numéros libres de la même sorte : un gobelin retiré laisse son numéro au prochain posé.
      const pris = [];
      return Array.from({ length: n || 1 }, () => {
        const court = numeroLibre(this.plan.pions, { ref: `bestiaire:${ref}` }, pris);
        pris.push(court);
        return { genre: "ennemi", ref: `bestiaire:${ref}`, nom: b.nom, court: String(court), taille: b.rang === "boss" || b.rang === "dragon" ? 2 : 1 };
      });
    }
    if (genre === "rencontre") {
      const r = this.rencontres.find((x) => x.id === ref);
      if (!r) return [];
      const res = [];
      for (const a of r.adversaires || []) {
        for (let k = 0; k < (a.n || 0); k++) res.push({ genre: "ennemi", ref: `bestiaire:${a.cle}`, nom: a.nom, court: String(res.length + 1), taille: a.rang === "boss" || a.rang === "dragon" ? 2 : 1 });
      }
      return res;
    }
    if (genre === "libre") return [{ genre: "autre", ref: "", nom: ref || "Pion" }];
    return [];
  }

  poserPions(x, y) {
    const p = this.plan;
    const modeles = this.modelesPions(this.optPion);
    if (!modeles.length) return toast("Rien à poser.");
    this.instantane();
    const occupees = new Set(p.pions.map((t) => `${Math.floor(t.x)}:${Math.floor(t.y)}`));
    // Les cases libres en spirale autour du clic, sur le sol.
    const places = [];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let r = 0; r < 12 && places.length < modeles.length; r++) {
      for (let j = cy - r; j <= cy + r; j++) {
        for (let i = cx - r; i <= cx + r; i++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          if (!dedans(p, i, j) || (!p.sol[idx(p, i, j)] && !p.fond) || occupees.has(`${i}:${j}`)) continue;
          places.push([i, j]);
          occupees.add(`${i}:${j}`);
        }
      }
    }
    modeles.forEach((m, k) => {
      const [i, j] = places[k] || [cx, cy];
      const t = m.taille || 1;
      const pion = { id: nouvelId(), cache: false, tombe: false, taille: 1, couleur: "", image: "", court: "", ...m, x: t % 2 ? i + 0.5 : i + 1, y: t % 2 ? j + 0.5 : j + 1 };
      this.bornerPion(pion);
      p.pions.push(pion);
    });
    this.vue.chargerImagesPions();
    this.vue.demander();
    this.optPion = null;
    this.afficherPanneau();
    this.modifie(true);
    toast(modeles.length > 1 ? `${modeles.length} pions posés.` : "Pion posé.");
  }

  creerTexte(x, y) {
    this.instantane();
    const t = { id: nouvelId(), texte: "Texte", x, y, taille: 0.6, mj: false };
    this.bornerTexte(t);
    this.plan.textes.push(t);
    this.vue.rafraichirZone({ x0: t.x - 4, y0: t.y - 2, x1: t.x + 4, y1: t.y + 2 });
    this.selectionner({ genre: "texte", id: t.id });
    donnerLaMain(this.panneau.querySelector('[data-el="texte"]'), this.canvas);
    this.modifie();
  }

  // ---------------------------------------------------------------- brouillard

  basculerPiece(cx, cy) {
    const p = this.plan;
    if (!dedans(p, cx, cy) || !p.sol[idx(p, cx, cy)]) return;
    const id = p.piece[idx(p, cx, cy)];
    const cases = [];
    for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.piece[i] === id) cases.push(i);
    const reveler = cases.some((i) => p.brouillard[i] !== 1);
    this.revelerPiece(id, reveler);
  }

  revelerPiece(id, reveler = true) {
    const p = this.plan;
    this.instantane();
    marquerPiece(p, id, reveler ? 1 : 0);
    const b = boitePiece(p, id);
    if (b) this.vue.rafraichirZone({ x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 });
    this.vue.demander();
    this.afficherPanneau();
    this.modifie(true);
    const nom = lirePiece(p, id)?.nom || "la pièce";
    toast(reveler ? `Les joueurs voient maintenant « ${nom} ».` : `Les joueurs ne voient plus « ${nom} ».`);
  }

  // Outils Pions et Sélection : un héros visible posé dans une pièce cachée la révèle, dans le même pas d'annulation que
  // son déplacement (un Ctrl+Z défait les deux). Un pion caché ne révèle rien. Si la pièce sort du cadre de la TV, le
  // prochain envoi l'élargit ; le panneau du pion rappelle ses notes du MJ.
  entrerDans(pions, choisi) {
    const avant = this.entree;
    this.entree = null;
    const p = this.plan;
    const revele = boiteRevelee(p);
    const ids = OUTILS_QUI_ENTRENT.includes(this.outil) && this.entrerRevele ? entrer(p, pions) : [];
    if (!ids.length) {
      if (avant) this.afficherPanneau();
      return;
    }
    let boite = null;
    for (const id of ids) {
      const b = boitePiece(p, id);
      if (!b) continue;
      this.vue.rafraichirZone({ x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 });
      boite = reunir(boite, b);
    }
    // Deux entrées avant l'envoi : la TV couvrira les deux pièces, à partir de son cadre d'avant la première.
    if (boite) this.elargir = { revele: this.elargir ? this.elargir.revele : revele, boite: reunir(this.elargir?.boite, boite) };
    this.entree = { pion: choisi.id, pieces: ids };
    this.afficherPanneau();
    // La ligne sous le curseur disait encore « cachée ».
    this.majInfos();
    const noms = ids.map((id) => `« ${lirePiece(p, id)?.nom || "la pièce"} »`);
    toast(`Les joueurs voient maintenant ${noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}` : noms[0]}. Ctrl+Z annule.`);
  }

  brumer(x, y) {
    const p = this.plan;
    for (const [i, j] of this.casesPinceau(x, y, this.optBrume.rayon)) p.brouillard[idx(p, i, j)] = this.glisse.valeur;
    const r = this.optBrume.rayon;
    this.vue.rafraichirZone({ x0: Math.floor(x) - r - 1, y0: Math.floor(y) - r - 1, x1: Math.floor(x) + r + 2, y1: Math.floor(y) + r + 2 }, { tuilesSeules: this.vue.niveau() > 0 });
  }

  finBrume() {
    this.vue.rafraichirTout();
    this.modifie(true);
  }

  async toutReveler(valeur) {
    if (valeur === 1 && (await this.surLaTable()) && !(await demander({ titre: "Tout révéler", texte: "La TV montre ce plan : les joueurs y verront tout, pièces cachées et trésor compris.", oui: "Tout révéler", non: "Annuler", danger: true }))) return;
    if (this.detruit) return;
    this.instantane();
    this.plan.brouillard = this.plan.brouillard.map(() => valeur);
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie(true);
  }

  // ---------------------------------------------------------------- brume

  // Le calque de la brume (plan/brume.js), posé sur le plan et sous le curseur de l'outil, dès que le plan en a.
  toileBrume() {
    const c = document.createElement("canvas");
    c.className = "brume-plan";
    c.setAttribute("aria-hidden", "true");
    this.canvas.after(c);
    return c;
  }

  // L'outil Brume ne touche qu'à plan.brume : aucune pièce n'est révélée ni cachée, et le plan ne se repeint pas (la
  // brume a son calque). Enregistré à la fin du trait, la TV suit tout de suite.
  poserNappe(x, y) {
    const p = this.plan;
    for (const [i, j] of this.casesPinceau(x, y, this.optNappe.rayon)) p.brume[idx(p, i, j)] = this.glisse.valeur;
    this.vue.majBrume();
  }

  finNappe() {
    this.majDecompteBrume();
    this.majEtapes();
    this.modifie(true);
  }

  // Brume partout : un voile sur tout le plan ; la brume épaisse déjà posée le reste.
  brumePartout() {
    const p = this.plan;
    if (p.brume.every((v) => v)) return toast("Tout le plan est déjà dans la brume.");
    this.instantane();
    p.brume = p.brume.map((v) => v || 1);
    this.vue.majBrume();
    this.majDecompteBrume();
    this.modifie(true);
    toast("Un voile de brume couvre tout le plan. Ctrl+Z annule.");
  }

  dissiperBrume() {
    const p = this.plan;
    if (!p.brume.some((v) => v)) return toast("Il n'y a pas de brume sur ce plan.");
    this.instantane();
    p.brume = p.brume.map(() => 0);
    this.vue.majBrume();
    this.majDecompteBrume();
    this.modifie(true);
    toast("La brume se dissipe : ce qu'elle cachait réapparaît sur la TV. Ctrl+Z la remet.");
  }

  // La teinte de toute la brume du plan : blanc-gris (brume) ou gris de suie (fumée d'un incendie).
  teinterBrume(teinte) {
    const p = this.plan;
    if ((p.brume_teinte === "fumee") === (teinte === "fumee")) return;
    this.instantane();
    p.brume_teinte = teinte === "fumee" ? "fumee" : "brume";
    this.vue.majBrume();
    this.afficherPanneau();
    this.modifie(true);
  }

  texteDecompteBrume() {
    const b = this.plan.brume;
    const n = b.filter((v) => v).length;
    const epaisses = b.filter((v) => v === 2).length;
    if (!n) return "Aucune brume sur ce plan.";
    return `${n} case${n > 1 ? "s" : ""} dans la brume${epaisses ? `, dont ${epaisses} dans la brume épaisse` : ""}.`;
  }

  majDecompteBrume() {
    const el = this.outil === "brume" && this.panneau?.querySelector("[data-decompte-brume]");
    if (el) el.textContent = this.texteDecompteBrume();
  }

  // ---------------------------------------------------------------- feu

  // Le calque du feu (plan/feu.js), posé sur celui de la brume s'il existe, sinon sur le plan, sous le curseur.
  toileFeu() {
    const c = document.createElement("canvas");
    c.className = "feu-plan";
    c.setAttribute("aria-hidden", "true");
    (this.dom.querySelector(".scene canvas.brume-plan") || this.canvas).after(c);
    return c;
  }

  // L'outil Feu ne touche qu'à plan.feu, et seulement sur un sol : son calque se refait à chaque touche du pinceau, la
  // lumière qu'il jette sur le plan peint à la fin du trait. Enregistré à la fin du trait, la TV suit tout de suite.
  poserFeu(x, y) {
    const p = this.plan;
    for (const [i, j] of this.casesPinceau(x, y, this.optFeu.rayon)) {
      const k = idx(p, i, j);
      if (p.sol[k]) p.feu[k] = this.glisse.valeur;
    }
    this.vue.majFeu();
  }

  // Le sang : un coup de pinceau, une tache posée, la gomme (Alt) ; la traînée se pose au lâcher, de l'appui au lâcher.
  poserSang(x, y) {
    const g = this.glisse;
    const o = this.optSang;
    const p = this.plan;
    let zone = null;
    if (g.effacer) {
      if (sg.effacer(p, x, y, o.taille)) zone = { x0: x - o.taille - 3, y0: y - o.taille - 3, x1: x + o.taille + 3, y1: y + o.taille + 3 };
    } else if (o.forme === "pinceau") {
      if (sg.peindre(p, g.dernier[0], g.dernier[1], x, y, o)) zone = { x0: Math.min(g.dernier[0], x) - o.taille - 1, y0: Math.min(g.dernier[1], y) - o.taille - 1, x1: Math.max(g.dernier[0], x) + o.taille + 1, y1: Math.max(g.dernier[1], y) + o.taille + 1 };
      g.dernier = [x, y];
    } else if (o.forme === "trainee") {
      g.fin = [x, y];
    } else if (g.premier || Math.hypot(x - g.dernier[0], y - g.dernier[1]) >= Math.max(0.3, o.taille * 0.9)) {
      const r = sg.poser(p, o.forme, x, y, x, y, o);
      if (r.erreur) {
        if (g.premier) toast(r.erreur, "erreur");
      } else zone = { x0: x - o.taille - 1, y0: y - o.taille - 1, x1: x + o.taille + 1, y1: y + o.taille + 1 };
      g.dernier = [x, y];
    }
    g.premier = false;
    if (zone) {
      g.change = true;
      this.vue.rafraichirZone(zone);
    }
  }

  finSang(g) {
    const o = this.optSang;
    if (!g.effacer && o.forme === "trainee") {
      const fin = g.fin || g.depart;
      const r = sg.poser(this.plan, "trainee", g.depart[0], g.depart[1], fin[0], fin[1], o);
      if (r.erreur) toast(r.erreur, "erreur");
      else g.change = true;
    }
    if (g.change) {
      this.vue.rafraichirTout();
      this.modifie();
    } else {
      this.passe.pop();
      this.majBarre();
    }
    this.afficherPanneau();
  }

  finFeu() {
    if (this.vue.style === "peint") this.vue.rafraichirTout();
    this.majDecompteFeu();
    this.majEtapes();
    this.modifie(true);
  }

  // Tout le feu change d'un coup (tout éteindre, tout calciner, une étape rappelée) : calque, lumière, panneau.
  feuChange() {
    this.vue.majFeu();
    if (this.vue.style === "peint") this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie(true);
  }

  eteindreFeu() {
    const p = this.plan;
    if (!p.feu.some((v) => v)) return toast("Rien ne brûle sur ce plan.");
    this.instantane();
    p.feu = p.feu.map(() => 0);
    this.feuChange();
    toast("Le feu s'éteint sans laisser de trace. Ctrl+Z le rallume.");
  }

  calcinerFeu() {
    const p = this.plan;
    if (!p.feu.some((v) => v && v !== CALCINE)) return toast("Rien ne brûle sur ce plan.");
    this.instantane();
    p.feu = p.feu.map((v) => (v ? CALCINE : 0));
    this.feuChange();
    toast("Tout ce qui brûlait est calciné : sol noirci, braises, filets de fumée. Ctrl+Z le rallume.");
  }

  texteDecompteFeu() {
    const f = this.plan.feu;
    const vifs = f.filter((v) => v >= 1 && v < CALCINE).length;
    const brasier = f.filter((v) => v === 3).length;
    const cendres = f.filter((v) => v === CALCINE).length;
    if (!vifs && !cendres) return "Rien ne brûle sur ce plan.";
    const parts = [];
    if (vifs) parts.push(`${vifs} case${vifs > 1 ? "s" : ""} en feu${brasier ? `, dont ${brasier} en brasier` : ""}`);
    if (cendres) parts.push(`${cendres} case${cendres > 1 ? "s" : ""} calcinée${cendres > 1 ? "s" : ""}`);
    return `${parts.join(" ; ")}.`;
  }

  majDecompteFeu() {
    const el = this.outil === "feu" && this.panneau?.querySelector("[data-decompte-feu]");
    if (el) el.textContent = this.texteDecompteFeu();
  }

  // ---------------------------------------------------------------- étapes

  // Une étape garde le feu et la brume du moment (plan.etapes). La rappeler les remet sur le plan ; la TV suit.
  appliquerEtape(i) {
    const p = this.plan;
    const et = p.etapes[i];
    if (!et) return;
    this.instantane();
    p.feu = et.feu.slice();
    p.brume = et.brume.slice();
    p.etape = i;
    this.vue.majBrume();
    this.majDecompteBrume();
    this.feuChange();
    toast(`${et.nom} : le feu et la brume sont en place. Ctrl+Z revient en arrière.`);
  }

  // Le feu ou la brume ont-ils changé depuis que l'étape en cours a été rappelée ou gardée ?
  etapeModifiee() {
    const p = this.plan;
    const et = Number.isInteger(p.etape) ? p.etapes[p.etape] : null;
    if (!et) return false;
    const egal = (a, b) => a.length === b.length && a.every((v, k) => (v || 0) === (b[k] || 0));
    return !egal(et.feu, p.feu) || !egal(et.brume, p.brume);
  }

  ajouterEtape() {
    const p = this.plan;
    if (p.etapes.length >= ETAPES_MAX) return toast(`${ETAPES_MAX} étapes au plus par plan.`);
    this.instantane();
    p.etapes.push({ nom: `Étape ${p.etapes.length + 1}`, feu: p.feu.slice(), brume: p.brume.slice() });
    p.etape = p.etapes.length - 1;
    this.afficherPanneau();
    this.modifie();
    toast(`Étape ${p.etape + 1} créée d'après le feu et la brume du moment.`);
  }

  garderEtape() {
    const p = this.plan;
    const et = Number.isInteger(p.etape) ? p.etapes[p.etape] : null;
    if (!et) return;
    this.instantane();
    p.etapes[p.etape] = { nom: et.nom, feu: p.feu.slice(), brume: p.brume.slice() };
    this.afficherPanneau();
    this.modifie();
    toast(`${et.nom} garde maintenant le feu et la brume du moment.`);
  }

  async retirerEtape() {
    const p = this.plan;
    const et = Number.isInteger(p.etape) ? p.etapes[p.etape] : null;
    if (!et || !(await demander({ titre: `Retirer « ${et.nom} »`, texte: "Le feu et la brume du plan restent tels qu'ils sont.", aide: "Ctrl+Z revient en arrière.", oui: "Retirer l'étape" }))) return;
    if (this.detruit || p.etapes[p.etape] !== et) return;
    this.instantane();
    p.etapes.splice(p.etape, 1);
    p.etape = null;
    this.afficherPanneau();
    this.modifie();
  }

  // Le nom d'une étape tel que la barre l'écrit : « 2 · Le brasier gagne la salle », ou « Étape 2 » si elle n'a pas
  // d'autre nom ; par défaut, celle rappelée.
  nomEtape(i = this.plan.etape) {
    const et = Number.isInteger(i) ? this.plan.etapes[i] : null;
    if (!et) return "";
    const nom = String(et.nom || "").trim();
    return !nom || /^étape\s*\d+$/i.test(nom) ? `Étape ${i + 1}` : `${i + 1} · ${nom}`;
  }

  // La barre des étapes, en bas du plan : le nom de l'étape rappelée, puis un bouton par étape, celle en cours enfoncée.
  // Les boutons restent au bout, à droite, quelle que soit la longueur du nom : le doigt les retrouve sans regarder.
  majEtapes() {
    const el = this.dom?.querySelector(".etapes-plan");
    if (!el) return;
    const p = this.plan;
    el.hidden = !p.etapes.length;
    const nom = this.nomEtape();
    el.innerHTML = p.etapes.length ? `<span class="lbl">Étapes</span><span class="nom-etape" aria-live="polite">${e(nom)}</span>${this.etapeModifiee() ? '<span class="modifiee" title="Le feu ou la brume ont changé depuis cette étape : l\'outil Feu peut la garder ainsi.">retouchée</span>' : ""}${p.etapes.map((et, k) => `<button data-etape="${k}" aria-pressed="${p.etape === k}" title="${e(et.nom)}">${k + 1}</button>`).join("")}` : "";
  }

  // La souris sur une étape : son nom s'écrit dans la barre avant qu'on la rappelle.
  apercuEtape(b) {
    const nom = this.dom?.querySelector(".etapes-plan .nom-etape");
    if (!nom) return;
    const i = b ? +b.dataset.etape : null;
    const apercu = Number.isInteger(i) && i !== this.plan.etape && !!this.plan.etapes[i];
    nom.textContent = apercu ? this.nomEtape(i) : this.nomEtape();
    nom.classList.toggle("survolee", apercu);
  }

  // ---------------------------------------------------------------- clavier

  touche(ev) {
    if (!this.detruit && rendreLaMain(ev, this.canvas)) return;
    if (this.detruit || ev.target.closest("input, textarea, select, dialog") || document.querySelector("dialog[open]")) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      return ev.shiftKey ? this.refaire() : this.annuler();
    }
    if (ctrl && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      return this.refaire();
    }
    if (ctrl) return;
    if (ev.code === "Space") {
      this.espace = true;
      ev.preventDefault();
      return;
    }
    if (ev.key === "Escape") {
      this.optPion = null;
      this.cadre = null;
      this.pointeur?.effacer();
      this.interrompre(true);
      return this.selectionner(null);
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      return this.supprimerSelection();
    }
    // Les flèches déplacent le pion choisi d'une case, ou tous les pions choisis d'un bloc : pratique en pleine partie.
    const fleches = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const choisis = idsDe(this.selection);
    if (fleches[ev.key] && choisis.length) {
      ev.preventDefault();
      // Montures et cavaliers suivent.
      const groupe = avecLesSelles(this.plan.pions, choisis);
      if (!groupe.length) return;
      // Contre le bord du plan, le pas est perdu : rien ne bouge, rien ne se révèle.
      const [dx, dy] = pasDuGroupe(groupe, ...fleches[ev.key], this.plan.largeur, this.plan.hauteur);
      if (!dx && !dy) return;
      this.instantane();
      const departs = groupe.map((t) => [t.x, t.y]);
      for (const t of groupe) {
        t.x += dx;
        t.y += dy;
      }
      const entres = groupe.filter((t, i) => changeDeCase(t, departs[i]));
      if (entres.length) this.entrerDans(entres, groupe[0]);
      this.vue.demander();
      return this.modifie(true);
    }
    if (ev.key === "0") return this.vue.cadrer();
    if (ev.key.toLowerCase() === "r") return this.tourner(ev.shiftKey ? -1 : 1);
    const outil = OUTILS.find(([, , t]) => t.toLowerCase() === ev.key.toLowerCase());
    if (outil) this.choisirOutil(outil[0]);
  }

  supprimerSelection() {
    const sel = this.selection;
    if (!sel) return;
    const p = this.plan;
    if (sel.genre === "pions") return this.supprimerPions(sel.ids);
    this.instantane();
    if (sel.genre === "piece") {
      for (let i = 0; i < p.sol.length; i++) if (p.piece[i] === sel.id) {
        p.sol[i] = 0;
        p.piece[i] = 0;
      }
      this.oublierPiecesVides();
      this.structure(null);
    } else if (sel.genre.startsWith("hab-")) {
      const cle = sel.genre === "hab-objet" ? "objets" : "lumieres";
      p.habillage[cle] = p.habillage[cle].filter((x) => x.id !== sel.id);
      this.vue.rafraichirTout();
    } else {
      const liste = { pion: "pions", texte: "textes", meuble: "objets", porte: "portes" }[sel.genre];
      p[liste] = p[liste].filter((x) => x.id !== sel.id);
      // Ses cavaliers mettent pied à terre.
      if (sel.genre === "pion") for (const x of p.pions) if (x.monture === sel.id) delete x.monture;
      if (sel.genre === "pion") this.vue.demander();
      else this.vue.rafraichirTout();
    }
    this.selectionner(null);
    this.modifie(sel.genre === "pion");
  }

  // Plusieurs pions retirés d'un coup : on le demande d'abord (un seul part sans question, Ctrl+Z le ramène).
  async supprimerPions(ids) {
    const p = this.plan;
    const pions = p.pions.filter((t) => ids.includes(t.id));
    if (!pions.length) return this.selectionner(null);
    const noms = pions.map((t) => `${t.nom || "Pion"}${t.court ? ` ${t.court}` : ""}`);
    const liste = noms.length > 6 ? `${noms.slice(0, 6).join(", ")} et ${noms.length - 6} autres` : `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`;
    if (!(await demander({ titre: `Retirer ${pions.length} pions`, texte: `${liste} quittent le plan.`, aide: "Ctrl+Z revient en arrière.", oui: "Retirer les pions" })) || this.detruit) return;
    const partis = new Set(pions.map((t) => t.id));
    this.instantane();
    p.pions = p.pions.filter((t) => !partis.has(t.id));
    // Les cavaliers d'une monture retirée mettent pied à terre.
    for (const t of p.pions) if (partis.has(t.monture)) delete t.monture;
    this.selectionner(null);
    this.modifie(true);
  }

  // Cacher ou montrer aux joueurs tous les pions choisis, d'un geste.
  cacherPions(cache) {
    const pions = this.plan.pions.filter((t) => idsDe(this.selection).includes(t.id));
    if (!pions.some((t) => !!t.cache !== cache)) return;
    this.instantane();
    for (const t of pions) t.cache = cache;
    this.vue.demander();
    this.afficherPanneau();
    this.modifie(true);
    toast(cache ? `${pions.length} pions cachés aux joueurs.` : `${pions.length} pions montrés aux joueurs, là où le plan est révélé.`);
  }

  // ---------------------------------------------------------------- dessin de l'éditeur

  dessinerEditeur(ctx, zone) {
    const p = this.plan;
    const z = this.vue.cam.z;
    const px = 1 / z;
    ctx.save();
    // La pièce sélectionnée : son contour en pointillé doré.
    if (this.selection?.genre === "piece") {
      const id = this.selection.id;
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      for (let y = Math.max(0, Math.floor(zone.y0)); y < Math.min(p.hauteur, Math.ceil(zone.y1)); y++) {
        for (let x = Math.max(0, Math.floor(zone.x0)); x < Math.min(p.largeur, Math.ceil(zone.x1)); x++) {
          const i = idx(p, x, y);
          if (!p.sol[i] || p.piece[i] !== id) continue;
          const dans = (a, b) => dedans(p, a, b) && p.sol[idx(p, a, b)] && p.piece[idx(p, a, b)] === id;
          if (!dans(x, y - 1)) { ctx.moveTo(x, y); ctx.lineTo(x + 1, y); }
          if (!dans(x, y + 1)) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); }
          if (!dans(x - 1, y)) { ctx.moveTo(x, y); ctx.lineTo(x, y + 1); }
          if (!dans(x + 1, y)) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); }
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const sel = this.element();
    if (sel && this.selection.genre === "meuble") {
      const b = emprise(sel);
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeRect(b.x0, b.y0, b.l, b.h);
      ctx.setLineDash([]);
    }
    if (sel && this.selection.genre === "porte") {
      const [cx, cy] = sel.sens === "h" ? [sel.x + 0.5, sel.y] : [sel.x, sel.y + 0.5];
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 2.5 * px;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (sel && this.selection.genre === "texte") {
      const l = (sel.taille || 0.6) * 0.62 * sel.texte.length;
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeRect(sel.x - l / 2 - 0.2, sel.y - (sel.taille || 0.6) * 0.7, l + 0.4, (sel.taille || 0.6) * 1.4);
      ctx.setLineDash([]);
    }
    if ((this.habillageModifiable() || (this.outil === "lumiere" && this.plan.habillage && !this.apercu)) && !this.vue.joueurs) this.dessinerReperesHab(ctx, px);
    // Le cadre d'une pièce en cours de tracé, avec ses dimensions.
    if (this.cadre) {
      const c = this.cadre;
      const x0 = Math.min(c.x0, c.x1);
      const y0 = Math.min(c.y0, c.y1);
      const l = Math.abs(c.x1 - c.x0) + 1;
      const h = Math.abs(c.y1 - c.y0) + 1;
      ctx.fillStyle = c.effacer ? "rgba(179,38,30,.25)" : "rgba(224,181,98,.2)";
      ctx.fillRect(x0, y0, l, h);
      ctx.strokeStyle = c.effacer ? "#e0584c" : "#e0b562";
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(x0, y0, l, h);
      this.etiquette(ctx, `${l} × ${h} cases · ${virgule(l * p.m_case)} × ${virgule(h * p.m_case)} m`, x0 + l / 2, y0 - 0.5, px);
    }
    // Le rectangle de sélection en cours.
    if (this.glisse?.type === "lasso" && this.glisse.bouge) {
      const g = this.glisse;
      ctx.fillStyle = "rgba(224,181,98,.12)";
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.fillRect(Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), Math.abs(g.x1 - g.x0), Math.abs(g.y1 - g.y0));
      ctx.strokeRect(Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), Math.abs(g.x1 - g.x0), Math.abs(g.y1 - g.y0));
      ctx.setLineDash([]);
    }
    // La caméra a pu bouger : le calque du curseur suit.
    this.majCurseur();
    if (this.mesure) {
      const m = this.mesure;
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([8 * px, 5 * px]);
      ctx.beginPath();
      ctx.moveTo(m.x0, m.y0);
      ctx.lineTo(m.x1, m.y1);
      ctx.stroke();
      ctx.setLineDash([]);
      this.etiquette(ctx, this.texteMesure(m), m.x1, m.y1 - 0.6, px);
    }
    ctx.restore();
  }

  // Vue du MJ : ce qui est caché aux joueurs est cerclé de rouge (comme les meubles cachés) ; les lumières, invisibles en
  // elles-mêmes, ont un repère à leur couleur quand l'outil de sélection est pris ; la sélection est cerclée d'or.
  dessinerReperesHab(ctx, px) {
    const h = this.plan.habillage;
    const sel = this.selection?.genre?.startsWith("hab-") ? this.selection : null;
    const cercle = (x, y, r, couleur, tirets) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash(tirets ? [4 * px, 3 * px] : []);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const o of Array.isArray(h.objets) ? h.objets : []) {
      if (!Array.isArray(o.case) || o.cle === "ornieres") continue;
      const [x, y] = this.positionHab(o, "hab-objet");
      const r = (PRISES[o.cle] || 0.22) + 0.06;
      if (o.cache) cercle(x, y, r, "#e0584c", true);
      if (sel?.genre === "hab-objet" && sel.id === o.id) cercle(x, y, r + 0.06, "#e0b562", true);
    }
    if (this.outil !== "main" && this.outil !== "lumiere") return;
    for (const l of Array.isArray(h.lumieres) ? h.lumieres : []) {
      const choisie = sel?.genre === "hab-lumiere" && sel.id === l.id;
      // Éteinte : le même repère, passé à la cendre et en pointillé (elle garde sa place, elle n'éclaire plus).
      if (l.eteinte) ctx.globalAlpha = 0.45;
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(l.couleur || "") ? l.couleur : "#ffb15e";
      ctx.strokeStyle = "rgba(20,12,6,.9)";
      ctx.lineWidth = 1.5 * px;
      // Un petit soleil de taille fixe à l'écran, quel que soit le zoom.
      ctx.beginPath();
      ctx.arc(l.x, l.y, 4.5 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.moveTo(l.x + Math.cos(a) * 7 * px, l.y + Math.sin(a) * 7 * px);
        ctx.lineTo(l.x + Math.cos(a) * 10.5 * px, l.y + Math.sin(a) * 10.5 * px);
      }
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
      if (l.cache) cercle(l.x, l.y, 13 * px, "#e0584c", true);
      if (choisie) {
        cercle(l.x, l.y, 15 * px, "#e0b562", false);
        // Sa portée, en pointillé discret.
        ctx.globalAlpha = 0.45;
        cercle(l.x, l.y, Math.max(0.5, +l.rayon || 3), "#e0b562", true);
      }
      ctx.globalAlpha = 1;
    }
  }

  etiquette(ctx, t, x, y, px) {
    ctx.font = `600 ${13 * px}px Cinzel`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(t).width + 14 * px;
    ctx.fillStyle = "rgba(20,15,11,.88)";
    ctx.fillRect(x - w / 2, y - 11 * px, w, 22 * px);
    ctx.fillStyle = "#f4ead4";
    ctx.fillText(t, x, y + px);
  }

  majInfos() {
    const c = this.curseur;
    if (!c || !this.infos) return;
    const p = this.plan;
    const cx = Math.floor(c[0]);
    const cy = Math.floor(c[1]);
    if (!dedans(p, cx, cy)) {
      this.infos.textContent = "";
      return;
    }
    const i = idx(p, cx, cy);
    const pc = p.sol[i] ? lirePiece(p, p.piece[i]) : null;
    const sol = SOLS[p.sol[i]]?.nom;
    const brume = { 1: "voile de brume", 2: "brume épaisse" }[p.brume[i]];
    const feu = p.sol[i] ? NOMS_FEU[p.feu[i]] : "";
    this.infos.textContent = [`Case ${cx + 1}, ${cy + 1}`, pc?.nom, p.sol[i] ? sol : "", p.brouillard_actif && p.sol[i] ? (p.brouillard[i] === 1 ? "révélée" : "cachée") : "", brume, feu].filter(Boolean).join(" · ");
  }

  // Ce que montre le curseur de l'outil, en cases : une case, le pinceau, l'arête d'une porte, le meuble, le pion.
  formeCurseur() {
    const cur = this.curseur;
    const g = this.glisse;
    if (!cur || (g && g.type !== "peinture" && g.type !== "brume" && g.type !== "nappe" && g.type !== "feu" && g.type !== "sang")) return null;
    const [x, y] = cur;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const o = this.outil;
    const brume = o === "brouillard" ? this.optBrume.mode : "";
    if (o === "sang") return { forme: "case", x: x - this.optSang.taille, y: y - this.optSang.taille, l: 2 * this.optSang.taille, h: 2 * this.optSang.taille };
    if (o === "piece" || brume === "piece") return { forme: "case", x: cx, y: cy, l: 1, h: 1 };
    if (o === "sol" || o === "brume" || o === "feu" || brume === "pinceau") {
      const r = (o === "sol" ? this.optSol.rayon : o === "brume" ? this.optNappe.rayon : o === "feu" ? this.optFeu.rayon : this.optBrume.rayon) - 1;
      return { forme: "case", x: cx - r, y: cy - r, l: 2 * r + 1, h: 2 * r + 1 };
    }
    if (o === "porte") {
      const a = areteProche(x, y, 0.35);
      if (!a) return null;
      return a.sens === "h" ? { forme: "porte-h", x: a.x, y: a.y, l: 1, h: 0 } : { forme: "porte-v", x: a.x, y: a.y, l: 0, h: 1 };
    }
    if (o === "meuble" && !this.toucher(x, y, ["meuble"])) {
      const b = this.placeMeuble(x, y);
      return b && { forme: "meuble", ...b };
    }
    if (o === "pion" && this.optPion) return { forme: "pion", x: cx + 0.08, y: cy + 0.08, l: 0.84, h: 0.84 };
    return null;
  }

  // La mesure d'un segment de l'outil Mesurer, telle qu'on l'écrit sur le plan et telle que les joueurs la lisent.
  texteMesure(m) {
    const d = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
    const cases = Math.max(Math.abs(Math.floor(m.x1) - Math.floor(m.x0)), Math.abs(Math.floor(m.y1) - Math.floor(m.y0)));
    return `${virgule(d * this.plan.m_case)} m · ${cases} case${cases > 1 ? "s" : ""}`;
  }

  // La règle part vers la page Table du coin des joueurs, pas plus vite que le pointeur (pointeur.js). Un segment sans
  // longueur ne part pas.
  envoyerRegle() {
    const m = this.mesure;
    if (!m || !this.pointeur || Math.hypot(m.x1 - m.x0, m.y1 - m.y0) < 0.05) return;
    this.pointeur.regle([m.x0, m.y0], [m.x1, m.y1], this.texteMesure(m));
  }

  // Le curseur sur son calque : une boîte placée en pixels d'écran, sans toucher au dessin du plan.
  majCurseur() {
    const el = this.pointe;
    if (!el || !this.vue) return;
    const f = this.formeCurseur();
    if (!f) {
      el.hidden = true;
      return;
    }
    const [sx, sy] = this.vue.versEcran(f.x, f.y);
    const z = this.vue.cam.z;
    el.hidden = false;
    el.dataset.forme = f.forme;
    el.style.width = `${f.l * z}px`;
    el.style.height = `${f.h * z}px`;
    el.style.transform = `translate(${sx}px, ${sy}px)`;
  }

  // ---------------------------------------------------------------- panneau

  afficherPanneau() {
    this.derniereSaisie = null;
    const sel = this.element();
    let html;
    if (this.outil === "lumiere") html = this.panneauLumieres();
    else if (this.selection?.genre === "pions") html = this.panneauGroupe(this.selection.ids);
    else if (sel && this.selection.genre === "piece") html = this.panneauPiece(sel);
    else if (sel && this.selection.genre === "porte") html = this.panneauPorte(sel);
    // Pose en série : l'outil Mobilier garde sa palette, la fiche du meuble qu'on vient de poser passe dessous.
    else if (sel && this.selection.genre === "meuble") html = this.outil === "meuble" ? `${this.panneauOutil()}<section class="pose-en-serie">${this.panneauMeuble(sel)}</section>` : this.panneauMeuble(sel);
    else if (sel && this.selection.genre === "pion") html = this.panneauPion(sel);
    else if (sel && this.selection.genre === "texte") html = this.panneauTexte(sel);
    else if (sel && this.selection.genre === "hab-objet") html = this.panneauObjetHab(sel);
    else if (sel && this.selection.genre === "hab-lumiere") html = this.panneauLumiereHab(sel);
    else html = this.panneauOutil();
    this.panneau.innerHTML = html;
    suivreVolets(this, this.panneau);
    this.panneau.querySelectorAll("textarea").forEach((z) => {
      z.style.height = "auto";
      z.style.height = `${z.scrollHeight + 2}px`;
    });
    this.majCurseur();
    this.majBandeau();
    this.majEtapes();
  }

  // ---------------------------------------------------------------- habillage par la rédaction

  panneauHabiller() {
    const enCours = !!this.habillement;
    return `
      <h3>Habiller le plan</h3>
      <p class="aide">L'atelier pose les objets du quotidien (chopes, couverts, sacs, paille…), les lumières et l'ambiance d'une heure, et une étiquette par pièce, d'après la fiche du lieu. Rien ne change avant que vous gardiez la proposition. L'habillage se voit dans le style Peint.</p>
      <div class="segments large" role="group" aria-label="Heure">${HEURES.map(([v, n]) => `<button data-action="hab-heure" data-valeur="${v}" aria-pressed="${this.optHab.heure === v}">${n}</button>`).join("")}</div>
      <label class="champ">Idée (facultatif)<textarea rows="2" data-hab-idee placeholder="une soirée animée, une caravane naine vient d'arriver…">${e(this.optHab.idee)}</textarea></label>
      <div class="actions"><button class="principal" data-action="habiller" data-estimation="habillage-plan" ${enCours || this.apercu ? "disabled" : ""}>${enCours ? "Habillage du plan en cours…" : "Habiller le plan"}</button></div>
      ${enCours ? '<p class="aide">Une minute environ. Vous pouvez continuer à travailler : la proposition s\'affichera sur le plan.</p>' : ""}
      ${this.erreurHab && !enCours ? `<p class="aide erreur-ia" role="alert">Dernier essai : ${e(this.erreurHab)}</p>` : ""}
      ${this.apercu ? `<p class="aide">Proposition affichée sur le plan : gardez-la ou écartez-la (bandeau au-dessus du plan).</p>
        ${this.apercu.remarques.length ? `<ul class="remarques-ia">${this.apercu.remarques.map((r) => `<li>${e(r)}</li>`).join("")}</ul>` : ""}` : ""}`;
  }

  // L'habillage gardé : heure et ambiance réglables sans rien redemander, et retouche objet par objet sur le plan.
  panneauHabillage() {
    const h = this.plan.habillage;
    if (!h || typeof h !== "object" || this.apercu) return "";
    const a = h.ambiance && typeof h.ambiance === "object" ? h.ambiance : AMBIANCES[h.heure] || AMBIANCES.soir;
    const caches = [...(h.objets || []), ...(h.lumieres || [])].filter((x) => x.cache).length;
    return `
      <h3>Habillage</h3>
      <p class="aide">${e(resumeHabillage(h))}${caches ? `, dont ${caches} caché${caches > 1 ? "s" : ""} aux joueurs` : ""}. ${this.vue.style === "peint" ? "Cliquez un objet ou une lumière sur le plan (outil Sélection) pour le déplacer, le cacher aux joueurs ou le retirer." : "Passez en style Peint pour le voir et le retoucher."}</p>
      <div class="segments large" role="group" aria-label="Heure de l'habillage">${HEURES.map(([v, n]) => `<button data-action="hab-heure-garde" data-valeur="${v}" aria-pressed="${h.heure === v}">${n}</button>`).join("")}</div>
      <label class="champ">Pénombre <output>${virgule(+a.force || 0)}</output><input type="range" min="0" max="0.95" step="0.05" data-amb="force" value="${e(+a.force || 0)}"></label>
      <div class="deux">
        <label class="champ">Teinte dedans<input type="color" data-amb="interieur" value="${e(a.interieur)}"></label>
        <label class="champ">Teinte dehors<input type="color" data-amb="exterieur" value="${e(a.exterieur)}"></label>
      </div>
      <div class="actions"><button class="danger" data-action="hab-retirer">Retirer l'habillage</button></div>`;
  }

  panneauObjetHab(o) {
    return `
      <h2>${e(NOMS_KITS[o.cle] || o.cle)}</h2>
      <p class="aide">Objet d'habillage. Glissez-le sur le plan pour le déplacer ; Suppr le retire.</p>
      <label class="champ">Rotation en degrés <output>${virgule(+o.rot || 0)}</output><input type="range" min="0" max="345" step="15" data-el="rot" value="${e(Math.round(((+o.rot || 0) % 360 + 360) % 360))}"></label>
      <label class="case"><input type="checkbox" data-el="cache" ${o.cache ? "checked" : ""}> Caché aux joueurs</label>
      <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer</button></div>`;
  }

  panneauLumiereHab(l) {
    return `<h2>Lumière</h2>${htmlLumiereChoisie(l)}`;
  }

  // L'outil Lumières : le type à poser, la liste des sources, la lumière choisie et l'ambiance (lumieres-menu.js).
  panneauLumieres() {
    const choisie = this.selection?.genre === "hab-lumiere" ? this.element() : null;
    return htmlLumieres(this.plan, { choisie, type: this.optLumiere.type, peint: this.vue.style === "peint", apercu: !!this.apercu });
  }

  // Un clic sur le sol avec l'outil Lumières : une lumière du type choisi, aussitôt choisie pour être réglée.
  ajouterLumiere(x, y) {
    if (this.apercu) return toast("Gardez ou écartez d'abord la proposition d'habillage.", "erreur");
    this.instantane();
    const r = lum.ajouter(this.plan, this.optLumiere.type, x, y);
    if (r.erreur) {
      this.passe.pop();
      this.majBarre();
      return toast(r.erreur, "erreur");
    }
    this.vue.rafraichirTout();
    this.selectionner({ genre: "hab-lumiere", id: r.lumiere.id });
    this.modifie();
    if (this.vue.style !== "peint") toast("Lumière posée. Elle se voit dans le style Peint.");
  }

  // Les gestes du menu du sang (data-sang) : style Peint, tout montrer, tout cacher, tout effacer.
  async actionSang(d) {
    const p = this.plan;
    const a = d.sang;
    if (a === "peint") {
      this.dom.querySelector('[data-style="peint"]')?.click();
      return this.afficherPanneau();
    }
    if (a === "tout-effacer") {
      const n = sg.compter(p).total;
      if (!n || !(await demander({ titre: "Effacer tout le sang", texte: `${n} tache${n > 1 ? "s" : ""} de sang sur ce plan.`, aide: "Ctrl+Z revient en arrière.", oui: "Tout effacer" })) || this.detruit) return;
      this.instantane();
      sg.toutEffacer(p);
    } else if (a === "reveler-tout" || a === "cacher-tout") {
      this.instantane();
      if (!sg.reveler(p, a === "reveler-tout")) {
        this.passe.pop();
        this.majBarre();
        return;
      }
    } else return;
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie();
  }

  // Les gestes du menu des lumières (data-lum) : choisir, allumer, éteindre, couleur, dupliquer, style Peint.
  actionLumiere(d) {
    const p = this.plan;
    const a = d.lum;
    if (a === "peint") {
      this.dom.querySelector('[data-style="peint"]')?.click();
      return this.afficherPanneau();
    }
    if (a === "choisir") {
      const l = lum.lumieresDe(p).find((x) => x.id === d.id);
      if (!l) return;
      this.selectionner({ genre: "hab-lumiere", id: l.id });
      return this.vue.animerVers({ x: l.x, y: l.y, hv: Math.max(8, (+l.rayon || 3) * 2 + 4) }, 500);
    }
    this.instantane();
    if (a === "bascule") {
      const l = lum.lumieresDe(p).find((x) => x.id === d.id);
      if (!l) return;
      lum.allumer(l, !lum.allumee(l));
    } else if (a === "tout-allumer" || a === "tout-eteindre") {
      if (!lum.toutAllumer(p, a === "tout-allumer")) return;
    } else if (a === "couleur") {
      const l = this.element();
      if (!l) return;
      lum.regler(l, "couleur", d.valeur);
    } else if (a === "dupliquer") {
      const l = this.element();
      const r = l ? lum.dupliquer(p, l) : { erreur: "Aucune lumière choisie." };
      if (r.erreur) return toast(r.erreur, "erreur");
      this.selection = { genre: "hab-lumiere", id: r.lumiere.id };
      this.vue.selection = anneauxDe(this.selection);
    } else return;
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie();
  }

  // Le bandeau au-dessus du plan : l'attente de la rédaction (avec le temps écoulé), puis la proposition à garder ou écarter.
  majBandeau() {
    const b = this.bandeau;
    if (!b) return;
    if (this.habillement) {
      const s = Math.round((Date.now() - this.habillement.depuis) / 1000);
      b.hidden = false;
      b.dataset.etat = "attente";
      b.innerHTML = `<span class="pouls"></span><span>Habillage du plan pour le ${e(this.habillement.heure)}… ${s} s (une minute environ)</span>`;
      return;
    }
    if (this.apercu) {
      const h = this.apercu.habillage;
      b.hidden = false;
      b.dataset.etat = "apercu";
      b.innerHTML = `<span>Proposition (${e(h.heure || "soir")}) : ${e(resumeHabillage(h))}. Rien n'est enregistré.</span>
        ${this.vue.style === "peint" ? "" : '<button data-action="hab-peint" title="L\'habillage se voit dans le style Peint">Voir en Peint</button>'}
        <button class="principal" data-action="hab-garder">Garder</button><button data-action="hab-ecarter">Écarter</button>`;
      return;
    }
    b.hidden = true;
    b.innerHTML = "";
  }

  async habiller() {
    if (this.habillement || this.apercu) return;
    const p = this.plan;
    if (!p.sol.some(Boolean)) return toast("Tracez d'abord des pièces : il n'y a rien à habiller.", "erreur");
    const { heure, idee } = this.optHab;
    this.habillement = { heure, depuis: Date.now() };
    this.erreurHab = null;
    this.minuterieHab = setInterval(() => this.majBandeau(), 1000);
    this.afficherPanneau();
    let r = null;
    try {
      // Le serveur lit le plan enregistré : ce qui attend part d'abord.
      await this.vider();
      r = await api.post(`/api/plans/${encodeURIComponent(p.id)}/habiller`, { heure, idee: idee.trim() });
    } catch (err) {
      this.erreurHab = erreurIA(err);
      if (!this.detruit) toast(`Habillage impossible : ${this.erreurHab}`, "erreur");
    }
    clearInterval(this.minuterieHab);
    this.habillement = null;
    if (this.detruit) return;
    if (r?.habillage) this.montrerApercu(r);
    // Une saisie en cours dans le panneau n'est pas coupée : seul le bouton se remet à jour.
    const saisie = document.activeElement?.closest?.("input, textarea, select");
    if (!saisie || !this.panneau.contains(saisie)) return this.afficherPanneau();
    const bouton = this.panneau.querySelector('[data-action="habiller"]');
    if (bouton) {
      bouton.disabled = !!this.apercu;
      bouton.textContent = "Habiller le plan";
    }
    this.majBandeau();
  }

  montrerApercu(r) {
    // La sélection d'un objet de l'ancien habillage n'a plus de sens.
    if (this.selection?.genre?.startsWith("hab-")) this.selectionner(null);
    this.apercu = { habillage: r.habillage, avant: this.plan.habillage || null, remarques: Array.isArray(r.remarques) ? r.remarques : [] };
    this.plan.habillage = r.habillage;
    this.vue.rafraichirTout();
    const rem = this.apercu.remarques;
    toast(rem.length ? `Proposition prête. Contrôle : ${rem.slice(0, 2).join(" ; ")}${rem.length > 2 ? "…" : ""}` : "Proposition prête : regardez-la sur le plan, puis gardez-la ou écartez-la.");
    if (this.vue.style !== "peint") toast("L'habillage se voit dans le style Peint.");
  }

  async garderApercu() {
    const a = this.apercu;
    if (!a) return;
    if (a.avant && !(await demander({ titre: "Remplacer l'habillage", texte: "L'habillage actuel sera remplacé par cette proposition.", aide: "Ctrl+Z revient en arrière.", oui: "Remplacer" }))) return;
    if (this.detruit || this.apercu !== a) return;
    // L'instantané prend l'habillage d'avant (l'aperçu est encore là) : Ctrl+Z y revient.
    this.instantane();
    this.apercu = null;
    this.plan.habillage = a.habillage;
    this.afficherPanneau();
    this.vue.demander();
    this.modifie();
    toast("Habillage gardé : retouchez-le objet par objet avec l'outil Sélection.");
  }

  ecarterApercu({ dessiner = true } = {}) {
    const a = this.apercu;
    if (!a) return;
    this.apercu = null;
    this.plan.habillage = a.avant;
    if (!dessiner) return;
    this.vue.rafraichirTout();
    this.afficherPanneau();
  }

  // Changer l'heure d'un habillage gardé : l'ambiance de référence de cette heure, sans rien redemander.
  heureHabillage(heure) {
    const h = this.plan.habillage;
    if (!h || !AMBIANCES[heure]) return;
    this.instantane();
    h.heure = heure;
    h.ambiance = { ...AMBIANCES[heure] };
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie();
  }

  async retirerHabillage() {
    if (!this.plan.habillage || !(await demander({ titre: "Retirer tout l'habillage", texte: "Objets, lumières, ambiance et étiquettes de ce plan.", aide: "Ctrl+Z revient en arrière.", oui: "Retirer l'habillage" }))) return;
    if (this.detruit || !this.plan.habillage) return;
    this.instantane();
    this.plan.habillage = null;
    if (this.selection?.genre?.startsWith("hab-")) this.selection = null;
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie();
  }

  panneauOutil() {
    const o = this.outil;
    if (o === "sang") return htmlSang(this.plan, this.optSang, { peint: this.vue.style === "peint", apercu: !!this.apercu });
    if (o === "piece") {
      return `
        <h2>Tracer une pièce</h2>
        <p class="aide">Glissez sur le quadrillage : la pièce se remplit, les murs se posent seuls, et une porte se place ensuite sur n'importe quel mur. Maj + glisser agrandit la pièce où vous commencez ; Alt + glisser efface.</p>
        <label class="champ">Genre<select data-opt="piece.genre">${option(GENRES_PIECES, this.optPiece.genre)}</select></label>
        <h3>Sol</h3>${this.paletteSols("piece.sol", this.optPiece.sol)}`;
    }
    if (o === "sol") {
      return `
        <h2>Peindre le sol</h2>
        <p class="aide">Change le sol des cases déjà tracées. Une case vide peinte rejoint la pièce sélectionnée, sinon sa voisine : idéal pour creuser une grotte. La gomme rend les cases au vide.</p>
        ${this.paletteSols("sol.sol", this.optSol.sol, true)}
        <label class="champ">Taille du pinceau <output>${this.optSol.rayon * 2 - 1} case${this.optSol.rayon > 1 ? "s" : ""}</output><input type="range" min="1" max="4" value="${this.optSol.rayon}" data-opt="sol.rayon"></label>`;
    }
    if (o === "porte") {
      return `
        <h2>Portes et fenêtres</h2>
        <p class="aide">Cliquez sur un mur pour y poser une porte ; cliquez sur une porte pour la régler. Une porte secrète n'apparaît aux joueurs qu'une fois découverte.</p>
        <div class="palette">${PORTES.map(([v, n]) => `<button role="radio" aria-checked="${this.optPorte.genre === v}" data-opt-bouton="porte.genre" data-valeur="${v}">${e(n)}</button>`).join("")}</div>
        <label class="champ">État<select data-opt="porte.etat">${option(ETATS_PORTE, this.optPorte.etat)}</select></label>`;
    }
    if (o === "meuble") {
      return `
        <h2>Mobilier</h2>
        <p class="aide">Choisissez un meuble et cliquez pour le poser : la palette reste là pour le suivant. Glissez un meuble pour le déplacer ; R tourne celui qu'on vient de poser (Maj + R dans l'autre sens), Échap le lâche.</p>
        <div class="tourner"><span class="lbl">Orientation ${this.optMeuble.rot}°</span><button class="icone-seule" data-action="tourner-pose-g" title="Tourner à gauche le prochain meuble">${icone("gauche")}</button><button class="icone-seule" data-action="tourner-pose-d" title="Tourner à droite le prochain meuble">${icone("droite")}</button></div>
        ${this.palette.html(this.optMeuble.cle)}`;
    }
    if (o === "pion") return this.panneauPions();
    if (o === "image") return panneauImages(this);
    if (o === "brouillard") {
      const p = this.plan;
      const total = p.sol.filter(Boolean).length;
      const vus = p.sol.filter((s, i) => s && p.brouillard[i] === 1).length;
      return `
        <h2>Révéler aux joueurs</h2>
        <p class="aide">Sur la TV, les joueurs ne voient que ce qui est révélé. Cliquez une pièce pour la révéler ou la cacher d'un coup ; le pinceau sert aux grottes et aux images importées.</p>
        <div class="segments large"><button data-opt-bouton="brume.mode" data-valeur="piece" aria-pressed="${this.optBrume.mode === "piece"}">Pièce entière</button><button data-opt-bouton="brume.mode" data-valeur="pinceau" aria-pressed="${this.optBrume.mode === "pinceau"}">Pinceau</button></div>
        ${this.optBrume.mode === "pinceau" ? `
          <div class="segments large"><button data-opt-bouton="brume.valeur" data-valeur="1" aria-pressed="${(this.optBrume.valeur ?? 1) === 1}">Révéler</button><button data-opt-bouton="brume.valeur" data-valeur="0" aria-pressed="${this.optBrume.valeur === 0}">Cacher</button></div>
          <label class="champ">Taille du pinceau <output>${this.optBrume.rayon * 2 - 1} case${this.optBrume.rayon > 1 ? "s" : ""}</output><input type="range" min="1" max="6" value="${this.optBrume.rayon}" data-opt="brume.rayon"></label>` : ""}
        <p>${vus} case${vus > 1 ? "s" : ""} révélée${vus > 1 ? "s" : ""} sur ${total}.</p>
        <div class="actions"><button data-action="tout-reveler">Tout révéler</button><button data-action="tout-cacher">Tout cacher</button></div>
        <label class="case"><input type="checkbox" data-p="brouillard_actif" ${p.brouillard_actif ? "checked" : ""}> Brouillard actif</label>
        <div class="actions"><button class="principal" data-action="table-cadrer">Cadrer la TV sur ce qui est révélé</button></div>
        <h3>Pièces</h3>${this.listePieces()}`;
    }
    if (o === "brume") {
      const v = this.optNappe.valeur;
      return `
        <h2>Brume</h2>
        <p class="aide">Une brume que les joueurs voient sur la TV : l'aube sur l'étang, un don qui voile le combat, la fumée d'un incendie. Elle ne révèle ni ne cache aucune pièce : c'est l'affaire de l'outil Révéler.</p>
        <div class="segments" role="group" aria-label="Teinte de toute la brume du plan"><button data-action="brume-teinte" data-valeur="brume" aria-pressed="${this.plan.brume_teinte !== "fumee"}">Brume</button><button data-action="brume-teinte" data-valeur="fumee" aria-pressed="${this.plan.brume_teinte === "fumee"}">Fumée</button></div>
        <div class="segments large"><button data-opt-bouton="nappe.valeur" data-valeur="1" aria-pressed="${v === 1}">Voile</button><button data-opt-bouton="nappe.valeur" data-valeur="2" aria-pressed="${v === 2}">Épaisse</button><button data-opt-bouton="nappe.valeur" data-valeur="0" aria-pressed="${v === 0}">Effacer</button></div>
        <p class="aide">${v === 2 ? "Épaisse : on ne voit plus le sol. Sur la TV, adversaires et PNJ y disparaissent ; les héros restent visibles, un peu estompés. Alt + glisser efface." : v === 1 ? "Voile : on voit à travers, le sol et les pions restent lisibles. Alt + glisser efface." : "Le pinceau retire la brume."}</p>
        <label class="champ">Taille du pinceau <output>${this.optNappe.rayon * 2 - 1} case${this.optNappe.rayon > 1 ? "s" : ""}</output><input type="range" min="1" max="6" value="${this.optNappe.rayon}" data-opt="nappe.rayon"></label>
        <p data-decompte-brume>${e(this.texteDecompteBrume())}</p>
        <div class="actions"><button data-action="brume-partout">Brume partout</button><button data-action="brume-dissiper">Dissiper la brume</button></div>
        <p class="aide">Dans l'atelier, la brume reste plus pâle que sur la TV pour laisser voir le plan : « Vue joueurs » la montre telle qu'ils la verront.</p>
        <p class="aide">Les étapes (le feu et la brume gardés pour la partie) se préparent dans l'outil Feu.</p>`;
    }
    if (o === "feu") return this.panneauFeu();
    if (o === "texte") return `<h2>Texte</h2><p class="aide">Cliquez sur le plan pour poser un texte : un nom de rue, un numéro de salle. Un texte « pour le MJ » ne va jamais sur la TV.</p>`;
    if (o === "mesure") return `<h2>Mesurer</h2><p class="aide">Glissez d'un point à un autre : distance en mètres et en cases (une case fait ${virgule(this.plan.m_case)} m). Les joueurs voient la règle sur la page Table de leur coin.</p>`;
    if (o === "pointeur") return panneauPointeur("plan", this.etatPortee());
    return this.panneauPlan();
  }

  panneauFeu() {
    const p = this.plan;
    const v = this.optFeu.valeur;
    const i = p.etape;
    const et = Number.isInteger(i) ? p.etapes[i] : null;
    const aide = {
      1: "Braises : le feu prend. De petites flammes sur un sol qui rougeoie.",
      2: "Flammes : un vrai feu, avec sa fumée et ses escarbilles.",
      3: "Brasier : de hautes flammes, une fumée épaisse, une lueur qui gagne la pièce.",
      4: "Calciné : le feu est passé. Sol noirci, dernières braises, filets de fumée.",
      0: "Le pinceau éteint le feu sans laisser de trace.",
    }[v];
    return `
      <h2>Feu</h2>
      <p class="aide">Un incendie que les joueurs voient sur la TV : flammes, fumée et escarbilles qui bougent, et sa lueur sur la pièce en style Peint. Il ne révèle ni ne cache aucune pièce.</p>
      <div class="palette" role="radiogroup" aria-label="Ce que pose le pinceau">${[...FEUX, [0, "Éteindre"]].map(([n, nom]) => `<button role="radio" aria-checked="${v === n}" data-opt-bouton="feu.valeur" data-valeur="${n}">${nom}</button>`).join("")}</div>
      <p class="aide">${aide}${v ? " Alt + glisser éteint." : ""}</p>
      <label class="champ">Taille du pinceau <output>${this.optFeu.rayon * 2 - 1} case${this.optFeu.rayon > 1 ? "s" : ""}</output><input type="range" min="1" max="6" value="${this.optFeu.rayon}" data-opt="feu.rayon"></label>
      <p data-decompte-feu>${e(this.texteDecompteFeu())}</p>
      <div class="actions"><button data-action="feu-calciner">Tout calciner</button><button data-action="feu-eteindre">Tout éteindre</button></div>
      <h3>En combat</h3>
      <label class="champ">Effet des flammes<textarea rows="2" maxlength="160" data-p="feu_effet" placeholder="Par exemple : 1D6 Santé, l'armure ne compte pas">${e(p.feu_effet || "")}</textarea></label>
      <p class="aide">Rappelé dans le suivi du combat et le tableau quand la main passe à un combattant dans les flammes ou le brasier, si ce plan est à la TV ou lié à la scène du combat (Préparer › Lier). Dans le kit, traverser un Mur de flammes coûte 1D6 et l'armure ordinaire ne protège pas du feu.</p>
      <h3>Étapes</h3>
      <p class="aide">Une étape garde le feu et la brume du moment. Pendant la partie, la barre « Étapes » en bas du plan les rappelle d'un clic, et la TV suit.</p>
      ${p.etapes.length ? `<div class="etapes-liste">${p.etapes.map((x, k) => `<button data-action="etape-rappeler" data-etape="${k}" aria-pressed="${i === k}" title="${e(x.nom)}">${k + 1}</button>`).join("")}</div>` : ""}
      ${et ? `
        <label class="champ">Nom de l'étape ${i + 1}<input type="text" maxlength="60" value="${e(et.nom)}" data-etape-nom></label>
        ${this.etapeModifiee() ? `<p class="aide">Le feu ou la brume ont changé depuis que cette étape a été rappelée.</p>` : ""}
        <div class="actions"><button data-action="etape-garder">Garder le feu et la brume ici</button><button class="danger" data-action="etape-retirer">Retirer cette étape</button></div>` : ""}
      <div class="actions"><button data-action="etape-ajouter" ${p.etapes.length >= ETAPES_MAX ? "disabled" : ""}>Nouvelle étape d'après le plan</button></div>`;
  }

  // Ce que l'outil Pointeur dit de la TV : d'après le serveur s'il a répondu depuis, sinon d'après la table relue.
  etatPortee() {
    return textePortee(this.portee, this.tableIci, this.ecransTable, "ce plan");
  }

  majPortee() {
    const el = this.outil === "pointeur" && !this.detruit && this.panneau?.querySelector(".portee-pointeur");
    if (!el) return;
    const t = this.etatPortee();
    el.textContent = t.texte;
    el.dataset.etat = t.etat;
  }

  // La table vient d'être lue, ou changée d'ici : le panneau en parle d'après elle, et le serveur redira la portée au
  // prochain mouvement, même s'il la croit inchangée.
  porteeRelue() {
    this.portee = undefined;
    this.pointeur?.relire();
    this.majPortee();
  }

  // La teinte d'un meuble ou du sol d'une pièce (reglages-decor.js) : une couleur #rrggbb, ou rien pour celle d'origine.
  // Le nuancier libre envoie sa couleur à chaque mouvement : une seule étape d'annulation pour toute la glissade.
  poserTeinte(cible, valeur, finie) {
    const o = this.element();
    if (!o || this.selection?.genre !== cible) return;
    const t = /^#[0-9a-fA-F]{6}$/.test(valeur || "") ? valeur.toLowerCase() : "";
    if (this.derniereSaisie !== `teinte:${this.selection.id}`) this.instantane();
    this.derniereSaisie = finie ? null : `teinte:${this.selection.id}`;
    if (t) o.teinte = t;
    else delete o.teinte;
    this.vue.rafraichirTout();
    if (finie) this.afficherPanneau();
    else for (const b of this.panneau.querySelectorAll("[data-teinte]")) b.setAttribute("aria-checked", String(b.dataset.valeur === t));
    this.modifie();
  }

  // La lumière du plan (style peint) : jour, crépuscule, nuit, torches ; rien pour revenir à celle d'avant.
  poserLumiere(valeur) {
    const p = this.plan;
    if ((p.lumiere || "") === valeur) return;
    this.instantane();
    if (valeur) p.lumiere = valeur;
    else delete p.lumiere;
    this.vue.rafraichirTout();
    this.afficherPanneau();
    this.modifie();
  }

  vignette(cle) {
    this.vignettes ||= new Map();
    const style = this.vue?.style === "peint" ? "peint" : "couleur";
    if (!this.vignettes.has(`${style}:${cle}`)) this.vignettes.set(`${style}:${cle}`, vignetteMeuble(cle, 44, style));
    return this.vignettes.get(`${style}:${cle}`);
  }

  paletteSols(cle, valeur, gomme = false) {
    const bouton = (s) => `<button role="radio" aria-checked="${valeur === s.id}" data-opt-bouton="${cle}" data-valeur="${s.id}"><span class="pastille" style="background:${s.couleur}"></span>${e(s.nom)}</button>`;
    const dedans = SOLS.filter((s) => s.id && SOLS_DEDANS.has(s.cle));
    const dehors = SOLS.filter((s) => s.id && !SOLS_DEDANS.has(s.cle));
    return `<p class="sous-titre-sols">Dedans</p><div class="palette">${dedans.map(bouton).join("")}</div>
      <p class="sous-titre-sols">Dehors et sous terre</p><div class="palette">${dehors.map(bouton).join("")}
      ${gomme ? `<button role="radio" aria-checked="${valeur === 0}" data-opt-bouton="${cle}" data-valeur="0"><span class="pastille" style="background:#15110d"></span>Gomme (vide)</button>` : ""}</div>`;
  }

  listePieces() {
    const p = this.plan;
    if (!p.pieces.length) return '<p class="aide">Aucune pièce : tracez-en avec l\'outil Pièce (P).</p>';
    return `<ul class="liste-lieux">${p.pieces.map((pc) => {
      const cases = [];
      for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.piece[i] === pc.id) cases.push(i);
      const vus = cases.filter((i) => p.brouillard[i] === 1).length;
      const etat = !cases.length ? "" : vus === cases.length ? "révélée" : vus ? "en partie" : "cachée";
      return `<li><button data-piece-liste="${e(pc.id)}"><span>${e(pc.nom || "Pièce")}</span><span class="secret ${etat === "révélée" ? "vue" : ""}">${etat}</span></button></li>`;
    }).join("")}</ul>`;
  }

  panneauPlan() {
    const p = this.plan;
    const gen = p.generateur || { modele: "vierge", graine: 1 };
    return `
      <h2>Le plan</h2>
      <label class="champ">Nom<input type="text" data-p="nom" value="${e(p.nom)}"></label>
      <label class="champ">Lieu<select data-p="lieu"><option value="">aucun lieu</option>${this.lieux.map((l) => `<option value="${e(l.id)}" ${l.id === p.lieu ? "selected" : ""}>${e(l.nom)}</option>`).join("")}</select></label>
      <label class="champ">Niveau ou partie<input type="text" data-p="etage" value="${e(p.etage || "")}" placeholder="rez-de-chaussée, étage, cave…"></label>
      <div class="deux">
        <label class="champ">Une case<select data-p="m_case">${option([[1, "1 m"], [1.5, "1,5 m"], [2, "2 m"], [3, "3 m"]], p.m_case)}</select></label>
        <label class="champ">Taille<output data-taille>${p.largeur} × ${p.hauteur}</output></label>
      </div>
      <div class="agrandir">
        <span class="lbl">Agrandir de 4 cases</span>
        <button data-agrandir="haut">en haut</button><button data-agrandir="bas">en bas</button><button data-agrandir="gauche">à gauche</button><button data-agrandir="droite">à droite</button>
        <button data-action="ajuster" title="Retire les bords vides, garde 2 cases de marge">Ajuster au contenu</button>
      </div>
      <label class="case"><input type="checkbox" data-p="quadrillage" ${p.quadrillage ? "checked" : ""}> Quadrillage sur la TV</label>
      <label class="case"><input type="checkbox" data-p="brouillard_actif" ${p.brouillard_actif ? "checked" : ""}> Brouillard : les joueurs ne voient que les pièces révélées</label>
      <div class="actions"><button data-action="table-cadrer" title="Après un cadrage à la main : la TV se cadre de nouveau sur ce qui est révélé, et suit chaque pièce révélée">Cadrer la TV sur ce qui est révélé</button></div>
      <h3>Générateur</h3>
      <label class="champ">Modèle<select data-gen="modele">${option(MODELES.map((m) => [m.cle, m.nom]), gen.modele)}</select></label>
      <p class="aide">${e(MODELES.find((m) => m.cle === gen.modele)?.aide || "")}</p>
      <div class="deux">
        <label class="champ">Graine<input type="number" data-gen="graine" value="${e(gen.graine)}"></label>
        <div class="actions bas"><button data-action="relancer" title="Une autre version, au hasard">Relancer</button></div>
      </div>
      <div class="actions"><button data-action="generer">Générer avec cette graine</button></div>
      <p class="aide">Générer remplace tout le plan (on vous le demande s'il a été retouché) ; Ctrl+Z revient en arrière.</p>
      <h3>Programmer un plan</h3>
      <p class="aide">Décrivez ce que vous voulez : l'atelier choisit le modèle et écrit chaque salle (ce que voient les joueurs, vos notes, piège, indice, rencontre) ; le générateur trace le plan. Les descriptions vont dans les notes des pièces, jamais sur la TV.</p>
      <label class="champ">Le plan voulu<textarea rows="3" data-programme placeholder="une crypte de 6 salles sous la chapelle, avec une énigme et un boss de niveau 1"></textarea></label>
      <div class="actions"><button data-action="programmer" data-estimation="plan">Programmer le plan</button></div>
      ${htmlLumiere(p)}
      ${this.panneauHabiller()}
      ${this.panneauHabillage()}
      <h3>Image de fond</h3>
      ${p.fond ? `
        <img class="apercu-fond" src="${e(p.fond.url)}" alt="">
        <div class="deux">
          <label class="champ">Largeur en cases<input type="number" step="0.1" min="2" data-fond="l" value="${e(p.fond.l)}"></label>
          <label class="champ">Opacité<input type="range" min="0.2" max="1" step="0.05" data-fond="opacite" value="${e(p.fond.opacite ?? 1)}"></label>
        </div>
        <div class="deux">
          <label class="champ">Décalage horizontal<input type="number" step="0.05" data-fond="x" value="${e(p.fond.x || 0)}"></label>
          <label class="champ">Décalage vertical<input type="number" step="0.05" data-fond="y" value="${e(p.fond.y || 0)}"></label>
        </div>
        <label class="case"><input type="checkbox" data-fond="dessiner" ${p.fond.dessiner ? "checked" : ""}> Dessiner les sols et les murs par-dessus</label>
        <p class="aide">Réglez la largeur jusqu'à ce que le quadrillage de l'image tombe sur celui de l'atelier : le plan suit l'image, plus grand ou plus petit, une fois la valeur validée. Tracez ensuite des pièces sur l'image (sans les dessiner) pour les révéler d'un clic.</p>
        <div class="actions"><button class="danger" data-action="fond-retirer">Retirer l'image</button></div>`
      : `<p class="aide">Un plan trouvé ailleurs (une carte de donjon, une capture) : il sert de fond, et le brouillard s'y pose comme sur un plan dessiné.</p>
        <label class="bouton">Importer une image<input type="file" accept="image/png,image/jpeg,image/webp" data-action="fond-importer" hidden></label>`}
      <p class="aide import-uvtt">${e(AIDE_UVTT)} ${e(PERTES_UVTT)} L'import remplace tout le plan (on vous le demande s'il a été retouché) ; Ctrl+Z revient en arrière.</p>
      <label class="bouton">Importer un plan UVTT<input type="file" data-action="uvtt-importer" hidden></label>
      <h3>Pièces</h3>${this.listePieces()}
      <h3>Notes du MJ</h3>
      <label class="champ secret">Ce que les joueurs ne voient pas<textarea rows="3" data-p="notes">${e(p.notes || "")}</textarea></label>
      <div class="actions"><button class="danger" data-action="supprimer">Mettre le plan à la corbeille</button>
        <a class="lien-versions" href="${lienVersions("plans", p.id, `#/plan/${p.id}`)}">Versions précédentes</a></div>`;
  }

  panneauPiece(pc) {
    const p = this.plan;
    const cases = [];
    for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.piece[i] === pc.id) cases.push(i);
    const revelee = cases.length && cases.every((i) => p.brouillard[i] === 1);
    const sol = cases.length ? p.sol[cases[0]] : 1;
    return `
      <h2>${e(pc.nom || "Pièce")}</h2>
      <p class="aide">${cases.length} cases, environ ${Math.round(cases.length * p.m_case * p.m_case)} m².</p>
      <label class="champ">Nom<input type="text" data-el="nom" value="${e(pc.nom || "")}"></label>
      <label class="champ">Genre<select data-el="genre">${option(GENRES_PIECES, pc.genre || "salle")}</select></label>
      <label class="champ">Sol de toute la pièce<select data-piece-sol>${option(SOLS.filter((s) => s.id).map((s) => [s.id, s.nom]), sol)}</select></label>
      ${htmlTeintes("piece", pc.teinte, "Teinte du sol", "Sa couleur")}
      ${(pc.genre || "salle") === "salle" ? htmlMurs(pc.mur) : ""}
      <label class="case"><input type="checkbox" data-el="nom_visible" ${pc.nom_visible ? "checked" : ""}> Nom écrit sur la TV une fois révélée</label>
      <p class="aide aide-nom-tv" hidden>Ce nom reste pour vous : cochez la case pour que les joueurs le lisent sur la TV, une fois la pièce révélée.</p>
      <div class="actions">
        <button class="principal" data-action="piece-montrer" title="La révèle et cadre la TV dessus">Révéler et montrer</button>
        <button data-action="${revelee ? "piece-cacher" : "piece-reveler"}">${revelee ? "Cacher" : "Révéler"}</button>
      </div>
      <label class="champ secret">Notes du MJ<textarea rows="3" data-el="notes" placeholder="Ce qui s'y trouve, ce qui s'y cache…">${e(pc.notes || "")}</textarea></label>
      <div class="actions"><button class="danger" data-action="supprimer-selection">Effacer la pièce</button></div>`;
  }

  panneauPorte(d) {
    return `
      <h2>${e(PORTES.find(([v]) => v === d.genre)?.[1] || "Porte")}</h2>
      <label class="champ">Genre<select data-el="genre">${option(PORTES, d.genre)}</select></label>
      <label class="champ">État<select data-el="etat">${option(ETATS_PORTE, d.etat || "fermee")}</select></label>
      ${d.genre === "secrete" ? `<label class="case"><input type="checkbox" data-el="decouverte" ${d.decouverte ? "checked" : ""}> Découverte par les joueurs : elle apparaît sur la TV</label>` : ""}
      <p class="aide">${d.etat === "verrouillee" ? "Verrouillée : le cadenas n'apparaît que dans la vue du MJ." : "Ouverte ou fermée, la TV montre la porte telle qu'elle est."}</p>
      <label class="champ secret">Note du MJ<textarea rows="2" data-el="note" placeholder="la clé est chez le prêtre, piégée…">${e(d.note || "")}</textarea></label>
      <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer</button></div>`;
  }

  panneauMeuble(o) {
    if (estImage(o)) return panneauImageObjet(this, o);
    const m = MEUBLES[o.cle];
    return `
      <h2>${e(o.nom || m?.nom || "Meuble")}</h2>
      <img class="vignette-meuble" src="${this.vignette(o.cle)}" alt="">
      <label class="champ">Nom (facultatif)<input type="text" data-el="nom" value="${e(o.nom || "")}" placeholder="${e(m?.nom || "")}"></label>
      <div class="tourner"><span class="lbl">Orientation ${o.rot || 0}°</span><button class="icone-seule" data-action="tourner-g" title="Tourner à gauche">${icone("gauche")}</button><button class="icone-seule" data-action="tourner-d" title="Tourner à droite (R)">${icone("droite")}</button></div>
      <div class="deux">
        <label class="champ">Largeur<input type="number" min="1" max="12" data-el="l" value="${e(o.l)}"></label>
        <label class="champ">Profondeur<input type="number" min="1" max="12" data-el="h" value="${e(o.h)}"></label>
      </div>
      ${m?.teinte ? htmlTeintes("meuble", o.teinte, "Teinte", "D'origine") : ""}
      <label class="case"><input type="checkbox" data-el="cache" ${o.cache ? "checked" : ""}> Caché aux joueurs</label>
      <label class="champ secret">Note du MJ<textarea rows="2" data-el="note">${e(o.note || "")}</textarea></label>
      <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer</button></div>`;
  }

  panneauPion(t) {
    const c = this.cartonDuPion(t);
    const secret = c?.cle === "pnj" && !c.fiche.connu;
    const deplace = OUTILS_QUI_ENTRENT.includes(this.outil);
    const entre = deplace && t.genre === "heros";
    return `
      <h2>${e(t.nom || "Pion")}</h2>
      ${this.notesEntree(t)}
      ${c ? `<div class="actions">
        <button class="principal" data-action="pion-carton" title="Son carton sur la TV, par-dessus la vue en cours">Montrer son carton</button>
        <button data-action="pion-carton-retirer" title="Retire de la TV le carton ${c.cle === "pnj" ? "du PNJ" : "de l'aventurier"}">Retirer le carton</button>
      </div>
      ${secret ? '<p class="aide">PNJ inconnu des joueurs : montrer son carton le rend connu, après confirmation.</p>' : ""}` : ""}
      <label class="champ">Nom<input type="text" data-el="nom" value="${e(t.nom || "")}"></label>
      <div class="deux">
        <label class="champ">Numéro<input type="text" data-el="court" value="${e(t.court || "")}" placeholder="1, 2…"></label>
        <label class="champ">Taille<select data-el="taille">${option(TAILLES_PION, t.taille || 1)}</select></label>
      </div>
      <label class="champ">Camp<select data-el="genre">${option([["heros", "Aventurier"], ["ennemi", "Adversaire"], ["pnj", "PNJ"], ["autre", "Autre"]], t.genre)}</select></label>
      ${htmlEtatsPion(t)}
      <label class="case"><input type="checkbox" data-el="cache" ${t.cache ? "checked" : ""}> Caché aux joueurs (embuscade)</label>
      ${htmlApparencePion(this, t)}
      <p class="aide">Les flèches du clavier le déplacent d'une case. Il n'apparaît sur la TV que sur une case révélée${t.genre === "heros" ? "" : ", et jamais dans la brume épaisse"}.${!t.cache && cacheParLaBrume(this.plan, t) ? " Il y est en ce moment : les joueurs ne le voient pas." : ""}${entre && !t.cache ? " Maj + glisser emmène tous les héros visibles." : ""}${deplace ? " Maj + clic sur un autre pion le joint à celui-ci." : ""}${entre && t.cache ? " Caché, il ne révèle aucune pièce en y entrant." : ""}</p>
      ${entre && !t.cache ? this.caseEntrer() : ""}
      <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer du plan</button></div>`;
  }

  // Plusieurs pions choisis (groupe-pions.js) : qui, et les gestes qui valent pour tous.
  panneauGroupe(ids) {
    const pions = ids.map((id) => this.plan.pions.find((t) => t.id === id)).filter(Boolean);
    const caches = pions.filter((t) => t.cache).length;
    const entre = OUTILS_QUI_ENTRENT.includes(this.outil) && pions.some(herosVisible);
    return `
      <h2>${pions.length} pions sélectionnés</h2>
      ${this.entree && ids.includes(this.entree.pion) ? this.notesEntree({ id: this.entree.pion }) : ""}
      <ul class="liste-lieux">${pions.map((t) => `<li><button data-pion-liste="${e(t.id)}" title="${this.multiple ? "Le retirer de la sélection" : "Ne garder que ce pion"}"><span class="pastille" style="background:${e(t.couleur || COULEURS_PIONS[t.genre] || "#888")}"></span>${e(t.nom || "Pion")}${t.court ? ` ${e(t.court)}` : ""}${t.tombe ? '<span class="secret">au tapis</span>' : t.cache ? '<span class="secret">caché</span>' : ""}</button></li>`).join("")}</ul>
      <p class="aide">Glissez l'un d'eux : tous suivent en gardant leur formation, montures et cavaliers compris. Les flèches du clavier les déplacent d'une case. Maj + clic (ou Ctrl, Cmd) ajoute ou retire un pion ; Maj + glisser sur le plan trace un rectangle ; Échap lâche tout.</p>
      ${this.boutonsSelection()}
      ${entre ? this.caseEntrer() : ""}
      <div class="actions">
        <button data-action="groupe-cacher" ${caches === pions.length ? "disabled" : ""}>Cacher aux joueurs</button>
        <button data-action="groupe-montrer" ${caches ? "" : "disabled"}>Montrer aux joueurs</button>
      </div>
      <div class="actions"><button data-action="groupe-lacher">Tout désélectionner</button><button class="danger" data-action="supprimer-selection">Retirer du plan</button></div>`;
  }

  // « Sélection multiple » (pour le doigt, sans touche Maj) et « Tous les héros ».
  boutonsSelection() {
    return `<div class="actions selection-pions">
        <button data-action="multi-bascule" aria-pressed="${this.multiple}" title="Toucher un pion l'ajoute ou le retire ; glisser sur le plan trace un rectangle">Sélection multiple</button>
        <button data-action="multi-heros" title="Choisit tous les héros que voient les joueurs">Tous les héros</button>
      </div>`;
  }

  caseEntrer() {
    return `<label class="case"><input type="checkbox" data-entrer ${this.entrerRevele ? "checked" : ""}> Entrer révèle la pièce</label>`;
  }

  // Le pion d'un héros (par sa fiche) ou d'un adversaire du combat en cours, choisi et montré au centre s'il sort de
  // la vue.
  choisirPionDuTableau({ heros, adversaire, pion }) {
    let id = pion && this.plan.pions.some((t) => t.id === pion) ? pion : null;
    if (heros) id = this.plan.pions.find((t) => t.ref === `aventurier:${heros}`)?.id || null;
    else if (adversaire) {
      for (const [pion, a] of adversairesSurPlan(this.plan, this.jeu?.combat)) if (a.id === adversaire) id = pion;
    }
    if (!id) return toast(heros ? "Ce héros n'a pas de pion sur ce plan." : "Cet adversaire n'a pas de pion sur ce plan.");
    if (this.outil !== "pion" && this.outil !== "main") this.choisirOutil("main");
    this.selectionner({ genre: "pion", id });
    const t = this.plan.pions.find((x) => x.id === id);
    const { cam, lw, lh } = this.vue;
    const sx = (t.x - cam.x) * cam.z + lw / 2;
    const sy = (t.y - cam.y) * cam.z + lh / 2;
    if (sx < lw * 0.1 || sx > lw * 0.9 || sy < lh * 0.1 || sy > lh * 0.9) this.vue.animerVers({ x: t.x, y: t.y, hv: lh / cam.z }, 600);
  }

  jaugesVisibles() {
    if (this.voirJauges === undefined) this.voirJauges = lireJauges();
    return this.voirJauges;
  }

  caseJauges() {
    return `<label class="case" title="Santé, Psy, cartons et jeton d'avantage des héros, Santé des adversaires du combat en cours. La TV montre toujours ceux des héros."><input type="checkbox" data-jauges ${this.jaugesVisibles() ? "checked" : ""}> Jauges sur les pions</label>`;
  }

  // Les notes du MJ des pièces où ce héros vient d'entrer : dans ce panneau seulement, jamais sur la TV.
  notesEntree(t) {
    const en = this.entree;
    if (!en || en.pion !== t.id) return "";
    return en.pieces.map((id) => {
      const pc = lirePiece(this.plan, id);
      if (!pc) return "";
      return `<div class="entree-piece"><p class="lbl">Révélée en entrant : ${e(pc.nom || "Pièce")}</p>
        ${pc.notes ? `<p class="notes">${e(pc.notes)}</p>` : '<p class="aide">Aucune note du MJ pour cette pièce.</p>'}</div>`;
    }).join("");
  }

  panneauTexte(t) {
    return `
      <h2>Texte</h2>
      <label class="champ">Texte<input type="text" data-el="texte" value="${e(t.texte)}"></label>
      <label class="champ">Taille <output>${virgule(t.taille || 0.6)}</output><input type="range" min="0.3" max="2" step="0.1" data-el="taille" value="${e(t.taille || 0.6)}"></label>
      <label class="case"><input type="checkbox" data-el="mj" ${t.mj ? "checked" : ""}> Pour le MJ seulement</label>
      <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer</button></div>`;
  }

  // Les familiers de la tablée (fiche de l'aventurier, panneau « Familier ») : leur joueur les bouge depuis le coin.
  htmlFamiliers(pris) {
    const liste = this.aventuriers.flatMap((a) => (a.familiers || []).map((f, i) => ({ a, f, i })).filter(({ f }) => (f.nom || "").trim() || f.espece));
    if (!liste.length) return "";
    return `<h3>Les familiers</h3><div class="choix-pions">${liste.map(({ a, f, i }) => `<button data-pion='${e(JSON.stringify(["familier", `${a.id}:${i}`]))}' ${pris(["familier", `${a.id}:${i}`])}><span class="pastille" style="background:${e(a.couleur || "#888")}"></span>${e((f.nom || "").trim() || "Familier")} <small>(${e(String(a.nom || "").split(/[\s,]+/)[0])})</small></button>`).join("")}</div>
      <p class="aide">Son joueur le bouge depuis la table du coin, comme son héros (en combat, au tour du héros).</p>`;
  }

  panneauPions() {
    const choisi = this.optPion ? JSON.stringify(this.optPion) : "";
    const pris = (v) => (JSON.stringify(v) === choisi ? 'aria-pressed="true"' : "");
    const p = this.plan;
    return `
      <h2>Pions</h2>
      <p class="aide">Choisissez qui poser, puis cliquez sur le plan : un groupe se range autour du clic. Glissez un pion pour le déplacer ; les flèches le bougent d'une case.</p>
      <p class="aide">Plusieurs pions ensemble : Maj + clic (ou Ctrl, Cmd) les réunit, Maj + glisser sur le plan trace un rectangle ; glisser l'un d'eux les emmène tous, en formation. Maj + glisser un héros emmène tous les héros visibles.</p>
      ${this.boutonsSelection()}
      ${this.caseEntrer()}
      ${this.caseJauges()}
      <p class="aide">Un héros visible glissé (ou avancé aux flèches) dans une pièce cachée la révèle aux joueurs ; Ctrl+Z annule les deux. Un pion caché ne révèle rien.</p>
      <h3>La tablée</h3>
      ${this.aventuriers.length ? `<div class="choix-pions">${this.aventuriers.map((a) => `<button data-pion='${e(JSON.stringify(["aventurier", a.id]))}' ${pris(["aventurier", a.id])}><span class="pastille" style="background:${e(a.couleur || "#888")}"></span>${e(a.nom || "Sans nom")}</button>`).join("")}</div>
        <div class="actions"><button data-pion='${e(JSON.stringify(["aventurier", "*"]))}' ${pris(["aventurier", "*"])}>Toute la tablée</button></div>`
        : '<p class="aide">Aucun aventurier dans la tablée : créez-les dans l\'onglet Aventuriers.</p>'}
      ${this.htmlFamiliers(pris)}
      <h3>Adversaires</h3>
      <div class="deux">
        <label class="champ">Qui<select data-pion-choix="bestiaire">${[["Rangs", RANGS], ["Créatures", CREATURES], ["Gens", GENS]].map(([t, l]) => `<optgroup label="${t}">${l.map((b) => `<option value="${e(b.cle)}" ${this.choixBestiaire === b.cle ? "selected" : ""}>${e(b.nom)}</option>`).join("")}</optgroup>`).join("")}</select></label>
        <label class="champ">Combien<input type="number" min="1" max="20" value="${this.nombreEnnemis || 1}" data-pion-choix="nombre"></label>
      </div>
      <div class="actions"><button data-action="pion-ennemis" ${this.optPion?.[0] === "ennemi" ? 'aria-pressed="true"' : ""}>Poser</button></div>
      ${this.rencontres.length ? `<label class="champ">Une rencontre de la balance<select data-pion-choix="rencontre"><option value="">choisir…</option>${this.rencontres.map((r) => `<option value="${e(r.id)}">${e(r.nom)}</option>`).join("")}</select></label>` : ""}
      <h3>PNJ du carnet</h3>
      <label class="champ">PNJ<select data-pion-choix="pnj"><option value="">choisir…</option>${this.pnj.map((q) => `<option value="${e(q.id)}">${e(q.nom)}${q.connu ? "" : " (inconnu)"}</option>`).join("")}</select></label>
      <h3>Autre</h3>
      <div class="deux"><label class="champ">Nom<input type="text" data-pion-choix="libre" placeholder="Un cheval, un chariot…"></label><div class="actions bas"><button data-action="pion-libre">Poser</button></div></div>
      ${p.pions.length ? `<h3>Sur le plan <span class="compte">${p.pions.length}</span></h3>
        <ul class="liste-lieux">${p.pions.map((t) => `<li><button data-pion-liste="${e(t.id)}"><span class="pastille" style="background:${e(t.couleur || COULEURS_PIONS[t.genre] || "#888")}"></span>${e(t.nom)}${t.court ? ` ${e(t.court)}` : ""}${t.tombe ? '<span class="secret">au tapis</span>' : t.cache ? '<span class="secret">caché</span>' : ""}</button></li>`).join("")}</ul>
        <div class="actions"><button class="danger" data-action="pions-vider">Retirer tous les pions</button></div>` : ""}`;
  }

  // ---------------------------------------------------------------- saisie du panneau

  saisie(ev, change) {
    const el = ev.target;
    const d = el.dataset;
    const discret = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "file";
    const p = this.plan;
    // L'image de fond suit la saisie, et le plan se recale sur elle quand la valeur est validée.
    if (d.fond && p.fond) return this.saisieFond(el, change);
    if (discret !== change) return;
    // Lot H2 : les réglages d'un pion enrichi, de l'outil Images et d'une image posée.
    if (d.pionReglage) return reglerPion(this, el);
    if (d.imageReglage) return reglerImage(this, el);
    if (d.action === "fond-importer") return this.importerFond(el.files[0]);
    if (d.action === "uvtt-importer") {
      const fichier = el.files[0];
      // Le même fichier pourra être choisi de nouveau.
      el.value = "";
      return this.importerUvtt(fichier);
    }
    if (d.opt) {
      const [groupe, cle] = d.opt.split(".");
      const cible = { piece: this.optPiece, sol: this.optSol, porte: this.optPorte, brume: this.optBrume, nappe: this.optNappe, feu: this.optFeu, lumiere: this.optLumiere, sang: this.optSang }[groupe];
      cible[cle] = el.type === "range" ? +el.value : el.value;
      if (el.type === "range") el.closest(".champ").querySelector("output").textContent = `${+el.value * 2 - 1} case${+el.value > 1 ? "s" : ""}`;
      return this.majCurseur();
    }
    if (d.gen) return;
    if (d.teinteLibre) return this.poserTeinte(d.teinteLibre, el.value, false);
    if (d.etapeNom !== undefined) {
      const et = Number.isInteger(p.etape) ? p.etapes[p.etape] : null;
      if (!et) return;
      if (this.derniereSaisie !== `etape:${p.etape}`) this.instantane();
      this.derniereSaisie = `etape:${p.etape}`;
      et.nom = el.value.trim().slice(0, 60) || `Étape ${p.etape + 1}`;
      this.majEtapes();
      return this.modifie();
    }
    if (d.entrer !== undefined) {
      this.entrerRevele = el.checked;
      garderEntrer(el.checked);
      return;
    }
    if (d.jauges !== undefined) {
      this.voirJauges = el.checked;
      garderJauges(el.checked);
      this.vue.demander();
      return;
    }
    // Les réglages du sang : taille, fraîcheur, caché aux joueurs (le prochain trait, pas ce qui est déjà posé).
    if (d.sangReglage) {
      const k = d.sangReglage;
      this.optSang[k] = el.type === "checkbox" ? el.checked : +el.value;
      if (el.type === "range") el.closest(".champ").querySelector("output").textContent = k === "age" ? (this.optSang.age < 0.25 ? "frais" : this.optSang.age < 0.65 ? "récent" : "sec") : String(Math.round(this.optSang.taille * 10) / 10).replace(".", ",");
      return this.majCurseur();
    }
    if (d.habIdee !== undefined) {
      this.optHab.idee = el.value;
      return;
    }
    if (d.amb) {
      const h = p.habillage;
      if (!h) return;
      if (this.derniereSaisie !== `amb:${d.amb}`) this.instantane();
      this.derniereSaisie = `amb:${d.amb}`;
      const base = h.ambiance && typeof h.ambiance === "object" ? h.ambiance : AMBIANCES[h.heure] || AMBIANCES.soir;
      h.ambiance = { ...base, [d.amb]: d.amb === "force" ? +el.value : el.value };
      if (el.type === "range") el.closest(".champ").querySelector("output").textContent = virgule(+el.value);
      this.vue.rafraichirTout();
      return this.modifie();
    }
    if (d.pionChoix) {
      if (d.pionChoix === "bestiaire") this.choixBestiaire = el.value;
      if (d.pionChoix === "nombre") this.nombreEnnemis = Math.max(1, Math.min(20, +el.value || 1));
      if (d.pionChoix === "rencontre" && el.value) {
        this.optPion = ["rencontre", el.value];
        toast("Cliquez sur le plan pour poser la rencontre.");
      }
      if (d.pionChoix === "pnj" && el.value) {
        this.optPion = ["pnj", el.value];
        toast("Cliquez sur le plan pour poser le PNJ.");
      }
      return;
    }
    if (d.p) {
      const k = d.p;
      if (el.type !== "checkbox" && el.tagName !== "SELECT" && change) return;
      if (k === "brouillard_actif" && !el.checked) return this.couperBrouillard(el);
      if (!["nom", "etage", "notes", "feu_effet"].includes(k) || !this.derniereSaisie || this.derniereSaisie !== k) this.instantane();
      this.derniereSaisie = k;
      p[k] = el.type === "checkbox" ? el.checked : k === "m_case" ? +el.value : el.value;
      if (k === "nom") Object.assign(this.dom.querySelector(".nom-carte"), { textContent: p.nom, title: p.nom });
      if (k === "quadrillage" || k === "brouillard_actif") this.vue.rafraichirTout();
      this.modifie(k === "brouillard_actif");
      return;
    }
    if (d.pieceSol !== undefined) {
      const id = this.selection?.id;
      this.instantane();
      for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.piece[i] === id) p.sol[i] = +el.value;
      this.vue.rafraichirTout();
      return this.modifie();
    }
    if (d.el) {
      const o = this.element();
      if (!o) return;
      if (el.type !== "checkbox" && el.tagName !== "SELECT" && change) return;
      const k = d.el;
      // Une taille vide ou nulle (en cours de frappe) ne s'applique pas : un meuble garde au moins une case.
      if ((k === "l" || k === "h") && !(Math.round(+el.value) >= 1)) return;
      if (this.derniereSaisie !== `${this.selection.id}:${k}`) this.instantane();
      this.derniereSaisie = `${this.selection.id}:${k}`;
      if (this.selection.genre === "hab-lumiere" && k === "type") {
        // Un autre type remet les réglages d'origine de ce type : la fiche se redessine avec les nouvelles valeurs.
        lum.changerType(o, el.value);
        this.vue.rafraichirTout();
        this.afficherPanneau();
        return this.modifie();
      }
      if (this.selection.genre === "hab-lumiere") lum.regler(o, k, el.type === "checkbox" ? el.checked : el.value);
      else o[k] = el.type === "checkbox" ? el.checked : ["l", "h", "taille"].includes(k) || el.type === "range" ? +el.value : el.value;
      // L'étiquette d'habillage d'une pièce porte son nom : elle suit quand le MJ la renomme.
      if (this.selection.genre === "piece" && k === "nom" && Array.isArray(p.habillage?.legende)) {
        for (const l of p.habillage.legende) if (l.piece === o.id) l.texte = o.nom;
      }
      // Le titre du panneau suit la frappe ; une pièce qui reçoit un nom rappelle qu'il ne va sur la TV que coché.
      if (k === "nom" && (this.selection.genre === "piece" || this.selection.genre === "pion")) {
        const titre = this.panneau.querySelector("h2");
        if (titre) titre.textContent = o.nom || (this.selection.genre === "piece" ? "Pièce" : "Pion");
      }
      if (this.selection.genre === "piece" && (k === "nom" || k === "nom_visible")) {
        const aide = this.panneau.querySelector(".aide-nom-tv");
        if (aide) aide.hidden = Boolean(o.nom_visible) || !String(o.nom || "").trim();
      }
      if (this.selection.genre === "meuble" && (k === "l" || k === "h")) {
        o[k] = Math.min(12, Math.round(o[k]));
        this.bornerMeuble(o);
      }
      // Une nouvelle taille se recale : au centre d'une case pour un petit, un moyen ou un énorme, au coin commun pour
      // un grand ou un gigantesque.
      if (this.selection.genre === "pion" && k === "taille") this.calerPion(o);
      if (this.selection.genre === "piece" && k === "genre") this.structure(null);
      else if (this.selection.genre === "pion") this.vue.demander();
      else if (this.selection.genre !== "hab-lumiere" || k !== "source") this.vue.rafraichirTout();
      if (this.selection.genre === "porte" && k === "genre") {
        if (o.genre === "secrete" && o.decouverte === undefined) o.decouverte = false;
        this.afficherPanneau();
      }
      if (el.type === "range") el.closest(".champ").querySelector("output").textContent = virgule(+el.value);
      this.modifie(this.selection.genre === "pion" || k === "decouverte");
    }
  }

  // Sans brouillard, la TV montre tout, trésor compris : si elle montre ce plan, on le demande d'abord.
  async couperBrouillard(el) {
    el.checked = true;
    if ((await this.surLaTable()) && !(await demander({ titre: "Couper le brouillard", texte: "La TV montre ce plan : sans brouillard, les joueurs y verront tout, pièces cachées et trésor compris.", oui: "Couper le brouillard", non: "Le garder", danger: true }))) return;
    if (this.detruit) return;
    this.instantane();
    this.derniereSaisie = "brouillard_actif";
    this.plan.brouillard_actif = false;
    for (const c of this.panneau.querySelectorAll('[data-p="brouillard_actif"]')) c.checked = false;
    this.vue.rafraichirTout();
    this.modifie(true);
  }

  // Image de fond : une étape d'annulation par réglage, prise avant la première touche. La largeur change l'aperçu à
  // mesure ; le plan se recale sur l'image, plus grand ou plus petit, quand la valeur est validée.
  saisieFond(el, change) {
    const f = this.plan.fond;
    const k = el.dataset.fond;
    if (el.type === "checkbox") {
      if (!change) return;
      this.instantane();
      f[k] = el.checked;
      this.vue.majStructure(null);
      return this.modifie();
    }
    const v = +el.value;
    if (el.value.trim() === "" || !Number.isFinite(v) || (k === "l" && v < 1)) {
      if (change) el.value = f[k] ?? (k === "opacite" ? 1 : 0);
      return;
    }
    if (this.derniereSaisie !== `fond:${k}`) this.instantane();
    this.derniereSaisie = change ? null : `fond:${k}`;
    const ratio = f.ratio || f.h / f.l;
    f[k] = v;
    if (k === "l") f.h = Math.round(v * ratio * 100) / 100;
    if (change && k !== "opacite") this.calerFond();
    else this.vue.majStructure(null);
    this.modifie();
  }

  async actionPanneau(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    const p = this.plan;
    if (d.pionAction) return actionPion(this, b);
    if (d.imageAction) return actionImage(this, b);
    if (d.optBouton) {
      const [groupe, cle] = d.optBouton.split(".");
      const cible = { piece: this.optPiece, sol: this.optSol, porte: this.optPorte, meuble: this.optMeuble, brume: this.optBrume, nappe: this.optNappe, feu: this.optFeu, lumiere: this.optLumiere, sang: this.optSang }[groupe];
      cible[cle] = ["sol", "valeur"].includes(cle) ? +d.valeur : d.valeur;
      return this.afficherPanneau();
    }
    if (d.lum) return this.actionLumiere(d);
    if (d.sang) return this.actionSang(d);
    if (d.teinte) return this.poserTeinte(d.teinte, d.valeur, true);
    if (d.lumiere !== undefined) return this.poserLumiere(d.lumiere);
    if (d.pieceListe) {
      const id = +d.pieceListe;
      if (this.outil === "brouillard") return this.basculerPieceParId(id);
      this.selectionner({ genre: "piece", id });
      const bt = boitePiece(p, id);
      if (bt) this.vue.animerVers({ x: (bt.x0 + bt.x1) / 2, y: (bt.y0 + bt.y1) / 2, hv: Math.max(bt.y1 - bt.y0, (bt.x1 - bt.x0) * this.vue.lh / this.vue.lw) + 4 }, 600);
      return;
    }
    // Un pion de la liste : choisi seul, ou ajouté et retiré en sélection multiple.
    if (d.pionListe) return this.selectionner(this.multiple ? selectionDe(p.pions, basculer(idsDe(this.selection), d.pionListe)) : { genre: "pion", id: d.pionListe });
    if (d.pion) {
      this.optPion = JSON.parse(d.pion);
      this.afficherPanneau();
      return toast("Cliquez sur le plan pour poser.");
    }
    if (d.agrandir) return this.agrandir(d.agrandir);
    const a = d.action;
    if (a === "tourner-g") return this.tourner(-1);
    if (a === "tourner-d") return this.tourner(1);
    // L'orientation de la palette vaut pour le prochain meuble, même quand celui qu'on vient de poser est sélectionné.
    if (a === "tourner-pose-g" || a === "tourner-pose-d") {
      this.optMeuble.rot = (this.optMeuble.rot + (a === "tourner-pose-d" ? 90 : 270)) % 360;
      return this.afficherPanneau();
    }
    if (a === "pion-ennemis") {
      this.optPion = ["ennemi", this.choixBestiaire || RANGS[0].cle, this.nombreEnnemis || 1];
      this.afficherPanneau();
      return toast("Cliquez sur le plan pour poser.");
    }
    if (a === "pion-libre") {
      const nom = this.panneau.querySelector('[data-pion-choix="libre"]').value.trim();
      this.optPion = ["libre", nom || "Pion"];
      return toast("Cliquez sur le plan pour poser.");
    }
    if (a === "pions-vider") {
      if (!(await demander({ titre: "Retirer tous les pions", texte: "Héros, adversaires et PNJ quittent le plan.", aide: "Ctrl+Z revient en arrière.", oui: "Retirer les pions" })) || this.detruit) return;
      this.instantane();
      p.pions = [];
      this.vue.demander();
      this.afficherPanneau();
      return this.modifie(true);
    }
    if (a === "multi-bascule") return this.basculerMultiple();
    if (a === "multi-heros") return this.choisirLesHeros();
    if (a === "groupe-cacher" || a === "groupe-montrer") return this.cacherPions(a === "groupe-cacher");
    if (a === "groupe-lacher") return this.selectionner(null);
    if (a === "pion-carton" || a === "pion-carton-retirer") return this.cartonPion(this.element(), a === "pion-carton");
    if (a === "brume-partout") return this.brumePartout();
    if (a === "brume-teinte") return this.teinterBrume(d.valeur);
    if (a === "brume-dissiper") return this.dissiperBrume();
    if (a === "feu-eteindre") return this.eteindreFeu();
    if (a === "feu-calciner") return this.calcinerFeu();
    if (a === "etape-rappeler") return this.appliquerEtape(+d.etape);
    if (a === "etape-ajouter") return this.ajouterEtape();
    if (a === "etape-garder") return this.garderEtape();
    if (a === "etape-retirer") return this.retirerEtape();
    if (a === "tout-reveler") return this.toutReveler(1);
    if (a === "tout-cacher") return this.toutReveler(0);
    if (a === "table-cadrer") return this.cadrageAuto();
    if (a === "piece-reveler" || a === "piece-cacher") return this.revelerPiece(this.selection.id, a === "piece-reveler");
    if (a === "piece-montrer") {
      const id = this.selection.id;
      this.revelerPiece(id, true);
      const bt = boitePiece(p, id);
      return this.envoyerTable({ forcer: true, camera: { x: (bt.x0 + bt.x1) / 2, y: (bt.y0 + bt.y1) / 2, hv: Math.max(bt.y1 - bt.y0 + 4, ((bt.x1 - bt.x0 + 4) * 9) / 16, 8) }, annonce: true });
    }
    if (a === "supprimer-selection") return this.supprimerSelection();
    if (a === "relancer") {
      const champ = this.panneau.querySelector('[data-gen="graine"]');
      const avant = champ.value;
      champ.value = Math.floor(Math.random() * 1e6);
      if (!(await this.generer())) champ.value = avant;
      return;
    }
    if (a === "generer") return this.generer();
    if (a === "programmer") return this.programmer(b);
    if (a === "hab-heure") {
      this.optHab.heure = d.valeur;
      return this.afficherPanneau();
    }
    if (a === "habiller") return this.habiller();
    if (a === "hab-heure-garde") return this.heureHabillage(d.valeur);
    if (a === "hab-retirer") return this.retirerHabillage();
    if (a === "ajuster") return this.ajuster();
    if (a === "fond-retirer") {
      if (!(await demander({ titre: "Retirer l'image de fond", texte: "Le plan garde ses pièces, ses portes et ses pions.", aide: "Ctrl+Z revient en arrière.", oui: "Retirer l'image" })) || this.detruit) return;
      this.instantane();
      p.fond = null;
      this.vue.majStructure(null);
      this.afficherPanneau();
      return this.modifie();
    }
    if (a === "supprimer") {
      // Sans confirmation : le dernier tracé part d'abord (le plan reviendra entier), puis « Annuler » dix secondes.
      await this.vider();
      try {
        await api.del(`/api/plans/${p.id}`);
      } catch (err) {
        return toast(`Suppression impossible : ${err.message}`, "erreur");
      }
      // Plus rien à enregistrer pour un plan à la corbeille.
      this.suspendu = true;
      this.sauver.annuler();
      this.reessai.arreter();
      this.etatSauvegarde = "ok";
      annoncerCorbeille(`« ${p.nom} » mis à la corbeille.`, "plans", p.id, { retour: `#/plan/${p.id}` });
      location.hash = "#/cartes";
    }
  }

  basculerPieceParId(id) {
    const p = this.plan;
    const reveler = p.sol.some((s, i) => s && p.piece[i] === id && p.brouillard[i] !== 1);
    this.revelerPiece(id, reveler);
  }

  // Le plan est-il tel que son générateur le donne ? Des pions, des textes, une note, une pièce révélée, un meuble
  // déplacé ou une image de fond : c'est un plan retouché, qu'on ne remplace pas sans le demander.
  retouche() {
    const p = this.plan;
    if (p.pions.length || p.textes.length || p.fond || this.habillageGarde() || p.brume.some((v) => v) || p.feu.some((v) => v) || p.etapes.length) return true;
    const g = p.generateur;
    const ref = g && g.modele !== "vierge" ? generer(g.modele, g.graine) : { sol: [], piece: [], brouillard: [], pieces: [], portes: [], objets: [] };
    const empreinte = (q) => JSON.stringify([
      q.sol.some(Boolean) ? [q.largeur, q.hauteur, q.sol, q.piece] : [],
      q.brouillard.some(Boolean) ? q.brouillard : [],
      q.pieces,
      q.portes.map(({ id, ...d }) => d),
      q.objets.map(({ id, ...o }) => o),
    ]);
    return empreinte(p) !== empreinte(ref);
  }

  // Rend vrai si le plan a été remplacé.
  async generer() {
    const modele = this.panneau.querySelector('[data-gen="modele"]').value;
    const graine = +this.panneau.querySelector('[data-gen="graine"]').value || 1;
    if (this.retouche() && !(await demander(QUESTION_RETOUCHE("par un plan généré")))) return false;
    if (this.detruit) return false;
    this.appliquerGeneration(generer(modele, graine));
    return true;
  }

  appliquerGeneration(g) {
    const p = this.plan;
    // Un plan neuf : l'habillage de l'ancien (proposé ou gardé) ne lui va plus.
    if (this.apercu) this.ecarterApercu({ dessiner: false });
    this.instantane();
    for (const k of ["largeur", "hauteur", "sol", "piece", "brouillard", "pieces", "portes", "objets", "textes", "generateur"]) p[k] = g[k];
    // Un plan extérieur vient avec sa lumière (le jour) ; les autres gardent celle du plan.
    if (g.lumiere) p.lumiere = g.lumiere;
    p.brume = Array(p.largeur * p.hauteur).fill(0);
    p.feu = Array(p.largeur * p.hauteur).fill(0);
    p.etapes = [];
    p.etape = null;
    p.pions = p.pions.filter((t) => dedans(p, Math.floor(t.x), Math.floor(t.y)));
    for (const t of p.pions) this.bornerPion(t);
    // Un plan importé (UVTT) vient avec son image de fond et son quadrillage éteint ; un plan généré n'a pas de fond.
    p.fond = g.fond || null;
    if (typeof g.quadrillage === "boolean") p.quadrillage = g.quadrillage;
    p.habillage = null;
    this.selection = null;
    this.vue.selection = null;
    this.vue.charger(p);
    this.vue.cadrer();
    this.afficherPanneau();
    this.modifie();
  }

  // Le programme vient de la rédaction (modèle et salles décrites) ; parmi les graines du modèle, on garde le plan dont le
  // nombre de salles (couloirs et passages secrets à part) colle le mieux, puis chaque salle reçoit son nom et ses notes.
  async programmer(bouton) {
    const demande = this.panneau.querySelector("[data-programme]")?.value.trim() || "";
    if (!demande) return toast("Décrivez d'abord le plan voulu.", "erreur");
    const p = this.plan;
    if (this.retouche() && !(await demander(QUESTION_RETOUCHE("par le plan programmé")))) return;
    bouton.disabled = true;
    bouton.textContent = "Préparation du plan…";
    let r;
    try {
      r = await api.post("/api/plans/programme", { demande, lieu: p.lieu || "" });
    } catch (err) {
      toast(`Rien de programmé : ${erreurIA(err, "le générateur et les outils de tracé restent là")}.`, "erreur");
      return this.afficherPanneau();
    }
    const voulu = r.salles.length;
    const salles = (q) => q.pieces.filter((pc) => !/^(Couloir|Passage secret)/.test(pc.nom || ""));
    let meilleur = null;
    // Un plan extérieur a toujours assez de zones : une seule graine suffit (et une ville se génère moins vite).
    const essais = MODELES.find((m) => m.cle === r.modele)?.dehors ? 1 : 300;
    for (let i = 0, graine = 1 + Math.floor(Math.random() * 1e6); i < essais; i += 1, graine += 1) {
      const g = generer(r.modele, graine);
      const n = salles(g).length;
      const ecart = n >= voulu ? n - voulu : 100 + voulu - n;
      if (!meilleur || ecart < meilleur.ecart) meilleur = { g, ecart };
      if (ecart === 0) break;
    }
    this.appliquerGeneration(meilleur.g);
    const principales = salles(p);
    const note = (s) => [s.role && `Rôle : ${s.role}`, s.joueurs && `Ce que voient les joueurs : ${s.joueurs}`, s.notes,
      s.piege && `Piège : ${s.piege}`, s.indice && `Indice : ${s.indice}`, s.rencontre && `Rencontre : ${s.rencontre}`].filter(Boolean).join("\n");
    r.salles.forEach((s, i) => {
      if (!principales[i]) return;
      principales[i].nom = s.nom || principales[i].nom;
      principales[i].notes = note(s);
    });
    const restees = r.salles.slice(principales.length);
    p.notes = [p.notes, r.notes, ...restees.map((s) => `${s.nom} (sans salle sur le plan) :\n${note(s)}`)].filter(Boolean).join("\n\n");
    if (r.nom && (!p.nom || /sans nom|^nouveau plan/i.test(p.nom))) p.nom = r.nom;
    if (restees.length) toast(`Le modèle n'offrait que ${principales.length} salles : ${restees.length} description(s) rangée(s) dans les notes du plan.`);
    else toast("Plan programmé : chaque salle a ses notes ; relisez-les, retouchez à volonté (Ctrl+Z revient en arrière).");
    this.afficherPanneau();
    this.modifie();
  }

  // Ajoute (n > 0) ou retire (n < 0) des cases d'un côté ; tout ce qui est posé suit. Ce qui tomberait hors du plan
  // est signalé, jamais retiré en silence.
  redimensionner(g, h, d, b, { panneau = true } = {}) {
    const p = this.plan;
    const W = p.largeur + g + d;
    const H = p.hauteur + h + b;
    if (W < 4 || H < 4 || W > 160 || H > 160) return toast("Taille hors limites (4 à 160 cases).");
    const recopie = (t) => {
      const n = Array(W * H).fill(0);
      for (let y = 0; y < p.hauteur; y++) for (let x = 0; x < p.largeur; x++) {
        const nx = x + g;
        const ny = y + h;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) n[ny * W + nx] = t[y * p.largeur + x];
      }
      return n;
    };
    p.sol = recopie(p.sol);
    p.piece = recopie(p.piece);
    p.brouillard = recopie(p.brouillard);
    p.brume = recopie(p.brume);
    p.feu = recopie(p.feu);
    for (const et of p.etapes) {
      et.feu = recopie(et.feu);
      et.brume = recopie(et.brume);
    }
    for (const liste of [p.portes, p.objets, p.pions, p.textes]) for (const o of liste) {
      o.x += g;
      o.y += h;
    }
    // L'habillage suit aussi (le gardé, et celui d'avant si une proposition est en aperçu).
    for (const hab of new Set([p.habillage, this.apercu?.avant])) {
      if (!hab || typeof hab !== "object") continue;
      for (const o of Array.isArray(hab.objets) ? hab.objets : []) if (Array.isArray(o.case)) o.case = [o.case[0] + g, o.case[1] + h];
      for (const l of [...(Array.isArray(hab.lumieres) ? hab.lumieres : []), ...(Array.isArray(hab.legende) ? hab.legende : [])]) {
        l.x += g;
        l.y += h;
      }
    }
    if (p.fond) {
      p.fond.x = (p.fond.x || 0) + g;
      p.fond.y = (p.fond.y || 0) + h;
    }
    p.largeur = W;
    p.hauteur = H;
    const avant = p.portes.length + p.objets.length + p.pions.length;
    p.portes = p.portes.filter((q) => q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H);
    p.objets = p.objets.filter((o) => o.x >= 0 && o.y >= 0 && emprise(o).x1 <= W && emprise(o).y1 <= H);
    p.pions = p.pions.filter((t) => t.x >= 0 && t.y >= 0 && t.x <= W && t.y <= H);
    const perdus = avant - (p.portes.length + p.objets.length + p.pions.length);
    this.oublierPiecesVides();
    this.nettoyerPortes();
    this.nettoyerHabillage();
    this.vue.charger(p);
    this.vue.cadrer();
    if (panneau) this.afficherPanneau();
    else {
      const taille = this.panneau.querySelector("[data-taille]");
      if (taille) taille.textContent = `${W} × ${H}`;
    }
    this.modifie();
    if (perdus) toast(`${perdus} élément${perdus > 1 ? "s" : ""} hors du plan retiré${perdus > 1 ? "s" : ""} : Ctrl+Z revient en arrière.`, "erreur");
  }

  agrandir(cote) {
    this.instantane();
    const k = 4;
    this.redimensionner(cote === "gauche" ? k : 0, cote === "haut" ? k : 0, cote === "droite" ? k : 0, cote === "bas" ? k : 0);
  }

  // Ce qui est tracé ou posé (sols, meubles, pions, textes, portes), en cases : rien de cela ne doit tomber hors du plan.
  etendue() {
    const p = this.plan;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const prendre = (a, b, c, d) => {
      x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    };
    for (let y = 0; y < p.hauteur; y++) for (let x = 0; x < p.largeur; x++) if (p.sol[idx(p, x, y)]) prendre(x, y, x + 1, y + 1);
    for (const o of p.objets) {
      const b = emprise(o);
      prendre(b.x0, b.y0, b.x1, b.y1);
    }
    for (const t of p.pions) {
      const r = (t.taille || 1) / 2;
      prendre(t.x - r, t.y - r, t.x + r, t.y + r);
    }
    for (const t of [...p.textes, ...p.portes]) prendre(t.x, t.y, t.x, t.y);
    if (x0 === Infinity) return null;
    return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
  }

  ajuster() {
    const p = this.plan;
    // Avec une image de fond, la taille suit l'image et ce qui dépasse d'elle.
    if (p.fond) {
      const { W, H } = this.tailleFond();
      if (W === p.largeur && H === p.hauteur) return toast("Le plan suit déjà l'image de fond.");
      this.instantane();
      return this.calerFond();
    }
    const b = this.etendue();
    if (!b) return toast("Le plan est vide.");
    this.instantane();
    const m = 2;
    this.redimensionner(m - b.x0, m - b.y0, m - (p.largeur - b.x1), m - (p.hauteur - b.y1));
  }

  async importerFond(fichier) {
    if (!fichier) return;
    const donnees = new FormData();
    donnees.append("image", fichier);
    try {
      const { url } = await api.post("/api/images", donnees);
      const img = await chargerImage(url);
      if (this.detruit) return;
      this.instantane();
      const p = this.plan;
      const l = p.largeur;
      p.fond = { url, x: 0, y: 0, l, h: Math.round((l * img.naturalHeight / img.naturalWidth) * 100) / 100, opacite: 1, dessiner: false, ratio: img.naturalHeight / img.naturalWidth };
      this.calerFond();
      this.afficherPanneau();
      this.modifie();
      toast("Image posée : réglez sa largeur en cases pour caler le quadrillage.");
    } catch (err) {
      toast(`Import impossible : ${err.message || "image illisible"}`, "erreur");
    }
  }

  // Un plan Universal VTT (importer-uvtt.js, uvtt.js) : il remplace le plan comme un plan généré, avec son image en fond,
  // ses pièces et ses portes ; le bilan dit ce qui s'est perdu, et laisse défaire l'import.
  async importerUvtt(fichier) {
    if (!fichier) return;
    if (this.retouche() && !(await demander(QUESTION_RETOUCHE("par le plan importé")))) return;
    if (this.detruit) return;
    const etat = attente("Import du plan");
    let r;
    try {
      r = await importerUvtt(fichier, etat.dire);
    } catch (err) {
      etat.fermer();
      return toast(`Import impossible : ${err.message || "fichier illisible"}`, "erreur");
    }
    etat.fermer();
    if (this.detruit) return;
    const n = r.plan.largeur * r.plan.hauteur;
    this.appliquerGeneration({ ...r.plan, brouillard: Array(n).fill(0), objets: [], textes: [], generateur: { modele: "vierge", graine: 1 } });
    if (!(await demander({ titre: "Plan importé", texte: r.phrases, oui: "Garder ce plan", non: "Défaire l'import" })) && !this.detruit) this.annuler();
  }

  // La taille que demande l'image de fond : l'image entière, et tout ce qui est tracé ou posé au-delà.
  tailleFond() {
    const p = this.plan;
    const f = p.fond;
    const b = this.etendue();
    return {
      W: Math.min(160, Math.max(4, Math.ceil((f.x || 0) + f.l), b ? b.x1 : 0)),
      H: Math.min(160, Math.max(4, Math.ceil((f.y || 0) + f.h), b ? b.y1 : 0)),
    };
  }

  // La hauteur de l'image suit sa largeur ; le plan se cale sur l'image, plus grand ou plus petit, sans rien rogner.
  calerFond() {
    const p = this.plan;
    const f = p.fond;
    if (!f) return;
    f.h = Math.round(f.l * (f.ratio || f.h / f.l) * 100) / 100;
    const { W, H } = this.tailleFond();
    if (Math.ceil((f.x || 0) + f.l) > 160 || Math.ceil((f.y || 0) + f.h) > 160) toast("L'image dépasse la taille maximale d'un plan (160 cases) : elle est rognée.");
    if (W !== p.largeur || H !== p.hauteur) this.redimensionner(0, 0, W - p.largeur, H - p.hauteur, { panneau: false });
    else this.vue.majStructure(null);
  }

  // ---------------------------------------------------------------- table et export

  // Safari sur iPad refuse une toile de plus de 16,7 millions de pixels (le fichier sort vide) : l'échelle se plafonne
  // selon la largeur et la hauteur, et un échec se dit.
  async exporter(joueurs) {
    this.dom.querySelector(".menu-exporter .menu").hidden = true;
    const { largeur: w, hauteur: h } = this.plan;
    const plafond = Math.floor(Math.sqrt(16e6 / (w * h)));
    const echelle = Math.max(1, Math.min(plafond, Math.max(32, Math.min(96, Math.floor(6000 / Math.max(w, h))))));
    toast("Préparation de l'image…");
    try {
      const blob = await this.vue.exporter(echelle, joueurs);
      if (!blob) throw new Error("le navigateur n'a pas pu fabriquer l'image");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${this.plan.id}${joueurs ? "-joueurs" : "-mj"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      toast(`Export impossible : ${err.message}`, "erreur");
    }
  }

  async lireTable() {
    try {
      this.tableRecue(await api.get("/api/table"));
    } catch {
      this.majEcrans(null);
      this.porteeRelue();
    }
  }

  // L'état de la table, relu d'ici ou annoncé par le témoin de l'en-tête (etat-tv.js) : un autre écran a pu la changer.
  tableRecue(t) {
    if (this.detruit) return;
    this.majEcrans(t.ecrans);
    this.tableIci = t.vue === "plan" && t.plan === this.plan.id;
    this.majRetour(t);
    this.porteeRelue();
  }

  // Une illustration montrée depuis une fiche recouvre ce plan : la vue qu'elle a notée pour y revenir.
  retourDe(t) {
    const a = t && t.vue === "image" && t.avant && t.avant.vue === "plan" ? t.avant : null;
    return a && (a.plan || t.plan) === this.plan.id ? a : null;
  }

  // « Montrer à la TV » devient alors « Revenir au plan », qui le remet avec le cadrage d'avant l'image.
  majRetour(t) {
    this.retour = this.retourDe(t);
    this.boutonTv?.maj(t || undefined);
  }

  // « Montrer à la TV » : un plan sous brouillard part cadré sur ce qui est révélé, et la TV suit les pièces révélées
  // ensuite (le cadrage de cet écran reste pour « Suivre »). Si rien n'est révélé, la TV serait noire : une question
  // d'abord, qui propose de révéler la pièce où se tiennent les héros.
  async montrerALaTv() {
    if (this.retour) return this.envoyerTable({ forcer: true, annonce: true, retour: true });
    const p = this.plan;
    if (rienDeRevele(p)) {
      const ids = piecesEntrees(p, p.pions || []);
      const choix = await questionTvNoire({ nom: p.nom, pieces: ids.map((id) => lirePiece(p, id)?.nom || "la pièce") });
      if (this.detruit || !choix) return;
      if (choix === "choisir") {
        this.choisirOutil("brouillard");
        return toast("Cliquez la pièce où entrent les héros : elle se révèle. Puis « Montrer à la TV ».");
      }
      if (choix === "reveler") {
        this.instantane();
        for (const id of ids) marquerPiece(p, id, 1);
        this.vue.rafraichirTout();
        this.afficherPanneau();
        this.modifie(true);
      }
    }
    return this.envoyerTable({ forcer: true, annonce: true, cadrageAuto: Boolean(p.brouillard_actif) });
  }

  // Le cadrage automatique rendu à la TV, après un cadrage à la main (Suivre, « Révéler et montrer ») : elle se cadre sur ce
  // qui est révélé, au-dessus de la légende des héros, et suit chaque pièce révélée. Suivre s'arrête, sinon le prochain
  // mouvement de cet écran la recadrerait.
  cadrageAuto() {
    if (this.suivre) {
      this.suivre = false;
      const bascule = this.dom?.querySelector('[data-action="table-suivre"]');
      if (bascule) bascule.checked = false;
    }
    return this.envoyerTable({ forcer: true, cadrageAuto: true, annonce: "À la TV : le plan, cadré sur ce qui est révélé." });
  }

  // La TV montre-t-elle ce plan en ce moment ? Relu à la source : un autre écran a pu la changer.
  async surLaTable() {
    await this.lireTable();
    return this.tableIci;
  }

  majEcrans(n) {
    // Ce que l'outil Pointeur en dit (null : la table n'a pas répondu).
    this.ecransTable = Number.isFinite(n) ? n : null;
    const el = this.dom?.querySelector(".ecrans");
    if (!el) return;
    el.textContent = n === null || n === undefined ? "" : n ? `${n} écran${n > 1 ? "s" : ""}` : "Aucun écran";
    el.dataset.actif = n ? "oui" : "non";
  }

  // Un geste du MJ (Montrer, Suivre coché, Cadrer, Révéler et montrer) met ce plan sur la TV. Le reste (enregistrement,
  // caméra suivie) ne la met à jour que si elle montre encore ce plan : un autre écran a pu y mettre autre chose.
  // Un envoi à la fois : la TV ne reçoit jamais une version plus ancienne après une plus récente.
  envoyerTable(opts = {}) {
    this.fileTable = this.fileTable.then(() => this.pousserTable(opts));
    return this.fileTable;
  }

  async pousserTable(opts) {
    try {
      // La TV lit la version enregistrée : ce qui attend part d'abord.
      if (!opts.apresEnregistrement) await this.vider();
      const actuel = await api.get("/api/table");
      // Une pièce où les héros viennent d'entrer : l'envoi qui suit l'enregistrement s'en charge, une seule fois.
      const elargir = opts.apresEnregistrement ? this.elargir : null;
      if (elargir) this.elargir = null;
      const ici = actuel.vue === "plan" && actuel.plan === this.plan.id;
      if (!ici && !opts.forcer) return this.tableAilleurs(actuel);
      // Après un enregistrement, la TV garde son cadrage (sauf si elle suit celui de cet écran), élargi à la pièce où
      // les héros viennent d'entrer si elle en sort. Au retour d'une image, elle reprend celui d'avant l'image, s'il la
      // recouvre encore.
      const retour = opts.retour ? this.retourDe(actuel) : null;
      const garde = actuel.camera ?? null;
      // Sans caméra (cadrage automatique), la TV se cadre elle-même sur ce qui est révélé, et suit chaque pièce révélée.
      const camera = retour ? retour.camera ?? null
        : opts.cadrageAuto ? null
        : opts.camera || (opts.apresEnregistrement && !this.suivre
          ? (garde && elargir && cameraElargie(this.plan, garde, elargir.revele, elargir.boite)) || garde
          : this.vue.cameraPartagee());
      const etat = { vue: "plan", plan: this.plan.id, camera, style: this.vue.style, version: this.plan.modifie };
      // Les cartons posés par-dessus (PNJ, rumeur, aventurier) restent pendant qu'on joue sur le plan.
      for (const k of ["pnj", "rumeur", "aventurier", "aventurier_maj"]) if (actuel[k]) etat[k] = actuel[k];
      const r = await api.put("/api/table", etat);
      this.majEcrans(r.ecrans);
      this.tableIci = true;
      this.porteeRelue();
      this.majRetour(null);
      if (opts.annonce) toast(!r.ecrans ? "Envoyé, mais aucun écran de table n'est branché." : retour ? "À la TV : le plan est revenu." : typeof opts.annonce === "string" ? opts.annonce : `À la TV : le plan «\u00a0${this.plan.nom}\u00a0»${rienDeRevele(this.plan) ? ", encore noir" : ""}.`);
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  // La TV montre autre chose : ce plan ne la reprend plus de lui-même.
  tableAilleurs(actuel) {
    this.majEcrans(actuel.ecrans);
    this.tableIci = false;
    this.porteeRelue();
    this.majRetour(actuel);
    if (!this.suivre) return;
    this.suivre = false;
    const bascule = this.dom?.querySelector('[data-action="table-suivre"]');
    if (bascule) bascule.checked = false;
    toast("La TV montre autre chose depuis un autre écran : elle ne suit plus ce plan.");
  }

  async tableAccueil() {
    try {
      const r = await api.put("/api/table", { vue: "accueil" });
      this.majEcrans(r.ecrans);
      this.tableIci = false;
      this.porteeRelue();
      this.majRetour(null);
      if (this.suivre) {
        this.suivre = false;
        this.dom.querySelector('[data-action="table-suivre"]').checked = false;
      }
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  // Le PNJ ou l'aventurier d'un pion : son carton peut passer sur la TV (un PNJ sans fiche chargée, non).
  cartonDuPion(t) {
    const [genre, id] = String(t?.ref || "").split(":");
    if (genre === "pnj") {
      const fiche = this.pnj.find((q) => q.id === id);
      return fiche ? { cle: "pnj", id, fiche } : null;
    }
    if (genre === "aventurier" && id) return { cle: "aventurier", id, fiche: this.aventuriers.find((a) => a.id === id) || { nom: t.nom } };
    return null;
  }

  // Comme depuis le carnet : un PNJ inconnu devient connu sur le « oui » de la question du carton, puis son carton se pose
  // par-dessus la vue.
  // L'envoi passe par la file de la table : un envoi du plan en cours ne fait pas disparaître le carton, ni l'inverse.
  async cartonPion(t, montrer) {
    const c = this.cartonDuPion(t);
    if (!c) return;
    const nom = c.fiche.nom || t.nom || "ce pion";
    // Une seule question, même pour un PNJ secret : il ne devient connu qu'après ce « oui ».
    if (montrer && c.cle === "pnj" && !(await cartonVerifie(c.id, nom, { secret: !c.fiche.connu }))) return;
    if (montrer && c.cle === "pnj" && !c.fiche.connu) {
      try {
        // Seul « connu » change : la fiche lue à l'ouverture du plan n'écrase rien de ce qu'un autre écran a écrit.
        Object.assign(c.fiche, await api.patch(`/api/pnj/${c.id}`, { connu: true }));
      } catch (err) {
        return toast(`Impossible de le rendre connu : ${err.message}`, "erreur");
      }
      if (this.element() === t) this.afficherPanneau();
    }
    const changements = c.cle === "pnj" ? { pnj: montrer ? c.id : null } : { aventurier: montrer ? c.id : null, aventurier_maj: Date.now() };
    this.fileTable = this.fileTable.then(async () => {
      try {
        const etat = await api.get("/api/table");
        delete etat.ecrans;
        const r = await api.put("/api/table", { ...etat, ...changements });
        this.majEcrans(r.ecrans);
        if (!montrer) return toast("Carton retiré de la table.");
        if (!r.ecrans) return toast("Envoyé, mais aucun écran de table n'est ouvert.");
        const de = /^[aeiouyàâéèêëîïôöùûœ]/i.test(nom) ? "d'" : "de ";
        toast(`Le carton ${de}${nom} est sur la TV.${t.cache ? " Son pion reste caché sur le plan." : ""}`);
      } catch (err) {
        toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
      }
    });
    return this.fileTable;
  }
}
