// Style « peint » des plans : une battle map du soir. Sols texturés, murs épais (pierre dehors, colombage ou pierre
// dedans), parois de roche, portes, mobilier ombré, objets d'ambiance (plan.habillage) et une lumière chaude qui ne
// traverse pas les murs. Tout se peint par zone, le fond d'ensemble comme chaque tuile du zoom : ce qui coûte (murs en
// pans, ombres, lumière) se calcule une fois par état du plan, en petites cartes agrandies au dessin, qui restent donc
// continues d'une tuile à l'autre.
// Vue des joueurs : seul ce qui est révélé compte. Une case cachée est du vide pour les murs, la lumière ne s'y répand
// pas, un objet ou une lumière qui s'y trouve n'existe pas ; le brouillard la couvre d'une seule couleur.

import { chaikin } from "../carte/geo.js";
import { texte } from "../carte/rendu.js";
import { MEUBLES, SOLS, cleArete, emprise, hache, lumiereValide, lumieresDuFeu, objetVisible, porteVisible, reveleA, teintesDesPieces } from "./modele.js";
import { dessinerSangPlan, tacheValide } from "./sang.js";
import { AU_SOL, GRANDS, MEUBLES_PEINTS, OBJETS_PEINTS, PAR_DESSUS, PLATS, dessinerMeublePeint, dessinerObjetPeint, rond } from "./peint-mobilier.js";
import { FOYERS_PLUS } from "./peint-mobilier-plus.js";
import { MATIERES_PEINTES, matiereArete, matierePeinte, matieresDesPieces, peindreMursPlus } from "./murs-plus.js";
import { motif } from "./textures.js";
import { reliefFalaises } from "./dehors-peint.js";
// Lot H2 : les images du MJ posées sous les pions.
import { dessinerImagesPlan } from "./images.js";

const EP_EXT = 0.34; // mur de pierre vers le dehors, en cases
const EP_INT = 0.24; // cloison intérieure
const BRUME = "#0f0c0a";

// Les heures du jour : couleur de l'ambiance dedans et dehors, et sa force (0 : aucune, 1 : la couleur pure). Mêmes
// valeurs que le serveur (habillage.py), qui les envoie à la TV.
export const AMBIANCES = {
  jour: { interieur: "#b9a888", exterieur: "#fff6e6", force: 0.3 },
  soir: { interieur: "#4c5278", exterieur: "#363f62", force: 0.78 },
  nuit: { interieur: "#2a3150", exterieur: "#1c2340", force: 0.9 },
};
// La lumière réglée sur le plan (plan.lumiere) l'emporte sur l'heure de l'habillage. Le crépuscule est le soir d'avant ;
// « torches » : la nuit noire d'un souterrain, où seuls les feux posés éclairent.
const LUMIERES_PLAN = {
  jour: AMBIANCES.jour,
  crepuscule: AMBIANCES.soir,
  nuit: AMBIANCES.nuit,
  torches: { interieur: "#2e2418", exterieur: "#16161e", force: 0.95 },
};
const HEURE_DE_LA_LUMIERE = { jour: "jour", crepuscule: "soir", nuit: "nuit", torches: "torches" };
const lumiereDuPlan = (p) => LUMIERES_PLAN[lumiereValide(p && p.lumiere)] || null;

// Ce qui éclaire sans que l'API le dise : les foyers du mobilier (et les champignons des grottes, qui luisent un peu),
// les objets d'habillage qui brûlent.
const FOYERS = {
  cheminee: { rayon: 6.5, couleur: "#ffb15e", intensite: 1, avant: 0.15, flamme: 1.5 },
  four: { rayon: 3.6, couleur: "#ff9a4a", intensite: 0.85, avant: 0.15, flamme: 0.9 },
  brasero: { rayon: 4.5, couleur: "#ffa955", intensite: 0.95, avant: 0, flamme: 1.1 },
  champignons: { rayon: 2.6, couleur: "#8fe0c8", intensite: 0.55, avant: 0, flamme: 0 },
  ...FOYERS_PLUS,
};
const LUMINEUX = {
  lanterne: { rayon: 3, couleur: "#ffc070", intensite: 0.8, flamme: 0.9 },
  chandelle: { rayon: 2.2, couleur: "#ffd08a", intensite: 0.65, flamme: 0.55 },
  "feu-de-camp": { rayon: 5, couleur: "#ffa955", intensite: 1, flamme: 1.4 },
};
// Sols naturels : leurs coins s'arrondissent les uns dans les autres.
const NATURELS = new Set(["herbe", "terre", "sable", "eau", "roche", "gravier", "boue", "feuilles", "mousse", "neige", "glace", "eau-profonde", "falaise", "cultures"]);
const COTES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];

// ---------------------------------------------------------------- outils

function toile(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function rvb(hex) {
  const n = parseInt(String(hex || "#ffb15e").slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const couleurValide = (c, defaut) => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : defaut);
const nombre = (v, defaut = 0) => (typeof v === "number" && Number.isFinite(v) ? v : defaut);

// Chrome perd des lettres quand une police de moins d'un pixel est agrandie : on écrit en 32 px et on réduit.
// Le halo est doux : trois contours de plus en plus larges et transparents sous la lettre.
function ecrireDoux(ctx, chaine, x, y, o) {
  const F = 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.taille / F, o.taille / F);
  const base = { ...o, taille: F };
  if (o.halo) {
    for (const [l, a] of [[0.95, 0.2], [0.62, 0.3], [0.34, 0.55]]) {
      texte(ctx, chaine, 0, 0, { ...base, couleur: "rgba(0,0,0,0)", halo: o.halo.replace("{a}", a), epaisseurHalo: l });
    }
  }
  texte(ctx, chaine, 0, 0, { ...base, halo: null });
  ctx.restore();
}

// ---------------------------------------------------------------- ce que voit celui qui regarde

export function vision(p, murs, joueurs) {
  const w = p.largeur;
  const h = p.hauteur;
  const n = w * h;
  const actif = joueurs && p.brouillard_actif;
  const vu = new Uint8Array(n);
  const sol = new Uint8Array(n);
  const mv = new Uint8Array(n);
  const genres = new Map((p.pieces || []).map((x) => [x.id, x.genre || "salle"]));
  const genre = new Array(n);
  for (let i = 0; i < n; i++) {
    vu[i] = !actif || (p.brouillard && p.brouillard[i] === 1) ? 1 : 0;
    sol[i] = vu[i] ? p.sol[i] || 0 : 0;
    mv[i] = vu[i] && murs ? murs[i] : 0;
    genre[i] = sol[i] ? genres.get(p.piece[i]) || "salle" : "vide";
  }
  return { w, h, vu, sol, murs: mv, genre };
}

// Un mur (droit ou de roche) entre deux cases voisines.
function bloque(v, i, j, bit) {
  const inverse = bit === 1 ? 4 : bit === 4 ? 1 : bit === 2 ? 8 : 2;
  return !!((v.murs[i] | (v.murs[i] >> 4)) & bit) || !!((v.murs[j] | (v.murs[j] >> 4)) & inverse);
}

// ---------------------------------------------------------------- murs en pans

// matieres : la matière choisie de chaque pièce (murs-plus.js), ou null ; p : le plan, pour lire ses pièces.
function aretesMurs(v, portes, p, matieres) {
  const { w, h } = v;
  const salle = (x, y) => x >= 0 && y >= 0 && x < w && y < h && v.genre[y * w + x] === "salle";
  const res = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = v.murs[y * w + x] & 15;
      if (!m) continue;
      const poser = (sens, ax, ay, ox, oy) => {
        const cle = cleArete(sens, ax, ay);
        if (!res.has(cle)) {
          const a = { sens, x: ax, y: ay, dehors: !(salle(x, y) && salle(ox, oy)) };
          // Une case que le joueur ne voit pas ne donne pas sa matière (v.sol y vaut 0).
          const m = matieres ? matiereArete({ largeur: w, hauteur: h, sol: v.sol, piece: p.piece }, matieres, sens, ax, ay) : "";
          if (m) a.mat = matierePeinte(m, a.dehors);
          res.set(cle, a);
        }
      };
      if (m & 1) poser("h", x, y, x, y - 1);
      if (m & 4) poser("h", x, y + 1, x, y + 1);
      if (m & 8) poser("v", x, y, x - 1, y);
      if (m & 2) poser("v", x + 1, y, x + 1, y);
    }
  }
  for (const [cle, a] of res) {
    const d = portes.get(cle);
    a.coupe = !!d && d.genre !== "fenetre" && !(d.genre === "secrete" && !d.decouverte);
  }
  return res;
}

