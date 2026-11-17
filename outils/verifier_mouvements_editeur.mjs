// L'éditeur de plan reçoit le déplacement d'un joueur (js/plan/mouvements-joueurs.js) sans rien perdre, sans navigateur :
// le pion glisse s'il est encore où le joueur l'a vu, le geste du MJ gagne sur le même pion (déplacé de son côté, ou tenu
// en main), la pièce entrée se révèle, les portes ouvertes en passant s'ouvrent (lot E4, sauf celles que le MJ a changées),
// la version du plan suit seulement quand l'éditeur était à jour, un mouvement reçu deux fois (le canal puis la réponse
// d'un enregistrement) ne s'applique qu'une fois, et l'historique (Ctrl+Z) garde le geste du joueur dans chaque instantané.
//   node outils/verifier_mouvements_editeur.mjs
import { corrigerInstantane, pionsApres, portesApres, recevoirMouvements } from "../app/static/js/plan/mouvements-joueurs.js";

let echecs = 0;
let essais = 0;
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) {
    echecs++;
    console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};

const plan = () => ({
  id: "p", largeur: 4, hauteur: 2, modifie: "v0", brouillard: [1, 1, 0, 0, 1, 1, 0, 0],
  pions: [{ id: "a", genre: "heros", x: 0.5, y: 0.5 }, { id: "b", genre: "heros", x: 1.5, y: 1.5 }],
  portes: [{ id: "d1", sens: "v", x: 2, y: 0, genre: "porte", etat: "fermee" }, { id: "d2", sens: "v", x: 2, y: 1, genre: "porte", etat: "verrouillee" }],
});
const mouvement = (champs = {}) => ({
  id: "m1", pion: "a", avant: [0.5, 0.5], apres: [1.5, 0.5], cases: [], brouillard: 1, w: 4, h: 2,
  version_avant: "v0", version_apres: "v1", alertes: [], ...champs,
});

// Un éditeur sans page : juste ce que lit et touche recevoirMouvements.
function editeur(p = plan()) {
  const vue = { plan: p, glisses: [], structures: 0, majPions(pions) { this.glisses.push(pions.map((t) => t.id)); this.plan.pions = pions; }, majStructure() { this.structures++; }, demander() {} };
  return { plan: p, vue, passe: [], futur: [], detruit: false, glisse: null, selection: null, panneau: null, afficherPanneau() {} };
}
const ou = (ed, id) => {
  const t = ed.plan.pions.find((x) => x.id === id);
  return [t.x, t.y];
};
// Ce que l'éditeur dit au MJ, relevé au lieu d'un toast.
const dits = [];
const dire = (texte, genre = "info") => dits.push([texte, genre]);
const etat = (p) => JSON.stringify({ pions: p.pions, brouillard: p.brouillard, portes: p.portes, largeur: p.largeur, hauteur: p.hauteur });
const OUVRE = [{ sens: "v", x: 2, y: 0, avant: "fermee", apres: "ouverte" }];

// Le pion glisse, la version suit.
{
  const ed = editeur();
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(JSON.stringify(ou(ed, "a")) === "[1.5,0.5]" && ed.plan.modifie === "v1" && ed.vue.glisses.length === 1, "le pion glisse et la version suit", JSON.stringify([ou(ed, "a"), ed.plan.modifie]));
  // Reçu une seconde fois (la réponse d'un enregistrement qui l'a rejoué) : rien de plus.
  recevoirMouvements(ed, [mouvement()], { version: false, dire });
  verifier(ed.vue.glisses.length === 1, "un mouvement reçu deux fois ne s'applique qu'une fois");
}

// L'éditeur n'était pas à jour : la version ne bouge pas (le serveur rejouera).
{
  const ed = editeur({ ...plan(), modifie: "v-autre" });
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(ed.plan.modifie === "v-autre" && JSON.stringify(ou(ed, "a")) === "[1.5,0.5]", "en retard : le pion se pose, la version reste");
}

// Le MJ a déplacé le même pion de son côté : son geste gagne, mais la version suit (il enregistrera par-dessus).
{
  const ed = editeur();
  ed.plan.pions[0] = { ...ed.plan.pions[0], x: 3.5, y: 1.5 };
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(JSON.stringify(ou(ed, "a")) === "[3.5,1.5]" && ed.vue.glisses.length === 0 && ed.plan.modifie === "v1", "le geste du MJ gagne sur le même pion");
}

