// Les liens des scènes dans la séance : « Sous la main » réunit ce que le MJ y a choisi et ce que lient les scènes, dans
// l'ordre du déroulé (js/seances/sous-la-main.js), et « Avant de jouer » le lit ; « Proposer les liens »
// (js/seances/proposer-liens.js) devine le plan, l'ambiance, la rencontre et les PNJ d'une scène d'après son titre et le
// chapitre du même titre. Sur les vraies séances (lues seulement), les propositions faites sur le déroulé nu sont
// comparées aux liens qu'le MJ principal a posés à la main.
//   node outils/verifier_liens_seance.mjs [data]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { avantDeJouer } from "../app/static/js/seances/avant-de-jouer.js";
import { chapitreDe, liensDuChapitre, nommePar, proposerLiens, score } from "../app/static/js/seances/proposer-liens.js";
import { idsSousLaMain, parLesScenes, plansDeLaSeance, sousLaMain } from "../app/static/js/seances/sous-la-main.js";

let echecs = 0;
let essais = 0;
const json = (x) => JSON.stringify(x);
const verifier = (vrai, nom, detail = "") => {
  essais++;
  if (!vrai) {
    echecs++;
    console.log(`ÉCHEC ${nom}${detail ? `\n  ${detail}` : ""}`);
  }
};
const egal = (obtenu, attendu, nom) => verifier(json(obtenu) === json(attendu), nom, `${json(obtenu)} au lieu de ${json(attendu)}`);

// ---- Sous la main
const plans = [{ id: "p-ferme", nom: "La Ferme", lieu: "ferme" }, { id: "p-sans", nom: "Sans lieu" }];
const s = {
  deroule: [
    { heure: "18:15", titre: "L'aube", liens: { pnj: ["toma", "mirele"], rencontre: "r-nuit", plan: "p-ferme" } },
    { heure: "19:00", titre: "La ferme", liens: { pnj: ["vadim", "toma"], rencontre: "r-ferme", plan: "p-sans" } },
    { titre: "Sans heure", liens: { pnj: ["toma"] } },
    { heure: "20:00", titre: "Rien" },
  ],
  pnj: ["lisette", "mirele", "", null], lieux: ["moulin", "ferme"], rencontres: ["r-main"],
};
const ids = idsSousLaMain(s, plans);
egal(ids.pnj.map((x) => [x.id, x.choisi, x.scenes]), [["toma", false, [0, 1, 2]], ["mirele", true, [0]], ["vadim", false, [1]], ["lisette", true, []]],
  "PNJ : ceux des scènes dans l'ordre du déroulé, puis ceux choisis à la main ; une valeur vide est ignorée");
egal(ids.lieux.map((x) => [x.id, x.choisi, x.scenes]), [["ferme", true, [0]], ["moulin", true, []]], "lieux : celui du plan d'une scène, puis les autres");
egal(ids.rencontres.map((x) => x.id), ["r-nuit", "r-ferme", "r-main"], "rencontres : celles des scènes, puis celles de « Sous la main »");
const fiches = { pnj: [{ id: "toma", nom: "Toma" }, { id: "mirele", nom: "Mirèle" }, { id: "lisette", nom: "Lisette" }], lieux: [{ id: "ferme", nom: "La Ferme" }],
  rencontres: [{ id: "r-nuit" }, { id: "r-main" }], plans };
const sous = sousLaMain(s, fiches);
egal(sous.pnj.map((x) => x.id), ["toma", "mirele", "lisette"], "une fiche retirée depuis disparaît de la liste");
egal(sous.rencontres.map((x) => x.id), ["r-nuit", "r-main"], "une rencontre retirée aussi");
egal([parLesScenes(s, [0]), parLesScenes(s, [0, 1]), parLesScenes(s, [0, 1, 2]), parLesScenes(s, [2]), parLesScenes(s, [])],
  ["par la scène de 18 h 15", "par les scènes de 18 h 15 et 19 h", "par 3 scènes, dès 18 h 15", "par la scène « Sans heure »", ""], "la mention des scènes");
egal(plansDeLaSeance(s, [...plans, { id: "p-moulin", lieu: "moulin" }, { id: "p-ailleurs", lieu: "ailleurs" }]).map((p) => p.id), ["p-ferme", "p-sans", "p-moulin"],
  "les plans à montrer : ceux des scènes et ceux des lieux sous la main");
egal(idsSousLaMain({}, []), { pnj: [], lieux: [], rencontres: [], documents: [] }, "une séance vide");

