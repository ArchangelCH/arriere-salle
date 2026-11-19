// Le feu d'un plan (plan.feu, une valeur par case : 0 rien, 1 braises, 2 flammes, 3 brasier, 4 calciné), que les
// joueurs voient comme la brume (brume.js) : sur son propre calque, posé sur celui du plan, qui ne se repeint donc pas à
// chaque image. Ce qui bouge lentement (la suie, la fumée, la lueur qui ne passe pas les murs, le lit de braises) tient
// dans de petites cartes floues, calculées une fois par feu, qu'un bruit qui glisse anime à chaque image ; viennent
// ensuite les flammes, de petites images calculées une fois pour toute la page et posées case par case, puis les
// escarbilles qui montent. La lumière que l'incendie jette sur la pièce est peinte avec le plan (style peint :
// lumieresDuFeu, peint.js). Importé par table.js (la TV) : rien de plus récent que Chromium 79.

import { flouter, texture } from "./brume.js";
import { CALCINE, feuVue, hache } from "./modele.js";
import { silhouette } from "./figurine.js";
import { pionMontre, trouerPrenom } from "./rendu.js";

// L'atelier peint le calque aux trois quarts de ses pixels d'écran, la TV au tiers (le feu est doux, le navigateur
// l'agrandit ; mesuré processeur ralenti 6 fois, une plus grande toile coûte surtout en dessin) ; les flammes dansent à
// 24 images par seconde dans l'atelier, à 12 sur la TV, où un feu qui change se fond dans le nouveau en une seconde et
// demie. sprite : largeur des images de flammes, en pixels ; flammes : au-delà, elles
// s'espacent et grandissent d'autant ; escarbilles : leur nombre au plus.
export const FEU_ATELIER = { echelle: 0.75, images: 24, fondu: 0, sprite: 96, flammes: 900, escarbilles: 140 };
export const FEU_TV = { echelle: 1 / 3, images: 12, fondu: 1500, sprite: 64, flammes: 320, escarbilles: 60 };

// Ce que donne chaque valeur de feu, avant de se répandre et de se flouter : la suie (le sol noirci), les braises (le
// lit rougeoyant sous les flammes), les cendres (le calciné : traînées grises et derniers tisons), la lueur (la clarté
// autour) et la fumée ; poids : sa part des escarbilles.
const NIVEAUX = [
  null,
  { suie: 0.03, braise: 0.55, cendre: 0, lueur: 0.5, fumee: 0.12, poids: 0.3 },
  { suie: 0.1, braise: 0.85, cendre: 0, lueur: 0.8, fumee: 0.4, poids: 0.8 },
  { suie: 0.18, braise: 1, cendre: 0, lueur: 1, fumee: 0.9, poids: 1.4 },
  { suie: 0.86, braise: 0, cendre: 1, lueur: 0.04, fumee: 0.22, poids: 0.06 },
];
const SUIE = [17, 13, 11]; // le noir de suie
const LUEUR = [255, 146, 58]; // la clarté orangée autour du feu
const VOILE_LUEUR = 0.36; // son opacité moyenne
const FUMEE = 0.62; // opacité de la fumée au plus épais
const DECALAGE_FUMEE = { x: 0.35, y: -0.8 }; // la fumée, poussée par le vent, en cases
const PALE = 0.85; // dans l'atelier, vue du MJ : le calque un peu allégé, pour voir ce qu'on édite
// Sous un pion vu, le feu s'éclaircit : le pion reste lisible au milieu des flammes, son prénom aussi.
const ECLAIRCIE = { heros: 0.88, autre: 0.8, mj: 0.9 };
// Le vent : la fumée et les escarbilles filent vers le haut de l'écran, un peu de biais (en cases par milliseconde).
const VENT = { vx: 0.00012, vy: -0.00034 };
// Les textures qui glissent sur les cartes : laquelle, la taille d'une tuile en cases, sa dérive.
const DERIVES = {
  fumee: { texture: "fumee", cases: 9, vx: VENT.vx, vy: VENT.vy },
  braises: { texture: "braises", cases: 5, vx: 0.00004, vy: -0.00006 },
  lueur: { texture: "vacille", cases: 7, vx: -0.00016, vy: -0.00022 },
  cendres: { texture: "cendres", cases: 7, vx: 0, vy: 0 },
};
const IMAGES_FLAMME = 8; // les images d'une flamme qui danse, en boucle
const VARIANTES = 4; // quatre flammes différentes, tirées case par case

const lisse = (t) => t * t * (3 - 2 * t);
const entre = (a, b, v) => lisse(Math.min(1, Math.max(0, (v - a) / (b - a))));
const modulo = (a, b) => ((a % b) + b) % b;

function toile(l, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(l));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------------------------------------------------------------- textures et flammes, une fois pour toute la page

