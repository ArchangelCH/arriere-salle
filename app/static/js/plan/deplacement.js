// Bouger son pion : jusqu'où un héros peut aller sur le plan que montre la TV. Le parcours se calcule sur
// la seule projection publique du plan (celle que reçoivent la TV et le coin des joueurs) : 8 voisins sans couper les
// coins, un mur franchi seulement par une porte ou une grille ouverte, ou un passage ; une fenêtre ne se franchit pas ; un
// meuble qui barre le passage bloque, sauf sous un pont (« passage ») ; l'eau profonde et la falaise aussi, sauf sous un
// pont ; on traverse un héros, jamais un adversaire
// debout ; seules les cases révélées comptent. Une image posée par le MJ (lot H2, clé « image ») barre le passage, sauf
// s'il l'a dite franchissable ; un cavalier en selle ne bouge pas seul.
// Si le MJ le permet (« entrer », lot E4), le héros tente aussi sa chance : il ouvre une porte fermée en la franchissant
// (parmi les plus courts chemins, celui qui en ouvre le moins), et vise en dernier pas une case encore cachée voisine
// d'une case atteinte (en ligne droite), « dans le noir », par une porte ou là où la projection ne montre pas de mur. Une
// porte verrouillée (dite fermée par la projection) et une porte secrète que les joueurs n'ont pas trouvée (absente de
// la projection) ne se voient pas d'ici : l'atelier refait le même parcours avec les vraies portes et décide.
//
// Jumeau de app/commun/deplacement.py : les cas communs (tests/deplacement-cas.json) passent à l'identique des deux côtés
// (outils/verifier_deplacement.mjs). Fonctions sans page : le coin (joueurs/bouger.js) s'en sert pour montrer les cases
// atteignables et prévalider ; l'atelier revérifie toujours.

import { MEUBLES, SOLS_INFRANCHISSABLES } from "./modele.js";

export const GENRE = "deplacement";
const COTE_MAX = 400;
const PORTES_QUI_S_OUVRENT = ["porte", "double", "grille"];
const PASSAGES = ["arche"];
// Ce qu'une porte fait d'un héros : elle le laisse passer, il l'ouvre en passant (« entrer »), ou elle l'arrête.
export const OUVERTE = "ouverte";
export const A_OUVRIR = "a-ouvrir";
export const BLOQUE = "bloque";
const BITS = { "0,-1": 1, "1,0": 2, "0,1": 4, "-1,0": 8 };
const VOISINS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

// Les phrases d'un refus, les mêmes que le serveur.
export const REFUS = {
  figes: "Votre MJ a figé les pions : demandez-lui de vive voix.",
  pasTonTour: "Ce n'est pas votre tour.",
  pasSurLePlan: "Votre héros n'est pas sur le plan que montre la TV.",
  tropGrand: "Votre pion est trop grand pour bouger d'ici : demandez à votre MJ.",
  enSelle: "Votre héros est en selle : demandez à votre MJ de déplacer sa monture.",
  aBouge: "Votre pion a bougé entre-temps : la page se relit.",
  dejaLa: "Votre pion y est déjà.",
  horsDuPlan: "Cette case est hors du plan.",
  pasRevelee: "Cette case n'est pas encore révélée.",
  pasDeSol: "Il n'y a pas de sol à cet endroit.",
  meuble: "Un meuble occupe cette case.",
  infranchissable: "On n'avance pas là : eau profonde ou falaise.",
  prise: "Cette case est déjà prise.",
  sansPassage: "Aucun passage jusque-là : un mur, une porte fermée ou un adversaire barre la route.",
  sansPassageEntrer: "Aucun passage jusque-là : un mur ou un adversaire barre la route.",
  noir: "Cette case est dans le noir : on n'y avance que d'un pas depuis une case voisine, et jamais à travers un mur.",
};

export function tropLoin(limite, combat) {
  const s = limite > 1 ? "s" : "";
  return combat
    ? `Trop loin pour ce tour : ${limite} case${s} au plus depuis votre place au début du tour.`
    : `Trop loin : ${limite} case${s} au plus d'un coup.`;
}

const entier = (v) => Number.isInteger(v);
// L'eau profonde, la falaise : un nombre de la liste (deplacement.py, sol_infranchissable).
export const solInfranchissable = (v) => typeof v === "number" && SOLS_INFRANCHISSABLES.has(v);
const nombre = (v, defaut = 0) => (typeof v === "number" && v === v ? v : defaut);

// Les cases sous un pion (plan/entrer.js, casesSous), à l'identique du serveur.
export function casesSous(t) {
  const n = Math.max(1, Math.round(nombre(t.taille, 1)));
  const x0 = Math.round(nombre(t.x) - n / 2);
  const y0 = Math.round(nombre(t.y) - n / 2);
  const res = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) res.push([x, y]);
  return res;
}

