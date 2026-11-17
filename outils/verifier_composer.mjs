// « Composer : Facile, Normale, Difficile, Épique » (combats/composer.js) doit tomber sur le niveau annoncé par le bouton,
// pour chaque taille de groupe de la table (3 à 7), sur les groupes de profils types. Le code de sortie vaut 1 s'il y a un écart.
// Usage : node outils/verifier_composer.mjs [graine de contrôle]
import { RANGS } from "../app/static/js/combats/bestiaire.js";
import { composer } from "../app/static/js/combats/composer.js";
import { PROFILS_TYPES, auNiveau, chargerPretires } from "../app/static/js/combats/groupe.js";
import { etudier, hasardAGraine, verdict } from "../app/static/js/combats/simulation.js";

await chargerPretires();
const controle = +(process.argv[2] || 99);
const options = { avant: 2, style: "fiches", moral: true, niveau: 2 };
const ecarts = [];
for (const n of [3, 4, 5, 6, 7]) {
  const groupe = Array.from({ length: n }, (_, i) => auNiveau(PROFILS_TYPES[i % PROFILS_TYPES.length], 2));
  for (const niveau of ["facile", "normale", "difficile", "epique"]) {
    const depart = [{ ...RANGS[0], n }];
    const adv = composer(niveau, groupe, options, depart);
    // Contrôlé avec d'autres dés que ceux du choix, sur plus de combats.
    const v = verdict(etudier(groupe, adv, { ...options, hasard: hasardAGraine(controle) }, 3000));
    const texte = adv.map((a) => `${a.n} ${a.nom}`).join(" + ");
    console.log(`${n} PJ  ${niveau.padEnd(9)} ${texte.padEnd(32)} -> ${v}`);
    if (v !== niveau) ecarts.push(`${n} PJ : ${niveau} donne ${v} (${texte})`);
  }
}
console.log(ecarts.length ? `${ecarts.length} écart(s)` : "Aucun écart");
for (const x of ecarts) console.log(`  - ${x}`);
process.exitCode = ecarts.length ? 1 : 0;
