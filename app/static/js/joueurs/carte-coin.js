// La carte du monde, dans la table du coin des joueurs : quand la TV montre une carte et non un plan, la page la
// montre aussi, telle que la TV la reçoit (l'atelier la publie pour le coin, table_joueurs.py), et chacun y navigue à sa
// guise, sans la caméra du MJ : un doigt déplace la vue, deux doigts (ou la molette) zooment, deux touchers rapides
// recadrent sur le groupe s'il est montré, sinon sur toute la carte. Le groupe n'y paraît que si le MJ le montre à la TV ;
// c'est toujours lui qui le déplace.
//
// Une carte peinte arrive avec son fond, peint par l'atelier : la page le pose tel quel et zoome dessus, sans jamais
// recalculer le relief (un téléphone y passerait des secondes à chaque zoom). Ce qui se dessine par-dessus (noms, lieux,
// groupe, cartouche) reste net à tous les zooms. Sans fond à jour (la carte retouchée, pas encore repeinte par l'atelier),
// le téléphone la peint lui-même, comme la TV, mais d'abord en plus grossier : des tuiles plus fines s'y ajoutent au zoom,
// pour ce qui est à l'écran seulement. L'atelier republie dès que le fond est repeint, et la page le prend.

import { decoderCarte } from "../carte/format.js";
import { VueCarte, chargerImage, memeFond } from "../carte/vue.js";

// Pas plus de pixels qu'un écran 1080p, des tuiles pour deux écrans et demi (comme la TV) : un téléphone garde sa mémoire.
const REGLAGES = { pixelsMax: 2.1e6, ecransTuiles: 2.5 };
// Le relief peint, s'il faut le calculer : deux workers, plus grossier qu'à l'atelier, sans garder ses calques (la TV).
const PEINT = { travailleurs: 2, garderRaster: false, rasterMax: 16 };
// La plus petite taille d'un nom, en pixels d'écran : la proportion de la TV (24 pixels sur un écran 1080p, tailleLisible
// de carte/vue.js), pour que la vue d'ensemble se compose comme à la TV, sans descendre sous NOM_MIN sur un téléphone.
const NOM_MIN = 6;
// Ce que montre « Recentrer sur le groupe » : le groupe et ses abords, jamais plus loin que la vue du moment.
const HAUTEUR_GROUPE = [16, 60];
const DELAI_FOND = 15000; // millisecondes : un fond qui n'arrive pas, la carte se peint sans lui
// Sans fond fourni, le fond de base peint par le téléphone : un million de pixels au plus (une carte de 360 × 250 cases
// passe de 8 à 3 pixels par case, sept fois moins à calculer).
const PIXELS_SEUL = 1e6;

export class VueCarteCoin extends VueCarte {
  constructor(canvas, options = {}) {
    super(canvas, { ...REGLAGES, ...options, joueurs: true, donneesPubliques: true, peint: PEINT });
    // Vrai quand le fond peint vient de l'atelier : la vue zoome sur lui, sans tuiles plus fines.
    this.surLeFond = false;
  }

  // Les noms ne descendent pas sous cette taille (en cases, au zoom du moment).
  tailleLisible() {
    if (!this.cam.z) return 0;
    return Math.max(NOM_MIN, (24 * Math.min(this.lh, (this.lw * 9) / 16)) / 1080) / this.cam.z;
  }

  // Sur le fond de l'atelier, un seul niveau : le fond agrandi. Le relief ne se recalcule pas au zoom.
  niveau() {
    return this.surLeFond ? 0 : super.niveau();
  }

  // Le fond de l'atelier a la taille de la TV ; celui que peint le téléphone est plus grossier (PIXELS_SEUL).
  echelleBase() {
    const B = super.echelleBase();
    if (this.surLeFond) return B;
    const { w, h } = this.champs;
    return Math.max(2, Math.min(B, Math.floor(Math.sqrt(PIXELS_SEUL / (w * h)))));
  }

  // Le groupe, s'il est montré aux joueurs (la carte publiée ne l'a que dans ce cas).
  groupe() {
    const g = this.carte && this.carte.groupe;
    return g && g.visible && g.montrer !== false && Number.isFinite(g.x) && Number.isFinite(g.y) ? g : null;
  }

  cameraGroupe() {
    const g = this.groupe();
    if (!g || !this.champs || !this.cam.z) return null;
    const voulue = Math.max(HAUTEUR_GROUPE[0], Math.min(HAUTEUR_GROUPE[1], this.champs.h / 3));
    return { x: g.x, y: g.y, hv: Math.min(this.lh / this.cam.z, voulue) };
  }
}

// Deux images d'écran : ce qui vient de changer dans la page (le mot d'attente) est peint.
const deuxImages = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));

