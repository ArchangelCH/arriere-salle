// Les liens d'un scénario vers les fiches (js/scenarios/fiches.js) : la recherche, l'insertion (rien d'autre du texte ne
// change : ni consigne, ni intertitre, ni liste, ni tableau), le « @ », les intertitres du sommaire (les mêmes que ceux
// de l'aperçu) et les liens morts. Les liens courts de la zone d'écriture (js/scenarios/liens-courts.js) : le texte
// enregistré revient octet pour octet, au hasard comme sur chaque vrai chapitre, et un lien inséré court ne change rien
// d'autre. Lit les fiches et les scénarios du dossier donné, sans rien y écrire.
//   node outils/verifier_liens_scenario.mjs [data]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consignesDuTexte } from "../app/static/js/scenarios/consignes.js";
import { arobaseOuvre, chercherFiches, cibleLien, fichesDe, indexFiches, insertionLien, intertitres, libelleDe, lienMort } from "../app/static/js/scenarios/fiches.js";
import { rendre } from "../app/static/js/scenarios/rendu.js";
import { LiensCourts, liensCourts, resoudreNom, versFichier, versZone } from "../app/static/js/scenarios/liens-courts.js";
import { finDuLien } from "../app/static/js/scenarios/fiches.js";

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

// ---- La recherche, sur des fiches inventées
const exemples = {
  pnj: [{ id: "vaslain", nom: "Vaslain", role: "Chef des brigands", lieu: "la-ferme" }, { id: "nanon", nom: "Nanon Aubel", role: "Meunière" },
    { id: "lou", nom: "Lou Aubel", role: "Son fils" }],
  lieux: [{ id: "la-ferme", nom: "La Ferme-Noire", type: "ruine", carte: "route" }, { id: "etang", nom: "L'étang des Roseaux", type: "point", carte: "route" },
    { id: "sans-carte", nom: "Le Gué", type: "point" }],
  plans: [{ id: "ferme", nom: "La Ferme-Noire", lieu: "la-ferme" }, { id: "camp", nom: "Le camp, au-dessus de l'étang", lieu: "etang" }],
  rencontres: [{ id: "ferme-r", nom: "La Ferme-Noire" }],
  cartes: [{ id: "route", nom: "La route de Tarvan" }],
};
const toutes = fichesDe(exemples);
verifier(toutes.length === 10 && toutes[0].genre === "pnj" && toutes.at(-1).genre === "carte", "toutes les fiches, triées par genre", json(toutes.map((f) => f.id)));
verifier(toutes.find((f) => f.id === "vaslain").route === "#/pnj/vaslain" && toutes.find((f) => f.id === "la-ferme").route === "#/carte/route?lieu=la-ferme"
  && toutes.find((f) => f.id === "sans-carte").route === "#/lieu/sans-carte" && toutes.find((f) => f.id === "ferme").route === "#/plan/ferme"
  && toutes.find((f) => f.id === "ferme-r").route === "#/combats/ferme-r" && toutes.find((f) => f.id === "route").route === "#/carte/route", "les routes des fiches");
verifier(toutes.find((f) => f.id === "vaslain").detail === "Chef des brigands · La Ferme-Noire", "le détail d'un PNJ : rôle et lieu");
const ids = (q) => chercherFiches(toutes, q).map((f) => f.id);
verifier(ids("vas")[0] === "vaslain", "« vas » trouve Vaslain", json(ids("vas")));
verifier(json(ids("ferme").slice(0, 3)) === json(["la-ferme", "ferme", "ferme-r"]), "« ferme » : le lieu, le plan, la rencontre", json(ids("ferme")));
verifier(json(ids("ETANG")) === json(["etang", "camp"]), "sans casse ni accents, un mot du nom", json(ids("ETANG")));
verifier(json(ids("aubel")) === json(["lou", "nanon"]), "plusieurs PNJ du même nom de famille", json(ids("aubel")));
verifier(ids("brigands")[0] === "vaslain" && ids("meuniere")[0] === "nanon", "par le rôle", json([ids("brigands"), ids("meuniere")]));
verifier(ids("lou aub")[0] === "lou" && ids("zzz").length === 0 && ids("").length === toutes.length, "plusieurs mots, rien, recherche vide");

