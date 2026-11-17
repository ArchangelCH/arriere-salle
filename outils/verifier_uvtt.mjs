// Vérifie l'import d'un plan Universal VTT (js/plan/uvtt.js) sans navigateur, sur les petits fichiers de tests/uvtt/ :
// la lecture (taille, origine, points en { x, y } ou en [x, y]), les erreurs dites au MJ (fichier illisible, sans image,
// trop grand), puis la conversion : pièces, zone extérieure, portes ouvertes ou fermées, case murée laissée vide. Les murs
// ne sont jamais stockés : ceux que calculerMurs déduit du plan importé tombent exactement sur les arêtes barrées entre
// deux pièces, et un pion (js/plan/deplacement.js) ne traverse pas un mur importé, passe une porte ouverte, n'ouvre une
// porte fermée que si « entrer » le permet. Les plans attendus sont dans tests/uvtt-cas.json : tests/test_uvtt.py les
// rejoue côté serveur (murs_du_plan, deplacement.py), sans node.
//   node outils/verifier_uvtt.mjs            vérifie
//   node outils/verifier_uvtt.mjs --ecrire   récrit tests/uvtt-cas.json d'après la conversion du moment (à relire)
import { readFileSync, writeFileSync } from "node:fs";
import { atteignables } from "../app/static/js/plan/deplacement.js";
import { calculerMurs, casesArete } from "../app/static/js/plan/modele.js";
import {
  COTE_IMAGE, ErreurUvtt, PX_PAR_CASE, aretesBarrees, convertir, lireUvtt, octetsDeBase64, phrasesBilan, tailleReduite, typeImage,
} from "../app/static/js/plan/uvtt.js";

const ICI = new URL("../tests/", import.meta.url);
const CAS = new URL("uvtt-cas.json", ICI);
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

// Les déplacements essayés sur chaque plan : [nom, départ, arrivée, entrer, atteint, distance].
const ESSAIS = {
  "maison.dd2vtt": [
    ["la porte intérieure ouverte se passe", [2, 1], [5, 1], false, true, 3],
    ["le mur entre les deux salles ne se traverse pas (détour par la porte)", [3, 1], [4, 1], false, true, 3],
    ["du pré, la porte d'entrée fermée arrête", [0, 0], [3, 4], false, false, null],
    ["du pré, « entrer » ouvre la porte d'entrée", [0, 0], [3, 4], true, true, 8],
    ["le mur d'enceinte ne se traverse pas", [1, 1], [2, 1], false, false, null],
    ["on fait le tour de la maison", [0, 0], [7, 5], false, true, 11],
  ],
  "biais.uvtt": [
    ["le mur en biais, ramené au quadrillage, ne se traverse pas", [1, 3], [0, 4], false, false, null],
    ["la salle aux murs tracés au milieu des cases reste fermée", [3, 0], [4, 0], false, false, null],
    ["sa porte fermée s'ouvre avec « entrer »", [4, 2], [4, 1], true, true, 1],
    ["la case murée n'a pas de sol", [1, 1], [2, 1], true, false, null],
  ],
  "sans-murs.json": [
    ["sans mur, tout le plan se parcourt", [0, 0], [4, 3], false, true, 4],
  ],
};

let n = 0;
const identifiant = () => `p${++n}`;
function importer(fichier) {
  n = 0;
  const u = lireUvtt(readFileSync(new URL(`uvtt/${fichier}`, ICI), "utf8"));
  return { u, c: convertir(u, identifiant) };
}

// Ce que le parcours lit : la projection d'un plan sans brouillard, avec les murs déduits.
const projection = (plan) => ({ ...plan, murs: [...calculerMurs(plan)], brouillard_actif: false, objets: [], pions: [] });

if (process.argv.includes("--ecrire")) {
  const cas = Object.keys(ESSAIS).map((fichier) => {
    const { u, c } = importer(fichier);
    const { bilan, ...plan } = c;
    return { fichier, fond: u.fond, plan, murs: [...calculerMurs(plan)], bilan, essais: ESSAIS[fichier].map(([nom, de, vers, entrer, atteint, distance]) => ({ nom, de, vers, entrer, atteint, distance })) };
  });
  writeFileSync(CAS, `${JSON.stringify({ cas }, null, 1)}\n`);
  console.log(`tests/uvtt-cas.json récrit : ${cas.length} plans.`);
  process.exit(0);
}

const attendus = JSON.parse(readFileSync(CAS, "utf8")).cas;
verifier(pareil(attendus.map((c) => c.fichier), Object.keys(ESSAIS)), "les cas communs couvrent les fichiers d'essai");

