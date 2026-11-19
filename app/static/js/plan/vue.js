// Affichage d'un plan : la mécanique des cartes (caméra, fond mis en cache, tuiles plus fines au zoom) avec le rendu
// des plans. Sur la TV, un plan qui change se fond dans le nouveau, et les pions glissent vers leur nouvelle case. La
// brume et le feu, quand le plan en a, vivent chacun sur leur propre calque (brume.js, feu.js).

import { VueCarte, chargerImage } from "../carte/vue.js";
import { BRUME_ATELIER, BRUME_TV, CalqueBrume } from "./brume.js";
import { CalqueFeu, FEU_ATELIER, FEU_TV } from "./feu.js";
import { boitePiece, boiteRevelee, calculerMurs, lumieresDuFeu } from "./modele.js";
import { preparerPeint, signaturePeint, zoneChangee } from "./peint.js";
import { dessinerPions, dessinerPlan, dessinerVoileMJ, placerNoms, placerNomsMJ, prenomsEcrits } from "./rendu.js";
// Lot H2 : les images du MJ posées sur le plan, les cavaliers sur leur monture, l'image choisie d'un pion.
import { chargerImagesPlan, dessinerImagesPlan, imagesDessus } from "./images.js";
import { imageDuPion, poserCavaliers } from "./pions.js";

const facile = (t) => 1 - (1 - t) ** 3;

