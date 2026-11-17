// Vérifie la barre des onglets de l'atelier (app/static/js/commun/onglets.js) : trois familles qui couvrent chacun des
// quinze onglets une seule fois, dans l'ordre de la page ; la seconde ligne montre toute la famille ouverte, dans son
// ordre, à la même place quel que soit le reste (jour de séance ou non) ; le jour d'une séance, Jouer s'y ajoute en
// entier ou pas du tout, d'abord avec sa séparation, puis avec la séparation courte ; la séance du soir suit la règle de
// la séance en cours (seance-en-cours.js) : une séance close, ou qu'on ne joue pas aujourd'hui, n'ouvre rien.
// Usage : node outils/verifier_onglets.mjs
import { readFileSync } from "node:fs";
import { FAMILLES, disposer, familleDe, seanceDuSoir } from "../app/static/js/commun/onglets.js";

let verifications = 0;
let defauts = 0;
function verifier(cond, quoi) {
  verifications++;
  if (!cond) {
    defauts++;
    if (defauts <= 20) console.log(`DÉFAUT : ${quoi}`);
  }
}

// 1. Les familles et la page : chaque onglet de la page dans une seule famille, dans le même ordre.
const page = readFileSync(new URL("../app/static/index.html", import.meta.url), "utf-8");
const ordrePage = [...page.matchAll(/<a href="#\/(\w+)" data-onglet="(\w+)">/g)].map((m) => m[2]);
const ordreFamilles = FAMILLES.flatMap((f) => f.onglets);
verifier(ordrePage.length === 15, `quinze onglets dans la page : ${ordrePage.length}`);
verifier(JSON.stringify(ordrePage) === JSON.stringify(ordreFamilles), `la page suit l'ordre des familles : ${ordrePage.join(" ")}`);
verifier(new Set(ordreFamilles).size === ordreFamilles.length, "un onglet dans une seule famille");
verifier(JSON.stringify(FAMILLES.map((f) => f.cle)) === JSON.stringify(["preparer", "compagnie", "jouer"]), "Préparer, La compagnie, Jouer");
verifier(JSON.stringify(FAMILLES[2].onglets) === JSON.stringify(["seances", "combats", "table", "regles"]), "Jouer : Séances, Combats, Table, Règles maison");
for (const f of FAMILLES) for (const o of f.onglets) verifier(familleDe(o) === f.cle, `familleDe(${o})`);
verifier(familleDe("inconnu") === null, "un onglet inconnu n'a pas de famille");
for (const f of FAMILLES) verifier(page.includes(`data-famille="${f.cle}"`) && page.includes(`>${f.nom}</button>`), `le mot ${f.nom} dans la page`);

// 2. Les règles de disposer(), sur un cas quelconque.
const EPS = 1e-6;
const JOUER = FAMILLES[2].onglets;
function controler(largeurs, ouverte, soir, place, ecart) {
  const r = disposer(largeurs, { ouverte, soir, place, ecart });
  const cas = JSON.stringify({ ouverte, soir, place, ecart, r });
  const famille = FAMILLES.find((f) => f.cle === ouverte).onglets;
  verifier(JSON.stringify(r.montres.slice(0, famille.length)) === JSON.stringify(famille), `la famille ouverte en entier, en tête et dans son ordre : ${cas}`);
  const reste = r.montres.slice(famille.length);
  verifier(reste.length === 0 || JSON.stringify(reste) === JSON.stringify(JOUER), `Jouer en entier ou pas du tout : ${cas}`);
  verifier(r.epingle === reste.length > 0, `épinglé quand Jouer est là : ${cas}`);
  verifier(!r.epingle || (soir && ouverte !== "jouer"), `Jouer épinglé seulement le jour d'une séance, hors de Jouer : ${cas}`);
  verifier(!r.courte || r.epingle, `séparation courte seulement épinglé : ${cas}`);
  const total = (liste) => liste.reduce((s, o) => s + largeurs[o], 0) + ecart * Math.max(0, liste.length - 1);
  const base = total(famille);
  const avec = (sep) => total([...famille, sep, ...JOUER]);
  if (r.epingle) verifier(avec(r.courte ? "¦" : "|") <= place + 0.5 + EPS, `l'épinglé tient : ${cas}`);
  if (r.courte) verifier(avec("|") > place + 0.5 - EPS, `la séparation courte seulement quand la longue ne tient pas : ${cas}`);
  if (soir && ouverte !== "jouer" && !r.epingle) verifier(avec("¦") > place + 0.5 - EPS, `Jouer tenait et n'est pas épinglé : ${cas}`);
  const occupe = r.epingle ? avec(r.courte ? "¦" : "|") : base;
  verifier(r.deborde === occupe > place + 0.5, `débordement annoncé : ${cas}`);
  return r;
}

