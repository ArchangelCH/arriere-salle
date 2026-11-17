// Vérifie l'état du moment des héros (app/static/js/aventuriers/etat.js et son socle dans combats/suivi.js) : l'état
// posé sur la fiche, le résumé, les champs envoyés, les repos du kit, l'or et les gestes sur le sac.
// node outils/verifier_etat_heros.mjs

import {
  avecGeste, champsChanges, champsDe, corpsDuSac, enPleineForme, etatComplet, ligneRepos, listeDuSac, poserEtat, repos, resumeEtat,
  resumeSac, reunirChamps, saisieOr, valeursAvant,
} from "../app/static/js/aventuriers/etat.js";
import { etatDuMoment, herosDepuis, jetonApres, santePosee } from "../app/static/js/combats/suivi.js";

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

const tavarede = { id: "t", nom: "Tavarède Lavelle", sante: 7, psy: 5, posture: "focus", couleur: "#ae00ff" };

// L'état posé sur la fiche.
egal(etatDuMoment(tavarede), { max: 7, sante: 7, psyMax: 5, psy: 5, santeDon: 0, cartons: {}, avantage: "" }, "sans état : en pleine forme");
egal(etatDuMoment(tavarede, { sante: 3, psy: 1, santeDon: 2, cartons: { physique: "jaune", social: "violet", pied: "rouge" } }),
  { max: 7, sante: 3, psyMax: 5, psy: 1, santeDon: 2, cartons: { physique: "jaune" }, avantage: "" }, "état du moment, cartons inconnus retirés");
egal(etatDuMoment(tavarede, { sante: 12, psy: -3, santeDon: 9 }), { max: 7, sante: 7, psyMax: 5, psy: 0, santeDon: 0, cartons: {}, avantage: "" }, "bornes de la fiche");
egal(etatDuMoment(tavarede, { sante: 5, santeDon: 9 }).santeDon, 2, "Santé payée jamais plus que ce qui manque");
egal(etatDuMoment(tavarede, { sante: -4 }).sante, -4, "le coma se garde");
egal(etatDuMoment(tavarede, { sante: "3", psy: null }), etatDuMoment(tavarede), "valeurs illisibles : au maximum");
egal(etatComplet(tavarede, { notes: "empoisonné" }).notes, "empoisonné", "la note du MJ");
egal(etatComplet(tavarede, { notes: 4 }).notes, "", "note illisible");
ok(enPleineForme(etatComplet(tavarede)) && !enPleineForme(etatComplet(tavarede, { cartons: { mental: "rouge" } })), "pleine forme");

// Le jeton d'avantage : un seul à la fois, l'autre l'annule, le même se joue (retiré), inconnu ignoré.
egal(etatDuMoment(tavarede, { avantage: "avantage" }).avantage, "avantage", "jeton gardé");
egal(etatDuMoment(tavarede, { avantage: "double" }).avantage, "", "jeton inconnu ignoré");
egal(herosDepuis(tavarede, "", { avantage: "desavantage" }).avantage, "desavantage", "le combat reprend le jeton");
egal(["", "avantage", "desavantage"].map((x) => [jetonApres(x, "avantage"), jetonApres(x, "desavantage")]),
  [["avantage", "desavantage"], ["", ""], ["", ""]], "gestes sur le jeton");
egal(jetonApres("avantage", "rien"), "", "geste inconnu : plus de jeton");
{
  const a = etatComplet(tavarede);
  egal(champsChanges(a, { ...a, avantage: "avantage" }), { avantage: "avantage" }, "un jeton posé");
  egal(champsChanges({ ...a, avantage: "avantage" }, a), { avantage: null }, "un jeton joué");
  ok(!enPleineForme({ ...a, avantage: "desavantage" }), "un jeton : plus en pleine forme");
  egal(resumeEtat({ ...a, avantage: "desavantage" }), "Santé 7/7, Psy 5/5, jeton désavantage", "résumé avec le jeton");
  egal(poserEtat({ avantage: "avantage", sante: 3 }, { avantage: null }), { sante: 3 }, "jeton retiré comme le serveur");
}