// La carte sur la page de la table : son cadre (.toile-carte), sa vue, ses gestes et ses boutons.
export class CarteCoin {
  // scene : la scène de la table ; texture() : le parchemin chargé par la page (ou null) ; brancher(el, vue, gestes) :
  // les gestes de la table (table-coin.js) ; boutonGroupe : le bouton « Recentrer », qui vise ici le groupe.
  constructor({ scene, texture, brancher, boutonGroupe }) {
    this.scene = scene;
    this.cadre = scene.querySelector(".toile-carte");
    this.toile = this.cadre.querySelector(".carte-coin");
    this.texture = texture;
    this.brancher = brancher;
    this.bouton = boutonGroupe;
    this.etiquette = boutonGroupe ? [boutonGroupe.getAttribute("aria-label"), boutonGroupe.title] : null;
    this.vue = null;
    this.affiche = null; // { signature, fond } de la carte à l'écran
    this.numero = 0;
    // Tant que le joueur n'a pas touché à la vue, elle montre toute la carte, même tournée ou redimensionnée.
    this.auto = true;
    window.addEventListener("resize", () => {
      if (this.auto && this.visible && this.vue) setTimeout(() => this.vue.cadrer(), 60);
    });
  }

  get visible() {
    return !this.cadre.hidden;
  }

  creer() {
    this.vue = new VueCarteCoin(this.toile, { texture: this.texture(), fond: "#140f0b" });
    this.brancher(this.cadre, this.vue, {
      surBouge: () => {
        this.auto = false;
      },
      surDouble: () => this.recentrer(),
    });
  }

  // v : la vue publiée ({ genre: "carte", style, carte }). Même carte et même fond : seul ce qui a changé se reprend
  // (le groupe déplacé, un lieu révélé), la vue reste où le joueur l'a mise.
  async montrer(v) {
    const n = ++this.numero;
    const json = v.carte;
    this.cadre.hidden = false;
    if (!this.vue) this.creer();
    this.vue.reveiller();
    const style = v.style || json.style || "couleur";
    const fond = style === "peint" && json.fond_peint && typeof json.fond_peint.url === "string" ? json.fond_peint : null;
    const signature = JSON.stringify([json.modifie, style, fond && fond.url]);
    if (!this.affiche || this.affiche.signature !== signature) {
      const { fond_peint: _, ...reste } = json;
      const carte = decoderCarte(reste);
      const lieux = reste.lieux || {};
      for (const l of Object.values(lieux)) l.connu = true;
      const nouvelle = !memeFond(this.vue.carte, carte);
      const memeImage = !!this.affiche && this.affiche.fond === (fond && fond.url) && this.vue.surLeFond === !!fond;
      if (nouvelle || !memeImage || !this.vue.actualiser(carte, lieux, style)) {
        // Le fond à télécharger, puis le relief à préparer (quelques secondes pour une grande carte sans fond peint) :
        // le mot d'attente paraît avant que le calcul ne prenne la main.
        this.attendre(true);
        const image = fond ? await this.image(fond.url) : null;
        await deuxImages();
        if (n !== this.numero) return;
        this.vue.style = style;
        this.vue.surLeFond = !!image;
        this.vue.charger(carte, lieux, { fond: image ? { image, nouveaux: fond.nouveaux } : null });
        if (nouvelle) this.auto = true;
        if (nouvelle || this.auto) this.vue.cadrer();
        this.attendre(false);
      }
      this.affiche = { signature, fond: fond && fond.url };
    }
    this.majBouton();
    this.vue.demander();
  }

  attendre(oui) {
    let mot = this.cadre.querySelector(".attente-carte");
    if (oui && !mot) {
      mot = document.createElement("p");
      mot.className = "attente-carte";
      mot.setAttribute("role", "status");
      mot.textContent = "La carte se dessine…";
      this.cadre.append(mot);
    }
    if (mot) mot.hidden = !oui;
  }

  async image(url) {
    let minuterie = 0;
    try {
      return await Promise.race([
        chargerImage(url),
        new Promise((_, ko) => {
          minuterie = setTimeout(() => ko(new Error("délai")), DELAI_FOND);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(minuterie);
    }
  }

  // La carte quittée (un plan, l'accueil) : elle rend sa mémoire et ne se dessine plus ; le bouton reprend son nom.
  cacher() {
    if (this.etiquette && this.visible) {
      this.bouton.setAttribute("aria-label", this.etiquette[0]);
      this.bouton.title = this.etiquette[1];
    }
    this.numero++;
    this.attendre(false);
    this.cadre.hidden = true;
    if (this.vue) this.vue.alleger();
  }

  majBouton() {
    if (!this.bouton) return;
    this.bouton.hidden = !this.vue.groupe();
    this.bouton.setAttribute("aria-label", "Recentrer sur le groupe");
    this.bouton.title = "Recentrer sur le groupe";
  }

  // Deux touchers rapides, ou le bouton : le groupe s'il est montré, sinon toute la carte.
  recentrer() {
    if (!this.vue) return;
    const cam = this.vue.cameraGroupe();
    if (!cam) return this.toutVoir();
    this.auto = false;
    this.vue.animerVers(cam, 700);
  }

  toutVoir() {
    this.auto = true;
    this.vue.animerVers({}, 700);
  }

  // Les boutons de la table (data-geste) : zoomer, dézoomer, tout voir, recentrer.
  geste(g) {
    if (!this.vue || !this.vue.champs) return;
    if (g === "plus" || g === "moins") {
      this.auto = false;
      const cam = this.vue.cameraPartagee();
      this.vue.animerVers({ ...cam, hv: cam.hv * (g === "plus" ? 1 / 1.6 : 1.6) }, 300);
    } else if (g === "tout") this.toutVoir();
    else if (g === "heros") this.recentrer();
  }
}
