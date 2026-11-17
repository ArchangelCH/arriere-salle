// Vérifie le suivi du combat (app/static/js/combats/suivi.js) : ordre du tour du kit, saisie de la Santé et de la Psy,
// coma et mort, fuite des sbires, tour suivant, fusion de deux écrans (la main jamais passée deux fois), bilan du journal,
// et la barre du combat (combats/barre.js) : les mêmes mots sur la page, le Tableau et la télécommande. Avec un dossier de
// données en argument (lu seulement), compose aussi les combats des rencontres réelles.
// node outils/verifier_combat.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MOTS, cartonApres, htmlBarre, htmlCartons, htmlPostures, minutes, versQui } from "../app/static/js/combats/barre.js";
import { groupes, planDe } from "../app/static/js/combats/rencontre.js";
import {
  ENNEMIS, adversairesDepuis, bilan, composerOrdre, etatHeros, fusionnerCombat, herosDepuis, lireSaisie, mainChangee, moralDuCombat,
  nouveauCombat, phraseOrdre, precedent, psyDe, saisiePsy, saisieSante, santeDonRestante, seuilMort, suivant,
} from "../app/static/js/combats/suivi.js";

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

// L'ordre du kit : N aventuriers, les ennemis, le reste.
const ids = ["t", "e", "v"];
egal(composerOrdre(ids, 0), [ENNEMIS, "aventurier:t", "aventurier:e", "aventurier:v"], "embuscade");
egal(composerOrdre(ids, 1, ["v"]), ["aventurier:v", ENNEMIS, "aventurier:t", "aventurier:e"], "un choisi");
egal(composerOrdre(ids, 2, ["v"]), ["aventurier:v", "aventurier:t", ENNEMIS, "aventurier:e"], "un choisi, complété");
egal(composerOrdre(ids, 2, ["e", "e", "inconnu", "t"]), ["aventurier:e", "aventurier:t", ENNEMIS, "aventurier:v"], "doublons et inconnus");
egal(composerOrdre(ids, 3), ["aventurier:t", "aventurier:e", "aventurier:v", ENNEMIS], "groupe préparé");
egal(composerOrdre(ids, 9, ["v", "t"]), ["aventurier:v", "aventurier:t", "aventurier:e", ENNEMIS], "plus que le groupe");
egal(composerOrdre([], 2), [ENNEMIS], "sans héros");

const heros = [
  herosDepuis({ id: "t", nom: "Tavarède Lavelle", sante: 7, psy: 5, posture: "focus", couleur: "#ae00ff" }),
  herosDepuis({ id: "e", nom: "Eloran de la maison Amberel", sante: 9, psy: 3, posture: "inconnue" }, "#01006e"),
  herosDepuis({ id: "v", nom: "Velora Dorvan", sante: 8, posture: "defensive" }),
];
egal(heros.map((h) => [h.max, h.sante, h.posture, h.couleur]), [[7, 7, "focus", "#ae00ff"], [9, 9, "focus", "#01006e"], [8, 8, "defensive", ""]], "héros d'après leur fiche");
egal(heros.map((h) => [h.psy, h.psyMax, h.santeDon]), [[5, 5, 0], [3, 3, 0], [0, 0, 0]], "Psy d'après la fiche");
const essai = (avant, choisis) => phraseOrdre({ heros, ordre: composerOrdre(ids, avant, choisis) });
egal(essai(1, ["t"]), "Tavarède, puis les adversaires, puis Eloran et Velora", "phrase à 1");
egal(essai(0), "Les adversaires, puis Tavarède, Eloran et Velora", "phrase en embuscade");
egal(essai(3), "Tavarède, Eloran et Velora, puis les adversaires", "phrase à 3");

// Saisie de la Santé.
egal([lireSaisie("-4", 7), lireSaisie("4", 7), lireSaisie(" − 4 ", 7), lireSaisie("+3", 2), lireSaisie("=12", 2), lireSaisie("=0", 5)], [3, 3, 3, 5, 12, 0], "saisies");
egal([lireSaisie("", 7), lireSaisie("abc", 7), lireSaisie("-4d6", 7), lireSaisie("--4", 7), lireSaisie("1000", 7)], [null, null, null, null, null], "saisies illisibles");