// Les arêtes regroupées en pans continus, coupés aux portes ; mat : pierre (dehors), bois (colombage) ou cloison.
function pansDeMurs(aretes, pierreDedans) {
  const groupes = new Map();
  for (const a of aretes.values()) {
    const mat = a.mat || (a.dehors ? "pierre" : pierreDedans ? "cloison" : "bois");
    // Une matière choisie a l'épaisseur de sa place (dehors, cloison) : elle se range aussi par là.
    const cle = `${a.sens}:${a.sens === "h" ? a.y : a.x}:${mat}${MATIERES_PEINTES.has(mat) ? `:${a.dehors ? 1 : 0}` : ""}`;
    if (!groupes.has(cle)) groupes.set(cle, { mat, liste: [], dehors: a.dehors });
    groupes.get(cle).liste.push(a);
  }
  const res = [];
  for (const { mat, liste, dehors } of groupes.values()) {
    const sens = liste[0].sens;
    const pos = (a) => (sens === "h" ? a.x : a.y);
    liste.sort((a, b) => pos(a) - pos(b));
    let debut = null;
    let prec = null;
    const fermer = () => {
      if (debut) res.push({ sens, mat, dehors, fixe: sens === "h" ? debut.y : debut.x, de: pos(debut), a: pos(prec) + 1 });
      debut = null;
    };
    for (const a of liste) {
      if (debut && (a.coupe || pos(a) !== pos(prec) + 1)) fermer();
      if (a.coupe) continue;
      if (!debut) debut = a;
      prec = a;
    }
    fermer();
  }
  for (const pn of res) {
    const e = pn.mat === "pierre" || (MATIERES_PEINTES.has(pn.mat) && pn.dehors) ? EP_EXT : EP_INT;
    pn.r = pn.sens === "h" ? [pn.de - e / 2, pn.fixe - e / 2, pn.a - pn.de + e, e] : [pn.fixe - e / 2, pn.de - e / 2, e, pn.a - pn.de + e];
  }
  return res;
}

// Les parois de grotte, enchaînées d'arête en arête, puis bosselées et lissées : une ligne de roche continue au lieu
// des marches de la grille. Chaque sommet bouge selon ses coordonnées, le tracé ne dépend pas de la zone peinte.
function chainesRoche(aretes) {
  const cle = (x, y) => `${x}:${y}`;
  const bouts = (a) => (a[0] === "h" ? [[a[1], a[2]], [a[1] + 1, a[2]]] : [[a[1], a[2]], [a[1], a[2] + 1]]);
  const parSommet = new Map();
  aretes.forEach((a, n) => {
    for (const [x, y] of bouts(a)) {
      const k = cle(x, y);
      if (!parSommet.has(k)) parSommet.set(k, []);
      parSommet.get(k).push(n);
    }
  });
  const pris = new Uint8Array(aretes.length);
  const suivre = (n, depuis) => {
    // Depuis le sommet « depuis », par l'arête n, aussi loin que le chemin ne bifurque pas.
    const pts = [depuis];
    let courant = depuis;
    let arete = n;
    while (arete >= 0 && !pris[arete]) {
      pris[arete] = 1;
      const [a, b] = bouts(aretes[arete]);
      const autre = a[0] === courant[0] && a[1] === courant[1] ? b : a;
      pts.push(autre);
      courant = autre;
      const liste = parSommet.get(cle(...autre));
      arete = liste.length === 2 ? (liste[0] === arete ? liste[1] : liste[0]) : -1;
    }
    return pts;
  };
  const res = [];
  for (let n = 0; n < aretes.length; n++) {
    if (pris[n]) continue;
    const [a] = bouts(aretes[n]);
    const avant = suivre(n, a);
    const fin = avant[avant.length - 1];
    const ferme = fin[0] === a[0] && fin[1] === a[1] && avant.length > 3;
    let pts = avant;
    if (!ferme) {
      const liste = parSommet.get(cle(...a));
      const autre = liste.length === 2 ? (liste[0] === n ? liste[1] : liste[0]) : -1;
      if (autre >= 0 && !pris[autre]) pts = suivre(autre, a).reverse().concat(avant.slice(1));
    } else pts = avant.slice(0, -1);
    const bosses = pts.map(([x, y]) => [x + (hache(x, y, 31) - 0.5) * 0.34, y + (hache(x, y, 37) - 0.5) * 0.34]);
    const lisse = chaikin(bosses, ferme, 3);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of lisse) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    res.push({ points: lisse, ferme, b: { x0, y0, x1, y1 } });
  }
  return res;
}

function tracerChaine(ctx, c) {
  const p = c.points;
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  if (c.ferme) ctx.closePath();
}

