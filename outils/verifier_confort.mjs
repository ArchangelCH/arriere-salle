// Vérifie ce que « Avant de jouer » repère des lignes et des voiles de la tablée dans les textes préparés d'une séance
// (app/static/js/confort/themes.js, confort.js) : chaque thème trouve ses mots, jamais au milieu d'un autre mot ; une
// limite écrite à la main se cherche par ses mots pleins ; la phrase nomme la scène, le chapitre ou la fiche.
// Avec un dossier de données, liste ce que la règle trouverait dans les vrais textes (lecture seule), pour juger à l'œil
// qu'aucun avertissement n'y serait absurde.
// node outils/verifier_confort.mjs [dossier data]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { alertesConfort, htmlLigneConfort, ligneConfort } from "../app/static/js/confort/confort.js";
import { THEMES, chercheur, forme } from "../app/static/js/confort/themes.js";
import { avantDeJouer, htmlAvantDeJouer } from "../app/static/js/seances/avant-de-jouer.js";

let defauts = 0;
let verifs = 0;
function ok(cond, message) {
  verifs++;
  if (!cond) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
}
const trouve = (item, texte) => chercheur(item)(forme(texte));

// Les clés des thèmes : celles de confort.py, dans le même ordre (le serveur refuse une clé inconnue).
const py = readFileSync(new URL("../app/commun/confort.py", import.meta.url), "utf8");
const clesPy = [...py.match(/^THEMES = \(([^)]*)\)/m)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok(JSON.stringify(clesPy) === JSON.stringify(THEMES.map((t) => t.cle)), `thèmes différents de confort.py : ${clesPy}`);

const CAS = [
  ["torture", "L'inquisiteur torture le prisonnier.", true],
  ["torture", "Un prisonnier torturé, les mains liées.", true],
  ["torture", "Le chemin tortueux mène au col.", false],
  ["araignees", "Des araignées géantes infestent la forêt.", true],
  ["insectes", "Des rats gros comme des chiens.", true],
  ["insectes", "Il a raté son coup, le pirate rate tout.", false],
  ["noyade", "Un noyé remonte de l'étang.", true],
  ["noyade", "Un vieux noyer ombrage la cour.", false],
  ["violences-sexuelles", "Un violon joue, la foule est violente.", false],
  ["violences-sexuelles", "Elle a été violée.", true],
  ["enfants", "L'enfant du forgeron pleure.", false],
  ["enfants", "Des enfants battus travaillent à la mine.", true],
  ["brules-vifs", "Le bûcheron coupe du bois.", false],
  ["brules-vifs", "On dresse le bûcher sur la place.", true],
  ["brules-vifs", "Trois hérétiques brûlés vifs.", true],
  ["gore", "Le corps est démembré.", true],
  ["suicide", "Il a tenté de se suicider.", true],
  ["esclavage", "Les esclavagistes du port.", true],
  ["sexe", "Ils passent une nuit d'amour.", true],
];
for (const [cle, texte, attendu] of CAS) ok(trouve({ cle }, texte) === attendu, `${cle} dans « ${texte} » : ${!attendu ? "trouvé" : "manqué"}`);

// Une limite écrite à la main : ses mots pleins, au singulier comme au pluriel ; une phrase longue ne se cherche pas.
ok(trouve({ texte: "les serpents" }, "Un serpent dort sous la pierre."), "« les serpents » trouve « serpent »");
ok(trouve({ texte: "le serpent" }, "Des serpents partout."), "« le serpent » trouve « serpents »");
ok(!trouve({ texte: "les serpents" }, "Une serpe rouillée."), "« serpents » ne trouve pas « serpe »");
ok(trouve({ texte: "la mort d'un animal" }, "L'animal est mort de froid."), "« la mort d'un animal » : les deux mots dans le même texte");
ok(!trouve({ texte: "la mort d'un animal" }, "Le marchand est mort."), "« la mort d'un animal » ne trouve pas une mort seule");
ok(!trouve({ texte: "les chiens blessés" }, "Les chiens aboient. Plus loin, trois gardes blessés."), "« chiens blessés » : les deux mots dans une même phrase, pas éparpillés");
ok(trouve({ texte: "les chiens blessés" }, "Un chien blessé gémit sous la charrette."), "« chiens blessés » trouve « chien blessé »");
ok(chercheur({ texte: "quand on maltraite un cheval devant les autres personnages" }) === null, "une phrase longue ne se cherche pas");
ok(chercheur({ texte: "et le la" }) === null, "des petits mots seuls ne cherchent rien");

