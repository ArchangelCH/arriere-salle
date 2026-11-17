// Vérifie « Jouer la scène » (app/static/js/seances/jouer-scene.js) : le repère de la scène en cours (une seule ligne,
// qui le garde quand on réorganise le déroulé), le bouton en tête des liens, et le geste lui-même avec de faux envois :
// le plan, l'ambiance sauf si elle joue déjà, la ligne du journal, ni carton ni combat, un envoi raté qui n'arrête pas
// les autres, et la TV noire d'un plan dont rien n'est révélé.
// Usage : node outils/verifier_jouer_scene.mjs

import { depuis, htmlGeste, htmlRepere, jouerLaScene, ligneEnCours, marquerEnCours, repere, vuePlan } from "../app/static/js/seances/jouer-scene.js";
import { htmlLiensJeu, liensResolus } from "../app/static/js/seances/liens-scene.js";

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const json = (x) => JSON.stringify(x);

// ---- Le repère ----
const deroule = () => [
  { heure: "14:00", titre: "Installation", duree: 10 },
  { heure: "14:10", titre: "La rixe", duree: 20, liens: { plan: "auberge", ambiance: "rixe" } },
  { heure: "14:30", titre: "Dehors", duree: 15 },
];
let lignes = deroule();
marquerEnCours(lignes, lignes[1], "2026-11-03T19:15:00.000Z");
verifier(repere(lignes[1]) === "2026-11-03T19:15:00.000Z" && !("en_cours" in lignes[0]) && !("en_cours" in lignes[2]), "le repère sur la ligne jouée seulement");
verifier(json(lignes[1].liens) === json({ plan: "auberge", ambiance: "rixe" }) && lignes[1].titre === "La rixe", "le reste de la ligne ne bouge pas");
marquerEnCours(lignes, lignes[2], "2026-11-03T19:40:00.000Z");
verifier(!("en_cours" in lignes[1]) && repere(lignes[2]), "une autre scène jouée : le repère passe sur elle");
// Monter, descendre, retirer, ajouter : le repère suit sa ligne.
[lignes[1], lignes[2]] = [lignes[2], lignes[1]];
verifier(ligneEnCours({ deroule: lignes }) === 1 && lignes[1].titre === "Dehors", "monter la scène : le repère monte avec elle");
lignes.splice(0, 1);
verifier(ligneEnCours({ deroule: lignes }) === 0 && lignes[0].titre === "Dehors", "retirer une scène avant : le repère reste sur la sienne");
lignes.push({ heure: "15:00", titre: "Scène 4", duree: 30 });
verifier(ligneEnCours({ deroule: lignes }) === 0, "ajouter une scène : rien ne change");
lignes[0].fait = true;
verifier(ligneEnCours({ deroule: lignes }) === -1 && htmlRepere(lignes[0]) === "", "une scène cochée ne montre plus le repère");
delete lignes[0].fait;
verifier(ligneEnCours({ deroule: lignes }) === 0, "décochée, elle le retrouve");
verifier(ligneEnCours({}) === -1 && ligneEnCours(null) === -1 && ligneEnCours({ deroule: deroule() }) === -1, "séance sans repère");
verifier(repere({ en_cours: "" }) === null && repere({ en_cours: true }) === null && repere(null) === null, "repère illisible : aucun");

const soir = new Date(2026, 10, 3, 21, 0);
verifier(depuis(new Date(2026, 10, 3, 20, 15).toISOString(), soir) === "depuis 20 h 15", depuis(new Date(2026, 10, 3, 20, 15).toISOString(), soir));
verifier(depuis(new Date(2026, 10, 3, 9, 5).toISOString(), soir) === "depuis 9 h 05", "heure sans zéro devant");
verifier(depuis(new Date(2026, 10, 3, 20, 0).toISOString(), soir) === "depuis 20 h", "heure ronde");
verifier(depuis(new Date(2026, 10, 1, 20, 15).toISOString(), soir) === "depuis le 1 novembre" || depuis(new Date(2026, 10, 1, 20, 15).toISOString(), soir) === "depuis le 1er novembre",
  `un autre jour : ${depuis(new Date(2026, 10, 1, 20, 15).toISOString(), soir)}`);
