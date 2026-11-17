// Ce que « Chercher » trouve dans l'atelier, tiré de l'index de /api/recherche (recherche.py) : les fiches de jeu
// d'abord (celles de « Lier une fiche », par fichesDe, mêmes routes et mêmes détails, puis les aventuriers, les
// boutiques, l'auberge, les séances et les règles maison), chacune avec ses champs de jeu ; puis les idées et les
// passages des scénarios. Fonctions pures, côté MJ seulement.

import { fichesDe } from "../scenarios/fiches.js";
import { assezLong, chercherFiches, extrait, mots, passagesDuScenario, placesDesMots, plier, propre } from "./moteur.js";

const enc = encodeURIComponent;
const STATUTS_REGLE = { "a-trancher": "À trancher", "en-vigueur": "En vigueur" };
// Les genres des documents remis aux joueurs (documents/rendu.js), en clair sous le titre.
const NOMS_DOCUMENTS = { lettre: "lettre manuscrite", affiche: "affiche", note: "note griffonnée", parchemin: "parchemin officiel", plan: "plan griffonné" };
const court = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// Dans l'ordre où « Chercher » les présente à égalité de rang.
export const GENRES = {
  pnj: { nom: "PNJ" },
  lieu: { nom: "Lieu" },
  aventurier: { nom: "Aventurier" },
  boutique: { nom: "Boutique" },
  plan: { nom: "Plan" },
  rencontre: { nom: "Rencontre" },
  carte: { nom: "Carte" },
  contrat: { nom: "Contrat" },
  rumeur: { nom: "Rumeur" },
  document: { nom: "Document" },
  seance: { nom: "Séance" },
  regle: { nom: "Règle maison" },
};
const ORDRE = Object.keys(GENRES);

// Un champ de jeu : [libellé, valeur ou fonction de la fiche]. Les vides sont passés.
const champs = (x, liste) => liste.map(([libelle, v]) => ({ libelle, texte: propre(typeof v === "function" ? v(x) : x[v]) })).filter((c) => c.texte);
const noms = (liste, cle = "nom") => (Array.isArray(liste) ? liste.map((o) => o?.[cle]).filter((t) => typeof t === "string") : []);

const CHAMPS = {
  pnj: (p) => champs(p, [["Surnom", "surnom"], ["Faction", "faction"], ["Peuple", "peuple"], ["Apparence", "apparence"], ["Voix", "voix"],
    ["Envie", "envie"], ["Secret", "secret"], ["Offre", "offre"], ["Capacités", "capacites"], ["Notes", "notes"], ["Scénario", "scenario"]]),
  lieu: (l) => champs(l, [["Résumé", "resume"], ["Notes", "notes"], ["Secrets", "secrets"]]),
  plan: (p) => champs(p, [["Étage", "etage"], ["Notes", "notes"],
    ["Pièces", (x) => (x.pieces || []).map((o) => [o.nom, o.notes].filter(Boolean).join(" : "))], ["Sur le plan", (x) => noms(x.textes, "texte")]]),
  rencontre: (r) => champs(r, [["Adversaires", (x) => noms(x.adversaires)], ["Notes", "notes"], ["Capacités", (x) => noms(x.adversaires, "capacites")]]),
  carte: (c) => champs(c, [["Sur la carte", (x) => noms(x.etiquettes, "texte")]]),
};

// Les champs de jeu d'une fiche (PNJ, lieu, plan, rencontre, carte), tels que la recherche les lit et les rappelle.
export const champsDe = (genre, x) => (CHAMPS[genre] ? CHAMPS[genre](x || {}) : []);

const parId = (liste) => Object.fromEntries((Array.isArray(liste) ? liste : []).filter((x) => x?.id).map((x) => [x.id, x]));

function dateEnClair(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" });
}

