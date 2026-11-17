// Les consignes lues par le navigateur (js/scenarios/consignes.js) comme par le serveur (app/contenu/consignes.py), sur les
// mêmes cas (tests/consignes-cas.json), puis quelques rendus de js/scenarios/rendu.js.
//   node outils/verifier_consignes.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { consignesDuScenario } from "../app/static/js/scenarios/consignes.js";
import { rendre } from "../app/static/js/scenarios/rendu.js";

const ici = (chemin) => fileURLToPath(new URL(chemin, import.meta.url));
const { cas } = JSON.parse(readFileSync(ici("../tests/consignes-cas.json"), "utf-8"));
let echecs = 0;
const verifier = (vrai, nom, detail = "") => {
  if (!vrai) {
    echecs++;
    console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};

for (const c of cas) {
  const scenario = { chapitres: c.chapitres.map((texte, i) => ({ id: `c-${i}`, texte })) };
  const lues = consignesDuScenario(scenario).map(({ genre, indications, cle, rang, bloc, numero }) => ({ genre, indications, cle, rang, bloc, numero }));
  verifier(JSON.stringify(lues) === JSON.stringify(c.attendu), c.nom, `obtenu ${JSON.stringify(lues)}`);
}

const consigne = (i, bloc) => ({ html: `<C${i}${bloc ? "B" : "L"}>`, apres: bloc ? "" : `<P${i}>` });
const r1 = rendre("Para avec [[pistes : nom]] dedans.\n\n[[carte blanche : x]]", { consigne });
verifier(r1.includes("<p>Para avec <C0L> dedans.</p>\n<P0>") && r1.includes("<C1B>") && !r1.includes("<p><C1B>"), "consignes en ligne et en bloc", r1);
const r2 = rendre("> Première ligne\n> suite\n>\n> Second paragraphe");
verifier(r2 === '<blockquote class="a-lire"><p>Première ligne<br>suite</p><p>Second paragraphe</p></blockquote>', "encadré à lire d'un seul tenant", r2);
const r3 = rendre("## Scène\nToma #Toma et l'#auberge, [Mirèle](#/pnj/mirele), <script>x</script>");
verifier(r3.includes("<h3>Scène</h3>") && r3.includes('href="#/idees?mot=Toma"') && r3.includes('href="#/idees?mot=auberge"')
  && r3.includes('<a href="#/pnj/mirele">Mirèle</a>') && r3.includes("&lt;script&gt;") && !r3.includes("<script>"), "intertitre, mots-clés, liens, échappement", r3);
const r4 = rendre("[x](javascript:alert(1)) et [y](https://youtu.be/abc?t=12)");
verifier(!r4.includes('href="javascript') && r4.includes('href="https://youtu.be/abc?t=12" target="_blank"'), "liens sûrs seulement", r4);
const r5 = rendre("1. Un\n   - a\n   - b\n2. Deux\n\n4. Quatre\n- puce");
verifier(r5 === '<ol><li>Un<ul><li>a</li><li>b</li></ul></li><li>Deux</li></ol>\n<ol start="4"><li>Quatre</li></ol><ul><li>puce</li></ul>', "listes imbriquées et numéro de départ", r5);

console.log(echecs ? `${echecs} échec(s)` : `consignes : ${cas.length}/${cas.length} cas identiques, rendus 5/5`);
process.exit(echecs ? 1 : 0);
