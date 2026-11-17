// Générateurs de plans : une auberge (rez-de-chaussée et étage, même emprise pour une même graine), une maison, une
// crypte, une grotte, et les plans extérieurs (generateurs-dehors.js, qui reçoit Chantier et hasard à l'appel). Chaque
// graine donne toujours le même plan : on relance jusqu'à ce qu'une version plaise.

import { MEUBLES, SOLS_INFRANCHISSABLES, calculerMurs, casesArete, cleArete, emprise, idx, nouveauPlan, nouvelId } from "./modele.js";
import { GENERATEURS_DEHORS, MODELES_DEHORS } from "./generateurs-dehors.js";

export const MODELES = [
  { cle: "auberge", nom: "Auberge, rez-de-chaussée", aide: "Salle commune, comptoir, cheminée, cuisine, réserve, cour et écurie, sur la route." },
  { cle: "auberge-etage", nom: "Auberge, étage", aide: "Couloir et chambres ; même graine que le rez-de-chaussée pour la même emprise." },
  { cle: "maison", nom: "Maison", aide: "Pièce commune, chambre, cellier, jardin." },
  { cle: "crypte", nom: "Crypte", aide: "Salles reliées par des couloirs, tombeaux, chapelle, porte secrète et pièges." },
  { cle: "grotte", nom: "Grotte", aide: "Galeries naturelles, mares, rochers ; zones à révéler une à une." },
  ...MODELES_DEHORS,
  { cle: "vierge", nom: "Plan vierge", aide: "Rien : vous tracez les pièces vous-même." },
];

export function hasard(graine) {
  let a = graine >>> 0 || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.entre = (a0, b0) => a0 + Math.floor(f() * (b0 - a0 + 1));
  f.un = (liste) => liste[Math.floor(f() * liste.length)];
  f.pile = (p = 0.5) => f() < p;
  return f;
}

// Les quatre côtés d'une case, avec le bit de mur correspondant (voir calculerMurs).
const COTES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];

export class Chantier {
  constructor(largeur, hauteur, nom) {
    this.p = nouveauPlan({ nom, largeur, hauteur });
    this.n = 0;
    // Pour poser le mobilier sans rien boucher : murs et cases prises, calculés à la demande.
    this.murs = null;
    this.bloque = null;
    this.connexeAvant = null;
  }

  piece(nom, genre, sol, x, y, l, h) {
    const id = ++this.n;
    this.p.pieces.push({ id, nom, genre, notes: "", nom_visible: false });
    this.remplir(id, sol, x, y, l, h);
    return id;
  }

