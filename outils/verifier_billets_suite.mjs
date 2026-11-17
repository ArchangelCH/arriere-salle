// Vérifie les billets secrets (app/static/js/seances/billets.js : destinataires, scène qui suit sa ligne, ordre, rappel
// de Jouer) et « Préparer la suivante » (seances/seance-suivante.js : scènes jouées d'après les coches, le repère et le
// journal ; ce qui est proposé et pourquoi ; une séance existante complétée sans qu'une ligne écrite bouge ; une
// proposition retirée jamais reproposée ; la date une semaine plus tard).
// Usage : node outils/verifier_billets_suite.mjs

import { billetsOrdonnes, cleDeScene, htmlBillets, htmlRappel, pourQui, prenom, rangDeScene, rappelDeScene, repereDeScene } from "../app/static/js/seances/billets.js";
import { completer, dateEnClair, dateProposee, enAttente, estDuCadre, nouvelleSuite, propositionsDeLaSuite, scenesJouees, seanceSuivante } from "../app/static/js/seances/seance-suivante.js";

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const pareil = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copie = (x) => JSON.parse(JSON.stringify(x));

const tablee = [
  { id: "j1", joueur: "Yuna", personnage: "Velora Dorvan", couleur: "#b3261e" },
  { id: "j2", joueur: "Elian", personnage: "Eloran de la maison Amberel" },
  { id: "j3", joueur: "Dario", personnage: "Vortan Aldrea" },
  { id: "j4", joueur: "Léa", personnage: "" },
];

// ---- Les billets ----
verifier(prenom(tablee[1]) === "Eloran" && prenom(tablee[3]) === "Léa", "le prénom du héros, sinon celui du joueur");
const seance = {
  id: "s2", numero: 2, heure: "18:00",
  deroule: [
    { heure: "18:00", titre: "Installation" },
    { heure: "18:10", titre: "Prologue", cle: "sc-a" },
    { heure: "18:30", titre: "La rixe" },
    { heure: "18:50", titre: "L'incendie", cle: "sc-b" },
  ],
  billets: [
    { id: "b1", pour: ["j3", "j1"], texte: "Le bouclier frémit.", scene: "sc-b" },
    { id: "b2", pour: ["j1"], titre: "Un <murmure>", texte: "Toi seule entends.", scene: "sc-a" },
    { id: "b3", pour: [], texte: "Quand il faut.", scene: "" },
    { id: "b4", pour: ["j2"], texte: "", scene: "sc-a" },
    { id: "b5", pour: ["parti"], texte: "Pour un héros parti.", scene: "sc-perdue" },
  ],
};
verifier(pourQui(seance.billets[0], tablee) === "Velora et Vortan", "les destinataires dans l'ordre de la tablée");
verifier(pourQui(seance.billets[4], tablee) === "", "un héros qui a quitté la tablée ne compte plus");
verifier(rangDeScene(seance, seance.billets[1]) === 1 && rangDeScene(seance, seance.billets[4]) === -1, "la scène d'un billet par sa clé");
const deplacee = copie(seance);
deplacee.deroule.reverse();
verifier(rangDeScene(deplacee, deplacee.billets[0]) === 0, "la scène suit sa ligne quand le déroulé change d'ordre");
verifier(pareil(billetsOrdonnes(seance).map((b) => b.id), ["b2", "b4", "b1", "b3", "b5"]), "les billets dans l'ordre du déroulé, ceux sans scène à la fin");
verifier(repereDeScene(seance, seance.billets[0]) === "Scène 4 · 18 h 50", "le repère dit le rang et l'heure, pas le titre");
verifier(rappelDeScene(seance, 1, tablee) === " Billet pour Velora à remettre.", "le rappel ignore un billet sans texte");
verifier(rappelDeScene({ ...seance, billets: seance.billets.map((b) => ({ ...b, remis: true })) }, 1, tablee) === "", "un billet remis ne se rappelle plus");
verifier(htmlRappel(seance, 2, tablee) === "", "une scène sans billet n'a pas de rappel");
const html = htmlBillets(seance, tablee);
verifier(!html.includes("<murmure>") && html.includes("&lt;murmure&gt;"), "le titre d'un billet est échappé");
verifier(html.includes('href="/billets?seance=s2"') && html.includes("Imprimer les 4 billets"), "le lien vers la feuille compte les billets écrits");
const ligne = { titre: "Nouvelle" };
const cle = cleDeScene(ligne);
verifier(/^sc-[a-z0-9]+$/.test(cle) && cleDeScene(ligne) === cle, "la clé d'une scène est posée une fois");

