// Vérifie la sélection de plusieurs pions de l'éditeur de plan (js/plan/groupe-pions.js) sans navigateur : la sélection
// (rien, un pion, plusieurs), Maj + clic qui ajoute et retire, le rectangle, les montures et cavaliers emmenés une seule
// fois, la formation gardée quand le groupe touche le bord du plan (au glissé comme aux flèches), et le déplacement d'un
// joueur qui n'arrache pas au MJ un pion du groupe qu'il tient en main (js/plan/mouvements-joueurs.js).
//   node outils/verifier_groupe_pions.mjs
import {
  anneauxDe, avecLesSelles, basculer, dansRectangle, idsDe, pasDuGroupe, placeDuGroupe, selectionDe, suiveurs,
} from "../app/static/js/plan/groupe-pions.js";
import { recevoirMouvements } from "../app/static/js/plan/mouvements-joueurs.js";

let echecs = 0;
let essais = 0;
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) {
    echecs++;
    console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};
const pareil = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pions = () => [
  { id: "a", genre: "heros", x: 1.5, y: 1.5 },
  { id: "b", genre: "heros", x: 2.5, y: 1.5 },
  { id: "c", genre: "ennemi", x: 5.5, y: 3.5 },
  { id: "cheval", genre: "autre", x: 3.5, y: 3.5 },
  { id: "cavalier", genre: "heros", x: 3.5, y: 3.5, monture: "cheval" },
  { id: "ogre", genre: "ennemi", x: 6, y: 6, taille: 2 },
];

// La sélection.
verifier(selectionDe(pions(), []) === null && selectionDe(pions(), ["parti"]) === null, "rien de choisi : pas de sélection");
verifier(pareil(selectionDe(pions(), ["a"]), { genre: "pion", id: "a" }), "un seul pion : la sélection simple d'avant");
verifier(pareil(selectionDe(pions(), ["a", "b", "a", "parti"]), { genre: "pions", ids: ["a", "b"] }), "plusieurs : sans doublon ni pion parti");
verifier(pareil(idsDe(null), []) && pareil(idsDe({ genre: "piece", id: 3 }), []) && pareil(idsDe({ genre: "pion", id: "a" }), ["a"]) && pareil(idsDe({ genre: "pions", ids: ["a", "b"] }), ["a", "b"]), "les pions d'une sélection");
verifier(anneauxDe(null) === null && anneauxDe({ genre: "meuble", id: "m" }) === null && anneauxDe({ genre: "pion", id: "a" }) === "a" && pareil(anneauxDe({ genre: "pions", ids: ["a", "b"] }), ["a", "b"]), "les anneaux de la vue : rien, un identifiant, une liste");
verifier(pareil(basculer(["a"], "b"), ["a", "b"]) && pareil(basculer(["a", "b"], "a"), ["b"]) && pareil(basculer([], "a"), ["a"]), "Maj + clic ajoute, puis retire");

// Le rectangle, tracé dans n'importe quel sens.
verifier(pareil(dansRectangle(pions(), { x0: 1, y0: 1, x1: 3, y1: 2 }), ["a", "b"]), "le rectangle prend les pions dont le centre est dedans");
verifier(pareil(dansRectangle(pions(), { x0: 3, y0: 2, x1: 1, y1: 1 }), ["a", "b"]), "tracé à l'envers, le même");
verifier(pareil(dansRectangle(pions(), { x0: 0, y0: 0, x1: 0.4, y1: 0.4 }), []), "un rectangle vide ne prend rien");
verifier(pareil(dansRectangle(pions(), { x0: 0, y0: 0, x1: 9, y1: 9 }, (t) => t.genre === "heros"), ["a", "b", "cavalier"]), "on peut laisser de côté ce que la vue ne montre pas");

// Montures et cavaliers.
verifier(pareil(avecLesSelles(pions(), ["a", "cavalier"]).map((t) => t.id), ["a", "cavalier", "cheval"]), "le cavalier emmène sa monture");
verifier(pareil(avecLesSelles(pions(), ["cheval", "cavalier", "cheval"]).map((t) => t.id), ["cheval", "cavalier"]), "chacun une seule fois");
const liste = pions();
const suite = suiveurs(liste, ["a", "b", "cavalier"], liste[0]);
verifier(pareil(suite, [{ id: "b", dx: 1, dy: 0, depart: [2.5, 1.5] }, { id: "cavalier", dx: 2, dy: 2, depart: [3.5, 3.5] }, { id: "cheval", dx: 2, dy: 2, depart: [3.5, 3.5] }]), "ceux qui suivent le pion tiré, avec leur écart", JSON.stringify(suite));
verifier(pareil(suiveurs(liste, [], liste[4]).map((m) => m.id), ["cheval"]), "sans groupe : le cavalier et sa monture, comme avant");

