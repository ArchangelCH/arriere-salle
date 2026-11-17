// Vérifie les aides du tableau du MJ : « Chacun son moment » (app/static/js/tableau/moments.js : qui le journal cite,
// les lignes que l'atelier écrit seul, l'heure d'une ligne, le combat, les durées, ce que cherche un héros) et « Hors du
// scénario » (tableau/tirages.js : le lieu courant, qui s'y trouve, les rumeurs, une rencontre pesée par la balance,
// trois noms). Avec un dossier de données en argument (lu seulement), rejoue aussi le journal des vraies séances.
// node outils/verifier_aides_tableau.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CREATURES, GENS, RANGS } from "../app/static/js/combats/bestiaire.js";
import { NOMS, ORIGINES, ORIGINES_PAR_NOM_DE_LIEU, ORIGINES_PAR_TYPE_DE_LIEU, PRENOMS } from "../app/static/js/campagne/noms.js";
import { PRETIRES, auNiveau, chargerPretires } from "../app/static/js/combats/groupe.js";
import { accorder } from "../app/static/js/pnj/tables.js";
import { hasardAGraine } from "../app/static/js/combats/simulation.js";
import {
  SEUIL_OUBLI, citeLeHeros, depuisEnClair, duree, envieDuHeros, herosAuCombat, herosDeLaSeance, instantDeLigne, ligneMecanique,
  moments, motifDuHeros, nomsDuHeros, retenirCombat,
} from "../app/static/js/tableau/moments.js";
import {
  FAMILLES, boutiquesDuLieu, famillesDuLieu, lieuCourant, nomDeRencontre, origineDuLieu, plansAConnaitre, pnjDuLieu,
  rencontreAEnregistrer, rumeursAPlacer, tirerRencontre, troisNoms,
} from "../app/static/js/tableau/tirages.js";

// Les prétirés du kit ne partent plus avec groupe.js : chargés d'abord.
await chargerPretires();

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

// Qui le journal cite.
egal(nomsDuHeros("Eloran de la maison Amberel"), ["eloran", "amberel"], "les mots à majuscule du nom");
egal(nomsDuHeros("Tavarède Lavelle"), ["tavarede", "lavelle"], "sans accents ni casse");
egal(nomsDuHeros("Frère Ansgar"), ["ansgar"], "sans le titre");
egal(nomsDuHeros("vortan aldrea"), ["vortan"], "un nom tout en minuscules : son premier mot");
egal(nomsDuHeros(""), [], "sans nom");
const eloran = motifDuHeros("Eloran de la maison Amberel");
const tavarede = motifDuHeros("Tavarède Lavelle");
ok(citeLeHeros("Eloran prépare un remède.", eloran) && citeLeHeros("Le remède d'Eloran.", eloran) && citeLeHeros("ELORAN rit.", eloran), "prénom cité, élidé, en capitales");
ok(citeLeHeros("La maison Amberel répond.", eloran), "nom de famille cité");
ok(!citeLeHeros("Les Elorans de la vallée.", eloran) && !citeLeHeros("Une maison brûle.", eloran), "mot entier seulement, pas « maison »");
ok(citeLeHeros("Tavarede negocie.", tavarede) && citeLeHeros("Lavelle paie.", tavarede) && !citeLeHeros("Les Lamottes.", tavarede), "Tavarède sans accent, son nom");
ok(!citeLeHeros("Tavarède", null), "sans motif, personne");

// Les lignes que l'atelier écrit seul.
for (const t of [
  "Nuit de repos. Tavarède : +3 Santé. Eloran : rien ne change.",
  "Journée de repos, dans de mauvaises conditions. Velora : +2 Psy.",
  "Remettre à neuf. Vortan : 5 Santé.",
  "Tavarède achète Potion de soins (40 po) chez Chez Torvin !.",
  "Velora reçoit Corde (offert) chez Chez Torvin !.",
  "Eloran verse 20 po pour La forge.",
  "PNJ improvisé : Aldwin Brisefer",
]) ok(ligneMecanique(t), `ligne de l'atelier : ${t}`);
for (const t of [
  "Tavarède achète la loyauté du garde.",
  "Combat « La Grange-Noire » : 4 tours. Tavarède : 2 Santé sur 7.",
  "Velora défie le ménestrel au bras de fer.",
]) ok(!ligneMecanique(t), `ligne du MJ : ${t}`);

