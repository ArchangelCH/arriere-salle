// Générateurs de terrain : la carte du monde de la campagne (modèle « cratere »), la carte de sa région (modèle
// « pays-castelblanc »), les régions détaillées et les cartes vierges. Les lieux, les noms, le relief et les secrets des
// deux cartes de la campagne vivent dans campagne/carte.js et campagne/pays.js : ce module n'en porte que la mécanique.

import { B, BIOMES } from "./biomes.js";
import { Tas, cheminLePlusSur, clamp, creerBruit, hacher, lisse, mulberry32, simplifier } from "./geo.js";
import { FICHES as FICHES_S4, HAUTEUR_KM, LARGEUR_KM, LIEUX as LIEUX_S4, RIVIERES as RIVIERES_S4, ROUTES as ROUTES_S4, biomeS4 } from "./saison4.js";
import { CARTOUCHE_MONDE, ETIQUETTES_MONDE, LIEUX_MONDE, REGION_SUR_LE_MONDE, RELIEF_MONDE, ROUTES_MONDE } from "../campagne/carte.js";
import { CARTOUCHE as CARTOUCHE_PAYS, ETIQUETTES as ETIQUETTES_PAYS, FICHES_EN_PLUS, LIEU_AU_BORD_DE_ROUTE, ORIGINE as ORIGINE_PAYS } from "../campagne/pays.js";

// Les données de la campagne que d'autres modules lisaient ici, sous leurs anciens noms.
// Où se trouve la carte de la région sur celle du monde : la position (u vers l'est, v vers le sud, le cercle de
// montagnes en d = 1) de son lieu d'ancrage.
export const CASTELBLANC_UV = { u: REGION_SUR_LE_MONDE.u, v: REGION_SUR_LE_MONDE.v };
// Textes des fiches des lieux de la région qui ne viennent pas de sa carte.
export { FICHES_EN_PLUS };
// Lieux du reste du monde, avec leur fiche.
export const LIEUX_CRATERE = LIEUX_MONDE;
// Noms du monde ; region : position en pourcentage de la carte de la région, pour les noms qui la concernent.
export const ETIQUETTES_CRATERE = ETIQUETTES_MONDE;

function ridge(u, v, a, b, largeur) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / l2, 0, 1);
  const d = Math.hypot(u - (a[0] + t * dx), v - (a[1] + t * dy));
  return Math.exp(-((d / largeur) ** 2)) * (0.55 + 0.45 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1)));
}

const bosse = (u, v, cu, cv, r) => Math.exp(-(((u - cu) ** 2 + (v - cv) ** 2) / (r * r)));

function drainer(w, h, elev, eau, domaine, seuil) {
  const n = w * h;
  const rempli = new Float32Array(n);
  const recepteur = new Int32Array(n).fill(-1);
  const vu = new Uint8Array(n);
  const ordre = [];
  const tas = new Tas();
  for (let i = 0; i < n; i++) {
    if (eau[i] && domaine[i]) {
      vu[i] = 1;
      rempli[i] = elev[i];
      tas.pousser(elev[i], i);
    }
  }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (tas.taille) {
    const c = tas.sortir();
    ordre.push(c);
    const x = c % w;
    const y = (c - x) / w;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (vu[j] || !domaine[j]) continue;
      vu[j] = 1;
      rempli[j] = Math.max(elev[j], rempli[c] + 1e-5);
      recepteur[j] = c;
      tas.pousser(rempli[j], j);
    }
  }
  const acc = new Float32Array(n);
  for (let k = ordre.length - 1; k >= 0; k--) {
    const c = ordre[k];
    if (eau[c]) continue;
    acc[c] += 1;
    if (recepteur[c] >= 0) acc[recepteur[c]] += acc[c];
  }
  const amont = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!eau[i] && acc[i] >= seuil && recepteur[i] >= 0) amont[recepteur[i]] = 1;
  const sources = [];
  for (let i = 0; i < n; i++) if (!eau[i] && acc[i] >= seuil && !amont[i]) sources.push(i);
  const longueur = (i) => {
    let l = 0;
    for (let c = i; c >= 0 && !eau[c] && l < 4000; c = recepteur[c]) l++;
    return l;
  };
  sources.sort((a, b) => longueur(b) - longueur(a));
  const pris = new Uint8Array(n);
  const rivieres = [];
  for (const s of sources) {
    const pts = [];
    let c = s;
    while (c >= 0) {
      const x = c % w;
      const y = (c - x) / w;
      const larg = Math.min(0.72, 0.13 + 0.085 * Math.log2(acc[c] / seuil + 1));
      pts.push([x + 0.5, y + 0.5, larg]);
      if (eau[c] || pris[c]) break;
      pris[c] = 1;
      c = recepteur[c];
    }
    if (pts.length >= 5) rivieres.push(pts);
  }
  return { rivieres, rempli, acc };
}

