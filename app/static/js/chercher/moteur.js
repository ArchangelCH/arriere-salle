// Le moteur de recherche de l'atelier, commun à « Chercher » (l'en-tête), à « Lier une fiche » (le scénario) et aux
// listes des PNJ et des lieux. Sans accents ni majuscules : le nom d'abord, puis le détail (métier, genre de lieu), puis
// les autres champs de jeu, et le champ qui répond est rappelé sous le nom. Dans un texte long (un chapitre, une idée),
// l'expression entière d'abord. Fonctions pures, côté MJ seulement : rien ne part vers la TV ni le coin des joueurs.

import { plier } from "../scenarios/consignes.js";

export { plier };

const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const echapperRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LETTRE = "[\\p{L}\\p{N}]";
const AUTRE = "[^\\p{L}\\p{N}]";

// Les mots d'un texte, pliés.
export const mots = (t) => plier(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Un caractère à la fois, de même longueur : la place d'un mot dans le texte plié est sa place dans le texte.
function plierUnite(c) {
  const p = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (p.length === c.length) return p;
  const m = c.toLowerCase();
  return m.length === c.length ? m : c;
}
export const plierPareil = (t) => Array.from(String(t ?? ""), plierUnite).join("");

// Un texte de fiche tel qu'on le cherche et le montre : une liste devient « a · b », les blancs se resserrent.
export function propre(v) {
  const t = Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).join(" · ") : typeof v === "string" ? v : "";
  return t.replace(/\s+/g, " ").trim();
}

function fusionner(zones) {
  const sortie = [];
  for (const z of zones.sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
    const d = sortie[sortie.length - 1];
    if (d && z[0] <= d[1]) d[1] = Math.max(d[1], z[1]);
    else sortie.push([...z]);
  }
  return sortie;
}

// Une expression régulière par mot cherché : au début d'un mot du texte, jusqu'au bout de ce mot (« chuch » marque
// « chuchote »).
const motifs = (motsQ) => motsQ.map((m) => ({ m, re: new RegExp(`(?<!${LETTRE})${echapperRe(m)}${LETTRE}*`, "gu") }));

// Les places des mots cherchés dans un texte, triées et fusionnées, et les mots qui s'y trouvent.
export function placesDesMots(texte, motsQ, deja = null) {
  const plie = plierPareil(texte);
  const zones = [];
  const trouves = new Set();
  for (const { m, re } of deja || motifs(motsQ)) {
    re.lastIndex = 0;
    for (const x of plie.matchAll(re)) {
      zones.push([x.index, x.index + x[0].length]);
      trouves.add(m);
    }
  }
  return { zones: fusionner(zones), trouves };
}

// Un extrait autour de la zone choisie (la première par défaut) : environ `largeur` caractères, coupé aux blancs,
// « … » aux bouts coupés ; échappé, les zones dans des <mark>.
export function extrait(texte, zones, { largeur = 120, centre = 0 } = {}) {
  const t = String(texte ?? "");
  let debut = 0;
  let fin = t.length;
  const z = zones[centre] || zones[0];
  if (t.length > largeur) {
    const pivot = z ? z[0] : 0;
    debut = Math.max(0, Math.min(pivot - Math.round(largeur * 0.3), t.length - largeur));
    fin = Math.min(t.length, debut + largeur);
    if (debut > 0) {
      const b = t.indexOf(" ", debut);
      if (b >= 0 && b < pivot) debut = b + 1;
    }
    if (fin < t.length) {
      const b = t.lastIndexOf(" ", fin);
      if (b > (z ? z[1] : 0)) fin = b;
    }
  }
  let html = debut > 0 ? "… " : "";
  let pos = debut;
  for (const [a, b] of zones) {
    if (b <= debut || a >= fin) continue;
    const x = Math.max(a, pos);
    const y = Math.min(b, fin);
    if (y <= x) continue;
    html += `${e(t.slice(pos, x))}<mark>${e(t.slice(x, y))}</mark>`;
    pos = y;
  }
  return `${html}${e(t.slice(pos, fin))}${fin < t.length ? " …" : ""}`;
}