  remplir(id, sol, x, y, l, h) {
    const p = this.p;
    this.murs = null;
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + l; i++) {
        if (i < 0 || j < 0 || i >= p.largeur || j >= p.hauteur) continue;
        p.sol[idx(p, i, j)] = sol;
        p.piece[idx(p, i, j)] = id;
      }
    }
  }

  case(x, y, id, sol) {
    const p = this.p;
    if (x < 0 || y < 0 || x >= p.largeur || y >= p.hauteur) return;
    this.murs = null;
    p.sol[idx(p, x, y)] = sol;
    p.piece[idx(p, x, y)] = id;
  }

  pieceA(x, y) {
    const p = this.p;
    if (x < 0 || y < 0 || x >= p.largeur || y >= p.hauteur) return 0;
    return p.sol[idx(p, x, y)] ? p.piece[idx(p, x, y)] : 0;
  }

  porte(sens, x, y, genre = "porte", etat = "fermee", extra = {}) {
    if (this.p.portes.some((d) => d.sens === sens && d.x === x && d.y === y)) return;
    this.p.portes.push({ id: nouvelId(), sens, x, y, genre, etat, ...extra });
  }

  meuble(cle, x, y, rot = 0, extra = {}) {
    const m = MEUBLES[cle];
    const o = { id: nouvelId(), cle, x, y, l: m.l, h: m.h, rot, cache: !!m.cache, note: "", ...extra };
    this.p.objets.push(o);
    this.marquer(o);
    return o;
  }

  // Pose un meuble si sa place est libre et, pour un meuble qu'on ne traverse pas, s'il ne bouche aucune porte et ne
  // coupe aucun passage. Rend le meuble posé, ou null.
  meubler(cle, x, y, rot = 0, extra = {}) {
    const m = MEUBLES[cle];
    const tourne = rot % 180 !== 0;
    const l = tourne ? m.h : m.l;
    const h = tourne ? m.l : m.h;
    if (!this.libre(x, y, l, h)) return null;
    if (!m.franchissable && !this.sansCouper(x, y, l, h)) return null;
    return this.meuble(cle, x, y, rot, extra);
  }

  // La première place qui convient, parmi [x, y, rotation].
  meublerParmi(cle, places, extra = {}) {
    for (const [x, y, rot = 0] of places) {
      const o = this.meubler(cle, x, y, rot, extra);
      if (o) return o;
    }
    return null;
  }

  // Les cases que le mobilier rend infranchissables.
  obstacles() {
    if (!this.bloque) {
      this.bloque = new Uint8Array(this.p.largeur * this.p.hauteur);
      for (const o of this.p.objets) this.marquer(o);
    }
    return this.bloque;
  }

  marquer(o) {
    if (!this.bloque || MEUBLES[o.cle]?.franchissable) return;
    const p = this.p;
    const b = emprise(o);
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (x >= 0 && y >= 0 && x < p.largeur && y < p.hauteur) this.bloque[y * p.largeur + x] = 1;
  }

  // Un meuble infranchissable posé là laisse-t-il libres les deux cases de chaque porte, et toutes les cases de sol
  // reliées entre elles ?
  sansCouper(x, y, l, h) {
    const p = this.p;
    const cases = [];
    for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) cases.push(j * p.largeur + i);
    const devant = new Set();
    for (const d of p.portes) {
      if (d.genre === "fenetre") continue;
      for (const [i, j] of casesArete(d.sens, d.x, d.y)) if (i >= 0 && j >= 0 && i < p.largeur && j < p.hauteur) devant.add(j * p.largeur + i);
    }
    if (cases.some((k) => devant.has(k))) return false;
    const bloque = this.obstacles();
    // Un plan déjà morcelé avant son mobilier : on ne juge que les portes.
    this.connexeAvant ??= this.connexe();
    if (!this.connexeAvant) return true;
    for (const k of cases) bloque[k] = 1;
    const ok = this.connexe();
    if (!ok) for (const k of cases) bloque[k] = 0;
    return ok;
  }

  // Toutes les cases libres (du sol où l'on marche, sans meuble infranchissable) se rejoignent-elles ? Un mur ne se passe
  // que par une porte, secrète comprise (le trésor se visite), jamais par une fenêtre ; l'eau profonde et la falaise ne
  // se passent pas (les plans d'intérieur n'en ont pas).
  connexe() {
    const p = this.p;
    const w = p.largeur;
    const h = p.hauteur;
    const murs = (this.murs ||= calculerMurs(p));
    const bloque = this.obstacles();
    const portes = new Set(p.portes.filter((d) => d.genre !== "fenetre").map((d) => cleArete(d.sens, d.x, d.y)));
    // Sur l'eau profonde ou la falaise, seul un pont, un ponton ou une barque (« passage ») porte le pied.
    let dessus = null;
    const surUnPassage = (i) => {
      if (!dessus) {
        dessus = new Uint8Array(w * h);
        for (const o of p.objets) {
          if (!MEUBLES[o.cle]?.passage) continue;
          const b = emprise(o);
          for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (x >= 0 && y >= 0 && x < w && y < h) dessus[y * w + x] = 1;
        }
      }
      return dessus[i];
    };
    const libre = (i) => p.sol[i] && !bloque[i] && (!SOLS_INFRANCHISSABLES.has(p.sol[i]) || surUnPassage(i));
    let total = 0;
    let depart = -1;
    for (let i = 0; i < w * h; i++) {
      if (!libre(i)) continue;
      total++;
      if (depart < 0) depart = i;
    }
    if (depart < 0) return true;
    const vu = new Uint8Array(w * h);
    const pile = [depart];
    vu[depart] = 1;
    let atteint = 1;
    while (pile.length) {
      const i = pile.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy, bit] of COTES) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (vu[j] || !libre(j)) continue;
        if (murs[i] & bit && !portes.has(dx ? cleArete("v", Math.max(x, nx), y) : cleArete("h", x, Math.max(y, ny)))) continue;
        vu[j] = 1;
        atteint++;
        pile.push(j);
      }
    }
    return atteint === total;
  }

  // Un couloir d'une case à l'autre : un L (horizontal ou vertical d'abord) ; si les deux L traversent une case
  // interdite, un détour par un coin de l'obstacle, sinon le plus court chemin qui l'évite.
  chemin(depart, arrivee, horizontalDabord, interdit) {
    const enL = ([x0, y0], [x1, y1], horizontal) => {
      const pts = [[x0, y0]];
      let x = x0;
      let y = y0;
      const aller = (tx, ty) => {
        while (x !== tx || y !== ty) {
          if (x !== tx) x += Math.sign(tx - x);
          else y += Math.sign(ty - y);
          pts.push([x, y]);
        }
      };
      if (horizontal) {
        aller(x1, y0);
        aller(x1, y1);
      } else {
        aller(x0, y1);
        aller(x1, y1);
      }
      return pts;
    };
    const valide = (pts) => !pts.some(([x, y]) => interdit(x, y));
    for (const horizontal of [horizontalDabord, !horizontalDabord]) {
      const pts = enL(depart, arrivee, horizontal);
      if (valide(pts)) return pts;
    }
    // Les cases interdites forment une salle : on la contourne par l'un de ses coins.
    const p = this.p;
    let bx0 = Infinity; let by0 = Infinity; let bx1 = -Infinity; let by1 = -Infinity;
    for (let y = 0; y < p.hauteur; y++) {
      for (let x = 0; x < p.largeur; x++) {
        if (!interdit(x, y)) continue;
        bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
      }
    }
    let meilleur = null;
    for (const coin of [[bx0 - 1, by0 - 1], [bx1 + 1, by0 - 1], [bx0 - 1, by1 + 1], [bx1 + 1, by1 + 1]]) {
      if (coin[0] < 0 || coin[1] < 0 || coin[0] >= p.largeur || coin[1] >= p.hauteur) continue;
      for (const h1 of [horizontalDabord, !horizontalDabord]) {
        for (const h2 of [!h1, h1]) {
          const pts = [...enL(depart, coin, h1), ...enL(coin, arrivee, h2).slice(1)];
          if (valide(pts) && new Set(pts.map(([x, y]) => `${x}:${y}`)).size === pts.length && (!meilleur || pts.length < meilleur.length)) meilleur = pts;
        }
      }
    }
    return meilleur || this.plusCourt(depart, arrivee, interdit) || enL(depart, arrivee, horizontalDabord);
  }

  // Le plus court passage à creuser dans le vide depuis une pièce jusqu'au sol le plus proche : ses cases, la porte
  // entre la pièce et le passage (s'il y en a un) et la porte à l'autre bout, contre le sol trouvé.
  passageSecret(id) {
    const p = this.p;
    const w = p.largeur;
    const h = p.hauteur;
    const venu = new Int32Array(w * h).fill(-2);
    const file = [];
    for (let i = 0; i < w * h; i++) {
      if (!p.sol[i] || p.piece[i] !== id) continue;
      venu[i] = -1;
      file.push(i);
    }
    const arete = (a, b) => {
      const [ax, ay] = [a % w, Math.floor(a / w)];
      const [bx, by] = [b % w, Math.floor(b / w)];
      return ax !== bx ? ["v", Math.max(ax, bx), ay] : ["h", ax, Math.max(ay, by)];
    };
    for (let t = 0; t < file.length; t++) {
      const i = file[t];
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of COTES) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (venu[j] !== -2) continue;
        if (p.sol[j]) {
          const passage = [];
          let k = i;
          while (venu[k] !== -1) {
            passage.push(k);
            k = venu[k];
          }
          passage.reverse();
          return {
            passage: passage.map((q) => [q % w, Math.floor(q / w)]),
            entree: passage.length ? arete(k, passage[0]) : null,
            secrete: arete(i, j),
          };
        }
        venu[j] = i;
        file.push(j);
      }
    }
    return null;
  }

  // Le plus court chemin de case en case qui évite les cases interdites (en largeur d'abord).
  plusCourt([x0, y0], [x1, y1], interdit) {
    const p = this.p;
    const w = p.largeur;
    const venu = new Int32Array(w * p.hauteur).fill(-1);
    const debut = y0 * w + x0;
    const fin = y1 * w + x1;
    venu[debut] = debut;
    const file = [debut];
    for (let t = 0; t < file.length && venu[fin] < 0; t++) {
      const i = file[t];
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of COTES) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= p.hauteur || interdit(nx, ny)) continue;
        const j = ny * w + nx;
        if (venu[j] >= 0) continue;
        venu[j] = i;
        file.push(j);
      }
    }
    if (venu[fin] < 0) return null;
    const pts = [];
    for (let i = fin; ; i = venu[i]) {
      pts.push([i % w, Math.floor(i / w)]);
      if (i === debut) break;
    }
    return pts.reverse();
  }

  texte(t, x, y, extra = {}) {
    this.p.textes.push({ id: nouvelId(), texte: t, x, y, taille: 0.6, mj: false, ...extra });
  }

  // Toutes les arêtes que deux pièces partagent.
  aretesEntre(a, b) {
    const p = this.p;
    const res = [];
    for (let y = 0; y < p.hauteur; y++) {
      for (let x = 0; x < p.largeur; x++) {
        if (this.pieceA(x, y) !== a) continue;
        if (this.pieceA(x + 1, y) === b) res.push(["v", x + 1, y]);
        if (this.pieceA(x - 1, y) === b) res.push(["v", x, y]);
        if (this.pieceA(x, y + 1) === b) res.push(["h", x, y + 1]);
        if (this.pieceA(x, y - 1) === b) res.push(["h", x, y]);
      }
    }
    return res;
  }

  relier(a, b, r, genre = "porte", etat = "fermee") {
    const aretes = this.aretesEntre(a, b);
    if (!aretes.length) return null;
    const milieu = aretes.slice(Math.floor(aretes.length * 0.25), Math.ceil(aretes.length * 0.75));
    const [sens, x, y] = r.un(milieu.length ? milieu : aretes);
    this.porte(sens, x, y, genre, etat);
    return [sens, x, y];
  }

  // Symétrie gauche-droite de tout le plan.
  miroir() {
    const p = this.p;
    const W = p.largeur;
    this.murs = null;
    this.bloque = null;
    for (const cle of ["sol", "piece", "brouillard"]) {
      const t = p[cle];
      for (let y = 0; y < p.hauteur; y++) {
        const ligne = t.slice(y * W, (y + 1) * W).reverse();
        for (let x = 0; x < W; x++) t[y * W + x] = ligne[x];
      }
    }
    for (const d of p.portes) d.x = d.sens === "v" ? W - d.x : W - 1 - d.x;
    for (const o of p.objets) {
      const tourne = (o.rot || 0) % 180 !== 0;
      o.x = W - o.x - (tourne ? o.h : o.l);
      o.rot = (360 - (o.rot || 0)) % 360;
    }
    for (const t of p.textes) t.x = W - t.x;
  }

  libre(x, y, l, h) {
    const p = this.p;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) if (!this.pieceA(i, j)) return false;
    return !p.objets.some((o) => {
      const tourne = (o.rot || 0) % 180 !== 0;
      const ol = tourne ? o.h : o.l;
      const oh = tourne ? o.l : o.h;
      return o.x < x + l && o.x + ol > x && o.y < y + h && o.y + oh > y;
    });
  }

  fini(modele, graine) {
    this.p.generateur = { modele, graine };
    return this.p;
  }
}

