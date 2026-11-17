// Textures peintes des sols et des murs d'un plan, calculées une seule fois puis posées en motifs (createPattern).
// Chaque texture se raccorde à elle-même sur ses bords : on la répète sans couture. La référence fait 64 pixels par
// case ; les finesses 32 et 16 s'en déduisent par réduction, la finesse 128 (zoom fort dans l'atelier) se recalcule
// avec le même tirage, donc le même dessin.

import { fabriquesDehors } from "./dehors-peint.js";

export const PX = 64;
const NIVEAUX = [16, 32, 64, 128];

function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bruit de valeur périodique : n cellules de réseau sur la période.
function bruitPeriodique(n, graine) {
  const r = alea(graine);
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = r() * 2 - 1;
  return (u, v) => {
    const i = Math.floor(u);
    const j = Math.floor(v);
    let fu = u - i;
    let fv = v - j;
    fu = fu * fu * (3 - 2 * fu);
    fv = fv * fv * (3 - 2 * fv);
    const i0 = ((i % n) + n) % n;
    const j0 = ((j % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const j1 = (j0 + 1) % n;
    const a = g[j0 * n + i0] + (g[j0 * n + i1] - g[j0 * n + i0]) * fu;
    const b = g[j1 * n + i0] + (g[j1 * n + i1] - g[j1 * n + i0]) * fu;
    return a + (b - a) * fv;
  };
}

// fbm périodique sur une texture de T pixels : base cellules sur la période, octaves doublées.
function fbmPeriodique(T, base, octaves, graine) {
  const couches = [];
  for (let o = 0; o < octaves; o++) couches.push(bruitPeriodique(base << o, graine + o * 101));
  return (x, y) => {
    let s = 0;
    let a = 1;
    let norme = 0;
    for (let o = 0; o < octaves; o++) {
      const k = (base << o) / T;
      s += a * couches[o](x * k, y * k);
      norme += a;
      a *= 0.5;
    }
    return s / norme;
  };
}

function toile(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Coordonnée de référence (en pixels de la texture à 64 par case) du pixel n d'une texture k fois plus fine, ramenée
// dans la période : à k = 1, c'est n lui-même.
const ref = (n, k, T) => {
  const u = (n + 0.5) / k - 0.5;
  return u < 0 ? u + T : u >= T ? u - T : u;
};

// Remplit une texture de T pixels de référence, k fois plus fine : f(x, y, sortie, o) écrit la couleur du pixel.
function peindrePixels(T, k, f) {
  const N = T * k;
  const c = toile(N, N);
  const img = new ImageData(N, N);
  const d = img.data;
  const xs = new Float32Array(N);
  for (let n = 0; n < N; n++) xs[n] = ref(n, k, T);
  for (let Y = 0; Y < N; Y++) {
    const y = xs[Y];
    for (let X = 0; X < N; X++) {
      const o = (Y * N + X) * 4;
      f(xs[X], y, d, o, X, Y);
      d[o + 3] = 255;
    }
  }
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

// Contexte où l'on dessine en pixels de référence sur une texture k fois plus fine.
function contexte(c, k) {
  const g = c.getContext("2d");
  g.setTransform(k, 0, 0, k, 0, 0);
  return g;
}

// Découpe cyclique d'une longueur T en morceaux de [lmin, lmax], à partir d'un décalage.
function decouper(T, lmin, lmax, r) {
  const coupes = [];
  let x = r() * T;
  const depart = x;
  while (x < depart + T - lmin) {
    coupes.push(x % T);
    x += lmin + r() * (lmax - lmin);
  }
  return coupes.sort((a, b) => a - b);
}

// Pour chaque colonne de la texture fine, le morceau qui la contient, et sa distance aux deux bouts (en référence).
function indexer(T, coupes, k) {
  const N = T * k;
  const id = new Int16Array(N);
  const d0 = new Float32Array(N);
  const d1 = new Float32Array(N);
  const n = coupes.length;
  for (let X = 0; X < N; X++) {
    const x = ref(X, k, T);
    let m = n - 1;
    for (let i = 0; i < n; i++) if (coupes[i] <= x + 0.5) m = i;
    const a = coupes[m];
    const b = m + 1 < n ? coupes[m + 1] : coupes[0] + T;
    let xx = x + 0.5;
    if (xx < a) xx += T;
    id[X] = m;
    d0[X] = xx - a;
    d1[X] = b - xx;
  }
  return { id, d0, d1 };
}

// ---------------------------------------------------------------- plancher : lames veinées, décalées

// Le plancher d'avant garde ses réglages par défaut ; les parquets et le pont de navire en changent (texturesPlus).
const BOIS_PLANCHER = [[150, 98, 56], [136, 88, 50], [160, 110, 64], [126, 82, 48], [144, 96, 58]];
function plancher(k, { graine = 41, H = PX / 4, BOIS = BOIS_PLANCHER, lmin = PX * 1.6, lmax = PX * 3.6, noeuds = 0.35, joint = 0.5 } = {}) {
  const T = PX * 6;
  const r = alea(graine);
  const veine = fbmPeriodique(T, 8, 3, graine === 41 ? 7 : graine + 1);
  const tache = fbmPeriodique(T, 4, 3, graine === 41 ? 9 : graine + 3);
  const rangs = [];
  for (let n = 0; n < T / H; n++) {
    const coupes = decouper(T, lmin, lmax, r);
    const lames = coupes.map(() => ({ teinte: r(), dec: r() * 50, noeud: r() < noeuds ? [r() * T, r()] : null }));
    rangs.push({ ...indexer(T, coupes, k), lames });
  }
  return peindrePixels(T, k, (x, y, d, o, X) => {
    const n = Math.min(rangs.length - 1, Math.floor(y / H));
    const ry = y - n * H;
    const rang = rangs[n];
    const lame = rang.lames[rang.id[X]];
    const b = BOIS[Math.floor(lame.teinte * BOIS.length)];
    let f = 0.92 + 0.16 * lame.teinte;
    // Veines : des lignes serrées qui ondulent le long de la lame.
    const g = veine(x, y * 6 + lame.dec * 4);
    const v = Math.abs(((ry * 0.55 + g * 5 + lame.dec) % 2) - 1);
    f *= 1 - 0.12 * clamp(1 - v * 4, 0, 1);
    f *= 0.94 + 0.12 * tache(x, y);
    if (lame.noeud) {
      const dx = ((((x - lame.noeud[0]) % T) + T + T / 2) % T) - T / 2;
      const dd = Math.hypot(dx / 2.2, ry - H * (0.3 + 0.4 * lame.noeud[1]));
      if (dd < 3.2) f *= 0.7 + 0.08 * dd;
      else if (dd < 6) f *= 1 - 0.05 * Math.sin(dd * 2.4);
    }
    // Joints entre rangs et bouts de lames, avec un léger chanfrein.
    if (ry < 1) f *= joint;
    else if (ry < 2) f *= 1.08;
    else if (ry > H - 2) f *= 0.84;
    const a0 = rang.d0[X];
    const a1 = rang.d1[X];
    const bout = Math.min(a0, a1);
    if (bout < 1) f *= 0.48;
    else if (bout < 2) f *= a0 < a1 ? 1.06 : 0.8;
    // Clous aux bouts des lames.
    if ((a0 > 3 && a0 < 5.5) || (a1 > 3 && a1 < 5.5)) {
      if (Math.abs(ry - H * 0.3) < 1.1 || Math.abs(ry - H * 0.72) < 1.1) f *= 0.55;
    }
    d[o] = b[0] * f;
    d[o + 1] = b[1] * f;
    d[o + 2] = b[2] * f;
  });
}

// ---------------------------------------------------------------- dalles : pierres irrégulières et leurs joints

function dallage(k, T, hmin, hmax, lmin, lmax, joint, teintes, graine, bombe) {
  const r = alea(graine);
  const tache = fbmPeriodique(T, 6, 4, graine + 3);
  const fin = fbmPeriodique(T, 24, 2, graine + 5);
  const mortier = fbmPeriodique(T, 12, 2, graine + 7);
  // Rangs de hauteurs variées, qui bouclent sur la période.
  const hauteurs = [];
  let s = 0;
  while (s < T - hmin) {
    const h = Math.min(hmin + r() * (hmax - hmin), T - s);
    hauteurs.push(h);
    s += h;
  }
  hauteurs[hauteurs.length - 1] += T - s;
  const rangs = [];
  let y0 = 0;
  for (const h of hauteurs) {
    const coupes = decouper(T, lmin, lmax, r);
    rangs.push({ y0, h, ...indexer(T, coupes, k), pierres: coupes.map(() => ({ t: r(), u: r(), pente: (r() - 0.5) * 0.12 })) });
    y0 += h;
  }
  // Le rang d'une ligne : celui où tombe le centre de ses pixels.
  const rangDe = (y) => {
    for (let n = rangs.length - 1; n > 0; n--) if (rangs[n].y0 <= y + 0.5) return n;
    return 0;
  };
  const demi = joint / 2;
  let rangY = -1;
  let g = null;
  return peindrePixels(T, k, (x, y, d, o, X, Y) => {
    if (Y !== rangY) {
      rangY = Y;
      g = rangs[rangDe(y)];
    }
    const dy0 = y + 0.5 - g.y0;
    const dy1 = g.y0 + g.h - y - 0.5;
    const p = g.pierres[g.id[X]];
    const dx0 = g.d0[X];
    const dx1 = g.d1[X];
    const dmin = Math.min(dx0, dx1, dy0, dy1);
    // Coins arrondis.
    const cx = Math.min(dx0, dx1);
    const cy = Math.min(dy0, dy1);
    const rc = 4;
    let dans = dmin > demi;
    if (dans && cx < rc + demi && cy < rc + demi) dans = Math.hypot(rc + demi - cx, rc + demi - cy) < rc;
    if (!dans) {
      const m = 0.85 + 0.25 * mortier(x, y);
      d[o] = 74 * m;
      d[o + 1] = 66 * m;
      d[o + 2] = 56 * m;
      return;
    }
    const b = teintes[Math.floor(p.t * teintes.length)];
    let f = 0.9 + 0.2 * p.u;
    f *= 0.9 + 0.16 * tache(x, y) + 0.08 * fin(x, y);
    f *= 1 + p.pente * ((dx0 - dx1) / 40 + (dy0 - dy1) / 40);
    // Chanfrein : bord nord-ouest éclairé, bord sud-est dans l'ombre.
    const bord = dmin - demi;
    if (bord < 3) {
      const q = 1 - bord / 3;
      if (dy0 <= dy1 && dy0 === dmin) f *= 1 + 0.14 * q;
      else if (dx0 <= dx1 && dx0 === dmin) f *= 1 + 0.1 * q;
      else f *= 1 - 0.22 * q;
    }
    if (bombe) {
      // Pavés bombés : un peu plus sombres sur leur pourtour.
      const nx = (dx0 - dx1) / (dx0 + dx1);
      const ny = (dy0 - dy1) / (dy0 + dy1);
      f *= 1 - 0.28 * Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 3) + 0.1 * (-nx - ny) * 0.5;
    }
    d[o] = b[0] * f;
    d[o + 1] = b[1] * f;
    d[o + 2] = b[2] * f;
  });
}

const PIERRES = [[136, 126, 110], [124, 116, 104], [144, 132, 114], [116, 110, 102], [132, 120, 102], [122, 114, 100]];
const PAVES = [[146, 136, 120], [134, 126, 112], [154, 142, 124], [126, 120, 108], [140, 128, 112]];
const MURAILLE = [[128, 122, 112], [116, 110, 102], [138, 130, 118], [106, 102, 96], [122, 114, 104]];

// ---------------------------------------------------------------- terre battue, paille, herbe, sable, roche, eau

// Cailloux posés en double sur les bords, pour que la texture se raccorde.
function cailloux(c, k, T, nb, graine, rmin, rmax, teinte) {
  const g = contexte(c, k);
  const r = alea(graine);
  for (let n = 0; n < nb; n++) {
    const x = r() * T;
    const y = r() * T;
    const rr = rmin + r() * (rmax - rmin);
    for (const [ox, oy] of [[0, 0], [T, 0], [-T, 0], [0, T], [0, -T]]) {
      g.fillStyle = "rgba(40,28,16,.35)";
      g.beginPath();
      g.ellipse(x + ox + 0.8, y + oy + 1, rr, rr * 0.75, r() * 3, 0, Math.PI * 2);
      g.fill();
      const v = teinte[0] + r() * teinte[1];
      g.fillStyle = `rgb(${v},${v * 0.94},${v * 0.86})`;
      g.beginPath();
      g.ellipse(x + ox, y + oy, rr, rr * 0.75, 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function terre(k, graine = 61, teinte = [124, 98, 70]) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 4, 4, graine);
  const t2 = fbmPeriodique(T, 32, 2, graine + 2);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    const f = 0.9 + 0.22 * t1(x, y) + 0.1 * t2(x, y);
    d[o] = teinte[0] * f;
    d[o + 1] = teinte[1] * f;
    d[o + 2] = teinte[2] * f;
  });
  cailloux(c, k, T, 70, graine + 9, 1.2, 3.8, [130, 50]);
  return c;
}

function brins(fond, k, nb, longueur, couleurs, graine, epaisseur = 1.2) {
  const T = fond.width / k;
  const g = contexte(fond, k);
  const r = alea(graine);
  g.lineCap = "round";
  for (let n = 0; n < nb; n++) {
    const x = r() * T;
    const y = r() * T;
    const a = r() * Math.PI * 2;
    const l = longueur[0] + r() * (longueur[1] - longueur[0]);
    const dx = Math.cos(a) * l;
    const dy = Math.sin(a) * l;
    g.strokeStyle = couleurs[Math.floor(r() * couleurs.length)];
    g.lineWidth = epaisseur * (0.7 + r() * 0.6);
    for (const [ox, oy] of [[0, 0], [T, 0], [-T, 0], [0, T], [0, -T], [T, T], [-T, -T], [T, -T], [-T, T]]) {
      if (ox && (x + ox + Math.min(0, dx) > T || x + ox + Math.max(0, dx) < 0)) continue;
      if (oy && (y + oy + Math.min(0, dy) > T || y + oy + Math.max(0, dy) < 0)) continue;
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + dx * 0.5 + dy * 0.08, y + oy + dy * 0.5 - dx * 0.08, x + ox + dx, y + oy + dy);
      g.stroke();
    }
  }
}

function paille(k) {
  const c = terre(k, 71, [118, 92, 52]);
  brins(c, k, 1100, [8, 22], ["rgba(214,184,104,.9)", "rgba(196,160,80,.9)", "rgba(232,206,132,.85)", "rgba(170,132,62,.9)"], 5, 1.4);
  brins(c, k, 500, [6, 16], ["rgba(240,218,150,.9)", "rgba(206,170,90,.9)"], 6, 1.1);
  return c;
}

function herbe(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 4, 4, 81);
  const t2 = fbmPeriodique(T, 16, 2, 83);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    const a = 0.5 + 0.5 * t1(x, y);
    const f = 0.9 + 0.15 * t2(x, y);
    d[o] = (92 + 18 * a) * f;
    d[o + 1] = (114 + 14 * a) * f;
    d[o + 2] = (54 + 4 * a) * f;
  });
  brins(c, k, 2600, [3, 7], ["rgba(70,96,40,.8)", "rgba(132,156,72,.7)", "rgba(58,82,34,.8)"], 85, 1);
  return c;
}

