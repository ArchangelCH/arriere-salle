// Les plans extérieurs : ville, village, forêt, montagne, désert, marais, rivière, côte, camp et ruines. Chaque
// générateur dessine d'abord son terrain (un sol par case, des bâtiments, des points remarquables), puis le découpe en
// zones extérieures à révéler une à une : une zone tient de 60 à 120 cases, on ne découvre jamais tout le dehors d'un
// coup. Les bâtiments sont des salles, chacun avec sa porte ; on entre dans certains, les autres sont fermés à clé.
// Toute case où l'on marche se rejoint depuis l'entrée (la pièce 1) : l'eau profonde et la falaise se passent par un
// pont, une barque ou un gué, et un meuble qui couperait un passage n'est pas posé (Chantier.meubler).
//
// Ce module n'importe que le modèle : generateurs.js lui passe Chantier et hasard à l'appel (pas d'import circulaire).

import { MEUBLES, SOLS_INFRANCHISSABLES } from "./modele.js";

export const MODELES_DEHORS = [
  { cle: "ville", nom: "Ville", aide: "Rues pavées, une place et sa fontaine, des pâtés de maisons ; on entre dans certains bâtiments, les autres sont fermés.", dehors: true },
  { cle: "village", nom: "Village", aide: "Quelques maisons le long des chemins, le puits, des champs, un enclos.", dehors: true },
  { cle: "foret", nom: "Forêt", aide: "Sous-bois serré, sentier, clairière, ruisseau passé à gué ou sur un pont.", dehors: true },
  { cle: "montagne", nom: "Montagne", aide: "Sentier en lacets entre les falaises, éboulis, jusqu'au col.", dehors: true },
  { cle: "desert", nom: "Désert", aide: "Dunes, rochers, une oasis et des ruines ensablées, le long d'une piste.", dehors: true },
  { cle: "marais", nom: "Marais", aide: "Boue, roseaux et eaux profondes, saules morts, un chemin de planches.", dehors: true },
  { cle: "riviere", nom: "Rivière", aide: "Une rivière profonde dans la plaine, un pont sur la route et un gué plus loin.", dehors: true },
  { cle: "cote", nom: "Côte", aide: "Plage, rochers et falaise, un ponton avec ses barques, la cabane du pêcheur.", dehors: true },
  { cle: "camp", nom: "Camp", aide: "Un camp dans les bois : palissade et sa porte, tentes, feu, réserves.", dehors: true },
  { cle: "ruines", nom: "Ruines", aide: "Un fort en ruine envahi d'herbe : remparts écroulés, brèches, une tour encore debout.", dehors: true },
];

// Les sols (modele.js, SOLS : l'identifiant est la place dans la liste).
const S = {
  pierre: 1, plancher: 2, terre: 3, paves: 4, herbe: 5, roche: 6, eau: 7, marbre: 8, paille: 9, sable: 10, dalles: 13,
  gravier: 17, boue: 18, feuilles: 19, mousse: 20, neige: 21, profonde: 23, falaise: 24, cultures: 25,
};
const VOISINS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const TAILLE_ZONE = 95; // cases d'une zone extérieure, en moyenne
const ZONE_MAX = 200; // au-delà, la zone se partage en deux

// Un bruit lisse dans [0, 1], tiré de la graine : une grille de valeurs au pas donné, interpolée.
function bruit(r, w, h, pas, octaves = 2) {
  const res = new Float64Array(w * h);
  let total = 0;
  for (let o = 0, a = 1, p = pas; o < octaves; o++, a /= 2, p = Math.max(2, p / 2)) {
    const gw = Math.ceil(w / p) + 2;
    const gh = Math.ceil(h / p) + 2;
    const g = Array.from({ length: gw * gh }, () => r());
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = x / p;
        const fy = y / p;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const tx = (fx - i) * (fx - i) * (3 - 2 * (fx - i));
        const ty = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
        const v = (g[j * gw + i] * (1 - tx) + g[j * gw + i + 1] * tx) * (1 - ty) + (g[(j + 1) * gw + i] * (1 - tx) + g[(j + 1) * gw + i + 1] * tx) * ty;
        res[y * w + x] += v * a;
      }
    }
    total += a;
  }
  for (let i = 0; i < res.length; i++) res[i] /= total;
  return res;
}

// ---------------------------------------------------------------- le terrain, avant le plan

class Terrain {
  constructor(w, h, fond) {
    this.w = w;
    this.h = h;
    this.sol = new Array(w * h).fill(fond);
    this.bati = new Int32Array(w * h); // 1 + l'indice du bâtiment qui couvre la case
    this.aire = new Int32Array(w * h).fill(-1); // la zone imposée (un point remarquable), sinon -1
    this.garde = new Uint8Array(w * h); // rien de posé ici : chemins, abords des portes
    this.dessus = new Uint8Array(w * h); // sous un pont, un ponton, une barque
    this.batiments = [];
    this.zones = []; // { nom, x, y, fixe }
    this.passages = []; // ponts, pontons, barques : [cle, x, y, rot, extra]
  }

  dedans(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  poser(x, y, sol) {
    if (!this.dedans(x, y) || this.bati[y * this.w + x]) return;
    this.sol[y * this.w + x] = sol;
  }

  // Une case où l'on marche (le dehors seulement : un bâtiment se joint par sa porte).
  marche(i) {
    return !!this.sol[i] && !this.bati[i] && (!SOLS_INFRANCHISSABLES.has(this.sol[i]) || !!this.dessus[i]);
  }

  disque(cx, cy, rayon, sol, garder = false) {
    for (let y = Math.floor(cy - rayon); y <= Math.ceil(cy + rayon); y++) {
      for (let x = Math.floor(cx - rayon); x <= Math.ceil(cx + rayon); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > rayon * rayon || !this.dedans(x, y)) continue;
        if (sol) this.poser(x, y, sol);
        if (garder) this.garde[y * this.w + x] = 1;
      }
    }
  }

  // Un trait épais de case en case, entre des points (un chemin, un ruisseau). Rend les cases tracées.
  trait(points, largeur, sol, { garder = false, si = null } = {}) {
    const cases = [];
    const vu = new Set();
    const tamponner = (x, y) => {
      const d0 = -Math.floor((largeur - 1) / 2);
      for (let j = d0; j < d0 + largeur; j++) {
        for (let i = d0; i < d0 + largeur; i++) {
          const nx = x + i;
          const ny = y + j;
          if (!this.dedans(nx, ny) || this.bati[ny * this.w + nx]) continue;
          const k = ny * this.w + nx;
          if (si && !si(this.sol[k], nx, ny)) continue;
          if (sol) this.sol[k] = sol;
          if (garder) this.garde[k] = 1;
          if (!vu.has(k)) {
            vu.add(k);
            cases.push([nx, ny]);
          }
        }
      }
    };
    for (let k = 1; k < points.length; k++) {
      let [x0, y0] = points[k - 1].map(Math.round);
      const [x1, y1] = points[k].map(Math.round);
      // Bresenham, sans diagonale : un pas en x puis un pas en y, pour que le trait se suive d'une case à l'autre.
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = Math.sign(x1 - x0);
      const sy = Math.sign(y1 - y0);
      let err = dx - dy;
      tamponner(x0, y0);
      while (x0 !== x1 || y0 !== y1) {
        const e2 = 2 * err;
        if (e2 > -dy && x0 !== x1) {
          err -= dy;
          x0 += sx;
        } else {
          err += dx;
          y0 += sy;
        }
        tamponner(x0, y0);
      }
    }
    return cases;
  }

  // Un bâtiment : sa boîte, sa porte (côté « h » ou « v », comme Chantier.porte), et ce qu'on y pose.
  batiment(b) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.l; x++) if (!this.dedans(x, y) || this.bati[y * this.w + x]) return null;
    this.batiments.push(b);
    const n = this.batiments.length;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.l; x++) this.bati[y * this.w + x] = n;
    // Devant la porte : rien de posé, et un sol où l'on marche.
    const [sens, px, py] = b.porte;
    const devant = sens === "h" ? (py === b.y ? [px, py - 1] : [px, py]) : px === b.x ? [px - 1, py] : [px, py];
    if (this.dedans(...devant)) {
      const k = devant[1] * this.w + devant[0];
      this.garde[k] = 1;
      if (SOLS_INFRANCHISSABLES.has(this.sol[k]) || !this.sol[k]) this.sol[k] = S.terre;
    }
    return b;
  }

  // Une zone à part (un point remarquable). fixe : ses cases sont les siennes (aire), elle ne s'étend pas.
  zone(nom, x, y, fixe = false) {
    this.zones.push({ nom, x: Math.round(x), y: Math.round(y), fixe });
    return this.zones.length - 1;
  }

  passage(cle, x, y, rot = 0, extra = {}) {
    const m = MEUBLES[cle];
    const l = extra.l ?? m.l;
    const h = extra.h ?? m.h;
    const [L, H] = rot % 180 ? [h, l] : [l, h];
    for (let j = y; j < y + H; j++) for (let i = x; i < x + L; i++) if (this.dedans(i, j)) this.dessus[j * this.w + i] = 1;
    this.passages.push([cle, x, y, rot, extra]);
  }

  // Ce qui reste coupé du reste (une île, un fond de vallon fermé par la falaise) se relie au plus court : l'eau
  // profonde traversée devient un gué, la falaise un passage d'éboulis. depart : une case de la pièce d'entrée.
  relier(depart) {
    const { w, h } = this;
    const n = w * h;
    for (let tour = 0; tour < 60; tour++) {
      const comp = new Int32Array(n).fill(-1);
      let k = 0;
      let principal = -1;
      for (let i = 0; i < n; i++) {
        if (comp[i] >= 0 || !this.marche(i)) continue;
        const pile = [i];
        comp[i] = k;
        while (pile.length) {
          const q = pile.pop();
          const x = q % w;
          const y = (q - x) / w;
          for (const [dx, dy] of VOISINS4) {
            const nx = x + dx;
            const ny = y + dy;
            const j = ny * w + nx;
            if (!this.dedans(nx, ny) || comp[j] >= 0 || !this.marche(j)) continue;
            comp[j] = k;
            pile.push(j);
          }
        }
        k++;
      }
      principal = comp[depart];
      if (principal < 0) {
        this.sol[depart] = S.terre;
        continue;
      }
      // La première composante coupée : le plus court chemin, par le dehors, jusqu'à la principale.
      let seule = -1;
      for (let i = 0; i < n && seule < 0; i++) if (comp[i] >= 0 && comp[i] !== principal) seule = comp[i];
      if (seule < 0) return;
      const venu = new Int32Array(n).fill(-2);
      const file = [];
      for (let i = 0; i < n; i++) {
        if (comp[i] !== seule) continue;
        venu[i] = -1;
        file.push(i);
      }
      let fin = -1;
      for (let t = 0; t < file.length && fin < 0; t++) {
        const q = file[t];
        const x = q % w;
        const y = (q - x) / w;
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * w + nx;
          if (!this.dedans(nx, ny) || venu[j] !== -2 || !this.sol[j] || this.bati[j]) continue;
          venu[j] = q;
          if (comp[j] === principal) {
            fin = j;
            break;
          }
          file.push(j);
        }
      }
      if (fin < 0) {
        // Rien ne la rejoint (enfermée par des bâtiments) : elle n'est plus un sol où l'on marche.
        for (let i = 0; i < n; i++) if (comp[i] === seule) this.sol[i] = S.falaise;
        continue;
      }
      for (let q = venu[fin]; q >= 0 && venu[q] !== -1; q = venu[q]) {
        if (this.sol[q] === S.profonde) this.sol[q] = S.eau;
        else if (this.sol[q] === S.falaise) this.sol[q] = S.gravier;
      }
    }
  }
}