// ---- L'insertion, cas choisis
const VAS = toutes.find((f) => f.id === "vaslain");
const appliquer = (t, r) => t.slice(0, r.debut) + r.insere + t.slice(r.fin);
const inserer = (t, a, b = a, o) => appliquer(t, insertionLien(t, a, b, VAS, o));
const L = "[Vaslain](#/pnj/vaslain)";
const cas = [
  ["au curseur, entre deux mots", "Il voit  arriver.", 8, 8, `Il voit ${L} arriver.`],
  ["collé à un mot : une espace", "chez", 4, 4, `chez ${L}`],
  ["avant une ponctuation : rien", "Il voit .", 8, 8, `Il voit ${L}.`],
  ["après une apostrophe : rien", "l'", 2, 2, `l'${L}`],
  ["un mot choisi devient le libellé", "Voici Vaslain, enfin.", 6, 13, "Voici [Vaslain](#/pnj/vaslain), enfin."],
  ["les blancs du choix restent dehors", "Voici Vaslain enfin.", 5, 14, "Voici [Vaslain](#/pnj/vaslain) enfin."],
  ["l'emphase reste autour", "Voici **le chef** ici.", 6, 16, "Voici **[le chef](#/pnj/vaslain)** ici."],
  ["choix sur deux lignes : lien après", "un\ndeux", 0, 7, `un\ndeux ${L}`],
  ["curseur dans un lien : après lui", "[Nanon](#/pnj/nanon) rit.", 3, 3, `[Nanon](#/pnj/nanon) ${L} rit.`],
  ["curseur dans une consigne : après elle", "Avant [[pistes : un nom]] après.", 12, 12, `Avant [[pistes : un nom]] ${L} après.`],
  ["choix dans une consigne : après elle", "Un [[pnj : le frère de Nanon]].", 23, 28, `Un [[pnj : le frère de Nanon]] ${L}.`],
  ["devant un intertitre : après la marque", "## Le chef", 0, 0, `## ${L} Le chef`],
  ["intertitre choisi avec sa marque : lien après", "## Le chef", 0, 10, `## Le chef ${L}`],
  ["devant une puce", "- Nanon", 0, 0, `- ${L} Nanon`],
  ["devant un encadré à lire", "> Il entre.", 0, 0, `> ${L} Il entre.`],
  ["au bout d'une rangée : dans la dernière cellule", "| a | b |", 9, 9, `| a | b ${L} |`],
  ["séparation d'un tableau : après le tableau", "| a | b |\n|---|---|\n| c | d |\nSuite", 12, 12, `| a | b |\n|---|---|\n| c | d |\n${L}\nSuite`],
  ["filet : sur sa ligne", "---\nSuite", 1, 1, `---\n${L}\nSuite`],
  ["consigne seule : sur sa propre ligne, après", "[[carte blanche : x]]\nSuite", 21, 21, `[[carte blanche : x]]\n${L}\nSuite`],
  ["consigne seule : sur sa propre ligne, avant", "[[carte blanche : x]]", 0, 0, `${L}\n[[carte blanche : x]]`],
  ["après un crochet seul : une espace", "voir [", 6, 6, `voir [ ${L}`],
  ["au milieu d'un mot : après le mot", "la Ferme-Noire brûle", 6, 6, `la Ferme-Noire ${L} brûle`],
  ["dans un mot-clé : après lui", "#auberge et", 1, 1, `#auberge ${L} et`],
  ["après un « * » en début de ligne : collé", "*italique*", 1, 1, `*${L} italique*`],
  ["après « 1. » en début de ligne : collé", "1.", 2, 2, `1.${L}`],
  ["à la place du « @ »", "Il voit @ arriver.", 9, 9, `Il voit ${L} arriver.`, { arobase: 8 }],
];
for (const [nom, t, a, b, attendu, o] of cas) {
  const obtenu = inserer(t, a, b, o);
  verifier(obtenu === attendu, `insertion : ${nom}`, `${json(obtenu)} au lieu de ${json(attendu)}`);
}
verifier(libelleDe("Voici Vaslain, enfin.", 6, 13) === "Vaslain" && libelleDe("a\nb", 0, 3) === null && libelleDe("#auberge", 0, 8) === null
  && libelleDe("x [y](#/pnj/y)", 0, 5) === null && libelleDe("| a | b |", 2, 7) === null, "ce qui peut servir de libellé");

