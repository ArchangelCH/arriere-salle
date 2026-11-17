// Vérifie ce que l'atelier sait de la TV sans navigateur (app/static/js/ecran-tv/tv-commun.js) : la vue qu'elle montre vraiment,
// comme table.js en décide ; la clé qui change quand autre chose arrive à l'écran, pas quand la caméra bouge ; ce que
// fait « Retirer » du témoin (un carton d'abord, le lieu d'une carte, une vue plein écran qui rend ce qu'elle recouvrait,
// enfin l'accueil) ; un plan sous brouillard dont rien n'est révélé ; et la ligne « Plan lié sans pièce révélée »
// d'« Avant de jouer ». Puis les vrais plans du dossier de données s'il est là (lus, jamais écrits), comparés à ce que la
// TV cadrerait.
// Usage : node outils/verifier_tv.mjs [dossier des plans, data/plans par défaut]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { avantDeJouer, htmlAvantDeJouer } from "../app/static/js/seances/avant-de-jouer.js";
import { boiteRevelee } from "../app/static/js/plan/modele.js";
import { placerNoms, placerNomsMJ, prenom } from "../app/static/js/plan/rendu.js";
import { allegerPlan, avantDe, cartonsTv, cleTv, combatTv, etatRetire, genreRetrait, lieuTv, rienDeRevele, vueTv } from "../app/static/js/ecran-tv/tv-commun.js";

const DOSSIER = process.argv[2] || new URL("../data/plans/", import.meta.url).pathname;
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

// ---- La vue montrée, comme table.js ----
verifier(vueTv(null) === "accueil" && vueTv({}) === "accueil" && vueTv({ vue: "accueil" }) === "accueil", "rien : l'accueil");
verifier(vueTv({ vue: "plan", plan: "p" }) === "plan" && vueTv({ vue: "plan" }) === "accueil", "un plan sans plan retombe sur l'accueil");
verifier(vueTv({ vue: "boutique", boutique: "b" }) === "boutique" && vueTv({ vue: "boutique" }) === "accueil", "une boutique sans boutique : l'accueil");
verifier(vueTv({ vue: "image", url: "/media/x.png" }) === "image" && vueTv({ vue: "image" }) === "accueil", "une image sans adresse : l'accueil");
verifier(vueTv({ vue: "precedemment", seance: "s" }) === "precedemment" && vueTv({ vue: "episode" }) === "accueil", "Précédemment et épisode ont besoin de leur séance");
verifier(["heros", "fiches", "planche", "sanctuaire"].every((v) => vueTv({ vue: v }) === v), "tablée, fiches, planche, sanctuaire se suffisent");
verifier(vueTv({ vue: "n'importe quoi" }) === "accueil", "une vue inconnue : l'accueil");
verifier(json(cartonsTv({ pnj: "a", rumeur: null, aventurier: "c" })) === json(["pnj", "aventurier"]), "les cartons à l'écran");
verifier(lieuTv({ vue: "carte", carte: "c", lieu: "l" }) === "l" && lieuTv({ vue: "plan", plan: "p", lieu: "l" }) === null, "le lieu, seulement sur une carte");

// ---- Les noms sous les pions, lus du canapé ----
const prenoms = { "Frère Anatole": "Anatole", "Le Ménestrel": "Ménestrel", "Dame Mélisande de Clairefonds": "Mélisande", "Sœur Agathe": "Agathe",
  "Maître Corbeau": "Corbeau", "Toma de Silbermann": "Toma", "Frère": "Frère", "L'inquisiteur qui boit seul": "inquisiteur", "Frédéric": "Frédéric" };
