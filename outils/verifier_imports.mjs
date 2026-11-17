// Vérifie que chaque import relatif des modules de app/static/js/ trouve son fichier (sans dépendance : une lecture
// du texte, import statique, « export … from » et import("…") littéral). À lancer après avoir déplacé un module.
// Usage : node outils/verifier_imports.mjs
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const JS = new URL("../app/static/js/", import.meta.url).pathname;
const fichiers = [];
const parcourir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? parcourir(p) : p.endsWith(".js") && fichiers.push(p); } };
parcourir(JS);

const SPECS = /(?:^|[\s;}])(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
let verifies = 0;
const manques = [];
for (const f of fichiers) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(SPECS)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec.startsWith(".")) continue;
    verifies++;
    if (!existsSync(resolve(dirname(f), spec))) manques.push(`${relative(JS, f)} : ${spec}`);
  }
}
console.log(manques.length ? manques.join("\n") : "", `\n${verifies} imports vérifiés, ${manques.length} introuvable(s)`);
process.exit(manques.length ? 1 : 0);