// ---- Le « @ »
const arobases = [
  ["@", 0, true], ["Il voit @", 8, true], ["(@)", 1, true], ["« @", 2, true], ["l'@", 2, true], ["camille@exemple.ch", 7, false],
  ["Il voit @Vaslain", 8, false], ["a @@", 3, false], ["[[pnj : un @]]", 11, false], ["[Ni @](#/pnj/n)", 4, false], ["x", 0, false],
];
for (const [t, i, attendu] of arobases) verifier(arobaseOuvre(t, i) === attendu, `« @ » dans ${json(t)}`, `obtenu ${arobaseOuvre(t, i)}`);

// ---- L'insertion, au hasard : rien d'autre ne change, le lien est rendu
const squelette = (t) => {
  const h = rendre(t);
  const n = (re) => (h.match(re) || []).length;
  return { titres: n(/<h[2-5]>/g), li: n(/<li>/g), tr: n(/<tr>/g), bq: n(/<blockquote/g), hr: n(/<hr>/g), ul: n(/<ul>/g), ol: n(/<ol[ >]/g), table: n(/<table>/g),
    consignes: consignesDuTexte(t).map((c) => `${c.cle}|${c.bloc}`), niveaux: intertitres(t).map((x) => x.niveau) };
};
const MORCEAUX = ["Nanon", "Toma", "l'auberge", "Vaslain", "la Ferme-Noire", "et", "puis", "**gras**", "*italique*", "#auberge", "(entre parenthèses)",
  "« guillemets »", "fin.", "virgule,", "@", "x@y.ch", "[Nanon](#/pnj/nanon-aubel)", "[[pistes : un nom]]", "[[carte blanche : a\nb]]", "  ", "\n", "\n\n"];
const LIGNES = ["## Intertitre", "### Sous-titre", "#### Petit", "> À lire", ">", "- puce", "  - sous-puce", "1. Un", "2) Deux", "  suite de puce", "| a | b |",
  "|---|---|", "| [x](#/plan/x) | **c** |", "---", "***", "[[pistes : un nom de village]]", "  [[vérifier : la date]]  ", "", "#mot seul"];
// Tirage reproductible (mulberry32).
let graine = 20261101;
const hasard = (n) => {
  graine = (graine + 0x6d2b79f5) | 0;
  let x = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) % n;
};
const texteAuHasard = () => {
  const lignes = [];
  for (let i = 0, n = 1 + hasard(12); i < n; i++) {
    if (hasard(3) === 0) lignes.push(LIGNES[hasard(LIGNES.length)]);
    else lignes.push(Array.from({ length: 1 + hasard(6) }, () => MORCEAUX[hasard(MORCEAUX.length)]).join(hasard(4) ? " " : ""));
  }
  return lignes.join("\n");
};
let auHasard = 0;
for (let k = 0; k < 6000; k++) {
  const t = texteAuHasard();
  let a = hasard(t.length + 1);
  let b = hasard(3) ? a : hasard(t.length + 1);
  if (b < a) [a, b] = [b, a];
  const arobase = t[a - 1] === "@" && a === b && arobaseOuvre(t, a - 1) && hasard(2) ? a - 1 : null;
  const fiche = toutes[hasard(toutes.length)];
  const r = insertionLien(t, a, b, fiche, { arobase });
  const nouveau = appliquer(t, r);
  const lien = r.insere.match(/\[([^\]\n]+)\]\(([^)\s]+)\)/);
  const quoi = `${json(t)} [${a}, ${b}]${arobase !== null ? " @" : ""} → ${json(nouveau)}`;
  auHasard++;
  verifier(lien && lien[2] === fiche.route, "un seul lien, vers la fiche", quoi);
  if (arobase !== null) verifier(r.debut === arobase && r.fin === arobase + 1, "le « @ » seul est remplacé", quoi);
  else if (r.fin > r.debut) {
    // Le passage choisi reste tel quel : retirer les marques du lien redonne le texte d'avant.
    const sansLien = r.insere.replace(`](${fiche.route})`, "").replace("[", "").replace(/^ (?=\S)/, (s) => (t[r.debut - 1] === "[" ? "" : s));
    verifier(r.debut === a && r.fin === b && sansLien === t.slice(a, b), "le choix devient le libellé, sans rien changer d'autre", quoi);
  } else verifier(/^[ \n]?\[[^\]\n]+\]\([^)\s]+\)[ \n]?$/.test(r.insere), "au curseur : le lien et au plus un blanc de chaque côté", quoi);
  const avant = squelette(t);
  const apres = squelette(nouveau);
  verifier(json(avant.consignes) === json(apres.consignes), "les consignes ne bougent pas", `${quoi}\n  ${json(avant.consignes)} → ${json(apres.consignes)}`);
  verifier(json(avant.niveaux) === json(apres.niveaux) && avant.titres === apres.titres, "les intertitres ne bougent pas", quoi);
  for (const k2 of ["li", "tr", "bq", "hr", "ul", "ol", "table"]) verifier(avant[k2] === apres[k2], `rien ne se défait (${k2})`, `${quoi}\n  ${avant[k2]} → ${apres[k2]}`);
  const compte = (h) => h.split(`href="${fiche.route}"`).length - 1;
  verifier(compte(rendre(nouveau)) === compte(rendre(t)) + 1, "le lien est rendu dans l'aperçu", quoi);
}