// La formation : le groupe s'arrête en bloc au bord.
const membres = (l, s) => s.map((m) => ({ ...m, t: l.find((t) => t.id === m.id) }));
const W = 10;
const H = 8;
verifier(pareil(placeDuGroupe(liste[0], membres(liste, suite), 4.2, 3.1, W, H), [4.2, 3.1]), "au milieu du plan, le pion tiré va où on le tire");
verifier(pareil(placeDuGroupe(liste[0], membres(liste, suite), -3, -3, W, H), [0.5, 0.5]), "en haut à gauche : le pion tiré touche le bord");
verifier(pareil(placeDuGroupe(liste[0], membres(liste, suite), 20, 20, W, H), [7.5, 5.5]), "en bas à droite : le dernier du groupe touche le bord, l'écart reste");
verifier(pareil(placeDuGroupe(liste[5], [], 0, 20, W, H), [1, 7]), "un grand pion seul se borne comme avant");
const large = [{ t: { id: "z", x: 0, y: 0 }, dx: 30, dy: 0 }];
verifier(Number.isFinite(placeDuGroupe(liste[0], large, 5, 5, W, H)[0]), "un groupe plus large que le plan ne donne jamais de place folle");

// Aux flèches.
const groupe = [liste[0], liste[1]];
verifier(pareil(pasDuGroupe(groupe, 1, 0, W, H), [1, 0]) && pareil(pasDuGroupe(groupe, 0, -1, W, H), [0, -1]), "un pas libre");
const auBord = [{ id: "a", x: 0.5, y: 1.5 }, { id: "b", x: 2.5, y: 1.5 }];
verifier(pareil(pasDuGroupe(auBord, -1, 0, W, H), [0, 0]), "contre le bord, personne n'avance : la formation ne se tasse pas");
verifier(pareil(pasDuGroupe([{ id: "a", x: 0.7, y: 1.5 }], -1, 0, W, H), [-0.19999999999999996, 0]) || Math.abs(pasDuGroupe([{ id: "a", x: 0.7, y: 1.5 }], -1, 0, W, H)[0] + 0.2) < 1e-9, "un pion mal calé finit son pas contre le bord, comme avant");
verifier(pareil(pasDuGroupe([liste[5]], 0, 1, W, H), [0, 1]) && pareil(pasDuGroupe([{ ...liste[5], y: 7 }], 0, 1, W, H), [0, 0]), "un grand pion compte son rayon");

// Un joueur bouge un pion que le MJ emmène dans son groupe : le geste du MJ gagne.
function editeur(glisse) {
  const plan = { id: "p", largeur: 6, hauteur: 4, modifie: "v0", brouillard: Array(24).fill(1), pions: [{ id: "a", genre: "heros", x: 0.5, y: 0.5 }, { id: "b", genre: "heros", x: 1.5, y: 0.5 }], portes: [] };
  const vue = { plan, majPions(l) { this.plan.pions = l; plan.pions = l; }, majStructure() {}, demander() {} };
  return { plan, vue, passe: [], futur: [], detruit: false, glisse, selection: { genre: "pions", ids: ["a", "b"] }, panneau: null, afficherPanneau() { this.panneaux = (this.panneaux || 0) + 1; } };
}
const mouvement = { id: "m1", pion: "b", avant: [1.5, 0.5], apres: [3.5, 0.5], cases: [], brouillard: 1, w: 6, h: 4, version_avant: "v0", version_apres: "v1", alertes: [] };
const tenu = editeur({ type: "objet", sel: { genre: "pion", id: "a" }, groupe: [{ id: "b", dx: 1, dy: 0, depart: [1.5, 0.5] }] });
recevoirMouvements(tenu, [mouvement], { dire: () => {} });
verifier(tenu.plan.pions.find((t) => t.id === "b").x === 1.5, "un pion du groupe tenu en main ne part pas sous le geste du MJ");
const libre = editeur(null);
recevoirMouvements(libre, [mouvement], { dire: () => {} });
verifier(libre.plan.pions.find((t) => t.id === "b").x === 3.5 && libre.panneaux === 1, "sans glissé en cours, il part, et le panneau du groupe se relit");
const autre = editeur({ type: "objet", sel: { genre: "pion", id: "a" }, groupe: [] });
recevoirMouvements(autre, [mouvement], { dire: () => {} });
verifier(autre.plan.pions.find((t) => t.id === "b").x === 3.5, "un pion hors du groupe tenu part comme avant");

console.log(`groupe de pions : ${essais - echecs}/${essais}`);
process.exit(echecs ? 1 : 0);
