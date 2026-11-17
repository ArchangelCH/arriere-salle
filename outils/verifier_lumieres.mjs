// Vérifie les sources de lumière d'un plan (js/plan/lumieres.js) sans navigateur : poser (sur du sol seulement, au plus
// 40, identifiants uniques), types et réglages d'origine, bornes des réglages, allumer et éteindre, dupliquer, retirer,
// noms de la liste, et ce que le rendu en fait : une lumière éteinte n'éclaire ni le MJ ni les joueurs, une lumière cachée
// n'éclaire que le MJ, une lumière dans une case non révélée n'existe pas pour les joueurs.
//   node outils/verifier_lumieres.mjs
import { nouveauPlan } from "../app/static/js/plan/modele.js";
import { lumieresVisibles } from "../app/static/js/plan/peint.js";
import {
  LUMIERES_MAX, NUANCES, RAYON, INTENSITE, TYPES_LUMIERE, ajouter, allumee, allumer, changerType, compter, couleurValide, dupliquer,
  lumieresDe, nomsDesLumieres, prochainId, regler, retirer, toutAllumer, typeDe,
} from "../app/static/js/plan/lumieres.js";

let essais = 0;
const echecs = [];
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) echecs.push(`${nom}${detail ? ` : ${detail}` : ""}`);
};

// Un plan de 12 × 8 avec une pièce de 6 × 4 en haut à gauche (sol, pièce 1), le reste vide.
function plan() {
  const p = nouveauPlan({ largeur: 12, hauteur: 8 });
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
    p.sol[y * 12 + x] = 1;
    p.piece[y * 12 + x] = 1;
  }
  p.pieces = [{ id: 1, nom: "Salle", genre: "salle", notes: "", nom_visible: false }];
  return p;
}

