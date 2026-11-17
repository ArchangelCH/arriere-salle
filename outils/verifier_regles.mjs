// Vérifie la recherche des règles maison (app/static/js/regles/commun.js) : sans accents ni casse, trois lettres
// suffisent, chaque mot cherché doit figurer, le contexte du MJ seulement quand on le demande, et les mots trouvés sont
// surlignés à leur place dans un texte échappé. Puis l'aide-mémoire du kit de la touche R (regles/aide-memoire.js) :
// cartons, critiques, coma, postures et sablier s'y trouvent, avec les chiffres du combat.
// Usage : node outils/verifier_regles.mjs
import { AIDE_MEMOIRE, aideCherchable } from "../app/static/js/regles/aide-memoire.js";
import { CARTONS, SABLIER } from "../app/static/js/combats/suivi.js";
import { correspond, motsDe, plier, surligner } from "../app/static/js/regles/commun.js";

let verifications = 0;
let defauts = 0;
function verifier(cond, quoi) {
  verifications++;
  if (!cond) {
    defauts++;
    console.log(`DÉFAUT : ${quoi}`);
  }
}

const feu = { titre: "Les dégâts du feu", texte: "Traverser les flammes : test de Physique, raté = 1D6 Santé.", contexte: "Proposé pour la nuit du Sanctuaire." };
const focus = { titre: "Focus au calme : le +5 % compte-t-il hors combat ?", texte: "Oui ou non ?", contexte: "" };

verifier(plier("Dégâts du FEU, l’Œil") === "degats du feu, l'œil", `plier : ${plier("Dégâts du FEU, l’Œil")}`);
for (const t of ["Dégâts", "étage", "Œuvre ﬁne", "İstanbul", "naïve 🔥 forêt"]) {
  verifier(plier(t).length === t.normalize("NFC").length, `plier garde la longueur : ${t}`);
}
verifier(correspond(feu, motsDe("deg")), "trois lettres suffisent, sans accent");
verifier(correspond(feu, motsDe("DÉG")), "majuscules et accents dans la recherche");
verifier(correspond(feu, motsDe("feu  santé")), "deux mots, n'importe où");
verifier(!correspond(feu, motsDe("feu glace")), "un mot absent écarte la règle");
verifier(correspond(focus, motsDe("foc")), "« foc » trouve le Focus");
verifier(correspond(feu, motsDe("")), "sans recherche, tout se voit");
verifier(!correspond(feu, motsDe("sanctuaire")), "le contexte n'est pas cherché par défaut");
verifier(correspond(feu, motsDe("sanctuaire"), true), "le contexte se cherche quand on le demande");
verifier(correspond({ titre: "Sauter de l’étage", texte: "" }, motsDe("l'etage")), "apostrophe droite ou courbe");

verifier(surligner("Les dégâts du feu", motsDe("degats")) === "Les <mark>dégâts</mark> du feu", surligner("Les dégâts du feu", motsDe("degats")));
verifier(surligner("Focus", motsDe("foc cus")) === "<mark>Focus</mark>", `mots qui se chevauchent : ${surligner("Focus", motsDe("foc cus"))}`);
verifier(surligner("feu, feu", motsDe("feu")) === "<mark>feu</mark>, <mark>feu</mark>", "chaque occurrence");
verifier(surligner("<b>feu</b> & \"eau\"", motsDe("feu")) === "&lt;b&gt;<mark>feu</mark>&lt;/b&gt; &amp; &quot;eau&quot;", "texte échappé");
verifier(surligner("dégâts", motsDe("dégâts")) === "<mark>dégâts</mark>", "texte décomposé (NFD)");
verifier(surligner("Rien", []) === "Rien", "sans mot, le texte tel quel");
verifier(surligner("<i>", motsDe("zzz")) === "&lt;i&gt;", "sans trouvaille, échappé quand même");

// L'aide-mémoire du kit : chaque mot du MJ principal trouve sa règle, sans accent ni casse, par trois lettres aussi.
const trouve = (q) => AIDE_MEMOIRE.filter((a) => correspond(aideCherchable(a), motsDe(q), true)).map((a) => a.id);
for (const [q, id] of [["cartons", "kit-cartons"], ["carton", "kit-cartons"], ["critique", "kit-tests"], ["critiques", "kit-tests"],
  ["coma", "kit-coma"], ["tapis", "kit-coma"], ["posture", "kit-postures"], ["postures", "kit-postures"], ["défensive", "kit-postures"],
  ["sablier", "kit-sablier"], ["Psy", "kit-psy"], ["initiative", "kit-qui-commence"], ["repos", "kit-repos"], ["car", "kit-cartons"], ["SABL", "kit-sablier"]]) {
  verifier(trouve(q).includes(id), `« ${q} » trouve ${id} : ${trouve(q).join(", ")}`);
}
verifier(!trouve("zzzz").length, "un mot absent ne trouve rien");
verifier(new Set(AIDE_MEMOIRE.map((a) => a.id)).size === AIDE_MEMOIRE.length, "un identifiant par règle du kit");
for (const a of AIDE_MEMOIRE) {
  verifier(a.titre && a.texte && !/[—–]/.test(a.titre + a.texte), `${a.id} : un titre, un texte, sans tiret long`);
  verifier(!/undefined|NaN|\[object/.test(a.texte), `${a.id} : texte composé sans trou`);
}
const cartons = AIDE_MEMOIRE.find((a) => a.id === "kit-cartons").texte;
for (const v of Object.values(CARTONS)) verifier(cartons.includes(v), `les cartons du combat dans l'aide-mémoire : ${v}`);
verifier(AIDE_MEMOIRE.find((a) => a.id === "kit-sablier").texte.includes(String(SABLIER)), "le sablier du combat");
verifier(AIDE_MEMOIRE.find((a) => a.id === "kit-coma").texte.includes("−10"), "la mort au plus tard à −10");

console.log(`${verifications} vérifications, ${defauts} défaut${defauts > 1 ? "s" : ""}`);
process.exit(defauts ? 1 : 0);
