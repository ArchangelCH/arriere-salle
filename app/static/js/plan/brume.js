// La brume d'un plan (plan.brume, une valeur par case : 0 rien, 1 voile, 2 épaisse), à ne pas confondre avec le
// brouillard (les cases cachées aux joueurs). Elle se peint sur son propre calque : une toile posée sur celle du plan,
// peinte en basse définition (la brume est floue, le navigateur l'agrandit), si bien que le plan ne se repeint jamais
// pour elle. Ses bords sont fondus une fois pour toutes (deux masques floutés, refaits quand la brume change) ; elle
// dérive par deux textures de bruit calculées une fois, à peu d'images par seconde. Importé par table.js (la TV) : rien
// de plus récent que Chromium 79.

import { brumeVue, hache } from "./modele.js";
import { silhouette } from "./figurine.js";
import { pionMontre, trouerPrenom } from "./rendu.js";

// L'atelier peint la brume à la moitié de ses pixels d'écran, la TV au quart (mesuré processeur ralenti 6 fois : un
// quart du fil principal de la TV pendant la dérive au tiers, 30 % de moins au quart, même aspect) ; la dérive est lente,
// 12 images par seconde y suffisent. Sur la TV, une brume qui change se fond dans la nouvelle en deux secondes.
export const BRUME_ATELIER = { echelle: 0.5, images: 20, fondu: 0 };
export const BRUME_TV = { echelle: 1 / 4, images: 12, fondu: 2000 };

const TEXTURE = 128; // côté des textures de bruit, en pixels (elles se répètent sans couture)
// Deux teintes (plan.brume_teinte) : la brume, blanc-gris légèrement bleuté, et la fumée d'un incendie, gris de suie.
// couleur : le voile ; clair et sombre : les traînées qui passent dessus ; voile : son opacité (les trouées l'allègent
// par endroits) ; epaisse : celle de la brume épaisse, posée sur le voile (le sol ne se voit plus).
const TEINTES = {
  brume: { couleur: [204, 212, 223], clair: [244, 248, 255], sombre: [150, 160, 178], voile: 0.46, epaisse: 0.9 },
  fumee: { couleur: [78, 72, 67], clair: [128, 120, 110], sombre: [30, 27, 25], voile: 0.5, epaisse: 0.9 },
};
export const teinteBrume = (p) => (p && p.brume_teinte === "fumee" ? "fumee" : "brume");
const PALE = 0.5; // dans l'atelier, vue du MJ : le calque entier, pour voir ce qu'on édite
// Sous un pion vu, la brume s'éclaircit : un héros dans l'épaisse reste visible, un peu estompé ; le MJ voit tout net.
const ECLAIRCIE = { heros: 0.7, autre: 0.5, mj: 0.85 };
// La dérive, en cases par milliseconde, et la taille d'une tuile de texture, en cases (deux tailles sans commune mesure :
// la répétition des tuiles ne se voit pas).
const TROUEES = { cases: 16, vx: 0.00021, vy: 0.00006 };
const NUANCES = { cases: 23, vx: -0.00012, vy: 0.00008 };

const lisse = (t) => t * t * (3 - 2 * t);
const entre = (a, b, v) => lisse(Math.min(1, Math.max(0, (v - a) / (b - a))));

function toile(l, h) {
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return c;
}

// Un bruit de valeurs qui se répète sans couture (quatre octaves), de 0 à 1.
function bruit(graine) {
  const v = new Float32Array(TEXTURE * TEXTURE);
  let amplitude = 1;
  let somme = 0;
  for (let o = 0; o < 4; o++) {
    const n = 4 << o; // cellules par côté : 4, 8, 16, 32
    const c = TEXTURE / n;
    const g = (i, j) => hache(i % n, j % n, graine + o);
    for (let y = 0; y < TEXTURE; y++) {
      const j = Math.floor(y / c);
      const fy = lisse(y / c - j);
      for (let x = 0; x < TEXTURE; x++) {
        const i = Math.floor(x / c);
        const fx = lisse(x / c - i);
        const a = g(i, j);
        const b = g(i + 1, j);
        const d = g(i, j + 1);
        const e = g(i + 1, j + 1);
        v[y * TEXTURE + x] += amplitude * (a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy);
      }
    }
    somme += amplitude;
    amplitude *= 0.55;
  }
  for (let k = 0; k < v.length; k++) v[k] /= somme;
  return v;
}

