// Vérifie « retrouver sa séance » : la règle unique de la séance en cours (app/static/js/seances/seance-en-cours.js), le fil de
// la séance et le geste « Scène suivante » (seances/scene-suivante.js : la scène en cours cochée, la suivante marquée,
// rien deux fois quand un autre écran a avancé), et le plan d'un combat lancé depuis une scène
// (combats/plan-de-scene.js : le plan de la scène, les pions qui manquent, cachés, à des numéros libres).
// Usage : node outils/verifier_seance_en_cours.mjs

import { seanceDuJour, seanceEnCours } from "../app/static/js/seances/seance-en-cours.js";
import { seanceDuJournal } from "../app/static/js/seances/journal.js";
import { attenduDe, avancer, filDeLaSeance, htmlFilDeSeance } from "../app/static/js/seances/scene-suivante.js";
import { sceneEnCours } from "../app/static/js/seances/liens-scene.js";
import { manquants, pionsAPoser, places, planDeLaScene, planDesNumeros } from "../app/static/js/combats/plan-de-scene.js";
import { groupes } from "../app/static/js/combats/rencontre.js";
import { ongletOuvrant, retenirOnglet } from "../app/static/js/seances/ouverture.js";

// La mémoire du navigateur, pour l'onglet retenu.
const memoire = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => (memoire.has(k) ? memoire.get(k) : null), setItem: (k, v) => memoire.set(k, String(v)) },
});

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

// ---- La séance en cours ----
const JOUR = "2026-11-03";
const midi = (j) => new Date(`${j}T12:00:00`).toISOString();
const s1 = { id: "s1", numero: 1, date: "2026-11-01", close: true };
const s2 = { id: "s2", numero: 2, date: "2026-11-07", deroule: [{ titre: "Installation" }] };
const s3 = { id: "s3", numero: 3, date: JOUR, deroule: [{ titre: "Installation" }] };
const id = (s) => s?.id || null;
verifier(seanceEnCours([], { jour: JOUR }) === null && seanceEnCours(null) === null && seanceEnCours([s1], { jour: JOUR }) === null, "sans séance ouverte : aucune");
verifier(id(seanceEnCours([s1, s2, s3], { jour: JOUR })) === "s3", "le jour J, la séance du jour, même si une autre a un plus petit numéro (c23)");
verifier(id(seanceEnCours([s1, s2], { jour: JOUR })) === "s2", "sinon la plus proche par sa date");
verifier(id(seanceDuJournal([s1, s2, s3], JOUR)) === "s3" && id(seanceDuJournal([s3, s2], JOUR)) === id(seanceEnCours([s2, s3], { jour: JOUR })), "le journal suit la même règle");
const avant = { id: "a", numero: 4, date: "2026-11-01" };
const apres = { id: "b", numero: 5, date: "2026-11-08" };
verifier(id(seanceEnCours([apres, avant], { jour: JOUR })) === "a", "une séance passée non close, plus proche, passe avant la suivante");
verifier(id(seanceEnCours([{ id: "c", numero: 7, date: "2026-11-05" }, { id: "d", numero: 6, date: "2026-11-01" }], { jour: JOUR })) === "d", "à égalité de date, le plus petit numéro");
verifier(id(seanceEnCours([{ id: "x", numero: 9 }, { id: "y", numero: 8 }], { jour: JOUR })) === "y", "sans date : la première par son numéro");
verifier(id(seanceEnCours([{ id: "x", numero: 1 }, s2], { jour: JOUR })) === "s2", "une séance datée passe avant une séance sans date");
// Une scène jouée aujourd'hui : la séance qu'on joue, quelle que soit sa date.
const jouee = { ...s2, deroule: [{ titre: "Installation", fait: true, en_cours: midi(JOUR) }, { titre: "Le prologue" }] };
verifier(id(seanceEnCours([s1, jouee, s3], { jour: JOUR })) === "s2", "une scène jouée aujourd'hui l'emporte sur la date");
const hier = { ...s2, deroule: [{ titre: "Installation", en_cours: midi("2026-11-02") }] };
verifier(id(seanceEnCours([hier, s3], { jour: JOUR })) === "s3", "une scène jouée un autre jour ne compte pas");
const tard = { ...s3, deroule: [{ titre: "x", en_cours: new Date(`${JOUR}T20:00:00`).toISOString() }] };
verifier(id(seanceEnCours([jouee, tard], { jour: JOUR })) === "s3", "deux séances jouées aujourd'hui : la plus récente");
// Un combat en cours : la séance où l'on se bat.
const combat = { ...s2, combat: { id: "c1", modifie: "2026-11-03T19:00:00", debut: "2026-11-03T18:40:00" } };
verifier(id(seanceEnCours([s1, combat, s3], { jour: JOUR })) === "s2", "un combat en cours l'emporte sur tout");
verifier(id(seanceEnCours([s1, s2, s3], { jour: JOUR, auCombat: "s2" })) === "s2", "la séance du combat, dite par l'écran (etat-jeu)");
verifier(id(seanceEnCours([s1, s2, s3], { jour: JOUR, auCombat: "s1" })) === "s3", "un combat dans une séance close ne compte pas");
verifier(seanceDuJour(s3, JOUR) && seanceDuJour(jouee, JOUR) && seanceDuJour(combat, JOUR), "séance du jour : datée du jour, jouée aujourd'hui, ou au combat");
verifier(!seanceDuJour(s2, JOUR) && !seanceDuJour(hier, JOUR) && !seanceDuJour({ ...s3, close: true }, JOUR) && !seanceDuJour(null, JOUR), "pas la séance du jour");