function sable(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 4, 3, 91);
  const grain = fbmPeriodique(T, 64, 1, 93);
  const ride = fbmPeriodique(T, 4, 2, 95);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    // Rides couchées par le vent, ondulées, et un grain fin.
    const onde = Math.sin(((y + ride(x, y) * 40) / T) * Math.PI * 2 * 14);
    const f = 0.93 + 0.1 * t1(x, y) + 0.05 * onde + 0.07 * grain(x, y);
    d[o] = 201 * f;
    d[o + 1] = 178 * f;
    d[o + 2] = 132 * f;
  });
  cailloux(c, k, T, 18, 97, 0.8, 1.8, [150, 60]);
  return c;
}

function roche(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 3, 4, 101);
  const t2 = fbmPeriodique(T, 24, 2, 103);
  const fente = fbmPeriodique(T, 5, 3, 105);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    // Une roche bosselée, fendue de lignes sombres (le bruit qui passe par zéro).
    const a = t1(x, y);
    let f = 0.84 + 0.32 * a + 0.1 * t2(x, y);
    const z = Math.abs(fente(x, y));
    if (z < 0.022) f *= 0.6 + 12 * z;
    else if (z < 0.05) f *= 1.07;
    d[o] = (112 + 10 * a) * f;
    d[o + 1] = (100 + 4 * a) * f;
    d[o + 2] = (86 - 4 * a) * f;
  });
  cailloux(c, k, T, 40, 107, 1.4, 4.2, [96, 40]);
  return c;
}

