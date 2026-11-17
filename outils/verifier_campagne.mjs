// Le contrat d'un pack de campagne (docs/campagne.md) : chaque fichier de contenu du pack a les mêmes exports, de même
// nature, que la campagne d'exemple du dépôt, et reste une donnée pure (aucun import hors de campagne/, aucune fonction).
//   node outils/verifier_campagne.mjs <pack>
// Code 1 au moindre écart ; un fichier du pack sans pendant dans le dépôt est signalé (il ne serait lu par rien).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pack = process.argv[2] && resolve(process.argv[2]);
if (!pack || !existsSync(join(pack, "app"))) {
  console.error("Usage : node outils/verifier_campagne.mjs <pack> (un dossier qui a app/)");
  process.exit(2);
}

const defauts = [];
const defaut = (texte) => defauts.push(texte);
const nature = (v) => (Array.isArray(v) ? "tableau" : v === null ? "null" : typeof v);

function fichiers(dossier, extension) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    return e.isDirectory() ? fichiers(chemin, extension) : e.name.endsWith(extension) ? [chemin] : [];
  });
}

// Les modules JS : mêmes exports, même nature, données pures.
let js = 0;
for (const chemin of fichiers(join(pack, "app/static/js/campagne"), ".js")) {
  const rel = relative(pack, chemin);
  const exemple = join(DEPOT, rel);
  js += 1;
  if (!existsSync(exemple)) {
    defaut(`${rel} : aucun module de ce nom dans le dépôt, rien ne le lira`);
    continue;
  }
  const source = readFileSync(chemin, "utf8");
  for (const m of source.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)) {
    if (!/^\.\/[\w-]+\.js$/.test(m[1])) defaut(`${rel} : import hors de campagne/ (${m[1]})`);
  }
  if (/^\s*(export\s+)?(async\s+)?function\b|=>/m.test(source)) defaut(`${rel} : une fonction, alors qu'un module de campagne ne porte que des données`);
  const [a, b] = await Promise.all([import(pathToFileURL(exemple)), import(pathToFileURL(chemin))]);
  for (const nom of Object.keys(a)) {
    if (!(nom in b)) defaut(`${rel} : export « ${nom} » absent du pack`);
    else if (nature(a[nom]) !== nature(b[nom])) defaut(`${rel} : « ${nom} » est un(e) ${nature(b[nom])}, l'exemple un(e) ${nature(a[nom])}`);
  }
  for (const nom of Object.keys(b)) if (!(nom in a)) defaut(`${rel} : export « ${nom} » en trop (le code ne le lit pas)`);
}

// Les modules Python : mêmes constantes, même nature (lues par l'analyse du source, sans rien exécuter).
const LIRE_PY = `
import ast, json, sys
sortie = {}
for chemin in sys.argv[1:]:
    arbre = ast.parse(open(chemin, encoding="utf-8").read())
    noms = {}
    for n in arbre.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
            noms["!" + type(n).__name__] = "interdit"
        cibles = n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, ast.AnnAssign) else []
        for c in cibles:
            if isinstance(c, ast.Name):
                try:
                    v = ast.literal_eval(n.value)
                    noms[c.id] = type(v).__name__
                except Exception:
                    noms[c.id] = "expression"
    sortie[chemin] = noms
print(json.dumps(sortie))
`;
let py = 0;
for (const chemin of [...fichiers(join(pack, "app/campagne"), ".py"), ...fichiers(join(pack, "app/commun"), "campagne.py")]) {
  const rel = relative(pack, chemin);
  const exemple = join(DEPOT, rel);
  py += 1;
  if (!existsSync(exemple)) {
    defaut(`${rel} : aucun module de ce nom dans le dépôt, rien ne le lira`);
    continue;
  }
  const lu = JSON.parse(execFileSync("python3", ["-c", LIRE_PY, exemple, chemin], { encoding: "utf8" }));
  const [a, b] = [lu[exemple], lu[chemin]];
  for (const [nom, genre] of Object.entries(b)) if (genre === "interdit") defaut(`${rel} : ${nom.slice(1)} interdit dans un module de données`);
  for (const nom of Object.keys(a).filter((n) => !n.startsWith("!"))) {
    if (!(nom in b)) defaut(`${rel} : constante « ${nom} » absente du pack`);
    else if (a[nom] !== b[nom]) defaut(`${rel} : « ${nom} » est un(e) ${b[nom]}, l'exemple un(e) ${a[nom]}`);
  }
}

for (const d of defauts) console.log("DÉFAUT : " + d);
console.log(defauts.length ? `${defauts.length} défaut(s), ${js} modules JS et ${py} modules Python lus.` : `Pack conforme : ${js} modules JS et ${py} modules Python lus.`);
process.exit(defauts.length ? 1 : 0);