// ---------------------------------------------------------------- auberge

function empriseAuberge(r) {
  const W = r.entre(17, 20);
  const H = r.entre(11, 13);
  const cour = r.pile(0.7);
  const miroir = r.pile();
  return { W, H, cour, miroir, bx: 2, by: 2, m: 2 + Math.floor(H / 2) };
}

function auberge(graine) {
  const r = hasard(graine);
  const { W, H, cour, miroir, bx, by, m } = empriseAuberge(r);
  const largeur = bx + W + (cour ? 8 : 2);
  const hauteur = by + H + 4;
  const c = new Chantier(largeur, hauteur, "Auberge, rez-de-chaussée");
  const Ws = Math.round(W * 0.6);
  const Hc = Math.round(H * 0.55);
  const route = c.piece("La route", "exterieur", 3, 0, by + H, largeur, 4);
  c.p.pieces.find((x) => x.id === route).nom_visible = true;
  const salle = c.piece("Salle commune", "salle", 2, bx, by, Ws, H);
  const cuisine = c.piece("Cuisine", "salle", 1, bx + Ws, by, W - Ws, Hc);
  const reserve = c.piece("Réserve", "salle", 3, bx + Ws, by + Hc, W - Ws, H - Hc);
  let laCour = 0;
  let ecurie = 0;
  if (cour) {
    laCour = c.piece("La cour", "exterieur", 4, bx + W, by, 8, H);
    ecurie = c.piece("Écurie", "salle", 9, bx + W + 2, by, 5, 5);
  }

  // Portes et fenêtres.
  const dx = bx + Math.round(Ws * 0.4);
  c.porte("h", dx, by + H, "double", "fermee");
  c.porte("v", bx + Ws, by + 1, "porte", "ouverte");
  c.porte("h", bx + Ws + 2, by + Hc, "porte", "fermee");
  if (cour) {
    c.porte("v", bx + W, by + Hc - 2, "porte", "fermee");
    c.porte("h", bx + W + 4, by + 5, "double", "ouverte");
  } else c.porte("h", bx + W - 2, by, "porte", "verrouillee");
  for (const x of [bx + 1, bx + Ws - 2]) if (Math.abs(x - dx) > 1) c.porte("h", x, by + H, "fenetre");
  c.porte("v", bx, by + 2, "fenetre");
  c.porte("v", bx, by + H - 3, "fenetre");
  c.porte("h", bx + Ws + 2, by, "fenetre");

  // Salle commune : cheminée au nord, escalier à l'ouest, comptoir contre la cuisine, bouclier au-dessus.
  c.meuble("cheminee", bx + Math.floor(Ws / 2) - 1, by, 0);
  c.meuble("escalier", bx, m - 1, 0);
  const xc = bx + Ws - 2;
  c.meuble("comptoir", xc, by + 2, 90);
  c.meuble("bouclier", bx + Ws - 1, by + 2, 90, { note: "Le bouclier cabossé au-dessus du comptoir." });
  c.meuble("tonneau", bx + Ws - 1, by + 3);
  c.meuble("tonneau", bx + Ws - 1, by + 4);
  c.meuble("etagere", bx + Ws - 1, by + 5, 90);
  c.meuble("planche-contrats", dx + 2, by + H - 1, 180, { note: "La planche à contrats, près de la porte." });
  // Tables et bancs, en laissant libres l'entrée, l'âtre et le comptoir.
  const reserve0 = [];
  const reserver = (x, y, l, h) => reserve0.push([x, y, l, h]);
  reserver(dx - 1, by + H - 3, 3, 3);
  reserver(bx, m - 2, 2, 4);
  reserver(bx + Math.floor(Ws / 2) - 2, by, 4, 2);
  reserver(xc - 1, by + 1, 3, 6);
  const touche = (x, y, l, h) => reserve0.some(([a, b, w2, h2]) => a < x + l && a + w2 > x && b < y + h && b + h2 > y);
  for (let y = by + 1; y + 3 <= by + H - 1; y += 4) {
    for (let x = bx + 2; x + 2 <= xc - 1; x += 3) {
      if (r.pile(0.28) && x + 3 <= xc - 1 && !touche(x, y, 3, 3) && c.libre(x, y, 3, 3)) {
        c.meuble("table-ronde", x + 1, y + 1);
        c.meuble("chaise", x + 1, y, 0);
        c.meuble("chaise", x + 1, y + 2, 180);
        c.meuble("chaise", x, y + 1, 270);
        c.meuble("chaise", x + 2, y + 1, 90);
        x += 1;
        continue;
      }
      if (touche(x, y, 2, 3) || !c.libre(x, y, 2, 3)) continue;
      c.meuble("banc", x, y);
      c.meuble("table", x, y + 1);
      c.meuble("banc", x, y + 2);
    }
  }

  // Cuisine, réserve, cour.
  c.meuble("four", bx + W - 1, by);
  c.meuble("etagere", bx + Ws + 3, by, 0);
  c.meuble("etabli", bx + Ws + 2, by + 2, 0);
  c.meuble("tonneau", bx + W - 1, by + Hc - 1);
  c.meuble("caisse", bx + W - 2, by + Hc - 1);
  c.meuble("tonneau", bx + Ws, by + Hc);
  c.meuble("tonneau", bx + Ws + 1, by + Hc);
  c.meuble("tonneau", bx + Ws, by + Hc + 1);
  c.meuble("caisse", bx + W - 1, by + H - 1);
  c.meuble("caisse", bx + W - 2, by + H - 1);
  c.meuble("etagere", bx + W - 1, by + Hc + 1, 90);
  c.meuble("trappe", bx + Ws + 2, by + H - 2, 0, { note: "La trappe de la cave." });
  if (cour) {
    c.meuble("stalle", bx + W + 2, by, 0);
    c.meuble("stalle", bx + W + 4, by, 0);
    c.meuble("foin", bx + W + 6, by + 3);
    c.meuble("puits", bx + W + 5, by + H - 3);
    c.meuble("charrette", bx + W + 2, by + H - 4, 0);
    if (r.pile()) c.meuble("arbre", bx + W + 6, by + H - 2);
  }
  if (miroir) c.miroir();
  void route; void salle; void laCour; void ecurie;
  return c.fini("auberge", graine);
}