// Le texte échappé, chaque mot cherché dans une <mark> (un nom, une ligne courte).
export function surligner(texte, recherche) {
  const t = String(texte ?? "");
  const motsQ = mots(recherche);
  return motsQ.length ? extrait(t, placesDesMots(t, motsQ).zones, { largeur: Infinity }) : e(t);
}

// Rang d'une fiche : 0 le nom même ; 1 le nom commence ainsi ; 2 chaque mot cherché commence un mot du nom ; 3 le nom
// le contient ; 4 avec le détail ou le genre ; 5 avec un autre champ de jeu (rappelé dans `trouve`) ; -1 rien.
// Une fiche : { genre, id, nom, cle (le nom plié), detail, nomGenre, ordre, champs: [{ libelle, texte, route? }] }.
function noter(f, q, motsQ, desMotifs, avecChamps) {
  if (f.cle === q) return { r: 0 };
  if (f.cle.startsWith(q)) return { r: 1 };
  const motsNom = mots(f.nom);
  if (motsQ.every((m) => motsNom.some((w) => w.startsWith(m)))) return { r: 2 };
  if (f.cle.includes(q)) return { r: 3 };
  const tete = [...motsNom, ...mots(f.detail), ...mots(f.nomGenre)];
  const manquants = motsQ.filter((m) => !tete.some((w) => w.startsWith(m)));
  if (!manquants.length) return { r: 4 };
  if (!avecChamps || !f.champs?.length) return { r: -1 };
  // Chaque mot qui manque doit se trouver dans un autre champ ; on rappelle celui qui en porte le plus.
  const couverts = new Set();
  let meilleur = null;
  for (const c of f.champs) {
    const { zones, trouves } = placesDesMots(c.texte, motsQ, desMotifs);
    const utiles = manquants.filter((m) => trouves.has(m));
    for (const m of utiles) couverts.add(m);
    if (utiles.length && (!meilleur || utiles.length > meilleur.n)) meilleur = { c, zones, n: utiles.length };
  }
  if (couverts.size < manquants.length) return { r: -1 };
  const { c, zones } = meilleur;
  return { r: 5, trouve: { libelle: c.libelle, html: extrait(c.texte, zones), route: c.route || null } };
}

// Trois lettres au moins (les blancs ne comptent pas) : de quoi chercher dans les textes sans tout ramener.
export const assezLong = (recherche) => plier(recherche).replace(/[^\p{L}\p{N}]+/gu, "").length >= 3;

// Le nom même ; le nom ; le détail ; un autre champ. À l'intérieur d'un groupe, la place que donne le contexte passe
// avant le rang : pour « @ », une fiche déjà liée au scénario vient avant une autre au nom plus proche.
const GROUPE = [0, 1, 1, 1, 2, 3];