// Le combat part de l'état ; sans état, le même héros qu'avant (mêmes clés, même ordre).
egal(herosDepuis(tavarede), { id: "t", nom: "Tavarède Lavelle", couleur: "#ae00ff", max: 7, sante: 7, psyMax: 5, psy: 5, santeDon: 0, posture: "focus", cartons: {} },
  "héros sans état");
egal(herosDepuis(tavarede, "", { sante: 2, psy: 0, santeDon: 3, cartons: { mental: "rouge" }, notes: "x" }),
  { id: "t", nom: "Tavarède Lavelle", couleur: "#ae00ff", max: 7, sante: 2, psyMax: 5, psy: 0, santeDon: 3, posture: "focus", cartons: { mental: "rouge" } },
  "héros repris du combat d'avant, sans la note");

// La Santé posée : coma, réveil avec un carton jaune en Physique, Santé payée bornée.
{
  const x = { max: 7, sante: 2, santeDon: 2, cartons: {} };
  let r = santePosee(x, -1);
  ok(r.coma && !r.reveil && r.heros.sante === -1 && r.heros.santeDon === 2, "tombe dans le coma");
  r = santePosee({ ...x, sante: -1 }, 3);
  ok(r.reveil && r.heros.cartons.physique === "jaune" && x.cartons.physique === undefined, "réveil, carton jaune, sans toucher l'état d'avant");
  r = santePosee({ ...x, sante: -1, cartons: { physique: "rouge" } }, 3);
  egal(r.heros.cartons, { physique: "rouge" }, "réveil sur un rouge : il reste rouge");
  egal(santePosee({ max: 7, sante: 3, santeDon: 3 }, 6).heros.santeDon, 1, "Santé payée jamais plus que ce qui manque");
  ok(!("santeDon" in santePosee({ max: 7, sante: 3 }, 5).heros), "ancien format : pas de Santé payée inventée");
}

// Le résumé.
egal(resumeEtat(etatComplet({ sante: 8, psy: 5 }, { sante: 5, psy: 2, cartons: { physique: "jaune" } })), "Santé 5/8, Psy 2/5, carton jaune en Physique", "résumé");
egal(resumeEtat(etatComplet(tavarede, { sante: 3, santeDon: 2, psy: 0, cartons: { physique: "jaune", mental: "rouge" } }), { sep: " · " }),
  "Santé 3/7 dont 2 payés faute de Psy · Psy 0/5 · carton jaune en Physique et rouge en Mental", "résumé court");
egal(resumeEtat(etatComplet(tavarede, { sante: -2, notes: "empoisonné" })), "Santé −2/7, dans le coma, Psy 5/5", "coma, sans la note");
egal(resumeEtat(etatComplet(tavarede, { santeDon: 1, sante: 6, notes: "empoisonné" }), { notes: true }), "Santé 6/7 dont 1 payé faute de Psy, Psy 5/5, empoisonné", "avec la note");