// Une texture d'après le bruit : chaque pixel reçoit une couleur et une opacité (teinte(v) → [r, g, b, a de 0 à 1]).
// Le feu (feu.js) s'en sert aussi, pour ses braises et sa fumée.
export function texture(graine, teinte) {
  const v = bruit(graine);
  const c = toile(TEXTURE, TEXTURE);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(TEXTURE, TEXTURE);
  for (let k = 0; k < v.length; k++) {
    const [r, g, b, a] = teinte(v[k]);
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = g;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Les textures, calculées une seule fois pour toute la page : les trouées qui allègent le voile, les nuances (traînées
// plus claires et plus sombres) qui passent sur toute la brume, une par teinte.
let textures = null;
function lesTextures() {
  if (!textures) {
    const nuances = (t) => texture(53, (v) => (v > 0.5 ? [...t.clair, 0.5 * entre(0.52, 0.8, v)] : [...t.sombre, 0.42 * entre(0.48, 0.2, v)]));
    textures = { trouees: texture(17, (v) => [0, 0, 0, 0.55 * entre(0.4, 0.78, v)]), nuances: nuances(TEINTES.brume), nuancesFumee: nuances(TEINTES.fumee) };
  }
  return textures;
}

function lesMotifs(ctx) {
  const t = lesTextures();
  return { trouees: ctx.createPattern(t.trouees, "repeat"), nuances: ctx.createPattern(t.nuances, "repeat"), nuancesFumee: ctx.createPattern(t.nuancesFumee, "repeat") };
}

// Flou en boîte, trois passes dans chaque sens (presque un flou gaussien) ; hors du tableau, rien.
function passer(v, debut, pas, longueur, r, t) {
  const n = 2 * r + 1;
  let s = 0;
  for (let i = 0; i < Math.min(r, longueur); i++) s += v[debut + i * pas];
  for (let i = 0; i < longueur; i++) {
    if (i + r < longueur) s += v[debut + (i + r) * pas];
    t[i] = s / n;
    if (i - r >= 0) s -= v[debut + (i - r) * pas];
  }
  for (let i = 0; i < longueur; i++) v[debut + i * pas] = t[i];
}

export function flouter(v, l, h, r) {
  const t = new Float32Array(Math.max(l, h));
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < h; y++) passer(v, y * l, 1, l, r, t);
    for (let x = 0; x < l; x++) passer(v, x, l, h, r, t);
  }
}

// Un bruit de valeurs sur la grille du masque (l × h pixels, K par case, marge m), qui ne se répète pas : deux octaves,
// des cellules de 2,4 et 1,1 cases. Les valeurs des nœuds se calculent une fois, chaque pixel les mélange.
function bruitPlan(l, h, K, m) {
  const v = new Float32Array(l * h);
  for (const [cellule, poids, graine] of [[2.4, 0.65, 71], [1.1, 0.35, 89]]) {
    const pas = cellule * K;
    const nl = Math.ceil(l / pas) + 2;
    const nh = Math.ceil(h / pas) + 2;
    const noeuds = new Float32Array(nl * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nl; i++) noeuds[j * nl + i] = hache(i, j, graine);
    for (let y = 0; y < h; y++) {
      const gy = (y - m) / pas + 1;
      const j = Math.floor(gy);
      const fy = lisse(gy - j);
      for (let x = 0; x < l; x++) {
        const gx = (x - m) / pas + 1;
        const i = Math.floor(gx);
        const fx = lisse(gx - i);
        const a = noeuds[j * nl + i];
        const b = noeuds[j * nl + i + 1];
        const c = noeuds[(j + 1) * nl + i];
        const d = noeuds[(j + 1) * nl + i + 1];
        v[y * l + x] += poids * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      }
    }
  }
  return v;
}

function toileAlpha(v, l, h, couleur) {
  const c = toile(l, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(l, h);
  for (let k = 0; k < v.length; k++) {
    img.data[k * 4] = couleur[0];
    img.data[k * 4 + 1] = couleur[1];
    img.data[k * 4 + 2] = couleur[2];
    img.data[k * 4 + 3] = Math.round(255 * Math.min(1, v[k]));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// La signature d'une brume (celle que montre la vue, brumeVue) : vide sans brume.
const signatureBrume = (p, b) => (Array.isArray(b) && b.some((v) => v) ? `${p.largeur}x${p.hauteur}:${teinteBrume(p)}:${b.join("")}` : "");

// Les deux masques de la brume (tout ce qui est embrumé ; l'épaisse seule), K pixels par case, floutés : aucun bord de
// case ne se voit. Une marge autour du plan laisse le flou s'éteindre au-delà du bord. null : pas de brume.
// b : la brume à peindre, celle du plan par défaut (pour les joueurs : brumeVue, les seules cases révélées).
export function masquesBrume(p, b = p.brume) {
  const w = p.largeur;
  const h = p.hauteur;
  if (!Array.isArray(b) || b.length !== w * h) return null;
  // Six pixels par case au plus : le masque est flou, et le refaire reste court sur la TV (étang, 44 × 32 cases : 50 ms
  // processeur ralenti 6 fois).
  const K = Math.max(3, Math.min(6, Math.floor(480 / Math.max(w, h))));
  // Trois passes de rayon r : un flou d'environ r + 0,5 pixels, ici 0,6 à 0,8 case.
  const r = Math.max(2, Math.round(K * 0.6));
  const m = 3 * r;
  const l = w * K + 2 * m;
  const hh = h * K + 2 * m;
  const tout = new Float32Array(l * hh);
  const epaisse = new Float32Array(l * hh);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let epais = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = b[y * w + x];
      if (v !== 1 && v !== 2) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      if (v === 2) epais = true;
      for (let j = 0; j < K; j++) {
        const ligne = (m + y * K + j) * l + m + x * K;
        for (let i = 0; i < K; i++) {
          tout[ligne + i] = 1;
          if (v === 2) epaisse[ligne + i] = 1;
        }
      }
    }
  }
  if (x1 < 0) return null;
  flouter(tout, l, hh, r);
  if (epais) flouter(epaisse, l, hh, r);
  // Des bords irréguliers, fixés une fois pour toutes : un bruit, en cases, décale le seuil où la brume s'éteint ; le
  // cœur reste plein, un coup de pinceau d'une seule case reste visible.
  const bords = bruitPlan(l, hh, K, m);
  for (const v of epais ? [tout, epaisse] : [tout]) {
    for (let k = 0; k < v.length; k++) if (v[k] > 0.001) v[k] = entre(0.12, 0.62, v[k] + 0.5 * (bords[k] - 0.5));
  }
  // La boîte de la brume, en cases, flou compris.
  const marge = m / K + 0.5;
  const teinte = teinteBrume(p);
  const couleur = TEINTES[teinte].couleur;
  return {
    tout: toileAlpha(tout, l, hh, couleur), epaisse: epais ? toileAlpha(epaisse, l, hh, couleur) : null, K, m, teinte,
    boite: { x0: x0 - marge, y0: y0 - marge, x1: x1 + 1 + marge, y1: y1 + 1 + marge },
  };
}

function croiser(a, b) {
  const z = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return z.x1 > z.x0 && z.y1 > z.y0 ? z : null;
}

function poserMasque(ctx, masque, c, boite) {
  // Seule la part du masque qui tombe dans la boîte se peint.
  const { K, m } = masque;
  const sx = Math.max(0, Math.floor((boite.x0 * K) + m));
  const sy = Math.max(0, Math.floor((boite.y0 * K) + m));
  const sl = Math.min(c.width, Math.ceil((boite.x1 * K) + m)) - sx;
  const sh = Math.min(c.height, Math.ceil((boite.y1 * K) + m)) - sy;
  if (sl > 0 && sh > 0) ctx.drawImage(c, sx, sy, sl, sh, (sx - m) / K, (sy - m) / K, sl / K, sh / K);
}

function poserMotif(ctx, motif, d, t, boite) {
  // Le motif se répète tous les d.cases cases et glisse avec le temps.
  const k = d.cases / TEXTURE;
  const ox = (((t * d.vx) % d.cases) + d.cases) % d.cases;
  const oy = (((t * d.vy) % d.cases) + d.cases) % d.cases;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.fillStyle = motif;
  ctx.fillRect((boite.x0 - ox) / k, (boite.y0 - oy) / k, (boite.x1 - boite.x0) / k, (boite.y1 - boite.y0) / k);
  ctx.restore();
}

function eclaircir(ctx, t, force) {
  // Un ovale haut, de la tête de la figurine jusqu'à son prénom sous le socle.
  const r = 0.42 * (t.taille || 1);
  const s = silhouette(r);
  ctx.save();
  ctx.translate(t.x, t.y + (s.haut + s.bas) / 2 + r * 0.22);
  ctx.scale(1, 1.7);
  const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.5);
  g.addColorStop(0, `rgba(0,0,0,${force})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 3);
  ctx.restore();
}

// La brume du moment, en coordonnées du plan, sur une toile vide : le voile, ses trouées qui dérivent, l'épaisse
// par-dessus, des traînées plus claires et plus sombres qui dérivent dans l'autre sens, puis une éclaircie sous chaque
// pion vu.
// m : les masques (masquesBrume) ; zone : ce qui est à l'écran, en cases ; t : l'heure de la dérive ; prenoms : sur la
// TV, les prénoms écrits sous les pions, que la brume laisse lisibles.
export function composerBrume(ctx, m, zone, t, pions, joueurs, motifs, prenoms) {
  const boite = croiser(zone, m.boite);
  if (!boite) return;
  const teinte = TEINTES[m.teinte] || TEINTES.brume;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = teinte.voile;
  poserMasque(ctx, m, m.tout, boite);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  poserMotif(ctx, motifs.trouees, TROUEES, t, boite);
  if (m.epaisse) {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = teinte.epaisse;
    poserMasque(ctx, m, m.epaisse, boite);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-atop";
  poserMotif(ctx, m.teinte === "fumee" ? motifs.nuancesFumee : motifs.nuances, NUANCES, t, boite);
  ctx.globalCompositeOperation = "destination-out";
  for (const p of pions) {
    const r = 0.7 * (p.taille || 1);
    if (p.x + r < boite.x0 || p.x - r > boite.x1 || p.y + 2 * r < boite.y0 || p.y - r > boite.y1) continue;
    eclaircir(ctx, p, !joueurs ? ECLAIRCIE.mj : p.genre === "heros" ? ECLAIRCIE.heros : ECLAIRCIE.autre);
  }
  for (const n of prenoms || []) trouerPrenom(ctx, n.boite);
  ctx.globalCompositeOperation = "source-over";
}

// Deux masques en fondu (TV : la brume qui change) : l'ancien s'efface pendant que le nouveau vient, sur une toile à part,
// en addition (là où rien ne change, la brume ne baisse pas pendant le fondu).
function fondre(avant, apres, k, toiles) {
  const ref = apres || avant;
  const l = ref.tout.width;
  const h = ref.tout.height;
  const boite = avant && apres
    ? { x0: Math.min(avant.boite.x0, apres.boite.x0), y0: Math.min(avant.boite.y0, apres.boite.y0), x1: Math.max(avant.boite.x1, apres.boite.x1), y1: Math.max(avant.boite.y1, apres.boite.y1) }
    : ref.boite;
  const mel = { K: ref.K, m: ref.m, boite, tout: null, epaisse: null, teinte: ref.teinte };
  for (const cle of ["tout", "epaisse"]) {
    if (!(avant && avant[cle]) && !(apres && apres[cle])) continue;
    const c = toiles[cle] && toiles[cle].width === l && toiles[cle].height === h ? toiles[cle] : (toiles[cle] = toile(l, h));
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, l, h);
    if (avant && avant[cle]) {
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(avant[cle], 0, 0);
    }
    if (apres && apres[cle]) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = k;
      ctx.drawImage(apres[cle], 0, 0);
    }
    mel[cle] = c;
  }
  return mel;
}

// Un masque qui ne sert plus rend sa mémoire tout de suite (une toile ramenée à zéro).
function liberer(m) {
  if (m) for (const cle of ["tout", "epaisse"]) if (m[cle]) m[cle].width = 0;
}

// Deux masques sont-ils de même forme (même plan, même taille) ? Sinon, pas de fondu : on passe de l'un à l'autre.
const memeGrille = (a, b) => a && b && a.K === b.K && a.m === b.m && a.tout.width === b.tout.width && a.tout.height === b.tout.height;

export class CalqueBrume {
  // toile : le canvas du calque, posé sur celui du plan ; vue : la VuePlan (caméra, plan, pions dessinés).
  constructor(toileCalque, vue, reglages = BRUME_ATELIER) {
    this.toile = toileCalque;
    this.ctx = toileCalque.getContext("2d");
    this.vue = vue;
    this.reglages = reglages;
    this.masque = null;
    this.signature = "";
    this.avant = null; // pendant un fondu : { masque, t0 }
    this.toilesFondu = {};
    this.aRelire = null; // le plan à relire à la prochaine image : { plan, fondu }
    this.joueurs = null; // la vue du masque : joueurs, la brume des seules cases révélées
    this.pale = null;
    this.vide = true; // rien n'est peint sur le calque
    this.minuterie = 0;
    this.raf = 0;
    // Mouvements réduits (réglage du système) : la brume reste immobile.
    this.immobile = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.redimensionner();
  }

  redimensionner() {
    const v = this.vue;
    const l = Math.max(1, Math.round((v.lw || 1) * this.reglages.echelle));
    const h = Math.max(1, Math.round((v.lh || 1) * this.reglages.echelle));
    if (this.toile.width !== l || this.toile.height !== h) {
      this.toile.width = l;
      this.toile.height = h;
      this.vide = true;
    }
  }

  // Le plan chargé, ou sa brume changée : relue à la prochaine image, tout de suite (une seule fois par image pendant
  // un coup de pinceau). fondu : même plan qu'avant, l'ancienne brume se fond dans la nouvelle (TV).
  charger(plan, fondu = false) {
    this.aRelire = { plan, fondu: fondu || !!(this.aRelire && this.aRelire.fondu) };
    clearTimeout(this.minuterie);
    this.minuterie = 0;
    this.planifier(0);
  }

  // Le brouillard a pu changer (une pièce révélée dans l'éditeur) : en vue joueurs, la brume montrée se relit à la
  // prochaine image ; rien ne se refait si elle reste la même.
  verifier() {
    if (!this.aRelire && this.vue.plan) this.aRelire = { plan: this.vue.plan, fondu: false };
    this.planifier(0);
  }

  relire() {
    const { plan, fondu } = this.aRelire;
    this.aRelire = null;
    // La brume de la vue : pour les joueurs, celle des seules cases révélées, comme sur la TV.
    this.joueurs = !!this.vue.joueurs;
    const b = brumeVue(plan, this.joueurs);
    const sig = signatureBrume(plan, b);
    if (sig === this.signature) return;
    this.signature = sig;
    const neuf = sig ? masquesBrume(plan, b) : null;
    const t = performance.now();
    // Pendant un fondu, l'ancienne brume est celle qui est à l'écran : le mélange, copié (ses toiles vont resservir) ;
    // les deux masques qu'il mêlait ne servent plus.
    const ecran = this.masqueDuMoment(t);
    const ancien = ecran && ecran !== this.masque ? this.copier(ecran) : ecran;
    if (ancien !== this.masque) {
      liberer(this.avant && this.avant.masque);
      liberer(this.masque);
    }
    const enFondu = fondu && this.reglages.fondu && (ancien || neuf) && (!ancien || !neuf || memeGrille(ancien, neuf));
    if (!enFondu) liberer(ancien);
    this.avant = enFondu ? { masque: ancien, t0: t } : null;
    this.masque = neuf;
  }

  copier(m) {
    const c = { ...m };
    for (const cle of ["tout", "epaisse"]) {
      if (!m[cle]) continue;
      c[cle] = toile(m[cle].width, m[cle].height);
      c[cle].getContext("2d").drawImage(m[cle], 0, 0);
    }
    return c;
  }

  // Le masque à peindre maintenant : le nouveau, ou le mélange des deux pendant un fondu.
  masqueDuMoment(t) {
    const a = this.avant;
    if (!a) return this.masque;
    const k = (t - a.t0) / this.reglages.fondu;
    if (k >= 1) {
      liberer(a.masque);
      this.avant = null;
      return this.masque;
    }
    return fondre(a.masque, this.masque, lisse(Math.max(0, k)), this.toilesFondu);
  }

  // Le plan a-t-il de la brume (à l'écran ou non : en vue joueurs, celle d'une zone cachée ne se peint pas) ?
  aDeLaBrume() {
    const p = (this.aRelire && this.aRelire.plan) || this.vue.plan;
    return !!(this.masque || this.avant || (p && Array.isArray(p.brume) && p.brume.some((v) => v)));
  }

  // Les pions sous lesquels la brume s'éclaircit : ceux que la vue montre (joueurs : ni embuscade, ni adversaire perdu
  // dans l'épaisse), à la place où ils sont dessinés (un pion qui glisse est suivi).
  pions(joueurs) {
    const v = this.vue;
    return (v.pionsDessines || v.plan.pions || []).filter((t) => pionMontre(v.plan, t, joueurs));
  }

  // Une image du calque : avec la caméra du plan (appelé par la vue à chaque image du plan), ou seule, pour la dérive.
  dessiner() {
    const v = this.vue;
    clearTimeout(this.minuterie);
    this.minuterie = 0;
    if (!v.plan || v.detruite || v.enSommeil) return this.arreter();
    // Vue du MJ ou des joueurs changée : la brume n'est pas la même (les cases cachées).
    if (!this.aRelire && !!v.joueurs !== this.joueurs) this.aRelire = { plan: v.plan, fondu: false };
    if (this.aRelire) this.relire();
    const t = performance.now();
    const m = this.masqueDuMoment(t);
    const pale = v.mj && !v.joueurs;
    if (pale !== this.pale) {
      this.pale = pale;
      this.toile.style.opacity = pale ? String(PALE) : "";
    }
    const ctx = this.ctx;
    if (!this.vide) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.toile.width, this.toile.height);
      this.vide = true;
    }
    if (!m) return;
    const s = this.toile.width / Math.max(1, v.lw);
    const { x, y, z } = v.cam;
    ctx.setTransform(z * s, 0, 0, z * s, (v.lw / 2 - x * z) * s, (v.lh / 2 - y * z) * s);
    ctx.imageSmoothingEnabled = true;
    // Les prénoms écrits sur la TV et les barres des héros : la brume les laisse lisibles.
    const trous = (v.prenomsTv || []).concat(v.barresDessinees || []);
    composerBrume(ctx, m, v.zoneVisible(), this.immobile ? 0 : t, this.pions(v.joueurs), v.joueurs, this.motifs(), trous);
    this.vide = false;
    // La dérive (ou le fondu) continue : la prochaine image, au rythme du calque.
    if (!this.immobile || this.avant) this.planifier(1000 / this.reglages.images);
  }

  motifs() {
    if (!this.motifsCtx) this.motifsCtx = lesMotifs(this.ctx);
    return this.motifsCtx;
  }

  planifier(delai) {
    if (this.minuterie || this.raf) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = 0;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.dessiner();
      });
    }, delai);
  }

  // Plan caché ou quitté : plus rien ne tourne. La prochaine image du plan relance la dérive.
  arreter() {
    clearTimeout(this.minuterie);
    cancelAnimationFrame(this.raf);
    this.minuterie = 0;
    this.raf = 0;
  }

  detruire() {
    this.arreter();
    liberer(this.masque);
    liberer(this.avant && this.avant.masque);
    liberer(this.toilesFondu);
    this.masque = null;
    this.avant = null;
    this.toile.width = 0;
  }

  // L'image exportée (PNG) : la brume du moment peinte sur le plan entier, à part puis posée dessus. Celle des joueurs ne
  // couvre que les cases révélées : son masque est fait pour l'export quand la vue à l'écran est l'autre.
  exporter(ctx, l, h, joueurs) {
    if (this.aRelire) this.relire();
    const v = this.vue;
    const b = brumeVue(v.plan, joueurs);
    const sig = signatureBrume(v.plan, b);
    if (!sig) return;
    const m = sig === this.signature && this.masque ? this.masque : masquesBrume(v.plan, b);
    if (!m) return;
    const K = Math.max(4, Math.min(16, Math.floor(4096 / Math.max(v.plan.largeur, v.plan.hauteur))));
    const c = toile(v.plan.largeur * K, v.plan.hauteur * K);
    const g = c.getContext("2d");
    g.setTransform(K, 0, 0, K, 0, 0);
    const motifs = lesMotifs(g);
    const zone = { x0: 0, y0: 0, x1: v.plan.largeur, y1: v.plan.hauteur };
    composerBrume(g, m, zone, this.immobile ? 0 : performance.now(), (v.plan.pions || []).filter((p) => pionMontre(v.plan, p, joueurs)), joueurs, motifs);
    ctx.save();
    ctx.globalAlpha = joueurs ? 1 : PALE;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, l, h);
    ctx.restore();
    c.width = 0;
    if (m !== this.masque) liberer(m);
  }
}
