// Vérifie le feu qui compte en combat (app/static/js/combats/flammes.js) : un pion dans les flammes à l'étape rappelée
// (Flammes ou Brasier ; ni une case saine, ni les braises, ni le calciné, ni un pion absent, ni un plan sans feu), les
// plans où l'on cherche les combattants d'un combat, et le silence quand un combattant a plus d'un pion.
// Avec un dossier de données, rejoue les étapes des vrais plans en flammes (lecture seule, pions posés en mémoire).
// node outils/verifier_flammes.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BRASIER, FLAMMES, flammesSous, phraseFlammes, planDeLaTv, plansDuCombat, rappelsFlammes } from "../app/static/js/combats/flammes.js";
import { ENNEMIS } from "../app/static/js/combats/suivi.js";

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

// Le plan tel que l'éditeur le laisse quand le MJ rappelle l'étape n (plan/editeur.js, appliquerEtape).
const aLEtape = (p, n) => ({ ...p, feu: p.etapes[n].feu.slice(), brume: p.etapes[n].brume.slice(), etape: n });

// Une salle de 6 × 3 ; la case (5, 2) n'a pas de sol. Trois étapes : rien, le feu prend au fond, tout brûle ou finit calciné.
const W = 6;
const H = 3;
const grille = (cases) => Array.from({ length: W * H }, (_, i) => cases[`${i % W},${Math.floor(i / W)}`] || 0);
const SOL = Array.from({ length: W * H }, (_, i) => (i === 2 * W + 5 ? 0 : 2));
const pion = (id, ref, x, y, o = {}) => ({ id, ref, genre: ref.startsWith("aventurier") ? "heros" : "ennemi", nom: o.nom || id, court: o.court || "", x: x + 0.5, y: y + 0.5, taille: 1, ...o });
const salle = (o = {}) => ({
  id: "salle", nom: "La salle", lieu: "", largeur: W, hauteur: H, sol: SOL, piece: Array(W * H).fill(1), brouillard: Array(W * H).fill(0),
  feu: Array(W * H).fill(0), brume: Array(W * H).fill(0), etape: null, pions: [], feu_effet: "",
  etapes: [
    { nom: "Étape 1", feu: grille({}), brume: grille({}) },
    { nom: "Étape 2", feu: grille({ "4,0": 1, "5,0": 2, "5,1": 3 }), brume: grille({}) },
    { nom: "L'aube", feu: grille({ "0,0": 4, "1,0": 3, "2,0": 2, "3,0": 1, "5,2": 3, "4,1": 4 }), brume: grille({}) },
  ],
  ...o,
});

{
  // Le feu sous un pion, étape par étape.
  const p = salle();
  const sur = (q, x, y, o) => flammesSous(q, pion("t", "aventurier:t", x, y, o));
  egal(sur(aLEtape(p, 0), 1, 0), 0, "étape 1 : rien ne brûle");
  egal(sur(aLEtape(p, 1), 5, 0), FLAMMES, "étape 2 : flammes");
  egal(sur(aLEtape(p, 1), 5, 1), BRASIER, "étape 2 : brasier");
  egal(sur(aLEtape(p, 1), 4, 0), 0, "étape 2 : des braises ne comptent pas");
  egal(sur(aLEtape(p, 1), 0, 2), 0, "étape 2 : une case saine");
  egal(sur(aLEtape(p, 2), 0, 0), 0, "l'aube : calciné, rien");
  egal(sur(aLEtape(p, 2), 1, 0), BRASIER, "l'aube : le brasier qui reste");
  egal(sur(aLEtape(p, 2), 5, 2), 0, "du feu hors du sol ne compte pas");
  egal(sur(salle({ feu: undefined }), 5, 1), 0, "un plan d'avant le feu : rien");
  egal(sur(salle({ feu: [3, 3, 3] }), 0, 0), 0, "un feu de la mauvaise taille : rien");
  egal(sur(salle({ feu: grille({ "1,1": "3", "2,1": 2.5, "3,1": true }) }), 1, 1) + sur(salle({ feu: grille({ "2,1": 2.5 }) }), 2, 1), 0, "valeurs abîmées ignorées");
  // Un grand pion (2 × 2, posé sur un coin de case) couvre quatre cases : une seule en flammes suffit.
  const grand = { ...pion("g", "bestiaire:ogre", 0, 0, { taille: 2 }), x: 5, y: 1 };
  egal(flammesSous(aLEtape(p, 1), grand), BRASIER, "un grand pion qui touche le brasier");
  egal(flammesSous(aLEtape(p, 1), { ...grand, x: 2, y: 2 }), 0, "un grand pion loin du feu");
  egal(flammesSous(aLEtape(p, 1), { id: "x", ref: "aventurier:t" }), 0, "un pion sans place");
}