function aretesRoche(v, portes) {
  const res = [];
  const { w, h } = v;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = v.murs[y * w + x] >> 4;
      if (!m) continue;
      const liste = [];
      if (m & 1) liste.push(["h", x, y]);
      if (m & 4) liste.push(["h", x, y + 1]);
      if (m & 8) liste.push(["v", x, y]);
      if (m & 2) liste.push(["v", x + 1, y]);
      for (const a of liste) {
        const d = portes.get(cleArete(...a));
        if (!(d && d.genre !== "fenetre" && !(d.genre === "secrete" && !d.decouverte))) res.push(a);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------- habillage et lumières

// L'habillage tel que le voit celui qui regarde : pour les joueurs, rien de caché ni rien dans une case non révélée.
export function habillageVu(p, joueurs) {
  const hab = p.habillage && typeof p.habillage === "object" ? p.habillage : null;
  const vide = { objets: [], lumieres: [], legende: [], ambiance: null, heure: null };
  if (!hab) return vide;
  const ici = (x, y) => !joueurs || reveleA(p, x, y);
  const objets = [];
  for (const o of Array.isArray(hab.objets) ? hab.objets : []) {
    if (!o || typeof o.cle !== "string" || !Array.isArray(o.case)) continue;
    if (!OBJETS_PEINTS[o.cle] && o.cle !== "ornieres") continue;
    const cx = nombre(o.case[0], NaN);
    const cy = nombre(o.case[1], NaN);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (joueurs && (o.cache || !ici(cx + 0.5, cy + 0.5))) continue;
    const dec = Array.isArray(o.decalage) ? o.decalage : [0.5, 0.5];
    objets.push({ cle: o.cle, piece: o.piece, x: cx + nombre(dec[0], 0.5), y: cy + nombre(dec[1], 0.5), cx, cy, rot: nombre(o.rot), cache: !!o.cache });
  }
  const lumieres = [];
  for (const l of Array.isArray(hab.lumieres) ? hab.lumieres : []) {
    if (!l || l.eteinte) continue;
    const x = nombre(l.x, NaN);
    const y = nombre(l.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (joueurs && (l.cache || !ici(x, y))) continue;
    lumieres.push({ x, y, rayon: Math.min(14, Math.max(0.5, nombre(l.rayon, 3))), couleur: couleurValide(l.couleur, "#ffb15e"), intensite: Math.min(1.5, Math.max(0, nombre(l.intensite, 1))) });
  }
  const noms = new Map((p.pieces || []).map((x) => [x.id, x]));
  const legende = [];
  for (const l of Array.isArray(hab.legende) ? hab.legende : []) {
    if (!l || typeof l.texte !== "string" || !l.texte.trim()) continue;
    const x = nombre(l.x, NaN);
    const y = nombre(l.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pc = noms.get(l.piece);
    // Pour les joueurs, la légende d'une pièce suit son nom : rien tant que le MJ ne l'a pas rendu visible.
    if (joueurs && (l.cache || !ici(x, y) || (pc && !pc.nom_visible))) continue;
    legende.push({ texte: l.texte.trim().slice(0, 60), x, y, piece: l.piece });
  }
  const amb = hab.ambiance && typeof hab.ambiance === "object" ? hab.ambiance : null;
  return {
    objets, lumieres, legende,
    heure: AMBIANCES[hab.heure] ? hab.heure : null,
    ambiance: amb ? { interieur: couleurValide(amb.interieur, AMBIANCES.soir.interieur), exterieur: couleurValide(amb.exterieur, AMBIANCES.soir.exterieur), force: Math.min(1, Math.max(0, nombre(amb.force, 0.78))) } : null,
  };
}

// Le sang que voit celui qui regarde : pour les joueurs, rien de caché ni rien dans une case non révélée. Lu à chaque
// dessin, hors de la signature (signature) : un coup de pinceau ne refait ni l'ombre ni la lumière du plan.
export function sangVu(p, joueurs) {
  const brut = p.habillage && typeof p.habillage === "object" && Array.isArray(p.habillage.sang) ? p.habillage.sang : [];
  const sang = [];
  for (const b of brut) {
    const s = tacheValide(b);
    if (!s || (joueurs && (s.cache || !reveleA(p, s.x, s.y)))) continue;
    sang.push(s);
  }
  return sang;
}

export function ambianceDuPlan(p) {
  const l = lumiereDuPlan(p);
  if (l) return l;
  const hab = p.habillage && typeof p.habillage === "object" ? p.habillage : null;
  const a = hab && hab.ambiance && typeof hab.ambiance === "object" ? hab.ambiance : null;
  if (a) return { interieur: couleurValide(a.interieur, AMBIANCES.soir.interieur), exterieur: couleurValide(a.exterieur, AMBIANCES.soir.exterieur), force: Math.min(1, Math.max(0, nombre(a.force, 0.78))) };
  return AMBIANCES[hab && hab.heure] || AMBIANCES.soir;
}

const melange = (amb) => (c) => rvb(c).map((v) => Math.round(255 - amb.force * (255 - v)));

// La couleur du brouillard une fois l'ambiance posée : celle de tout ce que les joueurs ne voient pas, et donc du fond
// de la TV autour du plan (aucune bordure ne trahit sa taille).
export function fondPeint(p) {
  const ae = melange(ambianceDuPlan(p))(ambianceDuPlan(p).exterieur);
  const b = rvb(BRUME);
  return `rgb(${b.map((v, k) => Math.round((v * ae[k]) / 255))})`;
}

// Centre d'un meuble et point placé devant lui (le foyer d'une cheminée), rotation comprise.
function devant(o, d) {
  const b = emprise(o);
  const a = ((o.rot || 0) * Math.PI) / 180;
  return [(b.x0 + b.x1) / 2 - Math.sin(a) * d, (b.y0 + b.y1) / 2 + Math.cos(a) * d];
}

// Pour les joueurs, une lumière dont le point tombe dans une case cachée n'existe pas (ni sa flamme). Le feu (plan.feu)
// éclaire aussi, case révélée par case révélée (lumieresDuFeu).
function lumieresVues(etat, p, joueurs) {
  const res = etat.hab.lumieres.map((l) => ({ ...l }));
  const flammes = [];
  const proche = (x, y, d) => res.some((l) => Math.hypot(l.x - x, l.y - y) < d);
  for (const { o } of etat.meubles) {
    const f = FOYERS[o.cle];
    if (!f) continue;
    const [x, y] = devant(o, f.avant);
    if (joueurs && !reveleA(p, x, y)) continue;
    if (f.flamme) flammes.push([x, y, f.flamme, 0.32]);
    if (!proche(x, y, 1.6)) res.push({ x, y, rayon: f.rayon, couleur: f.couleur, intensite: f.intensite });
  }
  for (const o of etat.hab.objets) {
    const f = LUMINEUX[o.cle];
    if (!f) continue;
    flammes.push([o.x, o.y, f.flamme, 0.3]);
    if (!proche(o.x, o.y, 1.1)) res.push({ x: o.x, y: o.y, rayon: f.rayon, couleur: f.couleur, intensite: f.intensite });
  }
  for (const l of lumieresDuFeu(p, joueurs)) {
    flammes.push([l.x, l.y, l.halo, 0.34]);
    res.push({ x: l.x, y: l.y, rayon: l.rayon, couleur: l.couleur, intensite: l.intensite });
  }
  return { lumieres: res, flammes };
}

// Les cases qu'une lumière atteint : sa case et celles qu'on rejoint sans passer un mur, dans son rayon.
function region(v, x, y, rayon) {
  const { w, h } = v;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h || !v.vu[cx + cy * w]) return null;
  const R = Math.ceil(rayon) + 1;
  const vus = new Set([cy * w + cx]);
  const pile = [cy * w + cx];
  const chemin = new Path2D();
  while (pile.length) {
    const i = pile.pop();
    const ix = i % w;
    const iy = (i - ix) / w;
    chemin.rect(ix - 0.02, iy - 0.02, 1.04, 1.04);
    for (const [dx, dy, bit] of COTES) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || Math.abs(nx - cx) > R || Math.abs(ny - cy) > R) continue;
      const j = ny * w + nx;
      if (vus.has(j) || !v.vu[j] || bloque(v, i, j, bit)) continue;
      vus.add(j);
      pile.push(j);
    }
  }
  return { chemin, cases: vus };
}

// ---------------------------------------------------------------- l'état précalculé

// Ce qui change le fond peint : tout sauf les pions, les textes et les notes.
function signature(p, joueurs) {
  return JSON.stringify([
    p.largeur, p.hauteur, p.sol, p.piece, joueurs && p.brouillard_actif ? p.brouillard : null, p.brouillard_actif, p.portes, p.objets,
    (p.pieces || []).map((x) => [x.id, x.genre, x.nom_visible, x.teinte, x.mur]), p.habillage ? { ...p.habillage, sang: undefined } : null, p.fond ? !!p.fond.dessiner : null, joueurs,
    lumieresDuFeu(p, joueurs), p.lumiere || null,
  ]);
}

// Cartes à K pixels par case : l'ombre portée, la lumière (multipliée) et la lueur (ajoutée).
function finesseCartes(w, h) {
  return Math.max(6, Math.min(20, Math.floor(Math.sqrt(1.2e6 / (w * h)))));
}

export function preparerPeint(p, murs, o = {}) {
  const joueurs = !!o.joueurs;
  const t0 = performance.now();
  const v = vision(p, murs, joueurs);
  const { w, h } = v;
  const structure = !p.fond || !!p.fond.dessiner;
  // Portes vues : pour les joueurs, ni porte secrète non découverte (le mur reste), ni porte hors de vue.
  const portes = new Map();
  for (const d of p.portes || []) {
    if (joueurs && !porteVisible(p, d)) continue;
    portes.set(cleArete(d.sens, d.x, d.y), d);
  }
  // Une bâtisse de pierre (crypte, temple) garde des cloisons de pierre ; sinon, du colombage.
  let pierre = 0;
  let salles = 0;
  for (let i = 0; i < w * h; i++) {
    if (v.genre[i] !== "salle") continue;
    salles++;
    const cle = SOLS[v.sol[i]] ? SOLS[v.sol[i]].cle : "";
    if (cle === "pierre" || cle === "marbre" || cle === "roche" || cle === "dalles") pierre++;
  }
  const aretes = aretesMurs(v, portes, p, matieresDesPieces(p));
  const roches = structure ? aretesRoche(v, portes) : [];
  const etat = {
    sig: o.sig || signature(p, joueurs), joueurs, w, h, v, structure, portes, aretes, roches,
    pans: structure ? pansDeMurs(aretes, salles > 0 && pierre / salles >= 0.6) : [],
    chaines: chainesRoche(roches),
    exterieur: (p.pieces || []).some((x) => x.genre === "exterieur" && (!joueurs || v.genre.includes("exterieur"))),
    teintes: teintesDesPieces(p),
    meubles: meublesVus(p, joueurs),
    hab: habillageVu(p, joueurs),
    mesures: {},
  };
  etat.mesures.analyse = performance.now() - t0;
  if (structure) {
    const t1 = performance.now();
    etat.K = finesseCartes(w, h);
    etat.ombre = carteOmbres(etat);
    etat.mesures.ombres = performance.now() - t1;
    const t2 = performance.now();
    eclairage(etat, p);
    etat.mesures.lumiere = performance.now() - t2;
  }
  etat.mesures.total = performance.now() - t0;
  return etat;
}

// Le mobilier vu, dans l'ordre où il se pose : stalles et tapis d'abord, puis ce qui est plat, puis le reste.
function meublesVus(p, joueurs) {
  const res = [];
  const ordre = (x) => (x.cle === "stalle" ? 0 : x.cle === "tapis" || MEUBLES[x.cle]?.sol ? 1 : PLATS.has(x.cle) ? 2 : 3);
  for (const x of (p.objets || []).slice().sort((a, b) => ordre(a) - ordre(b))) {
    if (!MEUBLES_PEINTS[x.cle]) continue;
    if (joueurs && !objetVisible(p, x)) continue;
    res.push({ o: x, b: emprise(x), cache: !joueurs && !!x.cache });
  }
  return res;
}

// Les lumières que voit celui qui regarde, hors lueurs des fenêtres (qui en découlent) : pour les vérifications.
export function lumieresVisibles(p, joueurs) {
  return lumieresVues({ meubles: meublesVus(p, !!joueurs), hab: habillageVu(p, !!joueurs) }, p, !!joueurs).lumieres;
}

export function signaturePeint(p, joueurs) {
  return signature(p, !!joueurs);
}

// ---------------------------------------------------------------- ombres

function ombrer(g, sil, K, dx, dy, flou, alpha) {
  // L'image passe hors de la toile, seule son ombre y tombe.
  const loin = sil.width + 64;
  g.save();
  g.shadowColor = `rgba(8,5,2,${alpha})`;
  g.shadowBlur = Math.max(0.5, flou * K);
  g.shadowOffsetX = dx * K + loin;
  g.shadowOffsetY = dy * K;
  g.drawImage(sil, -loin, 0);
  g.restore();
}

function carteOmbres(etat) {
  const { w, h, K } = etat;
  const W = w * K;
  const H = h * K;
  const om = toile(W, H);
  const g = om.getContext("2d");
  const classes = { murs: [], meubles: [], plats: [], grands: [] };
  const sil = toile(W, H);
  const s = sil.getContext("2d");
  const silhouette = (dessin) => {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, W, H);
    s.setTransform(K, 0, 0, K, 0, 0);
    dessin(s);
  };
  // Murs droits et parois de roche.
  if (etat.pans.length || etat.roches.length) {
    silhouette((c) => {
      c.fillStyle = "#000";
      for (const pn of etat.pans) c.fillRect(...pn.r);
      if (etat.roches.length) {
        c.strokeStyle = "#000";
        c.lineWidth = 0.42;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        for (const ch of etat.chaines) tracerChaine(c, ch);
        c.stroke();
      }
    });
    ombrer(g, sil, K, 0, 0, 0.21, 0.43);
    ombrer(g, sil, K, 0.13, 0.16, 0.26, 0.62);
  }
  for (const m of etat.meubles) classes[GRANDS.has(m.o.cle) ? "grands" : PLATS.has(m.o.cle) ? "plats" : "meubles"].push(m);
  const objets = etat.hab.objets.filter((o) => !AU_SOL.has(o.cle) && !PAR_DESSUS.has(o.cle));
  const reglages = {
    meubles: [[0, 0, 0.1, 0.38], [0.07, 0.09, 0.12, 0.55]],
    plats: [[0, 0, 0.05, 0.3]],
    grands: [[0, 0, 0.15, 0.4], [0.22, 0.28, 0.3, 0.5]],
  };
  for (const cle of ["plats", "meubles", "grands"]) {
    const liste = classes[cle];
    if (!liste.length && !(cle === "meubles" && objets.length)) continue;
    silhouette((c) => {
      for (const m of liste) dessinerMeublePeint(c, m.o);
      if (cle === "meubles") for (const o of objets) dessinerObjetPeint(c, o.cle, o.x, o.y, o.rot);
    });
    for (const r of reglages[cle]) ombrer(g, sil, K, ...r);
  }
  sil.width = 0;
  return om;
}

