// Ce que montre la TV, pour l'atelier : l'état de la table avec ses vrais identifiants (GET /api/table), relu dès que le
// canal de l'atelier (canal-table.js) annonce autre chose à l'écran, et nommé (« la boutique L'Échoppe du Gué »). Le
// témoin de l'en-tête, les boutons « Montrer à la TV » des fiches et les cadres des onglets lisent tous cet état-là :
// aucun ne décrit la TV à sa façon. Les modules que le coin des joueurs charge aussi (créateur, galerie) ne peuvent pas
// importer ce fichier : ils écoutent l'événement « etat-tv » du document, qui porte le même état.

import { api } from "../api.js";
import { ecouterTable } from "./canal-table.js";
import { cartonsTv, cleTv, combatTv, etatRetire, rienDeRevele, vueTv } from "./tv-commun.js";
import { estInvite } from "../mj/role.js";

// La feuille des témoins et des boutons de la TV (css/tv-atelier.css), liée une fois, par le premier module qui en a besoin.
const FEUILLE = "/static/css/tv-atelier.css";
if (!document.querySelector(`link[href="${FEUILLE}"]`)) {
  const lien = document.createElement("link");
  lien.rel = "stylesheet";
  lien.href = FEUILLE;
  document.head.append(lien);
}

const PERIODE = 20000; // le nombre d'écrans branchés, relu toutes les vingt secondes tant que la page est visible
const ecouteurs = new Set();
let reel = null; // le dernier GET /api/table
let description = null;
let demarre = false;
let enCours = null;
let relancer = false;
let nomsEnAttente = false;
let cleLue = null; // ce que montrait la TV à la dernière description (vrais identifiants)
let clePublique = null; // la même chose dans le dernier état reçu par le canal (jetons)
let versionPublique = null; // la version du plan montré, pour revoir s'il est encore tout noir
let minuteriePlan = 0;
let dernierAvis = ""; // ce que les écouteurs ont reçu en dernier : une relecture qui ne change rien ne les dérange pas

const annoncer = () => document.dispatchEvent(new CustomEvent("etat-tv", { detail: { etat: reel, description } }));
const avertir = () => {
  for (const fn of [...ecouteurs]) {
    try {
      fn(reel, description);
    } catch (err) {
      console.error(err);
    }
  }
  annoncer();
};
// Un module qui écoute « etat-tv » sans importer ce fichier demande le dernier état connu (« etat-tv-demande »).
document.addEventListener("etat-tv-demande", () => {
  demarrer();
  if (reel && description) annoncer();
});

// fn(etat, description) à chaque changement de ce que montre la TV, et tout de suite avec le dernier connu. etat : l'état
// de la table (vrais identifiants, écrans branchés) ; description : ce qu'il montre, nommé (voir decrire). Renvoie de
// quoi cesser d'écouter.
export function ecouterTv(fn) {
  ecouteurs.add(fn);
  demarrer();
  if (reel && description) fn(reel, description);
  return () => ecouteurs.delete(fn);
}

export const descriptionTv = () => description;

function demarrer() {
  if (demarre) return;
  demarre = true;
  relireTv();
  ecouterTable((pub) => {
    // Une autre vue, une autre fiche, un autre carton : relu et renommé. La caméra qui suit le MJ ne relit rien. Le même
    // plan réenregistré : peut-être une pièce révélée, relu un peu plus tard (pendant qu'on révèle, les enregistrements
    // se suivent).
    // « par » : l'autre MJ a pris la main sur le même écran, l'onglet Table relit qui l'a.
    const cle = `${cleTv(pub)}|${pub.par || ""}`;
    const version = vueTv(pub) === "plan" ? pub.version : null;
    if (cle !== clePublique) {
      clePublique = cle;
      versionPublique = version;
      return relireTv();
    }
    if (version !== versionPublique) {
      versionPublique = version;
      clearTimeout(minuteriePlan);
      minuteriePlan = setTimeout(() => relireTv({ noms: true }), 900);
    }
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && ecouteurs.size) relireTv();
  }, PERIODE);
  window.addEventListener("focus", () => relireTv());
}