// Les champs envoyés : au maximum, vides ; seulement ce qui change, carton par carton.
{
  const a = etatComplet(tavarede, { sante: 3, cartons: { physique: "jaune" } });
  egal(champsDe(a), { sante: 3, psy: null, santeDon: null, cartons: { physique: "jaune", social: null, mental: null }, avantage: null }, "champs d'un état");
  egal(champsChanges(a, { ...a, sante: 7 }), { sante: null }, "rendu au maximum : vide");
  egal(champsChanges(a, { ...a, cartons: { physique: "jaune", mental: "rouge" } }), { cartons: { mental: "rouge" } }, "un carton seul");
  egal(champsChanges(a, { ...a, cartons: {} }), { cartons: { physique: null } }, "un carton retiré");
  egal(champsChanges(a, a), {}, "rien ne change");
  egal(reunirChamps({ sante: 3, cartons: { physique: "jaune" } }, { psy: 1, cartons: { mental: "rouge" } }),
    { sante: 3, cartons: { physique: "jaune", mental: "rouge" }, psy: 1 }, "deux lots réunis");
  egal(reunirChamps({ sante: 3 }, { sante: null }), { sante: null }, "le plus récent l'emporte");
  egal(poserEtat({ sante: 3, cartons: { physique: "jaune" }, notes: "x" }, { sante: null, cartons: { physique: null, mental: "rouge" }, notes: "", psy: 2 }),
    { cartons: { mental: "rouge" }, psy: 2 }, "fusion comme le serveur");
  egal(poserEtat({ cartons: { physique: "jaune" } }, { cartons: { physique: null } }), {}, "plus de cartons");
  egal(poserEtat(null, { santeDon: 0 }), {}, "Santé payée à 0 : rien");
}