let textures = null;
function lesTextures() {
  if (!textures) {
    textures = {
      // Les braises : du rouge sombre au jaune, en taches qui se déplacent lentement.
      braises: texture(31, (v) => {
        const k = entre(0.2, 0.85, v);
        return [Math.round(200 + 55 * k), Math.round(60 + 150 * k * k), Math.round(15 + 90 * k * k * k), 0.6 + 0.4 * k];
      }),
      // La fumée : des volutes d'un gris de suie, plus ou moins denses.
      fumee: texture(47, (v) => [34 + Math.round(24 * v), 30 + Math.round(20 * v), 28 + Math.round(18 * v), 0.3 + 0.7 * entre(0.28, 0.72, v)]),
      // Les trouées qui font vaciller la lueur : ici plus claire, là plus sombre.
      vacille: texture(59, (v) => [0, 0, 0, 0.6 * entre(0.35, 0.8, v)]),
      // Le calciné : des traînées de cendre grise sur la suie.
      cendres: texture(83, (v) => [58 + Math.round(46 * v), 54 + Math.round(40 * v), 50 + Math.round(34 * v), 0.06 + 0.3 * entre(0.42, 0.88, v)]),
    };
  }
  return textures;
}

// Le contour d'une langue de feu : un bas arrondi, des flancs qui se resserrent en ondulant jusqu'à une pointe qui se
// balance. th : la phase de la danse (une boucle complète sur 2π).
function contour(ctx, bx, by, r0, haut, th, graine, penche) {
  const n = 18;
  const onde = (s, k) => 0.16 * r0 * Math.sin(7.3 * s + 2 * th + graine * (k + 1)) + 0.1 * r0 * Math.sin(12.1 * s - 3 * th + graine * 2.3 * (k + 1));
  const largeur = (s) => r0 * Math.pow(1 - s, 0.8) * (1 + 0.55 * s * (1 - s));
  const decale = (s) => penche * s * s * Math.sin(th + graine);
  ctx.beginPath();
  ctx.moveTo(bx + decale(1), by - haut);
  for (let k = n - 1; k >= 0; k--) {
    const s = k / n;
    ctx.lineTo(bx + largeur(s) + onde(s, 0) * s + decale(s), by - s * haut);
  }
  for (let k = 0; k <= 10; k++) {
    const a = (Math.PI * k) / 10;
    ctx.lineTo(bx + r0 * Math.cos(a), by + r0 * 0.5 * Math.sin(a));
  }
  for (let k = 0; k < n; k++) {
    const s = k / n;
    ctx.lineTo(bx - largeur(s) + onde(s, 1) * s + decale(s), by - s * haut);
  }
  ctx.closePath();
}