// ---------------------------------------------------------------- du terrain au plan

// Le découpage en zones : les points remarquables d'abord (une aire fixe, ou une graine qui s'étend), puis des graines
// tirées au plus loin de toutes les autres, jusqu'à une zone pour TAILLE_ZONE cases du dehors ; chaque case va à la
// graine la plus proche par le dehors. Une zone qui dépasse ZONE_MAX cases reçoit une graine de plus, à son bout.
function decouper(T, r, noms) {
  const { w, h } = T;
  const n = w * h;
  const dehors = (i) => !!T.sol[i] && !T.bati[i];
  let libres = 0;
  for (let i = 0; i < n; i++) if (dehors(i) && T.aire[i] < 0) libres++;
  const graines = T.zones.map((z) => ({ ...z }));
  // Chaque graine sur une case du dehors (la plus proche).
  const caseDehors = (x, y) => {
    let meilleur = -1;
    let dmin = Infinity;
    for (let i = 0; i < n; i++) {
      if (!dehors(i)) continue;
      const d = ((i % w) - x) ** 2 + (Math.floor(i / w) - y) ** 2;
      if (d < dmin) {
        dmin = d;
        meilleur = i;
      }
    }
    return meilleur;
  };
  for (const g of graines) g.i = caseDehors(g.x, g.y);
  let numero = 0;
  const nommer = (i) => {
    const nom = noms[numero] || `${noms[0]}, ${direction(T, i)}`;
    numero++;
    return graines.some((g) => g.nom === nom) ? `${nom} (${numero})` : nom;
  };
  const voulues = graines.filter((g) => g.fixe).length + Math.max(2, Math.round(libres / TAILLE_ZONE));
  while (graines.length < voulues) {
    let meilleure = -1;
    let dmax = -1;
    for (let i = 0; i < n; i++) {
      if (!dehors(i) || T.aire[i] >= 0) continue;
      const x = i % w;
      const y = (i - x) / w;
      let d = Infinity;
      for (const g of graines) d = Math.min(d, (x - (g.i % w)) ** 2 + (y - Math.floor(g.i / w)) ** 2);
      // Un peu de hasard, pour que deux graines ne tombent pas toujours sur les mêmes cases.
      d *= 0.85 + 0.3 * r();
      if (d > dmax) {
        dmax = d;
        meilleure = i;
      }
    }
    if (meilleure < 0) break;
    graines.push({ nom: nommer(meilleure), i: meilleure, fixe: false });
  }
  // En largeur d'abord, depuis les graines qui s'étendent ; puis ce qui reste va à la zone voisine. Rend aussi, pour
  // chaque case, la case d'où elle est venue la plus loin de sa graine.
  const repartir = () => {
    const zone = new Int32Array(n).fill(-1);
    const dist = new Int32Array(n);
    for (let i = 0; i < n; i++) if (dehors(i) && T.aire[i] >= 0) zone[i] = T.aire[i];
    const etendre = (depuis) => {
      const file = [...depuis];
      for (let t = 0; t < file.length; t++) {
        const q = file[t];
        const x = q % w;
        const y = (q - x) / w;
        for (const [dx, dy] of VOISINS4) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * w + nx;
          if (!T.dedans(nx, ny) || zone[j] >= 0 || !dehors(j)) continue;
          zone[j] = zone[q];
          dist[j] = dist[q] + 1;
          file.push(j);
        }
      }
    };
    const departs = [];
    graines.forEach((g, k) => {
      if (g.fixe || g.i < 0 || zone[g.i] >= 0) return;
      zone[g.i] = k;
      departs.push(g.i);
    });
    etendre(departs);
    const tout = [];
    for (let i = 0; i < n; i++) if (zone[i] >= 0) tout.push(i);
    etendre(tout);
    // Une aire fixe coupée en deux (un ruisseau au travers de la clairière) : ses morceaux, sauf le plus grand, vont aux
    // zones voisines.
    const vu = new Uint8Array(n);
    const recoudre = [];
    for (let i = 0; i < n; i++) {
      if (zone[i] < 0 || vu[i]) continue;
      const morceau = [i];
      vu[i] = 1;
      for (let t = 0; t < morceau.length; t++) {
        const q = morceau[t];
        const x = q % w;
        const y = (q - x) / w;
        for (const [dx, dy] of VOISINS4) {
          const j = (y + dy) * w + x + dx;
          if (T.dedans(x + dx, y + dy) && !vu[j] && zone[j] === zone[i]) {
            vu[j] = 1;
            morceau.push(j);
          }
        }
      }
      recoudre.push(morceau);
    }
    const plusGrand = new Map();
    for (const m of recoudre) if (!plusGrand.has(zone[m[0]]) || plusGrand.get(zone[m[0]]).length < m.length) plusGrand.set(zone[m[0]], m);
    let defaits = false;
    for (const m of recoudre) {
      if (plusGrand.get(zone[m[0]]) === m) continue;
      for (const q of m) zone[q] = -1;
      defaits = true;
    }
    if (defaits) {
      const restes = [];
      for (let i = 0; i < n; i++) if (zone[i] >= 0) restes.push(i);
      etendre(restes);
    }
    for (let i = 0; i < n; i++) {
      if (!dehors(i) || zone[i] >= 0) continue;
      graines.push({ nom: nommer(i), i, fixe: false });
      zone[i] = graines.length - 1;
      etendre([i]);
    }
    return { zone, dist };
  };
  let res = repartir();
  for (let tour = 0; tour < 12; tour++) {
    const tailles = new Int32Array(graines.length);
    for (let i = 0; i < n; i++) if (res.zone[i] >= 0) tailles[res.zone[i]]++;
    let grosse = -1;
    tailles.forEach((t, k) => {
      if (t > ZONE_MAX && !graines[k].fixe && (grosse < 0 || t > tailles[grosse])) grosse = k;
    });
    if (grosse < 0) break;
    let bout = -1;
    for (let i = 0; i < n; i++) if (res.zone[i] === grosse && (bout < 0 || res.dist[i] > res.dist[bout])) bout = i;
    graines.push({ nom: nommer(bout), i: bout, fixe: false });
    res = repartir();
  }
  return { zone: res.zone, graines };
}

// « au nord », « à l'est »… : où tombe une case par rapport au centre du plan.
function direction(T, i) {
  const x = (i % T.w) - T.w / 2;
  const y = Math.floor(i / T.w) - T.h / 2;
  const k = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) / 45) % 8;
  return ["à l'est", "au sud-est", "au sud", "au sud-ouest", "à l'ouest", "au nord-ouest", "au nord", "au nord-est"][k];
}

// Pose le terrain dans le chantier : les zones (l'entrée d'abord, la zone 0), puis les bâtiments, leurs portes et
// fenêtres, les ponts, puis le mobilier (meubler : rien ne bouche une porte ni ne coupe un passage).
function batir(c, T, r, noms, { meubler = () => {}, apres = () => {} } = {}) {
  const { w } = T;
  const { zone, graines } = decouper(T, r, noms);
  // Une zone sans case (une graine avalée par une aire fixe) ne devient pas une pièce.
  const tailles = new Int32Array(graines.length);
  for (let i = 0; i < zone.length; i++) if (zone[i] >= 0) tailles[zone[i]]++;
  const ids = graines.map((g, k) => (tailles[k] ? c.piece(g.nom, "exterieur", 0, 0, 0, 0, 0) : 0));
  for (let i = 0; i < zone.length; i++) if (zone[i] >= 0) c.case(i % w, Math.floor(i / w), ids[zone[i]], T.sol[i]);
  for (const b of T.batiments) {
    b.id = c.piece(b.nom, "salle", b.sol, b.x, b.y, b.l, b.h);
    if (b.mur) c.p.pieces.find((q) => q.id === b.id).mur = b.mur;
    c.porte(...b.porte, b.genre || "porte", b.etat || "fermee");
    for (const f of b.fenetres || []) c.porte(...f, "fenetre");
  }
  for (const [cle, x, y, rot, extra] of T.passages) c.meuble(cle, x, y, rot, { ...extra });
  const outils = aides(c, T, r);
  for (const b of T.batiments) if (b.meubles) b.meubles(outils, b);
  meubler(outils);
  apres(outils);
  return outils;
}