// L'heure d'une ligne.
const a = (h, m, jour = 7) => new Date(2026, 10, jour, h, m).getTime();
const maintenant = a(16, 30);
egal(instantDeLigne("15:00", maintenant), a(15, 0) + 30000, "même jour, au milieu de la minute");
egal(instantDeLigne("23:50", a(0, 20, 8)), a(23, 50, 7) + 30000, "après minuit : la veille");
egal(instantDeLigne("16:33", maintenant), a(16, 33) + 30000, "à peine en avance (horloges) : le même jour");
egal([instantDeLigne("25:00", maintenant), instantDeLigne("abc", maintenant), instantDeLigne("", maintenant)], [null, null, null], "heures illisibles");

// Le combat en cours.
const combat = {
  tour: 1, actif: 0, ordre: ["aventurier:t", "aventurier:e", "ennemis", "aventurier:v", "aventurier:fantome"],
  heros: [{ id: "t" }, { id: "e" }, { id: "v" }],
};
egal([...herosAuCombat(combat)], ["t"], "premier tour : celui qui a la main");
egal([...herosAuCombat({ ...combat, actif: 3 })], ["t", "e", "v"], "premier tour, après les ennemis");
egal([...herosAuCombat({ ...combat, tour: 2, actif: 0 })], ["t", "e", "v"], "deuxième tour : tous ceux du combat");
egal([...herosAuCombat(null)], [], "sans combat");
egal(retenirCombat({ v: 5 }, combat, 99), { v: 5, t: 99 }, "le tableau retient l'heure de chacun");
egal(retenirCombat({ v: 5 }, null, 99), { v: 5 }, "sans combat, rien ne change");

// Chacun son moment.
const H = [
  { id: "vortan", nom: "Vortan Aldrea" }, { id: "tavarede", nom: "Tavarède Lavelle" },
  { id: "eloran", nom: "Eloran de la maison Amberel" }, { id: "velora", nom: "Velora Dorvan" },
];
const journal = [
  { t: "03:00", texte: "Vortan vole une pomme (une autre séance)." },
  { t: "15:00", texte: "Velora défie le ménestrel au bras de fer et gagne." },
  { t: "15:35", texte: "Tavarède négocie une chambre avec Toma." },
  { t: "16:10", texte: "PNJ improvisé : Tavarède Gardefeu" },
  { t: "16:18", texte: "Le remède d'Eloran soulage le petit Cyril." },
  { t: "16:25", texte: "Nuit de repos. Tavarède : rien ne change. Vortan : rien ne change." },
  { id: "x", texte: "ligne sans heure" }, null,
];
const m = moments({ journal, heros: H, maintenant });
const par = Object.fromEntries(m.heros.map((x) => [x.id, x]));
egal([par.velora.minutes, par.velora.depuis], [89, "journal"], "Velora : sa ligne de 15 h");
egal([par.tavarede.minutes, par.tavarede.ligne], [54, "Tavarède négocie une chambre avec Toma."], "Tavarède : ni le PNJ homonyme ni le repos");
egal(par.eloran.minutes, 11, "Eloran : 11 min");
egal([par.vortan.minutes, par.vortan.depuis], [89, "debut"], "Vortan : jamais cité, depuis le début de la séance (la ligne de 3 h est d'une autre)");
egal(m.oublies, ["vortan"], "à attente égale, le jamais cité passe devant");
egal([m.echelle, m.debut], [89, 89], "échelle des barres et début de la séance");
const enCombat = moments({ journal, heros: H, maintenant, combat: { tour: 1, actif: 0, ordre: ["aventurier:tavarede", "ennemis"], heros: [{ id: "tavarede" }] } });
egal([enCombat.heros[1].minutes, enCombat.heros[1].depuis, enCombat.heros[1].auCombat], [0, "combat", true], "au combat : maintenant");
const vu = moments({ journal, heros: H, maintenant, vus: { eloran: maintenant - 3 * 60000, velora: maintenant - 20 * 3600000, inconnu: maintenant } });
egal([vu.heros[2].minutes, vu.heros[2].depuis], [3, "combat"], "un combat vu passer compte");
egal(vu.heros[3].minutes, 89, "un combat d'un autre jour ne compte pas");
const recent = moments({ journal: [{ t: "16:20", texte: "Tout le monde : Vortan, Tavarède, Eloran et Velora trinquent." }], heros: H, maintenant });
egal(recent.oublies, [], `personne en avant sous ${SEUIL_OUBLI} minutes`);
const vide = moments({ journal: [], heros: H, maintenant });
ok(vide.heros.every((x) => x.minutes === null && x.depuis === null) && vide.debut === null && !vide.oublies.length, "journal vide : rien à juger");
egal(moments({ journal, heros: [], maintenant }).heros, [], "sans héros");
egal([depuisEnClair(0), depuisEnClair(12), depuisEnClair(60), depuisEnClair(65), depuisEnClair(89), depuisEnClair(118)],
  ["à l'instant", "il y a 12 min", "il y a 1 h", "il y a 1 h 05", "il y a 1 h 30", "il y a 2 h"], "durées en clair");
