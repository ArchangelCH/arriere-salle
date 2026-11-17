// Outils numériques partagés : hasard reproductible, bruit, flou, isolignes, lissage, distances, chemins.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lisse = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry32(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Valeur pseudo-aléatoire stable pour un point entier : un même arbre reste au même endroit d'un rendu à l'autre.
export function hacher(x, y, s = 0) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((y | 0) + 0x632be5ab) | 0, 0xc2b2ae35) ^ Math.imul(s | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function creerBruit(graine) {
  const alea = mulberry32(graine);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const grad = (h, x, y) => GX[h & 7] * x + GY[h & 7] * y;
  const fondu = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function bruit(x, y) {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;
    const xi = X & 255;
    const yi = Y & 255;
    const aa = perm[perm[xi] + yi];
    const ba = perm[perm[xi + 1] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const bb = perm[perm[xi + 1] + yi + 1];
    const u = fondu(xf);
    const v = fondu(yf);
    const g1 = grad(aa, xf, yf);
    const g2 = grad(ba, xf - 1, yf);
    const g3 = grad(ab, xf, yf - 1);
    const g4 = grad(bb, xf - 1, yf - 1);
    const h1 = g1 + u * (g2 - g1);
    const h2 = g3 + u * (g4 - g3);
    return h1 + v * (h2 - h1);
  }

  function fbm(x, y, octaves = 4, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let somme = 0;
    let norme = 0;
    for (let i = 0; i < octaves; i++) {
      somme += amp * bruit(x * freq + i * 19.3, y * freq - i * 7.7);
      norme += amp;
      amp *= gain;
      freq *= 2.03;
    }
    return somme / norme;
  }

  // Crêtes : 1 sur la ligne de faîte, 0 loin d'elle.
  function crete(x, y, octaves = 4) {
    let amp = 1;
    let freq = 1;
    let somme = 0;
    let norme = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(bruit(x * freq + i * 31.1, y * freq + i * 11.9));
      somme += amp * n * n;
      norme += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return somme / norme;
  }

  return { bruit, fbm, crete };
}

// Flou boîte séparable, répété pour approcher un flou gaussien.
export function flouter(source, w, h, r, passes = 2) {
  let a = Float32Array.from(source);
  if (r <= 0) return a;
  const b = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[o + clamp(i, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[o + x] = s / n;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += b[clamp(i, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n;
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// Flou d'une image RGBA prémultipliée (Uint8ClampedArray), sans dépendre de ctx.filter.
export function flouterImage(data, w, h, r, passes = 2) {
  const canaux = [0, 1, 2, 3].map(() => new Float32Array(w * h));
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    canaux[0][i] = data[i * 4] * a;
    canaux[1][i] = data[i * 4 + 1] * a;
    canaux[2][i] = data[i * 4 + 2] * a;
    canaux[3][i] = data[i * 4 + 3];
  }
  const f = canaux.map((c) => flouter(c, w, h, r, passes));
  for (let i = 0; i < w * h; i++) {
    const al = f[3][i];
    const a = al / 255;
    data[i * 4] = a > 0.001 ? f[0][i] / a : 0;
    data[i * 4 + 1] = a > 0.001 ? f[1][i] / a : 0;
    data[i * 4 + 2] = a > 0.001 ? f[2][i] / a : 0;
    data[i * 4 + 3] = al;
  }
}

// Isolignes par carrés marchants. Renvoie des polylignes en coordonnées de grille.
export function isolignes(champ, W, H, seuil) {
  const pos = new Map();
  const adj = new Map();
  const bordH = (i, j) => {
    const k = 2 * (j * W + i);
    if (!pos.has(k)) {
      const a = champ[j * W + i];
      const b = champ[j * W + i + 1];
      pos.set(k, [i + (seuil - a) / (b - a), j]);
    }
    return k;
  };
  const bordV = (i, j) => {
    const k = 2 * (j * W + i) + 1;
    if (!pos.has(k)) {
      const a = champ[j * W + i];
      const b = champ[(j + 1) * W + i];
      pos.set(k, [i, j + (seuil - a) / (b - a)]);
    }
    return k;
  };
  const lier = (k1, k2) => {
    let l = adj.get(k1);
    if (!l) adj.set(k1, (l = []));
    l.push(k2);
    let m = adj.get(k2);
    if (!m) adj.set(k2, (m = []));
    m.push(k1);
  };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = champ[j * W + i];
      const b = champ[j * W + i + 1];
      const c = champ[(j + 1) * W + i + 1];
      const d = champ[(j + 1) * W + i];
      const cas = (a > seuil ? 8 : 0) | (b > seuil ? 4 : 0) | (c > seuil ? 2 : 0) | (d > seuil ? 1 : 0);
      if (cas === 0 || cas === 15) continue;
      switch (cas) {
        case 1: case 14: lier(bordV(i, j), bordH(i, j + 1)); break;
        case 2: case 13: lier(bordH(i, j + 1), bordV(i + 1, j)); break;
        case 3: case 12: lier(bordV(i, j), bordV(i + 1, j)); break;
        case 4: case 11: lier(bordH(i, j), bordV(i + 1, j)); break;
        case 6: case 9: lier(bordH(i, j), bordH(i, j + 1)); break;
        case 7: case 8: lier(bordV(i, j), bordH(i, j)); break;
        case 5: case 10: {
          const centre = (a + b + c + d) / 4 > seuil;
          if ((cas === 5) === centre) {
            lier(bordH(i, j), bordV(i, j));
            lier(bordH(i, j + 1), bordV(i + 1, j));
          } else {
            lier(bordH(i, j), bordV(i + 1, j));
            lier(bordV(i, j), bordH(i, j + 1));
          }
          break;
        }
      }
    }
  }
  const vus = new Set();
  const suivre = (depart) => {
    const pts = [depart];
    vus.add(depart);
    let cur = depart;
    for (;;) {
      let suivant = -1;
      for (const v of adj.get(cur)) {
        if (!vus.has(v)) {
          suivant = v;
          break;
        }
      }
      if (suivant < 0) break;
      vus.add(suivant);
      pts.push(suivant);
      cur = suivant;
    }
    return pts.map((k) => pos.get(k));
  };
  const lignes = [];
  for (const [k, v] of adj) if (v.length === 1 && !vus.has(k)) lignes.push({ points: suivre(k), ferme: false });
  for (const [k] of adj) if (!vus.has(k)) lignes.push({ points: suivre(k), ferme: true });
  return lignes;
}

// Lissage de Chaikin, sur des points de dimension quelconque ([x, y] ou [x, y, largeur]).
export function chaikin(points, ferme, iterations = 2) {
  let p = points;
  for (let it = 0; it < iterations; it++) {
    const n = p.length;
    if (n < 3) return p;
    const q = [];
    if (!ferme) q.push(p[0]);
    const fin = ferme ? n : n - 1;
    for (let i = 0; i < fin; i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      q.push(a.map((v, k) => 0.75 * v + 0.25 * b[k]));
      q.push(a.map((v, k) => 0.25 * v + 0.75 * b[k]));
    }
    if (!ferme) q.push(p[n - 1]);
    p = q;
  }
  return p;
}

// Douglas-Peucker : retire les points inutiles d'une polyligne.
export function simplifier(points, eps) {
  if (points.length < 3) return points.slice();
  const garde = new Uint8Array(points.length);
  garde[0] = garde[points.length - 1] = 1;
  const pile = [[0, points.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / l;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > eps && idx > 0) {
      garde[idx] = 1;
      pile.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => garde[i]);
}

// Distance (en cases de grille) au plus proche point source, par chanfrein deux passes.
export function distanceDepuis(sources, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = sources[i] ? 0 : INF;
  const r2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + r2);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + r2);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + r2);
        if (x > 0) v = Math.min(v, d[i + W - 1] + r2);
      }
      d[i] = v;
    }
  }
  return d;
}

