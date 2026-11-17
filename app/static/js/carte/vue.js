// Affichage d'une carte dans un canvas : un fond mis en cache pour la vue d'ensemble, et des tuiles plus fines,
// calculées petit à petit, dès qu'on zoome. Rien ne bloque l'écran plus que le temps d'une tuile.
// Style peint : le raster de chaque zone se calcule dans des Web Workers (peint.js) ; une tuile arrive quand le sien
// est prêt, et ce qui se pose dessus se peint ici, par tranches bornées.

import { Champs } from "./champs.js";
import { decoderCarte } from "./format.js";
import { calculerRaster } from "./peint-calcul.js";
import { dessinerDessusPeint } from "./peint-dessus.js";
import { FondPeint, MoteurPeint, calquesDe, fusionnerZones } from "./peint.js";
import { dessinerDessus, dessinerFond } from "./rendu.js";

export async function chargerPolices() {
  await Promise.all(
    ["600 20px Cinzel", "700 20px Cinzel", "700 20px 'Cinzel Decorative'", "500 20px 'EB Garamond'", "italic 500 20px 'EB Garamond'"].map((f) =>
      document.fonts.load(f).catch(() => null),
    ),
  );
}

export function chargerImage(src) {
  return new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = src;
  });
}

const facile = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const TUILE = 256; // pixels par côté
const DEBORD = 2; // pixels rendus en plus autour de chaque tuile, pour qu'aucune jointure ne se voie
const TUILES_MAX = 220; // dans l'atelier ; la TV règle le sien sur la taille de son écran (options.ecransTuiles)
const BUDGET = 12; // millisecondes de rendu de tuiles par tranche
// Un canvas ne peint qu'à la fin de l'image qui l'affiche : le vrai coût d'une tuile tombe là, pas pendant son calcul.
// Une tranche en calcule donc peu, et d'autant moins que l'image qui a montré les précédentes a été lente.
const PAR_TRANCHE = 4;
// Style peint : morceaux du fond de base (en cases), raster des tuiles plafonné (en pixels par case : au-delà, il est
// agrandi, il est flou par nature), demandes de tuiles en cours au plus.
const BLOC = 32;
const RASTER_MAX = 32;
const TUILES_EN_COURS = 8;

// Ce que actualiser() sait reprendre sans tout recalculer ; une autre différence recharge la carte entière.
const REPRIS = new Set([
  "terrain", "largeur", "hauteur", "graine", "taille_symboles", "decor",
  "traces", "marqueurs", "brouillard", "brouillard_actif", "etiquettes", "groupe", "taille_textes", "km_case", "lieux",
  "modifie", "cree", "nom", "id", "style", "notes", "parent", "modele", "habillage",
]);

const croise = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;
const dedans = (a, b) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
const inter = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

function memesOctets(a, b) {
  if (!a || !b || a.length !== b.length) return a === b;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Même fond de carte : dimensions, graine, taille des symboles, brume du décor et terrain case par case.
export function memeFond(a, b) {
  if (!a || !b) return false;
  for (const cle of ["largeur", "hauteur", "graine", "taille_symboles"]) if (a[cle] !== b[cle]) return false;
  if (JSON.stringify(a.decor?.brume ?? null) !== JSON.stringify(b.decor?.brume ?? null)) return false;
  return memesOctets(a.terrain, b.terrain);
}

// Éléments (tracés, lieux posés) présents d'un seul côté, comparés en entier.
function difference(avant = [], apres = []) {
  const parTexte = (liste) => new Map(liste.map((x) => [JSON.stringify(x), x]));
  const a = parTexte(avant);
  const b = parTexte(apres);
  const resultat = [];
  for (const [k, x] of a) if (!b.has(k)) resultat.push(x);
  for (const [k, x] of b) if (!a.has(k)) resultat.push(x);
  return resultat;
}

function boitePoints(points, marge) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0: x0 - marge, y0: y0 - marge, x1: x1 + marge, y1: y1 + marge };
}

// ---------------------------------------------------------------- molette et pavé tactile (éditeurs, pas la TV)

// Réglage « Pavé tactile / Souris » des éditeurs de cartes et de plans, retenu sur ce navigateur. Sans choix : pavé sur
// un Mac (ou un iPad au clavier), souris ailleurs.
const DEFILEMENT = "cartes.defilement";
// Chrome transmet un pincement du pavé en molette avec ctrlKey et deltaY = -100 × ln(échelle) : exp(-deltaY / 100)
// suit les doigts. Borné par événement, pour qu'un cran de Ctrl + molette (100) ne triple pas le zoom.
const PINCE = 0.01;
const PINCE_MAX = 0.3;
// Molette de souris, comme avant : par pixel, et par ligne (deltaMode 1).
const CRAN_PIXEL = 0.0016;
const CRAN_LIGNE = 0.05;
const LIGNE = 32; // pixels d'une ligne de défilement

export const AVIS_PAVE = "Deux doigts déplacent la vue, pincez pour zoomer (réglage en haut).";

export function lireDefilement() {
  try {
    const v = localStorage.getItem(DEFILEMENT);
    if (v === "pave" || v === "souris") return v;
  } catch {
    // stockage fermé : réglage par défaut
  }
  // « macOS » (userAgentData, page sûre seulement) ou « MacIntel », « iPad »…
  return /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || "") ? "pave" : "souris";
}

export function garderDefilement(mode) {
  try {
    localStorage.setItem(DEFILEMENT, mode);
  } catch {
    // préférence perdue, sans conséquence
  }
}

// Vrai une seule fois : deux doigts viennent de déplacer la vue sans réglage retenu (le même geste zoomait avant).
// Le réglage par défaut est alors retenu, l'éditeur ne le dit qu'une fois.
export function premierGlisser() {
  try {
    if (localStorage.getItem(DEFILEMENT)) return false;
    localStorage.setItem(DEFILEMENT, "pave");
    return true;
  } catch {
    return false;
  }
}

// Ce que fait un événement wheel : { zoom } (facteur, autour du pointeur) ou { glisser: [dx, dy] } (pixels d'écran).
// Pincer (ctrlKey) zoome toujours ; en mode pavé, deux doigts déplacent la vue et Cmd + deux doigts zoome ; en mode
// souris, la molette zoome.
export function gesteMolette(ev, mode, hauteur = 800) {
  const unite = ev.deltaMode === 1 ? LIGNE : ev.deltaMode === 2 ? hauteur : 1;
  if (ev.ctrlKey) return { zoom: Math.exp(Math.max(-PINCE_MAX, Math.min(PINCE_MAX, -ev.deltaY * unite * PINCE))) };
  if (mode === "pave" && !ev.metaKey) return { glisser: [-ev.deltaX * unite, -ev.deltaY * unite] };
  return { zoom: Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? CRAN_LIGNE : CRAN_PIXEL)) };
}

