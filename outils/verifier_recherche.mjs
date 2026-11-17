// La recherche de l'atelier (js/chercher/) : sans accents ni majuscules, le nom d'abord, puis le détail, puis les autres
// champs de jeu, rappelés sous le nom ; « @ » qui propose d'abord les fiches du scénario ; les passages d'un scénario
// (l'expression entière d'abord, jamais l'adresse d'un lien) ; les articles d'une boutique. Lit les fiches du dossier
// donné, sans rien y écrire.
//   node outils/verifier_recherche.mjs [data]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fichesDeLIndex, ideesTrouvees, recentes, routeDe, scenariosTrouves } from "../app/static/js/chercher/index-atelier.js";
import { chercherFiches, ligneLisible, passagesDe, passagesDuScenario, plier, surligner } from "../app/static/js/chercher/moteur.js";
import { articlesTrouves } from "../app/static/js/boutiques/comptoir.js";
import { contexteDuScenario, fichesDe } from "../app/static/js/scenarios/fiches.js";

let echecs = 0;
let essais = 0;
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) {
    echecs++;
    if (echecs <= 30) console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};
const json = (x) => JSON.stringify(x);

// Un index inventé, comme /api/recherche le rend
const index = {
  pnj: [
    { id: "toma", nom: "Toma de Silbermann", role: "Aubergiste", lieu: "fanfrelee", voix: "Bourru, généreux en cachette.", connu: true, modifie: "2026-11-01T10:00" },
    { id: "mirele", nom: "Mirèle", role: "Serveuse de l'auberge de Toma", lieu: "fanfrelee", connu: true, modifie: "2026-11-02T10:00" },
    { id: "gaspard", nom: "Gaspard Tourbe", role: "Meunier ruiné", lieu: "moulin", voix: "Il chuchote quand il ment.", secret: "Payé en or neuf.", modifie: "2026-11-03T10:00" },
    { id: "grimbal", nom: "Grimbal", role: "Roi des nains", envie: "La paix, et pas la guerre.", connu: true },
  ],
  lieux: [
    { id: "fanfrelee", nom: "La petite Fanfrelée", type: "auberge", carte: "pays", resume: "L'auberge de Toma, sur la route des caravanes.", connu: true },
    { id: "moulin", nom: "Le moulin des Varenne", type: "village", carte: "route", resume: "Au gué d'un ruisseau.", notes: "Une lanterne brisée dans la boue.", connu: false },
    { id: "gue-cendres", nom: "Le gué aux Cendres", type: "village", carte: "route", modifie: "2026-11-04T10:00" },
    { id: "comptoir", nom: "Comptoir d'or du Gué", type: "comptoir", carte: "cratere" },
  ],
  plans: [{ id: "auberge-rdc", nom: "L'auberge de Toma, rez-de-chaussée", lieu: "fanfrelee", pieces: [{ nom: "La salle commune", notes: "On ne se bat pas ici." }] }],
  rencontres: [{ id: "chasseurs", nom: "Les chasseurs du Notaire", adversaires: [{ nom: "Berthe Mâchelame" }] }],
  cartes: [{ id: "route", nom: "La route de Tarvan", etiquettes: [{ texte: "vers Tarvan" }] }, { id: "pays", nom: "Le pays de Clairefonds" }, { id: "cratere", nom: "Le Calvère" }],
  boutiques: [{ id: "thorvald", nom: "Chez Torvin !", marchand: "grimbal", lieu: "fanfrelee",
    articles: [{ id: "p1", nom: "Potion de soins", description: "1D6 + 2 soins" }, { id: "d1", nom: "Dague" }] }],
  aventuriers: [{ id: "velora", nom: "Velora Dorvan", genre: "f", joueur: "Yuna", objets: ["Le pendule détecteur de psy"] }],
  contrats: [{ id: "galette", nom: "Perdu : Galette", recompense: "Une tarte." }],
  rumeurs: [{ id: "r1", texte: "On paie une Gemme brute plus cher qu'un cheval.", source: "le marchand nain" }],
  seances: [{ id: "s2", nom: "Le Sanctuaire", numero: 2, date: "2026-11-07", objectif: "Faire aimer l'auberge." }],
  regles: [{ id: "feu", titre: "Les dégâts du feu", statut: "en-vigueur", texte: "1D6 par tour dans les flammes." }],
  idees: [{ id: "i1", texte: "Faire détruire l'auberge de Toma en début d'histoire.", modifie: "2026-11-01" }],
  scenarios: [{ id: "s3", nom: "Séance 3 · Les cendres du moulin", resume: "Le moulin des Varenne a brûlé.", chapitres: [
    { id: "c1", titre: "Le moulin en flammes", texte: "Les héros arrivent. [Gaspard Tourbe](#/pnj/gaspard) les attend.\n> Il chuchote." },
    { id: "c4", titre: "Le prix du silence", texte: "Gaspard avoue : l'incendie a été payé en or neuf, frappé au [Comptoir d'or du Gué](#/carte/cratere?lieu=comptoir)." },
  ] }],
};
const fiches = fichesDeLIndex(index);
const ids = (q, max = 30) => chercherFiches(fiches, q, { max }).map((f) => f.id);
const premier = (q) => chercherFiches(fiches, q, { max: 1 })[0];