// ---- Les scènes jouées ----
const rencontres = [{ id: "r-rixe", nom: "Les chasseurs du Notaire" }];
const jouee = {
  id: "s2", numero: 2, date: "2026-11-07", heure: "18:00", close: true,
  deroule: [
    { heure: "18:00", titre: "Installation, « Précédemment »", fait: true },
    { heure: "18:10", titre: "Prologue : le réveil", fait: true, liens: { pnj: ["mirele"] } },
    { heure: "18:30", titre: "O3 Chez Torvin", liens: { pnj: ["thorvald"] } },
    { heure: "18:40", titre: "La rixe", liens: { rencontre: "r-rixe", pnj: ["hilaire"] } },
    { heure: "19:00", titre: "Le conseil", liens: { pnj: ["toma"] } },
    { heure: "19:10", titre: "Pause" },
    { heure: "19:25", titre: "La nuit", en_cours: "2026-11-07T20:15:00", cle: "sc-nuit" },
    { heure: "19:40", titre: "L'incendie", cle: "sc-feu", liens: { pnj: ["mirele", "brom"], plan: "p-flammes" } },
    { heure: "20:20", titre: "L'aube", liens: { pnj: ["toma"] } },
    { heure: "20:40", titre: "Fin : ce que chacun a préféré" },
  ],
  journal: [{ t: "18:42", texte: "Combat « Les chasseurs du Notaire » : 2 tours. Au tapis : Hilaire." }, { t: "19:01", texte: "Scène : Le conseil" }],
  pnj: ["mirele", "valentine", "lisette", "mort", "hilaire"],
  lieux: ["l-auberge", "l-cache"],
  contrats: ["c-affiche", "c-pris", "c-reussi"],
  rumeurs: ["r-placer", "r-entendue", "r-verifiee"],
  questions: "Qui a trahi Toma ?",
  billets: [
    { id: "b-feu", pour: ["j1"], texte: "Une odeur d'étang.", scene: "sc-feu" },
    { id: "b-remis", pour: ["j2"], texte: "Déjà remis.", scene: "sc-feu", remis: true },
    { id: "b-nuit", pour: ["j3"], texte: "Pendant la nuit.", scene: "sc-nuit" },
  ],
};
verifier(pareil(scenesJouees(jouee, rencontres), [true, true, false, true, true, false, true, false, false, false]),
  "jouée : cochée, lancée, citée au journal (sa scène, ou le combat de sa rencontre)");
verifier(estDuCadre({ titre: "Fin : la planche noircie" }) && estDuCadre({ titre: "Pause" }) && !estDuCadre({ titre: "Finale au sommet" }), "le cadre : installation, pause, fin");

const monde = {
  rencontres,
  plans: [{ id: "p-flammes", lieu: "l-auberge" }],
  pnj: [
    { id: "mirele", nom: "Mirèle", connu: true }, { id: "thorvald", nom: "Torvin", connu: true }, { id: "hilaire", nom: "Hilaire", connu: false },
    { id: "toma", nom: "Toma", connu: true }, { id: "brom", nom: "Brom", connu: true }, { id: "valentine", nom: "Valentine", connu: false },
    { id: "lisette", nom: "Lisette", connu: true }, { id: "mort", nom: "Anatole", connu: true, statut: "mort" },
  ],
  lieux: [{ id: "l-auberge", nom: "L'auberge", connu: true }, { id: "l-cache", nom: "La cache", connu: false }],
  contrats: [
    { id: "c-affiche", nom: "Avis", etat: "affiche" }, { id: "c-pris", nom: "Galette", etat: "pris" }, { id: "c-reussi", nom: "Sauge", etat: "reussi" },
    { id: "c-ailleurs", nom: "Escorte", etat: "pris" }, { id: "c-tour", nom: "Volontaires", etat: "affiche", repere: "tour" },
  ],
  rumeurs: [
    { id: "r-placer", texte: "À placer", etat: "a-placer" }, { id: "r-entendue", texte: "Entendue", etat: "entendue", seance: "s2" },
    { id: "r-verifiee", texte: "Vérifiée", etat: "verifiee" }, { id: "r-fil", texte: "Du fil", etat: "a-placer", fil: "ether", etape_fil: 1 },
  ],
  fils: [
    { id: "ether", nom: "L'appel de l'Abîme", actif: true, avance: 1, etapes: [{ texte: "L'avis de la Tour est affiché.", rumeur: "Une voix au puits.", afficher: "tour" }, { texte: "Un volontaire revient." }],
      journal: [{ a: 1, seance: "s2", numero: 2 }] },
    { id: "chasse", nom: "La chasse", actif: true, avance: 2, etapes: [{ texte: "a" }, { texte: "b" }], journal: [{ a: 2, seance: "s1" }] },
    { id: "pause", nom: "En pause", actif: false, avance: 1, etapes: [{ texte: "x" }], journal: [{ a: 1, seance: "s2" }] },
  ],
};
const props = propositionsDeLaSuite(jouee, monde);
verifier(pareil(props.scenes.map((x) => x.ligne.titre), ["O3 Chez Torvin", "L'incendie", "L'aube", "L'avis de la Tour est affiché"]),
  "les scènes non jouées dans leur ordre, sans le cadre, puis une par fil qui a avancé à cette clôture");