// Une rivière qui traverse un lac s'y arrête et repart de l'autre rive.
function couperRivieres(rivieres, terrain, w) {
  const sortie = [];
  for (const pts of rivieres) {
    let courant = [];
    let precedent = null;
    for (const p of pts) {
      const dansEau = terrain[Math.floor(p[1]) * w + Math.floor(p[0])] === B.eau;
      if (dansEau) {
        if (courant.length) {
          courant.push(p);
          if (courant.length >= 4) sortie.push(courant);
          courant = [];
        }
      } else {
        if (!courant.length && precedent) courant.push(precedent);
        courant.push(p);
      }
      precedent = p;
    }
    if (courant.length >= 4) sortie.push(courant);
  }
  return sortie;
}

function simplifierRiviere(pts) {
  const s = simplifier(pts, 0.55);
  return s.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100]);
}

function trouverCase(w, h, terrain, x, y, accepte, rayon = 14) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let r = 0; r <= rayon; r++) {
    let meilleur = null;
    let dmin = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x0 + dx;
        const cy = y0 + dy;
        if (cx < 1 || cy < 1 || cx >= w - 1 || cy >= h - 1) continue;
        if (!accepte(cx, cy)) continue;
        const d = Math.hypot(dx, dy);
        if (d < dmin) {
          dmin = d;
          meilleur = [cx, cy];
        }
      }
    }
    if (meilleur) return meilleur;
  }
  return [x0, y0];
}

// Pose une polyligne (en pourcentage de la carte du pays) dans la grille d'une carte, avec une largeur par point.
function traceDepuisS4(points, versCase, largeurs, meandre = null) {
  const pts = points.map(([px, py]) => versCase(px, py));
  const n = pts.length;
  const sortie = [];
  for (let i = 0; i < n; i++) {
    const l = largeurs[0] + (largeurs[1] - largeurs[0]) * (i / Math.max(1, n - 1));
    if (meandre && i < n - 1) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const d = Math.hypot(bx - ax, by - ay);
      const pas = Math.max(1, Math.ceil(d / 1.4));
      for (let k = 0; k < pas; k++) {
        const t = k / pas;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const amp = i === 0 && k === 0 ? 0 : meandre.amplitude * meandre.bruit(x / 3.7 + i, y / 3.7 - i);
        const l2 = l + ((largeurs[1] - largeurs[0]) / Math.max(1, n - 1)) * t;
        sortie.push([x - ((by - ay) / (d || 1)) * amp, y + ((bx - ax) / (d || 1)) * amp, l2]);
      }
    } else {
      sortie.push([...pts[i], l]);
    }
  }
  return sortie.map((p) => p.map((v) => Math.round(v * 100) / 100));
}

function tracerRoutes(w, h, terrain, positions, liste, traces, prefixe) {
  const surRiviere = new Uint8Array(w * h);
  for (const t of traces) if (t.type === "riviere") for (const [x, y] of t.points) surRiviere[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)] = 1;
  const surRoute = new Uint8Array(w * h);
  const cout = (i) => {
    const c = BIOMES[terrain[i]].cout;
    if (!isFinite(c)) return Infinity;
    return (surRoute[i] ? 0.45 : 1) * (c + (surRiviere[i] ? 2.5 : 0));
  };
  const routes = {};
  for (const [a, b, type] of liste) {
    if (!positions[a] || !positions[b]) continue;
    const [ax, ay] = positions[a];
    const [bx, by] = positions[b];
    const depart = clamp(Math.floor(ay - 0.3), 0, h - 1) * w + clamp(Math.floor(ax), 0, w - 1);
    const arrivee = clamp(Math.floor(by - 0.3), 0, h - 1) * w + clamp(Math.floor(bx), 0, w - 1);
    const chemin = cheminLePlusSur(w, h, cout, depart, arrivee);
    if (!chemin || chemin.length < 3) continue;
    for (const i of chemin) surRoute[i] = 1;
    const pts = simplifier(chemin.map((i) => [(i % w) + 0.5, Math.floor(i / w) + 0.5]), 0.7).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    routes[`${a}-${b}`] = pts;
    traces.push({ id: `${prefixe}-${a}-${b}`, type, points: pts });
  }
  return routes;
}