// Saisie de la Psy : un don se paie, ce qui manque est pris sur la Santé (Toma : 2 Psy, un don à 7 → 2 Psy et 5 Santé).
const toma = { id: "th", nom: "Toma", max: 13, sante: 13, psy: 2, psyMax: 2, santeDon: 0 };
const psyDit = (texte, h, fiche) => {
  const r = saisiePsy(texte, h, fiche);
  return r && [r.psy, r.psyMax, r.sante, r.santeDon, r.preleve];
};
egal(psyDit("7", toma), [0, 2, 8, 5, 5], "don plus cher que la Psy");
egal(psyDit("-3", { ...toma, psy: 1 }), [0, 2, 11, 2, 2], "dépenser 3 avec 1 Psy");
egal(psyDit("−2", toma), [0, 2, 13, 0, 0], "don payé en Psy");
egal(psyDit("1", { ...toma, sante: 4, santeDon: 3 }), [1, 2, 4, 3, 0], "Psy suffisante : la Santé ne bouge pas");
egal(psyDit("2", { ...toma, psy: 0, sante: 4, santeDon: 3 }), [0, 2, 2, 5, 2], "Santé payée qui s'ajoute");
egal(psyDit("+5", { ...toma, psy: 0 }), [2, 2, 13, 0, 0], "soins de Psy plafonnés au maximum");
egal(psyDit("+1", { ...toma, psy: 4 }), [4, 2, 13, 0, 0], "au-dessus du maximum, des soins ne retirent rien");
egal(psyDit("=6", toma), [6, 2, 13, 0, 0], "« = » fixe ce que veut le MJ");
egal(psyDit("=0", toma), [0, 2, 13, 0, 0], "« =0 »");
egal([psyDit("", toma), psyDit("=-1", toma), psyDit("2d6", toma), psyDit("1000", toma)], [null, null, null, null], "saisies de Psy illisibles");
// Un combat commencé avant le suivi de la Psy : elle part pleine, de la fiche.
egal(psyDe({ sante: 3, max: 7 }, { psy: 4 }), { psy: 4, psyMax: 4, santeDon: 0 }, "ancien combat : Psy de la fiche");
egal(psyDe({ sante: 3, max: 7 }), { psy: 0, psyMax: 0, santeDon: 0 }, "ancien combat sans fiche");
egal(psyDit("6", { id: "x", sante: 7, max: 7 }, { psy: 4 }), [0, 4, 5, 2, 2], "ancien combat : payer un don");
// La Santé payée en dons ne dépasse jamais ce qui manque (« =N » la fait baisser).
egal([santeDonRestante({ max: 9, sante: 4, santeDon: 3 }), santeDonRestante({ max: 9, sante: 7, santeDon: 3 }), santeDonRestante({ max: 9, sante: 12, santeDon: 3 }),
  santeDonRestante({ max: 9, sante: 2 })], [3, 2, 0, 0], "Santé payée bornée par ce qui manque");