verifier(depuis("n'importe quoi", soir) === "", "date illisible : rien");
const badge = htmlRepere({ titre: "x", en_cours: new Date().toISOString() });
verifier(/^<span class="repere-scene">En cours depuis \d{1,2} h( \d{2})?<\/span>$/.test(badge), `le repère dans le déroulé : ${badge}`);
verifier(htmlRepere({ en_cours: new Date().toISOString() }, "p").startsWith('<p class="repere-scene">'), "le repère de Préparer : un paragraphe");

// ---- Le bouton, en tête des liens ----
const ctx = {
  seance: { id: "s1", combat: null },
  plans: [{ id: "auberge", nom: "L'auberge, rez-de-chaussée", style: "peint", modifie: "v3" }],
  pnj: [{ id: "toma", nom: "Toma", connu: true }],
  rencontres: [{ id: "chasseurs", nom: "Les chasseurs" }],
  ambiances: [{ id: "rixe", nom: "La rixe" }],
  table: { vue: "accueil" },
  musique: { courante: null, enPause: false },
};
const complete = { titre: "La rixe", liens: { plan: "auberge", pnj: ["toma"], rencontre: "chasseurs", ambiance: "rixe" } };
let html = htmlLiensJeu(complete, ctx, 4);
const ordre = ["scene-jouer", "plan-montrer", "pnj-montrer", "Lancer le combat", "ambiance-jouer"].map((x) => html.indexOf(x));
verifier(ordre.every((n, k) => n > 0 && (k === 0 || n > ordre[k - 1])), `le geste en tête, puis chaque bouton à sa place : ${json(ordre)}`);
verifier(/class="principal" data-action="scene-jouer" data-i="4"/.test(html) && html.includes(">Jouer la scène</button>"), "« Jouer la scène », bouton principal, avec sa ligne");
verifier(html.includes("<i>D'un geste</i> Plan sur la TV, ambiance et journal</span>"), "ce que fait le geste");
const nue = htmlLiensJeu({ titre: "Pause" }, ctx, 2);
verifier(nue.includes('data-action="scene-jouer" data-i="2"') && !/plan-montrer|pnj-montrer|ambiance-jouer|Lancer le combat/.test(nue), "scène sans lien : le geste seul");
verifier(nue.includes("Une ligne au journal"), "scène sans lien : une ligne au journal");
verifier(htmlGeste({}, 0, { plan: { id: "p" }, pnj: [], rencontre: null, ambiance: null }).includes("Plan sur la TV et journal"), "plan seul");
verifier(htmlGeste({}, 0, { plan: null, pnj: [], rencontre: null, ambiance: { id: "a" } }).includes("Ambiance et journal"), "ambiance seule");
html = htmlLiensJeu({ ...complete, en_cours: new Date().toISOString() }, ctx, 4);
verifier(html.includes(">Relancer la scène</button>") && !/class="principal" data-action="scene-jouer"/.test(html), "scène déjà en cours : « Relancer la scène »");
verifier(htmlLiensJeu({ ...complete, en_cours: new Date().toISOString(), fait: true }, ctx, 4).includes(">Jouer la scène</button>"), "scène cochée : le repère ne compte plus");
verifier(json(vuePlan(ctx.plans[0])) === json({ vue: "plan", plan: "auberge", camera: null, style: "peint", version: "v3", lieu: null, contrat: null, avant: null }), "la TV sur le plan, comme « Montrer »");