egal([duree(0), depuisEnClair(null)], ["0 min", ""], "durée nulle, rien");

// Ce que cherche un héros.
egal(envieDuHeros({ pourquoi: "Pour me prouver que je suis capable. Et plus encore.", lien: "x" }),
  { ligne: "Pour me prouver que je suis capable", entier: "Pour me prouver que je suis capable. Et plus encore.", champ: "pourquoi" }, "pourquoi il part, en une phrase");
egal(envieDuHeros({ pourquoi: "  ", lien: "Je soupçonne Josse !" })?.champ, "lien", "sinon son lien");
egal(envieDuHeros({ histoire: "Né sous la pluie.\nIl part." })?.ligne, "Né sous la pluie", "sinon le début de son histoire");
egal(envieDuHeros({}), null, "rien sur la fiche");

// Les héros de la séance.
const fiches = [{ id: "x", nom: "X", cree: "2" }, { id: "y", nom: "Y", cree: "1" }, { id: "z", nom: "Z", cree: "3" }, { id: "w", nom: "W", cree: "0", tablee: false }];
const tablee = [{ id: "a", aventurier: "x" }, { id: "b", aventurier: "y", actif: true }, { id: "c", aventurier: "z", actif: false }];
egal(herosDeLaSeance({ tablee, seance: { presents: ["a"] }, fiches }).map((f) => f.id), ["x"], "les présents");
egal(herosDeLaSeance({ tablee, seance: { presents: [] }, fiches }).map((f) => f.id), ["y", "x"], "personne de coché : la tablée active, par date");
egal(herosDeLaSeance({ tablee: [], seance: null, fiches }).map((f) => f.id), ["y", "x", "z"], "sans tablée : les fiches de la tablée");