// ---- Les intertitres du sommaire sont ceux de l'aperçu
const titresRendus = (t) => (rendre(t).match(/<h[2-5]>/g) || []).length;
const titres = [
  ["## Un\ntexte\n### Deux", ["Un", "Deux"]],
  ["## [Nanon](#/pnj/nanon) et **Lou**", ["Nanon et Lou"]],
  ["[[carte blanche : a\n## pas un titre]]\n## Vrai", ["Vrai"]],
  ["## Titre [[pistes : x\ny]] fin", ["Titre"]],
  ["#mot\n##pas\n##### pas\n## ", [""]],
];
for (const [t, attendu] of titres) {
  const obtenu = intertitres(t).map((x) => x.titre);
  verifier(json(obtenu) === json(attendu) && obtenu.length === titresRendus(t), `intertitres de ${json(t)}`, json(obtenu));
}
for (let k = 0; k < 2000; k++) {
  const t = texteAuHasard();
  verifier(intertitres(t).length === titresRendus(t), "autant d'intertitres que dans l'aperçu", json(t));
}
const debuts = intertitres("a\n## b\n\n### c");
verifier(json(debuts.map((x) => [x.rang, x.niveau, x.debut])) === json([[0, 2, 2], [1, 3, 8]]), "rang, niveau et début de ligne", json(debuts));

// ---- Les liens morts
const index = indexFiches(exemples);
const morts = [["#/pnj/vaslain", false], ["#/pnj/disparu", true], ["#/plan/camp", false], ["#/plan/x", true], ["#/combats/ferme-r", false],
  ["#/combats/autre", true], ["#/carte/route?lieu=etang", false], ["#/carte/route?lieu=parti", true], ["#/carte/nulle", true], ["#/lieux", false],
  // Le lieu d'une carte jetée : le lien ouvre sa fiche tant qu'il existe.
  ["#/carte/nulle?lieu=etang", false], ["#/carte/nulle?lieu=parti", true], ["#/lieu/sans-carte", false], ["#/lieu/parti", true],
  ["#/idees?mot=auberge", false], ["#/pnj/nouveau?lieu=x", false], ["#/pnj", false], ["https://exemple.ch", false]];
for (const [href, attendu] of morts) verifier(lienMort(href, index) === attendu, `lien mort ${href}`);
verifier(!lienMort("#/pnj/disparu", { ...index, pnj: null }) && cibleLien("#/pnj/a%20b")?.id === "a b" && cibleLien("#/pnj/%E0") === null,
  "liste illisible : rien de mort ; identifiant encodé");
