// Plusieurs pions choisis ensemble dans l'éditeur de plan : Maj + clic (ou Ctrl, Cmd) ajoute ou retire un pion, un
// rectangle tracé sur le vide en prend plusieurs, « Sélection multiple » fait de même au doigt. Glisser l'un d'eux les
// emmène tous, montures et cavaliers compris, en gardant leur formation : le groupe s'arrête en bloc au bord du plan, au
// lieu de s'y tasser pion par pion.
// Fonctions sans page (outils/verifier_groupe_pions.mjs les rejoue) ; l'éditeur (editeur.js) tient la sélection.

import { compagnonsDeSelle } from "./pions.js";

// La sélection de l'éditeur pour ces pions : rien, un pion ({ genre: "pion", id }) ou plusieurs ({ genre: "pions",
// ids }). Les identifiants qui ne sont plus sur le plan sont oubliés, les doublons aussi ; l'ordre est gardé.
export function selectionDe(pions, ids) {
  const la = new Set((pions || []).map((t) => t.id));
  const garde = [...new Set(ids || [])].filter((id) => la.has(id));
  if (!garde.length) return null;
  return garde.length === 1 ? { genre: "pion", id: garde[0] } : { genre: "pions", ids: garde };
}

// Les pions d'une sélection (aucun pour une pièce, un meuble, un texte).
export function idsDe(selection) {
  if (selection?.genre === "pion") return [selection.id];
  if (selection?.genre === "pions") return [...selection.ids];
  return [];
}

// Ce que la vue cercle d'or (VuePlan.selection) : un identifiant, une liste, ou rien.
export const anneauxDe = (selection) => (selection?.genre === "pion" ? selection.id : selection?.genre === "pions" ? [...selection.ids] : null);

// Maj + clic : le pion rejoint les autres, ou les quitte s'il y était.
export const basculer = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

// Les pions dont le centre est dans le rectangle tracé (deux coins, dans n'importe quel ordre), dans l'ordre du plan.
// voit(t) : pour laisser de côté ceux que la vue ne montre pas.
export function dansRectangle(pions, r, voit = () => true) {
  const x0 = Math.min(r.x0, r.x1);
  const x1 = Math.max(r.x0, r.x1);
  const y0 = Math.min(r.y0, r.y1);
  const y1 = Math.max(r.y0, r.y1);
  return (pions || []).filter((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 && voit(t)).map((t) => t.id);
}

// Ceux qui bougent avec ces pions : eux-mêmes, puis la monture et les cavaliers de chacun, une seule fois chacun.
export function avecLesSelles(pions, ids) {
  const res = [];
  const vus = new Set();
  const prendre = (t) => {
    if (!t || vus.has(t.id)) return;
    vus.add(t.id);
    res.push(t);
  };
  for (const id of ids) prendre((pions || []).find((t) => t.id === id));
  for (const t of [...res]) for (const c of compagnonsDeSelle(pions, t)) prendre(c);
  return res;
}

// Ce qui suit le pion tiré : chaque autre pion du groupe (selles comprises), avec son écart au pion tiré et sa place de
// départ. Le même format que le glissé d'un cavalier et de sa monture.
export function suiveurs(pions, ids, tire) {
  return avecLesSelles(pions, [tire.id, ...ids]).filter((t) => t.id !== tire.id)
    .map((t) => ({ id: t.id, dx: t.x - tire.x, dy: t.y - tire.y, depart: [t.x, t.y] }));
}

const rayon = (t) => (t.taille || 1) / 2;

// Où poser le pion tiré pour que tout le groupe tienne dans le plan : la place voulue (x, y), ramenée en bloc. membres :
// [{ t, dx, dy }], l'écart de chacun au pion tiré. Un groupe plus large que le plan (jamais, s'il y était posé) se cale
// sur son bord gauche et son bord haut.
export function placeDuGroupe(tire, membres, x, y, largeur, hauteur) {
  let [xMin, xMax, yMin, yMax] = [rayon(tire), largeur - rayon(tire), rayon(tire), hauteur - rayon(tire)];
  for (const m of membres) {
    const r = rayon(m.t);
    xMin = Math.max(xMin, r - m.dx);
    xMax = Math.min(xMax, largeur - r - m.dx);
    yMin = Math.max(yMin, r - m.dy);
    yMax = Math.min(yMax, hauteur - r - m.dy);
  }
  return [Math.max(xMin, Math.min(x, Math.max(xMin, xMax))), Math.max(yMin, Math.min(y, Math.max(yMin, yMax)))];
}

// Le pas (dx, dy) que tout le groupe peut faire d'un bloc sans sortir du plan : le pas voulu, raccourci s'il le faut
// (nul contre le bord).
export function pasDuGroupe(pions, dx, dy, largeur, hauteur) {
  let [gauche, droite, haut, bas] = [Infinity, Infinity, Infinity, Infinity];
  for (const t of pions) {
    const r = rayon(t);
    gauche = Math.min(gauche, t.x - r);
    droite = Math.min(droite, largeur - r - t.x);
    haut = Math.min(haut, t.y - r);
    bas = Math.min(bas, hauteur - r - t.y);
  }
  const borne = (v, moins, plus) => (v < 0 ? -Math.min(-v, Math.max(0, moins)) : Math.min(v, Math.max(0, plus)));
  return [borne(dx, gauche, droite) || 0, borne(dy, haut, bas) || 0];
}