verifier(props.scenes[0].raison === "sautée en séance 2" && props.scenes[1].raison === "pas jouée en séance 2", "sautée avant la dernière scène jouée, pas jouée après");
verifier(pareil(props.scenes[1].ligne, { titre: "L'incendie", duree: 30, note: "", liens: { pnj: ["mirele", "brom"], plan: "p-flammes" } }),
  "une scène reprise garde son texte et ses liens, sans heure, repère ni clé");
verifier(props.scenes[3].ligne.note.includes("étape 1") && props.scenes[3].ligne.note.includes("Une voix au puits"), "la scène du fil dit l'étape et la rumeur");
verifier(pareil(props.scenes[1].billets.map((b) => b.id), ["b-feu"]), "les billets non remis d'une scène reprise la suivent");
const raisons = Object.fromEntries(Object.entries(props.lignes).map(([g, l]) => [g, Object.fromEntries(l.map((x) => [x.id, x.raison]))]));
verifier(pareil(raisons.pnj, { hilaire: "croisé en séance 2, encore inconnu des joueurs", valentine: "pas encore rencontré", lisette: "sous la main en séance 2" }),
  `les PNJ : croisés, sous la main, pas encore rencontrés ; ni le mort, ni ceux qu'amène une scène proposée (${JSON.stringify(raisons.pnj)})`);
verifier(pareil(raisons.lieux, { "l-cache": "encore inconnu des joueurs" }), "les lieux encore inconnus ; celui qu'amène le plan d'une scène proposée n'a pas sa ligne");
verifier(pareil(raisons.contrats, { "c-tour": "affichée par le fil « L'appel de l'Abîme »", "c-pris": "prise, pas encore réussie", "c-ailleurs": "prise, pas encore réussie", "c-affiche": "encore sur la planche" }),
  `les affiches : celle du fil, les prises, celles de la séance encore sur la planche (${JSON.stringify(raisons.contrats)})`);
verifier(pareil(raisons.rumeurs, { "r-fil": "laissée par le fil « L'appel de l'Abîme »", "r-placer": "pas encore placée", "r-entendue": "entendue en séance 2, à suivre" }),
  `les rumeurs : du fil, à placer, entendues ; pas la vérifiée (${JSON.stringify(raisons.rumeurs)})`);
verifier(props.date === "2026-11-14" && props.heure === "18:00" && dateEnClair(props.date, props.heure) === "samedi 14 novembre à 18 h", "la même heure, le même jour, une semaine plus tard");
verifier(dateProposee({ close_le: "2026-11-01T18:11:33.078Z" }) === "2026-11-08", "sans date, une semaine après le jour de la clôture");

const muette = { ...copie(jouee), journal: [], deroule: jouee.deroule.map(({ fait, en_cours, ...d }) => d) };
const sans = propositionsDeLaSuite(muette, monde);
verifier(sans.sansScenes && sans.scenes.length === 1 && sans.scenes[0].cle.startsWith("fil:"), "rien ne dit quelles scènes sont jouées : aucune n'est reprise, on ne devine pas");
verifier("mirele" in Object.fromEntries(sans.lignes.pnj.map((x) => [x.id, 1])) && !sans.lignes.pnj.some((x) => x.id === "mort"), "sans scène jouée connue, tout « Sous la main » compte, sauf les morts");

// ---- La séance neuve ----
const cadre = [["Installation, et le « Précédemment »", 15], ["Scène 1", 40], ["Scène 2", 45], ["Pause", 30], ["Scène 3", 45], ["Fin de séance : ce que chacun a préféré", 15]];
const neuve = nouvelleSuite(jouee, props, { numero: 3, cadre, plans: monde.plans });
const titres = neuve.seance.deroule.map((d) => d.titre);
verifier(pareil(titres, ["Installation, et le « Précédemment »", "O3 Chez Torvin", "L'incendie", "Pause", "L'aube", "L'avis de la Tour est affiché", "Fin de séance : ce que chacun a préféré"]),
  `le cadre autour des scènes proposées, la pause au milieu (${JSON.stringify(titres)})`);