// Les aides du mobilier : poser au dehors (sur un sol où l'on marche, hors des chemins gardés, jamais à cheval sur un
// bâtiment) ou dans un bâtiment (sur ses seules cases).
function aides(c, T, r) {
  const { w } = T;
  const p = c.p;
  const taille = (cle, rot, extra) => {
    const m = MEUBLES[cle];
    const l = extra.l ?? m.l;
    const h = extra.h ?? m.h;
    return rot % 180 ? [h, l] : [l, h];
  };
  // Comme Chantier.meubler, mais avec la taille demandée (extra.l, extra.h).
  const meubler = (cle, x, y, rot, extra) => {
    const m = MEUBLES[cle];
    const [l, h] = taille(cle, rot, extra);
    if (!c.libre(x, y, l, h)) return null;
    if (!m.franchissable && !c.sansCouper(x, y, l, h)) return null;
    return c.meuble(cle, x, y, rot, extra);
  };
  const dehors = (cle, x, y, rot = 0, { eau = false, roc = false, garde = false, ...extra } = {}) => {
    const [l, h] = taille(cle, rot, extra);
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + l; i++) {
        if (!T.dedans(i, j)) return null;
        const k = j * w + i;
        if (!p.sol[k] || T.bati[k] || (T.garde[k] && !garde) || T.dessus[k]) return null;
        if (p.sol[k] === S.profonde && !eau) return null;
        if (p.sol[k] === S.falaise && !roc) return null;
      }
    }
    return meubler(cle, x, y, rot, extra);
  };
  const dedans = (b, cle, x, y, rot = 0, extra = {}) => {
    const [l, h] = taille(cle, rot, extra);
    if (x < b.x || y < b.y || x + l > b.x + b.l || y + h > b.y + b.h) return null;
    return meubler(cle, x, y, rot, extra);
  };
  // Une barque sur l'eau, contre une case où l'on marche (on y monte depuis la rive ou le ponton).
  const amarrer = (x, y, rot = 0) => {
    const [l, h] = taille("barque", rot, {});
    let rive = false;
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + l; i++) {
      const dansLaBarque = i >= x && i < x + l && j >= y && j < y + h;
      if (dansLaBarque || (i !== x - 1 && i !== x + l && j !== y - 1 && j !== y + h) || ((i < x || i >= x + l) && (j < y || j >= y + h))) continue;
      const k = j * w + i;
      if (T.dedans(i, j) && p.sol[k] && !T.bati[k] && !c.obstacles()[k] && (!SOLS_INFRANCHISSABLES.has(p.sol[k]) || T.dessus[k])) rive = true;
    }
    for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) if (!T.dedans(i, j) || (p.sol[j * w + i] !== S.profonde && p.sol[j * w + i] !== S.eau)) return null;
    return rive ? dehors("barque", x, y, rot, { eau: true }) : null;
  };
  // La première place qui convient.
  const parmi = (f, places) => {
    for (const pl of places) {
      const o = f(...pl);
      if (o) return o;
    }
    return null;
  };
  // Des essais au hasard dans une boîte, jusqu'à n meubles posés.
  const semer = (n, essais, x0, y0, x1, y1, tirer, options = {}) => {
    let poses = 0;
    for (let k = 0; k < essais && poses < n; k++) {
      const cle = typeof tirer === "function" ? tirer() : tirer;
      const { tourner, ...reste } = options;
      const rot = tourner ? r.un([0, 90, 180, 270]) : 0;
      const o = dehors(cle, r.entre(x0, x1), r.entre(y0, y1), rot, reste);
      if (o) poses++;
    }
    return poses;
  };
  return { c, T, r, dehors, dedans, parmi, semer, meubler, amarrer };
}

// Le mobilier d'un bâtiment selon son usage. Le fond est le mur opposé à la porte ; rot suit Chantier (0 : contre le mur
// du haut, 180 : du bas, 90 : de gauche, 270 : de droite).
function meublerBatiment(genre) {
  return (o, b) => {
    const { dedans, parmi, r } = o;
    const [sens, , py] = b.porte;
    const fondEnHaut = sens === "h" ? py !== b.y : true;
    const yFond = fondEnHaut ? b.y : b.y + b.h - 1;
    const rotFond = fondEnHaut ? 0 : 180;
    const x0 = b.x;
    const x1 = b.x + b.l - 1;
    const yMilieu = b.y + Math.floor(b.h / 2);
    const contreLeFond = (cle, l = 1) => {
      const places = [];
      for (let d = 0; d < b.l; d++) for (const k of d ? [d, -d] : [0]) {
        const x = b.x + Math.floor((b.l - l) / 2) + k;
        if (x >= x0 && x + l - 1 <= x1) places.push([b, cle, x, cle === "lit" ? (fondEnHaut ? b.y : b.y + b.h - 2) : yFond, rotFond]);
      }
      return parmi(dedans, places);
    };
    const coins = (cle) => parmi(dedans, [[b, cle, x0, yFond], [b, cle, x1, yFond], [b, cle, x0, fondEnHaut ? b.y + b.h - 1 : b.y], [b, cle, x1, fondEnHaut ? b.y + b.h - 1 : b.y]]);
    const partout = (cle, rot = 0) => {
      const places = [];
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.l; x++) places.push([b, cle, x, y, rot]);
      for (let k = places.length - 1; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [places[k], places[j]] = [places[j], places[k]];
      }
      return parmi(dedans, places);
    };
    if (genre === "maison") {
      contreLeFond("cheminee", 2);
      parmi(dedans, [[b, "lit", x0, fondEnHaut ? b.y : b.y + b.h - 2], [b, "lit", x1, fondEnHaut ? b.y : b.y + b.h - 2]]);
      parmi(dedans, [[b, "table", x0 + Math.floor(b.l / 2) - 1, yMilieu], [b, "table", x0 + 1, yMilieu]]);
      coins("coffre");
      coins("tonneau");
    } else if (genre === "taverne") {
      contreLeFond("comptoir", 4) || contreLeFond("comptoir-angle");
      contreLeFond("cheminee", 2);
      for (let k = 0; k < 3; k++) partout("table-ronde");
      coins("tonneau");
      coins("tonneau");
      partout("tabouret");
    } else if (genre === "forge") {
      contreLeFond("forge", 2);
      partout("enclume");
      coins("bac-trempe");
      partout("ratelier");
      coins("caisse");
    } else if (genre === "echoppe") {
      contreLeFond("etal", 2);
      partout("presentoir");
      coins("caisse");
      coins("tonneau");
      coins("sacs");
    } else if (genre === "temple") {
      contreLeFond("autel", 2);
      for (let k = 0; k < 2; k++) partout("banc-temple");
      coins("candelabre");
      coins("candelabre");
      partout("statue");
    } else if (genre === "entrepot") {
      for (let k = 0; k < 3; k++) partout("caisses");
      for (let k = 0; k < 3; k++) partout("tonneau");
      coins("sacs");
    } else if (genre === "grange") {
      for (let k = 0; k < 3; k++) partout("foin");
      partout("charrette");
      coins("tonneau");
    } else if (genre === "cabane") {
      coins("lit");
      coins("coffre");
      partout("filet");
      coins("tonneau");
    } else if (genre === "tour") {
      parmi(dedans, [[b, "escalier-bas", x0, b.y, 0, { note: "L'escalier qui descend sous la tour." }], [b, "escalier-bas", x1, b.y, 0, { note: "L'escalier qui descend sous la tour." }]]);
      coins("caisse");
      partout("gravats");
      partout("ossements");
    }
  };
}

// Une porte sur un côté d'un bâtiment, et ses fenêtres sur le même côté. cote : "haut", "bas", "gauche", "droite".
function ouvertures(r, b, cote, nbFenetres = 1) {
  const long = cote === "haut" || cote === "bas" ? b.l : b.h;
  const k = r.entre(1, Math.max(1, long - 2));
  const pos = (t) => (cote === "haut" ? ["h", b.x + t, b.y] : cote === "bas" ? ["h", b.x + t, b.y + b.h] : cote === "gauche" ? ["v", b.x, b.y + t] : ["v", b.x + b.l, b.y + t]);
  b.porte = pos(k);
  b.fenetres = [];
  for (let n = 0, t = 0; n < nbFenetres && t < 12; t++) {
    const f = r.entre(0, long - 1);
    if (Math.abs(f - k) > 1 && !b.fenetres.some((x) => Math.abs((cote === "haut" || cote === "bas" ? x[1] - b.x : x[2] - b.y) - f) < 2)) {
      b.fenetres.push(pos(f));
      n++;
    }
  }
  return b;
}

const ARBRES = [["arbre", 34], ["sapin", 16], ["chene", 10], ["bouleau", 10], ["buisson", 10], ["souche", 3], ["tronc", 3], ["arbre-mort", 3], ["rochers", 3], ["fougeres", 8]];
function tirage(r, table) {
  const total = table.reduce((s, [, p]) => s + p, 0);
  return () => {
    let t = r() * total;
    for (const [cle, p] of table) if ((t -= p) < 0) return cle;
    return table[0][0];
  };
}

// Une ligne qui serpente d'un bord à l'autre : des points tous les pas cases, écartés au hasard de la droite.
function serpent(r, x0, y0, x1, y1, pas, ecart) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / pas));
  const nx = -(y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
  const ny = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0);
  const pts = [];
  let d = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (k && k < n) d = Math.max(-ecart, Math.min(ecart, d + (r() - 0.5) * ecart));
    else d = k ? 0 : d;
    pts.push([x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d]);
  }
  return pts;
}

const entre = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- ville