// Le MJ tient ce pion en main (un glissé en cours) : rien ne le lui arrache.
{
  const ed = editeur();
  ed.glisse = { type: "objet", sel: { genre: "pion", id: "a" } };
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(JSON.stringify(ou(ed, "a")) === "[0.5,0.5]" && ed.vue.glisses.length === 0, "un pion tenu en main ne bouge pas");
}

// Un autre pion tenu en main : celui du joueur bouge quand même.
{
  const ed = editeur();
  ed.glisse = { type: "objet", sel: { genre: "pion", id: "b" } };
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(JSON.stringify(ou(ed, "a")) === "[1.5,0.5]", "un autre pion tenu en main n'empêche rien");
}

// La pièce entrée se révèle, sur les seules cases notées ; un plan d'une autre taille ne change pas.
{
  const ed = editeur();
  recevoirMouvements(ed, [mouvement({ cases: [2, 3, 6, 7] })], { dire });
  verifier(JSON.stringify(ed.plan.brouillard) === "[1,1,1,1,1,1,1,1]" && ed.vue.structures === 1, "la pièce entrée se révèle", JSON.stringify(ed.plan.brouillard));
  const autre = editeur({ ...plan(), largeur: 5, hauteur: 2, brouillard: [1, 1, 0, 0, 0, 1, 1, 0, 0, 0] });
  recevoirMouvements(autre, [mouvement({ id: "m2", cases: [2, 3] })], { dire });
  verifier(JSON.stringify(autre.plan.brouillard) === "[1,1,0,0,0,1,1,0,0,0]", "un plan retaillé ne se révèle pas d'après d'anciennes cases");
}

// Le MJ est prévenu d'une entrée dans une pièce cachée (le prénom du héros), et d'un pion caché sur la case d'arrivée.
{
  dits.length = 0;
  const ed = editeur();
  ed.plan.pions[0].nom = "Aude de Valcombe";
  recevoirMouvements(ed, [mouvement({ id: "m-entre", cases: [2], alertes: ["Un pion que les joueurs ne voient pas est sur cette case : Gobelin."] })], { dire });
  verifier(dits.length === 2 && dits[0][0] === "Aude entre dans une pièce cachée : elle se révèle aux joueurs." && dits[1][1] === "erreur" && /Gobelin/.test(dits[1][0]),
    "le MJ apprend l'entrée et le pion caché", JSON.stringify(dits));
}

// L'historique : Ctrl+Z après le geste du joueur ne le défait pas, ni Ctrl+Maj+Z.
{
  const ed = editeur();
  const avantMur = plan();
  avantMur.pions = avantMur.pions.map((t) => ({ ...t }));
  ed.passe = [etat(avantMur)];
  ed.futur = [etat({ ...plan(), pions: [{ id: "a", x: 0.5, y: 0.5 }, { id: "b", x: 3.5, y: 0.5 }] })];
  recevoirMouvements(ed, [mouvement({ cases: [2, 3] })], { dire });
  const passe = JSON.parse(ed.passe[0]);
  const futur = JSON.parse(ed.futur[0]);
  verifier(JSON.stringify([passe.pions[0].x, passe.pions[0].y]) === "[1.5,0.5]" && passe.brouillard[2] === 1, "Ctrl+Z garde le geste du joueur", ed.passe[0]);
  verifier(JSON.stringify([futur.pions[0].x, futur.pions[0].y]) === "[1.5,0.5]" && futur.pions[1].x === 3.5, "Ctrl+Maj+Z aussi, sans toucher au reste", ed.futur[0]);
}

// L'historique d'un pion que le MJ a déplacé lui-même n'est pas réécrit (son geste gagne).
{
  const ed = editeur();
  ed.plan.pions[0] = { ...ed.plan.pions[0], x: 3.5, y: 1.5 };
  ed.passe = [etat(plan())];
  recevoirMouvements(ed, [mouvement()], { dire });
  verifier(JSON.parse(ed.passe[0]).pions[0].x === 0.5, "le MJ qui défait son propre geste le retrouve");
}