// L'ancien identifiant d'une fiche renommée depuis (liens_fiches.py) : son lien n'est pas mort, sauf si la fiche est jetée.
const renomme = indexFiches({ ...exemples, renommages: { pnj: { "nouveau-pnj": "vaslain", "jete": "disparu" }, lieux: { "village-sans-nom": "etang" } } });
verifier(!lienMort("#/pnj/nouveau-pnj", renomme) && lienMort("#/pnj/jete", renomme) && !lienMort("#/carte/route?lieu=village-sans-nom", renomme)
  && lienMort("#/pnj/nouveau-pnj", index), "ancien identifiant d'une fiche renommée");

// ---- Les liens courts : cas choisis
const allerRetour = (t) => {
  const { zone, table } = versZone(t);
  return { zone, table, retour: versFichier(zone, table) };
};
const courts = [
  ["un lien vers un PNJ", "Voici [Nanon](#/pnj/nanon) qui rit.", "Voici @[Nanon] qui rit."],
  ["deux fois le même", "[Nanon](#/pnj/nanon) et [Nanon](#/pnj/nanon).", "@[Nanon] et @[Nanon]."],
  ["un lieu d'une carte", "Vers [la ferme](#/carte/route?lieu=la-ferme).", "Vers @[la ferme]."],
  ["un lieu sans carte, un plan, une rencontre", "[Le Gué](#/lieu/sans-carte), [camp](#/plan/camp), [Ferme](#/combats/ferme-r)", "@[Le Gué], @[camp], @[Ferme]"],
  ["un lien vers la série reste entier", "[S3 E12 00:19:18](https://youtu.be/x?t=1)", "[S3 E12 00:19:18](https://youtu.be/x?t=1)"],
  ["un lien vers une affiche reste entier", "[Perdu](#/auberge/contrat/perdu)", "[Perdu](#/auberge/contrat/perdu)"],
  ["deux Billy différents restent entiers", "[Billy](#/pnj/billy-1) puis [Billy](#/pnj/billy-2)", "[Billy](#/pnj/billy-1) puis [Billy](#/pnj/billy-2)"],
  ["dans une consigne, entier", "[[pnj : un ami de [Lou](#/pnj/lou)]]", "[[pnj : un ami de [Lou](#/pnj/lou)]]"],
  ["suivi de « ( », entier", "[Lou](#/pnj/lou)(son fils)", "[Lou](#/pnj/lou)(son fils)"],
  ["suivi de « ] », entier", "[[ note [Lou](#/pnj/lou)]", "[[ note [Lou](#/pnj/lou)]"],
  ["un « @ » devant", "@[Lou](#/pnj/lou)", "@@[Lou]"],
  ["un @[nom] déjà écrit garde son libellé", "[Lou](#/pnj/lou) et @[Lou]", "[Lou](#/pnj/lou) et @[Lou]"],
  ["intertitre, encadré, tableau", "## [Nanon](#/pnj/nanon)\n> [Lou](#/pnj/lou)\n| [x](#/plan/x) | b |", "## @[Nanon]\n> @[Lou]\n| @[x] | b |"],
];
for (const [nom, t, zoneAttendue] of courts) {
  const r = allerRetour(t);
  verifier(r.zone === zoneAttendue, `zone courte : ${nom}`, `${json(r.zone)} au lieu de ${json(zoneAttendue)}`);
  verifier(r.retour === t, `fichier rendu tel quel : ${nom}`, json(r.retour));
}
verifier(versFichier("Puis @[Lou Aubel] arrive.", new Map(), (n) => (n === "Lou Aubel" ? "#/pnj/lou" : null)) === "Puis [Lou Aubel](#/pnj/lou) arrive.",
  "un @[Nom] tapé se résout par le nom");
verifier(versFichier("Puis @[Personne] arrive.", new Map(), () => null) === "Puis @[Personne] arrive.", "sans fiche de ce nom, il reste tel quel");
verifier(versFichier("[[pnj : @[Lou]]]", new Map([["Lou", "#/pnj/lou"]])) === "[[pnj : @[Lou]]]", "dans une consigne, rien ne se résout");
verifier(resoudreNom("nanon aubel", toutes) === "#/pnj/nanon" && resoudreNom("LA FERME-NOIRE", toutes) === "#/carte/route?lieu=la-ferme"
  && resoudreNom("Le camp, au-dessus de l'étang", toutes) === "#/plan/camp" && resoudreNom("Personne", toutes) === null,
  "résoudre un nom : sans casse ni accents, le PNJ, puis le lieu (avant le plan et la rencontre du même nom), puis le plan");