function degager(terrain, w, h, x, y, rayon = 1) {
  for (let dy = -rayon; dy <= rayon; dy++) {
    for (let dx = -rayon; dx <= rayon; dx++) {
      const cx = Math.floor(x) + dx;
      const cy = Math.floor(y) + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const j = cy * w + cx;
      if ([B.foret, B.foret_profonde, B.pins, B.marais, B.jungle].includes(terrain[j])) terrain[j] = B.plaine;
    }
  }
}

export function genererCratere({ graine = 1, largeur = 360, hauteur = 250 } = {}) {
  const w = largeur;
  const h = hauteur;
  const kmCase = 8;
  const alea = mulberry32(graine);
  const n1 = creerBruit(graine * 7 + 1);
  const n2 = creerBruit(graine * 7 + 2);
  const n3 = creerBruit(graine * 7 + 3);
  const n4 = creerBruit(graine * 7 + 4);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const rx = w * 0.367;
  const ry = h * 0.432;
  const versCase = (u, v) => [cx + u * rx, cy + v * ry];
  const versUV = (x, y) => [(x - cx) / rx, (y - cy) / ry];

  // La carte de la région, à l'échelle de celle-ci (des cases de 8 km), son lieu d'ancrage posé à sa place dans le monde.
  const rw = LARGEUR_KM / kmCase;
  const rh = HAUTEUR_KM / kmCase;
  const cbS4 = LIEUX_S4.find((l) => l.cle === REGION_SUR_LE_MONDE.ancre);
  const [cbx, cby] = versCase(CASTELBLANC_UV.u, CASTELBLANC_UV.v);
  const region = { x0: cbx - (cbS4.x / 100) * rw, y0: cby - (cbS4.y / 100) * rh };
  region.x1 = region.x0 + rw;
  region.y1 = region.y0 + rh;
  const versRegion = (px, py) => [region.x0 + (px / 100) * rw, region.y0 + (py / 100) * rh];
  // Le relief de la campagne : une crête qui part de la région part d'un point de sa carte.
  const formes = RELIEF_MONDE.formes.map((f) => {
    if (!f.crete_region) return f;
    const de = versUV(...versRegion(...f.crete_region));
    return { ...f, crete: [de, [de[0] + f.vers[0], de[1] + f.vers[1]]] };
  });
  const [merU, merV, merRu, merRv] = RELIEF_MONDE.mer;

  const elev = new Float32Array(w * h);
  const humid = new Float32Array(w * h);
  const dist = new Float32Array(w * h);
  const eau = new Uint8Array(w * h);
  const domaine = new Uint8Array(w * h);
  const terrain = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      const a = Math.atan2(v, u);
      const d = Math.hypot(u, v) + 0.055 * n1.fbm(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 3, 3) + 0.028 * n1.bruit(x / 13, y / 13);
      dist[i] = d;
      const lr = 0.085 + 0.028 * n1.bruit(Math.cos(a) * 2.3 + 11, Math.sin(a) * 2.3 - 4);
      const cercle = Math.exp(-(((d - 1) / lr) ** 2));
      const hautCercle = 0.72 + 0.3 * n1.fbm(x / 17, y / 17, 3);

      let e = 0.24 + 0.16 * lisse(0.3, 0.95, d) + 0.22 * n2.fbm(x / 24, y / 24, 5);
      const crete = n2.crete(x / 40 + 5.5, y / 40 - 2.5, 4);
      e += 0.36 * lisse(0.78, 0.97, crete) * (1 - lisse(0.85, 1, d));
      // Dans l'ordre des données : une somme de flottants dépend de son ordre, et une case de plus ou de moins change le terrain.
      for (const f of formes) {
        if (f.bosse) e += f.force * bosse(u, v, f.bosse[0], f.bosse[1], f.bosse[2]);
        else {
          let r = f.force * ridge(u, v, f.crete[0], f.crete[1], f.largeur);
          if (f.breche) r *= 1 - f.breche.force * bosse(u, v, f.breche.bosse[0], f.breche.bosse[1], f.breche.bosse[2]);
          e += r;
        }
      }

      const mer = Math.hypot((u - merU) / merRu, (v - merV) / merRv) + 0.28 * n4.fbm(x / 15, y / 15, 4);
      e -= 0.5 * lisse(1.5, 0.6, mer);
      if (mer < 1) eau[i] = 1;

      if (d > 1) e = 0.28 + 0.14 * n2.fbm(x / 20, y / 20, 4);
      e = Math.max(e, 0.35 + cercle * hautCercle * 1.05);
      elev[i] = e;
      domaine[i] = d < 1.0 ? 1 : 0;

      let m = n3.fbm(x / 38, y / 38, 4) * 0.9;
      for (const f of RELIEF_MONDE.humidite) m += f.force * bosse(u, v, f.bosse[0], f.bosse[1], f.bosse[2]);
      m -= 0.25 * lisse(0.2, 0.8, v);
      m += 0.25 * lisse(0.6, 0.15, mer);
      humid[i] = m;
    }
  }

  // L'île du monde (le lieu marqué « ile ») sort de la mer.
  const ile = LIEUX_CRATERE.find((l) => l.ile);
  const [ix, iy] = ile ? versCase(ile.u, ile.v) : [0, 0];
  for (let y = Math.floor(iy - 4); ile && y <= iy + 4; y++) {
    for (let x = Math.floor(ix - 5); x <= ix + 5; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.hypot((x + 0.5 - ix) / 3.2, (y + 0.5 - iy) / 2.3) + 0.3 * n4.bruit(x / 2, y / 2);
      if (d < 1) {
        eau[y * w + x] = 0;
        elev[y * w + x] = 0.3;
      }
    }
  }

  const bruitFin = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) bruitFin[i] = elev[i] + 0.012 * alea();
  const seuil = Math.round(160 * ((w * h) / 90000));
  const { rivieres, rempli } = drainer(w, h, bruitFin, eau, domaine, seuil);
  const { volcan, desert: sable } = RELIEF_MONDE;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      const d = dist[i];
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      let t;
      if (eau[i] && d < 1) t = B.eau;
      else if (domaine[i] && rempli[i] - bruitFin[i] > 0.05 && e < 0.6) t = B.eau;
      else if (e > 0.92 && bosse(u, v, volcan[0], volcan[1], volcan[2]) > 0.45 && d < 0.95) t = B.volcan;
      else if (e > 1.02) t = B.sommets;
      else if (e > 0.8) t = B.montagnes;
      else if (e > 0.62) t = d > 1 ? B.foret_profonde : v < -0.62 && e > 0.7 ? B.neige : B.collines;
      else if (d > 1) t = B.foret_profonde;
      else {
        const m = humid[i];
        const froid = v < -0.5;
        const desert = bosse(u, v, sable[0], sable[1], sable[2]);
        if (desert > 0.5 && m < 0.1) t = B.desert;
        else if (m > 0.5) t = froid ? B.pins : B.foret_profonde;
        else if (m > 0.16) t = froid ? B.pins : B.foret;
        else if (m > 0.02 && e < 0.26 && n4.bruit(x / 6, y / 6) > 0.1) t = B.marais;
        else if (m < -0.28) t = desert > 0.25 ? B.desert : B.lande;
        else t = B.plaine;
      }
      terrain[i] = t;
    }
  }

  // La carte de la région remplace le terrain tiré au hasard, avec une lisière fondue sur ses bords.
  const bruitS4 = creerBruit(graine * 7 + 9);
  for (let y = Math.floor(region.y0); y <= Math.ceil(region.y1); y++) {
    for (let x = Math.floor(region.x0); x <= Math.ceil(region.x1); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const px = ((x + 0.5 - region.x0) / rw) * 100;
      const py = ((y + 0.5 - region.y0) / rh) * 100;
      if (px < 0 || px > 100 || py < 0 || py > 100) continue;
      const bord = Math.min(px, 100 - px, py, 100 - py);
      if (bord < 8 && 0.5 + 0.5 * n4.fbm(x / 3.5, y / 3.5, 3) * 2 > bord / 8) continue;
      terrain[y * w + x] = biomeS4(px, py, bruitS4);
    }
  }
  const dansRegion = ([x, y]) => x > region.x0 - 2 && x < region.x1 + 2 && y > region.y0 - 2 && y < region.y1 + 2;

  const traces = couperRivieres(rivieres, terrain, w)
    .map((pts) => simplifierRiviere(pts))
    .filter((pts) => !pts.some(dansRegion))
    .map((pts, k) => ({ id: `riv-${k}`, type: "riviere", points: pts }));
  const largeursMonde = REGION_SUR_LE_MONDE.largeurs_rivieres;
  for (const r of RIVIERES_S4) traces.push({ id: `riv-${r.id}`, type: "riviere", nom: r.nom, points: traceDepuisS4(r.points, versRegion, largeursMonde[r.id]) });

  const marqueurs = [];
  const positions = {};
  const estTerre = (x, y) => !BIOMES[terrain[y * w + x]].eau;
  for (const cle of REGION_SUR_LE_MONDE.lieux) {
    const l = LIEUX_S4.find((x) => x.cle === cle);
    const [x, y] = versRegion(l.x, l.y);
    if (l.type !== "cite_naine" && l.type !== "tour") degager(terrain, w, h, x, y);
    positions[cle] = [x, y + 0.4];
    marqueurs.push({ id: `m-${cle}`, repere: cle, x: Math.round(x * 100) / 100, y: Math.round((y + 0.4) * 100) / 100, taille: l.type === "capitale" ? 3.2 : 2.5 });
  }
  for (const l of LIEUX_CRATERE) {
    let [x, y] = versCase(l.u, l.v);
    if (l.surEau) {
      [x, y] = trouverCase(w, h, terrain, x, y, (a, b) => terrain[b * w + a] === B.eau);
      x += 0.5;
      y += 0.5;
    } else {
      const accepte = l.cote
        ? (a, b) => estTerre(a, b) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([p, q]) => terrain[(b + q) * w + a + p] === B.eau)
        : (a, b) => estTerre(a, b) && ![B.sommets, B.montagnes, B.volcan].includes(terrain[b * w + a]);
      [x, y] = trouverCase(w, h, terrain, x, y, accepte);
      x += 0.5;
      y += 0.72;
      degager(terrain, w, h, x, y);
    }
    positions[l.cle] = [x, y];
    const m = { id: `m-${l.cle}`, repere: l.cle, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, taille: l.taille || 2.9 };
    if (l.nomGauche) m.nom_gauche = true;
    marqueurs.push(m);
  }

  for (const l of LIEUX_CRATERE) {
    const r = { capitale: 9, cite: 7, ville: 5 }[l.type];
    if (!r) continue;
    const [px, py] = positions[l.cle];
    for (let y = Math.floor(py - r); y <= py + r; y++) {
      for (let x = Math.floor(px - r); x <= px + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / r + 0.35 * n4.bruit(x / 3, y / 3);
        if (d < 1 && [B.plaine, B.lande].includes(terrain[i])) terrain[i] = B.cultures;
      }
    }
  }

  tracerRoutes(w, h, terrain, positions, ROUTES_MONDE, traces, "route");

  const etiquettes = ETIQUETTES_CRATERE.map((e) => {
    const [x, y] = e.region ? versRegion(...e.region) : versCase(e.u, e.v);
    return { id: e.id, texte: e.texte, style: e.style, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, taille: e.taille, courbure: e.courbure || 0, angle: e.angle || 0 };
  });

  return {
    largeur: w,
    hauteur: h,
    km_case: kmCase,
    graine,
    modele: "cratere",
    taille_textes: 2.2,
    region_castelblanc: { x0: +region.x0.toFixed(2), y0: +region.y0.toFixed(2), x1: +region.x1.toFixed(2), y1: +region.y1.toFixed(2) },
    terrain,
    traces,
    marqueurs,
    etiquettes,
    decor: {
      cadre: true,
      brume: { x: cx, y: cy, rx: rx * 1.1, ry: ry * 1.1 },
      cartouche: { x: 48, y: 20, titre: CARTOUCHE_MONDE.titre, sous_titre: CARTOUCHE_MONDE.sous_titre, taille: 7.5 },
      rose: { x: w - 30, y: h - 34, taille: 30 },
      echelle: { x: 12, y: h - 16 },
    },
  };
}