function eau(k) {
  const T = PX * 4;
  const fond = fbmPeriodique(T, 3, 3, 111);
  const houle = fbmPeriodique(T, 4, 2, 113);
  const eclat = fbmPeriodique(T, 12, 2, 115);
  return peindrePixels(T, k, (x, y, d, o) => {
    // Profondeur changeante, et de petites rides couchées dont la crête accroche la lumière, par endroits.
    const p = 0.5 + 0.5 * fond(x, y);
    const onde = Math.sin(((y + houle(x, y) * 26) / T) * Math.PI * 2 * 22);
    const crete = onde > 0.82 ? (onde - 0.82) / 0.18 : 0;
    const reflet = crete * Math.max(0, eclat(x, y) + 0.1) * 0.9;
    const creux = onde < -0.7 ? 0.06 : 0;
    d[o] = (30 + 22 * p) * (1 - creux) + 110 * reflet;
    d[o + 1] = (64 + 30 * p) * (1 - creux) + 118 * reflet;
    d[o + 2] = (84 + 32 * p) * (1 - creux) + 112 * reflet;
  });
}

function marbre(k) {
  const T = PX * 2;
  const C = PX / 2; // un carreau de 75 cm
  const veine = fbmPeriodique(T, 3, 4, 121);
  const tache = fbmPeriodique(T, 6, 3, 123);
  return peindrePixels(T, k, (x, y, d, o) => {
    const i = Math.floor(x / C);
    const j = Math.floor(y / C);
    const fx = x - i * C;
    const fy = y - j * C;
    const sombre = (i + j) % 2 === 1;
    const base = sombre ? [178, 172, 162] : [228, 222, 210];
    let f = 0.96 + 0.06 * tache(x, y);
    const v = Math.abs(Math.sin((x + y) / 22 + veine(x, y) * 7));
    if (v < 0.06) f *= 0.82 + 3 * v;
    if (fx < 0.8 || fy < 0.8) f *= 0.62;
    else if (fx < 1.8 || fy < 1.8) f *= 1.05;
    else if (fx > C - 1.8 || fy > C - 1.8) f *= 0.9;
    d[o] = base[0] * f;
    d[o + 1] = base[1] * f;
    d[o + 2] = base[2] * f;
  });
}

