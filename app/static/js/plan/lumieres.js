// Les sources de lumière d'un plan (plan.habillage.lumieres), posées et réglées à la main : torche, bougie, braise, lune,
// magie… avec leur couleur, leur portée, leur intensité, un nom (une note du MJ, jamais envoyée à la TV), allumée ou
// éteinte, cachée aux joueurs ou non. Fonctions sans page (outils/verifier_lumieres.mjs les rejoue) ; le menu est dans
// lumieres-menu.js, le dessin dans peint.js (style Peint seulement) et ce que la TV reçoit dans app/ia/habillage.py.
// Les lumières qu'avait proposées la rédaction (l'habillage) sont les mêmes : elles apparaissent dans la liste.

// Chaque type : sa clé (gardée dans `type`), son nom, et les réglages d'origine d'une lumière de ce type.
export const TYPES_LUMIERE = [
  ["torche", "Torche", { rayon: 4, couleur: "#ffa94d", intensite: 0.9 }],
  ["bougie", "Bougie, chandelle", { rayon: 2, couleur: "#ffd27a", intensite: 0.7 }],
  ["lanterne", "Lanterne", { rayon: 3.5, couleur: "#ffc266", intensite: 0.85 }],
  ["brasero", "Brasero, cheminée", { rayon: 5.5, couleur: "#ff8a3d", intensite: 1 }],
  ["lune", "Clair de lune", { rayon: 8, couleur: "#9db8ff", intensite: 0.6 }],
  ["froide", "Lueur froide", { rayon: 4, couleur: "#d6e6ff", intensite: 0.8 }],
  ["magie-bleue", "Magie bleue", { rayon: 4, couleur: "#5ec8ff", intensite: 0.9 }],
  ["magie-verte", "Magie verte, poison", { rayon: 4, couleur: "#7dff8a", intensite: 0.9 }],
  ["magie-violette", "Magie violette", { rayon: 4, couleur: "#b98cff", intensite: 0.9 }],
  ["sinistre", "Lueur rouge, sinistre", { rayon: 3.5, couleur: "#ff4d4d", intensite: 0.85 }],
  ["libre", "Libre", { rayon: 3, couleur: "#ffb15e", intensite: 0.8 }],
];
export const NUANCES = [
  ["#ffb15e", "Ambre"], ["#ffd27a", "Cire"], ["#ff8a3d", "Braise"], ["#ff4d4d", "Rouge"], ["#ffffff", "Blanc"], ["#d6e6ff", "Glace"],
  ["#5ec8ff", "Bleu magique"], ["#b98cff", "Violet"], ["#7dff8a", "Vert"], ["#ffe14d", "Soleil"],
];

export const LUMIERES_MAX = 40;
export const RAYON = { min: 0.8, max: 10 };
export const INTENSITE = { min: 0.1, max: 1 };

const borne = (v, min, max, defaut) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const deux = (x) => Math.round(x * 100) / 100;
const COULEUR = /^#[0-9a-f]{6}$/i;

export const typeDe = (cle) => TYPES_LUMIERE.find(([c]) => c === cle) || null;
export const reglagesDuType = (cle) => (typeDe(cle) || typeDe("libre"))[2];
export const couleurValide = (c) => (COULEUR.test(c || "") ? c.toLowerCase() : "#ffb15e");

// La liste des lumières d'un plan, ou une liste vide. creer : l'habillage est créé s'il manque (un plan à qui l'on pose sa
// première lumière : sans heure ni ambiance, il garde le soir d'origine).
export function habillageDe(plan, creer = false) {
  if (!plan.habillage || typeof plan.habillage !== "object") {
    if (!creer) return null;
    plan.habillage = { cree: new Date().toISOString().slice(0, 16), lumieres: [], objets: [], legende: [] };
  }
  if (!Array.isArray(plan.habillage.lumieres)) plan.habillage.lumieres = [];
  return plan.habillage;
}

export const lumieresDe = (plan) => (Array.isArray(plan.habillage?.lumieres) ? plan.habillage.lumieres.filter((l) => l && typeof l === "object") : []);

// Un identifiant que rien ne porte déjà : « l » et le plus grand numéro, plus un (les lumières de la rédaction sont « l1 », « l2 »…).
export function prochainId(hab) {
  const n = (Array.isArray(hab?.lumieres) ? hab.lumieres : []).reduce((m, l) => Math.max(m, Number(/^l(\d+)$/.exec(l?.id || "")?.[1]) || 0), 0);
  return `l${n + 1}`;
}