// Relit l'état de la table (noms : renommer même si la TV montre la même chose). Une lecture déjà partie est suivie
// d'une autre : la dernière dit toujours l'état le plus récent.
export function relireTv({ noms = false } = {}) {
  if (enCours) {
    relancer = true;
    nomsEnAttente ||= noms;
    return enCours;
  }
  enCours = (async () => {
    const etat = await api.get("/api/table");
    const cle = cleTv(etat);
    if (noms || cle !== cleLue || !description) {
      description = await decrire(etat);
      cleLue = cle;
    } else description = { ...description, ...ecransDe(etat) };
    reel = etat;
    // L'heure du dernier envoi (maj) change à chaque geste, même sans rien changer à l'écran.
    const avis = JSON.stringify([{ ...etat, maj: null }, description]);
    if (avis !== dernierAvis) {
      dernierAvis = avis;
      avertir();
    }
    return reel;
  })()
    .catch(() => reel)
    .finally(() => {
      enCours = null;
      if (relancer) {
        relancer = false;
        const encore = nomsEnAttente;
        nomsEnAttente = false;
        relireTv({ noms: encore });
      }
    });
  return enCours;
}

const ecransDe = (t) => ({ ecrans: +t.ecrans || 0, ecransSalon: +t.ecrans_salon || 0, ecransInternet: +t.ecrans_internet || 0 });

async function lireFiche(chemin) {
  try {
    return await api.get(chemin);
  } catch {
    return null;
  }
}