// Le lieu courant.
const lieux = [{ id: "auberge", nom: "L'auberge", type: "auberge" }, { id: "moulin", nom: "Le moulin", type: "point" }, { id: "temple", type: "temple" }];
const plansLieux = { "plan-auberge": "auberge", "plan-moulin": "moulin", "plan-sans-lieu": "" };
const seance = { lieux: ["inconnu", "temple"], deroule: [{ fait: true, liens: { plan: "plan-auberge" } }, { liens: { plan: "plan-moulin", pnj: ["lisette"] } }], pnj: ["basile"], rumeurs: ["r2"] };
const base = { lieuDuPlan: (id) => plansLieux[id] || "", seance, lieux };
egal(lieuCourant({ ...base, choix: "temple", table: { vue: "plan", plan: "plan-auberge" } }), { id: "temple", source: "choisi" }, "le choix du MJ prime");
egal(lieuCourant({ ...base, choix: "disparu", table: { vue: "plan", plan: "plan-auberge" } }), { id: "auberge", source: "tv" }, "un choix disparu ne compte pas ; le plan de la TV");
egal(lieuCourant({ ...base, table: { vue: "carte", plan: "plan-auberge" }, planOuvert: { id: "plan-moulin", lieu: "moulin" } }), { id: "moulin", source: "plan" }, "la TV sur une carte : le plan ouvert");
egal(lieuCourant({ ...base, table: { vue: "plan", plan: "plan-sans-lieu" } }), { id: "moulin", source: "scene" }, "plan sans lieu : celui de la scène en cours");
egal(lieuCourant({ ...base, seance: { ...seance, deroule: [] } }), { id: "temple", source: "seance" }, "sinon le premier lieu connu de la séance");
egal(lieuCourant({ lieux }), { id: "", source: "" }, "rien pour en juger");
egal(plansAConnaitre({ table: { vue: "plan", plan: "plan-auberge" }, seance }), ["plan-auberge", "plan-moulin"], "les plans à lire : la TV, la scène");

// Qui est là, les rumeurs, les boutiques.
const pnj = [
  { id: "lisette", nom: "Lisette", lieu: "moulin", connu: false }, { id: "basile", nom: "Basile", lieu: "moulin", connu: true },
  { id: "lou", nom: "Lou", lieu: "moulin", connu: true }, { id: "anne", nom: "Anne", lieu: "moulin" },
  { id: "mort", nom: "Mort", lieu: "moulin", statut: "mort" }, { id: "parti", nom: "Parti", lieu: "moulin", statut: "disparu" },
  { id: "ailleurs", nom: "Ailleurs", lieu: "auberge", connu: true },
];
egal(pnjDuLieu(pnj, "moulin", seance).map((p) => p.id), ["lisette", "basile", "lou", "anne"], "scène, puis connus (la séance d'abord), puis les autres ; ni morts ni disparus");
egal(pnjDuLieu(pnj, "", seance).map((p) => p.id), ["lisette"], "sans lieu : ceux de la scène en cours");
egal(pnjDuLieu(pnj, "", { deroule: [] }), [], "sans lieu ni scène, personne");
// La scène en cours lie un PNJ qui habite ailleurs, et un mort : ils viennent en tête, la liste dit le mort (c17).
const sceneLoin = { ...seance, deroule: [seance.deroule[0], { liens: { plan: "plan-moulin", pnj: ["ailleurs", "mort"] } }] };
egal(pnjDuLieu(pnj, "moulin", sceneLoin).map((p) => p.id), ["ailleurs", "mort", "basile", "lou", "anne", "lisette"], "la scène d'abord, où qu'ils habitent, morts compris");
const autreScene = { ...seance, pnj: [], deroule: [{ liens: { pnj: ["anne"] }, fait: true }, { liens: { plan: "plan-moulin" } }] };
egal(pnjDuLieu(pnj, "moulin", autreScene).map((p) => p.id), ["basile", "lou", "anne", "lisette"], "une autre scène de la séance compte comme sous la main");
const rumeurs = [
  { id: "r1", texte: "Une", etat: "a-placer", cree: "1" }, { id: "r2", texte: "Deux", cree: "2" }, { id: "r3", texte: "Trois", etat: "entendue" },
  { id: "r4", texte: "  ", etat: "a-placer" },
];
egal(rumeursAPlacer(rumeurs, seance).map((r) => r.id), ["r2", "r1"], "à placer, celles de la séance d'abord, jamais une vide");
egal(boutiquesDuLieu([{ id: "b", nom: "B", lieu: "auberge" }, { id: "a", nom: "A", lieu: "auberge" }, { id: "c", lieu: "moulin" }], "auberge").map((b) => b.id), ["a", "b"], "boutiques du lieu");