export const caseDuPion = (t) => casesSous({ ...t, taille: 1 })[0];
export const tailleDuPion = (t) => Math.max(1, Math.round(nombre(t.taille, 1)));

// OUVERTE, A_OUVRIR ou BLOQUE. Une porte secrète découverte est une porte comme une autre ; non découverte, elle bloque
// comme un mur (jamais dans la projection). Une porte verrouillée bloque ; un état inconnu compte pour fermé.
export function etatPorte(d) {
  let genre = d.genre;
  if (genre === "secrete") {
    if (!d.decouverte) return BLOQUE;
    genre = "porte";
  }
  if (PASSAGES.includes(genre)) return OUVERTE;
  if (!PORTES_QUI_S_OUVRENT.includes(genre)) return BLOQUE;
  return d.etat === "ouverte" ? OUVERTE : d.etat === "verrouillee" ? BLOQUE : A_OUVRIR;
}

// Ce que le parcours lit du plan public, une fois pour toutes.
export class Grille {
  constructor(plan, pion) {
    this.w = Math.trunc(nombre(plan.largeur));
    this.h = Math.trunc(nombre(plan.hauteur));
    if (!(this.w > 0 && this.w <= COTE_MAX && this.h > 0 && this.h <= COTE_MAX)) {
      this.valide = false;
      return;
    }
    this.valide = true;
    const n = this.w * this.h;
    const liste = (cle) => {
      const v = Array.isArray(plan[cle]) ? plan[cle].slice(0, n) : [];
      while (v.length < n) v.push(0);
      return v;
    };
    this.sol = liste("sol");
    this.murs = liste("murs").map((m) => (entier(m) ? m : 0));
    const actif = plan.brouillard_actif !== false;
    this.vu = actif ? liste("brouillard").map((v) => (v === 1 ? 1 : 0)) : new Array(n).fill(1);
    this.portes = new Map();
    for (const d of plan.portes || []) {
      if (!d || typeof d !== "object" || !["v", "h"].includes(d.sens) || !entier(d.x) || !entier(d.y)) continue;
      const cle = `${d.sens}:${d.x}:${d.y}`;
      if (!this.portes.has(cle)) this.portes.set(cle, d);
    }
    this.meubles = new Set();
    for (const o of plan.objets || []) {
      if (!o || typeof o !== "object") continue;
      // Un meuble « franchissable » se traverse (tapis, trappe…) ; tout autre barre le passage, même inconnu. Une image
      // du MJ se traverse seulement s'il l'a dit.
      if (o.cle === "image" ? o.franchissable === true : MEUBLES[o.cle]?.franchissable) continue;
      const tourne = nombre(o.rot) % 180 !== 0;
      const l = tourne ? nombre(o.h, 1) : nombre(o.l, 1);
      const hh = tourne ? nombre(o.l, 1) : nombre(o.h, 1);
      const x0 = nombre(o.x);
      const y0 = nombre(o.y);
      for (let y = Math.floor(y0); y < Math.ceil(y0 + hh); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + l); x++) this.meubles.add(`${x},${y}`);
    }
    // Un pont, un ponton, une barque (« passage ») : on y marche, même par-dessus la rivière qu'il enjambe ou l'eau profonde.
    this.dessus = new Set();
    for (const o of plan.objets || []) {
      if (!o || typeof o !== "object" || !MEUBLES[o.cle]?.passage) continue;
      const tourne = nombre(o.rot) % 180 !== 0;
      const l = tourne ? nombre(o.h, 1) : nombre(o.l, 1);
      const hh = tourne ? nombre(o.l, 1) : nombre(o.h, 1);
      const x0 = nombre(o.x);
      const y0 = nombre(o.y);
      for (let y = Math.floor(y0); y < Math.ceil(y0 + hh); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x0 + l); x++) {
          this.meubles.delete(`${x},${y}`);
          this.dessus.add(`${x},${y}`);
        }
      }
    }
    this.ennemis = new Set();
    this.prises = new Set();
    this.moi = null;
    for (const t of plan.pions || []) {
      if (!t || typeof t !== "object" || !("x" in t) || !("y" in t)) continue;
      if (pion != null && t.id === pion) {
        this.moi = t;
        continue;
      }
      if (t.tombe) continue;
      for (const [x, y] of casesSous(t)) {
        this.prises.add(`${x},${y}`);
        if (t.genre === "ennemi") this.ennemis.add(`${x},${y}`);
      }
    }
  }

  dedans(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  i(x, y) {
    return y * this.w + x;
  }

  revelee(x, y) {
    return this.dedans(x, y) && this.vu[this.i(x, y)] === 1;
  }

  praticable(x, y) {
    const k = `${x},${y}`;
    const sol = this.revelee(x, y) ? this.sol[this.i(x, y)] : 0;
    return !!sol && (!solInfranchissable(sol) || this.dessus.has(k)) && !this.meubles.has(k) && !this.ennemis.has(k);
  }

  porte(x, y, dx, dy) {
    if (dx) return this.portes.get(`v:${dx > 0 ? x + 1 : x}:${y}`) || null;
    return this.portes.get(`h:${x}:${dy > 0 ? y + 1 : y}`) || null;
  }

  static ouverte(d) {
    return etatPorte(d) === OUVERTE;
  }

  mur(x, y, dx, dy) {
    const bit = BITS[`${dx},${dy}`];
    const oppose = BITS[`${-dx},${-dy}`];
    const m = this.dedans(x, y) ? this.murs[this.i(x, y)] : 0;
    const n = this.dedans(x + dx, y + dy) ? this.murs[this.i(x + dx, y + dy)] : 0;
    return !!(m & (bit | (bit << 4))) || !!(n & (oppose | (oppose << 4)));
  }

  // L'arête se franchit-elle sans rien ouvrir ?
  arete(x, y, dx, dy) {
    return this.passage(x, y, dx, dy, false) === 0;
  }

  // L'arête orthogonale vers (dx, dy) : 0, librement ; 1, en ouvrant une porte fermée (seulement si entrer) ; null, elle
  // arrête le héros.
  passage(x, y, dx, dy, entrer) {
    const d = this.porte(x, y, dx, dy);
    if (!d) return this.mur(x, y, dx, dy) ? null : 0;
    const e = etatPorte(d);
    if (e === OUVERTE) return 0;
    return e === A_OUVRIR && entrer ? 1 : null;
  }
}