// ---- « Avant de jouer » lit les deux listes ensemble
const rencontres = [{ id: "r-nuit", nom: "La nuit", lieu: "ferme", adversaires: [] }, { id: "r-autre", nom: "La Ferme", adversaires: [] }];
const lignes = avantDeJouer({ deroule: [{ liens: { rencontre: "r-nuit", plan: "p-ferme" } }], pnj: [], lieux: [], rencontres: [] },
  { pnj: [], lieux: [{ id: "ferme", nom: "La Ferme", connu: true }], rencontres, plans, tablee: [], musique: { ambiances: [], combat: null } });
const aChoisir = lignes.find((l) => l.genre === "rencontres")?.items.map((x) => x.r.id) || [];
verifier(!aChoisir.includes("r-nuit"), "une rencontre liée à une scène n'est pas proposée comme « non choisie »", json(aChoisir));
verifier(aChoisir.includes("r-autre"), "une rencontre du lieu d'une scène, elle, est proposée", json(aChoisir));
verifier(lignes.some((l) => l.genre === "verdicts" && l.items.some((x) => x.r.id === "r-nuit")), "le verdict d'une rencontre de scène est vérifié");

// ---- Proposer les liens, cas choisis
verifier(score("Le moulin des Varenne", "Le moulin des Varenne") > 1 && score("L'étang des Roseaux", "L'étang à l'aube") === 0.5
  && score("La nuit : l'écurie", "La nuit au camp") === 0 && score("Dehors, la nuit", "Toma, dehors") === 0.5 && score("Les", "Les") > 1
  && score("", "x") === 0, "le score d'un nom pour un titre : un mot de moment seul ne compte pas");
verifier(score("L'auberge de Toma, étage", "L'auberge : Toma", "étage") === 1, "l'étage d'un plan ne compte pas");
const chapitres = [{ id: "c1", titre: "Prologue : les jours d'après" }, { id: "c2", titre: "L'aube" }, { id: "c3", titre: "Premier chapitre" }];
egal([chapitreDe("Prologue : le réveil", chapitres)?.id, chapitreDe("L'aube : le sort de Toma", chapitres)?.id, chapitreDe("L'étang à l'aube", chapitres)?.id,
  chapitreDe("Scène 1", chapitres)?.id], ["c1", "c2", undefined, undefined], "le chapitre du même titre : par le début ou par la tête");
egal(liensDuChapitre("[a](#/pnj/a) [b](#/combats/b) [c](#/plan/c) [a](#/pnj/a) [x](#/pnj/nouveau) [y](https://x) [z](#/pnj/%E0)"),
  { pnj: ["a"], rencontres: ["b"], plans: ["c"] }, "ce que lie un chapitre");
verifier(nommePar({ nom: "Lisette Varenne" }, "Lisette et le premier contrat") && !nommePar({ nom: "Lisette Varenne" }, "Le moulin des Varenne")
  && nommePar({ nom: "Frère Anatole" }, "Frère Anatole et son affiche") && !nommePar({ nom: "Frère Ysmar" }, "Frère Anatole et son affiche")
  && nommePar({ nom: "Belisaire", surnom: "Brom" }, "Brom"), "un PNJ nommé par le titre : prénom ou surnom, jamais un titre comme « Frère »");