class Tas {
  constructor() {
    this.cles = [];
    this.vals = [];
  }
  get taille() {
    return this.cles.length;
  }
  pousser(cle, val) {
    const c = this.cles;
    const v = this.vals;
    let i = c.length;
    c.push(cle);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  sortir() {
    const c = this.cles;
    const v = this.vals;
    const val = v[0];
    const dernierC = c.pop();
    const dernierV = v.pop();
    if (c.length) {
      c[0] = dernierC;
      v[0] = dernierV;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1;
        const d = g + 1;
        let m = i;
        if (g < c.length && c[g] < c[m]) m = g;
        if (d < c.length && c[d] < c[m]) m = d;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return val;
  }
}

export { Tas };

// A* sur la grille des cases, 8 voisins. cout(i) = coût de traversée d'une case (Infinity = infranchissable).
export function cheminLePlusSur(W, H, cout, depart, arrivee) {
  const n = W * H;
  const g = new Float32Array(n).fill(Infinity);
  const venant = new Int32Array(n).fill(-1);
  const ferme = new Uint8Array(n);
  const [ax, ay] = [arrivee % W, Math.floor(arrivee / W)];
  const h = (i) => Math.hypot((i % W) - ax, Math.floor(i / W) - ay) * 0.9;
  const tas = new Tas();
  g[depart] = 0;
  tas.pousser(h(depart), depart);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (tas.taille) {
    const i = tas.sortir();
    if (i === arrivee) break;
    if (ferme[i]) continue;
    ferme[i] = 1;
    const x = i % W;
    const y = (i - x) / W;
    const ci = cout(i);
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (ferme[j]) continue;
      const cj = cout(j);
      if (!isFinite(cj)) continue;
      const pas = (k < 4 ? 1 : Math.SQRT2) * (ci + cj) * 0.5;
      const ng = g[i] + pas;
      if (ng < g[j]) {
        g[j] = ng;
        venant[j] = i;
        tas.pousser(ng + h(j), j);
      }
    }
  }
  if (venant[arrivee] < 0 && arrivee !== depart) return null;
  const chemin = [];
  for (let i = arrivee; i >= 0; i = venant[i]) {
    chemin.push(i);
    if (i === depart) break;
  }
  return chemin.reverse();
}

export function versBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function depuisBase64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function distanceSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