// La molette appliquée à la vue d'un éditeur : rend le geste, ou null s'il ne bouge rien.
export function molette(vue, ev, mode) {
  const g = gesteMolette(ev, mode, vue.lh);
  if (g.glisser) {
    if (!g.glisser[0] && !g.glisser[1]) return null;
    vue.deplacer(g.glisser[0], g.glisser[1]);
  } else {
    if (g.zoom === 1) return null;
    vue.zoomer(g.zoom, ev.offsetX, ev.offsetY);
  }
  return g;
}

export class VueCarte {
  // options.pixelsMax et options.ecransTuiles : réglages de la TV (plafond de pixels du canvas, tuiles gardées en écrans).
  // options.peint : réglages du style peint ({ worker, travailleurs, garderRaster, rasterMax }) ; options.donneesPubliques :
  // la carte reçue est déjà celle des joueurs (TV), rien n'y est à filtrer.
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.style = options.style || "couleur";
    this.joueurs = !!options.joueurs;
    this.texture = options.texture || null;
    this.fond = options.fond || "#1b140f";
    this.pixelsMax = options.pixelsMax || 0;
    this.ecransTuiles = options.ecransTuiles || 0;
    // Sur la TV (options.tv) : les noms de la carte ne descendent pas sous la taille lisible du canapé (tailleLisible).
    this.tv = !!options.tv;
    this.optionsPeint = options.peint || {};
    this.donneesPubliques = !!options.donneesPubliques;
    this.travauxPeints = [];
    this.tuilesEnCours = new Map();
    this.lieux = {};
    this.cam = { x: 0, y: 0, z: 4 };
    this.dessusEditeur = null;
    this.surCamera = null;
    this.animation = null;
    this.enAnimation = false;
    this.enSommeil = false;
    this.tuiles = new Map();
    this.parTranche = PAR_TRANCHE;
    this.image = 0;
    this.derniereMotion = 0;
    this.redimensionner();
    this.observateur = new ResizeObserver(() => {
      const avant = this.lw;
      this.redimensionner();
      if (this.champs && !avant) this.cadrer();
      this.demander();
    });
    this.observateur.observe(canvas);
  }

  detruire() {
    this.detruite = true;
    this.observateur.disconnect();
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.animation);
    clearTimeout(this.minuterieTuiles);
    clearTimeout(this.minuterieRepos);
    clearTimeout(this.minuterieTravaux);
    if (this.moteurPeint) this.moteurPeint.detruire();
    // Un canvas ramené à zéro rend sa mémoire tout de suite, sans attendre le ramasse-miettes.
    this.viderTuiles();
    if (this.base) this.libererBase();
    this.canvas.width = 0;
  }

  viderTuiles() {
    for (const t of this.tuiles.values()) this.libererTuile(t);
    this.tuiles.clear();
    this.tuilesEnCours.clear();
  }

  libererTuile(t) {
    t.toile.width = 0;
    if (t.ras) for (const c of [t.ras.couleur, t.ras.ombre, t.ras.lumiere]) c.width = 0;
  }

  libererBase() {
    this.base.toile.width = 0;
    if (this.base.ras) for (const c of [this.base.ras.couleur, this.base.ras.ombre, this.base.ras.lumiere]) c.width = 0;
  }

  // Vue cachée derrière une autre (sur la TV, la carte sous un plan, et inversement) : ses tuiles rendent leur mémoire,
  // plus rien ne se calcule ni ne se dessine. reveiller() la remet en marche.
  alleger() {
    if (this.enSommeil) return;
    this.enSommeil = true;
    cancelAnimationFrame(this.animation);
    this.enAnimation = false;
    clearTimeout(this.minuterieTuiles);
    this.minuterieTuiles = 0;
    this.aFaire = null;
    this.viderTuiles();
  }

  reveiller() {
    if (!this.enSommeil) return;
    this.enSommeil = false;
    this.demander();
  }

  redimensionner() {
    const r = this.canvas.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Plafond de pixels (TV) : un grand écran est agrandi par le navigateur au lieu d'être peint en entier à chaque image.
    if (this.pixelsMax && r.width * r.height > 0) dpr = Math.min(dpr, Math.sqrt(this.pixelsMax / (r.width * r.height)));
    this.dpr = dpr;
    this.lw = r.width;
    this.lh = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  // options.fond (style peint, TV) : { image, nouveaux }, le fond de base déjà peint par l'atelier, et ce qui s'est
  // ajouté depuis à la carte (indices fournis par le serveur) : seules ces zones-là se recalculent.
  charger(carte, lieux, options = {}) {
    this.carte = carte;
    this.lieux = lieux || {};
    this.champs = new Champs(carte);
    this.fondFourni = options.fond || null;
    this.construireBase();
  }

  // Sur la TV, la même carte réenregistrée par le MJ : si son fond n'a pas bougé (terrain, dimensions, graine, style),
  // seul ce qui a changé est repris (brouillard, tracés, lieux, noms, groupe, décor) ; sinon faux, et tout se recharge.
  actualiser(carte, lieux, style = this.style) {
    const avant = this.carte;
    if (!(this.champs instanceof Champs) || style !== this.style || !memeFond(avant, carte)) return false;
    for (const cle of new Set([...Object.keys(avant), ...Object.keys(carte)])) {
      if (!REPRIS.has(cle) && JSON.stringify(avant[cle]) !== JSON.stringify(carte[cle])) return false;
    }
    // Un tracé ou un lieu posé qui change écarte autrement les arbres et les montagnes : le fond se repeint autour de lui.
    const zones = [];
    for (const t of difference(avant.traces, carte.traces)) if (t.points && t.points.length) zones.push(boitePoints(t.points, 1));
    for (const m of difference(avant.marqueurs, carte.marqueurs)) {
      const s = m.taille || 1;
      zones.push(boitePoints([[m.x, m.y - 0.3 * s]], 1.05 * s + 0.5));
    }
    this.carte = carte;
    this.champs.carte = carte;
    this.lieux = lieux || {};
    if (!memesOctets(avant.brouillard, carte.brouillard) || avant.brouillard_actif !== carte.brouillard_actif) this.champs.majBrouillard();
    if (this.peint) {
      // Peint : le fond sait lui-même ce qui a changé (lieux, tracés, habillage) et ce que cela déplace autour.
      if (zones.length) this.champs.calculerVoies();
      this.peint.changerCarte(carte, this.lieux);
      this.rafraichirZonePeinte(null);
    } else if (zones.length) {
      this.champs.calculerVoies();
      for (const z of zones) {
        this.champs.invalider(z.x0 - 1, z.y0 - 1, z.x1 + 1, z.y1 + 1);
        // Un symbole déborde de sa case, vers le haut surtout (une montagne monte de quatre à cinq cases).
        this.rafraichirZone({ x0: z.x0 - 4, y0: z.y0 - 6, x1: z.x1 + 4, y1: z.y1 + 2 });
      }
    }
    this.demander();
    return true;
  }

  echelleBase() {
    const { w, h } = this.champs;
    return Math.max(2, Math.min(8, Math.floor(4096 / w), Math.floor(4096 / h)));
  }

  construireBase() {
    const B = this.echelleBase();
    const { w, h } = this.champs;
    if (this.base) this.libererBase();
    const toile = document.createElement("canvas");
    toile.width = w * B;
    toile.height = h * B;
    this.base = { toile, B };
    this.viderTuiles();
    if (this.majPeint()) return this.construireBasePeinte();
    this.rafraichirZone({ x0: 0, y0: 0, x1: w, y1: h });
  }

  changerStyle(style) {
    this.style = style;
    this.construireBase();
  }

  // options.tuilesSeules : pendant un coup de pinceau zoomé, le fond d'ensemble attend la fin du trait.
  // options.trait (peint) : coup de pinceau en cours ; les champs cultivés attendent la fin du trait.
  rafraichirZone(z, options = {}) {
    if (this.detruite) return;
    if (this.peint) return this.rafraichirZonePeinte(z, options);
    const { w, h } = this.champs;
    const zone = {
      x0: Math.max(0, Math.floor(z.x0)),
      y0: Math.max(0, Math.floor(z.y0)),
      x1: Math.min(w, Math.ceil(z.x1)),
      y1: Math.min(h, Math.ceil(z.y1)),
    };
    if (zone.x1 <= zone.x0 || zone.y1 <= zone.y0) return;
    const { toile, B } = this.base;
    if (!options.tuilesSeules) {
      const ctx = toile.getContext("2d");
      ctx.setTransform(B, 0, 0, B, 0, 0);
      ctx.clearRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
      this.peindreFond(ctx, zone);
    }
    // Petite zone (un coup de pinceau) : on repeint les tuiles sur place, sans repasser par le flou du fond.
    const petite = (zone.x1 - zone.x0) * (zone.y1 - zone.y0) < 1600;
    for (const [cle, t] of this.tuiles) {
      if (!(t.x1 > zone.x0 && t.x0 < zone.x1 && t.y1 > zone.y0 && t.y0 < zone.y1)) continue;
      if (!petite) {
        t.toile.width = 0;
        this.tuiles.delete(cle);
        continue;
      }
      const S = this.base.B * 2 ** t.l;
      const tctx = t.toile.getContext("2d");
      tctx.setTransform(S, 0, 0, S, DEBORD - t.ix * TUILE, DEBORD - t.iy * TUILE);
      tctx.clearRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
      this.peindreFond(tctx, zone);
    }
    this.demander();
  }

  rafraichirTout() {
    this.viderTuiles();
    // Peint : passer de la vue du MJ à celle des joueurs (ou l'inverse) change ce que le fond montre.
    if (this.peint && this.peint.joueurs !== this.joueurs) this.peint = this.nouveauFondPeint(this.joueurs);
    this.rafraichirZone({ x0: 0, y0: 0, x1: this.champs.w, y1: this.champs.h });
  }

  transformer(ctx) {
    const { x, y, z } = this.cam;
    const d = this.dpr;
    ctx.setTransform(z * d, 0, 0, z * d, (this.lw / 2 - x * z) * d, (this.lh / 2 - y * z) * d);
  }

  zoneVisible() {
    const { x, y, z } = this.cam;
    const dx = this.lw / 2 / z;
    const dy = this.lh / 2 / z;
    return { x0: x - dx, y0: y - dy, x1: x + dx, y1: y + dy };
  }

  versCarte(px, py) {
    const { x, y, z } = this.cam;
    return [x + (px - this.lw / 2) / z, y + (py - this.lh / 2) / z];
  }

  versEcran(cx, cy) {
    const { x, y, z } = this.cam;
    return [(cx - x) * z + this.lw / 2, (cy - y) * z + this.lh / 2];
  }

  zoomCadre(marge = 0.02) {
    const { w, h } = this.champs;
    return Math.min(this.lw / (w * (1 + marge)), this.lh / (h * (1 + marge)));
  }

  cadrer() {
    if (!this.champs || !this.lw) return;
    this.cam = { x: this.champs.w / 2, y: this.champs.h / 2, z: this.zoomCadre() };
    this.changementCamera();
  }

  limiter() {
    const zmin = this.zoomCadre() * 0.5;
    this.cam.z = Math.min(this.zoomMax || 80, Math.max(zmin, this.cam.z));
    const { w, h } = this.champs;
    this.cam.x = Math.min(w, Math.max(0, this.cam.x));
    this.cam.y = Math.min(h, Math.max(0, this.cam.y));
  }

  zoomer(facteur, px, py) {
    const [ax, ay] = this.versCarte(px, py);
    this.cam.z *= facteur;
    this.limiter();
    const [bx, by] = this.versCarte(px, py);
    this.cam.x += ax - bx;
    this.cam.y += ay - by;
    this.limiter();
    this.changementCamera();
  }

  deplacer(dx, dy) {
    this.cam.x -= dx / this.cam.z;
    this.cam.y -= dy / this.cam.z;
    this.limiter();
    this.changementCamera();
  }

  changementCamera() {
    this.derniereMotion = performance.now();
    this.demander();
    if (this.surCamera) this.surCamera(this.cam);
  }

  // Caméra décrite indépendamment de l'écran : centre et hauteur visible en cases.
  cameraPartagee() {
    return { x: +this.cam.x.toFixed(3), y: +this.cam.y.toFixed(3), hv: +(this.lh / this.cam.z).toFixed(3) };
  }

  animerVers(cible, duree = 1400) {
    if (!this.champs || !this.lw) return;
    const z1 = cible.hv ? this.lh / cible.hv : this.zoomCadre();
    const depart = { ...this.cam };
    const arrivee = { x: cible.x ?? this.champs.w / 2, y: cible.y ?? this.champs.h / 2, z: z1 };
    // Déjà en place : pas d'animation immobile, une image suffit.
    if (Math.abs(arrivee.x - depart.x) < 1e-3 && Math.abs(arrivee.y - depart.y) < 1e-3 && Math.abs(arrivee.z / depart.z - 1) < 1e-4) {
      cancelAnimationFrame(this.animation);
      this.enAnimation = false;
      this.demander();
      return;
    }
    const ecrans = (Math.hypot(arrivee.x - depart.x, arrivee.y - depart.y) * Math.min(depart.z, arrivee.z)) / Math.max(this.lw, this.lh);
    const bosse = Math.max(0, Math.log(1 + ecrans)) * 0.9;
    const t0 = performance.now();
    cancelAnimationFrame(this.animation);
    this.enAnimation = true;
    const pas = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / duree));
      const e = facile(k);
      this.cam.x = depart.x + (arrivee.x - depart.x) * e;
      this.cam.y = depart.y + (arrivee.y - depart.y) * e;
      this.cam.z = Math.exp(Math.log(depart.z) + (Math.log(arrivee.z) - Math.log(depart.z)) * e - bosse * Math.sin(Math.PI * e));
      this.derniereMotion = performance.now();
      this.dessiner();
      if (k < 1) this.animation = requestAnimationFrame(pas);
      else {
        this.enAnimation = false;
        this.demander();
      }
    };
    this.animation = requestAnimationFrame(pas);
  }

  // Une image à redessiner ; pendant une animation, la sienne suffit.
  demander() {
    if (this.rafId || this.enAnimation || this.detruite) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.dessiner();
    });
  }

  // Niveau de tuiles : chaque niveau double la finesse du fond de base.
  niveau() {
    const r = (this.cam.z * this.dpr) / this.base.B;
    if (r <= 1.08) return 0;
    return Math.max(1, Math.min(this.niveauMax || 4, Math.ceil(Math.log2(r) - 0.08)));
  }

  // Tuiles gardées en mémoire : TUILES_MAX dans l'atelier ; sur la TV, de quoi couvrir quelques écrans.
  limiteTuiles() {
    if (!this.ecransTuiles) return TUILES_MAX;
    const parEcran = Math.ceil(this.canvas.width / TUILE + 1) * Math.ceil(this.canvas.height / TUILE + 1);
    return Math.max(12, Math.round(this.ecransTuiles * parEcran));
  }

  rendreTuile(l, ix, iy) {
    const S = this.base.B * 2 ** l;
    const c = TUILE / S;
    const m = DEBORD / S;
    const toile = document.createElement("canvas");
    toile.width = toile.height = TUILE + 2 * DEBORD;
    const ctx = toile.getContext("2d");
    ctx.setTransform(S, 0, 0, S, DEBORD - ix * TUILE, DEBORD - iy * TUILE);
    const zone = { x0: ix * c - m, y0: iy * c - m, x1: (ix + 1) * c + m, y1: (iy + 1) * c + m };
    this.peindreFond(ctx, zone);
    this.rangerTuile(`${l}:${ix}:${iy}`, { toile, ...zone, l, ix, iy, vu: this.image, neuve: true });
  }

  rangerTuile(cle, tuile) {
    this.tuiles.set(cle, tuile);
    const max = this.limiteTuiles();
    if (this.tuiles.size > max) {
      const vieilles = [...this.tuiles.entries()].sort((a, b) => a[1].vu - b[1].vu);
      for (const [c, t] of vieilles.slice(0, this.tuiles.size - max)) {
        this.libererTuile(t);
        this.tuiles.delete(c);
      }
    }
  }

  planifierTuiles(l, manquantes) {
    this.aFaire = { l, liste: manquantes };
    if (this.minuterieTuiles || this.enSommeil) return;
    const attente = performance.now() - this.derniereMotion < 90 ? 110 : 0;
    this.minuterieTuiles = setTimeout(() => this.travaillerTuiles(), attente);
  }

  travaillerTuiles() {
    this.minuterieTuiles = 0;
    const a = this.aFaire;
    if (!a || !this.champs || this.enSommeil || this.detruite) return;
    if (performance.now() - this.derniereMotion < 90) {
      this.minuterieTuiles = setTimeout(() => this.travaillerTuiles(), 110);
      return;
    }
    if (this.peint) {
      // Les rasters se demandent aux workers ; les tuiles se peindront à leur arrivée (travail()).
      const limite = Math.min(TUILES_EN_COURS, 2 * Math.max(1, this.moteurPeint.travailleurs.length));
      while (a.liste.length && this.tuilesEnCours.size < limite) {
        const [ix, iy] = a.liste.shift();
        const cle = `${a.l}:${ix}:${iy}`;
        if (!this.tuiles.has(cle) && !this.tuilesEnCours.has(cle)) this.demanderTuilePeinte(a.l, ix, iy);
      }
      return;
    }
    const t0 = performance.now();
    let faites = 0;
    while (a.liste.length && faites < this.parTranche && performance.now() - t0 < BUDGET) {
      const [ix, iy] = a.liste.shift();
      if (!this.tuiles.has(`${a.l}:${ix}:${iy}`)) {
        this.rendreTuile(a.l, ix, iy);
        faites++;
      }
    }
    this.demander();
  }

  // Durée de l'image qui a montré de nouvelles tuiles, peinture comprise : lente, la tranche suivante en calcule moins.
  reglerTranche(duree) {
    if (duree > 3 * BUDGET) this.parTranche = Math.max(1, this.parTranche - 1);
    else if (duree < 1.5 * BUDGET) this.parTranche = Math.min(PAR_TRANCHE, this.parTranche + 1);
  }

  dessiner() {
    if (this.detruite || this.enSommeil) return;
    const debut = performance.now();
    const ctx = this.ctx;
    this.image++;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.fond;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.champs) return;
    const zone = this.zoneVisible();
    const bouge = debut - this.derniereMotion < 90;
    this.enMouvement = bouge || this.enAnimation;
    // Peint : un lieu révélé par le brouillard, un lieu devenu connu, un habillage posé changent ce que montre le fond.
    if (this.peint && this.peint.aChange()) this.rafraichirZonePeinte(null);
    const { w, h } = this.champs;
    const { toile, B } = this.base;
    this.transformer(ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = bouge ? "low" : "medium";
    const l = this.niveau();
    if (l === 0) {
      this.voulues = null;
      ctx.drawImage(toile, 0, 0, w, h);
    } else {
      const S = B * 2 ** l;
      const c = TUILE / S;
      const m = DEBORD / S;
      const ix0 = Math.max(0, Math.floor(zone.x0 / c));
      const iy0 = Math.max(0, Math.floor(zone.y0 / c));
      const ix1 = Math.min(Math.ceil(w / c) - 1, Math.floor(zone.x1 / c));
      const iy1 = Math.min(Math.ceil(h / c) - 1, Math.floor(zone.y1 / c));
      const cx = (zone.x0 + zone.x1) / 2;
      const cy = (zone.y0 + zone.y1) / 2;
      const pretes = [];
      const manquantes = [];
      this.voulues = new Set();
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const t = this.tuiles.get(`${l}:${ix}:${iy}`);
          this.voulues.add(`${l}:${ix}:${iy}`);
          if (t) pretes.push(t);
          else manquantes.push([ix, iy, Math.hypot((ix + 0.5) * c - cx, (iy + 0.5) * c - cy)]);
        }
      }
      // Le fond d'ensemble ne se peint que là où une tuile manque encore : sous une tuile prête, il serait recouvert.
      for (const [ix, iy] of manquantes) {
        const x0 = Math.max(0, ix * c - m);
        const y0 = Math.max(0, iy * c - m);
        const x1 = Math.min(w, (ix + 1) * c + m);
        const y1 = Math.min(h, (iy + 1) * c + m);
        if (x1 > x0 && y1 > y0) ctx.drawImage(toile, x0 * B, y0 * B, (x1 - x0) * B, (y1 - y0) * B, x0, y0, x1 - x0, y1 - y0);
      }
      ctx.imageSmoothingQuality = "low";
      let neuves = 0;
      for (const t of pretes) {
        t.vu = this.image;
        if (t.neuve) {
          t.neuve = false;
          neuves++;
        }
        ctx.drawImage(t.toile, t.ix * c - m, t.iy * c - m, c + 2 * m, c + 2 * m);
      }
      // La minuterie part après la fin de l'image, donc après la peinture des nouvelles tuiles.
      if (neuves) setTimeout(() => this.reglerTranche(performance.now() - debut), 0);
      if (manquantes.length) this.planifierTuiles(l, manquantes.sort((a, b) => a[2] - b[2]));
    }
    this.transformer(ctx);
    this.peindreDessus(ctx, zone);
    if (this.dessusEditeur) this.dessusEditeur(ctx, zone);
    if (bouge) {
      clearTimeout(this.minuterieRepos);
      this.minuterieRepos = setTimeout(() => this.demander(), 100);
    }
  }

  exporter(echelle, joueurs) {
    const { w, h } = this.champs;
    if (this.peint) return this.exporterPeint(echelle, joueurs);
    const toile = document.createElement("canvas");
    toile.width = w * echelle;
    toile.height = h * echelle;
    const ctx = toile.getContext("2d");
    ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
    const zone = { x0: 0, y0: 0, x1: w, y1: h };
    this.peindreFond(ctx, zone, { joueurs });
    this.peindreDessus(ctx, zone, { joueurs });
    return new Promise((ok) => toile.toBlob(ok, "image/png"));
  }

  // Ce qui se peint : le fond (mis en cache par tuiles) et le dessus (à chaque image). Les plans les remplacent.
  // Peint : le raster se calcule ici, d'un bloc (contrat synchrone) ; peindreFondAttendu passe par les workers.
  peindreFond(ctx, zone, o = {}) {
    const joueurs = o.joueurs ?? this.joueurs;
    if (this.peint) {
      const fond = this.fondPeintPour(joueurs);
      const R = Math.min(RASTER_MAX, Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || this.base.B);
      const m = this.moteurPeint;
      const X0 = Math.floor(zone.x0 * R) / R;
      const Y0 = Math.floor(zone.y0 * R) / R;
      const wpx = Math.ceil((zone.x1 - X0) * R);
      const hpx = Math.ceil((zone.y1 - Y0) * R);
      const r = calculerRaster(m.d, X0, Y0, wpx, hpx, R);
      const ras = { couleur: new ImageData(r.couleur, wpx, hpx), ombre: new ImageData(r.ombre, wpx, hpx), lumiere: new ImageData(r.lumiere, wpx, hpx), x0: X0, y0: Y0, R, wpx, hpx };
      fond.peindre(ctx, zone, R, calquesDe(ras, false));
      return;
    }
    dessinerFond(ctx, this.carte, this.champs, this.style, zone, this.texture, { joueurs });
  }

  async peindreFondAttendu(ctx, zone, o = {}) {
    if (!this.peint) return this.peindreFond(ctx, zone, o);
    const fond = this.fondPeintPour(o.joueurs ?? this.joueurs);
    const R = Math.min(RASTER_MAX, Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || this.base.B);
    const r = await this.moteurPeint.raster(zone, R, { priorite: -1e5 });
    if (r) fond.peindre(ctx, zone, R, calquesDe(r, false));
  }

  peindreDessus(ctx, zone, o = {}) {
    const joueurs = o.joueurs ?? this.joueurs;
    const minNom = o.rapide === false ? 0 : this.tailleLisible();
    if (this.peint) {
      // rapide === false : export ou capture, tout se peint tout de suite.
      const complet = o.rapide === false;
      const reste = dessinerDessusPeint(ctx, this.carte, this.lieux, this.champs, zone, { joueurs, texture: this.texture, rapide: complet ? false : this.enMouvement, complet, minNom });
      if (reste) this.demander();
      return;
    }
    dessinerDessus(ctx, this.carte, this.lieux, this.champs, this.style, zone, { joueurs, texture: this.texture, minNom });
  }

  // Sur la TV, aucun nom de la carte sous 24 pixels d'un écran 1080p (en cases, au zoom du moment) : les joueurs lisent
  // du canapé. Un téléphone tenu en hauteur compte comme un écran 16/9 posé dans sa largeur (la carte y est petite).
  tailleLisible() {
    if (!this.tv || !this.cam.z) return 0;
    return (24 * Math.min(this.lh, (this.lw * 9) / 16)) / 1080 / this.cam.z;
  }

  // ---------------------------------------------------------------- style peint

  // Prépare le style peint (moteur et fond de la vue courante) ou le quitte ; vrai s'il s'applique. Les plans ont leurs
  // propres champs : ils n'y passent jamais.
  majPeint() {
    this.generationPeinte = (this.generationPeinte || 0) + 1;
    this.travauxPeints = [];
    this.tuilesEnCours.clear();
    this.terrainEnAttente = null;
    this.peintureEnCours = false;
    if (this.style !== "peint" || !(this.champs instanceof Champs)) {
      if (this.moteurPeint) this.moteurPeint.detruire();
      this.moteurPeint = null;
      this.peint = null;
      return false;
    }
    if (this.moteurPeint) this.moteurPeint.charger(this.champs);
    else this.moteurPeint = new MoteurPeint(this.champs, this.optionsPeint);
    this.peint = this.nouveauFondPeint(this.joueurs);
    return true;
  }

  nouveauFondPeint(joueurs) {
    return new FondPeint(this.carte, this.champs, this.lieux, { moteur: this.moteurPeint, joueurs, publiques: this.donneesPubliques });
  }

  // Le fond d'une vue, à jour (export, capture) : celui de l'écran, ou un fond à part pour l'autre vue.
  fondPeintPour(joueurs) {
    this.rafraichirZonePeinte(null);
    return !!joueurs === this.peint.joueurs ? this.peint : this.nouveauFondPeint(!!joueurs);
  }

  // Un travail de peinture (tuile, morceau de fond) : ils passent par tranches de BUDGET millisecondes.
  travail(fn) {
    this.travauxPeints.push(fn);
    if (!this.minuterieTravaux) this.minuterieTravaux = setTimeout(() => this.faireTravaux(), 0);
  }

  faireTravaux() {
    this.minuterieTravaux = 0;
    if (this.detruite) return;
    const t0 = performance.now();
    while (this.travauxPeints.length && performance.now() - t0 < BUDGET) this.travauxPeints.shift()();
    this.demander();
    if (this.travauxPeints.length) this.minuterieTravaux = setTimeout(() => this.faireTravaux(), 0);
  }

  rasterMax() {
    return this.optionsPeint.rasterMax || RASTER_MAX;
  }

  // Le fond de base : l'image fournie (TV), ou un aperçu grossier puis la carte morceau par morceau, en commençant
  // par ce que montre la caméra. Dans l'atelier, les calques du raster sont gardés : une retouche qui ne touche pas au
  // terrain (tracé, lieu, habillage) se repeint sur place, sans worker.
  construireBasePeinte() {
    const b = this.base;
    const { B } = b;
    const { w, h } = this.champs;
    const gen = this.generationPeinte;
    const toile_ = (l, ht) => {
      const c = document.createElement("canvas");
      c.width = l;
      c.height = ht;
      return c;
    };
    // Calques gardés, sauf sur la TV et pour une très grande carte (la mémoire des canvas d'une tablette est comptée).
    const garder = this.optionsPeint.garderRaster !== false && w * h * B * B <= 4.2e6;
    b.ras = garder ? { couleur: toile_(w * B, h * B), ombre: toile_(w * B, h * B), lumiere: toile_(w * B, h * B), x0: 0, y0: 0, R: B, wpx: w * B, hpx: h * B } : null;
    b.perime = [];
    b.attente = [];
    b.enCours = 0;
    const f = this.fondFourni;
    this.fondFourni = null;
    if (f && f.image && f.image.width === w * B && f.image.height === h * B) {
      b.toile.getContext("2d").drawImage(f.image, 0, 0);
      if (b.ras) b.perime.push({ x0: 0, y0: 0, x1: w, y1: h });
      for (const z of this.peint.zonesDesNouveaux(f.nouveaux)) this.repeindreBase(z);
      this.demander();
      return;
    }
    // Le fond se peint morceau par morceau : peintureEnCours le dit, et surPeinturePrete (l'éditeur) est prévenu quand le
    // dernier morceau est posé.
    this.peintureEnCours = true;
    const tout = { x0: 0, y0: 0, x1: w, y1: h };
    const faits = new Set();
    const blocs = [];
    for (let y = 0; y < h; y += BLOC) for (let x = 0; x < w; x += BLOC) blocs.push({ x0: x, y0: y, x1: Math.min(w, x + BLOC), y1: Math.min(h, y + BLOC) });
    // Les calques gardés ne valent rien tant que leur morceau n'est pas arrivé.
    if (b.ras) b.perime = blocs.slice();
    const vivant = () => gen === this.generationPeinte && !this.detruite;
    // L'aperçu : le raster seul, quatre fois plus grossier, là où aucun morceau n'est encore arrivé.
    const Ra = Math.max(1, Math.min(2, Math.floor(B / 4)));
    this.moteurPeint.raster(tout, Ra, { priorite: -1e6, vivant }).then((r) => {
      if (!r || !vivant() || faits.size === blocs.length) return;
      const c = calquesDe(r, false);
      const ctx = b.toile.getContext("2d");
      ctx.save();
      ctx.setTransform(B, 0, 0, B, 0, 0);
      ctx.beginPath();
      for (const z of blocs) if (!faits.has(z)) ctx.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c.couleur, 0, 0, r.wpx, r.hpx, 0, 0, r.l, r.h);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(c.ombre, 0, 0, r.wpx, r.hpx, 0, 0, r.l, r.h);
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(c.lumiere, 0, 0, r.wpx, r.hpx, 0, 0, r.l, r.h);
      ctx.restore();
      this.demander();
    });
    for (const z of blocs) {
      const priorite = Math.hypot((z.x0 + z.x1 - w) / 2, (z.y0 + z.y1 - h) / 2);
      this.moteurPeint.raster(z, B, { priorite, vivant }).then((r) => {
        if (!r || !vivant()) return;
        this.travail(() => {
          if (!vivant()) return;
          faits.add(z);
          this.peindreBaseZone(z, r);
          if (faits.size === blocs.length) {
            this.peintureEnCours = false;
            if (this.surPeinturePrete) this.surPeinturePrete();
          }
        });
      });
    }
  }

  // Une zone du fond de base, avec le raster qui vient d'arriver (r) ou les calques gardés.
  peindreBaseZone(z, r) {
    const b = this.base;
    let ras = b.ras;
    if (r) {
      if (b.ras) {
        const ox = Math.round(r.x0 * b.B);
        const oy = Math.round(r.y0 * b.B);
        b.ras.couleur.getContext("2d").putImageData(r.couleur, ox, oy);
        b.ras.ombre.getContext("2d").putImageData(r.ombre, ox, oy);
        b.ras.lumiere.getContext("2d").putImageData(r.lumiere, ox, oy);
        const zr = { x0: r.x0, y0: r.y0, x1: r.x0 + r.l, y1: r.y0 + r.h };
        b.perime = b.perime.filter((p) => !dedans(p, zr));
      } else ras = calquesDe(r, false);
    }
    const ctx = b.toile.getContext("2d");
    ctx.setTransform(b.B, 0, 0, b.B, 0, 0);
    this.peint.peindre(ctx, z, b.B, ras);
  }

  // Repeindre une zone du fond de base : sur place si les calques gardés sont bons, sinon par les workers (les zones
  // demandées pendant un calcul se regroupent : un trait de pinceau ne s'empile pas).
  repeindreBase(z) {
    const b = this.base;
    const gen = this.generationPeinte;
    const morceaux = [];
    for (let y = z.y0; y < z.y1; y += BLOC) for (let x = z.x0; x < z.x1; x += BLOC) morceaux.push({ x0: x, y0: y, x1: Math.min(z.x1, x + BLOC), y1: Math.min(z.y1, y + BLOC) });
    for (const m of morceaux) {
      if (b.ras && !b.perime.some((p) => croise(p, m))) this.travail(() => gen === this.generationPeinte && this.peindreBaseZone(m, null));
      else b.attente.push(m);
    }
    this.lancerBase();
  }

  lancerBase() {
    const b = this.base;
    if (b.enCours || !b.attente.length) return;
    const gen = this.generationPeinte;
    const zones = fusionnerZones(b.attente);
    b.attente = [];
    b.enCours = zones.length;
    for (const z of zones) {
      this.moteurPeint.raster(z, b.B, { priorite: -1e4 }).then((r) => {
        if (gen !== this.generationPeinte || this.detruite) return;
        const fin = () => {
          b.enCours--;
          this.lancerBase();
        };
        if (!r) return fin();
        this.travail(() => {
          if (gen === this.generationPeinte) this.peindreBaseZone(z, r);
          fin();
        });
      });
    }
  }

  // Une tuile du style peint : son raster est demandé ; elle se peint (et s'affiche) quand il arrive.
  demanderTuilePeinte(l, ix, iy) {
    const S = this.base.B * 2 ** l;
    const c = TUILE / S;
    const m = DEBORD / S;
    const zone = { x0: ix * c - m, y0: iy * c - m, x1: (ix + 1) * c + m, y1: (iy + 1) * c + m };
    const Rr = Math.min(S, this.rasterMax());
    const cle = `${l}:${ix}:${iy}`;
    const gen = this.generationPeinte;
    this.tuilesEnCours.set(cle, gen);
    const vivant = () => gen === this.generationPeinte && !this.enSommeil && this.tuilesEnCours.get(cle) === gen && Boolean(this.voulues && this.voulues.has(cle));
    const cx = this.cam.x;
    const cy = this.cam.y;
    const priorite = Math.hypot((zone.x0 + zone.x1) / 2 - cx, (zone.y0 + zone.y1) / 2 - cy) / c - 1e3;
    // Un raster un peu plus large que la tuile : agrandi, son bord ne se voit pas.
    const marge = 2 / Rr;
    this.moteurPeint.raster({ x0: zone.x0 - marge, y0: zone.y0 - marge, x1: zone.x1 + marge, y1: zone.y1 + marge }, Rr, { priorite, vivant }).then((r) => {
      if (this.tuilesEnCours.get(cle) !== gen) return;
      if (!r || gen !== this.generationPeinte) {
        this.tuilesEnCours.delete(cle);
        this.demander();
        return;
      }
      this.travail(() => {
        if (this.tuilesEnCours.get(cle) !== gen) return;
        this.tuilesEnCours.delete(cle);
        const toile = document.createElement("canvas");
        toile.width = toile.height = TUILE + 2 * DEBORD;
        const ctx = toile.getContext("2d");
        ctx.setTransform(S, 0, 0, S, DEBORD - ix * TUILE, DEBORD - iy * TUILE);
        const garder = this.optionsPeint.garderRaster !== false;
        const ras = calquesDe(r, garder);
        this.peint.peindre(ctx, zone, S, ras);
        this.rangerTuile(cle, { toile, ...zone, l, ix, iy, S, Rr, vu: this.image, neuve: true, ras: garder ? ras : null, perime: [] });
      });
    });
  }

  // Repeindre une zone d'une tuile existante, sur place ; elle garde son image d'avant jusqu'à l'arrivée du raster.
  // trait : coup de pinceau en cours, un raster plus grossier suffit en attendant la fin du trait.
  repeindreTuile(cle, t, z, trait) {
    const gen = this.generationPeinte;
    const zt = inter(z, t);
    if (zt.x1 <= zt.x0 || zt.y1 <= zt.y0) return;
    // zone : celle de cet appel, ou, quand un raster arrive, toute la zone qu'il couvre (les demandes faites pendant
    // son calcul s'y sont ajoutées : elles ne sont peintes nulle part ailleurs).
    const peindre = (ras, zone) => {
      if (gen !== this.generationPeinte || this.tuiles.get(cle) !== t) return;
      const ctx = t.toile.getContext("2d");
      ctx.setTransform(t.S, 0, 0, t.S, DEBORD - t.ix * TUILE, DEBORD - t.iy * TUILE);
      this.peint.peindre(ctx, zone, t.S, ras);
      t.neuve = true;
    };
    if (t.ras && !t.perime.some((p) => croise(p, zt))) {
      this.travail(() => peindre(t.ras, zt));
      return;
    }
    t.attente = t.attente ? { x0: Math.min(t.attente.x0, zt.x0), y0: Math.min(t.attente.y0, zt.y0), x1: Math.max(t.attente.x1, zt.x1), y1: Math.max(t.attente.y1, zt.y1) } : zt;
    t.trait = trait;
    if (t.enCours) return;
    const lancer = () => {
      const za = t.attente;
      const grossier = t.trait;
      t.attente = null;
      if (!za) return;
      t.enCours = true;
      const Rr = grossier ? Math.min(t.Rr, 16) : t.Rr;
      const marge = 2 / Rr;
      this.moteurPeint.raster({ x0: za.x0 - marge, y0: za.y0 - marge, x1: za.x1 + marge, y1: za.y1 + marge }, Rr, { priorite: -5e3 }).then((r) => {
        t.enCours = false;
        if (!r) return lancer();
        this.travail(() => {
          if (t.ras && !grossier) {
            // Le raster de la zone remplace sa part des calques gardés.
            const ox = Math.round((r.x0 - t.ras.x0) * Rr);
            const oy = Math.round((r.y0 - t.ras.y0) * Rr);
            t.ras.couleur.getContext("2d").putImageData(r.couleur, ox, oy);
            t.ras.ombre.getContext("2d").putImageData(r.ombre, ox, oy);
            t.ras.lumiere.getContext("2d").putImageData(r.lumiere, ox, oy);
            t.perime = t.perime.filter((p) => !dedans(inter(p, t), za));
            peindre(t.ras, za);
          } else peindre(calquesDe(r, false), za);
          lancer();
        });
      });
    };
    lancer();
  }

  // Ce qui a changé (terrain, tracés, lieux, habillage) se repeint : fond de base et tuiles visibles sur place, les
  // autres tuiles touchées sont oubliées. z : la zone signalée par l'appelant (ou null : seulement ce qui a changé).
  // options.refaire : la fin d'un trait de pinceau ; voir plus bas.
  rafraichirZonePeinte(z, options = {}) {
    const { w, h } = this.champs;
    const zones = z ? [z] : [];
    const terrain = this.moteurPeint.synchroniser();
    if (terrain) {
      if (this.base.ras) this.base.perime.push(terrain);
      for (const t of this.tuiles.values()) if (croise(t, terrain)) (t.perime ||= []).push(terrain);
      this.terrainEnAttente = this.terrainEnAttente
        ? { x0: Math.min(this.terrainEnAttente.x0, terrain.x0), y0: Math.min(this.terrainEnAttente.y0, terrain.y0), x1: Math.max(this.terrainEnAttente.x1, terrain.x1), y1: Math.max(this.terrainEnAttente.y1, terrain.y1) }
        : terrain;
      this.peint.oublierArbres(terrain);
    }
    // À la fin d'un trait, toute sa boîte (la zone donnée et le terrain changé autour) repart des workers, fond de base
    // et tuiles : rien ne s'y repeint d'après des calques gardés, qu'un morceau repeint pendant le trait a pu laisser
    // en retard. Aucun bloc ne garde ainsi l'ancien terrain.
    if (options.refaire) {
      for (const b of [z, this.terrainEnAttente]) {
        if (!b) continue;
        if (this.base.ras) this.base.perime.push(b);
        for (const t of this.tuiles.values()) if (croise(t, b)) (t.perime ||= []).push(b);
      }
    }
    // Les champs cultivés suivent le terrain à la fin du trait seulement.
    if (!options.trait && this.terrainEnAttente) {
      zones.push(this.terrainEnAttente, ...this.peint.majTerrain(this.terrainEnAttente));
      this.terrainEnAttente = null;
    }
    zones.push(...this.peint.synchroniser());
    const bornees = fusionnerZones(zones.map((x) => ({
      x0: Math.max(0, Math.floor(x.x0)), y0: Math.max(0, Math.floor(x.y0)), x1: Math.min(w, Math.ceil(x.x1)), y1: Math.min(h, Math.ceil(x.y1)),
    })).filter((x) => x.x1 > x.x0 && x.y1 > x.y0));
    if (!bornees.length) return;
    const visible = this.zoneVisible();
    for (const zone of bornees) {
      if (!options.tuilesSeules) this.repeindreBase(zone);
      for (const [cle, t] of [...this.tuiles]) {
        if (!croise(t, zone)) continue;
        if (t.l === this.niveau() && croise(t, visible)) this.repeindreTuile(cle, t, zone, options.trait);
        else {
          this.libererTuile(t);
          this.tuiles.delete(cle);
        }
      }
    }
    this.demander();
  }

  // Le fond de base tel que le verra la TV, d'après la carte publique (la sortie du serveur pour la table) : peint ici,
  // sur un vrai ordinateur, il épargne à la TV le calcul du relief. Rien si le terrain n'est plus celui de l'écran.
  async fondPourTable(json) {
    if (!this.peint || !json || !json.terrain) return null;
    const carte = decoderCarte(json);
    const { w, h } = this.champs;
    if (carte.largeur !== w || carte.hauteur !== h || (carte.graine | 0) !== (this.carte.graine | 0) || !memesOctets(carte.terrain, this.carte.terrain)) return null;
    this.rafraichirZonePeinte(null);
    const lieux = json.lieux || {};
    for (const l of Object.values(lieux)) l.connu = true;
    const fond = new FondPeint(carte, this.champs, lieux, { moteur: this.moteurPeint, joueurs: true, publiques: true });
    const B = this.echelleBase();
    const toile = document.createElement("canvas");
    toile.width = w * B;
    toile.height = h * B;
    const ctx = toile.getContext("2d");
    const b = this.base;
    const gen = this.generationPeinte;
    const travaux = [];
    for (let y = 0; y < h; y += BLOC) {
      for (let x = 0; x < w; x += BLOC) {
        const z = { x0: x, y0: y, x1: Math.min(w, x + BLOC), y1: Math.min(h, y + BLOC) };
        const garde = b.B === B && b.ras && !b.perime.some((p) => croise(p, z));
        const ras = garde ? Promise.resolve(null) : this.moteurPeint.raster(z, B, { priorite: 1e5 });
        travaux.push(ras.then((r) => new Promise((ok) => {
          if (!garde && !r) return ok(false);
          this.travail(() => {
            ctx.setTransform(B, 0, 0, B, 0, 0);
            fond.peindre(ctx, z, B, garde ? b.ras : calquesDe(r, false));
            ok(true);
          });
        })));
      }
    }
    const faits = await Promise.all(travaux);
    if (gen !== this.generationPeinte || faits.includes(false)) return null;
    return new Promise((ok) => toile.toBlob(ok, "image/png"));
  }

  async exporterPeint(echelle, joueurs) {
    const { w, h } = this.champs;
    const fond = this.fondPeintPour(joueurs);
    const toile = document.createElement("canvas");
    toile.width = w * echelle;
    toile.height = h * echelle;
    const ctx = toile.getContext("2d");
    const travaux = [];
    for (let y = 0; y < h; y += BLOC) {
      for (let x = 0; x < w; x += BLOC) {
        const z = { x0: x, y0: y, x1: Math.min(w, x + BLOC), y1: Math.min(h, y + BLOC) };
        travaux.push(this.moteurPeint.raster(z, echelle, { priorite: -1e5 }).then((r) => {
          if (!r) throw new Error("calcul interrompu");
          ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
          fond.peindre(ctx, z, echelle, calquesDe(r, false));
        }));
      }
    }
    await Promise.all(travaux);
    const zone = { x0: 0, y0: 0, x1: w, y1: h };
    ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
    dessinerDessusPeint(ctx, this.carte, this.lieux, this.champs, zone, { joueurs, texture: this.texture, rapide: false, complet: true });
    return new Promise((ok) => toile.toBlob(ok, "image/png"));
  }
}