// Map "x,y" → { d, entree, portes, de } des cases atteignables depuis depart ([x, y], comprise, à 0, de null). entree : case
// encore cachée, en dernier pas ; portes : celles à ouvrir en chemin, le moins possible parmi les plus courts chemins ; de :
// la case d'où l'on y vient ("x,y"). limite : rien au-delà (null : tout le plan). Les cases prises par un autre pion y sont
// (on traverse un héros) : verifierDeplacement les refuse. Couche par couche, comme le serveur : à égalité, la première
// trouvée garde sa place.
export function atteignables(plan, { pion = null, depart, entrer = false, limite = null, grille = null }) {
  const g = grille || new Grille(plan, pion);
  const vus = new Map();
  if (!g.valide) return vus;
  vus.set(`${depart[0]},${depart[1]}`, { d: 0, entree: false, portes: 0, de: null });
  const file = [depart];
  for (let k = 0; k < file.length; k++) {
    const [x, y] = file[k];
    const ici = `${x},${y}`;
    const { d, portes: n } = vus.get(ici);
    if (limite !== null && d >= limite) continue;
    for (const [dx, dy] of VOISINS) {
      const nx = x + dx;
      const ny = y + dy;
      const cle = `${nx},${ny}`;
      const deja = vus.get(cle);
      // Déjà vue plus près, ou à la même distance sans qu'on puisse ouvrir moins de portes : rien à faire.
      if ((deja && (deja.d <= d || n >= deja.portes)) || !g.dedans(nx, ny)) continue;
      let cout;
      let entree = false;
      if (dx && dy) {
        if (!(g.praticable(nx, ny) && g.praticable(nx, y) && g.praticable(x, ny)
          && g.arete(x, y, dx, 0) && g.arete(nx, y, 0, dy) && g.arete(x, y, 0, dy) && g.arete(x, ny, dx, 0))) continue;
        cout = 0;
      } else if (g.praticable(nx, ny)) {
        cout = g.passage(x, y, dx, dy, entrer);
      } else if (entrer && !g.revelee(nx, ny) && !g.prises.has(cle)) {
        cout = g.passage(x, y, dx, dy, entrer);
        entree = true;
      } else continue;
      if (cout === null) continue;
      if (!deja) {
        vus.set(cle, { d: d + 1, entree, portes: n + cout, de: ici });
        if (!entree) file.push([nx, ny]);
      } else if (deja.d === d + 1 && n + cout < deja.portes) {
        vus.set(cle, { d: d + 1, entree, portes: n + cout, de: ici });
      }
    }
  }
  return vus;
}

// Les cases du chemin retenu jusqu'à vers ([x, y]), départ compris, et les portes à ouvrir le long de lui.
export function chemin(vus, vers) {
  const res = [`${vers[0]},${vers[1]}`];
  while (vus.get(res[res.length - 1])?.de) res.push(vus.get(res[res.length - 1]).de);
  return res.reverse().map((c) => c.split(",").map(Number));
}