// Les fiches qui répondent à la recherche, les plus proches d'abord, avec `trouve` quand c'est un autre champ qui
// répond (à partir de trois lettres : avant, une lettre trouverait tout). Recherche vide : toutes (le contexte
// d'abord). options : un nombre (le plafond, comme avant), ou { max, contexte } où contexte(fiche) rend sa place (0
// d'abord).
export function chercherFiches(fiches, recherche, options = {}) {
  const { max = 30, contexte = null } = typeof options === "number" ? { max: options } : options;
  const place = contexte || (() => 0);
  const ordre = (f) => f.ordre ?? 0;
  const q = plier(recherche);
  if (!q) {
    if (!contexte) return fiches.slice();
    return fiches.map((f, i) => ({ f, i, p: place(f) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.f);
  }
  const motsQ = mots(recherche);
  const desMotifs = motifs(motsQ);
  const avecChamps = assezLong(recherche);
  return fiches.map((f) => ({ f, p: place(f), ...noter(f, q, motsQ, desMotifs, avecChamps) })).filter((x) => x.r >= 0)
    .sort((a, b) => GROUPE[a.r] - GROUPE[b.r] || a.p - b.p || a.r - b.r || ordre(a.f) - ordre(b.f) || a.f.nom.localeCompare(b.f.nom, "fr"))
    .slice(0, max).map((x) => (x.trouve ? { ...x.f, trouve: x.trouve } : x.f));
}

// Les textes longs : un chapitre, une idée

const LIEN_MD = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// Une ligne telle qu'on la lit : les liens réduits à leur libellé, une consigne entre « », sans les marques de titre,
// d'encadré, de puce ni d'emphase.
export function ligneLisible(ligne) {
  return String(ligne ?? "").replace(LIEN_MD, "$1").replace(/\[\[([\s\S]*?)\]\]/g, "« $1 »")
    .replace(/^\s*(?:#{1,4}\s+|>\s?|[-*]\s+|\d+[.)]\s+|\|)/, "").replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\p{L}\p{N}])\*([^*\s][^*]*)\*/gu, "$1$2").replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim();
}

// L'adresse d'un lien ne se cherche pas (« pnj » trouverait tous les liens) : elle devient des blancs de même longueur.
const sansAdresses = (ligne) => ligne.replace(LIEN_MD, (tout, libelle, adresse) => `[${libelle}](${" ".repeat(adresse.length)})`);

// L'expression cherchée, mot après mot, quelle que soit la ponctuation entre eux ; le premier au début d'un mot, le
// dernier jusqu'au bout du sien.
function motifExpression(recherche) {
  const ms = plierPareil(recherche).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ms.length ? new RegExp(`(?<!${LETTRE})${ms.map(echapperRe).join(`${AUTRE}+`)}${LETTRE}*`, "gu") : null;
}

function placesExpression(texte, re) {
  re.lastIndex = 0;
  return [...plierPareil(texte).matchAll(re)].map((x) => [x.index, x.index + x[0].length]);
}

// Les passages d'un texte où paraît la recherche, ligne par ligne : { debut, fin } dans le texte, et l'extrait de la
// ligne lisible. expression : l'expression entière (sinon, les lignes qui ont chacun des mots, le passage au premier).
export function passagesDe(texte, recherche, { expression = true, max = 60 } = {}) {
  const t = String(texte ?? "");
  const motsQ = mots(recherche);
  if (!motsQ.length) return [];
  const re = expression ? motifExpression(recherche) : null;
  const desMotifs = expression ? null : motifs(motsQ);
  const sortie = [];
  let debutLigne = 0;
  for (const ligne of t.split("\n")) {
    const cherchee = sansAdresses(ligne);
    let places;
    if (re) places = placesExpression(cherchee, re);
    else {
      const { zones, trouves } = placesDesMots(cherchee, motsQ, desMotifs);
      places = trouves.size === motsQ.length ? zones.slice(0, 1) : [];
    }
    if (places.length) {
      const lisible = ligneLisible(ligne);
      const zones = re ? placesExpression(lisible, re) : placesDesMots(lisible, motsQ, desMotifs).zones;
      places.forEach(([a, b], k) => {
        if (sortie.length < max) sortie.push({ debut: debutLigne + a, fin: debutLigne + b, html: extrait(lisible, zones, { centre: re ? k : 0, largeur: 140 }) });
      });
    }
    debutLigne += ligne.length + 1;
  }
  return sortie;
}

// Les passages de tous les chapitres d'un scénario : l'expression entière d'abord ; si elle n'est nulle part, les
// lignes qui ont chacun des mots. Chaque passage : { chapitre, numero, titre, n (sa place dans le chapitre), debut, fin,
// html }.
export function passagesDuScenario(s, recherche, { max = 60 } = {}) {
  const chapitres = s?.chapitres || [];
  for (const expression of [true, false]) {
    const sortie = [];
    chapitres.forEach((ch, i) => {
      passagesDe(ch.texte, recherche, { expression, max: max - sortie.length }).forEach((p, n) => {
        sortie.push({ chapitre: ch.id, numero: i + 1, titre: ch.titre || "Sans titre", n, ...p });
      });
    });
    if (sortie.length || mots(recherche).length < 2) return sortie;
  }
  return [];
}