function aubergeEtage(graine) {
  const r = hasard(graine);
  const { W, H, cour, miroir, bx, by, m } = empriseAuberge(r);
  const largeur = bx + W + (cour ? 8 : 2);
  const hauteur = by + H + 4;
  const c = new Chantier(largeur, hauteur, "Auberge, étage");
  const tranches = (x0, largeurTotale) => {
    const t = [];
    let x = x0;
    let reste = largeurTotale;
    while (reste > 0) {
      let l = reste <= 6 ? reste : r.entre(3, 5);
      if (reste - l > 0 && reste - l < 3) l = reste;
      t.push([x, l]);
      x += l;
      reste -= l;
    }
    return t;
  };
  let numero = 0;
  const chambres = [];
  for (const [x, l] of tranches(bx, W)) chambres.push(["haut", x, l]);
  for (const [x, l] of tranches(bx, W)) chambres.push(["bas", x, l]);
  const grande = r.entre(0, chambres.length - 1);
  chambres.forEach(([cote, x, l], k) => {
    const y = cote === "haut" ? by : m + 1;
    const h = cote === "haut" ? m - by : by + H - m - 1;
    const nom = k === grande ? "Chambre du patron" : `Chambre ${++numero}`;
    const id = c.piece(nom, "salle", 2, x, y, l, h);
    // La première chambre du haut cède son coin au palier de l'escalier.
    const px = x === bx && cote === "haut" ? x + r.entre(1, l - 1) : x + r.entre(0, l - 1);
    c.porte("h", px, cote === "haut" ? m : m + 1, "porte", k === grande ? "verrouillee" : "fermee");
    // Le lit contre le mur du fond, un coffre, une table et une chaise.
    const fond = cote === "haut" ? y : y + h - 2;
    const xl = px === x ? x + l - 1 : x;
    c.meuble("lit", xl, fond, 0);
    if (k === grande && l >= 4) c.meuble("lit", xl === x ? x + 1 : xl - 1, fond, 0);
    const yc = cote === "haut" ? y : y + h - 1;
    const xcf = xl === x ? x + l - 1 : x;
    if (c.libre(xcf, yc, 1, 1)) c.meuble("coffre", xcf, yc, 0, k === grande ? { note: "Ce que le patron garde sous clé." } : {});
    if (l >= 4 && h >= 3) {
      const ym = cote === "haut" ? y + h - 2 : y + 1;
      const xm = x + Math.floor(l / 2);
      if (c.libre(xm, ym, 1, 1)) c.meuble("table-ronde", xm, ym);
    }
    if (k === grande && l >= 3 && h >= 4) c.meuble("tapis", x + Math.floor((l - 2) / 2), y + 1 + (cote === "haut" ? 0 : 0), 0, { h: Math.min(3, h - 2) });
    if (cote === "haut") c.porte("h", x + Math.floor(l / 2), by, "fenetre");
    else c.porte("h", x + Math.floor(l / 2), by + H, "fenetre");
    void id;
  });
  const couloir = c.piece("Couloir", "salle", 2, bx, m, W, 1);
  c.remplir(couloir, 2, bx, m - 1, 1, 1);
  c.meuble("escalier-bas", bx, m - 1, 0);
  c.porte("v", bx + W, m, "fenetre");
  if (miroir) c.miroir();
  return c.fini("auberge-etage", graine);
}