// ---- les types
verifier(TYPES_LUMIERE.length >= 8, "au moins huit types de lumière");
const cles = TYPES_LUMIERE.map(([c]) => c);
verifier(new Set(cles).size === cles.length, "une clé par type");
for (const [c, nom, r] of TYPES_LUMIERE) {
  verifier(!!nom && /^#[0-9a-f]{6}$/i.test(r.couleur), `type ${c} : nom et couleur`);
  verifier(r.rayon >= RAYON.min && r.rayon <= RAYON.max && r.intensite >= INTENSITE.min && r.intensite <= INTENSITE.max, `type ${c} : bornes`);
}
verifier(NUANCES.every(([c]) => couleurValide(c) === c), "les nuances sont des couleurs valides");
verifier(couleurValide("rouge") === "#ffb15e" && couleurValide("#ABCDEF") === "#abcdef", "couleur invalide : l'ambre ; majuscules ramenées");
verifier(typeDe("inconnu") === null && typeDe("torche")[1] === "Torche", "typeDe");

// ---- poser
let p = plan();
verifier(lumieresDe(p).length === 0 && p.habillage == null, "un plan neuf n'a pas de lumière ni d'habillage");
let r = ajouter(p, "torche", 2.5, 1.5);
verifier(!!r.lumiere && r.lumiere.id === "l1" && r.lumiere.piece === 1 && r.lumiere.type === "torche", "première lumière : l1, pièce 1", JSON.stringify(r));
verifier(r.lumiere.rayon === 4 && r.lumiere.couleur === "#ffa94d" && r.lumiere.intensite === 0.9, "réglages d'origine de la torche");
verifier(p.habillage && p.habillage.heure === undefined && Array.isArray(p.habillage.objets) && Array.isArray(p.habillage.legende), "l'habillage créé n'a ni heure ni ambiance (le soir d'origine reste)");
verifier(ajouter(p, "torche", 8.5, 1.5).erreur, "hors du sol : refusé");
verifier(ajouter(p, "torche", -1, 1).erreur && ajouter(p, "torche", 2, 99).erreur, "hors du plan : refusé");
verifier(lumieresDe(p).length === 1, "un refus ne pose rien");
r = ajouter(p, "nimporte", 3.5, 1.5);
verifier(r.lumiere.type === "libre" && r.lumiere.rayon === 3, "un type inconnu devient « libre »");
verifier(prochainId(p.habillage) === "l3", "prochain identifiant");
// Les lumières de la rédaction (l1, l2…, sans type) et celles à la main ne se marchent pas dessus.
const q = plan();
q.habillage = { heure: "nuit", lumieres: [{ id: "l1", x: 1.5, y: 1.5, rayon: 3 }, { id: "l7", x: 2.5, y: 1.5 }], objets: [], legende: [] };
verifier(ajouter(q, "bougie", 3.5, 1.5).lumiere.id === "l8" && q.habillage.heure === "nuit", "après l7 vient l8, l'habillage existant est gardé");
let plein = plan();
for (let i = 0; i < LUMIERES_MAX; i++) ajouter(plein, "libre", 0.5 + (i % 6), 0.5 + (i % 4));
verifier(lumieresDe(plein).length === LUMIERES_MAX && ajouter(plein, "libre", 1.5, 1.5).erreur, `au plus ${LUMIERES_MAX} lumières`);
verifier(new Set(lumieresDe(plein).map((l) => l.id)).size === LUMIERES_MAX, "identifiants uniques");

// ---- régler
const l = lumieresDe(p)[0];
regler(l, "rayon", 99);
verifier(l.rayon === RAYON.max, "portée bornée en haut");
regler(l, "rayon", 0);
verifier(l.rayon === RAYON.min, "portée bornée en bas");
regler(l, "rayon", "abc");
verifier(l.rayon === 3, "portée illisible : 3");
regler(l, "intensite", 5);
verifier(l.intensite === INTENSITE.max, "intensité bornée");
regler(l, "couleur", "#00FF00");
verifier(l.couleur === "#00ff00", "couleur");
regler(l, "couleur", "pas une couleur");
verifier(l.couleur === "#ffb15e", "couleur invalide : l'ambre");
regler(l, "source", "x".repeat(200));
verifier(l.source.length === 80, "nom limité à 80 caractères");
regler(l, "cache", true);
verifier(l.cache === true, "cachée");
regler(l, "cache", false);
verifier(!("cache" in l), "plus cachée : le champ s'en va");
changerType(l, "lune");
verifier(l.type === "lune" && l.rayon === 8 && l.couleur === "#9db8ff", "changer de type remet ses réglages");
regler(l, "couleur", "#123456");
changerType(l, "libre");
verifier(l.type === "libre" && l.couleur === "#123456", "« libre » garde les réglages");
changerType(l, "inconnu");
verifier(l.type === "libre", "un type inconnu ne change rien");

// ---- allumer, éteindre
verifier(allumee(l) && compter(p).allumees === 2, "allumée d'origine");
allumer(l, false);
verifier(!allumee(l) && l.eteinte === true && compter(p).allumees === 1, "éteinte");
allumer(l, true);
verifier(allumee(l) && !("eteinte" in l), "rallumée : le champ s'en va");
verifier(toutAllumer(p, false) === 2 && compter(p).allumees === 0, "tout éteindre");
verifier(toutAllumer(p, false) === 0, "tout éteindre deux fois ne change rien");
verifier(toutAllumer(p, true) === 2 && compter(p).allumees === 2, "tout allumer");

// ---- dupliquer, retirer, noms
const d = dupliquer(p, lumieresDe(p)[0]);
verifier(!!d.lumiere && d.lumiere.id !== lumieresDe(p)[0].id && d.lumiere.piece === 1 && d.lumiere.type === lumieresDe(p)[0].type, "doublon : autre identifiant, même type, sur du sol");
verifier(lumieresDe(p).length === 3, "le doublon s'ajoute");
retirer(p, d.lumiere.id);
verifier(lumieresDe(p).length === 2, "retirer");
const noms = nomsDesLumieres(p).map((n) => n.nom);
verifier(noms.length === 2 && noms.every((n) => n.length > 0), "chaque lumière a un nom dans la liste", noms.join(" | "));
regler(lumieresDe(p)[0], "source", "La torche du couloir");
verifier(nomsDesLumieres(p)[0].nom === "La torche du couloir", "le nom du MJ passe avant celui du type");
verifier(compter(p).total === 2 && compter(p).cachees === 0, "compter");

// ---- le rendu : éteinte = rien, cachée = MJ seulement, case non révélée = rien pour les joueurs
const v = plan();
ajouter(v, "torche", 1.5, 1.5);
ajouter(v, "lune", 2.5, 1.5);
ajouter(v, "bougie", 3.5, 1.5);
ajouter(v, "lanterne", 4.5, 1.5);
const [a, b, c, e4] = lumieresDe(v);
v.brouillard_actif = true;
v.brouillard = new Array(v.largeur * v.hauteur).fill(1);
const coul = (x) => x.map((z) => z.couleur).join(",");
verifier(lumieresVisibles(v, false).length === 4 && lumieresVisibles(v, true).length === 4, "quatre allumées : quatre pour le MJ et pour les joueurs");
allumer(b, false);
verifier(lumieresVisibles(v, false).length === 3 && lumieresVisibles(v, true).length === 3, "une éteinte n'éclaire ni le MJ ni les joueurs");
regler(c, "cache", true);
verifier(lumieresVisibles(v, false).length === 3 && lumieresVisibles(v, true).length === 2, "une cachée n'éclaire que le MJ", `${lumieresVisibles(v, false).length}/${lumieresVisibles(v, true).length}`);
v.brouillard = new Array(v.largeur * v.hauteur).fill(0);
verifier(lumieresVisibles(v, true).length === 0 && lumieresVisibles(v, false).length === 3, "sous le brouillard : rien pour les joueurs");
verifier(!coul(lumieresVisibles(v, true)).includes("undefined"), "couleurs lisibles");
allumer(b, true);
verifier(lumieresVisibles(v, false).length === 4, "rallumée : elle éclaire de nouveau");

if (echecs.length) {
  console.log(echecs.map((x) => `ÉCHEC ${x}`).join("\n"));
  console.log(`${echecs.length} échec(s) sur ${essais} vérifications.`);
  process.exit(1);
}
console.log(`${essais} vérifications, aucun défaut.`);