verifier(pareil(neuve.seance.deroule.map((d) => d.heure), ["18:00", "18:15", "18:45", "19:15", "19:45", "20:15", "20:25"]), "les heures recalées depuis l'heure de la séance");
verifier(neuve.seance.date === "" && neuve.seance.suite.date === "2026-11-14", "la date reste à confirmer : rien n'est publié aux joueurs avant");
verifier(neuve.seance.questions === "Qui a trahi Toma ?" && neuve.seance.numero === 3 && neuve.seance.close === false, "les questions ouvertes passent dans la séance neuve");
verifier(neuve.seance.billets.length === 1 && rangDeScene(neuve.seance, neuve.seance.billets[0]) === 2, "le billet reprise suit sa scène dans la séance neuve");
verifier(enAttente(neuve.seance, { ...monde }).scenes === 4 && enAttente(neuve.seance, monde).lignes === neuve.bilan.lignes, "ce qui attend un choix");
const vide = nouvelleSuite(jouee, { ...props, scenes: [] }, { numero: 3, cadre });
verifier(pareil(vide.seance.deroule.map((d) => d.titre), cadre.map(([t]) => t)), "sans scène proposée, le déroulé type tel quel");

// ---- Une séance suivante qui existe déjà ----
const existante = {
  id: "s3", numero: 3, date: "", heure: "17:00", questions: "Ma question.",
  deroule: [{ heure: "17:00", titre: "Mon ouverture", note: "écrite par le MJ principal" }, { heure: "17:30", titre: "Fin de séance" }],
  pnj: ["lisette"], contrats: [], rumeurs: [], lieux: [],
};
verifier(seanceSuivante(jouee, [jouee, { id: "s4", numero: 4 }, existante, { id: "s1", numero: 1 }]) === existante, "la séance suivante : la première non close après");
verifier(seanceSuivante(jouee, [jouee, { ...existante, close: true }]) === null, "toutes closes : il faut la créer");
const avant = copie(existante.deroule);
const bilan = completer(existante, props, jouee, { plans: monde.plans });
verifier(pareil(existante.deroule[0], avant[0]) && pareil(existante.deroule[existante.deroule.length - 1], avant[1]), "les lignes écrites ne bougent pas d'un caractère");
verifier(existante.deroule.length === 6 && existante.deroule[1].titre === "O3 Chez Torvin" && existante.deroule[1].heure === "17:00", "les scènes se glissent avant la fin, l'heure suit la ligne d'avant");
verifier(existante.questions === "Ma question." && existante.suite.date === "2026-11-14" && existante.suite.heure === "18:00", "un champ écrit n'est pas remplacé ; la date reste proposée");
verifier(!("lisette" in (existante.suite.proposes.pnj || {})) && existante.pnj.filter((x) => x === "lisette").length === 1, "ce qui est déjà sous la main n'est pas reproposé");
verifier(bilan.scenes === 4 && bilan.billets === 1, "le bilan compte ce qui est ajouté");
const encore = completer(existante, props, jouee, { plans: monde.plans });
verifier(encore.scenes === 0 && encore.lignes === 0 && encore.billets === 0 && existante.deroule.length === 6, "un second clic n'ajoute rien");
// Une scène et une ligne retirées ne reviennent plus.
const i = existante.deroule.findIndex((d) => d.titre === "L'aube");
existante.suite.retires = [existante.deroule[i].suite_cle, "pnj:valentine"];
existante.deroule.splice(i, 1);
existante.pnj = existante.pnj.filter((x) => x !== "valentine");
delete existante.suite.proposes.pnj.valentine;
const apres = completer(existante, props, jouee, { plans: monde.plans });
verifier(apres.scenes === 0 && apres.lignes === 0 && !existante.pnj.includes("valentine"), "une proposition retirée n'est jamais reproposée");
const datee2 = { id: "s5", numero: 3, date: "2026-11-21", deroule: [] };
completer(datee2, props, jouee, { plans: monde.plans });
verifier(!datee2.suite.date, "une séance déjà datée ne reçoit pas de date proposée");

console.log(`${verifications} vérifications, ${defauts} défaut${defauts > 1 ? "s" : ""}.`);
process.exit(defauts ? 1 : 0);