// ---- L'onglet où s'ouvre une séance ----
const aujourdhuiIci = new Date().toLocaleDateString("sv");
const duJourIci = { id: "j", numero: 3, date: aujourdhuiIci };
const autreJour = { id: "k", numero: 4, date: "2027-01-09" };
verifier(ongletOuvrant(null) === "preparer" && ongletOuvrant(duJourIci) === "jouer" && ongletOuvrant(autreJour) === "preparer", "sans mémoire : Jouer le jour où on la joue, sinon Préparer");
const t0 = Date.now();
retenirOnglet(duJourIci, "clore", t0);
retenirOnglet(autreJour, "jouer", t0 - 4 * 3600 * 1000);
verifier(ongletOuvrant(duJourIci, t0 + 3600 * 1000) === "clore", "le dernier onglet vu, depuis moins de trois heures");
verifier(ongletOuvrant(duJourIci, t0 + 4 * 3600 * 1000) === "jouer" && ongletOuvrant(autreJour, t0) === "preparer", "plus de trois heures : oublié");
retenirOnglet(duJourIci, "n'importe quoi", t0);
verifier(ongletOuvrant(duJourIci, t0) === "clore", "un onglet inconnu ne s'écrit pas");
retenirOnglet(duJourIci, "jouer", t0);
verifier(!JSON.parse(memoire.get("seances.onglets")).k, "les séances vues il y a plus de trois heures s'oublient");