// Largeurs mesurées dans Chrome à 1512 px (12 px, Cinzel), la séparation « Ce soir » et sa forme courte, marges
// comprises ; la ligne y fait 1264 px, l'écart entre deux éléments 2 px.
const REELLES = {
  scenarios: 107.5, cartes: 79.1, lieux: 66.9, pnj: 48.9, idees: 65, bible: 64, documents: 118.5,
  aventuriers: 125.4, auberge: 90.8, boutiques: 109.5, sanctuaire: 118,
  seances: 88.5, combats: 93.5, table: 67.3, regles: 142.8, "|": 92.1, "¦": 13,
};

// 3. Cas écrits à la main.
{
  let r = controler(REELLES, "preparer", false, 1264, 2);
  verifier(r.montres.join(" ") === "scenarios cartes lieux pnj idees bible documents" && !r.epingle && !r.deborde, "Préparer à 1512 px, sans séance");
  r = controler(REELLES, "preparer", true, 1264, 2);
  verifier(r.epingle && !r.courte && r.montres.length === 11, "jour de séance à 1512 px : Jouer épinglé, avec « Ce soir »");
  r = controler(REELLES, "jouer", true, 1264, 2);
  verifier(!r.epingle && r.montres.join(" ") === "seances combats table regles", "Jouer ouverte : rien de plus");
  r = controler(REELLES, "compagnie", true, 880, 2);
  verifier(r.epingle && r.courte, "La compagnie à l'étroit : séparation courte");
  r = controler(REELLES, "compagnie", true, 800, 2);
  verifier(!r.epingle, "trop étroit : Jouer reste dans sa famille");
  r = controler(REELLES, "preparer", true, 200, 2);
  verifier(!r.epingle && r.deborde && r.montres.length === 7, "la famille ouverte jamais coupée, même trop étroite (la ligne défile)");
}

// 4. Toutes les places de 0 à 1400 px, chaque famille ouverte, avec et sans séance, largeurs réelles.
for (const f of FAMILLES) {
  for (const soir of [false, true]) {
    for (let place = 0; place <= 1400; place += 0.5) controler(REELLES, f.cle, soir, place, 2);
  }
}

// 5. Cas tirés au hasard (graine fixe).
let graine = 20261104;
const hasard = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let k = 0; k < 30000; k++) {
  const largeurs = Object.fromEntries(Object.keys(REELLES).map((o) => [o, Math.round((5 + hasard() * 150) * 8) / 8]));
  if (largeurs["¦"] > largeurs["|"]) [largeurs["¦"], largeurs["|"]] = [largeurs["|"], largeurs["¦"]];
  const ouverte = FAMILLES[Math.floor(hasard() * 3)].cle;
  controler(largeurs, ouverte, hasard() < 0.5, Math.round(hasard() * 1600 * 4) / 4, Math.round(hasard() * 8));
}

// 6. La séance du soir, la règle de tout l'atelier (seance-en-cours.js) : la séance en cours si on la joue aujourd'hui
// (datée du jour, une scène jouée aujourd'hui, un combat en cours) ; ni hier, ni demain, ni close, ni sans date.
const jour = new Date().toLocaleDateString("sv");
const hier = new Date(Date.now() - 864e5).toLocaleDateString("sv");
const demain = new Date(Date.now() + 864e5).toLocaleDateString("sv");
verifier(seanceDuSoir([{ id: "a", date: jour }])?.id === "a", "séance d'aujourd'hui");
verifier(seanceDuSoir([{ id: "a", date: jour, close: true }]) === null, "séance d'aujourd'hui close");
verifier(seanceDuSoir([{ id: "a", date: demain }, { id: "b" }]) === null, "séance de demain, séance sans date");
verifier(seanceDuSoir([{ id: "a", date: demain }, { id: "b", date: jour }])?.id === "b", "la bonne parmi plusieurs");
verifier(seanceDuSoir(null) === null && seanceDuSoir([null]) === null, "liste absente ou abîmée");
verifier(seanceDuSoir([{ id: "a", date: hier }]) === null, "séance d'hier, rien de joué aujourd'hui");
verifier(seanceDuSoir([{ id: "a", numero: 1, date: hier, deroule: [{ en_cours: new Date().toISOString() }] }, { id: "b", numero: 2, date: demain }])?.id === "a",
  "séance d'hier dont une scène a été jouée aujourd'hui : c'est elle, comme pour le Tableau");
verifier(seanceDuSoir([{ id: "a", numero: 1, date: jour }, { id: "b", numero: 2, date: hier, combat: { tour: 2, debut: new Date().toISOString() } }])?.id === "b",
  "le combat en cours l'emporte sur la date, comme partout");
verifier(seanceDuSoir([{ id: "a", date: "2026-03-01" }], "2026-03-01")?.id === "a" && seanceDuSoir([{ id: "a", date: "2026-03-01" }], "2026-03-02") === null,
  "le jour en argument");

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
