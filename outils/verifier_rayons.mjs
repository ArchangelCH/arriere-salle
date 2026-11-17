// Vérifie l'échoppe de la TV sans navigateur (app/static/js/boutiques/rayons-tv.js) : les rayons dans l'ordre du MJ
// (celui de l'atelier, js/boutiques/commun.js grouper), chaque article une seule fois, jamais plus d'articles par rangée
// que permis, un rayon trop long qui continue sur la rangée suivante, deux articles par planche sur un téléphone ; une
// boutique trop grande pour un écran montrée par rayon (pagesEchoppe : chaque page lisible, chaque article une fois,
// l'ordre du MJ gardé) ; puis les vraies boutiques du dossier de données s'il est là (lues, jamais écrites), rangées
// pour une TV 1080p.
// Usage : node outils/verifier_rayons.mjs [dossier des boutiques, data/boutiques par défaut]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { grouper } from "../app/static/js/boutiques/commun.js";
import { ECHELLE_LISIBLE, articlesDeLaTv, disposition, pageDeLArticle, pageDemandee, pagesEchoppe, rangerRayons } from "../app/static/js/boutiques/rayons-tv.js";

const DOSSIER = process.argv[2] || new URL("../data/boutiques/", import.meta.url).pathname;
let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const json = (x) => JSON.stringify(x);
// L'ordre de lecture d'une échoppe rangée : rangée après rangée, de gauche à droite.
const lecture = (rangees) => rangees.flatMap((r) => r.flatMap((m) => m.articles));
const rayons = (rangees) => rangees.flatMap((r) => r.map((m) => m.categorie)).filter((c, i, t) => i === 0 || c !== t[i - 1]);

function controler(articles, nom) {
  const attendu = grouper(articles).flatMap((g) => g.articles);
  const ordre = grouper(articles).map((g) => g.categorie);
  for (let place = 1; place <= articles.length; place++) {
    const r = rangerRayons(articles, place);
    verifier(json(lecture(r.rangees)) === json(attendu), `${nom}, ${place} par rangée : chaque article une fois, dans l'ordre du MJ`);
    verifier(json(rayons(r.rangees)) === json(ordre), `${nom}, ${place} par rangée : les rayons dans l'ordre de l'atelier`);
    verifier(r.rangees.every((x) => x.reduce((t, m) => t + m.articles.length, 0) <= place), `${nom}, ${place} par rangée : aucune rangée trop pleine`);
  }
  const tv = disposition(articles, 1920, 1080);
  verifier(tv && tv.k > 0.5 && json(lecture(tv.rangees)) === json(attendu), `${nom} sur une TV 1080p : rangée dans l'ordre (k = ${tv && tv.k.toFixed(2)})`);
  const tel = disposition(articles, 390, 844);
  verifier(tel.rangees.every((x) => x.reduce((t, m) => t + m.articles.length, 0) <= 2) && json(lecture(tel.rangees)) === json(attendu), `${nom} sur un téléphone : deux par planche, dans l'ordre`);
  const pages = pagesEchoppe(articles);
  verifier(json(pages.flatMap((p) => p.articles)) === json(attendu), `${nom} par rayon : chaque article une fois, dans l'ordre du MJ`);
  verifier(pages.length === 1 || pages.every((p) => disposition(p.articles, 1920, 1080).k >= ECHELLE_LISIBLE),
    `${nom} par rayon : chaque page lisible à trois mètres`);
  verifier((pages.length === 1) === (tv.k >= ECHELLE_LISIBLE), `${nom} : une seule page si et seulement si tout tient`);
  return tv;
}