// ---------------------------------------------------------------- maison

function maison(graine) {
  const r = hasard(graine);
  const W = r.entre(9, 12);
  const H = r.entre(7, 9);
  const bx = 3;
  const by = 3;
  const c = new Chantier(W + 6, H + 6, "Maison");
  c.piece("Le jardin", "exterieur", 5, 0, 0, W + 6, H + 6);
  const Wp = Math.round(W * 0.6);
  const commune = c.piece("Pièce commune", "salle", 3, bx, by, Wp, H);
  const chambre = c.piece("Chambre", "salle", 2, bx + Wp, by, W - Wp, H >= 8 ? H - 3 : H);
  let cellier = 0;
  if (H >= 8) cellier = c.piece("Cellier", "salle", 3, bx + Wp, by + H - 3, W - Wp, 3);
  const dx = bx + Math.floor(Wp / 2);
  c.porte("h", dx, by + H, "porte", "fermee");
  c.relier(commune, chambre, r);
  if (cellier) c.relier(chambre, cellier, r);
  c.porte("h", bx + 1, by + H, "fenetre");
  c.porte("h", bx + Wp + 1, by, "fenetre");
  c.porte("v", bx, by + H - 2, "fenetre");
  // Le mobilier après les portes : rien ne bouche un passage ni n'enferme un coin de la pièce.
  c.meubler("cheminee", bx, by + Math.floor(H / 2) - 1, 90);
  const tx = bx + Math.floor(Wp / 2) - 1;
  const ty = by + Math.floor(H / 2) - 1;
  c.meubler("banc", tx, ty - 1);
  c.meubler("table", tx, ty);
  c.meubler("banc", tx, ty + 1);
  c.meublerParmi("etagere", [[bx + Wp - 2, by, 0], [bx, by + H - 2, 90]]);
  c.meubler("tonneau", bx + Wp - 1, by + H - 1);
  c.meubler("lit", bx + W - 1, by, 0);
  if (W - Wp >= 4) c.meubler("lit", bx + W - 3, by, 0);
  c.meubler("coffre", bx + Wp, by);
  if (cellier) {
    c.meubler("tonneau", bx + W - 1, by + H - 1);
    c.meubler("caisse", bx + W - 2, by + H - 1);
    c.meubler("caisse", bx + W - 1, by + H - 2);
  }
  c.meubler("arbre", 0, 0);
  if (r.pile()) c.meubler("puits", W + 4, H + 3);
  c.meubler("arbre", W + 4, 1);
  return c.fini("maison", graine);
}

