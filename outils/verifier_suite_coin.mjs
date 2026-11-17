// Vérifie la « suite » de la page de connexion du coin (app/static/js/joueurs/suite.js) : après la connexion, le joueur
// revient sur une page du coin, jamais sur un autre site. Chaque adresse rendue est relue comme la lit le navigateur
// (tabulations et sauts de ligne retirés, « \ » lu comme « / ») : son origine doit rester celle du coin.
// Usage : node outils/verifier_suite_coin.mjs
import { suiteSure } from "../app/static/js/joueurs/suite.js";

const ORIGINE = "https://joueurs.exemple.org";
// L'origine où mènerait location.replace(suite) ; une adresse que le navigateur refuserait compte aussi pour un défaut.
const origineDe = (s) => {
  try {
    return new URL(s || "/", ORIGINE).origin;
  } catch {
    return "adresse illisible";
  }
};
let n = 0;
const defauts = [];
const verifier = (cond, quoi) => {
  n += 1;
  if (!cond) defauts.push(quoi);
};

// Ce qui doit revenir tel quel
for (const bonne of ["/carnet", "/carnet#heros", "/bible", "/bible#chemin=bible%2Flieux.md", "/compte", "/fiche?verso=1", "/carnet#boutique/abc"]) {
  verifier(suiteSure(bonne, ORIGINE) === bonne, `suite légitime refusée : ${bonne}`);
}
// Ce qui ne mène nulle part : pas de suite
for (const vide of ["", "/", "carnet", "https://joueurs.exemple.org/carnet", null, undefined, 42]) {
  verifier(suiteSure(vide, ORIGINE) === "", `suite sans objet acceptée : ${String(vide)}`);
}
// Les détours vers un autre site
const pieges = ["//ailleurs.example", "/\\ailleurs.example", "/\t/ailleurs.example", "/\n/ailleurs.example", "/\r/ailleurs.example",
  "/\t\\ailleurs.example", "/\n\\ailleurs.example", "\t//ailleurs.example", "/%09/ailleurs.example", "/\u0000/ailleurs.example",
  "https://ailleurs.example", "javascript:alert(1)", "/\\/ailleurs.example", "/ /ailleurs.example", "/.//ailleurs.example",
  "/\u007f/ailleurs.example", "/\t\t/ailleurs.example/carnet"];
for (const piege of pieges) {
  const s = suiteSure(piege, ORIGINE);
  // Ce que ferait location.replace(s || r.suite || "/") : l'adresse relue par l'analyseur du navigateur.
  verifier(origineDe(s) === ORIGINE, `détour vers ${origineDe(s)} par ${JSON.stringify(piege)}`);
}
// Au hasard : des suites faites de morceaux dangereux, toujours relues dans le coin.
const morceaux = ["/", "\\", "\t", "\n", "\r", " ", ".", "..", "ailleurs.example", "%2f", "%5c", "@", ":", "?", "#", "carnet"];
let graine = 7;
const hasard = () => {
  graine = (graine * 1103515245 + 12345) % 2147483648;
  return graine / 2147483648;
};
for (let i = 0; i < 20000; i++) {
  let s = "/";
  for (let k = 0; k < 1 + Math.floor(hasard() * 6); k++) s += morceaux[Math.floor(hasard() * morceaux.length)];
  const rendue = suiteSure(s, ORIGINE);
  verifier(origineDe(rendue) === ORIGINE, `détour au hasard par ${JSON.stringify(s)}`);
}

if (defauts.length) {
  console.log(`${defauts.length} défaut(s) sur ${n} vérifications :`);
  for (const d of [...new Set(defauts)].slice(0, 20)) console.log("  -", d);
  process.exit(1);
}
console.log(`Aucun défaut (${n} vérifications).`);