// ---------------------------------------------------------------- lumière

function eclairage(etat, p) {
  const { w, h, K, v } = etat;
  const amb = lumiereDuPlan(p) || etat.hab.ambiance || AMBIANCES[etat.hab.heure] || ambianceDuPlan(p);
  const mel = melange(amb);
  const ai = mel(amb.interieur);
  const ae = mel(amb.exterieur);
  const L = toile(w * K, h * K);
  const g = L.getContext("2d");
  g.setTransform(K, 0, 0, K, 0, 0);
  const dedans = new Path2D();
  for (let i = 0; i < w * h; i++) if (v.genre[i] === "salle") dedans.rect((i % w) - 0.02, Math.floor(i / w) - 0.02, 1.04, 1.04);
  g.fillStyle = `rgb(${ae})`;
  g.fillRect(0, 0, w, h);
  g.fillStyle = `rgb(${ai})`;
  g.fill(dedans);
  const { lumieres, flammes } = lumieresVues(etat, p, etat.joueurs);
  // Les fenêtres d'une pièce éclairée laissent filer une lueur dehors.
  const eclairees = new Set();
  for (const l of lumieres) {
    const i = Math.floor(l.y) * w + Math.floor(l.x);
    if (l.x >= 0 && l.y >= 0 && l.x < w && l.y < h && v.genre[i] === "salle") eclairees.add(p.piece[i]);
  }
  const allumee = (x, y) => x >= 0 && y >= 0 && x < w && y < h && v.genre[y * w + x] === "salle" && eclairees.has(p.piece[y * w + x]);
  for (const d of etat.portes.values()) {
    if (d.genre !== "fenetre") continue;
    const [a, b] = d.sens === "h" ? [[d.x, d.y - 1], [d.x, d.y]] : [[d.x - 1, d.y], [d.x, d.y]];
    const dansA = allumee(...a);
    const dansB = allumee(...b);
    if (dansA === dansB) continue;
    const ext = dansA ? b : a;
    lumieres.push({ x: ext[0] + 0.5, y: ext[1] + 0.5, rayon: 2.2, couleur: "#ffb35c", intensite: 0.75, gx: d.sens === "h" ? d.x + 0.5 : d.x, gy: d.sens === "h" ? d.y : d.y + 0.5 });
  }
  // Et par toutes les fenêtres vers le dehors entre la clarté du ciel : la lune le soir, le jour franc le jour.
  const heure = HEURE_DE_LA_LUMIERE[lumiereValide(p.lumiere)] || etat.hab.heure || (p.habillage && AMBIANCES[p.habillage.heure] ? p.habillage.heure : "soir");
  const ciel = { jour: ["#fff1d6", 3.2, 0.7], soir: ["#a4b4dc", 3, 0.62], nuit: ["#8494c4", 2.4, 0.45], torches: ["#6a78a8", 1.8, 0.28] }[heure];
  for (const d of etat.portes.values()) {
    if (d.genre !== "fenetre") continue;
    const [a, b] = d.sens === "h" ? [[d.x, d.y - 1], [d.x, d.y]] : [[d.x - 1, d.y], [d.x, d.y]];
    const salle = (c) => c[0] >= 0 && c[1] >= 0 && c[0] < w && c[1] < h && v.genre[c[1] * w + c[0]] === "salle";
    if (salle(a) === salle(b)) continue;
    const dedans = salle(a) ? a : b;
    const sx = d.sens === "h" ? d.x + 0.5 : d.x;
    const sy = d.sens === "h" ? d.y : d.y + 0.5;
    const vers = [dedans[0] + 0.5 - sx, dedans[1] + 0.5 - sy];
    lumieres.push({ x: dedans[0] + 0.5, y: dedans[1] + 0.5, rayon: ciel[1], couleur: ciel[0], intensite: ciel[2], gx: sx + vers[0] * 0.3, gy: sy + vers[1] * 0.3, ciel: true });
  }
  const regions = new Map();
  const regionDe = (x, y, r) => {
    const cle = `${Math.floor(x)}:${Math.floor(y)}:${Math.ceil(r)}`;
    if (!regions.has(cle)) regions.set(cle, region(v, x, y, r));
    return regions.get(cle);
  };
  g.globalCompositeOperation = "lighter";
  const actives = [];
  for (const l of lumieres) {
    const reg = regionDe(l.x, l.y, l.rayon);
    if (!reg) continue;
    const cx = l.gx === undefined ? l.x : l.gx;
    const cy = l.gy === undefined ? l.y : l.gy;
    const i = Math.floor(l.y) * w + Math.floor(l.x);
    const a0 = v.genre[i] === "salle" ? ai : ae;
    const cible = rvb(l.couleur).map((c) => 255 - 0.62 * (255 - c));
    const ajout = cible.map((c, k) => Math.round(Math.max(0, c - a0[k]) * l.intensite));
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, l.rayon);
    gr.addColorStop(0, `rgba(${ajout},1)`);
    gr.addColorStop(0.3, `rgba(${ajout},.8)`);
    gr.addColorStop(0.65, `rgba(${ajout},.32)`);
    gr.addColorStop(1, `rgba(${ajout},0)`);
    g.save();
    g.clip(reg.chemin);
    g.fillStyle = gr;
    g.fillRect(cx - l.rayon, cy - l.rayon, l.rayon * 2, l.rayon * 2);
    g.restore();
    actives.push({ l, reg, cx, cy });
  }
  // La lueur chaude : une flaque de la couleur de chaque lumière, et le halo des flammes, sans traverser les murs.
  const G = toile(w * K, h * K);
  const q = G.getContext("2d");
  q.setTransform(K, 0, 0, K, 0, 0);
  q.globalCompositeOperation = "lighter";
  for (const { l, reg, cx, cy } of actives) {
    if (l.ciel) continue;
    const c = rvb(l.couleur);
    const a = 0.16 * l.intensite;
    const gr = q.createRadialGradient(cx, cy, 0, cx, cy, l.rayon * 0.8);
    gr.addColorStop(0, `rgba(${c},${a})`);
    gr.addColorStop(0.5, `rgba(${c},${a * 0.45})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    q.save();
    q.clip(reg.chemin);
    q.fillStyle = gr;
    q.fillRect(cx - l.rayon, cy - l.rayon, l.rayon * 2, l.rayon * 2);
    q.restore();
  }
  for (const [x, y, r, a] of flammes) {
    const reg = regionDe(x, y, r);
    if (!reg) continue;
    const gr = q.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,170,80,${a})`);
    gr.addColorStop(0.4, `rgba(255,120,40,${a * 0.4})`);
    gr.addColorStop(1, "rgba(255,100,30,0)");
    q.save();
    q.clip(reg.chemin);
    q.fillStyle = gr;
    q.fillRect(x - r, y - r, 2 * r, 2 * r);
    q.restore();
  }
  etat.lumiere = L;
  etat.lueur = G;
  etat.lumieres = actives.length;
}