// Les repos du kit.
{
  const x = etatComplet(tavarede, { sante: 3, santeDon: 2, psy: 1, cartons: { physique: "jaune", mental: "rouge" } });
  let r = repos("nuit", x, { de: 4 });
  egal([r.apres.sante, r.apres.santeDon, r.apres.psy, r.apres.cartons], [5, 2, 5, { mental: "rouge" }], "nuit : +3 sans la Santé payée, +1D6 Psy, jaunes retirés");
  egal(r.changements, ["Santé 3 → 5 sur 7 (2 points payés faute de Psy attendent une journée de repos)", "Psy 1 → 5 sur 5 (1D6 : 4)",
    "carton jaune en Physique retiré", "carton rouge en Mental gardé"], "nuit : ce qui change");
  r = repos("journee", x, { de: 1 });
  egal([r.apres.sante, r.apres.santeDon, r.apres.psy, r.apres.cartons], [7, 0, 2, { mental: "rouge" }], "journée : la Santé payée revient");
  r = repos("nuit", x, { de: 6, mauvaises: true });
  egal([r.apres.sante, r.apres.santeDon, r.apres.psy, r.apres.cartons], [3, 2, 5, x.cartons], "mauvaises conditions : la Psy seule");
  egal(r.changements, ["Santé 3 sur 7 (2 points payés faute de Psy attendent une journée de repos)", "Psy 1 → 5 sur 5 (1D6 : 6)"], "mauvaises conditions : ce qui change");
  r = repos("journee", x, { de: 2, mauvaises: true });
  egal([r.apres.sante, r.apres.santeDon], [3, 2], "journée en mauvaises conditions : rien de la Santé");
  r = repos("neuf", x);
  egal([r.apres.sante, r.apres.santeDon, r.apres.psy, r.apres.cartons], [7, 0, 5, {}], "remis à neuf");
  egal(r.changements, ["Santé 3 → 7 sur 7", "Psy 1 → 5 sur 5", "cartons jaune en Physique et rouge en Mental retirés"], "remis à neuf : ce qui change");
  // Encore dans le coma : réveil à 1 (et son carton jaune, que la nuit retire), puis la nuit.
  const coma = etatComplet(tavarede, { sante: -2 });
  r = repos("nuit", coma, { de: 3 });
  egal([r.apres.sante, r.apres.cartons], [4, {}], "coma : réveil puis nuit");
  egal(r.changements, ["sort du coma à 1", "Santé −2 → 4 sur 7", "Psy déjà pleine (1D6 : 3)"], "coma : ce qui change");
  r = repos("nuit", coma, { de: 3, mauvaises: true });
  egal([r.apres.sante, r.apres.cartons], [1, { physique: "jaune" }], "coma, mauvaises conditions : réveil à 1, carton jaune");
  egal(r.changements, ["sort du coma à 1", "Santé −2 → 1 sur 7", "Psy déjà pleine (1D6 : 3)", "carton jaune en Physique au réveil"], "coma, mauvaises conditions");
  // Juste sous le plafond : la nuit ne fait jamais baisser.
  r = repos("nuit", etatComplet(tavarede, { sante: 6, santeDon: 2 }), { de: 1 });
  egal([r.apres.sante, r.apres.santeDon], [6, 1], "au plafond : rien de plus");
  egal(r.changements[0], "Santé 6 sur 7 (1 point payé faute de Psy attend une journée de repos)", "au plafond : ce qui attend");
  r = repos("nuit", etatComplet(tavarede), { de: 5 });
  egal(r.changements, ["Psy déjà pleine (1D6 : 5)"], "en pleine forme");
  egal(champsChanges(etatComplet(tavarede, { sante: 3 }), repos("nuit", etatComplet(tavarede, { sante: 3 }), { de: 2 }).apres), { sante: 6 }, "champs d'une nuit");
  egal(ligneRepos("nuit", [{ nom: "Tavarède Lavelle", changements: ["Santé 3 → 6 sur 7", "Psy déjà pleine (1D6 : 2)"] }, { nom: "Eloran de la maison Amberel", changements: [] }], { mauvaises: true }),
    "Nuit de repos, dans de mauvaises conditions. Tavarède : Santé 3 → 6 sur 7, Psy déjà pleine (1D6 : 2). Eloran : rien ne change.", "ligne du journal");
  egal(ligneRepos("neuf", [{ nom: "Velora", changements: ["Psy 1 → 4 sur 4"] }], { mauvaises: true }), "Remettre à neuf. Velora : Psy 1 → 4 sur 4.", "remettre à neuf au journal");
  // Les valeurs d'avant qui partent avec le repos : celles du serveur, seulement pour les champs changés.
  const enregistre = { sante: 2, psy: 1, cartons: { mental: "jaune", social: "rouge" }, notes: "x", modifie: "t" };
  const xr = etatComplet(tavarede, enregistre);
  const champsNuit = champsChanges(xr, repos("nuit", xr, { de: 6 }).apres);
  egal(champsNuit, { sante: 5, psy: null, cartons: { mental: null } }, "champs d'une nuit, carton jaune");
  egal(valeursAvant(enregistre, champsNuit), { sante: 2, psy: 1, cartons: { mental: "jaune" } }, "valeurs d'avant de la nuit");
  egal(valeursAvant(undefined, { sante: 5, santeDon: null, cartons: { physique: "jaune" } }), { sante: null, santeDon: null, cartons: { physique: null } }, "sans état : tout au maximum");
  egal(valeursAvant({ sante: 0, psy: 0, cartons: { mental: "violet" } }, { sante: 1, psy: 3, cartons: { mental: null } }), { sante: 0, psy: 0, cartons: { mental: null } }, "zéro gardé, carton inconnu");
  egal(valeursAvant(enregistre, {}), {}, "rien à changer, rien d'attendu");
}

// L'or.
egal(saisieOr("+5", 110), { or: 115 }, "or +5");
egal(saisieOr(" − 3", 110), { or: 107 }, "or −3");
egal(saisieOr("=40", 110), { or: 40 }, "or =40");
egal(saisieOr("+5", null), { or: 5 }, "bourse vide");
ok(saisieOr("5", 110).erreur && saisieOr("abc", 110).erreur && saisieOr("", 1).erreur, "or sans signe : refusé, avec l'aide");
egal(saisieOr("-200", 110), { erreur: "La bourse n'a que 110 pièces d'or." }, "pas sous zéro");
egal(saisieOr("-2", 1), { erreur: "La bourse n'a que 1 pièce d'or." }, "pas sous zéro, une pièce");