// La carte de la région de la campagne, sur 200 cases de large, d'après ses formes (campagne/pays.js).
export function genererPaysCastelblanc({ graine = 1, parent = null } = {}) {
  const w = 200;
  const h = Math.round((w * HAUTEUR_KM) / LARGEUR_KM);
  const kmCase = LARGEUR_KM / w;
  const bruit = creerBruit(graine * 11 + 3);
  const detail = creerBruit(graine * 11 + 4);
  const versCase = (px, py) => [(px / 100) * w, (py / 100) * h];
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = biomeS4(((x + 0.5) / w) * 100, ((y + 0.5) / h) * 100, bruit);
      const bosquet = detail.fbm(x / 6 + 3, y / 6 - 8, 4);
      const relief = detail.fbm(x / 10 - 20, y / 10 + 4, 3);
      if ((t === B.plaine || t === B.cultures) && bosquet > 0.4) t = B.foret;
      else if (t === B.plaine && relief > 0.46) t = B.collines;
      else if ((t === B.foret_profonde || t === B.pins) && bosquet < -0.5) t = B.plaine;
      terrain[y * w + x] = t;
    }
  }

  const traces = RIVIERES_S4.map((r) => ({ id: r.id, type: "riviere", nom: r.nom, points: traceDepuisS4(r.points, versCase, r.largeur, { amplitude: 1.5, bruit: detail.bruit }) }));

  const k = 1.7;
  const tailles = { capitale: 2.4, cite: 2.1, cite_naine: 2.1, ville: 1.9, forteresse: 1.9, tour: 1.9, temple: 1.8 };
  const marqueurs = [];
  const positions = {};
  const poser = (l) => {
    const [x, y] = versCase(l.x, l.y);
    if (l.type !== "cite_naine" && l.type !== "tour" && l.type !== "mine") degager(terrain, w, h, x, y, 2);
    positions[l.cle] = [x, y + 0.5];
    marqueurs.push({ id: `m-${l.cle}`, repere: l.cle, x: Math.round(x * 100) / 100, y: Math.round((y + 0.5) * 100) / 100, taille: +((tailles[l.type] || 1.6) * k).toFixed(2) });
  };
  const bord = LIEU_AU_BORD_DE_ROUTE;
  for (const l of LIEUX_S4) if (l.cle !== bord.lieu) poser(l);

  const routes = tracerRoutes(w, h, terrain, positions, ROUTES_S4, traces, "route");

  // Un lieu se tient au bord d'une route, à quelques cases de son départ (l'auberge de la campagne, à la sortie de la
  // ville) : posé après les routes, il suit leur tracé.
  const auberge = LIEUX_S4.find((l) => l.cle === bord.lieu);
  if (auberge) {
    const route = routes[bord.route.join("-")];
    let [ax, ay] = versCase(auberge.x, auberge.y);
    if (route && route.length > 2) {
      let parcouru = 0;
      for (let i = 1; i < route.length; i++) {
        const d = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
        if (parcouru + d >= bord.distance) {
          const t = (bord.distance - parcouru) / d;
          ax = route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t + bord.decalage[0];
          ay = route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t + bord.decalage[1];
          break;
        }
        parcouru += d;
      }
    }
    degager(terrain, w, h, ax, ay, 1);
    positions[auberge.cle] = [ax, ay];
    const tailleAuberge = +(1.5 * k).toFixed(2);
    marqueurs.push({ id: `m-${auberge.cle}`, repere: auberge.cle, x: Math.round(ax * 100) / 100, y: Math.round(ay * 100) / 100, taille: tailleAuberge });
  }

  const pos = (px, py) => versCase(px, py).map((v) => Math.round(v * 10) / 10);
  const etiquettes = ETIQUETTES_PAYS.map((e) => {
    const [x, y] = pos(...e.position);
    return { id: e.id, texte: e.texte, style: e.style, x, y, taille: e.taille, courbure: e.courbure, angle: e.angle };
  });

  return {
    largeur: w,
    hauteur: h,
    km_case: kmCase,
    graine,
    modele: "pays-castelblanc",
    parent,
    taille_textes: k,
    terrain,
    traces,
    marqueurs,
    etiquettes,
    decor: {
      cadre: true,
      cartouche: { x: 100, y: 7, titre: CARTOUCHE_PAYS.titre, sous_titre: CARTOUCHE_PAYS.sous_titre, taille: 4.2 },
      rose: { x: 12, y: 16, taille: 16 },
      echelle: { x: 8, y: h - 9 },
    },
  };
}