function ville(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(52, 56);
  const H = r.entre(36, 40);
  const c = new Chantier(W, H, "Ville");
  const T = new Terrain(W, H, S.terre);
  const nb = bruit(r, W, H, 6);
  for (let i = 0; i < W * H; i++) T.sol[i] = nb[i] > 0.56 ? S.herbe : S.terre;
  const m = 2; // les faubourgs, autour des pâtés
  // Les pâtés, entre des rues : des tranches de longueur voulue, la rue du milieu plus large.
  const tranches = (debut, fin, cible, rue) => {
    const L = fin - debut;
    const k = Math.max(2, Math.round((L + rue) / (cible + rue)));
    const milieu = Math.floor((k - 1) / 2);
    const rues = Array.from({ length: k - 1 }, (_, i) => (i === milieu ? rue + 1 : rue));
    const reste = L - rues.reduce((s, v) => s + v, 0);
    const tailles = Array.from({ length: k }, (_, i) => Math.floor(reste / k) + (i < reste % k ? 1 : 0));
    for (let t = 0; t < k; t++) {
      const a = r.entre(0, k - 1);
      const b2 = r.entre(0, k - 1);
      if (a !== b2 && tailles[a] > cible - 2 && tailles[b2] < cible + 2) {
        tailles[a]--;
        tailles[b2]++;
      }
    }
    const res = [];
    let x = debut;
    tailles.forEach((t, i) => {
      res.push({ debut: x, fin: x + t, rue: i < rues.length ? [x + t, rues[i]] : null });
      x += t + (rues[i] || 0);
    });
    return res;
  };
  const colonnes = tranches(m, W - m, 14, 2);
  const rangees = tranches(m, H - m, 10, 2);
  // Les rues pavées, jusqu'au bord du plan.
  for (const col of colonnes) if (col.rue) for (let x = col.rue[0]; x < col.rue[0] + col.rue[1]; x++) for (let y = 0; y < H; y++) T.poser(x, y, S.paves);
  for (const ran of rangees) if (ran.rue) for (let y = ran.rue[0]; y < ran.rue[0] + ran.rue[1]; y++) for (let x = 0; x < W; x++) T.poser(x, y, S.paves);
  // La rue du milieu : l'entrée de la ville, au bas du plan.
  const grande = colonnes[Math.floor((colonnes.length - 1) / 2)].rue;
  T.zone("L'entrée de la ville", grande[0] + 1, H - 1);
  // La place : le pâté le plus proche du centre.
  let place = null;
  for (const col of colonnes) for (const ran of rangees) {
    const d = Math.hypot((col.debut + col.fin) / 2 - W / 2, (ran.debut + ran.fin) / 2 - H / 2);
    if (!place || d < place.d) place = { d, x0: col.debut, x1: col.fin, y0: ran.debut, y1: ran.fin };
  }
  const zPlace = T.zone("La place", (place.x0 + place.x1) / 2, (place.y0 + place.y1) / 2, true);
  for (let y = place.y0 - 1; y <= place.y1; y++) {
    for (let x = place.x0 - 1; x <= place.x1; x++) {
      if (!T.dedans(x, y)) continue;
      T.poser(x, y, S.paves);
      if (x >= place.x0 && x < place.x1 && y >= place.y0 && y < place.y1) T.aire[y * W + x] = zPlace;
    }
  }
  // Les lots : deux rangées dos à dos par pâté, chacune ouverte sur la rue (ou les faubourgs) de son côté.
  const lots = [];
  for (const col of colonnes) {
    for (const ran of rangees) {
      if (col.debut === place.x0 && ran.debut === place.y0) continue;
      const D = ran.fin - ran.debut;
      const dHaut = entre(Math.floor(D / 2) + r.entre(-1, 1), 4, D - 4);
      for (const [y, d, cote] of [[ran.debut, dHaut, "haut"], [ran.debut + dHaut, D - dHaut, "bas"]]) {
        let x = col.debut;
        while (x < col.fin) {
          const reste = col.fin - x;
          const l = reste <= 8 ? reste : r.entre(5, Math.min(8, reste - 5));
          lots.push({ x, y, l, h: d, cote, D, yPate: ran.debut });
          x += l;
        }
      }
    }
  }
  // Les bâtiments remarquables, au plus près de la place.
  const cx = (place.x0 + place.x1) / 2;
  const cy = (place.y0 + place.y1) / 2;
  lots.sort((a, b) => Math.hypot(a.x + a.l / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.l / 2 - cx, b.y + b.h / 2 - cy));
  const remarquables = [["La taverne", "taverne", S.plancher, "torchis"], ["Le temple", "temple", S.dalles, "pierre"], ["La forge", "forge", S.terre, "pierre"],
    ["L'échoppe", "echoppe", S.plancher, "torchis"], ["L'entrepôt", "entrepot", S.terre, "bois"], ["L'échoppe du drapier", "echoppe", S.plancher, "torchis"]];
  let maison = 0;
  let suivant = 0;
  for (const lot of lots) {
    // Un lot sur huit reste une cour ou un jardin, ouvert sur la rue.
    if (suivant >= remarquables.length && r.pile(0.12)) {
      for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.l; x++) T.poser(x, y, r.pile(0.7) ? S.herbe : S.terre);
      lot.jardin = true;
      continue;
    }
    const rem = suivant < remarquables.length && lot.l * lot.h >= 24 ? remarquables[suivant++] : null;
    const [nom, genre, sol, mur] = rem || [`Maison ${++maison}`, "maison", r.pile(0.7) ? S.plancher : S.terre, r.pile(0.75) ? "torchis" : "pierre"];
    const b = ouvertures(r, { x: lot.x, y: lot.y, l: lot.l, h: lot.h, nom, sol, mur }, lot.cote, lot.l >= 6 ? 2 : 1);
    // On entre dans les bâtiments remarquables et dans une maison sur trois ; les autres sont fermées à clé.
    b.etat = rem || r.pile(0.33) ? "fermee" : "verrouillee";
    if (genre === "temple" || genre === "entrepot") b.genre = "double";
    if (b.etat === "fermee") b.meubles = meublerBatiment(genre);
    T.batiment(b);
  }
  // Les rues, nommées de la plus proche de l'entrée à la plus loin.
  const noms = ["Rue des Tanneurs", "Rue du Marché", "Rue Basse", "Rue Haute", "Rue des Forges", "Rue aux Fèvres", "Rue du Puits", "Rue des Potiers",
    "Ruelle des Chandeliers", "Rue de la Monnaie", "Les faubourgs", "Rue des Lavandières", "Rue du Four", "Rue de l'Étuve"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, parmi, semer } = o;
      // La fontaine au milieu de la place, les étals autour.
      const fx = Math.floor(cx) - 1;
      const fy = Math.floor(cy) - 1;
      dehors("fontaine", fx, fy, 0, { l: 3, h: 3 }) || dehors("fontaine", fx, fy);
      for (const [x, y, rot] of [[fx - 3, fy - 2, 0], [fx + 3, fy - 2, 0], [fx - 3, fy + 3, 0], [fx + 3, fy + 3, 0], [fx - 4, fy, 90], [fx + 5, fy, 90]]) {
        if (r.pile(0.7)) dehors("etal", x, y, rot, { teinte: r.un(["#8e2a20", "#2c3e66", "#b8862e", "#2e5a4a", "#d6cab0"]) });
      }
      parmi(dehors, [[fx - 4, fy + 4, 90, {}], [fx + 4, fy - 4, 0, {}]].map(([x, y, rot]) => ["charrette", x, y, rot]));
      dehors("panneau", T.zones[0].x + 2, H - 2);
      // Contre les façades : des tonneaux, des caisses, un banc.
      semer(14, 220, 0, 0, W - 1, H - 1, tirage(r, [["tonneau", 4], ["caisse", 3], ["banc", 2], ["sacs", 1]]));
      // Les faubourgs et les jardins : des arbres, un puits.
      semer(16, 260, 0, 0, W - 1, H - 1, tirage(r, [["arbre", 5], ["buisson", 3], ["bouleau", 2]]));
      for (const lot of lots) if (lot.jardin && r.pile(0.4)) dehors(r.pile() ? "puits" : "potager", lot.x + 1, lot.y + 1);
    },
  });
  c.p.lumiere = "jour";
  return c.fini("ville", graine);
}

// ---------------------------------------------------------------- village