// Sans accents ni majuscules
verifier(ids("toma")[0] === "toma" && ids("TOMA")[0] === "toma", "« toma » et « TOMA » trouvent Toma en tête", json(ids("toma")));
verifier(ids("mirele")[0] === "mirele", "« mirele » trouve Mirèle", json(ids("mirele")));
// Le nom d'abord, puis le détail, puis un autre champ, rappelé sous le nom
const toma = ids("toma");
verifier(toma.indexOf("toma") < toma.indexOf("auberge-rdc") && toma.indexOf("auberge-rdc") < toma.indexOf("mirele") && toma.indexOf("mirele") < toma.indexOf("fanfrelee"),
  "le nom, puis un nom qui le contient, puis le détail (Mirèle, par son métier), puis un autre champ (le résumé)", json(toma));
const chuchote = premier("chuchote");
verifier(chuchote?.id === "gaspard" && chuchote.trouve?.libelle === "Voix" && /<mark>chuchote<\/mark>/.test(chuchote.trouve.html), "« chuchote », tiré de la voix de Gaspard, le trouve ; le champ est rappelé", json(chuchote));
verifier(premier("chuch")?.trouve?.html.includes("<mark>chuchote</mark>"), "trois lettres marquent le mot entier");
verifier(!chercherFiches(fiches, "ch", { max: 50 }).some((f) => f.trouve) && chercherFiches(fiches, "chu", { max: 50 }).some((f) => f.trouve), "sous trois lettres, les noms seulement ; dès trois, les autres champs");
const lanterne = premier("lanterne");
verifier(lanterne?.id === "moulin" && lanterne.trouve?.libelle === "Notes", "« lanterne » trouve le lieu par ses notes", json(lanterne));
verifier(premier("pendule")?.id === "velora" && premier("pendule").trouve?.libelle === "Objets", "un objet du sac d'une aventurière");
const potion = premier("potion");
verifier(potion?.id === "thorvald" && routeDe(potion) === "#/boutiques/thorvald?article=p1", "un article ouvre sa boutique sur lui", json(potion));
verifier(premier("galette")?.route === "#/auberge/contrat/galette" && premier("gemme")?.route === "#/auberge/rumeur/r1", "les contrats et les rumeurs de l'auberge");
verifier(premier("feu")?.route === "#/regles/feu" && premier("sanctuaire")?.route === "#/seances/s2", "les règles maison et les séances");
verifier(premier("tarvan")?.id === "route", "une carte par son nom", json(ids("tarvan")));
verifier(json(ids("guerre")) === json(["grimbal"]) && ids("zzz").length === 0, "un mot d'un champ ; rien");
// Plusieurs mots : chacun peut venir d'un champ différent
verifier(premier("gaspard or neuf")?.id === "gaspard", "plusieurs mots, le nom et le secret");
// Les mêmes routes que « Lier une fiche »
const lier = fichesDe(index);
for (const f of lier) verifier(fiches.find((x) => x.genre === f.genre && x.id === f.id)?.route === f.route, `même route que « Lier une fiche » : ${f.genre} ${f.id}`);
verifier(fiches.find((f) => f.id === "moulin").inconnu === true && fiches.find((f) => f.id === "toma").inconnu === false, "les PNJ et lieux inconnus sont marqués");
verifier(json(recentes(fiches, 2).map((f) => f.id)) === json(["gue-cendres", "gaspard"]), "les plus récentes d'abord, avant la première lettre");
verifier(surligner("Toma de Silbermann", "toma") === "<mark>Toma</mark> de Silbermann", "le nom surligné, accents gardés");

