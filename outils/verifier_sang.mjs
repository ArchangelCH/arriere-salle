// Vérifie le sang d'un plan (js/plan/sang.js) sans navigateur : les taches (bornes, formes, teintes), le pinceau (sur du sol
// seulement, au plus 500), la gomme, tout montrer ou cacher, le dessin (toutes les formes et toutes les teintes se dessinent
// sans erreur, toujours pareil pour une même graine), et ce que voit chacun : pour les joueurs, rien de caché ni rien dans
// une case non révélée ; une tache éteinte n'existe pas (le sang n'a pas d'état éteint : seulement caché).
//   node outils/verifier_sang.mjs
import { nouveauPlan } from "../app/static/js/plan/modele.js";
import { habillageVu, sangVu } from "../app/static/js/plan/peint.js";
import {
  FORMES_SANG, SANG_MAX, TAILLE, TEINTES_SANG, compter, couleursSang, dessinerSang, dessinerSangPlan, effacer, formeValide, hasard,
  peindre, poser, reveler, sangDe, tacheValide, teinteValide, toutEffacer,
} from "../app/static/js/plan/sang.js";

let essais = 0;
const echecs = [];
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) echecs.push(`${nom}${detail ? ` : ${detail}` : ""}`);
};

// Un faux contexte de canvas : il note les appels, rien ne se dessine.
class Chemin { rect() {} }
globalThis.Path2D = Chemin;
function faux() {
  const appels = [];
  const ctx = new Proxy({}, {
    get: (_, nom) => {
      if (nom === "appels") return appels;
      if (nom === "createRadialGradient" || nom === "createLinearGradient") return () => ({ addColorStop() {} });
      return (...a) => appels.push([String(nom), ...a.map((x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : typeof x))]);
    },
    set: () => true,
  });
  return ctx;
}

// Un plan de 12 × 8 avec une pièce de 6 × 4 en haut à gauche (sol), le reste vide.
function plan() {
  const p = nouveauPlan({ largeur: 12, hauteur: 8 });
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
    p.sol[y * 12 + x] = 1;
    p.piece[y * 12 + x] = 1;
  }
  p.pieces = [{ id: 1, nom: "Salle", genre: "salle", notes: "", nom_visible: false }];
  return p;
}
const opt = (o = {}) => ({ forme: "pinceau", taille: 1, age: 0.15, teinte: "rouge", cache: false, ...o });
// Un hasard fixe pour les essais.
const rnd = hasard(42);

// ---- les valeurs
verifier(FORMES_SANG.length === 4 && TEINTES_SANG.length === 4, "quatre formes, quatre teintes");
verifier(formeValide("inconnue") === "flaque" && formeValide("gouttes") === "gouttes", "forme inconnue : flaque");
verifier(teinteValide("jaune") === "rouge" && teinteValide("vert") === "vert", "teinte inconnue : rouge");
verifier(tacheValide({ x: "a", y: 1 }) === null && tacheValide({}) === null, "une tache sans position n'en est pas une");
const t0 = tacheValide({ x: 1.5, y: 2.5, r: 99, age: 5, type: "trainee", l: 99, teinte: "x", graine: -7, rot: 99 });
verifier(t0.r === TAILLE.max && t0.age === 1 && t0.l === 12 && t0.teinte === "rouge" && t0.graine === 7 && t0.rot === 7, "bornes d'une tache", JSON.stringify(t0));
verifier(!("l" in tacheValide({ x: 1, y: 1, type: "flaque" })), "seule la traînée a une longueur");
const [cf, cs] = [couleursSang("rouge", 0), couleursSang("rouge", 1)];
verifier(cf.luisant === 1 && cs.luisant === 0 && cf.centre.join() !== cs.centre.join(), "frais et sec n'ont ni le même éclat ni la même couleur");
verifier(couleursSang("vert", 0.5).bord.every((v) => v >= 0 && v <= 255), "couleurs dans l'échelle");

// ---- le hasard se rejoue
const a = hasard(7);
const b = hasard(7);
verifier([a(), a(), a()].join() === [b(), b(), b()].join(), "même graine, même suite");
verifier(hasard(1)() !== hasard(2)(), "graines différentes");

// ---- poser
let p = plan();
verifier(sangDe(p).length === 0 && p.habillage == null, "un plan neuf n'a pas de sang ni d'habillage");
let r = poser(p, "flaque", 2.5, 1.5, 2.5, 1.5, opt(), rnd);
verifier(!!r.tache && r.tache.type === "flaque" && r.tache.x === 2.5 && sangDe(p).length === 1, "une flaque posée");
verifier(p.habillage && p.habillage.heure === undefined && Array.isArray(p.habillage.lumieres), "l'habillage créé n'a ni heure ni ambiance");
verifier(poser(p, "flaque", 9.5, 1.5, 9.5, 1.5, opt(), rnd).erreur, "hors du sol : refusé");
verifier(sangDe(p).length === 1, "un refus ne pose rien");
r = poser(p, "trainee", 1.5, 1.5, 4.5, 1.5, opt(), rnd);
verifier(r.tache.type === "trainee" && Math.abs(r.tache.l - 3) < 1e-9 && Math.abs(r.tache.rot) < 1e-9, "traînée de l'appui au lâcher : longueur et sens");
r = poser(p, "trainee", 1.5, 2.5, 1.5, 2.5, opt({ taille: 2 }), rnd);
verifier(r.tache.l > 0.3, "un clic sans glissé pose une traînée courte");
r = poser(p, "gouttes", 3.5, 2.5, 3.5, 2.5, opt({ cache: true, teinte: "noir", age: 0.9 }), rnd);
verifier(r.tache.cache === true && r.tache.teinte === "noir" && r.tache.age === 0.9, "cachée, noire, sèche");
verifier(compter(p).total === 4 && compter(p).caches === 1, "compter");

