// Tout ce qui se déduit du terrain peint : contours organiques, côtes, vagues, lavis, relief, symboles.

import { BIOMES, B, PALETTES, SYMBOLES } from "./biomes.js";
import { chaikin, clamp, creerBruit, distanceDepuis, flouter, flouterImage, hacher, isolignes, lisse } from "./geo.js";

export const SOUS = 3; // sous-cases par case pour les côtes et les lavis
const SEAU = 8; // taille des paquets de symboles, en cases

const EAU = new Uint8Array(32);
const SYMBOLE_DE = [];
for (const b of BIOMES) {
  EAU[b.id] = b.eau ? 1 : 0;
  SYMBOLE_DE[b.id] = b.symbole;
}
const MONTAGNEUX = new Set([B.montagnes, B.sommets, B.volcan]);
const BIOMES_DU_SYMBOLE = {};
for (const b of BIOMES) if (b.symbole) (BIOMES_DU_SYMBOLE[b.symbole] ||= []).push(b.id);

function toile(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function boite(points) {
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
  return { x0, y0, x1, y1 };
}

export class Champs {
  constructor(carte) {
    this.carte = carte;
    this.w = carte.largeur;
    this.h = carte.hauteur;
    this.W = this.w * SOUS;
    this.H = this.h * SOUS;
    this.bruit = creerBruit(((carte.graine | 0) + 7919) >>> 0);
    this.biomeSous = new Uint8Array(this.W * this.H);
    this.voies = new Uint8Array(this.W * this.H);
    this.seaux = new Map();
    this.lavisCache = {};
    this.reliefToile = null;
    this.brouillardToile = null;
    this.cotesPerimees = false;
    this.majTout();
  }

  majTout() {
    this.calculerSous(0, 0, this.w, this.h);
    this.calculerCotes();
    this.calculerElevation();
    this.calculerVoies();
    this.seaux.clear();
    this.lavisCache = {};
    this.reliefToile = null;
    this.brouillardToile = null;
  }

  // Terrain modifié dans une zone (en cases). Les côtes sont recalculées à part, car c'est le plus long.
  majZone(x0, y0, x1, y1) {
    const zx0 = Math.max(0, Math.floor(x0) - 2);
    const zy0 = Math.max(0, Math.floor(y0) - 2);
    const zx1 = Math.min(this.w, Math.ceil(x1) + 2);
    const zy1 = Math.min(this.h, Math.ceil(y1) + 2);
    this.calculerSous(zx0, zy0, zx1, zy1);
    for (const style of Object.keys(this.lavisCache)) this.peindreLavis(style, zx0 * SOUS, zy0 * SOUS, zx1 * SOUS, zy1 * SOUS);
    this.invalider(zx0, zy0, zx1, zy1);
    this.cotesPerimees = true;
  }

  // zone (en cases) : là où la profondeur de l'eau a pu changer ; sans zone, toute la carte.
  majCotes(zone) {
    this.calculerCotes();
    const z = zone
      ? [(zone.x0 - 8) * SOUS, (zone.y0 - 8) * SOUS, (zone.x1 + 8) * SOUS, (zone.y1 + 8) * SOUS]
      : [0, 0, this.W, this.H];
    for (const style of Object.keys(this.lavisCache)) this.peindreLavis(style, ...z);
    this.cotesPerimees = false;
  }

  // Fin d'un coup de pinceau : relief, tailles des montagnes et côtes, recalculés une seule fois.
  finTrait(zone, eau) {
    this.calculerElevation();
    this.reliefToile = null;
    if (eau) this.majCotes(zone);
    this.invalider(zone.x0 - 3, zone.y0 - 3, zone.x1 + 3, zone.y1 + 3);
  }

  majBrouillard() {
    this.brouillardToile = null;
  }

  majVoies(zone) {
    this.calculerVoies();
    if (zone) this.invalider(zone.x0 - 1, zone.y0 - 1, zone.x1 + 1, zone.y1 + 1);
    else this.seaux.clear();
  }

  invalider(x0, y0, x1, y1) {
    const bx0 = Math.max(0, Math.floor((x0 - 1) / SEAU));
    const by0 = Math.max(0, Math.floor((y0 - 1) / SEAU));
    const bx1 = Math.floor((x1 + 1) / SEAU);
    const by1 = Math.floor((y1 + 1) / SEAU);
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.seaux.delete(by * 4096 + bx);
  }

  // Chaque sous-case lit le terrain un peu à côté d'elle, décalée par un bruit : les limites deviennent organiques.
  calculerSous(x0, y0, x1, y1) {
    const { W, w, h } = this;
    const t = this.carte.terrain;
    const b = this.bruit.bruit;
    const I0 = Math.max(0, x0 * SOUS);
    const J0 = Math.max(0, y0 * SOUS);
    const I1 = Math.min(this.W, x1 * SOUS);
    const J1 = Math.min(this.H, y1 * SOUS);
    for (let J = J0; J < J1; J++) {
      const y = (J + 0.5) / SOUS;
      for (let I = I0; I < I1; I++) {
        const x = (I + 0.5) / SOUS;
        const dx = 0.85 * b(x * 0.33 + 17.1, y * 0.33 + 3.7) + 0.32 * b(x * 0.97 + 5.3, y * 0.97 + 41.2);
        const dy = 0.85 * b(x * 0.33 + 71.9, y * 0.33 + 23.1) + 0.32 * b(x * 0.97 + 13.7, y * 0.97 + 7.9);
        let cx = Math.floor(x + dx);
        let cy = Math.floor(y + dy);
        cx = cx < 0 ? 0 : cx >= w ? w - 1 : cx;
        cy = cy < 0 ? 0 : cy >= h ? h - 1 : cy;
        this.biomeSous[J * W + I] = t[cy * w + cx];
      }
    }
  }

  biomeA(x, y) {
    const I = clamp(Math.floor(x * SOUS), 0, this.W - 1);
    const J = clamp(Math.floor(y * SOUS), 0, this.H - 1);
    return this.biomeSous[J * this.W + I];
  }

  calculerCotes() {
    const { W, H } = this;
    const n = W * H;
    const terre = new Float32Array(n);
    const source = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const sec = EAU[this.biomeSous[i]] ? 0 : 1;
      terre[i] = sec;
      source[i] = sec;
    }
    const versCases = (l) => {
      const points = chaikin(l.points.map(([x, y]) => [(x + 0.5) / SOUS, (y + 0.5) / SOUS]), l.ferme, 1);
      return { ferme: l.ferme, points, boite: boite(points) };
    };
    this.cotes = isolignes(flouter(terre, W, H, 1, 1), W, H, 0.5).filter((l) => l.points.length > 3).map(versCases);
    const d = flouter(distanceDepuis(source, W, H), W, H, 1, 1);
    this.distEau = d;
    this.vagues = [0.55, 1.15, 1.9].map((c) =>
      isolignes(d, W, H, c * SOUS).filter((l) => l.points.length > 12).map(versCases),
    );
  }

  calculerElevation() {
    const { w, h } = this;
    const t = this.carte.terrain;
    const b = this.bruit;
    const e = new Float32Array(w * h);
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const k = t[i];
        e[i] = BIOMES[k].hauteur + 0.07 * b.fbm(x / 7 + 3.1, y / 7 - 5.3, 3);
        m[i] = MONTAGNEUX.has(k) ? 1 : 0;
      }
    }
    this.elev = flouter(e, w, h, 1, 2);
    this.mont = flouter(m, w, h, 2, 2);
  }

  echantillon(champ, x, y) {
    const { w, h } = this;
    const fx = clamp(x - 0.5, 0, w - 1.001);
    const fy = clamp(y - 0.5, 0, h - 1.001);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const i = iy * w + ix;
    const a = champ[i] + (champ[i + 1] - champ[i]) * tx;
    const c = champ[i + w] + (champ[i + w + 1] - champ[i + w]) * tx;
    return a + (c - a) * ty;
  }

  // Les arbres et les montagnes s'écartent des rivières, des routes et des lieux.
  calculerVoies() {
    this.voies.fill(0);
    for (const tr of this.carte.traces || []) {
      if (tr.type === "frontiere" || !tr.points || tr.points.length < 2) continue;
      const pts = chaikin(tr.points, false, 2);
      const [l0, l1] = tr.largeur || [0.16, 0.4];
      const n = pts.length;
      for (let i = 0; i < n - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const larg = pts[i].length > 2 ? pts[i][2] : l0 + (l1 - l0) * (i / Math.max(1, n - 1));
        const r = tr.type === "riviere" ? larg / 2 + 0.28 : tr.type === "route" ? 0.34 : 0.26;
        const pas = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
        for (let k = 0; k <= pas; k++) this.tamponner(ax + ((bx - ax) * k) / pas, ay + ((by - ay) * k) / pas, r);
      }
    }
    for (const m of this.carte.marqueurs || []) this.tamponner(m.x, m.y - 0.3 * (m.taille || 1), 1.05 * (m.taille || 1));
  }

  tamponner(x, y, r) {
    const { W, H } = this;
    const I0 = Math.max(0, Math.floor((x - r) * SOUS));
    const I1 = Math.min(W - 1, Math.ceil((x + r) * SOUS));
    const J0 = Math.max(0, Math.floor((y - r) * SOUS));
    const J1 = Math.min(H - 1, Math.ceil((y + r) * SOUS));
    const r2 = r * r * SOUS * SOUS;
    const cx = x * SOUS;
    const cy = y * SOUS;
    for (let J = J0; J <= J1; J++) {
      for (let I = I0; I <= I1; I++) {
        const dx = I + 0.5 - cx;
        const dy = J + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.voies[J * W + I] = 1;
      }
    }
  }

  lavis(style) {
    let c = this.lavisCache[style];
    if (!c) {
      c = this.lavisCache[style] = { terre: toile(this.w, this.h), eau: toile(this.W, this.H), neige: toile(this.w, this.h) };
      this.peindreLavis(style, 0, 0, this.W, this.H);
    }
    return c;
  }

  // Zone en sous-cases. Terres et neige, très floues, se calculent à la case ; l'eau, qui doit coller à la côte, à la sous-case.
  peindreLavis(style, I0, J0, I1, J1) {
    const cible = this.lavisCache[style];
    if (!cible) return;
    this.peindreTerres(style, cible, Math.floor(I0 / SOUS), Math.floor(J0 / SOUS), Math.ceil(I1 / SOUS), Math.ceil(J1 / SOUS));
    this.peindreEaux(style, cible, I0, J0, I1, J1);
  }

  peindreTerres(style, cible, x0, y0, x1, y1) {
    const pal = PALETTES[style];
    const { w, h, W } = this;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(w, x1);
    y1 = Math.min(h, y1);
    const a0 = Math.max(0, x0 - 3);
    const b0 = Math.max(0, y0 - 3);
    const a1 = Math.min(w, x1 + 3);
    const b1 = Math.min(h, y1 + 3);
    const lw = a1 - a0;
    const lh = b1 - b0;
    if (lw <= 0 || lh <= 0 || x1 <= x0 || y1 <= y0) return;
    const terre = new ImageData(lw, lh);
    const neige = new ImageData(lw, lh);
    const couleurs = BIOMES.map((b) => pal.lavis[b.cle] || [0, 0, 0, 0]);
    for (let y = b0; y < b1; y++) {
      for (let x = a0; x < a1; x++) {
        const k = this.biomeSous[(y * SOUS + 1) * W + x * SOUS + 1];
        if (EAU[k]) continue;
        const o = ((y - b0) * lw + (x - a0)) * 4;
        const c = couleurs[k];
        terre.data[o] = c[0];
        terre.data[o + 1] = c[1];
        terre.data[o + 2] = c[2];
        terre.data[o + 3] = 255 * c[3];
        if (k === B.neige || k === B.sommets) {
          neige.data[o] = neige.data[o + 1] = neige.data[o + 2] = 255;
          neige.data[o + 3] = 255 * pal.neige * (k === B.sommets ? 0.55 : 1);
        }
      }
    }
    flouterImage(terre.data, lw, lh, 1, 1);
    flouterImage(neige.data, lw, lh, 1, 1);
    cible.terre.getContext("2d").putImageData(terre, a0, b0, x0 - a0, y0 - b0, x1 - x0, y1 - y0);
    cible.neige.getContext("2d").putImageData(neige, a0, b0, x0 - a0, y0 - b0, x1 - x0, y1 - y0);
  }

  peindreEaux(style, cible, I0, J0, I1, J1) {
    const pal = PALETTES[style];
    const { W, H } = this;
    I0 = Math.max(0, I0);
    J0 = Math.max(0, J0);
    I1 = Math.min(W, I1);
    J1 = Math.min(H, J1);
    const a0 = Math.max(0, I0 - 2);
    const b0 = Math.max(0, J0 - 2);
    const a1 = Math.min(W, I1 + 2);
    const b1 = Math.min(H, J1 + 2);
    const lw = a1 - a0;
    const lh = b1 - b0;
    if (lw <= 0 || lh <= 0 || I1 <= I0 || J1 <= J0) return;
    const eau = new ImageData(lw, lh);
    const [r0, g0, bl0, al0] = pal.eauBord;
    const [r1, g1, bl1, al1] = pal.eauFond;
    const d = this.distEau;
    let vide = true;
    for (let J = b0; J < b1; J++) {
      for (let I = a0; I < a1; I++) {
        const idx = J * W + I;
        if (!EAU[this.biomeSous[idx]]) continue;
        vide = false;
        const o = ((J - b0) * lw + (I - a0)) * 4;
        const t = lisse(0, 6 * SOUS, d ? d[idx] : 0);
        eau.data[o] = r0 + (r1 - r0) * t;
        eau.data[o + 1] = g0 + (g1 - g0) * t;
        eau.data[o + 2] = bl0 + (bl1 - bl0) * t;
        eau.data[o + 3] = 255 * (al0 + (al1 - al0) * t);
      }
    }
    if (!vide) flouterImage(eau.data, lw, lh, 1, 1);
    cible.eau.getContext("2d").putImageData(eau, a0, b0, I0 - a0, J0 - b0, I1 - I0, J1 - J0);
  }

  // Ombrage doux venu du nord-ouest, à poser en mode « produit ».
  relief() {
    if (this.reliefToile) return this.reliefToile;
    const { w, h } = this;
    const e = this.elev;
    const t = this.carte.terrain;
    const c = toile(w, h);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        if (EAU[t[i]]) {
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
          img.data[o + 3] = 0;
          continue;
        }
        const dx = e[y * w + Math.min(w - 1, x + 1)] - e[y * w + Math.max(0, x - 1)];
        const dy = e[Math.min(h - 1, y + 1) * w + x] - e[Math.max(0, y - 1) * w + x];
        const ombre = clamp(0.5 - (dx + dy) * 2.6, 0, 1);
        const marbre = 0.93 + 0.07 * this.bruit.fbm(x / 5.5 + 40, y / 5.5 - 12, 3) * 2;
        const v = (255 - 150 * ombre) * marbre;
        img.data[o] = v;
        img.data[o + 1] = v * 0.96 + 8;
        img.data[o + 2] = v * 0.9 + 18;
        img.data[o + 3] = 255;
      }
    }
    c.getContext("2d").putImageData(img, 0, 0);
    this.reliefToile = c;
    return c;
  }

  // Parchemin vierge posé sur les terres que les joueurs ne connaissent pas encore.
  brouillard(texture) {
    if (this.brouillardToile) return this.brouillardToile;
    const { w, h } = this;
    const connu = this.carte.brouillard;
    const f = 4;
    const masque = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      masque.data[i * 4 + 3] = connu && connu[i] ? 0 : 255;
    }
    flouterImage(masque.data, w, h, 1, 2);
    const petit = toile(w, h);
    petit.getContext("2d").putImageData(masque, 0, 0);
    const c = toile(w * f, h * f);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(petit, 0, 0, w * f, h * f);
    ctx.globalCompositeOperation = "source-in";
    if (texture) ctx.drawImage(texture, 0, 0, w * f, h * f);
    else {
      ctx.fillStyle = "#efe3c6";
      ctx.fillRect(0, 0, w * f, h * f);
    }
    this.brouillardToile = c;
    return c;
  }

  connuA(x, y) {
    const c = this.carte.brouillard;
    if (!this.carte.brouillard_actif || !c) return true;
    const i = clamp(Math.floor(y), 0, this.h - 1) * this.w + clamp(Math.floor(x), 0, this.w - 1);
    return c[i] === 1;
  }

  symbolesSeau(bx, by) {
    const cle = by * 4096 + bx;
    const deja = this.seaux.get(cle);
    if (deja) return deja;
    const s = [];
    const { w, h, W } = this;
    const x0 = bx * SEAU;
    const y0 = by * SEAU;
    const x1 = Math.min(w, x0 + SEAU);
    const y1 = Math.min(h, y0 + SEAU);
    const presents = new Set();
    const t = this.carte.terrain;
    for (let y = Math.max(0, y0 - 1); y < Math.min(h, y1 + 1); y++) {
      for (let x = Math.max(0, x0 - 1); x < Math.min(w, x1 + 1); x++) presents.add(t[y * w + x]);
    }
    const ech = this.carte.taille_symboles || 1;
    const brume = this.carte.decor?.brume;
    for (const type in SYMBOLES) {
      if (!BIOMES_DU_SYMBOLE[type].some((k) => presents.has(k))) continue;
      const def = SYMBOLES[type];
      const sp = def.espacement * ech;
      const i0 = Math.ceil(x0 / sp - 0.5);
      const j0 = Math.ceil(y0 / sp - 0.5);
      for (let j = j0; (j + 0.5) * sp < y1; j++) {
        for (let i = i0; (i + 0.5) * sp < x1; i++) {
          if (hacher(i, j, def.graine + 2) > def.densite) continue;
          const x = (i + 0.5 + (hacher(i, j, def.graine) - 0.5) * def.jitter) * sp;
          const y = (j + 0.5 + (hacher(i, j, def.graine + 1) - 0.5) * def.jitter) * sp;
          if (x < 0.4 || y < 0.4 || x > w - 0.4 || y > h - 0.4) continue;
          const idx = Math.floor(y * SOUS) * W + Math.floor(x * SOUS);
          if (SYMBOLE_DE[this.biomeSous[idx]] !== type || this.voies[idx]) continue;
          if (brume) {
            const q = Math.hypot((x - brume.x) / brume.rx, (y - brume.y) / brume.ry);
            if (q > 1.05 && hacher(i, j, def.graine + 5) > 1 - lisse(1.05, 1.6, q)) continue;
          }
          const v = hacher(i, j, def.graine + 3);
          s.push({ t: type, x, y, s: this.tailleSymbole(type, x, y, v) * ech, v });
        }
      }
    }
    this.seaux.set(cle, s);
    return s;
  }

  tailleSymbole(type, x, y, v) {
    const m = () => lisse(0.3, 0.95, this.echantillon(this.mont, x, y));
    switch (type) {
      case "montagne": return 1.55 + 1.25 * m() + 0.35 * v;
      case "sommet": return 2.5 + 1.3 * m() + 0.4 * v;
      case "volcan": return 2.2 + 0.9 * m() + 0.3 * v;
      case "colline": return 0.9 + 0.3 * v;
      case "arbre": return 0.56 + 0.2 * v;
      case "pin": return 0.66 + 0.24 * v;
      case "arbre_sombre": return 1.15 + 0.4 * v;
      case "marais": return 0.72 + 0.2 * v;
      case "dune": return 0.95 + 0.35 * v;
      case "champ": return 0.9 + 0.2 * v;
      case "congere": return 0.6 + 0.2 * v;
      case "palmier": return 0.95 + 0.3 * v;
      default: return 0.42 + 0.12 * v;
    }
  }

  // Symboles dont le dessin peut toucher la zone, triés du fond vers l'avant.
  symbolesZone(x0, y0, x1, y1) {
    const bx0 = Math.max(0, Math.floor((x0 - 2) / SEAU));
    const by0 = Math.max(0, Math.floor((y0 - 1) / SEAU));
    const bx1 = Math.min(Math.ceil(this.w / SEAU) - 1, Math.floor((x1 + 2) / SEAU));
    const by1 = Math.min(Math.ceil(this.h / SEAU) - 1, Math.floor((y1 + 4) / SEAU));
    const liste = [];
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        for (const s of this.symbolesSeau(bx, by)) {
          if (s.x > x0 - 2 && s.x < x1 + 2 && s.y > y0 - 0.6 && s.y < y1 + 4) liste.push(s);
        }
      }
    }
    liste.sort((a, b) => a.y - b.y || a.x - b.x);
    return liste;
  }
}