// « @ » : les fiches déjà liées dans ce scénario, puis celles de la même carte
const vraies = fichesDe(index);
const ordreGue = (s) => chercherFiches(vraies, "gue", { contexte: contexteDuScenario(s, vraies) }).map((f) => f.id);
verifier(json(ordreGue({ chapitres: [] }).slice(0, 2)) === json(["comptoir", "gue-cendres"]), "sans contexte : l'ordre des noms", json(ordreGue({ chapitres: [] })));
const lieAuMoulin = { chapitres: [{ texte: "Au [moulin](#/carte/route?lieu=moulin)." }] };
verifier(json(ordreGue(lieAuMoulin).slice(0, 2)) === json(["gue-cendres", "comptoir"]), "un lieu de la même carte que le moulin lié passe devant", json(ordreGue(lieAuMoulin)));
const lieAuComptoir = { chapitres: [{ texte: "Au [moulin](#/carte/route?lieu=moulin), puis au [Comptoir](#/carte/cratere?lieu=comptoir)." }] };
verifier(ordreGue(lieAuComptoir)[0] === "comptoir", "une fiche déjà liée passe devant tout", json(ordreGue(lieAuComptoir)));
verifier(chercherFiches(vraies, "", { contexte: contexteDuScenario(lieAuMoulin, vraies) })[0].id === "moulin", "recherche vide : la fiche liée d'abord");
verifier(chercherFiches(vraies, "gaspard tourbe", { contexte: contexteDuScenario(lieAuMoulin, vraies) })[0].id === "gaspard", "le nom même passe devant le contexte");

// Les passages d'un scénario
const s3 = index.scenarios[0];
const orNeuf = passagesDuScenario(s3, "or neuf");
verifier(orNeuf.length === 1 && orNeuf[0].chapitre === "c4" && orNeuf[0].numero === 2 && s3.chapitres[1].texte.slice(orNeuf[0].debut, orNeuf[0].fin) === "or neuf",
  "« or neuf », écrit au chapitre 4, trouvé et choisi tel quel", json(orNeuf));