// Une image de flamme : deux ou trois langues de feu (une haute au milieu, des plus basses qui penchent sur les côtés),
// chacune en trois couches (rouge, orange, cœur clair), dont le contour ondule d'une image à l'autre et revient au départ.
function imageFlamme(l, h, v, th) {
  const c = toile(l, h);
  const ctx = c.getContext("2d");
  const by = h * 0.82;
  const tire = (k) => hache(v, k, 97);
  const langues = [{ dx: 0, r: 0.22, haut: 0.62, phase: 0, penche: 0.06 }];
  langues.push({ dx: -0.15 - 0.05 * tire(1), r: 0.13 + 0.03 * tire(2), haut: 0.34 + 0.12 * tire(3), phase: 1.9 + tire(4), penche: -0.08 });
  if (tire(5) > 0.25) langues.push({ dx: 0.15 + 0.05 * tire(6), r: 0.12 + 0.03 * tire(7), haut: 0.3 + 0.12 * tire(8), phase: 3.7 + tire(9), penche: 0.08 });
  const couches = [
    { r: 1, haut: 1, couleurs: [[0, "rgba(255,150,52,0.72)"], [0.6, "rgba(222,74,20,0.42)"], [1, "rgba(140,25,8,0)"]], ombre: "rgba(255,84,18,0.5)", flou: 0.12 },
    { r: 0.68, haut: 0.74, couleurs: [[0, "rgba(255,206,112,0.82)"], [0.65, "rgba(255,128,34,0.46)"], [1, "rgba(255,90,20,0)"]], ombre: null, flou: 0 },
    { r: 0.36, haut: 0.42, couleurs: [[0, "rgba(255,244,206,0.86)"], [1, "rgba(255,196,108,0)"]], ombre: null, flou: 0 },
  ];
  couches.forEach((k, i) => {
    for (const [j, g] of langues.entries()) {
      // Le cœur clair seulement dans les deux langues les plus hautes.
      if (i === 2 && j > 1) continue;
      const bx = l * (0.5 + g.dx);
      const haut = h * g.haut * k.haut * (1 + 0.12 * Math.sin(th + g.phase));
      const r0 = l * g.r * k.r;
      const grad = ctx.createRadialGradient(bx, by - haut * 0.15, 0, bx, by - haut * 0.3, haut * 0.95);
      for (const [o, couleur] of k.couleurs) grad.addColorStop(o, couleur);
      ctx.save();
      if (k.ombre) {
        ctx.shadowColor = k.ombre;
        ctx.shadowBlur = l * k.flou;
      }
      ctx.fillStyle = grad;
      contour(ctx, bx, by, r0, haut, th + g.phase + i * 0.6, 1.7 + v * 2.9 + j + i, l * g.penche + l * 0.05 * Math.sin(th + g.phase));
      ctx.fill();
      ctx.restore();
    }
  });
  // Une flammèche qui se détache parfois au-dessus de la langue du milieu.
  const s = Math.sin(2 * th + v * 2.1);
  if (s > 0.35) {
    const y = by - h * (0.68 + 0.1 * s);
    const g = ctx.createRadialGradient(l / 2, y, 0, l / 2, y, l * 0.06);
    g.addColorStop(0, "rgba(255,206,118,0.75)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(l / 2 - l * 0.07, y - l * 0.07, l * 0.14, l * 0.14);
  }
  return c;
}

// Un tison : un point rouge orangé qui s'estompe, calculé une fois pour toute la page.
let tisonImage = null;
function imageTison() {
  if (!tisonImage) {
    tisonImage = toile(32, 32);
    const g = tisonImage.getContext("2d");
    const d = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    d.addColorStop(0, "rgba(255,214,140,1)");
    d.addColorStop(0.25, "rgba(255,120,40,0.85)");
    d.addColorStop(1, "rgba(150,30,10,0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 32, 32);
  }
  return tisonImage;
}

// Les images des flammes, par largeur : trois variantes de huit images qui bouclent.
const FLAMMES = new Map();
function lesFlammes(l) {
  if (!FLAMMES.has(l)) {
    const h = Math.round(l * 1.5);
    const variantes = [];
    for (let v = 0; v < VARIANTES; v++) {
      const images = [];
      for (let f = 0; f < IMAGES_FLAMME; f++) images.push(imageFlamme(l, h, v, (2 * Math.PI * f) / IMAGES_FLAMME));
      variantes.push(images);
    }
    FLAMMES.set(l, { l, h, variantes });
  }
  return FLAMMES.get(l);
}

// ---------------------------------------------------------------- le feu d'un plan, calculé une fois

// Une valeur par case, répandue de case en case sans passer un mur ni sortir de ce que la vue montre : à chaque pas, une
// voisine reçoit au plus la valeur de la case multipliée par k.
function repandre(v, w, h, murs, ouvert, pas, k) {
  let a = v;
  for (let s = 0; s < pas; s++) {
    const b = Float32Array.from(a);
    for (let i = 0; i < w * h; i++) {
      const vi = a[i] * k;
      if (vi < 0.02 || !ouvert[i]) continue;
      const x = i % w;
      const m = murs ? murs[i] | (murs[i] >> 4) : 0;
      if (i >= w && !(m & 1) && ouvert[i - w] && b[i - w] < vi) b[i - w] = vi;
      if (x < w - 1 && !(m & 2) && ouvert[i + 1] && b[i + 1] < vi) b[i + 1] = vi;
      if (i + w < w * h && !(m & 4) && ouvert[i + w] && b[i + w] < vi) b[i + w] = vi;
      if (x > 0 && !(m & 8) && ouvert[i - 1] && b[i - 1] < vi) b[i - 1] = vi;
    }
    a = b;
  }
  return a;
}

// Une carte floue, K pixels par case, avec une marge m où le flou s'éteint ; null si elle est vide.
function carte(v, w, h, K, m, r) {
  const L = w * K + 2 * m;
  const H = h * K + 2 * m;
  const a = new Float32Array(L * H);
  let rien = true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const val = v[y * w + x];
      if (!(val > 0.01)) continue;
      rien = false;
      for (let j = 0; j < K; j++) {
        const debut = (m + y * K + j) * L + m + x * K;
        a.fill(val, debut, debut + K);
      }
    }
  }
  if (rien) return null;
  flouter(a, L, H, r);
  return a;
}