for (const [nom, attendu] of Object.entries(prenoms)) verifier(prenom({ nom }) === attendu, `« ${nom} » s'écrit « ${prenom({ nom })} » sous son pion, attendu « ${attendu} »`);
// Deux PNJ serrés : sur la TV, leur nom garde une taille lisible au lieu de tomber à celle de l'atelier.
const ctxFaux = { font: "", save() {}, restore() {}, measureText: (t) => ({ width: [...t].length * 20 }) };
const serres = { pions: [{ id: "a", genre: "pnj", nom: "Mirèle", x: 2, y: 2 }, { id: "b", genre: "pnj", nom: "Torvin", x: 2.9, y: 2 }], largeur: 10, hauteur: 10, brouillard_actif: false };
const lisible = { nom: 0.9, nomMin: 0.64 };
const places = placerNoms(ctxFaux, serres, { x0: 0, y0: 0, x1: 10, y1: 10 }, lisible);
verifier([...places.ecrits.values()].every((t) => t >= 0.64), `des noms serrés gardent 17 px sur la TV (${json([...places.ecrits.values()])})`);
// Dans la vue du MJ, deux prénoms ne se chevauchent plus : le PNJ garde le sien avant un héros, le pion survolé passe
// devant tout le monde, et un prénom qui a la place reste écrit.
const tablee = { ...serres, pions: [{ id: "h", genre: "heros", nom: "Tavarède", x: 2, y: 2 }, ...serres.pions, { id: "c", genre: "pnj", nom: "Cyprien", x: 7, y: 7 }, { id: "e", genre: "ennemi", nom: "Brigand", court: "1", x: 7, y: 2 }] };
const zoneMJ = { x0: 0, y0: 0, x1: 10, y1: 10 };
let mj = placerNomsMJ(ctxFaux, tablee, zoneMJ, tablee.pions);
verifier(mj.get("a") > 0 && mj.get("h") === 0 && mj.get("b") === 0 && mj.get("c") > 0 && !mj.has("e"), `vue du MJ : un seul nom par groupe serré, le PNJ d'abord (${json([...mj])})`);
mj = placerNomsMJ(ctxFaux, tablee, zoneMJ, tablee.pions, ["h"]);
verifier(mj.get("h") > 0 && mj.get("a") === 0 && mj.get("c") > 0, `vue du MJ : le pion survolé garde son prénom (${json([...mj])})`);
mj = placerNomsMJ(ctxFaux, { ...tablee, pions: tablee.pions.map((t) => (t.id === "a" ? { ...t, cache: true } : t)) }, zoneMJ, tablee.pions.map((t) => (t.id === "a" ? { ...t, cache: true } : t)), [], true);
verifier(!mj.has("a") && mj.get("b") > 0 && mj.get("h") === 0, `vue joueurs de l'éditeur : un pion caché ne prend pas la place d'un nom (${json([...mj])})`);

// ---- La clé : autre chose à l'écran, pas la caméra ----
const plan = { vue: "plan", plan: "p", camera: { x: 1, y: 2, hv: 9 }, version: "v1", style: "peint" };
verifier(cleTv(plan) === cleTv({ ...plan, camera: { x: 5, y: 2, hv: 12 }, version: "v2", style: "couleur", combat_maj: 3 }), "la caméra, la version, le style ne changent pas la clé");
verifier(cleTv(plan) !== cleTv({ ...plan, plan: "q" }), "un autre plan change la clé");
verifier(cleTv(plan) !== cleTv({ ...plan, pnj: "gaspard" }), "un carton change la clé");
verifier(cleTv(plan) !== cleTv({ ...plan, combat: "seance-2" }), "l'ordre du combat qui paraît change la clé (le témoin le dit)");
verifier(combatTv({ ...plan, combat: "s" }) && combatTv({ vue: "carte", carte: "c", combat: "s" }) && combatTv({ vue: "image", url: "/media/x.png", combat: "s" }),
  "le bandeau du combat se pose sur un plan, une carte ou une image");
verifier(!combatTv(plan) && !combatTv({ vue: "heros", combat: "s" }) && !combatTv({ vue: "plan", combat: "s" }), "ailleurs, ou sans combat, pas d'ordre à l'écran");
verifier(cleTv({ vue: "boutique", boutique: "b" }) !== cleTv({ vue: "boutique", boutique: "b", article: "x" }), "un article de près change la clé");
verifier(cleTv({ vue: "plan" }) === cleTv({ vue: "accueil" }), "deux états qui montrent l'accueil ont la même clé");