verifier(resoudreNom("Billy", fichesDe({ pnj: [{ id: "b1", nom: "Billy" }, { id: "b2", nom: "Billy" }] })) === null, "deux fiches du même nom : rien de résolu");
verifier(finDuLien("Voici @[Nanon] ici", 9) === 14 && finDuLien("Voici @[Nanon] ici", 15) === -1 && !arobaseOuvre("@[Ni @]", 4),
  "le curseur dans un lien court : il compte comme un lien");
verifier(json(liensCourts("@[a] [[pnj : @[b]]] @[c]").map((l) => l.libelle)) === json(["a", "c"]), "les liens courts hors des consignes");
// Effacé puis remis (Ctrl+Z), un lien dont le libellé n'est pas le nom de la fiche retrouve son adresse.
const memoire = new LiensCourts(() => toutes);
const chap = { id: "c1", texte: "Le chef, [le meunier](#/pnj/vaslain), attend." };
const zoneChap = memoire.zone(chap);
verifier(memoire.fichier(chap, zoneChap.replace("@[le meunier]", "")) === "Le chef, , attend." && memoire.fichier(chap, zoneChap) === chap.texte,
  "Ctrl+Z après un lien effacé : son adresse revient");
verifier(memoire.retenir(chap, zoneChap, "le meunier", "#/pnj/vaslain") && !memoire.retenir(chap, zoneChap, "le meunier", "#/pnj/nanon")
  && memoire.retenir(chap, "plus de meunier ici", "le meunier", "#/pnj/nanon"), "un libellé pris par une autre adresse : le lien s'écrit en entier");

// ---- Les liens courts, au hasard : le fichier revient octet pour octet, l'insertion courte ne change rien d'autre
const MORCEAUX_COURTS = [...MORCEAUX, "[Lou](#/pnj/lou)", "[Lou](#/pnj/lou-2)", "[la ferme](#/carte/route?lieu=la-ferme)", "@[Lou]", "@[Nanon]",
  "[S3](https://youtu.be/x)", "](", ")(", "@", "@@", "[", "]", "[[pnj : [Nanon](#/pnj/nanon-aubel)]]", "[x](#/plan/x)(y)", "[[", "]]"];
let courtsAuHasard = 0;
for (let k = 0; k < 6000; k++) {
  const lignes = [];
  for (let i = 0, n = 1 + hasard(10); i < n; i++) {
    if (hasard(4) === 0) lignes.push(LIGNES[hasard(LIGNES.length)]);
    else lignes.push(Array.from({ length: 1 + hasard(7) }, () => MORCEAUX_COURTS[hasard(MORCEAUX_COURTS.length)]).join(hasard(3) ? " " : ""));
  }
  const t = lignes.join("\n");
  const { zone, table, retour } = allerRetour(t);
  courtsAuHasard++;
  verifier(retour === t, "au hasard : le fichier revient tel quel", json(t));
  verifier(json(consignesDuTexte(zone).map((c) => c.cle)) === json(consignesDuTexte(t).map((c) => c.cle)), "au hasard : la zone garde les consignes du fichier", json(t));
  // Un lien inséré court dans la zone : le fichier gagne ce lien, et rien d'autre ne se défait. Un « ]( » orphelin défait
  // déjà l'insertion entière, celle d'avant les liens courts : ces textes-là ne servent qu'à l'aller-retour.
  if (/\]\((?![^)\s]+\))/.test(zone) || /\]\([^)\s]*\[/.test(zone)) continue;
  let a = hasard(zone.length + 1);
  let b = hasard(3) ? a : hasard(zone.length + 1);
  if (b < a) [a, b] = [b, a];
  const fiche = toutes[hasard(toutes.length)];
  const memo = new Map(table);
  const r = insertionLien(zone, a, b, fiche, { court: (libelle) => (memo.has(libelle) && memo.get(libelle) !== fiche.route ? false : (memo.set(libelle, fiche.route), true)) });
  const nouveau = versFichier(appliquer(zone, r), memo);
  const compte = (h) => h.split(`href="${fiche.route}"`).length - 1;
  verifier(compte(rendre(nouveau)) === compte(rendre(t)) + 1, "au hasard : le lien inséré court est rendu, une fois", `${json(zone)} [${a}, ${b}] → ${json(nouveau)}`);
  const [x, y] = [squelette(t), squelette(nouveau)];
  verifier(json(x.consignes) === json(y.consignes) && x.titres === y.titres && x.li === y.li && x.tr === y.tr && x.bq === y.bq,
    "au hasard : l'insertion courte ne défait rien", `${json(zone)} [${a}, ${b}] → ${json(nouveau)}`);
}

