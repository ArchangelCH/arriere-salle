// Vérifie « Entrer révèle la pièce » (outils Pions et Sélection) sans navigateur : un héros visible posé sur une case cachée révèle
// sa pièce entière et rien d'autre, seulement s'il a changé de case (un clic qui tremble n'entre nulle part) ; un pion caché (Vortan au fond de l'étang), un PNJ, un adversaire ou un pion « autre »
// ne révèlent jamais rien, ni seuls ni emmenés avec la tablée ; sans brouillard, rien ne change. Le cadrage élargi de la
// TV couvre à la fois son cadre d'avant et la pièce. On rejoue les générateurs sur des graines, puis les vrais plans du
// dossier de données s'il est là (lus, jamais écrits) : Vortan posé sur chaque case de l'étang n'y change pas une case.
// Usage : node outils/verifier_entrer.mjs [nombre de graines, 100 par défaut] [dossier des plans, data/plans par défaut]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { MODELES, generer } from "../app/static/js/plan/generateurs.js";
import { cadreTv, cameraElargie, cameraSur, changeDeCase, entrer } from "../app/static/js/plan/entrer.js";
import { boitePiece, boiteRevelee } from "../app/static/js/plan/modele.js";

const N = +(process.argv[2] || 100);
const DOSSIER = process.argv[3] || new URL("../data/plans/", import.meta.url).pathname;
const defauts = [];
let essais = 0;
const verifier = (ok, texte) => {
  essais += 1;
  if (ok) return;
  if (defauts.length < 30) defauts.push(texte);
  else if (defauts.length === 30) defauts.push("…");
};

const copie = (p) => ({ ...p, brouillard: [...p.brouillard] });
const memes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const pion = (x, y, champs = {}) => ({ id: "essai", genre: "heros", cache: false, taille: 1, x: x + 0.5, y: y + 0.5, ...champs });
const contient = (a, b) => b.x0 >= a.x0 - 1e-6 && b.y0 >= a.y0 - 1e-6 && b.x1 <= a.x1 + 1e-6 && b.y1 <= a.y1 + 1e-6;

// Les cases d'une pièce, et une case de sol cachée par pièce (la première rencontrée).
function cases(p) {
  const parPiece = new Map();
  for (let i = 0; i < p.sol.length; i++) {
    if (!p.sol[i] || !p.piece[i]) continue;
    if (!parPiece.has(p.piece[i])) parPiece.set(p.piece[i], []);
    parPiece.get(p.piece[i]).push(i);
  }
  return parPiece;
}

// Les pions qui ne révèlent jamais rien, où qu'on les pose.
const MUETS = [
  ["un héros caché", { cache: true }],
  ["un PNJ", { genre: "pnj" }],
  ["un adversaire", { genre: "ennemi" }],
  ["un pion autre", { genre: "autre" }],
  ["un PNJ caché", { genre: "pnj", cache: true }],
];