// ---- le pinceau
p = plan();
const n1 = peindre(p, 1.5, 1.5, 4.5, 1.5, opt(), rnd);
verifier(n1 >= 8 && sangDe(p).length === n1, "un trait de trois cases pose une dizaine de taches", String(n1));
verifier(sangDe(p).every((s) => ["flaque", "gouttes", "eclaboussure"].includes(s.type)), "le pinceau mêle flaques, gouttes et éclaboussures");
verifier(new Set(sangDe(p).map((s) => s.graine)).size > n1 / 2, "des graines différentes");
verifier(sangDe(p).every((s) => s.y > 0 && s.y < 4 && s.x > 0 && s.x < 6), "le pinceau reste sur le sol");
const avant = sangDe(p).length;
peindre(p, 8.5, 6.5, 10.5, 6.5, opt(), rnd);
verifier(sangDe(p).length === avant, "hors du sol : rien");
const gros = plan();
for (let i = 0; i < 200; i++) peindre(gros, 0.5, 0.5, 5.5, 3.5, opt({ taille: 2 }), rnd);
verifier(sangDe(gros).length === SANG_MAX, `au plus ${SANG_MAX} taches`, String(sangDe(gros).length));

// ---- la gomme, tout cacher
p = plan();
poser(p, "flaque", 1.5, 1.5, 1.5, 1.5, opt({ taille: 1 }), rnd);
poser(p, "flaque", 4.5, 1.5, 4.5, 1.5, opt({ taille: 1 }), rnd);
verifier(effacer(p, 1.5, 1.5, 0.5) === 1 && sangDe(p).length === 1, "la gomme retire ce qui est dessous");
verifier(effacer(p, 9, 7, 0.5) === 0, "la gomme dans le vide ne retire rien");
verifier(reveler(p, false) === 1 && compter(p).caches === 1, "tout cacher");
verifier(reveler(p, false) === 0, "tout cacher deux fois ne change rien");
verifier(reveler(p, true) === 1 && compter(p).caches === 0 && !("cache" in sangDe(p)[0]), "tout montrer : le champ s'en va");
verifier(toutEffacer(p) === 1 && sangDe(p).length === 0, "tout effacer");

// ---- le dessin : chaque forme, chaque teinte, sans erreur, toujours pareil
for (const forme of FORMES_SANG) for (const [teinte] of TEINTES_SANG) for (const age of [0, 0.5, 1]) {
  const t = tacheValide({ x: 2, y: 2, r: 1, type: forme, teinte, age, graine: 123, rot: 0.7, l: 3 });
  const c1 = faux();
  const c2 = faux();
  try {
    dessinerSang(c1, t);
    dessinerSang(c2, t);
    verifier(c1.appels.length > 6 && JSON.stringify(c1.appels) === JSON.stringify(c2.appels), `dessin ${forme} ${teinte} ${age} : même graine, même dessin`);
  } catch (e) {
    verifier(false, `dessin ${forme} ${teinte} ${age}`, e.message);
  }
}
const ctx = faux();
dessinerSangPlan(ctx, plan(), [], { x0: 0, y0: 0, x1: 12, y1: 8 });
verifier(ctx.appels.length === 0, "rien à dessiner : rien ne bouge");
p = plan();
poser(p, "flaque", 2.5, 1.5, 2.5, 1.5, opt(), rnd);
poser(p, "flaque", 2.5, 1.5, 2.5, 1.5, opt(), rnd);
const loin = faux();
dessinerSangPlan(loin, p, sangDe(p).map(tacheValide), { x0: 8, y0: 5, x1: 12, y1: 8 });
verifier(!loin.appels.some(([n]) => n === "quadraticCurveTo"), "une zone sans sang n'en dessine pas");
const pres = faux();
dessinerSangPlan(pres, p, sangDe(p).map(tacheValide), { x0: 0, y0: 0, x1: 6, y1: 4 });
verifier(pres.appels.some(([n]) => n === "clip") && pres.appels.some(([n]) => n === "quadraticCurveTo"), "dans la zone : détourée au sol, dessinée");

// ---- ce que voit chacun
const v = plan();
poser(v, "flaque", 1.5, 1.5, 1.5, 1.5, opt(), rnd);
poser(v, "gouttes", 2.5, 1.5, 2.5, 1.5, opt({ cache: true }), rnd);
poser(v, "eclaboussure", 4.5, 1.5, 4.5, 1.5, opt(), rnd);
v.brouillard_actif = true;
v.brouillard = new Array(v.largeur * v.hauteur).fill(1);
v.brouillard[1 * 12 + 4] = 0;
verifier(sangVu(v, false).length === 3, "le MJ voit tout (même le caché)");
const vue = sangVu(v, true);
verifier(vue.length === 1 && vue[0].type === "flaque", "les joueurs : ni le caché ni la case sous le brouillard", JSON.stringify(vue.map((s) => s.type)));
v.brouillard = new Array(v.largeur * v.hauteur).fill(0);
verifier(sangVu(v, true).length === 0, "sous le brouillard : rien pour les joueurs");
verifier(sangVu(plan(), false).length === 0, "pas d'habillage : pas de sang");
verifier(!("sang" in habillageVu(v, false)), "l'habillage précalculé ne porte pas le sang");

if (echecs.length) {
  console.log(echecs.map((x) => `ÉCHEC ${x}`).join("\n"));
  console.log(`${echecs.length} échec(s) sur ${essais} vérifications.`);
  process.exit(1);
}
console.log(`${essais} vérifications, aucun défaut.`);
