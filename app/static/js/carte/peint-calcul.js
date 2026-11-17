// Calcul du relief peint, sans DOM : altitude tirée du terrain, eaux en dégradé, couleur, ombre et lumière d'une zone,
// pixel par pixel. Sert au Web Worker des cartes (atelier et TV) et, à défaut de worker, au fil principal.
// Tout se lit en coordonnées absolues (cases, pixels de la carte entière) : deux zones voisines, calculées à part,
// se raccordent sans couture.

import { B, BIOMES } from "./biomes.js";
import { SOUS } from "./champs.js";
import { clamp, distanceDepuis, flouter, hacher, lisse } from "./geo.js";

const EST_EAU = new Uint8Array(32);
for (const b of BIOMES) EST_EAU[b.id] = b.eau ? 1 : 0;

// Altitude de chaque terrain avant le relief fin (0 = plaine basse, 1 = hauts sommets).
const ALT = new Float32Array(32);
const ALT_CLE = {
  eau: -0.22, plaine: 0.06, cultures: 0.06, foret: 0.1, pins: 0.14, foret_profonde: 0.12, marais: 0.01, lande: 0.1,
  desert: 0.1, collines: 0.26, montagnes: 0.5, sommets: 0.72, neige: 0.45, volcan: 0.55, brume: 0.18, jungle: 0.08,
};
for (const b of BIOMES) ALT[b.id] = ALT_CLE[b.cle] !== undefined ? ALT_CLE[b.cle] : 0.1;

// Couleurs peintes, en [r, g, b].
const C = {
  pre: [158, 174, 86], preVert: [124, 152, 70], preSec: [186, 180, 108], preFrais: [140, 166, 78],
  champ: [176, 176, 96], lande: [156, 146, 104], bruyere: [146, 116, 120],
  foret: [52, 82, 42], pins: [36, 64, 46], profonde: [28, 50, 36], jungle: [42, 88, 46],
  marais: [108, 120, 82], mare: [62, 98, 92], desert: [224, 198, 140],
  alpage: [138, 146, 92], roche: [150, 140, 126], rocheClair: [178, 170, 158], neige: [244, 246, 250],
  volcan: [76, 62, 58], brume: [206, 204, 196],
  sable: [214, 194, 138], rive: [104, 182, 176], eauMi: [58, 136, 162], eauFond: [32, 82, 124],
};

const melange = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Lecture bilinéaire d'un champ (u, v en cellules, centres des cellules aux entiers).
function bil(f, W, H, u, v) {
  if (u < 0) u = 0; else if (u > W - 1.001) u = W - 1.001;
  if (v < 0) v = 0; else if (v > H - 1.001) v = H - 1.001;
  const i = u | 0;
  const j = v | 0;
  const tx = u - i;
  const ty = v - j;
  const o = j * W + i;
  const a = f[o] + (f[o + 1] - f[o]) * tx;
  const c = f[o + W] + (f[o + W + 1] - f[o + W]) * tx;
  return a + (c - a) * ty;
}

// Lecture bicubique (Catmull-Rom) : la pente reste continue d'une case à l'autre, l'ombrage ne trahit pas la grille.
function cub(a, b, c, d, t) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}
function bic(f, W, H, u, v) {
  if (u < 0) u = 0; else if (u > W - 1.001) u = W - 1.001;
  if (v < 0) v = 0; else if (v > H - 1.001) v = H - 1.001;
  const i = u | 0;
  const j = v | 0;
  const tx = u - i;
  const ty = v - j;
  const i0 = i > 0 ? i - 1 : 0;
  const i2 = i + 1;
  const i3 = i + 2 < W ? i + 2 : W - 1;
  const lig = (jj) => {
    const o = (jj < 0 ? 0 : jj >= H ? H - 1 : jj) * W;
    return cub(f[o + i0], f[o + i], f[o + i2], f[o + i3], tx);
  };
  return cub(lig(j - 1), lig(j), lig(j + 1), lig(j + 2), ty);
}