// Un combat : Eloran et Tavarède, puis les adversaires (deux frères de l'Eau, numéros 4 et 5).
const eloran = { id: "eloran", nom: "Eloran de la maison Amberel", max: 10, sante: 10 };
const tavarede = { id: "tavarede", nom: "Tavarède Lavelle", max: 10, sante: 10 };
const frere = (id, numero, o = {}) => ({ id, nom: "Frère de l'Eau", numero, cle: "frere-eau", rang: "soldat", max: 10, sante: 10, fuite: false, ...o });
const combat = (actif, o = {}) => ({
  id: "c1", rencontre: "porte", nom: "La porte de derrière", tour: 1, actif, ordre: ["aventurier:eloran", ENNEMIS, "aventurier:tavarede"],
  heros: [eloran, tavarede], adversaires: [frere("a1", "4"), frere("a2", "5")], ...o,
});
const freres = [pion("f4", "bestiaire:frere-eau", 5, 1, { nom: "Frère de l'Eau", court: "4" }), pion("f5", "bestiaire:frere-eau", 0, 2, { nom: "Frère de l'Eau", court: "5" })];

{
  // Le combat se joue sur la salle, que montre la TV.
  const p = aLEtape(salle({ pions: [pion("e", "aventurier:eloran", 5, 0), pion("t", "aventurier:tavarede", 1, 2), ...freres] }), 1);
  const ctx = { tv: "salle" };
  const r = rappelsFlammes(combat(0), [p], ctx);
  egal(r.map((x) => x.noms), [["Eloran"]], "la main à Eloran, dans les flammes");
  egal(r[0] && [r[0].plan.id, r[0].etape, r[0].niveau, r[0].effet], ["salle", "Étape 2", FLAMMES, ""], "le plan, l'étape, le niveau, aucun effet écrit");
  egal(rappelsFlammes(combat(2), [p], ctx), [], "la main à Tavarède, sur une case saine");
  egal(rappelsFlammes(combat(1), [p], ctx).map((x) => x.noms), [["Frère de l'Eau 4"]], "la main aux adversaires : le frère 4 dans le brasier");
  egal(rappelsFlammes(combat(1), [{ ...p, pions: [...p.pions.slice(0, 2), { ...freres[0], x: 5.5, y: 0.5 }, { ...freres[1], x: 5.5, y: 1.5 }] }], ctx).map((x) => [x.noms, x.niveau]),
    [[["Frère de l'Eau 4", "Frère de l'Eau 5"], BRASIER]], "deux adversaires dans le feu : une seule ligne");
  egal(phraseFlammes(["Frère de l'Eau 4", "Frère de l'Eau 5"]), "Frère de l'Eau 4 et Frère de l'Eau 5 sont dans les flammes", "la phrase au pluriel");
  egal(rappelsFlammes(combat(1, { adversaires: [frere("a1", "4", { sante: 0 }), frere("a2", "5")] }), [p], ctx), [], "un adversaire au tapis n'agit pas");
  egal(rappelsFlammes(combat(1, { adversaires: [frere("a1", "4", { fuite: true }), frere("a2", "5")] }), [p], ctx), [], "un adversaire en fuite non plus");
  egal(rappelsFlammes(combat(0), [{ ...p, feu_effet: "  1D6 Santé, l'armure ne compte pas  " }], ctx)[0]?.effet, "1D6 Santé, l'armure ne compte pas", "l'effet écrit pour le plan");
  egal(rappelsFlammes(combat(0), [{ ...p, feu_effet: { texte: "1D6" } }], ctx)[0]?.effet, "", "un effet illisible : rien");
  egal(rappelsFlammes(combat(0), [{ ...p, pions: p.pions.filter((t) => t.id !== "e") }], ctx), [], "le pion d'Eloran absent : rien");
  egal(rappelsFlammes(combat(0), [{ ...p, feu: undefined, etapes: [] }], ctx), [], "un plan sans feu : rien");
  egal(rappelsFlammes(combat(0), [aLEtape(p, 2)], ctx), [], "l'aube : Eloran sur du calciné, rien");
  egal(rappelsFlammes(combat(0), [{ ...p, pions: [...p.pions, pion("e2", "aventurier:eloran", 0, 2)] }], ctx), [], "deux pions d'Eloran sur le plan : rien");
  egal(rappelsFlammes(combat(0, { ordre: [] }), [p], ctx), [], "un combat sans ordre : rien");
  egal(rappelsFlammes(combat(0), [p], {}), [], "ni scène liée, ni TV : aucun plan, rien");
  egal(rappelsFlammes(combat(0), [p], { tv: "autre" }), [], "la TV sur un autre plan : rien");
  // Le feu retouché après avoir rappelé l'étape : c'est lui qui compte, et le rappel le dit.
  const retouche = { ...p, feu: p.feu.map((v, i) => (i === 2 * W + 1 ? 3 : v)) };
  egal(rappelsFlammes(combat(2), [retouche], ctx).map((x) => [x.noms, x.etape, x.niveau]), [[["Tavarède"], "Étape 2, retouchée", BRASIER]], "Tavarède rattrapé par le feu retouché");
  egal(rappelsFlammes(combat(0), [{ ...p, etape: null }], ctx)[0]?.etape, "", "aucune étape rappelée : le feu du moment, sans nom d'étape");
  // Un pion caché compte aussi : il est là, seulement invisible sur la TV.
  egal(rappelsFlammes(combat(0), [{ ...p, pions: p.pions.map((t) => (t.id === "e" ? { ...t, cache: true } : t)) }], ctx).length, 1, "un pion caché dans les flammes");
  // Un très grand pion (3 × 3, posé au centre d'une case) touche les flammes par un coin.
  const boss = { ...pion("b", "aventurier:eloran", 4, 2), taille: 3 };
  egal(flammesSous(p, boss), BRASIER, "un pion de 3 × 3 qui touche le brasier par un coin");
  egal(flammesSous(p, { ...boss, x: 2.5 }), 0, "le même, deux cases plus loin");
}