function village(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(46, 50);
  const H = r.entre(32, 35);
  const c = new Chantier(W, H, "Village");
  const T = new Terrain(W, H, S.herbe);
  const nb = bruit(r, W, H, 7);
  for (let i = 0; i < W * H; i++) if (nb[i] > 0.66) T.sol[i] = S.terre;
  // Le chemin d'ouest en est, et un autre qui part vers le nord ou le sud depuis la place.
  const yRoute = Math.round(H / 2) + r.entre(-3, 3);
  const route = serpent(r, 0, yRoute, W - 1, yRoute + r.entre(-3, 3), 8, 3);
  const casesRoute = T.trait(route, 2, S.terre, { garder: true });
  const px = Math.round(W / 2) + r.entre(-6, 6);
  const pyRoute = casesRoute.filter(([x]) => x === px).map(([, y]) => y);
  const py = pyRoute.length ? Math.min(...pyRoute) : yRoute;
  const versLeNord = r.pile();
  const branche = serpent(r, px, py, px + r.entre(-8, 8), versLeNord ? 0 : H - 1, 6, 2);
  T.trait(branche, 2, S.terre, { garder: true });
  T.zone("Le chemin", 0, route[0][1]);
  // La place du puits, au croisement.
  const zPlace = T.zone("La place du puits", px, py, true);
  for (let y = py - 3; y <= py + 3; y++) for (let x = px - 4; x <= px + 4; x++) {
    if (!T.dedans(x, y) || (x - px) ** 2 / 20 + (y - py) ** 2 / 12 > 1) continue;
    T.poser(x, y, S.terre);
    T.aire[y * W + x] = zPlace;
  }
  // Les maisons, le long des chemins, la porte vers le chemin le plus proche.
  const chemins = new Set();
  for (let i = 0; i < W * H; i++) if (T.garde[i]) chemins.add(i);
  const loin = (x, y, l, h) => {
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + l; i++) if (!T.dedans(i, j) || T.garde[j * W + i] || T.bati[j * W + i] || T.aire[j * W + i] >= 0) return false;
    return true;
  };
  const genres = [["La forge", "forge", S.terre, "pierre"], ["La grange", "grange", S.paille, "bois"], ["La chapelle", "temple", S.dalles, "pierre"]];
  let maison = 0;
  const maisons = [];
  for (let essai = 0; essai < 400 && maisons.length < 7; essai++) {
    const l = r.entre(5, 7);
    const h = r.entre(4, 6);
    const [rx, ry] = r.un([...chemins].map((i) => [i % W, Math.floor(i / W)]));
    const cote = r.un(["haut", "bas", "gauche", "droite"]);
    // La maison se pose à une case du chemin, face à lui.
    const x = cote === "gauche" ? rx + 2 : cote === "droite" ? rx - l - 1 : rx - Math.floor(l / 2);
    const y = cote === "haut" ? ry + 2 : cote === "bas" ? ry - h - 1 : ry - Math.floor(h / 2);
    if (x < 1 || y < 1 || x + l > W - 1 || y + h > H - 1 || !loin(x, y, l, h)) continue;
    const g = maisons.length < genres.length && maisons.length >= 1 ? genres[maisons.length - 1] : null;
    const [nom, genre, sol, mur] = g || [`Maison ${++maison}`, "maison", r.pile() ? S.plancher : S.terre, r.pile(0.6) ? "torchis" : "bois"];
    const b = ouvertures(r, { x, y, l, h, nom, sol, mur }, cote, 1);
    b.etat = g || r.pile(0.5) ? "fermee" : "verrouillee";
    if (genre === "grange") b.genre = "double";
    if (b.etat === "fermee") b.meubles = meublerBatiment(genre);
    if (!T.batiment(b)) continue;
    // De la porte au chemin, un sentier.
    const [sens, dx, dy] = b.porte;
    const devant = sens === "h" ? (dy === b.y ? [dx, dy - 1] : [dx, dy]) : dx === b.x ? [dx - 1, dy] : [dx, dy];
    T.trait([devant, cote === "haut" || cote === "bas" ? [devant[0], ry] : [rx, devant[1]]], 1, S.terre, { garder: true });
    maisons.push(b);
  }
  // Les champs, loin des maisons : des rectangles de cultures ; l'enclos, un pré fermé d'une clôture et sa barrière.
  const champs = [];
  for (let essai = 0; essai < 200 && champs.length < 4; essai++) {
    const l = r.entre(6, 10);
    const h = r.entre(4, 7);
    const x = r.entre(1, W - l - 1);
    const y = r.entre(1, H - h - 1);
    if (!loin(x, y, l, h) || champs.some((f) => x < f.x + f.l + 2 && x + l + 2 > f.x && y < f.y + f.h + 2 && y + h + 2 > f.y)) continue;
    champs.push({ x, y, l, h });
  }
  const enclos = champs.length >= 3 ? champs.pop() : null;
  champs.forEach((f, k) => {
    const z = T.zone(k ? `Le champ ${k + 1}` : "Les champs", f.x + f.l / 2, f.y + f.h / 2, true);
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.l; x++) {
      T.poser(x, y, S.cultures);
      T.aire[y * W + x] = z;
    }
  });
  if (enclos) {
    const z = T.zone("L'enclos", enclos.x + enclos.l / 2, enclos.y + enclos.h / 2, true);
    for (let y = enclos.y; y < enclos.y + enclos.h; y++) for (let x = enclos.x; x < enclos.x + enclos.l; x++) {
      T.poser(x, y, S.herbe);
      T.aire[y * W + x] = z;
    }
  }
  const noms = ["Les prés", "La lisière", "Le verger", "Derrière les maisons", "Le pâtis", "La haie", "Le bas du village", "Le haut du village"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer, parmi } = o;
      const autour = [];
      for (let d = 1; d <= 4; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) autour.push(["puits", px + dx, py + dy]);
      const puits = parmi(dehors, autour);
      if (puits) dehors("banc", puits.x + 1, puits.y + 1) || dehors("banc", puits.x - 2, puits.y - 1);
      if (enclos) {
        // La clôture, par tronçons, en laissant une barrière ouverte au milieu du côté le plus proche du chemin.
        const { x, y, l, h } = enclos;
        const barriere = r.entre(1, l - 2);
        for (let k = 0; k < l; k++) {
          if (k !== barriere) dehors("cloture", x + k, y, 0, { l: 1 });
          dehors("cloture", x + k, y + h - 1, 0, { l: 1 });
        }
        for (let k = 1; k < h - 1; k++) {
          dehors("cloture", x, y + k, 90, { l: 1 });
          dehors("cloture", x + l - 1, y + k, 90, { l: 1 });
        }
        dehors("foin", x + 2, y + 2);
        dehors("epouvantail", x + l - 3, y + h - 3);
      }
      for (const b of maisons) if (r.pile(0.5)) dehors("potager", b.x + b.l + 1, b.y) || dehors("potager", b.x - 3, b.y);
      for (const f of champs) if (r.pile(0.6)) dehors("epouvantail", f.x + Math.floor(f.l / 2), f.y + Math.floor(f.h / 2));
      dehors("charrette", px + 3, py - 4) || dehors("charrette", px - 5, py - 4);
      dehors("panneau", 2, route[0][1] - 2);
      semer(22, 300, 0, 0, W - 1, H - 1, tirage(r, [["arbre", 6], ["buisson", 4], ["chene", 1], ["bouleau", 2]]));
    },
  });
  c.p.lumiere = "jour";
  return c.fini("village", graine);
}

// ---------------------------------------------------------------- forêt

function foret(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(42, 46);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Forêt");
  const nb = bruit(r, W, H, 6);
  const T = new Terrain(W, H, S.herbe);
  for (let i = 0; i < W * H; i++) T.sol[i] = nb[i] < 0.38 ? S.mousse : nb[i] > 0.62 ? S.feuilles : S.herbe;
  // Le ruisseau, du nord au sud, profond d'une ou deux cases.
  const xr = Math.round(W * (0.55 + 0.2 * r()));
  const ruisseau = serpent(r, xr, 0, xr + r.entre(-6, 6), H - 1, 4, 4);
  const lit = T.trait(ruisseau, r.pile() ? 2 : 1, S.profonde);
  // Le sentier, d'ouest en est, qui passe le ruisseau.
  const ys = Math.round(H * (0.3 + 0.4 * r()));
  const sentier = serpent(r, 0, ys, W - 1, ys + r.entre(-6, 6), 6, 4);
  const surLeSentier = T.trait(sentier, 2, S.terre, { garder: true, si: (s) => s !== S.profonde });
  T.trait(sentier, 2, null, { garder: true });
  T.zone("L'orée du bois", 0, sentier[0][1]);
  // Là où le sentier croise le ruisseau : un pont, ou un gué de cailloux.
  const croisement = lit.filter(([x, y]) => T.garde[y * W + x]);
  if (croisement.length) {
    const xs = croisement.map(([x]) => x);
    const yc = croisement.map(([, y]) => y);
    const x0 = Math.min(...xs) - 1;
    const x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...yc);
    if (r.pile(0.55)) {
      T.passage("pont", x0, y0, 90, { l: 2, h: x1 - x0 + 1 });
      T.zone("Le pont", (x0 + x1) / 2, y0);
    } else {
      for (const [x, y] of croisement) T.sol[y * W + x] = S.eau;
      T.zone("Le gué", (x0 + x1) / 2, y0);
    }
  }
  // Un second gué plus loin, en amont ou en aval.
  const ailleurs = lit.filter(([, y]) => Math.abs(y - ys) > 8);
  if (ailleurs.length && r.pile(0.6)) {
    const [gx, gy] = r.un(ailleurs);
    for (const [x, y] of lit) if (Math.abs(y - gy) <= 1 && Math.abs(x - gx) <= 2) T.sol[y * W + x] = S.eau;
  }
  // La clairière, à l'écart du sentier.
  const cxl = entre(Math.round(W * (r.pile() ? 0.25 : 0.4)), 6, W - 7);
  const cyl = ys > H / 2 ? r.entre(5, Math.round(H / 2) - 3) : r.entre(Math.round(H / 2) + 3, H - 6);
  const rc = r.entre(3, 5);
  const zClairiere = T.zone("La clairière", cxl, cyl, true);
  for (let y = cyl - rc; y <= cyl + rc; y++) for (let x = cxl - rc; x <= cxl + rc; x++) {
    if (!T.dedans(x, y) || (x - cxl) ** 2 + (y - cyl) ** 2 > rc * rc + 1 || T.sol[y * W + x] === S.profonde) continue;
    T.sol[y * W + x] = S.herbe;
    T.aire[y * W + x] = zClairiere;
  }
  const noms = ["Le sous-bois", "Les fourrés", "La futaie", "Le taillis", "Les grands arbres", "La combe", "Le roncier", "La hêtraie", "La sapinière", "Les fougères"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  void surLeSentier;
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      if (r.pile(0.6)) dehors("feu-de-camp", cxl, cyl);
      if (r.pile(0.5)) dehors("souche", cxl + 2, cyl - 1);
      if (r.pile(0.4)) dehors("menhir", cxl - 2, cyl + 1);
      // Les roseaux au bord de l'eau.
      for (const [x, y] of lit) {
        for (const [dx] of [[-1], [1], [-2], [2]]) if (r.pile(0.12)) dehors("roseaux", x + dx, y);
      }
      // Le bois, serré : un arbre partout où il ne coupe aucun passage. Il laisse la clairière presque nue.
      const tirer = tirage(r, ARBRES);
      for (let k = 0; k < W * H * 0.55; k++) {
        const x = r.entre(0, W - 1);
        const y = r.entre(0, H - 1);
        if (T.aire[y * W + x] === zClairiere && r.pile(0.9)) continue;
        dehors(tirer(), x, y, r.pile(0.3) ? 90 : 0);
      }
      semer(6, 60, 0, 0, W - 1, H - 1, "fougeres");
    },
  });
  c.p.lumiere = "jour";
  return c.fini("foret", graine);
}

