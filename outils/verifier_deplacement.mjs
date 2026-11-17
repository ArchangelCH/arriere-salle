// Le parcours d'un pion lu par le navigateur (js/plan/deplacement.js) comme par le serveur
// (app/commun/deplacement.py), sur les mêmes cas (tests/deplacement-cas.json, écrits par outils/cas_deplacement.py) : le même
// verdict (distance, entrée, portes à ouvrir, phrase du refus) et les mêmes cases atteignables. Puis la cohérence de ce que montre la page du joueur : chaque
// case surlignée passe la vérification, et aucune case refusée n'est surlignée.
//   node outils/verifier_deplacement.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { atteignables, casesAtteignables, caseDuPion, verifierDeplacement } from "../app/static/js/plan/deplacement.js";

const ici = (chemin) => fileURLToPath(new URL(chemin, import.meta.url));
const { cas } = JSON.parse(readFileSync(ici("../tests/deplacement-cas.json"), "utf-8"));
let echecs = 0;
let essais = 0;
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) {
    echecs++;
    if (echecs <= 30) console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};

for (const c of cas) {
  const r = verifierDeplacement(c.plan, c.corps, c.regles, c.tour);
  const obtenu = r.ok ? { distance: r.distance, entree: r.entree, portes: r.portes.length } : { refus: r.refus };
  verifier(JSON.stringify(obtenu) === JSON.stringify(c.attendu), c.nom, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(c.attendu)}`);
  // Le chemin retenu (et donc les portes qu'il ouvre) : le même que le serveur, case par case.
  verifier(JSON.stringify(r.ok ? r.chemin : null) === JSON.stringify(c.chemin), `${c.nom} (chemin)`, `obtenu ${JSON.stringify(r.chemin)}, attendu ${JSON.stringify(c.chemin)}`);

  // Toutes les cases atteignables, sans limite, depuis la case du pion : les mêmes que le serveur.
  const moi = (c.plan.pions || []).find((t) => t.id === c.corps.pion);
  let liste = [];
  if (moi) {
    const vus = atteignables(c.plan, { pion: c.corps.pion, depart: caseDuPion(moi), entrer: c.regles.entrer === true });
    liste = [...vus].map(([cle, v]) => `${cle},${v.d}${v.entree ? ",e" : ""}${v.portes ? `,p${v.portes}` : ""}`).sort();
  }
  const attendu = [...c.atteignables].sort();
  verifier(JSON.stringify(liste) === JSON.stringify(attendu), `${c.nom} (cases atteignables)`,
    `en trop ${JSON.stringify(liste.filter((x) => !attendu.includes(x)).slice(0, 8))}, manquent ${JSON.stringify(attendu.filter((x) => !liste.includes(x)).slice(0, 8))}`);

  // Ce que la page surligne : exactement les cases qui passent la vérification.
  if (!moi) continue;
  const place = caseDuPion(moi);
  const surlignees = casesAtteignables(c.plan, c.corps.pion, c.regles, c.tour);
  for (let y = -1; y <= c.plan.hauteur; y++) {
    for (let x = -1; x <= c.plan.largeur; x++) {
      if (x < 0 || y < 0) continue;
      const v = verifierDeplacement(c.plan, { pion: c.corps.pion, depuis: place, vers: [x, y] }, c.regles, c.tour);
      const montree = surlignees.has(`${x},${y}`);
      verifier(montree === v.ok, `${c.nom} : la case ${x},${y} ${montree ? "surlignée" : "pas surlignée"}`, v.ok ? "" : v.refus);
      const s = surlignees.get(`${x},${y}`);
      if (montree && v.ok) verifier(s.d === v.distance && s.entree === v.entree && s.portes === v.portes.length, `${c.nom} : distance de ${x},${y}`);
    }
  }
}

console.log(echecs ? `${echecs} échec(s) sur ${essais} essais` : `déplacement : ${cas.length}/${cas.length} cas identiques au serveur, ${essais} essais`);
process.exit(echecs ? 1 : 0);