// La phrase de « Avant de jouer » : la scène par son heure, le chapitre, la fiche, groupés par genre.
const confort = { lignes: [{ cle: "torture", noms: ["Léa"], mj: false }], voiles: [{ texte: "les serpents", noms: [], mj: true }], reponses: 1, nommes: 1 };
const s = {
  id: "s1", nom: "Séance", deroule: [{ heure: "18:15", titre: "L'interrogatoire", note: "Il torture le passeur." }, { heure: "19:00", titre: "La fosse aux serpents", fait: true }],
  notes: "", scenario_id: "sc", pnj: ["p1"],
};
const scenario = { id: "sc", nom: "Le scénario", chapitres: [{ id: "c1", titre: "La crypte", texte: "Un serpent dort sur l'autel." }, { id: "c2", titre: "Rien", texte: "Il pleut." }] };
const pnj = [{ id: "p1", nom: "Frère Ysmar", connu: true, illustration: "x", secret: "Il a torturé des fidèles.", id_lieu: "" }];
const alertes = alertesConfort(s, confort, { sous: { pnj: [{ fiche: pnj[0] }], lieux: [], rencontres: [] }, scenario });
ok(alertes.length === 2, `deux limites touchées (${alertes.length})`);
const torture = alertes.find((a) => a.item.cle === "torture");
ok(torture && torture.niveau === "ligne" && torture.sources.map((x) => x.genre).join() === "scene,pnj", `torture : la scène et la fiche (${torture?.sources.map((x) => x.genre)})`);
const serpents = alertes.find((a) => a.item.texte === "les serpents");
ok(serpents && serpents.sources.map((x) => x.genre).join() === "chapitre", "serpents : le chapitre seul, pas la scène déjà jouée");
const html = htmlLigneConfort(ligneConfort(s, confort, { sous: { pnj: [{ fiche: pnj[0] }], lieux: [], rencontres: [] }, scenario }));
ok(html.includes("La scène de 18 h 15 et la fiche de <a href=\"#/pnj/p1\">Frère Ysmar</a> parlent de torture : une <b>ligne</b> de la tablée."), `phrase de la torture : ${html}`);
ok(html.includes("Le chapitre <a href=\"#/scenarios/sc?chapitre=c1\">«\u00a0La crypte\u00a0»</a> parle de «\u00a0les serpents\u00a0» : un <b>voile</b> de la tablée."), "phrase des serpents");
ok(html.includes("la torture <span class=\"ct-noms\">(Léa)</span>"), "le nom accepté suit la limite");
ok(html.includes('href="/carte-x"'), "la carte X à imprimer est à portée");
// Branchée dans avantDeJouer : la ligne vient en dernier, et rien quand personne n'a noté de limite.
const lignes = avantDeJouer(s, { pnj, scenarios: [scenario], confort });
ok(lignes.at(-1)?.genre === "confort", "la ligne du confort vient en dernier");
ok(htmlAvantDeJouer(lignes).includes("Confort de la table"), "l'encadré la montre");
ok(!avantDeJouer(s, { pnj, scenarios: [scenario], confort: { lignes: [], voiles: [] } }).some((l) => l.genre === "confort"), "sans limite, pas de ligne");
ok(!avantDeJouer(s, { pnj, scenarios: [scenario], confort: null }).some((l) => l.genre === "confort"), "confort illisible, pas de ligne");
ok(!avantDeJouer({ ...s, close: true }, { pnj, scenarios: [scenario], confort }).length, "séance close, rien");
// Un texte du joueur ne passe jamais tel quel dans la page.
const piege = htmlLigneConfort({ confort: { lignes: [{ texte: "<img src=x onerror=alert(1)>", noms: ["<b>Léa</b>"] }], voiles: [] }, alertes: [] });
ok(!piege.includes("<img") && !piege.includes("<b>Léa"), "les mots du joueur sont échappés");

const dossier = process.argv[2];
if (dossier) {
  // Ce que chaque thème trouverait dans les textes de la campagne : à relire d'un œil, rien ne doit y être absurde.
  const textes = [];
  for (const collection of ["seances", "scenarios", "pnj", "lieux", "rencontres"]) {
    let fichiers = [];
    try {
      fichiers = readdirSync(join(dossier, collection)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of fichiers) textes.push([`${collection}/${f}`, forme(readFileSync(join(dossier, collection, f), "utf8"))]);
  }
  for (const t of THEMES) {
    const ou = textes.filter(([, x]) => chercheur({ cle: t.cle })(x)).map(([nom]) => nom);
    if (ou.length) console.log(`${t.nom} : ${ou.length} fichier${ou.length > 1 ? "s" : ""} (${ou.slice(0, 4).join(", ")}${ou.length > 4 ? "…" : ""})`);
  }
}
console.log(`${verifs} vérifications, ${defauts} défaut${defauts > 1 ? "s" : ""}.`);
process.exit(defauts ? 1 : 0);