const FABRIQUES = {
  plancher: (k) => plancher(k),
  pierre: (k) => dallage(k, PX * 6, 26, 42, 34, 74, 3.2, PIERRES, 51, false),
  paves: (k) => dallage(k, PX * 4, 17, 21, 15, 26, 3, PAVES, 53, true),
  terre: (k) => terre(k),
  paille,
  herbe,
  sable,
  roche,
  eau,
  marbre,
  muraille: (k) => dallage(k, PX * 2, 13, 19, 20, 38, 2.6, MURAILLE, 57, false),
};

// ---------------------------------------------------------------- les sols ajoutés le 09/11

// Tomettes : des hexagones de terre cuite (un réseau décalé dont chaque case prend le centre le plus proche).
function tomettes(k) {
  const T = PX * 3;
  const n = 9;
  const m = 10;
  const dx = T / n;
  const dy = T / m;
  const r = alea(131);
  const teintes = [];
  for (let i = 0; i < n * m; i++) teintes.push([r(), r()]);
  const tache = fbmPeriodique(T, 6, 3, 133);
  return peindrePixels(T, k, (x, y, d, o) => {
    const j0 = Math.floor(y / dy);
    let a = 1e9;
    let b = 1e9;
    let id = 0;
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      const jj = ((j % m) + m) % m;
      const dec = jj % 2 ? 0.5 : 0;
      const cy = (j + 0.5) * dy;
      const i0 = Math.floor(x / dx - dec);
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const cx = (i + 0.5 + dec) * dx;
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd < a) {
          b = a;
          a = dd;
          id = jj * n + (((i % n) + n) % n);
        } else if (dd < b) b = dd;
      }
    }
    const joint = Math.sqrt(b) - Math.sqrt(a);
    const t = teintes[id];
    let f = 0.9 + 0.14 * t[1] + 0.08 * tache(x, y);
    if (joint < 1.3) {
      d[o] = 96 * f;
      d[o + 1] = 80 * f;
      d[o + 2] = 64 * f;
      return;
    }
    if (joint < 2.6) f *= 0.88;
    d[o] = (162 + 26 * t[0]) * f;
    d[o + 1] = (84 + 20 * t[0]) * f;
    d[o + 2] = (56 + 10 * t[0]) * f;
  });
}