// La pièce de la case où tombe la lumière (0 : aucune). Une lumière ne se pose que sur du sol : la structure du plan
// retire celles qui tombent hors d'une pièce (nettoyerHabillage).
export function pieceA(plan, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= plan.largeur || cy >= plan.hauteur) return null;
  const i = cy * plan.largeur + cx;
  return plan.sol[i] ? plan.piece[i] || 0 : null;
}

// Une lumière du type choisi à l'endroit voulu. Rend null (rien n'est changé) hors du sol ou au-delà du maximum.
export function ajouter(plan, type, x, y) {
  const piece = pieceA(plan, x, y);
  if (piece === null) return { erreur: "Une lumière se pose sur le sol d'une pièce." };
  if (lumieresDe(plan).length >= LUMIERES_MAX) return { erreur: `Au plus ${LUMIERES_MAX} lumières par plan.` };
  const hab = habillageDe(plan, true);
  const cle = typeDe(type) ? type : "libre";
  const l = { id: prochainId(hab), x: deux(x), y: deux(y), ...(piece ? { piece } : {}), type: cle, ...reglagesDuType(cle), source: "" };
  hab.lumieres.push(l);
  return { lumiere: l };
}

// Un changement de type remet les réglages d'origine du type (couleur, portée, intensité) ; « libre » ne touche à rien.
export function changerType(l, cle) {
  const t = typeDe(cle);
  if (!t) return;
  l.type = cle;
  if (cle !== "libre") Object.assign(l, t[2]);
}

// Un doublon, décalé d'un demi-case sur du sol si c'est possible, sinon au même endroit.
export function dupliquer(plan, l) {
  const hab = habillageDe(plan);
  if (!hab) return { erreur: "Aucune lumière à dupliquer." };
  if (lumieresDe(plan).length >= LUMIERES_MAX) return { erreur: `Au plus ${LUMIERES_MAX} lumières par plan.` };
  const decale = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]].map(([dx, dy]) => [l.x + dx, l.y + dy]).find(([x, y]) => pieceA(plan, x, y) !== null);
  const [x, y] = decale || [l.x, l.y];
  const copie = { ...l, id: prochainId(hab), x: deux(x), y: deux(y) };
  const piece = pieceA(plan, x, y);
  if (piece) copie.piece = piece;
  hab.lumieres.push(copie);
  return { lumiere: copie };
}

export const allumee = (l) => !l.eteinte;

// Allume ou éteint une lumière : une lumière éteinte garde sa place et ses réglages, mais n'éclaire personne (ni le MJ, ni la TV).
export function allumer(l, oui) {
  if (oui) delete l.eteinte;
  else l.eteinte = true;
}

// Toutes d'un coup ; rend le nombre de lumières qui ont changé.
export function toutAllumer(plan, oui) {
  let n = 0;
  for (const l of lumieresDe(plan)) {
    if (allumee(l) !== oui) {
      allumer(l, oui);
      n++;
    }
  }
  return n;
}

export const retirer = (plan, id) => {
  const hab = habillageDe(plan);
  if (hab) hab.lumieres = hab.lumieres.filter((l) => l.id !== id);
};

// Les valeurs saisies, ramenées aux bornes (le curseur et la saisie au clavier passent par ici).
export function regler(l, champ, valeur) {
  if (champ === "rayon") l.rayon = deux(borne(valeur, RAYON.min, RAYON.max, 3));
  else if (champ === "intensite") l.intensite = deux(borne(valeur, INTENSITE.min, INTENSITE.max, 0.8));
  else if (champ === "couleur") l.couleur = couleurValide(valeur);
  else if (champ === "source") l.source = String(valeur || "").slice(0, 80);
  else if (champ === "cache") {
    if (valeur) l.cache = true;
    else delete l.cache;
  } else if (champ === "allumee") allumer(l, !!valeur);
}

// Ce que montre la liste : le nom du MJ, sinon le type et le rang parmi les lumières du même type.
export function nomsDesLumieres(plan) {
  const vus = {};
  return lumieresDe(plan).map((l) => {
    const t = typeDe(l.type);
    const base = t ? t[1].split(",")[0] : "Lumière";
    vus[base] = (vus[base] || 0) + 1;
    return { id: l.id, nom: String(l.source || "").trim() || `${base} ${vus[base]}` };
  });
}

export function compter(plan) {
  const liste = lumieresDe(plan);
  return { total: liste.length, allumees: liste.filter(allumee).length, cachees: liste.filter((l) => l.cache).length };
}