// ---- Les vraies données, lues seulement
const dossier = process.argv[2] || "data";
let reels = "";
if (existsSync(join(dossier, "pnj"))) {
  const lire = (sous) => (existsSync(join(dossier, sous)) ? readdirSync(join(dossier, sous)).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dossier, sous, f), "utf-8"))) : []);
  const listes = { pnj: lire("pnj"), lieux: lire("lieux"), plans: lire("plans"), rencontres: lire("rencontres"), cartes: lire("cartes").map(({ id, nom }) => ({ id, nom })) };
  const vraies = fichesDe(listes);
  const n = Object.values(listes).reduce((s, l) => s + l.length, 0);
  verifier(vraies.length === n && vraies.every((f) => /^#\/[\w\-/?=&;%.]*$/.test(f.route)), "chaque vraie fiche a une route que l'aperçu sait rendre");
  verifier(vraies.every((f) => !lienMort(f.route, indexFiches(listes))), "aucune vraie fiche ne passe pour morte");
  let chapitres = 0;
  var courtsReels = 0;
  for (const s of lire("scenarios")) {
    for (const ch of s.chapitres || []) {
      chapitres++;
      const t = ch.texte || "";
      verifier(intertitres(t).length === titresRendus(t), `intertitres du chapitre « ${ch.titre} » de « ${s.nom} »`);
      // Le texte du MJ principal : ouvert en liens courts, il revient tel quel, et la zone ne montre plus d'adresse de fiche.
      const { zone, table } = versZone(t);
      verifier(versFichier(zone, table) === t, `liens courts : « ${ch.titre} » de « ${s.nom} » revient tel quel`);
      verifier(versFichier(zone, table, (n) => resoudreNom(n, vraies)) === t, `liens courts : « ${ch.titre} » revient tel quel, noms résolus`);
      verifier(intertitres(zone).length === intertitres(t).length && json(consignesDuTexte(zone).map((c) => c.cle)) === json(consignesDuTexte(t).map((c) => c.cle)),
        `liens courts : « ${ch.titre} » garde ses intertitres et ses consignes`);
      const restes = [...zone.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)].filter((m) => cibleLien(m[2]));
      verifier(restes.every((m) => [...t.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)].some((n) => n[1] === m[1] && n[2] !== m[2]) || /[([\]]/.test(zone[m.index + m[0].length] || "") || m[1].includes("[")),
        `liens courts : dans « ${ch.titre} », seuls restent entiers les libellés ambigus`, json(restes.map((m) => m[0])));
      courtsReels += table.size;
      for (let k = 0; k < 300 && t; k++) {
        const a = hasard(t.length + 1);
        const fiche = vraies[hasard(vraies.length)];
        const nouveau = appliquer(t, insertionLien(t, a, a, fiche));
        const [x, y] = [squelette(t), squelette(nouveau)];
        verifier(json(x) === json(y) && nouveau.length > t.length, `insertion dans « ${ch.titre} » sans rien défaire`, `${a} : ${json(nouveau.slice(Math.max(0, a - 40), a + 60))}`);
      }
    }
  }
  reels = `, ${vraies.length} vraies fiches, ${chapitres} chapitres réels, ${courtsReels} libellés raccourcis`;
}

console.log(echecs ? `${echecs} échec(s) sur ${essais} vérifications` : `Aucun défaut : ${essais} vérifications (${auHasard} insertions au hasard, ${courtsAuHasard} allers-retours courts${reels}).`);
process.exit(echecs ? 1 : 0);