const fiche = (collection, id) => lireFiche(`/api/${collection}/${encodeURIComponent(id)}`);
// Les vues publiques de la table (api/tv_*.py), par référence : ce que lit la TV d'une fiche désignée par son jeton.
const VUES_PUBLIQUES = { plan: "plan", lieu: "lieu", pnj: "pnj", rumeur: "rumeur", document: "document", boutique: "boutique", aventurier: "aventurier" };
const court = (t, n = 60) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// Ce que montre la TV, nommé : quoi (la vue, comme table.js la choisit), genre et nom (pour le témoin), lien (la fiche
// dans l'atelier), detail (ce qui est montré de près), cartons posés par-dessus, lieu montré sur une carte, noire (un plan
// sous brouillard dont rien n'est révélé), combat (l'ordre du tour est en haut de l'écran), et les écrans branchés.
export async function decrire(t) {
  const quoi = vueTv(t);
  const d = { quoi, genre: "", nom: "", lien: "", detail: "", cartons: [], lieu: null, noire: false, combat: combatTv(t), ...ecransDe(t) };
  const travaux = [];
  // Ce que montre la TV et qui est à l'autre MJ (deux MJ, lot MJ-6) : GET /api/table le désigne par son jeton (« jetons »).
  // Son nom se lit comme la TV le lit (/api/table/…), et le témoin n'y mène pas : l'atelier de cette page ne l'a pas.
  // Sans autre MJ, la liste est vide et rien ne change.
  const jetons = new Set(Array.isArray(t.jetons) ? t.jetons : []);
  const lire = (cle, collection, id) => (!jetons.has(cle) ? fiche(collection, id)
    : VUES_PUBLIQUES[cle] ? lireFiche(`/api/table/${VUES_PUBLIQUES[cle]}/${encodeURIComponent(id)}`) : Promise.resolve(null));
  const vers = (cle, lien) => (jetons.has(cle) ? "" : lien);
  if (quoi === "accueil") Object.assign(d, { genre: "Accueil", nom: "L'écran d'accueil" });
  else if (quoi === "plan") {
    travaux.push(lire("plan", "plans", t.plan).then((p) => {
      Object.assign(d, { genre: "Plan", nom: p?.nom || "Un plan", lien: vers("plan", `#/plan/${t.plan}`), noire: rienDeRevele(p) });
    }));
  } else if (quoi === "carte") {
    // Une carte de l'autre MJ : son nom tel que « Le monde » le donne (GET /api/monde, sous le même jeton).
    travaux.push(lireFiche(jetons.has("carte") ? "/api/monde" : "/api/cartes").then((liste) => {
      const cartes = jetons.has("carte") ? liste?.cartes : liste;
      const c = Array.isArray(cartes) ? cartes.find((x) => x.id === t.carte) : null;
      Object.assign(d, { genre: "Carte", nom: c?.nom || "Une carte", lien: vers("carte", `#/carte/${t.carte}`) });
    }));
    if (t.lieu) {
      travaux.push(lire("lieu", "lieux", t.lieu).then((l) => {
        d.lieu = { nom: l?.nom || "un lieu", lien: jetons.has("carte") || jetons.has("lieu") ? "" : `#/carte/${t.carte}?lieu=${t.lieu}` };
      }));
    }
  } else if (quoi === "image") Object.assign(d, { genre: "Illustration", nom: court(t.titre) || "Une illustration" });
  else if (quoi === "document") {
    travaux.push(lire("document", "documents", t.document).then((x) => {
      Object.assign(d, { genre: "Document", nom: court(x?.nom) || "Un document", lien: vers("document", `#/documents/${t.document}`) });
    }));
  }
  else if (quoi === "heros") Object.assign(d, { genre: "Tablée", nom: "La tablée", lien: estInvite() ? "#/tablee" : "#/aventuriers" });
  else if (quoi === "fiches") Object.assign(d, { genre: "Tablée", nom: "Les fiches de la tablée", lien: "#/tablee" });
  else if (quoi === "planche") {
    Object.assign(d, { genre: "Auberge", nom: "La planche à contrats", lien: "#/auberge" });
    if (t.contrat) {
      travaux.push(lire("contrat", "contrats", t.contrat).then((c) => {
        d.detail = court(c?.nom) || "une affiche";
        if (!jetons.has("contrat")) d.lien = `#/auberge/contrat/${t.contrat}`;
      }));
    }
  } else if (quoi === "boutique") {
    travaux.push(lire("boutique", "boutiques", t.boutique).then((b) => {
      const article = t.article ? (b?.articles || []).find((a) => a.id === t.article) : null;
      Object.assign(d, { genre: "Boutique", nom: b?.nom || "Une boutique", lien: vers("boutique", `#/boutiques/${t.boutique}`), detail: article ? court(article.nom) || "un article" : "" });
    }));
  } else if (quoi === "sanctuaire") {
    Object.assign(d, { genre: "Sanctuaire", nom: "Le sanctuaire", lien: estInvite() ? "" : "#/sanctuaire" });
    if (t.batiment) {
      travaux.push(lireFiche("/api/sanctuaire").then((s) => {
        const b = (s?.batiments || []).find((x) => x.id === t.batiment);
        d.detail = court(b?.nom) || "un bâtiment";
        if (!estInvite()) d.lien = `#/sanctuaire/${t.batiment}`;
      }));
    }
  } else if (quoi === "precedemment" || quoi === "episode") {
    Object.assign(d, { genre: "Séance", nom: quoi === "episode" ? "Le titre de l'épisode" : "Précédemment", lien: vers("seance", `#/seances/${t.seance}`) });
    travaux.push(lire("seance", "seances", t.seance).then((s) => {
      if (s?.numero) d.detail = `séance ${s.numero}`;
    }));
  }
  for (const cle of cartonsTv(t)) {
    const carton = { cle, nom: "", lien: "" };
    d.cartons.push(carton);
    if (cle === "pnj") {
      carton.lien = vers("pnj", `#/pnj/${t.pnj}`);
      travaux.push(lire("pnj", "pnj", t.pnj).then((p) => (carton.nom = p?.nom || "un PNJ")));
    } else if (cle === "rumeur") {
      carton.lien = vers("rumeur", `#/auberge/rumeur/${t.rumeur}`);
      travaux.push(lire("rumeur", "rumeurs", t.rumeur).then((r) => (carton.nom = r?.texte ? `« ${court(r.texte, 48)} »` : "une rumeur")));
    } else {
      carton.lien = vers("aventurier", `#/aventuriers/${t.aventurier}`);
      travaux.push(lire("aventurier", "aventuriers", t.aventurier).then((a) => (carton.nom = a?.nom || "un aventurier")));
    }
  }
  await Promise.all(travaux);
  await commeLaTv(d);
  return d;
}