// ---- Le geste ----
function faux({ ecrans = 2, deja = false, rate = {} } = {}) {
  const appels = [];
  return {
    appels,
    faire: {
      montrerPlan: async (p) => {
        appels.push(["plan", p.id]);
        if (rate.plan) throw new Error(rate.plan);
        return deja ? { deja: true, ecrans } : { ecrans };
      },
      lancerAmbiance: async (id) => {
        appels.push(["ambiance", id]);
        if (rate.ambiance) throw new Error(rate.ambiance);
      },
      noter: async (texte) => {
        appels.push(["journal", texte]);
        if (rate.journal) throw new Error(rate.journal);
        return { journal: [{ t: "20:15", texte }] };
      },
    },
  };
}
const seanceDe = (ligne) => ({ id: "s1", deroule: [{ titre: "Avant", en_cours: "2026-11-03T18:00:00.000Z" }, ligne, { titre: "Après" }] });
const QUAND = "2026-11-03T19:15:00.000Z";

let s = seanceDe(structuredClone(complete));
let f = faux();
let bilan = await jouerLaScene({ seance: s, i: 1, r: liensResolus(s.deroule[1], ctx), musique: ctx.musique, quand: QUAND }, f.faire);
verifier(json(f.appels) === json([["plan", "auberge"], ["ambiance", "rixe"], ["journal", "Scène : La rixe"]]), `plan, ambiance, journal ; ni carton ni combat : ${json(f.appels)}`);
verifier(s.deroule[1].en_cours === QUAND && !("en_cours" in s.deroule[0]), "la scène marquée en cours, l'ancienne plus");
verifier(bilan.texte === "Scène en cours : plan sur la TV, ambiance en fondu, notée au journal." && !bilan.erreur, bilan.texte);

s = seanceDe(structuredClone(complete));
f = faux();
bilan = await jouerLaScene({ seance: s, i: 1, r: liensResolus(s.deroule[1], ctx), musique: { courante: "rixe", enPause: false }, quand: QUAND }, f.faire);
verifier(!f.appels.some(([g]) => g === "ambiance") && bilan.texte === "Scène en cours : plan sur la TV, notée au journal.", `l'ambiance joue déjà : on n'y touche pas (${bilan.texte})`);

f = faux();
await jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: { courante: "rixe", enPause: true }, quand: QUAND }, f.faire);
verifier(f.appels.some(([g, id]) => g === "ambiance" && id === "rixe"), "l'ambiance en pause : elle reprend");

f = faux({ deja: true });
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.texte === "Scène en cours : ambiance en fondu, notée au journal.", `plan déjà sur la TV : rien à en dire (${bilan.texte})`);

f = faux({ ecrans: 0 });
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.texte.includes("plan envoyé, mais aucun écran de table n'est ouvert") && !bilan.erreur, `aucun écran ouvert : ${bilan.texte}`);

s = seanceDe({ titre: "  ", duree: 15 });
f = faux();
bilan = await jouerLaScene({ seance: s, i: 1, r: liensResolus(s.deroule[1], ctx), musique: {}, quand: QUAND }, f.faire);
verifier(json(f.appels) === json([["journal", "Scène : Scène 2"]]) && s.deroule[1].en_cours === QUAND, `scène sans lien ni titre : journal et repère seulement (${json(f.appels)})`);
verifier(bilan.texte === "Scène en cours : notée au journal.", bilan.texte);

s = seanceDe(structuredClone(complete));
f = faux({ rate: { plan: "serveur injoignable, vérifiez la connexion" } });
bilan = await jouerLaScene({ seance: s, i: 1, r: liensResolus(s.deroule[1], ctx), musique: {}, quand: QUAND }, f.faire);
verifier(f.appels.length === 3 && s.deroule[1].en_cours === QUAND, "le plan refusé n'arrête ni l'ambiance, ni le journal, ni le repère");
verifier(bilan.erreur && bilan.texte === "Scène en cours : ambiance en fondu, notée au journal. Pas fait : le plan (serveur injoignable, vérifiez la connexion).", bilan.texte);