// ---------------------------------------------------------------- différence entre deux états

// Les pixels d'une carte d'un état ne se lisent qu'une fois : l'état d'après d'une retouche est l'état d'avant de la
// suivante, et ils partent avec lui. Une toile relue coûte une seconde lecture, et Chrome s'en plaint dans la console.
function pixels(etat, cle) {
  const lus = etat.lus || (etat.lus = {});
  if (!lus[cle]) {
    const c = etat[cle];
    lus[cle] = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  }
  return lus[cle];
}

function boiteDifferente(avant, apres, cle, K) {
  const a = avant[cle];
  const b = apres[cle];
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  const da = pixels(avant, cle);
  const db = pixels(apres, cle);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const W = a.width;
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2] && da[i + 3] === db[i + 3]) continue;
    const p = i >> 2;
    const x = p % W;
    const y = (p - x) / W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x0 === Infinity ? false : { x0: x0 / K - 1, y0: y0 / K - 1, x1: (x1 + 1) / K + 1, y1: (y1 + 1) / K + 1 };
}

// La zone (en cases) où deux états se peignent différemment, en dehors de ce que l'appelant repeint déjà ; null pour
// « tout le plan ». Les pans de murs comptent, les cartes d'ombre et de lumière se comparent pixel à pixel.
export function zoneChangee(avant, apres) {
  if (!avant || !apres || avant.w !== apres.w || avant.h !== apres.h || avant.structure !== apres.structure || avant.K !== apres.K) return null;
  let z = null;
  const ajouter = (b) => {
    if (!b) return;
    z = z ? { x0: Math.min(z.x0, b.x0), y0: Math.min(z.y0, b.y0), x1: Math.max(z.x1, b.x1), y1: Math.max(z.y1, b.y1) } : b;
  };
  for (const cle of ["ombre", "lumiere", "lueur"]) {
    const b = boiteDifferente(avant, apres, cle, apres.K);
    if (b === null) return null;
    if (b) ajouter(b);
  }
  const cles = (e) => new Set([...e.pans.map((pn) => `${pn.sens}:${pn.fixe}:${pn.de}:${pn.a}:${pn.mat}`), ...e.roches.map((a) => a.join(":"))]);
  const ka = cles(avant);
  const kb = cles(apres);
  for (const [liste, autre] of [[avant, kb], [apres, ka]]) {
    for (const pn of liste.pans) if (!autre.has(`${pn.sens}:${pn.fixe}:${pn.de}:${pn.a}:${pn.mat}`)) ajouter({ x0: pn.r[0] - 1, y0: pn.r[1] - 1, x1: pn.r[0] + pn.r[2] + 1, y1: pn.r[1] + pn.r[3] + 1 });
    for (const a of liste.roches) if (!autre.has(a.join(":"))) ajouter({ x0: a[1] - 1, y0: a[2] - 1, x1: a[1] + 2, y1: a[2] + 2 });
  }
  if (avant.exterieur !== apres.exterieur) return null;
  return z || false;
}

// ---------------------------------------------------------------- peinture d'une zone