function rejouer(p0, nom) {
  const parPiece = cases(p0);
  for (const [id, liste] of parPiece) {
    const i = liste[0];
    const x = i % p0.largeur;
    const y = (i - x) / p0.largeur;
    // Un héros visible : toute la pièce, rien qu'elle.
    const p = copie(p0);
    const ids = entrer(p, [pion(x, y)]);
    verifier(ids.length === 1 && ids[0] === id, `${nom} : un héros dans la pièce ${id} rend ${JSON.stringify(ids)}`);
    verifier(p.brouillard.every((v, k) => (p.sol[k] && p.piece[k] === id ? v === 1 : v === p0.brouillard[k])), `${nom} : un héros dans la pièce ${id} touche d'autres cases`);
    // Déjà révélée : rien de plus.
    verifier(!entrer(p, [pion(x, y)]).length, `${nom} : une pièce déjà révélée se révèle encore`);
    for (const [quoi, champs] of MUETS) {
      const q = copie(p0);
      verifier(!entrer(q, [pion(x, y, champs)]).length && memes(q.brouillard, p0.brouillard), `${nom} : ${quoi} révèle la pièce ${id}`);
    }
    // Sans brouillard, tout est déjà vu.
    const sans = { ...copie(p0), brouillard_actif: false };
    verifier(!entrer(sans, [pion(x, y)]).length && memes(sans.brouillard, p0.brouillard), `${nom} : sans brouillard, la pièce ${id} change`);
    // Pièce révélée en partie : sur une case vue, rien ; sur une case cachée, toute la pièce.
    if (liste.length > 1) {
      const r = copie(p0);
      r.brouillard[liste[0]] = 1;
      const xv = liste[0] % p0.largeur;
      verifier(!entrer(r, [pion(xv, (liste[0] - xv) / p0.largeur)]).length, `${nom} : une case déjà vue de la pièce ${id} la révèle`);
      const j = liste[liste.length - 1];
      const xj = j % p0.largeur;
      verifier(memes(entrer(r, [pion(xj, (j - xj) / p0.largeur)]), [id]) && liste.every((k) => r.brouillard[k] === 1), `${nom} : la pièce ${id} en partie vue ne se révèle pas entière`);
    }
  }
  // Toute la tablée emmenée d'un coup (Maj + glisser) : un héros caché du groupe ne révèle pas sa pièce.
  const pieces = [...parPiece.keys()];
  if (pieces.length >= 2) {
    const [a, b] = pieces;
    const ia = parPiece.get(a)[0];
    const ib = parPiece.get(b)[0];
    const p = copie(p0);
    const ids = entrer(p, [pion(ia % p.largeur, Math.floor(ia / p.largeur)), pion(ib % p.largeur, Math.floor(ib / p.largeur), { id: "vortan", cache: true })]);
    verifier(memes(ids, [a]) && parPiece.get(b).every((k) => p.brouillard[k] === p0.brouillard[k]), `${nom} : un héros caché du groupe révèle la pièce ${b}`);
  }
}

// ---- les générateurs
let plans = 0;
for (const m of MODELES) {
  if (m.cle === "vierge") continue;
  for (let graine = 1; graine <= N; graine++) {
    const g = generer(m.cle, graine);
    const p = { ...g, brouillard: g.sol.map(() => 0), brouillard_actif: true, pions: [] };
    if (!p.sol.some(Boolean)) continue;
    rejouer(p, `${m.cle} graine ${graine}`);
    plans += 1;
  }
}

// ---- changer de case : un tremblement ou un pas perdu contre le bord n'entre nulle part
for (const taille of [1, 2, 3]) {
  const pose = (x, y) => ({ id: "essai", genre: "heros", taille, x, y });
  const c = taille % 2 ? 0.5 : 0;
  for (const [x, y] of [[c + 6, c + 26], [c + 0, c + 0], [c + 12, c + 3]]) {
    for (const d of [0.01, 0.2, 0.49]) {
      for (const [ax, ay] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, -d]]) {
        // Le pion lâché un peu à côté puis calé (comme calerPion) retombe sur sa case.
        const t = pose(x + ax, y + ay);
        t.x = taille % 2 ? Math.floor(t.x) + 0.5 : Math.round(t.x);
        t.y = taille % 2 ? Math.floor(t.y) + 0.5 : Math.round(t.y);
        verifier(!changeDeCase(t, [x, y]), `taille ${taille} : un tremblement de ${d} case en (${x}, ${y}) compte comme un pas`);
      }
    }
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) {
      verifier(changeDeCase(pose(x + ax, y + ay), [x, y]), `taille ${taille} : un pas d'une case depuis (${x}, ${y}) ne compte pas`);
    }
  }
}

