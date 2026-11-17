// Les dés libres : la lecture de la page (js/jets/des.js) donne exactement ce que lit le serveur (des.lire), et les effets du dé
// d'aventure sont les mêmes, sur les cas communs de tests/des-cas.json (tests/test_des.py les passe côté serveur).
import { readFileSync } from "node:fs";
import { EFFETS, lire } from "../app/static/js/jets/des.js";

const { expressions, effets } = JSON.parse(readFileSync(new URL("../tests/des-cas.json", import.meta.url), "utf-8"));
const fautes = expressions.filter(([texte, attendu]) => (lire(texte)?.texte ?? null) !== attendu);
for (const [texte, attendu] of fautes) console.log(`  ${JSON.stringify(texte)} : la page lit ${lire(texte)?.texte ?? "rien"}, le serveur ${attendu ?? "rien"}`);
const faces = [...new Set([...Object.keys(effets), ...Object.keys(EFFETS)])];
const ecarts = faces.filter((f) => EFFETS[f] !== effets[f]);
for (const f of ecarts) console.log(`  face ${f} : la page dit ${EFFETS[f] ?? "rien"}, le serveur ${effets[f] ?? "rien"}`);
const n = fautes.length + ecarts.length;
console.log(n ? `dés : ${n} écart(s) sur ${expressions.length + faces.length}` : `dés : ${expressions.length}/${expressions.length} expressions et ${faces.length}/${faces.length} effets identiques au serveur`);
process.exitCode = n ? 1 : 0;