for (const cas of attendus) {
  const { u, c } = importer(cas.fichier);
  const { bilan, ...plan } = c;
  const nom = cas.fichier;
  verifier(pareil(plan, cas.plan), `${nom} : le plan converti est celui des cas communs`);
  verifier(pareil(bilan, cas.bilan), `${nom} : le bilan`, JSON.stringify(bilan));
  verifier(pareil(u.fond, cas.fond), `${nom} : la place de l'image`, JSON.stringify(u.fond));
  verifier(!("murs" in plan), `${nom} : aucun mur stocké dans le plan`);
  const { largeur: w, hauteur: h } = plan;
  verifier(w >= 4 && h >= 4 && w <= 160 && h <= 160 && plan.sol.length === w * h && plan.piece.length === w * h, `${nom} : la taille`);
  verifier(plan.pieces.every((pc) => ["salle", "exterieur"].includes(pc.genre) && pc.nom && Number.isInteger(pc.id)), `${nom} : des pièces nommées`);
  verifier(plan.sol.every((s, i) => (s > 0) === (plan.piece[i] > 0)), `${nom} : un sol sous chaque pièce, rien ailleurs`);
  verifier(plan.piece.every((id) => !id || plan.pieces.some((pc) => pc.id === id)), `${nom} : chaque case a sa pièce dans la liste`);
  // Les murs déduits, arête par arête : un mur là où une arête barrée sépare deux pièces, et nulle part ailleurs.
  const murs = calculerMurs(plan);
  verifier(pareil([...murs], cas.murs), `${nom} : les murs déduits sont ceux des cas communs`);
  const { V, H } = aretesBarrees(u);
  let defauts = 0;
  let perdus = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (const [nx, ny, bit, inverse, barree] of [[x + 1, y, 2, 8, V[y * (w + 1) + x + 1]], [x, y + 1, 4, 1, H[(y + 1) * w + x]]]) {
        if (nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!plan.sol[i] || !plan.sol[j]) continue;
        const mur = !!(murs[i] & bit);
        if (mur !== !!(murs[j] & inverse)) defauts++;
        if (plan.piece[i] !== plan.piece[j]) {
          if (!barree || !mur) defauts++;
        } else {
          if (mur) defauts++;
          if (barree) perdus++;
        }
      }
    }
  }
  verifier(defauts === 0, `${nom} : chaque arête barrée entre deux pièces est un mur, et rien d'autre`, `${defauts} arête(s)`);
  verifier(perdus === bilan.perdus, `${nom} : les bouts de mur perdus sont comptés`, `${perdus} contre ${bilan.perdus}`);
  // Les portes : sur un mur, entre deux pièces différentes.
  for (const d of plan.portes) {
    const [[ax, ay], [bx, by]] = casesArete(d.sens, d.x, d.y);
    const a = plan.piece[ay * w + ax];
    const b = plan.piece[by * w + bx];
    verifier(a && b && a !== b && ["ouverte", "fermee"].includes(d.etat) && d.genre === "porte", `${nom} : la porte ${d.sens}:${d.x}:${d.y} sépare deux pièces`);
  }
  for (const e of cas.essais) {
    const v = atteignables(projection(plan), { depart: e.de, entrer: e.entrer }).get(`${e.vers[0]},${e.vers[1]}`);
    verifier(!!v === e.atteint && (!e.atteint || v.d === e.distance), `${nom} : ${e.nom}`, JSON.stringify(v || null));
  }
  verifier(phrasesBilan(bilan).every((t) => !t.includes("—")) && phrasesBilan(bilan)[0].startsWith("Plan importé"), `${nom} : le bilan se dit`);
}