// L'échoppe de Torvin telle que le MJ l'a rangée : les soins d'abord, comme dans l'atelier (constat d16).
const a = (categorie, nom) => ({ categorie, nom, prix: "1" });
const thorvald = [a("Soins et potions", "Potion"), a("Soins et potions", "Kit"), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => a("Armes", `Arme ${i}`)),
  a("Armures", "Cuir"), a("Armures", "Mailles"), a("Armures", "Plaques"), a("Montures", "Cheval"),
  a("Curiosités", "Gemme S"), a("Curiosités", "Gemme M"), a("Curiosités", "Gemme L"), a("Équipement", "Corde")];
const tv = controler(thorvald, "Torvin");
verifier(tv.rangees[0][0].categorie === "Soins et potions", "le premier rayon de l'atelier est le premier de la TV");
// Un rayon plus long qu'une rangée entière continue sur la suivante, sa plaque répétée.
const long = rangerRayons([a("Armes", "1"), a("Armes", "2"), a("Armes", "3"), a("Armes", "4"), a("Armes", "5")], 3);
verifier(json(long.rangees.map((r) => r.map((m) => [m.categorie, m.articles.length]))) === json([[["Armes", 3]], [["Armes", 2]]]), "un long rayon passe sur deux planches");
// Un rayon qui ne tient plus dans la rangée commencée passe entier à la suivante.
const suite = rangerRayons([a("Soins", "1"), a("Soins", "2"), a("Armes", "1"), a("Armes", "2"), a("Armes", "3")], 4);
verifier(json(suite.rangees.map((r) => r.map((m) => m.articles.length))) === json([[2], [3]]), "le rayon suivant ne se coupe pas pour remplir une rangée");
controler([a("", "Sans rayon")], "un seul article sans rayon");

// Par rayon (E07) : Torvin tient sur un écran ; trente articles non, ni un rayon de quarante armes à lui seul.
verifier(pagesEchoppe(thorvald).length === 1 && pagesEchoppe(thorvald)[0].nom === "", "Torvin se montre en entier");
const n = (cat, k) => Array.from({ length: k }, (_, i) => ({ ...a(cat, `${cat} ${i}`), id: `${cat.charAt(0).toLowerCase()}${i}` }));
const bazar = [...n("Soins", 4), ...n("Armes", 10), ...n("Armures", 6), ...n("Montures", 2), ...n("Curiosités", 5), ...n("Equipement", 3)];
const pagesBazar = pagesEchoppe(bazar);
controler(bazar, "Bazar de trente articles");
verifier(pagesBazar.length === 2 && pagesBazar[0].nom === "Soins · Armes · Armures · Montures", `le bazar en deux rayons (${json(pagesBazar.map((p) => p.nom))})`);
const armes = pagesEchoppe(n("Armes", 40));
controler(n("Armes", 40), "Quarante armes");
verifier(armes.length === 2 && armes[1].nom === "Armes, suite", "un rayon trop long se coupe en « Armes », puis « Armes, suite »");
verifier(pageDemandee(pagesBazar, 7) === 1 && pageDemandee(pagesBazar, -3) === 0 && pageDemandee(pagesBazar, "1") === 0, "le rayon demandé est borné");
verifier(pageDeLArticle(pagesBazar, "c2") === 1 && pageDeLArticle(pagesBazar, "inconnu") === 0, "un article montré de près part sur son rayon");
verifier(json(articlesDeLaTv([{ nom: "Caché", cache: true }, { nom: " ", categorie: "x" }, { nom: "Corde", categorie: "  Équipement   divers " }]).map((x) => [x.nom, x.categorie]))
  === json([["Corde", "Équipement divers"]]), "l'atelier compte les articles que reçoit la TV : visibles, nommés, rayon resserré");

if (existsSync(DOSSIER)) {
  let n = 0;
  for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith(".json"))) {
    const b = JSON.parse(readFileSync(`${DOSSIER}/${f}`, "utf8"));
    const articles = (b.articles || []).filter((x) => x && !x.cache && String(x.nom || "").trim());
    if (articles.length) controler(articles, f);
    n++;
  }
  console.log(`${n} boutiques du dossier relues`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