const ctx = {
  plans: [{ id: "ferme", nom: "La Grange-Noire", lieu: "l-ferme" }, { id: "rdc", nom: "L'auberge, rez-de-chaussée", lieu: "aub", etage: "rez-de-chaussée" },
    { id: "etage", nom: "L'auberge, étage", lieu: "aub", etage: "étage" }, { id: "camp", nom: "Le camp", lieu: "x" }],
  ambiances: [{ id: "a-ferme", nom: "La Grange-Noire" }, { id: "a-nuit", nom: "La nuit au camp" }],
  rencontres: [{ id: "r-ferme", nom: "La Grange-Noire" }, { id: "r-ecurie", nom: "La nuit : l'écurie" }, { id: "r-porte", nom: "La nuit : la porte" }],
  pnj: [{ id: "vadim", nom: "Vadim", surnom: "le Pinson" }, { id: "anatole", nom: "Frère Anatole", statut: "mort" }, { id: "hilaire", nom: "Hilaire" }],
  lieux: [{ id: "aub", nom: "L'auberge" }],
  scenarios: [{ id: "sc", nom: "Le scénario", chapitres: [{ id: "c", titre: "La nuit des cendres", texte: "[H](#/pnj/hilaire) [p](#/combats/r-porte) [e](#/combats/r-ecurie) [c](#/plan/camp)" }] }],
};
const seance = { scenario_id: "sc", deroule: [
  { titre: "La Grange-Noire, avec le Pinson" },
  { titre: "La nuit au camp" },
  { titre: "L'auberge : le soir" },
  { titre: "La nuit des cendres : l'arrivée" },
  { titre: "La nuit des cendres : la fuite", liens: { rencontre: "r-ecurie", pnj: ["hilaire"] } },
  { titre: "Frère Anatole" },
  { titre: "Pause" },
] };
const props = proposerLiens(seance, ctx);
const vues = (i) => (props.get(i)?.items || []).map((x) => `${x.genre}:${x.id}`);
egal(vues(0), ["plan:ferme", "ambiance:a-ferme", "rencontre:r-ferme", "pnj:vadim"], "le nom d'un lieu : son plan, son ambiance, sa rencontre ; le surnom d'un PNJ");
egal(vues(1), ["plan:camp", "ambiance:a-nuit"], "« La nuit au camp » : le camp, son ambiance, et pas « La nuit : l'écurie » (un mot de moment ne suffit pas)");
egal(vues(2), ["plan:rdc"], "à égalité, le plan du rez-de-chaussée");
egal(vues(3), ["plan:camp", "rencontre:r-porte", "pnj:hilaire"], "le chapitre du même titre : son plan seul, sa rencontre suivante, ses PNJ");
egal(vues(4), ["plan:camp"], "seul ce qui manque à la scène est proposé, et une rencontre n'est pas proposée deux fois");
egal(props.get(5)?.items.map((x) => x.nom), ["Frère Anatole (mort)"], "un PNJ mort est proposé avec sa mention");
verifier(!props.has(6), "« Pause » : rien");

// ---- Les vraies séances, lues seulement : les propositions sur le déroulé nu, comparées aux liens du MJ principal
const dossier = process.argv[2] || "data";
let reels = "";
if (existsSync(join(dossier, "seances"))) {
  const lire = (sous) => (existsSync(join(dossier, sous)) ? readdirSync(join(dossier, sous)).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dossier, sous, f), "utf-8"))) : []);
  const musique = existsSync(join(dossier, "musique.json")) ? JSON.parse(readFileSync(join(dossier, "musique.json"), "utf-8")) : {};
  const vrai = { plans: lire("plans"), pnj: lire("pnj"), rencontres: lire("rencontres"), lieux: lire("lieux"), scenarios: lire("scenarios"), ambiances: musique.ambiances || [] };
  const existe = { plan: new Set(vrai.plans.map((x) => x.id)), pnj: new Set(vrai.pnj.map((x) => x.id)), rencontre: new Set(vrai.rencontres.map((x) => x.id)),
    ambiance: new Set(vrai.ambiances.map((x) => x.id)) };
  let proposes = 0;
  let communs = 0;
  let seances = 0;
  for (const sv of lire("seances")) {
    if (!(sv.deroule || []).some((d) => d.liens)) continue;
    seances++;
    const nue = { ...sv, deroule: sv.deroule.map(({ liens, ...d }) => d) };
    for (const [i, p] of proposerLiens(nue, vrai)) {
      const l = sv.deroule[i].liens || {};
      for (const x of p.items) {
        proposes++;
        verifier(existe[x.genre]?.has(x.id), `séance ${sv.numero} : la proposition vise une fiche qui existe`, json(x));
        if (x.genre === "pnj" ? (l.pnj || []).includes(x.id) : l[x.genre] === x.id) communs++;
      }
    }
    // Sur le déroulé tel qu'il est, rien de déjà lié n'est reproposé.
    for (const [i, p] of proposerLiens(sv, vrai)) {
      const l = sv.deroule[i].liens || {};
      verifier(p.items.every((x) => (x.genre === "pnj" ? !(l.pnj || []).includes(x.id) : !l[x.genre])), `séance ${sv.numero} : rien de déjà lié n'est reproposé`);
    }
    const ids = idsSousLaMain(sv, vrai.plans);
    for (const g of ["pnj", "lieux", "rencontres"]) {
      verifier((sv[g] || []).every((id) => ids[g].some((x) => x.id === id && x.choisi)), `séance ${sv.numero} : tout ce qu'le MJ principal a choisi reste sous la main (${g})`);
    }
  }
  reels = `, ${seances} vraies séances : ${proposes} liens proposés sur le déroulé nu, dont ${communs} posés tels quels par le MJ principal`;
}

console.log(echecs ? `${echecs} échec(s) sur ${essais} vérifications` : `Aucun défaut : ${essais} vérifications${reels}.`);
process.exit(echecs ? 1 : 0);
