// Les formules d'or des activités : la lecture de la page du catalogue (js/activites/formule.js) dit lisible exactement ce
// que le serveur sait tirer (jets.formule), sur les cas communs de tests/formules-cas.json.
import { readFileSync } from "node:fs";
import { formuleLisible } from "../app/static/js/activites/formule.js";

const cas = JSON.parse(readFileSync(new URL("../tests/formules-cas.json", import.meta.url), "utf-8"));
const fautes = cas.filter(([texte, attendu]) => formuleLisible(texte) !== (attendu !== null));
for (const [texte, attendu] of fautes) console.log(`  « ${texte} » : la page dit ${formuleLisible(texte) ? "lisible" : "illisible"}, le serveur ${attendu === null ? "illisible" : attendu}`);
console.log(fautes.length ? `formules : ${fautes.length} écart(s) sur ${cas.length}` : `formules : ${cas.length}/${cas.length} cas identiques au serveur`);
process.exitCode = fautes.length ? 1 : 0;