function toileAlpha(a, L, H, couleur) {
  const c = toile(L, H);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(L, H);
  for (let k = 0; k < a.length; k++) {
    img.data[k * 4] = couleur[0];
    img.data[k * 4 + 1] = couleur[1];
    img.data[k * 4 + 2] = couleur[2];
    img.data[k * 4 + 3] = Math.round(255 * Math.min(1, a[k]));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// La signature d'un feu tel que le montre la vue (b) : il se recalcule si elle change (un mur, un sol, une case révélée
// changent la lueur et la fumée qui s'y répandent).
function signatureFeu(p, b, murs, joueurs) {
  return [
    p.largeur, p.hauteur, b.join(""), murs ? Array.prototype.join.call(murs, ",") : "", (p.sol || []).join(","),
    joueurs && (p.brouillard_actif === undefined || !!p.brouillard_actif) ? (p.brouillard || []).join("") : "",
  ].join("|");
}

// Ce qu'il faut pour peindre un feu (celui que montre la vue, b) : les quatre cartes floues, la boîte du feu, les
// flammes à poser et les cases d'où partent les escarbilles. null : rien ne brûle.
export function preparerFeu(p, b, murs, joueurs, reglages = FEU_ATELIER) {
  const w = p.largeur;
  const h = p.hauteur;
  const n = w * h;
  if (!b || b.length !== n) return null;
  const vu = Array.isArray(p.brouillard) ? p.brouillard : [];
  const actif = joueurs && (p.brouillard_actif === undefined || !!p.brouillard_actif);
  const ouvert = new Uint8Array(n);
  for (let i = 0; i < n; i++) ouvert[i] = p.sol[i] && (!actif || vu[i] === 1) ? 1 : 0;
  const suie = new Float32Array(n);
  const braise = new Float32Array(n);
  const cendre = new Float32Array(n);
  const lueur = new Float32Array(n);
  const fumee = new Float32Array(n);
  let flammes = [];
  const sources = [];
  const tisons = [];
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let i = 0; i < n; i++) {
    const v = b[i];
    if (!(v >= 1 && v <= CALCINE)) continue;
    const x = i % w;
    const y = (i - x) / w;
    const nv = NIVEAUX[v];
    suie[i] = nv.suie;
    braise[i] = nv.braise;
    cendre[i] = nv.cendre;
    lueur[i] = nv.lueur;
    fumee[i] = nv.fumee;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    sources.push({ x, y, poids: nv.poids });
    if (v === CALCINE) {
      // Les derniers tisons : un point rouge par case calcinée sur deux, à une place fixe, qui rougeoie lentement.
      if (hache(x, y, 101) < 0.5) tisons.push({ x: x + 0.12 + 0.76 * hache(x, y, 103), y: y + 0.12 + 0.76 * hache(x, y, 107), r: 0.05 + 0.07 * hache(x, y, 109), phase: hache(x, y, 113) });
      continue;
    }
    // Une flamme dans des braises, une ou deux dans un feu, deux ou trois dans un brasier, à des places fixes dans la
    // case. Contre un mur au nord, elles restent basses et au bas de la case : elles ne lèchent pas le mur par-dessus.
    const nord = murs && (murs[i] | (murs[i] >> 4)) & 1;
    const nombre = v === 1 ? 1 : v === 2 ? (hache(x, y, 7) < 0.4 ? 2 : 1) : hache(x, y, 7) < 0.3 ? 3 : 2;
    for (let k = 0; k < nombre; k++) {
      const s = hache(x, y, 37 + k);
      let taille = v === 1 ? 0.45 + 0.2 * s : v === 2 ? 0.8 + 0.25 * s : 1.05 + 0.4 * s;
      let fy = y + 0.3 + 0.6 * hache(x, y, 23 + k);
      if (nord) {
        taille = Math.min(taille, 0.72);
        fy = y + 0.72 + 0.2 * hache(x, y, 23 + k);
      }
      flammes.push({
        x: x + 0.15 + 0.7 * hache(x, y, 11 + k), y: fy, s: taille, a: 0.72 + 0.24 * hache(x, y, 89 + k),
        phase: hache(x, y, 41 + k), vitesse: 9 + 6 * hache(x, y, 53 + k),
        variante: Math.floor(hache(x, y, 67 + k) * VARIANTES) % VARIANTES, tri: hache(x, y, 79 + k),
      });
    }
  }
  if (x1 < 0) return null;
  // Trop de flammes pour la TV : on en garde une part, plus grandes d'autant.
  if (flammes.length > reglages.flammes) {
    const part = reglages.flammes / flammes.length;
    const grandit = Math.sqrt(1 / part);
    flammes = flammes.filter((f) => f.tri < part).map((f) => Object.assign({}, f, { s: f.s * grandit }));
  }
  flammes.sort((a, c) => a.y - c.y);
  const cumul = new Float32Array(sources.length);
  let poids = 0;
  sources.forEach((s, k) => {
    poids += s.poids;
    cumul[k] = poids;
  });
  // La lueur gagne trois cases, la fumée deux, sans passer les murs ; puis les cartes floues, au plus 8 pixels par case.
  const lueurs = repandre(lueur, w, h, murs, ouvert, 3, 0.62);
  const fumees = repandre(fumee, w, h, murs, ouvert, 2, 0.75);
  const K = Math.max(3, Math.min(8, Math.floor(320 / Math.max(w, h))));
  const m = 3 * Math.max(1, Math.round(K * 0.9));
  const L = w * K + 2 * m;
  const H = h * K + 2 * m;
  const cs = carte(suie, w, h, K, m, Math.max(1, Math.round(K * 0.45)));
  const cb = carte(braise, w, h, K, m, Math.max(1, Math.round(K * 0.3)));
  const cc = carte(cendre, w, h, K, m, Math.max(1, Math.round(K * 0.3)));
  const cl = carte(lueurs, w, h, K, m, Math.max(1, Math.round(K * 0.8)));
  const cf = carte(fumees, w, h, K, m, Math.max(1, Math.round(K * 0.9)));
  // Le flou ne déborde pas des sols : hors du plan, sur le noir, la fumée et la lueur feraient un halo pâle.
  const sols = carte(Float32Array.from(ouvert), w, h, K, m, Math.max(1, Math.round(K * 0.2)));
  for (const c of [cs, cb, cc, cl, cf]) if (c && sols) for (let k = 0; k < c.length; k++) c[k] *= Math.min(1, sols[k] * 1.6);
  const marge = 4;
  return {
    K, m, L, H, flammes, tisons, sources, cumul, poids,
    suie: cs && toileAlpha(cs, L, H, SUIE),
    braise: cb && toileAlpha(cb, L, H, [255, 255, 255]),
    cendre: cc && toileAlpha(cc, L, H, [255, 255, 255]),
    lueur: cl && toileAlpha(cl, L, H, LUEUR),
    fumee: cf && toileAlpha(cf, L, H, [255, 255, 255]),
    boite: { x0: x0 - marge, y0: y0 - marge, x1: x1 + 1 + marge, y1: y1 + 1 + marge },
  };
}

// Un feu qui ne sert plus rend sa mémoire tout de suite (des toiles ramenées à zéro).
function liberer(e) {
  if (e) for (const cle of ["suie", "braise", "cendre", "lueur", "fumee"]) if (e[cle]) e[cle].width = 0;
}

function croiser(a, b) {
  const z = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return z.x1 > z.x0 && z.y1 > z.y0 ? z : null;
}

// Une carte posée sur le plan : seule sa part qui tombe dans la boîte se peint.
function poser(ctx, e, c, boite) {
  const { K, m } = e;
  const sx = Math.max(0, Math.floor(boite.x0 * K + m));
  const sy = Math.max(0, Math.floor(boite.y0 * K + m));
  const sl = Math.min(c.width, Math.ceil(boite.x1 * K + m)) - sx;
  const sh = Math.min(c.height, Math.ceil(boite.y1 * K + m)) - sy;
  if (sl > 0 && sh > 0) ctx.drawImage(c, sx, sy, sl, sh, (sx - m) / K, (sy - m) / K, sl / K, sh / K);
}

// Toute la lueur vacille ensemble, un peu, à des rythmes qui ne se répètent pas.
const vacillement = (t) => 0.84 + 0.08 * Math.sin(t * 0.0113) + 0.05 * Math.sin(t * 0.0291 + 1.3) + 0.03 * Math.sin(t * 0.0517 + 0.4);

const COULEURS_ESCARBILLES = ["rgb(255,236,170)", "rgb(255,164,64)", "rgb(226,74,26)"];

export class CalqueFeu {
  // toile : le canvas du calque, posé sur celui du plan ; vue : la VuePlan (caméra, plan, murs, pions dessinés).
  constructor(toileCalque, vue, reglages = FEU_ATELIER) {
    this.toile = toileCalque;
    this.ctx = toileCalque.getContext("2d");
    this.vue = vue;
    this.reglages = reglages;
    this.etat = null;
    this.signature = "";
    this.avant = null; // pendant un fondu : { etat, t0 } (etat nul : le feu apparaît)
    this.aRelire = null; // le plan à relire à la prochaine image : { plan, fondu }
    this.joueurs = null;
    this.pale = null;
    this.vide = true;
    this.minuterie = 0;
    this.raf = 0;
    this.dernier = 0; // l'heure de l'image d'avant, pour faire avancer les escarbilles
    this.escarbilles = [];
    this.travaux = {};
    this.motifs = {};
    // Mouvements réduits (réglage du système) : le feu reste immobile.
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

  // Le plan chargé, ou son feu changé : relu à la prochaine image. fondu : même plan qu'avant, l'ancien feu se fond dans
  // le nouveau (TV).
  charger(plan, fondu = false) {
    this.aRelire = { plan, fondu: fondu || !!(this.aRelire && this.aRelire.fondu) };
    clearTimeout(this.minuterie);
    this.minuterie = 0;
    this.planifier(0);
  }

  // Le brouillard a pu changer (une pièce révélée) : en vue joueurs, le feu montré se relit ; rien ne se refait s'il
  // reste le même.
  verifier() {
    if (!this.aRelire && this.vue.plan) this.aRelire = { plan: this.vue.plan, fondu: false };
    this.planifier(0);
  }

  relire() {
    const { plan, fondu } = this.aRelire;
    this.aRelire = null;
    this.joueurs = !!this.vue.joueurs;
    const b = feuVue(plan, this.joueurs);
    const murs = this.vue.murs;
    const sig = b ? signatureFeu(plan, b, murs, this.joueurs) : "";
    if (sig === this.signature) return;
    this.signature = sig;
    const neuf = b ? preparerFeu(plan, b, murs, this.joueurs, this.reglages) : null;
    // Un fondu déjà en cours s'arrête : l'ancien feu part, le nouveau se fond depuis celui qui était à l'écran.
    if (this.avant) liberer(this.avant.etat);
    const ancien = this.etat;
    const enFondu = fondu && this.reglages.fondu && (ancien || neuf);
    this.avant = enFondu ? { etat: ancien, t0: performance.now() } : null;
    if (!enFondu) liberer(ancien);
    this.etat = neuf;
  }

  // Le plan a-t-il du feu (à l'écran ou non : en vue joueurs, celui d'une zone cachée ne se peint pas) ?
  aDuFeu() {
    const p = (this.aRelire && this.aRelire.plan) || this.vue.plan;
    return !!(this.etat || this.avant || (p && Array.isArray(p.feu) && p.feu.some((v) => v)));
  }

  // Une image du calque : avec la caméra du plan (appelé par la vue à chaque image du plan), ou seule, pour la danse.
  dessiner() {
    const v = this.vue;
    clearTimeout(this.minuterie);
    this.minuterie = 0;
    if (!v.plan || v.detruite || v.enSommeil) return this.arreter();
    if (!this.aRelire && !!v.joueurs !== this.joueurs) this.aRelire = { plan: v.plan, fondu: false };
    if (this.aRelire) this.relire();
    const t = performance.now();
    const dt = this.dernier ? Math.min(0.2, (t - this.dernier) / 1000) : 0;
    this.dernier = t;
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
    let neuf = 1;
    if (this.avant) {
      const k = (t - this.avant.t0) / this.reglages.fondu;
      if (k >= 1) {
        liberer(this.avant.etat);
        this.avant = null;
      } else neuf = lisse(Math.max(0, k));
    }
    this.majEscarbilles(dt);
    if (!this.etat && !this.avant && !this.escarbilles.length) return;
    const s = this.toile.width / Math.max(1, v.lw);
    const { x, y, z } = v.cam;
    ctx.setTransform(z * s, 0, 0, z * s, (v.lw / 2 - x * z) * s, (v.lh / 2 - y * z) * s);
    ctx.imageSmoothingEnabled = true;
    const zone = v.zoneVisible();
    const temps = this.immobile ? 0 : t;
    if (this.avant && this.avant.etat) this.composer(ctx, this.avant.etat, zone, temps, 1 - neuf);
    if (this.etat) this.composer(ctx, this.etat, zone, temps, neuf);
    this.dessinerEscarbilles(ctx, zone);
    this.eclaircir(ctx, zone, (v.pionsDessines || v.plan.pions || []).filter((p) => pionMontre(v.plan, p, !!v.joueurs)), !!v.joueurs, z);
    // Sur la TV, chaque prénom écrit troue le feu : son cartouche reste lisible au cœur du brasier. Les barres de Santé
    // et de Psy des héros aussi, sur la TV comme dans l'atelier.
    const trous = (v.prenomsTv || []).concat(v.barresDessinees || []);
    if (trous.length) {
      ctx.globalCompositeOperation = "destination-out";
      for (const n of trous) trouerPrenom(ctx, n.boite);
      ctx.globalCompositeOperation = "source-over";
    }
    this.vide = false;
    // La danse (ou le fondu) continue : la prochaine image, au rythme du calque.
    if (!this.immobile || this.avant) this.planifier(1000 / this.reglages.images);
  }

  // Un feu peint sur une toile déjà tournée vers le plan : le dessous (suie, lueur qui vacille, lit de braises), puis,
  // ajoutées, les flammes, et la fumée qui file par-dessus. alpha : sa part pendant un fondu.
  composer(ctx, e, zone, t, alpha) {
    const boite = croiser(zone, e.boite);
    if (!boite || alpha <= 0) return;
    // Le dessous se compose à la taille des cartes et se pose d'un seul coup : agrandir une image coûte, sur la TV.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    poser(ctx, e, this.dessous(e, t), boite);
    ctx.globalCompositeOperation = "lighter";
    const sp = lesFlammes(this.reglages.sprite);
    for (const f of e.flammes) {
      if (f.x + f.s < boite.x0 || f.x - f.s > boite.x1 || f.y + f.s < boite.y0 || f.y - 1.6 * f.s > boite.y1) continue;
      ctx.globalAlpha = alpha * f.a;
      const i = Math.floor((t * f.vitesse) / 1000 + f.phase * IMAGES_FLAMME) % IMAGES_FLAMME;
      const l = f.s * (1 + 0.07 * Math.sin(t * 0.006 + f.phase * 6.283));
      const h = l * 1.5;
      ctx.drawImage(sp.variantes[f.variante][i], f.x - l / 2, f.y - h * 0.82, l, h);
    }
    // Les tisons du calciné, ajoutés eux aussi.
    const tison = imageTison();
    for (const q of e.tisons) {
      if (q.x < boite.x0 || q.x > boite.x1 || q.y < boite.y0 || q.y > boite.y1) continue;
      ctx.globalAlpha = alpha * (0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.0018 + q.phase * 6.283)));
      ctx.drawImage(tison, q.x - q.r * 2, q.y - q.r * 2, q.r * 4, q.r * 4);
    }
    // La fumée par-dessus, poussée par le vent : elle file au-dessus des flammes et au-delà.
    ctx.globalCompositeOperation = "source-over";
    if (e.fumee) {
      ctx.globalAlpha = alpha * FUMEE;
      ctx.save();
      ctx.translate(DECALAGE_FUMEE.x, DECALAGE_FUMEE.y);
      poser(ctx, e, this.remplir(e, e.fumee, "fumee", t), boite);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Une toile de travail de la taille des cartes, gardée d'une image à l'autre.
  travail(cle, e) {
    let c = this.travaux[cle];
    if (!c) c = this.travaux[cle] = toile(e.L, e.H);
    else if (c.width !== e.L || c.height !== e.H) {
      c.width = e.L;
      c.height = e.H;
    }
    return c;
  }

  // Le dessous du feu, à la taille des cartes : la suie et les cendres, la lueur qui vacille, puis, ajouté, le lit de
  // braises.
  dessous(e, t) {
    const c = this.travail("dessous", e);
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, e.L, e.H);
    if (e.suie) g.drawImage(e.suie, 0, 0);
    if (e.cendre) g.drawImage(this.remplir(e, e.cendre, "cendres", t), 0, 0);
    if (e.lueur) {
      g.globalAlpha = VOILE_LUEUR * vacillement(t);
      g.drawImage(this.remplir(e, e.lueur, "lueur", t), 0, 0);
    }
    g.globalCompositeOperation = "lighter";
    if (e.braise) {
      g.globalAlpha = 0.78 + 0.12 * Math.sin(t * 0.0021);
      g.drawImage(this.remplir(e, e.braise, "braises", t), 0, 0);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    return c;
  }

  // Une carte emplie de sa texture qui glisse (fumée, braises), ou trouée par elle (la lueur qui vacille), sur une toile
  // de travail de la taille de la carte.
  remplir(e, masque, cle, t) {
    const c = this.travail(cle, e);
    const g = c.getContext("2d");
    const d = DERIVES[cle];
    const tex = lesTextures()[d.texture];
    if (!this.motifs[cle]) this.motifs[cle] = g.createPattern(tex, "repeat");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, e.L, e.H);
    g.drawImage(masque, 0, 0);
    g.globalCompositeOperation = cle === "lueur" ? "destination-out" : "source-in";
    const pas = d.cases * e.K;
    const k = pas / tex.width;
    const ox = modulo(t * d.vx * e.K, pas);
    const oy = modulo(t * d.vy * e.K, pas);
    g.translate(ox, oy);
    g.scale(k, k);
    g.fillStyle = this.motifs[cle];
    g.fillRect(-ox / k - tex.width, -oy / k - tex.height, e.L / k + 2 * tex.width, e.H / k + 2 * tex.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    return c;
  }

  // Les escarbilles : elles naissent sur les cases qui brûlent (plus nombreuses sur un brasier), montent avec le vent en
  // se balançant et s'éteignent en rougissant.
  majEscarbilles(dt) {
    const e = this.etat;
    const max = e && !this.immobile ? Math.min(this.reglages.escarbilles, Math.ceil(e.poids * 0.6)) : 0;
    const liste = this.escarbilles;
    for (let i = liste.length - 1; i >= 0; i--) {
      const q = liste[i];
      q.age += dt;
      if (q.age >= q.duree) {
        if (liste.length > max || !e) liste.splice(i, 1);
        else this.naitre(q, e);
        continue;
      }
      q.x += (q.vx + 0.22 * Math.sin(q.age * 5 + q.graine)) * dt;
      q.y += q.vy * dt;
    }
    // Les nouvelles naissent peu à peu, pas toutes à la même image.
    let n = Math.min(max - liste.length, Math.ceil(max * dt * 0.8));
    while (n-- > 0) {
      const q = {};
      this.naitre(q, e);
      liste.push(q);
    }
  }

  naitre(q, e) {
    const r = Math.random() * e.poids;
    let [a, b] = [0, e.cumul.length - 1];
    while (a < b) {
      const m = (a + b) >> 1;
      if (e.cumul[m] < r) a = m + 1;
      else b = m;
    }
    const s = e.sources[a];
    q.x = s.x + 0.15 + 0.7 * Math.random();
    q.y = s.y + 0.2 + 0.6 * Math.random();
    q.vx = VENT.vx * 1000 * (0.5 + Math.random()) + (Math.random() - 0.5) * 0.3;
    q.vy = VENT.vy * 1000 * (1.2 + 1.5 * Math.random());
    q.age = 0;
    q.duree = 0.8 + 1.5 * Math.random();
    q.taille = 0.035 + 0.05 * Math.random();
    q.graine = Math.random() * 6.283;
  }

  dessinerEscarbilles(ctx, zone) {
    if (!this.escarbilles.length) return;
    ctx.globalCompositeOperation = "lighter";
    for (const q of this.escarbilles) {
      if (q.x < zone.x0 || q.x > zone.x1 || q.y < zone.y0 || q.y > zone.y1) continue;
      const k = q.age / q.duree;
      ctx.globalAlpha = 0.95 * Math.pow(1 - k, 1.3);
      ctx.fillStyle = COULEURS_ESCARBILLES[k < 0.3 ? 0 : k < 0.65 ? 1 : 2];
      const t = q.taille * (1 - 0.4 * k);
      ctx.fillRect(q.x - t / 2, q.y - t / 2, t, t);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // Sous chaque pion vu, un ovale, puis une bande large sous lui pour son prénom : le feu s'y efface presque. px : une
  // case vaut combien de pixels d'écran (le prénom a une taille fixe à l'écran sur la TV).
  eclaircir(ctx, zone, pions, joueurs, px = 0) {
    ctx.globalCompositeOperation = "destination-out";
    const ovale = (x, y, rx, ry, force) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0.4, 0, 0, 1);
      g.addColorStop(0, `rgba(0,0,0,${force})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    };
    for (const p of pions) {
      const r = 0.42 * (p.taille || 1);
      if (p.x + 3 * r < zone.x0 || p.x - 3 * r > zone.x1 || p.y + 4 * r < zone.y0 || p.y - 2 * r > zone.y1) continue;
      const force = !joueurs ? ECLAIRCIE.mj : p.genre === "heros" ? ECLAIRCIE.heros : ECLAIRCIE.autre;
      // La figurine debout, du haut de son support au bas de son socle (le visage ne brûle pas sous les flammes).
      const s = silhouette(r);
      ovale(p.x, p.y + (s.haut + s.bas) / 2, s.demi * 1.3, ((s.bas - s.haut) / 2) * 1.1, force);
      // Le prénom : environ 140 pixels de large et 30 de haut sur la TV, sous le socle.
      const rx = Math.max(r * 1.7, px ? 75 / px : 0);
      const ry = Math.max(r * 0.42, px ? 18 / px : 0);
      ovale(p.x, p.y + s.bas + ry * 0.75, rx, ry, force * 0.9);
    }
    ctx.globalCompositeOperation = "source-over";
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

  // Plan caché ou quitté : plus rien ne tourne. La prochaine image du plan relance la danse.
  arreter() {
    clearTimeout(this.minuterie);
    cancelAnimationFrame(this.raf);
    this.minuterie = 0;
    this.raf = 0;
    this.dernier = 0;
  }

  detruire() {
    this.arreter();
    liberer(this.etat);
    liberer(this.avant && this.avant.etat);
    for (const cle of Object.keys(this.travaux)) this.travaux[cle].width = 0;
    this.etat = null;
    this.avant = null;
    this.escarbilles = [];
    this.toile.width = 0;
  }

  // L'image exportée (PNG) : le feu immobile, peint sur le plan entier à part, puis posé dessus. Celui des joueurs ne
  // couvre que les cases révélées.
  exporter(ctx, l, h, joueurs) {
    const v = this.vue;
    const e = preparerFeu(v.plan, feuVue(v.plan, joueurs), v.murs, joueurs, this.reglages);
    if (!e) return;
    const K = Math.max(4, Math.min(16, Math.floor(4096 / Math.max(v.plan.largeur, v.plan.hauteur))));
    const c = toile(v.plan.largeur * K, v.plan.hauteur * K);
    const g = c.getContext("2d");
    g.setTransform(K, 0, 0, K, 0, 0);
    const zone = { x0: 0, y0: 0, x1: v.plan.largeur, y1: v.plan.hauteur };
    this.composer(g, e, zone, 0, 1);
    this.eclaircir(g, zone, (v.plan.pions || []).filter((p) => pionMontre(v.plan, p, joueurs)), joueurs);
    ctx.save();
    ctx.globalAlpha = joueurs ? 1 : PALE;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, l, h);
    ctx.restore();
    c.width = 0;
    liberer(e);
  }
}