{
  // Les plans du combat.
  const auberge = (id, o = {}) => salle({ id, nom: id, lieu: "auberge", ...o });
  const bas = aLEtape(auberge("bas", { pions: [...freres] }), 1);
  const haut = aLEtape(auberge("haut", { pions: [pion("e", "aventurier:eloran", 5, 1)] }), 1);
  const toma = auberge("toma", { pions: [pion("e", "aventurier:eloran", 5, 1)], etapes: [], feu: Array(W * H).fill(0) });
  const ailleurs = aLEtape(salle({ id: "ailleurs", lieu: "foret", pions: [pion("e", "aventurier:eloran", 5, 1)] }), 1);
  const tous = [bas, haut, toma, ailleurs];
  const ids = (ctx) => plansDuCombat(combat(0), tous, ctx).map((p) => p.id).sort();
  egal(ids({}), [], "sans scène liée ni TV : aucun plan, pas même celui où la rencontre est posée");
  egal(ids({ tv: "bas" }), ["bas", "haut"], "la TV en bas, et l'étage du même lieu qui brûle ; ni l'auberge sans feu, ni la forêt");
  egal(ids({ tv: "ailleurs" }), ["ailleurs"], "la TV sur la forêt : la forêt seule");
  const seance = { deroule: [{ titre: "L'incendie", liens: { plan: "toma", rencontre: "porte" } }, { titre: "Ailleurs", liens: { plan: "ailleurs", rencontre: "autre" } }] };
  egal(ids({ seance }), ["bas", "haut", "toma"], "une scène qui lie la rencontre à un plan : ce plan, et ceux du même lieu qui brûlent");
  egal(ids({ seance: { deroule: [{ liens: { rencontre: "porte" } }, { liens: { plan: "bas" } }] } }), [], "une scène sans plan, ou sans la rencontre : rien");
  // Eloran à l'étage seulement : le rappel vient de l'étage, même si la TV montre le rez-de-chaussée.
  egal(rappelsFlammes(combat(0), [bas, haut], { tv: "bas" }).map((x) => x.plan.id), ["haut"], "un héros à l'étage, la TV en bas");
  // Monté à l'étage et resté en bas : on ne sait pas où il est, rien.
  const bas2 = { ...bas, pions: [...bas.pions, pion("e", "aventurier:eloran", 0, 2)] };
  egal(rappelsFlammes(combat(0), [bas2, haut], { tv: "haut" }), [], "un pion en bas et un à l'étage : rien");
  // Un vieux pion sur un plan d'ailleurs qui brûle ne compte pas, sauf si la TV le montre.
  egal(rappelsFlammes(combat(0), [bas, ailleurs], { tv: "bas" }), [], "un plan sans lien avec le combat ne compte pas");
  egal(rappelsFlammes(combat(0), [bas, ailleurs], { tv: "ailleurs" }).map((x) => x.plan.id), ["ailleurs"], "sauf s'il est à la TV");
}