// ---------------------------------------------------------------- montagne

function montagne(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(44, 48);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Montagne");
  const T = new Terrain(W, H, S.herbe);
  const nb = bruit(r, W, H, 5);
  // De l'alpage en bas à la neige au col : la roche gagne en montant.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hauteur = 1 - y / H + (nb[y * W + x] - 0.5) * 0.35;
    T.sol[y * W + x] = hauteur > 0.84 ? S.neige : hauteur > 0.62 ? S.roche : hauteur > 0.5 ? S.gravier : S.herbe;
  }
  // Deux barres de falaise en travers, chacune percée d'un seul passage, à gauche puis à droite : le sentier fait des
  // lacets. En haut, deux masses de roc et le col entre elles.
  const ondule = bruit(r, W, 1, 6, 1);
  const barres = [Math.round(H * 0.66), Math.round(H * 0.38)];
  const gauche = r.pile();
  const passages = [];
  barres.forEach((yb, k) => {
    const ep = r.entre(2, 3);
    const xg = (k % 2 === 0) === gauche ? r.entre(4, Math.round(W * 0.3)) : r.entre(Math.round(W * 0.7), W - 7);
    passages.push([xg + 1, yb]);
    for (let x = 0; x < W; x++) {
      const y0 = yb + Math.round((ondule[x] - 0.5) * 4);
      if (x >= xg && x < xg + 3) continue;
      for (let y = y0; y < y0 + ep; y++) T.poser(x, y, S.falaise);
    }
  });
  const xcol = Math.round(W / 2) + r.entre(-4, 4);
  const lcol = r.entre(3, 4);
  for (let y = 0; y < Math.round(H * 0.22); y++) {
    const pince = Math.round((Math.round(H * 0.22) - y) * 0.4);
    for (let x = 0; x < W; x++) if (x < xcol - pince - 1 || x > xcol + lcol + pince) T.poser(x, y, S.falaise);
  }
  // Le sentier : du pied au premier passage, puis au second, puis au col, en lacets là où la pente le permet.
  const pied = [Math.round(W / 2) + r.entre(-8, 8), H - 1];
  const etapes = [pied, ...passages, [xcol + 1, 0]];
  const pts = [etapes[0]];
  for (let k = 1; k < etapes.length; k++) {
    const [ax, ay] = etapes[k - 1];
    const [bx, by] = etapes[k];
    // Deux lacets entre chaque passage : on va et vient en montant.
    const n = 2;
    for (let t = 1; t <= n; t++) {
      const y = ay + ((by - ay) * t) / (n + 1);
      const x = t % 2 ? bx + (ax < bx ? 5 : -5) : ax;
      pts.push([entre(x, 1, W - 2), y]);
    }
    pts.push([bx, by]);
  }
  T.trait(pts, 2, S.terre, { garder: true, si: (s) => s !== S.falaise });
  T.trait(pts, 2, null, { garder: true });
  T.zone("Le pied de la montagne", pied[0], H - 1);
  T.zone("Le col", xcol + 1, 1);
  T.zone("Les lacets", passages[0][0], passages[0][1] + 3);
  T.zone("La corniche", passages[1][0], passages[1][1] + 2);
  // Un éboulis : du gravier et des blocs, sur une pente.
  const ex = r.entre(6, W - 10);
  const ey = r.entre(Math.round(H * 0.42), Math.round(H * 0.6));
  const zEboulis = T.zone("L'éboulis", ex, ey);
  for (let y = ey - 3; y <= ey + 3; y++) for (let x = ex - 5; x <= ex + 5; x++) {
    if (T.dedans(x, y) && T.sol[y * W + x] !== S.falaise && (x - ex) ** 2 / 25 + (y - ey) ** 2 / 9 <= 1) T.sol[y * W + x] = S.gravier;
  }
  void zEboulis;
  const noms = ["Les alpages", "La pente", "Les rochers", "Le pierrier", "Le replat", "La combe", "Les névés", "L'épaulement"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      semer(6, 80, ex - 5, ey - 3, ex + 5, ey + 3, tirage(r, [["eboulis", 2], ["rochers", 3], ["gros-rocher", 1]]));
      // Du relief sur la falaise : des blocs qu'on ne passe pas plus que le roc.
      semer(24, 400, 0, 0, W - 1, H - 1, tirage(r, [["gros-rocher", 2], ["rochers", 3]]), { roc: true });
      semer(14, 300, 0, 0, W - 1, H - 1, tirage(r, [["rochers", 4], ["gros-rocher", 1], ["menhir", 1]]));
      // Les sapins, plus bas.
      semer(16, 300, 0, Math.round(H * 0.55), W - 1, H - 1, tirage(r, [["sapin", 5], ["buisson", 2], ["arbre-mort", 1]]));
      dehors("panneau", pied[0] + 2, H - 2);
    },
  });
  c.p.lumiere = "jour";
  return c.fini("montagne", graine);
}

// ---------------------------------------------------------------- désert

function desert(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(44, 48);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Désert");
  const T = new Terrain(W, H, S.sable);
  const nb = bruit(r, W, H, 7);
  const roc = bruit(r, W, H, 4);
  for (let i = 0; i < W * H; i++) {
    if (roc[i] > 0.8) T.sol[i] = S.falaise;
    else if (roc[i] > 0.7) T.sol[i] = S.roche;
    else if (nb[i] > 0.7) T.sol[i] = S.gravier;
  }
  // La piste, d'ouest en est.
  const yp = Math.round(H * (0.35 + 0.3 * r()));
  const piste = serpent(r, 0, yp, W - 1, yp + r.entre(-5, 5), 7, 3);
  T.trait(piste, 2, S.terre, { garder: true });
  T.zone("La piste", 0, piste[0][1]);
  // L'oasis : une mare profonde, sa rive, l'herbe et les palmiers.
  const ox = r.entre(Math.round(W * 0.25), Math.round(W * 0.75));
  const oy = yp > H / 2 ? r.entre(6, Math.round(H / 2) - 4) : r.entre(Math.round(H / 2) + 4, H - 7);
  const zOasis = T.zone("L'oasis", ox, oy, true);
  for (let y = oy - 6; y <= oy + 6; y++) for (let x = ox - 7; x <= ox + 7; x++) {
    if (!T.dedans(x, y)) continue;
    const d = Math.hypot((x - ox) / 1.3, y - oy) + (nb[y * W + x] - 0.5) * 1.5;
    if (d > 5.5) continue;
    T.sol[y * W + x] = d < 1.8 ? S.profonde : d < 2.8 ? S.eau : S.herbe;
    T.aire[y * W + x] = zOasis;
  }
  // Les ruines ensablées, de l'autre côté de la piste que l'oasis, ou plus loin sur le même.
  let rx = r.entre(4, W - 14);
  const ry = oy < H / 2 ? r.entre(Math.round(H / 2) + 3, H - 10) : r.entre(3, Math.round(H / 2) - 8);
  if (Math.abs(rx - ox) < 10) rx = entre(ox + 12, 4, W - 14);
  const ruines = { x: rx, y: ry, l: r.entre(8, 10), h: r.entre(6, 7) };
  const zRuines = T.zone("Les ruines", rx + ruines.l / 2, ry + ruines.h / 2, true);
  for (let y = ry - 1; y <= ry + ruines.h; y++) for (let x = rx - 1; x <= rx + ruines.l; x++) {
    if (!T.dedans(x, y)) continue;
    T.sol[y * W + x] = nb[y * W + x] < 0.52 ? S.dalles : S.sable;
    T.aire[y * W + x] = zRuines;
  }
  const noms = ["Les dunes", "La mer de sable", "Le reg", "Les rochers", "Le plateau", "La dune haute", "Les cailloux", "Le creux"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      // Les murs des ruines, par pans, avec des brèches ; des colonnes brisées, une statue, des gravats.
      const { x, y, l, h } = ruines;
      for (let k = 0; k < l; k += 3) {
        if (r.pile(0.7)) dehors("mur-ruine", x + k, y, 0, { l: Math.min(3, l - k) });
        if (r.pile(0.7)) dehors("mur-ruine", x + k, y + h - 1, 0, { l: Math.min(3, l - k) });
      }
      for (let k = 1; k < h - 1; k += 3) {
        if (r.pile(0.6)) dehors("mur-ruine", x, y + k, 90, { l: Math.min(3, h - 1 - k) });
        if (r.pile(0.6)) dehors("mur-ruine", x + l - 1, y + k, 90, { l: Math.min(3, h - 1 - k) });
      }
      semer(5, 60, x + 1, y + 1, x + l - 2, y + h - 2, tirage(r, [["colonne-brisee", 3], ["colonne-couchee", 1], ["statue-brisee", 1], ["gravats", 3]]));
      if (r.pile(0.5)) dehors("escalier-bas", x + Math.floor(l / 2), y + 2, 0, { note: "Des marches sous le sable : la crypte des ruines." });
      // L'oasis : des palmiers autour de l'eau, des buissons.
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2;
        const d = 3 + r() * 2.2;
        dehors(r.pile(0.8) ? "palmier" : "buisson", Math.round(ox + Math.cos(a) * d * 1.3) - 1, Math.round(oy + Math.sin(a) * d) - 1);
      }
      for (let k = 0; k < 12; k++) dehors("roseaux", ox + r.entre(-4, 4), oy + r.entre(-3, 3));
      // Les dunes sur le sable, des rochers sur la roche.
      semer(26, 400, 0, 0, W - 1, H - 1, "dune", { tourner: true });
      semer(14, 300, 0, 0, W - 1, H - 1, tirage(r, [["rochers", 3], ["gros-rocher", 2], ["arbre-mort", 1], ["ossements", 1]]));
      semer(10, 200, 0, 0, W - 1, H - 1, tirage(r, [["gros-rocher", 1], ["rochers", 1]]), { roc: true });
    },
  });
  c.p.lumiere = "jour";
  return c.fini("desert", graine);
}

// ---------------------------------------------------------------- marais