// Fiches des lieux que les générateurs posent, repérées par leur clé : réutilisées si elles existent déjà
// (carte/editeur.js, assurerLieux).
export function definitionsLieux() {
  const defs = {};
  for (const l of LIEUX_CRATERE) {
    defs[l.cle] = { nom: l.nom, type: l.type, etiquette: l.etiquette, connu: l.connu, a_valider: l.origine === "propose", resume: l.resume || "", secrets: l.secrets || "",
      notes: l.origine === "propose" ? "Position proposée par l'atelier, à déplacer librement." : "" };
  }
  const bord = LIEU_AU_BORD_DE_ROUTE;
  for (const l of LIEUX_S4) {
    const f = { ...(FICHES_S4[l.cle] || {}), ...(FICHES_EN_PLUS[l.cle] || {}) };
    const auBord = l.cle === bord.lieu;
    defs[l.cle] = { nom: l.nom, type: l.type, etiquette: auBord ? bord.etiquette : ORIGINE_PAYS.etiquette, connu: true, a_valider: auBord, resume: f.resume || "", secrets: f.secrets || "",
      notes: auBord ? bord.note : ORIGINE_PAYS.note };
  }
  return defs;
}

// Abscisse du cartouche pour qu'un long titre ne sorte pas du cadre.
export function placerCartouche(titre, taille, largeur) {
  const demi = ((titre || "").length * taille * 0.78 + taille * 2.2) / 2;
  return Math.round(Math.min(largeur / 2, Math.max(largeur * 0.16, demi + 3)));
}