// Un instantané illisible, ou sans ce pion, reste tel quel.
verifier(corrigerInstantane("{pas du json", mouvement()) === "{pas du json", "un instantané illisible reste tel quel");
verifier(corrigerInstantane(JSON.stringify({ pions: [] }), mouvement()) === JSON.stringify({ pions: [] }), "un instantané sans ce pion reste tel quel");
verifier(pionsApres([{ id: "a", x: 1.5, y: 0.5 }], mouvement()) === null, "un pion déjà à sa place ne glisse pas");

// Une annulation (le pion revient, la pièce se cache de nouveau) suit le même chemin.
{
  const ed = editeur();
  recevoirMouvements(ed, [mouvement({ cases: [2] })], { dire });
  recevoirMouvements(ed, [mouvement({ id: "m3", avant: [1.5, 0.5], apres: [0.5, 0.5], cases: [2], brouillard: 0, version_avant: "v1", version_apres: "v2" })], { dire });
  verifier(JSON.stringify(ou(ed, "a")) === "[0.5,0.5]" && ed.plan.brouillard[2] === 0 && ed.plan.modifie === "v2", "une annulation remet pion et brouillard");
}

// Lot E4 : la porte que le héros a ouverte en passant s'ouvre dans l'éditeur, le MJ en est prévenu, la vue se repeint.
{
  dits.length = 0;
  const ed = editeur();
  ed.plan.pions[0].nom = "Aude de Valcombe";
  recevoirMouvements(ed, [mouvement({ id: "m-porte", apres: [2.5, 0.5], portes: OUVRE })], { dire });
  verifier(ed.plan.portes[0].etat === "ouverte" && ed.plan.portes[1].etat === "verrouillee" && ed.vue.structures === 1,
    "la porte ouverte par le héros s'ouvre, et seulement elle", JSON.stringify(ed.plan.portes));
  verifier(dits.length === 1 && dits[0][0] === "Aude ouvre une porte en passant.", "le MJ apprend la porte ouverte", JSON.stringify(dits));
}

// Une porte que le MJ a verrouillée (ou ôtée) de son côté garde son geste.
{
  const ed = editeur();
  ed.plan.portes[0].etat = "verrouillee";
  recevoirMouvements(ed, [mouvement({ portes: OUVRE })], { dire });
  verifier(ed.plan.portes[0].etat === "verrouillee", "une porte verrouillée par le MJ entre-temps reste verrouillée");
  const sans = editeur({ ...plan(), portes: [] });
  verifier(portesApres(sans.plan, mouvement({ portes: OUVRE })) === 0, "une porte ôtée ne revient pas");
}

// Ctrl+Z après l'ouverture ne referme pas la porte ; « Annuler » de la boîte la referme, sans un mot « ouvre ».
{
  dits.length = 0;
  const ed = editeur();
  ed.passe = [etat(plan())];
  recevoirMouvements(ed, [mouvement({ id: "m-p1", portes: OUVRE, cases: [2], revele: "autour" })], { dire });
  verifier(JSON.parse(ed.passe[0]).portes[0].etat === "ouverte", "Ctrl+Z garde la porte ouverte par le joueur", ed.passe[0]);
  verifier(dits.some(([t]) => t === "Aude avance dans le noir : ses alentours se révèlent aux joueurs.") || dits.some(([t]) => /avance dans le noir/.test(t)),
    "une révélation autour du héros se dit autrement qu'une pièce entière", JSON.stringify(dits));
  dits.length = 0;
  recevoirMouvements(ed, [mouvement({ id: "m-p2", genre: "annulation", avant: [1.5, 0.5], apres: [0.5, 0.5], cases: [2], brouillard: 0,
    portes: [{ sens: "v", x: 2, y: 0, avant: "ouverte", apres: "fermee" }], version_avant: "v1", version_apres: "v2" })], { dire });
  verifier(ed.plan.portes[0].etat === "fermee" && ed.plan.brouillard[2] === 0 && !dits.some(([t]) => /ouvre/.test(t)),
    "« Annuler » referme la porte et recache, sans dire qu'on ouvre", JSON.stringify([ed.plan.portes, dits]));
}

console.log(echecs ? `${echecs} échec(s) sur ${essais}` : `mouvements dans l'éditeur : ${essais}/${essais}`);
process.exit(echecs ? 1 : 0);