export function portesDuChemin(g, cases) {
  const res = [];
  for (let k = 1; k < cases.length; k++) {
    const [x, y] = cases[k - 1];
    const dx = cases[k][0] - x;
    const dy = cases[k][1] - y;
    if (dx && dy) continue;
    const d = g.porte(x, y, dx, dy);
    if (d && etatPorte(d) === A_OUVRIR) res.push(d);
  }
  return res;
}

// La case de départ du compte : en combat, celle du début du tour (si elle est sur le plan), sinon celle du pion.
function departDuCompte(g, ici, tour) {
  const debut = tour?.combat === true ? tour.debut : null;
  return Array.isArray(debut) && debut.length === 2 && debut.every(entier) && g.dedans(debut[0], debut[1]) ? [debut[0], debut[1]] : ici;
}

// Le déplacement demandé ({ pion, depuis, vers }) passe-t-il sur ce plan public ? { ok: true, distance, entree, depart,
// limite, portes, chemin } (portes : celles à ouvrir en chemin ; chemin : ses cases) ou { ok: false, refus } (la phrase à
// montrer, la même que le serveur).
export function verifierDeplacement(plan, corps, regles = {}, tour = {}) {
  const non = (refus) => ({ ok: false, refus });
  if (regles.pions === "figes") return non(REFUS.figes);
  const combat = tour.combat === true;
  if (combat && tour.mon_tour !== true) return non(REFUS.pasTonTour);
  const g = new Grille(plan, corps.pion);
  if (!g.valide || !g.moi) return non(REFUS.pasSurLePlan);
  if (tailleDuPion(g.moi) > 1) return non(REFUS.tropGrand);
  if (typeof g.moi.monture === "string") return non(REFUS.enSelle);
  const ici = caseDuPion(g.moi);
  const depuis = corps.depuis || [];
  if (depuis[0] !== ici[0] || depuis[1] !== ici[1]) return non(REFUS.aBouge);
  const [vx, vy] = corps.vers;
  if (vx === ici[0] && vy === ici[1]) return non(REFUS.dejaLa);
  if (!g.dedans(vx, vy)) return non(REFUS.horsDuPlan);
  if (g.prises.has(`${vx},${vy}`)) return non(REFUS.prise);
  const depart = departDuCompte(g, ici, tour);
  let limite = regles[combat ? "distance_combat" : "distance"];
  limite = entier(limite) && limite > 0 ? limite : 1;
  const entrer = regles.entrer === true;
  const vus = atteignables(plan, { pion: corps.pion, depart, entrer, grille: g });
  const v = vus.get(`${vx},${vy}`);
  if (!v) {
    if (!g.revelee(vx, vy)) return non(entrer ? REFUS.noir : REFUS.pasRevelee);
    if (!g.sol[g.i(vx, vy)]) return non(REFUS.pasDeSol);
    if (g.meubles.has(`${vx},${vy}`)) return non(REFUS.meuble);
    if (solInfranchissable(g.sol[g.i(vx, vy)]) && !g.dessus.has(`${vx},${vy}`)) return non(REFUS.infranchissable);
    return non(entrer ? REFUS.sansPassageEntrer : REFUS.sansPassage);
  }
  if (v.d > limite) return non(tropLoin(limite, combat));
  const cases = chemin(vus, [vx, vy]);
  return { ok: true, distance: v.d, entree: v.entree, depart, limite, portes: portesDuChemin(g, cases), chemin: cases };
}

// Les cases où le pion peut aller maintenant, pour les montrer : Map "x,y" → { d, entree, portes, de }, sans sa propre case
// ni les cases prises. Une case qui demande d'ouvrir une porte (portes) ou d'avancer dans le noir (entree) est une
// tentative : l'atelier peut encore la refuser (une porte verrouillée, un mur). Vide si le pion ne peut pas bouger (pions figés, pas son tour, pion absent ou trop grand).
export function casesAtteignables(plan, pion, regles = {}, tour = {}) {
  const res = new Map();
  if (regles.pions === "figes" || (tour.combat === true && tour.mon_tour !== true)) return res;
  const g = new Grille(plan, pion);
  if (!g.valide || !g.moi || tailleDuPion(g.moi) > 1 || typeof g.moi.monture === "string") return res;
  const ici = caseDuPion(g.moi);
  const combat = tour.combat === true;
  let limite = regles[combat ? "distance_combat" : "distance"];
  limite = entier(limite) && limite > 0 ? limite : 1;
  const vus = atteignables(plan, { pion, depart: departDuCompte(g, ici, tour), entrer: regles.entrer === true, limite, grille: g });
  for (const [cle, v] of vus) {
    if (cle === `${ici[0]},${ici[1]}` || g.prises.has(cle)) continue;
    res.set(cle, v);
  }
  return res;
}