// Une rencontre pesée par la balance.
const CATALOGUE = [...RANGS, ...CREATURES, ...GENS];
ok(FAMILLES.every((f) => CATALOGUE.some((x) => x.cle === f.troupe) && (!f.avec || CATALOGUE.some((x) => x.cle === f.avec))), "chaque famille vient du bestiaire");
ok(famillesDuLieu(lieux[0]).every((f) => f.lieux.includes("habite")) && famillesDuLieu({ type: "ruine" }).some((f) => f.cle === "squelettes")
  && famillesDuLieu(null).length === FAMILLES.length, "familles selon le lieu");
ok(famillesDuLieu({ type: "grotte" }).some((f) => f.cle === "araignees") && !famillesDuLieu({ type: "grotte" }).some((f) => f.cle === "gardes")
  && famillesDuLieu({ type: "camp" }).some((f) => f.cle === "brigands") && famillesDuLieu({ type: "inconnu" }).some((f) => f.cle === "loups"), "grotte, camp, type inconnu");
const brigands = FAMILLES.find((f) => f.cle === "brigands");
egal([nomDeRencontre(brigands, false, 1), nomDeRencontre(brigands, false, 4), nomDeRencontre(brigands, true, 0), nomDeRencontre(brigands, true, 3)],
  ["Brigand", "Brigands", "Chef mercenaire", "Brigands et leur chef"], "le nom suit la composition");
// Les prétirés de la campagne, au niveau 1 (un pack lance sa propre copie de ce vérifieur, avec le groupe de sa table).
const groupe = PRETIRES.map((p) => auNiveau(p, 1));
let exactes = 0;
let essais = 0;
for (const cible of ["facile", "normale", "difficile"]) {
  for (const lieu of [lieux[0], { type: "point" }, { type: "tombeau" }, null]) {
    for (const graine of [1, 2]) {
      const t0 = performance.now();
      const t = tirerRencontre({ groupe, niveau: 1, cible, lieu, hasard: hasardAGraine(graine) });
      const ms = performance.now() - t0;
      essais++;
      exactes += t.cle === cible;
      ok(t.adversaires.length && t.adversaires.every((x) => x.n > 0 && CATALOGUE.some((c) => c.cle === x.cle)), `${cible} : adversaires du bestiaire`);
      ok(!lieu || famillesDuLieu(lieu).some((f) => f.cle === t.famille), `${cible} : famille du lieu (${t.famille})`);
      ok(ms < 1500, `${cible} : tirage en ${Math.round(ms)} ms`);
    }
  }
}
ok(exactes === essais, `difficulté visée atteinte (${exactes} sur ${essais})`);
const un = tirerRencontre({ groupe, niveau: 1, cible: "normale", lieu: lieux[0], hasard: hasardAGraine(7) });
const deux = tirerRencontre({ groupe, niveau: 1, cible: "normale", lieu: lieux[0], hasard: hasardAGraine(7) });
egal([deux.famille, deux.adversaires, deux.cle], [un.famille, un.adversaires, un.cle], "même graine, même tirage");
ok(tirerRencontre({ groupe, niveau: 1, lieu: lieux[0], sauf: un.famille, hasard: hasardAGraine(7) }).famille !== un.famille, "« une autre » : pas la même famille");
egal(tirerRencontre({ groupe: [], cible: "normale" }), null, "sans tablée, rien");
const r = rencontreAEnregistrer(un, { lieu: lieux[0], seance: { numero: 2, nom: "Le Sanctuaire" }, nbPj: 4, niveau: 1, quand: "Q" });
egal([r.nom, r.lieu, r.avant, r.moral, r.verdict.cle, r.verdict.nbPj, r.verdict.quand], [`${un.nom}, L'auberge`, "auberge", 2, true, un.cle, 4, "Q"], "la rencontre enregistrée");
ok(r.notes === "Tirée au hasard dans le tableau du MJ pendant la séance 2 (Le Sanctuaire), pour la tablée de 4, niveau 1.", `ses notes : ${r.notes}`);