// Les animations des figurines (19/11), en millisecondes : l'éclair d'un coup ou d'un soin, la secousse d'un coup, la
// chute, la poussière quand une figurine se pose. Rien ne bouge pour qui demande moins de mouvement, ni dans une image
// exportée.
const DUREES = { flash: 450, secousse: 380, chute: 520, poussiere: 600, glisse: 650 };
const COUP = [220, 40, 30];
const SOIN = [70, 190, 90];
const moinsDeMouvement = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Ce qui oblige à repeindre le fond : tout sauf les pions, la brume et le feu (leurs calques se refont seuls, voir
// majBrume et majFeu), hormis la lumière que le feu jette sur le plan peint.
export function signatureStructure(p) {
  return JSON.stringify([p.largeur, p.hauteur, p.sol, p.piece, p.murs, p.brouillard, p.brouillard_actif, p.portes, p.objets, p.textes, p.fond, p.pieces, p.quadrillage, p.habillage || null, lumieresDuFeu(p, true), p.lumiere || null]);
}

function reunir(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export class VuePlan extends VueCarte {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this.zoomMax = 320;
    this.niveauMax = 5;
    this.mj = !!options.mj;
    this.images = new Map();
    // Les images posées sur le plan (images.js), chargées une fois par adresse.
    this.imagesPlan = new Map();
    // Le pion choisi dans l'éditeur (son identifiant), ou plusieurs (une liste) : cerclés d'or. Rien sur la TV ni au coin.
    this.selection = null;
    // Le pion sous la souris, dans l'éditeur : il garde son prénom même serré contre d'autres (placerNomsMJ).
    this.survol = null;
    this.glisses = new Map();
    this.ancienne = null;
    // Style peint : murs, ombres et lumière précalculés, pour la vue du MJ (m) et celle des joueurs (j).
    this.etatsPeints = new Map();
    // Sur la TV (options.tv) : prénoms et numéros lisibles depuis le canapé. surLegende reçoit les héros à nommer en bas
    // de l'écran quand l'un d'eux n'a plus la place d'écrire son prénom sous le pion (une liste vide : plus de légende).
    this.tv = !!options.tv;
    this.surLegende = options.surLegende || null;
    this.legende = null;
    // La brume : options.brume rend le canvas de son calque, posé juste sur celui du plan ; le calque ne se crée qu'au
    // premier plan qui a de la brume. pionsDessines : les pions de la dernière image, là où ils sont dessinés (un pion
    // qui glisse), pour que la brume s'éclaircisse sous eux.
    this.creerBrume = options.brume || null;
    // Le feu, de même : options.feu rend le canvas de son calque, créé au premier plan qui a du feu.
    this.creerFeu = options.feu || null;
    this.reglagesFeu = options.reglagesFeu || null;
    this.feu = null;
    // Les jauges des pions calculées par l'atelier (Map id → jauges, ou la fonction qui la rend : plan/jauges.js) ; sur
    // la TV, elles viennent avec les pions et ce champ reste vide.
    this.jauges = null;
    this.brume = null;
    this.pionsDessines = null;
    this.barresDessinees = null;
    // Ce que la vue a déjà vu de chaque pion (sa Santé, à terre ou non) et ce qui l'anime depuis : id → { flash, chute,
    // pose }. Un plan qui s'ouvre n'anime rien : seul un changement vu ensuite le fait.
    this.vus = new Map();
    this.anims = new Map();
    // Qui a la main au combat : une fonction (pions) → identifiants des pions qui luisent ; null hors combat. La TV et le
    // coin la posent d'après le bandeau du combat, l'atelier d'après le combat en cours.
    this.main = null;
    this.minuterieMain = 0;
  }

  redimensionner() {
    super.redimensionner();
    // Appelé aussi par le constructeur de la carte, avant que les calques de brume et de feu existent.
    if (this.brume) this.brume.redimensionner();
    if (this.feu) this.feu.redimensionner();
  }

  charger(plan) {
    const meme = !!this.plan && this.plan.id === plan.id;
    this.oublierEtatsPeints();
    if (!meme) {
      this.vus.clear();
      this.anims.clear();
    }
    this.carte = plan;
    this.plan = plan;
    this.champs = { w: plan.largeur, h: plan.hauteur };
    this.pionsDessines = null;
    this.preparer();
    this.construireBase();
    if (this.calqueBrume(plan)) this.brume.charger(plan, meme);
    if (this.calqueFeu(plan)) this.feu.charger(plan, meme);
  }

  // La brume seule a changé (TV : le plan réenregistré, même structure ; éditeur : un coup de pinceau) : son calque se
  // refait, le plan ne se repeint pas. brume : la nouvelle (TV), sinon celle du plan, changée sur place ; teinte : brume
  // ou fumée (TV).
  majBrume(brume, teinte) {
    if (brume !== undefined) this.plan.brume = brume;
    if (teinte !== undefined) this.plan.brume_teinte = teinte;
    if (this.calqueBrume(this.plan)) this.brume.charger(this.plan, true);
  }

  // Le feu seul a changé (TV : même lumière sur le plan ; éditeur : un coup de pinceau) : son calque se refait, le plan
  // ne se repeint pas. feu : le nouveau (TV), sinon celui du plan, changé sur place.
  majFeu(feu) {
    if (feu !== undefined) this.plan.feu = feu;
    if (this.calqueFeu(this.plan)) this.feu.charger(this.plan, true);
  }

  // Le calque du feu, créé au premier plan qui en a ; null tant qu'aucun n'en a eu.
  calqueFeu(plan) {
    if (!this.feu && this.creerFeu && Array.isArray(plan.feu) && plan.feu.some((v) => v)) {
      this.feu = new CalqueFeu(this.creerFeu(), this, Object.assign({}, this.tv ? FEU_TV : FEU_ATELIER, this.reglagesFeu || {}));
    }
    return this.feu;
  }

  // Le calque de brume, créé au premier plan qui en a ; null tant qu'aucun n'en a eu.
  calqueBrume(plan) {
    if (!this.brume && this.creerBrume && Array.isArray(plan.brume) && plan.brume.some((v) => v)) {
      this.brume = new CalqueBrume(this.creerBrume(), this, this.tv ? BRUME_TV : BRUME_ATELIER);
    }
    return this.brume;
  }

  preparer() {
    const p = this.plan;
    this.murs = p.murs ? Uint8Array.from(p.murs) : calculerMurs(p);
    this.centres = new Map();
    for (const pc of p.pieces || []) {
      const b = boitePiece(p, pc.id);
      if (b) this.centres.set(pc.id, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    }
    const url = p.fond?.url || null;
    if (url !== this.urlFond) {
      this.urlFond = url;
      this.imageFond = null;
      if (url) {
        chargerImage(url).then((img) => {
          if (this.urlFond !== url) return;
          this.imageFond = img;
          this.rafraichirTout();
        }).catch(() => {});
      }
    }
    this.chargerImagesPions();
    // Une image sous les pions est peinte avec le fond : il se repeint quand elle arrive.
    chargerImagesPlan(p, this.imagesPlan, (dessus) => (dessus ? this.demander() : !this.detruite && this.plan === p && this.rafraichirTout()));
  }

  chargerImagesPions() {
    for (const t of this.plan.pions || []) {
      const src = imageDuPion(t);
      if (!src || this.images.has(src)) continue;
      const img = new Image();
      img.onload = () => this.demander();
      img.src = src;
      this.images.set(src, img);
    }
  }

  oublierEtatsPeints() {
    for (const { etat } of this.etatsPeints.values()) for (const c of [etat.ombre, etat.lumiere, etat.lueur]) if (c) c.width = 0;
    this.etatsPeints.clear();
  }

  // L'état peint d'une vue (MJ ou joueurs), recalculé si le plan a changé depuis. Renvoie la zone dont le rendu change :
  // false pour rien, null pour tout le plan.
  majEtatPeint(joueurs) {
    const cle = joueurs ? "j" : "m";
    const e = this.etatsPeints.get(cle);
    if (e && !e.verifier) return false;
    const sig = signaturePeint(this.plan, joueurs);
    if (e && e.etat.sig === sig) {
      e.verifier = false;
      return false;
    }
    const etat = preparerPeint(this.plan, this.murs, { joueurs, sig });
    const zone = e ? zoneChangee(e.etat, etat) : null;
    if (e) for (const c of [e.etat.ombre, e.etat.lumiere, e.etat.lueur]) if (c) c.width = 0;
    this.etatsPeints.set(cle, { etat, verifier: false });
    return zone;
  }

  // Une retouche peut changer l'éclairage d'une pièce entière ou l'ombre d'un meuble déplacé : en style peint, la zone
  // repeinte s'étend à tout ce qui change vraiment.
  rafraichirZone(z, options = {}) {
    if (this.style === "peint" && this.plan) {
      for (const e of this.etatsPeints.values()) e.verifier = true;
      const plus = this.majEtatPeint(this.joueurs);
      if (plus === null) z = { x0: 0, y0: 0, x1: this.champs.w, y1: this.champs.h };
      else if (plus) z = reunir(z, plus);
    }
    super.rafraichirZone(z, options);
    // Vue des joueurs : la brume et le feu ne couvrent que les cases révélées, une pièce révélée ou cachée peut les
    // changer.
    if (this.brume && this.joueurs && !this.detruite) this.brume.verifier();
    if (this.feu && this.joueurs && !this.detruite) this.feu.verifier();
  }

  // Après une retouche dans l'éditeur : murs et noms recalculés, zone repeinte.
  majStructure(zone) {
    const url = this.urlFond;
    this.preparer();
    if (zone && url === this.urlFond) this.rafraichirZone(zone);
    else this.rafraichirTout();
  }

  // Les pions seuls ont changé : ils glissent de leur ancienne place à la nouvelle.
  majPions(pions) {
    const avant = new Map((this.plan.pions || []).map((t) => [t.id, t]));
    const t0 = performance.now();
    for (const t of pions) {
      const a = avant.get(t.id);
      if (a && (a.x !== t.x || a.y !== t.y)) this.glisses.set(t.id, { x0: a.x, y0: a.y, t0 });
    }
    this.plan.pions = pions;
    this.chargerImagesPions();
    this.demander();
  }

  echelleBase() {
    const { w, h } = this.champs;
    return Math.max(4, Math.min(24, Math.floor(4096 / w), Math.floor(4096 / h)));
  }

  peindreFond(ctx, zone, o = {}) {
    const joueurs = o.joueurs ?? this.joueurs;
    const peint = this.style === "peint";
    if (peint) this.majEtatPeint(joueurs);
    dessinerPlan(ctx, this.plan, this.murs, zone, {
      style: this.style, joueurs, image: this.imageFond, texture: this.texture, mj: this.mj, centres: this.centres, imagesPlan: this.imagesPlan,
      quadrillage: this.mj && !joueurs ? true : undefined,
      // Peint : l'état tenu à jour ; les textures les plus fines, hors de la TV (qui ne zoome pas si fort).
      etat: peint ? this.etatsPeints.get(joueurs ? "j" : "m").etat : undefined, hautes: !this.pixelsMax,
    });
  }

  peindreDessus(ctx, zone, o = {}) {
    const joueurs = o.joueurs ?? this.joueurs;
    if (this.mj && !joueurs) dessinerVoileMJ(ctx, this.plan, zone);
    let pions = this.plan.pions || [];
    if (this.glisses.size) {
      const t = performance.now();
      pions = pions.map((p) => {
        const g = this.glisses.get(p.id);
        if (!g) return p;
        const k = Math.min(1, (t - g.t0) / DUREES.glisse);
        if (k >= 1) {
          this.glisses.delete(p.id);
          // Elle se pose : un peu de poussière.
          if (!this.sansJauges && !moinsDeMouvement()) this.animer(p.id).pose = t;
          return p;
        }
        const e = facile(k);
        // La figurine se soulève, glisse et se repose.
        return { ...p, x: g.x0 + (p.x - g.x0) * e, y: g.y0 + (p.y - g.y0) * e, leve: moinsDeMouvement() ? 0 : Math.sin(Math.PI * k) };
      });
      this.demander();
    }
    let lisible;
    let noms;
    let decales;
    if (this.tv && joueurs) {
      // Les tailles d'un écran 1080p (24 px pour un prénom, 17 pour un nom serré contre d'autres, 20 pour un numéro, 5
      // pour l'anneau), ramenées en cases (hauteurLisible).
      const px = this.hauteurLisible() / 1080 / this.cam.z;
      lisible = { nom: 24 * px, nomMin: 17 * px, numero: 20 * px, anneau: 5 * px, barre: 9 * px, carton: 26 * px, jeton: 26 * px };
      // Les prénoms se placent d'après les cases d'arrivée : un pion qui glisse ne fait pas clignoter la légende.
      const arrivees = poserCavaliers(this.plan.pions || []);
      const places = placerNoms(ctx, arrivees === this.plan.pions ? this.plan : { ...this.plan, pions: arrivees }, zone, lisible);
      noms = places.ecrits;
      decales = places.decales;
      this.annoncerLegende(places.legende);
    }
    // Les cavaliers se posent sur leur monture ; sans cavalier, la même liste.
    pions = poserCavaliers(pions);
    this.pionsDessines = pions;
    // Sur la TV, les prénoms écrits et leur place : le feu et la brume s'y ouvrent (feu.js, brume.js).
    this.prenomsTv = noms ? prenomsEcrits(ctx, this.plan, pions, noms, lisible, decales) : null;
    const jauges = this.sansJauges ? new Map() : typeof this.jauges === "function" ? this.jauges() : this.jauges;
    // Dans l'éditeur, deux prénoms ne se chevauchent plus ; le pion choisi ou survolé garde le sien.
    const nomsMJ = this.mj && !this.tv ? placerNomsMJ(ctx, this.plan, zone, pions, [].concat(this.selection || [], this.survol || []), joueurs) : undefined;
    const animations = this.sansJauges ? null : this.animations(pions, jauges);
    const barres = dessinerPions(ctx, { ...this.plan, pions }, zone, { joueurs, style: this.style, images: this.images, selection: this.selection, lisible, noms: noms || nomsMJ, decales, jauges, animations });
    // Les images du MJ posées au-dessus des pions : un feuillage, un toit, une voûte.
    if (imagesDessus(this.plan)) dessinerImagesPlan(ctx, this.plan, zone, this.imagesPlan, { dessus: true, joueurs });
    // Les plaques des barres de Santé et de Psy à l'écran (pas celles d'une image exportée, qui n'en a pas) : le feu et la
    // brume s'y ouvrent, comme sur un prénom (feu.js, brume.js).
    if (!this.sansJauges) this.barresDessinees = barres;
  }

  animer(id) {
    if (!this.anims.has(id)) this.anims.set(id, {});
    return this.anims.get(id);
  }

  // Ce qui anime chaque pion à cette image (Map id → { flash, secousse, chute, poussiere }), d'après ce qui a changé
  // depuis l'image d'avant : sa Santé (un coup, un soin), le pion mis à terre. Redemande une image tant que ça bouge.
  animations(pions, jauges) {
    const now = performance.now();
    const calme = moinsDeMouvement();
    let bouge = false;
    for (const t of pions) {
      const j = jauges ? jauges.get(t.id) : t.jauges;
      const sante = j && typeof j.sante === "number" ? j.sante : null;
      const avant = this.vus.get(t.id);
      if (avant && !calme) {
        if (sante !== null && avant.sante !== null && sante !== avant.sante) {
          const a = this.animer(t.id);
          a.flash = now;
          a.coup = sante < avant.sante;
        }
        if (t.tombe && !avant.tombe) this.animer(t.id).chute = now;
      }
      this.vus.set(t.id, { sante, tombe: !!t.tombe });
    }
    // La figurine de qui a la main respire : une lueur lente et un léger soulèvement. Seule animation qui dure, à 20
    // images par seconde (la TV ne chauffe pas) ; immobile, la lueur reste, pour qui demande moins de mouvement.
    const main = typeof this.main === "function" ? this.main(pions) : null;
    const r = new Map();
    if (main && main.size) {
      const souffle = calme ? 0.6 : (Math.sin(now / 520) + 1) / 2;
      for (const id of main) r.set(id, { eclat: souffle, leve: calme ? 0 : 0.2 + souffle * 0.2 });
      if (!calme && !this.minuterieMain) {
        this.minuterieMain = setTimeout(() => {
          this.minuterieMain = 0;
          this.demander();
        }, 50);
      }
    }
    if (!this.anims.size) return r.size ? r : null;
    for (const [id, a] of this.anims) {
      const x = {};
      const kf = a.flash ? (now - a.flash) / DUREES.flash : 1;
      if (kf < 1) x.flash = { k: 1 - kf, rvb: a.coup ? COUP : SOIN };
      const ks = a.flash && a.coup ? (now - a.flash) / DUREES.secousse : 1;
      if (ks < 1) x.secousse = Math.sin(now / 22) * (1 - ks);
      const kc = a.chute ? (now - a.chute) / DUREES.chute : 1;
      if (kc < 1) x.chute = kc;
      const kp = a.pose ? (now - a.pose) / DUREES.poussiere : 1;
      if (kp < 1) x.poussiere = kp;
      if (kf >= 1 && ks >= 1 && kc >= 1 && kp >= 1) this.anims.delete(id);
      else {
        r.set(id, Object.assign(r.get(id) || {}, x));
        bouge = true;
      }
    }
    if (bouge) this.demander();
    return r;
  }

  // La hauteur d'écran sur laquelle se règlent les tailles lisibles : celle de la TV. Un téléphone tenu en hauteur compte
  // comme un écran 16/9 posé dans sa largeur : le plan y est petit, ses noms le restent avec lui (la page invite à tourner
  // le téléphone). Le coin des joueurs, où chacun zoome à sa guise, règle la sienne (js/joueurs/table-coin.js).
  hauteurLisible() {
    const debout = this.lw < 600 && this.lh > this.lw;
    return debout ? Math.min(this.lh, (this.lw * 9) / 16) : this.lh;
  }

  // La page n'est prévenue que d'une légende qui change, pas à chaque image.
  annoncerLegende(liste) {
    const cle = JSON.stringify(liste);
    if (cle === this.legende) return;
    this.legende = cle;
    if (this.surLegende) this.surLegende(liste);
  }

  // Sur la TV : l'image d'avant s'efface doucement sur la nouvelle, une fois celle-ci peinte (voir dessiner()).
  fondu() {
    if (!this.canvas.width || !this.plan) return;
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext("2d").drawImage(this.canvas, 0, 0);
    this.oublierAncienne();
    this.ancienne = { toile: c, t0: null, attendu: false };
  }

  // Caché derrière la carte : l'image d'avant n'a plus lieu d'être gardée, la brume ne dérive plus.
  alleger() {
    super.alleger();
    this.oublierAncienne();
    this.oublierEtatsPeints();
    if (this.brume) this.brume.arreter();
    if (this.feu) this.feu.arreter();
    this.legende = null; // annoncée de nouveau au réveil
  }

  detruire() {
    clearTimeout(this.minuterieMain);
    this.oublierEtatsPeints();
    if (this.brume) this.brume.detruire();
    if (this.feu) this.feu.detruire();
    super.detruire();
  }

  // L'image exportée : le plan, puis sa brume et son feu (pâles pour le plan du MJ ; pour les joueurs, sur les seules
  // cases révélées), comme à l'écran.
  // L'image exportée ne garde pas les jauges du moment (un plan imprimé ou archivé reste valable après le combat).
  exporter(echelle, joueurs) {
    this.sansJauges = true;
    try {
      return this.exporterImage(echelle, joueurs);
    } finally {
      this.sansJauges = false;
    }
  }

  exporterImage(echelle, joueurs) {
    const brume = this.brume && this.brume.aDeLaBrume();
    const feu = this.feu && this.feu.aDuFeu();
    if (!brume && !feu) return super.exporter(echelle, joueurs);
    const { w, h } = this.champs;
    const toile = document.createElement("canvas");
    toile.width = w * echelle;
    toile.height = h * echelle;
    const ctx = toile.getContext("2d");
    ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
    const zone = { x0: 0, y0: 0, x1: w, y1: h };
    this.peindreFond(ctx, zone, { joueurs });
    this.peindreDessus(ctx, zone, { joueurs });
    if (brume) this.brume.exporter(ctx, w, h, !!joueurs);
    if (feu) this.feu.exporter(ctx, w, h, !!joueurs);
    return new Promise((ok) => toile.toBlob(ok, "image/png"));
  }

  oublierAncienne() {
    if (this.ancienne) this.ancienne.toile.width = 0;
    this.ancienne = null;
  }

  dessiner() {
    super.dessiner();
    // La brume et le feu suivent la caméra et les pions à chaque image du plan ; entre deux, ils bougent seuls, chacun à
    // son rythme.
    if (this.brume && !this.enSommeil && !this.detruite) this.brume.dessiner();
    if (this.feu && !this.enSommeil && !this.detruite) this.feu.dessiner();
    const a = this.ancienne;
    if (!a || this.enSommeil || this.detruite) return;
    // Le repeint peut figer la TV une demi-seconde, et un canvas ne peint qu'à la fin de l'image qui l'affiche : la
    // première image après le repeint en paie le coût et garde l'image d'avant entière. Le chrono part de la suivante.
    if (a.t0 === null && !a.attendu) {
      a.attendu = true;
      requestAnimationFrame(() => {
        if (this.ancienne === a) a.t0 = performance.now();
      });
    }
    const k = a.t0 === null ? 0 : (performance.now() - a.t0) / 900;
    if (k >= 1) {
      this.oublierAncienne();
      return;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1 - facile(k);
    ctx.drawImage(a.toile, 0, 0);
    ctx.globalAlpha = 1;
    this.demander();
  }

  // Ce que les joueurs connaissent du plan, avec un peu de marge : sert à cadrer la TV.
  cameraRevelee(marge = 2) {
    const b = boiteRevelee(this.plan) || { x0: 0, y0: 0, x1: this.plan.largeur, y1: this.plan.hauteur };
    const w = b.x1 - b.x0 + marge * 2;
    const h = b.y1 - b.y0 + marge * 2;
    const hv = Math.max(h, (w * this.lh) / Math.max(1, this.lw), 8);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, hv };
  }

  limiter() {
    const zmin = this.zoomCadre() * 0.4;
    this.cam.z = Math.min(this.zoomMax, Math.max(zmin, this.cam.z));
    const { w, h } = this.champs;
    this.cam.x = Math.min(w, Math.max(0, this.cam.x));
    this.cam.y = Math.min(h, Math.max(0, this.cam.y));
  }
}