function dessinerMursPeints(ctx, etat, zone, S, hautes) {
  const dans = (r) => r[0] < zone.x1 && r[0] + r[2] > zone.x0 && r[1] < zone.y1 && r[1] + r[3] > zone.y0;
  const pierre = new Path2D();
  const bois = new Path2D();
  const cloison = new Path2D();
  // Le colombage choisi (« torchis ») se peint avec celui d'avant ; planches, roche taillée et palissade à part.
  const liste = { pierre: [], bois: [], cloison: [], planches: [], taillee: [], palissade: [] };
  for (const pn of etat.pans) {
    if (!dans(pn.r)) continue;
    const mat = pn.mat === "torchis" ? "bois" : pn.mat;
    if (mat === "pierre" || mat === "bois" || mat === "cloison") ({ pierre, bois, cloison })[mat].rect(...pn.r);
    liste[mat].push(pn);
  }
  const lw = 0.03;
  // Un contour large passé dessous, puis le plein : seul le pourtour de l'ensemble reste, sans trait aux jonctions.
  if (liste.bois.length) {
    ctx.strokeStyle = "rgba(24,16,8,.85)";
    ctx.lineWidth = lw * 2;
    ctx.stroke(bois);
    ctx.fillStyle = "#bba887";
    ctx.fill(bois);
    // Colombage : sablières de chêne sombre, poteaux à chaque case, torchis entre eux.
    ctx.fillStyle = "#4e3320";
    for (const pn of liste.bois) {
      const [x, y, w, h] = pn.r;
      if (pn.sens === "h") {
        ctx.fillRect(x, y, w, h * 0.32);
        ctx.fillRect(x, y + h * 0.68, w, h * 0.32);
        for (let t = pn.de; t <= pn.a; t++) ctx.fillRect(Math.max(x, t - 0.08), y, Math.min(0.16, x + w - t + 0.08), h);
      } else {
        ctx.fillRect(x, y, w * 0.32, h);
        ctx.fillRect(x + w * 0.68, y, w * 0.32, h);
        for (let t = pn.de; t <= pn.a; t++) ctx.fillRect(x, Math.max(y, t - 0.08), w, Math.min(0.16, y + h - t + 0.08));
      }
    }
    ctx.strokeStyle = "rgba(255,226,180,.12)";
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    for (const pn of liste.bois) {
      const [x, y, w, h] = pn.r;
      if (pn.sens === "h") {
        ctx.moveTo(x, y + h * 0.16);
        ctx.lineTo(x + w, y + h * 0.16);
      } else {
        ctx.moveTo(x + w * 0.16, y);
        ctx.lineTo(x + w * 0.16, y + h);
      }
    }
    ctx.stroke();
  }
  for (const [mat, chemin] of [["cloison", cloison], ["pierre", pierre]]) {
    if (!liste[mat].length) continue;
    ctx.strokeStyle = "rgba(24,16,8,.85)";
    ctx.lineWidth = lw * 2;
    ctx.stroke(chemin);
    ctx.fillStyle = motif(ctx, "muraille", S, hautes);
    ctx.fill(chemin);
    ctx.fillStyle = mat === "pierre" ? "rgba(255,246,226,.06)" : "rgba(255,246,226,.1)";
    ctx.fill(chemin);
  }
  peindreMursPlus(ctx, liste, S, hautes);
  // Parois de roche : la masse sombre, la pierre, une arête claire.
  const chaines = etat.chaines.filter((c) => c.b.x1 > zone.x0 - 1 && c.b.x0 < zone.x1 + 1 && c.b.y1 > zone.y0 - 1 && c.b.y0 < zone.y1 + 1);
  if (chaines.length) {
    const chemin = new Path2D();
    for (const c of chaines) tracerChaine(chemin, c);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1712";
    ctx.lineWidth = 0.5;
    ctx.stroke(chemin);
    ctx.strokeStyle = motif(ctx, "roche", S, hautes);
    ctx.lineWidth = 0.32;
    ctx.stroke(chemin);
    ctx.strokeStyle = "rgba(20,16,12,.35)";
    ctx.stroke(chemin);
    ctx.strokeStyle = "rgba(226,212,186,.22)";
    ctx.lineWidth = 0.05;
    ctx.stroke(chemin);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  }
}

function dessinerPortePeinte(ctx, d, etat, mj) {
  const a = etat.aretes.get(cleArete(d.sens, d.x, d.y));
  const e = a && !a.dehors ? EP_INT : EP_EXT;
  if (d.genre === "secrete" && !d.decouverte) {
    // Vue du MJ : le mur reste, marqué d'un S rouge.
    const hz = d.sens === "h";
    ctx.save();
    ctx.setLineDash([0.08, 0.06]);
    ctx.strokeStyle = "#e0584c";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(hz ? d.x + 0.15 : d.x, hz ? d.y : d.y + 0.15);
    ctx.lineTo(hz ? d.x + 0.85 : d.x, hz ? d.y : d.y + 0.85);
    ctx.stroke();
    ctx.restore();
    ecrireDoux(ctx, "S", hz ? d.x + 0.5 : d.x + 0.24, hz ? d.y - 0.26 : d.y + 0.5, { taille: 0.34, police: "700 {t}px Cinzel", couleur: "#b3261e", halo: "rgba(246,238,219,{a})" });
    return;
  }
  ctx.save();
  ctx.translate(d.x, d.y);
  if (d.sens !== "h") ctx.rotate(Math.PI / 2);
  // Repère : l'arête court de (0,0) à (1,0).
  const genre = d.genre === "secrete" ? "porte" : d.genre;
  if (genre === "fenetre") {
    ctx.fillStyle = "#5e3b1f";
    ctx.fillRect(0.16, -e * 0.32, 0.68, e * 0.64);
    ctx.fillStyle = "#24364a";
    ctx.fillRect(0.2, -e * 0.2, 0.6, e * 0.4);
    ctx.fillStyle = "rgba(255,206,130,.35)";
    ctx.fillRect(0.2, -e * 0.2, 0.6, e * 0.14);
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(0.49, -e * 0.2, 0.02, e * 0.4);
  } else {
    // Seuil de pierre.
    ctx.fillStyle = "#8e877b";
    ctx.fillRect(0.02, -e / 2, 0.96, e);
    ctx.strokeStyle = "rgba(30,24,18,.6)";
    ctx.lineWidth = 0.02;
    ctx.strokeRect(0.02, -e / 2, 0.96, e);
    if (genre === "arche") {
      // Passage ouvert : deux piédroits de pierre.
      for (const x of [0, 0.88]) {
        ctx.fillStyle = "#77706a";
        ctx.fillRect(x, -e / 2 - 0.03, 0.12, e + 0.06);
        ctx.strokeStyle = "rgba(24,16,8,.8)";
        ctx.strokeRect(x, -e / 2 - 0.03, 0.12, e + 0.06);
      }
    } else if (genre === "grille") {
      ctx.fillStyle = "#2c2e31";
      ctx.fillRect(0.08, -0.03, 0.84, 0.06);
      for (let k = 0; k < 6; k++) {
        rond(ctx, 0.12 + k * 0.152, 0, 0.045);
        ctx.fillStyle = "#3a3c3e";
        ctx.fill();
        rond(ctx, 0.11 + k * 0.152, -0.012, 0.015);
        ctx.fillStyle = "rgba(220,220,210,.5)";
        ctx.fill();
      }
    } else {
      const battants = genre === "double" ? [[0.06, 0.44, 1], [0.94, 0.44, -1]] : [[0.08, 0.84, 1]];
      for (const [pivot, l, s] of battants) {
        ctx.save();
        ctx.translate(pivot, 0);
        if (d.etat === "ouverte") ctx.rotate((s * Math.PI) / 2);
        const x0 = s > 0 ? 0 : -l;
        ctx.fillStyle = "#94643a";
        ctx.fillRect(x0, -0.08, l, 0.16);
        ctx.strokeStyle = "rgba(40,22,8,.7)";
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        for (let k = 1; k < 4; k++) {
          ctx.moveTo(x0 + (l * k) / 4, -0.08);
          ctx.lineTo(x0 + (l * k) / 4, 0.08);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(34,20,10,.85)";
        ctx.lineWidth = 0.022;
        ctx.strokeRect(x0, -0.08, l, 0.16);
        ctx.fillStyle = "#2f2f2c";
        ctx.fillRect(x0 + (s > 0 ? 0.03 : l - 0.17), -0.085, 0.14, 0.04);
        ctx.fillRect(x0 + (s > 0 ? 0.03 : l - 0.17), 0.045, 0.14, 0.04);
        ctx.restore();
      }
    }
    if (mj && d.etat === "verrouillee") {
      // Vue du MJ : un cadenas rouge.
      ctx.fillStyle = "#b3261e";
      ctx.fillRect(0.42, 0.2, 0.16, 0.12);
      ctx.strokeStyle = "#b3261e";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(0.5, 0.2, 0.05, Math.PI, 0);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Coins arrondis entre sols naturels voisins (herbe, terre, sable, eau, roche) : la case cède un quart de disque au sol
// qui l'entoure sur deux côtés.
function arrondirCoins(ctx, etat, x0, y0, x1, y1, S, hautes, p) {
  const { v } = etat;
  const { w, h } = v;
  // La clé d'un sol naturel, suivie de la teinte de sa pièce s'il en a une.
  const cle = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const i = y * w + x;
    if (!v.sol[i] || v.genre[i] === "salle") return null;
    const s = SOLS[v.sol[i]];
    if (!s || !NATURELS.has(s.cle)) return null;
    const t = etat.teintes && etat.teintes.get(p.piece[i]);
    return t ? `${s.cle}${t}` : s.cle;
  };
  const r = 0.42;
  const parSol = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = cle(x, y);
      if (!a) continue;
      for (const [dx, dy] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
        const b = cle(x + dx, y);
        if (!b || b === a || cle(x, y + dy) !== b || cle(x + dx, y + dy) !== b) continue;
        const i = y * w + x;
        if (bloque(v, i, i + dx, dx > 0 ? 2 : 8) || bloque(v, i, i + dy * w, dy > 0 ? 4 : 1)) continue;
        const cx = x + (dx > 0 ? 1 : 0);
        const cy = y + (dy > 0 ? 1 : 0);
        if (!parSol.has(b)) parSol.set(b, new Path2D());
        const chemin = parSol.get(b);
        // Coin (cx, cy), centre du quart de disque à (cx - dx r, cy - dy r).
        const ox = cx - dx * r;
        const oy = cy - dy * r;
        const a1 = dx > 0 ? 0 : Math.PI;
        const a2 = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
        let delta = a2 - a1;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta <= -Math.PI) delta += 2 * Math.PI;
        chemin.moveTo(cx, cy);
        chemin.lineTo(cx, oy);
        chemin.arc(ox, oy, r, a1, a2, delta < 0);
        chemin.closePath();
      }
    }
  }
  for (const [b, chemin] of parSol) {
    const k = b.indexOf("#");
    ctx.fillStyle = k < 0 ? motif(ctx, b, S, hautes) : motif(ctx, b.slice(0, k), S, hautes, b.slice(k));
    ctx.fill(chemin);
  }
}