// ---- Le fil de la séance ----
const deroule = () => [
  { titre: "Installation", fait: true },
  { titre: "L'aube sur les cendres", en_cours: midi(JOUR), liens: { plan: "etang", ambiance: "aube" } },
  { titre: "La piste des chasseurs", liens: { plan: "camp" } },
  { titre: "  " },
];
let s = { id: "s", deroule: deroule() };
verifier(json(filDeLaSeance(s)) === json({ enCours: 1, suivante: 2 }), `en cours et ensuite : ${json(filDeLaSeance(s))}`);
verifier(json(filDeLaSeance({ deroule: [{ titre: "a" }, { titre: "b" }] })) === json({ enCours: -1, suivante: 0 }), "rien de joué : la première non cochée ensuite");
verifier(json(filDeLaSeance({ deroule: [{ titre: "a", fait: true }, { titre: "b", en_cours: midi(JOUR) }] })) === json({ enCours: 1, suivante: -1 }), "la dernière scène en cours : rien ensuite");
verifier(json(filDeLaSeance({ deroule: [{ titre: "a", fait: true, en_cours: midi(JOUR) }] })) === json({ enCours: -1, suivante: -1 }), "tout coché : ni l'une ni l'autre");
verifier(json(filDeLaSeance({ deroule: [{ titre: "a" }, { titre: "b", en_cours: midi(JOUR) }, { titre: "c", fait: true }] })) === json({ enCours: 1, suivante: 0 }), "rien après la scène en cours : une scène sautée avant elle");
verifier(json(filDeLaSeance({})) === json({ enCours: -1, suivante: -1 }) && json(filDeLaSeance(null)) === json({ enCours: -1, suivante: -1 }), "séance vide");
verifier(sceneEnCours({ deroule: [{ titre: "a" }, { titre: "b", en_cours: midi(JOUR) }] }) === 1, "la scène en cours de Jouer : celle que « Jouer la scène » a marquée");
verifier(sceneEnCours({ deroule: [{ titre: "a", fait: true }, { titre: "b" }] }) === 1 && sceneEnCours({ deroule: [{ fait: true }] }) === -1, "sinon la première non cochée");
verifier(json(attenduDe(s)) === json({ enCours: 1, suivante: 2, titre: "La piste des chasseurs" }), "ce que le bouton annonce");
verifier(attenduDe({ deroule: [{ titre: "a", en_cours: midi(JOUR) }, { titre: " " }] }).titre === "Scène 2", "une scène sans titre : son numéro");

// ---- Le pas du geste ----
const quand = new Date(`${JOUR}T21:30:00`).toISOString();
let pas = avancer(s, attenduDe(s), quand);
verifier(pas.i === 2 && s.deroule[1].fait === true && s.deroule[2].en_cours === quand && !("en_cours" in s.deroule[1]), `la scène en cours cochée, la suivante marquée : ${json(s.deroule)}`);
verifier(json(s.deroule[2].liens) === json({ plan: "camp" }) && s.deroule[0].fait && !s.deroule[3].fait, "le reste du déroulé ne bouge pas");
// Le même bouton, renvoyé (double toucher, ou un autre écran qui avait déjà joué) : rien ne se rejoue.
s = { deroule: deroule() };
const bouton = attenduDe(s);
avancer(s, bouton, quand);
const copieAvant = json(s.deroule);
pas = avancer(s, bouton, quand);
verifier(pas.refus && pas.deja && pas.refus.includes("déjà en cours") && json(s.deroule) === copieAvant, `renvoyé : déjà en cours, rien ne change (${pas.refus})`);
// Un autre écran a avancé plus loin : refus, la séance dit où elle en est.
const loin = { deroule: [{ titre: "a", fait: true }, { titre: "b", fait: true }, { titre: "c", en_cours: quand }, { titre: "d" }] };
const vieux = { enCours: 0, suivante: 1, titre: "b" };
pas = avancer(loin, vieux, quand);
verifier(pas.refus && !pas.deja && pas.refus.includes("« c » est en cours") && !loin.deroule[3].en_cours, `la séance a changé : ${pas.refus}`);
// Une scène montée ou renommée entre le bouton et le geste : refus aussi.
const renomme = { deroule: deroule() };
const avantRenom = attenduDe(renomme);
renomme.deroule[2].titre = "La piste, de nuit";
verifier(avancer(renomme, avantRenom, quand).refus && !renomme.deroule[1].fait, "la scène annoncée a changé de titre : rien ne se joue");
// Les blancs d'un titre ne comptent pas (le serveur les réduit dans la commande de la télécommande).
const blancs = { deroule: [{ titre: "a", en_cours: quand }, { titre: "La piste  des\nchasseurs" }] };
verifier(avancer(blancs, { enCours: 0, suivante: 1, titre: "La piste des chasseurs" }, quand).i === 1, "titre aux blancs réduits : la même scène");
verifier(avancer({ deroule: [{ titre: "a", fait: true }] }, null, quand).refus, "plus rien à jouer : refus");
const debut = { deroule: [{ titre: "Installation" }, { titre: "b" }] };
pas = avancer(debut, attenduDe(debut), quand);
verifier(pas.i === 0 && !debut.deroule[0].fait && debut.deroule[0].en_cours === quand, "rien de joué : la première se joue, rien n'est coché");

