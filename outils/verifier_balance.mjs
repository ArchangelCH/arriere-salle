// Rejoue le barème du bestiaire avec le moteur de la balance : chaque composition doit tomber sur sa difficulté.
// Usage : node outils/verifier_balance.mjs [graine]
// Les combats sont tirés avec une graine (1 par défaut) : deux lancements donnent les mêmes chiffres. Le code de sortie
// vaut 1 s'il y a au moins un écart avec le barème, 0 sinon.
import { RANGS } from "../app/static/js/combats/bestiaire.js";
import { PRETIRES, PROFILS_TYPES, auNiveau, chargerPretires } from "../app/static/js/combats/groupe.js";
import { etudier, hasardAGraine, verdict, VERDICTS } from "../app/static/js/combats/simulation.js";

// Les prétirés du kit ne partent plus avec groupe.js : chargés d'abord.
await chargerPretires();

const graine = +(process.argv[2] || 1);
const rang = (cle, n) => ({ ...RANGS.find((r) => r.cle === cle), n });
// Le bestiaire est calibré sur quatre à six aventuriers. Les prétirés sont ceux de la campagne (un pack lance sa propre
// copie de ce vérifieur, avec les groupes de sa table) ; les profils types, ceux du code.
const groupes = [
  [`${PRETIRES.length} prétirés, niveau 1`, PRETIRES, 1],
  ["3 profils types, niveau 2", PROFILS_TYPES.slice(0, 3), 2],
  ["4 profils types, niveau 2", PROFILS_TYPES.slice(0, 4), 2],
  ["6 profils types, niveau 2", PROFILS_TYPES, 2],
];
const ecarts = [];
let essais = 0;
for (const [nom, base, niveau] of groupes) {
  const g = base.map((p) => auNiveau(p, niveau));
  const n = g.length;
  console.log(`\n== ${nom}`);
  const lignes = [
    ["Facile : 1 sbire par PJ", [rang("sbire", n)], 2, "facile"],
    ["Normale : 1 soldat par PJ", [rang("soldat", n)], 2, "normale"],
    ["Normale, embuscade", [rang("soldat", n)], 0, ""],
    ["Difficile : 1 élite pour 2 PJ", [rang("elite", Math.max(1, Math.floor(n / 2)))], 2, "difficile"],
    ["Difficile : 1 boss", [rang("boss", 1)], 2, "difficile"],
    ["Épique : 1 boss + 1 sbire pour 2 PJ", [rang("boss", 1), rang("sbire", Math.max(1, Math.floor(n / 2)))], 2, "epique"],
  ];
  for (const [titre, adv, avant, attendu] of lignes) {
    const r = etudier(g, adv, { avant, niveau, hasard: hasardAGraine(graine) }, 4000);
    const v = verdict(r);
    const ecart = attendu && attendu !== v;
    if (attendu) essais++;
    if (ecart) ecarts.push(`${nom} · ${titre} : ${VERDICTS[v].nom} au lieu de ${VERDICTS[attendu].nom}`);
    const indecis = r.indecis ? `  indécis ${(r.indecis * 100).toFixed(1)} %` : "";
    console.log(`${titre.padEnd(40)} victoire ${(r.victoire * 100).toFixed(1).padStart(5)} %  tours ${r.tours.toFixed(1)}  au tapis ${r.auTapis.toFixed(2)}  mort ${(r.mort * 100).toFixed(1).padStart(4)} %${indecis}  -> ${VERDICTS[v].nom}${ecart ? `   (barème : ${VERDICTS[attendu].nom})` : ""}`);
  }
}
console.log(`\n${ecarts.length ? `${ecarts.length} écart${ecarts.length > 1 ? "s" : ""}` : "Aucun écart"} avec le barème sur ${essais} compositions (graine ${graine}).`);
for (const x of ecarts) console.log(`  - ${x}`);
process.exitCode = ecarts.length ? 1 : 0;