// Trois noms. Déjà pris : un prénom et un nom de chaque origine des tables de la campagne (campagne/noms.js), et un
// prénom seul ; le tirage doit les éviter tous.
const eviter = Object.keys(PRENOMS).flatMap((o) => [`${PRENOMS[o].h[0]} ${NOMS[o][0]}`, PRENOMS[o].f[0]]);
const pris = eviter.flatMap((n) => nomsDuHeros(n));
for (let i = 0; i < 40; i++) {
  const noms = troisNoms({ eviter });
  const mots = noms.flatMap((n) => nomsDuHeros(n.nom));
  ok(noms.length === 3 && new Set(noms.map((n) => n.nom)).size === 3, "trois noms distincts");
  ok(!mots.some((x) => pris.includes(x)), `aucun nom déjà pris : ${noms.map((n) => n.nom).join(", ")}`);
  ok(noms.some((n) => n.genre === "h") && noms.some((n) => n.genre === "f") && noms.every((n) => n.peuple), "un homme, une femme, chacun son peuple");
}
// Les noms d'ici : l'origine que donne un type de lieu (un peuple chez lui), et celles que cite le nom d'un lieu.
const [typeLocal, origineLocale] = Object.entries(ORIGINES_PAR_TYPE_DE_LIEU)[0];
const peupleLocal = ORIGINES.find((o) => o.cle === origineLocale).peuple;
const locaux = troisNoms({ origine: origineLocale });
ok(locaux.slice(0, 2).every((n) => n.origine === origineLocale && n.peuple === accorder(peupleLocal, n.genre)), `deux noms d'ici (${origineLocale})`);
const [regionA, regionB] = ORIGINES_PAR_NOM_DE_LIEU;
const nomDe = (cle) => ORIGINES.find((o) => o.cle === cle)?.nom || cle;
egal([origineDuLieu({ type: typeLocal }), origineDuLieu({ id: regionA, nom: nomDe(regionA) }), origineDuLieu({ id: "x", nom: `La Cité de ${nomDe(regionB)}` }),
  origineDuLieu({ id: "ailleurs" }), origineDuLieu(null)], [origineLocale, regionA, regionB, "", ""], "la région d'un lieu");

// Les vraies séances (lues seulement) : qui chaque journal cite.
const dossier = process.argv[2];
if (dossier) {
  const lireTout = (d) => readdirSync(join(dossier, d)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(dossier, d, n), "utf8")));
  const aventuriers = lireTout("aventuriers");
  const campagne = JSON.parse(readFileSync(join(dossier, "campagne.json"), "utf8"));
  for (const s of lireTout("seances")) {
    const heros = herosDeLaSeance({ tablee: campagne.tablee, seance: s, fiches: aventuriers });
    const dernier = (s.journal || []).map((l) => l.t).filter(Boolean).sort().pop();
    if (!dernier) {
      console.log(`${s.nom} : journal vide`);
      continue;
    }
    const [h, mn] = dernier.split(":").map(Number);
    const fin = new Date(2026, 10, 7, h, mn + 5).getTime();
    const x = moments({ journal: s.journal, heros: heros.map((f) => ({ id: f.id, nom: f.nom })), maintenant: fin });
    ok(x.heros.length === heros.length, `${s.id} : un compte par héros`);
    console.log(`${s.nom}, cinq minutes après la dernière ligne : ${x.heros.map((y) => `${y.nom.split(" ")[0]} ${y.depuis === "debut" ? "jamais" : depuisEnClair(y.minutes)}`).join(", ")}`);
  }
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifs} vérifications.` : `Aucun défaut (${verifs} vérifications).`);
process.exit(defauts ? 1 : 0);