// Le relief au hasard d'une carte vierge : plaines, bois, landes, collines, quelques lacs et un massif, tirés d'une
// altitude et d'une humidité de bruit, à l'échelle de la carte (trois ou quatre ondulations d'un bord à l'autre). Un
// point de départ à retoucher au pinceau : ni rivière, ni route, ni lieu.
export function reliefAuHasard(largeur, hauteur, graine = 1) {
  const terrain = new Uint8Array(largeur * hauteur);
  const alt = creerBruit(((graine | 0) * 7 + 11) >>> 0);
  const hum = creerBruit(((graine | 0) * 7 + 12) >>> 0);
  const k = 3.6 / Math.max(largeur, hauteur);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      // L'altitude : de larges ondulations, et des crêtes qui ne se lèvent qu'en hauteur (un massif, pas des pics semés).
      const base = alt.fbm(x * k, y * k, 5);
      const e = base + 0.55 * Math.max(0, base + 0.1) * alt.crete(x * k * 1.7 + 31, y * k * 1.7 - 17, 4);
      const h = hum.fbm(x * k * 1.6 + 9, y * k * 1.6 + 4, 4) + 0.12 * hum.bruit(x * k * 9, y * k * 9);
      let t;
      if (e < -0.26) t = B.eau;
      else if (e > 0.62) t = B.sommets;
      else if (e > 0.43) t = B.montagnes;
      else if (e > 0.25) t = h > 0.12 ? B.pins : B.collines;
      else if (e < -0.2 && h > 0.18) t = B.marais;
      else if (h > 0.34) t = B.foret_profonde;
      else if (h > 0.1) t = B.foret;
      else if (h < -0.3) t = B.lande;
      else t = B.plaine;
      terrain[y * largeur + x] = t;
    }
  }
  return terrain;
}

