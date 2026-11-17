// Vérifie l'écart mot à mot de l'histoire des héros (app/static/js/lore/ecart.js) : l'égal et le retiré refont toujours le
// texte d'avant, l'égal et l'ajouté celui d'après, sur des cas écrits et sur des textes tirés au hasard ; un long texte
// changé aux deux bouts se compare vite.
// node outils/verifier_ecart.mjs

import { bilan, ecart, htmlEcart } from "../app/static/js/lore/ecart.js";

let defauts = 0;
const refait = (m, type) => m.filter((x) => x.type === "egal" || x.type === type).map((x) => x.texte).join("");

function verifier(nom, avant, apres, attendu = null) {
  const m = ecart(avant, apres);
  const fautes = [];
  if (refait(m, "retire") !== avant) fautes.push("le texte d'avant ne se refait pas");
  if (refait(m, "ajoute") !== apres) fautes.push("le texte d'après ne se refait pas");
  for (let i = 1; i < m.length; i++) if (m[i].type === m[i - 1].type) fautes.push("deux morceaux du même genre se suivent");
  if (attendu && JSON.stringify(m.map((x) => [x.type[0], x.texte])) !== JSON.stringify(attendu)) fautes.push(`écart ${JSON.stringify(m)}`);
  if (fautes.length) {
    defauts++;
    console.log(`DÉFAUT : ${nom} : ${fautes.join(" ; ")}`);
  }
  return m;
}

verifier("identiques", "Le chat dort.", "Le chat dort.", [["e", "Le chat dort."]]);
verifier("vide vers texte", "", "Un nouveau passage.", [["a", "Un nouveau passage."]]);
verifier("texte vers vide", "Tout s'efface.", "", [["r", "Tout s'efface."]]);
verifier("un mot changé", "Il a grandi à Clairefonds.", "Il a grandi à Valbrume.", [["e", "Il a grandi à "], ["r", "Clairefonds"], ["a", "Valbrume"], ["e", "."]]);
verifier("un ajout au milieu", "Il part seul.", "Il part seul, la nuit.", [["e", "Il part seul"], ["a", ", la nuit"], ["e", "."]]);
verifier("apostrophes", "l'auberge de Toma", "l’auberge de Toma", [["r", "l'auberge"], ["a", "l’auberge"], ["e", " de Toma"]]);
verifier("paragraphes", "Premier.\n\nDeuxième.\n\nTroisième.", "Premier.\n\nDeuxième, revu.\n\nTroisième.");
verifier("accents composés", "Été", "Ete");

// Au hasard : des mots d'un petit lexique, des paragraphes, des retouches.
let graine = 7;
const hasard = (n) => {
  graine = (graine * 1103515245 + 12345) % 2147483648;
  return graine % n;
};
const LEXIQUE = ["le", "la", "héros", "aubergiste", "nuit", "Clairefonds", "épée", "d'argent", ",", ".", "jamais", "Toma", "l'auberge", "sang", "loup"];
const texte = (n) => Array.from({ length: n }, () => (hasard(9) ? LEXIQUE[hasard(LEXIQUE.length)] : "\n\n")).join(" ");
for (let k = 0; k < 300; k++) {
  const a = texte(hasard(60));
  const mots = a.split(" ");
  for (let r = hasard(6); r >= 0; r--) {
    const i = hasard(mots.length + 1);
    if (hasard(2)) mots.splice(i, hasard(3), LEXIQUE[hasard(LEXIQUE.length)]);
    else mots.splice(i, 1);
  }
  verifier(`hasard ${k}`, a, mots.join(" "));
}

// Une histoire de 8000 signes retouchée en tête et en fin : vite, et seulement ce qui change.
const long = Array.from({ length: 1400 }, (_, i) => `mot${i % 97}`).join(" ").slice(0, 7990);
const debut = performance.now();
const m = verifier("long texte", long, `Prologue. ${long.slice(0, 3000)} au milieu ${long.slice(3000)} Épilogue.`);
const duree = performance.now() - debut;
const b = bilan(m);
if (duree > 1500 || b.ajoutes !== 4 || b.retires !== 0) {
  defauts++;
  console.log(`DÉFAUT : long texte : ${Math.round(duree)} ms, ${JSON.stringify(b)}`);
}
const html = htmlEcart(ecart("a <b>", "a <i>\nc"), (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
if (html.includes("<b>") || html.includes("<i>") || !html.includes("<br>")) {
  defauts++;
  console.log(`DÉFAUT : HTML non échappé : ${html}`);
}
console.log(defauts ? `${defauts} défaut(s)` : "écart mot à mot : tout est juste");
process.exit(defauts ? 1 : 0);
