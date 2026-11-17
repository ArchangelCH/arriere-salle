// Les liens d'un scénario vers les fiches de l'atelier (PNJ, lieux, plans, rencontres, cartes) et les intertitres
// d'un chapitre. Fonctions pures : c'est le MJ qui insère un lien (bouton Fiche ou « @ »), et rien d'autre de son texte
// ne change. Côté MJ seulement, rien ne part vers la TV.

import { TYPES_LIEUX } from "../carte/biomes.js";
import { lienLieu } from "../seances/avant-de-jouer.js";
import { chercherFiches } from "../chercher/moteur.js";
import { consignesDuTexte, plier } from "./consignes.js";

// La recherche elle-même est commune à l'atelier (chercher/moteur.js) : « Chercher » de l'en-tête la reprend.
export { chercherFiches };

const TYPES = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
const CONSIGNE = /\[\[[\s\S]*?\]\]/g;
// Un lien Markdown, lu comme par rendu.js ; et sa forme courte dans la zone d'écriture, @[Nom] (liens-courts.js).
const LIEN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
export const COURT = /@\[([^[\]\n]+)\](?!\()/g;
const TITRE = /^(#{1,4})\s+(.*)$/;
const RANGEE = /^\s*\|.*\|\s*$/;
const SEPARATION = /^\s*\|[\s:|-]+\|\s*$/;
const FILET = /^\s*(-{3,}|\*{3,})\s*$/;
const enc = encodeURIComponent;

// Dans l'ordre où la recherche les présente à égalité.
export const GENRES_FICHES = {
  pnj: { nom: "PNJ", route: (f) => `#/pnj/${enc(f.id)}` },
  lieu: { nom: "Lieu", route: lienLieu },
  plan: { nom: "Plan", route: (f) => `#/plan/${enc(f.id)}` },
  rencontre: { nom: "Rencontre", route: (f) => `#/combats/${enc(f.id)}` },
  carte: { nom: "Carte", route: (f) => `#/carte/${enc(f.id)}` },
};
const ORDRE = Object.keys(GENRES_FICHES);

const sansCrochets = (t) => String(t || "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

// Toutes les fiches qu'un lien peut viser, triées par genre puis par nom. Une liste absente (null) est passée. Chacune
// porte aussi la carte où elle vit (celle du lieu, pour un PNJ ou un plan) : « @ » propose d'abord celles du scénario.
export function fichesDe({ pnj, lieux, plans, rencontres, cartes } = {}) {
  const nomLieu = Object.fromEntries((lieux || []).map((l) => [l.id, l.nom]));
  const carteLieu = Object.fromEntries((lieux || []).map((l) => [l.id, l.carte || null]));
  const carteDe = { pnj: (p) => carteLieu[p.lieu], lieu: (l) => l.carte, plan: (p) => carteLieu[p.lieu], rencontre: () => null, carte: (c) => c.id };
  const sortie = [];
  const ajouter = (genre, liste, detail) => {
    for (const f of liste || []) {
      if (!f?.id) continue;
      const nom = sansCrochets(f.nom) || "Sans nom";
      sortie.push({ genre, id: f.id, nom, detail: detail(f), route: GENRES_FICHES[genre].route(f), cle: plier(nom),
        nomGenre: GENRES_FICHES[genre].nom, ordre: ORDRE.indexOf(genre), carte: carteDe[genre](f) || null });
    }
  };
  ajouter("pnj", pnj, (p) => [p.role, nomLieu[p.lieu]].filter(Boolean).join(" · "));
  ajouter("lieu", lieux, (l) => TYPES[l.type] || "");
  ajouter("plan", plans, (p) => nomLieu[p.lieu] || "");
  ajouter("rencontre", rencontres, () => "");
  ajouter("carte", cartes, () => "");
  return sortie.sort((a, b) => ORDRE.indexOf(a.genre) - ORDRE.indexOf(b.genre) || a.nom.localeCompare(b.nom, "fr"));
}

// Pour « @ » et « Lier une fiche » : la place d'une fiche, 0 si un lien du scénario la vise déjà, 1 si elle vit sur la
// même carte qu'une fiche liée, 2 sinon. Un lieu se lie par sa carte (#/carte/…?lieu=…) : c'est le lieu qui compte.
export function contexteDuScenario(s, fiches) {
  const liees = new Set();
  for (const ch of s?.chapitres || []) {
    for (const m of String(ch.texte || "").matchAll(LIEN)) {
      const c = cibleLien(m[2]);
      if (c) liees.add(c.lieu ? `lieu:${c.lieu}` : `${c.genre}:${c.id}`);
    }
  }
  const cle = (f) => `${f.genre}:${f.id}`;
  const cartes = new Set((fiches || []).filter((f) => liees.has(cle(f)) && f.carte).map((f) => f.carte));
  return (f) => (liees.has(cle(f)) ? 0 : f.carte && cartes.has(f.carte) ? 1 : 2);
}

function ligneDe(t, pos) {
  const debut = pos > 0 ? t.lastIndexOf("\n", pos - 1) + 1 : 0;
  const fin = t.indexOf("\n", pos);
  return { debut, texte: t.slice(debut, fin < 0 ? t.length : fin) };
}

// La fin du lien qui contient pos (strictement à l'intérieur), écrit en entier ou court, sinon -1.
export function finDuLien(texte, pos) {
  const ligne = ligneDe(texte || "", pos);
  for (const m of [...ligne.texte.matchAll(LIEN), ...ligne.texte.matchAll(COURT)]) {
    const a = ligne.debut + m.index;
    const b = a + m[0].length;
    if (pos > a && pos < b) return b;
  }
  return -1;
}

// La fin de la consigne qui contient pos (strictement à l'intérieur), sinon -1. Un lien ne s'y pose jamais : changer
// son texte la détacherait de sa proposition.
export function finDeConsigne(texte, pos) {
  for (const m of (texte || "").matchAll(CONSIGNE)) {
    if (pos > m.index && pos < m.index + m[0].length) return m.index + m[0].length;
  }
  return -1;
}

// En début de ligne, la marque qui fait l'intertitre, l'encadré, la puce, le numéro, la cellule ou le retrait : un lien
// posé devant la déferait.
const MARQUE_LIGNE = /^[ \t]*(?:#{1,4}[ \t]+|>|[-*][ \t]+|\d+[.)][ \t]+|\|)?[ \t]*/;

// Le passage choisi, coupé en ce qui reste autour du lien (blancs, astérisques d'emphase) et son libellé ; null s'il ne
// peut pas servir de libellé : plusieurs lignes, crochet, barre de tableau, mot-clé, astérisque au milieu, marque de
// début de ligne, filet ou séparation de tableau, ou à cheval sur un lien ou une consigne.
function decouper(t, debut, fin) {
  const choisi = t.slice(debut, fin);
  const [, tete, libelle, queue] = /^([ \t*]*)([\s\S]*?)([ \t*]*)$/.exec(choisi);
  if (!libelle || libelle.length > 120 || /[\n\r[\]|#*]/.test(choisi.replace(/^\*+|\*+$/g, ""))) return null;
  for (const pos of [debut, fin]) if (finDuLien(t, pos) >= 0 || finDeConsigne(t, pos) >= 0) return null;
  const ligne = ligneDe(t, debut);
  if (FILET.test(ligne.texte) || SEPARATION.test(ligne.texte)) return null;
  if (/\S/.test(t.slice(debut, Math.min(fin, ligne.debut + MARQUE_LIGNE.exec(ligne.texte)[0].length)))) return null;
  return { tete, libelle, queue };
}

export function libelleDe(texte, debut, fin) {
  return debut < fin ? decouper(texte || "", debut, fin)?.libelle || null : null;
}

// Là où le lien peut se poser sans rien défaire : hors d'un lien ou d'une consigne, après le mot où tombe le curseur
// (un #mot-clé compris), après la marque de la ligne, avant le dernier « | » d'une rangée de tableau.
function placeSure(t, pos) {
  let p = pos;
  const lien = finDuLien(t, p);
  if (lien >= 0) p = lien;
  const consigne = finDeConsigne(t, p);
  if (consigne >= 0) p = consigne;
  if (/[\p{L}\p{N}_#]/u.test(t[p - 1] || "") && /[\p{L}\p{N}_]/u.test(t[p] || "")) p += /^(?:[\p{L}\p{N}_]|['’-](?=[\p{L}\p{N}_]))*/u.exec(t.slice(p))[0].length;
  const ligne = ligneDe(t, p);
  const marque = MARQUE_LIGNE.exec(ligne.texte)[0].length;
  if (p - ligne.debut < marque) p = ligne.debut + marque;
  const dernier = ligne.texte.lastIndexOf("|");
  if (RANGEE.test(ligne.texte) && p > ligne.debut + dernier) p = ligne.debut + dernier;
  return p;
}

// Les lignes qui ne prennent rien sans changer de nature : une consigne seule sur sa ligne (elle passerait dans la
// phrase), un filet, la ligne de séparation d'un tableau. Le lien va alors sur sa propre ligne, juste avant ou juste
// après (après le tableau entier pour la séparation). Rend { p, devant } ou null.
function lignePropre(t, p) {
  const seule = consignesDuTexte(t).find((c) => c.bloc && ((p <= c.debut && ligneDe(t, c.debut).debut <= p) || (p >= c.fin && ligneDe(t, p).debut <= c.fin)));
  if (seule) return { p, devant: p <= seule.debut };
  const ligne = ligneDe(t, p);
  const finLigne = ligne.debut + ligne.texte.length;
  if (FILET.test(ligne.texte)) return { p: finLigne, devant: false };
  if (!SEPARATION.test(ligne.texte)) return null;
  let fin = finLigne;
  while (fin < t.length) {
    const suivante = ligneDe(t, fin + 1);
    if (!RANGEE.test(suivante.texte)) break;
    fin = suivante.debut + suivante.texte.length;
  }
  return { p: fin, devant: false };
}

// Un « @ » tapé en début de mot ouvre la recherche : précédé d'un blanc, d'une parenthèse, d'un guillemet ou d'une
// apostrophe, suivi de rien d'autre qu'un blanc ou une ponctuation (une adresse e-mail ne déclenche rien).
export function arobaseOuvre(texte, i) {
  const t = texte || "";
  if (t[i] !== "@") return false;
  const avant = i > 0 ? t[i - 1] : "";
  const apres = t[i + 1] || "";
  if (avant && !/[\s(«"“‘'’]/.test(avant)) return false;
  if (apres && /[\p{L}\p{N}_@]/u.test(apres)) return false;
  return finDuLien(t, i) < 0 && finDeConsigne(t, i) < 0;
}

// Ce qu'il faut insérer, et où : le texte devient texte.slice(0, debut) + insere + texte.slice(fin), rien d'autre ne
// bouge. Avec « @ » (arobase : sa position), le lien prend sa place ; avec un passage choisi utilisable, ce passage
// devient le libellé, tel quel ; sinon le lien se pose après le passage, à une place sûre (placeSure), avec une espace
// s'il touche un mot, ou sur sa propre ligne (lignePropre). court(libellé), s'il est donné et répond oui, écrit le lien
// court de la zone d'écriture, @[libellé] (liens-courts.js) ; jamais devant « ( » ou « ] », qui le déferaient.
export function insertionLien(texte, debut, fin, fiche, { arobase = null, court = null } = {}) {
  const t = texte || "";
  const lien = (libelle, apres = "") => (court && apres !== "(" && apres !== "]" && court(libelle) ? `@[${libelle}]` : `[${libelle}](${fiche.route})`);
  const nom = sansCrochets(fiche.nom) || "Sans nom";
  if (arobase !== null && t[arobase] === "@") return { debut: arobase, fin: arobase + 1, insere: lien(nom, t[arobase + 1]) };
  const morceaux = debut < fin ? decouper(t, debut, fin) : null;
  if (morceaux) {
    const { tete, libelle, queue } = morceaux;
    return { debut, fin, insere: `${t[debut - 1] === "[" && !tete ? " " : ""}${tete}${lien(libelle, queue ? queue[0] : t[fin])}${queue}` };
  }
  const sure = placeSure(t, fin);
  const propre = lignePropre(t, sure);
  if (propre) return { debut: propre.p, fin: propre.p, insere: propre.devant ? `${lien(nom, "\n")}\n` : `\n${lien(nom, t[propre.p])}` };
  const p = sure;
  const avant = t[p - 1] || "";
  const apres = t[p] || "";
  // Pas d'espace qui ferait d'un « * », d'un « # » ou d'un « 1. » en début de ligne une puce, un intertitre, un numéro.
  const marque = /^[ \t]*(#{1,4}|[-*]|\d+[.)])$/.test(t.slice(ligneDe(t, p).debut, p));
  const espaceAvant = avant && !marque && !/[\s(«"“‘'’/-]/.test(avant) ? " " : "";
  const espaceApres = apres && !/[\s)»"”’'.,;:!?…\]/-]/.test(apres) ? " " : "";
  return { debut: p, fin: p, insere: `${espaceAvant}${lien(nom, espaceApres || apres)}${espaceApres}` };
}

// Un intertitre, lisible dans le sommaire : sans consigne, sans balise de lien ni d'emphase.
function titreLisible(t) {
  return t.replace(CONSIGNE, "…").replace(/\[\[[\s\S]*$/, "").replace(LIEN, "$1").replace(COURT, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1$2").replace(/\s+/g, " ").trim();
}

// Les intertitres du chapitre (« # » à « #### » en début de ligne, hors des consignes), dans l'ordre où l'aperçu les
// rend : rang = place parmi les intertitres de l'aperçu, debut = début de la ligne dans le texte.
export function intertitres(texte) {
  const t = texte || "";
  const plages = [...t.matchAll(CONSIGNE)].map((m) => [m.index, m.index + m[0].length]);
  const sortie = [];
  let debut = 0;
  for (const ligne of t.split("\n")) {
    const m = plages.some(([a, b]) => debut > a && debut < b) ? null : TITRE.exec(ligne);
    if (m) sortie.push({ rang: sortie.length, niveau: m[1].length, titre: titreLisible(m[2]), debut });
    debut += ligne.length + 1;
  }
  return sortie;
}

// La fiche visée par un lien de l'atelier, ou null si le lien vise autre chose.
export function cibleLien(href) {
  const [chemin, requete = ""] = String(href || "").replace(/^#/, "").split("?");
  const [vide, page, id, reste] = chemin.split("/");
  const genre = { pnj: "pnj", plan: "plan", combats: "rencontre", carte: "carte", lieu: "lieu" }[page];
  if (vide !== "" || !genre || !id || reste !== undefined || (genre === "pnj" && id === "nouveau")) return null;
  try {
    const lieu = genre === "carte" ? new URLSearchParams(requete).get("lieu") : null;
    return { genre, id: decodeURIComponent(id), lieu: lieu || null };
  } catch {
    return null;
  }
}

// Un lien vers une fiche qui n'existe plus. index : { pnj, lieu, plan, rencontre, carte } en Set d'identifiants, null
// pour une liste qui n'a pas pu être lue (rien n'est alors déclaré mort). Le lien vers un lieu d'une carte jetée vit
// tant que le lieu existe : il ouvre la fiche du lieu, là où elle est maintenant.
export function lienMort(href, index) {
  const c = cibleLien(href);
  if (!c || !index) return false;
  if (c.genre === "carte" && c.lieu && index.lieu) return !index.lieu.has(c.lieu);
  if (index[c.genre] && !index[c.genre].has(c.id)) return true;
  return Boolean(c.lieu && index.lieu && !index.lieu.has(c.lieu));
}

export function indexFiches(listes) {
  const ids = (l) => (Array.isArray(l) ? new Set(l.map((f) => f.id)) : null);
  const index = { pnj: ids(listes.pnj), lieu: ids(listes.lieux), plan: ids(listes.plans), rencontre: ids(listes.rencontres), carte: ids(listes.cartes) };
  // L'ancien identifiant d'une fiche renommée depuis (renommages : { pnj, lieux }, liens_fiches.py) : son lien y mène encore.
  for (const [genre, collection] of [["pnj", "pnj"], ["lieu", "lieux"]]) {
    for (const [ancien, neuf] of Object.entries(listes.renommages?.[collection] || {})) if (index[genre]?.has(neuf)) index[genre].add(ancien);
  }
  return index;
}