// ---- Le fil à l'écran ----
s = { id: "s2", numero: 2, nom: "Le Sanctuaire", deroule: deroule() };
let html = htmlFilDeSeance(s);
verifier(/En cours<\/small><button[^>]*data-action="voir-scene"[^>]*>L&#39;aube sur les cendres</.test(html) && /Ensuite<\/small><b>La piste des chasseurs<\/b>/.test(html), "le bandeau : en cours, ensuite");
verifier(/data-action="jouer-suite" data-seance="s2" data-de="1" data-vers="2" data-titre="La piste des chasseurs"/.test(html) && html.includes(">Jouer</button>"), "le bouton porte ce qu'il annonce");
verifier(html.includes("Coche « L&#39;aube sur les cendres » et joue « La piste des chasseurs » : plan sur la TV et journal."), "la bulle dit ce que fait le geste");
html = htmlFilDeSeance(s, "tableau");
verifier(html.includes('href="#/seances/s2?onglet=jouer"') && html.includes("Séance 2 · Le Sanctuaire") && !html.includes("voir-scene"), "le Tableau : le nom de la séance, qui l'ouvre sur Jouer");
verifier(htmlFilDeSeance({ ...s, close: true }) === "" && htmlFilDeSeance({ id: "x", deroule: [] }) === "" && htmlFilDeSeance(null) === "", "séance close ou vide : rien");
html = htmlFilDeSeance({ id: "x", deroule: [{ titre: "a", fait: true }, { titre: "b", en_cours: quand }] });
verifier(html.includes("Dernière scène du déroulé.") && !html.includes("jouer-suite"), "la dernière scène : pas de bouton");
html = htmlFilDeSeance({ id: "x", deroule: [{ titre: "a", fait: true }] });
verifier(html.includes("Toutes les scènes sont jouées.") && !html.includes("jouer-suite"), "tout est joué");
html = htmlFilDeSeance({ id: "x", deroule: [{ titre: "<b>a</b>" }] });
verifier(!html.includes("<b>a</b>") && html.includes("&lt;b&gt;a&lt;/b&gt;"), "les titres sont échappés");

// ---- Le plan d'un combat lancé depuis une scène ----
const r = { id: "embuscade", nom: "L'embuscade", adversaires: [{ cle: "clemence-morel", nom: "Clémence Morand", n: 1 }, { cle: "brigand", nom: "Brigand", n: 3 }] };
const ferme = { id: "ferme", nom: "La Grange-Noire", pions: [1, 2, 3].map((k) => ({ id: `b${k}`, genre: "ennemi", ref: "bestiaire:brigand", nom: "Brigand", court: String(k), x: k + 0.5, y: 1.5 })) };
const etang = {
  id: "etang", nom: "L'étang", largeur: 6, hauteur: 5,
  // Une rangée d'eau au milieu (7), du vide (0) en haut à gauche.
  sol: [0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  pions: [{ id: "h1", genre: "heros", ref: "aventurier:a", nom: "Vortan", x: 2.5, y: 3.5 }, { id: "n1", genre: "ennemi", ref: "bestiaire:zombie", nom: "Noyé", court: "1", x: 4.5, y: 4.5, cache: true }],
};
const seance = { deroule: [{ titre: "La route" }, { titre: "L'étang", liens: { plan: "etang", rencontre: "embuscade" } }, { titre: "Ailleurs", liens: { plan: "ferme", rencontre: "embuscade" } }] };
const plans = [ferme, etang];
verifier(planDeLaScene(seance, r, plans)?.id === "etang", "le plan de la scène qui lie la rencontre (la première)");
verifier(planDeLaScene({ deroule: [...seance.deroule.slice(0, 2).map((d) => ({ ...d, fait: true })), { ...seance.deroule[2], en_cours: quand }] }, r, plans)?.id === "ferme", "la scène en cours d'abord");
verifier(planDeLaScene({ deroule: [{ liens: { rencontre: "embuscade" } }] }, r, plans) === null && planDeLaScene(seance, { id: "autre" }, plans) === null && planDeLaScene(null, r, plans) === null, "sans plan lié : rien (la balance choisit)");
verifier(planDeLaScene({ deroule: [{ liens: { plan: "disparu", rencontre: "embuscade" } }] }, r, plans) === null, "un plan retiré depuis : rien");
// Le plan des numéros (feuille de combat et suivi) : la scène d'abord, sinon un plan du lieu de la rencontre, sinon rien.
const auberge = { id: "auberge", nom: "L'auberge en flammes", lieu: "auberge", pions: [1, 2, 3].map((k) => ({ id: `a${k}`, genre: "ennemi", ref: "bestiaire:brigand", nom: "Brigand", court: String(k + 5) })) };
const sansPlan = { deroule: [{ titre: "Le jour d'avant", liens: { rencontre: "embuscade" } }] };
verifier(planDesNumeros(seance, r, [...plans, auberge])?.id === "etang", "numéros : le plan de la scène passe avant tout");
verifier(planDesNumeros(sansPlan, { ...r, lieu: "etang-lieu" }, [{ ...etang, lieu: "etang-lieu" }, auberge]) === null, "numéros : le lieu de la rencontre n'a pas ses pions, rien plutôt que l'auberge");
verifier(planDesNumeros(sansPlan, { ...r, lieu: "auberge" }, [ferme, auberge])?.id === "auberge", "numéros : un plan de son lieu qui porte ses adversaires");
verifier(planDesNumeros(sansPlan, r, [etang, auberge])?.id === "auberge" && planDesNumeros(null, null, plans) === null, "numéros : sans lieu, l'ancienne règle (le plan qui en porte le plus)");
verifier(manquants(r, etang) === 4 && manquants(r, ferme) === 1, `les pions qui manquent : ${manquants(r, etang)} sur l'étang, ${manquants(r, ferme)} à la ferme`);
const poses = pionsAPoser(r, etang);
verifier(json(poses.map((t) => [t.nom, t.court, t.cache, t.ref])) === json([["Clémence Morand", "2", true, "bestiaire:clemence-morel"], ["Brigand", "3", true, "bestiaire:brigand"], ["Brigand", "4", true, "bestiaire:brigand"], ["Brigand", "5", true, "bestiaire:brigand"]]),
  `posés cachés, à des numéros libres (le 1 est au Noyé) : ${json(poses.map((t) => [t.nom, t.court]))}`);
verifier(json(pionsAPoser(r, ferme).map((t) => [t.nom, t.court])) === json([["Clémence Morand", "4"]]), "seulement ceux qui manquent");
// Posés, ils donnent leurs numéros au combat.
const pose = { ...etang, pions: [...etang.pions, ...poses.map((t, k) => ({ ...t, id: `p${k}`, x: k + 0.5, y: 0.5 }))] };
const numeros = groupes(r, pose, 4, 2).flatMap((g) => g.membres.map((m) => `${g.a.nom} ${m.numero}`));
verifier(json(numeros) === json(["Clémence Morand 2", "Brigand 3", "Brigand 4", "Brigand 5"]) && manquants(r, pose) === 0, `les numéros du combat : ${json(numeros)}`);
const cases = places(etang, 4);
const k = (c) => c[1] * 6 + c[0];
verifier(cases.length === 4 && cases.every((c) => etang.sol[k(c)] && etang.sol[k(c)] !== 7), `des cases de sol, hors de l'eau : ${json(cases)}`);
verifier(cases.every((c) => Math.max(Math.abs(c[0] - 2), Math.abs(c[1] - 3)) >= 2) && new Set(cases.map(json)).size === 4, "à deux cases au moins des héros, une par pion");
verifier(!cases.some((c) => c[0] === 4 && c[1] === 4), "jamais sur un autre pion");
const plein = places({ ...etang, pions: [] }, 30);
verifier(plein.length === 29 && plein.filter((c) => etang.sol[k(c)] === 7).length === 6, "faute de place, l'eau sert aussi ; jamais le vide");

console.log(`${verifications} vérifications, ${defauts} défaut${defauts > 1 ? "s" : ""}.`);
process.exit(defauts ? 1 : 0);