// Les gestes sur le sac.
{
  const f = { id: "t", or: 110, equipement: ["Matériel de camp", "", "Corde"], objets: ["Un harmonica"] };
  egal(listeDuSac(f, "objets"), ["Un harmonica", "", ""], "objets en trois cases");
  egal(listeDuSac({ equipement: [3, null] }, "equipement"), ["3", ""], "équipement en textes");
  egal(corpsDuSac(f, { genre: "or", texte: "+5" }), { or: { avant: 110, apres: 115 } }, "or");
  egal(corpsDuSac(f, { genre: "or", texte: "=110" }), {}, "or inchangé");
  egal(corpsDuSac(f, { genre: "ajouter", liste: "equipement", texte: "  Torche   longue " }),
    { equipement: { avant: f.equipement, apres: ["Matériel de camp", "Torche longue", "Corde"] } }, "ajouter : la première ligne vide");
  egal(corpsDuSac({ equipement: ["Corde"] }, { genre: "ajouter", liste: "equipement", texte: "Torche" }).equipement.apres, ["Corde", "Torche"], "ajouter à la fin");
  egal(corpsDuSac({}, { genre: "ajouter", liste: "equipement", texte: "Torche" }), { equipement: { avant: [], apres: ["Torche"] } }, "ajouter sans équipement");
  egal(corpsDuSac(f, { genre: "ajouter", liste: "objets", texte: "Une plume" }).objets.apres, ["Un harmonica", "Une plume", ""], "objet : première case vide");
  ok(corpsDuSac({ objets: ["a", "b", "c"] }, { genre: "ajouter", liste: "objets", texte: "d" }).erreur, "trois objets pris");
  egal(corpsDuSac(f, { genre: "changer", liste: "equipement", rang: 2, avant: "Corde", texte: "Corde usée" }).equipement.apres,
    ["Matériel de camp", "", "Corde usée"], "changer une ligne");
  egal(corpsDuSac({ equipement: ["Torche", "Matériel de camp", "", "Corde"] }, { genre: "changer", liste: "equipement", rang: 2, avant: "Corde", texte: "Corde usée" }).equipement.apres,
    ["Torche", "Matériel de camp", "", "Corde usée"], "la ligne a bougé : retrouvée par son texte");
  ok(corpsDuSac(f, { genre: "changer", liste: "equipement", rang: 2, avant: "Lanterne", texte: "x" }).erreur, "ligne disparue : refus");
  egal(corpsDuSac(f, { genre: "changer", liste: "equipement", rang: 0, avant: "Matériel de camp", texte: " Matériel de camp " }), {}, "même texte : rien");
  egal(corpsDuSac(f, { genre: "retirer", liste: "equipement", rang: 2, avant: "Corde" }).equipement.apres, ["Matériel de camp", ""], "retirer de l'équipement");
  egal(corpsDuSac(f, { genre: "changer", liste: "equipement", rang: 0, avant: "Matériel de camp", texte: "" }).equipement.apres, ["", "Corde"], "vider une ligne : retirée");
  egal(corpsDuSac(f, { genre: "retirer", liste: "objets", rang: 0, avant: "Un harmonica" }).objets.apres, ["", "", ""], "retirer un objet : la case reste");
  ok(corpsDuSac(f, { genre: "ajouter", liste: "armes", texte: "Épée" }).erreur, "les armes ne sont pas dans le sac");
  egal(avecGeste(f, { genre: "or", texte: "-10" }).or, 100, "fiche avec le geste");
  ok(avecGeste(f, { genre: "or", texte: "-1000" }) === f, "geste qui ne s'applique pas : fiche inchangée");
  egal(resumeSac(f), "110 pièces d'or, 3 objets", "résumé du sac");
  egal(resumeSac({ or: 1 }), "1 pièce d'or, aucun objet", "sac presque vide");
  egal(resumeSac({ objets: ["a"] }), "1 objet", "sans bourse");
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Aucun défaut (${verifs} vérifications).`);
process.exit(defauts ? 1 : 0);