// ---- le cadrage de la TV
const P = { largeur: 60, hauteur: 40 };
const camera = { x: 10, y: 10, hv: 9 };
const interieure = { x0: 6, y0: 7, x1: 12, y1: 12 };
verifier(cameraElargie(P, camera, null, interieure) === null, "TV : une pièce déjà dans le cadre le change");
for (const boite of [{ x0: 40, y0: 30, x1: 48, y1: 36 }, { x0: 0, y0: 0, x1: 3, y1: 2 }, { x0: 14, y0: 8, x1: 22, y1: 11 }]) {
  const c = cameraElargie(P, camera, null, boite);
  const cadre = c && cadreTv(P, c, null);
  verifier(c && contient(cadre, boite) && contient(cadre, cadreTv(P, camera, null)), `TV : le cadre élargi ne couvre pas ${JSON.stringify(boite)} et l'ancien cadre`);
}
// Sans caméra, la TV cadrait ce qui était révélé : le cadre élargi le garde.
const revele = { x0: 2, y0: 2, x1: 8, y1: 6 };
const loin = { x0: 30, y0: 20, x1: 36, y1: 26 };
const c0 = cameraElargie(P, null, revele, loin);
verifier(c0 && contient(cadreTv(P, c0, null), loin) && contient(cadreTv(P, c0, null), cadreTv(P, null, revele)), "TV sans caméra : le cadre élargi perd ce qui était révélé");
verifier(cameraElargie(P, null, null, loin) === null, "TV sans caméra ni pièce révélée : elle montre déjà tout le plan");
verifier(cameraSur({ x0: 0, y0: 0, x1: 2, y1: 2 }).hv === 8, "TV : la hauteur vue descend sous 8 cases");

// ---- les vrais plans (lecture seule)
let reels = 0;
if (existsSync(DOSSIER)) {
  for (const f of readdirSync(DOSSIER).filter((n) => n.endsWith(".json")).sort()) {
    const p0 = JSON.parse(readFileSync(DOSSIER + f, "utf-8"));
    if (!Array.isArray(p0.sol) || !Array.isArray(p0.brouillard) || !Array.isArray(p0.pions)) continue;
    const p = { ...p0, brouillard_actif: p0.brouillard_actif ?? true };
    reels += 1;
    // Chaque pion caché du plan, posé sur chaque case de sol : pas une case ne change.
    for (const t of p.pions.filter((x) => x.cache)) {
      const q = copie(p);
      for (let i = 0; i < q.sol.length; i++) {
        if (!q.sol[i]) continue;
        const x = i % q.largeur;
        verifier(!entrer(q, [{ ...t, x: x + 0.5, y: (i - x) / q.largeur + 0.5 }]).length, `${f} : ${t.nom} (caché) révèle une pièce en case ${x + 1}, ${(i - x) / q.largeur + 1}`);
      }
      verifier(memes(q.brouillard, p.brouillard), `${f} : ${t.nom} (caché) change le brouillard`);
    }
    // Le même pion rendu visible, lui, révèle bien sa pièce s'il entre dans une pièce cachée.
    const cachee = p.sol.findIndex((s, i) => s && p.piece[i] && p.brouillard[i] !== 1);
    if (p.brouillard_actif && cachee >= 0) {
      const q = copie(p);
      const x = cachee % q.largeur;
      const ids = entrer(q, [{ id: "essai", genre: "heros", cache: false, x: x + 0.5, y: (cachee - x) / q.largeur + 0.5 }]);
      verifier(memes(ids, [p.piece[cachee]]) && contient(boiteRevelee(q), boitePiece(q, ids[0])), `${f} : un héros visible n'y révèle pas sa pièce`);
    }
  }
  const etang = DOSSIER + "l-etang-des-roseaux.json";
  if (existsSync(etang) && !JSON.parse(readFileSync(etang, "utf-8")).pions.some((t) => t.ref === "aventurier:vortan-aldrea" && t.cache)) {
    console.log("Note : Vortan n'est plus caché sur l'étang, les plans réels ne couvrent plus son cas (les générés, si).");
  }
}

console.log(`${plans} plans générés, ${reels} plans du dossier ${existsSync(DOSSIER) ? DOSSIER : "(absent)"}, ${essais} vérifications.`);
if (defauts.length) {
  console.log(`${defauts.length} défaut(s) :`);
  for (const d of defauts) console.log(`  ${d}`);
  process.exit(1);
}
console.log("Aucun défaut : un pion caché ne révèle jamais rien.");