{
  // Le plan de la TV.
  egal(planDeLaTv({ vue: "plan", plan: "bas" }), "bas", "la TV montre un plan");
  egal(planDeLaTv({ vue: "image", plan: null, avant: { vue: "plan", plan: "bas" } }), "bas", "une image montrée par-dessus le plan");
  egal(planDeLaTv({ vue: "plan", plan: "bas", pnj: "mirele" }), "bas", "le carton d'un PNJ par-dessus le plan");
  egal(planDeLaTv({ vue: "image", avant: { vue: "carte", carte: "x" } }), null, "une image par-dessus une carte");
  egal([planDeLaTv({ vue: "accueil" }), planDeLaTv(null), planDeLaTv({ vue: "carte", plan: "bas" })], [null, null, null], "ni accueil, ni carte");
}

// Les vrais plans : à chaque étape, un héros posé (en mémoire) sur une case en flammes est rappelé, et pas sur une case
// saine, en braises ou calcinée.
const dossier = process.argv[2];
if (dossier) {
  const rep = join(dossier, "plans");
  let etapes = 0;
  const NOMS = { 0: "saine", 1: "en braises", 2: "en flammes", 3: "en brasier", 4: "calcinée" };
  for (const nom of readdirSync(rep).filter((f) => f.endsWith(".json"))) {
    const brut = JSON.parse(readFileSync(join(rep, nom), "utf-8"));
    for (const [n] of (Array.isArray(brut.etapes) ? brut.etapes : []).entries()) {
      etapes++;
      const p = aLEtape(brut, n);
      for (const v of [0, 1, 2, 3, 4]) {
        const i = p.feu.findIndex((x, k) => x === v && p.sol[k]);
        if (i < 0) continue;
        const [x, y] = [i % p.largeur, Math.floor(i / p.largeur)];
        // Un héros seul sur ce plan, la TV dessus : il n'est cherché que là.
        const q = { ...p, pions: [...(p.pions || []).filter((t) => t.ref !== "aventurier:eloran"), pion("essai", "aventurier:eloran", x, y)] };
        const r = rappelsFlammes(combat(0), [q], { tv: q.id });
        const attendu = v === 2 || v === 3;
        ok(r.length === (attendu ? 1 : 0), `${nom}, ${p.etapes[n].nom} : un héros sur une case ${NOMS[v]} ${attendu ? "est" : "n'est pas"} rappelé`);
      }
    }
  }
  console.log(`${etapes} étapes rejouées.`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Flammes : ${verifs} vérifications, aucun défaut.`);
process.exit(defauts ? 1 : 0);
