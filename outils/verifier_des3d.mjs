// Contrôle la géométrie des dés en 3D (js/ecran-tv/des-3d.js) : chaque polyèdre a le bon nombre de faces, des faces planes
// et tournées vers l'extérieur, et la rotation de pose amène bien la face du résultat face au regard, chiffre à l'endroit.
// Et la lecture des messages : un test donne deux D10 (dizaines, unités), des dés libres un dé par face tirée.
// Usage : node outils/verifier_des3d.mjs

import { desDuMessage, orientation, polyedre } from "../app/static/js/ecran-tv/des-3d.js";

let defauts = 0;
let controles = 0;
const verifier = (ok, quoi) => {
  controles += 1;
  if (!ok) {
    defauts += 1;
    console.error(`DÉFAUT : ${quoi}`);
  }
};
const produit = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fois = (m, v) => m.map((ligne) => produit(ligne, v));
const proche = (a, b) => Math.abs(a - b) < 1e-6;

const COTES = { 4: 3, 6: 4, 8: 3, 10: 4, 12: 5, 20: 3 };
for (const [n, cotes] of Object.entries(COTES)) {
  const p = polyedre(Number(n));
  verifier(p && p.faces.length === Number(n), `D${n} : ${p?.faces.length} faces`);
  verifier(p.sommets.every((v) => Math.hypot(...v) <= 1 + 1e-9), `D${n} : un sommet hors de la sphère`);
  const vus = new Set();
  p.faces.forEach((f, i) => {
    verifier(f.indices.length === cotes, `D${n}, face ${i + 1} : ${f.indices.length} côtés au lieu de ${cotes}`);
    const d = f.indices.map((k) => produit(p.sommets[k], f.normale));
    verifier(d.every((x) => proche(x, d[0])) && d[0] > 0, `D${n}, face ${i + 1} : pas plane ou tournée vers l'intérieur`);
    verifier(p.sommets.every((v) => produit(v, f.normale) <= d[0] + 1e-6), `D${n}, face ${i + 1} : le polyèdre n'est pas convexe`);
    verifier(proche(produit(f.haut, f.normale), 0) && proche(Math.hypot(...f.haut), 1) && f.place > 0.05, `D${n}, face ${i + 1} : le haut du chiffre sort du plan`);
    const m = orientation(p, i);
    const [x, y, z] = [fois(m, f.droite), fois(m, f.haut), fois(m, f.normale)];
    verifier(proche(z[2], 1) && proche(y[1], 1) && proche(x[0], 1), `D${n}, face ${i + 1} : la pose ne la met pas face au regard`);
    // Une rotation pure : ses lignes sont orthonormées et dans le bon sens.
    verifier(proche(produit(m[0], m[1]), 0) && proche(produit(m[0], m[2]), 0) && proche(produit(m[1], m[2]), 0), `D${n}, face ${i + 1} : la pose déforme le dé`);
    vus.add(f.indices.slice().sort((a, b) => a - b).join(","));
  });
  verifier(vus.size === Number(n), `D${n} : deux faces identiques`);
}
verifier(polyedre(7) === null && polyedre(100) === null, "un dé inconnu a un polyèdre");

const test = desDuMessage({ type: "jet", de: 37, couleur: "#2f6ea5" });
verifier(test.length === 2 && test[0].face === 3 && test[1].face === 7 && test[0].etiquettes[3] === "30" && test[1].etiquettes[7] === "7", "un test de 37 : 30 et 7");
verifier(test[0].couleur === "#2f6ea5" && test[1].couleur !== "#2f6ea5", "les dizaines à la couleur du héros, les unités en ivoire");
const cent = desDuMessage({ type: "jet", de: 100 });
verifier(cent[0].etiquettes[cent[0].face] === "00" && cent[1].etiquettes[cent[1].face] === "0", "100 se lit 00 et 0");
const sept = desDuMessage({ type: "jet", de: 7 });
verifier(sept[0].etiquettes[sept[0].face] === "00" && sept[1].etiquettes[sept[1].face] === "7", "07 se lit 00 et 7");
const libres = desDuMessage({ type: "des", faces: 6, des: [4, 6, 1] });
verifier(libres.length === 3 && libres.map((d) => d.etiquettes[d.face]).join() === "4,6,1" && libres.every((d) => d.faces === 6), "3D6 : trois cubes sur 4, 6 et 1");
for (const f of [4, 8, 10, 12, 20]) {
  const d = desDuMessage({ type: "des", faces: f, des: [f] });
  verifier(d.length === 1 && d[0].etiquettes[d[0].face] === String(f) && d[0].etiquettes.length === f, `1D${f} sur sa plus haute face`);
}
verifier(desDuMessage({ type: "des", faces: 100, des: [100, 5, 42, 99, 1] }).length === 10, "5D100 : dix D10");
for (const faux of [null, {}, { type: "jet", de: 0 }, { type: "jet", de: 101 }, { type: "jet", de: "12" }, { type: "des", faces: 7, des: [1] },
  { type: "des", faces: 6, des: [7] }, { type: "des", faces: 6, des: [] }, { type: "des", faces: 6, des: [1, 1, 1, 1, 1, 1] }, { type: "pointeur" }]) {
  verifier(desDuMessage(faux).length === 0, `message illisible accepté : ${JSON.stringify(faux)}`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${controles} vérifications.` : `Aucun défaut (${controles} vérifications).`);
process.exit(defauts ? 1 : 0);
