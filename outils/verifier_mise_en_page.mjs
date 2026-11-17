// La mise en page proposée d'un chapitre : l'empreinte du navigateur (js/scenarios/mise-en-page.js) vaut celle du
// serveur (app/api/scenarios_api.py) sur les mêmes cas (tests/mise-en-page-cas.json) ; les passages qui changent
// refont les deux textes au caractère près, et les choix du MJ donnent le texte attendu.
//   node outils/verifier_mise_en_page.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appliquer, empreinte, passages } from "../app/static/js/scenarios/mise-en-page.js";

const ici = (chemin) => fileURLToPath(new URL(chemin, import.meta.url));
const cas = JSON.parse(readFileSync(ici("../tests/mise-en-page-cas.json"), "utf-8"));
let echecs = 0;
const verifier = (vrai, nom, detail = "") => {
  if (!vrai) {
    echecs++;
    console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};

for (const c of cas.empreintes) verifier(empreinte(c.texte) === c.attendu, `empreinte de ${JSON.stringify(c.texte.slice(0, 30))}`, `obtenu ${empreinte(c.texte)}, attendu ${c.attendu}`);

for (const c of cas.passages) {
  const m = passages(c.avant, c.apres);
  verifier(JSON.stringify(m) === JSON.stringify(c.attendu), c.nom, `obtenu ${JSON.stringify(m)}`);
  verifier(appliquer(m, () => false) === c.avant, `${c.nom} : tout refuser rend le texte du MJ`);
  verifier(appliquer(m, () => true) === c.apres, `${c.nom} : tout accepter rend le texte proposé`);
}

// Un long chapitre retouché partout : les deux textes se refont toujours, et un choix sur deux reste cohérent.
const avant = Array.from({ length: 400 }, (_, i) => `Paragraphe ${i}, avec une faute${i % 3 ? "" : "s"}.`).join("\n\n");
const apres = Array.from({ length: 400 }, (_, i) => (i % 50 ? "" : `## Scène ${i / 50 + 1}\n\n`) + `Paragraphe ${i}, avec une faute.`).join("\n\n");
const m = passages(avant, apres);
const changes = m.filter((x) => !x.egal).length;
verifier(appliquer(m, () => false) === avant && appliquer(m, () => true) === apres && changes > 100, "long chapitre refait au caractère près", `${changes} passages`);
const mixte = appliquer(m, (rang) => rang % 2 === 0);
verifier(mixte !== avant && mixte !== apres && mixte.includes("Paragraphe 399"), "un passage sur deux accepté");

const n = cas.empreintes.length + cas.passages.length;
console.log(echecs ? `${echecs} échec(s)` : `mise en page : ${n}/${n} cas identiques, long chapitre en ${changes} passages`);
process.exit(echecs ? 1 : 0);
