// Éditeur de carte : outils, sélection, panneau de propriétés, annulation, sauvegarde, pilotage de la table.

import { htmlCasePartage } from "../mj/partage.js";
import { api, copie, differer, echapper as e, erreurIA, fusionner, toast } from "../api.js";
import { lienVersions } from "../corbeille/corbeille.js";
import { donnerLaMain, rendreLaMain } from "../commun/clavier-editeur.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { peindreBoutonListe } from "../ecran-tv/table-tv.js";
import { Attente, DELAI, SEUIL, auDoigt } from "../commun/doigt.js";
import { Galerie } from "../illustrations/illustrations.js";
import { Pointeur, panneauPointeur, textePortee } from "../ecran-tv/pointeur.js";
import { montrerPointeursJoueurs } from "../commun/pointeurs-joueurs.js";
import { Reessai, injoignable } from "../commun/reessai.js";
import { B, BIOMES, ORDRE_PALETTE, PALETTES, STYLES_ETIQUETTES, TYPES_LIEUX, TYPES_TRACES } from "./biomes.js";
import { definitionsLieux, genererCratere, genererPaysCastelblanc, genererRegion } from "./generateur.js";
import { EXEMPLES_CARTES } from "../campagne/cartes-libelles.js";
import { decoderCarte, encoderCarte } from "./format.js";
import { OUTILS, tailleMarqueur } from "./outils.js";
import { cheminLePlusSur, clamp, distanceSegment, simplifier } from "./geo.js";
import { dansPolygone } from "./peint-habillage.js";
import { STYLES_TEXTE, pointsLisses, positionNom, styleNomLieu } from "./rendu.js";
import { AVIS_PAVE, VueCarte, chargerImage, chargerPolices, garderDefilement, lireDefilement, molette, premierGlisser } from "./vue.js";
import { htmlRetour, placeMentions } from "../liens/dans-les-scenarios.js";
import { adopterSurLaCarte, htmlPnjIci, monterPanneauLieu, suivreNomSurLaCarte } from "../lieux/panneau-lieu.js";

const ICONES = {
  main: '<path d="M6 3l12 8-5.2 1.3L10 18z"/>',
  terrain: '<path d="M19.5 3.5l1.5 1.5-9 9-1.9-1.9z"/><path d="M9.6 12.6c-2.1 0-3.6 1.4-3.6 3.4 0 1.3-.7 2.3-2 3 3 .9 7.2-.3 7.6-4.4"/>',
  lieu: '<path d="M8 21V9.5l4-5.5 4 5.5V21z"/><path d="M11 21v-4h2v4M5 21h14"/>',
  trace: '<path d="M4 19c4-10 11-3 16-14"/><circle cx="4" cy="19" r="1.7"/><circle cx="20" cy="5" r="1.7"/>',
  texte: '<path d="M5 7V4.5h14V7M12 4.5V20M9 20h6"/>',
  brouillard: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  groupe: '<path d="M6 21V4"/><path d="M6 4h11l-2 3.5L17 11H6"/>',
  mesure: '<path d="M12 3v3M12 6L6.5 21M12 6l5.5 15M8.4 15.5h7.2"/>',
  pointeur: '<circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="6.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6"/>',
  annuler: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12h-2" transform="translate(0 -6)"/>',
  refaire: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12h2" transform="translate(0 -6)"/>',
  exporter: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  pave: '<path d="M5 6h14v9H5z"/><path d="M3 18h18"/><path d="M10 16.5h4"/>',
  souris: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
};