verifier(/<mark>or neuf<\/mark>/.test(orNeuf[0].html) && !orNeuf[0].html.includes("#/carte"), "l'extrait se lit sans l'adresse des liens", orNeuf[0]?.html);
verifier(passagesDuScenario(s3, "pnj").length === 0 && passagesDuScenario(s3, "cratere").length === 0, "l'adresse d'un lien ne se cherche pas");
const gaspard = passagesDuScenario(s3, "gaspard");
verifier(gaspard.length === 2 && gaspard[0].chapitre === "c1" && gaspard[1].chapitre === "c4", "un nom, dans chaque chapitre, dans l'ordre", json(gaspard.map((p) => p.chapitre)));
verifier(passagesDuScenario(s3, "neuf payé").length === 1, "plusieurs mots sans l'expression : la ligne qui les a tous");
verifier(passagesDe("Il CHUCHOTE.", "chuchote")[0]?.debut === 3, "sans majuscules");
verifier(ligneLisible("## Le **prix** du [silence](#/pnj/x) [[pistes : trois]]") === "Le prix du silence « pistes : trois »", "une ligne lisible", ligneLisible("## Le **prix** du [silence](#/pnj/x) [[pistes : trois]]"));
const sc = scenariosTrouves(index.scenarios, "or neuf");
verifier(sc.length === 1 && sc[0].href === "#/scenarios/s3?chapitre=c4&chercher=or%20neuf&passage=0" && sc[0].ou === "ch. 2 · Le prix du silence", "« Chercher » mène au passage", json(sc));
verifier(ideesTrouvees(index.idees, "auberge toma").length === 1 && ideesTrouvees(index.idees, "zzz").length === 0, "les idées : chaque mot");

// Les articles d'une boutique
const articles = [{ nom: "Flèches 10 unités" }, { nom: "Flèches de guerre", description: "+ 1 perce armure" }, { nom: "Armure de cuir", categorie: "Armures" }, { nom: "" }];
verifier(json(articlesTrouves(articles, "fleche").map((a) => a.nom)) === json(["Flèches 10 unités", "Flèches de guerre", ""]), "« fleche » sans accent ; un article sans nom reste en vue");
verifier(json(articlesTrouves(articles, "armure").map((a) => a.nom)) === json(["Flèches de guerre", "Armure de cuir", ""]), "par ce qu'en lisent les joueurs et la catégorie");
verifier(articlesTrouves(articles, "").length === 4, "recherche vide : tous");

// Les vraies données, lues seulement
const dossier = process.argv[2] || "data";
let reels = "";
if (existsSync(join(dossier, "pnj"))) {
  const lire = (sous) => (existsSync(join(dossier, sous)) ? readdirSync(join(dossier, sous)).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dossier, sous, f), "utf-8"))) : []);
  const ix = { pnj: lire("pnj"), lieux: lire("lieux"), plans: lire("plans"), rencontres: lire("rencontres"), cartes: lire("cartes").map(({ id, nom, etiquettes }) => ({ id, nom, etiquettes })),
    boutiques: lire("boutiques"), aventuriers: lire("aventuriers"), contrats: lire("contrats"), rumeurs: lire("rumeurs"), seances: lire("seances"),
    regles: lire("regles-maison"), idees: lire("idees"), scenarios: lire("scenarios") };
  const toutes = fichesDeLIndex(ix);
  verifier(toutes.every((f) => /^#\/[\w\-/?=&;%.]*$/.test(f.route)), "chaque vraie fiche a une route");
  // Chaque fiche se retrouve par son nom tapé sans accents ni majuscules, en tête ou parmi les homonymes.
  for (const f of toutes) {
    const q = plier(f.nom).toUpperCase();
    const trouvees = chercherFiches(toutes, q, { max: 50 });
    const memeNom = trouvees.filter((x) => plier(x.nom) === plier(f.nom));
    verifier(trouvees.includes(f) && memeNom.length && trouvees.indexOf(f) < memeNom.length + trouvees.findIndex((x) => plier(x.nom) === plier(f.nom)), `« ${q} » retrouve ${f.genre} ${f.id}`);
  }
  for (const s of ix.scenarios) {
    for (const ch of s.chapitres || []) {
      for (const p of passagesDuScenario({ chapitres: [ch] }, "le")) verifier(/^le/i.test(plier(ch.texte.slice(p.debut, p.fin))), `passage de « ${ch.titre} » à sa place`);
    }
  }
  reels = `, ${toutes.length} vraies fiches`;
}

console.log(echecs ? `${echecs} échec(s) sur ${essais} vérifications` : `Aucun défaut : ${essais} vérifications${reels}.`);
process.exit(echecs ? 1 : 0);