// ---------------------------------------------------------------- crypte

function crypte(graine) {
  const r = hasard(graine);
  const L = 36;
  const Hh = 28;
  const c = new Chantier(L, Hh, "Crypte");
  const salles = [];
  for (let essai = 0; essai < 400 && salles.length < 8; essai++) {
    const l = r.entre(4, 8);
    const h = r.entre(4, 7);
    const x = r.entre(1, L - l - 1);
    const y = r.entre(1, Hh - h - 1);
    if (salles.some((s) => x < s.x + s.l + 2 && x + l + 2 > s.x && y < s.y + s.h + 2 && y + h + 2 > s.y)) continue;
    salles.push({ x, y, l, h });
  }
  salles.sort((a, b) => a.y + a.x / 2 - (b.y + b.x / 2));
  const noms = ["Entrée", "Chapelle", "Salle des tombeaux", "Ossuaire", "Salle des gisants", "Caveau", "Salle des offrandes", "Trésor"];
  // Le trésor, dernière salle, reste à l'écart des couloirs : on n'y entre que par sa porte secrète.
  const avecTresor = salles.length >= 3;
  salles.forEach((s, k) => {
    s.nom = noms[Math.min(k, noms.length - 2)];
    if (avecTresor && k === salles.length - 1) s.nom = "Trésor";
    s.id = c.piece(s.nom, "salle", s.nom === "Chapelle" ? 8 : 1, s.x, s.y, s.l, s.h);
  });
  const tresor = avecTresor ? salles[salles.length - 1] : null;
  const ordinaires = avecTresor ? salles.slice(0, -1) : salles;
  // Couloirs : un arbre qui relie les salles ordinaires au plus court, plus une boucle.
  const centre = (s) => [s.x + Math.floor(s.l / 2), s.y + Math.floor(s.h / 2)];
  const liens = [];
  const dans = new Set([0]);
  while (dans.size < ordinaires.length) {
    let meilleur = null;
    for (const a of dans) {
      for (let b = 0; b < ordinaires.length; b++) {
        if (dans.has(b)) continue;
        const [ax, ay] = centre(ordinaires[a]);
        const [bx2, by2] = centre(ordinaires[b]);
        const d = Math.abs(ax - bx2) + Math.abs(ay - by2);
        if (!meilleur || d < meilleur.d) meilleur = { a, b, d };
      }
    }
    liens.push([meilleur.a, meilleur.b]);
    dans.add(meilleur.b);
  }
  const boucle = [1, ordinaires.length - 1];
  if (ordinaires.length > 3 && !liens.some(([a, b]) => Math.min(a, b) === boucle[0] && Math.max(a, b) === boucle[1])) liens.push(boucle);
  // Chaque tronçon de couloir creusé d'un seul tenant est une pièce à part : on le révèle quand on y entre.
  const interdit = (x, y) => !!tresor && c.pieceA(x, y) === tresor.id;
  const pieges = [];
  let numero = 0;
  for (const [a, b] of liens) {
    const pts = c.chemin(centre(ordinaires[a]), centre(ordinaires[b]), r.pile(), interdit);
    let prec = c.pieceA(...pts[0]);
    let troncon = 0;
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1];
      const [bx3, by3] = pts[k];
      if (!c.pieceA(bx3, by3)) {
        if (!troncon) troncon = c.piece(`Couloir ${++numero}`, "salle", 1, 0, 0, 0, 0);
        c.case(bx3, by3, troncon, 1);
        if (r.pile(0.04)) pieges.push([bx3, by3]);
      } else troncon = 0;
      const ici = c.pieceA(bx3, by3);
      if (ici !== prec) {
        const sens = ax !== bx3 ? "v" : "h";
        const ex = ax !== bx3 ? Math.max(ax, bx3) : bx3;
        const ey = ay !== by3 ? Math.max(ay, by3) : by3;
        const couloirs = /^Couloir/.test(c.p.pieces.find((q) => q.id === ici)?.nom) && /^Couloir/.test(c.p.pieces.find((q) => q.id === prec)?.nom);
        // Deux couloirs se rejoignent par un simple passage ; une salle s'ouvre par une porte ou une arche.
        if (couloirs) c.porte(sens, ex, ey, "arche", "ouverte");
        else c.porte(sens, ex, ey, r.pile(0.35) ? "arche" : "porte", r.pile(0.15) ? "verrouillee" : "fermee");
      }
      prec = ici;
    }
  }
  // Le trésor : un cul-de-sac au bout d'un passage caché, creusé depuis la salle ou le couloir le plus proche. La porte
  // secrète s'ouvre dans un mur ordinaire, jamais au bout d'un couloir qui ne mènerait qu'à elle.
  if (tresor) {
    const lien = c.passageSecret(tresor.id);
    if (lien) {
      const note = "Un bas-relief pivote quand on appuie sur l'œil du gisant.";
      if (lien.passage.length) {
        const passage = c.piece("Passage secret", "salle", 1, 0, 0, 0, 0);
        for (const [x, y] of lien.passage) c.case(x, y, passage, 1);
        c.porte(...lien.entree, "porte", "fermee");
      }
      c.porte(...lien.secrete, "secrete", "fermee", { decouverte: false, note });
    }
  }
  for (const [x, y] of pieges) c.meuble("piege", x, y, 0, { note: "Dalle piégée : fléchettes, 1D6 (Perception pour la voir)." });
  // Mobilier des salles, après les portes : rien ne bouche un passage.
  salles.forEach((s, k) => {
    const cx = s.x + Math.floor(s.l / 2);
    const cy = s.y + Math.floor(s.h / 2);
    // L'autel contre un mur : au milieu de chaque mur (celui du fond d'abord), puis de plus en plus loin du milieu.
    const contreUnMur = [];
    for (let d = 0; d < Math.max(s.l, s.h); d++) {
      for (const k of d ? [d, -d] : [0]) {
        if (cx - 1 + k >= s.x && cx + k < s.x + s.l) contreUnMur.push([cx - 1 + k, s.y, 0], [cx - 1 + k, s.y + s.h - 1, 180]);
        if (cy - 1 + k >= s.y && cy + k < s.y + s.h) contreUnMur.push([s.x, cy - 1 + k, 90], [s.x + s.l - 1, cy - 1 + k, 270]);
      }
    }
    if (k === 0) c.meuble("escalier", s.x + 1, s.y + 1, 0, { note: "L'escalier qui remonte à la surface." });
    if (s.nom === "Chapelle") {
      const autel = c.meublerParmi("autel", contreUnMur);
      for (const y of [s.y + 1, s.y + s.h - 2]) {
        if (s.l >= 5) {
          c.meubler("colonne", s.x + 1, y);
          c.meubler("colonne", s.x + s.l - 2, y);
        }
      }
      if (autel) {
        const b = emprise(autel);
        const cotes = b.x1 - b.x0 > 1 ? [[b.x1, b.y0], [b.x0 - 1, b.y0]] : [[b.x0, b.y1], [b.x0, b.y0 - 1]];
        c.meublerParmi("brasero", cotes);
      }
    } else if (s.nom === "Salle des tombeaux" || s.nom === "Salle des gisants" || s.nom === "Caveau") {
      for (let x = s.x + 1; x + 1 <= s.x + s.l - 1; x += 2) c.meubler("sarcophage", x, s.y + 1);
      if (s.h >= 6) for (let x = s.x + 1; x + 1 <= s.x + s.l - 1; x += 2) c.meubler("sarcophage", x, s.y + s.h - 3);
    } else if (s.nom === "Ossuaire") {
      for (let k2 = 0; k2 < 5; k2++) {
        const x = r.entre(s.x, s.x + s.l - 1);
        const y = r.entre(s.y, s.y + s.h - 1);
        c.meubler("ossements", x, y);
      }
    } else if (s.nom === "Trésor") {
      // Le coffre (et sa note) trouve toujours une place, au fond d'abord.
      const places = [[cx, s.y + 1]];
      for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.l; x++) places.push([x, y]);
      const coffre = c.meublerParmi("coffre", places, { note: "Offrandes funéraires : 1D6 × 20 pièces d'or et une Gemme brute." });
      if (coffre) c.meublerParmi("tresor", [[coffre.x - 1, coffre.y], [coffre.x + 1, coffre.y], [coffre.x, coffre.y + 1]]);
      c.meublerParmi("statue", [[s.x, s.y], [s.x + s.l - 1, s.y], [s.x, s.y + s.h - 1], [s.x + s.l - 1, s.y + s.h - 1]]);
    } else if (s.nom === "Salle des offrandes") {
      c.meublerParmi("autel", [[cx - 1, s.y + 1, 0], ...contreUnMur]);
      c.meubler("brasero", s.x, s.y);
    }
    if (k > 0 && s.nom !== "Trésor" && r.pile(0.4)) c.meubler("brasero", s.x + s.l - 1, s.y + s.h - 1);
  });
  return c.fini("crypte", graine);
}