// Saisie de la Santé : des soins s'arrêtent avant la Santé payée en dons (elle ne revient qu'après une journée entière de
// repos), seul « =N » la rend. Comme combat.js : la saisie, puis santeDon borné par ce qui manque.
const santeDit = (texte, x) => {
  const r = saisieSante(texte, x);
  if (!r) return null;
  const y = { ...x, sante: r.sante };
  if (y.santeDon) y.santeDon = santeDonRestante(y);
  return [y.sante, y.santeDon, r.retenu];
};
const tavarede = { id: "t", nom: "Tavarède", max: 7, sante: 7, psy: 5, psyMax: 5, santeDon: 0 };
const paye = saisiePsy("7", tavarede);
egal([paye.psy, paye.sante, paye.santeDon, paye.preleve], [0, 5, 2, 2], "Tavarède paie 7 avec 5 Psy");
const blesse = { ...tavarede, psy: paye.psy, sante: paye.sante, santeDon: paye.santeDon };
egal(santeDit("+2", blesse), [5, 2, 2], "« +2 » après un don : rien ne revient, santeDon gardé");
egal(santeDit("-3", blesse), [2, 2, 0], "un coup : santeDon gardé");
egal(santeDit("+5", { ...blesse, sante: 2 }), [5, 2, 2], "soins plafonnés au maximum moins les dons");
egal(santeDit("+1", { ...blesse, sante: 2 }), [3, 2, 0], "soins sous le plafond : rien de retenu");
egal(santeDit("=7", blesse), [7, 0, 0], "« =7 » après une journée de repos : santeDon effacé");
egal(santeDit("=6", blesse), [6, 1, 0], "« =6 » : santeDon borné par ce qui manque");
egal(santeDit("=3", blesse), [3, 2, 0], "« =3 » : santeDon gardé");
egal(santeDit("+3", { ...blesse, sante: -3, santeDon: 10 }), [-3, 10, 3], "coma payé en dons : des soins ne le réveillent pas");
egal(santeDit("+9", { ...blesse, sante: -3, santeDon: 2 }), [5, 2, 1], "coma dû aux coups : réveil, sans la Santé des dons");
egal(santeDit("+1", { ...blesse, sante: 6, santeDon: 2 }), [6, 1, 1], "au-dessus du plafond (données d'avant), des soins ne retirent rien");
egal(santeDit("+3", { max: 7, sante: 2 }), [5, undefined, 0], "sans santeDon (ancien format)");
egal([santeDit("+4", { max: 7, sante: 5 }), santeDit("+1", { max: 7, sante: 9 }), santeDit("4", { max: 7, sante: 5 }), santeDit("=12", { max: 7, sante: 5 })],
  [[7, undefined, 0], [9, undefined, 0], [1, undefined, 0], [12, undefined, 0]], "adversaires : plafond au maximum, jamais en baisse");
egal([santeDit("", blesse), santeDit("abc", blesse), santeDit("-4d6", blesse), santeDit("1000", blesse)], [null, null, null, null], "saisies de Santé illisibles");

// Coma à 0, mort à moins la Santé maximum, jamais avant -10.
egal([seuilMort(7), seuilMort(13), seuilMort(0)], [-10, -13, -10], "seuils de mort");
egal([{ sante: 1, max: 7 }, { sante: 0, max: 7 }, { sante: -9, max: 7 }, { sante: -10, max: 7 }, { sante: -12, max: 13 }, { sante: -13, max: 13 }].map(etatHeros),
  ["debout", "coma", "coma", "mort", "coma", "mort"], "états des héros");

// La Grange-Noire : trois brigands (sbires) et Vadim.
const rencontre = {
  id: "ferme", nom: "La Grange-Noire", avant: 2, moral: true,
  adversaires: [{ cle: "brigand", nom: "Brigand", rang: "sbire", sante: "5", n: 3 }, { cle: "pnj:vadim", nom: "Vadim", rang: "soldat", sante: "10", n: 1, capacites: "S'il tombe, ils fuient." }],
};
const plan = { id: "p", pions: [{ ref: "bestiaire:brigand", nom: "Brigand", court: "1" }, { ref: "pnj:vadim", nom: "Vadim, dit le Pinson", court: "M" },
  { ref: "bestiaire:brigand", nom: "Brigand", court: "2" }, { ref: "bestiaire:brigand", nom: "Brigand", court: "3" }] };
egal(planDe(rencontre, [{ id: "vide", pions: [] }, plan])?.id, "p", "plan de la rencontre");
const adv = adversairesDepuis(groupes(rencontre, plan, 3, 1));
egal(adv.map((a) => [a.id, a.nom, a.numero, a.max, a.sante, a.rang]), [["a1", "Brigand", "1", 5, 5, "sbire"], ["a2", "Brigand", "2", 5, 5, "sbire"],
  ["a3", "Brigand", "3", 5, 5, "sbire"], ["a4", "Vadim", "M", 10, 10, "soldat"]], "adversaires numérotés comme leurs pions");
egal(adversairesDepuis(groupes(rencontre, null, 3, 1)).map((a) => a.numero), ["1", "2", "3", ""], "sans plan : 1, 2, 3");
ok(adv[0].capacites.startsWith("Racket"), "capacité du bestiaire reprise");
const boss = adversairesDepuis(groupes({ adversaires: [{ cle: "boss", nom: "Boss", rang: "boss", sante: "8 × PJ", n: 1 }] }, null, 3, 1));
egal(boss.map((a) => a.max), [21], "boss niveau 1 : 7 par aventurier");