// Un tapis d'un mur à l'autre : la laine, sa trame, un losange par case et un médaillon à chaque croisement.
function tapisSol(k) {
  const T = PX * 2;
  const grain = fbmPeriodique(T, 64, 1, 141);
  const tache = fbmPeriodique(T, 4, 3, 143);
  return peindrePixels(T, k, (x, y, d, o) => {
    const u = (x / PX) % 1;
    const v = (y / PX) % 1;
    let f = 0.93 + 0.07 * grain(x, y) + 0.05 * tache(x, y);
    f *= (Math.floor(x / 1.5) + Math.floor(y / 1.5)) % 2 ? 1.025 : 0.975;
    const l = Math.abs(Math.abs(u - 0.5) + Math.abs(v - 0.5) - 0.5);
    if (l < 0.016) f *= 1.42;
    else if (l < 0.034) f *= 0.82;
    const c = Math.hypot(u - 0.5, v - 0.5);
    if (c < 0.06) f *= 1.32;
    else if (c < 0.085) f *= 0.84;
    d[o] = 124 * f;
    d[o + 1] = 44 * f;
    d[o + 2] = 36 * f;
  });
}

function boue(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 4, 4, 161);
  const t2 = fbmPeriodique(T, 32, 2, 163);
  const flaque = fbmPeriodique(T, 3, 3, 165);
  const ride = fbmPeriodique(T, 14, 2, 167);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    let f = 0.86 + 0.24 * t1(x, y) + 0.1 * t2(x, y);
    let col = [94, 72, 50];
    const p = flaque(x, y);
    if (p > 0.34) {
      // L'eau qui stagne dans les creux : plus sombre, un reflet qui ride.
      const q = Math.min(1, (p - 0.34) / 0.08);
      col = col.map((v, i) => v + ([74, 76, 68][i] - v) * q);
      f = f * (1 - 0.06 * q) + 0.2 * q * Math.max(0, ride(x, y));
    } else if (p > 0.26) f *= 0.86;
    d[o] = col[0] * f;
    d[o + 1] = col[1] * f;
    d[o + 2] = col[2] * f;
  });
  cailloux(c, k, T, 24, 169, 1, 2.6, [96, 40]);
  return c;
}