// Toutes les fiches de jeu de l'index, avec leurs champs, leur genre, leur ordre, leur date et leur route.
export function fichesDeLIndex(ix = {}) {
  const sources = { pnj: parId(ix.pnj), lieu: parId(ix.lieux), plan: parId(ix.plans), rencontre: parId(ix.rencontres), carte: parId(ix.cartes) };
  const nomPnj = (id) => sources.pnj[id]?.nom || "";
  const nomLieu = (id) => sources.lieu[id]?.nom || "";
  const sortie = fichesDe({ pnj: ix.pnj, lieux: ix.lieux, plans: ix.plans, rencontres: ix.rencontres, cartes: ix.cartes }).map((f) => {
    const x = sources[f.genre][f.id] || {};
    return { ...f, nomGenre: GENRES[f.genre].nom, ordre: ORDRE.indexOf(f.genre), champs: CHAMPS[f.genre](x), modifie: x.modifie || "",
      inconnu: (f.genre === "pnj" || f.genre === "lieu") && x.connu !== true };
  });
  const ajouter = (genre, x, nom, detail, route, desChamps) => {
    const n = propre(nom) || "Sans nom";
    sortie.push({ genre, id: x.id, nom: n, cle: plier(n), detail: propre(detail), route, nomGenre: GENRES[genre].nom, ordre: ORDRE.indexOf(genre),
      champs: desChamps, modifie: x.modifie || "" });
  };
  for (const a of ix.aventuriers || []) {
    const joueur = a.joueur ? `${a.genre === "f" ? "jouée" : "joué"} par ${a.joueur}` : "";
    ajouter("aventurier", a, a.nom, [joueur, a.tablee === false ? "hors de la tablée" : ""].filter(Boolean).join(" · "), `#/aventuriers/${enc(a.id)}`,
      champs(a, [["Peuple", "peuple"], ["Spécialité", "specialite"], ["Avant l'aventure", "avant"], ["Allure", "allure"], ["Défaut", "defaut"],
        ["Contacts", "contacts"], ["Équipement", "equipement"], ["Objets", "objets"], ["Armes", (x) => noms(x.armes)], ["Dons", (x) => noms(x.dons)],
        ["Histoire", "histoire"], ["Secret", "secret"], ["Notes du MJ", "notes_mj"]]));
  }
  for (const b of ix.boutiques || []) {
    const articles = (b.articles || []).filter((x) => propre(x.nom)).map((x) => ({
      libelle: "Article", texte: [x.nom, x.description, x.note_mj].map(propre).filter(Boolean).join(" · "),
      route: `#/boutiques/${enc(b.id)}?article=${enc(x.id || "")}`,
    }));
    ajouter("boutique", b, b.nom, [nomPnj(b.marchand), nomLieu(b.lieu)].filter(Boolean).join(" · "), `#/boutiques/${enc(b.id)}`,
      [...champs(b, [["Accroche", "accroche"]]), ...articles, ...champs(b, [["Notes du MJ", "notes_mj"]])]);
  }
  for (const c of ix.contrats || []) {
    ajouter("contrat", c, c.nom, c.genre === "avis" ? "avis officiel" : "", `#/auberge/contrat/${enc(c.id)}`,
      champs(c, [["Affiche", "affiche"], ["Récompense", "recompense"], ["Contact", "contact"], ["Vérité", "verite"]]));
  }
  for (const r of ix.rumeurs || []) {
    ajouter("rumeur", r, court(propre(r.texte), 90), r.source ? `selon ${r.source}` : "", `#/auberge/rumeur/${enc(r.id)}`,
      champs(r, [["Rumeur", "texte"], ["Le fond", "fond"]]));
  }
  for (const d of ix.documents || []) {
    ajouter("document", d, d.nom || "Document sans titre", NOMS_DOCUMENTS[d.genre] || "", `#/documents/${enc(d.id)}`,
      champs(d, [["Texte", "texte"], ["Signature", "signature"], ["Notes du MJ", "notes_mj"]]));
  }
  for (const s of ix.seances || []) {
    const numero = s.numero !== undefined && s.numero !== null && s.numero !== "" ? `Séance ${s.numero}` : "Séance";
    ajouter("seance", s, [numero, s.nom].filter(Boolean).join(" · "), [dateEnClair(s.date), s.close ? "close" : ""].filter(Boolean).join(" · "),
      `#/seances/${enc(s.id)}`, champs(s, [["Objectif", "objectif"], ["Scénario", "scenario"], ["Déroulé", (x) => (x.deroule || []).map((d) => [d.titre, d.note].filter(Boolean).join(" : "))],
        ["Notes", "notes"]]));
  }
  for (const r of ix.regles || []) {
    ajouter("regle", r, r.titre, STATUTS_REGLE[r.statut] || "", `#/regles/${enc(r.id)}`, champs(r, [["Règle", "texte"], ["Contexte", "contexte"]]));
  }
  return sortie;
}

// Les fiches modifiées le plus récemment : ce que propose « Chercher » avant la première lettre.
export function recentes(fiches, n = 8) {
  return fiches.filter((f) => f.modifie).sort((a, b) => b.modifie.localeCompare(a.modifie)).slice(0, n);
}

// La route d'un résultat : celle du champ qui répond quand il en a une (un article ouvre sa boutique sur lui).
export const routeDe = (f) => f.trouve?.route || f.route;

export function fichesTrouvees(fiches, recherche, max = 30) {
  return chercherFiches(fiches, recherche, { max });
}

// Les idées dont le texte a chacun des mots cherchés, avec leur extrait.
export function ideesTrouvees(idees, recherche, max = 5) {
  const motsQ = mots(recherche);
  if (!motsQ.length || !assezLong(recherche)) return [];
  const sortie = [];
  for (const i of idees || []) {
    const texte = propre(i.texte);
    const { zones, trouves } = placesDesMots(texte, motsQ);
    if (trouves.size === motsQ.length) sortie.push({ id: i.id, etat: i.etat || "a-creuser", html: extrait(texte, zones, { largeur: 110 }), modifie: i.modifie || "" });
  }
  return sortie.sort((a, b) => b.modifie.localeCompare(a.modifie)).slice(0, max);
}

// Les scénarios dont le titre répond, puis les passages de leurs chapitres (l'expression entière d'abord) : la route
// ouvre le chapitre et y choisit le passage.
export function scenariosTrouves(scenarios, recherche, max = 6) {
  const motsQ = mots(recherche);
  if (!motsQ.length || !assezLong(recherche)) return [];
  const sortie = [];
  for (const s of scenarios || []) {
    const nom = propre(s.nom) || "Sans titre";
    const { trouves } = placesDesMots(nom, motsQ);
    if (trouves.size === motsQ.length) sortie.push({ href: `#/scenarios/${enc(s.id)}`, nom, ou: "le scénario", html: extrait(propre(s.resume), placesDesMots(propre(s.resume), motsQ).zones, { largeur: 110 }) });
  }
  for (const s of scenarios || []) {
    for (const p of passagesDuScenario(s, recherche, { max })) {
      if (sortie.length >= max) return sortie;
      sortie.push({ href: `#/scenarios/${enc(s.id)}?chapitre=${enc(p.chapitre)}&chercher=${enc(recherche)}&passage=${p.n}`, nom: propre(s.nom) || "Sans titre",
        ou: `ch. ${p.numero} · ${p.titre}`, html: p.html });
    }
  }
  return sortie.slice(0, max);
}