// ---- Retirer ----
const lus = { ecrans: 1, ecrans_salon: 1, ecrans_internet: 0, publique: { ouverte: true } };
verifier(etatRetire({ vue: "accueil", ...lus }) === null && genreRetrait({ vue: "accueil" }) === "", "l'accueil : rien à retirer");
let r = etatRetire({ ...plan, pnj: "gaspard", rumeur: "r1", ...lus });
verifier(r.vue === "plan" && r.plan === "p" && json(r.camera) === json(plan.camera) && r.pnj === null && r.rumeur === null && r.aventurier === null, `un carton sur un plan : le plan revient, cadrage compris (${json(r)})`);
verifier(!("ecrans" in r) && !("publique" in r), "ce que GET ajoute ne repart pas");
verifier(genreRetrait({ ...plan, pnj: "g" }) === "carton", "le bouton dit : un carton");
r = etatRetire({ vue: "carte", carte: "c", lieu: "l", camera: { x: 1, y: 1, hv: 3 } });
verifier(r.vue === "carte" && r.lieu === null && r.camera.hv === 3 && genreRetrait({ vue: "carte", carte: "c", lieu: "l" }) === "lieu", "le lieu d'une carte : la carte reste, zoomée");
const avant = avantDe(plan);
verifier(avant.vue === "plan" && avant.plan === "p" && json(avant.camera) === json(plan.camera), "une vue plein écran note le plan qu'elle recouvre");
const boutique = { vue: "boutique", boutique: "b", article: "x", avant, plan: "p", lieu: null };
verifier(json(avantDe(boutique)) === json(avant), "par-dessus une autre vue pleine : celle que l'autre avait notée");
r = etatRetire(boutique);
verifier(r.vue === "plan" && r.plan === "p" && json(r.camera) === json(plan.camera) && r.boutique === null && r.article === null && r.avant === null, `la boutique retirée : le plan revient (${json(r)})`);
r = etatRetire({ vue: "sanctuaire", batiment: "forge", avant: { vue: "boutique", boutique: "b" } });
verifier(r.vue === "accueil" && r.batiment === null, "une vue pleine notée par-dessus une autre vue pleine : l'accueil");
r = etatRetire({ vue: "planche", contrat: "c1", avant: null });
verifier(r.vue === "accueil" && r.contrat === null, "la planche sans vue notée : l'accueil");
r = etatRetire({ vue: "image", url: "/media/a.png", titre: "Aude", avant: { vue: "carte", carte: "c", camera: null, lieu: null, url: null, titre: null } });
verifier(r.vue === "carte" && r.carte === "c" && r.url === null, "une illustration retirée : la carte d'avant revient");
verifier(json(etatRetire(plan)) === json({ vue: "accueil" }) && genreRetrait(plan) === "tout", "un plan seul : l'accueil");
r = etatRetire({ vue: "accueil", pnj: "g" });
verifier(r.vue === "accueil" && r.pnj === null, "un carton sur l'accueil : il s'en va");

// ---- Rien de révélé ----
verifier(!rienDeRevele(null) && !rienDeRevele({ brouillard_actif: false, sol: [1], brouillard: [0] }), "sans brouillard, la TV voit tout");
verifier(rienDeRevele({ brouillard_actif: true, sol: [1, 1], brouillard: [0, 0] }), "tout caché : noir");
verifier(!rienDeRevele({ brouillard_actif: true, sol: [1, 1], brouillard: [0, 1] }), "une case révélée : la TV montre quelque chose");
verifier(rienDeRevele({ brouillard_actif: true, sol: [0, 1], brouillard: [1, 0] }), "révélé hors des sols : toujours noir");
verifier(!rienDeRevele({ brouillard_actif: true, sol: [0, 0], brouillard: [1, 0], fond: { url: "/media/f.png" } }), "révélé sur une image de fond : visible");
verifier(rienDeRevele({ brouillard_actif: true }), "un plan sans tableaux, sous brouillard : noir");