function neige(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 3, 4, 171);
  const t2 = fbmPeriodique(T, 16, 2, 173);
  const eclat = fbmPeriodique(T, 64, 1, 175);
  return peindrePixels(T, k, (x, y, d, o) => {
    // Des congères douces, leurs creux bleutés, quelques cristaux qui brillent.
    const a = t1(x, y);
    const f = 0.94 + 0.06 * a + 0.03 * t2(x, y);
    const ombre = Math.max(0, -a);
    const e = eclat(x, y) > 0.6 ? 18 : 0;
    d[o] = 236 * f - 70 * ombre + e;
    d[o + 1] = 240 * f - 48 * ombre + e;
    d[o + 2] = 246 * f - 14 * ombre + e;
  });
}

function glace(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 3, 3, 181);
  const fente = fbmPeriodique(T, 4, 3, 183);
  const fente2 = fbmPeriodique(T, 7, 2, 185);
  const strie = fbmPeriodique(T, 2, 2, 187);
  return peindrePixels(T, k, (x, y, d, o) => {
    const a = 0.5 + 0.5 * t1(x, y);
    let f = 0.9 + 0.14 * a;
    const z = Math.min(Math.abs(fente(x, y)), Math.abs(fente2(x, y)) * 1.4);
    let blanc = 0;
    if (z < 0.012) blanc = 0.5;
    else if (z < 0.026) f *= 0.9;
    const s = Math.sin(((x + y + strie(x, y) * 60) / T) * Math.PI * 2 * 6);
    if (s > 0.93) blanc += 0.14;
    d[o] = (148 + 30 * a) * f + 100 * blanc;
    d[o + 1] = (184 + 22 * a) * f + 70 * blanc;
    d[o + 2] = (204 + 18 * a) * f + 50 * blanc;
  });
}