let c = nouveauCombat({ rencontre, heros, adversaires: adv, avant: 1, choisis: ["v"], id: "c1" });
egal([c.tour, c.actif, c.ordre[0], c.avant, c.moral, c.strat, c.sablier], [1, 0, "aventurier:v", 1, true, false, null], "combat neuf");

// Moral : 2 brigands sur 3 tombés, les autres fuient ; un sans-peur ne compte pas ; la rencontre peut retirer la règle.
const m0 = moralDuCombat(c);
egal([m0.n, m0.seuil, m0.tombes, m0.fuient], [3, 2, 0, false], "moral au départ");
const blesser = (combat, id, sante) => ({ ...combat, adversaires: combat.adversaires.map((a) => (a.id === id ? { ...a, sante } : a)) });
let d = blesser(blesser(c, "a1", 0), "a2", -2);
const m1 = moralDuCombat(d);
egal([m1.tombes, m1.fuient, m1.restent.map((a) => a.id)], [2, true, ["a3"]], "moral à la moitié");
egal(moralDuCombat({ ...d, moral: false }), null, "règle retirée");
egal(moralDuCombat({ adversaires: d.adversaires.map((a) => ({ ...a, sansPeur: true })) }), null, "sans peur");

// Tour suivant : ordre v, ennemis, t, e ; un héros dans le coma est sauté, les ennemis aussi quand tous sont hors de combat.
const pas = (combat) => [combat.actif, combat.tour];
c = { ...c, sablier: { duree: 60, fin: 1 } };
let x = suivant(c);
egal([...pas(x), x.sablier], [1, 1, null], "suivant : les ennemis, sablier arrêté");
x = suivant(suivant(suivant(x)));
egal(pas(x), [0, 2], "retour au premier, tour 2");
const coma = { ...c, heros: c.heros.map((h) => (h.id === "t" ? { ...h, sante: 0 } : h)) };
egal(pas(suivant(suivant(coma))), [3, 1], "le héros dans le coma est sauté");
const vaincus = { ...c, adversaires: c.adversaires.map((a, i) => (i < 3 ? { ...a, sante: 0 } : { ...a, fuite: true })) };
egal(pas(suivant(vaincus)), [2, 1], "plus d'ennemi debout : sautés");
const personne = { ...vaincus, heros: vaincus.heros.map((h) => ({ ...h, sante: -1 })) };
egal(pas(suivant(personne)), [1, 1], "personne ne peut agir : un pas");
egal(pas(precedent(c)), [0, 1], "précédent au tout début : rien");
egal(pas(precedent({ ...c, actif: 0, tour: 2 })), [3, 1], "précédent : tour d'avant");
egal(pas(precedent({ ...coma, actif: 3, tour: 1 })), [1, 1], "précédent : saute le coma");

// Deux écrans : chacun garde ce qu'il a changé.
const base = { ...c, modifie: "1" };
const ici = blesser({ ...base, tour: 2 }, "a1", 1);
const labas = { ...blesser(base, "a4", 6), strat: true, modifie: "2" };
const f = fusionnerCombat(base, ici, labas);
egal([f.tour, f.strat, f.adversaires[0].sante, f.adversaires[3].sante, f.modifie], [2, true, 1, 6, "2"], "fusion de deux écrans");
egal(fusionnerCombat(base, ici, { ...labas, id: "autre" }).id, "autre", "combat remplacé ailleurs : le serveur l'emporte");
egal(fusionnerCombat(base, ici, null), null, "combat fini ailleurs");
// La Psy, champ par champ : un écran paie un don, l'autre retire de la Santé au même héros.
const avecPsy = (combat, id, champs) => ({ ...combat, heros: combat.heros.map((h) => (h.id === id ? { ...h, ...champs } : h)) });
const fp = fusionnerCombat(base, avecPsy(base, "t", { psy: 2 }), { ...avecPsy(base, "t", { sante: 3 }), modifie: "2" });
egal(fp.heros.find((h) => h.id === "t") && [fp.heros[0].psy, fp.heros[0].sante], [2, 3], "fusion : Psy ici, Santé là-bas");
const ancien = { ...base, heros: base.heros.map(({ psy, psyMax, santeDon, ...h }) => h) };
const fa = fusionnerCombat(ancien, avecPsy(ancien, "e", { psy: 0, psyMax: 3, santeDon: 0 }), { ...ancien, strat: true, modifie: "2" });
egal([fa.strat, fa.heros[1].psy, fa.heros[1].psyMax, "psy" in fa.heros[0]], [true, 0, 3, false], "fusion d'un combat d'avant la Psy");