const icone = (cle) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[cle]}</svg>`;

// Les lettres des outils et la taille des icônes (carte/outils.js) : la carte des touches et le dialogue des lieux d'une carte
// jetée les lisent sans charger l'éditeur.
export { OUTILS, tailleMarqueur };

const ETIQUETTES_ORIGINE = [["officiel", "Officiel"], ["série", "Série"], ["maison", "Maison"]];

let compteur = 0;
const nouvelId = (prefixe) => `${prefixe}-${Date.now().toString(36)}${(compteur++).toString(36)}`;

// Mesure du texte à taille 100 puis mise à l'échelle : plus fiable que de mesurer à 2 px.
let ctxMesure = null;
function mesurer(chaine, taille, police, espacement = 0) {
  ctxMesure ||= document.createElement("canvas").getContext("2d");
  ctxMesure.font = police.replace("{t}", 100);
  const car = [...chaine];
  const l = car.reduce((a, c) => a + ctxMesure.measureText(c).width, 0);
  return (l * taille) / 100 + espacement * taille * Math.max(0, car.length - 1);
}

// Les nombres à virgule s'écrivent avec une virgule, comme « 0,25 km par case ».
const virgule = (x, d = 1) => Number(x).toFixed(d).replace(".", ",");

const VECTEURS = ["nom", "graine", "km_case", "taille_textes", "taille_symboles", "brouillard_actif", "traces", "marqueurs", "etiquettes", "decor", "groupe", "style", "habillage"];

// L'habillage (carte.habillage) : détails de petite échelle proposés par la rédaction zone par zone, dessinés en style peint.
const GENRES_HAB = ["champs", "vergers", "haies", "hameaux", "chemins", "ponts", "gues", "batiments"];
const NOMS_HAB = { champs: "Champs", vergers: "Verger", haies: "Haie", hameaux: "Hameau", chemins: "Sentier", ponts: "Pont", gues: "Gué", batiments: "Bâtiment" };
const NOMS_BATIMENTS = { moulin: "Moulin", ferme_brulee: "Ferme incendiée", ruine: "Ruine", grange: "Grange", chapelle: "Chapelle", cabane: "Cabane", ponton: "Ponton" };
const KM_HABILLAGE = 1;
const listeHab = (h, g) => (h && Array.isArray(h[g]) ? h[g] : []);
// Le point qui situe un élément d'habillage (dans une zone, ou pour le viser) : son centre.
function centreHab(g, el) {
  const pts = g === "champs" || g === "vergers" ? el.zone : g === "haies" || g === "chemins" ? el.points : g === "hameaux" ? (el.fermes || []).map((f) => [f.x, f.y]) : [[el.x, el.y]];
  const ok = (pts || []).filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));
  if (!ok.length) return null;
  return [ok.reduce((a, p) => a + p[0], 0) / ok.length, ok.reduce((a, p) => a + p[1], 0) / ok.length];
}
function resumeHab(h) {
  const parts = GENRES_HAB.map((g) => [g, g === "hameaux" ? listeHab(h, g).reduce((n, x) => n + (x.fermes || []).length, 0) : listeHab(h, g).length]).filter(([, n]) => n);
  const mots = { champs: ["zone de champs", "zones de champs"], vergers: ["verger", "vergers"], haies: ["haie", "haies"], hameaux: ["ferme", "fermes"], chemins: ["sentier", "sentiers"], ponts: ["pont", "ponts"], gues: ["gué", "gués"], batiments: ["bâtiment", "bâtiments"] };
  return parts.map(([g, n]) => `${n} ${mots[g][n > 1 ? 1 : 0]}`).join(", ") || "rien";
}

export { decoderCarte, encoderCarte };


export class EditeurCarte {
  constructor(racine, carteJson, lieux) {
    this.racine = racine;
    this.carte = decoderCarte(carteJson);
    this.lieux = lieux;
    this.outil = "main";
    this.pinceau = { biome: B.foret, rayon: 3 };
    this.brume = { mode: "reveler", rayon: 8 };
    this.typeLieu = "village";
    this.typeTrace = "route";
    this.traceAuto = true;
    this.styleEtiquette = "region";
    this.traceTrajet = true;
    // Pavé tactile (deux doigts déplacent la vue) ou souris (la molette zoome), retenu sur ce navigateur.
    this.defilement = lireDefilement();
    this.selection = null;
    // Habillage : la demande en cours (habillement), puis la proposition montrée avant d'être gardée (apercu).
    this.habillement = null;
    this.apercu = null;
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
    this.lieuxModifies = new Set();
    this.curseur = null;
    this.mesure = null;
    this.traceEnCours = null;
    this.galerie = new Galerie({
      cible: "lieu",
      fiche: () => this.lieux[this.marqueur(this.selection?.id)?.lieu],
      trouver: (id) => this.lieux[id],
      rafraichir: () => this.afficherPanneau(),
      zone: () => this.panneau,
      apresTable: (r) => {
        this.majEcrans(r.ecrans);
        this.tableIci = false;
        this.porteeRelue();
      },
    });
    this.pnj = [];
    // Les envois de la carte et des fiches de lieux se suivent en file : un envoi lent ne se fait jamais doubler
    // (sinon la carte entrait en conflit avec elle-même).
    this.chaineCarte = Promise.resolve();
    this.chaineLieux = Promise.resolve();
    this.versionLocale = 0;
    // Dernière version connue du serveur pour chaque lieu : sert de base à la fusion après un conflit.
    this.basesLieux = Object.fromEntries(Object.values(lieux || {}).map((l) => [l.id, copie(l)]));
    this.sauverCarte = differer(() => this.enregistrer(), 1200);
    this.sauverLieux = differer(() => this.enregistrerLieux(), 800);
    this.suivreTable = differer(() => this.envoyerTable({ auto: true, suivi: true }), 220);
    this.clavier = (ev) => this.touche(ev);
    this.relache = (ev) => {
      if (ev.code === "Space") this.espace = false;
    };
    // Serveur injoignable : la carte et les fiches de lieux repartent seules (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatSauvegarde === "erreur") this.etat("erreur");
    });
    this.reessaiLieux = new Reessai(() => this.enregistrerLieux());
  }

  async demarrer() {
    this.racine.innerHTML = this.gabarit();
    this.canvas = this.racine.querySelector("canvas");
    // Le pointeur d'un joueur posé depuis le coin (« Montrer au MJ ») paraît sur cette carte, à la couleur de son héros.
    this.finPointeursJoueurs = montrerPointeursJoueurs({ hote: this.racine.querySelector(".scene"), genre: "carte", id: this.carte.id, vue: () => this.vue });
    this.panneau = this.racine.querySelector(".panneau");
    this.infos = this.racine.querySelector(".infos");
    await chargerPolices();
    this.texture = await chargerImage("/static/img/carte-parchemin.jpg");
    if (this.detruit) return;
    this.vue = new VueCarte(this.canvas, { style: this.carte.style || "couleur", texture: this.texture });
    this.vue.charger(this.carte, this.lieux);
    this.champs = this.vue.champs;
    this.vue.cadrer();
    this.vue.dessusEditeur = (ctx, zone) => this.dessinerEditeur(ctx, zone);
    this.vue.surCamera = () => {
      if (this.suivre) this.suivreTable();
    };
    this.lier();
    this.chargerEnfants();
    this.galerie.suivre();
    api.get("/api/plans?resume=1").then((liste) => {
      this.plans = liste.map((q) => ({ id: q.id, nom: q.nom, lieu: q.lieu, etage: q.etage }));
      if (this.selection?.genre === "marqueur" && !this.panneau.contains(document.activeElement)) this.afficherPanneau();
    }).catch(() => {});
    api.get("/api/pnj").then((liste) => {
      this.pnj = liste;
      // Un lieu ouvert avant l'arrivée de la liste (lien « Voir le lieu sur la carte ») montre ses PNJ, sauf pendant une saisie.
      if (this.selection?.genre === "marqueur" && !this.panneau.contains(document.activeElement)) this.afficherPanneau();
    }).catch(() => {});
    this.choisirOutil("main");
    this.majBarre();
    this.etat("ok");
    // « Montrer à la TV » : le bouton commun (bouton-tv.js), qui suit l'état réel de la table, comme le témoin.
    this.boutonTv = new BoutonTv({
      estIci: (t) => t.vue === "carte" && t.carte === this.carte.id,
      // envoyerTable et tableAccueil disent eux-mêmes un échec : le message ne suit qu'un envoi parti.
      montrer: async () => {
        await this.envoyerTable();
        if (this.tableIci) toast(this.ecransTable === 0 ? "Envoyé, mais aucun écran de table n'est branché." : `À la TV : la carte «\u00a0${this.carte.nom}\u00a0».`);
      },
      retirer: async () => {
        await this.tableAccueil();
        if (!this.tableIci) toast(`Retiré de la TV : la carte «\u00a0${this.carte.nom}\u00a0».`);
      },
      titre: "Cette vue de la carte sur la TV, sans les lieux secrets ni ce qui est sous le brouillard",
      titreIci: "La TV montre cette carte : la retirer, l'écran d'accueil revient",
    });
    this.racine.querySelector(".place-bouton-tv")?.replaceWith(this.boutonTv.el);
    this.lireTable();
    this.finTv = ecouterTv((t) => this.tableRecue(t));
    this.planifierFondTable(4000);
  }

  async chargerEnfants() {
    try {
      const cartes = await api.get("/api/cartes");
      this.enfants = cartes.filter((c) => c.parent?.carte === this.carte.id);
      this.parent = this.carte.parent ? cartes.find((c) => c.id === this.carte.parent.carte) : null;
      this.idsCartes = new Set(cartes.map((c) => c.id));
      if ((this.outil === "main" || this.outil === "lieu") && !this.selection) this.afficherPanneau();
      this.vue.demander();
    } catch {
      this.enfants = [];
    }
  }

  detruire() {
    this.detruit = true;
    this.attente?.annuler();
    this.pointeur?.fermer();
    this.finPointeursJoueurs?.();
    clearTimeout(this.minuterieFond);
    clearInterval(this.minuterieHab);
    this.vue?.detruire();
    this.galerie.arreter();
    this.suivreTable.annuler();
    this.finTv?.();
    this.boutonTv?.detruire();
    window.removeEventListener("keydown", this.clavier);
    window.removeEventListener("keyup", this.relache);
    return this.vider();
  }

  // Ce qui attend encore part tout de suite (changement de page, onglet fermé ou mis en arrière-plan).
  vider() {
    if (this.etatSauvegarde === "modifie" || this.echecCarte()) this.sauverCarte.maintenant();
    if (this.lieuxModifies.size || this.sauverLieux.enAttente()) this.sauverLieux.maintenant();
    return this.chaineCarte.then(() => this.chaineLieux);
  }

  // Un envoi de la carte a échoué (hors conflit : après un conflit, plus rien ne part d'ici).
  echecCarte() {
    return this.etatSauvegarde === "erreur" && !this.suspendu;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.etatSauvegarde === "modifie" || this.etatSauvegarde === "enregistrement" || this.echecCarte() || this.sauverCarte.enAttente()
      || this.lieuxModifies.size > 0 || this.sauverLieux.enAttente();
  }

  gabarit() {
    return `
    <div class="editeur">
      <header class="barre-carte">
        <a class="retour" href="#/cartes" title="Toutes les cartes">Cartes</a>
        <h1 class="nom-carte" title="${e(this.carte.nom)}">${e(this.carte.nom)}</h1>
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
            <button data-action="export-mj">Image du MJ (PNG)</button>
            <button data-action="export-joueurs">Image des joueurs (PNG)</button>
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
      </nav>
      <div class="scene"><canvas tabindex="0" aria-label="Carte"></canvas><div class="infos"></div><div class="bandeau-ia" aria-live="polite" hidden></div></div>
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
      this.vue.demander();
      // La souris sort de la carte : son point quitte la TV. Un doigt levé (ou un stylet) le laisse s'estomper.
      if (ev.pointerType === "mouse") this.pointeur?.effacer();
    });
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const g = molette(this.vue, ev, this.defilement);
      if (!g) return;
      // La carte a bougé sous le pointeur immobile : le pinceau et les infos suivent, le point de la TV aussi.
      this.curseur = this.position(ev);
      this.majInfos();
      if (this.outil === "pointeur") this.pointeur.bouger(...this.curseur);
      if (g.glisser && premierGlisser()) toast(AVIS_PAVE);
    }, { passive: false });
    c.addEventListener("dblclick", (ev) => this.doubleClic(ev));
    c.addEventListener("contextmenu", (ev) => ev.preventDefault());
    window.addEventListener("keydown", this.clavier);
    window.addEventListener("keyup", this.relache);

    const barre = this.racine.querySelector(".barre-carte");
    barre.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.style) this.changerStyle(b.dataset.style);
      if (b.dataset.mode) this.changerMode(b.dataset.mode);
      if (b.dataset.defilement) this.changerDefilement(b.dataset.defilement);
      const a = b.dataset.action;
      if (a === "annuler") this.annuler();
      if (a === "refaire") this.refaire();
      if (a === "exporter") this.racine.querySelector(".menu-exporter .menu").hidden ^= true;
      if (a === "export-mj" || a === "export-joueurs") this.exporter(a === "export-joueurs");
      if (a === "table-accueil") this.tableAccueil();
    });
    barre.querySelector('[data-action="table-suivre"]').addEventListener("change", (ev) => {
      this.suivre = ev.target.checked;
      if (this.suivre) this.envoyerTable();
    });
    this.racine.querySelector(".outils").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-outil]");
      if (b) this.choisirOutil(b.dataset.outil);
    });
    this.panneau.addEventListener("input", (ev) => this.saisie(ev));
    this.panneau.addEventListener("change", (ev) => this.saisie(ev, true));
    this.panneau.addEventListener("click", (ev) => this.actionPanneau(ev));
    this.bandeau = this.racine.querySelector(".bandeau-ia");
    this.bandeau.addEventListener("click", (ev) => {
      const a = ev.target.closest("button")?.dataset.action;
      if (a === "hab-garder") this.garderApercu(true);
      if (a === "hab-ajouter") this.garderApercu(false);
      if (a === "hab-ecarter") this.ecarterApercu();
      if (a === "hab-peint") this.changerStyle("peint");
    });
  }

  // ---- état général ----

  // Après la destruction, la page en montre une autre : l'état n'y est plus écrit.
  etat(e) {
    this.etatSauvegarde = e;
    afficherTemoin(this.detruit ? null : this.racine.querySelector(".barre-carte .temoin-enregistrement"), e, { reessai: this.reessai, modifie: this.carte.modifie });
  }

  modifie() {
    this.versionLocale++;
    this.etat("modifie");
    this.sauverCarte();
  }

  enregistrer() {
    this.chaineCarte = this.chaineCarte.then(() => this.envoyerCarte());
    return this.chaineCarte;
  }

  async envoyerCarte() {
    if (this.suspendu) return;
    const version = this.versionLocale;
    this.etat("enregistrement");
    try {
      const r = await api.put(`/api/cartes/${this.carte.id}`, { ...encoderCarte(this.carte), habillage: this.habillageGarde(), version_base: this.carte.modifie });
      this.carte.modifie = r.modifie;
      this.reessai.reussite();
      // Une modification faite pendant l'envoi reste à enregistrer : l'état ne passe pas à « enregistré ».
      this.etat(version === this.versionLocale ? "ok" : "modifie");
      if (this.tableIci) this.envoyerTable({ auto: true, camera: this.derniereCamera });
      this.planifierFondTable();
    } catch (err) {
      if (err.status === 409) {
        this.suspendu = true;
        this.sauverCarte.annuler();
        this.reessai.arreter();
        this.etat("erreur");
        // Page déjà quittée (nouvel essai arrivé trop tard) : pas de question posée par-dessus une autre page.
        if (this.detruit) return toast("Cette carte a été modifiée depuis un autre écran : vos derniers changements n'y ont pas été enregistrés.", "erreur");
        demander({
          titre: "Modifiée sur un autre écran", texte: "Cette carte a été modifiée depuis un autre écran pendant que vous travailliez ici.",
          aide: "Recharger reprend la dernière version enregistrée ; vos changements non enregistrés sur cet écran sont perdus.",
          oui: "Recharger", non: "Rester sur cette version", danger: true,
        }).then((oui) => (oui ? location.reload() : toast("Enregistrement suspendu sur cet écran : rechargez la page pour reprendre.", "erreur")));
        return;
      }
      this.reessai.echec(err);
      this.etat("erreur");
      this.reessai.signaler(err, "Enregistrement impossible");
    }
  }

  lieuModifie(id) {
    this.lieuxModifies.add(id);
    this.sauverLieux();
  }

  enregistrerLieux() {
    this.chaineLieux = this.chaineLieux.then(() => this.envoyerLieux());
    return this.chaineLieux;
  }

  async envoyerLieux() {
    const ids = [...this.lieuxModifies];
    this.lieuxModifies.clear();
    const erreurs = [];
    for (const id of ids) {
      const lieu = this.lieux[id];
      if (!lieu) continue;
      try {
        const envoye = copie(lieu);
        const srv = await this.envoyerLieu(id, envoye);
        // Seules la version et les illustrations reviennent du serveur : une frappe faite pendant l'envoi reste.
        lieu.modifie = srv.modifie;
        lieu.illustrations = srv.illustrations;
        lieu.illustration = srv.illustration;
        this.basesLieux[id] = copie(srv);
        // Renommé depuis un autre écran : le serveur a suivi le renommage (liens_fiches.py), le lieu et la carte suivent.
        if (srv.id && srv.id !== id) adopterSurLaCarte(this, lieu, id, srv.id, srv);
      } catch (err) {
        erreurs.push(err);
        // Serveur injoignable : la fiche repartira au prochain essai.
        if (injoignable(err)) this.lieuxModifies.add(id);
        this.reessaiLieux.signaler(err, `Fiche « ${lieu.nom} » non enregistrée`);
      }
    }
    if (ids.length) this.reessaiLieux.bilan(erreurs);
    // Un lieu devenu connu (ou renommé) doit apparaître sur la TV si elle montre cette carte.
    if (ids.length && this.tableIci) this.envoyerTable({ auto: true, camera: this.derniereCamera });
    if (ids.length) this.planifierFondTable();
  }

  // Envoi d'une fiche de lieu avec sa version ; si un autre écran l'a changée entre-temps, fusion champ par champ :
  // ce que cet écran a modifié passe par-dessus, le reste vient du serveur.
  async envoyerLieu(id, lieu) {
    try {
      return await api.put(`/api/lieux/${id}`, { ...lieu, version_base: lieu.modifie });
    } catch (err) {
      if (err.status !== 409) throw err;
      const srv = await api.get(`/api/lieux/${id}`);
      const fusion = fusionner(this.basesLieux[id] || srv, lieu, srv);
      const r = await api.put(`/api/lieux/${id}`, { ...fusion, version_base: srv.modifie });
      const local = this.lieux[id];
      if (local) {
        for (const [cle, valeur] of Object.entries(fusion)) if (JSON.stringify(local[cle]) === JSON.stringify(lieu[cle])) local[cle] = valeur;
        if (!this.panneau.contains(document.activeElement)) this.afficherPanneau();
      }
      return r;
    }
  }

  majBarre() {
    for (const b of this.racine.querySelectorAll("[data-style]")) b.setAttribute("aria-pressed", b.dataset.style === this.vue.style);
    for (const b of this.racine.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", (b.dataset.mode === "joueurs") === this.vue.joueurs);
    for (const b of this.racine.querySelectorAll("[data-defilement]")) b.setAttribute("aria-pressed", b.dataset.defilement === this.defilement);
    this.racine.querySelector('[data-action="annuler"]').disabled = !this.passe.length;
    this.racine.querySelector('[data-action="refaire"]').disabled = !this.futur.length;
  }

  changerStyle(style) {
    if (style === this.vue.style) return;
    this.carte.style = style;
    this.vue.changerStyle(style);
    this.annoncerPeinture();
    this.majBarre();
    this.modifie();
    if (this.suivre) this.suivreTable();
  }

  // Le style Peint se peint morceau par morceau (quelques secondes sur une grande carte) : « Peinture… » le dit jusqu'au
  // dernier morceau, pour qu'on ne prenne pas l'image d'avant ou une carte à moitié peinte pour un raté (b15).
  annoncerPeinture() {
    const ancien = this.messagePeinture;
    this.messagePeinture = null;
    if (ancien?.isConnected) ancien.remove();
    if (!this.vue.peintureEnCours) return;
    const t = toast("Peinture de la carte…", "info", { duree: 60000 });
    this.messagePeinture = t;
    this.vue.surPeinturePrete = () => {
      this.vue.surPeinturePrete = null;
      if (this.messagePeinture !== t) return;
      this.messagePeinture = null;
      t.classList.add("sortie");
      setTimeout(() => t.remove(), 400);
    };
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
    if (this.traceEnCours) this.finirTrace();
    // Le point quitte la TV avec l'outil ; l'outil choisi relit ce que montre la TV, pour dire si le point y passera.
    if (outil !== "pointeur") {
      this.pointeur?.effacer();
      this.doigtPointe = null;
    } else {
      this.pointeur ||= new Pointeur("carte", this.carte.id, (p) => {
        this.portee = p;
        this.majPortee();
      });
      if (this.outil !== "pointeur") this.lireTable();
    }
    // La règle de l'outil Mesurer se montre aux joueurs du coin tant que l'outil est pris, et s'efface avec lui.
    if (outil === "mesure") {
      this.pointeur ||= new Pointeur("carte", this.carte.id, (p) => {
        this.portee = p;
        this.majPortee();
      });
    } else this.pointeur?.effacerRegle();
    this.outil = outil;
    this.mesure = null;
    if (outil !== "lieu") this.aPoser = null;
    if (outil !== "main") this.selection = null;
    if (outil !== "region") this.cadreRegion = null;
    for (const b of this.racine.querySelectorAll("[data-outil]")) b.setAttribute("aria-pressed", b.dataset.outil === outil);
    this.canvas.dataset.curseur = outil;
    this.afficherPanneau();
    this.vue.demander();
  }

  // ---- annulation ----

  // L'habillage enregistré : pendant l'aperçu d'une proposition, celui d'avant (la proposition n'est que montrée, ni
  // enregistrée, ni prise dans l'historique).
  habillageGarde() {
    return (this.apercu ? this.apercu.avant : this.carte.habillage) || null;
  }

  instantane(avecTerrain = false) {
    const vect = {};
    for (const k of VECTEURS) vect[k] = k === "habillage" ? this.habillageGarde() : this.carte[k];
    const etat = { vect: JSON.stringify(vect) };
    if (avecTerrain) etat.terrain = this.carte.terrain.slice();
    etat.brouillard = this.carte.brouillard.slice();
    this.passe.push(etat);
    if (this.passe.length > 80) this.passe.shift();
    this.futur = [];
    this.majBarre();
  }

  instantaneGroupe(cle) {
    const t = Date.now();
    if (cle !== this.derniereCle || t - this.dernierInstant > 2500) this.instantane();
    this.derniereCle = cle;
    this.dernierInstant = t;
  }

  restaurer(depuis, vers) {
    const etat = depuis.pop();
    if (!etat) return;
    // Annuler pendant un aperçu l'écarte d'abord : on revient sur ce qui était enregistré.
    if (this.apercu) this.ecarterApercu({ dessiner: false });
    const actuel = { vect: null, brouillard: this.carte.brouillard.slice() };
    const vect = {};
    for (const k of VECTEURS) vect[k] = k === "habillage" ? this.habillageGarde() : this.carte[k];
    actuel.vect = JSON.stringify(vect);
    if (etat.terrain) actuel.terrain = this.carte.terrain.slice();
    vers.push(actuel);
    this.remettre(JSON.parse(etat.vect), etat);
    if (this.vue.style !== (this.carte.style || "couleur")) this.vue.changerStyle(this.carte.style || "couleur");
    Object.assign(this.racine.querySelector(".nom-carte"), { textContent: this.carte.nom, title: this.carte.nom });
    this.selection = null;
    this.afficherPanneau();
    this.majBarre();
    this.modifie();
  }

  // Remet la carte dans un état pris par instantane() (vect déjà lu) et redessine ce qui a changé.
  remettre(vect, etat) {
    const avantTraces = JSON.stringify([this.carte.traces, this.carte.marqueurs]);
    Object.assign(this.carte, vect);
    this.carte.brouillard.set(etat.brouillard);
    this.champs.majBrouillard();
    if (etat.terrain) {
      this.carte.terrain.set(etat.terrain);
      this.champs.majTout();
      this.vue.construireBase();
    } else if (avantTraces !== JSON.stringify([this.carte.traces, this.carte.marqueurs])) {
      this.champs.majVoies();
      this.vue.rafraichirTout();
    } else {
      this.vue.demander();
    }
  }

  // Un geste défait avant d'être fini (deuxième doigt, geste repris par le navigateur) : la carte revient à
  // l'instantané pris à son début, sans rien enregistrer ni envoyer à la TV, et ce pas d'annulation disparaît. Si un
  // enregistrement est parti pendant le geste (une retouche d'avant qui attendait), la carte défaite repart à son tour.
  oublierGeste(debut) {
    if (this.imagePeinture) cancelAnimationFrame(this.imagePeinture);
    this.imagePeinture = 0;
    this.zoneEnAttente = null;
    this.zoneTrait = null;
    this.traitEau = false;
    this.brumeChangee = false;
    const etat = this.passe.pop();
    if (!etat) return;
    const vect = JSON.parse(etat.vect);
    // Pendant l'aperçu d'un habillage, l'instantané garde celui d'avant : l'aperçu montré reste en place.
    if (this.apercu) delete vect.habillage;
    this.remettre(vect, etat);
    this.afficherPanneau();
    this.majBarre();
    if (this.carte.modifie !== debut || this.etatSauvegarde === "enregistrement") this.modifie();
  }

  annuler() {
    this.restaurer(this.passe, this.futur);
  }

  refaire() {
    this.restaurer(this.futur, this.passe);
  }

  // ---- accès aux objets ----

  marqueur(id) {
    return this.carte.marqueurs.find((m) => m.id === id);
  }

  trace(id) {
    return this.carte.traces.find((t) => t.id === id);
  }

  etiquette(id) {
    return this.carte.etiquettes.find((t) => t.id === id);
  }

  k() {
    return this.carte.taille_textes || 1;
  }

  boiteMarqueur(m) {
    const lieu = this.lieux[m.lieu];
    const s = m.taille || 1.6;
    const icone = { x0: m.x - s * 0.75, y0: m.y - s * 1.45, x1: m.x + s * 0.75, y1: m.y + s * 0.3 };
    let nom = null;
    if (lieu?.nom && !m.sans_nom) {
      const st = styleNomLieu(lieu.type);
      const t = st.taille * this.k() * (m.taille_nom || 1);
      const p = positionNom(m);
      const l = mesurer(lieu.nom, t, st.police, st.espacement);
      if (m.nom_gauche && m.nx === undefined) p.x = m.x - s * 0.62 - l;
      nom = { x0: p.x, y0: p.y - t * 0.6, x1: p.x + l, y1: p.y + t * 0.6 };
    }
    return { icone, nom };
  }

  geometrieEtiquette(et) {
    const st = STYLES_TEXTE[et.style] || STYLES_TEXTE.region;
    const taille = et.taille || st.taille;
    const chaine = st.majuscules ? (et.texte || "").toLocaleUpperCase("fr") : et.texte || "";
    const l = mesurer(chaine, taille, st.police, et.espacement ?? st.espacement);
    const courbure = et.courbure || 0;
    const fleche = courbure ? (l / Math.abs(courbure)) * (1 - Math.cos(courbure / 2)) : 0;
    return { l, h: taille * 1.25, angle: et.angle || 0, fleche: courbure > 0 ? fleche : -fleche };
  }

  dansEtiquette(et, x, y) {
    const g = this.geometrieEtiquette(et);
    const c = Math.cos(-g.angle);
    const s = Math.sin(-g.angle);
    const dx = x - et.x;
    const dy = y - et.y;
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return Math.abs(rx) <= g.l / 2 && ry >= -g.h / 2 + Math.min(0, g.fleche) && ry <= g.h / 2 + Math.max(0, g.fleche);
  }

  boiteCartouche(c) {
    const tt = c.taille || 4;
    const lt = mesurer((c.titre || "").toLocaleUpperCase("fr"), tt, "700 {t}px 'Cinzel Decorative'", 0.08);
    const ls = c.sous_titre ? mesurer(c.sous_titre, tt * 0.34, "italic 500 {t}px 'EB Garamond'", 0.02) : 0;
    const w = Math.max(lt, ls) + tt * 2.2;
    const h = tt * (c.sous_titre ? 2.35 : 1.8);
    return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
  }

  boiteEchelle(ech) {
    const k = this.k();
    const lieuesParCase = (this.carte.km_case || 8) / 4;
    const cible = 34 * lieuesParCase;
    const pas = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((p) => p >= cible / 4) || 1000;
    const L = (pas * 4) / lieuesParCase;
    return { x0: ech.x - k, y0: ech.y - 2 * k, x1: ech.x + L + 4 * k, y1: ech.y + 2.2 * k };
  }

  toucher(x, y) {
    const tol = 7 / this.vue.cam.z;
    const dans = (b) => b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    const sel = this.selection;
    if (sel?.genre === "trace") {
      const t = this.trace(sel.id);
      if (t) {
        for (let i = t.points.length - 1; i >= 0; i--) {
          if (Math.hypot(t.points[i][0] - x, t.points[i][1] - y) < tol * 1.4) return { genre: "point", id: t.id, index: i };
        }
      }
    }
    const d = this.carte.decor || {};
    if (this.carte.groupe?.visible && Math.hypot(this.carte.groupe.x + 0.4 * this.k() - x, this.carte.groupe.y - this.k() - y) < 1.4 * this.k()) return { genre: "groupe" };
    if (d.rose && d.rose.visible !== false && Math.hypot(d.rose.x - x, d.rose.y - y) < (d.rose.taille || 8) * 0.5) return { genre: "decor", cle: "rose" };
    if (d.cartouche && d.cartouche.visible !== false && dans(this.boiteCartouche(d.cartouche))) return { genre: "decor", cle: "cartouche" };
    if (d.echelle && d.echelle.visible !== false && dans(this.boiteEchelle(d.echelle))) return { genre: "decor", cle: "echelle" };
    const marqueurs = [...this.carte.marqueurs].sort((a, b) => b.y - a.y);
    for (const m of marqueurs) {
      const b = this.boiteMarqueur(m);
      if (dans(b.icone)) return { genre: "marqueur", id: m.id };
      if (dans(b.nom)) return { genre: "marqueur", id: m.id, nom: true };
    }
    for (let i = this.carte.etiquettes.length - 1; i >= 0; i--) {
      const et = this.carte.etiquettes[i];
      if (this.dansEtiquette(et, x, y)) return { genre: "etiquette", id: et.id };
    }
    const hab = this.habillageModifiable() ? this.carte.habillage : null;
    const vu = (el) => !(this.vue.joueurs && el.cache);
    if (hab) {
      // Les éléments ponctuels, puis les lignes ; les zones de champs, larges, après les tracés.
      for (const g of ["batiments", "ponts", "gues"]) {
        for (const el of listeHab(hab, g)) {
          const r = g === "ponts" ? (+el.longueur || 1.4) / 2 + 0.3 : g === "gues" ? 0.9 : 1;
          if (vu(el) && Math.hypot(el.x - x, el.y - y) < Math.max(r, tol)) return { genre: "hab", cat: g, id: el.id };
        }
      }
      for (const el of listeHab(hab, "hameaux")) {
        const i = (el.fermes || []).findIndex((fe) => Math.hypot(fe.x - x, fe.y - y) < Math.max(1.3, tol));
        if (vu(el) && i >= 0) return { genre: "hab", cat: "hameaux", id: el.id, ferme: i };
      }
      for (const g of ["chemins", "haies"]) {
        for (const el of listeHab(hab, g)) {
          const pts = el.points || [];
          for (let j = 0; vu(el) && j < pts.length - 1; j++) {
            if (distanceSegment(x, y, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) < Math.max(tol, 0.3)) return { genre: "hab", cat: g, id: el.id };
          }
        }
      }
    }
    for (let i = this.carte.traces.length - 1; i >= 0; i--) {
      const t = this.carte.traces[i];
      const pts = pointsLisses(t);
      for (let j = 0; j < pts.length - 1; j++) {
        const larg = t.type === "riviere" ? (pts[j][2] || 0.3) / 2 : 0.1;
        if (distanceSegment(x, y, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) < Math.max(tol, larg + tol * 0.5)) return { genre: "trace", id: t.id };
      }
    }
    if (hab) {
      for (const g of ["vergers", "champs"]) {
        for (const el of listeHab(hab, g)) if (vu(el) && Array.isArray(el.zone) && dansPolygone(x, y, el.zone)) return { genre: "hab", cat: g, id: el.id };
      }
    }
    return null;
  }

  // L'habillage se retouche dans le style qui le dessine, une fois gardé (pas pendant l'aperçu d'une proposition).
  habillageModifiable() {
    const h = this.carte.habillage;
    return !!h && typeof h === "object" && !this.apercu && this.vue.style === "peint";
  }

  elementHab(sel = this.selection) {
    if (sel?.genre !== "hab") return null;
    return listeHab(this.carte.habillage, sel.cat).find((x) => x.id === sel.id) || null;
  }

  selectionner(sel) {
    this.selection = sel && sel.genre === "point" ? { genre: "trace", id: sel.id } : sel;
    this.afficherPanneau();
    this.vue.demander();
  }

  // ---- pointeur ----

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
      // Un glissé d'objet interrompu est défait même au stylet, comme sur le plan.
      return this.interrompre(this.doigt || this.glisse?.type === "objet");
    }
    this.doigt = auDoigt(ev);
    const [x, y] = this.position(ev);
    if (ev.button === 1 || ev.button === 2 || this.espace) {
      this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };
      return;
    }
    switch (this.outil) {
      case "main": return this.basSelection(x, y, ev);
      case "terrain": return this.auTrait(ev, () => this.debutPeinture(x, y));
      case "brouillard": return this.auTrait(ev, () => this.debutBrume(x, y, ev));
      case "lieu": {
        if (this.aPoser) return this.auLever(ev, () => this.poserLieu(x, y));
        const t = this.toucher(x, y);
        if (t?.genre === "marqueur") {
          this.selectionner(t);
          return this.basSelection(x, y, ev);
        }
        return this.auLever(ev, () => this.creerLieu(x, y));
      }
      case "trace": return this.auLever(ev, () => this.clicTrace(x, y));
      case "texte": {
        const t = this.toucher(x, y);
        if (t?.genre === "etiquette") {
          this.selectionner(t);
          return this.basSelection(x, y, ev);
        }
        return this.auLever(ev, () => this.creerEtiquette(x, y));
      }
      case "groupe": return this.auLever(ev, () => this.placerGroupe(x, y));
      case "region":
        this.cadreRegion = { x0: x, y0: y, x1: x, y1: y, actif: true };
        this.glisse = { type: "region" };
        return;
      case "mesure":
        this.mesure = { x0: x, y0: y, x1: x, y1: y, actif: true };
        this.vue.demander();
        return;
      case "pointeur": return this.basPointeur(ev, x, y);
    }
  }

  // Pointeur : à la souris ou au stylet, un clic fait une onde sur la TV. Au doigt, un toucher bref la fait au lever ;
  // un doigt qui glisse, ou reste posé un instant, pointe. Rien ne change dans la carte.
  basPointeur(ev, x, y) {
    if (!this.doigt) return this.pointeur.onde(x, y);
    const id = ev.pointerId;
    this.attente = new Attente(ev, () => this.pointeur.onde(x, y), ([px, py]) => {
      this.doigtPointe = id;
      this.pointeur.bouger(...this.vue.versCarte(px, py));
    }, DELAI);
  }

  // Au doigt, une action ponctuelle (lieu, point d'un tracé, nom, groupe) part au lever du doigt, s'il n'a pas glissé
  // et qu'aucun deuxième doigt n'est venu entre-temps ; s'il glisse, la vue le suit.
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

  // Un deuxième doigt interrompt le geste en cours. Au doigt, ce qu'il avait changé est défait (un pincement ne
  // révèle, ne peint ni ne déplace rien) ; un objet glissé l'est aussi au stylet ; sinon il finit comme au lâcher.
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
    if (g.type === "region") this.cadreRegion = null;
    if (g.type === "peinture" || g.type === "brume" || (g.type === "objet" && g.bouge)) this.oublierGeste(g.debut);
    this.vue.demander();
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
    if (this.geste?.type === "pincer" && this.pointeurs.size === 2) {
      const m = this.mesurePincement();
      this.vue.deplacer(m.cx - this.geste.cx, m.cy - this.geste.cy);
      this.vue.zoomer(m.d / this.geste.d, m.cx, m.cy);
      this.geste = { type: "pincer", ...m };
      return;
    }
    // Un doigt posé qui n'a pas encore assez glissé ne fait rien d'autre (pas de trait, pas de déplacement).
    if (this.attente?.bouge(ev)) return this.vue.demander();
    const g = this.glisse;
    // Le point de la TV suit la souris, le stylet, ou le doigt qui pointe (pas celui d'un pincement fini).
    if (this.outil === "pointeur" && g?.type !== "camera" && (!auDoigt(ev) || this.doigtPointe === ev.pointerId)) this.pointeur.bouger(x, y);
    if (!g) {
      // La mesure suit le pointeur tant que le bouton est enfoncé, et la règle part vers les joueurs du coin.
      if (this.mesure?.actif) {
        this.mesure.x1 = x;
        this.mesure.y1 = y;
        this.envoyerRegle();
      }
      if (["terrain", "brouillard", "trace"].includes(this.outil) || this.mesure?.actif) this.vue.demander();
      return;
    }
    if (g.type === "camera") {
      this.vue.deplacer(ev.offsetX - g.px, ev.offsetY - g.py);
      g.px = ev.offsetX;
      g.py = ev.offsetY;
      return;
    }
    if (g.type === "peinture") return this.continuerPeinture(x, y);
    if (g.type === "brume") return this.continuerBrume(x, y);
    if (g.type === "objet") return this.glisserObjet(x, y);
    if (g.type === "region") {
      this.cadreRegion.x1 = x;
      this.cadreRegion.y1 = y;
      this.vue.demander();
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
    if (g.type === "peinture") this.finPeinture();
    if (g.type === "brume") this.finBrume();
    if (g.type === "objet") this.finGlisse(g);
    if (g.type === "region") this.finRegion();
  }

  doubleClic(ev) {
    const [x, y] = this.position(ev);
    if (this.outil === "trace" && this.traceEnCours) {
      this.traceEnCours.points.pop();
      this.finirTrace();
      return;
    }
    if (this.outil !== "main") return;
    const t = this.toucher(x, y);
    if (t?.genre === "point") {
      const tr = this.trace(t.id);
      if (tr.points.length > 2) {
        this.instantane();
        tr.points.splice(t.index, 1);
        this.traceChangee(tr);
      }
    } else if (t?.genre === "trace") {
      const tr = this.trace(t.id);
      let meilleur = 0;
      let dmin = Infinity;
      for (let i = 0; i < tr.points.length - 1; i++) {
        const d = distanceSegment(x, y, tr.points[i][0], tr.points[i][1], tr.points[i + 1][0], tr.points[i + 1][1]);
        if (d < dmin) {
          dmin = d;
          meilleur = i;
        }
      }
      this.instantane();
      const avant = tr.points[meilleur];
      const nouveau = avant.length > 2 ? [x, y, avant[2]] : [x, y];
      tr.points.splice(meilleur + 1, 0, nouveau);
      this.selectionner({ genre: "trace", id: tr.id });
      this.traceChangee(tr);
    }
  }

  // ---- sélection et glisser ----

  basSelection(x, y, ev) {
    const t = this.toucher(x, y);
    if (!t) {
      this.selectionner(null);
      this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };
      return;
    }
    // Noms de région et tracés couvrent beaucoup de carte : un clic les sélectionne, glisser déplace la vue.
    // Un nom déjà sélectionné se déplace ; un tracé ne bouge que par ses points.
    const dejaChoisi = this.selection?.genre === t.genre && this.selection?.id === t.id;
    if (t.genre === "trace" || t.genre === "hab" || (t.genre === "etiquette" && !dejaChoisi)) {
      this.selectionner(t);
      this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };
      return;
    }
    this.selectionner(t);
    const g = { type: "objet", cible: t, x0: x, y0: y, bouge: false, debut: this.carte.modifie };
    if (t.genre === "marqueur") {
      const m = this.marqueur(t.id);
      g.origine = t.nom ? { nx: positionNom(m).x - m.x, ny: positionNom(m).y - m.y } : { x: m.x, y: m.y };
    } else if (t.genre === "etiquette") {
      const et = this.etiquette(t.id);
      g.origine = { x: et.x, y: et.y };
    } else if (t.genre === "point") {
      const p = this.trace(t.id).points[t.index];
      g.origine = { x: p[0], y: p[1] };
    } else if (t.genre === "decor") {
      const d = this.carte.decor[t.cle];
      g.origine = { x: d.x, y: d.y };
    } else if (t.genre === "groupe") {
      g.origine = { x: this.carte.groupe.x, y: this.carte.groupe.y };
    } else if (t.genre === "trace") {
      g.origine = { points: this.trace(t.id).points.map((p) => p.slice()) };
    }
    this.glisse = g;
  }

  glisserObjet(x, y) {
    const g = this.glisse;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (!g.bouge) {
      // Au doigt, il faut un vrai glissé : le premier doigt d'un pincement ne déplace rien.
      if (Math.hypot(dx, dy) * this.vue.cam.z < (this.doigt ? SEUIL : 3)) return;
      g.bouge = true;
      this.instantane();
    }
    const t = g.cible;
    if (t.genre === "marqueur") {
      const m = this.marqueur(t.id);
      if (t.nom) {
        m.nx = g.origine.nx + dx;
        m.ny = g.origine.ny + dy;
      } else {
        m.x = g.origine.x + dx;
        m.y = g.origine.y + dy;
      }
    } else if (t.genre === "etiquette") {
      const et = this.etiquette(t.id);
      et.x = g.origine.x + dx;
      et.y = g.origine.y + dy;
    } else if (t.genre === "point") {
      const tr = this.trace(t.id);
      const avant = this.boiteTrace(tr);
      tr.points[t.index][0] = g.origine.x + dx;
      tr.points[t.index][1] = g.origine.y + dy;
      this.rafraichirAutour(avant, this.boiteTrace(tr));
    } else if (t.genre === "trace") {
      const tr = this.trace(t.id);
      const avant = this.boiteTrace(tr);
      tr.points = g.origine.points.map((p) => [p[0] + dx, p[1] + dy, ...p.slice(2)]);
      this.rafraichirAutour(avant, this.boiteTrace(tr));
    } else if (t.genre === "decor") {
      const d = this.carte.decor[t.cle];
      d.x = g.origine.x + dx;
      d.y = g.origine.y + dy;
    } else if (t.genre === "groupe") {
      this.carte.groupe.x = g.origine.x + dx;
      this.carte.groupe.y = g.origine.y + dy;
    }
    this.vue.demander();
  }

  finGlisse(g) {
    if (!g.bouge) return;
    const t = g.cible;
    if (t.genre === "marqueur" && !t.nom) {
      const m = this.marqueur(t.id);
      const zone = { x0: Math.min(g.origine.x, m.x) - 3, y0: Math.min(g.origine.y, m.y) - 4, x1: Math.max(g.origine.x, m.x) + 3, y1: Math.max(g.origine.y, m.y) + 3 };
      this.champs.majVoies(zone);
      this.vue.rafraichirZone({ x0: g.origine.x - 5, y0: g.origine.y - 6, x1: g.origine.x + 5, y1: g.origine.y + 6 });
      this.vue.rafraichirZone({ x0: m.x - 5, y0: m.y - 6, x1: m.x + 5, y1: m.y + 6 });
    }
    if (t.genre === "point" || t.genre === "trace") this.traceChangee(this.trace(t.id));
    this.afficherPanneau();
    this.modifie();
  }

  boiteTrace(tr) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of tr.points) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x0: x0 - 4, y0: y0 - 5, x1: x1 + 4, y1: y1 + 5 };
  }

  rafraichirAutour(a, b) {
    this.vue.rafraichirZone({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  }

  traceChangee(tr, avant) {
    const b = this.boiteTrace(tr);
    const zone = avant ? { x0: Math.min(avant.x0, b.x0), y0: Math.min(avant.y0, b.y0), x1: Math.max(avant.x1, b.x1), y1: Math.max(avant.y1, b.y1) } : b;
    this.champs.majVoies(zone);
    this.vue.rafraichirZone(zone);
    this.modifie();
  }

  // ---- terrain ----

  debutPeinture(x, y) {
    this.instantane(true);
    this.glisse = { type: "peinture", dernier: [x, y], debut: this.carte.modifie };
    this.zoneTrait = null;
    this.derniereCote = performance.now();
    this.peindre(x, y);
  }

  continuerPeinture(x, y) {
    const [lx, ly] = this.glisse.dernier;
    const d = Math.hypot(x - lx, y - ly);
    const pas = Math.max(0.5, this.pinceau.rayon * 0.4);
    const n = Math.ceil(d / pas);
    for (let i = 1; i <= n; i++) this.peindre(lx + ((x - lx) * i) / n, ly + ((y - ly) * i) / n);
    this.glisse.dernier = [x, y];
  }

  elargir(z, m) {
    return { x0: z.x0 - m, y0: z.y0 - m, x1: z.x1 + m, y1: z.y1 + m };
  }

  peindre(x, y) {
    const r = this.pinceau.rayon;
    const { largeur: w, hauteur: h, terrain } = this.carte;
    const b = this.pinceau.biome;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    let change = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
        const i = cy * w + cx;
        if (terrain[i] === b) continue;
        if (BIOMES[terrain[i]].eau || BIOMES[b].eau) this.traitEau = true;
        terrain[i] = b;
        change = true;
      }
    }
    if (!change) return;
    const z = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);
    this.zoneTrait = union(this.zoneTrait, z);
    this.zoneEnAttente = union(this.zoneEnAttente, z);
    if (!this.imagePeinture) this.imagePeinture = requestAnimationFrame(() => this.appliquerPeinture());
  }

  // Les coups de pinceau d'une même image sont regroupés : un seul recalcul par image affichée.
  appliquerPeinture() {
    this.imagePeinture = 0;
    const z = this.zoneEnAttente;
    this.zoneEnAttente = null;
    if (!z) return;
    this.champs.majZone(z.x0, z.y0, z.x1, z.y1);
    this.vue.rafraichirZone({ x0: z.x0 - 4, y0: z.y0 - 4, x1: z.x1 + 4, y1: z.y1 + 6 }, { tuilesSeules: this.vue.niveau() > 0, trait: true });
  }

  finPeinture() {
    if (this.imagePeinture) {
      cancelAnimationFrame(this.imagePeinture);
      this.appliquerPeinture();
    }
    if (this.zoneTrait) {
      this.champs.finTrait(this.zoneTrait, this.traitEau);
      // Toute la boîte du trait se repeint d'après un calcul neuf : en vue d'ensemble, aucun bloc ne garde l'ancien
      // terrain (vue.js, rafraichirZonePeinte).
      this.vue.rafraichirZone(this.elargir(this.zoneTrait, this.traitEau ? 9 : 6), { refaire: true });
      this.modifie();
    } else {
      this.passe.pop();
      this.majBarre();
    }
    this.traitEau = false;
    this.zoneTrait = null;
  }

  // ---- brouillard ----

  debutBrume(x, y, ev) {
    this.instantane();
    this.brumeValeur = (this.brume.mode === "reveler") !== (ev.altKey || ev.shiftKey) ? 1 : 0;
    this.glisse = { type: "brume", dernier: [x, y], debut: this.carte.modifie };
    this.brumer(x, y);
  }

  continuerBrume(x, y) {
    const [lx, ly] = this.glisse.dernier;
    const n = Math.ceil(Math.hypot(x - lx, y - ly) / Math.max(0.5, this.brume.rayon * 0.4));
    for (let i = 1; i <= n; i++) this.brumer(lx + ((x - lx) * i) / n, ly + ((y - ly) * i) / n);
    this.glisse.dernier = [x, y];
  }

  brumer(x, y) {
    const r = this.brume.rayon;
    const { largeur: w, hauteur: h, brouillard } = this.carte;
    let change = false;
    for (let cy = Math.max(0, Math.floor(y - r)); cy <= Math.min(h - 1, Math.ceil(y + r)); cy++) {
      for (let cx = Math.max(0, Math.floor(x - r)); cx <= Math.min(w - 1, Math.ceil(x + r)); cx++) {
        if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
        const i = cy * w + cx;
        if (brouillard[i] !== this.brumeValeur) {
          brouillard[i] = this.brumeValeur;
          change = true;
        }
      }
    }
    if (change) {
      this.champs.majBrouillard();
      this.vue.demander();
      this.brumeChangee = true;
    }
  }

  finBrume() {
    if (this.brumeChangee) this.modifie();
    else {
      this.passe.pop();
      this.majBarre();
    }
    this.brumeChangee = false;
  }

  toutReveler(valeur) {
    this.instantane();
    this.carte.brouillard.fill(valeur);
    this.champs.majBrouillard();
    this.vue.demander();
    this.modifie();
  }

  // ---- lieux ----

  // Un lieu posé à la main (fiche vide, sélectionnée), ou gardé parmi les propositions d'une région peuplée (fiche
  // remplie, sans changer la sélection : le MJ continue de trier les autres propositions).
  async creerLieu(x, y, fiche = null) {
    this.instantane();
    const type = fiche?.type || this.typeLieu;
    const typeParDefaut = TYPES_LIEUX.find((t) => t.cle === type);
    let lieu;
    try {
      lieu = await api.post("/api/lieux", { nom: fiche?.nom || (typeParDefaut ? `${typeParDefaut.nom} sans nom` : "Lieu sans nom"), type, etiquette: "maison", connu: false,
        resume: fiche?.resume || "", secrets: fiche?.secrets || "", notes: fiche?.notes || "", carte: this.carte.id });
    } catch (err) {
      this.passe.pop();
      toast(`Impossible de créer la fiche : ${err.message}`, "erreur");
      return null;
    }
    this.lieux[lieu.id] = lieu;
    this.basesLieux[lieu.id] = copie(lieu);
    const taille = tailleMarqueur(type, this.k());
    const m = { id: nouvelId("m"), lieu: lieu.id, x: +x.toFixed(2), y: +(y + taille * 0.3).toFixed(2), taille };
    this.carte.marqueurs.push(m);
    this.champs.majVoies({ x0: m.x - 3, y0: m.y - 4, x1: m.x + 3, y1: m.y + 3 });
    this.vue.rafraichirZone({ x0: m.x - 5, y0: m.y - 6, x1: m.x + 5, y1: m.y + 6 });
    if (fiche) {
      this.modifie();
      return lieu;
    }
    this.selectionner({ genre: "marqueur", id: m.id });
    this.modifie();
    const champ = this.panneau.querySelector('[data-champ="nom"][data-cible="lieu"]');
    if (champ) {
      champ.focus();
      champ.select();
    }
  }

  // Un lieu qui a déjà sa fiche (sans carte, ou venu d'une carte jetée) attend le prochain clic sur cette carte.
  preparerPose(id) {
    const lieu = this.lieux[id];
    if (!lieu) return toast("Ce lieu n'existe plus.", "erreur");
    const m = this.carte.marqueurs.find((x) => x.lieu === id);
    if (m) {
      toast(`« ${lieu.nom} » est déjà sur cette carte.`);
      return this.allerAuLieu(m.id);
    }
    this.choisirOutil("lieu");
    this.aPoser = id;
    this.afficherPanneau();
  }

  // Un lien vers un lieu qui n'est pas (ou plus) posé sur cette carte : la carte s'ouvre, et le dit.
  lieuAbsent(id) {
    const lieu = this.lieux[id];
    if (!lieu) return;
    toast(`« ${lieu.nom} » n'est pas posé sur cette carte.`, "info", { action: { libelle: "Le poser ici", faire: () => this.preparerPose(id) } });
  }

  // Sa fiche revient telle quelle (secrets et notes compris) et désigne désormais cette carte. Ctrl+Z retire l'icône.
  poserLieu(x, y) {
    const lieu = this.lieux[this.aPoser];
    this.aPoser = null;
    if (!lieu) return this.afficherPanneau();
    this.instantane();
    const taille = tailleMarqueur(lieu.type, this.k());
    const m = { id: nouvelId("m"), lieu: lieu.id, x: +x.toFixed(2), y: +(y + taille * 0.3).toFixed(2), taille };
    this.carte.marqueurs.push(m);
    if (lieu.carte !== this.carte.id) {
      lieu.carte = this.carte.id;
      this.lieuModifie(lieu.id);
    }
    this.champs.majVoies({ x0: m.x - 3, y0: m.y - 4, x1: m.x + 3, y1: m.y + 3 });
    this.vue.rafraichirZone({ x0: m.x - 5, y0: m.y - 6, x1: m.x + 5, y1: m.y + 6 });
    this.choisirOutil("main");
    this.selectionner({ genre: "marqueur", id: m.id });
    this.modifie();
    toast(`« ${lieu.nom} » est posé sur cette carte.`);
  }

  // Les lieux qui ne sont posés sur aucune carte : jamais posés, ou leur carte est à la corbeille.
  lieuxSansCarte() {
    const ici = new Set(this.carte.marqueurs.map((m) => m.lieu));
    return Object.values(this.lieux)
      .filter((l) => l && !ici.has(l.id) && (!l.carte || (this.idsCartes && !this.idsCartes.has(l.carte))))
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  }

  // ---- régions peuplées ----

  // L'image de la zone, telle que la voit le MJ (lieux cachés compris), au plus 1100 pixels de côté.
  async captureZone(z) {
    const echelle = Math.max(2, Math.min(14, Math.floor(1100 / Math.max(z.x1 - z.x0, z.y1 - z.y0))));
    const toile = document.createElement("canvas");
    toile.width = Math.round((z.x1 - z.x0) * echelle);
    toile.height = Math.round((z.y1 - z.y0) * echelle);
    const ctx = toile.getContext("2d");
    ctx.setTransform(echelle, 0, 0, echelle, -z.x0 * echelle, -z.y0 * echelle);
    await this.vue.peindreFondAttendu(ctx, z, { joueurs: false });
    this.vue.peindreDessus(ctx, z, { joueurs: false, rapide: false });
    return toile.toDataURL("image/png");
  }

  async peuplerRegion() {
    const c = this.cadreRegion;
    if (!c || this.peuplement) return;
    const z = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
    const nombre = +(this.panneau.querySelector('select[name="nombre-lieux"]')?.value || 5);
    const idee = this.panneau.querySelector('input[name="idee-region"]')?.value.trim() || "";
    this.peuplement = true;
    this.afficherPanneau();
    try {
      const r = await api.post(`/api/cartes/${encodeURIComponent(this.carte.id)}/peupler`, { zone: z, nombre, idee, image: await this.captureZone(z) });
      this.fantomes = [...(this.fantomes || []), ...(r.lieux || [])];
      if (!(r.lieux || []).length) toast("Aucun lieu proposé n'était plaçable dans cette zone : réessayez, ou élargissez le cadre.");
    } catch (err) {
      toast(`Rien de proposé : ${erreurIA(err, "les lieux se posent aussi à la main, avec l'outil Lieu")}.`, "erreur");
    }
    this.peuplement = false;
    this.afficherPanneau();
    this.vue.demander();
  }

  async garderFantome(i) {
    const f = (this.fantomes || [])[i];
    if (!f) return;
    this.fantomes.splice(i, 1);
    const notes = [f.accroche && `Accroche : ${f.accroche}`, f.rumeur && `Rumeur : ${f.rumeur}`].filter(Boolean).join("\n");
    const lieu = await this.creerLieu(f.x, f.y, { nom: f.nom, type: f.type, resume: f.resume, secrets: f.secrets, notes });
    if (!lieu) this.fantomes.splice(i, 0, f);
    this.afficherPanneau();
    this.vue.demander();
  }

  async garderTousFantomes() {
    while ((this.fantomes || []).length) {
      const avant = this.fantomes.length;
      await this.garderFantome(0);
      if (this.fantomes.length === avant) break;
    }
  }

  ecarterFantome(i) {
    if (i < 0) this.fantomes = [];
    else (this.fantomes || []).splice(i, 1);
    this.afficherPanneau();
    this.vue.demander();
  }

  panneauFantomes() {
    const f = this.fantomes || [];
    if (!f.length) return "";
    const nom = (t) => TYPES_LIEUX.find((x) => x.cle === t)?.nom || "Lieu";
    return `
      <h3>Lieux proposés (${f.length})</h3>
      <p class="aide">Ils sont dessinés en pointillés sur la carte. Gardez ceux qui vous plaisent : chacun devient une fiche, comme un lieu posé à la main.</p>
      <ul class="fantomes">${f.map((l, i) => `
        <li>
          <p><b>${e(l.nom)}</b> <span class="aide">${e(nom(l.type))}${l.terrain ? `, ${e(l.terrain.toLowerCase())}` : ""}</span></p>
          <p>${e(l.resume)}</p>
          ${l.accroche ? `<p class="aide">Accroche : ${e(l.accroche)}</p>` : ""}
          <div class="actions"><button class="principal" data-action="garder-fantome" data-valeur="${i}">Garder</button><button data-action="ecarter-fantome" data-valeur="${i}">Écarter</button></div>
        </li>`).join("")}
      </ul>
      <div class="actions"><button data-action="garder-tous-fantomes">Tout garder</button><button class="lien-danger" data-action="ecarter-fantome" data-valeur="-1">Tout écarter</button></div>`;
  }

  // ---- habillage par la rédaction ----

  dansZoneHab(g, el, z) {
    const c = centreHab(g, el);
    return !!c && c[0] >= z.x0 && c[0] <= z.x1 && c[1] >= z.y0 && c[1] <= z.y1;
  }

  compteHab(h, z = null) {
    return GENRES_HAB.reduce((n, g) => n + listeHab(h, g).filter((el) => !z || this.dansZoneHab(g, el, z)).length, 0);
  }

  // L'habillage gardé, plus une proposition : ce qui était dans la zone part si remplacer, le reste s'ajoute.
  fusionHab(avant, prop, zone, remplacer) {
    const res = { ...(avant || {}), cree: prop.cree, taille_parcelle_m: (avant && avant.taille_parcelle_m) || prop.taille_parcelle_m };
    delete res.zone;
    for (const g of GENRES_HAB) res[g] = [...listeHab(avant, g).filter((el) => !(remplacer && this.dansZoneHab(g, el, zone))), ...listeHab(prop, g)];
    return res;
  }

  panneauCarteHab() {
    const km = this.carte.km_case || 1;
    const h = this.habillageGarde();
    const occupe = this.habillement || this.apercu;
    const caches = GENRES_HAB.reduce((n, g) => n + listeHab(h, g).filter((el) => el.cache).length, 0);
    return `
      <h3>Habillage de la carte</h3>
      ${km > KM_HABILLAGE ? `<p class="aide">Carte trop vaste pour l'habillage (${String(km).replace(".", ",")} km par case) : un champ n'y serait qu'un point, et les champs se dessinent déjà d'eux-mêmes autour des lieux. Habillez plutôt une carte détaillée, à 1 km par case au plus.</p>` : `
      <p class="aide">Encadrez une zone : l'atelier y pose champs, vergers, haies, fermes, sentiers, ponts, gués et bâtiments d'après les fiches des lieux, et le style Peint les dessine. Rien n'est gardé sans vous ; une carte s'habille zone par zone.</p>
      <div class="actions"><button data-action="habiller" ${occupe ? "disabled" : ""}>${this.habillement ? "Habillage d'une zone en cours…" : "Habiller une zone"}</button></div>`}
      ${h && this.compteHab(h) ? `<p class="aide">Habillage gardé : ${e(resumeHab(h))}${caches ? `, dont ${caches} élément${caches > 1 ? "s" : ""} caché${caches > 1 ? "s" : ""} aux joueurs` : ""}. ${this.vue.style === "peint" ? "Cliquez un élément sur la carte (outil Sélection) pour voir pourquoi il est là, le cacher, le montrer ou le retirer." : "Passez en style Peint pour le voir et le retoucher."}</p>
        <div class="actions"><button class="danger" data-action="hab-retirer-tout" ${this.apercu ? "disabled" : ""}>Retirer l'habillage de la carte</button></div>` : ""}`;
  }

  panneauRegionHab(c) {
    const occupe = this.habillement || this.apercu;
    if (!c || c.actif) {
      return `
        <h2>Habiller une zone</h2>
        <p class="aide">Tracez un rectangle autour de la zone à habiller : les abords d'un village, la route entre deux lieux. Plus elle est petite, plus le détail est fin et la réponse rapide.</p>
        <div class="actions"><button data-action="annuler-region">Annuler</button></div>`;
    }
    const km = this.carte.km_case || 1;
    const dedans = this.compteHab(this.habillageGarde(), c);
    const dim = (n) => (n * km >= 1 ? `${String(+(n * km).toFixed(1)).replace(".", ",")} km` : `${Math.round(n * km * 1000)} m`);
    return `
      <h2>Habiller une zone</h2>
      <p class="aide">${Math.round(c.x1 - c.x0)} × ${Math.round(c.y1 - c.y0)} cases, soit ${dim(c.x1 - c.x0)} sur ${dim(c.y1 - c.y0)}. La proposition part du terrain, des tracés et de la fiche visible des lieux (jamais de leurs secrets) ; ce qui touche un lieu inconnu des joueurs reste caché sur la TV.</p>
      <label class="champ">Une idée de départ (facultatif)<input type="text" name="idee-habillage" placeholder="des vignes sur les coteaux, un hameau de bûcherons"></label>
      <div class="actions">
        <button class="principal" data-action="habiller-proposer" data-estimation="habillage-carte" ${occupe ? "disabled" : ""}>${this.habillement ? "Habillage de la zone en cours…" : "Habiller cette zone"}</button>
        <button data-action="habiller" ${occupe ? "disabled" : ""}>Autre cadre</button>
        <button data-action="annuler-region">Fermer</button>
      </div>
      ${this.habillement ? '<p class="aide">Une à trois minutes. Vous pouvez continuer à travailler : la proposition s\'affichera sur la carte.</p>' : ""}
      ${this.erreurHab && !this.habillement ? `<p class="aide erreur-ia" role="alert">Dernier essai : ${e(this.erreurHab)}</p>` : ""}
      ${this.apercu?.remarques?.length ? `<ul class="remarques-ia">${this.apercu.remarques.map((r) => `<li>${e(r)}</li>`).join("")}</ul>` : ""}
      ${dedans && !this.apercu ? `<p class="aide">Cette zone porte déjà ${dedans} élément${dedans > 1 ? "s" : ""} d'habillage.</p>
        <div class="actions"><button class="danger" data-action="hab-retirer-zone">Retirer l'habillage de la zone</button></div>` : ""}`;
  }

  panneauHab(sel, el) {
    const g = sel.cat;
    const titre = g === "batiments" ? NOMS_BATIMENTS[el.genre] || "Bâtiment" : g === "chemins" ? (el.genre === "chemin" ? "Chemin" : "Sentier")
      : g === "hameaux" ? (sel.ferme !== undefined ? "Ferme" : "Hameau") : NOMS_HAB[g];
    const lieu = el.lieu ? this.lieux[el.lieu] : null;
    const details = g === "champs" ? `Cultures : ${(el.cultures || []).filter((c, i, l) => l.indexOf(c) === i).join(", ")}${el.haies >= 0.5 ? " ; bocage" : ""}.`
      : g === "vergers" ? `${el.essence || "Arbres fruitiers"}.` : g === "ponts" ? `Pont de ${el.genre === "pierre" ? "pierre" : "planches"}.`
        : g === "batiments" && el.genre === "moulin" ? `Roue : ${el.roue === "arrêtée" ? "arrêtée" : "qui tourne"}.`
          : g === "hameaux" ? `${(el.fermes || []).length} ferme${(el.fermes || []).length > 1 ? "s" : ""}${sel.ferme !== undefined && el.fermes[sel.ferme] ? ` ; celle-ci : ${(el.fermes[sel.ferme].batiments || []).map((b) => ({ etable: "étable" })[b] || b).join(", ")}` : ""}.` : "";
    const plusieurs = g === "hameaux" && sel.ferme !== undefined && (el.fermes || []).length > 1;
    return `
      <h2>${e(titre)}</h2>
      <p class="aide">Habillage proposé par l'atelier${lieu ? `, rattaché à « ${e(lieu.nom)} »` : ""}.${details ? ` ${e(details)}` : ""}</p>
      ${el.raison ? `<label class="champ secret">Pourquoi (note du MJ)<textarea rows="3" readonly>${e(el.raison)}</textarea></label>` : ""}
      <label class="case"><input type="checkbox" data-cible="hab" data-champ="cache" data-type="booleen" ${el.cache ? "checked" : ""}> Caché aux joueurs${g === "hameaux" ? " (tout le hameau)" : ""}</label>
      ${lieu && !lieu.connu ? `<p class="aide">« ${e(lieu.nom)} » est inconnu des joueurs : sur la TV, cet élément reste caché tant que le lieu n'est pas connu, même décoché.</p>` : ""}
      <div class="actions">${plusieurs ? '<button class="danger" data-action="hab-retirer-ferme">Retirer cette ferme</button><button class="danger" data-action="hab-retirer-hameau">Retirer le hameau</button>' : '<button class="danger" data-action="supprimer">Retirer</button>'}</div>`;
  }

  // Le bandeau au-dessus de la carte : l'attente de la rédaction (temps écoulé), puis la proposition à garder ou écarter.
  majBandeau() {
    const b = this.bandeau;
    if (!b) return;
    if (this.habillement) {
      const s = Math.round((Date.now() - this.habillement.depuis) / 1000);
      b.hidden = false;
      b.dataset.etat = "attente";
      b.innerHTML = `<span class="pouls"></span><span>Habillage de la zone… ${s} s (une à trois minutes)</span>`;
      return;
    }
    if (this.apercu) {
      const a = this.apercu;
      b.hidden = false;
      b.dataset.etat = "apercu";
      const peint = this.vue.style === "peint" ? "" : '<button data-action="hab-peint" title="L\'habillage se voit dans le style Peint">Voir en Peint</button>';
      b.innerHTML = a.recouvre
        ? `<span>Proposition : ${e(resumeHab(a.proposition))}. La zone en avait déjà ${a.recouvre}. Rien n'est enregistré.</span>${peint}
          <button class="principal" data-action="hab-garder">Remplacer dans la zone</button><button data-action="hab-ajouter">Ajouter sans rien retirer</button><button data-action="hab-ecarter">Écarter</button>`
        : `<span>Proposition : ${e(resumeHab(a.proposition))}. Rien n'est enregistré.</span>${peint}
          <button class="principal" data-action="hab-garder">Garder</button><button data-action="hab-ecarter">Écarter</button>`;
      return;
    }
    b.hidden = true;
    b.innerHTML = "";
  }

  async habillerZone() {
    const c = this.cadreRegion;
    if (!c || c.actif || this.habillement || this.apercu) return;
    const zone = { x0: +c.x0.toFixed(2), y0: +c.y0.toFixed(2), x1: +c.x1.toFixed(2), y1: +c.y1.toFixed(2) };
    const idee = this.panneau.querySelector('input[name="idee-habillage"]')?.value.trim() || "";
    this.habillement = { zone, depuis: Date.now() };
    this.erreurHab = null;
    this.minuterieHab = setInterval(() => this.majBandeau(), 1000);
    this.afficherPanneau();
    this.vue.demander();
    let r = null;
    try {
      // Le serveur lit la carte enregistrée : ce qui attend part d'abord.
      if (this.etatSauvegarde === "modifie") this.sauverCarte.maintenant();
      await this.chaineCarte;
      r = await api.post(`/api/cartes/${encodeURIComponent(this.carte.id)}/habiller`, { zone, idee, image: await this.captureZone(zone) });
    } catch (err) {
      this.erreurHab = erreurIA(err);
      if (!this.detruit) toast(`Habillage impossible : ${this.erreurHab}`, "erreur");
    }
    clearInterval(this.minuterieHab);
    this.habillement = null;
    if (this.detruit) return;
    if (r?.habillage) this.montrerApercu(r, zone);
    // Une saisie en cours dans le panneau n'est pas coupée.
    const saisie = document.activeElement?.closest?.("input, textarea, select");
    if (!saisie || !this.panneau.contains(saisie)) this.afficherPanneau();
    else this.majBandeau();
    this.vue.demander();
  }

  montrerApercu(r, zone) {
    const avant = this.carte.habillage || null;
    if (this.selection?.genre === "hab") this.selection = null;
    this.apercu = { proposition: r.habillage, avant, zone, remarques: Array.isArray(r.remarques) ? r.remarques : [], recouvre: this.compteHab(avant, zone) };
    // L'aperçu montre ce que donnerait « Garder » : la zone remplacée.
    this.carte.habillage = this.fusionHab(avant, r.habillage, zone, true);
    this.vue.demander();
    const rem = this.apercu.remarques;
    toast(rem.length ? `Proposition prête. Contrôle : ${rem.slice(0, 2).join(" ; ")}${rem.length > 2 ? "…" : ""}` : "Proposition prête : regardez-la sur la carte, puis gardez-la ou écartez-la.");
    if (this.vue.style !== "peint") toast("L'habillage se voit dans le style Peint.");
  }

  garderApercu(remplacer) {
    const a = this.apercu;
    if (!a) return;
    // L'instantané prend l'habillage d'avant (l'aperçu est encore là) : Ctrl+Z y revient.
    this.instantane();
    this.apercu = null;
    this.carte.habillage = this.fusionHab(a.avant, a.proposition, a.zone, remplacer);
    this.afficherPanneau();
    this.vue.demander();
    this.modifie();
    toast("Habillage gardé : cliquez un élément (outil Sélection) pour le cacher, le montrer ou le retirer.");
  }

  ecarterApercu({ dessiner = true } = {}) {
    const a = this.apercu;
    if (!a) return;
    this.apercu = null;
    this.carte.habillage = a.avant;
    if (!dessiner) return;
    this.afficherPanneau();
    this.vue.demander();
  }

  // L'habillage rattaché à un lieu, dans sa fiche : c'est là que le MJ montre aux joueurs ce qui était caché d'office.
  panneauLieuHab(lieu) {
    const h = this.habillageGarde();
    const liste = GENRES_HAB.flatMap((g) => listeHab(h, g).filter((el) => el.lieu === lieu.id).map((el) => ({ g, el })));
    if (!liste.length || this.apercu) return "";
    const nom = ({ g, el }) => (g === "batiments" ? NOMS_BATIMENTS[el.genre] || "Bâtiment" : g === "chemins" && el.genre === "chemin" ? "Chemin" : NOMS_HAB[g]);
    const caches = liste.filter((x) => x.el.cache).length;
    return `
      <h3>Habillage de ce lieu <span class="compte">${liste.length}</span></h3>
      <ul class="liste-lieux">${liste.map((x) => `<li><button data-action="hab-choisir" data-valeur="${e(x.g)}:${e(x.el.id)}">${e(nom(x))}${x.el.cache ? '<span class="secret">caché</span>' : ""}</button></li>`).join("")}</ul>
      ${lieu.connu ? "" : '<p class="aide">Le lieu est inconnu des joueurs : son habillage reste caché sur la TV tant qu\'il ne l\'est pas.</p>'}
      <div class="actions">${caches ? `<button data-action="hab-lieu-montrer" data-valeur="${e(lieu.id)}">Montrer aux joueurs</button>` : ""}${caches < liste.length ? `<button data-action="hab-lieu-cacher" data-valeur="${e(lieu.id)}">Tout cacher</button>` : ""}</div>`;
  }

  cacherHabLieu(idLieu, cacher) {
    const h = this.carte.habillage;
    if (!h || this.apercu) return;
    this.instantane();
    for (const g of GENRES_HAB) for (const el of listeHab(h, g)) if (el.lieu === idLieu) el.cache = cacher;
    this.afficherPanneau();
    this.vue.demander();
    this.modifie();
  }

  retirerElementHab(sel, fermeSeule) {
    const h = this.carte.habillage;
    const el = this.elementHab(sel);
    if (!h || !el) return;
    this.instantane();
    if (fermeSeule && sel.cat === "hameaux" && (el.fermes || []).length > 1) el.fermes.splice(sel.ferme, 1);
    else h[sel.cat] = listeHab(h, sel.cat).filter((x) => x.id !== sel.id);
    this.selection = null;
    this.afficherPanneau();
    this.vue.demander();
    this.modifie();
  }

  // Toute la carte (zone nulle) ou une zone : on le demande, Ctrl+Z y revient.
  async retirerHabillage(zone) {
    const h = this.carte.habillage;
    const n = this.compteHab(h, zone);
    if (!h || !n || this.apercu) return;
    const question = zone ? { titre: "Retirer l'habillage de la zone", texte: `Les ${n} éléments d'habillage de cette zone.` } : { titre: "Retirer tout l'habillage", texte: `Tout l'habillage de la carte : ${resumeHab(h)}.` };
    if (!(await demander({ ...question, aide: "Ctrl+Z revient en arrière.", oui: "Retirer" }))) return;
    if (this.detruit || this.carte.habillage !== h || this.apercu) return;
    this.instantane();
    if (zone) {
      const res = { ...h };
      for (const g of GENRES_HAB) res[g] = listeHab(h, g).filter((el) => !this.dansZoneHab(g, el, zone));
      this.carte.habillage = res;
    } else this.carte.habillage = null;
    if (this.selection?.genre === "hab") this.selection = null;
    this.afficherPanneau();
    this.vue.demander();
    this.modifie();
  }

  // La fiche d'un lieu écrite d'après la campagne, le canon et les lieux voisins : seuls les champs vides sont remplis,
  // sauf accord du MJ pour tout réécrire.
  async redigerLieu(id, bouton) {
    const lieu = this.lieux[id];
    if (!lieu) return;
    const champs = ["resume", "secrets", "notes"];
    const vides = champs.filter((k) => !(lieu[k] || "").trim());
    if (!vides.length && !(await demander({ titre: "Réécrire la fiche", texte: "Les trois champs sont remplis : la proposition les remplacerait tous.", oui: "Tout réécrire", non: "Garder la fiche", danger: true }))) return;
    const idee = this.panneau.querySelector('input[name="idee-lieu"]')?.value.trim() || "";
    bouton.disabled = true;
    bouton.textContent = "Rédaction de la fiche…";
    try {
      const r = await api.post(`/api/lieux/${encodeURIComponent(id)}/redaction`, { idee, fiche: { nom: lieu.nom, type: lieu.type, connu: lieu.connu, resume: lieu.resume, secrets: lieu.secrets, notes: lieu.notes } });
      this.instantane();
      for (const k of vides.length ? vides : champs) if (r[k]) lieu[k] = r[k];
      this.lieuModifie(id);
      toast("Fiche proposée : relisez-la, gardez ce qui vous plaît.");
    } catch (err) {
      toast(`Rien de proposé : ${erreurIA(err, "la fiche s'écrit aussi à la main, rien n'a été effacé")}.`, "erreur");
    }
    this.afficherPanneau();
  }

  async supprimerMarqueur(id, avecFiche) {
    const m = this.marqueur(id);
    if (!m) return;
    this.instantane();
    this.carte.marqueurs = this.carte.marqueurs.filter((x) => x.id !== id);
    if (avecFiche && m.lieu) {
      try {
        await api.del(`/api/lieux/${m.lieu}`);
        delete this.lieux[m.lieu];
      } catch (err) {
        toast(`La fiche n'a pas pu être supprimée : ${err.message}`, "erreur");
      }
    }
    this.champs.majVoies({ x0: m.x - 3, y0: m.y - 4, x1: m.x + 3, y1: m.y + 3 });
    this.vue.rafraichirZone({ x0: m.x - 5, y0: m.y - 6, x1: m.x + 5, y1: m.y + 6 });
    this.selectionner(null);
    this.modifie();
  }

  // ---- tracés ----

  clicTrace(x, y) {
    const auto = this.traceAuto && ["route", "chemin"].includes(this.typeTrace);
    if (auto) {
      if (!this.traceEnCours) {
        this.traceEnCours = { id: nouvelId("t"), type: this.typeTrace, points: [[x, y]], auto: true };
        this.vue.demander();
        return;
      }
      const [ax, ay] = this.traceEnCours.points[0];
      const w = this.carte.largeur;
      const cout = (i) => BIOMES[this.carte.terrain[i]].cout;
      const depart = clamp(Math.floor(ay), 0, this.carte.hauteur - 1) * w + clamp(Math.floor(ax), 0, w - 1);
      const arrivee = clamp(Math.floor(y), 0, this.carte.hauteur - 1) * w + clamp(Math.floor(x), 0, w - 1);
      const chemin = cheminLePlusSur(w, this.carte.hauteur, cout, depart, arrivee);
      if (!chemin) {
        toast("Pas de chemin par voie de terre entre ces deux points.", "erreur");
        this.traceEnCours = null;
        this.vue.demander();
        return;
      }
      const pts = simplifier([[ax, ay], ...chemin.slice(1, -1).map((i) => [(i % w) + 0.5, Math.floor(i / w) + 0.5]), [x, y]], 0.6);
      this.traceEnCours.points = pts.map(([px, py]) => [+px.toFixed(2), +py.toFixed(2)]);
      this.finirTrace();
      return;
    }
    if (!this.traceEnCours) {
      this.traceEnCours = { id: nouvelId("t"), type: this.typeTrace, points: [] };
      if (this.typeTrace === "riviere") this.traceEnCours.largeur = [0.16 * this.k(), 0.45 * this.k()];
    }
    this.traceEnCours.points.push([+x.toFixed(2), +y.toFixed(2)]);
    this.vue.demander();
  }

  finirTrace() {
    const t = this.traceEnCours;
    this.traceEnCours = null;
    if (!t || t.points.length < 2) {
      this.vue.demander();
      return;
    }
    delete t.auto;
    this.instantane();
    this.carte.traces.push(t);
    this.traceChangee(t);
    this.selectionner({ genre: "trace", id: t.id });
  }

  supprimerTrace(id) {
    const t = this.trace(id);
    if (!t) return;
    this.instantane();
    this.carte.traces = this.carte.traces.filter((x) => x.id !== id);
    const b = this.boiteTrace(t);
    this.champs.majVoies(b);
    this.vue.rafraichirZone(b);
    this.selectionner(null);
    this.modifie();
  }

  // ---- étiquettes, groupe ----

  creerEtiquette(x, y) {
    this.instantane();
    const st = STYLES_TEXTE[this.styleEtiquette];
    const et = { id: nouvelId("e"), texte: "Nouveau nom", style: this.styleEtiquette, x: +x.toFixed(2), y: +y.toFixed(2), taille: +(st.taille * this.k()).toFixed(2), courbure: 0, angle: 0 };
    this.carte.etiquettes.push(et);
    this.selectionner({ genre: "etiquette", id: et.id });
    this.modifie();
    donnerLaMain(this.panneau.querySelector('[data-champ="texte"]'), this.canvas);
  }

  placerGroupe(x, y) {
    this.instantane();
    const g = (this.carte.groupe ||= { visible: true, montrer: true, trajet: [] });
    if (this.traceTrajet) {
      if (!g.trajet?.length && g.x !== undefined) g.trajet = [[g.x, g.y]];
      g.trajet = [...(g.trajet || []), [+x.toFixed(2), +y.toFixed(2)]];
    }
    g.x = +x.toFixed(2);
    g.y = +y.toFixed(2);
    g.visible = true;
    this.vue.demander();
    this.modifie();
    this.afficherPanneau();
    if (this.suivre) this.suivreTable();
  }

  // ---- clavier ----

  touche(ev) {
    // Un dialogue ouvert par-dessus (journal, règles…) garde le clavier pour lui.
    if (rendreLaMain(ev, this.canvas) || document.querySelector("dialog[open]")) return;
    const cible = ev.target;
    const saisie = cible.closest && cible.closest("input, textarea, select, [contenteditable]");
    if ((ev.ctrlKey || ev.metaKey) && !saisie) {
      if (ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault();
        this.annuler();
        return;
      }
      if (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey)) {
        ev.preventDefault();
        this.refaire();
        return;
      }
    }
    if (saisie || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.code === "Space") {
      this.espace = true;
      ev.preventDefault();
      return;
    }
    if (ev.key === "Escape") {
      this.pointeur?.effacer();
      if (this.aPoser) {
        this.aPoser = null;
        this.afficherPanneau();
      } else if (this.traceEnCours) {
        this.traceEnCours = null;
        this.vue.demander();
      } else this.selectionner(null);
      return;
    }
    if (ev.key === "Enter" && this.traceEnCours) {
      this.finirTrace();
      return;
    }
    if (ev.key === "Backspace" && this.traceEnCours) {
      this.traceEnCours.points.pop();
      this.vue.demander();
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && this.selection) {
      ev.preventDefault();
      this.supprimerSelection();
      return;
    }
    if (ev.key === "+" || ev.key === "=") this.vue.zoomer(1.25, this.vue.lw / 2, this.vue.lh / 2);
    if (ev.key === "-") this.vue.zoomer(0.8, this.vue.lw / 2, this.vue.lh / 2);
    if (ev.key === "0") this.vue.cadrer();
    const outil = OUTILS.find((o) => o[2].toLowerCase() === ev.key.toLowerCase());
    if (outil) this.choisirOutil(outil[0]);
    if (ev.key === "[" || ev.key === "]") {
      const d = ev.key === "]" ? 1 : -1;
      if (this.outil === "terrain") this.pinceau.rayon = clamp(this.pinceau.rayon + d, 1, 30);
      if (this.outil === "brouillard") this.brume.rayon = clamp(this.brume.rayon + d, 1, 60);
      this.afficherPanneau();
      this.vue.demander();
    }
  }

  // « Détailler une région » : le cadre à tracer est prêt (depuis le panneau, ou depuis « Nouvelle carte » › « Une région
  // d'une carte existante », qui ouvre cette carte-ci).
  detaillerRegion() {
    this.cadreRegion = null;
    this.regionPour = "detailler";
    this.choisirOutil("region");
  }

  supprimerSelection() {
    const s = this.selection;
    if (!s) return;
    if (s.genre === "marqueur") {
      const m = this.marqueur(s.id);
      const nom = this.lieux[m?.lieu]?.nom || "ce lieu";
      // La fiche reste : d'autres cartes, des PNJ et des séances peuvent y renvoyer. Ctrl+Z remet le marqueur.
      demander({ titre: `Retirer « ${nom} » de cette carte`, texte: "Sa fiche reste dans les Lieux.", aide: "Ctrl+Z remet le lieu sur la carte.", oui: "Retirer de la carte" })
        .then((oui) => oui && !this.detruit && this.marqueur(s.id) && this.supprimerMarqueur(s.id, false));
    } else if (s.genre === "trace") this.supprimerTrace(s.id);
    else if (s.genre === "hab") this.retirerElementHab(s, s.ferme !== undefined);
    else if (s.genre === "etiquette") {
      this.instantane();
      this.carte.etiquettes = this.carte.etiquettes.filter((x) => x.id !== s.id);
      this.selectionner(null);
      this.modifie();
    }
  }

  // ---- surimpressions de l'éditeur ----

  dessinerEditeur(ctx, zone) {
    const z = this.vue.cam.z;
    const px = (n) => n / z;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (!this.vue.joueurs && this.outil === "brouillard" && this.carte.brouillard_actif) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.champs.brouillard(this.texture), 0, 0, this.champs.w, this.champs.h);
      ctx.globalAlpha = 1;
    }
    const s = this.selection;
    const cadre = (b) => {
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(5), px(4)]);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.setLineDash([]);
    };
    if (s?.genre === "marqueur") {
      const m = this.marqueur(s.id);
      if (m) {
        const b = this.boiteMarqueur(m);
        cadre(b.icone);
        if (b.nom) cadre(b.nom);
      }
    } else if (s?.genre === "etiquette") {
      const et = this.etiquette(s.id);
      if (et) {
        const g = this.geometrieEtiquette(et);
        ctx.save();
        ctx.translate(et.x, et.y);
        ctx.rotate(g.angle);
        cadre({ x0: -g.l / 2, y0: -g.h / 2 + Math.min(0, g.fleche), x1: g.l / 2, y1: g.h / 2 + Math.max(0, g.fleche) });
        ctx.restore();
      }
    } else if (s?.genre === "trace") {
      const t = this.trace(s.id);
      if (t) {
        ctx.strokeStyle = "rgba(224,181,98,.9)";
        ctx.lineWidth = px(2);
        ctx.setLineDash([px(6), px(4)]);
        ctx.beginPath();
        t.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, y] of t.points) {
          ctx.beginPath();
          ctx.arc(x, y, px(4.5), 0, Math.PI * 2);
          ctx.fillStyle = "#f4ead4";
          ctx.fill();
          ctx.lineWidth = px(1.6);
          ctx.strokeStyle = "#8e1b17";
          ctx.stroke();
        }
      }
    } else if (s?.genre === "decor") {
      const d = this.carte.decor[s.cle];
      if (s.cle === "cartouche") cadre(this.boiteCartouche(d));
      if (s.cle === "echelle") cadre(this.boiteEchelle(d));
      if (s.cle === "rose") {
        const r = (d.taille || 8) * 0.5;
        cadre({ x0: d.x - r, y0: d.y - r, x1: d.x + r, y1: d.y + r });
      }
    } else if (s?.genre === "groupe" && this.carte.groupe) {
      const g = this.carte.groupe;
      const k = this.k();
      cadre({ x0: g.x - 0.6 * k, y0: g.y - 2.2 * k, x1: g.x + 1.4 * k, y1: g.y + 0.4 * k });
    }
    this.dessinerReperesHab(ctx, px);
    const t = this.traceEnCours;
    if (t) {
      ctx.strokeStyle = "#8e1b17";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(7), px(5)]);
      ctx.beginPath();
      t.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (this.curseur) ctx.lineTo(...this.curseur);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of t.points) {
        ctx.beginPath();
        ctx.arc(x, y, px(3.5), 0, Math.PI * 2);
        ctx.fillStyle = "#8e1b17";
        ctx.fill();
      }
    }
    const c = this.curseur;
    if (c && (this.outil === "terrain" || this.outil === "brouillard")) {
      const r = this.outil === "terrain" ? this.pinceau.rayon : this.brume.rayon;
      ctx.beginPath();
      ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20,14,10,.8)";
      ctx.lineWidth = px(3);
      ctx.stroke();
      ctx.strokeStyle = "#f0d596";
      ctx.lineWidth = px(1.4);
      ctx.stroke();
    }
    if (this.mesure) this.dessinerMesure(ctx, px);
    if (!this.vue.joueurs) {
      for (const enfant of this.enfants || []) {
        const r = enfant.parent;
        ctx.strokeStyle = "rgba(142,27,23,.85)";
        ctx.lineWidth = px(1.5);
        ctx.setLineDash([px(8), px(5)]);
        ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        ctx.setLineDash([]);
        ctx.font = `italic 600 ${px(14)}px 'EB Garamond'`;
        ctx.fillStyle = "rgba(142,27,23,.95)";
        ctx.textBaseline = "bottom";
        ctx.fillText(enfant.nom, r.x0 + px(4), r.y0 - px(3));
      }
    }
    for (const f of this.fantomes || []) {
      const r = px(11);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(244,234,212,.45)";
      ctx.strokeStyle = "#8e1b17";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(4), px(3)]);
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `italic 600 ${px(13)}px 'EB Garamond'`;
      ctx.textBaseline = "middle";
      ctx.lineWidth = px(3);
      ctx.strokeStyle = "rgba(244,234,212,.9)";
      ctx.strokeText(f.nom, f.x + r + px(4), f.y);
      ctx.fillStyle = "#2b1d12";
      ctx.fillText(f.nom, f.x + r + px(4), f.y);
      ctx.restore();
    }
    const cr = this.cadreRegion;
    if (cr) {
      const x0 = Math.min(cr.x0, cr.x1);
      const y0 = Math.min(cr.y0, cr.y1);
      ctx.fillStyle = "rgba(224,181,98,.12)";
      ctx.fillRect(x0, y0, Math.abs(cr.x1 - cr.x0), Math.abs(cr.y1 - cr.y0));
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(7), px(4)]);
      ctx.strokeRect(x0, y0, Math.abs(cr.x1 - cr.x0), Math.abs(cr.y1 - cr.y0));
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Vue du MJ, style peint : ce qui est caché aux joueurs est cerné de rouge, la sélection d'or ; la zone d'une demande
  // en cours ou d'une proposition montrée, en pointillé doré.
  dessinerReperesHab(ctx, px) {
    const z = this.habillement?.zone || this.apercu?.zone;
    if (z) {
      ctx.strokeStyle = "#e0b562";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(7), px(4)]);
      ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.setLineDash([]);
    }
    if (!this.habillageModifiable() || this.vue.joueurs) return;
    const tracer = (g, el, couleur, epais) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = px(epais);
      ctx.setLineDash([px(5), px(4)]);
      ctx.beginPath();
      if (g === "champs" || g === "vergers") {
        (el.zone || []).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      } else if (g === "haies" || g === "chemins") {
        (el.points || []).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      } else if (g === "hameaux") {
        for (const f of el.fermes || []) {
          ctx.moveTo(f.x + 1.5, f.y);
          ctx.arc(f.x, f.y, 1.5, 0, Math.PI * 2);
        }
      } else {
        const r = g === "ponts" ? (+el.longueur || 1.4) / 2 + 0.3 : 1;
        ctx.moveTo(el.x + r, el.y);
        ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const h = this.carte.habillage;
    for (const g of GENRES_HAB) for (const el of listeHab(h, g)) if (el.cache) tracer(g, el, "rgba(224,88,76,.85)", 1.5);
    const sel = this.elementHab();
    if (sel) tracer(this.selection.cat, sel, "#e0b562", 2.5);
  }

  finRegion() {
    const c = this.cadreRegion;
    c.actif = false;
    const rect = { x0: Math.max(0, Math.min(c.x0, c.x1)), y0: Math.max(0, Math.min(c.y0, c.y1)), x1: Math.min(this.carte.largeur, Math.max(c.x0, c.x1)), y1: Math.min(this.carte.hauteur, Math.max(c.y0, c.y1)) };
    if (rect.x1 - rect.x0 < 4 || rect.y1 - rect.y0 < 4) {
      this.cadreRegion = null;
      toast("Cadre trop petit : tracez un rectangle plus grand.");
      this.vue.demander();
      return;
    }
    this.cadreRegion = { ...c, ...rect };
    this.afficherPanneau();
    const champ = this.panneau.querySelector('input[name="nom-region"]');
    if (champ) {
      champ.focus();
      champ.select();
    }
  }

  facteursRegion() {
    const c = this.cadreRegion;
    const l = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    return [3, 4, 5, 6, 8, 10, 12]
      .map((f) => ({ f, w: Math.round(l * f), h: Math.round(h * f), km: (this.carte.km_case || 1) / f }))
      .filter((o) => o.w * o.h <= 150000 && o.w >= 40);
  }

  nomRegionParDefaut() {
    const c = this.cadreRegion;
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    let meilleur = null;
    let dmin = Infinity;
    for (const m of this.carte.marqueurs) {
      if (m.x < c.x0 || m.x > c.x1 || m.y < c.y0 || m.y > c.y1) continue;
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < dmin && this.lieux[m.lieu]) {
        dmin = d;
        meilleur = this.lieux[m.lieu].nom;
      }
    }
    return meilleur ? `Les environs de ${meilleur}` : "Nouvelle région";
  }

  async creerRegion(nom, facteur) {
    const c = this.cadreRegion;
    if (!c) return;
    try {
      if (!(facteur > 0)) throw new Error("choisissez une précision");
      const source = { ...this.carte, typesLieux: Object.fromEntries(this.carte.marqueurs.map((m) => [m.lieu, this.lieux[m.lieu]?.type])) };
      const region = genererRegion(source, c, facteur, { graine: Math.floor(Math.random() * 1e6), nom });
      region.nom = nom;
      region.style = this.vue.style;
      region.brouillard_actif = !!this.carte.brouillard_actif;
      const brouillard = new Uint8Array(region.largeur * region.hauteur);
      if (this.carte.brouillard_actif) {
        for (let y = 0; y < region.hauteur; y++) {
          for (let x = 0; x < region.largeur; x++) {
            const sx = Math.floor(c.x0 + (x + 0.5) / facteur);
            const sy = Math.floor(c.y0 + (y + 0.5) / facteur);
            brouillard[y * region.largeur + x] = this.carte.brouillard[sy * this.carte.largeur + sx];
          }
        }
      }
      if (this.etatSauvegarde === "modifie") await this.sauverCarte.maintenant();
      const r = await api.post("/api/cartes", encoderCarte({ ...region, brouillard }));
      this.cadreRegion = null;
      location.hash = `#/carte/${r.id}`;
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
      this.afficherPanneau();
    }
  }

  // La règle part vers la page Table du coin des joueurs : la distance seule, sans les temps de marche.
  envoyerRegle() {
    const m = this.mesure;
    if (!m || !this.pointeur || Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * (this.carte.km_case || 1) < 0.01) return;
    const km = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * (this.carte.km_case || 1);
    this.pointeur.regle([m.x0, m.y0], [m.x1, m.y1], `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`);
  }

  dessinerMesure(ctx, px) {
    const m = this.mesure;
    const km = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * (this.carte.km_case || 1);
    ctx.strokeStyle = "#8e1b17";
    ctx.lineWidth = px(2.5);
    ctx.setLineDash([px(8), px(5)]);
    ctx.beginPath();
    ctx.moveTo(m.x0, m.y0);
    ctx.lineTo(m.x1, m.y1);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[m.x0, m.y0], [m.x1, m.y1]]) {
      ctx.beginPath();
      ctx.arc(x, y, px(4), 0, Math.PI * 2);
      ctx.fillStyle = "#8e1b17";
      ctx.fill();
    }
    const texte = `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km · ${this.jours(km / 30)} à pied · ${this.jours(km / 50)} à cheval`;
    ctx.font = `600 ${px(14)}px 'EB Garamond'`;
    const l = ctx.measureText(texte).width;
    const x = m.x1 + px(12);
    const y = m.y1 - px(12);
    ctx.fillStyle = "rgba(27,20,15,.88)";
    ctx.fillRect(x - px(8), y - px(14), l + px(16), px(24));
    ctx.fillStyle = "#f4ead4";
    ctx.textBaseline = "middle";
    ctx.fillText(texte, x, y - px(2));
  }

  jours(j) {
    if (j < 0.2) return "moins d'une demi-journée";
    if (j < 0.75) return "une demi-journée";
    const n = Math.round(j * 2) / 2;
    return `${String(n).replace(".", ",")} jour${n >= 2 ? "s" : ""}`;
  }

  majInfos() {
    if (!this.curseur || !this.infos) return;
    const [x, y] = this.curseur;
    const km = this.carte.km_case || 1;
    const dans = x >= 0 && y >= 0 && x < this.carte.largeur && y < this.carte.hauteur;
    const biome = dans ? BIOMES[this.champs.biomeA(x, y)].nom : "";
    const echelle = km >= 1 ? `1 case = ${String(km).replace(".", ",")} km` : `1 case = ${Math.round(km * 1000)} m`;
    this.infos.textContent = `${biome}${biome ? " · " : ""}${echelle} · zoom ${Math.round((this.vue.cam.z / this.vue.zoomCadre()) * 100)} %`;
  }

  // ---- panneau ----

  afficherPanneau() {
    const s = this.selection;
    let html = "";
    if (s?.genre === "marqueur" && this.marqueur(s.id)) html = this.panneauLieu(this.marqueur(s.id));
    // Tracés en série : l'outil garde le choix Route, Rivière…, la fiche du tracé qu'on vient de finir passe dessous.
    else if (s?.genre === "trace" && this.trace(s.id)) html = this.outil === "trace" ? `${this.panneauOutil()}<section class="pose-en-serie">${this.panneauTrace(this.trace(s.id))}</section>` : this.panneauTrace(this.trace(s.id));
    else if (s?.genre === "etiquette" && this.etiquette(s.id)) html = this.panneauEtiquette(this.etiquette(s.id));
    else if (s?.genre === "decor") html = this.panneauDecor(s.cle);
    else if (s?.genre === "groupe") html = this.panneauGroupe();
    else if (s?.genre === "hab" && this.elementHab(s)) html = this.panneauHab(s, this.elementHab(s));
    else html = this.panneauOutil();
    this.panneau.innerHTML = html;
    // Le panneau d'un lieu : « Ajouter un PNJ » et « Dans les scénarios » (lieux/panneau-lieu.js).
    if (s?.genre === "marqueur" && this.marqueur(s.id)) {
      monterPanneauLieu(this.panneau, {
        lieu: this.lieux[this.marqueur(s.id).lieu], pnj: () => this.pnj, lieux: () => this.lieux, redessiner: () => this.afficherPanneau(),
      });
    }
    this.peindreBoutonLieu();
    this.majBandeau();
  }

  panneauOutil() {
    switch (this.outil) {
      case "terrain":
        return `
          <h2>Peindre le terrain</h2>
          <p class="aide">Glissez sur la carte. Les montagnes, forêts et côtes se dessinent seules. <kbd>[</kbd> <kbd>]</kbd> changent la taille du pinceau.</p>
          <div class="palette" role="radiogroup" aria-label="Terrain">
            ${ORDRE_PALETTE.map((cle) => {
              const b = BIOMES[B[cle]];
              const c = PALETTES.couleur.lavis[cle];
              const fond = cle === "eau" ? "rgb(88,140,160)" : `rgb(${c[0]},${c[1]},${c[2]})`;
              return `<button role="radio" aria-checked="${this.pinceau.biome === b.id}" data-action="biome" data-valeur="${b.id}"><span class="pastille" style="background:${fond}"></span>${e(b.nom)}</button>`;
            }).join("")}
          </div>
          <label class="champ">Taille du pinceau <output>${this.pinceau.rayon}</output>
            <input type="range" min="1" max="30" step="1" value="${this.pinceau.rayon}" data-cible="pinceau" data-champ="rayon" data-type="nombre"></label>
          ${this.panneauCarte()}`;
      case "brouillard":
        return `
          <h2>Terres connues des joueurs</h2>
          <label class="case"><input type="checkbox" data-cible="carte" data-champ="brouillard_actif" data-type="booleen" ${this.carte.brouillard_actif ? "checked" : ""}> Cacher aux joueurs les terres inconnues</label>
          <p class="aide">Peignez ce que les héros connaissent. Maj ou Alt en peignant fait l'inverse. Vérifiez avec « Vue joueurs ».</p>
          <div class="segments large" role="group">
            <button data-action="brume-mode" data-valeur="reveler" aria-pressed="${this.brume.mode === "reveler"}">Révéler</button>
            <button data-action="brume-mode" data-valeur="cacher" aria-pressed="${this.brume.mode === "cacher"}">Recouvrir</button>
          </div>
          <label class="champ">Taille du pinceau <output>${this.brume.rayon}</output>
            <input type="range" min="1" max="60" step="1" value="${this.brume.rayon}" data-cible="brume" data-champ="rayon" data-type="nombre"></label>
          <div class="actions">
            <button data-action="brume-tout" data-valeur="1">Tout révéler</button>
            <button data-action="brume-tout" data-valeur="0">Tout recouvrir</button>
          </div>`;
      case "lieu": {
        const enAttente = this.lieux[this.aPoser];
        if (enAttente) return `
          <h2>Poser « ${e(enAttente.nom)} »</h2>
          <p class="aide">Cliquez sur la carte, là où se trouve ce lieu : il y retrouve sa fiche telle quelle, secrets et notes compris. Échap pour y renoncer.</p>
          <div class="actions"><button data-action="pose-annuler">Ne pas le poser</button></div>`;
        const orphelins = this.lieuxSansCarte();
        return `
          <h2>Poser un lieu</h2>
          <p class="aide">Choisissez le genre de lieu, puis cliquez sur la carte. Sa fiche s'ouvre ici.</p>
          <div class="grille-types">
            ${TYPES_LIEUX.map((t) => `<button data-action="type-lieu" data-valeur="${t.cle}" aria-pressed="${this.typeLieu === t.cle}">${e(t.nom)}</button>`).join("")}
          </div>
          ${orphelins.length ? `
          <h3>Lieux sans carte <span class="compte">${orphelins.length}</span></h3>
          <p class="aide">Ils ont déjà leur fiche. Choisissez-en un, puis cliquez sur la carte pour l'y poser.</p>
          <ul class="liste-lieux">
            ${orphelins.map((l) => `<li><button data-action="poser-lieu" data-valeur="${e(l.id)}">${e(l.nom || "Lieu sans nom")}${l.connu ? "" : '<span class="secret">secret</span>'}</button></li>`).join("")}
          </ul>` : ""}
          ${this.listeLieux()}`;
      }
      case "trace":
        return `
          <h2>Tracer</h2>
          <div class="grille-types">
            ${TYPES_TRACES.map((t) => `<button data-action="type-trace" data-valeur="${t.cle}" aria-pressed="${this.typeTrace === t.cle}">${e(t.nom)}</button>`).join("")}
          </div>
          ${["route", "chemin"].includes(this.typeTrace) ? `<label class="case"><input type="checkbox" data-cible="editeur" data-champ="traceAuto" data-type="booleen" ${this.traceAuto ? "checked" : ""}> Tracé automatique : cliquez le départ puis l'arrivée, la route suit le terrain</label>` : ""}
          <p class="aide">${this.traceAuto && ["route", "chemin"].includes(this.typeTrace) ? "" : "Cliquez point par point. Double-clic ou Entrée pour finir, Retour arrière pour effacer le dernier point, Échap pour abandonner."} Une rivière se trace de la source vers l'embouchure.</p>`;
      case "texte":
        return `
          <h2>Nom de région</h2>
          <p class="aide">Choisissez un style puis cliquez sur la carte.</p>
          <div class="grille-types">
            ${STYLES_ETIQUETTES.map((t) => `<button data-action="style-etiquette" data-valeur="${t.cle}" aria-pressed="${this.styleEtiquette === t.cle}">${e(t.nom)}</button>`).join("")}
          </div>`;
      case "groupe":
        return `
          <h2>Le groupe</h2>
          <p class="aide">Cliquez où se trouvent les aventuriers. La bannière rouge les suit sur la carte et sur la TV.</p>
          <label class="case"><input type="checkbox" data-cible="editeur" data-champ="traceTrajet" data-type="booleen" ${this.traceTrajet ? "checked" : ""}> Garder la trace du voyage</label>
          ${this.carte.groupe ? this.panneauGroupeCorps() : ""}`;
      case "region": {
        const c = this.cadreRegion;
        if (this.regionPour === "habiller") return this.panneauRegionHab(c);
        if (this.regionPour === "peupler") {
          if (!c || c.actif) {
            return `
              <h2>Peupler une région</h2>
              <p class="aide">Tracez un rectangle autour de la zone à peupler. Plus elle est petite, plus les lieux seront placés finement.</p>
              <div class="actions"><button data-action="annuler-region">Annuler</button></div>
              ${this.panneauFantomes()}`;
          }
          return `
            <h2>Peupler une région</h2>
            <label class="champ">Combien de lieux<select name="nombre-lieux">${[3, 4, 5, 6, 8].map((n) => `<option ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
            <label class="champ">Une idée de départ (facultatif)<input type="text" name="idee-region" placeholder="une vallée de bûcherons inquiets, une ruine elfique"></label>
            <div class="actions">
              <button class="principal" data-action="peupler-proposer" data-estimation="peupler" ${this.peuplement ? "disabled" : ""}>${this.peuplement ? "Lecture de la carte…" : "Proposer des lieux"}</button>
              <button data-action="peupler">Autre cadre</button>
              <button data-action="annuler-region">Fermer</button>
            </div>
            ${this.panneauFantomes()}`;
        }
        if (!c || c.actif) {
          return `
            <h2>Détailler une région</h2>
            <p class="aide">Tracez un rectangle sur la carte autour de la région où jouent les aventuriers. L'atelier en tire une carte plus précise : mêmes côtes, rivières, routes et lieux, avec bosquets, clairières et collines en plus.</p>
            <div class="actions"><button data-action="annuler-region">Annuler</button></div>`;
        }
        const options = this.facteursRegion();
        if (!options.length) {
          return `
          <h2>Nouvelle carte de région</h2>
          <p class="alerte">Ce cadre est trop grand pour une carte détaillée. Tracez un rectangle plus petit.</p>
          <div class="actions"><button data-action="detailler">Recommencer</button><button data-action="annuler-region">Annuler</button></div>`;
        }
        const defaut = options.find((o) => o.km <= 2) || options[options.length - 1];
        return `
          <h2>Nouvelle carte de région</h2>
          <label class="champ">Nom<input type="text" name="nom-region" value="${e(this.nomRegionParDefaut())}"></label>
          <label class="champ">Précision<select name="facteur-region">
            ${options.map((o) => `<option value="${o.f}" ${o === defaut ? "selected" : ""}>${o.km >= 1 ? `${String(+o.km.toFixed(2)).replace(".", ",")} km` : `${Math.round(o.km * 1000)} m`} par case (${o.w} × ${o.h} cases)</option>`).join("")}
          </select></label>
          <p class="aide">Les lieux du cadre gardent leur fiche : les modifier sur une carte les modifie partout.</p>
          <div class="actions">
            <button class="principal" data-action="creer-region">Créer la carte</button>
            <button data-action="annuler-region">Annuler</button>
          </div>`;
      }
      case "mesure":
        return `
          <h2>Mesurer</h2>
          <p class="aide">Glissez d'un point à un autre. On compte 30 km par jour à pied et 50 à cheval, sur terrain facile. Les joueurs voient la règle (la distance seule) sur la page Table de leur coin.</p>`;
      case "pointeur":
        return panneauPointeur("carte", this.etatPortee());
      default:
        return this.panneauCarte(true);
    }
  }

  // Ce que l'outil Pointeur dit de la TV : d'après le serveur s'il a répondu depuis, sinon d'après la table relue.
  etatPortee() {
    return textePortee(this.portee, this.tableIci, this.ecransTable, "cette carte");
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

  listeLieux() {
    const lignes = this.carte.marqueurs
      .map((m) => ({ m, lieu: this.lieux[m.lieu] }))
      .filter((x) => x.lieu)
      .sort((a, b) => a.lieu.nom.localeCompare(b.lieu.nom, "fr"));
    if (!lignes.length) return "";
    const aValider = lignes.filter((x) => x.lieu.a_valider).length;
    return `
      <h3>Lieux de la carte <span class="compte">${lignes.length}</span></h3>
      ${aValider ? `<p class="aide">${aValider} position${aValider > 1 ? "s" : ""} proposée${aValider > 1 ? "s" : ""} par l'atelier, entourée${aValider > 1 ? "s" : ""} de rouge : déplacez-les à votre idée puis décochez « à valider ».</p>` : ""}
      <ul class="liste-lieux">
        ${lignes.map(({ m, lieu }) => `<li><button data-action="aller-lieu" data-valeur="${e(m.id)}">${e(lieu.nom)}${lieu.a_valider ? '<span class="pastille-valider" title="Position à valider"></span>' : ""}${lieu.connu ? "" : '<span class="secret">secret</span>'}</button></li>`).join("")}
      </ul>`;
  }

  panneauCarte(complet) {
    const c = this.carte;
    const d = c.decor || {};
    if (!complet) return "";
    return `
      <h2>La carte</h2>
      <label class="champ">Nom<input type="text" value="${e(c.nom)}" data-cible="carte" data-champ="nom"></label>
      <div class="deux">
        <label class="champ">Kilomètres par case<input type="number" min="0.01" step="0.5" value="${c.km_case || 1}" data-cible="carte" data-champ="km_case" data-type="nombre"></label>
        <label class="champ">Taille des textes<input type="number" min="0.4" max="5" step="0.1" value="${c.taille_textes || 1}" data-cible="carte" data-champ="taille_textes" data-type="nombre"></label>
      </div>
      <label class="champ">Taille des montagnes et des arbres <output>${virgule((c.taille_symboles || 1))}</output>
        <input type="range" min="0.5" max="2.5" step="0.1" value="${c.taille_symboles || 1}" data-cible="carte" data-champ="taille_symboles" data-type="nombre" data-apres="symboles"></label>
      <h3>Décor</h3>
      <div class="cases">
        <label class="case"><input type="checkbox" data-cible="decor" data-champ="cadre" data-type="booleen" ${d.cadre !== false ? "checked" : ""}> Cadre</label>
        <label class="case"><input type="checkbox" data-cible="decor-visible" data-champ="cartouche" data-type="booleen" ${d.cartouche && d.cartouche.visible !== false ? "checked" : ""}> Cartouche</label>
        <label class="case"><input type="checkbox" data-cible="decor-visible" data-champ="rose" data-type="booleen" ${d.rose && d.rose.visible !== false ? "checked" : ""}> Rose des vents</label>
        <label class="case"><input type="checkbox" data-cible="decor-visible" data-champ="echelle" data-type="booleen" ${d.echelle && d.echelle.visible !== false ? "checked" : ""}> Échelle</label>
      </div>
      <p class="aide">Cliquez sur le cartouche, la rose ou l'échelle pour les régler ou les déplacer.</p>
      <h3>Cartes détaillées</h3>
      ${this.parent ? `<p class="aide">Détail de <a href="#/carte/${e(this.parent.id)}">${e(this.parent.nom)}</a>.</p>` : ""}
      ${(this.enfants || []).length ? `<ul class="liste-lieux">${this.enfants.map((x) => `<li><a class="lien-carte" href="#/carte/${e(x.id)}">${e(x.nom)}</a></li>`).join("")}</ul>` : ""}
      <p class="aide">Encadrez une zone pour en tirer une carte plus précise, par exemple ${e(EXEMPLES_CARTES.detail)} pour une première séance.</p>
      <div class="actions"><button data-action="detailler">Détailler une région</button></div>
      <h3>Peuplement de la carte</h3>
      <p class="aide">Encadrez une zone : l'atelier regarde le terrain et propose des villages, ruines, grottes ou tours plausibles, avec leur fiche. Vous gardez ou écartez chacun.</p>
      <div class="actions"><button data-action="peupler">${(this.fantomes || []).length ? `Peupler une région (${this.fantomes.length} en attente)` : "Peupler une région"}</button></div>
      ${this.panneauCarteHab()}
      ${c.modele === "cratere" || c.modele === "pays-castelblanc" ? `
      <h3>Relief</h3>
      <p class="aide">Redessine montagnes, forêts, rivières et routes avec un autre tirage. Les lieux proposés se replacent ; vos lieux, noms et tracés restent. Annulable.</p>
      <div class="actions"><button data-action="relancer">Relancer le relief</button></div>` : ""}
      ${this.listeLieux()}
      <p class="aide"><a class="lien-versions" href="${lienVersions("cartes", c.id, `#/carte/${c.id}`)}">Versions précédentes de la carte</a></p>`;
  }

  panneauLieu(m) {
    const lieu = this.lieux[m.lieu] || {};
    return `
      ${lieu.id ? htmlRetour("lieu", lieu.id) : ""}
      <h2>${e(TYPES_LIEUX.find((t) => t.cle === lieu.type)?.nom || "Lieu")}</h2>
      <label class="champ">Nom<input type="text" value="${e(lieu.nom)}" data-cible="lieu" data-champ="nom"></label>
      <div class="deux">
        <label class="champ">Genre<select data-cible="lieu" data-champ="type" data-apres="icone">
          ${TYPES_LIEUX.map((t) => `<option value="${t.cle}" ${lieu.type === t.cle ? "selected" : ""}>${e(t.nom)}</option>`).join("")}
        </select></label>
        <label class="champ">Source<select data-cible="lieu" data-champ="etiquette">
          ${ETIQUETTES_ORIGINE.map(([v, n]) => `<option value="${v}" ${lieu.etiquette === v ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
      </div>
      <div class="cases">
        <label class="case"><input type="checkbox" data-cible="lieu" data-champ="connu" data-type="booleen" ${lieu.connu ? "checked" : ""}> Connu des joueurs</label>
        ${htmlCasePartage(lieu, 'data-cible="lieu" data-champ="partage" data-type="booleen"')}
        <label class="case"><input type="checkbox" data-cible="lieu" data-champ="a_valider" data-type="booleen" ${lieu.a_valider ? "checked" : ""}> Position à valider</label>
      </div>
      <div class="actions">
        <button class="principal" data-action="montrer-lieu">Montrer à la TV</button>
      </div>
      ${this.panneauPnj(lieu)}
      ${lieu.id ? placeMentions("lieux", lieu.id) : ""}
      <label class="champ">Ce que les joueurs en savent<textarea rows="4" data-cible="lieu" data-champ="resume">${e(lieu.resume)}</textarea></label>
      <label class="champ secret">Réservé au MJ<textarea rows="4" data-cible="lieu" data-champ="secrets">${e(lieu.secrets)}</textarea></label>
      <label class="champ">Notes<textarea rows="3" data-cible="lieu" data-champ="notes">${e(lieu.notes)}</textarea></label>
      ${lieu.id ? `<p class="aide"><a class="lien-versions" href="${lienVersions("lieux", lieu.id, `#/carte/${this.carte.id}?lieu=${lieu.id}`)}">Versions précédentes de la fiche</a></p>` : ""}
      <div class="ia-lieu">
        <label class="champ">Une idée de départ (facultatif)<input type="text" name="idee-lieu" placeholder="un moulin hanté par un ancien meunier"></label>
        <div class="actions"><button data-action="rediger-lieu" data-valeur="${e(m.lieu)}" data-estimation="lieu" title="Remplit les champs vides d'après la campagne, le canon et les lieux voisins">Écrire la fiche</button></div>
      </div>
      ${this.panneauLieuHab(lieu)}
      ${this.panneauPlans(lieu)}
      ${this.galerie.html(lieu)}
      <h3>Sur la carte</h3>
      <label class="champ">Taille de l'icône <output>${virgule((m.taille || 1.6))}</output>
        <input type="range" min="0.6" max="8" step="0.1" value="${m.taille || 1.6}" data-cible="marqueur" data-champ="taille" data-type="nombre" data-apres="voies"></label>
      <label class="case"><input type="checkbox" data-cible="marqueur" data-champ="sans_nom" data-type="booleen" ${m.sans_nom ? "checked" : ""}> Masquer le nom sur la carte</label>
      <p class="aide">Glissez l'icône pour déplacer le lieu, ou son nom pour le décaler.</p>
      <div class="actions">
        ${m.nx !== undefined ? `<button data-action="nom-defaut">Remettre le nom à côté</button>` : ""}
        <button class="danger" data-action="supprimer">Retirer de la carte</button>
      </div>`;
  }

  panneauPlans(lieu) {
    const ici = (this.plans || []).filter((p) => p.lieu === lieu.id);
    return `
      <h3>Plans intérieurs <span class="compte">${ici.length || ""}</span></h3>
      ${ici.length ? `<ul class="liste-lieux">${ici.map((p) => `<li><a class="lien-carte" href="#/plan/${e(p.id)}">${e(p.nom)}${p.etage && !p.nom.toLowerCase().includes(p.etage.toLowerCase()) ? ` <span class="secret">${e(p.etage)}</span>` : ""}</a></li>`).join("")}</ul>` : ""}
      <div class="actions"><a class="bouton" href="#/cartes?nouveau-plan=${e(lieu.id)}">Nouveau plan de ce lieu</a></div>`;
  }

  panneauPnj(lieu) {
    return htmlPnjIci(lieu, this.pnj);
  }

  panneauTrace(t) {
    const nomType = TYPES_TRACES.find((x) => x.cle === t.type)?.nom || "Tracé";
    return `
      <h2>${e(nomType)}</h2>
      <label class="champ">Nom (facultatif)<input type="text" value="${e(t.nom || "")}" data-cible="trace" data-champ="nom"></label>
      <label class="champ">Genre<select data-cible="trace" data-champ="type" data-apres="trace">
        ${TYPES_TRACES.map((x) => `<option value="${x.cle}" ${t.type === x.cle ? "selected" : ""}>${e(x.nom)}</option>`).join("")}
      </select></label>
      ${t.type === "riviere" && !t.points.some((p) => p.length > 2) ? `
      <div class="deux">
        <label class="champ">Largeur à la source<input type="number" min="0.05" max="3" step="0.05" value="${+(+(t.largeur || [0.16, 0.42])[0]).toFixed(2)}" data-cible="trace-largeur" data-champ="0" data-type="nombre" data-apres="trace"></label>
        <label class="champ">À l'embouchure<input type="number" min="0.05" max="4" step="0.05" value="${+(+(t.largeur || [0.16, 0.42])[1]).toFixed(2)}" data-cible="trace-largeur" data-champ="1" data-type="nombre" data-apres="trace"></label>
      </div>` : ""}
      <label class="case"><input type="checkbox" data-cible="trace" data-champ="cache" data-type="booleen" ${t.cache ? "checked" : ""}> Caché aux joueurs</label>
      <p class="aide">Glissez un point pour le déplacer. Double-clic sur le trait : ajoute un point. Double-clic sur un point : le retire.</p>
      <div class="actions"><button class="danger" data-action="supprimer">Supprimer</button></div>`;
  }

  panneauEtiquette(et) {
    return `
      <h2>Nom sur la carte</h2>
      <label class="champ">Texte<input type="text" value="${e(et.texte)}" data-cible="etiquette" data-champ="texte"></label>
      <p class="aide">Dans ce champ, les lettres s'écrivent dans le texte ; Échap rend la main aux touches d'outils.</p>
      <label class="champ">Style<select data-cible="etiquette" data-champ="style">
        ${STYLES_ETIQUETTES.map((x) => `<option value="${x.cle}" ${et.style === x.cle ? "selected" : ""}>${e(x.nom)}</option>`).join("")}
      </select></label>
      <label class="champ">Taille <output>${virgule((et.taille || 2))}</output>
        <input type="range" min="0.6" max="14" step="0.1" value="${et.taille || 2}" data-cible="etiquette" data-champ="taille" data-type="nombre"></label>
      <label class="champ">Courbure <output>${Math.round((et.courbure || 0) * 100)}</output>
        <input type="range" min="-1.2" max="1.2" step="0.02" value="${et.courbure || 0}" data-cible="etiquette" data-champ="courbure" data-type="nombre"></label>
      <label class="champ">Inclinaison <output>${Math.round(((et.angle || 0) * 180) / Math.PI)}°</output>
        <input type="range" min="-1.5708" max="1.5708" step="0.0175" value="${et.angle || 0}" data-cible="etiquette" data-champ="angle" data-type="nombre"></label>
      <label class="case"><input type="checkbox" data-cible="etiquette" data-champ="cache" data-type="booleen" ${et.cache ? "checked" : ""}> Caché aux joueurs</label>
      <div class="actions"><button class="danger" data-action="supprimer">Supprimer</button></div>`;
  }

  panneauDecor(cle) {
    const d = this.carte.decor[cle] || {};
    if (cle === "cartouche") {
      return `
        <h2>Cartouche</h2>
        <label class="champ">Titre<input type="text" value="${e(d.titre)}" data-cible="decor-cartouche" data-champ="titre"></label>
        <label class="champ">Sous-titre<input type="text" value="${e(d.sous_titre)}" data-cible="decor-cartouche" data-champ="sous_titre"></label>
        <label class="champ">Taille <output>${virgule((d.taille || 4))}</output>
          <input type="range" min="1" max="16" step="0.1" value="${d.taille || 4}" data-cible="decor-cartouche" data-champ="taille" data-type="nombre"></label>
        <div class="actions"><button data-action="masquer-decor" data-valeur="cartouche">Masquer le cartouche</button></div>`;
    }
    if (cle === "rose") {
      return `
        <h2>Rose des vents</h2>
        <label class="champ">Taille <output>${(d.taille || 8).toFixed(0)}</output>
          <input type="range" min="3" max="60" step="1" value="${d.taille || 8}" data-cible="decor-rose" data-champ="taille" data-type="nombre"></label>
        <div class="actions"><button data-action="masquer-decor" data-valeur="rose">Masquer la rose</button></div>`;
    }
    return `
      <h2>Échelle</h2>
      <p class="aide">Elle se règle d'après les kilomètres par case (panneau de la carte, sans rien sélectionner).</p>
      <div class="actions"><button data-action="masquer-decor" data-valeur="echelle">Masquer l'échelle</button></div>`;
  }

  panneauGroupe() {
    return `<h2>Le groupe</h2>${this.panneauGroupeCorps()}`;
  }

  panneauGroupeCorps() {
    const g = this.carte.groupe;
    return `
      <div class="cases">
        <label class="case"><input type="checkbox" data-cible="groupe" data-champ="visible" data-type="booleen" ${g.visible ? "checked" : ""}> Bannière sur la carte</label>
        <label class="case"><input type="checkbox" data-cible="groupe" data-champ="montrer" data-type="booleen" ${g.montrer !== false ? "checked" : ""}> Visible par les joueurs</label>
      </div>
      <p class="aide">${g.trajet?.length > 1 ? `Voyage : ${g.trajet.length - 1} étape${g.trajet.length > 2 ? "s" : ""}.` : "Pas encore de voyage enregistré."}</p>
      <div class="actions"><button data-action="effacer-trajet">Effacer le voyage</button></div>`;
  }

  objetCible(cible) {
    const s = this.selection;
    switch (cible) {
      case "lieu": return this.lieux[this.marqueur(s?.id)?.lieu];
      case "marqueur": return this.marqueur(s?.id);
      case "trace": return this.trace(s?.id);
      case "trace-largeur": {
        const t = this.trace(s?.id);
        if (t && !t.largeur) t.largeur = [0.16, 0.42];
        return t?.largeur;
      }
      case "etiquette": return this.etiquette(s?.id);
      case "hab": return this.elementHab();
      case "carte": return this.carte;
      case "decor": return (this.carte.decor ||= {});
      case "decor-cartouche": return this.carte.decor.cartouche;
      case "decor-rose": return this.carte.decor.rose;
      case "groupe": return this.carte.groupe;
      case "pinceau": return this.pinceau;
      case "brume": return this.brume;
      case "editeur": return this;
      default: return null;
    }
  }

  saisie(ev, change) {
    const el = ev.target;
    if (el.dataset.action === "ill-importer") {
      if (change) this.galerie.importer(el.files[0]);
      return;
    }
    if (el.dataset.local) {
      this.galerie.saisie(el);
      return;
    }
    const cible = el.dataset.cible;
    const champ = el.dataset.champ;
    if (!cible || !champ) return;
    // Le nom d'un lieu quitté : son identifiant le suit tant que rien d'autre ne le cite (lieux/panneau-lieu.js).
    if (change && cible === "lieu" && champ === "nom") suivreNomSurLaCarte(this, this.objetCible("lieu"));
    if ((el.type === "checkbox" || el.tagName === "SELECT") && !change) return;
    if (el.type !== "checkbox" && el.tagName !== "SELECT" && change && el.type !== "range") return;
    let valeur = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.type === "nombre") {
      valeur = parseFloat(valeur);
      if (!isFinite(valeur)) return;
    }
    const sortie = el.parentElement.querySelector("output");
    if (sortie) sortie.textContent = champ === "angle" ? `${Math.round((valeur * 180) / Math.PI)}°` : champ === "courbure" ? Math.round(valeur * 100) : champ === "rayon" ? valeur : valeur.toFixed ? virgule(valeur) : valeur;

    if (cible === "decor-visible") {
      this.instantane();
      const d = this.carte.decor;
      if (valeur && !d[champ]) {
        const { largeur: w, hauteur: h } = this.carte;
        d[champ] = { cartouche: { x: w * 0.16, y: 9, titre: this.carte.nom, sous_titre: "", taille: 3.2 }, rose: { x: w - 14, y: h - 15, taille: 10 }, echelle: { x: 6, y: h - 8 } }[champ];
      }
      if (d[champ]) d[champ].visible = valeur;
      this.vue.demander();
      this.modifie();
      return;
    }
    const obj = this.objetCible(cible);
    if (!obj) return;
    if (!["pinceau", "brume", "editeur"].includes(cible)) {
      if (cible === "lieu") this.instantaneGroupe(`lieu:${champ}`);
      else this.instantaneGroupe(`${cible}:${champ}:${this.selection?.id || ""}`);
    }
    obj[champ] = valeur;
    if (cible === "lieu") {
      this.lieuModifie(obj.id);
      if (champ === "type") this.afficherPanneau();
      this.vue.demander();
      return;
    }
    if (cible === "editeur") {
      this.afficherPanneau();
      return;
    }
    if (cible === "pinceau" || cible === "brume") {
      this.vue.demander();
      return;
    }
    if (cible === "carte" && champ === "nom") {
      Object.assign(this.racine.querySelector(".nom-carte"), { textContent: valeur, title: valeur });
      if (this.carte.decor?.cartouche && !this.carte.decor.cartouche.titre) this.carte.decor.cartouche.titre = valeur;
    }
    const apres = el.dataset.apres;
    if (apres === "symboles") {
      this.champs.seaux.clear();
      this.vue.rafraichirTout();
    } else if (apres === "voies" && cible === "marqueur") {
      if (change || el.type === "range") {
        this.champs.majVoies({ x0: obj.x - 6, y0: obj.y - 8, x1: obj.x + 6, y1: obj.y + 4 });
        this.vue.rafraichirZone({ x0: obj.x - 8, y0: obj.y - 10, x1: obj.x + 8, y1: obj.y + 8 });
      }
    } else if (apres === "trace" || cible === "trace-largeur" || (cible === "trace" && champ === "cache")) {
      const t = this.trace(this.selection.id);
      this.traceChangee(t);
      if (champ === "type") this.afficherPanneau();
      return;
    } else if (cible === "carte" && champ === "brouillard_actif") {
      this.champs.majBrouillard();
      this.vue.demander();
    } else {
      this.vue.demander();
    }
    this.modifie();
  }

  actionPanneau(ev) {
    const b = ev.target.closest("button[data-action]");
    if (!b) return;
    const a = b.dataset.action;
    const v = b.dataset.valeur;
    if (a.startsWith("ill-")) {
      this.galerie.action(a, v, b);
      return;
    }
    if (a === "biome") {
      this.pinceau.biome = +v;
      this.afficherPanneau();
    } else if (a === "type-lieu") {
      this.typeLieu = v;
      this.afficherPanneau();
    } else if (a === "type-trace") {
      if (this.traceEnCours) this.finirTrace();
      this.typeTrace = v;
      this.afficherPanneau();
    } else if (a === "style-etiquette") {
      this.styleEtiquette = v;
      this.afficherPanneau();
    } else if (a === "brume-mode") {
      this.brume.mode = v;
      this.afficherPanneau();
    } else if (a === "brume-tout") this.toutReveler(+v);
    else if (a === "supprimer") this.supprimerSelection();
    else if (a === "aller-lieu") this.allerAuLieu(v);
    else if (a === "poser-lieu") this.preparerPose(v);
    else if (a === "pose-annuler") {
      this.aPoser = null;
      this.afficherPanneau();
    }
    else if (a === "montrer-lieu") this.montrerLieu();
    else if (a === "retirer-lieu") this.retirerLieu();
    else if (a === "nom-defaut") {
      const m = this.marqueur(this.selection?.id);
      if (m) {
        this.instantane();
        delete m.nx;
        delete m.ny;
        this.vue.demander();
        this.afficherPanneau();
        this.modifie();
      }
    } else if (a === "masquer-decor") {
      this.instantane();
      this.carte.decor[v].visible = false;
      this.selectionner(null);
      this.modifie();
    } else if (a === "effacer-trajet") {
      this.instantane();
      this.carte.groupe.trajet = [];
      this.vue.demander();
      this.afficherPanneau();
      this.modifie();
    } else if (a === "relancer") this.relancerRelief();
    else if (a === "detailler") this.detaillerRegion();
    else if (a === "peupler") {
      this.cadreRegion = null;
      this.regionPour = "peupler";
      this.choisirOutil("region");
    } else if (a === "peupler-proposer") this.peuplerRegion();
    else if (a === "habiller") {
      if ((this.carte.km_case || 1) > KM_HABILLAGE) return;
      this.cadreRegion = null;
      this.regionPour = "habiller";
      this.choisirOutil("region");
    } else if (a === "habiller-proposer") this.habillerZone();
    else if (a === "hab-retirer-zone") this.retirerHabillage(this.cadreRegion);
    else if (a === "hab-retirer-tout") this.retirerHabillage(null);
    else if (a === "hab-retirer-ferme") this.retirerElementHab(this.selection, true);
    else if (a === "hab-choisir") {
      const [cat, id] = v.split(":");
      const el = listeHab(this.carte.habillage, cat).find((x) => x.id === id);
      const c = el && centreHab(cat, el);
      this.selectionner({ genre: "hab", cat, id });
      if (c) this.vue.animerVers({ x: c[0], y: c[1], hv: Math.min(this.carte.hauteur, 26) }, 600);
    } else if (a === "hab-lieu-montrer" || a === "hab-lieu-cacher") this.cacherHabLieu(v, a === "hab-lieu-cacher");
    else if (a === "hab-retirer-hameau") this.retirerElementHab(this.selection, false);
    else if (a === "garder-fantome") this.garderFantome(+v);
    else if (a === "garder-tous-fantomes") this.garderTousFantomes();
    else if (a === "ecarter-fantome") this.ecarterFantome(+v);
    else if (a === "rediger-lieu") this.redigerLieu(v, b);
    else if (a === "annuler-region") {
      this.cadreRegion = null;
      this.choisirOutil("main");
    } else if (a === "creer-region") {
      const nom = this.panneau.querySelector('input[name="nom-region"]').value.trim() || "Nouvelle région";
      const f = +this.panneau.querySelector('select[name="facteur-region"]').value;
      b.disabled = true;
      b.textContent = "Création…";
      this.creerRegion(nom, f);
    }
  }

  allerAuLieu(idMarqueur) {
    const m = this.marqueur(idMarqueur);
    if (!m) return;
    this.choisirOutil("main");
    const hv = Math.min(this.carte.hauteur, 40 * this.k());
    this.vue.animerVers({ x: m.x, y: m.y - 1, hv }, 700);
    this.selectionner({ genre: "marqueur", id: m.id });
  }

  // Nouveau tirage d'une carte de la campagne (monde ou région) : terrain, rivières et routes générées changent, le reste
  // est gardé.
  async relancerRelief() {
    if (!(await demander({ titre: "Redessiner tout le relief", texte: "Un nouveau tirage remplace le terrain, les rivières et les routes générées. Vos coups de pinceau seront perdus.", aide: "Ctrl+Z revient en arrière.", oui: "Redessiner" })) || this.detruit) return;
    this.instantane(true);
    const graine = Math.floor(Math.random() * 1e6);
    const nouveau = this.carte.modele === "pays-castelblanc"
      ? genererPaysCastelblanc({ graine, parent: this.carte.parent })
      : genererCratere({ graine, largeur: this.carte.largeur, hauteur: this.carte.hauteur });
    this.carte.graine = graine;
    this.carte.terrain.set(nouveau.terrain);
    const generes = (t) => /^(riv|route|riviere|fleuve|chemin)-/.test(t.id);
    this.carte.traces = [...nouveau.traces, ...this.carte.traces.filter((t) => !generes(t))];
    const places = Object.fromEntries(nouveau.marqueurs.map((m) => [m.repere, m]));
    for (const m of this.carte.marqueurs) {
      const lieu = this.lieux[m.lieu];
      if (m.repere && places[m.repere] && lieu?.a_valider) {
        m.x = places[m.repere].x;
        m.y = places[m.repere].y;
      }
    }
    this.vue.charger(this.carte, this.lieux);
    this.champs = this.vue.champs;
    this.modifie();
    toast("Nouveau relief dessiné.");
  }

  // ---- export ----

  async exporter(joueurs) {
    this.racine.querySelector(".menu-exporter .menu").hidden = true;
    toast("Préparation de l'image…");
    // Safari sur iPad refuse un canvas de plus de 16,7 millions de pixels : l'échelle en tient compte.
    const plafond = Math.floor(Math.sqrt(16e6 / (this.carte.largeur * this.carte.hauteur)));
    const echelle = Math.max(1, Math.min(14, plafond, Math.max(4, Math.floor(6000 / this.carte.largeur))));
    let blob;
    try {
      blob = await this.vue.exporter(echelle, joueurs);
      if (!blob) throw new Error("image vide");
    } catch (err) {
      return toast(`Export impossible : ${err.message}`, "erreur");
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.carte.id}${joueurs ? "-joueurs" : "-mj"}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---- table ----

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
    this.tableIci = t.vue === "carte" && t.carte === this.carte.id;
    if (this.tableIci) {
      this.derniereCamera = t.camera;
      this.dernierLieu = t.lieu;
    }
    this.lieuTv = this.tableIci ? t.lieu || null : null;
    this.peindreBoutonLieu();
    this.porteeRelue();
  }

  // Le bouton du lieu ouvert : « Montrer à la TV », ou liseré or et « À la TV » tant que son carton est sur la carte.
  peindreBoutonLieu() {
    const b = this.panneau?.querySelector('[data-action="montrer-lieu"], [data-action="retirer-lieu"]');
    const m = b && this.marqueur(this.selection?.id);
    if (!m) return;
    const ici = Boolean(this.lieuTv) && this.lieuTv === m.lieu;
    peindreBoutonListe(b, ici);
    b.classList.toggle("principal", !ici);
    b.dataset.action = ici ? "retirer-lieu" : "montrer-lieu";
  }

  // Le carton du lieu retiré : la carte reste, avec son cadrage.
  async retirerLieu() {
    try {
      const actuel = await api.get("/api/table");
      delete actuel.ecrans;
      if (actuel.vue === "carte" && actuel.carte === this.carte.id && actuel.lieu) {
        const r = await api.put("/api/table", { ...actuel, lieu: null });
        this.majEcrans(r.ecrans);
        this.dernierLieu = null;
      }
      const m = this.marqueur(this.selection?.id);
      toast(`Retiré de la TV : le lieu «\u00a0${(m && this.lieux[m.lieu]?.nom) || "le lieu"}\u00a0».`);
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  majEcrans(n) {
    // Ce que l'outil Pointeur en dit (null : la table n'a pas répondu).
    this.ecransTable = Number.isFinite(n) ? n : null;
    const el = this.racine.querySelector(".ecrans");
    if (!el) return;
    el.textContent = n === null ? "" : n ? `${n} écran${n > 1 ? "s" : ""}` : "Aucun écran";
    el.dataset.actif = n ? "oui" : "non";
  }

  // opts.auto : renvoi automatique (après un enregistrement, ou le mode « Suivre ») ; il ne se fait que si la TV
  // montre encore cette carte : un autre écran a pu y mettre la planche ou le « Précédemment » entre-temps.
  async envoyerTable(opts = {}) {
    try {
      const actuel = await api.get("/api/table").catch(() => ({}));
      if (opts.auto && !(actuel.vue === "carte" && actuel.carte === this.carte.id)) {
        this.tableIci = false;
        this.porteeRelue();
        if (this.suivre) {
          this.suivre = false;
          const bascule = this.racine.querySelector('[data-action="table-suivre"]');
          if (bascule) bascule.checked = false;
          toast("La TV montre autre chose : « Suivre » est coupé.");
        }
        return;
      }
      const camera = opts.camera || this.vue.cameraPartagee();
      const lieu = opts.lieu !== undefined ? opts.lieu : opts.auto && !opts.suivi ? actuel.lieu ?? null : null;
      // Les cartons posés par d'autres pages (PNJ, rumeur, aventurier) restent à l'écran.
      const cartons = Object.fromEntries(["pnj", "rumeur", "aventurier", "aventurier_maj"].filter((k) => actuel[k]).map((k) => [k, actuel[k]]));
      const etat = { ...cartons, vue: "carte", carte: this.carte.id, camera, style: this.vue.style, version: this.carte.modifie, lieu };
      const r = await api.put("/api/table", etat);
      this.majEcrans(r.ecrans);
      this.tableIci = true;
      this.porteeRelue();
      this.derniereCamera = camera;
      this.dernierLieu = etat.lieu;
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  async montrerLieu() {
    const m = this.marqueur(this.selection?.id);
    if (!m) return;
    const lieu = this.lieux[m.lieu];
    if (lieu && !lieu.connu) {
      if (!(await demander({ titre: `Montrer « ${lieu.nom} »`, texte: `« ${lieu.nom} » est encore inconnu des joueurs. Le montrer le rend connu, sur la TV et dans le carnet des joueurs.`, oui: "Le rendre connu et montrer", non: "Ne pas montrer", danger: true }))) return;
      lieu.connu = true;
      this.lieuModifie(lieu.id);
      await this.sauverLieux.maintenant();
      this.afficherPanneau();
    }
    if (this.etatSauvegarde === "modifie") await this.sauverCarte.maintenant();
    const hv = Math.min(this.carte.hauteur, 34 * this.k());
    // Le carton occupe le bas à gauche de la TV : le lieu est cadré en haut à droite.
    await this.envoyerTable({ camera: { x: m.x - 0.28 * hv, y: m.y - 1 + 0.16 * hv, hv }, lieu: m.lieu });
    toast(this.ecransTable === 0 ? "Envoyé, mais aucun écran de table n'est branché." : `À la TV : le lieu «\u00a0${lieu?.nom || "le lieu"}\u00a0».`);
  }

  // Le fond peint de la TV : peint ici (la TV est lente) d'après la carte publique, puis confié au serveur, quand
  // tout est enregistré et que le pinceau s'est posé un moment. Sans lui, la TV peint elle-même.
  planifierFondTable(delai = 6000) {
    clearTimeout(this.minuterieFond);
    if ((this.carte.style || "couleur") !== "peint" || this.detruit) return;
    this.minuterieFond = setTimeout(() => this.envoyerFondTable(), delai);
  }

  async envoyerFondTable() {
    if (this.detruit || this.suspendu || this.vue.style !== "peint") return;
    if (this.etatSauvegarde !== "ok" || this.lieuxModifies.size || this.sauverLieux.enAttente() || this.glisse || this.envoiFond) {
      this.planifierFondTable();
      return;
    }
    this.envoiFond = true;
    try {
      const id = encodeURIComponent(this.carte.id);
      const publique = await api.get(`/api/cartes/${id}/publique`);
      const f = publique.fond_peint;
      const ajouts = f && f.nouveaux ? [f.nouveaux.traces, f.nouveaux.marqueurs, ...Object.values(f.nouveaux.habillage || {})] : [];
      // Le serveur a déjà ce fond-là, à l'identique : rien à refaire.
      if (f && f.echelle === this.vue.echelleBase() && ajouts.every((l) => !l || !l.length)) return;
      const image = await this.vue.fondPourTable(publique);
      if (!image || this.detruit) return;
      const r = await fetch(`/api/cartes/${id}/fond?version=${encodeURIComponent(publique.modifie)}&echelle=${this.vue.echelleBase()}`, {
        method: "PUT", headers: { "Content-Type": "image/png" }, body: image,
      });
      // La carte a changé pendant le calcul : le prochain enregistrement relancera l'envoi.
      if (r.status === 409) this.planifierFondTable();
    } catch {
      // la TV peindra elle-même
    } finally {
      this.envoiFond = false;
    }
  }

  async tableAccueil() {
    try {
      const r = await api.put("/api/table", { vue: "accueil" });
      this.majEcrans(r.ecrans);
      this.tableIci = false;
      this.porteeRelue();
      if (this.suivre) {
        this.suivre = false;
        this.racine.querySelector('[data-action="table-suivre"]').checked = false;
      }
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }
}

// Les fiches des lieux que les générateurs posent (generateur.js, definitionsLieux), repérées par leur clé : réutilisées
// si elles existent déjà.
export async function assurerLieux(cles, { maj = false } = {}) {
  const defs = definitionsLieux();
  const existants = await api.get("/api/lieux");
  const parRepere = Object.fromEntries(existants.filter((l) => l.repere).map((l) => [l.repere, l]));
  const ids = {};
  for (const cle of cles) {
    const def = defs[cle];
    if (!def) continue;
    let lieu = parRepere[cle];
    if (!lieu) lieu = await api.post("/api/lieux", { ...def, repere: cle });
    else if (maj) lieu = await api.patch(`/api/lieux/${lieu.id}`, { ...def, repere: cle });
    ids[cle] = lieu.id;
  }
  return ids;
}

async function enregistrerNouvelleCarte(carte, nom) {
  carte.nom = nom;
  carte.style = "peint";
  carte.brouillard_actif = false;
  const ids = await assurerLieux(carte.marqueurs.map((m) => m.repere));
  for (const m of carte.marqueurs) m.lieu = ids[m.repere];
  const r = await api.post("/api/cartes", encoderCarte({ ...carte, brouillard: new Uint8Array(carte.largeur * carte.hauteur) }));
  for (const m of carte.marqueurs) {
    const lieu = await api.get(`/api/lieux/${m.lieu}`);
    if (!lieu.carte) await api.patch(`/api/lieux/${m.lieu}`, { carte: r.id });
  }
  return r.id;
}

export function creerCarteCratere(nom, graine) {
  return enregistrerNouvelleCarte(genererCratere({ graine }), nom);
}

// La carte de la région de la campagne, rattachée à la carte du monde si elle existe.
export async function creerPaysCastelblanc(nom, graine) {
  const cartes = await api.get("/api/cartes");
  let parent = null;
  for (const c of cartes) {
    const complete = await api.get(`/api/cartes/${c.id}`);
    if (complete.modele === "cratere" && complete.region_castelblanc) {
      parent = { carte: c.id, ...complete.region_castelblanc };
      break;
    }
  }
  return enregistrerNouvelleCarte(genererPaysCastelblanc({ graine, parent }), nom);
}