// Le bord de l'eau : un peu de vase contre la rive, l'eau plus sombre au large.
function rivesEau(ctx, etat, x0, y0, x1, y1) {
  const { v } = etat;
  const { w, h } = v;
  const eau = (x, y) => x >= 0 && y >= 0 && x < w && y < h && v.sol[y * w + x] && /^eau/.test(SOLS[v.sol[y * w + x]]?.cle || "");
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!eau(x, y)) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || eau(nx, ny) || !v.sol[ny * w + nx]) continue;
        const ax = dx > 0 ? x + 1 : dx < 0 ? x : x + 0.5;
        const ay = dy > 0 ? y + 1 : dy < 0 ? y : y + 0.5;
        const g = ctx.createLinearGradient(ax, ay, ax - dx * 0.35, ay - dy * 0.35);
        g.addColorStop(0, "rgba(62,58,40,.55)");
        g.addColorStop(0.35, "rgba(40,60,58,.25)");
        g.addColorStop(1, "rgba(40,60,58,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function ornieres(ctx, p, etat, o) {
  // Deux ornières le long de la pièce (la route), et quelques flaques, sans sortir de ses cases.
  const { v } = etat;
  const { w, h } = v;
  const id = typeof o.piece === "number" ? o.piece : p.piece[Math.floor(o.cy) * w + Math.floor(o.cx)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const cases = new Path2D();
  for (let i = 0; i < w * h; i++) {
    if (!v.sol[i] || p.piece[i] !== id) continue;
    const x = i % w;
    const y = (i - x) / w;
    cases.rect(x, y, 1, 1);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  if (x0 === Infinity) return;
  const long = x1 - x0 >= y1 - y0;
  ctx.save();
  ctx.clip(cases);
  ctx.lineCap = "round";
  for (const t of [0.38, 0.62]) {
    ctx.beginPath();
    if (long) {
      const y = y0 + (y1 - y0) * t;
      ctx.moveTo(x0, y);
      for (let x = x0; x <= x1; x += 0.5) ctx.lineTo(x, y + Math.sin(x * 0.7 + t * 9) * 0.05);
    } else {
      const x = x0 + (x1 - x0) * t;
      ctx.moveTo(x, y0);
      for (let y = y0; y <= y1; y += 0.5) ctx.lineTo(x + Math.sin(y * 0.7 + t * 9) * 0.05, y);
    }
    ctx.strokeStyle = "rgba(50,34,20,.35)";
    ctx.lineWidth = 0.2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(200,170,120,.18)";
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }
  const n = Math.max(2, Math.round((long ? x1 - x0 : y1 - y0) / 5));
  for (let k = 0; k < n; k++) {
    const u = (long ? x0 : y0) + 1 + hache(k, id, 71) * ((long ? x1 - x0 : y1 - y0) - 2);
    const t = hache(k, id, 73) < 0.5 ? 0.38 : 0.62;
    const [x, y] = long ? [u, y0 + (y1 - y0) * t] : [x0 + (x1 - x0) * t, u];
    ctx.beginPath();
    ctx.ellipse(x, y, long ? 0.35 + 0.3 * hache(k, id, 75) : 0.13, long ? 0.13 : 0.35 + 0.3 * hache(k, id, 75), 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(46,60,72,.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(160,190,210,.25)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
  }
  ctx.restore();
}

// o : joueurs, mj, quadrillage, image (fond importé chargé), centres (noms des pièces déjà placés), etat, hautes.
export function dessinerPlanPeint(ctx, p, murs, z, o = {}) {
  const joueurs = !!o.joueurs;
  // Rien hors du plan : une tuile du bord laisse voir le fond de la vue, comme le fond d'ensemble.
  const zone = { x0: Math.max(0, z.x0), y0: Math.max(0, z.y0), x1: Math.min(p.largeur, z.x1), y1: Math.min(p.hauteur, z.y1) };
  if (zone.x1 <= zone.x0 || zone.y1 <= zone.y0) return;
  // L'état vient de la vue, qui le tient à jour ; sinon (vignette, appel isolé) il se calcule ici.
  const etat = o.etat || preparerPeint(p, murs, { joueurs });
  const { v } = etat;
  const { w, h } = v;
  const S = Math.abs(ctx.getTransform().a) || 1;
  const hautes = o.hautes !== false;
  const x0 = Math.max(0, Math.floor(zone.x0) - 1);
  const y0 = Math.max(0, Math.floor(zone.y0) - 1);
  const x1 = Math.min(w, Math.ceil(zone.x1) + 1);
  const y1 = Math.min(h, Math.ceil(zone.y1) + 1);
  const dansZone = (b, m = 0.6) => b.x1 > zone.x0 - m && b.x0 < zone.x1 + m && b.y1 > zone.y0 - m && b.y0 < zone.y1 + m;
  const structure = etat.structure;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;

  // Le vide : l'herbe sombre autour d'une bâtisse qui a des abords, la roche sous terre ou à l'étage.
  if (structure) {
    ctx.fillStyle = motif(ctx, etat.exterieur ? "herbe" : "roche", S, hautes);
    ctx.fillRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
    ctx.fillStyle = etat.exterieur ? "rgba(14,18,22,.45)" : "rgba(10,8,6,.66)";
    ctx.fillRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
  } else {
    ctx.fillStyle = BRUME;
    ctx.fillRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
  }
  if (p.fond && o.image) {
    ctx.save();
    ctx.globalAlpha = nombre(p.fond.opacite, 1);
    ctx.drawImage(o.image, p.fond.x || 0, p.fond.y || 0, p.fond.l || w, p.fond.h || h);
    ctx.restore();
  }

  // Les sols, un motif par matière (et par teinte, quand une pièce en a une), puis les coins arrondis et les rives.
  if (structure) {
    const parSol = new Map();
    const teintes = etat.teintes;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const s = v.sol[y * w + x];
        if (!s) continue;
        const t = teintes && teintes.get(p.piece[y * w + x]);
        const cle = t ? `${s}${t}` : s;
        if (!parSol.has(cle)) parSol.set(cle, new Path2D());
        parSol.get(cle).rect(x, y, 1, 1);
      }
    }
    for (const [cle, chemin] of parSol) {
      const [s, t] = typeof cle === "number" ? [cle, null] : [+cle.slice(0, cle.indexOf("#")), cle.slice(cle.indexOf("#"))];
      ctx.fillStyle = motif(ctx, SOLS[s] ? SOLS[s].cle : "terre", S, hautes, t);
      ctx.fill(chemin);
    }
    rivesEau(ctx, etat, x0, y0, x1, y1);
    arrondirCoins(ctx, etat, x0, y0, x1, y1, S, hautes, p);
    reliefFalaises(ctx, v, x0, y0, x1, y1);
  }

  // Ce qui traîne au sol : paille, ornières, flaques.
  for (const ob of etat.hab.objets) {
    if (!AU_SOL.has(ob.cle)) continue;
    if (ob.cle === "ornieres") ornieres(ctx, p, etat, ob);
    else if (dansZone({ x0: ob.x - 0.7, y0: ob.y - 0.7, x1: ob.x + 0.7, y1: ob.y + 0.7 })) dessinerObjetPeint(ctx, ob.cle, ob.x, ob.y, ob.rot, ob.cache ? 0.6 : 1);
  }

  // Le sang, à même le sol (sang.js).
  dessinerSangPlan(ctx, p, sangVu(p, etat.joueurs), { x0, y0, x1, y1 });

  // Le quadrillage, fin à toutes les échelles.
  if (o.quadrillage === undefined ? p.quadrillage : o.quadrillage) {
    ctx.strokeStyle = structure ? "rgba(20,12,6,.24)" : "rgba(255,248,230,.22)";
    ctx.lineWidth = Math.max(0.012, 1.1 / S);
    ctx.beginPath();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (!(structure ? v.sol[i] : v.vu[i])) continue;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1, y);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 1);
        if (x === w - 1 || !(structure ? v.sol[i + 1] : v.vu[i + 1])) {
          ctx.moveTo(x + 1, y);
          ctx.lineTo(x + 1, y + 1);
        }
        if (y === h - 1 || !(structure ? v.sol[i + w] : v.vu[i + w])) {
          ctx.moveTo(x, y + 1);
          ctx.lineTo(x + 1, y + 1);
        }
      }
    }
    ctx.stroke();
  }

  // Le brouillard des joueurs, d'une seule couleur, sous les murs : ceux d'une pièce révélée restent nets.
  if (joueurs && p.brouillard_actif) {
    ctx.fillStyle = BRUME;
    for (let y = y0; y < y1; y++) {
      let debut = -1;
      for (let x = x0; x <= x1; x++) {
        const cache = x < x1 && !v.vu[y * w + x];
        if (cache && debut < 0) debut = x;
        if (!cache && debut >= 0) {
          ctx.fillRect(debut, y, x - debut, 1);
          debut = -1;
        }
      }
    }
    // Bord adouci là où la brume touche un sol révélé sans mur entre les deux.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (!v.vu[i] || !v.sol[i]) continue;
        for (const [dx, dy, bit] of COTES) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || v.vu[ny * w + nx] || (v.murs[i] | (v.murs[i] >> 4)) & bit) continue;
          const g = ctx.createLinearGradient(x + (dx > 0 ? 1 : dx < 0 ? 0 : 0.5), y + (dy > 0 ? 1 : dy < 0 ? 0 : 0.5), x + (dx > 0 ? 0.6 : dx < 0 ? 0.4 : 0.5), y + (dy > 0 ? 0.6 : dy < 0 ? 0.4 : 0.5));
          g.addColorStop(0, "rgba(15,12,10,.95)");
          g.addColorStop(1, "rgba(15,12,10,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // Les ombres portées, d'un coup, sous les murs et le mobilier.
  if (structure && etat.ombre) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(etat.ombre, 0, 0, w, h);
  }
  if (structure) dessinerMursPeints(ctx, etat, zone, S, hautes);
  for (const d of etat.portes.values()) {
    if (d.x < zone.x0 - 1.5 || d.x > zone.x1 + 1.5 || d.y < zone.y0 - 1.5 || d.y > zone.y1 + 1.5) continue;
    if (d.genre === "secrete" && !d.decouverte && joueurs) continue;
    dessinerPortePeinte(ctx, d, etat, !joueurs);
  }

  // Les images du MJ posées sous les pions, avant le mobilier ; la lumière de la pièce les éclaire comme lui.
  dessinerImagesPlan(ctx, p, zone, o.imagesPlan, { joueurs });
  // Le mobilier, puis les objets d'ambiance.
  for (const m of etat.meubles) if (dansZone(m.b)) dessinerMeublePeint(ctx, m.o, { cache: m.cache });
  for (const ob of etat.hab.objets) {
    if (AU_SOL.has(ob.cle) || PAR_DESSUS.has(ob.cle)) continue;
    if (dansZone({ x0: ob.x - 0.7, y0: ob.y - 0.7, x1: ob.x + 0.7, y1: ob.y + 0.7 })) dessinerObjetPeint(ctx, ob.cle, ob.x, ob.y, ob.rot, ob.cache ? 0.6 : 1);
  }

  // La lumière : l'ambiance et les flaques de lumière (multipliées), puis la lueur des flammes (ajoutée).
  if (structure && etat.lumiere) {
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(etat.lumiere, 0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(etat.lueur, 0, 0, w, h);
    ctx.restore();
  }
  for (const ob of etat.hab.objets) {
    if (!PAR_DESSUS.has(ob.cle)) continue;
    if (dansZone({ x0: ob.x - 1, y0: ob.y - 1, x1: ob.x + 1, y1: ob.y + 1 })) dessinerObjetPeint(ctx, ob.cle, ob.x, ob.y, ob.rot, ob.cache ? 0.6 : 1);
  }

  // Les textes posés sur le plan, la légende de l'habillage et les noms des pièces.
  const loin = (x, y, m) => x < zone.x0 - m || x > zone.x1 + m || y < zone.y0 - m || y > zone.y1 + m;
  for (const t of p.textes || []) {
    if (joueurs && (t.mj || !reveleA(p, t.x, t.y))) continue;
    if (loin(t.x, t.y, 8 * (t.taille || 0.6))) continue;
    ecrireDoux(ctx, t.texte, t.x, t.y, {
      taille: t.taille || 0.6, police: "600 {t}px Cinzel", couleur: t.mj ? "#e0584c" : "rgba(246,236,214,.96)", halo: "rgba(14,9,5,{a})", espacement: 0.08,
    });
  }
  const legendees = new Set();
  for (const l of etat.hab.legende) {
    if (l.piece !== undefined) legendees.add(l.piece);
    if (loin(l.x, l.y, 6)) continue;
    ecrireDoux(ctx, l.texte, l.x, l.y, { taille: 0.48, police: "italic 600 {t}px 'EB Garamond'", couleur: "rgba(250,238,212,.96)", halo: "rgba(14,9,5,{a})", espacement: 0.02 });
  }
  if (o.mj || joueurs) {
    for (const pc of p.pieces || []) {
      const centre = o.centres && o.centres.get(pc.id);
      if (!pc.nom || !centre || legendees.has(pc.id)) continue;
      if (joueurs && (!pc.nom_visible || !reveleA(p, centre[0], centre[1]))) continue;
      if (loin(centre[0], centre[1], 6)) continue;
      ecrireDoux(ctx, pc.nom, centre[0], centre[1], { taille: 0.44, police: "italic 600 {t}px 'EB Garamond'", couleur: "rgba(250,238,212,.95)", halo: "rgba(14,9,5,{a})", espacement: 0.02 });
    }
  }
  ctx.restore();
}