// Ce que chaque fichier doit donner, dit en clair (les cas communs pourraient être récrits de travers).
const maison = importer("maison.dd2vtt").c;
verifier(maison.bilan.salles === 2 && maison.bilan.exterieurs === 1 && maison.bilan.portes === 2 && maison.bilan.lumieres === 2 && !maison.bilan.biais, "maison : deux salles, le pré, deux portes, deux lumières perdues");
verifier(pareil(maison.portes.map(({ id, ...d }) => d), [{ sens: "v", x: 4, y: 2, genre: "porte", etat: "ouverte" }, { sens: "h", x: 3, y: 5, genre: "porte", etat: "fermee" }]), "maison : la porte intérieure ouverte, la porte d'entrée fermée");
verifier(maison.pieces.find((pc) => pc.genre === "exterieur")?.nom === "Extérieur" && pareil(maison.pieces.filter((pc) => pc.genre === "salle").map((pc) => pc.nom), ["Salle 1", "Salle 2"]), "maison : « Extérieur », « Salle 1 », « Salle 2 »");
verifier(maison.piece.filter((v) => v === 2).length === 8 && maison.piece.filter((v) => v === 3).length === 8, "maison : huit cases par salle");
const biais = importer("biais.uvtt");
verifier(biais.u.largeur === 7 && biais.u.hauteur === 5 && biais.u.fond.x === 0.5 && biais.u.fond.y === 0, "biais : une origine à cheval décale l'image d'une demi-case");
verifier(biais.c.bilan.enfermees === 1 && biais.c.sol[1 * 7 + 2] === 0 && biais.c.piece[1 * 7 + 2] === 0, "biais : la case murée reste vide");
verifier(biais.c.bilan.portes === 1 && biais.c.bilan.portes_perdues === 1 && biais.c.bilan.biais > 0 && biais.c.bilan.lumieres === 3, "biais : une porte posée, une porte isolée perdue, des murs ramenés au quadrillage");
verifier(biais.c.pieces.filter((pc) => pc.genre === "exterieur").length === 1, "biais : deux zones ouvertes séparées par un mur, une seule reste dehors");
verifier(phrasesBilan(biais.c.bilan).join(" ").includes("lumières du fichier ne sont pas reprises") && phrasesBilan(biais.c.bilan).join(" ").includes("en biais"), "biais : le bilan dit ce qui se perd");
const vide = importer("sans-murs.json").c;
verifier(vide.pieces.length === 1 && vide.pieces[0].genre === "exterieur" && vide.sol.every((s) => s > 0) && !vide.portes.length, "sans murs : une seule zone ouverte");

// Les erreurs, dites au MJ.
const erreur = (source) => {
  try {
    lireUvtt(source);
  } catch (err) {
    return err instanceof ErreurUvtt ? err.message : `autre : ${err}`;
  }
  return "";
};
const image = JSON.parse(readFileSync(new URL("uvtt/maison.dd2vtt", ICI), "utf8")).image;
verifier(erreur("ceci n'est pas du JSON").startsWith("Fichier illisible"), "un fichier illisible le dit");
verifier(erreur('{"nom": "autre chose"}').includes("taille du plan"), "un JSON qui n'est pas un plan le dit");
verifier(erreur({ resolution: { map_size: { x: 8, y: 6 } }, image: "" }).includes("pas d'image"), "un plan sans image le dit");
verifier(erreur({ resolution: { map_size: { x: 200, y: 40 } }, image }).startsWith("Plan trop grand : 200 × 40"), "un plan trop grand le dit");
verifier(erreur({ resolution: { map_size: { x: 160, y: 160 } }, image }) === "", "160 cases de côté passent");
verifier(lireUvtt({ resolution: { map_size: { x: 2, y: 3 } }, image }).largeur === 4, "un plan minuscule fait au moins 4 cases");
// Des points comptés depuis le coin de l'image malgré une origine ailleurs : ils restent où ils sont.
const relatif = lireUvtt({ resolution: { map_origin: { x: 10, y: 10 }, map_size: { x: 8, y: 6 } }, line_of_sight: [[{ x: 2, y: 1 }, { x: 2, y: 5 }]], image });
verifier(pareil(relatif.murs, [[2, 1, 2, 5]]), "des points comptés depuis le coin de l'image ne sont pas décalés");

// L'image : son type, ses octets, sa taille d'envoi.
const octets = octetsDeBase64(image);
verifier(typeImage(octets) === "image/png" && pareil([...octets], [...Buffer.from(image, "base64")]), "l'image en base64 redevient un PNG, octet pour octet");
verifier(typeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg" && typeImage(new Uint8Array(20)) === null, "JPEG reconnu, octets quelconques refusés");
verifier(erreur({ resolution: { map_size: { x: 8, y: 6 } }, image: `data:image/png;base64,${image}` }) === "", "une image en adresse data: se lit");
verifier(tailleReduite(800, 600, 8) === null, "une image de 100 px par case part telle quelle");
const r = tailleReduite(5600, 4200, 28);
verifier(r && r.l === 2800 && r.h === 2100, "200 px par case : réduite à 100", JSON.stringify(r));
const g = tailleReduite(16000, 8000, 160);
verifier(g && g.l === COTE_IMAGE && g.h === COTE_IMAGE / 2 && PX_PAR_CASE === 100, "jamais plus de 4096 px de côté", JSON.stringify(g));

console.log(`import UVTT : ${essais - echecs}/${essais}`);
process.exit(echecs ? 1 : 0);