// ---------------------------------------------------------------- grotte

function grotte(graine) {
  const r = hasard(graine);
  const L = 44;
  const Hh = 32;
  const c = new Chantier(L, Hh, "Grotte");
  let roche = Array.from({ length: L * Hh }, (_, i) => {
    const x = i % L;
    const y = Math.floor(i / L);
    return x < 2 || y < 2 || x >= L - 2 || y >= Hh - 2 || r() < 0.46;
  });
  const voisins = (t, x, y) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      n += nx < 0 || ny < 0 || nx >= L || ny >= Hh || t[ny * L + nx] ? 1 : 0;
    }
    return n;
  };
  for (let it = 0; it < 5; it++) {
    roche = roche.map((v, i) => {
      const n = voisins(roche, i % L, Math.floor(i / L));
      return n >= 5 || (it < 2 && n <= 1);
    });
  }
  // Seule la plus grande poche reste.
  const zone = new Int32Array(L * Hh).fill(-1);
  const tailles = [];
  for (let i = 0; i < L * Hh; i++) {
    if (roche[i] || zone[i] >= 0) continue;
    const k = tailles.length;
    let n = 0;
    const pile = [i];
    zone[i] = k;
    while (pile.length) {
      const j = pile.pop();
      n++;
      const x = j % L;
      const y = Math.floor(j / L);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const q = ny * L + nx;
        if (nx < 0 || ny < 0 || nx >= L || ny >= Hh || roche[q] || zone[q] >= 0) continue;
        zone[q] = k;
        pile.push(q);
      }
    }
    tailles.push(n);
  }
  const garde = tailles.indexOf(Math.max(...tailles));
  const cases = [];
  for (let i = 0; i < L * Hh; i++) if (zone[i] === garde) cases.push(i);
  if (cases.length < 120) return grotte(graine + 1);
  // Des zones à révéler une à une : graines éloignées, puis chaque case va à la plus proche par le chemin.
  const nbZones = Math.max(4, Math.min(8, Math.round(cases.length / 90)));
  const graines = [r.un(cases)];
  const dist = (a, b) => Math.hypot((a % L) - (b % L), Math.floor(a / L) - Math.floor(b / L));
  while (graines.length < nbZones) {
    let meilleure = null;
    let dmax = -1;
    for (const q of cases) {
      const d = Math.min(...graines.map((g) => dist(g, q)));
      if (d > dmax) {
        dmax = d;
        meilleure = q;
      }
    }
    graines.push(meilleure);
  }
  const affect = new Int32Array(L * Hh).fill(-1);
  const file = graines.map((g, k) => [g, k]);
  for (const [g, k] of file) affect[g] = k;
  for (let t = 0; t < file.length; t++) {
    const [j, k] = file[t];
    const x = j % L;
    const y = Math.floor(j / L);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = (y + dy) * L + (x + dx);
      if (x + dx < 0 || y + dy < 0 || x + dx >= L || y + dy >= Hh || zone[q] !== garde || affect[q] >= 0) continue;
      affect[q] = k;
      file.push([q, k]);
    }
  }
  const nomsZones = ["Entrée", "Première galerie", "La salle aux échos", "Le bassin", "La fosse", "Galerie basse", "Le repaire", "Salle des champignons"];
  // L'entrée : la zone la plus proche d'un bord.
  let entree = 0;
  let meilleurBord = Infinity;
  graines.forEach((g, k) => {
    const x = g % L;
    const y = Math.floor(g / L);
    const d = Math.min(x, y, L - 1 - x, Hh - 1 - y);
    if (d < meilleurBord) {
      meilleurBord = d;
      entree = k;
    }
  });
  const ordre = [entree, ...graines.map((_, k) => k).filter((k) => k !== entree)];
  const ids = [];
  ordre.forEach((k, rang) => {
    ids[k] = c.piece(nomsZones[rang] || `Galerie ${rang + 1}`, "grotte", 6, 0, 0, 0, 0);
  });
  for (const q of cases) c.case(q % L, Math.floor(q / L), ids[affect[q]], 6);
  // Des mares, là où un bruit simple descend assez bas.
  const bassin = ids[ordre[Math.min(3, ordre.length - 1)]];
  const g0 = graines[ordre[Math.min(3, ordre.length - 1)]];
  for (const q of cases) {
    const d = dist(q, g0);
    if (d < 2.6 + r() * 1.2) c.p.sol[q] = 7;
  }
  // Le tunnel d'entrée jusqu'au bord le plus proche.
  const ge = graines[entree];
  let ex = ge % L;
  let ey = Math.floor(ge / L);
  const bords = [[ex, 0, 0, -1], [ex, Hh - 1, 0, 1], [0, ey, -1, 0], [L - 1, ey, 1, 0]];
  const [, , sx, sy] = bords.sort((a, b) => Math.hypot(a[0] - ex, a[1] - ey) - Math.hypot(b[0] - ex, b[1] - ey))[0];
  while (ex > 0 && ey > 0 && ex < L - 1 && ey < Hh - 1) {
    ex += sx;
    ey += sy;
    if (!c.pieceA(ex, ey)) c.case(ex, ey, ids[entree], 6);
  }
  // Rochers, stalagmites, champignons, ossements : un rocher ne ferme jamais un boyau.
  for (let k = 0; k < Math.round(cases.length / 18); k++) {
    const q = r.un(cases);
    const x = q % L;
    const y = Math.floor(q / L);
    if (c.p.sol[q] === 7 || !c.libre(x, y, 1, 1)) continue;
    c.meubler(r.un(["rochers", "stalagmite", "stalagmite", "champignons", "rochers", "ossements"]), x, y);
  }
  for (let k = 0; k < 3; k++) {
    const q = r.un(cases);
    const x = q % L;
    const y = Math.floor(q / L);
    if (c.p.sol[q] !== 7) c.meubler("gros-rocher", x, y);
  }
  void bassin;
  return c.fini("grotte", graine);
}

const GENERATEURS = { auberge, "auberge-etage": aubergeEtage, maison, crypte, grotte };

export function generer(modele, graine = Math.floor(Math.random() * 1e6)) {
  // Les plans extérieurs reçoivent les outils du chantier : leur module n'importe pas celui-ci.
  if (Object.prototype.hasOwnProperty.call(GENERATEURS_DEHORS, modele)) return GENERATEURS_DEHORS[modele](graine, { Chantier, hasard });
  const f = GENERATEURS[modele];
  if (!f) return { ...nouveauPlan({ nom: "Nouveau plan" }), generateur: { modele: "vierge", graine } };
  return f(graine);
}