function feuilles(k) {
  const T = PX * 4;
  const c = terre(k, 191, [70, 54, 36]);
  const g = contexte(c, k);
  const r = alea(193);
  const teintes = [[184, 116, 44], [154, 82, 34], [201, 160, 64], [110, 68, 32], [170, 60, 30], [120, 110, 50]];
  for (let n = 0; n < 650; n++) {
    const x = r() * T;
    const y = r() * T;
    const l = 4 + r() * 5;
    const a = r() * Math.PI * 2;
    const t = teintes[Math.floor(r() * teintes.length)];
    const v = 0.8 + r() * 0.35;
    for (const [ox, oy] of [[0, 0], [T, 0], [-T, 0], [0, T], [0, -T], [T, T], [-T, -T], [T, -T], [-T, T]]) {
      if (Math.abs(x + ox - T / 2) > T / 2 + l || Math.abs(y + oy - T / 2) > T / 2 + l) continue;
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      g.fillStyle = "rgba(20,12,6,.35)";
      g.beginPath();
      g.ellipse(0.8, 1, l, l * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgb(${t.map((q) => Math.round(q * v))})`;
      g.beginPath();
      g.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(40,20,8,.35)";
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(-l, 0);
      g.lineTo(l, 0);
      g.stroke();
      g.restore();
    }
  }
  return c;
}

function mousse(k) {
  const T = PX * 4;
  const t1 = fbmPeriodique(T, 6, 4, 201);
  const t2 = fbmPeriodique(T, 32, 2, 203);
  const creux = fbmPeriodique(T, 5, 3, 205);
  const c = peindrePixels(T, k, (x, y, d, o) => {
    const a = 0.5 + 0.5 * t1(x, y);
    let f = 0.8 + 0.32 * a + 0.12 * t2(x, y);
    const z = Math.abs(creux(x, y));
    if (z < 0.03) f *= 0.55 + 15 * z;
    d[o] = (70 + 22 * a) * f;
    d[o + 1] = (94 + 26 * a) * f;
    d[o + 2] = (44 + 8 * a) * f;
  });
  brins(c, k, 900, [2, 4], ["rgba(150,180,90,.6)", "rgba(60,90,36,.6)"], 207, 1.4);
  return c;
}

const DALLES = [[156, 150, 138], [146, 140, 130], [164, 156, 142], [140, 136, 128], [152, 144, 132]];
Object.assign(FABRIQUES, {
  "parquet-clair": (k) => plancher(k, { graine: 43, H: PX / 5, BOIS: [[196, 156, 108], [186, 146, 100], [204, 166, 118], [178, 140, 96], [192, 152, 106]], lmin: PX * 1.2, lmax: PX * 2.4, noeuds: 0.2 }),
  "parquet-sombre": (k) => plancher(k, { graine: 47, H: PX / 5, BOIS: [[104, 68, 42], [94, 60, 36], [112, 74, 46], [86, 56, 34], [100, 64, 40]], lmin: PX * 1.2, lmax: PX * 2.4, noeuds: 0.25 }),
  pont: (k) => plancher(k, { graine: 53, H: PX / 6, BOIS: [[138, 112, 84], [128, 104, 78], [146, 118, 88], [120, 98, 74], [134, 108, 80]], lmin: PX * 3, lmax: PX * 5.6, noeuds: 0.15, joint: 0.28 }),
  dalles: (k) => dallage(k, PX * 4, 30, 34, 30, 36, 2.6, DALLES, 59, false),
  tomettes,
  tapis: tapisSol,
  gravier: (k) => {
    const c = terre(k, 151, [118, 110, 96]);
    cailloux(c, k, PX * 4, 900, 153, 0.8, 2.2, [118, 70]);
    return c;
  },
  boue,
  feuilles,
  mousse,
  neige,
  glace,
});
// Les sols des plans extérieurs (10/11, dehors-peint.js), avec les mêmes outils.
Object.assign(FABRIQUES, fabriquesDehors({ PX, fbmPeriodique, peindrePixels, cailloux, terre, contexte, alea }));

// La teinte d'un sol (piece.teinte) : la couleur choisie, avec le grain de la texture (sa clarté rapportée à la
// moyenne) ; les joints restent sombres, les reflets clairs.
function teinter(source, hex) {
  const n = parseInt(hex.slice(1), 16);
  const t = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const c = toile(source.width, source.height);
  const g = c.getContext("2d");
  g.drawImage(source, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let somme = 0;
  for (let i = 0; i < d.length; i += 4) somme += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const moyenne = somme / (d.length / 4) || 1;
  for (let i = 0; i < d.length; i += 4) {
    const f = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / moyenne;
    d[i] = t[0] * f;
    d[i + 1] = t[1] * f;
    d[i + 2] = t[2] * f;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Réduction de moitié : au demi-pixel près, le lissage simple fait la moyenne exacte de quatre pixels, sans déborder
// sur le bord opposé ; la texture reste raccordable.
function reduire(c) {
  const d = toile(c.width / 2, c.height / 2);
  const g = d.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "low";
  g.drawImage(c, 0, 0, d.width, d.height);
  return d;
}

const cache = new Map();
// Temps passé à calculer les textures, pour les mesures.
export const mesures = { textures: 0 };
let profondeur = 0;

// La texture d'un sol à px pixels par case (16, 32, 64 ou 128), calculée à la première demande ; teinte : celle
// d'une pièce (#rrggbb), ou rien.
export function texture(cle, px = PX, teinte = null) {
  if (!FABRIQUES[cle]) cle = "terre";
  const nom = teinte ? `${cle}:${px}:${teinte}` : `${cle}:${px}`;
  if (!cache.has(nom)) {
    const t0 = performance.now();
    profondeur++;
    try {
      if (teinte) cache.set(nom, teinter(texture(cle, px), teinte));
      else cache.set(nom, px < PX ? reduire(texture(cle, px * 2)) : FABRIQUES[cle](px / PX));
    } finally {
      profondeur--;
    }
    if (!profondeur) mesures.textures += performance.now() - t0;
  }
  return cache.get(nom);
}

// La finesse à employer pour S pixels d'écran par case : la plus petite qui ne s'agrandit pas trop.
export function finesse(S, hautes = true) {
  let px = NIVEAUX[0];
  for (const n of NIVEAUX) {
    if (n > PX && !hautes) break;
    px = n;
    if (n >= S * 0.8) break;
  }
  return px;
}

// Motif à poser dans un contexte dont l'unité est la case, à S pixels d'écran par case.
export function motif(ctx, cle, S, hautes = true, teinte = null) {
  const px = finesse(S, hautes);
  const p = ctx.createPattern(texture(cle, px, teinte), "repeat");
  p.setTransform(new DOMMatrix([1 / px, 0, 0, 1 / px, 0, 0]));
  return p;
}