// Flou boîte sur une image RVB (trois canaux entrelacés dans un Float32Array), rayon en pixels.
function flouRVB(px, w, h, r) {
  if (r < 1) return;
  const tmp = new Float32Array(Math.max(w, h) * 3);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += px[(y * w + clamp(i, 0, w - 1)) * 3 + c];
      for (let x = 0; x < w; x++) {
        tmp[x * 3 + c] = s / n;
        s += px[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - px[(y * w + Math.max(0, x - r)) * 3 + c];
      }
    }
    px.set(tmp.subarray(0, w * 3), y * w * 3);
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += px[(clamp(i, 0, h - 1) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        tmp[y * 3 + c] = s / n;
        s += px[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - px[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
    for (let y = 0; y < h; y++) {
      px[(y * w + x) * 3] = tmp[y * 3];
      px[(y * w + x) * 3 + 1] = tmp[y * 3 + 1];
      px[(y * w + x) * 3 + 2] = tmp[y * 3 + 2];
    }
  }
}

// ---------------------------------------------------------------- champs du relief

// Champs tirés du terrain : à la case, altitude lissée et masques des reliefs ; à la sous-case, terre ferme adoucie
// et distance aux eaux. d : { w, h, W, H, terrain, biomeSous }.
export function preparerChamps(d) {
  const f = {};
  champsCases(d, f, 0, 0, d.w, d.h, 0, 0, d.w, d.h);
  champsSous(d, f, 0, 0, d.W, d.H, 0, 0, d.W, d.H);
  return f;
}

// Calcule sur la fenêtre [a0, a1[ × [b0, b1[ et recopie [x0, x1[ × [y0, y1[ (incluse dans la fenêtre).
function champsCases(d, f, a0, b0, a1, b1, x0, y0, x1, y1) {
  const { w, h, terrain: t } = d;
  const lw = a1 - a0;
  const lh = b1 - b0;
  const n = lw * lh;
  const alt = new Float32Array(n);
  const mont = new Float32Array(n);
  const somm = new Float32Array(n);
  const coll = new Float32Array(n);
  for (let y = b0; y < b1; y++) {
    for (let x = a0; x < a1; x++) {
      const k = t[y * w + x];
      const i = (y - b0) * lw + x - a0;
      alt[i] = ALT[k];
      mont[i] = k === B.montagnes || k === B.sommets || k === B.volcan ? 1 : 0;
      somm[i] = k === B.sommets || k === B.neige ? 1 : 0;
      coll[i] = k === B.collines ? 1 : 0;
    }
  }
  const res = { alt: flouter(alt, lw, lh, 2, 3), mont: flouter(mont, lw, lh, 1, 2), somm: flouter(somm, lw, lh, 1, 2), coll: flouter(coll, lw, lh, 1, 2) };
  for (const nom of ["alt", "mont", "somm", "coll"]) {
    if (!f[nom]) f[nom] = new Float32Array(w * h);
    const src = res[nom];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f[nom][y * w + x] = src[(y - b0) * lw + x - a0];
  }
}

function champsSous(d, f, a0, b0, a1, b1, x0, y0, x1, y1) {
  const { W, H, biomeSous } = d;
  const lw = a1 - a0;
  const lh = b1 - b0;
  const terre = new Float32Array(lw * lh);
  const eau = new Uint8Array(lw * lh);
  for (let y = b0; y < b1; y++) {
    for (let x = a0; x < a1; x++) {
      const e = EST_EAU[biomeSous[y * W + x]];
      const i = (y - b0) * lw + x - a0;
      terre[i] = e ? 0 : 1;
      eau[i] = e;
    }
  }
  const res = { terreFlou: flouter(terre, lw, lh, 1, 1), versEau: flouter(distanceDepuis(eau, lw, lh), lw, lh, 1, 1) };
  for (const nom of ["terreFlou", "versEau"]) {
    if (!f[nom]) f[nom] = new Float32Array(W * H);
    const src = res[nom];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f[nom][y * W + x] = src[(y - b0) * lw + x - a0];
  }
}

// Terrain changé dans une zone (en cases) : les champs sont recalculés autour, sur une fenêtre assez large pour que le
// résultat soit celui d'un calcul complet (le flou de l'altitude porte à six cases ; seules les distances aux eaux de
// moins de deux sous-cases comptent). Renvoie les morceaux changés, à recopier dans les workers.
export function majChampsZone(d, f, x0, y0, x1, y1) {
  const { w, h, W, H } = d;
  const c = (v, max) => Math.max(0, Math.min(max, v));
  const rx0 = c(Math.floor(x0) - 7, w);
  const ry0 = c(Math.floor(y0) - 7, h);
  const rx1 = c(Math.ceil(x1) + 7, w);
  const ry1 = c(Math.ceil(y1) + 7, h);
  champsCases(d, f, c(rx0 - 8, w), c(ry0 - 8, h), c(rx1 + 8, w), c(ry1 + 8, h), rx0, ry0, rx1, ry1);
  // Les sous-cases bougent jusqu'à deux cases autour du terrain peint (Champs.majZone).
  const sx0 = c((Math.floor(x0) - 2) * SOUS - 6, W);
  const sy0 = c((Math.floor(y0) - 2) * SOUS - 6, H);
  const sx1 = c((Math.ceil(x1) + 2) * SOUS + 6, W);
  const sy1 = c((Math.ceil(y1) + 2) * SOUS + 6, H);
  champsSous(d, f, c(sx0 - 18, W), c(sy0 - 18, H), c(sx1 + 18, W), c(sy1 + 18, H), sx0, sy0, sx1, sy1);
  const morceaux = [];
  const extraire = (nom, tab, larg, a0, b0, a1, b1) => {
    const lw = a1 - a0;
    const lh = b1 - b0;
    if (lw <= 0 || lh <= 0) return;
    const data = new tab.constructor(lw * lh);
    for (let y = b0; y < b1; y++) data.set(tab.subarray(y * larg + a0, y * larg + a1), (y - b0) * lw);
    morceaux.push({ nom, x0: a0, y0: b0, lw, lh, data });
  };
  extraire("terrain", d.terrain, w, rx0, ry0, rx1, ry1);
  for (const nom of ["alt", "mont", "somm", "coll"]) extraire(nom, f[nom], w, rx0, ry0, rx1, ry1);
  for (const nom of ["terreFlou", "versEau"]) extraire(nom, f[nom], W, sx0, sy0, sx1, sy1);
  return morceaux;
}

export function appliquerMorceaux(d, morceaux) {
  for (const m of morceaux) {
    const tab = d[m.nom];
    if (!tab) continue;
    if (m.lw === undefined) {
      d[m.nom] = m.data;
      continue;
    }
    const larg = m.nom === "terreFlou" || m.nom === "versEau" || m.nom === "distEau" ? d.W : d.w;
    for (let y = 0; y < m.lh; y++) tab.set(m.data.subarray(y * m.lw, (y + 1) * m.lw), (m.y0 + y) * larg + m.x0);
  }
}

// ---------------------------------------------------------------- le raster d'une zone

// Marge de calcul autour d'une zone, en pixels : ce que les flous et la pente vont chercher au-delà du bord.
export function margeRaster(R) {
  return 2 * Math.max(1, Math.round(R / 12)) + Math.max(1, Math.round(R / 9)) + 2;
}

// Le fond d'une zone de wpx × hpx pixels dont le coin est (X0, Y0) en cases, à R pixels par case : couleur, ombre à
// multiplier, lumière à superposer, en RVBA. d : terrain, champs du relief, distEau (Champs), bruit, w, h, W, H, Z.
export function calculerRaster(d, X0, Y0, wpx, hpx, R) {
  const M = margeRaster(R);
  const ww = wpx + 2 * M;
  const hh = hpx + 2 * M;
  const n = ww * hh;
  const { w, h, W, H } = d;
  const t = d.terrain;
  const b = d.bruit;
  const Hh = new Float32Array(n);
  const CR = new Float32Array(n); // force des crêtes (pour la neige)
  const MM = new Float32Array(n); // masque des montagnes
  const K = new Uint8Array(n);
  const P = new Float32Array(n); // profondeur de l'eau, ou distance à la rive sur la terre (en cases)
  const inv = 1 / R;
  // Passe 1 : terrain, altitude, eau.
  for (let j = 0; j < hh; j++) {
    const y = Y0 + (j - M + 0.5) * inv;
    for (let i = 0; i < ww; i++) {
      const x = X0 + (i - M + 0.5) * inv;
      const p = j * ww + i;
      const dx = 0.85 * b(x * 0.33 + 17.1, y * 0.33 + 3.7) + 0.32 * b(x * 0.97 + 5.3, y * 0.97 + 41.2) + 0.12 * b(x * 2.9 + 1.3, y * 2.9 - 4.1);
      const dy = 0.85 * b(x * 0.33 + 71.9, y * 0.33 + 23.1) + 0.32 * b(x * 0.97 + 13.7, y * 0.97 + 7.9) + 0.12 * b(x * 2.9 - 8.2, y * 2.9 + 2.6);
      let cx = Math.floor(x + dx);
      let cy = Math.floor(y + dy);
      cx = cx < 0 ? 0 : cx >= w ? w - 1 : cx;
      cy = cy < 0 ? 0 : cy >= h ? h - 1 : cy;
      let k = t[cy * w + cx];
      const u = x * SOUS - 0.5;
      const v = y * SOUS - 0.5;
      if (bil(d.terreFlou, W, H, u, v) < 0.5) {
        k = B.eau;
        P[p] = bil(d.distEau, W, H, u, v) / SOUS;
        Hh[p] = -0.02;
        K[p] = k;
        continue;
      }
      if (EST_EAU[k]) k = B.plaine;
      P[p] = bil(d.versEau, W, H, u, v) / SOUS;
      let alt = bic(d.alt, w, h, x - 0.5, y - 0.5) + 0.035 * b(x / 4.3 + 11.3, y / 4.3 - 7.7) + 0.012 * b(x / 1.3 - 3.1, y / 1.3 + 9.2);
      const mm = clamp(bic(d.mont, w, h, x - 0.5, y - 0.5), 0, 1);
      const ss = clamp(bic(d.somm, w, h, x - 0.5, y - 0.5), 0, 1);
      if (mm > 0.01 || ss > 0.01) {
        // Crêtes ramifiées : bruit « en arêtes » sur un domaine légèrement tordu, des massifs plus ou moins hauts.
        const qx = x / 7.4 + 0.38 * b(x / 11.3 + 3.3, y / 11.3 + 9.1);
        const qy = y / 7.4 + 0.38 * b(x / 11.3 - 5.7, y / 11.3 + 1.9);
        let s = 0;
        let a = 1;
        let fr = 1;
        let poids = 1;
        for (let o = 0; o < 4; o++) {
          let r = 1 - Math.abs(b(qx * fr + o * 31.1, qy * fr + o * 11.9));
          r *= r;
          s += a * r * poids;
          poids = clamp(r * 1.5, 0, 1);
          a *= 0.45;
          fr *= 2.05;
        }
        s = (s / 1.6) * 0.7 + 0.3 * (0.5 + 0.6 * b(x / 5.1 - 2.2, y / 5.1 + 6.6));
        const massif = 0.75 + 0.35 * b(x / 15.1 + 7.7, y / 15.1 - 3.1);
        alt += (mm * 0.55 + ss * 0.3) * s * massif;
        CR[p] = s * massif;
        MM[p] = mm;
      }
      const cc = clamp(bic(d.coll, w, h, x - 0.5, y - 0.5), 0, 1);
      if (cc > 0.01) alt += cc * 0.16 * (0.5 + 0.5 * (b(x / 1.9 + 4.4, y / 1.9 - 2.2) + 0.45 * b(x / 0.9, y / 0.9 + 7)));
      Hh[p] = alt;
      K[p] = k;
    }
  }
  // Un relief peint, pas gravé : les hauteurs sont adoucies d'un léger flou.
  const lisseH = flouter(Hh, ww, hh, Math.max(1, Math.round(R / 12)), 2);
  for (let p = 0; p < n; p++) if (K[p] !== B.eau) Hh[p] = lisseH[p];
  // Passe 2 : couleur, ombre, lumière.
  const coul = new Float32Array(n * 3);
  const omb = new Uint8ClampedArray(wpx * hpx * 4);
  const lum = new Uint8ClampedArray(wpx * hpx * 4);
  const Z = d.Z || 2.6;
  const Lx = -0.62;
  const Ly = -0.62;
  const Lz = 0.48;
  for (let j = 0; j < hh; j++) {
    const y = Y0 + (j - M + 0.5) * inv;
    const jm = j > 0 ? j - 1 : j;
    const jp = j < hh - 1 ? j + 1 : j;
    for (let i = 0; i < ww; i++) {
      const x = X0 + (i - M + 0.5) * inv;
      const p = j * ww + i;
      const k = K[p];
      const im = i > 0 ? i - 1 : i;
      const ip = i < ww - 1 ? i + 1 : i;
      const gx = ((Hh[j * ww + ip] - Hh[j * ww + im]) * R) / (ip - im || 1);
      const gy = ((Hh[jp * ww + i] - Hh[jm * ww + i]) * R) / (jp - jm || 1);
      const pente = Math.sqrt(gx * gx + gy * gy) * Z;
      const nx = -Z * gx;
      const ny = -Z * gy;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const ec = (nx * Lx + ny * Ly + Lz) / l / Lz; // 1 sur le plat
      const alt = Hh[p];
      let c;
      const n1 = b(x / 9.7 + 2.1, y / 9.7 - 6.3);
      const n2 = b(x / 3.1 - 1.7, y / 3.1 + 4.4);
      if (k === B.eau) {
        const dd = P[p];
        const tt = lisse(0, 1.1, dd);
        const tf = lisse(0.9, 5.5, dd);
        c = melange(melange(C.rive, C.eauMi, tt), C.eauFond, tf);
        // Reflet du ciel : de longues traînées claires, très douces.
        const r = b(x * 0.35 + 3.3, y * 2.6 - 1.1) + 0.5 * b(x * 0.8, y * 5.1);
        const g = clamp((r - 0.25) * 0.5, 0, 0.12) * (0.4 + 0.6 * tt);
        c = melange(c, [210, 236, 240], g);
      } else {
        switch (k) {
          case B.plaine:
          case B.cultures:
          case B.collines: {
            c = melange(C.pre, C.preVert, clamp(0.5 + n1 * 1.4, 0, 1));
            c = melange(c, C.preSec, clamp(n2 * 1.3 - 0.15, 0, 0.36));
            c = melange(c, C.preFrais, clamp(-n2 * 1.2 - 0.2, 0, 0.3));
            if (k === B.cultures) c = melange(c, C.champ, 0.35);
            // Touffes d'herbe plus sombres ou plus claires, puis touches de pinceau : un grain allongé, en biais.
            const tf = b(x * 2.3 + 5.5, y * 2.3 - 1.4);
            c = melange(c, tf > 0 ? [180, 186, 108] : [104, 132, 62], Math.abs(tf) * 0.22);
            const tp = b((x * 0.87 + y * 0.5) * 1.1, (y * 0.87 - x * 0.5) * 3.6);
            c = melange(c, tp > 0 ? [196, 196, 120] : [96, 124, 58], Math.abs(tp) * 0.16);
            break;
          }
          case B.lande:
            c = melange(C.lande, C.bruyere, clamp(n2 * 1.8, 0, 0.6));
            break;
          case B.foret:
            c = melange(C.foret, C.pre, 0.08 + 0.08 * n1);
            break;
          case B.pins:
            c = C.pins;
            break;
          case B.foret_profonde:
            c = C.profonde;
            break;
          case B.jungle:
            c = C.jungle;
            break;
          case B.marais: {
            const m = b(x * 1.6 + 9.1, y * 1.6 - 3.3) + 0.45 * b(x * 3.4, y * 3.4 + 1.7);
            const base = melange(C.marais, C.preVert, clamp(0.35 + n2 * 1.2, 0, 0.7));
            c = m > 0.4 ? melange(C.mare, [96, 130, 112], lisse(0.46, 0.4, m) * 0.6) : base;
            break;
          }
          case B.desert:
            c = melange(C.desert, [206, 176, 120], clamp(n2 * 1.2 + 0.2, 0, 0.6));
            break;
          case B.montagnes:
          case B.sommets:
          case B.neige:
          case B.volcan: {
            // Alpages en bas, roche sur les pentes, neige sur les crêtes hautes ; au pied, le pré se mêle à l'alpage.
            const roche = clamp(lisse(0.4, 0.8, alt) + pente * 0.2 - 0.06, 0, 1);
            let cm = melange(melange(C.alpage, C.pre, 0.2), C.roche, roche);
            cm = melange(cm, [126, 112, 96], clamp(n1 * 1.3 + 0.1 * b(x * 1.9, y * 0.7), 0, 0.38));
            cm = melange(cm, C.rocheClair, clamp((alt - 0.72) * 1.3, 0, 0.45));
            const lim = (k === B.sommets || k === B.neige ? 1.02 : 1.2) + 0.06 * n2;
            const neige = lisse(lim, lim + 0.08, alt) * lisse(0.42, 0.6, CR[p]) * clamp(1.4 - pente * 0.35, 0, 1);
            // Fonds de vallée plus sombres : le massif prend du volume.
            cm = melange(cm, [92, 84, 74], (1 - lisse(0.2, 0.55, CR[p])) * 0.3 * MM[p]);
            cm = melange(cm, C.neige, neige);
            if (k === B.neige) cm = melange(cm, C.neige, 0.75);
            if (k === B.volcan) cm = melange(cm, C.volcan, 0.75);
            const cp = melange(C.pre, C.preVert, clamp(0.5 + n1 * 1.4, 0, 1));
            c = melange(cp, cm, lisse(0.08, 0.6, MM[p]));
            break;
          }
          default:
            c = C.brume;
        }
        // Rives sableuses le long des eaux.
        const dd = P[p];
        const larg = 0.3 + 0.12 * n2;
        if (dd < larg + 0.15) {
          const sb = 1 - lisse(larg - 0.08, larg + 0.15, dd);
          c = melange(c, C.sable, sb * 0.9);
        }
        // Les hauteurs s'éclaircissent un peu, à la manière des reliefs suisses.
        c = melange(c, [236, 232, 214], clamp((alt - 0.35) * 0.18, 0, 0.12));
      }
      const o = p * 3;
      coul[o] = c[0];
      coul[o + 1] = c[1];
      coul[o + 2] = c[2];
      // Ombre et lumière, sur la zone utile seulement.
      const io = i - M;
      const jo = j - M;
      if (io < 0 || jo < 0 || io >= wpx || jo >= hpx) continue;
      const q = (jo * wpx + io) * 4;
      if (k === B.eau) {
        omb[q] = omb[q + 1] = omb[q + 2] = 255;
        omb[q + 3] = 255;
        lum[q + 3] = 255;
        continue;
      }
      const sombre = clamp((1 - ec) * 0.8, 0, 0.7);
      omb[q] = 255 - sombre * (255 - 92);
      omb[q + 1] = 255 - sombre * (255 - 92);
      omb[q + 2] = 255 - sombre * (255 - 128);
      omb[q + 3] = 255;
      const clair = clamp((ec - 1) * 0.45, 0, 0.3);
      lum[q] = 255 * clair;
      lum[q + 1] = 232 * clair;
      lum[q + 2] = 184 * clair;
      lum[q + 3] = 255;
    }
  }
  flouRVB(coul, ww, hh, Math.max(1, Math.round(R / 9)));
  const couleur = new Uint8ClampedArray(wpx * hpx * 4);
  // Grain de peinture, très léger, tiré du pixel absolu : il ne change pas d'une zone à l'autre.
  const gx0 = Math.round(X0 * R);
  const gy0 = Math.round(Y0 * R);
  for (let jo = 0; jo < hpx; jo++) {
    for (let io = 0; io < wpx; io++) {
      const p = ((jo + M) * ww + io + M) * 3;
      const q = (jo * wpx + io) * 4;
      const g = (hacher(gx0 + io, gy0 + jo, 7) - 0.5) * 7;
      couleur[q] = coul[p] + g;
      couleur[q + 1] = coul[p + 1] + g;
      couleur[q + 2] = coul[p + 2] + g;
      couleur[q + 3] = 255;
    }
  }
  return { couleur, ombre: omb, lumiere: lum };
}