// Les noms tels que la TV les montre : le nom caché de l'auberge y devient « l'auberge » (le serveur seul connaît ce nom,
// POST /api/masque). Le témoin dit ce que voient les joueurs ; sans réponse, les noms restent tels quels.
const SEPARATION = "\n¶\n";
async function commeLaTv(d) {
  const champs = [[d, "nom"], [d, "detail"], [d.lieu, "nom"], ...d.cartons.map((c) => [c, "nom"])].filter(([o, k]) => o && o[k]);
  if (!champs.length) return;
  try {
    const r = await api.post("/api/masque", { texte: champs.map(([o, k]) => o[k]).join(SEPARATION) });
    const parts = r?.trouve ? String(r.texte || "").split(SEPARATION) : [];
    if (parts.length === champs.length) champs.forEach(([o, k], i) => (o[k] = parts[i]));
  } catch {
    // les noms restent ceux des fiches
  }
}

const voyelle = (t) => /^[aeiouyàâäéèêëîïôöùûüœh]/i.test(String(t || ""));
export const de = (nom) => (voyelle(nom) ? `d'${nom}` : `de ${nom}`);

// La vue seule, en clair : « la boutique « L'Échoppe du Gué », et de près « Corde » ».
export function phraseVue(d) {
  if (!d) return "";
  const guillemets = (t) => `«\u00a0${t}\u00a0»`;
  switch (d.quoi) {
    case "plan": return `le plan ${guillemets(d.nom)}${d.noire ? ", encore tout dans le brouillard" : ""}`;
    case "carte": return `la carte ${guillemets(d.nom)}${d.lieu ? `, et le lieu ${guillemets(d.lieu.nom)}` : ""}`;
    case "image": return d.nom && d.nom !== "Une illustration" ? `l'illustration ${guillemets(d.nom)}` : "une illustration";
    case "document": return d.nom && d.nom !== "Un document" ? `le document ${guillemets(d.nom)}` : "un document";
    case "heros": return "la tablée des aventuriers";
    case "fiches": return "les fiches de la tablée";
    case "planche": return d.detail ? `la planche, et de près ${guillemets(d.detail)}` : "la planche à contrats";
    case "boutique": return `la boutique ${guillemets(d.nom)}${d.detail ? `, et de près ${guillemets(d.detail)}` : ""}`;
    case "sanctuaire": return d.detail ? `le sanctuaire, et de près ${guillemets(d.detail)}` : "le sanctuaire";
    case "precedemment": return `le «\u00a0Précédemment\u00a0»${d.detail ? ` de la ${d.detail}` : ""}`;
    case "episode": return "le titre de l'épisode";
    default: return "l'écran d'accueil";
  }
}

// Un carton, en clair : « le carton de Gaspard Tourbe », « une rumeur ».
export function phraseCarton(c) {
  if (c.cle === "rumeur") return c.nom && c.nom !== "une rumeur" ? `la rumeur ${c.nom}` : "une rumeur";
  return `le carton ${de(c.nom)}`;
}

// Ce que voient les joueurs, en une phrase sans majuscule : les cartons d'abord, la vue d'en dessous ensuite, et l'ordre
// du combat quand il est en haut de l'écran.
export function phraseTv(d) {
  if (!d) return "";
  const vue = phraseVue(d) + (d.combat ? ", avec l'ordre du combat en haut" : "");
  if (!d.cartons.length) return vue;
  const cartons = d.cartons.map(phraseCarton);
  const liste = cartons.length > 1 ? `${cartons.slice(0, -1).join(", ")} et ${cartons[cartons.length - 1]}` : cartons[0];
  return d.quoi === "accueil" ? liste : `${liste}, par-dessus ${vue}`;
}

// « Retirer » depuis le témoin : ce que ferait le « Retirer » de la page concernée (voir etatRetire), sur l'état relu à
// l'instant. Rend la réponse du serveur, ou null quand il n'y avait rien à retirer.
export async function retirerDeLaTv() {
  const actuel = await api.get("/api/table");
  const nouveau = etatRetire(actuel);
  if (!nouveau) return null;
  const r = await api.put("/api/table", nouveau);
  relireTv();
  return r;
}
