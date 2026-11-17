// Vérifie le feu que montre chaque vue d'un plan (app/static/js/plan/modele.js, feuVue) : le MJ voit tout le feu ; les
// joueurs (« Vue joueurs » de l'atelier, export des joueurs) celui des seules cases révélées, comme la TV (api/tv_plans.py,
// cases_feu et plan_public), et jamais hors d'un sol ; puis la lumière qu'il jette sur le plan peint (lumieresDuFeu).
// Avec un dossier de données, rejoue la règle sur les vrais plans et leurs étapes (lecture seule).
// node outils/verifier_feu.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { feuVue, lumieresDuFeu } from "../app/static/js/plan/modele.js";

let defauts = 0;
let verifs = 0;
function ok(cond, message) {
  verifs++;
  if (!cond) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
}
const egal = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} : ${JSON.stringify(a)} au lieu de ${JSON.stringify(b)}`);

// La règle du serveur, recopiée de api/tv_plans.py (cases_vues, cases_feu, plan_public) : le feu des cases vues, sur un sol.
function feuDuServeur(p) {
  const n = p.largeur * p.hauteur;
  const actif = p.brouillard_actif === undefined ? true : !!p.brouillard_actif;
  const br = [...(p.brouillard || [])];
  while (br.length < n) br.push(0);
  const vu = actif ? br.slice(0, n).map((v) => (v === 1 ? 1 : 0)) : Array(n).fill(1);
  const f = Array.isArray(p.feu) ? [...p.feu.slice(0, n)] : [];
  while (f.length < n) f.push(0);
  const sol = [...(p.sol || [])];
  while (sol.length < n) sol.push(0);
  const valeur = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4 ? v : 0);
  return f.map((v, i) => (vu[i] && sol[i] ? valeur(v) : 0));
}
// feuVue rend null sans feu : la même chose qu'une grille vide.
const vue = (p, joueurs) => feuVue(p, joueurs) || Array(p.largeur * p.hauteur).fill(0);

// Deux salles côte à côte : A (x < 3) révélée, B (x >= 3) cachée ; une case sans sol en (2, 2).
const W = 6;
const H = 3;
const BROUILLARD = Array.from({ length: W * H }, (_, i) => (i % W < 3 ? 1 : 0));
const SOL = Array.from({ length: W * H }, (_, i) => (i === 2 * W + 2 ? 0 : 2));
const PIECE = Array.from({ length: W * H }, (_, i) => (i % W < 3 ? 1 : 2));
const grille = (cases) => Array.from({ length: W * H }, (_, i) => cases[`${i % W},${Math.floor(i / W)}`] || 0);
const plan = (feu, o = {}) => ({ largeur: W, hauteur: H, brouillard_actif: true, brouillard: BROUILLARD, sol: SOL, piece: PIECE, feu, ...o });

{
  const feu = grille({ "0,0": 1, "1,0": 3, "2,1": 2, "2,2": 3, "3,0": 3, "4,1": 4, "5,2": 2 });
  const p = plan(feu);
  egal(vue(p, false), grille({ "0,0": 1, "1,0": 3, "2,1": 2, "3,0": 3, "4,1": 4, "5,2": 2 }), "le MJ voit tout le feu, sauf hors du sol");
  egal(vue(p, true), grille({ "0,0": 1, "1,0": 3, "2,1": 2 }), "les joueurs : le feu de la salle révélée seulement");
  egal(vue(p, true), feuDuServeur(p), "les joueurs : même feu que la TV");
  egal(vue(p, false), feuDuServeur({ ...p, brouillard_actif: false }), "le MJ : même feu que la TV sans brouillard");
  ok(feuVue(plan(grille({ "4,0": 3, "5,1": 2 })), true) === null, "feu sur une salle cachée : rien pour les joueurs, pas même sa forme");
  egal(vue(plan(feu, { brouillard_actif: undefined }), true), feuDuServeur(p), "brouillard_actif absent : actif");
  ok(feuVue(plan(feu, { brouillard: undefined }), true) === null, "sans brouillard enregistré : tout caché");
  // Valeurs abîmées : rien d'autre que 1 à 4, des entiers.
  const abime = plan(grille({ "0,0": 5, "1,0": -1, "0,1": 2.5, "1,1": "3", "0,2": true, "1,2": 3 }));
  egal(vue(abime, false), grille({ "1,2": 3 }), "valeurs abîmées ignorées");
  egal(vue(abime, true), feuDuServeur(abime), "valeurs abîmées : même règle que le serveur");
  ok(feuVue(plan(undefined), false) === null && feuVue(plan([3, 3]), false) === null, "pas de feu, ou un feu de la mauvaise taille : rien");
}

{
  // La lumière : une par pièce et par carré de trois cases qui brûle, posée sur une case qui brûle ; rien pour les cendres.
  const feu = grille({ "0,0": 3, "1,0": 3, "0,1": 2, "3,0": 1, "4,1": 4 });
  const l = lumieresDuFeu(plan(feu, { brouillard_actif: false }), false);
  egal(l.length, 2, "deux groupes qui brûlent (salle A, salle B ; les cendres n'éclairent pas)");
  for (const x of l) {
    const i = Math.floor(x.y) * W + Math.floor(x.x);
    ok(feu[i] >= 1 && feu[i] <= 3, `lumière posée sur une case qui brûle (${x.x}, ${x.y})`);
    ok(x.rayon > 0 && x.rayon <= 8 && x.intensite > 0 && x.intensite <= 1.5, "rayon et intensité dans leurs bornes");
  }
  ok(lumieresDuFeu(plan(feu), true).every((x) => x.x < 3), "les joueurs : aucune lumière du feu caché");
  ok(lumieresDuFeu(plan(grille({ "4,1": 4 })), false).length === 0, "des cendres seules : aucune lumière");
}

// Les vrais plans : chaque vue et chaque étape obéissent à la même règle que le serveur.
const dossier = process.argv[2];
if (dossier) {
  const rep = join(dossier, "plans");
  let plans = 0;
  let etapes = 0;
  for (const nom of readdirSync(rep).filter((f) => f.endsWith(".json"))) {
    const p = JSON.parse(readFileSync(join(rep, nom), "utf-8"));
    plans++;
    egal(vue(p, true), feuDuServeur(p), `${nom} : vue joueurs = TV`);
    for (const [k, et] of (Array.isArray(p.etapes) ? p.etapes : []).entries()) {
      etapes++;
      ok(Array.isArray(et.feu) && et.feu.length === p.largeur * p.hauteur, `${nom}, étape ${k + 1} : feu de la taille du plan`);
      ok(Array.isArray(et.brume) && et.brume.length === p.largeur * p.hauteur, `${nom}, étape ${k + 1} : brume de la taille du plan`);
      const q = { ...p, feu: et.feu };
      egal(vue(q, true), feuDuServeur(q), `${nom}, étape ${k + 1} : vue joueurs = TV`);
    }
  }
  console.log(`${plans} plans, ${etapes} étapes rejoués.`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Feu : ${verifs} vérifications, aucun défaut.`);
process.exit(defauts ? 1 : 0);
