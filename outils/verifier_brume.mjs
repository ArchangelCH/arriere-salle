// Vérifie la brume que montre chaque vue d'un plan (app/static/js/plan/modele.js, brumeVue) : le MJ voit toute la
// brume ; les joueurs (« Vue joueurs » de l'atelier, export des joueurs) celle des seules cases révélées, comme la TV
// (api/tv_plans.py, plan_public). Avec un dossier de données, rejoue la règle sur les vrais plans (lecture seule).
// node outils/verifier_brume.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brumeVue, cacheParLaBrume } from "../app/static/js/plan/modele.js";

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

// La règle du serveur, recopiée de api/tv_plans.py (cases_vues, cases_brume, plan_public) : la brume des cases vues.
function brumeDuServeur(p) {
  const n = p.largeur * p.hauteur;
  const actif = p.brouillard_actif === undefined ? true : !!p.brouillard_actif;
  const br = [...(p.brouillard || [])];
  while (br.length < n) br.push(0);
  const vu = actif ? br.slice(0, n).map((v) => (v === 1 ? 1 : 0)) : Array(n).fill(1);
  const b = Array.isArray(p.brume) ? [...p.brume.slice(0, n)] : [];
  while (b.length < n) b.push(0);
  return b.map((v, i) => (vu[i] ? (v === 2 ? 2 : v === 1 ? 1 : 0) : 0));
}
const nettoyee = (b, n) => Array.from({ length: n }, (_, i) => (b && (b[i] === 1 || b[i] === 2) ? b[i] : 0));

// Deux salles côte à côte : A (x < 3) révélée, B (x >= 3) cachée.
const W = 6;
const H = 3;
const BROUILLARD = Array.from({ length: W * H }, (_, i) => (i % W < 3 ? 1 : 0));
const grille = (cases) => Array.from({ length: W * H }, (_, i) => cases[`${i % W},${Math.floor(i / W)}`] || 0);
const plan = (brume, o = {}) => ({ largeur: W, hauteur: H, brouillard_actif: true, brouillard: BROUILLARD, brume, ...o });

{
  const brume = grille({ "0,0": 1, "1,0": 2, "2,1": 1, "3,0": 2, "4,0": 2, "5,0": 2, "3,1": 2, "4,1": 1, "5,2": 2 });
  const p = plan(brume);
  ok(brumeVue(p, false) === brume, "le MJ voit toute la brume, telle quelle");
  egal(brumeVue(p, true), grille({ "0,0": 1, "1,0": 2, "2,1": 1 }), "les joueurs : la brume de la salle révélée seulement");
  egal(brumeVue(p, true), brumeDuServeur(p), "les joueurs : même brume que la TV");
  egal(brume, grille({ "0,0": 1, "1,0": 2, "2,1": 1, "3,0": 2, "4,0": 2, "5,0": 2, "3,1": 2, "4,1": 1, "5,2": 2 }), "le plan n'est pas touché");

  // Le cas de la relecture : la brume sur la seule salle cachée, ou partout.
  const cachee = plan(grille({ "4,0": 2, "4,1": 2, "5,1": 1 }));
  ok(brumeVue(cachee, true).every((v) => v === 0), "brume sur une salle cachée : rien pour les joueurs, pas même sa forme");
  const partout = plan(Array(W * H).fill(1));
  egal(brumeVue(partout, true), BROUILLARD, "Brume partout : le voile sur les seules cases révélées");

  // Sans brouillard, tout se voit ; brouillard_actif absent compte pour actif (comme le serveur).
  egal(brumeVue(plan(brume, { brouillard_actif: false }), true), brume, "sans brouillard : toute la brume");
  egal(brumeVue(plan(brume, { brouillard_actif: undefined }), true), brumeDuServeur(p), "brouillard_actif absent : actif");
  // Un brouillard trop court ou absent : ce qui manque est caché.
  egal(brumeVue(plan(brume, { brouillard: BROUILLARD.slice(0, 4) }), true), grille({ "0,0": 1, "1,0": 2 }), "brouillard trop court");
  ok(brumeVue(plan(brume, { brouillard: undefined }), true).every((v) => v === 0), "sans brouillard enregistré : tout caché");
  // Un plan d'avant la brume.
  ok(brumeVue(plan(undefined), true) === undefined && brumeVue(plan(undefined), false) === undefined, "plan sans brume : rien");
  egal(brumeVue(plan([]), true), [], "liste vide (la TV, sans brume)");

  // Ce que la TV reçoit (déjà coupé aux cases vues, brouillard = cases vues) ne change pas en passant par la règle.
  const tv = { ...p, brume: brumeDuServeur(p) };
  egal(brumeVue(tv, true), tv.brume, "sur la TV : la brume reçue, inchangée");

  // Un adversaire dans l'épaisse d'une salle cachée reste caché aux joueurs (par le brouillard).
  ok(cacheParLaBrume(p, { genre: "ennemi", x: 4.5, y: 0.5 }), "adversaire dans l'épaisse cachée : caché");
}

// Plans tirés au hasard : la règle des joueurs suit celle du serveur.
{
  let graine = 7;
  const hasard = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 300; k++) {
    const w = 1 + Math.floor(hasard() * 20);
    const h = 1 + Math.floor(hasard() * 20);
    const n = w * h;
    const p = {
      largeur: w, hauteur: h, brouillard_actif: hasard() < 0.85,
      brouillard: Array.from({ length: n }, () => (hasard() < 0.5 ? 1 : 0)),
      brume: Array.from({ length: n }, () => [0, 0, 1, 2][Math.floor(hasard() * 4)]),
    };
    egal(nettoyee(brumeVue(p, true), n), brumeDuServeur(p), `plan au hasard n° ${k} (${w} × ${h})`);
  }
}

// Les vrais plans (lecture seule) : brume partout, puis épaisse sur les seules cases cachées.
const dossier = process.argv[2];
if (dossier) {
  const plans = readdirSync(join(dossier, "plans")).filter((f) => f.endsWith(".json"));
  for (const f of plans) {
    const p = JSON.parse(readFileSync(join(dossier, "plans", f), "utf8"));
    const n = p.largeur * p.hauteur;
    if (p.brouillard_actif === undefined) p.brouillard_actif = true; // l'éditeur le pose ainsi (normaliser)
    for (const [nom, brume] of [
      ["partout", Array(n).fill(1)],
      ["épaisse cachée", Array.from({ length: n }, (_, i) => (p.brouillard_actif && (p.brouillard || [])[i] !== 1 ? 2 : 0))],
      ["la sienne", p.brume],
    ]) {
      const q = { ...p, brume };
      egal(nettoyee(brumeVue(q, true), n), brumeDuServeur(q), `${f}, brume ${nom}`);
    }
  }
  console.log(`${plans.length} plans relus.`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Aucun défaut (${verifs} vérifications).`);
process.exit(defauts ? 1 : 0);
