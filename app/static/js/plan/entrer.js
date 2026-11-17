// Entrer dans une pièce, en pleine partie : un héros visible posé sur une case encore cachée révèle sa pièce aux joueurs,
// et la TV s'élargit pour la montrer. Fonctions sans page : l'éditeur les appelle, outils/verifier_entrer.mjs les rejoue.

import { dedans, idx } from "./modele.js";

// La TV du salon est en 16/9 : son cadre se déduit de la hauteur vue (hv) d'une caméra partagée.
export const RATIO_TV = 16 / 9;

// Seul un héros que les joueurs voient entre quelque part : un pion caché (Vortan au fond de l'étang) ne révèle rien.
export const herosVisible = (t) => !!t && t.genre === "heros" && !t.cache;

// Les cases sous un pion posé : une pour un pion normal, 2 × 2 ou 3 × 3 pour les grands (posés au coin commun).
export function casesSous(t) {
  const n = Math.max(1, Math.round(t.taille || 1));
  const x0 = Math.round(t.x - n / 2);
  const y0 = Math.round(t.y - n / 2);
  const res = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) res.push([x, y]);
  return res;
}

// Le pion a-t-il changé de case depuis sa position d'avant ([x, y]) ? Un clic qui tremble d'un pixel ou une flèche
// contre le bord du plan le laissent sur sa case : ils n'entrent nulle part.
export function changeDeCase(t, [x, y]) {
  const [a] = casesSous({ ...t, x, y });
  const [b] = casesSous(t);
  return a[0] !== b[0] || a[1] !== b[1];
}

// Les pièces encore cachées sous ces pions, là où ils sont posés (le trajet ne compte pas). Sans brouillard, rien.
export function piecesEntrees(p, pions) {
  const ids = [];
  if (!p.brouillard_actif) return ids;
  for (const t of pions) {
    if (!herosVisible(t)) continue;
    for (const [x, y] of casesSous(t)) {
      if (!dedans(p, x, y)) continue;
      const i = idx(p, x, y);
      const id = p.sol[i] ? p.piece[i] : 0;
      if (id && p.brouillard[i] !== 1 && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// Toute la pièce d'un coup, comme l'outil Révéler.
export function marquerPiece(p, id, valeur) {
  for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.piece[i] === id) p.brouillard[i] = valeur;
}

// Pose les héros : les pièces cachées où ils entrent sont révélées. Rend leurs identifiants (aucun : rien n'a changé).
export function entrer(p, pions) {
  const ids = piecesEntrees(p, pions);
  for (const id of ids) marquerPiece(p, id, 1);
  return ids;
}

// La caméra qui cadre une zone sur la TV, avec sa marge (comme cameraRevelee, au format de la TV).
export function cameraSur(b, marge = 0) {
  const w = b.x1 - b.x0 + marge * 2;
  const h = b.y1 - b.y0 + marge * 2;
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r((b.x0 + b.x1) / 2), y: r((b.y0 + b.y1) / 2), hv: r(Math.max(h, w / RATIO_TV, 8)) };
}

// Ce que montre la TV. Sans caméra, elle cadre ce qui était révélé (revele) avec 2 cases de marge, ou le plan entier si
// rien ne l'était ; une caméra sans hauteur cadre le plan entier.
export function cadreTv(p, camera, revele) {
  const plan = { x0: 0, y0: 0, x1: p.largeur, y1: p.hauteur };
  const c = camera && camera.hv ? camera : camera ? cameraSur(plan) : cameraSur(revele || plan, 2);
  const dx = (c.hv * RATIO_TV) / 2;
  const dy = c.hv / 2;
  return { x0: c.x - dx, y0: c.y - dy, x1: c.x + dx, y1: c.y + dy };
}

// Si la pièce entrée (boite) sort du cadre de la TV, la caméra qui couvre ce cadre et la pièce, avec une case de marge ;
// null si la TV la montre déjà en entier.
export function cameraElargie(p, camera, revele, boite) {
  if (!boite) return null;
  const c = cadreTv(p, camera, revele);
  if (boite.x0 >= c.x0 && boite.y0 >= c.y0 && boite.x1 <= c.x1 && boite.y1 <= c.y1) return null;
  return cameraSur({
    x0: Math.min(c.x0, boite.x0 - 1), y0: Math.min(c.y0, boite.y0 - 1), x1: Math.max(c.x1, boite.x1 + 1), y1: Math.max(c.y1, boite.y1 + 1),
  });
}