// La main passée sur les deux écrans depuis la même version (la télécommande, puis Entrée sur l'ordinateur en retard) : celle
// du serveur reste, un tour n'est jamais compté deux fois, ni rendu en arrière ; le reste de chaque écran est gardé.
ok(mainChangee(base, suivant(base)) && !mainChangee(base, { ...base, strat: true }), "main changée ou non");
const telecommande = { ...suivant(base), modifie: "2" };
const mac = suivant(base);
egal(pas(fusionnerCombat(base, mac, telecommande)), pas(telecommande), "deux Suivant en même temps : un seul pas");
const deuxFois = { ...suivant(suivant(base)), modifie: "3" };
egal(pas(fusionnerCombat(base, mac, deuxFois)), pas(deuxFois), "deux pas au téléphone, un au Mac : la main ne recule pas");
const macBlesse = blesser(suivant({ ...base, sablier: { duree: 60, fin: 9 } }), "a1", 2);
const fm = fusionnerCombat({ ...base, sablier: { duree: 60, fin: 9 } }, macBlesse, { ...telecommande, sablier: null });
egal([fm.actif, fm.tour, fm.sablier, fm.adversaires[0].sante], [telecommande.actif, telecommande.tour, null, 2], "la main du serveur, la blessure du Mac");
egal(pas(fusionnerCombat(base, { ...base, strat: true }, telecommande)), pas(telecommande), "le Mac n'a pas touché la main : celle du serveur");
egal(pas(fusionnerCombat(base, mac, { ...base, strat: true, modifie: "2" })), pas(mac), "seul le Mac a passé la main : la sienne");

// La barre du combat : les mêmes mots et les mêmes gestes sur les trois écrans, « Fin du combat » au bout.
const texte = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const gestes = (html) => [...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]).filter((g) => g !== "aller");
const calme = { ...c, sablier: null, strat: false };
const barres = ["page", "tableau", "telecommande"].map((surface) => htmlBarre(calme, { surface }));
for (const b of barres) {
  for (const mot of [MOTS.precedent, MOTS.suivant, MOTS.strat, MOTS.sablier, MOTS.tv, MOTS.fin]) ok(texte(b).includes(mot), `barre : « ${mot} »`);
  egal(gestes(b), ["precedent", "suivant", "strat", "sablier", "tv", "fin"], "barre : les gestes, dans l'ordre, la fin au bout");
}
egal(barres.map((b) => texte(b).replace(/barre-[a-z]+/g, "")), Array(3).fill(texte(barres[0])), "barre : le même texte partout");
egal(MOTS.sablier, "Sablier 1 min", "le sablier dit sa durée");
const pris = texte(htmlBarre({ ...calme, strat: true, sablier: { duree: 60, fin: 1 } }, { tv: true, reste: 42 }));
ok(pris.includes(MOTS.stratPris) && pris.includes(MOTS.sablierArret) && pris.includes(MOTS.tvRetirer) && pris.includes("0:42"), "barre : les états pris");
ok(texte(htmlBarre(c)).includes("Velora a la main. Ensuite : les adversaires."), "barre : qui a la main, et ensuite");
const auxEnnemis = { ...c, actif: 1 };
ok(texte(htmlBarre(auxEnnemis)).includes("Les adversaires ont la main.") && versQui(auxEnnemis) === "aux adversaires" && versQui(c) === "à Velora", "barre : les adversaires");
egal([minutes(60), minutes(4.2), minutes(0), minutes(-3)], ["1:00", "0:05", "0:00", "0:00"], "minutes du sablier");
egal([cartonApres(""), cartonApres("jaune"), cartonApres("rouge"), cartonApres("bleu")], ["jaune", "rouge", "", "jaune"], "cartons : aucun, jaune, rouge");
const cartons = htmlCartons("t", "Tavarède", { physique: "rouge" }, { inactif: true });
ok((cartons.match(/disabled/g) || []).length === 3 && cartons.includes('class="carton-rouge"') && texte(cartons).trim() === "P S M", "cartons : P, S, M");
const postures = htmlPostures("t", "Tavarède", "defensive");
ok((postures.match(/aria-pressed="true"/g) || []).length === 1 && /data-posture="defensive" aria-pressed="true"/.test(postures), "posture : une pastille pleine");
ok(!/<script|onerror/i.test(htmlBarre({ ...c, nom: "<script>", heros: c.heros.map((h) => ({ ...h, nom: "<img src=x onerror=1>" })) })), "barre : noms échappés");