function marais(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(42, 46);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Marais");
  const T = new Terrain(W, H, S.boue);
  const nb = bruit(r, W, H, 5);
  const v = bruit(r, W, H, 9, 1);
  for (let i = 0; i < W * H; i++) {
    const e = nb[i] * 0.7 + v[i] * 0.3;
    T.sol[i] = e > 0.62 ? S.profonde : e > 0.55 ? S.eau : e > 0.45 ? S.boue : e > 0.33 ? S.mousse : S.herbe;
  }
  // Le chemin de planches : une diagonale d'un bord à l'autre ; sur l'eau profonde, des passerelles.
  const y0 = r.entre(3, H - 4);
  const chemin = serpent(r, 0, y0, W - 1, r.entre(3, H - 4), 6, 4);
  const cases = T.trait(chemin, 1, null, { garder: true });
  for (const [x, y] of cases) if (T.sol[y * W + x] !== S.profonde) T.sol[y * W + x] = S.terre;
  T.zone("Le bord du marais", 0, y0);
  // Les planches : un tronçon par case d'eau profonde, dans le sens du chemin.
  cases.forEach(([x, y], k) => {
    if (T.sol[y * W + x] !== S.profonde) return;
    const [ax, ay] = cases[Math.max(0, k - 1)];
    const [bx, by] = cases[Math.min(cases.length - 1, k + 1)];
    T.passage("passerelle", x, y, Math.abs(bx - ax) >= Math.abs(by - ay) ? 90 : 0, { l: 1, h: 1 });
  });
  // L'îlot : une butte sèche au milieu de l'eau, la cabane de la sorcière ou du passeur.
  const ix = r.entre(8, W - 12);
  const iy = Math.abs(r.entre(6, H - 9) - y0) < 6 ? (y0 > H / 2 ? 5 : H - 10) : r.entre(6, H - 9);
  const zIlot = T.zone("L'îlot", ix + 2, iy + 2);
  for (let y = iy - 3; y <= iy + 6; y++) for (let x = ix - 3; x <= ix + 7; x++) {
    if (!T.dedans(x, y)) continue;
    const d = Math.hypot((x - ix - 2) / 1.4, y - iy - 1.5);
    if (d < 3.8) T.poser(x, y, S.herbe);
    else if (d < 5.2 && T.sol[y * W + x] !== S.terre) T.poser(x, y, S.profonde);
  }
  const cabane = ouvertures(r, { x: ix, y: iy, l: 5, h: 4, nom: "La cabane", sol: S.plancher, mur: "bois" }, r.pile() ? "bas" : "droite", 1);
  cabane.etat = r.pile(0.7) ? "fermee" : "verrouillee";
  cabane.meubles = meublerBatiment("cabane");
  T.batiment(cabane);
  void zIlot;
  const noms = ["Les roselières", "Les eaux mortes", "La tourbière", "Les saules", "La vase", "Les joncs", "La fondrière", "Les mares"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      semer(40, 500, 0, 0, W - 1, H - 1, "roseaux");
      semer(18, 400, 0, 0, W - 1, H - 1, tirage(r, [["saule", 2], ["arbre-mort", 3], ["souche", 2], ["buisson", 2], ["tronc", 1]]));
      for (let k = 0; k < 30; k++) if (o.amarrer(ix + r.entre(-4, 8), iy + r.entre(-4, 7))) break;
    },
  });
  c.p.lumiere = "jour";
  return c.fini("marais", graine);
}

// ---------------------------------------------------------------- rivière

function riviere(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(42, 46);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Rivière");
  const T = new Terrain(W, H, S.herbe);
  const nb = bruit(r, W, H, 7);
  for (let i = 0; i < W * H; i++) if (nb[i] > 0.65) T.sol[i] = S.terre;
  // La rivière, du nord au sud, large de quatre à cinq cases ; une rive de sable ou de gravier, de l'eau peu profonde.
  const xr = Math.round(W / 2) + r.entre(-5, 5);
  const cours = serpent(r, xr, -1, xr + r.entre(-6, 6), H, 5, 4);
  const large = r.entre(4, 5);
  T.trait(cours, large + 4, S.gravier, { si: (s) => s !== S.profonde });
  T.trait(cours, large + 2, S.eau);
  const lit = T.trait(cours, large, S.profonde);
  // La route, d'ouest en est, et son pont.
  const yRoute = Math.round(H * (0.3 + 0.4 * r()));
  const route = [[0, yRoute], [W * 0.3, yRoute + r.entre(-2, 2)], [W * 0.7, yRoute + r.entre(-2, 2)], [W - 1, yRoute + r.entre(-2, 2)]];
  T.trait(route, 2, S.terre, { garder: true, si: (s) => s !== S.profonde && s !== S.eau });
  T.trait(route, 2, null, { garder: true });
  T.zone("La route", 0, yRoute);
  const sousLaRoute = [];
  for (let i = 0; i < W * H; i++) if (T.garde[i] && (T.sol[i] === S.profonde || T.sol[i] === S.eau)) sousLaRoute.push([i % W, Math.floor(i / W)]);
  if (sousLaRoute.length) {
    const xs = sousLaRoute.map(([x]) => x);
    const ys = sousLaRoute.map(([, y]) => y);
    const x0 = Math.min(...xs) - 1;
    const x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    // Un pont de deux cases de large, d'une rive à l'autre.
    for (let y = y0; y <= y1; y += 2) T.passage("pont", x0, y, 90, { l: Math.min(2, y1 - y + 1), h: x1 - x0 + 1 });
    T.zone("Le pont", (x0 + x1) / 2, y0);
  }
  // Le gué, loin du pont : un haut-fond de galets.
  const loinDuPont = lit.filter(([, y]) => Math.abs(y - yRoute) > 9 && y > 2 && y < H - 3);
  if (loinDuPont.length) {
    const [gx, gy] = r.un(loinDuPont);
    for (const [x, y] of lit) if (Math.abs(y - gy) <= 1 && Math.abs(x - gx) <= large) T.sol[y * W + x] = (x + y) % 3 ? S.eau : S.gravier;
    T.zone("Le gué", gx, gy);
  }
  const noms = ["Les prés", "Les saules", "La berge", "Le pâturage", "Le bosquet", "L'anse", "La prairie", "Les joncs"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      semer(30, 400, 0, 0, W - 1, H - 1, "roseaux");
      semer(30, 500, 0, 0, W - 1, H - 1, tirage(r, [["saule", 2], ["arbre", 5], ["buisson", 4], ["bouleau", 2], ["chene", 1]]));
      // Un bosquet, d'un côté de la rivière.
      const bx = r.pile() ? r.entre(2, xr - 12) : r.entre(xr + 8, W - 10);
      const by = r.entre(2, H - 10);
      semer(10, 120, bx, by, bx + 8, by + 8, tirage(r, [["arbre", 3], ["chene", 1], ["buisson", 2], ["fougeres", 1]]));
      // Une barque amarrée, sur l'eau profonde contre la rive.
      for (const [x, y] of lit) if (r.pile(0.1) && o.amarrer(x, y)) break;
      dehors("panneau", 2, yRoute - 2);
      semer(2, 40, 0, 0, W - 1, H - 1, "menhir");
    },
  });
  c.p.lumiere = "jour";
  return c.fini("riviere", graine);
}

// ---------------------------------------------------------------- côte

function cote(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(42, 46);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Côte");
  const T = new Terrain(W, H, S.herbe);
  const nb = bruit(r, W, 1, 6, 2);
  const nb2 = bruit(r, W, H, 8);
  // La mer au sud : la ligne du rivage ondule ; de l'eau peu profonde, la plage, puis les dunes herbeuses.
  for (let x = 0; x < W; x++) {
    const rivage = Math.round(H * 0.58 + (nb[x] - 0.5) * 8);
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      const d = y - rivage;
      T.sol[i] = d > 3 ? S.profonde : d > 0 ? S.eau : d > -5 ? S.sable : nb2[i] > 0.6 ? S.sable : S.herbe;
    }
  }
  // Le cap : un bout de falaise à l'est ou à l'ouest, qui s'avance dans la mer.
  const est = r.pile();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bord = est ? W - 1 - x : x;
    const lim = 5 + (nb2[y * W + x] - 0.5) * 5 + (y > H * 0.5 ? (y - H * 0.5) * 0.35 : 0);
    if (bord < lim && y > H * 0.32) T.sol[y * W + x] = bord < lim - 3 ? S.falaise : S.roche;
  }
  // Le chemin côtier, d'un bord à l'autre au-dessus de la plage.
  const yc = Math.round(H * 0.28);
  const chemin = serpent(r, 0, yc, W - 1, yc + r.entre(-3, 3), 7, 2);
  T.trait(chemin, 2, S.terre, { garder: true, si: (s) => s !== S.falaise });
  T.zone("Le chemin côtier", est ? 0 : W - 1, chemin[est ? 0 : chemin.length - 1][1]);
  // Le ponton, depuis la plage jusqu'à l'eau profonde, et les barques le long.
  const xp = est ? r.entre(10, Math.round(W * 0.45)) : r.entre(Math.round(W * 0.55), W - 12);
  let yp = 0;
  while (yp < H - 1 && T.sol[yp * W + xp] !== S.eau) yp++;
  const longueur = Math.min(H - yp - 1, r.entre(7, 9));
  for (let y = yp - 1; y < yp + longueur; y += 3) T.passage("ponton", xp, y, 0, { l: 2, h: Math.min(3, yp + longueur - y) });
  T.zone("Le ponton", xp + 1, yp + 2);
  for (const [dx, dy] of [[-1, 2], [2, 4], [-1, 6]]) if (r.pile(0.7) && yp + dy + 1 < H) T.passage("barque", xp + dx, yp + dy, 0);
  // La cabane du pêcheur, au-dessus de la plage.
  const xb = entre(xp - r.entre(3, 6), 2, W - 8);
  const yb = entre(yp - r.entre(9, 11), yc + 3, H - 10);
  const cabane = ouvertures(r, { x: xb, y: yb, l: r.entre(5, 6), h: 4, nom: "La cabane du pêcheur", sol: S.plancher, mur: "bois" }, "bas", 1);
  cabane.etat = r.pile(0.7) ? "fermee" : "verrouillee";
  cabane.meubles = meublerBatiment("cabane");
  if (T.batiment(cabane)) {
    const [, dx, dy] = cabane.porte;
    T.trait([[dx, dy], [xb - 1, dy], [xb - 1, yc]], 1, S.terre, { garder: true });
  }
  T.zone("La plage", xp - (est ? -6 : 6), yp - 2);
  const noms = ["Les dunes", "Les rochers", "Le cap", "La lande", "Le large", "Les brisants", "L'anse", "La grève"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      dehors("filet", xb + cabane.l + 1, yb + 1) || dehors("filet", xb - 3, yb + 1);
      dehors("tonneau", xb + cabane.l, yb + 3);
      dehors("bitte", xp - 1, yp - 1) || dehors("bitte", xp + 2, yp - 1);
      dehors("cordages", xp + 2, yp - 2);
      semer(14, 300, 0, 0, W - 1, H - 1, tirage(r, [["rochers", 3], ["gros-rocher", 1]]));
      semer(14, 300, 0, 0, W - 1, H - 1, tirage(r, [["gros-rocher", 1], ["rochers", 2]]), { roc: true });
      semer(10, 200, 0, 0, W - 1, H - 1, tirage(r, [["buisson", 3], ["arbre-mort", 1], ["sapin", 1]]));
      semer(5, 100, 0, 0, W - 1, H - 1, "dune", { tourner: true });
    },
  });
  c.p.lumiere = "jour";
  return c.fini("cote", graine);
}