// ---- Avant de jouer ----
const noir = { id: "ferme", nom: "La Grange-Noire", brouillard_actif: true, sol: [1], brouillard: [0] };
const clair = { id: "moulin", nom: "Le moulin", brouillard_actif: true, sol: [1], brouillard: [1] };
const seance = { id: "s1", deroule: [{ titre: "A", liens: { plan: "ferme" } }, { titre: "B", liens: { plan: "moulin" } }, { titre: "C", fait: true, liens: { plan: "ferme" } }] };
let lignes = avantDeJouer(seance, { plans: [noir, clair] });
const ligne = lignes.find((l) => l.genre === "plans");
verifier(ligne && json(ligne.items.map((p) => p.id)) === json(["ferme"]), `un plan noir lié à une scène à venir (${json(lignes)})`);
const html = htmlAvantDeJouer(lignes);
verifier(html.includes("Plan lié sans pièce révélée") && html.includes('href="#/plan/ferme"') && html.includes("la TV restera noire"), "la ligne mène au plan");
lignes = avantDeJouer({ ...seance, deroule: [seance.deroule[2], seance.deroule[1]] }, { plans: [noir, clair] });
verifier(!lignes.some((l) => l.genre === "plans"), "une scène jouée ne compte plus, un plan révélé non plus");
verifier(!avantDeJouer(seance, {}).some((l) => l.genre === "plans"), "sans les plans chargés : rien à dire");
verifier(avantDeJouer({ ...seance, close: true }, { plans: [noir] }).length === 0, "une séance close : rien");
lignes = avantDeJouer({ deroule: [{ liens: { plan: "ferme" } }, { liens: { plan: "ferme" } }, { liens: { plan: "autre" } }] }, { plans: [noir, { ...noir, id: "autre", nom: "L'autre" }] });
verifier(lignes.find((l) => l.genre === "plans")?.items.length === 2 && htmlAvantDeJouer(lignes).includes("Plans liés sans pièce révélée"), "deux plans noirs, chacun une fois");

// ---- Les images d'un plan sur la table publique (allegerPlan, avec le leger de table.js) ----
{
  const MEDIA = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;
  const legerSur = (internet) => (url, largeur, transparence = false) => {
    const m = internet && typeof url === "string" ? MEDIA.exec(url) : null;
    return m ? `/api/table/vignette/${m[1]}?l=${largeur}${transparence ? "&a=1" : ""}` : url;
  };
  const plan = () => ({
    pions: [{ id: "a", image: "/media/portrait-a.jpg" }, { id: "b", image: "/media/img-b.png", image_libre: true }, { id: "c", image: "" }],
    objets: [{ id: "i", cle: "image", image: "/media/decor.png" }, { id: "j", cle: "image", image: "" }, { id: "t", cle: "table" }],
  });
  const p = allegerPlan(plan(), legerSur(true));
  verifier(p.pions[0].image === "/api/table/vignette/portrait-a.jpg?l=160", "table publique : le portrait d'un pion en vignette de 160 px");
  verifier(p.pions[1].image === "/api/table/vignette/img-b.png?l=160&a=1", "table publique : l'image libre d'un pion garde sa transparence");
  verifier(p.pions[2].image === "", "table publique : un pion sans image le reste");
  verifier(p.objets[0].image === "/api/table/vignette/decor.png?l=640&a=1", "table publique : une image posée sur le plan en vignette de 640 px, transparente");
  verifier(p.objets[1].image === "" && !("image" in p.objets[2]), "table publique : une image vide et un meuble ne changent pas");
  verifier(json(allegerPlan(plan(), legerSur(false))) === json(plan()), "TV du salon : les images entières, rien ne change");
}

// ---- Les vrais plans ----
if (existsSync(DOSSIER)) {
  let n = 0;
  for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith(".json"))) {
    const p = JSON.parse(readFileSync(`${DOSSIER}/${f}`, "utf8"));
    // Sans image de fond, la TV cadre la boîte de ce qui est révélé (boiteRevelee) : pas de boîte, rien à montrer.
    if (p.fond) continue;
    const attendu = Boolean(p.brouillard_actif) && boiteRevelee(p) === null;
    verifier(rienDeRevele(p) === attendu, `${f} : rien de révélé ${rienDeRevele(p)}, la TV cadrerait ${json(boiteRevelee(p))}`);
    n++;
  }
  console.log(`${n} plans du dossier relus`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