// Bilan pour le journal.
let fin = blesser(blesser(c, "a1", 0), "a4", -3);
fin = { ...fin, tour: 4, strat: true, adversaires: fin.adversaires.map((a) => (a.id === "a2" ? { ...a, fuite: true } : a)),
  heros: fin.heros.map((h) => (h.id === "t" ? { ...h, sante: -2, cartons: { physique: "jaune" } } : h.id === "e" ? { ...h, sante: 5, cartons: { mental: "rouge", social: "bleu" } } : h)) };
egal(bilan(fin), "Combat « La Grange-Noire » : 4 tours. Au tapis : Brigand 1 et Vadim M. En fuite : Brigand 2. Encore debout : Brigand 3. "
  + "Tavarède : dans le coma (-2), carton jaune en Physique. Eloran : 5 Santé sur 9, carton rouge en Mental. Point strat pris.", "bilan");
// La Psy au bilan : quand elle a changé, et la Santé payée faute de Psy ; rien pour une Psy intacte ou un ancien combat.
const finPsy = { ...fin, heros: fin.heros.map((h) => (h.id === "t" ? { ...h, psy: 0, santeDon: 1 } : h.id === "e" ? { ...h, psy: 1, santeDon: 2 } : h)) };
egal(bilan(finPsy), "Combat « La Grange-Noire » : 4 tours. Au tapis : Brigand 1 et Vadim M. En fuite : Brigand 2. Encore debout : Brigand 3. "
  + "Tavarède : dans le coma (-2), 0 Psy sur 5, 1 point de Santé payé faute de Psy, carton jaune en Physique. "
  + "Eloran : 5 Santé sur 9, 1 Psy sur 3, 2 points de Santé payés faute de Psy, carton rouge en Mental. Point strat pris.", "bilan avec la Psy");
egal(bilan({ ...fin, heros: fin.heros.map((h) => (h.id === "v" ? { ...h, psy: 0, psyMax: 0 } : h)) }), bilan(fin), "Psy intacte, ou nulle : rien au bilan");
egal(bilan({ ...fin, heros: fin.heros.map(({ psy, psyMax, santeDon, ...h }) => h) }), bilan(fin), "ancien combat : bilan sans Psy");
ok(bilan({ ...fin, nom: "x".repeat(3000) }).length <= 1990, "bilan borné à la ligne du journal");

// Les rencontres réelles (lues seulement).
const dossier = process.argv[2];
if (dossier) {
  const lireTout = (d) => readdirSync(join(dossier, d)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(dossier, d, n), "utf8")));
  const plans = lireTout("plans");
  for (const r of lireTout("rencontres")) {
    const liste = adversairesDepuis(groupes(r, planDe(r, plans), 3, 1));
    const neuf = nouveauCombat({ rencontre: r, heros, adversaires: liste, avant: r.avant, id: "r" });
    ok(neuf.ordre.filter((o) => o === ENNEMIS).length === 1 && neuf.ordre.length === 4, `${r.id} : ordre`);
    ok(liste.every((a) => a.max >= 1 && a.sante === a.max), `${r.id} : Santé`);
    console.log(`${r.nom} : ${liste.map((a) => `${a.nom}${a.numero ? ` ${a.numero}` : ""} (${a.max})`).join(", ")} ; ${phraseOrdre(neuf)}`);
  }
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Aucun défaut (${verifs} vérifications).`);
process.exit(defauts ? 1 : 0);