// ---------------------------------------------------------------- camp

function camp(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(40, 44);
  const H = r.entre(28, 31);
  const c = new Chantier(W, H, "Camp");
  const nb = bruit(r, W, H, 6);
  const T = new Terrain(W, H, S.herbe);
  for (let i = 0; i < W * H; i++) T.sol[i] = nb[i] < 0.4 ? S.mousse : nb[i] > 0.62 ? S.feuilles : S.herbe;
  // L'enceinte : un rectangle de palissade, sa porte vers le sentier.
  const l = r.entre(16, 20);
  const h = r.entre(12, 14);
  const x0 = Math.round((W - l) / 2) + r.entre(-3, 3);
  const y0 = Math.round((H - h) / 2) + r.entre(-2, 2);
  // Deux zones dans l'enceinte : le camp autour du feu, et les tentes.
  const zCamp = T.zone("Le camp", x0 + l / 4, y0 + h / 2, true);
  const zTentes = T.zone("Les tentes", x0 + (3 * l) / 4, y0 + h / 2, true);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) {
    T.sol[y * W + x] = (x + y) % 5 === 0 ? S.herbe : S.terre;
    T.aire[y * W + x] = x < x0 + l / 2 ? zCamp : zTentes;
  }
  const xporte = x0 + r.entre(3, l - 5);
  // Le sentier, du bord sud du plan jusqu'à la porte.
  const sentier = serpent(r, xporte + r.entre(-8, 8), H - 1, xporte + 1, y0 + h - 1, 5, 3);
  T.trait(sentier, 2, S.terre, { garder: true });
  T.zone("Le sentier", sentier[0][0], H - 1);
  T.zone("Devant la porte", xporte + 1, y0 + h + 2);
  for (let x = xporte; x < xporte + 2; x++) T.garde[(y0 + h - 1) * W + x] = 1;
  const noms = ["La lisière", "Les bois", "Les fourrés", "Le guet", "Derrière le camp", "Le ravin", "La hêtraie", "Les ronces"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      // La palissade d'abord : elle laisse la porte (deux cases) et rien d'autre.
      for (let x = x0; x < x0 + l; x++) {
        dehors("palissade", x, y0, 0, { l: 1, h: 1 });
        if (x < xporte || x >= xporte + 2) dehors("palissade", x, y0 + h - 1, 0, { l: 1, h: 1 });
      }
      for (let y = y0 + 1; y < y0 + h - 1; y++) {
        dehors("palissade", x0, y, 90, { l: 1, h: 1 });
        dehors("palissade", x0 + l - 1, y, 90, { l: 1, h: 1 });
      }
      const cx = x0 + Math.floor(l / 2);
      const cy = y0 + Math.floor(h / 2);
      dehors("feu-de-camp", cx, cy);
      dehors("banc", cx - 1, cy - 2);
      dehors("tronc", cx + 2, cy - 1);
      semer(r.entre(4, 6), 120, x0 + 2, y0 + 2, x0 + l - 4, y0 + h - 4, "tente", { teinte: r.un(["#a89466", "#6b7a30", "#8e2a20", "#5a3a22"]) });
      semer(5, 100, x0 + 1, y0 + 1, x0 + l - 3, y0 + h - 3, tirage(r, [["caisse", 3], ["tonneau", 3], ["sacs", 2], ["ratelier", 1], ["charrette", 1]]));
      dehors("cage", x0 + l - 3, y0 + 1, 0, { note: "Un prisonnier, peut-être." });
      // Le bois tout autour, serré.
      const tirer = tirage(r, ARBRES);
      for (let k = 0; k < W * H * 0.4; k++) {
        const x = r.entre(0, W - 1);
        const y = r.entre(0, H - 1);
        if (x >= x0 - 1 && x <= x0 + l && y >= y0 - 1 && y <= y0 + h) continue;
        dehors(tirer(), x, y);
      }
    },
  });
  c.p.lumiere = "crepuscule";
  return c.fini("camp", graine);
}

// ---------------------------------------------------------------- ruines

function ruines(graine, { Chantier, hasard }) {
  const r = hasard(graine);
  const W = r.entre(42, 46);
  const H = r.entre(30, 33);
  const c = new Chantier(W, H, "Ruines");
  const nb = bruit(r, W, H, 5);
  const T = new Terrain(W, H, S.herbe);
  for (let i = 0; i < W * H; i++) if (nb[i] > 0.64) T.sol[i] = S.terre;
  // L'enceinte du fort : un grand rectangle ; la cour dallée par endroits.
  const l = r.entre(22, 26);
  const h = r.entre(16, 18);
  const x0 = Math.round((W - l) / 2) + r.entre(-2, 2);
  const y0 = Math.round((H - h) / 2) + r.entre(-2, 2);
  // La cour, en deux : la cour et la place d'armes.
  const zCour = T.zone("La cour", x0 + l / 4, y0 + h / 2, true);
  const zArmes = T.zone("La place d'armes", x0 + (3 * l) / 4, y0 + h / 2, true);
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + l - 1; x++) {
    if (nb[y * W + x] < 0.55) T.sol[y * W + x] = S.dalles;
    T.aire[y * W + x] = x < x0 + l / 2 ? zCour : zArmes;
  }
  // La tour, encore debout dans un coin.
  const coin = r.un([[x0 + 1, y0 + 1, "bas"], [x0 + l - 7, y0 + 1, "bas"], [x0 + 1, y0 + h - 6, "haut"], [x0 + l - 7, y0 + h - 6, "haut"]]);
  const tour = ouvertures(r, { x: coin[0], y: coin[1], l: 6, h: 5, nom: "La tour", sol: S.pierre, mur: "pierre" }, coin[2], 1);
  tour.etat = r.pile(0.75) ? "fermee" : "verrouillee";
  tour.meubles = meublerBatiment("tour");
  T.batiment(tour);
  // Le chemin jusqu'à la grande brèche.
  const yb = r.pile() ? y0 : y0 + h - 1;
  const xb = x0 + r.entre(8, l - 9);
  const chemin = serpent(r, xb + r.entre(-6, 6), yb === y0 ? 0 : H - 1, xb, yb, 4, 2);
  T.trait(chemin, 2, S.terre, { garder: true });
  T.zone("Le chemin", chemin[0][0], chemin[0][1]);
  T.zone("La brèche", xb, yb + (yb === y0 ? -2 : 2));
  const noms = ["Les remparts", "Les fossés", "Les broussailles", "Le glacis", "Les éboulis", "La lande", "Le bosquet", "Les douves"];
  T.relier(T.zones[0].y * W + T.zones[0].x);
  batir(c, T, r, noms, {
    meubler(o) {
      const { dehors, semer } = o;
      // Les remparts, par pans d'une case, avec des brèches ; la grande brèche reste libre.
      const pan = (x, y, rot) => {
        if (Math.abs(x - xb) <= 1 && y === yb) return;
        if (r.pile(0.8)) dehors("mur-ruine", x, y, rot, { l: 1 });
      };
      for (let x = x0; x < x0 + l; x++) {
        pan(x, y0, 0);
        pan(x, y0 + h - 1, 0);
      }
      for (let y = y0 + 1; y < y0 + h - 1; y++) {
        pan(x0, y, 90);
        pan(x0 + l - 1, y, 90);
      }
      semer(10, 160, x0 + 2, y0 + 2, x0 + l - 3, y0 + h - 3, tirage(r, [["colonne-brisee", 3], ["colonne-couchee", 2], ["statue-brisee", 1], ["gravats", 4], ["eboulis", 1]]));
      if (r.pile(0.6)) dehors("puits", x0 + Math.floor(l / 2), y0 + Math.floor(h / 2));
      semer(8, 120, 0, 0, W - 1, H - 1, tirage(r, [["gravats", 3], ["eboulis", 1], ["colonne-brisee", 1]]));
      semer(26, 500, 0, 0, W - 1, H - 1, tirage(r, [["arbre", 4], ["buisson", 4], ["arbre-mort", 1], ["bouleau", 2], ["souche", 1], ["fougeres", 2]]));
    },
  });
  c.p.lumiere = "jour";
  return c.fini("ruines", graine);
}

export const GENERATEURS_DEHORS = { ville, village, foret, montagne, desert, marais, riviere, cote, camp, ruines };