f = faux({ rate: { ambiance: "le lecteur de musique n'est pas prêt", journal: "Ligne vide" } });
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.erreur && bilan.texte === "Scène en cours : plan sur la TV. Pas fait : l'ambiance (le lecteur de musique n'est pas prêt) ; le journal (Ligne vide).", bilan.texte);

// Les trois envois partent ensemble : le journal n'attend pas la TV.
let libererPlan;
const ordreAppels = [];
const enCours = jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: {}, quand: QUAND }, {
  montrerPlan: () => new Promise((r) => { ordreAppels.push("plan"); libererPlan = () => r({ ecrans: 1 }); }),
  lancerAmbiance: async () => ordreAppels.push("ambiance"),
  noter: async () => ordreAppels.push("journal"),
});
await new Promise((r) => setImmediate(r));
verifier(json(ordreAppels) === json(["plan", "ambiance", "journal"]), `envois partis ensemble : ${json(ordreAppels)}`);
libererPlan();
verifier((await enCours).texte === "Scène en cours : plan sur la TV, ambiance en fondu, notée au journal.", "puis le compte rendu complet");

// Un plan sous brouillard sans pièce révélée : le compte rendu le dit (la TV reste noire) et offre « Ouvrir le plan ».
const noir = { id: "ferme", nom: "La Grange-Noire", style: "peint", modifie: "v1", brouillard_actif: true, sol: [1, 1, 0, 1], brouillard: [0, 0, 0, 0] };
const ctxNoir = { ...ctx, plans: [...ctx.plans, noir] };
const sceneNoire = { titre: "La piste", liens: { plan: "ferme" } };
f = faux();
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(sceneNoire)), i: 1, r: liensResolus(sceneNoire, ctxNoir), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.texte === "Scène en cours : plan sur la TV, encore tout dans le brouillard : la TV reste noire, notée au journal." && !bilan.erreur, `plan tout noir : ${bilan.texte}`);
verifier(bilan.action?.libelle === "Ouvrir le plan" && typeof bilan.action.faire === "function", "plan tout noir : « Ouvrir le plan » dans le message");
f = faux({ deja: true });
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(sceneNoire)), i: 1, r: liensResolus(sceneNoire, ctxNoir), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.texte.includes("le plan à la TV est encore tout dans le brouillard") && bilan.action, `plan noir déjà à la TV : encore dit (${bilan.texte})`);
f = faux({ rate: { plan: "serveur injoignable" } });
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(sceneNoire)), i: 1, r: liensResolus(sceneNoire, ctxNoir), musique: {}, quand: QUAND }, f.faire);
verifier(!bilan.action && !bilan.texte.includes("brouillard"), `plan refusé : pas de TV noire annoncée (${bilan.texte})`);
const revele = { ...noir, brouillard: [0, 1, 0, 0] };
f = faux();
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(sceneNoire)), i: 1, r: liensResolus(sceneNoire, { ...ctx, plans: [revele] }), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.texte === "Scène en cours : plan sur la TV, notée au journal." && !bilan.action, `une pièce révélée : rien à signaler (${bilan.texte})`);
f = faux();
bilan = await jouerLaScene({ seance: seanceDe(structuredClone(complete)), i: 1, r: liensResolus(complete, ctx), musique: {}, quand: QUAND }, f.faire);
verifier(bilan.action === null, "plan sans brouillard : pas d'action");

// Une fiche retirée depuis ne donne plus de geste vers elle.
f = faux();
await jouerLaScene({ seance: seanceDe({ titre: "Vieille", liens: { plan: "disparu", ambiance: "partie" } }), i: 1, r: liensResolus({ liens: { plan: "disparu", ambiance: "partie" } }, ctx), musique: {}, quand: QUAND }, f.faire);
verifier(json(f.appels) === json([["journal", "Scène : Vieille"]]), `liens vers des fiches disparues : journal seulement (${json(f.appels)})`);

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