// relief : un relief au hasard (reliefAuHasard) au lieu d'un terrain uni.
export function genererVierge({ largeur = 200, hauteur = 140, fond = B.plaine, graine = 1, km_case = 1, relief = false } = {}) {
  const terrain = relief ? reliefAuHasard(largeur, hauteur, graine) : new Uint8Array(largeur * hauteur).fill(fond);
  return {
    largeur,
    hauteur,
    km_case,
    graine,
    modele: "vierge",
    terrain,
    traces: [],
    marqueurs: [],
    etiquettes: [],
    decor: {
      cadre: true,
      cartouche: { x: placerCartouche("Nouvelle carte", 3.2, largeur), y: 9, titre: "Nouvelle carte", sous_titre: "", taille: 3.2, visible: true },
      rose: { x: largeur - 14, y: hauteur - 15, taille: 10 },
      echelle: { x: 6, y: hauteur - 8 },
    },
  };
}

// Carte détaillée d'une région : le terrain de la carte mère est relu plus finement, avec les mêmes contours,
// puis enrichi de bosquets, clairières et collines ; rivières, routes, lieux et noms sont repris.
export function genererRegion(source, rect, facteur, { graine = 1, nom = "" } = {}) {
  const sw = source.largeur;
  const sh = source.hauteur;
  const w = Math.round((rect.x1 - rect.x0) * facteur);
  const h = Math.round((rect.y1 - rect.y0) * facteur);
  const terrain = new Uint8Array(w * h);
  const ondulation = creerBruit(((source.graine | 0) + 7919) >>> 0).bruit;
  const detail = creerBruit(graine * 13 + 5);
  const vers = (x, y) => [(x - rect.x0) * facteur, (y - rect.y0) * facteur];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = rect.x0 + (x + 0.5) / facteur;
      const sy = rect.y0 + (y + 0.5) / facteur;
      const dx = 0.85 * ondulation(sx * 0.33 + 17.1, sy * 0.33 + 3.7) + 0.32 * ondulation(sx * 0.97 + 5.3, sy * 0.97 + 41.2)
        + 0.22 * detail.bruit(sx * 2.6, sy * 2.6) + 0.1 * detail.bruit(sx * 7.1, sy * 7.1);
      const dy = 0.85 * ondulation(sx * 0.33 + 71.9, sy * 0.33 + 23.1) + 0.32 * ondulation(sx * 0.97 + 13.7, sy * 0.97 + 7.9)
        + 0.22 * detail.bruit(sx * 2.6 + 40, sy * 2.6 - 13) + 0.1 * detail.bruit(sx * 7.1 - 9, sy * 7.1 + 22);
      const cx = clamp(Math.floor(sx + dx), 0, sw - 1);
      const cy = clamp(Math.floor(sy + dy), 0, sh - 1);
      let t = source.terrain[cy * sw + cx];
      const bosquet = detail.fbm(x / 7 + 3, y / 7 - 8, 4);
      const relief = detail.fbm(x / 11 - 20, y / 11 + 4, 3);
      if ((t === B.plaine || t === B.lande || t === B.cultures) && bosquet > 0.36) t = B.foret;
      else if ((t === B.plaine || t === B.lande) && relief > 0.4) t = B.collines;
      else if ((t === B.foret || t === B.pins) && bosquet < -0.42) t = B.plaine;
      else if (t === B.montagnes && relief < -0.35) t = B.collines;
      terrain[y * w + x] = t;
    }
  }

  const dedans = ([x, y]) => x >= -3 && y >= -3 && x <= w + 3 && y <= h + 3;
  const traces = [];
  for (const t of source.traces || []) {
    if (!t.points || t.points.length < 2) continue;
    const fins = [];
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i];
      const b = t.points[i + 1];
      const [ax, ay] = vers(a[0], a[1]);
      const [bx, by] = vers(b[0], b[1]);
      const l = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(l / 1.6));
      for (let k = 0; k < n; k++) {
        const u = k / n;
        const x = ax + (bx - ax) * u;
        const y = ay + (by - ay) * u;
        const amp = t.type === "riviere" ? 0.9 : t.type === "frontiere" ? 0.5 : 0.35;
        const nx = -(by - ay) / (l || 1);
        const ny = (bx - ax) / (l || 1);
        const d = amp * detail.bruit(x / 4.3 + i, y / 4.3 - i) * (k === 0 && i === 0 ? 0 : 1);
        const larg = a.length > 2 ? (a[2] + ((b[2] ?? a[2]) - a[2]) * u) * facteur * 0.32 : undefined;
        fins.push(larg === undefined ? [x + nx * d, y + ny * d] : [x + nx * d, y + ny * d, Math.round(larg * 100) / 100]);
      }
    }
    const last = t.points[t.points.length - 1];
    const fin = vers(last[0], last[1]);
    fins.push(last.length > 2 ? [...fin, Math.round(last[2] * facteur * 32) / 100] : fin);
    let morceau = [];
    const pousser = () => {
      if (morceau.length >= 2) {
        const copie = { ...t, id: `${t.id}-${traces.length}`, points: morceau.map((p) => p.map((v) => Math.round(v * 100) / 100)) };
        if (t.largeur) copie.largeur = t.largeur.map((l) => Math.round(l * facteur * 32) / 100);
        traces.push(copie);
      }
      morceau = [];
    };
    for (const p of fins) {
      if (dedans(p)) morceau.push(p);
      else pousser();
    }
    pousser();
  }

  const k = 1.8;
  const tailles = { capitale: 2.3, cite: 2.1, cite_naine: 2.1, ville: 1.9, forteresse: 1.9, tour: 1.9, temple: 1.8 };
  const marqueurs = (source.marqueurs || [])
    .filter((m) => m.x >= rect.x0 && m.x <= rect.x1 && m.y >= rect.y0 && m.y <= rect.y1)
    .map((m) => {
      const [x, y] = vers(m.x, m.y);
      return { id: `${m.id}-r`, lieu: m.lieu, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, taille: (tailles[source.typesLieux?.[m.lieu]] || 1.6) * k };
    });
  const etiquettes = (source.etiquettes || [])
    .filter((e) => e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1)
    .map((e) => {
      const [x, y] = vers(e.x, e.y);
      return { ...e, id: `${e.id}-r`, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, taille: Math.min(12, Math.round(e.taille * facteur * 0.4 * 10) / 10) };
    });

  return {
    largeur: w,
    hauteur: h,
    km_case: Math.round(((source.km_case || 8) / facteur) * 1000) / 1000,
    graine,
    modele: "region",
    parent: { carte: source.id, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 },
    taille_textes: k,
    terrain,
    traces,
    marqueurs,
    etiquettes,
    decor: {
      cadre: true,
      cartouche: { x: placerCartouche(nom, 4.4, w), y: 9, titre: nom, sous_titre: source.nom ? `Détail de la carte « ${source.nom} »` : "", taille: 4.4 },
      rose: { x: w - 16, y: h - 17, taille: 14 },
      echelle: { x: 7, y: h - 9 },
    },
  };
}
